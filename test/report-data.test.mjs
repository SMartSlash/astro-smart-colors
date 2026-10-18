import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertReportInputsUnchanged, captureReportInputs, configSnippet, darkFillTuningIdentity, formatReportSummary, mergeSideEffect, readConfigValue, structuralChanges, withConfigValue, proposalImproves, publishedProposal, readPaletteDarkBlend, replacePaletteDarkBlend, replacePaletteSource, replaceTuningDeclaration, reportCandidates, reportOverlapScenario, reportScenario, reportSideEffect, reportSnapshot, worstSideEffect } from "../src/report-data.mjs";

import { analyzeColorTokens } from "../src/generate-colors.mjs";
import { nearestLightness, resolvedColor, sourceColorValue } from "../src/contrast-advice.mjs";
import { contrast, fitToSrgb, mixOklch, oklch, serializedColor } from "../src/color-math.mjs";

const color = { l: 0.5, c: 0.02, h: 32 };
const row = (label, status = "pass", ratio = 7.2) => ({
  label, status, ratio, foreground: "--color-text", background: "--color-bg",
  foregroundColor: color, backgroundColor: { l: 0.95, c: 0.01, h: 88 }, target: 7, minimum: 4.5, kind: "text",
});

function summarySnapshot(rows, baseline = rows) {
  return {
    generatedAt: "2026-10-17T12:00:00.000Z", inputDigest: "a".repeat(64),
    files: { palette: "palette.css", config: "smart-colors.config.mjs", tuning: "colors-tuning.css", output: "colors.css" },
    scenarios: [reportScenario("chromium", "light", "light", rows, baseline)],
    palette: [], notes: [], proposals: [], generationErrors: [], auditErrors: [],
  };
}

test("CLI report summary groups repeats, prioritizes minimums and preserves threshold precision", () => {
  const input = summarySnapshot([
    row("target", "below-target", 6.8), row("minimum", "below-minimum", 4.4999999),
  ], [row("target"), row("minimum")]);
  input.scenarios.push(reportScenario("webkit", "light", "light", [
    row("target", "below-target", 6.9), row("minimum", "below-minimum", 4.49999999),
  ], [row("target"), row("minimum")]));
  const before = structuredClone(input);
  const summary = formatReportSummary(input);
  assert.match(summary, /^2 problemi distinti: 1 sotto il minimo · 1 sotto il target\./);
  assert.match(summary, /4 misure in 2 scenari · 0 correzioni verificate/);
  assert.equal((summary.match(/SOTTO MINIMO/g) ?? []).length, 1);
  assert.equal((summary.match(/SOTTO TARGET/g) ?? []).length, 1);
  assert.ok(summary.indexOf("SOTTO MINIMO") < summary.indexOf("SOTTO TARGET"));
  assert.match(summary, /< 4,5:1/);
  assert.doesNotMatch(summary, /&lt;|4\.499999/);
  assert.match(summary, /Per 2 problemi la baseline rispettava le soglie/);
  assert.match(summary, /Nessun candidato verificato disponibile/);
  assert.match(summary, /non il valore estetico/);
  assert.deepEqual(input, before);
});

test("CLI report summary never promotes incomplete data or attributes existing shortfalls to tuning", () => {
  const passing = summarySnapshot([row("text")]);
  assert.match(formatReportSummary(passing), /Nessun problema nelle coppie misurate/);
  assert.match(formatReportSummary(passing), /Non è una certificazione/);
  const existing = summarySnapshot([row("text", "below-target", 6.8)], [row("text", "below-target", 6.9)]);
  assert.doesNotMatch(formatReportSummary(existing), /baseline rispettava/);
  for (const invalid of [null, {}, { ...passing, auditErrors: ["browser unavailable"] }, { ...passing, generationErrors: ["invalid palette"] }, { ...passing, scenarios: [] }]) {
    const summary = formatReportSummary(invalid);
    assert.match(summary, /Esito non verificato o incompleto/);
    assert.doesNotMatch(summary, /Nessun problema|correzione verificata|correzioni verificate/);
  }
});

test("CLI report summary counts only proposals covering every original control", () => {
  const input = summarySnapshot([row("issue", "below-target", 6.8), row("passing control")]);
  const checks = reportScenario("chromium", "light", "light", [row("issue"), row("passing control")]).diagnostics;
  input.proposals.push({
    id: "trial", title: "Manual option", kind: "tuning", verified: true,
    destination: { file: "colors-tuning.css", path: "--knob", snippet: "--knob: 1;" },
    impact: "surface only", search: "local", issueLabels: ["issue"], checks,
    changes: [{ label: "surface", before: color, after: { ...color, l: 0.6 } }],
  });
  assert.match(formatReportSummary(input), /1 correzione verificata/);
  input.proposals[0].checks = checks.slice(0, 1);
  assert.match(formatReportSummary(input), /0 correzioni verificate/);
  assert.doesNotMatch(formatReportSummary(input), /Le correzioni sono opzioni/);
});

test("structural helpers read, write and print build-time paths without mutating the inspected configuration", () => {
  const config = { derivation: { surface: { lightShift: -0.018 }, dark: { bgMixRatio: 14 } } };
  assert.equal(readConfigValue(config, "derivation.surface.lightShift"), -0.018);
  assert.equal(readConfigValue(config, "derivation.dark.bgMixRatio"), 14);
  assert.equal(readConfigValue(config, "derivation.missing.value"), null);
  assert.equal(readConfigValue(config, "derivation.surface.lightShift.deep"), null);
  assert.equal(readConfigValue({ derivation: { surface: { lightShift: "-0.018" } } }, "derivation.surface.lightShift"), null, "a non-numeric value is never used as a build-time fact");
  const updated = withConfigValue(config, "derivation.surface.lightShift", -0.028);
  assert.equal(readConfigValue(updated, "derivation.surface.lightShift"), -0.028);
  assert.equal(readConfigValue(config, "derivation.surface.lightShift"), -0.018, "the inspected configuration is never mutated");
  const created = withConfigValue(config, "derivation.surface.newKnob", 3);
  assert.equal(readConfigValue(created, "derivation.surface.newKnob"), 3);
  assert.equal(readConfigValue(created, "derivation.surface.lightShift"), -0.018);
  assert.equal(configSnippet("derivation.surface.lightShift", -0.028), "derivation: { surface: { lightShift: -0.028 } }");
  assert.equal(configSnippet("derivation.dark.bgMixRatio", 18), "derivation: { dark: { bgMixRatio: 18 } }");
});

test("structural changes lead with the foregrounds of the pairs the proposal fixes", () => {
  const measured = (label, foreground, l) => ({ label, foreground, foregroundColor: { l, c: 0.01, h: 30 },
    backgroundColor: { l: 0.92, c: 0.01, h: 88 }, ratio: 7, status: "pass", minimum: 4.5, target: 7, kind: "text" });
  const before = [
    measured("neutral border / surface", "--color-primary-border-strong", 0.5),
    measured("muted / surface", "--color-text-muted", 0.417),
    measured("identity text / surface", "--color-primary-text", 0.414),
    measured("unchanged / surface", "--color-border-subtle", 0.6),
  ];
  const after = [
    measured("neutral border / surface", "--color-primary-border-strong", 0.49),
    measured("muted / surface", "--color-text-muted", 0.41),
    measured("identity text / surface", "--color-primary-text", 0.408),
    measured("unchanged / surface", "--color-border-subtle", 0.6),
  ];
  // Audit order puts the border first, but it is not a pair the proposal fixes.
  assert.deepEqual(structuralChanges(before, after, ["muted / surface", "identity text / surface"]).map((change) => change.label),
    ["--color-text-muted", "--color-primary-text", "--color-primary-border-strong"]);
  const [first] = structuralChanges(before, after, ["muted / surface"]);
  assert.deepEqual(first.before, { l: 0.417, c: 0.01, h: 30 });
  assert.deepEqual(first.after, { l: 0.41, c: 0.01, h: 30 });
  assert.equal(structuralChanges(before, after, []).length, 3, "Unchanged tokens are never published as changes");
  assert.equal(structuralChanges(before, after, [], 2).length, 2, "The published list stays capped");
  const repeated = structuralChanges([...before, before[1]], [...after, after[1]], ["muted / surface"]);
  assert.equal(repeated.filter((change) => change.label === "--color-text-muted").length, 1, "One entry per token");
  assert.deepEqual(structuralChanges(before, after, undefined).length, 3, "A malformed label list never breaks the ordering");
});

test("report facts preserve full precision and distinguish boundary usage from text", () => {
  const ratio = 4.499999999999;
  const input = { ...row("light text", "below-minimum", ratio), kind: "family-ui", minimum: 3, target: 4.6, status: "below-target" };
  const scenario = reportScenario("webkit", "light", "dark", [input], [row("light text")]);
  assert.equal(scenario.diagnostics[0].ratio, ratio);
  assert.equal(scenario.diagnostics[0].foregroundToken, "--color-text");
  assert.deepEqual(scenario.diagnostics[0].foreground, color);
  assert.equal(scenario.diagnostics[0].kind, "non-text");
  assert.equal(scenario.diagnostics[0].baselineRatio, 7.2);
  assert.equal(scenario.diagnostics[0].provenance, "browser-after-tuning");
});

function overlapTokens() {
  return new Map([
    ["--color-bg", { l: 1, c: 0, h: 0 }],
    ["--color-surface", { l: 0, c: 0, h: 0 }],
    ["--color-secondary", { l: 0.511111111111, c: 0.0800000000001, h: -12.1234567890123 }],
    ["--color-primary", { l: 0.6321234567891234, c: 0.100049123456, h: 392.000050123456 }],
    ["--color-spark", { l: 0.90000000001, c: 0.0100000001, h: 88.000000005 }],
  ]);
}

test("overlap counts cover two neutral backgrounds and every unordered pair, including zero/one names", () => {
  for (let count = 0; count <= 5; count += 1) {
    const names = Array.from({ length: count }, (_, index) => `identity-${index}`);
    const tokens = overlapTokens();
    for (const [index, name] of names.entries()) tokens.set(`--color-${name}`, { l: 0.2 + index * 0.1, c: 0, h: index });
    const scenario = reportOverlapScenario("chromium", "light", "light", tokens, names);
    assert.equal(scenario.diagnostics.length, count * 2 + count * (count - 1) / 2);
  }
});

test("overlaps preserve input order and contain unique pairs without self or reverse duplicates", () => {
  const scenario = reportOverlapScenario("webkit", "light", "dark", overlapTokens(), ["spark", "secondary", "primary"]);
  const pairs = scenario.diagnostics.map((item) => [item.foregroundToken, item.backgroundToken]);
  assert.deepEqual(pairs, [
    ["--color-spark", "--color-bg"], ["--color-spark", "--color-surface"],
    ["--color-secondary", "--color-bg"], ["--color-secondary", "--color-surface"],
    ["--color-primary", "--color-bg"], ["--color-primary", "--color-surface"],
    ["--color-spark", "--color-secondary"], ["--color-spark", "--color-primary"],
    ["--color-secondary", "--color-primary"],
  ]);
  assert.ok(pairs.every(([foreground, background]) => foreground !== background));
  assert.equal(new Set(pairs.map((pair) => [...pair].sort().join(" / "))).size, pairs.length);
  assert.equal(new Set(scenario.diagnostics.map((item) => item.label)).size, pairs.length);
  for (const item of scenario.diagnostics) {
    assert.ok(item.label.includes(item.foregroundToken) && item.label.includes(item.backgroundToken));
  }
});

test("overlaps deduplicate names, preserve full-precision tokens/ratios and never mutate inputs", () => {
  const tokens = overlapTokens();
  for (const color of tokens.values()) Object.freeze(color);
  const names = Object.freeze(["secondary", "primary", "spark", "primary", "secondary", "spark"]);
  const beforeTokens = structuredClone(tokens), beforeNames = [...names];
  const scenario = reportOverlapScenario("firefox", "dark", "light", tokens, names);
  assert.deepEqual(scenario, reportOverlapScenario("firefox", "dark", "light", tokens, ["secondary", "primary", "spark"]));
  assert.equal(scenario.diagnostics.length, 9);
  for (const item of scenario.diagnostics) {
    assert.deepEqual(item.foreground, tokens.get(item.foregroundToken));
    assert.deepEqual(item.background, tokens.get(item.backgroundToken));
    assert.equal(item.ratio, contrast(tokens.get(item.foregroundToken), tokens.get(item.backgroundToken)));
  }
  assert.ok(scenario.diagnostics.some((item) => item.ratio !== Number(item.ratio.toFixed(4))));
  assert.deepEqual(tokens, beforeTokens);
  assert.deepEqual(names, beforeNames);
  scenario.diagnostics[0].foreground.l = 0;
  assert.deepEqual(tokens, beforeTokens, "published colors must not alias input tokens");
});

test("overlap contrast agrees with independent achromatic WCAG luminance oracles", () => {
  const tokens = new Map([
    ["--color-bg", { l: 1, c: 0, h: 0 }], ["--color-surface", { l: 0, c: 0, h: 0 }],
    ["--color-black", { l: 0, c: 0, h: 0 }], ["--color-gray", { l: 0.5, c: 0, h: 0 }],
    ["--color-white", { l: 1, c: 0, h: 0 }],
  ]);
  const scenario = reportOverlapScenario("chromium", "light", "light", tokens, ["black", "gray", "white"]);
  // For achromatic OKLCH, linear-sRGB relative luminance is L cubed.
  for (const item of scenario.diagnostics) {
    const a = item.foreground.l ** 3, b = item.background.l ** 3;
    const expected = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(Math.abs(item.ratio - expected) < 1e-8, `${item.label}: ${item.ratio} vs ${expected}`);
    assert.ok(Number.isFinite(item.ratio) && item.ratio >= 1 && item.ratio <= 21);
    assert.equal(item.status, expected >= 4.5 ? "pass" : "below-minimum");
  }
  assert.equal(scenario.diagnostics.find((item) => item.foregroundToken === "--color-black" && item.backgroundToken === "--color-surface").ratio, 1);
  assert.ok(Math.abs(scenario.diagnostics.find((item) => item.foregroundToken === "--color-black" && item.backgroundToken === "--color-white").ratio - 21) < 1e-8);
});

test("overlap status uses the unrounded 4.5 text minimum without an audit tolerance", () => {
  for (const [expected, status] of [[4.5 - 1e-12, "below-minimum"], [4.5 + 1e-12, "pass"]]) {
    const tokens = overlapTokens();
    tokens.set("--color-primary", { l: Math.cbrt(0.05 * (expected - 1)), c: 0, h: 0 });
    const item = reportOverlapScenario("webkit", "light", "light", tokens, ["primary"]).diagnostics[1];
    assert.equal(Number(item.ratio.toFixed(2)), 4.5);
    assert.equal(item.status, status);
    assert.equal(item.ratio, contrast(tokens.get("--color-primary"), tokens.get("--color-surface")));
  }
});

test("overlap scenarios and diagnostics preserve browser/theme/preference and explicit resolved-color provenance", () => {
  for (const browser of ["chromium", "firefox", "webkit"]) {
    for (const scheme of ["light", "dark"]) {
      for (const preference of ["light", "dark"]) {
        const scenario = reportOverlapScenario(browser, scheme, preference, overlapTokens(), ["primary"]);
        assert.deepEqual(Object.keys(scenario), Object.keys(reportScenario(browser, scheme, preference, [])));
        assert.equal(scenario.browser, browser);
        assert.equal(scenario.scheme, scheme);
        assert.equal(scenario.preference, preference);
        assert.equal(scenario.provenance, "browser-resolved-overlap");
        for (const item of scenario.diagnostics) {
          assert.equal(item.browser, browser);
          assert.equal(item.scheme, scheme);
          assert.equal(item.preference, preference);
          assert.equal(item.provenance, "browser-resolved-overlap");
          assert.equal(item.kind, "text");
          assert.equal(item.target, 4.5);
          assert.equal(item.minimum, 4.5);
          assert.equal(Object.hasOwn(item, "baselineRatio"), false);
        }
      }
    }
  }
});

test("overlaps reject invalid context, token collections and public names with useful errors", () => {
  const valid = ["chromium", "light", "dark", overlapTokens(), ["primary"]];
  for (const [index, values, field] of [
    [0, [undefined, null, "", "safari", {}, "Chromium"], "browser"],
    [1, [undefined, null, "", "auto", {}, "LIGHT"], "scheme"],
    [2, [undefined, null, "", "no-preference", {}, "DARK"], "preference"],
    [3, [undefined, null, {}, [], new Set()], "tokens"],
    [4, [undefined, null, {}, "primary", new Set(["primary"])], "names"],
  ]) {
    for (const value of values) {
      const args = [...valid];
      args[index] = value;
      assert.throws(() => reportOverlapScenario(...args), new RegExp(`Report overlap ${field}`));
    }
  }
  for (const name of [undefined, null, "", " primary", "primary ", "--color-primary", "Primary", "bad;name", "bg", "surface", 1, 1n, {}, []]) {
    assert.throws(() => reportOverlapScenario("chromium", "light", "dark", overlapTokens(), [name]), /Report overlap name .* invalid/);
  }
});

test("overlaps reject each missing or invalid required color rather than filling channels or clamping", () => {
  const invalidColors = [undefined, null, "oklch(.5 .1 32)", [], {},
    ...[-Number.EPSILON, 1 + Number.EPSILON, NaN, Infinity, -Infinity, "0.5", null, undefined].map((l) => ({ ...color, l })),
    ...[-Number.EPSILON, NaN, Infinity, -Infinity, "0.1", null, undefined].map((c) => ({ ...color, c })),
    ...[NaN, Infinity, -Infinity, "32", null, undefined].map((h) => ({ ...color, h })),
  ];
  for (const token of ["--color-bg", "--color-surface", "--color-primary", "--color-spark"]) {
    const tokens = overlapTokens();
    const check = () => assert.throws(() => reportOverlapScenario("firefox", "dark", "light", tokens, ["primary", "spark"]), (error) => {
      assert.match(error.message, /Report overlap firefox\/dark\/light/);
      assert.ok(error.message.includes(token));
      assert.match(error.message, /missing or invalid resolved OKLCH color/);
      return true;
    });
    tokens.delete(token);
    check();
    for (const invalid of invalidColors) {
      tokens.set(token, invalid);
      const before = structuredClone(tokens);
      check();
      assert.deepEqual(tokens, before);
    }
  }
});

test("overlaps reject a non-finite calculated ratio even when individual channels are finite", () => {
  for (const overflow of [{ c: Number.MAX_VALUE }, { h: Number.MAX_VALUE }]) {
    const tokens = overlapTokens();
    tokens.set("--color-primary", { ...color, ...overflow });
    assert.throws(() => reportOverlapScenario("webkit", "dark", "dark", tokens, ["primary"]), /Report overlap webkit\/dark\/dark --color-primary on --color-bg: invalid contrast ratio .*finite ratio in \[1, 21\]/);
  }
});

test("proposals must solve every named issue without new target or minimum deficits", () => {
  const before = [row("light issue", "below-target", 6.8), row("dark fine"), row("old issue", "below-target", 6.9)];
  const good = [row("light issue"), row("dark fine"), row("old issue", "below-target", 6.9)];
  assert.equal(proposalImproves(before, good, ["light issue"]), true);
  assert.equal(proposalImproves(before, good, ["light issue", "missing"]), false);
  assert.equal(proposalImproves(before, good, ["light issue", "old issue"]), false);
  assert.equal(proposalImproves(before, [good[0], row("dark fine", "below-target", 6.8), good[2]], ["light issue"]), false);
  assert.equal(proposalImproves(before, [good[0], good[1], row("old issue", "below-minimum", 4.49)], ["light issue"]), false);
  assert.equal(proposalImproves(before, good.slice(0, 2), ["light issue"]), false);
  assert.equal(proposalImproves(before, [row("changed label"), ...good.slice(1)], ["light issue"]), false);
  assert.equal(proposalImproves(before, [{ ...good[0], ratio: NaN }, ...good.slice(1)], ["light issue"]), false);
  assert.equal(proposalImproves(before, good, []), false);
});

test("tuning trials replace one actual declaration and preserve its selector and comments", () => {
  const css = "/* --color-tune-surface-lightness-shift: 9; */\n:root[data-theme=light] {\n  --color-tune-surface-lightness-shift: -0.028;\n  --other: 1;\n}";
  assert.equal(replaceTuningDeclaration(css, "--color-tune-surface-lightness-shift", "-0.018"), css.replace(": -0.028;", ": -0.018;"));
  assert.equal(replaceTuningDeclaration(":root { --x: 1; --x: 2; }", "--x", "3"), null);
  assert.match(replaceTuningDeclaration("/* --x: 0; */", "--x", "2"), /:root \{ --x: 2; \}/);
});

test("source trials preserve role descriptors and unrelated sources", () => {
  const css = "@property --palette-primary { initial-value: oklch(.5 .1 32); role: ui; dark-blend: 80; }\n@property --palette-other { initial-value: oklch(.7 .1 88); role: ui; }";
  const updated = replacePaletteSource(css, "--palette-primary", "oklch(0.6 0.1 32)");
  assert.equal(updated, css.replace("oklch(.5 .1 32)", "oklch(0.6 0.1 32)"));
  assert.equal(replacePaletteSource(css, "--missing", "oklch(0 0 0)"), null);
  assert.equal(replacePaletteSource(css + css, "--palette-primary", "oklch(0 0 0)"), null);
  assert.equal(replacePaletteSource(":root { --primary: oklch(.5 .1 32); }", "--primary", "oklch(0.6 0.1 32)"), ":root { --primary: oklch(0.6 0.1 32); }");
});

test("snapshot hashes track source bytes and resolved configuration without mutating inputs", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-report-data-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  const file = path.join(root, "src/styles/tokens/palette.css");
  const css = "@property --palette-bg { initial-value: oklch(.95 .01 88); role: canvas; }";
  await writeFile(file, css);
  const first = await reportSnapshot(root);
  const repeat = await reportSnapshot(root);
  assert.equal(first.inputDigest, repeat.inputDigest);
  assert.deepEqual(first.overlaps, []);
  assert.notStrictEqual(first.overlaps, first.scenarios);
  first.scenarios.push(reportScenario("chromium", "light", "light", [row("light text")]));
  const auditScenarios = structuredClone(first.scenarios);
  first.overlaps.push(reportOverlapScenario("chromium", "light", "light", overlapTokens(), ["primary", "spark"]));
  assert.deepEqual(first.scenarios, auditScenarios);
  assert.deepEqual(repeat.overlaps, []);
  assert.deepEqual(repeat.scenarios, []);
  assert.equal(first.palette[0].role, "canvas");
  assert.equal(await readFile(file, "utf8"), css);
  await writeFile(path.join(root, "src/styles/tokens/colors-tuning.css"), ":root { --x: 2; }");
  assert.notEqual((await reportSnapshot(root)).inputDigest, first.inputDigest);
  const configured = await reportSnapshot(root, { config: { palette: "src/styles/tokens/palette.css", output: "src/styles/tokens/colors.css" }, errors: [] });
  assert.notEqual(configured.inputDigest, first.inputDigest);
});

const PALETTE = `@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; }
@property --palette-ink { initial-value: oklch(.28 .007 3.68); role: ink; }
@property --palette-primary { initial-value: oklch(.62 .300049 32.00005); role: ui; }`;

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-session-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, "src/styles/tokens/palette.css"), PALETTE);
  return root;
}

test("snapshot exposes identity sources and their palette names for variant comparison", async (t) => {
  const root = await fixture(t);
  const config = { palette: "src/styles/tokens/palette.css", output: "src/styles/tokens/colors.css", roles: { identities: {
    primary: { token: "--palette-primary", role: "ui" },
    legacy: { token: "--brand" },
  } } };
  const snapshot = await reportSnapshot(root, { config, errors: [] });
  assert.deepEqual(snapshot.roles.identities, [
    { name: "primary", role: "ui", token: "--palette-primary", paletteName: "--palette-primary" },
    { name: "legacy", role: null, token: "--brand", paletteName: "--brand" },
  ]);
  assert.deepEqual((await reportSnapshot(root)).roles.identities, []);
});

test("analysis and report use captured palette bytes; mid-session input changes invalidate publication", async (t) => {
  const root = await fixture(t);
  const captured = await captureReportInputs(root);
  const pathPalette = path.join(root, "src/styles/tokens/palette.css");
  await writeFile(pathPalette, PALETTE.replace(".62 .300049", ".7 .300049"));
  const analysis = await analyzeColorTokens({ root, suggest: false }, captured.inputs.find(([name]) => name === "palette")[2]);
  assert.equal(analysis.inputs.paletteCss, PALETTE);
  const snapshot = await reportSnapshot(root, analysis, captured);
  assert.equal(snapshot.palette.find((item) => item.name === "--palette-primary").authored.l, 0.62);
  await assert.rejects(assertReportInputsUnchanged(root, captured), { code: "SMART_COLORS_INPUTS_CHANGED" });
  await writeFile(pathPalette, PALETTE);
  await assertReportInputsUnchanged(root, captured);
  await writeFile(path.join(root, "smart-colors.config.mjs"), "");
  await assert.rejects(assertReportInputsUnchanged(root, captured), { code: "SMART_COLORS_INPUTS_CHANGED" });
  const tuning = path.join(root, "src/styles/tokens/colors-tuning.css");
  await writeFile(tuning, Buffer.from([0xff]));
  const invalidUtf8 = await captureReportInputs(root);
  await writeFile(tuning, Buffer.from([0xfe]));
  const changedBytes = await captureReportInputs(root);
  assert.equal(invalidUtf8.inputs.find(([name]) => name === "tuning")[2], changedBytes.inputs.find(([name]) => name === "tuning")[2]);
  await assert.rejects(assertReportInputsUnchanged(root, invalidUtf8), { code: "SMART_COLORS_INPUTS_CHANGED" });
});

test("source candidate trial uses the exact full-precision OKLCH published in the snippet", async (t) => {
  const root = await fixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const after = { l: 0.6321, c: 0.300049, h: 32.00005 };
  const proposal = {
    id: "exact-source", identity: "primary", scheme: "light", kind: "palette-source",
    destination: { file: "src/styles/tokens/palette.css", path: "@property --palette-primary / initial-value", snippet: `initial-value: ${sourceColorValue(after)};` },
    changes: [{ label: "--palette-primary", before: analysis.authoredTokens["palette-primary"], after }],
  };
  const original = analysis.diagnostics.find((item) => item.label === "light primary-on-solid / solid");
  const simulated = {
    label: original.label, foreground: original.foregroundToken, background: original.backgroundToken,
    foregroundColor: original.foreground, backgroundColor: original.background,
    target: original.target, minimum: original.minimum, ratio: 4, status: "below-minimum", kind: "on-color",
  };
  const candidates = await reportCandidates(root, { ...analysis, proposals: [proposal] }, ":root {}", [{ scheme: "light", tuned: [simulated] }]);
  const candidate = candidates.find((item) => item.id === "exact-source");
  assert.ok(candidate);
  const exactSource = replacePaletteSource(PALETTE, "--palette-primary", sourceColorValue(after));
  const expected = await analyzeColorTokens({ root, config: analysis.config, suggest: false }, exactSource);
  const declarations = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(declarations(candidate.css), declarations(expected.css));
  assert.equal(candidate.destination.snippet, proposal.destination.snippet);
});

// Dark tuning fixtures: the report consumes browser-resolved colors, so these
// tests provide explicit measured rows instead of launching a browser.
const DARK_PALETTE = `@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; }
@property --palette-ink { initial-value: oklch(.28 .007 3.68); role: ink; }
@property --palette-primary { initial-value: oklch(.62 .16 32.41); role: ui; }`;

async function darkFixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-dark-tuning-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, "src/styles/tokens/palette.css"), DARK_PALETTE);
  return root;
}

function darkPair(label, foreground, background, foregroundColor, backgroundColor, status = "below-minimum", target = 4.6, minimum = 4.5) {
  return { label, foreground, background, foregroundColor, backgroundColor, ratio: 4, status, target, minimum, kind: "text" };
}

// Two-decimal percentage grid, nearest to the active value first: the oracle
// the dark knob searches must reproduce without sharing their implementation.
function knobGrid(current) {
  return Array.from({ length: 10001 }, (_, index) => index / 100)
    .sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
}

const margin = (pair) => Math.min(21, Math.max(pair.minimum, pair.target) + 0.02);
const percent = (value) => `${Number(value.toFixed(2))}%`;

test("dark bg depth search proposes the nearest percentage that clears the measured margin", async (t) => {
  const root = await darkFixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const canvas = { l: 0.3, c: 0.01, h: 88 };
  const tuned = [
    darkPair("dark neutral text / canvas", "--color-text", "--color-bg", { l: 0.66, c: 0, h: 88 }, canvas),
    darkPair("dark control active border / canvas", "--color-control-border-active", "--color-bg", { l: 0.5, c: 0.02, h: 88 }, canvas, "below-minimum", 3, 3),
  ];
  const tuningCss = ":root {\n  --color-tune-dark-bg-mix: 30%;\n}";
  const scaled = (value) => ({ l: canvas.l * (value / 30), c: canvas.c * (value / 30), h: canvas.h });
  const expected = knobGrid(30).find((value) => tuned.every((pair) => contrast(pair.foregroundColor, scaled(value)) >= margin(pair)));
  assert.ok(Number.isFinite(expected) && expected !== 30, "fixture needs a reachable darker canvas");
  const candidates = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned }]);
  const candidate = candidates.find((item) => item.id === "browser-neutral-bg-dark");
  assert.ok(candidate, "expected a dark canvas tuning proposal");
  assert.equal(candidate.kind, "tuning");
  assert.deepEqual(candidate.destination, {
    file: "src/styles/tokens/colors-tuning.css", path: "--color-tune-dark-bg-mix",
    snippet: `--color-tune-dark-bg-mix: ${percent(expected)};`,
  });
  assert.deepEqual(candidate.issueLabels, ["dark neutral text / canvas", "dark control active border / canvas"]);
  assert.deepEqual(candidate.changes, [{ label: "--color-bg (dark)", before: canvas, after: scaled(expected) }]);
  assert.equal(candidate.css, analysis.css);
  assert.equal(candidate.tuningCss, replaceTuningDeclaration(tuningCss, "--color-tune-dark-bg-mix", percent(expected)));
  assert.equal(candidates.some((item) => ["browser-neutral-surface-dark", "browser-neutral-muted-dark"].includes(item.id)), false);
});

test("dark surface depth is searched on the surface rows and skipped without a relative dark derivation", async (t) => {
  const root = await darkFixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const surface = { l: 0.36, c: 0.012, h: 88 };
  const tuned = [darkPair("dark muted text / surface", "--color-text-muted", "--color-surface", { l: 0.6, c: 0, h: 88 }, surface)];
  const tuningCss = ":root { --color-tune-dark-surface-mix: 36%; }";
  const scaled = (value) => ({ l: surface.l * (value / 36), c: surface.c * (value / 36), h: surface.h });
  const expected = knobGrid(36).find((value) => contrast(tuned[0].foregroundColor, scaled(value)) >= margin(tuned[0]));
  assert.ok(Number.isFinite(expected), "fixture needs a reachable darker surface");
  const candidates = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned }]);
  const candidate = candidates.find((item) => item.id === "browser-neutral-surface-dark");
  assert.ok(candidate, "expected a dark surface tuning proposal");
  assert.equal(candidate.destination.path, "--color-tune-dark-surface-mix");
  assert.deepEqual(candidate.changes, [{ label: "--color-surface (dark)", before: surface, after: scaled(expected) }]);
  assert.equal(candidate.tuningCss, replaceTuningDeclaration(tuningCss, "--color-tune-dark-surface-mix", percent(expected)));
  // Static dark derivations do not consume the knobs: no proposal is invented.
  const staticDark = await analyzeColorTokens({ root, suggest: false, inlineConfig: { derivation: { dark: { mode: "static" } } } });
  assert.deepEqual(staticDark.errors, []);
  assert.deepEqual(await reportCandidates(root, staticDark, tuningCss, [{ scheme: "dark", tuned }]), []);
});

test("dark muted depth search uses resolved text and canvas and skips unverifiable sources", async (t) => {
  const root = await darkFixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const text = { l: 0.75, c: 0, h: 88 };
  const canvas = { l: 0.34, c: 0, h: 88 };
  const surface = { l: 0.2, c: 0, h: 88 };
  const muted = { l: 0.6352, c: 0, h: 88 };
  const tuned = [
    darkPair("dark muted text / canvas", "--color-text-muted", "--color-bg", muted, canvas),
    darkPair("dark muted text / surface", "--color-text-muted", "--color-surface", muted, surface, "pass"),
  ];
  const tuningCss = ":root { --color-tune-dark-muted-mix: 72%; }";
  const expected = knobGrid(72).find((value) => tuned.every((pair) => contrast(mixOklch(text, canvas, value / 100), pair.backgroundColor) >= margin(pair)));
  assert.ok(Number.isFinite(expected) && expected > 72, "fixture needs a lighter muted mix");
  const computed = { tokens: new Map([["--color-text", text], ["--color-bg", canvas]]) };
  const candidates = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned, computed }]);
  const candidate = candidates.find((item) => item.id === "browser-neutral-muted-dark");
  assert.ok(candidate, "expected a dark muted tuning proposal");
  assert.deepEqual(candidate.destination, {
    file: "src/styles/tokens/colors-tuning.css", path: "--color-tune-dark-muted-mix",
    snippet: `--color-tune-dark-muted-mix: ${percent(expected)};`,
  });
  assert.deepEqual(candidate.changes, [{ label: "--color-text-muted (dark)", before: muted, after: mixOklch(text, canvas, expected / 100) }]);
  assert.equal(candidate.tuningCss, replaceTuningDeclaration(tuningCss, "--color-tune-dark-muted-mix", percent(expected)));
  assert.deepEqual(candidate.issueLabels, ["dark muted text / canvas"]);
  // Without browser-resolved internal colors the mix is not measurable: stay silent.
  const blind = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned }]);
  assert.equal(blind.some((item) => item.id === "browser-neutral-muted-dark"), false);
  // An active --color-text override reshapes the muted mix source: stay silent.
  const overridden = await reportCandidates(root, analysis, `${tuningCss}\n:root { --color-text: oklch(0.9 0 0); }`, [{ scheme: "dark", tuned, computed }]);
  assert.equal(overridden.some((item) => item.id === "browser-neutral-muted-dark"), false);
});

test("dark bg depth search re-models muted constraints with the active muted mix depth", async (t) => {
  const root = await darkFixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const canvas = { l: 0.3, c: 0.01, h: 88 };
  const text = { l: 0.75, c: 0, h: 88 };
  // Measured muted tokens sit exactly on their active mix of text into the canvas:
  // the 76% tuning override for the main run, the generated 72% for the fallback.
  const mutedTuned = { l: 0.642, c: 0.0024, h: 88 };
  const mutedGenerated = { l: 0.624, c: 0.0028, h: 88 };
  const rowsFor = (muted) => [
    darkPair("dark muted text / canvas", "--color-text-muted", "--color-bg", muted, canvas),
    darkPair("dark neutral text / canvas", "--color-text", "--color-bg", { l: 0.66, c: 0, h: 88 }, canvas),
  ];
  const tuned = rowsFor(mutedTuned);
  const scaled = (value) => ({ l: canvas.l * (value / 30), c: canvas.c * (value / 30), h: canvas.h });
  // The muted foreground follows the candidate canvas: it is a mix of the resolved
  // dark text into the new background, never the measured foreground held fixed.
  const search = (mutedDepth, rows) => knobGrid(30).find((value) => rows.every((pair) => {
    const background = scaled(value);
    const foreground = pair.foreground === "--color-text-muted" ? mixOklch(text, background, mutedDepth) : pair.foregroundColor;
    return contrast(foreground, background) >= margin(pair);
  }));
  const constant = knobGrid(30).find((value) => tuned.every((pair) => contrast(pair.foregroundColor, scaled(value)) >= margin(pair)));
  const tuningCss = ":root { --color-tune-dark-bg-mix: 30%; --color-tune-dark-muted-mix: 76%; }";
  const expected = search(76 / 100, tuned);
  assert.ok(Number.isFinite(expected) && expected !== 30, "fixture needs a reachable darker canvas");
  assert.notEqual(expected, constant, "fixture must distinguish the re-modelled muted text from the constant one");
  const computed = { tokens: new Map([["--color-text", text], ["--color-bg", canvas]]) };
  const candidates = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned, computed }]);
  const candidate = candidates.find((item) => item.id === "browser-neutral-bg-dark");
  assert.ok(candidate, "expected a dark canvas tuning proposal");
  assert.deepEqual(candidate.destination, {
    file: "src/styles/tokens/colors-tuning.css", path: "--color-tune-dark-bg-mix",
    snippet: `--color-tune-dark-bg-mix: ${percent(expected)};`,
  });
  assert.deepEqual(candidate.issueLabels, ["dark muted text / canvas", "dark neutral text / canvas"]);
  assert.deepEqual(candidate.changes, [{ label: "--color-bg (dark)", before: canvas, after: scaled(expected) }]);
  assert.equal(candidate.tuningCss, replaceTuningDeclaration(tuningCss, "--color-tune-dark-bg-mix", percent(expected)));
  // Without the active knob the muted depth falls back to the generated contract value.
  const generated = Number(/--color-tune-dark-muted-mix:\s*([\d.]+)%/.exec(analysis.css)[1]);
  const fallbackTuning = ":root { --color-tune-dark-bg-mix: 30%; }";
  const fallbackRows = rowsFor(mutedGenerated);
  const fallback = await reportCandidates(root, analysis, fallbackTuning, [{ scheme: "dark", tuned: fallbackRows, computed }]);
  const fallbackCandidate = fallback.find((item) => item.id === "browser-neutral-bg-dark");
  assert.ok(fallbackCandidate, "expected the generated muted depth to stay measurable");
  assert.equal(fallbackCandidate.destination.snippet, `--color-tune-dark-bg-mix: ${percent(search(generated / 100, fallbackRows))};`);
  assert.notEqual(percent(search(generated / 100, fallbackRows)), percent(expected), "fixture must distinguish the active and generated muted depths");
  // Without the resolved dark text the muted interaction is not measurable: no proposal.
  const blind = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned }]);
  assert.equal(blind.some((item) => item.id === "browser-neutral-bg-dark"), false);
});

test("dark fill escape hatch serializes one concrete tune declaration and refuses ambiguous duplicates", async (t) => {
  const root = await darkFixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const fill = { l: 0.62, c: 0.16, h: 32.41 };
  const tuned = [
    darkPair("dark on-primary / primary", "--color-primary-ink", "--color-primary", { l: 0.97, c: 0, h: 0 }, fill),
    darkPair("dark primary-on-solid / solid", "--color-primary-solid-text", "--color-primary-solid", { l: 0.9, c: 0, h: 0 }, fill),
  ];
  const tuningCss = ":root {\n  /* --color-tune-primary-dark: color-mix(in oklch, var(--_color-primary-source) 80%, oklch(1 0 none)); */\n}";
  const requirement = (pair, candidate) => contrast(pair.foregroundColor, resolvedColor(candidate)) >= margin(pair);
  const balanced = nearestLightness(fill, (color) => tuned.every((pair) => requirement(pair, color)));
  assert.ok(balanced && balanced.l < fill.l, "fixture needs a darker fill");
  const candidates = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned }]);
  const candidate = candidates.find((item) => item.id === "browser-dark-fill:primary");
  assert.ok(candidate, "expected a dark fill escape hatch proposal");
  assert.equal(candidate.kind, "tuning");
  assert.deepEqual(candidate.destination, {
    file: "src/styles/tokens/colors-tuning.css", path: "--color-tune-primary-dark",
    snippet: `--color-tune-primary-dark: ${oklch(balanced)};`,
  });
  assert.deepEqual(candidate.changes, [{ label: "--color-primary (dark)", before: fill, after: resolvedColor(balanced) }]);
  assert.equal(candidate.tuningCss, replaceTuningDeclaration(tuningCss, "--color-tune-primary-dark", oklch(balanced)));
  assert.deepEqual(candidate.issueLabels, ["dark on-primary / primary", "dark primary-on-solid / solid"]);
  // Two active declarations are ambiguous under the same rule that blocks a write.
  const duplicated = `${tuningCss}\n:root { --color-tune-primary-dark: oklch(0.5 0.1 32); }\n:root { --color-tune-primary-dark: oklch(0.6 0.1 32); }`;
  const ambiguous = await reportCandidates(root, analysis, duplicated, [{ scheme: "dark", tuned }]);
  assert.equal(ambiguous.some((item) => item.id === "browser-dark-fill:primary"), false);
  // A light failure on the same fill is not fixed by a dark-only hatch.
  const light = tuned.map((pair) => ({ ...pair, label: `light ${pair.label.slice("dark ".length)}` }));
  const lights = await reportCandidates(root, analysis, tuningCss, [{ scheme: "light", tuned: light }]);
  assert.equal(lights.some((item) => item.id === "browser-dark-fill:primary"), false);
});

test("dark fill escape hatch optimizes the text on the new fill, not the distance from the old one", async (t) => {
  const root = await darkFixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  // Dark text on a mid-tone fill: the shortfall is fixed by lightening the fill.
  // Optimizing the candidate against the previous fill instead would pick a darker
  // color that satisfies that wrong measurement and then fails with this text.
  const fill = { l: 0.35, c: 0.12, h: 32.41 };
  const text = { l: 0.05, c: 0, h: 0 };
  const tuned = [darkPair("dark on-primary / primary", "--color-primary-ink", "--color-primary", text, fill)];
  const tuningCss = ":root {\n  /* --color-tune-primary-dark: oklch(0.6 0.12 32.41); */\n}";
  const requirement = (candidate) => contrast(text, resolvedColor(candidate)) >= margin(tuned[0]);
  const expected = nearestLightness(fill, requirement);
  assert.ok(expected && expected.l > fill.l, "fixture needs a lighter fill for dark text");
  const candidates = await reportCandidates(root, analysis, tuningCss, [{ scheme: "dark", tuned }]);
  const candidate = candidates.find((item) => item.id === "browser-dark-fill:primary");
  assert.ok(candidate, "expected a dark fill escape hatch proposal");
  const [change] = candidate.changes;
  assert.equal(change.label, "--color-primary (dark)");
  assert.deepEqual(change.after, resolvedColor(expected));
  assert.ok(change.after.l > fill.l, "The proposed fill must lighten for dark text");
  assert.ok(requirement(expected), "The proposal must satisfy the measured text requirement");
  const [row] = tuned;
  assert.ok(contrast(row.foregroundColor, change.after) >= margin(row), "Proposal must keep the text readable on the new fill");
  assert.equal(candidate.destination.snippet, `--color-tune-primary-dark: ${oklch(expected)};`);
});

const FOCUS_PALETTE = `@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; }
@property --palette-ink { initial-value: oklch(.28 .007 3.68); role: ink; }
@property --palette-primary { initial-value: oklch(.62 .16 32.41); role: ui; }
@property --palette-secondary { initial-value: oklch(.54 .16 198); role: ui; }`;

test("dark fill impact names the control consumers only for the focus identity", async (t) => {
  const root = await darkFixture(t);
  await writeFile(path.join(root, "src/styles/tokens/palette.css"), FOCUS_PALETTE);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  assert.equal(analysis.config.roles.focus, "primary", "fixture must resolve the first ui identity as focus");
  const tuned = [
    darkPair("dark on-primary / primary", "--color-primary-ink", "--color-primary", { l: 0.97, c: 0, h: 0 }, { l: 0.62, c: 0.16, h: 32.41 }),
    darkPair("dark on-secondary / secondary", "--color-secondary-ink", "--color-secondary", { l: 0.97, c: 0, h: 0 }, { l: 0.54, c: 0.16, h: 198 }),
  ];
  const candidates = await reportCandidates(root, analysis, ":root {}", [{ scheme: "dark", tuned }]);
  const focus = candidates.find((item) => item.id === "browser-dark-fill:primary");
  const other = candidates.find((item) => item.id === "browser-dark-fill:secondary");
  assert.ok(focus && other, "expected dark fill proposals for both identities");
  const baseFor = (identity) => `Fissa il riempimento dark di ${identity} (condiviso dal bordo) senza toccare la palette; riempimento chiaro, solid-hover e companion restano letterali. Escape hatch non validato dal generatore: per scelte stabili usa dark-blend in palette.css. Decommenta o sostituisci la riga di esempio nel pannello 2 di colors-tuning.css.`;
  assert.equal(other.impact, baseFor("secondary"), "non-focus identities keep the current impact text");
  assert.ok(focus.impact.startsWith(baseFor("primary")), "focus impact extends the current text");
  for (const token of ["--_color-primary-dark", "--color-control-bg-active", "--color-control-border-active", "--color-control-focus-bg"]) {
    assert.ok(focus.impact.includes(token), `focus impact must name ${token}`);
    assert.ok(!other.impact.includes(token), `non-focus impact must not name ${token}`);
  }
});

test("palette-source verification also names the direct on-color companion", async (t) => {
  const root = await fixture(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const after = { l: 0.6321, c: 0.300049, h: 32.00005 };
  const proposal = {
    id: "direct-companion-source", identity: "primary", scheme: "light", kind: "palette-source",
    destination: { file: "src/styles/tokens/palette.css", path: "@property --palette-primary / initial-value", snippet: `initial-value: ${sourceColorValue(after)};` },
    changes: [{ label: "--palette-primary", before: analysis.authoredTokens["palette-primary"], after }],
  };
  const original = analysis.diagnostics.find((item) => item.label === "light primary-on-solid / solid");
  const solid = {
    label: original.label, foreground: original.foregroundToken, background: original.backgroundToken,
    foregroundColor: original.foreground, backgroundColor: original.background,
    target: original.target, minimum: original.minimum, ratio: 4, status: "below-minimum", kind: "on-color",
  };
  const direct = {
    label: "light on-primary / primary", foreground: "--color-primary-ink", background: "--color-primary",
    foregroundColor: { l: 0.97, c: 0, h: 0 }, backgroundColor: { l: 0.62, c: 0.16, h: 32.41 },
    target: 4.6, minimum: 4.5, ratio: 3.1, status: "below-minimum", kind: "on-color",
  };
  const candidates = await reportCandidates(root, { ...analysis, proposals: [proposal] }, ":root {}", [{ scheme: "light", tuned: [solid, direct] }]);
  const candidate = candidates.find((item) => item.id === "direct-companion-source");
  assert.ok(candidate, "expected the source trial to cover both failing companions");
  assert.deepEqual(candidate.issueLabels, ["light primary-on-solid / solid", "light on-primary / primary"]);
  assert.equal(candidate.destination.snippet, proposal.destination.snippet);
  const expected = await analyzeColorTokens({ root, config: analysis.config, suggest: false }, replacePaletteSource(PALETTE, "--palette-primary", sourceColorValue(after)));
  const declarations = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal(declarations(candidate.css), declarations(expected.css));
  // The direct companion alone keeps the same source trial and its own label.
  const onlyDirect = await reportCandidates(root, { ...analysis, proposals: [proposal] }, ":root {}", [{ scheme: "light", tuned: [direct] }]);
  const alternative = onlyDirect.find((item) => item.id === "direct-companion-source");
  assert.ok(alternative, "expected the source trial to cover a direct-only failure");
  assert.deepEqual(alternative.issueLabels, ["light on-primary / primary"]);
});

// `--color-tune-<id>-dark` also moves the family border alias on the canvas, a
// pair the audit deliberately leaves unmeasured. The comparison is information
// only: it never feeds verified, checks, issue labels, counts or filters.
const sideEffectBefore = {
  color: Object.freeze({ l: 0.6333333333333, c: 0.1625123456789012, h: 392.000050123456 }),
  background: Object.freeze({ l: 0.1928571428571, c: 0.00345678901234, h: 88.000000005 }),
};
const sideEffectAfter = {
  color: Object.freeze({ l: 0.5333333333333, c: 0.1225123456789, h: 32.410000001234 }),
  background: sideEffectBefore.background,
};

test("dark fill side effects are gated to --color-tune-<id>-dark destinations", () => {
  assert.equal(darkFillTuningIdentity({ file: "src/styles/tokens/colors-tuning.css", path: "--color-tune-primary-dark" }), "primary");
  assert.equal(darkFillTuningIdentity({ path: "--color-tune-surface-strong-dark" }), "surface-strong");
  for (const destination of [
    undefined, null, {}, { path: undefined }, { path: 42 },
    { path: "--color-tune-dark-bg-mix" }, { path: "--color-tune-surface-lightness-shift" },
    { path: "--color-tune-primary-light" }, { path: "--color-tune-primary-dark-extra" },
    { path: "--color-primary-border" }, { path: "onSolid.primary.dark" },
  ]) {
    assert.equal(darkFillTuningIdentity(destination), null, `unexpected identity for ${JSON.stringify(destination)}`);
  }
});

test("dark fill side effect entries validate measurements, preserve full precision and never mutate inputs", () => {
  const entry = reportSideEffect("primary", sideEffectBefore, sideEffectAfter);
  assert.deepEqual(entry, {
    label: "dark primary-border / canvas", scheme: "dark",
    foregroundToken: "--color-primary-border", backgroundToken: "--color-bg",
    before: { color: sideEffectBefore.color, ratio: contrast(sideEffectBefore.color, sideEffectBefore.background) },
    after: { color: sideEffectAfter.color, ratio: contrast(sideEffectAfter.color, sideEffectAfter.background) },
    provenance: "browser-proposal-side-effect",
  });
  assert.deepEqual(Object.keys(entry), ["label", "scheme", "foregroundToken", "backgroundToken", "before", "after", "provenance"]);
  // Full precision: the published ratio is never rounded to a display precision,
  // and the entry copies the measured colors instead of aliasing fresh fixtures.
  assert.equal(entry.before.ratio, contrast(sideEffectBefore.color, sideEffectBefore.background));
  assert.notEqual(entry.before.ratio, Number(entry.before.ratio.toFixed(2)));
  assert.notEqual(entry.before.color, sideEffectBefore.color);
  assert.notEqual(entry.after.color, sideEffectAfter.color);
  // Independent achromatic oracle: linear-sRGB luminance is L cubed.
  const oracle = reportSideEffect("primary",
    { color: { l: 1, c: 0, h: 0 }, background: { l: 0, c: 0, h: 0 } },
    { color: { l: 0, c: 0, h: 0 }, background: { l: 0, c: 0, h: 0 } });
  assert.ok(Math.abs(oracle.before.ratio - 21) < 1e-8);
  assert.equal(oracle.after.ratio, 1);
  // Invalid measurements return null instead of throwing: inside the browser
  // verification loop an exception would mark the proposal invalid.
  const invalidColors = [undefined, null, 3, "oklch(0.5 0 0)", [], { l: NaN, c: 0, h: 0 },
    { l: 1.000001, c: 0, h: 0 }, { l: 0.5, c: -0.0001, h: 0 }, { l: 0.5, c: 0, h: Infinity }, { l: 0.5, c: 0 }];
  for (const color of invalidColors) {
    assert.equal(reportSideEffect("primary", { color, background: sideEffectBefore.background }, sideEffectAfter), null, `invalid before color ${JSON.stringify(color)}`);
    assert.equal(reportSideEffect("primary", sideEffectBefore, { color: sideEffectAfter.color, background: color }), null, `invalid after background ${JSON.stringify(color)}`);
  }
  assert.equal(reportSideEffect("primary", undefined, sideEffectAfter), null);
  assert.equal(reportSideEffect("primary", sideEffectBefore, undefined), null);
  assert.equal(reportSideEffect("primary", { color: sideEffectBefore.color }, sideEffectAfter), null);
});

test("dark fill side effects keep the worst case and never alter published verified/checks", () => {
  const darkCanvas = sideEffectBefore.background;
  const far = reportSideEffect("primary", sideEffectBefore, { color: { l: 0.9, c: 0, h: 0 }, background: darkCanvas });
  const near = reportSideEffect("primary", sideEffectBefore, { color: { l: 0.4, c: 0, h: 0 }, background: darkCanvas });
  assert.ok(near.after.ratio < far.after.ratio, "fixture needs a distinguishable worst case");
  assert.equal(worstSideEffect(far, near), near);
  assert.equal(worstSideEffect(near, far), near);
  assert.equal([far, near, far].reduce((previous, current) => worstSideEffect(previous, current), null), near);
  assert.equal(worstSideEffect(null, near), near);
  assert.equal(worstSideEffect(far, null), far);
  assert.equal(worstSideEffect(null, null), null);
  assert.equal(worstSideEffect(far, far), far);
  const checks = Object.freeze([{ label: "dark primary-border-strong / canvas", ratio: 4.61, provenance: "browser-proposal" }]);
  const result = Object.freeze({ valid: true, browsers: 2, checks, sideEffects: Object.freeze([near]) });
  const candidate = Object.freeze({
    id: "browser-dark-fill:primary", title: "Escape hatch", kind: "tuning", impact: "impact", search: "search",
    destination: Object.freeze({ file: "src/styles/tokens/colors-tuning.css", path: "--color-tune-primary-dark", snippet: "--color-tune-primary-dark: oklch(0.5 0.1 32.41);" }),
    changes: Object.freeze([]), issueLabels: Object.freeze([]), css: ":root {}", tuningCss: ":root {}",
  });
  const published = publishedProposal(candidate, result);
  assert.equal(published.verified, true);
  assert.equal(published.checks, checks);
  assert.equal(published.sideEffects, result.sideEffects);
  assert.deepEqual(published.issueLabels, candidate.issueLabels);
  assert.deepEqual(published.destination, candidate.destination);
  assert.equal(published.id, candidate.id);
  assert.equal("css" in published, false);
  assert.equal("tuningCss" in published, false);
  // Absent for other kinds/paths even when side-effect data is present.
  const foreground = { ...candidate, kind: "foreground", destination: { ...candidate.destination, path: "onSolid.primary.dark" } };
  assert.equal("sideEffects" in publishedProposal(foreground, result), false);
  const depth = { ...candidate, id: "browser-neutral-bg-dark", destination: { ...candidate.destination, path: "--color-tune-dark-bg-mix" } };
  assert.equal("sideEffects" in publishedProposal(depth, result), false);
  // Absent when measurements are unavailable, empty or malformed.
  assert.equal("sideEffects" in publishedProposal(candidate, { valid: true, checks }), false);
  assert.equal("sideEffects" in publishedProposal(candidate, { valid: true, checks, sideEffects: [] }), false);
  assert.equal("sideEffects" in publishedProposal(candidate, { valid: true, checks, sideEffects: "none" }), false);
});

test("dark fill side effects measure both neutral backgrounds and keep the worst entry per background", () => {
  const canvas = sideEffectBefore.background;
  const surface = { l: 0.2401, c: 0.0042, h: 88 };
  const canvasEntry = reportSideEffect("primary", sideEffectBefore, sideEffectAfter);
  const surfaceEntry = reportSideEffect("primary",
    { color: sideEffectBefore.color, background: surface },
    { color: sideEffectAfter.color, background: surface }, "--color-surface");
  // The same candidate border on both neutrals: in dark the lighter surface keeps
  // less separation, so it is the worse background of the two.
  assert.equal(canvasEntry.label, "dark primary-border / canvas");
  assert.equal(canvasEntry.backgroundToken, "--color-bg");
  assert.equal(surfaceEntry.label, "dark primary-border / surface");
  assert.equal(surfaceEntry.backgroundToken, "--color-surface");
  assert.equal(surfaceEntry.before.ratio, contrast(sideEffectBefore.color, surface));
  assert.equal(surfaceEntry.after.ratio, contrast(sideEffectAfter.color, surface));
  assert.ok(surfaceEntry.after.ratio < canvasEntry.after.ratio, "fixture needs the surface to be the worse neutral");
  const lighter = reportSideEffect("primary",
    { color: sideEffectBefore.color, background: surface },
    { color: { l: 0.62, c: 0, h: 0 }, background: surface }, "--color-surface");
  const worstSurface = reportSideEffect("primary",
    { color: sideEffectBefore.color, background: surface },
    { color: { l: 0.3, c: 0, h: 0 }, background: surface }, "--color-surface");
  const merged = [canvasEntry, surfaceEntry, lighter, worstSurface].reduce((entries, entry) => mergeSideEffect(entries, entry), []);
  assert.equal(merged.length, 2, "one entry per measured background");
  const keptCanvas = merged.find((entry) => entry.backgroundToken === "--color-bg");
  const keptSurface = merged.find((entry) => entry.backgroundToken === "--color-surface");
  assert.equal(keptCanvas, canvasEntry);
  assert.equal(keptSurface, worstSurface, "the worst after state wins per background");
  assert.ok(worstSurface.after.ratio < lighter.after.ratio && worstSurface.after.ratio < surfaceEntry.after.ratio);
  assert.ok(keptSurface.after.ratio < keptCanvas.after.ratio, "the worst measured neutral is the surface");
  assert.equal(keptSurface.label, "dark primary-border / surface");
  assert.equal(keptCanvas.label, "dark primary-border / canvas");
  assert.equal(mergeSideEffect([worstSurface], lighter)[0], worstSurface, "merge order does not change the worst case");
  const worstCanvas = reportSideEffect("primary", sideEffectBefore,
    { color: { l: 0.3, c: 0, h: 0 }, background: canvas });
  const updated = mergeSideEffect(merged, worstCanvas);
  assert.equal(updated.length, 2);
  assert.equal(updated.find((entry) => entry.backgroundToken === "--color-bg"), worstCanvas, "a worse canvas updates only its own background");
  assert.equal(updated.find((entry) => entry.backgroundToken === "--color-surface"), worstSurface);
  assert.equal(merged.find((entry) => entry.backgroundToken === "--color-bg"), canvasEntry, "aggregation must not mutate the previous list");
  // Only the two measured neutral surfaces have a side-effect background.
  assert.equal(reportSideEffect("primary", sideEffectBefore, sideEffectAfter, "--color-text"), null);
});

// ─── Palette source levers: canvas lightness and dark-blend ───────────────
// Both candidates rewrite src/styles/tokens/palette.css and are verified
// against the edited bytes, regenerated in a temporary root. The oracles below
// replicate the grids and the documented mix contract independently of the
// report implementation.

const CANVAS_PALETTE = `@property --palette-bg {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(.962 .015 88);
  role: canvas;
}

@property --palette-ink {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(.28 .007 3.68);
  role: ink;
}

@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(.62 .16 32.41);
  role: ui;
}`;

const DECLARED_BLEND_PALETTE = CANVAS_PALETTE.replace("  role: ui;", "  role: ui;\n  dark-blend: 30;");
const DEEP_PALETTE = CANVAS_PALETTE.replace("oklch(.62 .16 32.41)", "oklch(.45 .16 32.41)");
const DECORATIVE_PALETTE = `${CANVAS_PALETTE}

@property --palette-spark {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(.72 .18 280);
  role: decorative;
}`;

async function paletteFixture(t, palette) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-palette-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, "src/styles/tokens/palette.css"), palette);
  return root;
}

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

// Integer 0..100 grid, nearest to the active blend first, with the same
// tie-break as the report's grids. The fill formula mirrors the documented
// contract: dark-blend 0..100 mixes 0..28% white into the authored source.
const blendGrid = (current) => Array.from({ length: 101 }, (_, index) => index)
  .sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
const blendFill = (light, blend) => mixOklch(light, { l: 1, c: 0, h: null }, Number((100 - blend * 0.28).toFixed(4)) / 100);

function measuredRow(label, foreground, background, foregroundColor, backgroundColor, target = 4.6, minimum = 4.5) {
  const ratio = contrast(foregroundColor, backgroundColor);
  const status = ratio < minimum ? "below-minimum" : ratio < target ? "below-target" : "pass";
  return { label, foreground, background, foregroundColor, backgroundColor, ratio, target, minimum, kind: "text", status };
}

test("palette dark-blend replaces or inserts one descriptor and refuses ambiguous or malformed blocks", () => {
  assert.deepEqual(readPaletteDarkBlend(CANVAS_PALETTE, "--palette-primary"), { value: null });
  assert.equal(replacePaletteDarkBlend(CANVAS_PALETTE, "--palette-primary", 81), CANVAS_PALETTE.replace("  role: ui;", "  role: ui;\n  dark-blend: 81;"));
  assert.deepEqual(readPaletteDarkBlend(DECLARED_BLEND_PALETTE, "--palette-primary"), { value: 30 });
  assert.equal(replacePaletteDarkBlend(DECLARED_BLEND_PALETTE, "--palette-primary", 86), DECLARED_BLEND_PALETTE.replace("dark-blend: 30;", "dark-blend: 86;"));
  // A single-line block has no own-line role: the insertion stays inline.
  const single = "@property --palette-primary { initial-value: oklch(.62 .16 32.41); role: ui; }";
  assert.equal(replacePaletteDarkBlend(single, "--palette-primary", 50), single.replace("role: ui;", "role: ui; dark-blend: 50;"));
  // Disabled examples are inert: the descriptor counts as missing and the rewrite adds a real line.
  const commented = DECLARED_BLEND_PALETTE.replace("  dark-blend: 30;", "  /* dark-blend: 30; */");
  assert.deepEqual(readPaletteDarkBlend(commented, "--palette-primary"), { value: null });
  assert.equal(replacePaletteDarkBlend(commented, "--palette-primary", 50), commented.replace("  role: ui;", "  role: ui;\n  dark-blend: 50;"));
  // Ambiguous or malformed blocks stay a human decision: no speculative write.
  for (const css of [
    `${CANVAS_PALETTE}\n${CANVAS_PALETTE}`,
    DECLARED_BLEND_PALETTE.replace("  dark-blend: 30;", "  dark-blend: 30;\n  dark-blend: 31;"),
    DECLARED_BLEND_PALETTE.replace("dark-blend: 30;", "dark-blend: red;"),
    DECLARED_BLEND_PALETTE.replace("dark-blend: 30;", "dark-blend: 120;"),
    DECLARED_BLEND_PALETTE.replace("dark-blend: 30;", "dark-blend: ;"),
  ]) {
    assert.equal(readPaletteDarkBlend(css, "--palette-primary"), null, `read must refuse ${JSON.stringify(css.slice(0, 48))}`);
    assert.equal(replacePaletteDarkBlend(css, "--palette-primary", 50), null, `write must refuse ${JSON.stringify(css.slice(0, 48))}`);
  }
  // Insertion needs a readable role anchor; other syntaxes or tokens stay silent.
  const hiddenRole = CANVAS_PALETTE.replace("  role: ui;", "  /* role: ui; */");
  assert.deepEqual(readPaletteDarkBlend(hiddenRole, "--palette-primary"), { value: null });
  assert.equal(replacePaletteDarkBlend(hiddenRole, "--palette-primary", 50), null);
  assert.equal(replacePaletteDarkBlend(":root { --palette-primary: oklch(.62 .16 32.41); }", "--palette-primary", 50), null);
  assert.equal(replacePaletteDarkBlend(CANVAS_PALETTE, "--palette-other", 50), null);
});

test("palette-bg-lightness proposes the nearest canvas lightness that clears the measured neutral margin", async (t) => {
  const root = await paletteFixture(t, CANVAS_PALETTE);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const canvas = { l: 0.962, c: 0.015, h: 88 };
  const surface = { l: 0.944, c: 0.015, h: 88 };
  const muted = { l: 0.54, c: 0.0046, h: 3.68 };
  const tuned = [
    measuredRow("light neutral text / canvas", "--color-text", "--color-bg", { l: 0.28, c: 0.007, h: 3.68 }, canvas),
    measuredRow("light muted text / canvas", "--color-text-muted", "--color-bg", muted, canvas),
    measuredRow("light muted text / surface", "--color-text-muted", "--color-surface", muted, surface),
  ];
  assert.deepEqual(tuned.map((row) => row.status), ["pass", "below-target", "below-minimum"]);
  const states = [{ scheme: "light", preference: "light", tuned, computed: { tokens: new Map([["--color-bg", canvas], ["--color-surface", surface]]) } }];
  const candidates = await reportCandidates(root, analysis, ":root {}", states);
  const candidate = candidates.find((item) => item.id === "palette-bg-lightness");
  assert.ok(candidate, "expected a canvas source proposal");
  // Independent oracle: own 4-decimal grid, surface modelled with the measured shift.
  const shift = surface.l - canvas.l;
  const lightnessGrid = Array.from({ length: 10001 }, (_, index) => index / 10000)
    .sort((a, b) => Math.abs(a - 0.962) - Math.abs(b - 0.962) || a - b);
  const expected = lightnessGrid.find((l) => tuned.every((pair) => contrast(pair.foregroundColor,
    pair.background === "--color-bg" ? { l, c: canvas.c, h: canvas.h } : { l: l + shift, c: surface.c, h: surface.h }) >= margin(pair)));
  assert.ok(Number.isFinite(expected) && expected > 0.962, "fixture needs a reachable lighter canvas");
  assert.equal(candidate.kind, "palette-source");
  assert.deepEqual(candidate.destination, {
    file: "src/styles/tokens/palette.css", path: "--palette-bg",
    snippet: `initial-value: ${oklch({ l: expected, c: 0.015, h: 88 })};`,
  });
  assert.deepEqual(candidate.changes, [{ label: "--palette-bg", before: { l: 0.962, c: 0.015, h: 88 }, after: { l: expected, c: 0.015, h: 88 } }]);
  assert.deepEqual(candidate.issueLabels, ["light muted text / canvas", "light muted text / surface"]);
  assert.equal(candidate.tuningCss, ":root {}");
  const rewritten = replacePaletteSource(CANVAS_PALETTE, "--palette-bg", oklch({ l: expected, c: 0.015, h: 88 }));
  const trial = await analyzeColorTokens({ root, config: analysis.config, suggest: false }, rewritten);
  assert.equal(stripComments(candidate.css), stripComments(trial.css), "the trial must regenerate from the rewritten palette");
  // Palette source first: the tuning candidate stays an alternative.
  const tuning = candidates.findIndex((item) => item.id === "browser-neutral-surface");
  assert.ok(tuning !== -1, "the tuning alternative must be offered for the same surface failure");
  assert.ok(candidates.indexOf(candidate) < tuning, "the palette source must precede the tuning candidate");
});

test("palette-bg-lightness stays silent when the canvas cannot be rewritten or no lightness resolves", async (t) => {
  const root = await paletteFixture(t, CANVAS_PALETTE);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const canvas = { l: 0.962, c: 0.015, h: 88 };
  const surface = { l: 0.944, c: 0.015, h: 88 };
  const muted = { l: 0.54, c: 0.0046, h: 3.68 };
  const tuned = [
    measuredRow("light muted text / canvas", "--color-text-muted", "--color-bg", muted, canvas),
    measuredRow("light muted text / surface", "--color-text-muted", "--color-surface", muted, surface),
  ];
  const states = [{ scheme: "light", preference: "light", tuned, computed: { tokens: new Map([["--color-bg", canvas], ["--color-surface", surface]]) } }];
  // Ambiguous source: the rewrite must not guess which @property to edit.
  const ambiguous = { ...analysis, inputs: { ...analysis.inputs, paletteCss: `${CANVAS_PALETTE}\n${CANVAS_PALETTE}` } };
  const ambiguousCandidates = await reportCandidates(root, ambiguous, ":root {}", states);
  assert.equal(ambiguousCandidates.some((item) => item.id === "palette-bg-lightness"), false);
  // No lightness on the grid clears a 21:1 requirement from a mid-tone foreground.
  const impossible = [measuredRow("light neutral text / canvas", "--color-text", "--color-bg", { l: 0.5, c: 0, h: 0 }, canvas, 21, 21)];
  assert.equal(impossible[0].status, "below-minimum");
  const rejections = [];
  const impossibleCandidates = await reportCandidates(root, analysis, ":root {}", [{ scheme: "light", preference: "light", tuned: impossible, computed: { tokens: new Map([["--color-bg", canvas], ["--color-surface", surface]]) } }], rejections);
  assert.equal(impossibleCandidates.some((item) => item.id === "palette-bg-lightness"), false);
  assert.ok(rejections.some((entry) => entry.id === "palette-bg-lightness" && entry.file === "src/styles/tokens/palette.css" && /nessuna luminosità/.test(entry.reason)), "a discarded palette candidate must publish its reason");
  // Without the browser-resolved neutrals the canvas move is not measurable.
  const blind = [{ scheme: "light", preference: "light", tuned: [tuned[0]] }];
  assert.equal((await reportCandidates(root, analysis, ":root {}", blind)).some((item) => item.id === "palette-bg-lightness"), false);
});

test("palette-dark-blend replaces the declared descriptor and is offered before the tuning escape hatch", async (t) => {
  const root = await paletteFixture(t, DECLARED_BLEND_PALETTE);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  assert.equal(analysis.model.identities.primary.darkBlend, 30, "fixture must declare the descriptor");
  const light = serializedColor(fitToSrgb(analysis.authoredTokens["palette-primary"]));
  const fill = blendFill(light, 30);
  const tuned = [measuredRow("dark on-primary / primary", "--color-primary-ink", "--color-primary", { l: 0.3, c: 0, h: 0 }, fill)];
  assert.equal(tuned[0].status, "below-minimum", "fixture needs a dark fill shortfall");
  const candidates = await reportCandidates(root, analysis, ":root {}", [{ scheme: "dark", preference: "dark", tuned }]);
  const candidate = candidates.find((item) => item.id === "palette-dark-blend:primary");
  assert.ok(candidate, "expected a dark-blend palette proposal");
  const expected = blendGrid(30).find((blend) => contrast(tuned[0].foregroundColor, blendFill(light, blend)) >= margin(tuned[0]));
  assert.ok(Number.isInteger(expected) && expected > 30, "fixture needs a reachable lighter dark fill");
  assert.equal(candidate.kind, "palette-source");
  assert.deepEqual(candidate.destination, { file: "src/styles/tokens/palette.css", path: "dark-blend", snippet: `dark-blend: ${expected};` });
  assert.deepEqual(candidate.changes, [{ label: "--color-primary (dark)", before: fill, after: blendFill(light, expected) }]);
  assert.deepEqual(candidate.issueLabels, ["dark on-primary / primary"]);
  assert.equal(candidate.tuningCss, ":root {}");
  const rewritten = replacePaletteDarkBlend(DECLARED_BLEND_PALETTE, "--palette-primary", expected);
  assert.equal(rewritten, DECLARED_BLEND_PALETTE.replace("dark-blend: 30;", `dark-blend: ${expected};`));
  const trial = await analyzeColorTokens({ root, config: analysis.config, suggest: false }, rewritten);
  assert.equal(stripComments(candidate.css), stripComments(trial.css), "the trial must regenerate from the rewritten palette");
  const escape = candidates.findIndex((item) => item.id === "browser-dark-fill:primary");
  assert.ok(escape !== -1 && candidates.indexOf(candidate) < escape, "the palette source must precede the tuning escape hatch");
});

test("palette-dark-blend inserts the missing descriptor next to role and regenerates the model", async (t) => {
  const root = await paletteFixture(t, DEEP_PALETTE);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const light = serializedColor(fitToSrgb(analysis.authoredTokens["palette-primary"]));
  // Without the descriptor the effective blend is the adaptive fallback (0.5 + L/2).
  const reference = ((1 - Number(((0.5 + light.l * 0.5) * 100).toFixed(4)) / 100) / 0.28) * 100;
  const fill = blendFill(light, reference);
  const tuned = [measuredRow("dark on-primary / primary", "--color-primary-ink", "--color-primary", { l: 0.85, c: 0, h: 0 }, fill)];
  assert.equal(tuned[0].status, "below-minimum", "fixture needs a dark fill shortfall");
  const candidates = await reportCandidates(root, analysis, ":root {}", [{ scheme: "dark", preference: "dark", tuned }]);
  const candidate = candidates.find((item) => item.id === "palette-dark-blend:primary");
  assert.ok(candidate, "expected a dark-blend proposal from the adaptive reference");
  const expected = blendGrid(reference).find((blend) => contrast(tuned[0].foregroundColor, blendFill(light, blend)) >= margin(tuned[0]));
  assert.ok(Number.isInteger(expected) && expected < reference, "fixture needs a reachable darker dark fill");
  assert.deepEqual(candidate.destination, { file: "src/styles/tokens/palette.css", path: "dark-blend", snippet: `dark-blend: ${expected};` });
  assert.deepEqual(candidate.changes[0].after, blendFill(light, expected));
  assert.deepEqual(candidate.issueLabels, ["dark on-primary / primary"]);
  // The missing descriptor is inserted next to role: the rewrite path is the insertion.
  const rewritten = replacePaletteDarkBlend(DEEP_PALETTE, "--palette-primary", expected);
  assert.equal(rewritten, DEEP_PALETTE.replace("  role: ui;", `  role: ui;\n  dark-blend: ${expected};`));
  assert.deepEqual(readPaletteDarkBlend(rewritten, "--palette-primary"), { value: expected });
  const trial = await analyzeColorTokens({ root, config: analysis.config, suggest: false }, rewritten);
  assert.equal(stripComments(candidate.css), stripComments(trial.css));
  const escape = candidates.findIndex((item) => item.id === "browser-dark-fill:primary");
  assert.ok(escape !== -1 && candidates.indexOf(candidate) < escape);
});

test("palette-dark-blend stays silent for decorative roles, unreachable searches and unwritable palettes", async (t) => {
  const root = await paletteFixture(t, DECORATIVE_PALETTE);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const decorative = [measuredRow("dark on-spark / spark", "--color-spark-ink", "--color-spark", { l: 0.5, c: 0, h: 0 }, { l: 0.55, c: 0.12, h: 280 })];
  assert.equal(decorative[0].status, "below-minimum");
  const decorativeCandidates = await reportCandidates(root, analysis, ":root {}", [{ scheme: "dark", preference: "dark", tuned: decorative }]);
  assert.equal(decorativeCandidates.some((item) => item.id.startsWith("palette-dark-blend:")), false, "dark-blend exists only for ui/feedback roles");
  const declaredRoot = await paletteFixture(t, DECLARED_BLEND_PALETTE);
  const declaredAnalysis = await analyzeColorTokens({ root: declaredRoot, suggest: false });
  const light = serializedColor(fitToSrgb(declaredAnalysis.authoredTokens["palette-primary"]));
  const fill = blendFill(light, 30);
  // No integer blend reaches a light companion on this mid-tone source.
  const unreachable = [measuredRow("dark on-primary / primary", "--color-primary-ink", "--color-primary", { l: 0.97, c: 0, h: 0 }, fill)];
  assert.equal(unreachable[0].status, "below-minimum");
  const searched = await reportCandidates(declaredRoot, declaredAnalysis, ":root {}", [{ scheme: "dark", preference: "dark", tuned: unreachable }]);
  assert.equal(searched.some((item) => item.id === "palette-dark-blend:primary"), false);
  // Writable search, but no safe rewrite target: no speculative write.
  const reachable = [measuredRow("dark on-primary / primary", "--color-primary-ink", "--color-primary", { l: 0.3, c: 0, h: 0 }, fill)];
  assert.equal(reachable[0].status, "below-minimum");
  for (const paletteCss of [
    `${DECLARED_BLEND_PALETTE}\n${DECLARED_BLEND_PALETTE}`,
    DECLARED_BLEND_PALETTE.replace("dark-blend: 30;", "dark-blend: red;"),
    CANVAS_PALETTE.replace("  role: ui;", "  /* role: ui; */"),
  ]) {
    const unwritable = { ...declaredAnalysis, inputs: { ...declaredAnalysis.inputs, paletteCss } };
    const silent = await reportCandidates(declaredRoot, unwritable, ":root {}", [{ scheme: "dark", preference: "dark", tuned: reachable }]);
    assert.equal(silent.some((item) => item.id === "palette-dark-blend:primary"), false, `expected silence for ${JSON.stringify(paletteCss.slice(0, 48))}`);
  }
});

test("capture adopts an effective config file while keeping the legacy default path", async (t) => {
  const root = await fixture(t);
  const config = { palette: "src/styles/tokens/palette.css", output: "src/styles/tokens/colors.css" };
  const legacy = await captureReportInputs(root, config);
  assert.equal(legacy.files.config, "smart-colors.config.mjs", "the legacy two-argument call keeps the frozen default config name");
  assert.deepEqual(await captureReportInputs(root, config, {}), legacy, "an empty option bag is byte-for-byte the legacy call");

  await writeFile(path.join(root, "custom.config.mjs"), "export default {};");
  const adopted = await captureReportInputs(root, config, { configFile: "custom.config.mjs" });
  assert.equal(adopted.files.config, "custom.config.mjs");
  const configInput = adopted.inputs.find(([name]) => name === "config");
  assert.deepEqual(configInput.slice(0, 2), ["config", "custom.config.mjs"]);
  assert.equal(configInput[3], true);
  assert.match(configInput[4], /^[a-f\d]{64}$/);
});

test("capture always records the motion output as a protected input, even when motion is disabled", async (t) => {
  const root = await fixture(t);
  const captured = await captureReportInputs(root);
  assert.equal(captured.files.motion, "src/styles/colors-motion.css");
  const motion = captured.inputs.find(([name]) => name === "motion");
  assert.deepEqual(motion.slice(0, 2), ["motion", "src/styles/colors-motion.css"]);
  assert.equal(motion[3], false);
  assert.equal(motion[4], null);
  const configured = await captureReportInputs(root, {
    palette: "src/styles/tokens/palette.css", output: "src/styles/tokens/colors.css",
    motion: { enabled: false, output: "src/styles/custom-motion.css" },
  });
  assert.equal(configured.files.motion, "src/styles/custom-motion.css");
});

test("capture reports an existing unreadable input instead of treating it as absent", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "src/styles/tokens/colors-tuning.css"), { recursive: true });
  await assert.rejects(() => captureReportInputs(root), (error) => {
    assert.equal(error.code, "SMART_COLORS_INPUT_UNREADABLE");
    assert.match(error.message, /"tuning"/);
    return true;
  });
});
