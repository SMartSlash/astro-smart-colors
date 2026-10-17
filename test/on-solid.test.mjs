import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { contrast, fitToSrgb, oklch } from "../src/color-math.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { parseOklch, parsePaletteWithDiagnostics } from "../src/parse-palette.mjs";

const PALETTE = [
  ["canvas", "canvas", "0.962 0.015 88"],
  ["ink", "ink", "0.28 0.007 3.68"],
  ["primary", "ui", "0.62 0.16 32"],
  ["info", "feedback", "0.56 0.12 260"],
  ["spark", "decorative", "0.88 0.12 85"],
].map(([name, role, channels]) => `@property --palette-${name} {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(${channels});
  role: ${role};
}`).join("\n\n");
const PALETTE_PATH = "src/styles/tokens/palette.css";
const OUTPUT_PATH = "src/styles/tokens/colors.css";
const STATIC_CONFIG = { derivation: { dark: { mode: "static" } } };

async function createProject(t, paletteCss = PALETTE) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-on-solid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, PALETTE_PATH), paletteCss, "utf8");
  await writeFile(path.join(root, OUTPUT_PATH), ":root {}\n", "utf8");
  return root;
}

function getDeclarations(css) {
  return new Map([...css.matchAll(/(?:^|\n)\s*(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi)]
    .map(([, name, value]) => [name, value.trim()]));
}

function getThemeColor(css, token, scheme) {
  const declarations = getDeclarations(css);
  const value = declarations.get(token);
  assert.ok(value, `Expected generated token ${token}.`);
  const pair = /^light-dark\(((?:oklch|var)\([^()]+\)),\s*((?:oklch|var)\([^()]+\))\)$/.exec(value);
  assert.ok(pair, `Expected a static light-dark color pair in ${token}: ${value}.`);
  return resolveStaticColor(declarations, pair[scheme === "light" ? 1 : 2]);
}

function resolveStaticColor(declarations, value, stack = []) {
  const reference = /^var\((--[a-z0-9_-]+)(?:,\s*(.*))?\)$/.exec(value);
  if (reference) {
    assert.ok(!stack.includes(reference[1]), `Circular reference: ${reference[1]}.`);
    const selected = declarations.get(reference[1]) ?? reference[2];
    assert.ok(selected, `Expected ${reference[1]} or its fallback.`);
    return resolveStaticColor(declarations, selected, [...stack, reference[1]]);
  }
  const parsed = parseOklch(value);
  assert.deepEqual(parsed.errors, []);
  return parsed.source;
}

function getSolidRatios(css, name, scheme, foreground = getThemeColor(css, `--color-${name}-solid-text`, scheme)) {
  return ["solid", "solid-hover"].map((suffix) => contrast(
    foreground,
    getThemeColor(css, `--color-${name}-${suffix}`, scheme),
  ));
}

function assertSolidTarget(css, name, scheme, target) {
  for (const ratio of getSolidRatios(css, name, scheme)) {
    assert.ok(ratio >= target, `${scheme} ${name} solid/hover contrast ${ratio} must reach ${target}.`);
  }
}

function getSuggestion(report, name, scheme) {
  assert.ok(Array.isArray(report.suggestions));
  assert.ok(report.suggestions.every((suggestion) => typeof suggestion === "string"));
  const matches = report.suggestions.filter((suggestion) => suggestion.startsWith(`${name} (${scheme}):`));
  assert.equal(matches.length, 1, `Expected one suggestion for ${name} (${scheme}).`);
  return matches[0];
}

function warningLabels(warnings) {
  return new Set(warnings.map((warning) => warning.split(" is ")[0]));
}

function assertOnlyOnSolidChanged(beforeCss, afterCss, name) {
  const before = getDeclarations(beforeCss);
  const after = getDeclarations(afterCss);
  assert.deepEqual([...after.keys()], [...before.keys()]);
  assert.deepEqual(
    [...before.keys()].filter((token) => before.get(token) !== after.get(token)),
    [`--color-${name}-solid-text`],
  );
}

test("onSolid is optional and an empty override preserves the default output", async (t) => {
  const root = await createProject(t);
  const baseline = await generateColorTokens({ root });
  const empty = await generateColorTokens({ root, inlineConfig: { onSolid: {} } });

  assert.equal(getThemeColor(baseline.css, "--color-info-solid-text", "light").l, 0.9944);
  assertSolidTarget(baseline.css, "info", "light", 4.62);
  assert.ok(!baseline.warnings.some((warning) => /info-on-solid/.test(warning)));
  assert.ok(!baseline.suggestions.some((entry) => entry.startsWith("info (light):")));
  assert.equal(empty.css, baseline.css);
  assert.deepEqual(empty.warnings, baseline.warnings);
  assert.deepEqual(empty.suggestions, baseline.suggestions);
  assert.equal(empty.changed, false);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
});

test("onSolid rejects unknown identities, themes, invalid shapes and non-opaque concrete colors", async (t) => {
  const root = await createProject(t);
  const cases = [
    ["null root", null, /onSolid must be an object/],
    ["array root", [], /onSolid must be an object/],
    ["string root", "oklch(0.99 0 0)", /onSolid must be an object/],
    ["number root", 42, /onSolid must be an object/],
    ["unknown identity", { missing: { light: "oklch(0.99 0 0)" } }, /onSolid\.missing.*existing UI\/feedback identity/],
    ["decorative identity", { spark: { light: "oklch(0.99 0 0)" } }, /onSolid\.spark.*existing UI\/feedback identity/],
    ["foundation identity", { canvas: { light: "oklch(0.99 0 0)" } }, /onSolid\.canvas.*existing UI\/feedback identity/],
    ["alias identity", { accent: { light: "oklch(0.99 0 0)" } }, /onSolid\.accent.*existing UI\/feedback identity/],
    ["unknown theme", { info: { sepia: "oklch(0.99 0 0)" } }, /onSolid\.info\.sepia.*only light and dark/],
    ["null identity", { info: null }, /onSolid\.info must be an object/],
    ["array identity", { info: [] }, /onSolid\.info must be an object/],
    ["string identity", { info: "oklch(0.99 0 0)" }, /onSolid\.info must be an object/],
    ...[
      null, 0.99, {}, [], "", "#fff", "rgb(255 255 255)", "var(--color-text)",
      "oklch(from var(--color-text) l c h)", "oklch(calc(0.9 + 0.1) 0 0)",
      "oklch(none 0 0)", "oklch(NaN 0 0)", "oklch(1.1 0 0)",
      "oklch(0.9 -0.1 0)", "oklch(0.99 0 0 / 50%)", "oklch(0.99 0 0 / 1)",
    ].map((value) => [`invalid color ${JSON.stringify(value)}`, { info: { light: value } }, /onSolid\.info\.light/]),
  ];

  for (const [label, onSolid, expectedError] of cases) {
    await t.test(label, async () => {
      await assert.rejects(generateColorTokens({
        root,
        inlineConfig: { onSolid, aliases: { accent: "primary" } },
      }), expectedError);
      assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), ":root {}\n");
      assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
    });
  }
});

test("per-theme UI/feedback overrides change only family onSolid and warn without forcing contrast", async (t) => {
  const root = await createProject(t);
  const config = {
    ...STATIC_CONFIG,
    aliases: { accent: "primary" },
    scales: { enabled: true, applyTo: ["primary", "info"], hueVariants: { enabled: true, applyTo: ["primary"] } },
    logo: { enabled: true, sources: { brand: "oklch(0.62 0.16 32)" } },
    motion: { enabled: true },
  };
  const baseline = await generateColorTokens({ root, inlineConfig: config });
  const override = "oklch(0.5 0.01 88)";

  for (const name of ["primary", "info"]) {
    for (const scheme of ["light", "dark"]) {
      await t.test(`${name} ${scheme}`, async () => {
        const inlineConfig = { ...config, onSolid: { [name]: { [scheme]: override } } };
        const originalConfig = structuredClone(inlineConfig);
        const report = await generateColorTokens({ root, inlineConfig });
        const otherScheme = scheme === "light" ? "dark" : "light";

        assert.deepEqual(report.errors, []);
        assert.deepEqual(getThemeColor(report.css, `--color-${name}-solid-text`, scheme), parseOklch(override).color);
        assert.deepEqual(
          getThemeColor(report.css, `--color-${name}-solid-text`, otherScheme),
          getThemeColor(baseline.css, `--color-${name}-solid-text`, otherScheme),
        );
        assertOnlyOnSolidChanged(baseline.css, report.css, name);
        assert.equal(report.motionCss, baseline.motionCss);
        for (const suffix of ["solid", "solid-hover"]) {
          assert.ok(report.warnings.some((warning) => warning.startsWith(`${scheme} ${name}-on-solid / ${suffix} is `)));
        }
        assert.deepEqual(inlineConfig, originalConfig);
        assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
      });
    }
  }
});

test("both theme overrides are applied independently without changing other tokens", async (t) => {
  const root = await createProject(t);
  const baseline = await generateColorTokens({ root, inlineConfig: STATIC_CONFIG });
  const onSolid = { info: { light: "oklch(1 0 0)", dark: "oklch(0.02 0 0)" } };
  const report = await generateColorTokens({ root, inlineConfig: { ...STATIC_CONFIG, onSolid } });

  for (const scheme of ["light", "dark"]) {
    assert.deepEqual(getThemeColor(report.css, "--color-info-solid-text", scheme), parseOklch(onSolid.info[scheme]).color);
    assertSolidTarget(report.css, "info", scheme, 4.62);
  }
  assertOnlyOnSolidChanged(baseline.css, report.css, "info");
  assert.ok(!report.warnings.some((warning) => /info-on-solid/.test(warning)));
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
});

test("on-solid contrast never rounds a below-threshold emitted pair into a pass", async (t) => {
  const root = await createProject(t);
  for (const lightness of [0.985, 0.9852]) {
    const report = await generateColorTokens({
      root,
      inlineConfig: {
        ...STATIC_CONFIG,
        contrast: { onColor: 4.5 },
        onSolid: { info: { light: `oklch(${lightness} 0 0)` } },
      },
    });
    const ratio = getSolidRatios(report.css, "info", "light")[0];
    assert.ok(ratio < 4.5 && ratio > 4.495, `Fixture must exercise a hidden shortfall, received ${ratio}.`);
    assert.equal(getThemeColor(report.css, "--color-info-solid-text", "light").l, lightness);
    const warning = report.warnings.find((entry) => entry.startsWith("light info-on-solid / solid is "));
    assert.ok(warning);
    assert.ok(warning.includes(`${ratio.toFixed(6)}:1 (target 4.500000:1)`));
    assert.ok(getSuggestion(report, "info", "light"));
    assert.deepEqual(report.errors, []);
    assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
  }
});

test("on-solid warnings distinguish target shortfalls from the normal-text minimum", async (t) => {
  const root = await createProject(t);
  for (const [lightness, status] of [[0.99, "below-target"], [0.9852, "below-minimum"]]) {
    await t.test(status, async () => {
      const report = await generateColorTokens({
        root,
        inlineConfig: { ...STATIC_CONFIG, onSolid: { info: { light: `oklch(${lightness} 0 0)` } } },
      });
      const ratio = getSolidRatios(report.css, "info", "light")[0];
      assert.ok(ratio < 4.6);
      if (status === "below-target") assert.ok(ratio >= 4.5 && ratio < 4.57);
      else assert.ok(ratio < 4.5 && ratio > 4.499);
      const warning = report.warnings.find((entry) => entry.startsWith("light info-on-solid / solid is "));
      assert.ok(warning);
      assert.ok(warning.includes(`Status: ${status}; WCAG AA normal-text reference minimum 4.50`));
      assert.ok(warning.endsWith("Ratios use generated defaults, before CSS overrides."));
      assert.equal(getThemeColor(report.css, "--color-info-solid-text", "light").l, lightness);
      assert.deepEqual(report.errors, []);
      assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
    });
  }
});

test("on-solid validates serialized colors even when the unrounded override passes", async (t) => {
  const root = await createProject(t);
  const target = 4.49985;
  const authored = { l: 0.985249, c: 0, h: 0 };
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      ...STATIC_CONFIG,
      contrast: { onColor: target },
      onSolid: { info: { light: `oklch(${authored.l} 0 0)` } },
    },
  });
  const solid = getThemeColor(report.css, "--color-info-solid", "light");
  assert.ok(contrast(authored, solid) >= target, "Unrounded fixture must pass.");
  assert.equal(getThemeColor(report.css, "--color-info-solid-text", "light").l, 0.9852);
  const emittedRatio = getSolidRatios(report.css, "info", "light")[0];
  assert.ok(emittedRatio < target, "Serialized fixture must fail.");
  assert.ok(report.warnings.some((entry) => entry.startsWith(`light info-on-solid / solid is ${emittedRatio.toFixed(6)}:1 (target ${target.toFixed(6)}:1)`)));
  assert.ok(getSuggestion(report, "info", "light"));
  assert.deepEqual(report.errors, []);
  assert.equal(report.config.onSolid.info.light, "oklch(0.985249 0 0)");
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
});

test("on-solid accepts emitted contrast at or above the exact threshold", async (t) => {
  const root = await createProject(t);
  const baseline = await generateColorTokens({
    root,
    inlineConfig: { ...STATIC_CONFIG, contrast: { onColor: 4.5 }, onSolid: { info: { light: "oklch(0.9853 0 0)" } } },
  });
  const ratio = getSolidRatios(baseline.css, "info", "light")[0];
  assert.ok(ratio > 4.5);
  for (const target of [4.5, ratio]) {
    const report = await generateColorTokens({
      root,
      inlineConfig: { ...STATIC_CONFIG, contrast: { onColor: target }, onSolid: { info: { light: "oklch(0.9853 0 0)" } } },
    });
    assert.ok(!report.warnings.some((entry) => entry.startsWith("light info-on-solid / solid is ")));
    assert.ok(!report.suggestions.some((entry) => entry.startsWith("info (light):")));
  }
});

test("info foreground suggestion is nearest on the four-decimal grid and copy-paste fixes the warning", async (t) => {
  const root = await createProject(t);
  const baseline = await generateColorTokens({ root, inlineConfig: { ...STATIC_CONFIG, onSolid: { info: { light: "oklch(0.99 0 0)" } } } });
  assert.ok(baseline.warnings.some((warning) => warning.startsWith("light info-on-solid / solid is ")));
  const suggestion = getSuggestion(baseline, "info", "light");
  assert.match(suggestion, /preserve the palette/);
  assert.match(suggestion, /In smart-colors\.config\.mjs, set onSolid\.info\.light/);
  assert.match(suggestion, /Changes only --color-info-solid-text \(light\), shared by solid\/hover; not --color-info-ink or either fill/);
  assert.match(suggestion, /Search: nearest L on a 4-decimal grid with C\/H fixed, checked after gamut mapping and serialization; not a global perceptual nearest-color claim/);
  assert.match(suggestion, /Merge into existing onSolid settings; no changes applied/);
  const match = /onSolid: \{ "info": \{ light: "(oklch\([^()]+\))" \} \}/.exec(suggestion);
  assert.ok(match, "Expected copy-pasteable onSolid config.");
  assert.equal(match[1], "oklch(0.9944 0 0)");
  const candidate = parseOklch(match[1]).color;
  const original = getThemeColor(baseline.css, "--color-info-solid-text", "light");
  assert.equal(candidate.c, original.c);
  assert.equal(candidate.h, original.h);
  const distance = Math.abs(candidate.l - original.l);
  for (let index = 0; index <= 10000; index += 1) {
    const l = index / 10000;
    if (Math.abs(l - original.l) >= distance - 1e-12) continue;
    const serialized = parseOklch(oklch(fitToSrgb({ ...original, l }))).color;
    assert.ok(getSolidRatios(baseline.css, "info", "light", serialized).some((ratio) => ratio < 4.62),
      `Closer grid candidate ${l} must not satisfy the safety margin.`);
  }

  const configText = `export default { derivation: { dark: { mode: "static" } }, onSolid: { info: { light: ${JSON.stringify(match[1])} } } };\n`;
  await writeFile(path.join(root, "smart-colors.config.mjs"), configText, "utf8");
  const fixed = await generateColorTokens({ root });
  assert.deepEqual(fixed.errors, []);
  assertSolidTarget(fixed.css, "info", "light", 4.62);
  assert.ok(!fixed.warnings.some((warning) => /info-on-solid/.test(warning)));
  assert.ok(!fixed.suggestions.some((entry) => entry.startsWith("info (light):")));
  assertOnlyOnSolidChanged(baseline.css, fixed.css, "info");
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
  assert.equal(await readFile(path.join(root, "smart-colors.config.mjs"), "utf8"), configText);
});

test("advice uses the configured identity key, authored source and config destination", async (t) => {
  const root = await createProject(t);
  const palettePath = "src/styles/tokens/authored.css";
  const outputPath = "src/styles/tokens/mapped-colors.css";
  const configFile = "config/mapped-colors.mjs";
  const paletteCss = PALETTE.replace("--palette-primary", "--palette-brand")
    .replace("--palette-info", "--palette-notice");
  const config = {
    ...STATIC_CONFIG,
    palette: palettePath,
    output: outputPath,
    roles: { focus: "primary", identities: { primary: { token: "--palette-brand", role: "ui" }, info: { token: "--palette-notice", role: "feedback" } } },
    onSolid: { info: { light: "oklch(0.99 0 0)" } },
  };
  const configText = `export default ${JSON.stringify(config)};\n`;
  await writeFile(path.join(root, palettePath), paletteCss, "utf8");
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, configFile), configText, "utf8");
  const report = await generateColorTokens({ root, configFile });
  assert.deepEqual(report.errors, []);
  const foreground = getSuggestion(report, "info", "light");
  assert.match(foreground, /In config\/mapped-colors\.mjs, set onSolid\.info\.light/);
  assert.match(foreground, /onSolid: \{ "info": \{ light: "oklch\(0\.9944 0 0\)" \} \}/);
  assert.match(foreground, /Changes only --color-info-solid-text \(light\), shared by solid\/hover; not --color-info-ink or either fill/);
  assert.match(foreground, /Search: nearest L on a 4-decimal grid with C\/H fixed, checked after gamut mapping and serialization; not a global perceptual nearest-color claim/);
  assert.doesNotMatch(foreground, /onSolid\.notice|--color-notice|In smart-colors\.config\.mjs/);
  const source = getSuggestion(report, "primary", "light");
  assert.match(source, /Optional source adjustment in src\/styles\/tokens\/authored\.css, @property --palette-brand, initial-value/);
  assert.match(source, /oklch\(0\.62 0\.16 32\) -> oklch\(0\.6238 0\.16 32\)/);
  assert.doesNotMatch(source, /@property --palette-primary|in src\/styles\/tokens\/palette\.css/);
  const checked = await generateColorTokens({ root, configFile, check: true });
  assert.equal(checked.changed, false);
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.suggestions, report.suggestions);
  assert.equal(await readFile(path.join(root, outputPath), "utf8"), report.css);
  assert.equal(await readFile(path.join(root, palettePath), "utf8"), paletteCss);
  assert.equal(await readFile(path.join(root, configFile), "utf8"), configText);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), ":root {}\n");
  await assert.rejects(readFile(path.join(root, "smart-colors.config.mjs")), { code: "ENOENT" });
});

test("primary source fallback is optional, copy-pasteable and creates no new warning labels in either theme", async (t) => {
  const root = await createProject(t);
  const baseline = await generateColorTokens({ root, inlineConfig: STATIC_CONFIG });
  const solid = getThemeColor(baseline.css, "--color-primary-solid", "light");
  const hover = getThemeColor(baseline.css, "--color-primary-solid-hover", "light");
  // Even black and white cannot span this pair at 4.6:1; changing text alone cannot fix it.
  const darker = Math.min(solid.l, hover.l) === solid.l ? solid : hover;
  const lighter = darker === solid ? hover : solid;
  assert.ok(contrast({ l: 0, c: 0, h: 0 }, darker) < 4.6);
  assert.ok(contrast({ l: 1, c: 0, h: 0 }, lighter) < 4.6);
  const suggestion = getSuggestion(baseline, "primary", "light");
  assert.match(suggestion, /no text-only suggestion.*4-decimal lightness grid/);
  assert.match(suggestion, /Optional source adjustment in src\/styles\/tokens\/palette\.css, @property --palette-primary, initial-value/);
  assert.match(suggestion, /Authored chroma and hue unchanged/);
  assert.match(suggestion, /Generation rechecked in both themes with no new contrast warnings\./);
  assert.match(suggestion, /Source edits affect the identity, both themes and derived families\/scales; logo sources remain separate\./);
  assert.match(suggestion, /Search: nearest authored L on a 4-decimal grid, C\/H fixed, full regeneration verified\. No changes applied\./);
  const match = /(oklch\([^()]+\)) -> (oklch\([^()]+\))/.exec(suggestion);
  assert.ok(match, "Expected copy-pasteable source replacement.");
  assert.equal(match[1], "oklch(0.62 0.16 32)");
  assert.equal(match[2], "oklch(0.6238 0.16 32)");
  assert.deepEqual(parseOklch(match[2]).color, { l: 0.6238, c: 0.16, h: 32 });
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);

  // Only this explicit manual edit changes the authored palette, never generation.
  const editedPalette = PALETTE.replace(match[1], match[2]);
  await writeFile(path.join(root, PALETTE_PATH), editedPalette, "utf8");
  const fixed = await generateColorTokens({ root, inlineConfig: STATIC_CONFIG });
  assert.deepEqual(fixed.errors, []);
  for (const scheme of ["light", "dark"]) assertSolidTarget(fixed.css, "primary", scheme, 4.62);
  const existingLabels = warningLabels(baseline.warnings);
  for (const label of warningLabels(fixed.warnings)) assert.ok(existingLabels.has(label), `Unexpected new warning: ${label}`);
  assert.ok(!fixed.warnings.some((warning) => /primary-on-solid/.test(warning)));
  assert.ok(!fixed.suggestions.some((entry) => entry.startsWith("primary (light):")));
  const before = getDeclarations(baseline.css);
  for (const [token, value] of getDeclarations(fixed.css)) {
    if (/info|spark/.test(token)) assert.equal(value, before.get(token), `${token} must remain unchanged.`);
  }
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), editedPalette);
});

test("out-of-sRGB source fallback preserves authored chroma/hue and copy-pastes into the palette", async (t) => {
  const authoredSource = "oklch(0.62 0.3 32)";
  const paletteCss = PALETTE.replace("oklch(0.62 0.16 32)", authoredSource);
  const parsedPalette = parsePaletteWithDiagnostics(paletteCss);
  assert.deepEqual(parsedPalette.errors, []);
  assert.deepEqual(parsedPalette.authoredTokens["palette-primary"], { l: 0.62, c: 0.3, h: 32 });
  assert.ok(parsedPalette.tokens["palette-primary"].c < 0.3, "Fixture must require sRGB gamut mapping.");
  const root = await createProject(t, paletteCss);
  const baseline = await generateColorTokens({ root, inlineConfig: STATIC_CONFIG });
  const suggestion = getSuggestion(baseline, "primary", "light");
  assert.match(suggestion, /no text-only suggestion.*4-decimal lightness grid/);
  assert.match(suggestion, /Optional source adjustment in src\/styles\/tokens\/palette\.css, @property --palette-primary, initial-value/);
  assert.match(suggestion, /Authored chroma and hue unchanged/);
  assert.match(suggestion, /Generation rechecked in both themes with no new contrast warnings\./);
  assert.match(suggestion, /Source edits affect the identity, both themes and derived families\/scales; logo sources remain separate\./);
  assert.match(suggestion, /Search: nearest authored L on a 4-decimal grid, C\/H fixed, full regeneration verified\. No changes applied\./);
  const match = /(oklch\([^()]+\)) -> (oklch\([^()]+\))/.exec(suggestion);
  assert.ok(match, "Expected copy-pasteable raw source replacement, not a gamut-mapped value.");
  assert.equal(match[1], authoredSource);
  const suggestedSource = parseOklch(match[2]);
  assert.deepEqual(suggestedSource.errors, []);
  assert.equal(suggestedSource.source.c, 0.3);
  assert.equal(suggestedSource.source.h, 32);
  assert.notEqual(suggestedSource.source.l, 0.62);
  assert.ok(Math.abs(suggestedSource.source.l * 10000 - Math.round(suggestedSource.source.l * 10000)) < 1e-9);
  assert.ok(suggestedSource.color.c < suggestedSource.source.c);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), paletteCss);

  const checked = await generateColorTokens({ root, check: true, inlineConfig: STATIC_CONFIG });
  assert.equal(checked.changed, false);
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.suggestions, baseline.suggestions);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), paletteCss);

  // This explicit fixture edit is the only operation allowed to change the source.
  assert.equal(paletteCss.split(match[1]).length, 2);
  const editedPalette = paletteCss.replace(match[1], match[2]);
  await writeFile(path.join(root, PALETTE_PATH), editedPalette, "utf8");
  const fixed = await generateColorTokens({ root, inlineConfig: STATIC_CONFIG });
  assert.deepEqual(fixed.errors, []);
  const target = baseline.config.contrast.onColor + 0.02;
  for (const scheme of ["light", "dark"]) assertSolidTarget(fixed.css, "primary", scheme, target);
  assert.ok(!fixed.warnings.some((warning) => /primary-on-solid/.test(warning)));
  const existingLabels = warningLabels(baseline.warnings);
  for (const label of warningLabels(fixed.warnings)) assert.ok(existingLabels.has(label), `Unexpected new warning: ${label}`);
  assert.deepEqual(parsePaletteWithDiagnostics(editedPalette).authoredTokens["palette-primary"], suggestedSource.source);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), editedPalette);
});

test("suggest:false disables only advice while omitted and explicit true retain default suggestions", async (t) => {
  const root = await createProject(t);
  const inlineConfig = { onSolid: { info: { light: "oklch(0.99 0 0)" } } };
  const baseline = await generateColorTokens({ root, inlineConfig });
  assert.ok(baseline.warnings.length > 0);
  getSuggestion(baseline, "info", "light");
  getSuggestion(baseline, "primary", "light");
  const disabled = await generateColorTokens({ root, inlineConfig, suggest: false });
  assert.deepEqual(disabled.suggestions, []);
  assert.equal(disabled.css, baseline.css);
  assert.deepEqual(disabled.warnings, baseline.warnings);
  assert.deepEqual(disabled.config, baseline.config);
  assert.deepEqual(disabled.errors, baseline.errors);
  assert.equal(disabled.changed, false);
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), baseline.css);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);

  const enabled = await generateColorTokens({ root, inlineConfig, suggest: true });
  assert.deepEqual(enabled.suggestions, baseline.suggestions);
  const { suggestions: disabledAdvice, ...disabledReport } = disabled;
  const { suggestions: enabledAdvice, ...enabledReport } = enabled;
  assert.deepEqual(disabledReport, enabledReport);
  assert.deepEqual(disabledAdvice, []);
  assert.ok(enabledAdvice.length > 0);

  const checked = await generateColorTokens({ root, inlineConfig, check: true, suggest: false });
  assert.deepEqual(checked, disabled);
  const defaultCheck = await generateColorTokens({ root, inlineConfig, check: true });
  assert.deepEqual(defaultCheck, enabled);
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), baseline.css);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
});

test("suggestions are read-only advice in check mode and a clean model has an empty string array", async (t) => {
  const root = await createProject(t);
  const baseline = await generateColorTokens({ root });
  const checked = await generateColorTokens({ root, check: true });
  assert.equal(checked.changed, false);
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.suggestions, baseline.suggestions);
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), baseline.css);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
  await assert.rejects(readFile(path.join(root, "smart-colors.config.mjs")), { code: "ENOENT" });

  const cleanPalette = PALETTE.replace("oklch(0.62 0.16 32)", "oklch(0.6238 0.16 32)");
  await writeFile(path.join(root, PALETTE_PATH), cleanPalette, "utf8");
  const clean = await generateColorTokens({ root, inlineConfig: { onSolid: { info: { light: "oklch(0.9944 0 0)" } } } });
  assert.deepEqual(clean.warnings, []);
  assert.deepEqual(clean.suggestions, []);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), cleanPalette);
});

test("unavailable suggestions honestly report the search limits without claiming a verified fix", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: { contrast: { onColor: 21, maxIdentity: 21, darkRichness: 1 } },
  });
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some((warning) => warning.startsWith("light primary-on-solid / solid is ")));
  const suggestion = getSuggestion(report, "primary", "light");
  assert.match(suggestion, /no verified foreground or source suggestion was found/);
  assert.match(suggestion, /4-decimal lightness grid with chroma and hue fixed/);
  assert.match(suggestion, /onSolid\.primary\.light in smart-colors\.config\.mjs/);
  assert.match(suggestion, /do not edit generated src\/styles\/tokens\/colors\.css\. No changes applied/);
  assert.doesNotMatch(suggestion, /onSolid:| -> |Verified light|Verified solid/);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
});
