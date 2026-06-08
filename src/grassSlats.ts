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
      uniform float wiggleAmp;
      uniform float wiggleFreq;
      uniform float bendAmp;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vTop;
      varying float vRun;

      float mowedAt(vec2 xz){
        vec2 uvm = vec2((xz.x - bounds.x) / bounds.z, 1.0 - ((xz.y - bounds.y) / bounds.w));
        return texture2D(mowField, uvm).r;
      }
      float vhash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float vnoise(vec2 p){
        vec2 i = floor(p); vec2 f = fract(p);
        float a = vhash(i); float b = vhash(i + vec2(1.0, 0.0));
        float c = vhash(i + vec2(0.0, 1.0)); float d = vhash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - (2.0 * f));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }
      void main(void){
        float top = position.y;
        float run = uv.x;
        bool alongX = abs(normal.z) > 0.5;
        vec2 perpDir = alongX ? vec2(0.0, 1.0) : vec2(1.0, 0.0); // facing
        vec2 cell = vec2(position.x, position.z);

        // Per-SECTION bend from layered noise: every part of every slat leans a
        // different direction, so there is no uniform comb pattern.
        float n1 = vnoise(cell * 0.7) - 0.5;
        float n2 = vnoise((cell * 2.1) + 9.3) - 0.5;
        float n3 = vnoise((cell * 5.4) + 21.7) - 0.5;
        float bendAngle = ((n1 * 2.2) + n2 + (0.5 * n3)) * 6.28318;
        vec2 bdir = vec2(cos(bendAngle), sin(bendAngle));
        float bamt = bendAmp * top * top * (0.45 + (0.9 * vnoise((cell * 1.3) + 3.0)));

        // Gentle base meander (keeps the wiggle controls live).
        float w = wiggleAmp * sin((run * wiggleFreq) + ((cell.x + cell.y) * 3.0));
        vec2 xz = cell + (bdir * bamt) + (perpDir * w);

        // Point each section's lighting normal at a RANDOM azimuth (full circle),
        // like real blades facing every which way. The cross-hatch alone only had
        // +/-X and +/-Z facings, so the specular showed up as two flanking lobes
        // instead of one broad grass highlight. perpDir is unused for lighting now.
        float twist = (vnoise((cell * 1.1) + 13.0) * 6.28318) + (n2 * 3.0);
        vec2 facing = vec2(cos(twist), sin(twist));

        float h = slatHeight * (1.0 - (mowedAt(xz) * 0.92));
        vec3 wp = vec3(xz.x, top * h, xz.y);
        vWorldPos = wp;
        vNormal = vec3(facing.x, 0.35 * top, facing.y);
        vTop = top;
        vRun = run;
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
        // Isotropic highlight, same character as the real PBR blades (which face
        // random ways). With the randomized section facings above, this spreads
        // into ONE broad grass highlight on the sun side rather than flanking lobes.
        float power = max(8.0, 2.0 / max(0.0025, roughness * roughness));
        float spec = pow(NoH, power) * specIntensity * NoL;
        float rim = pow(1.0 - NoV, 2.5) * sheen * (0.25 + (0.75 * NoL));
        float diffuse = 0.5 + (0.5 * NoL);
        vec3 col = (base * diffuse) + (LIGHT_COLOR * spec) + (base * rim) + (LIGHT_COLOR * (rim * 0.4));
        gl_FragColor = vec4(col, 1.0);
      }
    `;
  }

  const material = new ShaderMaterial("grassSlatsMat", scene, "grassSlats", {
    attributes: ["position", "normal", "uv"],
    uniforms: [
      "worldViewProjection", "cameraPosition", "bounds", "slatHeight", "topColor", "bottomColor",
      "lightDir", "tileScale", "normalStrength", "roughness", "specIntensity", "sheen", "cutoff",
      "wiggleAmp", "wiggleFreq", "bendAmp",
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
    material.setFloat("wiggleAmp", settings.lodSlatWiggle);
    material.setFloat("wiggleFreq", settings.lodSlatWiggleFreq);
    material.setFloat("bendAmp", settings.lodSlatBend);
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
