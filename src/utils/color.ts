import { Color3 } from "@babylonjs/core";

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function hexToColor3(hex: string) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16) / 255;
  const green = Number.parseInt(value.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
  return new Color3(red, green, blue);
}

export function mixColor(a: Color3, b: Color3, amount: number) {
  return new Color3(
    a.r + ((b.r - a.r) * amount),
    a.g + ((b.g - a.g) * amount),
    a.b + ((b.b - a.b) * amount),
  );
}

export function color3ToHsl(color: Color3) {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l: lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  if (max === color.r) {
    hue = ((color.g - color.b) / delta) + (color.g < color.b ? 6 : 0);
  } else if (max === color.g) {
    hue = ((color.b - color.r) / delta) + 2;
  } else {
    hue = ((color.r - color.g) / delta) + 4;
  }

  return { h: hue / 6, s: saturation, l: lightness };
}

export function hslToColor3(hue: number, saturation: number, lightness: number) {
  const h = ((hue % 1) + 1) % 1;
  const s = clamp01(saturation);
  const l = clamp01(lightness);

  if (s === 0) {
    return new Color3(l, l, l);
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - (l * s);
  const p = (2 * l) - q;
  const toRgb = (t: number) => {
    const wrapped = ((t % 1) + 1) % 1;

    if (wrapped < 1 / 6) return p + ((q - p) * 6 * wrapped);
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + ((q - p) * ((2 / 3) - wrapped) * 6);
    return p;
  };

  return new Color3(toRgb(h + (1 / 3)), toRgb(h), toRgb(h - (1 / 3)));
}
