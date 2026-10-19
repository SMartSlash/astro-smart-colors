import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createContrastAdvice, nearestLightness, suggestLightness } from "../src/contrast-advice.mjs";
import { contrast, fitToSrgb, oklch, serializedColor } from "../src/color-math.mjs";
import { createVerificationCore } from "../src/verification-core.mjs";

const RESULT_KEYS = ["authored", "color", "deltaL", "gamutAdjusted", "reason", "status", "value"];
const core = createVerificationCore();

test("nearestLightness searches the editable 0..1 grid nearest to the authored lightness", () => {
  const source = { l: 0.5, c: 0.1, h: 30 };
  // Any candidate is accepted: the authored lightness itself is the nearest grid point.
  const keep = nearestLightness(source, () => true);
  assert.deepEqual(keep, { l: 0.5, c: 0.1, h: 30 });
  assert.notEqual(keep, source, "the result is a fresh candidate, never the input object");
  assert.deepEqual(source, { l: 0.5, c: 0.1, h: 30 }, "the input is never mutated");

  // The search widens symmetrically in 0.0001 steps.
  assert.equal(nearestLightness(source, (candidate) => candidate.l > 0.5).l, 0.5001);
  assert.equal(nearestLightness(source, (candidate) => candidate.l < 0.5).l, 0.4999);

  // Stable tie: an exact midpoint prefers the lower lightness.
  assert.equal(nearestLightness({ l: 0.50005, c: 0, h: 0 }, (candidate) => candidate.l === 0.5 || candidate.l === 0.5001).l, 0.5);

  // No grid point can satisfy the predicate: null, never a fabricated answer.
  assert.equal(nearestLightness(source, () => false), null);
});

test("createContrastAdvice is self-contained and re-runs identically in a bare realm", () => {
  const source = `(${createContrastAdvice.toString()})`;
  assert.doesNotMatch(source, /\brequire\s*\(/, "no CommonJS reference may leak into the serialized factory");
  assert.doesNotMatch(source, /\bimport\b/, "no module loader reference may leak into the serialized factory");
  assert.doesNotMatch(source, /\.\.\//, "no relative module path may leak into the serialized factory");
  assert.doesNotMatch(source, /node:/, "no Node built-in may leak into the serialized factory");

  const factory = vm.runInContext(source, vm.createContext({}));
  const isolated = factory(core);
  assert.deepEqual(Object.keys(isolated).sort(), ["nearestLightness", "suggestLightness"]);

  const input = {
    color: { l: 0.5, c: 0.12, h: 250 },
    constraints: [{ other: { l: 0.97, c: 0.005, h: 250 }, minimum: 4.5 }],
  };
  // Cross-realm objects keep a different prototype, so compare the serialized fields.
  assert.equal(JSON.stringify(isolated.suggestLightness(input)), JSON.stringify(suggestLightness(input)));
  assert.equal(isolated.nearestLightness.length, 2);
});

test("the factory nearestLightness matches the module export exactly", () => {
  const { nearestLightness: factoryNearest } = createContrastAdvice(core);
  const source = { l: 0.3771, c: 0.1, h: 200 };
  for (const accepts of [() => true, (candidate) => candidate.l >= 0.6, () => false]) {
    const expected = nearestLightness(source, accepts);
    const actual = factoryNearest(source, accepts);
    assert.deepEqual(actual, expected);
  }
});

test("suggestLightness rejects invalid input honestly", () => {
  const empty = { status: "invalid", color: null, value: null, authored: null, deltaL: null, gamutAdjusted: false, reason: null };
  const valid = { color: { l: 0.5, c: 0.1, h: 30 }, constraints: [{ other: { l: 0.9, c: 0, h: 0 }, minimum: 4.5 }] };
  for (const input of [
    undefined,
    {},
    { ...valid, constraints: [] },
    { ...valid, constraints: null },
    { ...valid, color: { l: Number.NaN, c: 0.1, h: 30 } },
    { ...valid, color: { l: 0.5, c: 0.1 } },
    { ...valid, constraints: [{ other: { l: 0.9, c: 0, h: 0 }, minimum: 0.5 }] },
    { ...valid, constraints: [{ other: { l: 0.9, c: Number.POSITIVE_INFINITY, h: 0 }, minimum: 4.5 }] },
    { ...valid, margin: -1 },
    { ...valid, margin: Number.NaN },
  ]) {
    const result = suggestLightness(input);
    assert.equal(result.status, "invalid");
    assert.equal(typeof result.reason, "string");
    assert.deepEqual({ ...result, reason: null }, empty);
  }
});

test("suggestLightness returns the nearest authored lightness that clears every constraint", () => {
  const color = { l: 0.5, c: 0.12, h: 250 };
  const other = { l: 0.97, c: 0.005, h: 250 };
  const result = suggestLightness({ color, constraints: [{ other, minimum: 4.5 }] });

  assert.equal(result.status, "candidate");
  assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
  assert.equal(result.reason, null);

  // The found lightness is exactly the nearest grid point that clears the threshold after
  // serialization — the same ordering nearestLightness uses, with chroma and hue preserved.
  const accepts = (candidate) => contrast(serializedColor(fitToSrgb(candidate)), other) >= 4.5;
  const expected = nearestLightness(color, accepts);
  assert.ok(expected);
  assert.deepEqual(result.color, serializedColor(fitToSrgb({ l: expected.l, c: color.c, h: color.h })));
  assert.ok(contrast(result.color, other) >= 4.5, "post-serialize recheck: the emitted bytes clear the threshold");
  assert.equal(result.value, oklch(result.color));

  // authored echoes the source; deltaL is the applied lightness shift.
  assert.deepEqual(result.authored, color);
  assert.equal(result.deltaL, Number((result.color.l - color.l).toFixed(4)));
  assert.equal(result.deltaL, Number((expected.l - color.l).toFixed(4)));
});

test("suggestLightness keeps an already-satisfying authored lightness (deltaL 0)", () => {
  const color = { l: 0.5, c: 0.02, h: 250 };
  const result = suggestLightness({ color, constraints: [{ other: { l: 0.05, c: 0, h: 0 }, minimum: 1 }] });
  assert.equal(result.status, "candidate");
  assert.equal(result.deltaL, 0);
  assert.deepEqual(result.color, serializedColor(fitToSrgb(color)));
});

test("suggestLightness flags a gamut adjustment when the authored chroma is out of sRGB", () => {
  const saturated = suggestLightness({
    color: { l: 0.6, c: 0.4, h: 140 },
    constraints: [{ other: { l: 0.05, c: 0, h: 0 }, minimum: 1 }],
  });
  assert.equal(saturated.status, "candidate");
  assert.equal(saturated.gamutAdjusted, true);
  assert.ok(saturated.color.c < 0.4, "the emitted chroma is fitted into sRGB");

  const inGamut = suggestLightness({
    color: { l: 0.5, c: 0.02, h: 250 },
    constraints: [{ other: { l: 0.95, c: 0, h: 0 }, minimum: 1 }],
  });
  assert.equal(inGamut.gamutAdjusted, false);
});

test("suggestLightness clamps the margin-derived target to the 21:1 ceiling", () => {
  const color = { l: 0.5, c: 0, h: 0 };
  const black = { l: 0, c: 0, h: 0 };
  const gray = { l: 0.5, c: 0, h: 0 };

  // A large margin cannot raise the target past 21: the clamped search equals an explicit 21.
  const clamped = suggestLightness({ color, constraints: [{ other: black, minimum: 4.5 }], margin: 1000 });
  const explicit = suggestLightness({ color, constraints: [{ other: black, minimum: 21 }] });
  assert.equal(JSON.stringify(clamped), JSON.stringify(explicit));

  // The margin is not ignored: a larger target turns a reachable search into none.
  assert.equal(suggestLightness({ color, constraints: [{ other: gray, minimum: 4.5 }] }).status, "candidate");
  const strict = suggestLightness({ color, constraints: [{ other: gray, minimum: 21 }] });
  assert.equal(strict.status, "none");
  assert.equal(strict.color, null);
  assert.equal(strict.value, null);
  assert.equal(strict.authored.l, color.l);
  assert.match(strict.reason, /0\.\.1 grid/, "the reason states the bounded grid search");
  assert.match(strict.reason, /not a global perceptual match/, "the reason states the search limit");

  // A minimum already above 21 is valid input but unreachable, so the status is none, not invalid.
  assert.equal(suggestLightness({ color, constraints: [{ other: black, minimum: 30 }] }).status, "none");
});

test("suggestLightness is deterministic, JSON-only and never mutates its input", () => {
  const input = {
    color: { l: 0.42, c: 0.14, h: 32 },
    constraints: [{ other: { l: 0.96, c: 0.01, h: 88 }, minimum: 4.6 }],
    margin: 0.2,
  };
  const snapshot = JSON.stringify(input);
  const first = suggestLightness(input);
  const second = suggestLightness(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(first))), JSON.stringify(first), "the result is JSON-stable");
  assert.equal(JSON.stringify(input), snapshot, "the input object is untouched");
});
