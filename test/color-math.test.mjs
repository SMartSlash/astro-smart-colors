import assert from "node:assert/strict";
import test from "node:test";
import { clamp, contrast, fitToSrgb, mixOklch, oklch, serializedColor } from "../src/color-math.mjs";
import { createVerificationCore } from "../src/verification-core.mjs";

function close(actual, expected) {
  for (const channel of ["l", "c", "h"]) {
    assert.ok(Math.abs(actual[channel] - expected[channel]) < 1e-10, `${channel}: ${actual[channel]} vs ${expected[channel]}`);
  }
}

test("gamut fitting keeps authored hues bit-exact for in-gamut colors and normalizes only out-of-range input", () => {
  for (const h of [0, 3.68, 32.41, 86.83, 89.1642, 198, 260, 259.999999, 359.999999]) {
    const color = { l: 0.5, c: 0.02, h };
    const fitted = fitToSrgb(color);
    assert.equal(fitted.h, h, `hue drifted for ${h}`);
    assert.deepEqual(fitted, color);
    assert.equal(Object.is(fitted.h, -0), false, "negative zero must not leak into serialized hues");
  }
  assert.equal(fitToSrgb({ l: 0.5, c: 0.02, h: 392 }).h, 32);
  assert.equal(fitToSrgb({ l: 0.5, c: 0.02, h: -12 }).h, 348);
  assert.equal(fitToSrgb({ l: 0.5, c: 0.02, h: -0 }).h, 0);
  assert.equal(fitToSrgb({ l: 0.5, c: 0.02, h: 720 }).h, 0);
  const resolved = fitToSrgb({ l: 0.9496, c: 0.0127, h: 86.83 });
  assert.equal(serializedColor(resolved).h, 86.83, "resolved palette hues must match the authored value");
});

test("neutral missing hue preserves the chromatic source, while explicit zero participates", () => {
  const source = { l: 0.54, c: 0.0918, h: 198 };
  close(mixOklch(source, { l: 1, c: 0, h: null }, 0.7592), { l: 0.650768, c: 0.06969456, h: 198 });
  close(mixOklch(source, { l: 1, c: 0, h: 0 }, 0.7592), { l: 0.650768, c: 0.06969456, h: 237.0096 });
  close(mixOklch({ l: 0.5456, c: 0.1625, h: 32.41 }, { l: 1, c: 0, h: null }, 0.776), { l: 0.6473856, c: 0.1261, h: 32.41 });
});

test("chromatic mixes follow the shorter arc, including wrap and exact 180-degree ties", () => {
  for (const [firstHue, secondHue, expectedHue] of [
    [350, 10, 5],
    [10, 350, 355],
    [-10, 370, 5],
    [30, 210, 165],
    [210, 30, 75],
  ]) {
    close(mixOklch({ l: 0.6, c: 0.1, h: firstHue }, { l: 0.8, c: 0.05, h: secondHue }, 0.25), { l: 0.75, c: 0.0625, h: expectedHue });
  }
});

test("missing hue is borrowed in either direction and two missing hues resolve to zero", () => {
  close(mixOklch({ l: 0.2, c: 0, h: null }, { l: 0.8, c: 0.1, h: 210 }, 0.25), { l: 0.65, c: 0.075, h: 210 });
  close(mixOklch({ l: 0.2, c: 0, h: null }, { l: 0.8, c: 0, h: null }, 0.25), { l: 0.65, c: 0, h: 0 });
});

test("native intermediate mixes are not gamut-mapped or rounded", () => {
  close(mixOklch({ l: 0.8, c: 0.4, h: 32.41 }, { l: 0.99, c: 0, h: null }, 0.5), { l: 0.895, c: 0.2, h: 32.41 });
});

test("serializedColor uses the exact emitted precision without a second gamut mapping", () => {
  const original = { l: 0.985249, c: 0.200049, h: 32.410049 };
  const emitted = serializedColor(original);
  assert.deepEqual(emitted, { l: 0.9852, c: 0.2, h: 32.41 });
  assert.equal(oklch(emitted), oklch(original));
  assert.deepEqual(serializedColor(emitted), emitted);
  assert.equal(original.l, 0.985249);
});

test("color-math re-exports the shared numeric contract with no second implementation", () => {
  const core = createVerificationCore();
  const grid = [
    { l: 0.5, c: 0.02, h: 392 },
    { l: 0.8, c: 0.4, h: 32.41 },
    { l: 0.34, c: 0.3, h: 140 },
    { l: 0.5, c: 0.02, h: -12 },
    { l: 0.9496, c: 0.0127, h: 86.83 },
    { l: 0.1, c: 0.02, h: 260 },
  ];
  for (const color of grid) {
    assert.deepEqual(core.fitToSrgb(color), fitToSrgb(color));
    assert.deepEqual(core.serializedColor(color), serializedColor(color));
    assert.equal(core.oklch(color), oklch(color));
  }
  for (const first of grid) {
    for (const second of grid) {
      assert.equal(core.contrast(first, second), contrast(first, second));
    }
  }
  for (const ratio of [0, 0.25, 0.7592, 1]) {
    close(core.mixOklch(grid[0], grid[1], ratio), mixOklch(grid[0], grid[1], ratio));
  }
  assert.equal(core.clamp(-1, 0, 1), clamp(-1, 0, 1));
});
