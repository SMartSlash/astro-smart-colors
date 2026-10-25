import assert from "node:assert/strict";
import test from "node:test";
import { contrast, fitToSrgb, mixOklch, oklch, serializedColor } from "../../src/colors/color-math.mjs";
import { bestOnSolid, chooseForeground } from "../../src/colors/foreground-solver.mjs";

const neutral = (l) => ({ l, c: 0, h: 0 });
const emitted = (color) => serializedColor(fitToSrgb(color));
const minimum = (color, backgrounds) => Math.min(...backgrounds.map((background) => contrast(color, background)));
const preferredColors = (ink) => [ink, neutral(0.02), neutral(0.99)].map(emitted);

// Independent exhaustive oracle: materialize every domain point, then sort the
// full grid by the documented policy instead of using the solver's lazy streams.
function oracle(backgrounds, ink, target) {
  const preferred = preferredColors(ink)
    .map((color) => ({ color, score: minimum(color, backgrounds) }))
    .sort((a, b) => b.score - a.score);
  if (preferred[0].score >= target) return { color: preferred[0].color, passing: 1 };

  const anchors = preferredColors(ink).map((color) => Math.round(color.l * 10000));
  const grid = [];
  for (let index = 0; index <= 10000; index += 1) {
    for (const [domain, channels] of [{ c: ink.c, h: ink.h }, { c: 0, h: 0 }].entries()) {
      const color = emitted({ l: index / 10000, ...channels });
      grid.push({
        color,
        score: minimum(color, backgrounds),
        distance: Math.min(...anchors.map((anchor) => Math.abs(index - anchor))),
        index,
        domain,
      });
    }
  }
  grid.sort((a, b) => a.distance - b.distance || a.index - b.index || a.domain - b.domain);
  const passing = grid.filter((candidate) => candidate.score >= target);
  if (passing.length > 0) return { color: passing[0].color, passing: passing.length };

  const best = [preferred[0], ...grid].reduce((winner, candidate) => candidate.score > winner.score ? candidate : winner);
  return { color: best.color, passing: 0 };
}

function assertEmitted(color) {
  assert.deepEqual(serializedColor(color), color);
  assert.match(oklch(color), /^oklch\([^)]*\)$/);
  assert.ok(color.l >= 0 && color.l <= 1);
}

test("chooseForeground maximizes the common minimum, not one background or candidate order", () => {
  const backgrounds = [neutral(0), neutral(1)];
  const candidates = [neutral(0), neutral(0.56), neutral(1)];
  const expected = emitted(candidates[1]);
  assert.deepEqual(chooseForeground(backgrounds, candidates, 4.5), expected);
  assert.deepEqual(chooseForeground(backgrounds, candidates, 7.52), expected);
  assert.ok(backgrounds.every((background) => contrast(expected, background) >= 4.5));
});

test("chooseForeground ranks after gamut mapping, never by the original candidate", () => {
  const background = neutral(0);
  const saturated = { l: 0.4, c: 0.2, h: 30 };
  const gray = neutral(0.4);
  assert.ok(contrast(saturated, background) > contrast(gray, background));
  assert.ok(contrast(emitted(saturated), background) < contrast(emitted(gray), background));
  assert.deepEqual(chooseForeground([background], [saturated, gray], 2.2), emitted(gray));
  assert.deepEqual(chooseForeground([background], [saturated, gray], 3), emitted(gray));
});

test("rounding ties retain candidate order instead of ranking unrounded lightness", () => {
  const first = { l: 0.400001, c: 0, h: 123 };
  const second = { l: 0.400049, c: 0, h: 234 };
  const background = neutral(0);
  assert.ok(contrast(second, background) > contrast(first, background));
  assert.equal(contrast(emitted(first), background), contrast(emitted(second), background));
  assert.deepEqual(chooseForeground([background], [first, second], 2), emitted(first));
  assert.deepEqual(chooseForeground([background], [second, first], 2), emitted(second));
});

test("the returned foreground is exactly fit+serialized, including C/H precision", () => {
  const candidate = { l: 0.545649, c: 0.362549, h: 392.410049 };
  const expected = emitted(candidate);
  const actual = chooseForeground([neutral(1)], [candidate], 4.52);
  assert.deepEqual(actual, expected);
  assert.notEqual(actual.c, candidate.c);
  assert.equal(actual.h, 32.41);
  assertEmitted(actual);
});

test("raw unmapped native mix backgrounds are neither fit nor serialized by either wrapper", () => {
  const background = mixOklch({ l: 0.4, c: 0.2, h: 200 }, { l: 0.99, c: 0, h: null }, 0.7592);
  Object.freeze(background);
  const before = { ...background };
  const dark = neutral(0);
  const light = neutral(1);
  assert.ok(contrast(dark, background) > contrast(light, background));
  assert.ok(contrast(dark, emitted(background)) < contrast(light, emitted(background)));
  assert.deepEqual(chooseForeground([background], [dark, light], 4.52), dark);
  assert.deepEqual(bestOnSolid([background], { l: 0.5, c: 0.1, h: 200 }, 4.52), neutral(0.02));
  assert.deepEqual(background, before);
});

test("native mix background precision is kept even when rounding would reverse the winner", () => {
  const background = mixOklch(neutral(0), { l: 1, c: 0, h: null }, 0.4362897951333347);
  const dark = neutral(0);
  const light = neutral(1);
  assert.ok(contrast(dark, background) > contrast(light, background));
  assert.ok(contrast(dark, serializedColor(background)) < contrast(light, serializedColor(background)));
  assert.deepEqual(chooseForeground([background], [dark, light], 4.52), dark);
});

test("preferred winners are preserved and successful fast paths never search the grid", () => {
  const ink = Object.freeze({ l: 0.12, c: 0.02, h: 270 });
  let evaluations = 0;
  const background = { get l() { evaluations += 1; return 0.95; }, c: 0, h: 0 };
  const expected = preferredColors(ink)
    .sort((a, b) => contrast(b, neutral(0.95)) - contrast(a, neutral(0.95)))[0];
  assert.deepEqual(bestOnSolid([background], ink, 4.52), expected);
  assert.equal(evaluations, 4);

  // Ink itself can be the legacy winner; it must not be replaced by a neutral.
  const darkInk = Object.freeze({ l: 0.01, c: 0.003, h: 270 });
  assert.deepEqual(bestOnSolid([neutral(0.95)], darkInk, 4.52), emitted(darkInk));
});

test("the caller's exact safety threshold controls passing, with no permissive epsilon", () => {
  const backgrounds = [neutral(0)];
  const ink = { l: 0.5, c: 0, h: 123 };
  const threshold = contrast(neutral(0.99), backgrounds[0]);
  assert.deepEqual(bestOnSolid(backgrounds, ink, threshold), neutral(0.99));
  const actual = bestOnSolid(backgrounds, ink, threshold + 1e-9);
  assert.deepEqual(actual, { l: 0.9901, c: 0, h: 123 });
  assert.ok(minimum(actual, backgrounds) >= threshold + 1e-9);
  assert.ok(minimum(neutral(1), backgrounds) > minimum(actual, backgrounds));
});

for (const [label, background, endpoint, neighbor] of [
  ["white", neutral(0), 1, 0.9999],
  ["black", neutral(1), 0, 0.0001],
]) {
  test(`${label}-only solution includes the exact endpoint and exits before a full grid scan`, () => {
    const ink = { l: 0.5, c: 0.14, h: 200 };
    const target = 21;
    assert.ok(preferredColors(ink).every((color) => contrast(color, background) < target));
    assert.ok(contrast(neutral(neighbor), background) < target);
    let evaluations = 0;
    const observed = { get l() { evaluations += 1; return background.l; }, c: background.c, h: background.h };
    const actual = bestOnSolid([observed], ink, target);
    assert.deepEqual(actual, { l: endpoint, c: 0, h: 200 });
    assert.equal(contrast(actual, background), target);
    assert.ok(evaluations < 3000, `${evaluations} evaluations should not exhaust the two-domain grid`);
    assert.deepEqual(actual, oracle([background], ink, target).color);
  });
}

test("a common interior candidate is verified against both backgrounds, not sequentially adjusted", () => {
  const backgrounds = Object.freeze([Object.freeze(neutral(0)), Object.freeze(neutral(1))]);
  const ink = Object.freeze({ l: 0.5, c: 0.14, h: 200 });
  const target = 4.52;
  assert.ok(preferredColors(ink).every((color) => minimum(color, backgrounds) < target));
  const expected = oracle(backgrounds, ink, target);
  assert.ok(expected.passing > 0);
  const actual = bestOnSolid(backgrounds, ink, target);
  assert.deepEqual(actual, expected.color);
  assert.ok(actual.l > 0 && actual.l < 1);
  assert.ok(actual.c > 0);
  assert.ok(backgrounds.every((background) => contrast(actual, background) >= target));
  assert.deepEqual(bestOnSolid([...backgrounds].reverse(), ink, target), actual);
  assertEmitted(actual);
});

test("fallback nearest-L policy matches the exhaustive oracle across both domains and raw mixes", () => {
  const cases = [
    { backgrounds: [neutral(0), neutral(1)], ink: { l: 0.5, c: 0, h: 123 }, target: 4.52 },
    { backgrounds: [neutral(0.555), neutral(0.56)], ink: { l: 0.5, c: 0.14, h: 200 }, target: 4.6 },
    { backgrounds: [neutral(0), neutral(1)], ink: { l: 0.500049, c: 0.4, h: 392.410049 }, target: 4.52 },
    {
      backgrounds: [
        mixOklch({ l: 0.4, c: 0.2, h: 200 }, { l: 0.99, c: 0, h: null }, 0.7592),
        mixOklch({ l: 0.4, c: 0.2, h: 200 }, { l: 0.99, c: 0, h: null }, 0.7),
      ],
      ink: { l: 0.5, c: 0.3, h: 32.41 },
      target: 5.2,
    },
  ];
  for (const { backgrounds, ink, target } of cases) {
    assert.ok(preferredColors(ink).every((color) => minimum(color, backgrounds) < target));
    const expected = oracle(backgrounds, ink, target);
    const actual = bestOnSolid(backgrounds, ink, target);
    assert.deepEqual(actual, expected.color, JSON.stringify({ backgrounds, ink, target }));
    assert.equal(minimum(actual, backgrounds) >= target, expected.passing > 0);
    assert.deepEqual(bestOnSolid(backgrounds, ink, target), actual);
    assertEmitted(actual);
  }
});

test("no common candidate in the searched domains returns max-min best effort, not a last-background fix", () => {
  const backgrounds = [neutral(0), neutral(1)];
  const ink = { l: 0.5, c: 0.14, h: 200 };
  const target = 7.52;
  const expected = oracle(backgrounds, ink, target);
  assert.equal(expected.passing, 0);
  const actual = bestOnSolid(backgrounds, ink, target);
  assert.deepEqual(actual, expected.color);
  assert.ok(minimum(actual, backgrounds) < target);
  assert.ok(minimum(actual, backgrounds) > Math.max(...preferredColors(ink).map((color) => minimum(color, backgrounds))));
  assert.deepEqual(bestOnSolid([...backgrounds].reverse(), ink, target), actual);
  assert.deepEqual(Object.keys(actual).sort(), ["c", "h", "l"]);
});

test("endpoint-dominated failures match the exhaustive oracle without scanning either grid", () => {
  const ink = Object.freeze({ l: 0.500049, c: 0.4, h: 392.410049 });
  const cases = [
    { backgrounds: [neutral(0.55), neutral(0.59)], target: 4.52 },
    { backgrounds: [neutral(0.5), neutral(0.54)], target: 7.52 },
    { backgrounds: [neutral(0.56)], target: 7.52 },
    { backgrounds: [neutral(0.62), neutral(0.55), neutral(0.59), neutral(0.55)], target: 7.52 },
    {
      backgrounds: [
        mixOklch({ l: 0.4, c: 0.2, h: 200 }, { l: 0.99, c: 0, h: null }, 0.7592),
        mixOklch({ l: 0.4, c: 0.2, h: 200 }, { l: 0.99, c: 0, h: null }, 0.7),
      ],
      target: 5.2,
    },
  ];
  for (const { backgrounds, target } of cases) {
    const expected = oracle(backgrounds, ink, target);
    assert.equal(expected.passing, 0);
    let evaluations = 0;
    const observed = backgrounds.map((background) => Object.freeze({
      get l() { evaluations += 1; return background.l; }, c: background.c, h: background.h,
    }));
    const actual = bestOnSolid(Object.freeze(observed), ink, target);
    assert.deepEqual(actual, expected.color);
    assert.ok(evaluations < backgrounds.length * 12, `${evaluations} evaluations should be bounded by background count`);
    assert.ok(actual.l === 0 || actual.l === 1);
    assert.equal(actual.c, 0);
    assert.equal(actual.h, 32.41, "Keep the original chromatic endpoint's serialized hue, not a neutral replacement.");
    assert.deepEqual(bestOnSolid([...backgrounds].reverse(), ink, target), actual);
    assertEmitted(actual);
  }
});

test("the guard uses every adjacent luminance gap, including unsorted and duplicate backgrounds", () => {
  // The outer gap alone has a bound of 2.5, equal to black's score. A middle
  // background splits it into two smaller gaps, proving strict endpoint dominance.
  const low = neutral(Math.cbrt(0.075));
  const middle = neutral(Math.cbrt(0.2625));
  const high = neutral(Math.cbrt(0.73125));
  const backgrounds = [high, middle, low, middle];
  const ink = { l: 0.5, c: 0.14, h: 200 };
  const target = 3;
  const expected = oracle(backgrounds, ink, target);
  assert.equal(expected.passing, 0);
  assert.ok(Math.abs(Math.sqrt(contrast(low, high)) - minimum(neutral(0), backgrounds)) < 1e-12);
  let evaluations = 0;
  const observed = backgrounds.map((background) => ({
    get l() { evaluations += 1; return background.l; }, c: background.c, h: background.h,
  }));
  assert.deepEqual(bestOnSolid(observed, ink, target), expected.color);
  assert.ok(evaluations < 48, `${evaluations} evaluations should not scan a grid`);
});

test("a bound equal to the endpoint score cannot prune the interior tie order", () => {
  const backgrounds = [neutral(Math.cbrt(0.075)), neutral(Math.cbrt(0.73125))];
  const ink = { l: 0.64, c: 0.14, h: 200 };
  const target = 3;
  const endpointScore = Math.max(minimum(neutral(0), backgrounds), minimum(neutral(1), backgrounds));
  assert.ok(Math.abs(Math.sqrt(contrast(...backgrounds)) - endpointScore) < 1e-12);
  const expected = oracle(backgrounds, ink, target);
  assert.equal(expected.passing, 0);
  let evaluations = 0;
  const observed = backgrounds.map((background) => ({
    get l() { evaluations += 1; return background.l; }, c: background.c, h: background.h,
  }));
  assert.deepEqual(bestOnSolid(observed, ink, target), expected.color);
  assert.ok(evaluations > 40000, "Equality must retain the exhaustive best-effort search.");
});

test("an endpoint meeting the exact target never bypasses nearest-L selection", () => {
  const backgrounds = [neutral(0.55), neutral(0.59)];
  const ink = { l: 0.5, c: 0.14, h: 200 };
  const target = minimum(neutral(0), backgrounds);
  assert.ok(preferredColors(ink).every((color) => minimum(color, backgrounds) < target));
  let evaluations = 0;
  const observed = backgrounds.map((background) => ({
    get l() { evaluations += 1; return background.l; }, c: background.c, h: background.h,
  }));
  const actual = bestOnSolid(observed, ink, target);
  assert.deepEqual(actual, oracle(backgrounds, ink, target).color);
  assert.equal(minimum(actual, backgrounds), target);
  assert.ok(evaluations > 1000, "Passing endpoints still use the original nearest-L search.");
});

test("empty domains are rejected and frozen inputs remain untouched", () => {
  assert.throws(() => chooseForeground([], [neutral(0)], 4.52), RangeError);
  assert.throws(() => chooseForeground([neutral(1)], [], 4.52), RangeError);
  assert.throws(() => bestOnSolid([], neutral(0.5), 4.52), RangeError);
  const candidates = Object.freeze([Object.freeze({ l: 0.400049, c: 0.2, h: 392.410049 }), Object.freeze(neutral(0.4))]);
  const backgrounds = Object.freeze([Object.freeze(neutral(0))]);
  const before = structuredClone({ candidates, backgrounds });
  chooseForeground(backgrounds, candidates, 4.52);
  assert.deepEqual({ candidates, backgrounds }, before);
});
