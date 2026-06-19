import type { CloverPatch } from "./config";
import { randomHash, smoothstep, valueNoise } from "./utils/noise";

// Shared, pure description of where the clover sits, so the clover placement and
// the grass-thinning in grass.ts agree on the exact same irregular edge.

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

// Clover coverage for a single patch at (x, z): 1 in the core, feathering to 0
// across an irregular, noise-wobbled edge (so it's a lumpy blob, not a disc).
function patchCloverAmount(patch: CloverPatch, x: number, z: number) {
  const dx = x - patch.x;
  const dz = z - patch.z;
  const dist = Math.hypot(dx, dz);

  // Two octaves of value noise wobble the edge for an organic, lumpy outline —
  // but kept MODEST so the patch stays roughly its nominal size (don't let it
  // balloon to ~1.75x and merge with its neighbours).
  const wobble = ((valueNoise((x * 0.4) + patch.x, (z * 0.4) - patch.z) - 0.5) * patch.radius * 0.45)
    + ((valueNoise((x * 0.95) - patch.z, (z * 0.95) + patch.x) - 0.5) * patch.radius * 0.22);
  const effectiveRadius = patch.radius + wobble;
  const feather = Math.max(0.6, patch.radius * 0.4); // width of the clover->grass blend
  let amount = smoothstep(clamp01((effectiveRadius - dist) / feather));

  // A soft "bite" out of one side turns the blob into crescent / kidney shapes —
  // closer to how clover actually spreads than a circle. Seeded from the patch
  // position so the placement and the grass-thinning carve the same bite.
  const biteAngle = randomHash(patch.x * 1.31, patch.z * 0.77) * Math.PI * 2;
  const biteX = patch.x + (Math.cos(biteAngle) * patch.radius * 0.95);
  const biteZ = patch.z + (Math.sin(biteAngle) * patch.radius * 0.95);
  const biteDist = Math.hypot(x - biteX, z - biteZ);
  const bite = smoothstep(clamp01(((patch.radius * 0.75) - biteDist) / (patch.radius * 0.55)));
  amount *= 1 - (bite * 0.8);

  return amount;
}

// A patch's grass tufts: 1-2 small, deterministic spots inside the core where
// the lawn stays at full density (so the clover isn't uniformly bare). Seeded
// from the patch position so placement and grass-thinning agree.
function patchTufts(patch: CloverPatch) {
  const count = 1 + Math.floor(randomHash(patch.x, patch.z) * 2); // 1 or 2
  const tufts: Array<{ x: number; z: number; radius: number }> = [];

  for (let i = 0; i < count; i += 1) {
    const angle = randomHash((patch.x * 1.7) + (i * 5.3), (patch.z * 1.3) - (i * 2.9)) * Math.PI * 2;
    const dist = (0.2 + (randomHash((patch.x * 0.9) - i, (patch.z * 1.1) + i) * 0.5)) * patch.radius;
    tufts.push({
      x: patch.x + (Math.cos(angle) * dist),
      z: patch.z + (Math.sin(angle) * dist),
      radius: 0.24 + (randomHash((patch.x * 2.1) + i, (patch.z * 0.7) - i) * 0.12),
    });
  }

  return tufts;
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
// toward the patch's `grassKeep` in the core (smoothly, across the feathered
// edge). High-frequency "tuft" noise punches occasional full-density grass
// clumps back through the clover, so the inside isn't uniformly sparse.
export function cloverGrassKeepAt(patches: CloverPatch[] | undefined, x: number, z: number) {
  if (!patches || patches.length === 0) {
    return 1;
  }

  let amount = 0;
  let keepFloor = 0.25;
  let tuftMask = 0;
  for (const patch of patches) {
    const patchAmount = patchCloverAmount(patch, x, z);
    if (patchAmount > amount) {
      amount = patchAmount;
      keepFloor = patch.grassKeep ?? 0.25;
    }

    // Nearest tuft (in this patch): full density at its center, soft to its rim.
    for (const tuft of patchTufts(patch)) {
      const normalized = Math.hypot(x - tuft.x, z - tuft.z) / tuft.radius;
      tuftMask = Math.max(tuftMask, 1 - smoothstep(clamp01(normalized)));
    }
  }

  if (amount <= 0) {
    return 1;
  }

  const baseKeep = 1 + ((keepFloor - 1) * amount); // lerp(1, keepFloor, amount)

  return baseKeep + ((1 - baseKeep) * tuftMask);
}
