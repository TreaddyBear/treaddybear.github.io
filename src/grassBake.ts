import { DynamicTexture, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

// Bakes the static, tiling grass detail used by the far-LOD mesh: a NORMAL map
// (fine, strongly VERTICAL blade streaks, so light glances across them like real
// grass — this is what sells the distant shine) plus an ALBEDO streak map.
// Generated once from a tileable blade heightfield. Mipmapped + anisotropic so it
// does NOT alias into static when tiled and viewed at distance/grazing angles.

const RES = 256;

export type GrassBake = ReturnType<typeof createGrassBake>;

// Value noise on an integer lattice that wraps at `period` (so the texture tiles).
function tileNoise(period: number, seed: number) {
  const rand = (ix: number, iy: number) => {
    const x = ((ix % period) + period) % period;
    const y = ((iy % period) + period) % period;
    let h = ((x * 374761393) ^ (y * 668265263) ^ (seed * 2246822519)) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return (h % 100000) / 100000;
  };
  const smooth = (t: number) => t * t * (3 - (2 * t));
  return (u: number, v: number) => {
    const fx = u * period;
    const fy = v * period;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const a = rand(ix, iy);
    const b = rand(ix + 1, iy);
    const c = rand(ix, iy + 1);
    const d = rand(ix + 1, iy + 1);
    return ((a + ((b - a) * tx)) * (1 - ty)) + ((c + ((d - c) * tx)) * ty);
  };
}

export function createGrassBake(scene: Scene) {
  // Tileable blade heightfield. Streaks vary fast across X (thin blades) and
  // drift only slowly along Y (so they run vertically), sharpened so they read as
  // distinct blades rather than a wide smear.
  const height = new Float32Array(RES * RES);
  const cols = tileNoise(48, 53); // blade columns
  const colsFine = tileNoise(120, 91); // finer blades between
  const breakup = tileNoise(64, 23); // vertical breakup along blades
  const broad = tileNoise(7, 11); // gentle clumps
  for (let py = 0; py < RES; py += 1) {
    const v = py / RES;
    for (let px = 0; px < RES; px += 1) {
      const u = px / RES;
      const s1 = Math.pow(cols(u, v * 0.06), 3.0); // sparse thin bright vertical lines
      const s2 = Math.pow(colsFine(u, v * 0.1), 4.0);
      const streak = ((s1 * 0.7) + (s2 * 0.3)) * (0.6 + (0.4 * breakup(u, v * 1.5)));
      const clump = (broad(u, v) - 0.5) * 0.18;
      height[(py * RES) + px] = Math.max(0, Math.min(1, (streak * 0.92) + 0.18 + clump));
    }
  }

  const opts = { width: RES, height: RES };
  const normalTex = new DynamicTexture("grassLodNormal", opts, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const albedoTex = new DynamicTexture("grassLodAlbedo", opts, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  const nctx = normalTex.getContext() as CanvasRenderingContext2D;
  const actx = albedoTex.getContext() as CanvasRenderingContext2D;
  const nimg = nctx.createImageData(RES, RES);
  const aimg = actx.createImageData(RES, RES);

  const at = (x: number, y: number) => height[((((y % RES) + RES) % RES) * RES) + (((x % RES) + RES) % RES)];
  const slope = 3.4;
  for (let py = 0; py < RES; py += 1) {
    for (let px = 0; px < RES; px += 1) {
      const dx = (at(px + 1, py) - at(px - 1, py)) * slope;
      const dy = (at(px, py + 1) - at(px, py - 1)) * slope;
      const len = Math.hypot(-dx, -dy, 1) || 1;
      const i = ((py * RES) + px) * 4;
      nimg.data[i] = (((-dx / len) * 0.5) + 0.5) * 255;
      nimg.data[i + 1] = (((-dy / len) * 0.5) + 0.5) * 255;
      nimg.data[i + 2] = (((1 / len) * 0.5) + 0.5) * 255;
      nimg.data[i + 3] = 255;
      const h = height[(py * RES) + px];
      aimg.data[i] = 22 + (h * 70);
      aimg.data[i + 1] = 60 + (h * 150);
      aimg.data[i + 2] = 12 + (h * 34);
      aimg.data[i + 3] = Math.round(Math.min(1, h * 1.25) * 255); // blade-density mask for slat cutout

    }
  }
  nctx.putImageData(nimg, 0, 0);
  actx.putImageData(aimg, 0, 0);
  normalTex.update(false);
  albedoTex.update(false);
  for (const tex of [normalTex, albedoTex]) {
    tex.wrapU = Texture.WRAP_ADDRESSMODE;
    tex.wrapV = Texture.WRAP_ADDRESSMODE;
    tex.anisotropicFilteringLevel = 8; // crisp without aliasing at grazing angles
  }

  return { normalTex, albedoTex };
}
