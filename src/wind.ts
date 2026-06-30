import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import { settings, yardSegments } from "./config";
import type { WindMote, WindWisp } from "./types";

export type Wind = ReturnType<typeof createWind>;
export const windDirection = new Vector3(1, 0, 0).normalize();
const windSideDirection = new Vector3(windDirection.z, 0, -windDirection.x);
const baseWindAngle = 0;

// Owns the ambient wind wisps and motes (and the mower-clipping / seed bursts
// that spawn motes). Needs the camera for billboarding wisps and the player for
// clipping origins.
export function createWind(scene: Scene, camera: ArcRotateCamera, player: Mesh, getYaw: () => number) {
  const windWisps: WindWisp[] = [];
  const windMotes: WindMote[] = [];
  let windAngle = baseWindAngle;
  let targetWindAngle = baseWindAngle;
  let windShiftTimer = 0;

  const effectRadius = () => Math.max(8, settings.windEffectRadius);

  const setWindDirection = (angle: number) => {
    windDirection.set(Math.cos(angle), 0, Math.sin(angle));
    windSideDirection.set(windDirection.z, 0, -windDirection.x);
  };

  const chooseNextWindDirection = () => {
    const varianceRadians = (Math.max(0, Math.min(180, settings.windDirectionVarianceDegrees)) * Math.PI) / 180;
    targetWindAngle = baseWindAngle + ((Math.random() - 0.5) * varianceRadians);
    windShiftTimer = Math.max(1, settings.windShiftSeconds) * (0.78 + (Math.random() * 0.44));
  };

  const updateWindDirection = (deltaSeconds: number) => {
    windShiftTimer -= deltaSeconds;
    if (windShiftTimer <= 0) {
      chooseNextWindDirection();
    }

    windAngle += (targetWindAngle - windAngle) * (1 - Math.exp(-deltaSeconds * 0.55));
    setWindDirection(windAngle);
  };

  const playerRelativePoint = (upwindBias: number, sideSpread: number) => {
    const radius = effectRadius();
    const along = (-radius * upwindBias) + (Math.random() * radius * 1.2);
    const side = (Math.random() - 0.5) * sideSpread;
    return {
      x: player.position.x + (windDirection.x * along) + (windSideDirection.x * side),
      z: player.position.z + (windDirection.z * along) + (windSideDirection.z * side),
    };
  };

  const createWindWispMesh = (name: string) => {
    const mesh = new Mesh(name, scene);
    const segments = 80;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices: number[] = [];

    for (let index = 0; index <= segments; index += 1) {
      if (index < segments) {
        const base = index * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);

    const vertexData = new VertexData();
    vertexData.positions = positions;
    vertexData.indices = indices;
    vertexData.normals = normals;
    vertexData.applyToMesh(mesh, true);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;

    return { mesh, positions };
  };

  const resetWindWisp = (wisp: WindWisp) => {
    wisp.segment = yardSegments[Math.floor(Math.random() * yardSegments.length)];
    wisp.age = -(Math.random() * 3);
    wisp.duration = 9 + (Math.random() * 5);
    wisp.length = 4 + (Math.random() * 2.5);
    const point = playerRelativePoint(0.65, effectRadius() * 1.7);
    wisp.x = point.x;
    wisp.z = point.z;
    wisp.y = 0.75 + (Math.random() * 0.8);
    wisp.bend = (Math.random() < 0.5 ? -1 : 1) * (0.45 + (Math.random() * 0.28));
    wisp.hook = -wisp.bend * (0.95 + (Math.random() * 0.45));
  };

  const updateWindWispShape = (wisp: WindWisp) => {
    const segments = 80;
    const t = Math.min(1, Math.max(0, wisp.age / wisp.duration));
    const appear = Math.min(1, t / 0.48);
    const fadeOut = Math.min(1, (1 - t) / 0.42);
    const visibility = appear * fadeOut;
    const growEase = 1 - Math.pow(1 - Math.min(1, t / 0.62), 3);
    const growEnd = Math.max(0.04, growEase);
    const trimStart = t < 0.68 ? 0 : ((t - 0.68) / 0.32) * 0.92;
    const curveAmount = Math.min(1, t / 0.45);
    const hookAmount = Math.max(0, (t - 0.48) / 0.4);
    const baseWidth = 0.075 * visibility;

    for (let index = 0; index <= segments; index += 1) {
      const local = index / segments;
      const u = trimStart + ((growEnd - trimStart) * local);
      const localWidth = Math.sin(Math.PI * local) * baseWidth;
      const x = u * wisp.length;
      const firstCurve = Math.sin(Math.PI * Math.min(1, u * 0.92)) * wisp.bend * curveAmount;
      const hookT = Math.max(0, (u - 0.58) / 0.42);
      const hook = Math.sin(Math.PI * hookT * 0.9) * wisp.hook * hookAmount;
      const tangentZ = (Math.cos(Math.PI * Math.min(1, u * 0.92)) * Math.PI * 0.92 * wisp.bend * curveAmount)
        + (hookT > 0 ? Math.cos(Math.PI * hookT * 0.9) * Math.PI * 0.9 * wisp.hook * hookAmount / 0.42 : 0);
      const tangent = windDirection.add(windSideDirection.scale(tangentZ)).normalize();
      const sideDistance = firstCurve + hook;
      const centerX = wisp.x + (windDirection.x * x) + (windSideDirection.x * sideDistance);
      const centerY = wisp.y + (Math.sin(Math.PI * u) * 0.04 * curveAmount);
      const centerZ = wisp.z + (windDirection.z * x) + (windSideDirection.z * sideDistance);
      const lift = Math.sin(Math.PI * u) * 0.04 * curveAmount;
      const cameraDirection = camera.position.subtract(new Vector3(centerX, centerY, centerZ)).normalize();
      const widthDirection = Vector3.Cross(tangent, cameraDirection).normalize();
      const offset = index * 6;

      wisp.positions[offset] = centerX + (widthDirection.x * localWidth);
      wisp.positions[offset + 1] = centerY + lift + (widthDirection.y * localWidth);
      wisp.positions[offset + 2] = centerZ + (widthDirection.z * localWidth);
      wisp.positions[offset + 3] = centerX - (widthDirection.x * localWidth);
      wisp.positions[offset + 4] = centerY + lift - (widthDirection.y * localWidth);
      wisp.positions[offset + 5] = centerZ - (widthDirection.z * localWidth);
    }

    wisp.mesh.updateVerticesData(VertexBuffer.PositionKind, wisp.positions, true, false);
    wisp.material.alpha = visibility * 0.34;
  };

  const createWindWisps = () => {
    for (let index = 0; index < 4; index += 1) {
      const material = new StandardMaterial(`windWispMaterial-${index}`, scene);
      material.diffuseColor = new Color3(1, 1, 1);
      material.emissiveColor = new Color3(0.9, 1, 0.92);
      material.alpha = 0.4;
      material.backFaceCulling = false;
      material.disableLighting = true;

      const { mesh, positions } = createWindWispMesh(`windWisp-${index}`);
      mesh.material = material;
      mesh.isPickable = false;

      const wisp: WindWisp = {
        mesh,
        material,
        segment: yardSegments[0],
        positions,
        age: 0,
        duration: 5,
        length: 1,
        x: 0,
        z: 0,
        y: 1,
        bend: 0,
        hook: 0,
      };

      resetWindWisp(wisp);
      wisp.age = index === 0 ? wisp.duration * 0.12 : -(2 + (index * 2.7) + (Math.random() * 1.3));
      updateWindWispShape(wisp);
      windWisps.push(wisp);
    }
  };

  const updateWindWisps = (deltaSeconds: number) => {
    for (const wisp of windWisps) {
      wisp.age += deltaSeconds;

      if (wisp.age < 0) {
        wisp.material.alpha = 0;
        continue;
      }

      if (wisp.age > wisp.duration) {
        resetWindWisp(wisp);
      }

      wisp.mesh.position.set(0, 0, 0);
      wisp.mesh.rotation.set(0, 0, 0);
      wisp.mesh.scaling.set(1, 1, 1);
      updateWindWispShape(wisp);
    }
  };

  const resetWindMote = (mote: WindMote) => {
    const radius = effectRadius();
    const point = playerRelativePoint(0.95, radius * 1.8);
    mote.segment = yardSegments.find((segment) => (
      point.x >= segment.xMin
      && point.x <= segment.xMax
      && point.z >= segment.zMin
      && point.z <= segment.zMax
    )) ?? yardSegments[0];
    mote.age = -(Math.random() * 5);
    mote.duration = Math.max(8, (radius / Math.max(0.1, settings.windSpeed)) * 0.75);
    mote.x = point.x;
    mote.z = point.z;
    mote.y = 0.45 + (Math.random() * 1.2);
    mote.speed = settings.windSpeed * (0.86 + (Math.random() * 0.32));
    mote.drift = (Math.random() - 0.5) * 0.5;
    mote.size = 0.018 + (Math.random() * 0.035);
  };

  const createWindMote = (color?: Color3) => {
    const material = new StandardMaterial(`windMoteMaterial-${windMotes.length}`, scene);
    material.diffuseColor = color ?? new Color3(0.95, 1, 0.9);
    material.emissiveColor = material.diffuseColor;
    material.alpha = 0;
    material.disableLighting = true;

    const mesh = MeshBuilder.CreatePlane(`windMote-${windMotes.length}`, { size: 1 }, scene);
    mesh.material = material;
    mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    mesh.isPickable = false;

    return {
      mesh,
      material,
      segment: yardSegments[0],
      age: 0,
      duration: 6,
      x: 0,
      y: 0,
      z: 0,
      speed: 1,
      drift: 0,
      size: 0.02,
    } satisfies WindMote;
  };

  const createWindMotes = () => {
    for (let index = 0; index < 6; index += 1) {
      const mote = createWindMote(Math.random() < 0.18 ? new Color3(1, 0.92, 0.34) : undefined);
      resetWindMote(mote);
      windMotes.push(mote);
    }
  };

  const updateWindMotes = (deltaSeconds: number) => {
    for (const mote of windMotes) {
      mote.age += deltaSeconds;

      const travelDistance = Math.max(0, mote.age) * mote.speed;
      const currentX = mote.x + (windDirection.x * travelDistance);
      const currentZ = mote.z + (windDirection.z * travelDistance);
      const playerDx = currentX - player.position.x;
      const playerDz = currentZ - player.position.z;
      if (mote.age > mote.duration || (playerDx * playerDx) + (playerDz * playerDz) > (effectRadius() + 10) ** 2) {
        resetWindMote(mote);
      }

      if (mote.age < 0) {
        mote.material.alpha = 0;
        continue;
      }

      const t = mote.age / mote.duration;
      const fade = Math.sin(Math.PI * t);
      const travel = mote.age * mote.speed;
      const sideDrift = Math.sin(t * Math.PI) * mote.drift;
      const x = mote.x + (windDirection.x * travel) + (windSideDirection.x * sideDrift);
      const y = mote.y + (Math.sin((t * Math.PI * 2) + mote.drift) * 0.08);
      const z = mote.z + (windDirection.z * travel) + (windSideDirection.z * sideDrift);

      mote.mesh.position.set(x, y, z);
      mote.mesh.scaling.set(mote.size, mote.size, mote.size);
      mote.material.alpha = fade * 0.28;
    }
  };

  createWindWisps();
  createWindMotes();
  chooseNextWindDirection();

  return {
    update(deltaSeconds: number) {
      updateWindDirection(deltaSeconds);
      updateWindWisps(deltaSeconds);
      updateWindMotes(deltaSeconds);
    },

    burstMowerClippings(includeYellow = false) {
      const yaw = getYaw();
      const forwardX = Math.sin(yaw);
      const forwardZ = Math.cos(yaw);
      const sideSign = Math.random() < 0.5 ? -1 : 1;
      const sideX = Math.cos(yaw) * sideSign;
      const sideZ = -Math.sin(yaw) * sideSign;
      const originX = player.position.x - (forwardX * 0.35) + (sideX * 0.52);
      const originZ = player.position.z - (forwardZ * 0.35) + (sideZ * 0.52);
      const count = includeYellow ? 5 : 1;

      for (let index = 0; index < count; index += 1) {
        const color = includeYellow && index < 5
          ? new Color3(1, 0.94, 0.02)
          : new Color3(0.42 + (Math.random() * 0.2), 0.74 + (Math.random() * 0.18), 0.12);
        const mote = createWindMote(color);
        mote.segment = yardSegments.find((segment) => (
          player.position.x >= segment.xMin
          && player.position.x <= segment.xMax
          && player.position.z >= segment.zMin
          && player.position.z <= segment.zMax
        )) ?? yardSegments[0];
        mote.age = Math.random() * 0.15;
        mote.duration = 1.3 + (Math.random() * 1.5);
        mote.x = originX + ((Math.random() - 0.5) * 0.38);
        mote.y = 0.18 + (Math.random() * 0.32);
        mote.z = originZ + ((Math.random() - 0.5) * 0.38);
        mote.speed = settings.windSpeed * (0.34 + (Math.random() * 0.4));
        mote.drift = (sideSign * 0.75) + ((Math.random() - 0.5) * 0.35);
        mote.size = 0.014 + (Math.random() * 0.03);
        windMotes.push(mote);
      }
    },

    burstDandelionSeeds(x: number, z: number, y: number) {
      for (let index = 0; index < 32; index += 1) {
        const mote = createWindMote();
        mote.segment = yardSegments.find((segment) => (
          x >= segment.xMin
          && x <= segment.xMax
          && z >= segment.zMin
          && z <= segment.zMax
        )) ?? yardSegments[0];
        mote.age = Math.random() * 0.3;
        mote.duration = 4 + (Math.random() * 3.5);
        mote.x = x + ((Math.random() - 0.5) * 0.25);
        mote.y = y + ((Math.random() - 0.5) * 0.18);
        mote.z = z + ((Math.random() - 0.5) * 0.25);
        mote.speed = settings.windSpeed * (0.72 + (Math.random() * 0.75));
        mote.drift = (Math.random() - 0.5) * 0.9;
        mote.size = 0.018 + (Math.random() * 0.025);
        windMotes.push(mote);
      }
    },
  };
}
