import { MaterialPluginBase } from "@babylonjs/core";
import type { Material, UniformBuffer } from "@babylonjs/core";

// Dithered LOD cull for the real (PBR) grass blades. The slats fade IN with
// camera distance (grassSlats.ts); this fades the blades OUT over the SAME band
// so the two hand off. Per-patch hashed discard (quantized world XZ) keeps the
// blades in the opaque/alpha-test path — no blending, no sorting — and the
// stochastic drop means individual blades wink out at slightly different
// distances, so there is no hard ring or pop as the LOD radius moves.
//
// The hash/quantize/vis math mirrors the slat shader exactly, with the keep
// condition inverted (blade shown where the slat is hidden), so blades and slats
// tile to full coverage with no gap. PBRMaterial can't be hand-edited, so we
// splice a few GLSL lines in via Babylon's material-plugin injection points.

class LodDitherPlugin extends MaterialPluginBase {
  lodFade = 0; // 0 = blades everywhere, 1 = distance cull on
  lodDistance = 8; // ground radius where blades start dropping
  lodBand = 6; // width of the dither band over which they cull out
  lodGrain = 16; // dither cells per world unit (higher = finer; must match slats)

  constructor(material: Material) {
    // priority 200; enabled immediately so the code is always injected and we
    // gate at runtime with the lodFade uniform (no shader recompile to toggle).
    super(material, "LodDither", 200, { LOD_DITHER: false }, true, true);
  }

  getClassName() {
    return "LodDitherPlugin";
  }

  prepareDefines(defines: Record<string, unknown>) {
    defines.LOD_DITHER = true;
  }

  getUniforms() {
    return {
      ubo: [
        { name: "lodFade", size: 1, type: "float" },
        { name: "lodDistance", size: 1, type: "float" },
        { name: "lodBand", size: 1, type: "float" },
        { name: "lodGrain", size: 1, type: "float" },
      ],
      fragment: `#ifdef LOD_DITHER
        uniform float lodFade;
        uniform float lodDistance;
        uniform float lodBand;
        uniform float lodGrain;
      #endif`,
    };
  }

  bindForSubMesh(uniformBuffer: UniformBuffer) {
    uniformBuffer.updateFloat("lodFade", this.lodFade);
    uniformBuffer.updateFloat("lodDistance", this.lodDistance);
    uniformBuffer.updateFloat("lodBand", this.lodBand);
    uniformBuffer.updateFloat("lodGrain", this.lodGrain);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "fragment") {
      return null;
    }

    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
        float lodHash21(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
      `,
      CUSTOM_FRAGMENT_MAIN_BEGIN: `
        #ifdef LOD_DITHER
        if (lodFade > 0.5) {
          float lodCamDist = distance(vEyePosition.xz, vPositionW.xz);
          float lodVis = clamp((lodCamDist - lodDistance) / max(0.001, lodBand), 0.0, 1.0);
          // Blade shown where the slat is hidden (keep if hash >= vis): near = all
          // blades, far = none, matching the slat fade-in's complement exactly.
          if (lodHash21(floor(vPositionW.xz * lodGrain)) < lodVis) {
            discard;
          }
        }
        #endif
      `,
    };
  }
}

// Attach the cull to the given PBR materials and return a single update handle.
export function attachLodDither(materials: Material[]) {
  const plugins = materials.map((material) => {
    const existing = material.pluginManager?.getPlugin?.("LodDither") as LodDitherPlugin | undefined;
    return existing ?? new LodDitherPlugin(material);
  });

  return {
    update(fade: boolean, distance: number, band: number, grain: number) {
      for (const plugin of plugins) {
        plugin.lodFade = fade ? 1 : 0;
        plugin.lodDistance = distance;
        plugin.lodBand = band;
        plugin.lodGrain = grain;
      }
    },
  };
}
