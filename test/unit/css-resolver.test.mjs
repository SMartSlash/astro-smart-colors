/**
 * Tests for the shared CSS custom-property resolver used by the generator tests.
 *
 * The resolver is an oracle: it reads emitted declarations the way a browser does. These tests
 * pin the parts of CSS that the oracle claims to model, plus the boundaries it must not cross.
 * Every expected value below is derived from CSS Color 4 §13.5 (shorter hue arc) by hand; the
 * production mix is never imported or used to compute an expectation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getDeclarations, mixOklch, resolveThemeColor } from "../helpers/css-resolver.mjs";

const color = (l, c, h) => ({ l, c, h });

test("the oracle interpolates hue along the shorter arc across 0/360", () => {
  // Arithmetic interpolation would return 180 here; CSS returns 0.
  assert.equal(mixOklch(color(0.5, 0.1, 350), color(0.5, 0.1, 10), 0.5).h, 0);
  // 350 -> 370 through the wrap, weighted by the first operand.
  assert.equal(mixOklch(color(0.5, 0.1, 350), color(0.5, 0.1, 10), 0.75).h, 355);
  assert.equal(mixOklch(color(0.5, 0.1, 350), color(0.5, 0.1, 10), 0.25).h, 5);
});

test("the shorter arc is symmetric when the operand order is reversed", () => {
  // 10 -> 350 is 340 degrees forward, so the first hue moves up by a full turn.
  assert.equal(mixOklch(color(0.5, 0.1, 10), color(0.5, 0.1, 350), 0.5).h, 0);
  assert.equal(mixOklch(color(0.5, 0.1, 10), color(0.5, 0.1, 350), 0.75).h, 5);
  assert.equal(mixOklch(color(0.5, 0.1, 10), color(0.5, 0.1, 350), 0.25).h, 355);
});

test("a hue gap of exactly 180 degrees keeps the operand order", () => {
  // CSS adjusts only when the difference is greater than 180 in either direction,
  // so both arcs tie and the direction follows first -> second.
  assert.equal(mixOklch(color(0.5, 0.1, 0), color(0.5, 0.1, 180), 0.5).h, 90);
  assert.equal(mixOklch(color(0.5, 0.1, 0), color(0.5, 0.1, 180), 0.75).h, 45);
  assert.equal(mixOklch(color(0.5, 0.1, 180), color(0.5, 0.1, 0), 0.75).h, 135);
  assert.equal(mixOklch(color(0.5, 0.1, 180), color(0.5, 0.1, 0), 0.25).h, 45);
});

test("identical hues do not move, including hues above a full turn", () => {
  assert.equal(mixOklch(color(0.5, 0.1, 200), color(0.5, 0.1, 200), 0.5).h, 200);
  assert.equal(mixOklch(color(0.5, 0.1, 20), color(0.5, 0.1, 380), 0.5).h, 20);
});

test("all three channels of the same color survive any weight", () => {
  const source = color(0.62, 0.16, 32);
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    assert.deepEqual(mixOklch(source, source, ratio), source);
  }
});

test("a missing hue borrows the other operand's hue", () => {
  // An achromatic first operand must not drag the hue toward 0.
  assert.equal(mixOklch(color(0.5, 0, null), color(0.5, 0.1, 120), 0.5).h, 120);
  assert.equal(mixOklch(color(0.5, 0, null), color(0.5, 0.1, 120), 0.75).h, 120);
  assert.equal(mixOklch(color(0.5, 0.1, 200), color(0.5, 0, null), 0.5).h, 200);
  assert.equal(mixOklch(color(0.5, 0.1, 200), color(0.5, 0, null), 0.25).h, 200);
});

test("two missing hues mix to zero, and a borrowed hue is used by both operands", () => {
  assert.equal(mixOklch(color(0.5, 0, null), color(0.2, 0, null), 0.5).h, 0);
  // A carried-forward hue is shared, so it cannot be dragged toward 0 or split by an arc.
  assert.equal(mixOklch(color(0.5, 0, null), color(0.5, 0.1, 10), 0.5).h, 10);
  assert.equal(mixOklch(color(0.5, 0, null), color(0.5, 0.1, 350), 0.75).h, 350);
});

test("an authored zero hue is not the same as a missing hue", () => {
  // `none` carries the other hue; an explicit 0 participates in the interpolation.
  assert.equal(mixOklch(color(0.5, 0, 0), color(0.5, 0.1, 120), 0.5).h, 60);
  assert.equal(mixOklch(color(0.5, 0, null), color(0.5, 0.1, 120), 0.5).h, 120);
  // Same inputs, so the difference is only in the hue channel.
  assert.equal(mixOklch(color(0.5, 0, 0), color(0.5, 0.1, 120), 0.5).l, 0.5);
});

test("lightness and chroma stay linear while hue takes the arc", () => {
  assert.deepEqual(
    mixOklch(color(0.5, 0.125, 350), color(0.75, 0.25, 10), 0.25),
    { l: 0.6875, c: 0.21875, h: 5 },
  );
});

test("extreme weights return the endpoints exactly", () => {
  const first = color(0.62, 0.16, 350);
  const second = color(0.4, 0.08, 10);
  assert.deepEqual(mixOklch(first, second, 1), first);
  assert.deepEqual(mixOklch(first, second, 0), second);
});

test("a weight outside [0, 1] is rejected instead of clamped", () => {
  const first = color(0.62, 0.16, 350);
  const second = color(0.4, 0.08, 10);
  for (const ratio of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => mixOklch(first, second, ratio), /ratio in \[0, 1\]/);
  }
});

test("the resolver applies the same arc to a declared color-mix", () => {
  const declarations = getDeclarations(`
    --a: oklch(0.5 0.1 350);
    --b: oklch(0.5 0.1 10);
    --plain: color-mix(in oklch, var(--a) 50%, var(--b));
    --knob: 75%;
    --knobbed: color-mix(in oklch, var(--a) var(--knob, 25%), var(--b));
  `);
  assert.equal(resolveThemeColor(declarations, "--plain", "light").h, 0);
  assert.equal(resolveThemeColor(declarations, "--knobbed", "light").h, 355);
});

// Scope guards: the oracle models the declarations the generator emits and nothing more.
// Unsupported CSS must fail loudly instead of silently producing a plausible number.
test("the oracle rejects color spaces outside oklch", () => {
  const declarations = getDeclarations(`
    --a: oklch(0.5 0.1 350);
    --b: oklch(0.5 0.1 10);
    --mix: color-mix(in srgb, var(--a) 50%, var(--b));
  `);
  assert.throws(() => resolveThemeColor(declarations, "--mix", "light"), /in oklch/);
});

test("the oracle rejects hue-interpolation methods it does not model", () => {
  const declarations = getDeclarations(`
    --a: oklch(0.5 0.1 350);
    --b: oklch(0.5 0.1 10);
    --mix: color-mix(in oklch longer hue, var(--a) 50%, var(--b));
  `);
  assert.throws(() => resolveThemeColor(declarations, "--mix", "light"), /in oklch/);
});

test("the oracle rejects weight expressions it does not model", () => {
  const declarations = getDeclarations(`
    --a: oklch(0.5 0.1 350);
    --b: oklch(0.5 0.1 10);
    --mix: color-mix(in oklch, var(--a) calc(50%), var(--b));
  `);
  assert.throws(() => resolveThemeColor(declarations, "--mix", "light"), /weighted mix/);
});

test("the oracle rejects a color-mix percentage above 100% instead of clamping it", () => {
  // CSS defines the weight as <percentage [0,100]>: 101% is invalid, not a 100% mix.
  const declarations = getDeclarations(`
    --a: oklch(0.5 0.1 350);
    --b: oklch(0.5 0.1 10);
    --mix: color-mix(in oklch, var(--a) 101%, var(--b));
  `);
  assert.throws(() => resolveThemeColor(declarations, "--mix", "light"), /ratio in \[0, 1\]/);
});

test("the oracle rejects color functions it does not model", () => {
  const declarations = getDeclarations(`
    --accent: rgb(255 0 0);
  `);
  assert.throws(() => resolveThemeColor(declarations, "--accent", "light"), /resolvable OKLCH/);
});
