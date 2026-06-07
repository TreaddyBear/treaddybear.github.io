import { Effect, Mesh, ShaderMaterial, Vector3, Vector4, VertexData } from "@babylonjs/core";
import type { DynamicTexture, Scene } from "@babylonjs/core";
import { MOW_FIELD } from "./mowField";
import { settings } from "./config";
import { hexToColor3 } from "./utils/color";
import type { GrassBake } from "./grassBake";

// The far-LOD grass as VERTICAL slats instead of a flat sheet. A flat mesh only
// reflects over the upper hemisphere with near-up normals, so it reads as shiny
// ground. Real grass shimmers because thousands of near-vertical surfaces each
// face a different azimuth. These cross-hatched ribbon strips (one set running X,
// one running Z) recreate that: side-facing normals catch light from the side,
// and an alpha-cutout from the baked blade-density mask carves each strip into
// ragged blades that thin toward the tip. Driven by the live mow-field for height.

const SPACING = 0.5; // strip spacing + segment length (world units)

export function createGrassSlats(scene: Scene, mowTexture: DynamicTexture, bake: GrassBake) {
  const { minX, maxX, minZ, maxZ } = MOW_FIELD;
  const width = maxX - minX;
  const depth = maxZ - minZ;

  const positions: number[] = []; // x, topFlag(0|1), z
  const normals: number[] = []; // horizontal slat facing
  const uvs: number[] = []; // runDistance, topFlag
  const indices: number[] = [];
  let vi = 0;

  const addStrips = (alongX: boolean) => {
    const runMin = alongX ? minX : minZ;
    const runMax = alongX ? maxX : maxZ;
    const crossMin = alongX ? minZ : minX;
    const crossMax = alongX ? maxZ : maxX;
    const nx = alongX ? 0 : 1;
    const nz = alongX ? 1 : 0;
    for (let c = crossMin + (SPACING * 0.5); c < crossMax; c += SPACING) {
      let prevBot = -1;
      let prevTop = -1;
      let runDist = 0;
      for (let run = runMin; run <= runMax + 1e-3; run += SPACING) {
        const x = alongX ? run : c;
        const z = alongX ? c : run;
        positions.push(x, 0, z, x, 1, z);
        normals.push(nx, 0, nz, nx, 0, nz);
        uvs.push(runDist, 0, runDist, 1);
        const bot = vi;
        const top = vi + 1;
        vi += 2;
        if (prevBot >= 0) {
          indices.push(prevBot, bot, prevTop, bot, top, prevTop);
        }
        prevBot = bot;
        prevTop = top;
        runDist += SPACING;
      }
    }
  };
  addStrips(true);
  addStrips(false);

  const mesh = new Mesh("grassSlats", scene);
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  data.applyToMesh(mesh);

  if (!Effect.ShadersStore.grassSlatsVertexShader) {
    Effect.ShadersStore.grassSlatsVertexShader = `
      precision highp float;
      attribute vec3 position;   // x, topFlag(0|1), z
      attribute vec3 normal;     // horizontal slat facing
      attribute vec2 uv;         // runDist, topFlag
      uniform mat4 worldViewProjection;
      uniform sampler2D mowField;
      uniform vec4 bounds;
      uniform float slatHeight;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vTop;
      varying float vRun;

      float mowedAt(vec2 xz){
        vec2 uvm = vec2((xz.x - bounds.x) / bounds.z, 1.0 - ((xz.y - bounds.y) / bounds.w));
        return texture2D(mowField, uvm).r;
      }
      void main(void){
        vec2 xz = vec2(position.x, position.z);
        float h = slatHeight * (1.0 - (mowedAt(xz) * 0.92));
        vec3 wp = vec3(position.x, position.y * h, position.z);
        vWorldPos = wp;
        vNormal = normal;
        vTop = uv.y;
        vRun = uv.x;
        gl_Position = worldViewProjection * vec4(wp, 1.0);
      }
    `;
    Effect.ShadersStore.grassSlatsFragmentShader = `
      precision highp float;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vTop;
      varying float vRun;
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
      uniform float cutoff;

      const vec3 LIGHT_COLOR = vec3(1.0, 0.95, 0.74);

      void main(void){
        vec2 duv = vec2(vRun, vWorldPos.y) * tileScale;
        vec4 alb = texture2D(grassAlbedo, duv);
        // carve into blades: more cutout toward the tip so it thins like grass
        float thresh = mix(cutoff, cutoff + 0.45, vTop);
        if (alb.a < thresh) discard;

        vec3 N0 = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 T = normalize(cross(up, N0));
        vec3 nm = (texture2D(grassNormal, duv).xyz * 2.0) - 1.0;
        vec3 N = normalize((nm.x * T * normalStrength) + (nm.y * up * normalStrength) + N0);

        vec3 L = -normalize(lightDir);
        vec3 V = normalize(cameraPosition - vWorldPos);
        vec3 H = normalize(L + V);
        float NoL = clamp(dot(N, L), 0.0, 1.0);
        float NoH = clamp(dot(N, H), 0.0, 1.0);
        float NoV = clamp(dot(N, V), 0.0, 1.0);

        vec3 base = mix(bottomColor, topColor, vTop) * (0.7 + (0.6 * alb.g));
        float a = max(0.02, roughness * roughness);
        float dnm = ((NoH * NoH) * ((a * a) - 1.0)) + 1.0;
        float spec = ((a * a) / (3.14159 * dnm * dnm)) * specIntensity * NoL;
        float rim = pow(1.0 - NoV, 3.0) * sheen * (0.3 + (0.7 * NoL));
        float diffuse = 0.45 + (0.55 * NoL);
        vec3 col = (base * diffuse) + (LIGHT_COLOR * spec) + (base * rim);
        gl_FragColor = vec4(col, 1.0);
      }
    `;
  }

  const material = new ShaderMaterial("grassSlatsMat", scene, "grassSlats", {
    attributes: ["position", "normal", "uv"],
    uniforms: [
      "worldViewProjection", "cameraPosition", "bounds", "slatHeight", "topColor", "bottomColor",
      "lightDir", "tileScale", "normalStrength", "roughness", "specIntensity", "sheen", "cutoff",
    ],
    samplers: ["mowField", "grassNormal", "grassAlbedo"],
    needAlphaTesting: true,
  });
  material.setTexture("mowField", mowTexture);
  material.setTexture("grassNormal", bake.normalTex);
  material.setTexture("grassAlbedo", bake.albedoTex);
  material.setVector4("bounds", new Vector4(minX, minZ, width, depth));
  material.setVector3("lightDir", new Vector3(-0.45, -1, 0.24).normalize());
  material.backFaceCulling = false; // slats are double-sided
  mesh.material = material;
  mesh.isPickable = false;

  const applySettings = () => {
    material.setFloat("slatHeight", settings.lodSlatHeight);
    material.setFloat("tileScale", settings.lodSlatTileScale);
    material.setFloat("normalStrength", settings.lodNormalStrength);
    material.setFloat("roughness", settings.lodRoughness);
    material.setFloat("specIntensity", settings.lodSpecular);
    material.setFloat("sheen", settings.lodSheen);
    material.setFloat("cutoff", settings.lodSlatCutoff);
    material.setColor3("topColor", hexToColor3(settings.lodTopColor));
    material.setColor3("bottomColor", hexToColor3(settings.lodBottomColor));
    mesh.setEnabled(settings.lodSlatsShow);
  };
  applySettings();

  return {
    applySettings,
    show(on: boolean) {
      settings.lodSlatsShow = on;
      mesh.setEnabled(on);
    },
  };
}
