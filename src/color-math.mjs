export function fitToSrgb(color) {
  const normalized = {
    l: clamp(color.l, 0, 1),
    c: Math.max(0, color.c),
    h: normalizeHue(color.h),
  };

  if (isInSrgbGamut(normalized)) return normalized;

  let low = 0;
  let high = normalized.c;

  for (let i = 0; i < 32; i += 1) {
    const mid = (low + high) / 2;
    const candidate = { ...normalized, c: mid };

    if (isInSrgbGamut(candidate)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return { ...normalized, c: low };
}

export function contrast(a, b) {
  const aLum = relativeLuminance(a);
  const bLum = relativeLuminance(b);
  const light = Math.max(aLum, bLum);
  const dark = Math.min(aLum, bLum);
  return (light + 0.05) / (dark + 0.05);
}

export function oklch(color) {
  return `oklch(${formatNumber(color.l)} ${formatNumber(color.c)} ${formatNumber(color.h)})`;
}

export function serializedColor(color) {
  return Object.fromEntries(["l", "c", "h"].map((channel) => [channel, Number(formatNumber(color[channel]))]));
}

// Opaque CSS interpolation in OKLCH with the default shorter-hue path.
// Missing hue is explicit (null); an authored achromatic hue still participates.
// Gamut mapping belongs to materialized colors, not intermediate CSS mixes.
export function mixOklch(first, second, firstRatio) {
  const ratio = clamp(firstRatio, 0, 1);
  let firstHue = first.h ?? second.h ?? 0;
  let secondHue = second.h ?? first.h ?? 0;
  firstHue = normalizeHue(firstHue);
  secondHue = normalizeHue(secondHue);
  if (secondHue - firstHue > 180) firstHue += 360;
  else if (secondHue - firstHue < -180) secondHue += 360;

  return {
    l: first.l * ratio + second.l * (1 - ratio),
    c: first.c * ratio + second.c * (1 - ratio),
    h: normalizeHue(firstHue * ratio + secondHue * (1 - ratio)),
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isInSrgbGamut(color) {
  const [r, g, b] = oklchToLinearSrgbRaw(color);
  return r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
}

function relativeLuminance(color) {
  const [r, g, b] = oklchToLinearSrgb(color);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function oklchToLinearSrgb(color) {
  return oklchToLinearSrgbRaw(color).map((channel) => clamp(channel, 0, 1));
}

function oklchToLinearSrgbRaw({ l, c, h }) {
  const hue = (h * Math.PI) / 180;
  const a = c * Math.cos(hue);
  const b = c * Math.sin(hue);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;

  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

// Adding 360 to an already positive hue moves the value into a higher binary
// exponent and loses low mantissa bits (86.83 became 86.82999999999998).
// Keep the identity exact for in-range hues; only negative remainders shift.
function normalizeHue(hue) {
  const remainder = hue % 360;
  if (remainder < 0) return remainder + 360;
  return remainder === 0 ? 0 : remainder;
}

function formatNumber(value) {
  return Number(value.toFixed(4)).toString();
}
