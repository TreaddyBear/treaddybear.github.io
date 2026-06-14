import { MaterialPluginBase } from "@babylonjs/core";
import type { Material, UniformBuffer } from "@babylonjs/core";

// Per-blade dithered LOD cull for the real (PBR) grass blades. The decision is
// made ONCE PER BLADE in the vertex stage: each blade is a thin instance, so we
// hash its instance position (finalWorld translation), compare to a
// distance-driven threshold, and if it loses we collapse the whole blade off
// screen. That means a blade is either fully there or fully gone — never a
// per-pixel stipple — and culled blades skip rasterization entirely (a real
// saving, not just a discard). The slats fade IN over the same band so the two
// hand off.
//
// PBRMaterial can't be hand-edited, so we splice the cull into its vertex shader
// via Babylon's material-plugin injection points.

class LodDitherPlugin extends MaterialPluginBase {
  lodFade = 0; // 0 = blades everywhere, 1 = distance cull on
  lodDistance = 8; // ground radius where blades start dropping
  lodBand = 6; // width of the band over which blades cull out
  centerX = 0; // LOD center (the mower), updated per frame
  centerZ = 0;

  constructor(material: Material) {
    // priority 200; enabled immediately so the code is always injected and we
    // gate at runtime with the lodFade uniform (no recompile to toggle).
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
        { name: "lodCenter", size: 2, type: "vec2" },
      ],
      vertex: `#ifdef LOD_DITHER
        uniform float lodFade;
        uniform float lodDistance;
        uniform float lodBand;
        uniform vec2 lodCenter;
      #endif`,
    };
  }

  bindForSubMesh(uniformBuffer: UniformBuffer) {
    uniformBuffer.updateFloat("lodFade", this.lodFade);
    uniformBuffer.updateFloat("lodDistance", this.lodDistance);
    uniformBuffer.updateFloat("lodBand", this.lodBand);
    uniformBuffer.updateFloat2("lodCenter", this.centerX, this.centerZ);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== "vertex") {
      return null;
    }

    return {
      CUSTOM_VERTEX_DEFINITIONS: `
        float lodHash21(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
      `,
      // After gl_Position is computed: one decision for the whole blade, keyed on
      // its instance position. finalWorld[3].xz is the blade's base, identical for
      // every vertex of the instance, so the entire blade culls or stays as a unit.
      // Blade kept where the slat is hidden (keep if hash >= vis): near = all
      // blades, far = none.
      CUSTOM_VERTEX_MAIN_END: `
        #ifdef LOD_DITHER
        if (lodFade > 0.5) {
          vec2 lodBase = finalWorld[3].xz;
          float lodDist = distance(lodCenter, lodBase);
          float lodVis = clamp((lodDist - lodDistance) / max(0.001, lodBand), 0.0, 1.0);
          if (lodHash21(lodBase) < lodVis) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // off-screen: whole blade culled
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
    update(fade: boolean, distance: number, band: number) {
      for (const plugin of plugins) {
        plugin.lodFade = fade ? 1 : 0;
        plugin.lodDistance = distance;
        plugin.lodBand = band;
      }
    },
    // The LOD center is the mower, pushed every frame (camera orbit must not move
    // the cull). Other camera modes could later feed a different point.
    setCenter(x: number, z: number) {
      for (const plugin of plugins) {
        plugin.centerX = x;
        plugin.centerZ = z;
      }
    },
  };
}
