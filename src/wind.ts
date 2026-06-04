import { Color3, Mesh, MeshBuilder, StandardMaterial, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import type { ArcRotateCamera, Scene } from "@babylonjs/core";
import { yardSegments } from "./config";
import type { WindMote, WindWisp } from "./types";

export type Wind = ReturnType<typeof createWind>;

// Owns the ambient wind wisps and motes (and the mower-clipping / seed bursts
// that spawn motes). Needs the camera for billboarding wisps and the player for
// clipping origins.
export function createWind(scene: Scene, camera: ArcRotateCamera, player: Mesh, getYaw: () => number) {
  const windWisps: WindWisp[] = [];
  const windMotes: WindMote[] = [];

  const createWindWispMesh = (name: string) => {
    const mesh = new Mesh(name, scene);
    const segments = 80;
    const positions = new Float32Array((segments + 1) * 2 * 3);
    const indices: number[] = [];

    for (let i = 0; i <= segments; i += 1) {
      if (i < segments) {
        const base = i * 2;
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
    wisp.x = wisp.segment.xMin + (Math.random() * Math.max(1, (wisp.segment.xMax - wisp.segment.xMin - wisp.length - 1)));
    wisp.z = wisp.segment.zMin + (Math.random() * (wisp.segment.zMax - wisp.segment.zMin));
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

    for (let i = 0; i <= segments; i += 1) {
      const local = i / segments;
      const u = trimStart + ((growEnd - trimStart) * local);
      const localWidth = Math.sin(Math.PI * local) * baseWidth;
      const x = u * wisp.length;
      const firstCurve = Math.sin(Math.PI * Math.min(1, u * 0.92)) * wisp.bend * curveAmount;
      const hookT = Math.max(0, (u - 0.58) / 0.42);
      const hook = Math.sin(Math.PI * hookT * 0.9) * wisp.hook * hookAmount;
      const tangentZ = (Math.cos(Math.PI * Math.min(1, u * 0.92)) * Math.PI * 0.92 * wisp.bend * curveAmount)
        + (hookT > 0 ? Math.cos(Math.PI * hookT * 0.9) * Math.PI * 0.9 * wisp.hook * hookAmount / 0.42 : 0);
      const tangent = new Vector3(1, 0, tangentZ).normalize();
      const centerX = wisp.x + x;
      const centerY = wisp.y + (Math.sin(Math.PI * u) * 0.04 * curveAmount);
      const centerZ = wisp.z + firstCurve + hook;
      const lift = Math.sin(Math.PI * u) * 0.04 * curveAmount;
      const cameraDirection = camera.position.subtract(new Vector3(centerX, centerY, centerZ)).normalize();
      const widthDirection = Vector3.Cross(tangent, cameraDirection).normalize();
      const offset = i * 6;

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
    for (let i = 0; i < 4; i += 1) {
      const material = new StandardMaterial(`windWispMaterial-${i}`, scene);
      material.diffuseColor = new Color3(1, 1, 1);
      material.emissiveColor = new Color3(0.9, 1, 0.92);
      material.alpha = 0.4;
      material.backFaceCulling = false;
      material.disableLighting = true;

      const { mesh, positions } = createWindWispMesh(`windWisp-${i}`);
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
      wisp.age = i === 0 ? wisp.duration * 0.12 : -(2 + (i * 2.7) + (Math.random() * 1.3));
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
    mote.segment = { ...yardSegments[0], xMin: -34, xMax: 39, zMin: -24, zMax: 30, width: 73, height: 54, center: Vector3.Zero() };
    mote.age = -(Math.random() * 18);
    mote.duration = 48 + (Math.random() * 18);
    mote.x = -34 + (Math.random() * 3);
    mote.z = -24 + (Math.random() * 54);
    mote.y = 0.45 + (Math.random() * 1.2);
    mote.speed = 1.25 + (Math.random() * 0.35);
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
    for (let i = 0; i < 1; i += 1) {
      const mote = createWindMote(Math.random() < 0.18 ? new Color3(1, 0.92, 0.34) : undefined);
      resetWindMote(mote);
      windMotes.push(mote);
    }
  };

  const updateWindMotes = (deltaSeconds: number) => {
    for (const mote of windMotes) {
      mote.age += deltaSeconds;

      const currentX = mote.x + (Math.max(0, mote.age) * mote.speed);
      if (mote.age > mote.duration || currentX > 42) {
        resetWindMote(mote);
      }

      if (mote.age < 0) {
        mote.material.alpha = 0;
        continue;
      }

      const t = mote.age / mote.duration;
      const fade = Math.sin(Math.PI * t);
      const x = mote.x + (mote.age * mote.speed);
      const y = mote.y + (Math.sin((t * Math.PI * 2) + mote.drift) * 0.08);
      const z = mote.z + (Math.sin(t * Math.PI) * mote.drift);

      mote.mesh.position.set(x, y, z);
      mote.mesh.scaling.set(mote.size, mote.size, mote.size);
      mote.material.alpha = fade * 0.28;
    }
  };

  createWindWisps();
  createWindMotes();

  return {
    update(deltaSeconds: number) {
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

      for (let i = 0; i < count; i += 1) {
        const color = includeYellow && i < 5
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
        mote.speed = 0.25 + (Math.random() * 0.45);
        mote.drift = (sideSign * 0.75) + ((Math.random() - 0.5) * 0.35);
        mote.size = 0.014 + (Math.random() * 0.03);
        windMotes.push(mote);
      }
    },

    burstDandelionSeeds(x: number, z: number, y: number) {
      for (let i = 0; i < 32; i += 1) {
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
        mote.speed = 0.7 + (Math.random() * 1.1);
        mote.drift = (Math.random() - 0.5) * 0.9;
        mote.size = 0.018 + (Math.random() * 0.025);
        windMotes.push(mote);
      }
    },
  };
}
