import { Effect, Mesh, ShaderMaterial, Vector3, Vector4, VertexData } from "@babylonjs/core";
import type { DynamicTexture, Scene } from "@babylonjs/core";
import { MOW_FIELD } from "./mowField";
import { settings } from "./config";
import { hexToColor3 } from "./utils/color";
import { createGrassBake } from "./grassBake";

// Step 2 of the grass-LOD plan: one ground mesh that reads as a field of grass.
// The vertex shader samples the live mow-state field and raises the surface where
// uncut (procedural lumpiness), dropping it short where mowed. The FRAGMENT now
// samples BAKED tiling normal + albedo maps (grassBake.ts) instead of computing
// noise per pixel — that's the perf win and what makes the distant shine read as
// grass: the baked normal map glances light directionally, and a roughness-matched
// GGX highlight + grazing sheen approximate the real blades' specular. All tunable
// live from the "Grass LOD" settings group.

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

  const bake = createGrassBake(scene);

  if (!Effect.ShadersStore.grassFieldVertexShader) {
    Effect.ShadersStore.grassFieldVertexShader = `
      precision highp float;
      attribute vec3 position;
      uniform mat4 worldViewProjection;
      uniform sampler2D mowField;
      uniform vec4 bounds;        // minX, minZ, width, depth
      uniform float heightTotal;     // base grass height
      uniform float bumpAmplitude;   // +/- surface deviation around the base
      uniform float heightOffset;
      uniform float noiseScale;
      varying float vT;
      varying vec3 vGeoNormal;
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
        vec2 uv = vec2((xz.x - bounds.x) / bounds.z, 1.0 - ((xz.y - bounds.y) / bounds.w));
        return texture2D(mowField, uv).r;
      }
      float heightAt(vec2 xz){
        float bump = fbm(xz * noiseScale);
        float uncut = 1.0 - (mowedAt(xz) * 0.85);
        float surf = heightTotal + (bumpAmplitude * (bump - 0.5) * 2.0);
        return heightOffset + (uncut * max(0.0, surf));
      }

      void main(void){
        vec2 xz = position.xz;
        float h = heightAt(xz);
        float e = 0.16;
        float hx = heightAt(xz + vec2(e, 0.0));
        float hz = heightAt(xz + vec2(0.0, e));
        vGeoNormal = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
        vT = clamp((fbm(xz * noiseScale) - 0.25) / 0.5, 0.0, 1.0);
        vec3 wp = vec3(position.x, position.y + h, position.z);
        vWorldPos = wp;
        gl_Position = worldViewProjection * vec4(wp, 1.0);
      }
    `;
    Effect.ShadersStore.grassFieldFragmentShader = `
      precision highp float;
      varying float vT;
      varying vec3 vGeoNormal;
      varying vec3 vWorldPos;
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 lightDir;
      uniform vec3 cameraPosition;
      uniform sampler2D grassNormal;
      uniform sampler2D grassAlbedo;
      uniform float tileScale;
      uniform float normalStrength;
      uniform float roughness;
      uniform float specIntensity;
      uniform float sheen;
      uniform float opacity;

      const vec3 LIGHT_COLOR = vec3(1.0, 0.95, 0.74);

      void main(void){
        vec2 duv = vWorldPos.xz * tileScale;
        vec3 nm = (texture2D(grassNormal, duv).xyz * 2.0) - 1.0;
        vec3 detail = texture2D(grassAlbedo, duv).rgb;

        vec3 N = normalize(vGeoNormal + (vec3(nm.x, 0.0, nm.y) * normalStrength));
        vec3 L = -normalize(lightDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 H = normalize(L + V);
        float NoL = clamp(dot(N, L), 0.0, 1.0);
        float NoH = clamp(dot(N, H), 0.0, 1.0);
        float NoV = clamp(dot(N, V), 0.0, 1.0);

        vec3 base = mix(bottomColor, topColor, vT) * (0.7 + (0.6 * detail.g));

        // GGX-ish highlight; breadth tracks roughness so it matches the blades' shine
        float a = max(0.02, roughness * roughness);
        float dnm = ((NoH * NoH) * ((a * a) - 1.0)) + 1.0;
        float D = (a * a) / (3.14159 * dnm * dnm);
        float spec = D * specIntensity * NoL;

        // grazing sheen — the velvety retro-glow distant grass has
        float rim = pow(1.0 - NoV, 3.0) * sheen * (0.3 + (0.7 * NoL));

        float diffuse = 0.4 + (0.6 * NoL);
        vec3 col = (base * diffuse) + (LIGHT_COLOR * spec) + (base * rim);
        gl_FragColor = vec4(col, opacity);
      }
    `;
  }

  const material = new ShaderMaterial("grassFieldMat", scene, "grassField", {
    attributes: ["position"],
    uniforms: [
      "worldViewProjection", "cameraPosition", "bounds", "heightTotal", "bumpAmplitude",
      "heightOffset", "noiseScale", "topColor", "bottomColor", "lightDir", "tileScale",
      "normalStrength", "roughness", "specIntensity", "sheen", "opacity",
    ],
    samplers: ["mowField", "grassNormal", "grassAlbedo"],
  });
  material.setTexture("mowField", mowTexture);
  material.setTexture("grassNormal", bake.normalTex);
  material.setTexture("grassAlbedo", bake.albedoTex);
  material.setVector4("bounds", new Vector4(minX, minZ, width, depth));
  material.setVector3("lightDir", new Vector3(-0.45, -1, 0.24).normalize());
  material.backFaceCulling = true;

  mesh.material = material;
  mesh.isPickable = false;

  const applySettings = () => {
    material.setFloat("heightTotal", settings.lodHeightTotal);
    material.setFloat("bumpAmplitude", settings.lodBumpAmplitude);
    material.setFloat("heightOffset", settings.lodHeightOffset);
    material.setFloat("noiseScale", settings.lodNoiseScale);
    material.setFloat("tileScale", settings.lodNormalScale); // repurposed: baked-detail tiling
    material.setFloat("normalStrength", settings.lodNormalStrength);
    material.setFloat("roughness", settings.lodRoughness);
    material.setFloat("specIntensity", settings.lodSpecular);
    material.setFloat("sheen", settings.lodSheen);
    material.setFloat("opacity", settings.lodOpacity);
    material.setColor3("topColor", hexToColor3(settings.lodTopColor));
    material.setColor3("bottomColor", hexToColor3(settings.lodBottomColor));
    material.alpha = settings.lodOpacity;
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
