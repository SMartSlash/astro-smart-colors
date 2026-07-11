import assert from "node:assert/strict";
import test from "node:test";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { parseOklch, parsePalette } from "../src/parse-palette.mjs";
import { validateSmartColorsInput } from "../src/validate-config.mjs";

const DEFAULT_PALETTE = parsePalette(`:root {
  --palette-bg: oklch(0.962 0.015 88);
  --palette-ink: oklch(0.28 0.007 3.68);
  --palette-primary: oklch(0.62 0.16 32);
  --palette-secondary: oklch(0.54 0.108 198);
  --palette-tertiary: oklch(0.88 0.12 85);
}`);

function validate(config) {
  return validateSmartColorsInput({ config, palette: DEFAULT_PALETTE });
}

test("OKLCH parser supports CSS percentages and angle units with correct semantics", () => {
  const parsed = parseOklch("oklch(62% 5% 0.5turn)");

  assert.deepEqual(parsed.errors, []);
  assert.ok(parsed.color);
  assert.ok(Math.abs(parsed.color.l - 0.62) < 0.0001);
  assert.ok(Math.abs(parsed.color.c - 0.02) < 0.0001);
  assert.ok(Math.abs(parsed.color.h - 180) < 0.0001);

  const grad = parseOklch("oklch(0.62 0.02 200grad)");
  assert.deepEqual(grad.errors, []);
  assert.ok(Math.abs(grad.color.h - 180) < 0.0001);
});

test("OKLCH parser rejects partial numbers, unsupported hue units and alpha", () => {
  assert.ok(parseOklch("oklch(0.5foo 0.1 120)").errors.length > 0);
  assert.ok(parseOklch("oklch(0.5 0.1 50%)").errors.length > 0);
  assert.ok(parseOklch("oklch(0.5 0.1 120 / 50%)").errors.some((error) => error.includes("Alpha")));
});

test("validator rejects public token collisions", () => {
  const config = structuredClone(defaultSmartColorsConfig);
  config.roles.decoratives.primary = { token: "--palette-primary", role: "decorative" };
  config.aliases.bg = "primary";

  const report = validate(config);

  assert.ok(report.errors.some((error) => error.includes("--color-primary")));
  assert.ok(report.errors.some((error) => error.includes("--color-bg")));
});

test("validator rejects invalid contrast targets and dark mode", () => {
  const config = structuredClone(defaultSmartColorsConfig);
  config.contrast.text = 22;
  config.contrast.ui = 8;
  config.contrast.maxIdentity = 7;
  config.derivation.dark.mode = "automatic";

  const report = validate(config);

  assert.ok(report.errors.some((error) => error.includes("contrast.text must be between 1 and 21")));
  assert.ok(report.errors.some((error) => error.includes("both contrast.text and contrast.ui")));
  assert.ok(report.errors.some((error) => error.includes("derivation.dark.mode")));
});

test("validator rejects an invalid or colliding motion output", () => {
  const config = structuredClone(defaultSmartColorsConfig);
  config.motion.enabled = true;
  config.motion.output = config.output;

  const report = validate(config);

  assert.ok(report.errors.some((error) => error.includes("motion.output must be different")));
});

test("validator rejects scale steps that cannot form stable CSS token names", () => {
  const config = structuredClone(defaultSmartColorsConfig);
  config.scales.enabled = true;
  config.scales.steps = [50, 50, 100.5, 500];
  config.scales.base = 400;
  config.scales.applyTo = ["primary"];

  const report = validate(config);

  assert.ok(report.errors.some((error) => error.includes("scales.steps[2] must be an integer")));
  assert.ok(report.errors.some((error) => error.includes("must not contain duplicate")));
  assert.ok(report.errors.some((error) => error.includes("scales.base must be included")));
});
