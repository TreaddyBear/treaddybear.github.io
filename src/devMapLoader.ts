// DEV-ONLY escape hatch: import and normalize the authored map source at
// runtime so you can tweak lawn-maps.json and reload without re-baking.
//
// How to use (during development only):
//   import { loadAuthoredMapPack } from "./devMapLoader";
//   const maps = await loadAuthoredMapPack();
//
// This module is NEVER imported by any production game module. Vite's
// tree-shaker will eliminate it entirely from production builds because
// import.meta.env.DEV is statically false in production. The dynamic imports
// inside the guard ensure even the indirect dependencies (mapData, runtimeMap)
// are unreachable by the bundler in the production path.
//
// Do NOT add a static import of this file to config.ts or main.ts.

export async function loadAuthoredMapPack() {
  if (!import.meta.env.DEV) {
    throw new Error(
      "loadAuthoredMapPack() is only available in dev builds. " +
      "In production the engine loads the pre-baked artifact.",
    );
  }

  // Dynamic imports keep these modules out of the production bundle even
  // if this file is accidentally statically imported somewhere.
  const { mapPack } = await import("./mapData");
  const { normalizeMapPack } = await import("./runtimeMap");

  return normalizeMapPack(mapPack);
}
