import assert from "node:assert/strict";

// Shared CSS custom-property resolver for the generator/formatter tests.
//
// It reads the *emitted* declarations the way a browser resolves them, so a test
// can assert value semantics and precedence instead of pinning a CSS shape:
//   * `light-dark(a, b)` picks the branch for the requested scheme;
//   * `var(--name)` and `var(--name, fallback)` follow the declaration or fallback;
//   * `color-mix(in oklch, A <w>, B)` reads the weight from `var(--k, N%)`, a
//     declared percentage knob `var(--k)` or a bare `N%`, and mixes the channels
//     with the CSS defaults: linear lightness and chroma, hue along the shorter
//     arc, and a missing hue carrying the other operand.
// No epsilon, fit or rounding is applied: the resolved value is the raw mix, so
// thresholds stay exact and comparisons remain meaningful.
//
// This is an oracle for the emitted subset, not a CSS engine. Anything outside
// `light-dark()`, `var()`, `color-mix(in oklch, …)` and the relative forms below
// must fail instead of approximating a result.

const OKLCH_LITERAL = /^oklch\(\s*([^\s()/]+)\s+([^\s()/]+)\s+([^\s()/]+)(?:\s*\/\s*[^\s()]+)?\s*\)$/i;
const NUMBER = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;
const DECLARATION = /(?:^|\n)\s*(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi;

export function getDeclarations(css) {
  // Documentation comments are blanked while preserving newlines and offsets.
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const declarations = new Map();
  for (const match of uncommented.matchAll(DECLARATION)) declarations.set(match[1], match[2].trim());
  return declarations;
}

export function resolveThemeColor(declarations, tokenName, scheme, stack = []) {
  assert.ok(!stack.includes(tokenName), `Circular custom-property reference: ${[...stack, tokenName].join(" -> ")}`);
  const value = declarations.get(tokenName);
  assert.ok(value, `Expected generated token ${tokenName}.`);
  return resolveColorExpression(declarations, value, scheme, [...stack, tokenName]);
}

export function resolveColorExpression(declarations, expression, scheme, stack) {
  const value = expression.trim();

  const lightDark = unwrapFunction(value, "light-dark");
  if (lightDark != null) {
    const choices = splitTopLevel(lightDark);
    assert.equal(choices.length, 2, `Expected two light-dark() colors in ${value}.`);
    return resolveColorExpression(declarations, choices[scheme === "light" ? 0 : 1], scheme, stack);
  }

  const variable = unwrapFunction(value, "var");
  if (variable != null) {
    const [reference, fallback] = splitTopLevel(variable);
    if (declarations.has(reference)) return resolveThemeColor(declarations, reference, scheme, stack);
    assert.ok(fallback, `Expected ${reference} or a fallback in ${value}.`);
    return resolveColorExpression(declarations, fallback, scheme, stack);
  }

  const mix = unwrapFunction(value, "color-mix");
  if (mix != null) {
    const [space, weighted, second] = splitTopLevel(mix);
    assert.equal(space, "in oklch", `Expected an in oklch color-mix in ${value}.`);
    const match = /^(.*?)\s+(?:var\((--[a-z0-9_-]+)(?:,\s*(\d+(?:\.\d+)?)%)?\)|(\d+(?:\.\d+)?)%)$/.exec(weighted);
    assert.ok(match, `Expected a weighted mix in ${value}.`);
    const firstColor = resolveColorExpression(declarations, match[1], scheme, stack);
    const secondColor = resolveColorExpression(declarations, second, scheme, stack);
    const weight = match[2] != null
      ? (declarations.has(match[2]) ? declarations.get(match[2]) : match[3])
      : match[4];
    return mixOklch(firstColor, secondColor, percentRatio(weight, match[1]));
  }

  const relative = unwrapRelativeOklch(value);
  if (relative != null) return resolveRelativeOklch(declarations, relative, scheme, stack);

  return parseOklchLiteral(value);
}

// `oklch(from <color> <L> <C> <H> [/ <alpha>])`. Only the forms the generator
// emits are evaluated: channel references (`l`/`c`/`h`) and
// `clamp(0, calc(l +/- var(--knob)), 1)`.
function unwrapRelativeOklch(value) {
  if (!/^oklch\(\s*from\s+/i.test(value) || !value.endsWith(")")) return null;
  const body = value.slice(value.indexOf("(") + 1, -1).trim();
  return splitWhitespaceTopLevel(body);
}

function resolveRelativeOklch(declarations, tokens, scheme, stack) {
  assert.equal(tokens[0].toLowerCase(), "from", "expected a relative-color `from` origin");
  const base = resolveColorExpression(declarations, tokens[1], scheme, stack);
  const channels = tokens.slice(2).filter((token) => !token.startsWith("/"));
  return {
    l: evalLightnessChannel(channels[0], base, declarations),
    c: evalChannelReference(channels[1], base, "c"),
    h: evalChannelReference(channels[2], base, "h"),
  };
}

function evalChannelReference(token, base, name) {
  if (token == null || token.toLowerCase() === name) return base[name];
  if (token.toLowerCase() === "none") return null;
  return Number(token);
}

function evalLightnessChannel(token, base, declarations) {
  const clampBody = unwrapFunction(token, "clamp");
  if (clampBody == null) return evalChannelReference(token, base, "l");
  const [lower, middle, upper] = splitTopLevel(clampBody);
  const value = evalCalc(middle, base, declarations);
  return Math.min(Number(upper), Math.max(Number(lower), value));
}

function evalCalc(token, base, declarations) {
  const text = token.trim();
  if (text.toLowerCase() === "l") return base.l;
  const calcBody = unwrapFunction(text, "calc");
  assert.ok(calcBody != null, `Unsupported calc expression ${token}.`);
  const match = /^l\s*([+-])\s*var\((--[a-z0-9_-]+)\)$/.exec(calcBody);
  assert.ok(match, `Unsupported calc expression ${token}.`);
  const knob = declarations.get(match[2]);
  assert.ok(knob != null, `Expected a declared ${match[2]}.`);
  const value = Number(knob);
  assert.ok(Number.isFinite(value), `Expected a numeric ${match[2]}, received ${knob}.`);
  return match[1] === "+" ? base.l + value : base.l - value;
}

function splitWhitespaceTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (/\s/.test(character) && depth === 0) {
      if (start != null) {
        parts.push(value.slice(start, index));
        start = null;
      }
    } else if (start == null) {
      start = index;
    }
  }
  if (start != null) parts.push(value.slice(start));
  return parts;
}

function percentRatio(value, label) {
  assert.ok(value != null, `Expected a percentage weight for ${label}.`);
  const match = /^(\d+(?:\.\d+)?)%?$/.exec(String(value).trim());
  assert.ok(match, `Expected a percentage weight for ${label}, received "${value}".`);
  return Number.parseFloat(match[1]) / 100;
}

function parseOklchLiteral(value) {
  const match = OKLCH_LITERAL.exec(value);
  assert.ok(match, `Expected a resolvable OKLCH color, received ${value}.`);
  return {
    l: parseChannel(match[1], value),
    c: parseChannel(match[2], value),
    h: parseChannel(match[3], value),
  };
}

function parseChannel(raw, value) {
  const text = raw.trim().toLowerCase();
  if (text === "none") return null;
  const match = NUMBER.exec(text);
  assert.ok(match, `Unsupported channel "${raw}" in ${value}.`);
  return Number(match[1]);
}

// `oklch()` interpolation as a browser performs it (CSS Color 4 §13.5): lightness and
// chroma are linear, hue follows the shorter arc, and a missing hue is filled from the
// other operand before the arc is chosen. Because a `none` hue is carried forward, an
// achromatic color never introduces a fake angle; an authored hue of 0 does participate.
//
// The weight must be a finite fraction in [0, 1]. CSS types the color-mix weight as
// <percentage [0,100]>: a value outside that range is invalid CSS, not a clamped mix, so
// the oracle rejects it instead of turning a bad input into a plausible colour.
export function mixOklch(first, second, firstRatio) {
  assert.ok(
    Number.isFinite(firstRatio) && firstRatio >= 0 && firstRatio <= 1,
    `Expected a mix ratio in [0, 1], received ${String(firstRatio)}.`,
  );
  const ratio = firstRatio;
  const { firstHue, secondHue } = shorterArc(first.h ?? second.h ?? 0, second.h ?? first.h ?? 0);
  const channel = (a, b) => (a == null ? 0 : a) * ratio + (b == null ? 0 : b) * (1 - ratio);
  return {
    l: channel(first.l, second.l),
    c: channel(first.c, second.c),
    h: normalizeHue(firstHue * ratio + secondHue * (1 - ratio)),
  };
}

// The shorter-arc fix-up: normalise both angles, then move one of them by a full turn
// only when that is what keeps the sweep within 180 degrees. At exactly 180 degrees CSS
// leaves both angles untouched, so the direction follows the operand order (first to
// second); that tie is intentional and covered by the oracle tests.
function shorterArc(first, second) {
  const firstHue = normalizeHue(first);
  const secondHue = normalizeHue(second);
  if (secondHue - firstHue > 180) return { firstHue: firstHue + 360, secondHue };
  if (secondHue - firstHue < -180) return { firstHue, secondHue: secondHue + 360 };
  return { firstHue, secondHue };
}

function normalizeHue(hue) {
  const remainder = hue % 360;
  return remainder < 0 ? remainder + 360 : remainder;
}

export function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

export function unwrapFunction(value, functionName) {
  const prefix = `${functionName}(`;
  if (!value.startsWith(prefix) || !value.endsWith(")")) return null;
  return value.slice(prefix.length, -1).trim();
}
