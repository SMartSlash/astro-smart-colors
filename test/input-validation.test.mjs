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

test("palette parser accepts dark-blend for every role", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-canvas {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.962 0.015 88);
  role: canvas;
  dark-blend: 20;
}
@property --palette-ink {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.28 0.007 3.68);
  role: ink;
  dark-blend: 40;
}
@property --palette-primary {
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
}
@property --palette-spark {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.72 0.18 280);
  role: decorative;
  dark-blend: 50;
}`);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.annotatedDarkBlends, {
    "palette-canvas": 20,
    "palette-ink": 40,
    "palette-primary": 0,
    "palette-success": 100,
    "palette-spark": 50,
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

test("palette parser accepts dark-blend for canvas, ink and decorative roles", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-spark {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.72 0.18 280);
  role: decorative;
  dark-blend: 50;
}`);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.annotatedDarkBlends, { "palette-spark": 50 });
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

function validPublicConfig() {
  const config = structuredClone(defaultSmartColorsConfig);
  config.roles.canvas = "--palette-canvas";
  config.roles.ink = "--palette-ink";
  config.roles.identities.primary = { token: "--palette-primary", role: "ui" };
  config.roles.focus = "primary";
  return config;
}

test("required palette references must resolve to own declarations, not inherited entries", () => {
  for (const token of ["--constructor", "--inherited"]) {
    for (const path of ["canvas", "ink", "identities.primary"]) {
      const config = validPublicConfig();
      const palette = Object.assign(Object.create({ inherited: DEFAULT_PALETTE["palette-primary"] }), DEFAULT_PALETTE);
      if (path === "identities.primary") config.roles.identities.primary.token = token;
      else config.roles[path] = token;

      const report = validateSmartColorsInput({ config, palette });
      assert.ok(report.errors.some((error) =>
        error.includes(`Missing required palette token ${token}`) && error.includes(`roles.${path}`)));
    }
  }
});

test("decorative palette references also distinguish own declarations from inherited entries", () => {
  const config = validPublicConfig();
  config.roles.decoratives.spark = { token: "--constructor", role: "decorative" };
  const report = validate(config);
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some((warning) =>
    warning.includes("Missing decorative palette tokens skipped: --constructor (roles.decoratives.spark)")));
});

test("own constructor palette declarations remain valid", () => {
  const config = validPublicConfig();
  config.roles.identities.primary.token = "--constructor";
  for (const palette of [
    { ...DEFAULT_PALETTE, constructor: DEFAULT_PALETTE["palette-primary"] },
    Object.assign(Object.create(null), DEFAULT_PALETTE, { constructor: DEFAULT_PALETTE["palette-primary"] }),
  ]) {
    assert.deepEqual(validateSmartColorsInput({ config, palette }).errors, []);
  }
});

test("decorative aliases do not acquire functional families from inherited identity names", () => {
  const config = validPublicConfig();
  config.roles.decoratives.constructor = { token: "--palette-tertiary", role: "decorative" };
  config.roles.decoratives["brand-solid"] = { token: "--palette-tertiary", role: "decorative" };
  config.aliases.brand = "constructor";
  assert.deepEqual(validate(config).errors, []);
});

test("validator rejects collisions with logo tokens actually emitted by the formatter", () => {
  for (const [sources, token, owners] of [
    [{ stroke: "oklch(.62 .02 32)" }, "stroke", ["logo.sources.stroke", "logo semantic API"]],
    [{ "bg-fill": "oklch(.62 .02 32)" }, "bg-fill", ["logo.sources.bg-fill", "logo semantic API"]],
    [{ accent: "oklch(.62 .02 32)", "accent-alpha": "oklch(.7 .02 32)" }, "accent-alpha", ["logo.sources.accent-alpha", "logo.sources.accent"]],
  ]) {
    const config = validPublicConfig();
    config.logo = { enabled: true, sources };
    assert.ok(validate(config).errors.some((error) =>
      error.includes(`--logo-${token} would be generated by both`) && owners.every((owner) => error.includes(owner))));
  }
});

test("logo validation allows non-colliding sources and disabled logo sources", () => {
  for (const logo of [
    { enabled: true, sources: {} },
    { enabled: true, sources: { accent: "oklch(.62 .02 32)" } },
    { enabled: true, sources: { "accent-alpha": "oklch(.62 .02 32)" } },
    { enabled: true, sources: { "stroke-detail": "oklch(.62 .02 32)", "bg-fill-detail": "oklch(.7 .02 32)" } },
    { enabled: false, sources: { stroke: "oklch(.62 .02 32)", "bg-fill": "oklch(.7 .02 32)", accent: "oklch(.6 .02 32)", "accent-alpha": "oklch(.7 .02 32)" } },
  ]) {
    const config = validPublicConfig();
    config.logo = logo;
    assert.deepEqual(validate(config).errors, []);
  }
});

test("validator reserves tune-* names for tuning tokens and identity dark escape hatches", () => {
  for (const name of ["tune-light-warmth", "tune-dark-bg-mix", "tune-primary-dark", "tune-secondary-dark", "tune-future-knob"]) {
    for (const owner of ["identities", "decoratives", "aliases"]) {
      const config = validPublicConfig();
      assert.deepEqual(validate(config).errors, []);
      if (owner === "aliases") {
        config.aliases[name] = "primary";
      } else {
        config.roles[owner][name] = {
          token: "--palette-primary",
          role: owner === "identities" ? "ui" : "decorative",
        };
      }
      const path = owner === "aliases" ? `aliases.${name}` : `roles.${owner}.${name}`;
      assert.ok(validate(config).errors.some((error) =>
        error.includes(`--color-${name}`) && error.includes(path) && error.includes('reserved "tune-"')));
    }
  }
});

test("reserved tuning prefix is checked for generated functional names too", () => {
  const config = validPublicConfig();
  config.roles.identities.tune = { token: "--palette-primary", role: "ui" };
  assert.ok(validate(config).errors.some((error) =>
    error.includes("--color-tune-solid") && error.includes('reserved "tune-"')));
});

test("validator permits non-reserved names containing tune away from the prefix", () => {
  const config = validPublicConfig();
  config.roles.identities["fine-tune"] = { token: "--palette-primary", role: "ui" };
  config.roles.decoratives.tuneful = { token: "--palette-tertiary", role: "decorative" };
  config.aliases["brand-tune"] = "primary";
  assert.deepEqual(validate(config).errors, []);
});

test("public registry retains collisions for generated on-color, functional, scale and hue names including aliases", () => {
  for (const name of ["primary-ink", "primary-solid", "primary-500", "primary-warm", "primary-hue-plus-30"]) {
    for (const owner of ["identities", "decoratives", "aliases"]) {
      const config = validPublicConfig();
      config.scales.enabled = true;
      config.scales.applyTo = ["primary"];
      config.scales.hueVariants = {
        enabled: true,
        applyTo: ["primary"],
        shifts: name.includes("hue-") ? [30, -30, 60] : [30, -30],
      };
      assert.deepEqual(validate(config).errors, []);
      if (owner === "aliases") {
        config.aliases[name] = "primary";
      } else {
        config.roles[owner][name] = {
          token: "--palette-primary",
          role: owner === "identities" ? "ui" : "decorative",
        };
      }
      assert.ok(validate(config).errors.some((error) =>
        error.includes(`--color-${name} would be generated by both`)));
    }
  }
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
