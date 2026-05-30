export function randomHash(x: number, z: number) {
  const value = Math.sin((x * 127.1) + (z * 311.7)) * 43758.5453123;
  return value - Math.floor(value);
}

export function smoothstep(value: number) {
  return value * value * (3 - (2 * value));
}

export function valueNoise(x: number, z: number) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothstep(x - x0);
  const tz = smoothstep(z - z0);
  const a = randomHash(x0, z0);
  const b = randomHash(x0 + 1, z0);
  const c = randomHash(x0, z0 + 1);
  const d = randomHash(x0 + 1, z0 + 1);
  const top = a + ((b - a) * tx);
  const bottom = c + ((d - c) * tx);
  return top + ((bottom - top) * tz);
}

export function grassNoiseAt(x: number, z: number) {
  const broad = valueNoise(x * 0.18, z * 0.18);
  const detail = valueNoise((x * 0.9) + 31, (z * 0.9) - 17);
  return Math.min(1, Math.max(0, (broad * 0.78) + (detail * 0.22)));
}
