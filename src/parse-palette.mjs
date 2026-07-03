import { fitToSrgb } from "./color-math.mjs";

export function parsePalette(css) {
  const tokens = {};
  const tokenPattern = /--([a-z0-9-]+)\s*:\s*oklch\(\s*([^\s()]+)\s+([^\s()]+)\s+([^\s()]+)\s*\)\s*;/gi;
  let match;

  while ((match = tokenPattern.exec(css))) {
    const [, name, lightness, chroma, hue] = match;
    tokens[name] = fitToSrgb({
      l: parseChannel(lightness, "lightness"),
      c: parseChannel(chroma, "chroma"),
      h: parseChannel(hue, "hue"),
    });
  }

  return tokens;
}

export function tokenKey(customProperty) {
  return customProperty.replace(/^--/, "");
}

function parseChannel(value, channel) {
  const clean = value.trim().toLowerCase();

  if (clean.endsWith("deg")) {
    return Number.parseFloat(clean);
  }

  if (clean.endsWith("%")) {
    const numeric = Number.parseFloat(clean) / 100;
    return channel === "hue" ? numeric * 360 : numeric;
  }

  return Number.parseFloat(clean);
}
