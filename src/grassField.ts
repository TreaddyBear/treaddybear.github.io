import { Effect, Mesh, ShaderMaterial, Vector3, Vector4, VertexData } from "@babylonjs/core";
import type { DynamicTexture, Scene } from "@babylonjs/core";
import { MOW_FIELD } from "./mowField";
import { settings } from "./config";
import { hexToColor3 } from "./utils/color";

// Step 2 of the grass-LOD plan: a single ground mesh that reads as a field of
// grass without per-blade instances. A shader samples the mow-state field and
// raises the surface where the lawn is uncut (with procedural lumpiness) and
// drops it flat/short where mowed. Colour comes from local HEIGHT (light tips,
// dark valleys), so the valleys read as self-shadowed; the offset can even sink
// valleys slightly below the terrain so they're occluded. Everything is tunable
// live from the "Grass LOD" settings group via applySettings().
//
// Still the FAR LOD only — shown via the lodShow setting, non-destructive, and
// not yet blended with the real near blades (step 3).

export function createGrassField(scene: Scene, mowTexture: DynamicTexture) {
  const { minX, maxX, minZ, maxZ } = MOW_FIELD;
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const subX = 96;
  const subZ = 70;

  const positions: number[] = [];
  const indices: number[] = [];
  for (let zi = 0; zi <= subZ; zi += 1) {
    const z = minZ + ((zi / subZ) * depth);
    for (let xi = 0; xi <= subX; xi += 1) {
      const x = minX + ((xi / subX) * width);
      positions.push(x, 0, z);
    }
  }
  const row = subX + 1;
  for (let zi = 0; zi < subZ; zi += 1) {
    for (let xi = 0; xi < subX; xi += 1) {
      const base = (zi * row) + xi;
      indices.push(base, base + 1, base + row);
      indices.push(base + 1, base + row + 1, base + row);
    }
  }

  const mesh = new Mesh("grassField", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.applyToMesh(mesh);

  if (!Effect.ShadersStore.grassFieldVertexShader) {
    Effect.ShadersStore.grassFieldVertexShader = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      uniform sampler2D mowField;
      uniform vec4 bounds;        // minX, minZ, width, depth
      uniform float heightTotal;
      uniform float heightOffset;
      uniform float noiseScale;
      varying float vT;           // 0 at valleys, 1 at tips
      varying vec3 vNormal;
      varying vec3 vWorldPos;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i); float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float fbm(vec2 p){
        return (vnoise(p) * 0.55) + (vnoise(p * 2.3 + vec2(11.3)) * 0.30) + (vnoise(p * 5.7 + vec2(31.7)) * 0.15);
      }
      float mowedAt(vec2 xz){
        // V flipped vs the canvas paint (mowField.toPixelY uses maxZ - z).
        vec2 uv = vec2((xz.x - bounds.x) / bounds.z, 1.0 - ((xz.y - bounds.y) / bounds.w));
        return texture2D(mowField, uv).r;
      }
      float heightAt(vec2 xz){
        float bump = fbm(xz * noiseScale);
        float uncut = 1.0 - (mowedAt(xz) * 0.85); // mowed keeps short stubble, not zero
        return heightOffset + (heightTotal * bump * uncut);
      }

      void main(void){
        vec2 xz = position.xz;
        float h = heightAt(xz);
        float e = 0.16;
        float hx = heightAt(xz + vec2(e, 0.0));
        float hz = heightAt(xz + vec2(0.0, e));
        vNormal = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
        vT = clamp((h - heightOffset) / max(0.001, heightTotal), 0.0, 1.0);
        vec3 wp = vec3(position.x, position.y + h, position.z);
        vWorldPos = wp;
        gl_Position = worldViewProjection * vec4(wp, 1.0);
      }
    `;
    Effect.ShadersStore.grassFieldFragmentShader = `
      precision highp float;
      varying float vT;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 lightDir;
      uniform vec3 cameraPosition;
      uniform float normalStrength;
      uniform float normalScale;
      uniform float specularIntensity;
      uniform float opacity;

      float hash2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float vnoise2(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash2(i); float b = hash2(i + vec2(1.0, 0.0));
        float c = hash2(i + vec2(0.0, 1.0)); float d = hash2(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      void main(void){
        vec3 base = mix(bottomColor, topColor, vT);
        // perturb the normal with fine noise so the surface deviates/sparkles
        vec2 np = vWorldPos.xz * normalScale;
        float nx = vnoise2(np) - 0.5;
        float nz = vnoise2(np + vec2(19.7)) - 0.5;
        vec3 N = normalize(vNormal + (vec3(nx, 0.0, nz) * normalStrength));
        vec3 L = -normalize(lightDir);
        float lambert = clamp(dot(N, L), 0.0, 1.0);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 H = normalize(L + V);
        float spec = pow(clamp(dot(N, H), 0.0, 1.0), 28.0) * specularIntensity;
        float light = 0.42 + (0.58 * lambert);
        vec3 col = (base * light) + vec3(spec);
        gl_FragColor = vec4(col, opacity);
      }
    `;
  }

  const material = new ShaderMaterial("grassFieldMat", scene, "grassField", {
    attributes: ["position"],
    uniforms: [
      "worldViewProjection", "cameraPosition", "bounds", "heightTotal", "heightOffset",
      "noiseScale", "topColor", "bottomColor", "lightDir", "normalStrength", "normalScale",
      "specularIntensity", "opacity",
    ],
    samplers: ["mowField"],
  });
  material.setTexture("mowField", mowTexture);
  material.setVector4("bounds", new Vector4(minX, minZ, width, depth));
  material.setVector3("lightDir", new Vector3(-0.45, -1, 0.24).normalize());
  material.backFaceCulling = true;

  mesh.material = material;
  mesh.isPickable = false;

  const applySettings = () => {
    material.setFloat("heightTotal", settings.lodHeightTotal);
    material.setFloat("heightOffset", settings.lodHeightOffset);
    material.setFloat("noiseScale", settings.lodNoiseScale);
    material.setFloat("normalStrength", settings.lodNormalStrength);
    material.setFloat("normalScale", settings.lodNormalScale);
    material.setFloat("specularIntensity", settings.lodSpecular);
    material.setFloat("opacity", settings.lodOpacity);
    material.setColor3("topColor", hexToColor3(settings.lodTopColor));
    material.setColor3("bottomColor", hexToColor3(settings.lodBottomColor));
    material.alpha = settings.lodOpacity; // toggles alpha blending on ShaderMaterial
    mesh.setEnabled(settings.lodShow);
  };
  applySettings();

  return {
    applySettings,
    show(on: boolean) {
      settings.lodShow = on;
      mesh.setEnabled(on);
    },
    isShown() {
      return mesh.isEnabled();
    },
  };
}
