// DEV-ONLY — detects when the baked artifact is out of date relative to the
// authored source. Imported exclusively via a dynamic import inside a
// `if (import.meta.env.DEV)` guard in bakedMapLoader.ts, so Vite tree-shakes
// this entire module out of production bundles.

import rawSource from "../map-exports/lawn-maps.json";
import type { AnyBakedMapPack } from "./bakedMapFormat";

// FNV-1a 32-bit — must match the identical implementation in tools/bake-maps.ts.
// Both run on V8 (Node.js in the baker, Chromium at dev startup), so charCodeAt
// and >>> 0 unsigned arithmetic produce the same bit pattern on both sides.
function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash ^ str.charCodeAt(i)) * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function checkBakedStaleness(baked: AnyBakedMapPack): void {
  // rawSource is the parsed JSON object Vite gives us — same representation as
  // JSON.parse(readFileSync(...)) in the baker, so JSON.stringify key order is
  // identical across both V8 environments.
  const currentHash = fnv1a(JSON.stringify(rawSource));

  if (currentHash !== baked.sourceHash) {
    console.warn(
      `⚠️ [LaMow] Baked map artifact is stale — run \`pnpm bake\` to update.\n` +
      `   Artifact hash : ${baked.sourceHash ?? "(none — old artifact)"}\n` +
      `   Current hash  : ${currentHash}`,
    );
  }
}
