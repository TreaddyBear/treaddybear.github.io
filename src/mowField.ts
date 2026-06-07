import { Color3, Material, Mesh, StandardMaterial, VertexData } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

// The "mow-state field": a coarse paint-as-you-mow grid baked into a texture,
// recording where the mower has cut (black = tall/uncut, white = mowed/short).
//
// This is step 1 of the documented grass-LOD plan (see BACKLOG.md). It is the
// shared source of truth that the future far-LOD grass mesh and field shadows
// will sample. Today it only records and can be shown as a debug overlay; it
// does not yet drive any rendering.
//
// Fixed bounds cover both maps (main ±9, flower-court x±15/z±10) with padding,
// so it survives a map switch without rebuilding.
const MIN_X = -18;
const MAX_X = 18;
const MIN_Z = -13;
const MAX_Z = 13;
const RES = 128;
const WIDTH = MAX_X - MIN_X;
const DEPTH = MAX_Z - MIN_Z;

export type MowField = ReturnType<typeof createMowField>;

export function createMowField(scene: Scene) {
  // A plain offscreen canvas is the grid; we upload it to a texture only when it
  // changes. (DynamicTexture is created lazily by the debug overlay.)
  const canvas = document.createElement("canvas");
  canvas.width = RES;
  canvas.height = RES;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  let dirty = false;
  let lastTexel = -1;
  let debugMesh: Mesh | null = null;
  let debugTexture: import("@babylonjs/core").DynamicTexture | null = null;

  const clearCanvas = () => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, RES, RES);
  };
  clearCanvas();

  // World (x,z) -> canvas pixel. Canvas Y is flipped vs world Z so the overlay
  // (which uses matching UVs below) lines up with the world.
  const toPixelX = (x: number) => ((x - MIN_X) / WIDTH) * RES;
  const toPixelY = (z: number) => ((MAX_Z - z) / DEPTH) * RES;

  const reset = () => {
    clearCanvas();
    lastTexel = -1;
    dirty = true;
  };

  // Paint the mower's footprint as mowed. Skips redundant work when the mower
  // hasn't moved to a new texel, so a parked mower costs nothing.
  const mark = (x: number, z: number, worldRadius = 0.7) => {
    const px = toPixelX(x);
    const py = toPixelY(z);
    const texel = (Math.round(py) * RES) + Math.round(px);
    if (texel === lastTexel) {
      return;
    }
    lastTexel = texel;
    const r = Math.max(1, (worldRadius / WIDTH) * RES);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    dirty = true;
  };

  // Push the canvas to the GPU texture once per frame, only if it changed.
  const flush = () => {
    if (!dirty) {
      return;
    }
    dirty = false;
    if (debugTexture) {
      const target = debugTexture.getContext() as CanvasRenderingContext2D;
      target.clearRect(0, 0, RES, RES);
      target.drawImage(canvas, 0, 0);
      debugTexture.update(false);
    }
  };

  // % of the field painted as mowed — a verifiable read of the data that does
  // not depend on overlay orientation.
  const coverage = () => {
    const data = ctx.getImageData(0, 0, RES, RES).data;
    let mowed = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 127) {
        mowed += 1;
      }
    }
    return (mowed / (RES * RES)) * 100;
  };

  const buildOverlay = async () => {
    const { DynamicTexture } = await import("@babylonjs/core/Materials/Textures/dynamicTexture");
    debugTexture = new DynamicTexture("mowFieldDebug", { width: RES, height: RES }, scene, false);
    const target = debugTexture.getContext() as CanvasRenderingContext2D;
    target.drawImage(canvas, 0, 0);
    debugTexture.update(false);

    const mat = new StandardMaterial("mowFieldDebugMat", scene);
    mat.diffuseTexture = debugTexture;
    mat.emissiveTexture = debugTexture;
    mat.disableLighting = true;
    mat.specularColor = new Color3(0, 0, 0);
    mat.alpha = 0.55;
    mat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    mat.backFaceCulling = false;

    // A flat quad over the lawn, UVs chosen to match toPixelX/Y exactly.
    const mesh = new Mesh("mowFieldDebug", scene);
    const y = 0.07;
    const data = new VertexData();
    data.positions = [
      MIN_X, y, MIN_Z,
      MAX_X, y, MIN_Z,
      MAX_X, y, MAX_Z,
      MIN_X, y, MAX_Z,
    ];
    data.indices = [0, 1, 2, 0, 2, 3];
    data.uvs = [0, 0, 1, 0, 1, 1, 0, 1];
    data.normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    data.applyToMesh(mesh);
    mesh.material = mat;
    mesh.isPickable = false;
    debugMesh = mesh;
  };

  let overlayPending = false;
  const showDebug = (on: boolean) => {
    if (on && !debugMesh && !overlayPending) {
      overlayPending = true;
      void buildOverlay().then(() => {
        overlayPending = false;
        debugMesh?.setEnabled(true);
      });
      return;
    }
    debugMesh?.setEnabled(on);
  };

  return { mark, flush, reset, coverage, showDebug };
}
