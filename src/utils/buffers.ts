import { Color3, Matrix } from "@babylonjs/core";

export function writeMatrix(buffer: Float32Array, index: number, matrix: Matrix) {
  matrix.copyToArray(buffer, index * 16);
}

export function writeColor(buffer: Float32Array, index: number, color: number[] | Color3) {
  if (color instanceof Color3) {
    buffer.set([color.r, color.g, color.b, 1], index * 4);
    return;
  }

  buffer.set(color, index * 4);
}

export function emptyMatrix() {
  return Matrix.Zero();
}
