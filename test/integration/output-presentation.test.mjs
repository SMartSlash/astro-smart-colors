import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fitToSrgb, mixOklch, oklch } from "../../src/colors/color-math.mjs";
import { generateColorTokens } from "../../src/colors/generate-colors.mjs";
import { parseOklch } from "../../src/colors/parse-palette.mjs";
import { getDeclarations, resolveThemeColor } from "../helpers/css-resolver.mjs";

const OUTPUT_PATH = "src/styles/tokens/colors.css";
const EMPTY_OUTPUT = ":root {}\n";
const FOUNDATION = [
  ["canvas", "canvas", "0.962 0.015 88"],
  ["ink", "ink", "0.28 0.007 3.68"],
];
// Interleaved roles and deliberately non-alphabetical names expose accidental sorting.
const COLORS = [
  ["spark", "decorative", "0.88 0.12 85"],
  ["warning", "feedback", "0.62 0.08 75"],
  ["zeta", "ui", "0.62 0.08 32"],
  ["glow", "decorative", "0.70 0.06 290"],
  ["info", "feedback", "0.56 0.08 260"],
  ["alpha", "ui", "0.54 0.08 198"],
];
const FUNCTIONAL_SUFFIXES = [
  "surface",
  "surface-strong",
  "text",
  "text-strong",
  "solid",
  "solid-hover",
  "solid-text",
  "border",
  "border-strong",
];
const ALIASES = { action: "zeta", notice: "warning", ornament: "spark" };
const LOGO_SOURCES = { accent: "oklch(0.50 0.04 32)", wordmark: "oklch(0.40 0.02 198)" };
const OPTIONAL_CONFIG = {
  scales: {
    enabled: true,
    steps: [900, 500, 100],
    base: 500,
    applyTo: ["zeta"],
    hueVariants: { enabled: true, shifts: [30, -30], applyTo: ["zeta"] },
  },
  logo: { enabled: true, sources: LOGO_SOURCES },
};
const CORE_HEADINGS = [
  "Foundation",
  "Identity / brand (ui)",
  "Feedback",
  "Decorative",
  "Aliases",
  "Controls",
  "Advanced",
  "Surface contract",
  "Elevation",
];

function paletteCss(colors = COLORS) {
  return [...FOUNDATION, ...colors].map(([name, role, channels]) => `@property --palette-${name} {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(${channels});
  role: ${role};
}`).join("\n\n");
}

async function createProject(t, colors = COLORS) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-presentation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, "src/styles/tokens/palette.css"), paletteCss(colors), "utf8");
  await writeFile(path.join(root, OUTPUT_PATH), EMPTY_OUTPUT, "utf8");
  return root;
}

async function generate(root, inlineConfig = {}) {
  const report = await generateColorTokens({ root, check: true, suggest: false, inlineConfig });
  assert.deepEqual(report.suggestions, []);
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), EMPTY_OUTPUT,
    "Presentation checks must not write generated output.");
  // An intentionally empty output is stale in check mode; it is not a generation failure.
  assert.deepEqual(report.errors, [`Generated ${OUTPUT_PATH} is out of date. Run smart-colors build.`]);
  return report;
}

function declarations(css) {
  // Ignore documentation while preserving offsets used to locate declarations by section.
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  return [...uncommented.matchAll(/(?:^|\n)\s*(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi)]
    .map((match) => ({
      name: match[1],
      value: match[2].trim(),
      index: match.index + match[0].indexOf(match[1]),
    }));
}

function headings(css) {
  return [...css.matchAll(/\/\*\s*─+\s+([^\n─]+?)\s+─+/g)]
    .map((match) => ({ name: match[1].trim(), index: match.index }));
}

function heading(css, name) {
  const matches = headings(css).filter((entry) => entry.name === name || entry.name.startsWith(`${name} (`));
  assert.equal(matches.length, 1, `Expected exactly one ${name} heading.`);
  return matches[0];
}

function sectionDeclarations(css, name) {
  const start = heading(css, name).index;
  const end = headings(css).find((entry) => entry.index > start)?.index ?? css.length;
  return declarations(css).filter((entry) => entry.index > start && entry.index < end);
}

function assertHeadingOrder(css, expected) {
  assert.deepEqual(headings(css).map((entry) => entry.name), expected.map((name) => heading(css, name).name));
}

function familyNames(name) {
  return [`--color-${name}`, `--color-${name}-ink`, ...FUNCTIONAL_SUFFIXES.map((suffix) => `--color-${name}-${suffix}`)];
}

function assertContiguous(css, expected) {
  const names = declarations(css).map((entry) => entry.name);
  const start = names.indexOf(expected[0]);
  assert.ok(start >= 0, `Expected ${expected[0]}.`);
  assert.deepEqual(names.slice(start, start + expected.length), expected,
    `Expected a contiguous, ordered block beginning with ${expected[0]}.`);
}

function values(css) {
  const entries = declarations(css);
  const names = entries.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, "Every custom property must be declared exactly once.");
  return new Map(entries.map(({ name, value }) => [name, value]));
}

function value(tokens, name) {
  assert.ok(tokens.has(name), `Expected generated token ${name}.`);
  return tokens.get(name);
}

function assertPrivateTail(css) {
  const internal = heading(css, "Internal implementation");
  assert.equal(headings(css).at(-1).name, internal.name, "Internal implementation must be the final section.");
  const entries = declarations(css);
  const privateEntries = entries.filter((entry) => entry.name.startsWith("--_"));
  assert.ok(privateEntries.length > 0, "Expected generated implementation declarations.");
  for (const entry of entries) {
    assert.equal(entry.index > internal.index, entry.name.startsWith("--_"),
      `${entry.name} must be in the ${entry.name.startsWith("--_") ? "internal" : "public"} part of the output.`);
  }
  values(css);
}

test("sections follow the designer-facing order with all optional sections enabled", async (t) => {
  const root = await createProject(t);
  const { css } = await generate(root, { ...OPTIONAL_CONFIG, aliases: ALIASES });
  assertHeadingOrder(css, [
    ...CORE_HEADINGS,
    "Logo / brand",
    "Optional numeric tonal steps",
    "Hue variants",
    "Native contrast helpers",
    "Tuning contract",
    "Quick reference",
    "Internal implementation",
  ]);
  assert.deepEqual(sectionDeclarations(css, "Foundation").map((entry) => entry.name).sort(), [
    "--color-bg", "--color-surface", "--color-text", "--color-text-muted",
    "--color-border-subtle", "--color-border-strong", "--color-focus-ring",
  ].sort());
  assert.ok(sectionDeclarations(css, "Controls").length > 0);
  assert.ok(sectionDeclarations(css, "Controls").every((entry) => entry.name.startsWith("--color-control-")));
});

test("interleaved palette roles become contiguous families without sorting within a role", async (t) => {
  const root = await createProject(t);
  const { css, config } = await generate(root);
  assert.deepEqual(Object.keys(config.roles.identities), ["warning", "zeta", "info", "alpha"]);
  for (const [role, title, expectedNames] of [
    ["ui", "Identity / brand (ui)", ["zeta", "alpha"]],
    ["feedback", "Feedback", ["warning", "info"]],
  ]) {
    assert.deepEqual(Object.entries(config.roles.identities)
      .filter(([, identity]) => identity.role === role).map(([name]) => name), expectedNames);
    assert.deepEqual(sectionDeclarations(css, title).map((entry) => entry.name), expectedNames.flatMap(familyNames));
    for (const name of expectedNames) assertContiguous(css, familyNames(name));
  }
  const decorativeNames = ["spark", "glow"];
  assert.deepEqual(sectionDeclarations(css, "Decorative").map((entry) => entry.name),
    decorativeNames.flatMap((name) => [`--color-${name}`, `--color-${name}-ink`]));
  for (const name of decorativeNames) {
    assertContiguous(css, [`--color-${name}`, `--color-${name}-ink`]);
    assert.ok(!declarations(css).some((entry) => FUNCTIONAL_SUFFIXES.some((suffix) => entry.name === `--color-${name}-${suffix}`)));
  }
});

test("aliases keep the family suffix order and resolve to their target until overridden", async (t) => {
  const root = await createProject(t);
  const { css } = await generate(root, { aliases: ALIASES });
  const declarations = getDeclarations(css);
  const expectedNames = [];
  for (const [alias, target] of Object.entries(ALIASES)) {
    const aliasNames = alias === "ornament" ? [`--color-${alias}`, `--color-${alias}-ink`] : familyNames(alias);
    const targetNames = alias === "ornament" ? [`--color-${target}`, `--color-${target}-ink`] : familyNames(target);
    expectedNames.push(...aliasNames);
    assertContiguous(css, aliasNames);
    for (const [index, name] of aliasNames.entries()) {
      const targetToken = targetNames[index];
      assert.ok(declarations.has(targetToken), `Alias ${name} must reference a declared target.`);
      // The alias maps to its target: identical resolved value per theme...
      for (const scheme of ["light", "dark"]) {
        assert.deepEqual(resolveThemeColor(declarations, name, scheme), resolveThemeColor(declarations, targetToken, scheme), `${name} ${scheme} must map to ${targetToken}`);
      }
      // ...and keeps its own per-theme override on top of the mapping.
      const withOverride = new Map(declarations);
      withOverride.set(`--color-tune-${name.slice("--color-".length)}-dark`, "oklch(0.2 0.05 300)");
      assert.deepEqual(resolveThemeColor(withOverride, name, "dark"), { l: 0.2, c: 0.05, h: 300 }, `${name} dark override`);
      assert.deepEqual(resolveThemeColor(withOverride, targetToken, "dark"), resolveThemeColor(declarations, targetToken, "dark"), `${targetToken} must be untouched`);
    }
  }
  assert.deepEqual(sectionDeclarations(css, "Aliases").map((entry) => entry.name), expectedNames);
});

test("all private declarations, including logo pairs, occur only in the final internal section", async (t) => {
  const root = await createProject(t);
  const { css } = await generate(root, { ...OPTIONAL_CONFIG, aliases: ALIASES });
  assertPrivateTail(css);
  const tokens = values(css);
  for (const name of Object.keys(LOGO_SOURCES)) {
    value(tokens, `--_logo-${name}-light`);
    value(tokens, `--_logo-${name}-dark`);
    assert.equal(value(tokens, `--logo-${name}`), `light-dark(var(--_logo-${name}-light), var(--_logo-${name}-dark))`);
  }
  assert.ok(sectionDeclarations(css, "Logo / brand").every((entry) => entry.name.startsWith("--logo-")));
});

test("native ink helpers live in Advanced and never interrupt functional families", async (t) => {
  const root = await createProject(t);
  const { css, config } = await generate(root);
  const helpers = declarations(css).filter((entry) => entry.name.startsWith("--ink-"));
  assert.deepEqual(helpers.map((entry) => entry.name).sort(), Object.keys(config.roles.identities).map((name) => `--ink-${name}`).sort());
  assert.deepEqual(sectionDeclarations(css, "Native contrast helpers"), helpers);
  for (const entry of helpers) {
    assert.ok(entry.index > heading(css, "Advanced").index);
    assert.ok(entry.index < heading(css, "Internal implementation").index);
    assert.equal(entry.value, `contrast-color(var(--color-${entry.name.slice("--ink-".length)}))`);
  }
});

for (const mode of ["relative", "static"]) {
  test(`optional scales, hue and logo preserve values and the existing API in ${mode} dark mode`, async (t) => {
    const root = await createProject(t);
    const derivation = { dark: { mode } };
    const baseline = await generate(root, { derivation, aliases: ALIASES });
    const enabled = await generate(root, { ...OPTIONAL_CONFIG, derivation, aliases: ALIASES });
    const baselineTokens = values(baseline.css);
    const tokens = values(enabled.css);
    for (const [name, existingValue] of baselineTokens) {
      assert.equal(value(tokens, name), existingValue, `Enabling optional output must not change ${name}.`);
    }

    const light = parseOklch(value(tokens, "--_color-zeta-light")).color;
    const generatedDark = value(tokens, "--_color-zeta-dark-generated");
    let dark;
    if (mode === "relative") {
      const mix = /^color-mix\(in oklch, var\(--_color-zeta-source\) var\(--color-tune-zeta-dark-mix, ([\d.]+)%\), oklch\(1 0 none\)\)$/.exec(generatedDark);
      assert.ok(mix, "Relative dark output must retain its native color-mix formula.");
      dark = mixOklch(light, { l: 1, c: 0, h: null }, Number(mix[1]) / 100);
    } else {
      const parsed = parseOklch(generatedDark);
      assert.deepEqual(parsed.errors, []);
      dark = parsed.color;
    }
    assert.deepEqual(sectionDeclarations(enabled.css, "Optional numeric tonal steps").map((entry) => entry.name),
      ["--color-zeta-100", "--color-zeta-500", "--color-zeta-900"]);
    assert.equal(value(tokens, "--color-zeta-500"), `light-dark(var(--color-tune-zeta-500-light, ${oklch(fitToSrgb(light))}), var(--color-tune-zeta-500-dark, ${oklch(fitToSrgb(dark))}))`);
    for (const step of [100, 500, 900]) {
      assert.match(value(tokens, `--color-zeta-${step}`), /^light-dark\(var\(--color-tune-zeta-\d+-light, oklch\([^()]+\)\), var\(--color-tune-zeta-\d+-dark, oklch\([^()]+\)\)\)$/);
    }
    // Hue distance wraps at 360deg: 2deg (-30) is nearer 240deg than 62deg (+30).
    for (const [suffix, shift] of [["warm", 30], ["cool", -30]]) {
      assert.equal(value(tokens, `--color-zeta-${suffix}`),
        `light-dark(var(--color-tune-zeta-${suffix}-light, ${oklch(fitToSrgb({ ...light, h: light.h + shift }))}), var(--color-tune-zeta-${suffix}-dark, ${oklch(fitToSrgb({ ...dark, h: dark.h + shift }))}))`);
    }
    // A per-theme override on a scale step and a hue variant resolves as declared.
    const advancedTuned = getDeclarations(enabled.css);
    advancedTuned.set("--color-tune-zeta-500-dark", "oklch(0.2 0.05 300)");
    advancedTuned.set("--color-tune-zeta-warm-light", "oklch(0.4 0.06 200)");
    assert.deepEqual(resolveThemeColor(advancedTuned, "--color-zeta-500", "dark"), { l: 0.2, c: 0.05, h: 300 });
    assert.deepEqual(resolveThemeColor(advancedTuned, "--color-zeta-warm", "light"), { l: 0.4, c: 0.06, h: 200 });
    assert.deepEqual(sectionDeclarations(enabled.css, "Hue variants").map((entry) => entry.name),
      ["--color-zeta-warm", "--color-zeta-cool"]);
    for (const [name, source] of Object.entries(LOGO_SOURCES)) {
      const lightLogo = fitToSrgb(parseOklch(source).color);
      const darkLogo = fitToSrgb({ ...lightLogo, l: lightLogo.l * 1.5 });
      assert.equal(value(tokens, `--_logo-${name}-light`), oklch(lightLogo));
      assert.equal(value(tokens, `--_logo-${name}-dark`), oklch(darkLogo));
      assert.equal(value(tokens, `--logo-${name}`), `light-dark(var(--_logo-${name}-light), var(--_logo-${name}-dark))`);
    }
    assert.equal(value(tokens, "--logo-accent-alpha"), "oklch(from var(--logo-accent) l c h / 88%)");
    assert.equal(value(tokens, "--logo-stroke"), "light-dark(oklch(0.99 0 0), var(--color-bg))");
    assert.equal(value(tokens, "--logo-bg-fill"), "light-dark(var(--color-bg), var(--color-surface))");
    assert.deepEqual([...tokens.keys()].filter((name) => !baselineTokens.has(name)).sort(), [
      "--color-zeta-100", "--color-zeta-500", "--color-zeta-900", "--color-zeta-warm", "--color-zeta-cool",
      "--_logo-accent-light", "--_logo-accent-dark", "--_logo-wordmark-light", "--_logo-wordmark-dark",
      "--logo-accent", "--logo-wordmark", "--logo-accent-alpha", "--logo-stroke", "--logo-bg-fill",
    ].sort());
    assertPrivateTail(enabled.css);
  });
}

test("feedback-only static output omits UI, decorative and alias headings without losing families", async (t) => {
  const root = await createProject(t, COLORS.filter(([, role]) => role === "feedback"));
  const { css, config } = await generate(root, { derivation: { dark: { mode: "static" } } });
  assert.equal(config.roles.focus, "warning");
  assertHeadingOrder(css, [
    "Foundation", "Feedback", "Controls", "Advanced", "Surface contract", "Elevation",
    "Native contrast helpers", "Tuning contract", "Quick reference", "Internal implementation",
  ]);
  assert.deepEqual(sectionDeclarations(css, "Feedback").map((entry) => entry.name), ["warning", "info"].flatMap(familyNames));
  for (const name of ["warning", "info"]) {
    assertContiguous(css, familyNames(name));
    assert.match(value(values(css), `--_color-${name}-dark-generated`), /^oklch\([^()]+\)$/);
  }
  assertPrivateTail(css);
});

test("disabled optional features emit neither their headings nor public or private declarations", async (t) => {
  const root = await createProject(t);
  const { css } = await generate(root, {
    scales: {
      ...OPTIONAL_CONFIG.scales,
      enabled: false,
      hueVariants: { ...OPTIONAL_CONFIG.scales.hueVariants, enabled: false },
    },
    logo: { enabled: false, sources: LOGO_SOURCES },
  });
  assertHeadingOrder(css, [
    ...CORE_HEADINGS.filter((name) => name !== "Aliases"),
    "Native contrast helpers", "Tuning contract", "Quick reference", "Internal implementation",
  ]);
  const names = [...values(css).keys()];
  assert.ok(!names.some((name) => /^--(?:_)?logo-/.test(name)), "Disabled logo must not leave private pairs behind.");
  assert.ok(!names.some((name) => /^--color-.*-\d+$/.test(name)), "Disabled scales must not emit tonal steps.");
  assert.ok(!names.some((name) => /^--color-.*-(?:warm|cool|hue-plus-\d+|hue-minus-\d+)$/.test(name)),
    "Disabled hue variants must not emit variant tokens.");
  assertPrivateTail(css);
});

test("header comments neutralize configured paths containing the comment terminator", async (t) => {
  const root = await createProject(t);
  const palettePath = "src/a*/palette.css";
  const outputPath = "out*/colors.css";
  await mkdir(path.join(root, "src/a*"), { recursive: true });
  await writeFile(path.join(root, palettePath), paletteCss(), "utf8");

  const report = await generateColorTokens({
    root,
    check: true,
    suggest: false,
    inlineConfig: { palette: palettePath, output: outputPath },
  });

  // Only the display text is escaped; the values used for reads and writes stay exact.
  assert.equal(report.config.palette, palettePath);
  assert.equal(report.outputs[0].path, outputPath);
  assert.ok(report.css.includes("src/a*\\/palette.css"));
  assert.ok(report.css.includes("out*\\/colors.css"));
  // CSS comments do not nest: the first `*/` ends the header, so header prose
  // must not survive a spec-like comment strip.
  const uncommented = report.css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(uncommented, /Editable source:|Generated output:|palette\.css/);
});
