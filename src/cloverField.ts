import type { CloverPatch } from "./config";
import { randomHash, smoothstep, valueNoise } from "./utils/noise";

// Shared, pure description of where the clover sits, so the clover placement and
// the grass-thinning in grass.ts agree on the exact same irregular shape.

const TAU = Math.PI * 2;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// Multi-octave value noise (fbm) in ~[0,1] — the MAIN shape generator.
function fbm(x: number, z: number) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < 3; octave += 1) {
    sum += valueNoise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / norm;
}

// Country-shaped clover coverage: 1 across a solid interior, fading to 0 over a
// ~0.5 m edge. The OUTLINE is a per-direction radius built from a few angular
// harmonics (smooth lobed shape — never a circle) with per-patch random phases,
// plus fine fbm noise for a wiggly coastline. The interior is always inside the
// outline (solid), and the radius is bounded so the shape stays confined.
function patchCloverAmount(patch: CloverPatch, x: number, z: number) {
  const dx = x - patch.x;
  const dz = z - patch.z;
  const dist = Math.hypot(dx, dz);
  const angle = Math.atan2(dz, dx);

  // Per-patch random phases so each patch is a different shape.
  const p2 = randomHash(patch.x, patch.z) * TAU;
  const p3 = randomHash((patch.x * 1.7) + 11.3, (patch.z * 1.3) - 7.1) * TAU;
  const p5 = randomHash((patch.x * 0.9) - 3.7, (patch.z * 2.1) + 5.9) * TAU;

  // Radius-by-direction: big low harmonics make a strongly lobed (non-circular)
  // outline; ranges ~0.3..1.7 of the nominal radius, so lobes and bays are deep.
  let r = 1
    + (0.36 * Math.sin((2 * angle) + p2))
    + (0.24 * Math.sin((3 * angle) + p3))
    + (0.16 * Math.sin((5 * angle) + p5));
  // Fine coastline wiggle from position noise.
  r += (fbm((x * 1.0) + patch.x, (z * 1.0) - patch.z) - 0.5) * 0.4;

  const reach = patch.radius * Math.max(0.12, r);
  return smoothstep(clamp01((reach - dist) / 0.5)); // ~0.5 m clover->grass edge
}

// Max clover coverage over all patches (0..1).
export function cloverAmountAt(patches: CloverPatch[] | undefined, x: number, z: number) {
  if (!patches || patches.length === 0) {
    return 0;
  }

  let amount = 0;
  for (const patch of patches) {
    amount = Math.max(amount, patchCloverAmount(patch, x, z));
  }

  return amount;
}

// Fraction of normal lawn density to keep at (x, z): 1 outside any clover, down
// toward the patch's `grassKeep` across the ~0.5 m edge. With grassKeep 0 the
// interior is fully clear of grass (clover only).
export function cloverGrassKeepAt(patches: CloverPatch[] | undefined, x: number, z: number) {
  if (!patches || patches.length === 0) {
    return 1;
  }

  let amount = 0;
  let keepFloor = 0.25;
  for (const patch of patches) {
    const patchAmount = patchCloverAmount(patch, x, z);
    if (patchAmount > amount) {
      amount = patchAmount;
      keepFloor = patch.grassKeep ?? 0.25;
    }
  }

  if (amount <= 0) {
    return 1;
  }

  return 1 + ((keepFloor - 1) * amount); // lerp(1, keepFloor, amount)
}
