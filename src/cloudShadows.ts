import { DynamicTexture, Material, MeshBuilder, StandardMaterial, Texture, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";

export type CloudShadows = ReturnType<typeof createCloudShadows>;

// A faint, slowly drifting layer of soft dark blobs sitting just above the grass.
// Seen from the higher shots (orbit / drone / establish / crane) it reads as cloud
// shadows dappling the field, which makes the top-down framings pop. It is a flat
// horizontal sheet with backface culling, so when a low shot dips beneath it the
// sheet simply isn't drawn (no dark "ceiling"). Cheap: one plane, one texture.
export function createCloudShadows(scene: Scene) {
  const size = 256;
  const texture = new DynamicTexture("cloudShadowTexture", { width: size, height: size }, scene, false);
  const c = texture.getContext() as CanvasRenderingContext2D;

  // Luminance = shadow strength: black is clear, white is full shade. A handful of
  // soft overlapping blobs (additive) make a lumpy cloud field.
  c.fillStyle = "#000";
  c.fillRect(0, 0, size, size);
  c.globalCompositeOperation = "lighter";
  const blobs = 9;
  for (let i = 0; i < blobs; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 36 + (Math.random() * 64);
    const gradient = c.createRadialGradient(x, y, 1, x, y, r);
    const peak = 0.55 + (Math.random() * 0.35);
    gradient.addColorStop(0, `rgba(255,255,255,${peak})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    c.fillStyle = gradient;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fill();
  }
  c.globalCompositeOperation = "source-over";
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = 3.6;
  texture.vScale = 3.6;
  texture.getAlphaFromRGB = true; // luminance -> opacity

  const material = new StandardMaterial("cloudShadowMaterial", scene);
  material.disableLighting = true;
  material.diffuseColor.set(0, 0, 0);
  material.emissiveColor.set(0.12, 0.14, 0.2); // cool, dark — a soft shade tint
  material.specularColor.set(0, 0, 0);
  material.opacityTexture = texture;
  material.transparencyMode = Material.MATERIAL_ALPHABLEND;
  material.alpha = 0.4; // overall faintness
  material.disableDepthWrite = true;
  material.backFaceCulling = true; // only visible from above

  const sheet = MeshBuilder.CreateGround("cloudShadowSheet", { width: 70, height: 70 }, scene);
  sheet.position = new Vector3(0, 0.85, 0); // just above the tallest grass
  sheet.material = material;
  sheet.isPickable = false;
  sheet.alwaysSelectAsActiveMesh = true;
  sheet.setEnabled(false);
  let active = false;

  return {
    setEnabled(enabled: boolean) {
      active = enabled;
      sheet.setEnabled(enabled);
    },
    // Drift the clouds slowly across the field.
    update(timeSeconds: number) {
      if (!active) {
        return;
      }

      texture.uOffset = timeSeconds * 0.004;
      texture.vOffset = timeSeconds * 0.0026;
    },
  };
}
