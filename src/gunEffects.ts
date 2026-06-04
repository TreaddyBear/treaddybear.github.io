import { Color3, MeshBuilder, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import type { GunParticle, GunTracer } from "./types";
import { terrainHeightAt } from "./world";

export type GunEffects = ReturnType<typeof createGunEffects>;

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
    particle.material.dispose();
  };

  const createMaterial = (name: string, color: Color3, alpha: number) => {
    const material = new StandardMaterial(name, scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.22);
    material.specularColor = Color3.Black();
    material.alpha = alpha;
    return material;
  };

  const pushParticle = (particle: GunParticle) => {
    particles.push(particle);

    while (particles.length > 180) {
      const oldParticle = particles.shift();
      if (oldParticle) {
        disposeParticle(oldParticle);
      }
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
    mesh.material = material;
    pushParticle({
      mesh,
      material,
      velocity,
      age: 0,
      duration,
      spin: (Math.random() - 0.5) * 8,
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
      mesh.material = material;
      tracers.push({ mesh, material, age: 0, duration: 0.11 });
    },

    spawnImpactDust(x: number, z: number, strength = 1) {
      const count = 5 + Math.floor(Math.random() * 5 * strength);

      for (let i = 0; i < count; i += 1) {
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
      for (let i = tracers.length - 1; i >= 0; i -= 1) {
        const tracer = tracers[i];
        tracer.age += deltaSeconds;
        const life = 1 - (tracer.age / tracer.duration);

        if (life <= 0) {
          tracers.splice(i, 1);
          disposeTracer(tracer);
          continue;
        }

        tracer.material.alpha = 0.52 * life;
        tracer.mesh.scaling.x = 0.65 + (life * 0.35);
        tracer.mesh.scaling.y = 0.65 + (life * 0.35);
      }

      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i];
        particle.age += deltaSeconds;
        const life = 1 - (particle.age / particle.duration);

        if (life <= 0) {
          particles.splice(i, 1);
          disposeParticle(particle);
          continue;
        }

        particle.velocity.y -= 2.4 * deltaSeconds;
        particle.mesh.position.addInPlace(particle.velocity.scale(deltaSeconds));
        particle.mesh.rotation.x += particle.spin * deltaSeconds;
        particle.mesh.rotation.z += particle.spin * 0.6 * deltaSeconds;
        particle.mesh.scaling.setAll(0.35 + (life * 0.65));
        particle.material.alpha = 0.72 * life;
      }
    },
  };
}
