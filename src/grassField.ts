import { Color3, Effect, Mesh, ShaderMaterial, Vector3, Vector4, VertexData } from "@babylonjs/core";
import type { DynamicTexture, Scene } from "@babylonjs/core";
import { MOW_FIELD } from "./mowField";

// Step 2 of the grass-LOD plan: a single ground mesh that reads as a field of
// grass without per-blade instances. A shader samples the mow-state field and
// raises the surface where the lawn is uncut (with procedural lumpiness so it
// reads as grass) and drops it flat/short where it has been mowed, recoloring
// to match. Because it samples the live mow texture every frame, it updates as
// you mow with zero per-frame JS.
//
// This is the FAR LOD only; today it is gated behind a dev toggle
// (window.grassField.show(true)) and is non-destructive — it does not yet
// replace or blend with the real near blades. It currently covers the whole
// field rectangle (road/out-of-bounds included) — masking to the yard comes
// with the near/far blend (step 3).

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
      uniform vec4 bounds;       // minX, minZ, width, depth
      uniform float grassHeight;
      varying float vMowed;
      varying vec3 vNormal;
      varying float vHeight;

      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = hash(i); float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)); float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      float mowedAt(vec2 xz){
        vec2 uv = vec2((xz.x - bounds.x) / bounds.z, (xz.y - bounds.y) / bounds.w);
        return texture2D(mowField, uv).r;
      }
      float heightAt(vec2 xz){
        float bump = (vnoise(xz * 1.6) * 0.6) + (vnoise(xz * 5.1) * 0.4);
        return grassHeight * (1.0 - mowedAt(xz)) * (0.45 + (0.55 * bump));
      }

      void main(void){
        vec2 xz = position.xz;
        float h = heightAt(xz);
        float e = 0.18;
        float hx = heightAt(xz + vec2(e, 0.0));
        float hz = heightAt(xz + vec2(0.0, e));
        vNormal = normalize(vec3(-(hx - h) / e, 1.0, -(hz - h) / e));
        vHeight = h;
        vMowed = mowedAt(xz);
        gl_Position = worldViewProjection * vec4(position.x, position.y + h, position.z, 1.0);
      }
    `;
    Effect.ShadersStore.grassFieldFragmentShader = `
      precision highp float;
      varying float vMowed;
      varying vec3 vNormal;
      varying float vHeight;
      uniform vec3 tallColor;
      uniform vec3 shortColor;
      uniform vec3 lightDir;

      void main(void){
        vec3 base = mix(tallColor, shortColor, clamp(vMowed, 0.0, 1.0));
        float lambert = clamp(dot(normalize(vNormal), -normalize(lightDir)), 0.0, 1.0);
        float light = 0.5 + (0.5 * lambert);
        gl_FragColor = vec4(base * light, 1.0);
      }
    `;
  }

  const material = new ShaderMaterial("grassFieldMat", scene, "grassField", {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "bounds", "grassHeight", "tallColor", "shortColor", "lightDir"],
    samplers: ["mowField"],
  });
  material.setTexture("mowField", mowTexture);
  material.setVector4("bounds", new Vector4(minX, minZ, width, depth));
  material.setFloat("grassHeight", 0.62);
  material.setColor3("tallColor", new Color3(0.08, 0.27, 0.04));
  material.setColor3("shortColor", new Color3(0.33, 0.6, 0.13));
  material.setVector3("lightDir", new Vector3(-0.45, -1, 0.24).normalize());
  material.backFaceCulling = true;

  mesh.material = material;
  mesh.isPickable = false;
  mesh.setEnabled(false); // off by default — dev toggle only for now

  return {
    show(on: boolean) {
      mesh.setEnabled(on);
    },
    isShown() {
      return mesh.isEnabled();
    },
  };
}
