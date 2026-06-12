import { Effect, Mesh, ShaderMaterial, Vector2, Vector3, Vector4, VertexData } from "@babylonjs/core";
import type { DynamicTexture, Scene } from "@babylonjs/core";
import { MOW_FIELD } from "./mowField";
import { settings } from "./config";
import { hexToColor3 } from "./utils/color";
import type { GrassBake } from "./grassBake";

// Far-LOD grass as vertical slats. The geometry supplies density and silhouette;
// the shader computes normals from the bent ribbon surface so light responds to
// the visible motion instead of to a fabricated sky-facing normal.

const SPACING = 0.5; // strip spacing + segment length in world units
const SLAT_DOWNWIND_DIRECTION = new Vector2(1, 0.35).normalize();

export function createGrassSlats(scene: Scene, mowTexture: DynamicTexture, bake: GrassBake) {
  const { minX, maxX, minZ, maxZ } = MOW_FIELD;
  const width = maxX - minX;
  const depth = maxZ - minZ;

  const positions: number[] = []; // x, topFlag/heightFactor, z
  const normals: number[] = []; // horizontal slat face normal
  const uvs: number[] = []; // runDistance, topFlag/heightFactor
  const indices: number[] = [];
  let vertexIndex = 0;

  const addStrips = (alongX: boolean) => {
    const runMin = alongX ? minX : minZ;
    const runMax = alongX ? maxX : maxZ;
    const crossMin = alongX ? minZ : minX;
    const crossMax = alongX ? maxZ : maxX;
    const normalX = alongX ? 0 : 1;
    const normalZ = alongX ? 1 : 0;

    for (let cross = crossMin + (SPACING * 0.5); cross < crossMax; cross += SPACING) {
      const jitteredCross = cross + ((Math.random() - 0.5) * SPACING * 0.85);
      const heightFactor = 0.5 + (Math.random() * 0.9);
      let previousBottom = -1;
      let previousTop = -1;
      let runDistance = 0;

      for (let run = runMin; run <= runMax + 1e-3; run += SPACING) {
        const perpendicularJitter = (Math.random() - 0.5) * SPACING * 0.5;
        const x = (alongX ? run : jitteredCross) + (alongX ? 0 : perpendicularJitter);
        const z = (alongX ? jitteredCross : run) + (alongX ? perpendicularJitter : 0);

        positions.push(x, 0, z, x, heightFactor, z);
        normals.push(normalX, 0, normalZ, normalX, 0, normalZ);
        uvs.push(runDistance, 0, runDistance, heightFactor);

        const bottom = vertexIndex;
        const top = vertexIndex + 1;
        vertexIndex += 2;

        if (previousBottom >= 0) {
          indices.push(previousBottom, bottom, previousTop, bottom, top, previousTop);
        }

        previousBottom = bottom;
        previousTop = top;
        runDistance += SPACING;
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
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv;
      uniform mat4 worldViewProjection;
      uniform sampler2D mowField;
      uniform vec4 bounds;
      uniform float slatHeight;
      uniform float wiggleAmp;
      uniform float wiggleFreq;
      uniform float bendAmp;
      uniform float time;
      uniform float windAmp;
      uniform vec2 windDir;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vTop;
      varying float vRun;

      float mowedAt(vec2 xz) {
        vec2 uvm = vec2((xz.x - bounds.x) / bounds.z, 1.0 - ((xz.y - bounds.y) / bounds.w));
        return texture2D(mowField, uvm).r;
      }

      float vhash(vec2 p) {
        return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453);
      }

      float vnoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = vhash(i);
        float b = vhash(i + vec2(1.0, 0.0));
        float c = vhash(i + vec2(0.0, 1.0));
        float d = vhash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - (2.0 * f));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      void main(void) {
        float top = position.y > 0.001 ? 1.0 : 0.0;
        float heightFactor = max(position.y, 0.18);
        float run = uv.x;
        bool alongX = abs(normal.z) > 0.5;
        vec2 stripFace = normalize(normal.xz);
        vec2 runDir = alongX ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec2 cell = vec2(position.x, position.z);

        float noiseA = vnoise(cell * 0.7) - 0.5;
        float noiseB = vnoise((cell * 2.1) + 9.3) - 0.5;
        float noiseC = vnoise((cell * 5.4) + 21.7) - 0.5;
        float leanAngle = ((noiseA * 2.2) + noiseB + (0.5 * noiseC)) * 6.28318;
        vec2 staticLeanDir = vec2(cos(leanAngle), sin(leanAngle));
        float staticLean = bendAmp * (0.4 + (1.6 * vnoise((cell * 1.3) + 3.0)));

        vec2 windAcross = vec2(-windDir.y, windDir.x);
        float along = dot(cell, windDir);
        float across = dot(cell, windAcross);
        float gustA = 0.5 + (0.5 * sin((time * 1.7) + (along * 0.45) + (across * 0.12)));
        float gustB = 0.5 + (0.5 * sin((time * 2.6) + (along * 0.8) + (across * 0.3)));
        float gust = 0.35 + (0.45 * gustA) + (0.2 * gustB);
        vec2 windLean = windDir * windAmp * gust;

        vec2 lean = (staticLeanDir * staticLean) + windLean;
        float curve = top * top;
        float wigglePhase = (run * wiggleFreq) + ((cell.x + cell.y) * 3.0);
        float wiggle = wiggleAmp * sin(wigglePhase);
        float wiggleDerivative = wiggleAmp * (wiggleFreq + 3.0) * cos(wigglePhase);
        vec2 xz = cell + (lean * curve) + (stripFace * wiggle);

        float h = slatHeight * (1.0 - (mowedAt(xz) * 0.92));
        vec3 worldPosition = vec3(xz.x, top * h * heightFactor, xz.y);

        vec3 runTangent = normalize(vec3(
          runDir.x + (stripFace.x * wiggleDerivative),
          0.0,
          runDir.y + (stripFace.y * wiggleDerivative)
        ));
        vec3 heightTangent = vec3(2.0 * lean.x * top, max(0.02, h * heightFactor), 2.0 * lean.y * top);
        vec3 geometricNormal = normalize(cross(runTangent, heightTangent));

        if (dot(geometricNormal.xz, stripFace) < 0.0) {
          geometricNormal = -geometricNormal;
        }

        vWorldPos = worldPosition;
        vNormal = geometricNormal;
        vTop = top;
        vRun = run;
        gl_Position = worldViewProjection * vec4(worldPosition, 1.0);
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
      const float PI = 3.14159265;

      void main(void) {
        vec2 detailUv = vec2(vRun, vWorldPos.y) * tileScale;
        vec4 albedoDetail = texture2D(grassAlbedo, detailUv);
        float tipAmount = clamp(vTop, 0.0, 1.0);
        float threshold = mix(cutoff, cutoff + 0.45, tipAmount);

        if (albedoDetail.a < threshold) {
          discard;
        }

        vec3 baseNormal = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
        vec3 tangent = abs(baseNormal.y) > 0.96
          ? vec3(1.0, 0.0, 0.0)
          : normalize(cross(vec3(0.0, 1.0, 0.0), baseNormal));
        vec3 bitangent = normalize(cross(baseNormal, tangent));
        vec3 normalDetail = (texture2D(grassNormal, detailUv).xyz * 2.0) - 1.0;
        vec3 normal = normalize(
          baseNormal
          + (tangent * normalDetail.x * normalStrength)
          + (bitangent * normalDetail.y * normalStrength * 0.35)
        );

        vec3 light = -normalize(lightDir);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 halfDir = normalize(light + viewDir);
        float normalDotLight = clamp(dot(normal, light), 0.0, 1.0);
        float normalDotView = clamp(dot(normal, viewDir), 0.0, 1.0);
        float normalDotHalf = clamp(dot(normal, halfDir), 0.0, 1.0);
        float viewDotHalf = clamp(dot(viewDir, halfDir), 0.0, 1.0);

        vec3 rootColor = mix(bottomColor, topColor, 0.32);
        vec3 base = mix(rootColor, topColor, tipAmount) * (0.78 + (0.42 * albedoDetail.g));
        float diffuse = 0.42 + (0.58 * clamp((dot(normal, light) + 0.18) / 1.18, 0.0, 1.0));

        float rough = clamp(roughness, 0.04, 1.0);
        float alpha = max(0.025, rough * rough);
        float alphaSquared = alpha * alpha;
        float denom = ((normalDotHalf * normalDotHalf) * (alphaSquared - 1.0)) + 1.0;
        float distribution = alphaSquared / max(0.0001, PI * denom * denom);
        float geometryK = ((rough + 1.0) * (rough + 1.0)) * 0.125;
        float geometryView = normalDotView / max(0.0001, (normalDotView * (1.0 - geometryK)) + geometryK);
        float geometryLight = normalDotLight / max(0.0001, (normalDotLight * (1.0 - geometryK)) + geometryK);
        float fresnel = 0.04 + (0.96 * pow(1.0 - viewDotHalf, 5.0));
        float specular = distribution * geometryView * geometryLight * fresnel * specIntensity * normalDotLight;
        specular = min(specular, 0.85);

        float coatRough = 0.06;
        float coatAlpha = max(0.01, coatRough * coatRough);
        float coatAlphaSquared = coatAlpha * coatAlpha;
        float coatDenom = ((normalDotHalf * normalDotHalf) * (coatAlphaSquared - 1.0)) + 1.0;
        float coatDistribution = coatAlphaSquared / max(0.0001, PI * coatDenom * coatDenom);
        float coatFresnel = 0.04 + (0.96 * pow(1.0 - viewDotHalf, 5.0));
        float clearCoat = coatDistribution * coatFresnel * sheen * normalDotLight * 0.18;
        clearCoat = min(clearCoat, 0.55);

        vec3 color = (base * diffuse) + (LIGHT_COLOR * (specular + clearCoat));
        gl_FragColor = vec4(color, 1.0);
      }
    `;
  }

  const material = new ShaderMaterial("grassSlatsMat", scene, "grassSlats", {
    attributes: ["position", "normal", "uv"],
    uniforms: [
      "worldViewProjection", "cameraPosition", "bounds", "slatHeight", "topColor", "bottomColor",
      "lightDir", "tileScale", "normalStrength", "roughness", "specIntensity", "sheen", "cutoff",
      "wiggleAmp", "wiggleFreq", "bendAmp", "time", "windAmp", "windDir",
    ],
    samplers: ["mowField", "grassNormal", "grassAlbedo"],
    needAlphaTesting: true,
  });
  material.setTexture("mowField", mowTexture);
  material.setTexture("grassNormal", bake.normalTex);
  material.setTexture("grassAlbedo", bake.albedoTex);
  material.setVector4("bounds", new Vector4(minX, minZ, width, depth));
  material.setVector3("lightDir", new Vector3(-0.45, -1, 0.24).normalize());
  material.setVector2("windDir", SLAT_DOWNWIND_DIRECTION);
  material.backFaceCulling = false;
  mesh.material = material;
  mesh.isPickable = false;

  const applySettings = () => {
    material.setFloat("slatHeight", settings.lodSlatHeight);
    material.setFloat("tileScale", settings.lodSlatTileScale);
    material.setFloat("wiggleAmp", settings.lodSlatWiggle);
    material.setFloat("wiggleFreq", settings.lodSlatWiggleFreq);
    material.setFloat("bendAmp", settings.lodSlatBend);
    material.setFloat("windAmp", settings.lodSlatWind);
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
    setTime(timeSeconds: number) {
      material.setFloat("time", timeSeconds);
    },
    show(on: boolean) {
      settings.lodSlatsShow = on;
      mesh.setEnabled(on);
    },
  };
}
