import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { formatContrastReportHtml, prepareContrastReport } from "../src/format-report-html.mjs";
import { createLocalPresenter, formatContrastPreviewHtml } from "../src/format-report-preview.mjs";
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

test("multi-change proposals caption every pair before the figures in published order", () => {
  const changes = [
    { label: "--color-text-muted", before: color(0.6, 0.02, 250), after: color(0.55, 0.02, 250) },
    { label: "--color-tertiary-text", before: color(0.62, 0.03, 250), after: color(0.57, 0.03, 250) },
    { label: "--color-text-soft", before: color(0.64, 0.02, 250), after: color(0.59, 0.02, 250) },
    { label: "--color-text-faint", before: color(0.66, 0.02, 250), after: color(0.61, 0.02, 250) },
  ];
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal({ changes })] });
  const action = section(preview(input), "azione");
  const blocks = action.split('<div class="change">').slice(1);
  assert.equal(blocks.length, changes.length);
  const labels = [...action.matchAll(/<p class="change-label">([^<]*)<\/p>/g)].map(([, label]) => label);
  assert.deepEqual(labels, changes.map(({ label }) => label), "Labels keep the published change order");
  changes.forEach(({ label }, index) => {
    const block = blocks[index];
    assert.ok(block.startsWith(`<p class="change-label">${label}</p><div class="grid-2">`), `Change ${index} starts with its label`);
    assert.ok(block.indexOf("change-label") < block.indexOf('<figure class="color-choice"'), `Change ${index} names the pair before the swatches`);
    assert.match(block, /<figcaption><strong>Attuale<\/strong>/);
    assert.match(block, /<figcaption><strong>Suggerito<\/strong>/);
  });
});

test("changes without a valid label add no empty caption", () => {
  for (const label of [undefined, 42, "   "]) {
    const change = { before: color(), after: color(0.4), ...(label === undefined ? {} : { label }) };
    const action = section(preview(report({
      scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })],
      proposals: [proposal({ changes: [change] })],
    })), "azione");
    assert.doesNotMatch(action, /change-label/, `Label ${String(label)} must not add a caption`);
    assert.doesNotMatch(action, /class="change-label"><\/p>/);
  }
});

test("tuning actions keep the build-time home and runtime caveat next to the destination", () => {
  const tuning = (restoresConfig) => proposal({
    kind: "tuning",
    destination: { file: "tokens/colors-tuning.css", path: "--color-tune-surface-lightness-shift", snippet: "--color-tune-surface-lightness-shift: 0.02;" },
    configKey: "derivation.surface.lightShift",
    configValue: -0.018,
    restoresConfig,
  });
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [tuning(true)] });
  const action = section(preview(input), "azione");
  assert.match(action, /Build: <code>derivation\.surface\.lightShift = -0,018<\/code> in <code>smart-colors\.config\.mjs<\/code>\./);
  assert.match(action, /colors-tuning\.css lo sovrascrive solo a runtime; il valore proposto è già in <code>smart-colors\.config\.mjs<\/code>: allineare o rimuovere l’override lo ripristina\./);
  assert.ok(action.indexOf('<dl class="destination"') < action.indexOf("Build:"));
  assert.ok(action.indexOf("Build:") < action.indexOf("<pre"));

  const alternative = section(preview(report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [tuning(false)] })), "azione");
  assert.match(alternative, /colors-tuning\.css lo sovrascrive solo a runtime; l’alternativa strutturale è cambiare <code>derivation\.surface\.lightShift<\/code> in <code>smart-colors\.config\.mjs<\/code>\./);
  assert.doesNotMatch(alternative, /il valore proposto è già/);
});

test("config actions summarize the structural definition and regenerated tokens near the destination", () => {
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal({
    kind: "config",
    destination: { file: "smart-colors.config.mjs", path: "derivation.surface.lightShift", snippet: "derivation: { surface: { lightShift: -0.016 } }," },
    configKey: "derivation.surface.lightShift",
    configValue: -0.018,
    promotedValue: -0.016,
    configToken: "--color-tune-surface-lightness-shift",
  })] });
  const action = section(preview(input), "azione");
  assert.match(action, /<h3>Modifiche in smart-colors\.config\.mjs<\/h3>/);
  assert.match(action, /Struttura: <code>derivation\.surface\.lightShift = -0,016<\/code> in <code>smart-colors\.config\.mjs<\/code>\./);
  assert.match(action, /La build rigenera i token di testo derivati; la dichiarazione <code>--color-tune-surface-lightness-shift<\/code> in <code>colors-tuning\.css<\/code> diventa ridondante: rimuovila o allineala\./);
});

test("rejected palette sources appear in #azione after the file groups only when valid", () => {
  const input = report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal()], rejectedSources: [
    { id: "surface-hover", file: "tokens/palette.css", reason: "non raggiunge il minimo" },
    { id: 7, file: "tokens/palette.css", reason: "id non valido" },
    { id: "missing-file", reason: "file assente" },
  ] });
  const action = section(preview(input), "azione");
  assert.match(action, /Nessuna alternativa verificata in palette\.css/);
  assert.match(action, /<code>surface-hover<\/code> — non raggiunge il minimo/);
  assert.doesNotMatch(action, /missing-file|<code>7<\/code>/);
  assert.ok(action.indexOf("Modifiche in palette.css") < action.indexOf("Nessuna alternativa verificata"));

  const withoutActions = section(preview(report({ rejectedSources: [{ id: "surface-hover", file: "tokens/palette.css", reason: "non raggiunge il minimo" }] })), "azione");
  assert.match(withoutActions, /Nessuna alternativa verificata in palette\.css/);
  assert.match(withoutActions, /<code>surface-hover<\/code> — non raggiunge il minimo/);
  assert.doesNotMatch(preview(report({ rejectedSources: [{ id: "", file: "tokens/palette.css", reason: "x" }, "testo"] })), /Nessuna alternativa verificata/);
});

test("invalid structural fields add no lines to preview actions", () => {
  const base = (overrides) => report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.2 })] })], proposals: [proposal(overrides)] });
  const noKey = section(preview(base({ kind: "tuning", configKey: 42, configValue: -0.018, restoresConfig: true })), "azione");
  assert.doesNotMatch(noKey, /Build:|Il valore di build|<code>42<\/code>/);
  const badValue = section(preview(base({ kind: "tuning", configKey: "derivation.surface.lightShift", configValue: Number.NaN, restoresConfig: true })), "azione");
  assert.match(badValue, /Build: <code>derivation\.surface\.lightShift<\/code> in <code>smart-colors\.config\.mjs<\/code>\./);
  assert.doesNotMatch(badValue, /NaN|Infinity/);
  const badConfig = section(preview(base({ kind: "config", configKey: "derivation.surface.lightShift", promotedValue: "14", configToken: 5 })), "azione");
  assert.doesNotMatch(badConfig, /Struttura:|La dichiarazione/);
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
  { kind: "text", tokens: (name) => [`--color-${name}-solid-text`, `--color-${name}-solid`], foreground: () => color(0.99, 0, 0) },
  { kind: "text", tokens: (name) => [`--color-${name}-solid-text`, `--color-${name}-solid-hover`], foreground: () => color(0.99, 0, 0) },
  { kind: "text", tokens: (name) => [`--color-${name}-ink`, `--color-${name}`], foreground: () => color(0.99, 0, 0) },
  { kind: "text", tokens: (name) => [`--color-${name}-text`, "--color-bg"], foreground: (index) => color(0.3 + index * 0.01, 0.08, 30 + index * 20) },
  { kind: "text", tokens: (name) => [`--color-${name}-text`, "--color-surface"], foreground: (index) => color(0.3 + index * 0.01, 0.08, 30 + index * 20) },
  { kind: "text", tokens: (name) => [`--color-${name}-ink`, "--color-surface"], foreground: () => color(0.99, 0, 0) },
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

// ---------------------------------------------------------------------------
// SC-03 diagnostic session: payload, runtime, CSP and the model/automation split.
// These are Node-only checks; the real browser proof runs on a temporary `file://
// fixture outside this suite (see the SC-06 delivery notes).
// ---------------------------------------------------------------------------

function sessionDiag(overrides = {}) {
  const item = {
    label: "primary / family surface", scheme: "light", foregroundToken: "--color-primary-text",
    backgroundToken: "--color-primary-surface", foreground: color(0.4, 0.1, 350), background: color(0.95, 0.02, 90),
    ratio: 4.4, target: 4.6, minimum: 4.5, kind: "text", provenance: "model",
    ...overrides,
  };
  return { ...item, status: overrides.status ?? statusFor(item.ratio, item.target, item.minimum) };
}

function diagSession(overrides = {}) {
  const samples = [{ browser: "model", scheme: "light", preference: "no-preference", provenance: "model", diagnostics: [sessionDiag()] }];
  return {
    ...report({ scenarios: [] }),
    roles: { identities: [{ name: "primary", role: "accent-text", token: "primary", paletteName: "--primary" }] },
    schemaVersion: 1,
    toolVersion: "0.3.0",
    snapshotId: "snap-123",
    config: { contrast: { text: 4.6, onColor: 4.6, ui: 3, maxIdentity: 7.5, darkRichness: 1.15 }, roles: { identities: { primary: { token: "primary", role: "accent-text" } }, decoratives: {} } },
    inputs: [{ name: "palette", path: "tokens/palette.css", present: true, sha256: "b".repeat(64) }],
    css: { baseline: ":root { --color-bg: oklch(1 0 0); }", tuning: null, tuningSupport: "absent" },
    model: { diagnostics: samples[0].diagnostics, errors: [], warnings: [] },
    samples,
    automation: { provenance: "model", mode: "off", status: "disabled", expected: { scenarios: [], pairs: [] }, executed: { scenarios: [], pairs: [] }, measurements: [], errors: [], environment: null, measuredAt: null },
    ...overrides,
  };
}

function automationRun(overrides = {}) {
  return {
    provenance: "browser-automation", mode: "required", status: "complete", snapshotId: "snap-123",
    engines: [{ name: "chromium", launched: true, status: "complete", version: "151.0.7922.34", executable: "/opt/chromium", phase: null, reason: null }],
    environment: { engines: [{ name: "chromium", version: "151.0.7922.34", executable: "/opt/chromium", environments: [{ userAgent: "Mozilla/5.0", language: "it-IT", preference: "light", forcedColors: false, measuredAt: "2026-07-01T12:00:00.000Z" }] }] },
    expected: { scenarios: ["chromium/baseline-light-light"], pairs: { "chromium/baseline-light-light": ["light|color|--color-primary-text|--color-primary-surface"] } },
    executed: { scenarios: ["chromium/baseline-light-light"], pairs: { "chromium/baseline-light-light": ["light|color|--color-primary-text|--color-primary-surface"] } },
    scenarios: [{ id: "chromium/baseline-light-light", theme: "light", variant: "baseline", preference: "light", status: "measured", reason: null, engine: "chromium" }],
    measurements: [{ pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "chromium/baseline-light-light", engine: "chromium", target: 4.6, minimum: 4.5, ratio: 4.7, status: "pass", error: null }],
    coverage: { complete: true, expectedCount: 1, measuredCount: 1, scenarios: [], duplicateScenarios: [], missingScenarios: [], unexpectedScenarios: [], duplicates: [], unmeasured: [] },
    unsupported: [], errors: [], notes: [], partial: false, measuredAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

const runtimeScript = (html) => html.match(/<script id="smart-colors-runtime">([\s\S]*?)<\/script>/)[1];
const payloadBlock = (html) => html.match(/<script type="application\/json" id="smart-colors-payload">([\s\S]*?)<\/script>/)[1];
const cspOf = (html) => html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/)[1].replaceAll("&#39;", "'");
const markupOf = (html) => html.slice(0, html.indexOf("<script"));

// A test-only DOM good enough for the presenter: createElement/appendChild/insertBefore/
// querySelector plus a `role="status"` region and a frames container under the host.
function presenterDom() {
  const makeElement = (tag) => ({
    tagName: tag, className: "", textContent: "", attributes: {}, children: [], parentNode: null,
    style: { setProperty() {} },
    get firstChild() { return this.children[0] ?? null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child, reference) {
      child.parentNode = this;
      const index = this.children.indexOf(reference);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
      return child;
    },
    removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; },
    querySelector() { return null; },
  });
  const host = makeElement("div");
  const frames = makeElement("div");
  host.appendChild(frames);
  host.querySelector = (selector) => {
    if (selector === ".local-rows") return host.children.find((child) => child.className === "local-rows") ?? null;
    if (selector.includes("frames")) return frames;
    return null;
  };
  return { host, frames, document: { getElementById: (id) => id === "smart-colors-diagnostic" ? host : null, createElement: makeElement } };
}

test("a diagnostic session preview embeds one hashed script, an inert payload and no inline handler", () => {
  const html = preview(diagSession());
  assert.equal(html.split("\n")[0], MARKER);
  assert.equal((html.match(/<script/g) ?? []).length, 2);
  const source = runtimeScript(html);
  const hash = createHash("sha256").update(source, "utf8").digest("base64");
  assert.ok(cspOf(html).includes(`script-src 'sha256-${hash}'`), "the CSP hash must cover the exact emitted bytes");
  assert.match(cspOf(html), /frame-src 'none'/);
  assert.match(cspOf(html), /default-src 'none'/);
  assert.doesNotMatch(cspOf(html), /unsafe-eval|unsafe-hashes/);
  assert.doesNotMatch(markupOf(html), /\son[a-z]+\s*=/i, "no inline event handler in markup");
  assert.doesNotMatch(markupOf(html), /<(?:link|img|object|embed|svg|input|form)\b|https?:\/\//i);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(source, /\beval\s*\(|new Function\b|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.ok(!source.includes("</"), "no closing-tag sequence inside the hashed script");
});

test("the payload stays inert JSON and never lets embedded CSS close the block or leak markup", () => {
  const hostile = `:root { --x: '</script><style></style>'; } /* " & ' */}`;
  const html = preview(diagSession({ css: { baseline: hostile, tuning: hostile, tuningSupport: "supported" } }));
  const text = payloadBlock(html);
  assert.ok(!text.includes("<"), "every < must be escaped so no tag can appear in the block");
  assert.ok(!text.includes("</"), "no closing-tag sequence may terminate the block early");
  const payload = JSON.parse(text);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.css.baseline, hostile);
  assert.equal(payload.css.tuning, hostile);
  assert.equal(payload.css.tuningSupport, "supported");
  assert.equal(payload.snapshotId, "snap-123");
  assert.equal(payload.config.contrast.text, 4.6);
  assert.equal(payload.config.roles.identities.primary.token, "primary");
  assert.ok(!Object.hasOwn(payload, "automation"), "automation must stay out of the local payload");
  assert.ok(!Object.hasOwn(payload, "samples"), "model samples must stay out of the local payload");
});

test("the local presenter is serialized self-contained and renders rows, status and scope", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  let listener = null;
  const report = {
    preference: { active: "light", unmeasured: ["dark"] },
    coverage: { complete: false },
    executed: { scenarios: ["baseline-light-light"] },
    measurements: [{ pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "baseline-light-light", ratio: 4.44, minimum: 4.5, target: 4.6, status: "below-target", error: null }],
    errors: [{ phase: "measure", cause: "computed-empty", message: "x" }],
    unsupported: [{ id: "baseline-dark-dark", reason: "forced-colors is active" }],
  };
  const controller = { status: () => ({ state: "incomplete", report }), subscribe: (fn) => { listener = fn; return () => {}; } };
  const presenter = factory({ document: dom.document, controller });
  assert.ok(presenter, "the presenter must attach to the host");
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  assert.ok(panel, "the presenter must create its own panel before the frames container");
  assert.equal(panel.children[0].tagName, "h3");
  assert.equal(panel.children[0].textContent, "Misure locali di questo browser");
  const scope = panel.children.find((child) => child.className === "local-scope");
  assert.match(scope.textContent, /Provenienza: browser-local/);
  assert.match(scope.textContent, /copertura: incompleta/);
  assert.match(scope.textContent, /preferenza non misurata: dark/);
  const scroll = panel.children.find((child) => child.className === "local-table-scroll");
  assert.equal(scroll.getAttribute("role"), "region");
  const table = scroll.children[0];
  const head = table.children.find((child) => child.tagName === "thead");
  assert.deepEqual(head.children[0].children.map((cell) => cell.textContent), ["Scenario", "Coppia", "Rapporto", "Minimo", "Target", "Esito", "Nota"]);
  assert.ok(head.children[0].children.every((cell) => cell.getAttribute("scope") === "col"));
  const body = table.children.find((child) => child.tagName === "tbody");
  const row = body.children[0];
  assert.equal(row.children[0].getAttribute("scope"), "row");
  assert.equal(row.children[1].textContent, "--color-primary-text su --color-primary-surface (color, tema light)");
  assert.equal(row.children[2].textContent, "4,44:1");
  assert.equal(row.children[2].getAttribute("data-ratio"), "4.44");
  assert.equal(row.children[2].getAttribute("data-minimum"), "4.5");
  assert.equal(row.children[2].getAttribute("data-target"), "4.6");
  assert.equal(row.children[3].textContent, "4,50:1");
  assert.equal(row.children[4].textContent, "4,60:1");
  assert.equal(row.children[5].textContent, "Sotto il target");
  const errorsHeading = panel.children.filter((child) => child.tagName === "h3").map((child) => child.textContent);
  assert.deepEqual(errorsHeading, ["Misure locali di questo browser", "Scenari non supportati", "Errori della verifica locale"]);
  assert.equal(listener instanceof Function, true);
  // A fresh subscriber snapshot must repaint the same panel without duplicating it.
  listener({ state: "pending", report: null });
  assert.equal(dom.host.children.filter((child) => child.className === "local-rows").length, 1);
});

test("a session preview stays useful without JavaScript and keeps the model out of any verified verdict", () => {
  const html = preview(diagSession());
  assert.match(html, /<h1>Contrasto colori — anteprima<\/h1>/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<main id="contenuto">/);
  assert.match(html, /Campioni dal modello \(senza browser\)/);
  assert.match(html, /Campioni calcolati dal modello del generatore, senza browser/);
  assert.match(html, /non ricevono un badge di verifica/);
  assert.doesNotMatch(html, /class="color-choice color-choice--suggested"/);
  assert.match(html, /badge badge--dashed">Snapshot non verificato</);
  assert.match(html, /Verifica automatizzata/);
  assert.match(html, /Automazione disattivata/);
  assert.match(html, /Misure locali non eseguite: serve JavaScript nel browser/);
  assert.match(html, /Snapshot incorporato: <code>snap-123<\/code> · Versione tool: <code>0\.3\.0<\/code>/);
  assert.match(html, /<a href="smart-colors\.html">/);
});

test("session markup follows the navigation, keeps a logical heading order and never moves focus", () => {
  const html = preview(diagSession());
  const anchors = [...html.match(/<nav aria-label="Sezioni dell’anteprima">([\s\S]*?)<\/nav>/)[1].matchAll(/href="#([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(anchors, ["locale", "azione", "problemi", "modello", "palette", "varianti", "abbinamenti", "automazione"]);
  assert.deepEqual([...html.matchAll(/<section id="([a-z]+)"/g)].map((match) => match[1]), anchors);
  const levels = headingLevels(html);
  assert.equal(levels[0], 1);
  for (let index = 1; index < levels.length; index += 1) assert.ok(levels[index] - levels[index - 1] <= 1, `heading jump at ${index}: ${levels}`);
  assert.doesNotMatch(html, /\bautofocus\b/);
  assert.match(html, /:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  assert.match(html, /data-smart-colors-diagnostic="status" role="status"/);
  assert.match(html, /<button type="button" data-smart-colors-diagnostic="retry" hidden>Ripeti verifica<\/button>/);
  assert.ok([...html.matchAll(/href="([^"]+)"/g)].every((match) => /^(#|smart-colors\.html(#\w+)?$)/.test(match[1])), "only in-document anchors or the full report may be linked");
});

test("a diagnostic session escapes hostile identity and automation metadata", () => {
  const attack = '<script>"&\u2028</script>';
  const html = preview(diagSession({
    snapshotId: attack,
    toolVersion: attack,
    automation: { provenance: "model", mode: attack, status: "unavailable", expected: {}, executed: {}, measurements: [], errors: [], environment: { browser: attack, version: attack }, measuredAt: attack },
  }));
  assert.doesNotMatch(markupOf(html), /<script>"&/);
  assert.ok(!markupOf(html).includes(attack), "the raw attack string must never reach the markup");
  assert.match(html, /&lt;script&gt;&quot;&amp;/);
});

// Provisional preview budget pending orchestrator approval. The historical 120.000-byte
// budget predates the embedded SC-04 runtime (fixed ~67 KB) and the exact CSS payload;
// 220 KB covers the starter (~85 KB) and the extended palette (~161 KB) with headroom.
const PREVIEW_BUDGET_BYTES = 220 * 1024;

function extendedSession() {
  const names = ["primary", "secondary", "info", "success", "warning", "danger", "accent", "neutral", "brand", "muted"];
  const tokenLines = [":root {"];
  for (let index = 0; index < 800; index += 1) tokenLines.push(`  --color-scale-${index}: oklch(0.4 0.1 ${(index * 7) % 360});`);
  tokenLines.push("}");
  const pairsFor = (scheme, name) => [
    sessionDiag({ scheme, label: `${name} text`, foregroundToken: `--color-${name}-text`, backgroundToken: `--color-${name}-surface`, ratio: 4.4 }),
    sessionDiag({ scheme, label: `${name} border`, foregroundToken: `--color-${name}-border-strong`, backgroundToken: `--color-${name}-surface`, ratio: 3.2, kind: "non-text", minimum: 3, target: 3 }),
    sessionDiag({ scheme, label: `${name} solid`, foregroundToken: `--color-${name}-solid-text`, backgroundToken: `--color-${name}-solid`, ratio: 5.5 }),
    sessionDiag({ scheme, label: `${name} ink`, foregroundToken: `--color-${name}-ink`, backgroundToken: `--color-${name}`, ratio: 4.8 }),
  ];
  const samples = ["light", "dark"].map((scheme) => ({ browser: "model", scheme, preference: "no-preference", provenance: "model", diagnostics: names.flatMap((name) => pairsFor(scheme, name)) }));
  return diagSession({
    palette: names.map((name) => ({ name, role: "accent-text", authored: color(0.5, 0.3), resolved: color() })),
    roles: { identities: names.map((name) => ({ name, role: "accent-text", token: name, paletteName: `--${name}` })) },
    css: { baseline: tokenLines.join("\n"), tuning: null, tuningSupport: "absent" },
    samples,
    model: { diagnostics: samples.flatMap((sample) => sample.diagnostics), errors: [], warnings: [] },
  });
}

test("a session preview stays inside the proposed size budget on the starter and the extended palette", () => {
  const starter = Buffer.byteLength(preview(diagSession()), "utf8");
  const extended = Buffer.byteLength(preview(extendedSession()), "utf8");
  assert.ok(starter <= PREVIEW_BUDGET_BYTES, `starter preview is ${starter} bytes, over the proposed budget`);
  assert.ok(extended <= PREVIEW_BUDGET_BYTES, `extended preview is ${extended} bytes, over the proposed budget`);
  assert.ok(extended > starter, "the extended palette must be the heavier measurement");
});

test("the legacy snapshot preview never gains the session runtime", () => {
  const html = preview(report({ proposals: [proposal()] }));
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /smart-colors-diagnostic|smart-colors-payload/);
});

function panelOf(presenterReport) {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const controller = { status: () => ({ state: presenterReport.state ?? "complete", report: presenterReport.report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  return dom.host.children.find((child) => child.className === "local-rows");
}

test("the local ratio label never rounds a below-threshold value onto its own minimum", () => {
  const panel = panelOf({
    state: "complete",
    report: {
      preference: { active: "light", unmeasured: [] }, coverage: { complete: true }, executed: { scenarios: ["baseline-light-light"] },
      measurements: [{ pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "baseline-light-light", ratio: 4.4999, minimum: 4.5, target: 4.6, status: "below-minimum", error: null }],
      errors: [], unsupported: [],
    },
  });
  const scroll = panel.children.find((child) => child.className === "local-table-scroll");
  const body = scroll.children[0].children.find((child) => child.tagName === "tbody");
  const cell = body.children[0].children[2];
  assert.equal(cell.textContent, "< 4,5:1");
  assert.notEqual(cell.textContent, "4,50:1");
  assert.equal(cell.getAttribute("data-ratio"), "4.4999");
  assert.match(panel.children.find((child) => child.className === "local-scope").textContent, /copertura: completa negli scenari locali eseguiti \(non universale\)/);
});

test("zero local measurements still surface error causes and unsupported reasons", () => {
  const panel = panelOf({
    state: "unsupported",
    report: {
      preference: { active: "dark", unmeasured: ["light"] }, coverage: { complete: false }, executed: { scenarios: [] },
      measurements: [],
      errors: [{ phase: "measure", cause: "forced-colors-active", scenarioId: "baseline-light-dark", pairId: "light|color|--color-text|--color-bg", message: "forced-colors is active" }],
      unsupported: [{ id: "baseline-dark-dark", reason: "the isolated document could not be measured" }],
    },
  });
  const headings = panel.children.filter((child) => child.tagName === "h3").map((child) => child.textContent);
  assert.deepEqual(headings, ["Misure locali di questo browser", "Scenari non supportati", "Errori della verifica locale"]);
  assert.ok(panel.children.some((child) => child.className === "local-empty"));
  const errors = panel.children.find((child) => child.className === "local-errors");
  assert.equal(errors.tagName, "ul");
  assert.equal(errors.children[0].textContent, "measure · forced-colors-active — forced-colors is active; scenario baseline-light-dark; coppia light|color|--color-text|--color-bg");
  const unsupported = panel.children.find((child) => child.className === "local-unsupported");
  assert.match(unsupported.children[0].textContent, /^baseline-dark-dark — the isolated document could not be measured$/);
});

test("a complete automation run qualifies the preview header instead of a global pass", () => {
  const html = preview(diagSession({ automation: automationRun() }));
  assert.match(html, /<span class="badge badge--outline">Snapshot verificato: coppie automatizzate negli ambienti eseguiti<\/span>/);
  assert.match(html, /Verifica circoscritta ai motori e agli scenari automatizzati elencati/);
  assert.doesNotMatch(html, /Snapshot verificato<\/span>/);
  assert.match(html, /Copertura completa negli ambienti eseguiti \(i motori e gli scenari elencati qui sotto\), non universale/);
  assert.match(html, /<h4>Motori richiesti<\/h4>/);
  assert.match(html, /<code>chromium<\/code> 151\.0\.7922\.34 · Completa · eseguito/);
});

test("an incomplete or partial automation run cannot render a positive preview header", () => {
  const html = preview(diagSession({ automation: automationRun({ partial: true, status: "incomplete", coverage: { complete: false, expectedCount: 1, measuredCount: 0 } }) }));
  assert.match(html, /<span class="badge badge--dashed">Snapshot non verificato<\/span>/);
  assert.match(html, /Nessuna conclusione positiva: l'automazione non copre tutte le coppie/);
  assert.doesNotMatch(html, /Snapshot verificato/);
  assert.match(html, /Copertura parziale o incompleta/);
});

test("automation engine and error details stay static, escaped and cause-complete", () => {
  const run = automationRun({
    partial: true,
    engines: [
      { name: "chromium", launched: true, status: "complete", version: "151.0.7922.34", executable: "/opt/chromium", phase: null, reason: null },
      { name: "firefox", launched: false, status: "unavailable", version: null, executable: null, phase: "availability", reason: "browser binary unavailable at /opt/firefox" },
    ],
    errors: [
      { phase: "availability", cause: "binary-missing", engine: "firefox", scenarioId: null, pairId: null, message: "firefox: install it with pnpm exec playwright install firefox" },
      { phase: "measure", cause: "runtime-run-failed", engine: "chromium", scenarioId: "chromium/baseline-dark-dark", pairId: null, message: "preferenza dark: timeout" },
    ],
    measurements: [
      { pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "chromium/baseline-light-light", engine: "chromium", target: 4.6, minimum: 4.5, ratio: 4.2, status: "below-minimum", error: null },
    ],
  });
  const html = preview(diagSession({ automation: run }));
  const markup = markupOf(html);
  assert.match(markup, /<code>firefox<\/code> · Non disponibile · non eseguito · fase <code>availability<\/code> — browser binary unavailable at \/opt\/firefox/);
  assert.match(markup, /<code>availability<\/code> · <code>binary-missing<\/code> — firefox: install it with pnpm exec playwright install firefox/);
  assert.match(markup, /<code>measure<\/code> · <code>runtime-run-failed<\/code> — preferenza dark: timeout · motore <code>chromium<\/code> · scenario <code>chromium\/baseline-dark-dark<\/code>/);
  assert.match(markup, /<caption>Misure automatizzate per coppia<\/caption>/);
  assert.match(markup, /<th scope="row"><code>--color-primary-text<\/code> su <code>--color-primary-surface<\/code><\/th><td>Chiaro<\/td><td><code>4\.5:1<\/code><\/td><td><code>4\.6:1<\/code><\/td><td>4,20:1<\/td><td>Sotto il minimo<\/td><td>1<\/td>/);
  assert.match(markup, /<h4>Errori dell'automazione \(2\)<\/h4>/);
  assert.doesNotMatch(markup, /\/opt\/foo\.svg|https?:\/\//);
});

// QA finding, preview side: a session with externally supplied, structurally valid scenarios must
// not render a positive action/header while its automation run is not complete.
function sessionWithIssue(overrides = {}) {
  return diagSession({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.499999999999999 })] })], proposals: [proposal()], ...overrides });
}

function sessionAllPass(overrides = {}) {
  return diagSession({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 5 })] })], ...overrides });
}

function previewGateCases() {
  return [
    ["missing automation", () => { const session = sessionWithIssue(); delete session.automation; return session; }],
    ["disabled automation", () => sessionWithIssue({ automation: automationRun({ mode: "off", status: "disabled", partial: false, engines: [], measurements: [], coverage: { complete: false, expectedCount: 0, measuredCount: 0 } }) })],
    ["incomplete automation", () => sessionWithIssue({ automation: automationRun({ status: "incomplete", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [] }) })],
    ["unavailable automation", () => sessionWithIssue({ automation: automationRun({ status: "unavailable", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [], engines: [] }) })],
    ["partial automation", () => sessionWithIssue({ automation: automationRun({ partial: true }) })],
    ["unsupported automation", () => sessionWithIssue({ automation: automationRun({ status: "unsupported", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [] }) })],
  ];
}

test("a session preview never inherits a positive outcome while automation is not complete", () => {
  for (const [label, build] of previewGateCases()) {
    const html = preview(build());
    assert.match(html, /badge badge--dashed">Snapshot non verificato/, label);
    assert.doesNotMatch(html, /Snapshot verificato: coppie automatizzate/, label);
    assert.doesNotMatch(html, /class="color-choice color-choice--suggested"/, label);
    assert.match(html, /Nessun colore suggerito/, label);
    assert.match(html, /Nessuna conclusione positiva/, label);
  }
});

test("a session preview with valid scenarios and complete automation may be positive", () => {
  const html = preview(sessionWithIssue({ automation: automationRun() }));
  assert.match(html, /Snapshot verificato: coppie automatizzate negli ambienti eseguiti/);
  assert.match(html, /class="color-choice color-choice--suggested"/);
  assert.match(section(html, "azione"), /<h4>Correzione locale del primo piano<\/h4>/);
  assert.doesNotMatch(html, /Nessuna conclusione positiva/);
});

test("a session preview verdict is non-positive while automation is not complete", () => {
  const gated = preview(sessionAllPass({ automation: automationRun({ status: "incomplete", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [] }) }));
  assert.doesNotMatch(gated, /Esito positivo dello snapshot: 0 issue/);
  assert.match(gated, /<p class="verdict">Esito non verificato o incompleto<\/p>/);
  const positive = preview(sessionAllPass({ automation: automationRun() }));
  assert.match(positive, /<p class="verdict">Esito positivo dello snapshot: 0 issue<\/p>/);
});
