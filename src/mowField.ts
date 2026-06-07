import { Color3, DynamicTexture, Material, Mesh, StandardMaterial, Texture, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

// The "mow-state field": a coarse paint-as-you-mow grid baked into a texture,
// recording where the mower has cut (black = tall/uncut, white = mowed/short).
//
// Step 1 of the documented grass-LOD plan (see BACKLOG.md): the shared source of
// truth the far-LOD grass mesh (grassField.ts) and future field shadows sample.
//
// Fixed bounds cover both maps (main ±9, flower-court x±15/z±10) with padding, so
// it survives a map switch without rebuilding.
export const MOW_FIELD = { minX: -18, maxX: 18, minZ: -13, maxZ: 13, res: 128 };

export type MowField = ReturnType<typeof createMowField>;

export function createMowField(scene: Scene) {
  const { minX, maxX, minZ, maxZ, res } = MOW_FIELD;
  const width = maxX - minX;
  const depth = maxZ - minZ;

  // Drawn on directly; uploaded to the GPU only when it changes.
  const texture = new DynamicTexture("mowField", { width: res, height: res }, scene, false);
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  const ctx = texture.getContext() as CanvasRenderingContext2D;

  let dirty = false;
  let lastTexel = -1;
  let debugMesh: Mesh | null = null;

  // World (x,z) -> canvas pixel. Canvas Y is flipped vs world Z so the StandardMaterial
  // debug overlay below (which applies invertY) lines up with the world.
  const toPixelX = (x: number) => ((x - minX) / width) * res;
  const toPixelY = (z: number) => ((maxZ - z) / depth) * res;

  const fillBlack = () => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, res, res);
  };
  fillBlack();
  texture.update(false);

  const reset = () => {
    fillBlack();
    lastTexel = -1;
    dirty = true;
  };

  // Paint the mower's footprint as mowed; skips redundant work when it has not
  // moved to a new texel, so a parked mower costs nothing.
  const mark = (x: number, z: number, worldRadius = 0.7) => {
    const px = toPixelX(x);
    const py = toPixelY(z);
    const texel = (Math.round(py) * res) + Math.round(px);
    if (texel === lastTexel) {
      return;
    }
    lastTexel = texel;
    const r = Math.max(1, (worldRadius / width) * res);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    dirty = true;
  };

  const flush = () => {
    if (!dirty) {
      return;
    }
    dirty = false;
    texture.update(false);
  };

  // % of the field painted as mowed — verifiable read of the data, orientation-proof.
  const coverage = () => {
    const data = ctx.getImageData(0, 0, res, res).data;
    let mowed = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 127) {
        mowed += 1;
      }
    }
    return (mowed / (res * res)) * 100;
  };

  const showDebug = (on: boolean) => {
    if (on && !debugMesh) {
      const mat = new StandardMaterial("mowFieldDebugMat", scene);
      mat.diffuseTexture = texture;
      mat.emissiveTexture = texture;
      mat.disableLighting = true;
      mat.specularColor = new Color3(0, 0, 0);
      mat.alpha = 0.55;
      mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
      mat.backFaceCulling = false;

      const mesh = new Mesh("mowFieldDebug", scene);
      const y = 0.07;
      const data = new VertexData();
      data.positions = [minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ];
      data.indices = [0, 1, 2, 0, 2, 3];
      data.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
      data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
      data.applyToMesh(mesh);
      mesh.material = mat;
      mesh.isPickable = false;
      debugMesh = mesh;
    }
    debugMesh?.setEnabled(on);
  };

  return { mark, flush, reset, coverage, showDebug, texture };
}
