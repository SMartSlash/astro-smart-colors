import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { contrast, fitToSrgb, mixOklch, serializedColor } from "../src/color-math.mjs";
import { analyzeColorTokens, generateColorTokens } from "../src/generate-colors.mjs";
import { parseOklch } from "../src/parse-palette.mjs";

function palette(primary = "0.62 0.16 32", canvas = "0.962 0.015 88") {
  return [
    ["canvas", "canvas", canvas],
    ["ink", "ink", "0.28 0.007 3.68"],
    ["primary", "ui", primary],
    ["info", "feedback", "0.56 0.12 260"],
    ["spark", "decorative", "0.88 0.12 85"],
  ].map(([name, role, channels]) => `@property --palette-${name} {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(${channels});
  role: ${role};
}`).join("\n\n");
}

function legacyPalette(primary = "0.62 0.16 32") {
  return `:root {
  /* @role canvas */
  --palette-canvas: oklch(0.962 0.015 88);
  /* @role ink */
  --palette-ink: oklch(0.28 0.007 3.68);
  /* @role ui */
  --palette-primary: oklch(${primary});
  /* @role feedback */
  --palette-info: oklch(0.56 0.12 260);
  /* @role decorative */
  --palette-spark: oklch(0.88 0.12 85);
}`;
}

async function fixture(t, paletteCss = palette(), config = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-model-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "palette.css"), paletteCss);
  await writeFile(path.join(root, "colors.css"), "/* existing colors */\n");
  await writeFile(path.join(root, "motion.css"), "/* existing motion */\n");
  await writeFile(path.join(root, "settings.mjs"), `export default ${JSON.stringify({ palette: "palette.css", output: "colors.css", ...config })};\n`);
  return { root, configFile: "settings.mjs" };
}

async function snapshot(root) {
  return Promise.all(["palette.css", "settings.mjs", "colors.css", "motion.css"].map((file) => readFile(path.join(root, file), "utf8")));
}

function declarations(css) {
  return new Map([...css.matchAll(/(?:^|\n)\s*(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi)].map(([, name, value]) => [name, value.trim()]));
}

function splitArguments(value) {
  let depth = 0;
  let start = 0;
  const parts = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    if (value[index] === ")") depth -= 1;
    if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  return [...parts, value.slice(start).trim()];
}

// Resolve emitted static-theme literals and native opaque control mixes. Never
// gamut-map or serialize the resulting native intermediates a second time.
function resolve(values, expression, scheme) {
  const match = /^(light-dark|var|color-mix)\(([\s\S]*)\)$/.exec(expression);
  if (!match) {
    const missingHue = /^oklch\(([\d.]+)\s+([\d.]+)\s+none\)$/.exec(expression);
    if (missingHue) return { l: Number(missingHue[1]), c: Number(missingHue[2]), h: null };
    const parsed = parseOklch(expression);
    assert.deepEqual(parsed.errors, []);
    return parsed.source;
  }
  const args = splitArguments(match[2]);
  if (match[1] === "light-dark") return resolve(values, args[scheme === "light" ? 0 : 1], scheme);
  if (match[1] === "var") {
    const value = values.get(args[0]) ?? args[1];
    assert.ok(value, `Missing ${args[0]}`);
    return resolve(values, value, scheme);
  }
  assert.equal(args[0], "in oklch");
  const weighted = /^(.*)\s+(\d+(?:\.\d+)?)%$/.exec(args[1]);
  assert.ok(weighted);
  return mixOklch(resolve(values, weighted[1], scheme), resolve(values, args[2], scheme), Number(weighted[2]) / 100);
}

function assertFacts(analysis) {
  assert.ok(analysis.diagnostics.length > 0);
  const labels = new Set();
  for (const fact of analysis.diagnostics) {
    assert.deepEqual(Object.keys(fact).sort(), ["label", "scheme", "foregroundToken", "backgroundToken", "foreground", "background", "ratio", "target", "minimum", "kind", "status", "severity", "provenance"].sort());
    assert.ok(!labels.has(fact.label), `Duplicate ${fact.label}`);
    labels.add(fact.label);
    assert.ok(["light", "dark"].includes(fact.scheme));
    assert.match(fact.foregroundToken, /^--color-/);
    assert.match(fact.backgroundToken, /^--color-/);
    for (const color of [fact.foreground, fact.background]) {
      assert.deepEqual(Object.keys(color).sort(), ["c", "h", "l"]);
      assert.ok(Object.values(color).every(Number.isFinite));
    }
    assert.equal(fact.ratio, contrast(fact.foreground, fact.background));
    assert.ok(Number.isFinite(fact.ratio));
    assert.equal(fact.status, fact.ratio < fact.minimum ? "below-minimum" : fact.ratio < fact.target ? "below-target" : "pass");
    assert.ok(["error", "warning"].includes(fact.severity));
    assert.ok(["text", "non-text"].includes(fact.kind));
    assert.equal(fact.provenance, "generated");
    if (fact.status !== "pass") {
      const messages = fact.severity === "error" ? analysis.errors : analysis.warnings;
      assert.ok(messages.some((message) => message.startsWith(`${fact.label} is `)), `Missing legacy message for ${fact.label}`);
    }
  }
  assert.equal(analysis.errors.length, analysis.diagnostics.filter((fact) => fact.status !== "pass" && fact.severity === "error").length);
  assert.equal(analysis.model.warnings.length, analysis.diagnostics.filter((fact) => fact.status !== "pass" && fact.severity === "warning").length);
}

function assertProposal(proposal) {
  assert.ok(proposal.id);
  assert.ok(["foreground", "palette-source"].includes(proposal.kind));
  assert.ok(proposal.destination.file && proposal.destination.path && proposal.destination.snippet);
  assert.ok(proposal.impact && proposal.search);
  assert.ok(proposal.changes.length > 0);
  for (const change of proposal.changes) {
    assert.ok(change.label);
    assert.ok(Object.values(change.before).every(Number.isFinite));
    assert.ok(Object.values(change.after).every(Number.isFinite));
  }
  assert.ok(proposal.checks.length > 0);
  assert.ok(!proposal.checks.some((fact) => fact.status !== "pass" && fact.severity === "error"));
}

test("internal analysis is read-only and its structured checks match every emitted static pair", async (t) => {
  const options = await fixture(t, palette(), { derivation: { dark: { mode: "static" } }, motion: { enabled: true, output: "motion.css" } });
  const before = await snapshot(options.root);
  const analysis = await analyzeColorTokens({ ...options, suggest: false });
  const report = await generateColorTokens({ ...options, check: true, suggest: false });
  assertFacts(analysis);
  assert.equal(analysis.diagnostics.length, 82);
  const values = declarations(analysis.css);
  for (const fact of analysis.diagnostics) {
    for (const [color, token] of [[fact.foreground, fact.foregroundToken], [fact.background, fact.backgroundToken]]) {
      const emitted = resolve(values, values.get(token), fact.scheme);
      for (const channel of ["l", "c", "h"]) {
        assert.ok(Math.abs(color[channel] - emitted[channel]) < 1e-12, `${fact.label}: emitted ${token}.${channel}`);
      }
    }
  }
  assert.equal(analysis.css, report.css);
  assert.equal(analysis.motionCss, report.motionCss);
  assert.ok(analysis.motionCss.includes("@property"));
  assert.deepEqual(analysis.config, report.config);
  assert.deepEqual(analysis.warnings, report.warnings);
  assert.deepEqual(analysis.model.warnings, analysis.warnings);
  assert.deepEqual(analysis.proposals, []);
  assert.deepEqual(analysis.suggestions, []);
  assert.ok(analysis.palette["palette-primary"]);
  assert.deepEqual(analysis.authoredTokens["palette-primary"], { l: 0.62, c: 0.16, h: 32 });
  assert.deepEqual(await snapshot(options.root), before);
});

test("native relative identity mixes retain their raw precision in inspection checks", async (t) => {
  const options = await fixture(t, palette("0.54 0.108 198"));
  const analysis = await analyzeColorTokens({ ...options, suggest: false });
  assertFacts(analysis);
  const fact = analysis.diagnostics.find((item) => item.label === "dark on-primary / primary");
  const values = declarations(analysis.css);
  const native = resolve(values, values.get("--color-primary"), "dark");
  assert.deepEqual(fact.background, native);
  assert.deepEqual(fact.background, analysis.model.identities.primary.dark);
  assert.notDeepEqual(fact.background, serializedColor(fact.background));
  assert.equal(fact.ratio, contrast(fact.foreground, native));
});

test("unattainable contrast remains inspectable with finite CSS while build/check reject before either output write", async (t) => {
  const options = await fixture(t, palette(), {
    contrast: { text: 21, maxIdentity: 21, darkRichness: 1 },
    motion: { enabled: true, output: "motion.css" },
  });
  const before = await snapshot(options.root);
  const analysis = await analyzeColorTokens(options);
  assertFacts(analysis);
  assert.ok(analysis.errors.length > 0);
  assert.ok(analysis.diagnostics.some((fact) => fact.status !== "pass" && fact.severity === "error"));
  assert.match(analysis.css, /:root\s*\{/);
  assert.doesNotMatch(analysis.css, /\b(?:NaN|Infinity)\b/);
  assert.doesNotMatch(analysis.motionCss, /\b(?:NaN|Infinity)\b/);
  assert.deepEqual(analysis.proposals, [], "On-solid advice cannot repair a strict text-contract failure.");
  const expected = `Smart Colors generated an invalid contrast contract:\n${analysis.errors.map((error) => `- ${error}`).join("\n")}`;
  for (const check of [false, true]) {
    await assert.rejects(generateColorTokens({ ...options, check }), (error) => error.message === expected);
    assert.deepEqual(await snapshot(options.root), before);
  }
});

test("analysis does not suppress invalid input, I/O errors or source/output guards", async (t) => {
  const options = await fixture(t);
  const before = await snapshot(options.root);
  await assert.rejects(analyzeColorTokens({ ...options, inlineConfig: { onSolid: { primary: { light: "oklch(0.5 0 0 / 0.5)" } } } }), /Smart Colors validation failed/);
  await assert.rejects(analyzeColorTokens({ ...options, inlineConfig: { palette: "missing.css" } }), { code: "ENOENT" });
  await assert.rejects(analyzeColorTokens({ ...options, inlineConfig: { output: "palette.css" } }));
  assert.deepEqual(await snapshot(options.root), before);
});

test("strict all-background checks report an impossible common foreground rather than a last-background pass", async (t) => {
  const options = await fixture(t, palette("0.62 0.16 32", "0.56 0 88"), { derivation: { dark: { mode: "static" } } });
  const analysis = await analyzeColorTokens({ ...options, suggest: false });
  assertFacts(analysis);
  const pairs = analysis.diagnostics.filter((fact) => fact.scheme === "light" && fact.foregroundToken === "--color-primary-text");
  assert.equal(pairs.length, 4);
  assert.ok(pairs.some((fact) => fact.status !== "pass" && fact.severity === "error"));
  assert.ok(analysis.errors.length > 0);
  await assert.rejects(generateColorTokens({ ...options, check: true, suggest: false }), /invalid contrast contract/);
});

test("minimum-only shortfalls stay warnings in structured and CLI diagnostics", async (t) => {
  const options = await fixture(t, palette(), { contrast: { text: 3, onColor: 3, darkRichness: 1 }, derivation: { dark: { mode: "static" } } });
  const analysis = await analyzeColorTokens({ ...options, suggest: false });
  assertFacts(analysis);
  const fact = analysis.diagnostics.find((item) => item.label === "light muted text / canvas");
  assert.ok(fact.ratio >= fact.target && fact.ratio < fact.minimum);
  assert.equal(fact.severity, "warning");
  assert.equal(fact.status, "below-minimum");
  assert.deepEqual(analysis.errors, []);
});

test("structured on-solid checks use exact thresholds without a permissive epsilon", async (t) => {
  const options = await fixture(t, palette(), { onSolid: { info: { light: "oklch(0.9944 0 0)" } } });
  const initial = await analyzeColorTokens({ ...options, suggest: false });
  const label = "light info-on-solid / solid";
  const ratio = initial.diagnostics.find((fact) => fact.label === label).ratio;
  const exact = await analyzeColorTokens({ ...options, suggest: false, inlineConfig: { contrast: { onColor: ratio } } });
  const shortfall = await analyzeColorTokens({ ...options, suggest: false, inlineConfig: { contrast: { onColor: ratio + Number.EPSILON * 8 } } });
  assert.equal(exact.diagnostics.find((fact) => fact.label === label).status, "pass");
  assert.equal(shortfall.diagnostics.find((fact) => fact.label === label).status, "below-target");
  assertFacts(shortfall);
});

test("foreground proposals share CLI advice and carry full regeneration checks without editing inputs", async (t) => {
  const options = await fixture(t, palette("0.6238 0.16 32"), { onSolid: { info: { light: "oklch(0.99 0 0)" } } });
  const before = await snapshot(options.root);
  const analysis = await analyzeColorTokens(options);
  const proposal = analysis.proposals.find((item) => item.identity === "info" && item.scheme === "light");
  assertProposal(proposal);
  assert.equal(proposal.kind, "foreground");
  assert.deepEqual(proposal.destination, { file: "settings.mjs", path: "onSolid.info.light", snippet: 'onSolid: { "info": { light: "oklch(0.9944 0 0)" } }' });
  assert.equal(proposal.changes[0].label, "--color-info-on-solid (light)");
  assert.deepEqual(proposal.changes[0].after, { l: 0.9944, c: 0, h: 0 });
  assert.ok(analysis.suggestions.some((text) => text.includes(proposal.destination.snippet)));
  const after = proposal.changes[0].after;
  const value = `oklch(${after.l} ${after.c} ${after.h})`;
  const fixed = await analyzeColorTokens({ ...options, suggest: false, inlineConfig: { onSolid: { info: { light: value } } } });
  assert.deepEqual(proposal.checks, fixed.diagnostics);
  const report = await generateColorTokens({ ...options, check: true });
  assert.deepEqual(report.suggestions, analysis.suggestions);
  assert.deepEqual(await snapshot(options.root), before);
});

test("nearest source advice re-selects the automatic foreground: .5838 -> .6057, not .5617", async (t) => {
  const options = await fixture(t, palette("0.5838 0 0"), { derivation: { dark: { mode: "static" } } });
  const before = await snapshot(options.root);
  const analysis = await analyzeColorTokens(options);
  const proposal = analysis.proposals.find((item) => item.identity === "primary" && item.scheme === "light");
  assertProposal(proposal);
  assert.equal(proposal.kind, "palette-source");
  assert.deepEqual(proposal.changes[0], { label: "--palette-primary", before: { l: 0.5838, c: 0, h: 0 }, after: { l: 0.6057, c: 0, h: 0 } });
  assert.deepEqual(proposal.destination, { file: "palette.css", path: "@property --palette-primary / initial-value", snippet: "initial-value: oklch(0.6057 0 0);" });
  assert.ok(analysis.suggestions.some((text) => text.includes("oklch(0.5838 0 0) -> oklch(0.6057 0 0)")));
  assert.deepEqual(await snapshot(options.root), before);

  // Exhaust all closer source-grid points. For this narrow luminance interval,
  // neither endpoint can pass; an interior foreground is bounded by the contrast
  // between solid and hover and cannot pass either. No full regeneration is skipped
  // based on the old foreground or the solver's selection heuristic.
  const distance = Math.abs(0.6057 - 0.5838);
  for (let index = 0; index <= 10000; index += 1) {
    const l = index / 10000;
    if (Math.abs(l - 0.5838) >= distance) continue;
    const solid = serializedColor(fitToSrgb({ l, c: 0, h: 0 }));
    const hover = serializedColor(fitToSrgb({ ...solid, l: solid.l - 0.04 }));
    for (const endpoint of [0, 1]) {
      assert.ok(Math.min(contrast({ l: endpoint, c: 0, h: 0 }, solid), contrast({ l: endpoint, c: 0, h: 0 }, hover)) < 4.62);
    }
    assert.ok(contrast(solid, hover) < 4.62);
  }
  await writeFile(path.join(options.root, "palette.css"), palette("0.6057 0 0"));
  const fixed = await analyzeColorTokens({ ...options, suggest: false });
  assert.deepEqual(proposal.checks, fixed.diagnostics);
  assert.deepEqual(fixed.warnings, []);
  assert.deepEqual(fixed.errors, []);
  const regenerated = await generateColorTokens({ ...options, suggest: false });
  assert.equal(regenerated.css, fixed.css);
  assert.ok(fixed.diagnostics.filter((fact) => fact.foregroundToken === "--color-primary-on-solid" && fact.scheme === "light").every((fact) => fact.ratio >= 4.62));
});

test("legacy source proposal and CLI target the active :root declaration and the snippet re-inspects correctly", async (t) => {
  for (const [name, source, expected, disabledExamples] of [
    ["legacy declaration", "0.62 0.16 32", "0.6238 0.16 32", ""],
    ["commented property examples stay inactive", "0.5838 0 0", "0.6057 0 0", `/* @property --palette-retired { initial-value: oklch(0.8 0 0); role: ui; } */
/*
@property --palette-primary {
  initial-value: oklch(0.1 0 0);
  role: ui;
}
*/
`],
  ]) {
    await t.test(name, async (t) => {
      const paletteCss = disabledExamples + legacyPalette(source);
      const config = { derivation: { dark: { mode: "static" } } };
      const options = await fixture(t, paletteCss, config);
      const before = await snapshot(options.root);
      const analysis = await analyzeColorTokens(options);
      const proposal = analysis.proposals.find((item) => item.identity === "primary" && item.scheme === "light");
      assertProposal(proposal);
      assert.equal(proposal.kind, "palette-source");
      assert.deepEqual(proposal.destination, {
        file: "palette.css", path: ":root / --palette-primary", snippet: `--palette-primary: oklch(${expected});`,
      });
      const advice = analysis.suggestions.find((text) => text.startsWith("primary (light):"));
      assert.ok(advice.includes("Optional source adjustment in palette.css, :root, --palette-primary:"));
      assert.ok(advice.includes(proposal.destination.snippet));
      assert.doesNotMatch(advice, /@property|initial-value/);
      const report = await generateColorTokens({ ...options, check: true });
      assert.deepEqual(report.suggestions, analysis.suggestions);
      assert.deepEqual(await snapshot(options.root), before);

      const propertyOptions = await fixture(t, `/* :root { --palette-primary: oklch(0.1 0 0); } */\n${palette(source)}`, config);
      const propertyAnalysis = await analyzeColorTokens(propertyOptions);
      assert.deepEqual(analysis.diagnostics, propertyAnalysis.diagnostics, "Source syntax must not change any contrast fact.");
      assert.equal(analysis.css, propertyAnalysis.css);
      const propertyProposal = propertyAnalysis.proposals.find((item) => item.identity === "primary" && item.scheme === "light");
      assert.deepEqual(propertyProposal.destination, {
        file: "palette.css", path: "@property --palette-primary / initial-value", snippet: `initial-value: oklch(${expected});`,
      });
      const propertyAdvice = propertyAnalysis.suggestions.find((text) => text.startsWith("primary (light):"));
      assert.ok(propertyAdvice.includes(`Optional source adjustment in palette.css, @property --palette-primary, initial-value:\n  oklch(${source}) -> oklch(${expected})\n`));
      assert.doesNotMatch(propertyAdvice, /:root|\n  --palette-primary:/);
      assert.deepEqual(proposal.checks, propertyProposal.checks);

      const declaration = `  --palette-primary: oklch(${source});`;
      assert.equal(paletteCss.split(declaration).length, 2);
      const edited = paletteCss.replace(declaration, `  ${proposal.destination.snippet}`);
      await writeFile(path.join(options.root, "palette.css"), edited);
      const fixed = await analyzeColorTokens({ ...options, suggest: false });
      assert.deepEqual(fixed.diagnostics, proposal.checks);
      assert.deepEqual(fixed.errors, []);
      assert.deepEqual(fixed.warnings, []);
      assert.ok(fixed.diagnostics.filter((fact) => fact.foregroundToken === "--color-primary-on-solid").every((fact) => fact.ratio >= analysis.config.contrast.onColor + 0.02));
      const after = await snapshot(options.root);
      assert.equal(after[0], edited);
      assert.deepEqual(after.slice(1), before.slice(1));
    });
  }
});

test("foreground advice names the legacy fill source without inventing an @property location", async (t) => {
  const options = await fixture(t, `/* @property --ignored {} */\n${legacyPalette("0.6238 0.16 32")}`, {
    onSolid: { info: { light: "oklch(0.99 0 0)" } },
  });
  const before = await snapshot(options.root);
  const analysis = await analyzeColorTokens(options);
  const proposal = analysis.proposals.find((item) => item.identity === "info" && item.scheme === "light");
  assertProposal(proposal);
  assert.equal(proposal.kind, "foreground");
  assert.equal(proposal.destination.path, "onSolid.info.light");
  const advice = analysis.suggestions.find((text) => text.startsWith("info (light):"));
  assert.ok(advice.includes("Fill source: palette.css, :root, --palette-info, authored"));
  assert.doesNotMatch(advice, /@property|initial-value/);
  const report = await generateColorTokens({ ...options, check: true });
  assert.deepEqual(report.suggestions, analysis.suggestions);
  assert.deepEqual(await snapshot(options.root), before);
});

test("root canonical declarations remain unchanged and internal analysis does not regenerate project files", async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const output = path.join(root, "src/styles/tokens/colors.css");
  const before = await readFile(output, "utf8");
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const entries = [...declarations(analysis.css)].sort(([a], [b]) => a.localeCompare(b));
  assert.equal(entries.length, 315);
  assert.equal(createHash("sha256").update(JSON.stringify(entries)).digest("hex"), "3deae7b57faa61c437f68b5cc9290f38dfd6a43df8884392fc1c97b949989666");
  assert.equal(await readFile(output, "utf8"), before);
});

test("watcher suggest:false benchmark fixture skips advice without changing colors or contrast checks", { timeout: 15000 }, async (t) => {
  const options = await fixture(t, palette(), { contrast: { onColor: 21, maxIdentity: 21, darkRichness: 1 } });
  const before = await snapshot(options.root);
  const start = performance.now();
  let disabled;
  for (let index = 0; index < 10; index += 1) {
    disabled = await analyzeColorTokens({ ...options, suggest: false });
    assert.deepEqual(disabled.proposals, []);
    assert.deepEqual(disabled.suggestions, []);
  }
  const disabledMs = performance.now() - start;
  const adviceStart = performance.now();
  const enabled = await analyzeColorTokens(options);
  const adviceMs = performance.now() - adviceStart;
  assert.ok(enabled.suggestions.length > 0);
  assert.equal(enabled.css, disabled.css);
  assert.deepEqual(enabled.diagnostics, disabled.diagnostics);
  assert.deepEqual(enabled.warnings, disabled.warnings);
  assert.deepEqual(await snapshot(options.root), before);
  t.diagnostic(`Unattainable 21:1 advice fixture: suggest:false ${(disabledMs / 10).toFixed(2)} ms/analysis (10 runs); enabled ${adviceMs.toFixed(2)} ms. Timing is informational, not a machine-dependent pass threshold.`);
});
