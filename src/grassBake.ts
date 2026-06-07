import { DynamicTexture, Texture } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

// Bakes the static, tiling grass detail used by the far-LOD mesh: a NORMAL map
// (so light glances off the surface in fine, vertically-streaked, grass-like
// directions — this is what sells the distant shine) plus an ALBEDO map (blade
// colour streaks). Generated once from a tileable blade heightfield, so the LOD
// fragment shader becomes a couple of cheap texture samples instead of per-pixel
// procedural noise. Wraps seamlessly so it can tile across the whole field.

const RES = 256;

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
  // Tileable blade heightfield: thin near-vertical streaks (high frequency across
  // X, smooth along Y) over broader clumps.
  const height = new Float32Array(RES * RES);
  const cols = tileNoise(110, 53); // per-column blade variation -> vertical streaks
  const fine = tileNoise(220, 97); // fine breakup
  const broad = tileNoise(9, 11); // clumps
  const mid = tileNoise(26, 37);
  for (let py = 0; py < RES; py += 1) {
    const v = py / RES;
    for (let px = 0; px < RES; px += 1) {
      const u = px / RES;
      const blade = (cols(u, v * 0.12) * 0.7) + (fine(u, v * 0.5) * 0.3);
      const streak = Math.pow(blade, 1.6); // sharpen into thin blades
      const clump = (broad(u, v) * 0.6) + (mid(u, v) * 0.4);
      height[(py * RES) + px] = (streak * 0.72) + (clump * 0.28);
    }
  }

  const normalTex = new DynamicTexture("grassLodNormal", { width: RES, height: RES }, scene, false);
  const albedoTex = new DynamicTexture("grassLodAlbedo", { width: RES, height: RES }, scene, false);
  const nctx = normalTex.getContext() as CanvasRenderingContext2D;
  const actx = albedoTex.getContext() as CanvasRenderingContext2D;
  const nimg = nctx.createImageData(RES, RES);
  const aimg = actx.createImageData(RES, RES);

  const at = (x: number, y: number) => height[((((y % RES) + RES) % RES) * RES) + (((x % RES) + RES) % RES)];
  const slope = 2.6;
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
      aimg.data[i] = 22 + (h * 70); // r
      aimg.data[i + 1] = 64 + (h * 150); // g (dominant)
      aimg.data[i + 2] = 12 + (h * 36); // b
      aimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  actx.putImageData(aimg, 0, 0);
  normalTex.update(false);
  albedoTex.update(false);
  normalTex.wrapU = Texture.WRAP_ADDRESSMODE;
  normalTex.wrapV = Texture.WRAP_ADDRESSMODE;
  albedoTex.wrapU = Texture.WRAP_ADDRESSMODE;
  albedoTex.wrapV = Texture.WRAP_ADDRESSMODE;

  return { normalTex, albedoTex };
}
