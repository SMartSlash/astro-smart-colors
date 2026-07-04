import { fitToSrgb } from "./color-math.mjs";

const OKLCH_DECLARATION_PATTERN = /--([a-z0-9-]+)\s*:\s*(oklch\([^;]*\))\s*;/gi;
const OKLCH_VALUE_PATTERN = /^oklch\(\s*([^\s()/]+)\s+([^\s()/]+)\s+([^\s()/]+)(?:\s*\/\s*[^\s()]+)?\s*\)$/i;

export function parsePalette(css) {
  return parsePaletteWithDiagnostics(css).tokens;
}

export function parsePaletteWithDiagnostics(css) {
  const tokens = {};
  const errors = [];
  let match;

  while ((match = OKLCH_DECLARATION_PATTERN.exec(css))) {
    const [, name, value] = match;
    const parsed = parseOklch(value);

    if (parsed.errors.length) {
      errors.push(`--${name}: ${parsed.errors.join(" ")}`);
      continue;
    }

    tokens[name] = parsed.color;
  }

  return { tokens, errors };
}

export function parseOklch(value) {
  const match = OKLCH_VALUE_PATTERN.exec(String(value).trim());

  if (!match) {
    return {
      color: null,
      errors: ["Expected a simple OKLCH value like oklch(0.62 0.14 160)."],
    };
  }

  const [, lightness, chroma, hue] = match;
  const parsed = parseOklchChannels({ lightness, chroma, hue });

  return {
    color: parsed.errors.length ? null : fitToSrgb(parsed.color),
    errors: parsed.errors,
  };
}

export function tokenKey(customProperty) {
  return customProperty.replace(/^--/, "");
}

function parseOklchChannels({ lightness, chroma, hue }) {
  const errors = [];
  const l = parseChannel(lightness, "lightness", errors);
  const c = parseChannel(chroma, "chroma", errors);
  const h = parseChannel(hue, "hue", errors);

  if (Number.isFinite(l) && (l < 0 || l > 1)) {
    errors.push(`Lightness ${lightness} must resolve to a value between 0 and 1.`);
  }

  if (Number.isFinite(c) && c < 0) {
    errors.push(`Chroma ${chroma} must be greater than or equal to 0.`);
  }

  return {
    color: { l, c, h },
    errors,
  };
}

function parseChannel(value, channel, errors) {
  const clean = value.trim().toLowerCase();
  let parsed;

  if (clean.endsWith("deg")) {
    parsed = Number.parseFloat(clean);
  } else if (clean.endsWith("%")) {
    const numeric = Number.parseFloat(clean) / 100;
    parsed = channel === "hue" ? numeric * 360 : numeric;
  } else {
    parsed = Number.parseFloat(clean);
  }

  if (!Number.isFinite(parsed)) {
    errors.push(`${channel} "${value}" must be a finite number.`);
  }

  return parsed;
}
