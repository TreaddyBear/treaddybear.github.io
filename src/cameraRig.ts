import { ArcRotateCamera, Camera, Effect, FreeCamera, MeshBuilder, RenderTargetTexture, Scene, ShaderMaterial, Texture, Vector3, Viewport } from "@babylonjs/core";
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

function lerpAngle(current: number, target: number, amount: number) {
  const wrappedDelta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + (wrappedDelta * amount);
}

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
  const cinematicCamera = new ArcRotateCamera("cinematic-camera", -Math.PI / 2, Math.PI / 3, 16, Vector3.Zero(), scene);
  cinematicCamera.detachControl();
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

  if (!Effect.ShadersStore.cinematicCompositeVertexShader) {
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
  }

  if (!Effect.ShadersStore.cinematicCompositeFragmentShader) {
    Effect.ShadersStore.cinematicCompositeFragmentShader = `
      precision highp float;
      varying vec2 vUV;
      uniform sampler2D primarySampler;
      uniform sampler2D secondarySampler;
      uniform float mask;
      uniform float softness;
      uniform float direction;
      uniform float texelX;

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
        float blurAmount = edgeProximity * edgeProximity * 6.0;

        vec4 blurredPrimary = directionBlur(primarySampler, vUV, blurAmount);
        vec4 blurredSecondary = directionBlur(secondarySampler, vUV, blurAmount);

        gl_FragColor = mix(blurredPrimary, blurredSecondary, blurGradient);
      }
    `;
  }

  const compositeMaterial = new ShaderMaterial("cinematic-composite-material", compositorScene, "cinematicComposite", {
    attributes: ["position", "uv"],
    uniforms: ["mask", "softness", "direction", "texelX"],
    samplers: ["primarySampler", "secondarySampler"],
  });
  compositeMaterial.disableDepthWrite = true;
  compositeMaterial.setTexture("primarySampler", primaryTarget);
  compositeMaterial.setTexture("secondarySampler", secondaryTarget);
  compositeMaterial.setFloat("softness", 0.05);
  compositeMaterial.setFloat("direction", 1);

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

    cinematicFlyby(timeSeconds: number, deltaSeconds: number, target: Vector3, radius: number) {
      const orbitRadius = Math.max(12, Math.min(30, radius));
      const targetAlpha = (timeSeconds * 0.12) - (Math.PI / 2);
      const targetBeta = 0.88 + (Math.sin(timeSeconds * 0.17) * 0.08);
      const targetRadius = orbitRadius + (Math.sin(timeSeconds * 0.09) * 1.4);
      const ease = 1 - Math.exp(-deltaSeconds * 0.75);

      camera.alpha = lerpAngle(camera.alpha, targetAlpha, ease);
      camera.beta += (targetBeta - camera.beta) * ease;
      camera.radius += (targetRadius - camera.radius) * ease;
      camera.setTarget(Vector3.Lerp(camera.target, target, ease));
    },

    cinematicPose(position: Vector3, target: Vector3, fov: number, deltaSeconds: number) {
      scene.activeCameras = null;
      scene.activeCamera = camera;
      camera.viewport = new Viewport(0, 0, 1, 1);
      const ease = 1 - Math.exp(-deltaSeconds * 1.35);
      camera.setPosition(Vector3.Lerp(camera.position, position, ease));
      camera.setTarget(Vector3.Lerp(camera.target, target, ease));
      camera.fov += (fov - camera.fov) * ease;
    },

    cinematicViewportPose(
      primary: { position: Vector3; target: Vector3; fov: number },
      secondary: { position: Vector3; target: Vector3; fov: number } | null,
      wipeProgress: number,
    ) {
      camera.setPosition(primary.position);
      camera.setTarget(primary.target);
      camera.fov = primary.fov;
      scene.activeCameras = null;
      scene.activeCamera = camera;
      camera.viewport = new Viewport(0, 0, 1, 1);

      if (!secondary) {
        return;
      }

      const wipe = Math.max(0.001, Math.min(0.999, wipeProgress));
      cinematicCamera.setPosition(secondary.position);
      cinematicCamera.setTarget(secondary.target);
      cinematicCamera.fov = secondary.fov;
      camera.viewport = new Viewport(0, 0, wipe, 1);
      cinematicCamera.viewport = new Viewport(wipe, 0, 1 - wipe, 1);
      scene.activeCameras = [cinematicCamera, camera];
    },

    renderCinematicComposite(
      primary: { position: Vector3; target: Vector3; fov: number },
      secondary: { position: Vector3; target: Vector3; fov: number },
      mask: number,
      direction = 1,
    ) {
      scene.activeCameras = null;
      camera.viewport = new Viewport(0, 0, 1, 1);
      cinematicCamera.viewport = new Viewport(0, 0, 1, 1);
      camera.setPosition(primary.position);
      camera.setTarget(primary.target);
      camera.fov = primary.fov;
      cinematicCamera.setPosition(secondary.position);
      cinematicCamera.setTarget(secondary.target);
      cinematicCamera.fov = secondary.fov;
      primaryTarget.activeCamera = camera;
      secondaryTarget.activeCamera = cinematicCamera;
      primaryTarget.render(false);
      secondaryTarget.render(false);
      compositeMaterial.setTexture("primarySampler", primaryTarget);
      compositeMaterial.setTexture("secondarySampler", secondaryTarget);
      compositeMaterial.setFloat("mask", Math.max(-0.25, Math.min(1.25, mask)));
      compositeMaterial.setFloat("direction", direction >= 0 ? 1 : 0);
      compositeMaterial.setFloat("texelX", 1 / Math.max(1, engine.getRenderWidth()));
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
