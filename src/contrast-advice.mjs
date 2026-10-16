import { contrast, fitToSrgb, serializedColor } from "./color-math.mjs";

export function resolvedColor(color) {
  return serializedColor(fitToSrgb(color));
}

export function solidContrasts(foreground, family) {
  return {
    // Inputs are emitted literals or resolved native mixes, never map them again.
    solid: contrast(foreground, family.solid),
    hover: contrast(foreground, family.solidHover),
  };
}

export function meetsSolidTarget(foreground, family, target) {
  const ratios = solidContrasts(foreground, family);
  return ratios.solid >= target && ratios.hover >= target;
}

// Search the editable 4-decimal lightness grid, not the entire OKLCH space.
// Chroma and hue remain authored; every candidate is checked after CSS serialization.
export function nearestLightness(color, accepts) {
  const candidates = Array.from({ length: 10001 }, (_, index) => index / 10000)
    .sort((a, b) => Math.abs(a - color.l) - Math.abs(b - color.l) || a - b);
  for (const l of candidates) {
    const candidate = { ...color, l };
    if (accepts(candidate)) return candidate;
  }
  return null;
}

export function sourceColorValue(color) {
  return `oklch(${color.l} ${color.c} ${color.h})`;
}

export function contrastSummary(ratios) {
  return `solid ${ratios.solid.toFixed(2)}:1; hover ${ratios.hover.toFixed(2)}:1`;
}
