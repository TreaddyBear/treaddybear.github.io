import type { DynamicTexture, Mesh, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import type { YardSegment } from "./config";

export type WindWisp = {
  mesh: Mesh;
  material: StandardMaterial;
  segment: YardSegment;
  positions: Float32Array;
  age: number;
  duration: number;
  length: number;
  x: number;
  z: number;
  y: number;
  bend: number;
  hook: number;
};

export type WindMote = {
  mesh: Mesh;
  material: StandardMaterial;
  segment: YardSegment;
  age: number;
  duration: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  drift: number;
  size: number;
};

export type Dandelion = {
  root: TransformNode;
  stem: Mesh;
  head: TransformNode;
  pieces: Mesh[];
  detachedPieces: Mesh[];
  x: number;
  z: number;
  kind: "yellow" | "seed";
  cut: boolean;
  popped: boolean;
  headVelocity: Vector3;
  headFalling: boolean;
  headSettled: boolean;
};

export type FloatingSeed = {
  mesh: Mesh;
  age: number;
  duration: number;
  velocity: Vector3;
  drift: number;
};

export type FallingPetal = {
  mesh: Mesh;
  age: number;
  duration: number;
  velocity: Vector3;
  settled: boolean;
};

export type Tulip = {
  root: TransformNode;
  head: Mesh;
  stem: Mesh;
  x: number;
  z: number;
  destroyed: boolean;
};

export type FenceDamageState = {
  segmentIndex: number;
  pieceIndex: number;
  x: number;
  z: number;
  axisX: number;
  axisZ: number;
  halfAlong: number;
  halfAcross: number;
  health: number;
  broken: boolean;
};

export type FenceHealthLabel = {
  mesh: Mesh;
  material: StandardMaterial;
  texture: DynamicTexture;
};

export type RockCollider = {
  x: number;
  z: number;
  radius: number;
};

export type GunTracer = {
  mesh: Mesh;
  material: StandardMaterial;
  age: number;
  duration: number;
};

export type GunParticle = {
  mesh: Mesh;
  material: StandardMaterial;
  velocity: Vector3;
  age: number;
  duration: number;
  spin: number;
};
