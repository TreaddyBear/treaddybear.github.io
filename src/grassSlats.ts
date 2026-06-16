import { Effect, Mesh, ShaderMaterial, Vector2, Vector3, Vector4, VertexData } from "@babylonjs/core";
import type { DynamicTexture, Scene } from "@babylonjs/core";
import { MOW_FIELD } from "./mowField";
import { settings } from "./config";
import { hexToColor3 } from "./utils/color";
import { biomeHomeAmount, roadGrassAmount, sampledTerrainHeightAt } from "./world";
import { windDirection } from "./wind";
import type { GrassBake } from "./grassBake";

// Far-LOD grass as vertical slats. The geometry supplies density and silhouette;
// the shader computes normals from the bent ribbon surface so light responds to
// the visible motion instead of to a fabricated sky-facing normal.

const SPACING = 0.5; // strip spacing + segment length in world units
const slatWindDirection = new Vector2(windDirection.x, windDirection.z).normalize();

// The slat MESH spans far more than the playable mow field: the far grass runs
// well past the fence into the visible distance. Mow state (cutting) only exists
// inside MOW_FIELD; outside it, slats read as uncut tall grass.
const SLAT_AREA = { minX: -75, maxX: 75, minZ: -70, maxZ: 64 };

export function createGrassSlats(scene: Scene, mowTexture: DynamicTexture, bake: GrassBake) {
  const { minX, maxX, minZ, maxZ } = SLAT_AREA;
  // Mow-field bounds drive the `bounds` uniform (where cutting is sampled).
  const mowWidth = MOW_FIELD.maxX - MOW_FIELD.minX;
  const mowDepth = MOW_FIELD.maxZ - MOW_FIELD.minZ;

  const positions: number[] = []; // x, topFlag/heightFactor, z
  const normals: number[] = []; // horizontal slat face normal
  const uvs: number[] = []; // runDistance, topFlag/heightFactor
  const groundYs: number[] = []; // baked terrain height — slats sit on the rolling ground
  const covers: number[] = []; // baked grass/dirt/road coverage (1 = grass, 0 = dirt/road)
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
        // Bake the ground height and grass/dirt coverage here (world-space, same
        // signals the real ground uses) so slats follow the terrain and only grow
        // where there's grass — never on the road or far dirt. Use the SAMPLED
        // (mesh-interpolated) height, not the exact curve, so slats sit ON the
        // visible ground mesh instead of floating above it on steep hills.
        const groundY = sampledTerrainHeightAt(x, z);
        // Grass only past the road's dirt verge AND inside the grass biome, so the
        // slats stop at the same irregular dirt->grass edge the ground draws.
        const cover = roadGrassAmount(x, z, settings.lodSlatRoadInset) * biomeHomeAmount(x, z);
        groundYs.push(groundY, groundY);
        covers.push(cover, cover);

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
  mesh.setVerticesData("groundY", groundYs, false, 1);
  mesh.setVerticesData("cover", covers, false, 1);

  if (!Effect.ShadersStore.grassSlatsVertexShader) {
    Effect.ShadersStore.grassSlatsVertexShader = `
      precision highp float;
      attribute vec3 position;
      attribute vec3 normal;
      attribute vec2 uv;
      attribute float groundY;
      attribute float cover;
      uniform mat4 worldViewProjection;
      uniform sampler2D mowField;
      uniform vec4 bounds;
      uniform float slatHeight;
      uniform float wiggleAmp;
      uniform float wiggleFreq;
      uniform float bendAmp;
      uniform float time;
      uniform float windAmp;
      uniform vec2 windDirection;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vTop;
      varying float vRun;
      varying float vColorPick;
      varying float vCover;

      float mowedAt(vec2 xz) {
        vec2 uvm = vec2((xz.x - bounds.x) / bounds.z, 1.0 - ((xz.y - bounds.y) / bounds.w));
        // Mow state only exists inside the field; outside, treat as uncut (0) so
        // the yard's mowed edge doesn't bleed into the extended far grass.
        if (uvm.x < 0.0 || uvm.x > 1.0 || uvm.y < 0.0 || uvm.y > 1.0) {
          return 0.0;
        }
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

        vec2 windAcross = vec2(-windDirection.y, windDirection.x);
        float along = dot(cell, windDirection);
        float across = dot(cell, windAcross);
        float gustA = 0.5 + (0.5 * sin((time * 1.7) + (along * 0.45) + (across * 0.12)));
        float gustB = 0.5 + (0.5 * sin((time * 2.6) + (along * 0.8) + (across * 0.3)));
        float gust = 0.35 + (0.45 * gustA) + (0.2 * gustB);
        vec2 windLean = windDirection * windAmp * gust;

        vec2 lean = (staticLeanDir * staticLean) + windLean;
        float curve = top * top;
        float wigglePhase = (run * wiggleFreq) + ((cell.x + cell.y) * 3.0);
        float wiggle = wiggleAmp * sin(wigglePhase);
        float wiggleDerivative = wiggleAmp * (wiggleFreq + 3.0) * cos(wigglePhase);
        vec2 xz = cell + (lean * curve) + (stripFace * wiggle);

        float h = slatHeight * (1.0 - (mowedAt(xz) * 0.92));
        // Sit on the rolling terrain (baked groundY), so far slats follow the
        // ground like the real blades/props instead of floating on the y=0 plane.
        vec3 worldPosition = vec3(xz.x, groundY + (top * h * heightFactor), xz.y);

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

        // Per-slat top pick: low-freq noise gives yellower/greener PATCHES across
        // the field, the higher-freq term jitters it blade-to-blade. Drives which
        // of the two top colors this blade leans toward in the fragment.
        vColorPick = clamp((vnoise((cell * 0.9) + 17.0) * 0.65) + (vnoise((cell * 3.7) + 5.0) * 0.35), 0.0, 1.0);

        vWorldPos = worldPosition;
        vNormal = geometricNormal;
        vTop = top;
        vRun = run;
        vCover = cover;
        gl_Position = worldViewProjection * vec4(worldPosition, 1.0);
      }
    `;

    Effect.ShadersStore.grassSlatsFragmentShader = `
      precision highp float;
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      varying float vTop;
      varying float vRun;
      varying float vColorPick;
      varying float vCover;
      uniform vec3 topColorA;
      uniform vec3 topColorB;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      uniform float slatMidPoint;
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
      uniform float lodFade;          // 0 = slats everywhere, 1 = distance fade on
      uniform vec2 lodCenter;         // LOD reference point (the mower, not the camera)
      uniform float slatFadeDistance; // radius where slats begin appearing
      uniform float slatFadeBand;     // width of the alpha fade-in
      uniform float slatMaxDistance;  // far render limit — slats fade back out by here

      const vec3 LIGHT_COLOR = vec3(1.0, 0.95, 0.74);
      const float PI = 3.14159265;

      void main(void) {
        // Only where there's grass — baked coverage is 0 on the road and on far
        // dirt (same signal the ground uses), 1 on grass.
        if (vCover < 0.5) {
          discard;
        }
        vec2 detailUv = vec2(vRun, vWorldPos.y) * tileScale;
        vec4 albedoDetail = texture2D(grassAlbedo, detailUv);
        float tipAmount = clamp(vTop, 0.0, 1.0);
        float threshold = mix(cutoff, cutoff + 0.45, tipAmount);

        if (albedoDetail.a < threshold) {
          discard;
        }

        // Distance LOD: slats are the FAR grass, so they fade IN (alpha) the
        // further you are from the mower. Measured from the mower (lodCenter), not
        // the camera, so orbiting the camera doesn't move the LOD ring. Own
        // distance/band, tuned separately from the blade cull. lodFade off => slats
        // fully on everywhere (tuning mode).
        float slatAlpha = 1.0;
        if (lodFade > 0.5) {
          float lodDist = distance(lodCenter, vWorldPos.xz);
          float fadeIn = clamp((lodDist - slatFadeDistance) / max(0.001, slatFadeBand), 0.0, 1.0);
          // Fade back OUT approaching the render limit, so the far edge isn't a hard
          // ring and "render distance" is a smooth, tunable cutoff.
          float fadeOut = clamp((slatMaxDistance - lodDist) / max(0.001, slatFadeBand), 0.0, 1.0);
          slatAlpha = fadeIn * fadeOut;
          if (slatAlpha <= 0.0) {
            discard; // faded out near the mower or past the render limit — skip it
          }
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

        // "Y"-shaped color graph: each blade picks one of two TOP colors
        // (blade-to-blade variation), then the length blends top -> mid -> bottom
        // through a shared knee at slatMidPoint. Two tops converging to one mid
        // and one bottom.
        vec3 topMix = mix(topColorA, topColorB, vColorPick);
        float knee = clamp(slatMidPoint, 0.05, 0.95);
        vec3 vert = tipAmount < knee
          ? mix(bottomColor, midColor, tipAmount / knee)
          : mix(midColor, topMix, (tipAmount - knee) / (1.0 - knee));
        vec3 base = vert * (0.78 + (0.42 * albedoDetail.g));
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
        gl_FragColor = vec4(color, slatAlpha);
      }
    `;
  }

  const material = new ShaderMaterial("grassSlatsMat", scene, "grassSlats", {
    attributes: ["position", "normal", "uv", "groundY", "cover"],
    uniforms: [
      "worldViewProjection", "cameraPosition", "bounds", "slatHeight",
      "topColorA", "topColorB", "midColor", "bottomColor", "slatMidPoint",
      "lightDir", "tileScale", "normalStrength", "roughness", "specIntensity", "sheen", "cutoff",
      "wiggleAmp", "wiggleFreq", "bendAmp", "time", "windAmp", "windDirection",
      "lodFade", "lodCenter", "slatFadeDistance", "slatFadeBand", "slatMaxDistance",
    ],
    samplers: ["mowField", "grassNormal", "grassAlbedo"],
    needAlphaTesting: true,
  });
  material.setTexture("mowField", mowTexture);
  material.setTexture("grassNormal", bake.normalTex);
  material.setTexture("grassAlbedo", bake.albedoTex);
  material.setVector4("bounds", new Vector4(MOW_FIELD.minX, MOW_FIELD.minZ, mowWidth, mowDepth));
  material.setVector3("lightDir", new Vector3(-0.45, -1, 0.24).normalize());
  material.setVector2("windDirection", slatWindDirection);
  material.setVector2("lodCenter", new Vector2(0, 0));
  material.backFaceCulling = false;
  // The slats fade in by ALPHA, so they need blending. alpha < 1 flips Babylon's
  // needAlphaBlending() on for this ShaderMaterial (the shader writes the real
  // per-pixel alpha; this value isn't multiplied in). forceDepthWrite keeps the
  // far grass writing depth so it occludes correctly instead of haloing.
  material.alpha = 0.999;
  material.forceDepthWrite = true;
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
    material.setColor3("topColorA", hexToColor3(settings.lodSlatTopColorA));
    material.setColor3("topColorB", hexToColor3(settings.lodSlatTopColorB));
    material.setColor3("midColor", hexToColor3(settings.lodSlatMidColor));
    material.setColor3("bottomColor", hexToColor3(settings.lodSlatBottomColor));
    material.setFloat("slatMidPoint", settings.lodSlatColorMid);
    material.setFloat("lodFade", settings.lodFade ? 1 : 0);
    material.setFloat("slatFadeDistance", settings.lodSlatFadeDistance);
    material.setFloat("slatFadeBand", settings.lodSlatFadeBand);
    material.setFloat("slatMaxDistance", settings.lodSlatRenderDistance);
    mesh.setEnabled(settings.lodSlatsShow);
  };
  applySettings();

  const center = new Vector2(0, 0);

  return {
    applySettings,
    setTime(timeSeconds: number) {
      material.setFloat("time", timeSeconds);
    },
    // The LOD reference point (the mower), pushed every frame.
    setCenter(x: number, z: number) {
      center.set(x, z);
      material.setVector2("lodCenter", center);
    },
    // Recompute the grass/dirt coverage from the existing vertex positions (no
    // re-jitter) when the road verge width changes, so slats follow the new edge.
    rebuildCover() {
      const pos = mesh.getVerticesData("position");
      if (!pos) {
        return;
      }
      const next = new Array(pos.length / 3);
      for (let index = 0; index < next.length; index += 1) {
        const x = pos[index * 3];
        const z = pos[(index * 3) + 2];
        next[index] = roadGrassAmount(x, z, settings.lodSlatRoadInset) * biomeHomeAmount(x, z);
      }
      mesh.updateVerticesData("cover", next);
    },
    show(on: boolean) {
      settings.lodSlatsShow = on;
      mesh.setEnabled(on);
    },
  };
}
