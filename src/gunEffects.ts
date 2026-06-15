import { Color3, Material, Mesh, MeshBuilder, Scene, StandardMaterial, Vector3, VertexData } from "@babylonjs/core";
import type { GunParticle, GunTracer } from "./types";
import { settings } from "./config";
import { alphaSortOrder, renderingGroups } from "./renderOrder";
import { color3ToHsl, hexToColor3, hslToColor3 } from "./utils/color";
import { terrainHeightAt } from "./world";

export type GunEffects = ReturnType<typeof createGunEffects>;

type DustCloudSpawn = {
  x: number;
  z: number;
  baseY: number;
  startHeight: number;
  velocity: Vector3;
  size: number;
  duration: number;
  alpha: number;
  startScale: number;
  endScale: number;
  horizontalScale: number;
  verticalScale: number;
  expansionDelay: number;
  expansionDuration: number;
  initialDrag: number;
  brakeDrag: number;
  brakeDelay: number;
  brakeDuration: number;
  tailDrag: number;
  groundHugSeconds: number;
  liftDuration: number;
  liftGravity: number;
  tailGravity: number;
  windDelay: number;
  windRampDuration: number;
};

function smoothstep01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - (2 * t));
}

function randomDustDuration() {
  const roll = Math.random();

  if (roll < 0.55) {
    return 18 + (Math.random() * 30);
  }

  if (roll < 0.88) {
    return 48 + (Math.pow(Math.random(), 1.35) * 72);
  }

  return 120 + (Math.pow(Math.random(), 1.7) * 90);
}

function randomScaledCount(baseCount: number, scale: number) {
  const scaledCount = Math.max(0, baseCount * scale);
  const wholeCount = Math.floor(scaledCount);
  return wholeCount + (Math.random() < scaledCount - wholeCount ? 1 : 0);
}

// Owns the transient gun tracers and dust/grass particles. Returns spawn helpers
// (called from the shot logic) and an update(dt) for the render loop.
export function createGunEffects(scene: Scene) {
  const tracers: GunTracer[] = [];
  const particles: GunParticle[] = [];

  const disposeTracer = (tracer: GunTracer) => {
    tracer.mesh.dispose();
    tracer.material.dispose();
  };

  const disposeParticle = (particle: GunParticle) => {
    particle.mesh.dispose();
    particle.material.dispose(false, false);
  };

  const createMaterial = (name: string, color: Color3, alpha: number) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.22);
    material.specularColor = Color3.Black();
    material.alpha = alpha;
    return material;
  };

  const createDustGritMaterial = (alpha: number) => {
    const color = randomDustColor();
    const material = new StandardMaterial("mower-dirt-grit-material", scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.38);
    material.specularColor = Color3.Black();
    material.alpha = alpha;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    return material;
  };

  const createDustCloudMaterial = (alpha: number) => {
    const material = new StandardMaterial("mower-dirt-cloud-material", scene);
    material.diffuseColor = Color3.White();
    material.emissiveColor = Color3.White();
    material.specularColor = Color3.Black();
    material.alpha = alpha;
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    return material;
  };

  const randomDustColor = () => {
    const base = color3ToHsl(hexToColor3(settings.dustColor));
    const hue = base.h + ((Math.random() - 0.5) * settings.dustHueVariance);
    const saturation = base.s + ((Math.random() - 0.5) * settings.dustSaturationVariance);
    const lightness = base.l + ((Math.random() - 0.5) * settings.dustLightnessVariance);
    return hslToColor3(hue, saturation, lightness);
  };

  const createDustCloudMesh = (size: number, color: Color3) => {
    const segments = 18;
    const radius = size * 0.5;
    const centerY = radius * 1.05;
    const mesh = new Mesh("mower-dirt-cloud", scene);
    const positions: number[] = [0, centerY, 0];
    const indices: number[] = [];
    const colors: number[] = [color.r, color.g, color.b, 0.92];

    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const lumpyRadius = radius * (0.86 + (Math.sin((index * 2.31) + 0.7) * 0.08) + (Math.sin(index * 5.17) * 0.05));
      positions.push(Math.cos(angle) * lumpyRadius, centerY + (Math.sin(angle) * lumpyRadius * 0.95), 0);
      colors.push(color.r, color.g, color.b, 0);
    }

    for (let index = 0; index < segments; index += 1) {
      indices.push(0, index + 1, ((index + 1) % segments) + 1);
    }

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.colors = colors;
    vertexData.applyToMesh(mesh);
    mesh.useVertexColors = true;
    mesh.hasVertexAlpha = true;
    return mesh;
  };

  const createDustGritMesh = (size: number) => MeshBuilder.CreatePlane(
    "mower-dirt-grit",
    { width: size * 0.45, height: size },
    scene,
  );

  const removeOldestParticle = (predicate: (particle: GunParticle) => boolean) => {
    const index = particles.findIndex(predicate);

    if (index < 0) {
      return false;
    }

    const oldParticle = particles.splice(index, 1)[0];
    disposeParticle(oldParticle);
    return true;
  };

  const pushParticle = (particle: GunParticle) => {
    particles.push(particle);

    while (particles.filter((item) => item.kind === "dust").length > 280) {
      removeOldestParticle((item) => item.kind === "dust");
    }

    while (particles.filter((item) => item.kind === "dustGrit").length > 90) {
      removeOldestParticle((item) => item.kind === "dustGrit");
    }

    while (particles.filter((item) => item.kind === "general").length > 180) {
      removeOldestParticle((item) => item.kind === "general");
    }

    while (particles.length > 480) {
      removeOldestParticle(() => true);
    }
  };

  const spawnParticle = (
    name: string,
    x: number,
    z: number,
    color: Color3,
    velocity: Vector3,
    size: number,
    duration: number,
    alpha = 0.78,
  ) => {
    const material = createMaterial(`${name}-material`, color, alpha);
    const mesh = MeshBuilder.CreateSphere(name, { diameter: size, segments: 4 }, scene);

    mesh.position = new Vector3(x, terrainHeightAt(x, z) + 0.08 + (Math.random() * 0.06), z);
    mesh.renderingGroupId = renderingGroups.transientEffects;
    mesh.alphaIndex = alphaSortOrder.transientEffect;
    mesh.material = material;
    pushParticle({
      mesh,
      material,
      velocity,
      kind: "general",
      age: 0,
      duration,
      spin: (Math.random() - 0.5) * 8,
      alpha,
    });
  };

  const spawnDustCloud = (spawn: DustCloudSpawn) => {
    const material = createDustCloudMaterial(spawn.alpha);
    const mesh = createDustCloudMesh(spawn.size, randomDustColor());

    mesh.position = new Vector3(spawn.x, spawn.baseY + spawn.startHeight, spawn.z);
    mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
    mesh.renderingGroupId = renderingGroups.transientEffects;
    mesh.alphaIndex = alphaSortOrder.transientEffect;
    mesh.isPickable = false;
    mesh.material = material;
    pushParticle({
      mesh,
      material,
      velocity: spawn.velocity,
      kind: "dust",
      age: 0,
      duration: spawn.duration,
      spin: 0,
      alpha: spawn.alpha,
      drag: spawn.tailDrag,
      initialDrag: spawn.initialDrag,
      brakeDrag: spawn.brakeDrag,
      brakeDelay: spawn.brakeDelay,
      brakeDuration: spawn.brakeDuration,
      fadePower: 0.68,
      startScale: spawn.startScale,
      endScale: spawn.endScale,
      horizontalScale: spawn.horizontalScale,
      verticalScale: spawn.verticalScale,
      expansionDelay: spawn.expansionDelay,
      expansionDuration: spawn.expansionDuration,
      groundHugSeconds: spawn.groundHugSeconds,
      liftDuration: spawn.liftDuration,
      liftGravity: spawn.liftGravity,
      tailGravity: spawn.tailGravity,
      windDelay: spawn.windDelay,
      windRampDuration: spawn.windRampDuration,
    });
  };

  const spawnDustGrit = (
    x: number,
    z: number,
    baseY: number,
    velocity: Vector3,
    size: number,
    duration: number,
    alpha: number,
  ) => {
    const material = createDustGritMaterial(alpha);
    const mesh = createDustGritMesh(size);

    mesh.position = new Vector3(x, baseY + 0.075 + (Math.random() * 0.035), z);
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.renderingGroupId = renderingGroups.transientEffects;
    mesh.alphaIndex = alphaSortOrder.transientEffect;
    mesh.isPickable = false;
    mesh.material = material;
    pushParticle({
      mesh,
      material,
      velocity,
      kind: "dustGrit",
      age: 0,
      duration,
      spin: 0,
      alpha,
      drag: 1.8,
      fadePower: 0.95,
      gravity: 1.0,
      startScale: 1,
      endScale: 0.55,
      expansionDuration: duration,
    });
  };

  return {
    spawnTracer(origin: Vector3, direction: Vector3, length: number) {
      const safeLength = Math.max(0.1, length);
      const material = createMaterial("gun-tracer-material", new Color3(1, 0.92, 0.58), 0.52);
      const mesh = MeshBuilder.CreateBox("gun-tracer", { width: 0.035, height: 0.028, depth: safeLength }, scene);

      mesh.position = origin.add(direction.scale(safeLength * 0.5));
      mesh.position.y = Math.max(mesh.position.y + 0.42, terrainHeightAt(mesh.position.x, mesh.position.z) + 0.38);
      mesh.rotation.y = Math.atan2(direction.x, direction.z);
      mesh.renderingGroupId = renderingGroups.transientEffects;
      mesh.alphaIndex = alphaSortOrder.transientEffect;
      mesh.material = material;
      tracers.push({ mesh, material, age: 0, duration: 0.11 });
    },

    spawnImpactDust(x: number, z: number, strength = 1) {
      const count = 5 + Math.floor(Math.random() * 5 * strength);

      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.25 + (Math.random() * 0.75 * strength);
        spawnParticle(
          "gun-impact-dust",
          x + ((Math.random() - 0.5) * 0.16),
          z + ((Math.random() - 0.5) * 0.16),
          new Color3(0.62 + (Math.random() * 0.12), 0.54 + (Math.random() * 0.1), 0.38 + (Math.random() * 0.08)),
          new Vector3(Math.cos(angle) * speed, 0.35 + (Math.random() * 0.55 * strength), Math.sin(angle) * speed),
          0.035 + (Math.random() * 0.055),
          0.38 + (Math.random() * 0.28),
          0.58,
        );
      }
    },

    spawnMowerDirtDust(
      x: number,
      z: number,
      baseY: number,
      heading: number,
      speed: number,
      strength = 1,
      windDirection = new Vector3(1, 0, 0),
      outwardDirection = new Vector3(0, 0, 0),
      emissionScale = 1,
    ) {
      const dustEmissionScale = Math.max(0, emissionScale);

      if (dustEmissionScale <= 0) {
        return;
      }

      const travelHeading = speed >= 0 ? heading : heading + Math.PI;
      const forward = new Vector3(Math.sin(travelHeading), 0, Math.cos(travelHeading));
      const side = new Vector3(forward.z, 0, -forward.x);
      const normalizedWindDirection = windDirection.lengthSquared() > 0.0001
        ? windDirection.clone().normalize()
        : new Vector3(1, 0, 0);
      const cleanOutwardDirection = outwardDirection.lengthSquared() > 0.0001
        ? outwardDirection.clone().normalize()
        : null;
      const dustStrength = Math.max(0.08, Math.min(1.5, strength));
      const maxMowerSpeed = Math.max(0.1, settings.playerSpeed * settings.playerBoost);
      const mowerSpeedAmount = Math.min(1, Math.abs(speed) / maxMowerSpeed);
      const baseCount = 1 + Math.floor(dustStrength * 3.8) + (Math.random() < dustStrength ? 1 : 0);
      const count = randomScaledCount(baseCount, dustEmissionScale);
      const windVelocity = new Vector3(
        normalizedWindDirection.x * Math.max(0, settings.windSpeed),
        0.035,
        normalizedWindDirection.z * Math.max(0, settings.windSpeed),
      );

      for (let index = 0; index < count; index += 1) {
        const baseOutwardDirection = cleanOutwardDirection
          ?? side.scale(Math.random() < 0.5 ? -1 : 1).add(forward.scale(-0.32));
        const spreadAngle = (Math.random() - Math.random()) * Math.PI * 0.5;
        const spreadCos = Math.cos(spreadAngle);
        const spreadSin = Math.sin(spreadAngle);
        const exitDirection = new Vector3(
          (baseOutwardDirection.x * spreadCos) + (baseOutwardDirection.z * spreadSin),
          0,
          (-baseOutwardDirection.x * spreadSin) + (baseOutwardDirection.z * spreadCos),
        );

        if (exitDirection.lengthSquared() < 0.0001) {
          exitDirection.copyFrom(side);
        }

        exitDirection.normalize();
        const tangent = new Vector3(-exitDirection.z, 0, exitDirection.x);
        const sourceTangent = (Math.random() - 0.5) * (0.24 + (dustStrength * 0.1));
        const sourceInset = 0.03 + (Math.random() * 0.1);
        const sourceX = x + (tangent.x * sourceTangent) - (exitDirection.x * sourceInset);
        const sourceZ = z + (tangent.z * sourceTangent) - (exitDirection.z * sourceInset);
        const exitSpeed = (2.25 + (Math.random() * 1.15) + (dustStrength * 0.42))
          * (0.74 + (mowerSpeedAmount * 0.42));
        const startHeight = 0.055 + (Math.random() * 0.035);
        const expansionDelay = 0.14 + (Math.random() * 0.11);
        const duration = randomDustDuration();

        for (let gritIndex = 0; gritIndex < 3 + Math.floor(dustStrength * 2.4); gritIndex += 1) {
          const gritSpread = (Math.random() - Math.random()) * Math.PI * 0.58;
          const gritCos = Math.cos(gritSpread);
          const gritSin = Math.sin(gritSpread);
          const gritDirection = new Vector3(
            (exitDirection.x * gritCos) + (exitDirection.z * gritSin),
            0,
            (-exitDirection.x * gritSin) + (exitDirection.z * gritCos),
          ).normalize();
          const gritSpeed = exitSpeed * (1.05 + (Math.random() * 0.42));

          spawnDustGrit(
            sourceX + ((Math.random() - 0.5) * 0.08),
            sourceZ + ((Math.random() - 0.5) * 0.08),
            baseY,
            new Vector3(
              gritDirection.x * gritSpeed,
              0.12 + (Math.random() * 0.28),
              gritDirection.z * gritSpeed,
            ),
            0.045 + (Math.random() * 0.045),
            0.48 + (Math.random() * 0.52),
            0.62,
          );
        }

        spawnDustCloud({
          x: sourceX,
          z: sourceZ,
          baseY,
          startHeight,
          velocity: new Vector3(
            exitDirection.x * exitSpeed,
            0.012 + (Math.random() * 0.026),
            exitDirection.z * exitSpeed,
          ),
          size: 0.42 + (Math.random() * 0.4) + (dustStrength * 0.28),
          duration,
          alpha: 0.14 + (dustStrength * 0.1),
          startScale: 0.018 + (Math.random() * 0.026),
          endScale: 1.25 + (Math.random() * 0.72),
          horizontalScale: 1,
          verticalScale: 1,
          expansionDelay,
          expansionDuration: 0.52 + (Math.random() * 0.42),
          initialDrag: 0.04,
          brakeDrag: 5.2,
          brakeDelay: expansionDelay,
          brakeDuration: 0.56 + (Math.random() * 0.28),
          tailDrag: 0.06,
          groundHugSeconds: 0.08 + (Math.random() * 0.06),
          liftDuration: expansionDelay + 1.3 + (Math.random() * 0.7),
          liftGravity: -0.055,
          tailGravity: 0,
          windDelay: expansionDelay + 0.3 + (Math.random() * 0.22),
          windRampDuration: 2.2 + (Math.random() * 1.4),
        });

        const particle = particles[particles.length - 1];
        if (particle?.kind === "dust") {
          particle.windInfluence = 1.15;
          particle.windVelocity = windVelocity.clone();
        }
      }
    },

    spawnGrassFleck(x: number, z: number, direction: Vector3) {
      const side = new Vector3(direction.z, 0, -direction.x);
      const sideAmount = (Math.random() - 0.5) * 1.1;
      const forwardAmount = 0.25 + (Math.random() * 0.45);
      const color = Math.random() > 0.35
        ? new Color3(0.24, 0.62 + (Math.random() * 0.14), 0.1)
        : new Color3(0.42, 0.5, 0.14);

      spawnParticle(
        "gun-grass-fleck",
        x,
        z,
        color,
        new Vector3(
          (direction.x * forwardAmount) + (side.x * sideAmount),
          0.45 + (Math.random() * 0.45),
          (direction.z * forwardAmount) + (side.z * sideAmount),
        ),
        0.025 + (Math.random() * 0.035),
        0.28 + (Math.random() * 0.22),
        0.72,
      );
    },

    update(deltaSeconds: number) {
      for (let index = tracers.length - 1; index >= 0; index -= 1) {
        const tracer = tracers[index];
        tracer.age += deltaSeconds;
        const life = 1 - (tracer.age / tracer.duration);

        if (life <= 0) {
          tracers.splice(index, 1);
          disposeTracer(tracer);
          continue;
        }

        tracer.material.alpha = 0.52 * life;
        tracer.mesh.scaling.x = 0.65 + (life * 0.35);
        tracer.mesh.scaling.y = 0.65 + (life * 0.35);
      }

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.age += deltaSeconds;
        const life = 1 - (particle.age / particle.duration);

        if (life <= 0) {
          particles.splice(index, 1);
          disposeParticle(particle);
          continue;
        }

        const brakeDelay = particle.brakeDelay ?? 0;
        const brakeDuration = particle.brakeDuration ?? 0;
        let drag = particle.drag ?? 0;

        if (particle.brakeDrag !== undefined && particle.age < brakeDelay + brakeDuration) {
          drag = particle.age < brakeDelay ? particle.initialDrag ?? drag : particle.brakeDrag;
        }

        if (drag > 0) {
          particle.velocity.scaleInPlace(Math.max(0, 1 - (drag * deltaSeconds)));
        }

        if (particle.windVelocity && particle.windInfluence) {
          const windAge = particle.age - (particle.windDelay ?? 0);

          if (windAge > 0) {
            const windRamp = Math.min(1, windAge / Math.max(0.001, particle.windRampDuration ?? 0.001));
            const windBlend = Math.min(1, particle.windInfluence * windRamp * deltaSeconds);

            particle.velocity.x += (particle.windVelocity.x - particle.velocity.x) * windBlend;
            particle.velocity.y += (particle.windVelocity.y - particle.velocity.y) * windBlend;
            particle.velocity.z += (particle.windVelocity.z - particle.velocity.z) * windBlend;
          }
        }

        let gravity = particle.gravity ?? 2.4;

        if (particle.liftGravity !== undefined) {
          const groundHugSeconds = particle.groundHugSeconds ?? 0;
          const liftEndsAt = groundHugSeconds + (particle.liftDuration ?? 0);

          if (particle.age < groundHugSeconds) {
            gravity = 0;
          } else if (particle.age < liftEndsAt) {
            gravity = particle.liftGravity;
          } else {
            gravity = particle.tailGravity ?? 0;
          }
        } else if (particle.age < (particle.groundHugSeconds ?? 0)) {
          gravity = Math.max(0, gravity);
        }

        particle.velocity.y -= gravity * deltaSeconds;
        particle.mesh.position.addInPlace(particle.velocity.scale(deltaSeconds));

        if (particle.kind === "general") {
          particle.mesh.rotation.x += particle.spin * deltaSeconds;
          particle.mesh.rotation.z += particle.spin * 0.6 * deltaSeconds;
        }

        const startScale = particle.startScale ?? 1;
        const endScale = particle.endScale ?? 0.35;
        const expansionDelay = particle.expansionDelay ?? 0;
        const expansionDuration = Math.max(0.001, particle.expansionDuration ?? particle.duration);
        const scaleRatio = smoothstep01((particle.age - expansionDelay) / expansionDuration);
        const scale = startScale + ((endScale - startScale) * scaleRatio);

        particle.mesh.scaling.x = scale * (particle.horizontalScale ?? 1);
        particle.mesh.scaling.y = scale * (particle.verticalScale ?? 1);
        particle.mesh.scaling.z = scale;
        particle.material.alpha = particle.alpha * Math.pow(Math.max(0, life), particle.fadePower ?? 1);
      }
    },
  };
}
