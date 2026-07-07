import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { contrast } from "../src/color-math.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { parseOklch } from "../src/parse-palette.mjs";

const DEFAULT_PALETTE = `:root {
  --palette-bg: oklch(0.962 0.015 88);
  --palette-ink: oklch(0.28 0.007 3.68);
  --palette-primary: oklch(0.62 0.16 32);
  --palette-secondary: oklch(0.540 0.108 198);
  --palette-tertiary: oklch(0.880 0.120 85);
}`;

const CONTRAST_PALETTE = `:root {
  --palette-bg: oklch(0.962 0.015 88);
  --palette-ink: oklch(0.28 0.007 3.68);
  --palette-primary: oklch(0.62 0.16 32);
  --palette-secondary: oklch(0.540 0.108 198);
  --palette-tertiary: oklch(0.880 0.120 85);
  --palette-warning: oklch(0.68 0.17 65);
  --palette-high-contrast: oklch(0.22 0.05 32);
}`;

async function createProject(t, paletteCss = DEFAULT_PALETTE) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-"));
  const tokenDir = path.join(root, "src/styles/tokens");
  await mkdir(tokenDir, { recursive: true });
  await writeFile(path.join(tokenDir, "palette.css"), paletteCss, "utf8");
  await writeFile(path.join(tokenDir, "colors.css"), "", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function getLightnessSteps(css, name) {
  return [...css.matchAll(new RegExp(`--color-${name}-(\\d+): light-dark\\(oklch\\(([^\\s]+)`, "g"))]
    .map((match) => ({ step: Number(match[1]), lightness: Number(match[2]) }))
    .sort((a, b) => a.step - b.step);
}

function getOklchToken(css, tokenName) {
  const line = css.split("\n").find((candidate) => candidate.trim().startsWith(`${tokenName}: oklch(`));
  assert.ok(line, `Expected generated token ${tokenName}.`);

  const value = line.slice(line.indexOf("oklch(")).replace(/;$/, "");
  const parsed = parseOklch(value);
  assert.deepEqual(parsed.errors, []);
  return parsed.color;
}

function getDarkScaleColor(css, name, step) {
  const line = css.split("\n").find((candidate) => candidate.trim().startsWith(`--color-${name}-${step}: light-dark(`));
  assert.ok(line, `Expected generated scale token --color-${name}-${step}.`);

  const match = line.match(/,\s*(oklch\([^)]*\))\);$/);
  assert.ok(match, `Expected a dark OKLCH value in --color-${name}-${step}.`);

  const parsed = parseOklch(match[1]);
  assert.deepEqual(parsed.errors, []);
  return parsed.color;
}

function getDarkMixRatio(css, name) {
  const line = css.split("\n").find((candidate) => candidate.trim().startsWith(`--_color-${name}-dark-generated: color-mix(in oklch, var(--_color-${name}-source)`));
  assert.ok(line, `Expected generated dark mix for ${name}.`);

  const match = line.match(/source\) (\d+)%,/);
  assert.ok(match, `Expected a numeric mix ratio for ${name}.`);
  return Number(match[1]) / 100;
}

function assertColorClose(actual, expected, label) {
  assert.ok(Math.abs(actual.l - expected.l) <= 0.001, `${label} lightness ${actual.l} should be close to ${expected.l}.`);
  assert.ok(Math.abs(actual.c - expected.c) <= 0.001, `${label} chroma ${actual.c} should be close to ${expected.c}.`);
  assert.ok(Math.abs(actual.h - expected.h) <= 0.001, `${label} hue ${actual.h} should be close to ${expected.h}.`);
}

test("content role contrast corrections meet min and max targets", async (t) => {
  const root = await createProject(t, CONTRAST_PALETTE);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      roles: {
        identities: {
          warning: { token: "--palette-warning", role: "content" },
          high: { token: "--palette-high-contrast", role: "content" },
        },
      },
      derivation: {
        dark: { mode: "static" },
      },
    },
  });

  const bgLight = getOklchToken(report.css, "--_color-bg-light");
  const warningLight = getOklchToken(report.css, "--_color-warning-light");
  const highLight = getOklchToken(report.css, "--_color-high-light");

  const warningContrast = contrast(warningLight, bgLight);
  const highContrast = contrast(highLight, bgLight);

  assert.ok(warningContrast >= 4.595, `warning contrast ${warningContrast.toFixed(2)} should meet text target.`);
  assert.ok(highContrast >= 7.2, `high contrast ${highContrast.toFixed(2)} should stay near maxIdentity, not collapse to text minimum.`);
  assert.ok(highContrast <= 7.51, `high contrast ${highContrast.toFixed(2)} should respect maxIdentity.`);
});

test("relative dark identities mix from the palette source, not adjusted light output", async (t) => {
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
  assert.match(report.css, /--_color-primary-light: oklch\(0\.5547 0\.16 32\);/);
  assert.match(report.css, /--_color-primary-dark-generated: color-mix\(in oklch, var\(--_color-primary-source\) \d+%, oklch\(1 0 0\)\);/);
  assert.doesNotMatch(report.css, /--_color-primary-dark-generated: color-mix\(in oklch, var\(--_color-primary-light\)/);

  const source = getOklchToken(report.css, "--_color-primary-source");
  const mixRatio = getDarkMixRatio(report.css, "primary");
  const primaryScaleBaseDark = getDarkScaleColor(report.css, "primary", 500);

  assertColorClose(primaryScaleBaseDark, {
    l: source.l * mixRatio + 1 * (1 - mixRatio),
    c: source.c * mixRatio,
    h: source.h,
  }, "primary dark scale base");
});

test("generated scales expose designer-facing aliases and avoid clipped duplicate tints", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["tertiary"],
      },
    },
  });

  assert.match(report.css, /--color-tertiary-surface: var\(--color-tertiary-50\);/);
  assert.match(report.css, /--color-tertiary-border: var\(--color-tertiary-300\);/);
  assert.match(report.css, /--color-tertiary-solid: var\(--color-tertiary-500\);/);
  assert.match(report.css, /--color-tertiary-on-solid: var\(--color-on-tertiary\);/);
  assert.match(report.css, /--color-tertiary-text: var\(--color-tertiary-700\);/);

  const softTintSteps = getLightnessSteps(report.css, "tertiary").filter(({ step }) => step <= 400);
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

  assert.match(report.css, /@property --surface-color \{/);
  assert.match(report.css, /syntax: "<color>";/);
  assert.match(report.css, /@property --surface-contrast \{/);
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
