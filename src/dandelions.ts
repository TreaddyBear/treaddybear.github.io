import { Color3, DynamicTexture, Material, Mesh, MeshBuilder, StandardMaterial, TransformNode, Vector3, VertexBuffer } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { getActiveMap, yardSegments } from "./config";
import type { Materials } from "./materials";
import type { Dandelion, FallingPetal, FloatingSeed } from "./types";
import type { Wind } from "./wind";
import { distanceToShot } from "./utils/geometry";
import { randomPointInSegments } from "./utils/yard";

export type Dandelions = ReturnType<typeof createDandelions>;

// Owns the dandelions plus their detached floating seeds and falling petals.
// Mowing/shooting query it; it leans on wind for clipping bursts and a callback
// for the flower-pop sound so it stays decoupled from the audio module.
export function createDandelions(
  scene: Scene,
  materials: Materials,
  wind: Wind,
  getYaw: () => number,
  playFlowerPop: () => void,
) {
  const dandelions: Dandelion[] = [];
  const floatingSeeds: FloatingSeed[] = [];
  const fallingPetals: FallingPetal[] = [];

  // One soft seed-tuft sprite (fine light filaments + a dark seed dot in the
  // middle), drawn once and shared by every billboarded fuzz plane, so the puff
  // reads as dense airy fluff instead of a cluster of hard little balls.
  const fluffTexture = new DynamicTexture("dandelionFluff", { width: 64, height: 64 }, scene, false);
  fluffTexture.hasAlpha = true;
  const fluffCtx = fluffTexture.getContext() as CanvasRenderingContext2D;
  fluffCtx.clearRect(0, 0, 64, 64);
  for (let i = 0; i < 46; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const r = 16 + (Math.random() * 14);
    fluffCtx.strokeStyle = `rgba(255,255,250,${0.18 + (Math.random() * 0.3)})`;
    fluffCtx.lineWidth = 1;
    fluffCtx.beginPath();
    fluffCtx.moveTo(32, 32);
    fluffCtx.lineTo(32 + (Math.cos(a) * r), 32 + (Math.sin(a) * r));
    fluffCtx.stroke();
  }
  const fluffGlow = fluffCtx.createRadialGradient(32, 32, 1, 32, 32, 17);
  fluffGlow.addColorStop(0, "rgba(255,255,250,0.85)");
  fluffGlow.addColorStop(0.5, "rgba(255,255,250,0.3)");
  fluffGlow.addColorStop(1, "rgba(255,255,250,0)");
  fluffCtx.fillStyle = fluffGlow;
  fluffCtx.beginPath();
  fluffCtx.arc(32, 32, 17, 0, Math.PI * 2);
  fluffCtx.fill();
  fluffCtx.fillStyle = "rgba(58,36,15,0.95)"; // the dark seed dot
  fluffCtx.beginPath();
  fluffCtx.arc(32, 32, 2.3, 0, Math.PI * 2);
  fluffCtx.fill();
  fluffTexture.update();

  const fluffMaterial = new StandardMaterial("dandelionFluffMaterial", scene);
  fluffMaterial.diffuseTexture = fluffTexture;
  fluffMaterial.diffuseColor = new Color3(1, 1, 1);
  fluffMaterial.emissiveColor = new Color3(0.46, 0.46, 0.42); // lift so it reads light/airy
  fluffMaterial.specularColor = Color3.Black();
  fluffMaterial.useAlphaFromDiffuseTexture = true;
  fluffMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
  fluffMaterial.backFaceCulling = false;

  // Tiny dark-brown seed knob at the centre of the puff.
  const seedCoreMaterial = new StandardMaterial("dandelionSeedCoreMaterial", scene);
  seedCoreMaterial.diffuseColor = new Color3(0.2, 0.12, 0.05);
  seedCoreMaterial.specularColor = Color3.Black();

  const clear = () => {
    while (dandelions.length > 0) {
      const dandelion = dandelions.pop();
      dandelion?.root.dispose(false, true);
      // Detached seeds/petals were re-parented OFF the root, so disposing the
      // root leaves them behind as stray white fluff at random spots on the next
      // level. Dispose them explicitly.
      for (const piece of dandelion?.detachedPieces ?? []) {
        piece.dispose();
      }
    }
    while (floatingSeeds.length > 0) {
      floatingSeeds.pop()?.mesh.dispose();
    }
    while (fallingPetals.length > 0) {
      fallingPetals.pop()?.mesh.dispose();
    }
  };

  const createDandelion = (x: number, z: number, kind: Dandelion["kind"]) => {
    const root = new TransformNode(`dandelion-${kind}`, scene);
    root.position = new Vector3(x, 0, z);
    root.rotation.y = Math.random() * Math.PI * 2; // face a random way so they don't all line up
    const pieces: Mesh[] = [];

    // Per-plant geometry noise so no two stems look identical.
    const height = (kind === "seed" ? 0.95 : 0.72) * (0.86 + (Math.random() * 0.28));
    const stem = MeshBuilder.CreateCylinder(`${kind}-stem`, {
      height,
      diameterTop: 0.019 + (Math.random() * 0.008),
      diameterBottom: 0.03 + (Math.random() * 0.012),
      tessellation: 6,
    }, scene);
    stem.parent = root;
    stem.position.y = height / 2;
    stem.rotation.x = (Math.random() - 0.5) * 0.3;
    stem.rotation.z = (Math.random() - 0.5) * 0.3;
    // Tint each stem a little (greener/yellower, lighter/darker) for variety.
    const stemMaterial = materials.dandelionStemMaterial.clone(`${kind}-stem-mat`) ?? materials.dandelionStemMaterial;
    if (stemMaterial instanceof StandardMaterial) {
      const tint = 0.82 + (Math.random() * 0.32);
      stemMaterial.diffuseColor = materials.dandelionStemMaterial.diffuseColor.scale(tint);
      stemMaterial.diffuseColor.g = Math.min(1, stemMaterial.diffuseColor.g * (1.02 + (Math.random() * 0.1)));
    }
    stem.material = stemMaterial;

    const head = new TransformNode(`${kind}-head`, scene);
    head.parent = root;
    head.position.y = height + 0.02;

    if (kind === "yellow") {
      // A flattened, faceted "lens" reads as a real flower centre instead of a
      // smooth ball: jitter the verts, squash on Y, then flat-shade.
      const center = MeshBuilder.CreateSphere("yellow-center", { diameter: 0.16, segments: 7, updatable: true }, scene);
      const cp = center.getVerticesData(VertexBuffer.PositionKind);
      if (cp) {
        for (let v = 0; v < cp.length; v += 3) {
          const jitter = 0.82 + (Math.random() * 0.36);
          cp[v] *= jitter;
          cp[v + 1] *= jitter * 0.46; // squash into a lens
          cp[v + 2] *= jitter;
        }
        center.setVerticesData(VertexBuffer.PositionKind, cp);
        center.convertToFlatShadedMesh();
      }
      center.parent = head;
      center.material = materials.dandelionCenterMaterial;
      pieces.push(center);

      for (let i = 0; i < 22; i += 1) {
        const angle = (i / 22) * Math.PI * 2;
        const petal = MeshBuilder.CreateSphere(`yellow-petal-${i}`, { diameter: 0.085, segments: 5 }, scene);
        petal.parent = head;
        petal.position = new Vector3(Math.cos(angle) * 0.085, Math.sin(angle * 3) * 0.018, Math.sin(angle) * 0.085);
        petal.scaling = new Vector3(1.6, 0.45, 0.65);
        petal.rotation.y = -angle;
        petal.material = materials.dandelionYellowMaterial;
        pieces.push(petal);
      }
    } else {
      const core = MeshBuilder.CreateIcoSphere("seed-core", { radius: 0.026, subdivisions: 1, flat: true }, scene);
      core.parent = head;
      core.material = seedCoreMaterial;
      pieces.push(core);

      const fuzzCount = 150 + Math.floor(Math.random() * 60);

      for (let i = 0; i < fuzzCount; i += 1) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos((Math.random() * 2) - 1);
        const radius = 0.12 + (Math.random() * 0.08);
        const fuzz = MeshBuilder.CreatePlane(`seed-fuzz-${i}`, { size: 0.07 + (Math.random() * 0.05) }, scene);
        fuzz.parent = head;
        fuzz.position = new Vector3(
          Math.sin(phi) * Math.cos(theta) * radius,
          Math.cos(phi) * radius,
          Math.sin(phi) * Math.sin(theta) * radius,
        );
        fuzz.billboardMode = Mesh.BILLBOARDMODE_ALL;
        fuzz.material = fluffMaterial;
        pieces.push(fuzz);
      }
    }

    dandelions.push({
      root,
      stem,
      head,
      pieces,
      detachedPieces: [],
      x,
      z,
      kind,
      cut: false,
      popped: false,
      headVelocity: Vector3.Zero(),
      headFalling: false,
      headSettled: false,
      stemHeight: height,
      leanX: 0,
      leanZ: 0,
      shrinking: false,
      shrinkAge: 0,
    });
  };

  const releaseDandelionSeeds = (dandelion: Dandelion, requestedCount = dandelion.pieces.length, hitPop = false) => {
    if (dandelion.popped || dandelion.kind !== "seed") {
      return;
    }

    let released = 0;

    for (const piece of dandelion.pieces) {
      if (released >= requestedCount) {
        break;
      }

      if (piece.name === "seed-core") {
        continue;
      }

      if (!piece.isEnabled() || piece.parent === null) {
        continue;
      }

      const worldPosition = piece.getAbsolutePosition().clone();
      piece.parent = null;
      piece.position.copyFrom(worldPosition);
      piece.billboardMode = Mesh.BILLBOARDMODE_ALL;
      // Keep the shared fluff material — cloning it here cloned its texture too
      // (~200 DynamicTexture clones at once = the destruction CPU spike). Per-seed
      // fade is done with mesh.visibility in update() instead.
      dandelion.detachedPieces.push(piece);
      floatingSeeds.push({
        mesh: piece,
        age: 0,
        duration: 4 + (Math.random() * 3),
        velocity: new Vector3(
          0.45 + (Math.random() * 0.8),
          (hitPop ? 0.28 : 0.04) + (Math.random() * (hitPop ? 0.34 : 0.16)),
          (Math.random() - 0.5) * 0.42,
        ),
        drift: (Math.random() - 0.5) * 0.9,
      });
      released += 1;
    }

    const remaining = dandelion.pieces.some((piece) => piece.name !== "seed-core" && piece.isEnabled() && piece.parent !== null);
    dandelion.popped = !remaining;

    if (dandelion.popped) {
      dandelion.head.setEnabled(false);
    }
  };

  const releaseYellowPetals = (dandelion: Dandelion) => {
    if (dandelion.popped || dandelion.kind !== "yellow") {
      return;
    }

    dandelion.popped = true;

    for (const piece of dandelion.pieces) {
      const worldPosition = piece.getAbsolutePosition().clone();
      piece.parent = null;
      piece.position.copyFrom(worldPosition);
      piece.billboardMode = Mesh.BILLBOARDMODE_ALL;
      piece.material = piece.material?.clone(`${piece.name}-falling-material`) ?? null;
      dandelion.detachedPieces.push(piece);

      const angle = Math.random() * Math.PI * 2;
      const burst = 0.6 + (Math.random() * 0.85);
      fallingPetals.push({
        mesh: piece,
        age: 0,
        duration: 2.6 + (Math.random() * 1.4),
        velocity: new Vector3(
          Math.cos(angle) * burst + 0.2,
          1.1 + (Math.random() * 0.7),
          Math.sin(angle) * burst,
        ),
        settled: false,
      });
    }
  };

  const mowDandelion = (dandelion: Dandelion) => {
    if (dandelion.kind === "yellow" && dandelion.cut && !dandelion.popped) {
      if (dandelion.headSettled) {
        releaseYellowPetals(dandelion);
        wind.burstMowerClippings(true);
      }

      return;
    }

    if (dandelion.cut) {
      return;
    }

    dandelion.cut = true;
    // Don't snap the stem flat — animate it sucking down into the mower (handled
    // in update) so the head/seeds visibly leave upward instead of disintegrating.
    dandelion.shrinking = true;
    dandelion.shrinkAge = 0;
    wind.burstMowerClippings(dandelion.kind === "yellow");

    if (dandelion.kind === "seed") {
      releaseDandelionSeeds(dandelion, dandelion.pieces.length, true);
      return;
    }

    playFlowerPop();

    const yaw = getYaw();
    const worldPosition = dandelion.head.getAbsolutePosition().clone();
    dandelion.head.parent = null;
    dandelion.head.position.copyFrom(worldPosition);
    dandelion.headVelocity = new Vector3(
      Math.sin(yaw) * 2.2,
      1.65,
      Math.cos(yaw) * 2.2,
    );
    dandelion.headFalling = true;
  };

  // World position to use for mow/shot tests: a popped yellow head follows its
  // flying head, everything else stays at the stem.
  const targetPosition = (dandelion: Dandelion) => {
    if (dandelion.kind === "yellow" && dandelion.cut) {
      const head = dandelion.head.getAbsolutePosition();
      return { x: head.x, z: head.z };
    }

    return { x: dandelion.x, z: dandelion.z };
  };

  return {
    place() {
      clear();

      for (let i = 0; i < getActiveMap().dandelionCount; i += 1) {
        const { x, z } = randomPointInSegments(yardSegments);
        const kind: Dandelion["kind"] = i % 3 === 0 ? "seed" : "yellow";

        if ((x * x) + (z * z) > 1.4) {
          createDandelion(x, z, kind);
        }
      }
    },

    // Mow any dandelion the mower is currently over, and bow the ones it's
    // approaching away from the mower body so they don't poke through it.
    mowAt(mowerX: number, mowerZ: number, radiusSquared: number) {
      const leanRadius = 1;
      for (const dandelion of dandelions) {
        const target = targetPosition(dandelion);
        const dx = mowerX - target.x;
        const dz = mowerZ - target.z;
        const distSq = (dx * dx) + (dz * dz);

        if (distSq <= radiusSquared) {
          mowDandelion(dandelion);
        }

        if (dandelion.cut) {
          continue;
        }

        const dist = Math.sqrt(distSq);
        if (dist < leanRadius && dist > 0.0001) {
          // Hook away from the mower — harder and snappier the closer it gets, so
          // the head curves well clear of the body instead of poking through it.
          const proximity = 1 - (dist / leanRadius);
          const lean = (proximity ** 1.4) * 1.45; // up to ~83°, nearly laid flat away
          const awayX = -dx / dist; // direction from mower to plant
          const awayZ = -dz / dist;
          dandelion.leanX += ((lean * awayZ) - dandelion.leanX) * 0.5;
          dandelion.leanZ += ((-lean * awayX) - dandelion.leanZ) * 0.5;
        } else {
          dandelion.leanX += (0 - dandelion.leanX) * 0.12;
          dandelion.leanZ += (0 - dandelion.leanZ) * 0.12;
        }
        dandelion.root.rotation.x = dandelion.leanX;
        dandelion.root.rotation.z = dandelion.leanZ;
      }
    },

    // Mow dandelions along a shot. Returns the positions hit for impact effects.
    damageAlongShot(origin: Vector3, direction: Vector3, range: number) {
      const hits: Array<{ x: number; z: number }> = [];

      for (const dandelion of dandelions) {
        const target = targetPosition(dandelion);

        if (distanceToShot(target.x, target.z, origin, direction, range) < 0.42) {
          mowDandelion(dandelion);
          hits.push(target);
        }
      }

      return hits;
    },

    update(deltaSeconds: number) {
      for (const dandelion of dandelions) {
        if (dandelion.shrinking) {
          dandelion.shrinkAge += deltaSeconds;
          const t = Math.min(1, dandelion.shrinkAge / 0.13);
          const eased = t * t; // accelerate as it's yanked under
          const scaleY = 1 - (0.86 * eased);
          dandelion.stem.scaling.y = scaleY;
          dandelion.stem.position.y = (dandelion.stemHeight * scaleY) / 2; // base stays planted
          if (t >= 1) {
            dandelion.shrinking = false;
          }
        }

        if (dandelion.headFalling) {
          dandelion.headVelocity.y -= 4.4 * deltaSeconds;
          dandelion.head.position.addInPlace(dandelion.headVelocity.scale(deltaSeconds));
          dandelion.head.rotation.x += deltaSeconds * 2.1;
          dandelion.head.rotation.z += deltaSeconds * 1.4;

          if (dandelion.head.position.y <= 0.08 && dandelion.headVelocity.y < 0) {
            dandelion.head.position.y = 0.08;

            if (dandelion.headVelocity.y < -0.6) {
              // Bounce off the ground a few times before coming to rest.
              dandelion.headVelocity.y = -dandelion.headVelocity.y * 0.42;
              dandelion.headVelocity.x *= 0.55;
              dandelion.headVelocity.z *= 0.55;
            } else {
              dandelion.headVelocity.set(0, 0, 0);
              dandelion.headFalling = false;
              dandelion.headSettled = true;
            }
          }
        }

      }

      for (let i = floatingSeeds.length - 1; i >= 0; i -= 1) {
        const seed = floatingSeeds[i];
        seed.age += deltaSeconds;

        const t = seed.age / seed.duration;
        seed.mesh.position.addInPlace(seed.velocity.scale(deltaSeconds));
        seed.mesh.position.z += Math.sin(t * Math.PI * 2) * seed.drift * deltaSeconds * 0.18;
        seed.mesh.scaling.scaleInPlace(1 - (deltaSeconds * 0.08));

        // Fade per-seed via mesh.visibility (the material is shared now, so we
        // must not touch material.alpha — and the fluff's alpha comes from its
        // texture, which made material.alpha do nothing anyway).
        seed.mesh.visibility = Math.max(0, (1 - t) * 0.9);

        if (t >= 1) {
          seed.mesh.dispose();
          floatingSeeds.splice(i, 1);
        }
      }

      const groundY = 0.03;

      for (let i = fallingPetals.length - 1; i >= 0; i -= 1) {
        const petal = fallingPetals[i];
        petal.age += deltaSeconds;

        if (!petal.settled) {
          petal.velocity.y -= 4.2 * deltaSeconds;
          petal.mesh.position.addInPlace(petal.velocity.scale(deltaSeconds));
          petal.mesh.rotation.y += deltaSeconds * 3.2;
          petal.mesh.rotation.z += deltaSeconds * 2.1;

          if (petal.mesh.position.y <= groundY && petal.velocity.y < 0) {
            petal.mesh.position.y = groundY;

            if (petal.velocity.y < -0.55) {
              // Bounce: reflect upward with damping, scrub sideways speed.
              petal.velocity.y = -petal.velocity.y * 0.45;
              petal.velocity.x *= 0.6;
              petal.velocity.z *= 0.6;
            } else {
              // Too slow to bounce again: settle on the ground, then fade.
              petal.velocity.setAll(0);
              petal.settled = true;
            }
          }
        }

        // Stay fully visible while it pops and bounces; only fade over the last
        // third of its life so it never vanishes mid-air.
        const t = petal.age / petal.duration;
        const material = petal.mesh.material;
        if (material instanceof StandardMaterial) {
          material.alpha = Math.max(0, Math.min(1, (1 - t) / 0.34));
        }

        if (t >= 1) {
          petal.mesh.dispose();
          fallingPetals.splice(i, 1);
        }
      }
    },
  };
}
