import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { contrast, fitToSrgb } from "../src/color-math.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { parseOklch } from "../src/parse-palette.mjs";

const DEFAULT_PALETTE = `@property --palette-canvas {
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

const SEMANTIC_SUFFIXES = [
  "surface",
  "surface-strong",
  "border",
  "border-strong",
  "solid",
  "solid-hover",
  "on-solid",
  "text",
  "text-strong",
];

async function createProject(t, paletteCss = DEFAULT_PALETTE) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-"));
  const tokenDir = path.join(root, "src/styles/tokens");
  await mkdir(tokenDir, { recursive: true });
  await writeFile(path.join(tokenDir, "palette.css"), paletteCss, "utf8");
  await writeFile(path.join(tokenDir, "colors.css"), "", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function getDeclarations(css) {
  const declarations = new Map();
  const pattern = /(?:^|\n)\s*(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi;

  for (const match of css.matchAll(pattern)) {
    declarations.set(match[1], match[2].trim());
  }

  return declarations;
}

function getDeclaration(css, tokenName) {
  const value = getDeclarations(css).get(tokenName);
  assert.ok(value, `Expected generated token ${tokenName}.`);
  return value;
}

function splitTopLevel(value) {
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

function unwrapFunction(value, functionName) {
  const prefix = `${functionName}(`;
  if (!value.startsWith(prefix) || !value.endsWith(")")) return null;
  return value.slice(prefix.length, -1).trim();
}

function resolveThemeColor(declarations, tokenName, scheme, stack = []) {
  assert.ok(!stack.includes(tokenName), `Circular custom-property reference: ${[...stack, tokenName].join(" -> ")}`);
  const value = declarations.get(tokenName);
  assert.ok(value, `Expected generated token ${tokenName}.`);
  return resolveColorExpression(declarations, value, scheme, [...stack, tokenName]);
}

function resolveColorExpression(declarations, expression, scheme, stack) {
  const value = expression.trim();
  const lightDarkBody = unwrapFunction(value, "light-dark");

  if (lightDarkBody != null) {
    const choices = splitTopLevel(lightDarkBody);
    assert.equal(choices.length, 2, `Expected two light-dark() colors in ${value}.`);
    return resolveColorExpression(declarations, choices[scheme === "light" ? 0 : 1], scheme, stack);
  }

  const varBody = unwrapFunction(value, "var");
  if (varBody != null) {
    const [reference, fallback] = splitTopLevel(varBody);
    if (declarations.has(reference)) return resolveThemeColor(declarations, reference, scheme, stack);
    assert.ok(fallback, `Expected ${reference} or a fallback in ${value}.`);
    return resolveColorExpression(declarations, fallback, scheme, stack);
  }

  const parsed = parseOklch(value);
  assert.deepEqual(parsed.errors, [], `Expected a resolvable OKLCH color, received ${value}.`);
  return parsed.color;
}

function getLightnessSteps(css, name) {
  return [...css.matchAll(new RegExp(`--color-${name}-(\\d+): light-dark\\(oklch\\(([^\\s]+)`, "g"))]
    .map((match) => ({ step: Number(match[1]), lightness: Number(match[2]) }))
    .sort((a, b) => a.step - b.step);
}

function getOklchToken(css, tokenName) {
  const value = getDeclaration(css, tokenName);
  const parsed = parseOklch(value);
  assert.deepEqual(parsed.errors, []);
  return parsed.color;
}

function getDarkScaleColor(css, name, step) {
  const value = getDeclaration(css, `--color-${name}-${step}`);
  const lightDarkBody = unwrapFunction(value, "light-dark");
  assert.ok(lightDarkBody, `Expected light-dark() in --color-${name}-${step}.`);
  const choices = splitTopLevel(lightDarkBody);
  const parsed = parseOklch(choices[1]);
  assert.deepEqual(parsed.errors, []);
  return parsed.color;
}



function assertColorClose(actual, expected, label) {
  assert.ok(Math.abs(actual.l - expected.l) <= 0.001, `${label} lightness ${actual.l} should be close to ${expected.l}.`);
  assert.ok(Math.abs(actual.c - expected.c) <= 0.001, `${label} chroma ${actual.c} should be close to ${expected.c}.`);
  assert.ok(Math.abs(actual.h - expected.h) <= 0.001, `${label} hue ${actual.h} should be close to ${expected.h}.`);
}

function mixOklch(first, second, firstRatio) {
  return fitToSrgb({
    l: first.l * firstRatio + second.l * (1 - firstRatio),
    c: first.c * firstRatio + second.c * (1 - firstRatio),
    h: first.h,
  });
}

function getPercentageDeclaration(css, tokenName) {
  const value = getDeclaration(css, tokenName);
  assert.match(value, /^\d+(?:\.\d+)?%$/);
  return Number.parseFloat(value) / 100;
}

function assertMinContrast(foreground, background, target, label) {
  const ratio = contrast(foreground, background);
  assert.ok(
    ratio >= target - 0.005,
    `${label} contrast ${ratio.toFixed(3)} should be at least ${target.toFixed(1)} (tolerance 0.005).`,
  );
}

test("designer-facing roles map to canvas, ui, feedback and decorative output", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({ root });
  const declarations = getDeclarations(report.css);

  assert.equal(report.config.roles.canvas, "--palette-canvas");
  assert.equal(Object.hasOwn(report.config.roles, "bg"), false);
  assert.equal(report.config.roles.identities.primary.role, "ui");
  assert.equal(report.config.roles.identities.secondary.role, "feedback");
  assert.equal(report.config.roles.decoratives.tertiary.role, "decorative");

  for (const name of ["primary", "secondary"]) {
    for (const suffix of SEMANTIC_SUFFIXES) {
      assert.ok(declarations.has(`--color-${name}-${suffix}`), `Expected --color-${name}-${suffix} without numeric scales.`);
    }
  }

  assert.doesNotMatch(report.css, /--color-(?:primary|secondary)-\d+:/);
  assert.match(getDeclaration(report.css, "--color-tertiary"), /^light-dark\(/);
  assert.match(getDeclaration(report.css, "--color-on-tertiary"), /^light-dark\(/);

  for (const scheme of ["light", "dark"]) {
    assert.ok(declarations.has(`--_color-tertiary-${scheme}`));
    assert.ok(declarations.has(`--_color-on-tertiary-${scheme}`));
  }
});

test("numeric scales are optional and never source semantic role families", async (t) => {
  const root = await createProject(t);
  const withoutScales = await generateColorTokens({ root });
  const withScales = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary", "secondary"],
      },
    },
  });

  assert.match(withScales.css, /--color-primary-500: light-dark\(/);
  assert.match(withScales.css, /--color-secondary-500: light-dark\(/);

  for (const name of ["primary", "secondary"]) {
    for (const suffix of SEMANTIC_SUFFIXES) {
      const tokenName = `--color-${name}-${suffix}`;
      const withoutScaleValue = getDeclaration(withoutScales.css, tokenName);
      const withScaleValue = getDeclaration(withScales.css, tokenName);

      assert.equal(withScaleValue, withoutScaleValue, `${tokenName} must not change when numeric scales are enabled.`);
      assert.doesNotMatch(withScaleValue, new RegExp(`var\\(--color-${name}-\\d+\\)`));
    }
  }
});

test("semantic role families meet essential light and dark contrast contracts", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      derivation: {
        dark: { mode: "static" },
      },
    },
  });
  const declarations = getDeclarations(report.css);

  for (const scheme of ["light", "dark"]) {
    const neutralBackgrounds = [
      ["bg", resolveThemeColor(declarations, "--color-bg", scheme)],
      ["surface", resolveThemeColor(declarations, "--color-surface", scheme)],
    ];

    for (const name of ["primary", "secondary"]) {
      const familyBackgrounds = [
        ...neutralBackgrounds,
        ["family surface", resolveThemeColor(declarations, `--color-${name}-surface`, scheme)],
        ["family surface-strong", resolveThemeColor(declarations, `--color-${name}-surface-strong`, scheme)],
      ];

      for (const textToken of ["text", "text-strong"]) {
        const text = resolveThemeColor(declarations, `--color-${name}-${textToken}`, scheme);
        for (const [backgroundName, background] of familyBackgrounds) {
          assertMinContrast(text, background, 4.6, `${scheme} ${name}-${textToken} vs ${backgroundName}`);
        }
      }

      for (const foregroundToken of ["border", "border-strong", "solid", "solid-hover"]) {
        const foreground = resolveThemeColor(declarations, `--color-${name}-${foregroundToken}`, scheme);
        for (const [backgroundName, background] of neutralBackgrounds) {
          assertMinContrast(foreground, background, 3, `${scheme} ${name}-${foregroundToken} vs ${backgroundName}`);
        }
      }

      const onSolid = resolveThemeColor(declarations, `--color-${name}-on-solid`, scheme);
      for (const solidToken of ["solid", "solid-hover"]) {
        const solid = resolveThemeColor(declarations, `--color-${name}-${solidToken}`, scheme);
        assertMinContrast(onSolid, solid, 4.6, `${scheme} ${name}-on-solid vs ${solidToken}`);
      }
    }

    const decorative = resolveThemeColor(declarations, "--color-tertiary", scheme);
    const onDecorative = resolveThemeColor(declarations, "--color-on-tertiary", scheme);
    assertMinContrast(onDecorative, decorative, 4.6, `${scheme} on-tertiary vs tertiary`);
  }
});

test("relative dark tuning defaults preserve the validated muted-text contract", async (t) => {
  const palette = DEFAULT_PALETTE.replace("oklch(0.962 0.015 88)", "oklch(0.7 0 88)");
  const root = await createProject(t, palette);
  const report = await generateColorTokens({ root });
  const source = { l: 0.7, c: 0, h: 88 };
  const black = { l: 0, c: 0, h: 88 };
  const white = { l: 0.99, c: 0, h: 88 };
  const bgDark = mixOklch(source, black, 0.14);
  const surfaceDark = mixOklch(source, black, 0.18);
  const textDark = mixOklch(source, white, getPercentageDeclaration(report.css, "--color-tune-dark-text-depth"));
  const mutedDark = mixOklch(textDark, bgDark, getPercentageDeclaration(report.css, "--color-tune-dark-muted-depth"));
  const target = 4.6 * 1.15;

  assertMinContrast(mutedDark, bgDark, target, "relative dark muted text vs canvas");
  assertMinContrast(mutedDark, surfaceDark, target, "relative dark muted text vs surface");
});

test("every identity emits an explicit dark variant used by the numeric scale base", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary"],
      },
    },
  });

  assert.match(report.css, /--_color-primary-source: oklch\(0\.62 0\.16 32\);/);
  const generatedDark = getOklchToken(report.css, "--_color-primary-dark-generated");
  const primaryScaleBaseDark = getDarkScaleColor(report.css, "primary", 500);

  assertColorClose(primaryScaleBaseDark, generatedDark, "primary dark scale base");
});

test("generated numeric scales avoid clipped duplicate tints", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary"],
      },
    },
  });

  const softTintSteps = getLightnessSteps(report.css, "primary").filter(({ step }) => step <= 400);
  assert.equal(softTintSteps.length, 5);
  assert.equal(new Set(softTintSteps.map(({ lightness }) => lightness.toFixed(4))).size, 5);

  for (let index = 1; index < softTintSteps.length; index += 1) {
    assert.ok(
      softTintSteps[index - 1].lightness > softTintSteps[index].lightness,
      "light-mode tints should progress toward the identity color without repeated clipped values",
    );
  }
});

test("generated output exposes a global surface substrate", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({ root });

  assert.doesNotMatch(report.css, /@property/);
  assert.doesNotMatch(report.css, /transition-property:/);
  assert.match(report.css, /--color-tune-light-warmth: 100%;/);
  assert.match(report.css, /--color-tune-dark-bg-depth: 14%;/);
  assert.match(report.css, /--color-tune-elevation-1-shadow-alpha: 10%;/);
  assert.match(report.css, /--surface-color: var\(--color-bg\);/);
  assert.match(report.css, /--surface-contrast: contrast-color\(var\(--surface-color\)\);/);
  assert.match(report.css, /--surface-text: var\(--color-text\);/);
  assert.match(report.css, /--surface-text-muted: var\(--color-text-muted\);/);
  assert.match(report.css, /--surface-border: var\(--color-border-subtle\);/);
  assert.match(report.css, /--elevation-1:/);
  assert.match(report.css, /--elevation-2:/);
  assert.match(report.css, /--_color-primary-dark-generated:/);
  assert.match(report.css, /--_color-primary-dark: var\(--color-tune-primary-dark, var\(--_color-primary-dark-generated\)\);/);
  assert.match(report.css, /oklch\(from var\(--surface-color\)/);
});

test("paired hue variants use designer-facing warm/cool token names", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary"],
        hueVariants: {
          enabled: true,
          shifts: [30, -30],
          applyTo: ["primary"],
        },
      },
    },
  });

  assert.match(report.css, /--color-primary-warm:/);
  assert.match(report.css, /--color-primary-cool:/);
  assert.doesNotMatch(report.css, /--color-primary-hue-plus-30:/);
  assert.doesNotMatch(report.css, /--color-primary-hue-minus-30:/);
  assert.doesNotMatch(report.css, /--color-primary-h30:/);
  assert.doesNotMatch(report.css, /--color-primary-h-30:/);
});

test("check mode reports stale generated output", async (t) => {
  const root = await createProject(t);
  await generateColorTokens({ root });

  const cleanReport = await generateColorTokens({ root, check: true });
  assert.equal(cleanReport.changed, false);
  assert.deepEqual(cleanReport.errors, []);

  await writeFile(path.join(root, "src/styles/tokens/colors.css"), ":root {}\n", "utf8");
  const staleReport = await generateColorTokens({ root, check: true });

  assert.equal(staleReport.changed, true);
  assert.ok(staleReport.errors.some((error) => error.includes("out of date")));
});
