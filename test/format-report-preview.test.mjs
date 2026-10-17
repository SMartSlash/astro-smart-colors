import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { formatContrastReportHtml, prepareContrastReport } from "../src/format-report-html.mjs";
import { formatContrastPreviewHtml } from "../src/format-report-preview.mjs";
import { writeContrastReport } from "../src/report-artifact.mjs";

const MARKER = "<!-- smart-colors-report:v1 -->";
const color = (l = 0.5, c = 0.1, h = 350) => ({ l, c, h });
const statusFor = (ratio, target, minimum) => ratio < minimum ? "below-minimum" : ratio < target ? "below-target" : "pass";

function diagnostic(overrides = {}) {
  const item = {
    label: "identità / superficie", scheme: "light", foregroundToken: "--color-primary",
    backgroundToken: "--color-bg", foreground: color(), background: color(1, 0, 0),
    ratio: 5, target: 4.6, minimum: 4.5, kind: "text", provenance: "generated",
    ...overrides,
  };
  return { ...item, status: overrides.status ?? statusFor(item.ratio, item.target, item.minimum) };
}
function scenario(overrides = {}) {
  return { browser: "chromium", scheme: "light", preference: "no-preference", provenance: "browser: computed styles", diagnostics: [diagnostic()], ...overrides };
}
function report(overrides = {}) {
  return {
    generatedAt: "2026-07-01T12:34:56.789Z", inputDigest: "a".repeat(64),
    files: { palette: "tokens/palette.css", config: "smart-colors.config.mjs", tuning: null, output: "tokens/colors.css" },
    palette: [{ name: "primary", role: "accent-text", authored: color(0.5, 0.3), resolved: color(), darkBlend: 0.78 }],
    scenarios: [scenario()], proposals: [], generationErrors: [], auditErrors: [], notes: [],
    ...overrides,
  };
}
function proposal(overrides = {}) {
  return {
    id: "primary-lightness", title: "Correzione locale del primo piano", kind: "palette-lightness",
    destination: { file: "tokens/palette.css", path: "primary", snippet: "--primary: oklch(0.4 0.1 350);" },
    impact: "Modifica la luminosità del primo piano", search: "griglia locale di lightness, chroma e hue invariati",
    changes: [{ label: "primary", before: color(), after: color(0.4) }],
    checks: [diagnostic({ foreground: color(0.4), browser: "chromium", preference: "no-preference", ratio: 6 })],
    issueLabels: ["identità / superficie"], verified: true,
    ...overrides,
  };
}
const preview = (value) => formatContrastPreviewHtml(value);
const section = (html, id) => html.match(new RegExp(`<section id="${id}"[^>]*>[\\s\\S]*?<\\/section>`))?.[0] ?? "";
const snippetIn = (html, id) => section(html, id).match(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/)?.[1] ?? "";
const unescapeHtml = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'" })[entity]);
const headingLevels = (html) => [...html.matchAll(/<h([1-4])[^>]*>/g)].map((match) => Number(match[1]));
function facts(html) {
  const list = html.match(/<ul class="facts">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  return new Map([...list.matchAll(/<li><strong>([^<]*)<\/strong> ([^<]*)<\/li>/g)].map(([, value, label]) => [label.trim(), Number(value)]));
}
function reportFacts(html) {
  const list = html.match(/<ul class="summary-facts">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  return new Map([...list.matchAll(/<li><strong>([^<]*)<\/strong> ([^<]*)<\/li>/g)].map(([, value, label]) => [label.trim(), value]));
}
// Overlap counts stay hand-checkable: three usable pairs, one large-only pair and one to avoid.
const OVERLAP_RATIOS = {
  light: [["--color-primary", "--color-bg", 5.2], ["--color-primary", "--color-surface", 4.7], ["--color-secondary", "--color-bg", 3.4], ["--color-secondary", "--color-surface", 2.2], ["--color-primary", "--color-secondary", 6.1]],
  dark: [["--color-primary", "--color-bg", 4.9], ["--color-primary", "--color-surface", 4.6], ["--color-secondary", "--color-bg", 3.2], ["--color-secondary", "--color-surface", 2.6], ["--color-primary", "--color-secondary", 5.4]],
};
function overlapScenario(browser, scheme, preference) {
  return {
    browser, scheme, preference, provenance: "browser-resolved-overlap",
    diagnostics: OVERLAP_RATIOS[scheme].map(([foregroundToken, backgroundToken, ratio]) => diagnostic({
      label: `${scheme} ${foregroundToken} on ${backgroundToken}`, scheme, browser, preference,
      foregroundToken, backgroundToken, kind: "text", minimum: 4.5, target: 4.5, provenance: "browser-resolved-overlap",
      ratio, foreground: color(0.4, 0.08, 30), background: color(0.96, 0.01, 90),
    })),
  };
}

test("renders a standalone static Italian preview with the report marker, CSP and navigation order", () => {
  const html = preview(report());
  assert.equal(html.split("\n")[0], MARKER);
  assert.match(html, /<!doctype html>\s*<html lang="it">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;none&#39;/);
  assert.match(html, /<h1>Contrasto colori — anteprima<\/h1>/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<main id="contenuto">/);
  assert.match(html, /<a class="skip" href="#contenuto">/);
  assert.match(html, /<time datetime="2026-07-01T12:34:56\.789Z">2026-07-01T12:34:56\.789Z<\/time>/);
  assert.match(html, /SHA-256 abbreviato: <code>aaaaaaaa<\/code>/);
  assert.match(html, /href="smart-colors.html"/);
  assert.match(html, /Apri il report completo \(smart-colors.html\)/);
  const anchors = [...html.match(/<nav aria-label="Sezioni dell’anteprima">([\s\S]*?)<\/nav>/)[1].matchAll(/href="#([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(anchors, ["azione", "problemi", "palette", "varianti", "abbinamenti"]);
  assert.deepEqual([...html.matchAll(/<section id="([a-z]+)"/g)].map((match) => match[1]), anchors);
  assert.match(html, /main > section \{ container-name: preview-section; container-type: inline-size; scroll-margin-top: 5rem; \}/);
  assert.match(html, /@container preview-section \(min-width: 40rem\)/);
  assert.match(html, /\.verdict \{ font-size: clamp\(1\.75rem, 1\.2rem \+ 2vw, 2\.5rem\); font-weight: 700;/);
  assert.match(html, /<li><strong>0<\/strong> problemi distinti<\/li><li><strong>0<\/strong> correzioni verificate<\/li><li><strong>1<\/strong> coppia misurata<\/li><li><strong>1<\/strong> scenario<\/li>/);
  for (const feature of [/@media \(forced-colors: active\)/, /@media print/, /@media \(prefers-reduced-motion: no-preference\)/]) assert.match(html, feature);
  assert.ok([...html.matchAll(/href="([^"]+)"/g)].every((match) => /^(#|smart-colors\.html(#\w+)?$)/.test(match[1])), "Only in-document anchors or the full report may be linked");
});

test("static previews carry no script, no external resource and no inline handler", () => {
  const html = preview(report({ proposals: [proposal()], overlaps: [overlapScenario("chromium", "light", "no-preference")] }));
  assert.doesNotMatch(html, /<script|<link|<img|<iframe|<object|<embed|<svg|<button|<input|<form\b|\son\w+=/i);
  assert.doesNotMatch(html, /@import|url\(|https?:\/\//i);
  assert.match(html, /user-select:\s*text/);
});

test("verified proposals appear in #azione with the exact snippet, samples and the covering link", () => {
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal({
    sideEffects: [{
      label: "bordo", scheme: "dark", foregroundToken: "--color-primary-border", backgroundToken: "--color-bg",
      before: { color: color(0.6, 0.05), ratio: 2.4 }, after: { color: color(0.55, 0.05), ratio: 2.2 }, provenance: "browser-proposal",
    }],
  })] });
  const html = preview(input);
  const action = section(html, "azione");
  assert.match(action, /<h3>Modifiche in palette\.css<\/h3>/);
  assert.match(action, /Fonte iniziale delle scelte del designer/);
  assert.match(action, /<h4>Correzione locale del primo piano<\/h4>/);
  assert.equal(unescapeHtml(snippetIn(html, "azione")), input.proposals[0].destination.snippet);
  assert.match(action, /Attuale<\/strong>/);
  assert.match(action, /<strong>Suggerito<\/strong>/);
  assert.match(action, /color-choice--suggested/);
  assert.match(action, /ΔL -0,1 · ΔC 0 ·/);
  assert.match(action, /tokens\/palette\.css/);
  assert.match(action, /Percorso nella configurazione<\/dt><dd><code>primary<\/code>/);
  assert.match(action, /Altro effetto della stessa modifica/);
  assert.match(section(html, "problemi"), /<a href="#proposal-1">Correzione locale del primo piano<\/a>/);
  assert.match(html, /id="proposal-1"/);
});

test("unverified snapshots get no positive verdict, no suggested color and a dashed state badge", () => {
  const input = report({ auditErrors: ["Audit incompleto per timeout"], proposals: [proposal()] });
  const html = preview(input);
  assert.match(html, /<p class="verdict">Esito non verificato o incompleto<\/p>/);
  assert.match(html, /<span class="badge badge--dashed">Snapshot non verificato<\/span>/);
  assert.match(html, /Nessuna conclusione positiva/);
  assert.match(html, /Audit incompleto per timeout/);
  assert.match(section(html, "azione"), /Nessun colore suggerito/);
  assert.doesNotMatch(html, /Suggerito/);
  assert.doesNotMatch(html, /class="color-choice color-choice--suggested"/);
  assert.doesNotMatch(html, /badge--outline">Snapshot verificato/);
  assert.match(section(html, "varianti"), /Varianti non confrontabili/);
  assert.match(section(html, "abbinamenti"), /Sovrapposizioni libere non verificate/);
  assert.doesNotMatch(html, /Coperta da/);
});

test("incomplete proposals are never presented as verified corrections", () => {
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal({
    checks: [diagnostic({ foreground: color(0.4), label: "altra coppia", ratio: 6 })],
  })] });
  const html = preview(input);
  assert.match(section(html, "azione"), /Nessuna correzione verificata/);
  assert.doesNotMatch(html, /<pre/);
  assert.doesNotMatch(html, /Suggerito/);
  assert.match(section(html, "problemi"), /Nessuna correzione verificata copre questa coppia/);
});

test("a missing passing control in another scenario prevents verified preview actions", () => {
  const control = diagnostic({ label: "passing control", scheme: "dark", ratio: 5 });
  const input = report({ scenarios: [
    scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] }),
    scenario({ browser: "webkit", scheme: "dark", diagnostics: [control] }),
  ], proposals: [proposal()] });
  const html = preview(input);
  assert.match(html, /1 problema di contrasto · 0 correzioni verificate/);
  assert.match(section(html, "azione"), /Nessuna correzione verificata/);
  assert.doesNotMatch(html, /Suggerito|Coperta da|<pre/);
  const complete = { ...input, proposals: [proposal({ checks: [
    ...input.proposals[0].checks, { ...control, browser: "webkit", preference: "no-preference" },
  ] })] };
  assert.match(preview(complete), /1 problema di contrasto · 1 correzione verificata/);
  assert.match(section(preview(complete), "azione"), /<strong>Suggerito<\/strong>/);
});

test("family badges respect validated minimum failures even when the target is met", () => {
  for (const [kind, minimum, target, below, passing, foregroundToken, tier] of [
    ["text", 4.5, 4, 4.4, 4.5, "--color-primary-text", "AA"],
    ["non-text", 3, 2.5, 2.9, 3, "--color-primary-border-strong", "3:1"],
  ]) {
    const family = (ratio, overrides = {}) => section(preview(report({ scenarios: [scenario({ diagnostics: [
      diagnostic({ label: "family name", foregroundToken: "--color-primary-text", backgroundToken: "--color-bg" }),
      diagnostic({ kind, minimum, target, ratio, foregroundToken, backgroundToken: "--color-primary-surface", ...overrides }),
    ] })] })), "palette").match(/<article class="card family-strip">[\s\S]*?<\/article>/)?.[0] ?? "";
    assert.match(family(below), /badge--solid">Sotto il minimo/);
    assert.doesNotMatch(family(below), /class="tier">/);
    assert.ok(family(passing).includes(`<span class="tier">${tier}</span>`));
    assert.match(family(passing, { target: passing + 0.1 }), /badge--outline">Sotto il target/);
    assert.doesNotMatch(family(below, { status: "pass" }), /class="tier">/, "Incoherent diagnostics must not enter the family atlas");
  }
});

test("state badges pair text with shape and keep minimum and target distinct", () => {
  const input = report({ scenarios: [scenario({ diagnostics: [
    diagnostic({ label: "sotto minimo", ratio: 4.4 }),
    diagnostic({ label: "sotto target", ratio: 4.55 }),
  ] })], overlaps: [overlapScenario("chromium", "light", "no-preference")] });
  const html = preview(input);
  assert.match(section(html, "problemi"), /<span class="badge badge--solid">Sotto il minimo<\/span>/);
  assert.match(section(html, "problemi"), /<span class="badge badge--outline">Sotto il target<\/span>/);
  assert.match(section(html, "problemi"), /Minimo 4,50:1 · target 4,60:1/);
  const problems = section(html, "problemi");
  assert.ok(problems.indexOf("sotto minimo") < problems.indexOf("sotto target"), "Below-minimum groups come first");
});

test("summary numbers and verdict stay identical to the full report on the same snapshot", () => {
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal()] });
  const full = formatContrastReportHtml(input);
  const html = preview(input);
  assert.equal(html.match(/<p class="verdict">([\s\S]*?)<\/p>/)[1], full.match(/<p class="status overview">([\s\S]*?)<\/p>/)[1]);
  const summary = facts(html), reference = reportFacts(full);
  assert.equal(summary.size, 4, "Preview keeps its four tiles");
  for (const [label, count] of summary) {
    assert.ok(reference.has(label), `Full report must expose the same tile: ${label}`);
    assert.equal(Number(reference.get(label)), count, label);
  }
  const empty = report({ scenarios: [] });
  assert.equal(preview(empty).match(/<p class="verdict">([\s\S]*?)<\/p>/)[1], formatContrastReportHtml(empty).match(/<p class="status overview">([\s\S]*?)<\/p>/)[1]);
});

test("both snapshot-only renderers use the shared verdict and reject prepared-view bypasses", () => {
  const valid = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal()] });
  const prepared = prepareContrastReport(valid);
  for (const input of [report(), valid, { ...valid, proposals: [proposal({ checks: [] })] },
    { ...valid, auditErrors: ["Audit incompleto"] }, { ...valid, inputDigest: "invalid" }, undefined]) {
    const summary = prepareContrastReport(input);
    const full = formatContrastReportHtml(input);
    const html = preview(input);
    assert.equal(html.match(/<p class="verdict">([\s\S]*?)<\/p>/)[1], summary.outcome);
    assert.equal(full.match(/<p class="status overview">([\s\S]*?)<\/p>/)[1], summary.outcome);
    assert.equal(formatContrastPreviewHtml(input, prepared), html);
  }
  assert.equal(formatContrastPreviewHtml.length, 1);
  assert.match(preview(prepared), /<p class="verdict">Esito non verificato o incompleto<\/p>/);
});

test("heading hierarchy never skips a level and the sections follow the navigation", () => {
  const html = preview(report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal()] }));
  const levels = headingLevels(html);
  assert.deepEqual(levels.slice(0, 1), [1]);
  assert.equal(levels.filter((level) => level === 1).length, 1);
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(levels[index] <= levels[index - 1] + 1, `Heading jump ${levels[index - 1]} → ${levels[index]}`);
  }
  const titles = [...html.matchAll(/<h2 id="([a-z]+)-titolo">([^<]+)<\/h2>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(titles.map(([id]) => id), ["azione", "problemi", "palette", "varianti", "abbinamenti"]);
  assert.equal(titles[0][1], "Cosa fare adesso");
});

test("rendering is deterministic and never mutates the supplied snapshot", () => {
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal()], overlaps: [overlapScenario("chromium", "light", "no-preference")] });
  const before = structuredClone(input);
  assert.equal(preview(input), preview(input));
  assert.deepEqual(input, before);
});

const BIG_NAMES = ["primary", "secondary", "tertiary", "info", "success", "warning", "danger", "sky", "mint", "sand", "plum", "coral", "teal", "rose"];
const BIG_SCENARIOS = [
  ["chromium", "light", "light"], ["chromium", "light", "dark"], ["chromium", "dark", "light"], ["chromium", "dark", "dark"],
  ["firefox", "light", "light"], ["firefox", "light", "dark"], ["firefox", "dark", "light"], ["firefox", "dark", "dark"],
];
// Exactly thirty measurements per identity and scenario: ten pairs, ten per theme, plus
// a handful of genuine shortfalls with one pair whose baseline shows a tuning regression.
const BIG_PAIRS = [
  { kind: "text", tokens: (name) => [`--color-${name}-text`, `--color-${name}-surface`], foreground: (index) => color(0.3 + index * 0.01, 0.08, 30 + index * 20) },
  { kind: "non-text", tokens: (name) => [`--color-${name}-border-strong`, `--color-${name}-surface`], foreground: (index) => color(0.55, 0.09, 30 + index * 20) },
  { kind: "text", tokens: (name) => [`--color-${name}-on-solid`, `--color-${name}-solid`], foreground: () => color(0.99, 0, 0) },
  { kind: "text", tokens: (name) => [`--color-${name}-on-solid`, `--color-${name}-solid-hover`], foreground: () => color(0.99, 0, 0) },
  { kind: "text", tokens: (name) => [`--color-on-${name}`, `--color-${name}`], foreground: () => color(0.99, 0, 0) },
  { kind: "text", tokens: (name) => [`--color-${name}-text`, "--color-bg"], foreground: (index) => color(0.3 + index * 0.01, 0.08, 30 + index * 20) },
  { kind: "text", tokens: (name) => [`--color-${name}-text`, "--color-surface"], foreground: (index) => color(0.3 + index * 0.01, 0.08, 30 + index * 20) },
  { kind: "text", tokens: (name) => [`--color-on-${name}`, "--color-surface"], foreground: () => color(0.99, 0, 0) },
  { kind: "non-text", tokens: (name) => [`--color-${name}-border`, "--color-surface"], foreground: (index) => color(0.6, 0.07, 30 + index * 20) },
  { kind: "text", tokens: () => ["--color-text-muted", "--color-surface"], foreground: () => color(0.45, 0.01, 260) },
];
const BIG_SHORTFALLS = new Map([
  ["0:0", { ratio: 4.21, baseline: 4.92 }],
  ["2:7", { ratio: 4.44 }],
  ["4:5", { ratio: 4.53 }],
  ["6:6", { ratio: 4.47 }],
  ["8:5", { ratio: 4.58 }],
  ["10:9", { ratio: 4.36 }],
  ["12:5", { ratio: 4.52 }],
  ["13:8", { ratio: 2.4 }],
]);
const bigLabel = (scheme, name, pairIndex) => `${scheme} ${name} pair ${pairIndex}`;
const forcedScenario = (scheme) => bigLabel(scheme, BIG_NAMES[0], 0);
function bigScenario(browser, scheme, preference) {
  const diagnostics = [];
  BIG_NAMES.forEach((name, index) => {
    BIG_PAIRS.forEach((pair, pairIndex) => {
      const forced = BIG_SHORTFALLS.get(`${index}:${pairIndex}`);
      const nonText = pair.kind === "non-text";
      diagnostics.push(diagnostic({
        label: bigLabel(scheme, name, pairIndex), scheme, browser, preference,
        foregroundToken: pair.tokens(name)[0], backgroundToken: pair.tokens(name)[1], kind: pair.kind,
        foreground: pair.foreground(index), background: color(scheme === "dark" ? 0.22 : 0.98, 0.01, (index * 23 + pairIndex * 17) % 360),
        ratio: forced?.ratio ?? 5.2 + ((index * 3 + pairIndex * 5) % 40) / 10,
        target: nonText ? 3.05 : 4.6, minimum: nonText ? 3 : 4.5,
        ...(forced?.baseline ? { baselineRatio: forced.baseline } : {}),
      }));
    });
  });
  return scenario({ browser, scheme, preference, diagnostics });
}
function bigReport() {
  const light = forcedScenario("light");
  const scenarios = BIG_SCENARIOS.map(([browser, scheme, preference]) => bigScenario(browser, scheme, preference));
  return report({
    palette: BIG_NAMES.map((name, index) => ({
      name: `--${name}`, role: "ui", authored: color(0.62 + index * 0.01, 0.12, (index * 25) % 360),
      resolved: color(0.62 + index * 0.01, 0.12, (index * 25) % 360),
    })),
    roles: { identities: BIG_NAMES.map((name) => ({ name, role: "ui", token: `--color-${name}-text`, paletteName: `--${name}` })) },
    scenarios,
    overlaps: BIG_SCENARIOS.map(([browser, scheme, preference]) => overlapScenario(browser, scheme, preference)),
    proposals: [{
      id: "tune-pair-0", title: "Correzione di prova sul primo abbinamento", kind: "tuning",
      destination: { file: "src/styles/tokens/colors-tuning.css", path: "--color-tune-muted-lightness-shift", snippet: ":root {\n  --color-tune-muted-lightness-shift: -0.04;\n}" },
      impact: "Regola il testo secondario senza cambiare la palette", search: "dipendenza monotona in lightness",
      changes: [{ label: "--color-text-muted", before: color(0.6, 0.02, 250), after: color(0.55, 0.02, 250) }],
      checks: scenarios.flatMap(({ diagnostics }) => diagnostics.map((item) => item.label === light
        ? { ...item, foreground: color(0.3, 0.08, 30), ratio: 5.4, status: "pass" }
        : { ...item })),
      issueLabels: [light], verified: true,
    }],
  });
}

test("a realistic snapshot stays inside the 120 KB budget and keeps every section populated", () => {
  const input = bigReport();
  const html = preview(input);
  const bytes = Buffer.byteLength(html, "utf8");
  assert.ok(bytes <= 120 * 1024, `Preview is ${bytes} bytes, over the 120 KB budget`);
  assert.equal((html.match(/class="card family-strip"/g) ?? []).length, BIG_NAMES.length);
  assert.equal((html.match(/class="card problem-card"/g) ?? []).length, BIG_SHORTFALLS.size * 2);
  assert.match(html, /Senza i tuning di progetto questa coppia rispettava le soglie/);
  assert.match(html, /Coperta da <a href="#proposal-1">Correzione di prova sul primo abbinamento<\/a>/);
  assert.equal((html.match(/<li><span class="variant-swatch"/g) ?? []).length, 5);
  assert.match(section(html, "varianti"), /Altre \d+ varianti oltre soglia nel <a href="smart-colors\.html#usi">report completo<\/a>/);
  assert.match(section(html, "abbinamenti"), /<strong class="count">3<\/strong> usabili per testo normale · <strong class="count">1<\/strong> solo per titoli grandi, bordi e icone · <strong class="count">1<\/strong> da evitare/);
  assert.equal((section(html, "abbinamenti").match(/<li><span class="pair-chip"/g) ?? []).length, 6);
  assert.match(section(html, "palette"), /<p class="sample-note"><span class="tier">AA<\/span>/);
  assert.match(section(html, "palette"), /<p class="sample-note"><span class="badge badge--solid">Sotto il minimo<\/span>/);
  assert.equal(snippetIn(html, "azione"), ":root {\n  --color-tune-muted-lightness-shift: -0.04;\n}");
  assert.ok(headingLevels(html).length > 20, "Preview must keep a readable heading structure");
});

test("one writer call publishes both marked artifacts and never overwrites an unowned file", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-preview-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal()] });
  const result = await writeContrastReport({ root, config: structuredClone(defaultSmartColorsConfig), report: input, preview: true });
  assert.equal(result.reportPath, path.join(root, "reports/smart-colors.html"));
  assert.equal(result.previewPath, path.join(root, "reports/smart-colors-preview.html"));
  assert.deepEqual((await readdir(path.join(root, "reports"))).sort(), ["smart-colors-preview.html", "smart-colors.html"]);
  assert.equal(await readFile(result.reportPath, "utf8"), formatContrastReportHtml(input));
  assert.equal(await readFile(result.previewPath, "utf8"), formatContrastPreviewHtml(input));
  assert.ok((await readFile(result.previewPath, "utf8")).startsWith(`${MARKER}\n`));
  await writeFile(result.previewPath, "hand written note\n");
  await assert.rejects(
    () => writeContrastReport({ root, config: structuredClone(defaultSmartColorsConfig), report: report({ notes: ["next"] }), preview: true }),
    /refuses to overwrite an unowned file/,
  );
  assert.equal(await readFile(result.previewPath, "utf8"), "hand written note\n");
  assert.equal(await readFile(result.reportPath, "utf8"), formatContrastReportHtml(input));

  const single = await mkdtemp(path.join(tmpdir(), "smart-colors-preview-"));
  t.after(() => rm(single, { recursive: true, force: true }));
  const onlyReport = await writeContrastReport({ root: single, config: structuredClone(defaultSmartColorsConfig), report: input });
  assert.equal(onlyReport, path.join(single, "reports/smart-colors.html"));
  assert.deepEqual(await readdir(path.join(single, "reports")), ["smart-colors.html"]);
});
