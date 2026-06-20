import { ArcRotateCamera, Camera, DynamicTexture, Effect, FreeCamera, MeshBuilder, Quaternion, RenderTargetTexture, Scene, ShaderMaterial, Texture, Vector3, Viewport } from "@babylonjs/core";
import type { Engine } from "@babylonjs/core";
import { settings } from "./config";
import type { AnalogInput, InputMode } from "./input";
import { updateFollowCamera } from "./world";

export type CameraRig = ReturnType<typeof createCameraRig>;

export type CameraRigDeps = {
  scene: Scene;
  engine: Engine;
  keys: Set<string>;
  analogInput: AnalogInput;
  getYaw: () => number;
  getPlayerPosition: () => Vector3;
  getInputMode: () => InputMode;
  perfEl: HTMLDivElement | null;
};

type DragState = {
  active: boolean;
  pointerId: number;
  lastX: number;
  lastY: number;
};

type CameraRigState = {
  orbitYaw: number;
  orbitHeight: number;
  distanceOffset: number;
  adjustmentCount: number;
  adjustmentCooldown: number;
  returnDelay: number;
  returning: boolean;
  isPortrait: boolean;
  perfSampleTime: number;
  currentHardwareScale: number;
  drag: DragState;
};

type GrassTossParticle = {
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  vx: number;
  verticalDrag: number;
  angle: number;
  spin: number;
  size: number;
  age: number;
  life: number;
  bornColumnX: number;
};

// Owns the chase camera and everything that aims it: orbit/return-to-behind
// state, right-drag and wheel control, portrait FOV/framing, and optional
// adaptive resolution. The render loop calls updateInput/follow; canvas pointer
// handlers delegate begin/drag/end/zoom.
export function createCameraRig(deps: CameraRigDeps) {
  const {
    scene,
    engine,
    keys,
    analogInput,
    getYaw,
    getPlayerPosition,
    getInputMode,
    perfEl: perfElement,
  } = deps;

  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 3, 16, Vector3.Zero(), scene);
  camera.detachControl();
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 24;
  // Two free cameras dedicated to the attract cinematic. The director drives
  // their position and rotationQuaternion DIRECTLY from its physics state (never
  // setTarget / look-at), so orientation carries its own angular inertia — a
  // heavy head, not a weightless gimbal pinned to a subject.
  const cinePrimaryCam = new FreeCamera("cine-primary-camera", Vector3.Zero(), scene);
  const cineSecondaryCam = new FreeCamera("cine-secondary-camera", Vector3.Zero(), scene);
  for (const cam of [cinePrimaryCam, cineSecondaryCam]) {
    cam.detachControl();
    cam.rotationQuaternion = Quaternion.Identity();
    cam.minZ = 0.05;
    cam.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
  }
  const primaryTarget = new RenderTargetTexture("cinematic-primary", { ratio: 1 }, scene, false, true);
  const secondaryTarget = new RenderTargetTexture("cinematic-secondary", { ratio: 1 }, scene, false, true);
  primaryTarget.renderListPredicate = () => true;
  secondaryTarget.renderListPredicate = () => true;
  primaryTarget.renderParticles = true;
  secondaryTarget.renderParticles = true;
  primaryTarget.wrapU = Texture.CLAMP_ADDRESSMODE;
  primaryTarget.wrapV = Texture.CLAMP_ADDRESSMODE;
  secondaryTarget.wrapU = Texture.CLAMP_ADDRESSMODE;
  secondaryTarget.wrapV = Texture.CLAMP_ADDRESSMODE;

  const compositorScene = new Scene(engine);
  compositorScene.autoClear = true;
  const compositorCamera = new FreeCamera("cinematic-compositor-camera", new Vector3(0, 0, -1), compositorScene);
  compositorCamera.mode = Camera.ORTHOGRAPHIC_CAMERA;
  compositorCamera.orthoLeft = -1;
  compositorCamera.orthoRight = 1;
  compositorCamera.orthoBottom = -1;
  compositorCamera.orthoTop = 1;
  compositorCamera.setTarget(Vector3.Zero());
  compositorScene.activeCamera = compositorCamera;

  Effect.ShadersStore.cinematicCompositeVertexShader = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 vUV;

    void main(void) {
      vUV = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  Effect.ShadersStore.cinematicCompositeFragmentShader = `
      precision highp float;
      varying vec2 vUV;
      uniform sampler2D primarySampler;
      uniform sampler2D secondarySampler;
      uniform sampler2D grassMaskSampler;
      uniform float mask;
      uniform float softness;
      uniform float direction;
      uniform float texelX;
      uniform float aspect;
      uniform float wipeMode;
      uniform float wipeSeed;

      vec4 directionBlur(sampler2D sampler, vec2 uv, float blurAmount) {
        vec2 offset = vec2(texelX * blurAmount, 0.0);
        return (
          texture2D(sampler, uv - (offset * 4.0)) * 0.06
          + texture2D(sampler, uv - (offset * 3.0)) * 0.1
          + texture2D(sampler, uv - (offset * 2.0)) * 0.14
          + texture2D(sampler, uv - offset) * 0.18
          + texture2D(sampler, uv) * 0.04
          + texture2D(sampler, uv + offset) * 0.18
          + texture2D(sampler, uv + (offset * 2.0)) * 0.14
          + texture2D(sampler, uv + (offset * 3.0)) * 0.1
          + texture2D(sampler, uv + (offset * 4.0)) * 0.06
        );
      }

      float eraserKey(int index) {
        if (index == 0) { return -0.05; }
        if (index == 1) { return 0.15; }
        if (index == 2) { return 0.10; }
        if (index == 3) { return 0.30; }
        if (index == 4) { return 0.25; }
        if (index == 5) { return 0.45; }
        if (index == 6) { return 0.40; }
        if (index == 7) { return 0.60; }
        if (index == 8) { return 0.55; }
        if (index == 9) { return 0.75; }
        if (index == 10) { return 0.70; }
        if (index == 11) { return 0.90; }
        if (index == 12) { return 0.85; }
        return 1.05;
      }

      float arcEase(float t) {
        return t * t * (3.0 - (2.0 * t));
      }

      vec2 eraserArcPoint(float a, float b, float local, float columnShift) {
        float signedRadius = b - a;
        float radius = abs(signedRadius);
        float side = signedRadius >= 0.0 ? 1.0 : -1.0;
        float theta = arcEase(local) * 1.570795;
        return vec2(
          a + columnShift + (side * radius * sin(theta)),
          b - (side * radius * cos(theta))
        );
      }

      float eraserTrailCover(float a, float b, float local, float columnShift, vec2 point, float edgeHalf) {
        float best = 10.0;

        for (int stepIndex = 0; stepIndex < 9; stepIndex++) {
          float sampleT = local * (float(stepIndex) / 8.0);
          vec2 center = eraserArcPoint(a, b, sampleT, columnShift);
          best = min(best, length(point - center));
        }

        return 1.0 - smoothstep(0.12 - edgeHalf, 0.12 + edgeHalf, best);
      }

      float eraserPieCover(float a, float b, float local, float columnShift, vec2 point, float edgeHalf) {
        if (b <= a || local <= 0.0) {
          return 0.0;
        }

        float current = mix(a, b, arcEase(local));
        float radius = max(current - a, 0.0001);
        float dy = point.y - current;
        float arcSpan = sqrt(max(0.0, (radius * radius) - (dy * dy)));
        float curvedBoundary = a + columnShift + arcSpan;

        float belowStart = smoothstep(a - edgeHalf, a + edgeHalf, point.y);
        float aboveBottom = 1.0 - smoothstep(current - edgeHalf, current + edgeHalf, point.y);
        float rightOfCurve = 1.0 - smoothstep(curvedBoundary - edgeHalf, curvedBoundary + edgeHalf, point.x);

        return min(min(belowStart, aboveBottom), rightOfCurve);
      }

      float eraserColumnCover(float localTravel, float columnShift, vec2 point, float edgeHalf) {
        float traveled = 0.0;
        float cover = 0.0;

        for (int i = 0; i < 13; i++) {
          float a = eraserKey(i);
          float b = eraserKey(i + 1);
          float segmentLength = max(abs(b - a), 0.0001);
          float local = clamp((localTravel - traveled) / segmentLength, 0.0, 1.0);

          if (localTravel > traveled) {
            float pieCover = eraserPieCover(a, b, local, columnShift, point, edgeHalf);
            float trailCover = eraserTrailCover(a, b, local, columnShift, point, edgeHalf);
            cover = max(cover, max(pieCover, trailCover));
          }

          traveled += segmentLength;
        }

        return cover;
      }

      float hash11(float n) {
        return fract(sin((n * 127.1) + (wipeSeed * 311.7)) * 43758.5453123);
      }

      float eraserColumnPace(float t, float columnT) {
        t = clamp(t, 0.0, 1.0);
        float slowFastSlow = t * t * (3.0 - (2.0 * t));
        float leftWeighted = 1.0 - pow(1.0 - t, 1.0 + (columnT * 0.9));
        return mix(slowFastSlow, leftWeighted, columnT * 0.42);
      }

      float eraserMaskCover(float progress, float edgeHalf) {
        vec2 point = vec2((1.0 - vUV.x) * aspect, 1.0 - vUV.y);
        float pathLength = 1.70;
        float p = clamp(progress, 0.0, 1.0);
        float columnStride = max(0.20, (aspect + 0.16) / 7.0);
        float cover = 0.0;
        float lastFinish = 0.0;

        for (int column = 0; column < 8; column++) {
          float columnT = float(column) / 7.0;
          float columnShift = float(column) * columnStride;
          float startJitter = (hash11((float(column) * 19.0) + 7.0) - 0.5) * 0.026;
          float start = column == 0 ? 0.0 : 0.28 + ((float(column) - 1.0) * 0.024) + startJitter;
          float speed = column == 0
            ? 1.0
            : min(1.88, 1.46 + (columnT * 0.26) + (float(column) * 0.015) + (hash11((float(column) * 31.0) + 3.0) * 0.05));
          float localProgress = (p - start) * speed;
          float pacedProgress = eraserColumnPace(localProgress, columnT);
          float localTravel = pacedProgress * pathLength;
          float finish = start + (1.0 / speed);
          lastFinish = max(lastFinish, finish);

          if (localProgress > 0.0) {
            cover = max(cover, eraserColumnCover(min(localTravel, pathLength), columnShift, point, edgeHalf));
          }
        }

        float clearStart = min(max(lastFinish, 0.94), 0.985);
        cover = max(cover, smoothstep(clearStart, 1.0, p));
        return cover;
      }

      float grassPileCover(float progress) {
        return max(texture2D(grassMaskSampler, vec2(vUV.x, 1.0 - vUV.y)).r, smoothstep(0.985, 1.0, progress));
      }

      void main(void) {
        // The soft edge is ~10% of the viewport wide (edgeHalf each side of center).
        // Its CENTER travels from fully off-screen right to fully off-screen left,
        // so the blurred band never sits parked at a frame boundary (no snap).
        float edgeHalf = max(softness, 0.0001);          // half-width of the soft edge (~0.05)
        float margin = edgeHalf + 0.08;                  // start/end ~13% beyond the frame edge

        // reveal: 1 = full primary visible, 0 = full secondary visible.
        float reveal = direction > 0.5 ? mask : 1.0 - mask;
        reveal = clamp(reveal, 0.0, 1.0);

        // Edge center sweeps (1 + margin) -> (-margin) as reveal goes 1 -> 0.
        float edgePos = mix(-margin, 1.0 + margin, reveal);

        // Soft edge: 0 on the primary side, 1 on the secondary side.
        float blurGradient = smoothstep(edgePos - edgeHalf, edgePos + edgeHalf, vUV.x);

        // Directional blur peaks right at the moving edge, zero elsewhere.
        float edgeProximity = 1.0 - clamp(abs(vUV.x - edgePos) / edgeHalf, 0.0, 1.0);

        if (wipeMode > 1.5) {
          float progress = direction > 0.5 ? 1.0 - reveal : reveal;
          blurGradient = grassPileCover(progress);
          edgeProximity = (1.0 - abs((blurGradient * 2.0) - 1.0)) * 0.18;
        } else if (wipeMode > 0.5) {
          float progress = direction > 0.5 ? 1.0 - reveal : reveal;
          blurGradient = eraserMaskCover(progress, edgeHalf);
          edgeProximity = 1.0 - abs((blurGradient * 2.0) - 1.0);
        }
        float blurAmount = edgeProximity * edgeProximity * 6.0;

        vec4 blurredPrimary = directionBlur(primarySampler, vUV, blurAmount);
        vec4 blurredSecondary = directionBlur(secondarySampler, vUV, blurAmount);

        gl_FragColor = mix(blurredPrimary, blurredSecondary, blurGradient);
      }
    `;

  const compositeMaterial = new ShaderMaterial("cinematic-composite-material", compositorScene, "cinematicComposite", {
    attributes: ["position", "uv"],
    uniforms: ["mask", "softness", "direction", "texelX", "aspect", "wipeMode", "wipeSeed"],
    samplers: ["primarySampler", "secondarySampler", "grassMaskSampler"],
  });
  const grassMaskWidth = 512;
  const grassMaskHeight = 288;
  const grassMaskTexture = new DynamicTexture("grass-transition-mask", { width: grassMaskWidth, height: grassMaskHeight }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
  grassMaskTexture.wrapU = Texture.CLAMP_ADDRESSMODE;
  grassMaskTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const grassMaskCtx = grassMaskTexture.getContext() as CanvasRenderingContext2D;
  const grassBakeCanvas = document.createElement("canvas");
  grassBakeCanvas.width = grassMaskWidth;
  grassBakeCanvas.height = grassMaskHeight;
  const grassBakeCtx = grassBakeCanvas.getContext("2d") as CanvasRenderingContext2D;
  compositeMaterial.disableDepthWrite = true;
  compositeMaterial.setTexture("primarySampler", primaryTarget);
  compositeMaterial.setTexture("secondarySampler", secondaryTarget);
  compositeMaterial.setTexture("grassMaskSampler", grassMaskTexture);
  compositeMaterial.setFloat("softness", 0.05);
  compositeMaterial.setFloat("direction", 1);
  compositeMaterial.setFloat("aspect", 1);
  compositeMaterial.setFloat("wipeMode", 0);
  compositeMaterial.setFloat("wipeSeed", 0);

  let grassBakeSeed = 1;
  let grassBakeKey = "";
  let grassBakeProgress = 0;
  let grassBakeLastTime = 0;
  let grassTossAccumulator = 0;
  let grassTossParticles: GrassTossParticle[] = [];

  const resetGrassMaskCanvas = () => {
    grassBakeCtx.save();
    grassBakeCtx.globalCompositeOperation = "source-over";
    grassBakeCtx.globalAlpha = 1;
    grassBakeCtx.fillStyle = "#000";
    grassBakeCtx.fillRect(0, 0, grassMaskWidth, grassMaskHeight);
    grassBakeCtx.restore();
    grassMaskCtx.save();
    grassMaskCtx.globalCompositeOperation = "source-over";
    grassMaskCtx.globalAlpha = 1;
    grassMaskCtx.fillStyle = "#000";
    grassMaskCtx.fillRect(0, 0, grassMaskWidth, grassMaskHeight);
    grassMaskCtx.restore();
    grassMaskTexture.update(false);
  };

  const grassRandom = () => {
    grassBakeSeed |= 0;
    grassBakeSeed = (grassBakeSeed + 0x6D2B79F5) | 0;
    let t = grassBakeSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const grassColumnX = (progress: number) => {
    return (1.12 - (1.24 * Math.max(0, Math.min(1, progress)))) * grassMaskWidth;
  };

  const drawGrassBlade = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    length: number,
    angle: number,
    alpha: number,
  ) => {
    const bendNoise = Math.sin((x * 12.9898) + (y * 78.233) + (angle * 37.719)) * 43758.5453;
    const bendT = bendNoise - Math.floor(bendNoise);
    const width = length * 0.15;
    const bend = length * (0.10 + (bendT * 0.18)) * (bendT < 0.5 ? -1 : 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(0, length * 0.5);
    ctx.bezierCurveTo(-width, length * 0.18, bend - width, -length * 0.22, bend * 0.42, -length * 0.5);
    ctx.bezierCurveTo(bend + width, -length * 0.18, width, length * 0.16, 0, length * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  const stampBakedGrass = (progress: number) => {
    const columnX = grassColumnX(progress);
    const stampCount = 40;
    grassBakeCtx.save();
    grassBakeCtx.globalCompositeOperation = "lighter";

    for (let i = 0; i < stampCount; i += 1) {
      const ahead = -((0.015 + (grassRandom() * 0.075)) * grassMaskWidth);
      const behind = (grassRandom() * 0.20) * grassMaskWidth;
      const x = Math.max(-40, Math.min(grassMaskWidth + 40, columnX + ahead + behind));
      const y = (grassRandom() * (grassMaskHeight + 24)) - 12;
      const length = (22 + (grassRandom() * 24)) * (0.9 + (grassRandom() * 0.2));
      const angle = (grassRandom() * Math.PI * 2);
      drawGrassBlade(grassBakeCtx, x, y, length, angle, 0.82 + (grassRandom() * 0.18));
    }

    grassBakeCtx.restore();
  };

  const spawnGrassTossParticle = (progress: number) => {
    const columnX = grassColumnX(progress);
    const ahead = (0.05 + (grassRandom() * 0.10)) * grassMaskWidth;
    const startX = columnX - ahead + ((grassRandom() - 0.5) * 0.08 * grassMaskWidth);
    const startY = grassMaskHeight + 12 + (grassRandom() * 24);
    const vx = (0.040 + (grassRandom() * 0.045)) * grassMaskWidth;
    const life = 0.82 + (grassRandom() * 0.36);
    const targetX = startX + (vx * life);
    const targetY = (0.10 + (grassRandom() * 0.76)) * grassMaskHeight;
    grassTossParticles.push({
      startX,
      startY,
      targetX,
      targetY,
      vx,
      verticalDrag: 6.8 + (grassRandom() * 3.4),
      angle: grassRandom() * Math.PI * 2,
      spin: (grassRandom() - 0.5) * 8,
      size: (24 + (grassRandom() * 28)) * (0.9 + (grassRandom() * 0.2)),
      age: 0,
      life,
      bornColumnX: columnX,
    });
  };

  const renderGrassMask = (progress: number, deltaSeconds: number) => {
    stampBakedGrass(progress);

    grassTossAccumulator += deltaSeconds * 40;
    let spawned = 0;
    while (grassTossAccumulator >= 1 && spawned < 12) {
      grassTossAccumulator -= 1;
      spawned += 1;
      spawnGrassTossParticle(progress);
    }

    const columnX = grassColumnX(progress);
    grassTossParticles = grassTossParticles.filter((particle) => {
      particle.age += deltaSeconds;
      return particle.age < particle.life && columnX > particle.targetX - (0.07 * grassMaskWidth);
    });
    if (grassTossParticles.length > 120) {
      grassTossParticles.splice(0, grassTossParticles.length - 120);
    }

    grassMaskCtx.save();
    grassMaskCtx.globalCompositeOperation = "source-over";
    grassMaskCtx.globalAlpha = 1;
    grassMaskCtx.drawImage(grassBakeCanvas, 0, 0);
    grassMaskCtx.globalCompositeOperation = "lighter";

    for (const particle of grassTossParticles) {
      const t = Math.max(0, Math.min(1, particle.age / particle.life));
      const verticalSettle = 1 - Math.exp(-particle.verticalDrag * particle.age);
      const x = particle.startX + (particle.vx * particle.age);
      const y = particle.startY + ((particle.targetY - particle.startY) * verticalSettle);
      const alpha = 0.82 * (1 - Math.max(0, Math.min(1, (t - 0.82) / 0.18)));
      drawGrassBlade(grassMaskCtx, x, y, particle.size, particle.angle + (particle.spin * particle.age), alpha);
    }

    if (progress > 0.985) {
      grassMaskCtx.globalCompositeOperation = "source-over";
      grassMaskCtx.globalAlpha = Math.min(1, (progress - 0.985) / 0.015);
      grassMaskCtx.fillStyle = "#fff";
      grassMaskCtx.fillRect(0, 0, grassMaskWidth, grassMaskHeight);
    }

    grassMaskCtx.restore();
    grassMaskTexture.update(false);
  };

  const updateGrassTransitionMask = (progress: number, wipeSeed: number) => {
    const now = performance.now() * 0.001;
    const key = `${Math.floor(wipeSeed * 1000000)}`;
    if (grassBakeKey !== key || progress < grassBakeProgress - 0.03) {
      grassBakeKey = key;
      grassBakeSeed = (Math.floor((wipeSeed + 0.001) * 2147483647) || 1) | 0;
      grassBakeProgress = 0;
      grassBakeLastTime = now;
      grassTossAccumulator = 0;
      grassTossParticles = [];
      resetGrassMaskCanvas();
    }

    if (progress <= 0.001) {
      grassBakeProgress = 0;
      grassBakeLastTime = now;
      return;
    }

    const deltaSeconds = Math.max(1 / 120, Math.min(1 / 20, now - grassBakeLastTime));
    grassBakeLastTime = now;
    grassBakeProgress = Math.max(grassBakeProgress, progress);
    renderGrassMask(progress, deltaSeconds);
  };

  resetGrassMaskCanvas();

  const compositePlane = MeshBuilder.CreatePlane("cinematic-composite-plane", { size: 2 }, compositorScene);
  compositePlane.material = compositeMaterial;

  const cameraState: CameraRigState = {
    orbitYaw: 0,
    orbitHeight: 0,
    distanceOffset: 0,
    adjustmentCount: 0,
    adjustmentCooldown: 0,
    returnDelay: 0,
    returning: false,
    isPortrait: false,
    perfSampleTime: 0,
    currentHardwareScale: 1,
    drag: {
      active: false,
      pointerId: -1,
      lastX: 0,
      lastY: 0,
    },
  };

  const markAdjusted = () => {
    if(cameraState.adjustmentCooldown <= 0) {
      cameraState.adjustmentCount += 1;
    }

    cameraState.adjustmentCooldown = 0.45;
    cameraState.returnDelay = Math.min(18, Math.max(2.5, cameraState.adjustmentCount * 2.5));
    cameraState.returning = false;
  };

  const updateProjection = () => {
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    cameraState.isPortrait = aspect < 1;

    if(cameraState.isPortrait) {
      // Portrait (phones): fix the horizontal field of view so left/right stay
      // visible without the slit you get from a vertical-fixed FOV on a tall
      // window. The framing (zoom/angle) is handled by the follow camera.
      camera.fovMode = Camera.FOVMODE_HORIZONTAL_FIXED;
      camera.fov = settings.portraitFov;
    } else {
      camera.fovMode = Camera.FOVMODE_VERTICAL_FIXED;
      camera.fov = 0.8;
    }
  };

  updateProjection();

  return {
    camera,

    isDragging: () => cameraState.drag.active,

    markAdjusted,

    updateProjection,

    reset() {
      cameraState.orbitYaw = 0;
      cameraState.orbitHeight = 0;
      cameraState.distanceOffset = 0;
      cameraState.adjustmentCount = 0;
      cameraState.adjustmentCooldown = 0;
      cameraState.returnDelay = 0;
      cameraState.returning = false;
    },

    beginDrag(pointerId: number, x: number, y: number) {
      cameraState.drag.active = true;
      cameraState.drag.pointerId = pointerId;
      cameraState.drag.lastX = x;
      cameraState.drag.lastY = y;
    },

    // Applies a right-drag orbit. Returns true when the move was consumed as a
    // drag, so the caller skips mouse steering.
    dragTo(pointerId: number, x: number, y: number) {
      if(!cameraState.drag.active || pointerId !== cameraState.drag.pointerId) {
        return false;
      }

      cameraState.orbitYaw -= (x - cameraState.drag.lastX) * 0.006;
      cameraState.orbitHeight += (y - cameraState.drag.lastY) * 0.012;
      cameraState.orbitHeight = Math.max(-1.7, Math.min(4.8, cameraState.orbitHeight));
      markAdjusted();
      cameraState.drag.lastX = x;
      cameraState.drag.lastY = y;
      return true;
    },

    endDrag(pointerId: number) {
      if(pointerId !== cameraState.drag.pointerId) {
        return;
      }

      cameraState.drag.active = false;
      cameraState.drag.pointerId = -1;
    },

    zoom(deltaY: number) {
      cameraState.distanceOffset += deltaY * 0.008;
      cameraState.distanceOffset = Math.max(-3.2, Math.min(7.5, cameraState.distanceOffset));
      markAdjusted();
    },

    updateInput(deltaSeconds: number) {
      let adjusted = false;
      const controllerCameraTurn = analogInput.cameraTurn;
      const controllerCameraPitch = analogInput.cameraPitch;
      const hasCameraStickInput = (
        Math.abs(controllerCameraTurn) > 0
        || Math.abs(controllerCameraPitch) > 0
      );

      if(hasCameraStickInput) {
        cameraState.orbitYaw += controllerCameraTurn * deltaSeconds * 2.2;
        cameraState.orbitHeight -= controllerCameraPitch * deltaSeconds * 2.4;
        adjusted = true;
      }

      if(getInputMode() === "keyboard") {
        const arrowTurn = (keys.has("arrowright") ? 1 : 0) - (keys.has("arrowleft") ? 1 : 0);
        const arrowPitch = (keys.has("arrowdown") ? 1 : 0) - (keys.has("arrowup") ? 1 : 0);
        const hasKeyboardCameraInput = arrowTurn !== 0 || arrowPitch !== 0;

        if(hasKeyboardCameraInput) {
          cameraState.orbitYaw += arrowTurn * deltaSeconds * 2.4;
          cameraState.orbitHeight += arrowPitch * deltaSeconds * 3.1;
          adjusted = true;
        }
      }

      if(adjusted) {
        markAdjusted();
      } else {
        cameraState.adjustmentCooldown = Math.max(0, cameraState.adjustmentCooldown - deltaSeconds);

        // Only the azimuth (orbitYaw) auto-returns to "behind the mower". Pitch
        // and zoom are sticky — they stay wherever the player set them.
        const hasManualYawOffset = Math.abs(cameraState.orbitYaw) > 0.001;

        if(cameraState.adjustmentCount < 7 && hasManualYawOffset) {
          cameraState.returnDelay -= deltaSeconds;

          if(cameraState.returnDelay <= 0) {
            cameraState.returning = true;
          }
        }
      }

      if(cameraState.returning) {
        const returnAmount = Math.min(1, deltaSeconds / 7);
        // Azimuth only — leave orbitHeight (pitch) and distanceOffset (zoom) alone.
        cameraState.orbitYaw += (0 - cameraState.orbitYaw) * returnAmount;

        if(Math.abs(cameraState.orbitYaw) < 0.004) {
          cameraState.orbitYaw = 0;
          cameraState.returning = false;
          cameraState.adjustmentCount = 0;
        }
      }

      cameraState.orbitHeight = Math.max(-1.7, Math.min(4.8, cameraState.orbitHeight));
      cameraState.distanceOffset = Math.max(-3.2, Math.min(7.5, cameraState.distanceOffset));
    },

    follow(deltaSeconds: number) {
      scene.activeCameras = null;
      scene.activeCamera = camera;
      camera.viewport = new Viewport(0, 0, 1, 1);
      const baseDistance = cameraState.isPortrait ? settings.portraitDistance : 7.2;
      const baseHeight = cameraState.isPortrait ? settings.portraitHeight : 4.2;
      const lookAhead = cameraState.isPortrait ? settings.portraitLookAhead : 0;
      camera.fov = cameraState.isPortrait ? settings.portraitFov : 0.8;

      updateFollowCamera(
        camera,
        getPlayerPosition(),
        getYaw(),
        deltaSeconds,
        cameraState.orbitYaw,
        cameraState.orbitHeight,
        cameraState.distanceOffset,
        baseDistance,
        baseHeight,
        lookAhead,
      );
    },

    // Render the attract cinematic: two free cameras (primary = current shot,
    // secondary = the next shot warming up) render to their own targets, then the
    // wipe shader composites primary over secondary. Each pose is a world position
    // + an absolute orientation quaternion (NOT a look-at target) + a vertical fov.
    renderCinematicComposite(
      primary: { position: Vector3; rotation: Quaternion; fov: number },
      secondary: { position: Vector3; rotation: Quaternion; fov: number },
      mask: number,
      direction = 1,
      wipeMode = 0,
      wipeSeed = 0,
    ) {
      scene.activeCameras = null;

      const applyPose = (cam: FreeCamera, pose: { position: Vector3; rotation: Quaternion; fov: number }) => {
        cam.position.copyFrom(pose.position);
        (cam.rotationQuaternion ??= Quaternion.Identity()).copyFrom(pose.rotation);
        cam.fov = pose.fov;
        cam.viewport = new Viewport(0, 0, 1, 1);
      };

      applyPose(cinePrimaryCam, primary);
      applyPose(cineSecondaryCam, secondary);
      primaryTarget.activeCamera = cinePrimaryCam;
      secondaryTarget.activeCamera = cineSecondaryCam;
      primaryTarget.render(false);
      secondaryTarget.render(false);
      compositeMaterial.setTexture("primarySampler", primaryTarget);
      compositeMaterial.setTexture("secondarySampler", secondaryTarget);
      compositeMaterial.setTexture("grassMaskSampler", grassMaskTexture);
      compositeMaterial.setFloat("mask", Math.max(-0.25, Math.min(1.25, mask)));
      compositeMaterial.setFloat("direction", direction >= 0 ? 1 : 0);
      compositeMaterial.setFloat("aspect", engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()));
      compositeMaterial.setFloat("wipeMode", wipeMode);
      compositeMaterial.setFloat("wipeSeed", wipeSeed);
      compositeMaterial.setFloat("texelX", 1 / Math.max(1, engine.getRenderWidth()));
      if (wipeMode > 1.5) {
        const reveal = Math.max(0, Math.min(1, direction >= 0 ? mask : 1 - mask));
        const progress = direction >= 0 ? 1 - reveal : reveal;
        updateGrassTransitionMask(progress, wipeSeed);
      }
      compositorScene.render();
    },

    // Optional adaptive resolution: sample FPS twice a second and nudge the
    // engine hardware-scaling level so a struggling device renders lower-res
    // and a comfortable one returns toward native. Off by default.
    updateAdaptiveResolution(deltaSeconds: number) {
      cameraState.perfSampleTime += deltaSeconds;

      if(cameraState.perfSampleTime < 0.5) {
        return;
      }

      cameraState.perfSampleTime = 0;
      const fps = engine.getFps();

      if(settings.dynamicResolution) {
        const mobileLike = getInputMode() === "touch" || window.innerWidth < 620;
        const maxHardwareScale = mobileLike ? 1.45 : 2;
        const shouldRaiseHardwareScale = (
          fps < settings.targetFps - 5
          && cameraState.currentHardwareScale < maxHardwareScale
        );
        const shouldLowerHardwareScale = (
          fps >= settings.targetFps - 1
          && cameraState.currentHardwareScale > 1
        );

        if(shouldRaiseHardwareScale) {
          cameraState.currentHardwareScale = Math.min(
            maxHardwareScale,
            cameraState.currentHardwareScale + 0.08,
          );
          engine.setHardwareScalingLevel(cameraState.currentHardwareScale);
        } else if(shouldLowerHardwareScale) {
          cameraState.currentHardwareScale = Math.max(1, cameraState.currentHardwareScale - 0.06);
          engine.setHardwareScalingLevel(cameraState.currentHardwareScale);
        }
      } else if(cameraState.currentHardwareScale !== 1) {
        cameraState.currentHardwareScale = 1;
        engine.setHardwareScalingLevel(1);
      }

      if(perfElement && !perfElement.hidden) {
        perfElement.textContent = `${Math.round(fps)} fps \u00B7 ${cameraState.currentHardwareScale.toFixed(2)}x`;
      }
    },
  };
}
