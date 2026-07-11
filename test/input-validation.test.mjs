import assert from "node:assert/strict";
import test from "node:test";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { parseOklch, parsePalette, parsePaletteWithDiagnostics } from "../src/parse-palette.mjs";
import { validateSmartColorsInput } from "../src/validate-config.mjs";

const DEFAULT_PALETTE_CSS = `@property --palette-canvas {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.962 0.015 88);
  role: canvas;
}

@property --palette-ink {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.28 0.007 3.68);
  role: ink;
}

@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
  role: ui;
}

@property --palette-secondary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.54 0.108 198);
  role: feedback;
}

@property --palette-tertiary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.88 0.12 85);
  role: decorative;
}`;

const DEFAULT_PALETTE = parsePalette(DEFAULT_PALETTE_CSS);

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

test("palette parser accepts only the designer-facing roles", () => {
  const report = parsePaletteWithDiagnostics(DEFAULT_PALETTE_CSS);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.annotatedRoles, {
    "palette-canvas": "canvas",
    "palette-ink": "ink",
    "palette-primary": "ui",
    "palette-secondary": "feedback",
    "palette-tertiary": "decorative",
  });
});

test("palette parser accepts dark-blend for ui and feedback roles", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
  role: ui;
  dark-blend: 0;
}
@property --palette-success {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.14 160);
  role: feedback;
  dark-blend: 100;
}`);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.annotatedDarkBlends, {
    "palette-primary": 0,
    "palette-success": 100,
  });
});

test("palette parser rejects invalid dark-blend values", () => {
  for (const value of ["-1", "101", "50%", "auto"]) {
    const report = parsePaletteWithDiagnostics(`@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
  role: ui;
  dark-blend: ${value};
}`);

    assert.ok(
      report.errors.some((error) => error.includes("dark-blend")),
      `Expected dark-blend ${value} to be rejected, received: ${report.errors.join(" ") || "no errors"}`,
    );
  }
});

test("palette parser rejects duplicate dark-blend descriptors", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
  role: ui;
  dark-blend: 25;
  dark-blend: 75;
}`);

  assert.ok(report.errors.some((error) => error.includes("at most once")));
});

test("palette parser limits dark-blend to functional identity roles", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-spark {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.72 0.18 280);
  role: decorative;
  dark-blend: 50;
}`);

  assert.ok(report.errors.some((error) => error.includes("only for roles ui and feedback")));
});

test("palette parser rejects legacy roles in @property blocks", () => {
  const legacyRoles = ["bg", "content", "action", "fill", "accent-text", "accent-ui", "soft-surface"];

  for (const role of legacyRoles) {
    const report = parsePaletteWithDiagnostics(`@property --palette-legacy {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
  role: ${role};
}`);

    assert.ok(
      report.errors.some((error) => /role/i.test(error)),
      `Expected legacy role "${role}" to be rejected, received: ${report.errors.join(" ") || "no errors"}`,
    );
  }
});

test("palette parser rejects @property blocks without an explicit role", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-unclassified {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
}`);

  assert.ok(report.errors.some((error) => /role/i.test(error)));
});

test("palette parser ignores commented-out @property blocks", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
  role: ui;
}
/*
@property --palette-retired {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.5 0.1 20);
  role: ui;
}
*/`);

  assert.ok(report.tokens["palette-primary"]);
  assert.equal(report.tokens["palette-retired"], undefined);
});

test("palette parser rejects duplicate canvas or ink foundations", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-canvas-a {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.96 0.01 88);
  role: canvas;
}
@property --palette-canvas-b {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.94 0.01 88);
  role: canvas;
}`);

  assert.ok(report.errors.some((error) => error.includes('Role "canvas" must identify exactly one')));
});

test("validator keeps decorative colors out of functional identity families", () => {
  const config = structuredClone(defaultSmartColorsConfig);
  config.roles.identities.spark = { token: "--palette-primary", role: "decorative" };

  const report = validate(config);

  assert.ok(report.errors.some((error) => error.includes('must be either "ui" or "feedback"')));
});

test("validator rejects public token collisions", () => {
  const config = structuredClone(defaultSmartColorsConfig);
  config.roles.identities.primary = { token: "--palette-primary", role: "ui" };
  config.roles.decoratives.primary = { token: "--palette-primary", role: "decorative" };
  config.aliases.bg = "primary";

  const report = validate(config);

  assert.ok(report.errors.some((error) => error.includes("--color-primary")));
  assert.ok(report.errors.some((error) => error.includes("--color-bg")));
});

test("validator rejects invalid contrast targets and dark mode", () => {
  const config = structuredClone(defaultSmartColorsConfig);
  config.contrast.text = 22;
  config.contrast.onColor = 0;
  config.contrast.ui = 8;
  config.contrast.maxIdentity = 7;
  config.derivation.dark.mode = "automatic";

  const report = validate(config);

  assert.ok(report.errors.some((error) => error.includes("contrast.text must be between 1 and 21")));
  assert.ok(report.errors.some((error) => error.includes("contrast.onColor must be between 1 and 21")));
  assert.ok(report.errors.some((error) => error.includes("contrast.text, contrast.onColor and contrast.ui")));
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
