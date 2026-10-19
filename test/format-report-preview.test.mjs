import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { formatContrastReportHtml, prepareContrastReport } from "../src/format-report-html.mjs";
import { createLocalPresenter, formatContrastPreviewHtml, localPresenterSource } from "../src/format-report-preview.mjs";
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
function presenterDom(payload) {
  const makeElement = (tag) => ({
    tagName: tag, className: "", textContent: "", attributes: {}, children: [], parentNode: null,
    style: { props: {}, setProperty(name, value) { this.props[name] = String(value); } },
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
  const payloadNode = payload === undefined ? null : Object.assign(makeElement("script"), { textContent: JSON.stringify(payload) });
  return { host, frames, document: { getElementById: (id) => id === "smart-colors-diagnostic" ? host : (id === "smart-colors-payload" ? payloadNode : null), createElement: makeElement } };
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
  // Native form controls are the guided workbench: they are allowed and required, while
  // external/embedded resources and remote URLs stay forbidden.
  assert.doesNotMatch(markupOf(html), /<(?:link|img|object|embed|svg|iframe)\b|https?:\/\//i);
  assert.match(markupOf(html), /<form\b/);
  assert.match(markupOf(html), /<input\b/);
  assert.match(markupOf(html), /<select\b/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(source, /\beval\s*\(|new Function\b|\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.ok(!source.includes("</"), "no closing-tag sequence inside the hashed script");
  assert.doesNotThrow(() => new Function(source), "the concatenated runtime, presenter and view factory must parse as one classic script");
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
  assert.equal(payload.css.baselineSupport, "supported", "a legacy payload derives the same conservative support state");
  assert.equal(payload.paletteSource, null, "a legacy array palette is never forwarded as captured bytes");
  assert.ok(!Object.hasOwn(payload, "palette"), "the legacy palette array stays out of the payload");
});

test("the payload forwards the captured palette block byte-for-byte and keeps it inert", () => {
  const css = ":root {}\n@property --palette-brand { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; dark-blend: 80; }\n";
  const declaration = `@property --palette-brand { initial-value: oklch(0.56 0.14 255); /* </script> */ }`;
  const palette = {
    css, path: "src/styles/tokens/palette.css", sha256: "d".repeat(64),
    sources: [{ token: "--palette-brand", value: "oklch(0.56 0.14 255)", role: "ui", darkBlend: 80, declaration }],
  };
  const html = preview(diagSession({ paletteSource: palette, css: { baseline: ":root{}", tuning: null, tuningSupport: "absent", baselineSupport: "unsupported" } }));
  const text = payloadBlock(html);
  assert.ok(!text.includes("<"), "every < must stay escaped in the inert block");
  const payload = JSON.parse(text);
  assert.deepEqual(payload.paletteSource, palette, "the captured palette bytes and provenance must survive unchanged under paletteSource");
  assert.equal(payload.css.baselineSupport, "unsupported", "a declared baselineSupport is retained");
});

test("the session preview leads with the workbench, keeps the raw source archive after it and the resolved gallery inside the technical archive", () => {
  const design = designFixture();
  design.tokens["--color-orphan"] = { sources: ["--palette-brand"], recipe: "scale", usage: "Passo di scala senza coppia", controls: {} };
  const html = preview(diagSession({ design }));
  const bancoIndex = html.indexOf('id="banco"');
  const paletteIndex = html.indexOf('id="palette"');
  const diagnostaIndex = html.indexOf('id="diagnostica"');
  const usiIndex = html.indexOf('id="usi"');
  assert.ok(bancoIndex >= 0 && paletteIndex > bancoIndex, "the guided workbench leads, the raw source archive follows it");
  assert.ok(diagnostaIndex > paletteIndex && usiIndex > diagnostaIndex, "the technical archive encloses the resolved gallery");
  assert.match(html, /id="smart-colors-workbench"/);
  // The raw source metadata stays in a closed native detail, not on the primary surface.
  assert.match(html, /<details class="is-detail wb-palette-details"><summary>Dettagli tecnici della palette sorgente<\/summary>/);
  assert.match(html, /<details id="diagnostica" class="preview-technical"><summary>Diagnostica e archivio completo<\/summary>/);
  assert.match(html, /<details class="is-detail archive-gallery"><summary>Apri l'archivio dei campioni risolti \(stime, non verifiche\)<\/summary>/);
  // The archive gallery must not dominate: the summary line precedes the model samples.
  assert.ok(html.indexOf("archive-gallery") < html.indexOf("Famiglia <code>--color-primary</code>"), "the resolved gallery sits inside the archive detail");
  assert.match(html, /Senza JavaScript/);
  assert.match(html, /La ricerca è limitata alla <strong>minima variazione di luminosità<\/strong>/);
  assert.match(html, /il fit di gamut può ridurre il chroma/);
  assert.match(html, /ricerca globale del colore più vicino in ΔE/);
  assert.match(html, /nessun abbinamento verificato/);
  // Fully native controls, and neutral headings whose theme/variant come from the controller.
  assert.match(html, /<select id="smart-colors-workbench-source"/);
  assert.match(html, /<select id="smart-colors-workbench-pair"/);
  assert.match(html, /<input id="smart-colors-workbench-theme-light" type="radio"/);
  assert.match(html, /<input id="smart-colors-workbench-comparison-themes" type="radio"/);
  assert.match(html, /<button type="submit"[^>]*id="smart-colors-workbench-submit"[^>]*>Aggiorna il confronto<\/button>/);
  assert.match(html, /<textarea id="smart-colors-workbench-export-text"/);
  assert.match(html, /<h3 id="smart-colors-workbench-left-title"[^>]*>Tema chiaro<\/h3>/);
  assert.match(html, /<h3 id="smart-colors-workbench-right-title"[^>]*>Tema scuro<\/h3>/);
  // The redundant restore/reset-all duplicate is gone: reset-all appears once, in controls scope.
  assert.doesNotMatch(html, /Ripristina<\/button>/);
  assert.equal((html.match(/Azzera tutto il tuning<\/button>/g) ?? []).length, 1);
  assert.match(html, /Ambito: solo i controlli pubblici dichiarati per i due token della coppia selezionata/);
});

test("the hashed session script always integrates the mandatory workbench runtime and view factory", () => {
  const html = preview(diagSession());
  const source = runtimeScript(html);
  assert.match(source, /SMART_COLORS_WORKBENCH_RUNTIME_V1/, "the mandatory runtime must be concatenated into the hashed script");
  assert.match(source, /__smartColorsWorkbench/);
  assert.match(source, /createContrastWorkbenchView/);
});

test("the local presenter is serialized self-contained and renders problems, scope and raw details", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  let listener = null;
  const hits = [];
  // A stub factory stands in for designer-language.mjs: the presenter must consume it, never
  // re-implement the vocabulary, and never touch innerHTML for the sample colors.
  const language = {
    pairTitle: (foreground, background, property) => { hits.push(["pairTitle", foreground, background, property]); return "TITOLO " + foreground; },
    themeLabel: (theme) => { hits.push(["themeLabel", theme]); return theme === "dark" ? "scuro" : "chiaro"; },
    variantLabel: (variant) => (variant === "tuned" ? "con tuning" : "generato"),
    roleLabel: (role) => String(role),
  };
  const report = {
    preference: { active: "light", unmeasured: ["dark"] },
    coverage: { complete: false },
    executed: { scenarios: ["baseline-light-light"] },
    scenarios: [{ id: "baseline-light-light", variant: "baseline", theme: "light", preference: "light", status: "measured" }],
    measurements: [
      { pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "baseline-light-light", foreground: "oklch(0.4 0.1 350)", background: "oklch(0.95 0.02 90)", ratio: 4.44, minimum: 4.5, target: 4.6, status: "below-target", error: null },
      { pairId: "light|color|--color-text|--color-bg", scenarioId: "baseline-light-light", foreground: "oklch(0.28 0.007 3.68)", background: "oklch(0.95 0.01 86)", ratio: 12.6, minimum: 4.5, target: 7, status: "pass", error: null },
    ],
    errors: [{ phase: "measure", cause: "computed-empty", message: "x" }],
    unsupported: [{ id: "baseline-dark-light", reason: "forced-colors is active" }],
  };
  const controller = { status: () => ({ state: "incomplete", report }), subscribe: (fn) => { listener = fn; return () => {}; } };
  const presenter = factory({ document: dom.document, controller, language });
  assert.ok(presenter, "the presenter must attach to the host");
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  assert.ok(panel, "the presenter must create its own panel before the frames container");
  assert.equal(panel.children[0].tagName, "h3");
  assert.equal(panel.children[0].textContent, "Misure locali di questo browser");
  const scope = panel.children.find((child) => child.className === "local-scope");
  assert.match(scope.textContent, /Verifica locale di questo browser, separata dal modello e dall'automazione/);
  assert.match(scope.textContent, /Preferenza attiva: light/);
  assert.match(scope.textContent, /l'altra preferenza di sistema \(dark\) non è misurata: è un'altra preferenza, non un tema/);
  const combos = panel.children.find((child) => child.className === "local-combos");
  assert.match(combos.children[0].textContent, /generato · chiaro: 2 misurate · 1 sotto il target/);
  // Problems come before the raw data, carrying variant, theme, the designer title and the sample.
  const grid = panel.children.find((child) => child.className === "local-problems");
  assert.equal(grid.children.length, 1, "only the below-target pair is a problem");
  const card = grid.children[0];
  assert.equal(card.children[0].textContent, "Misurato in questo browser · generato · chiaro");
  assert.equal(card.children[1].textContent, "TITOLO --color-primary-text");
  const visual = card.children[2];
  assert.equal(visual.style.props["--sample-fg"], "oklch(0.4 0.1 350)");
  assert.equal(visual.style.props["--sample-bg"], "oklch(0.95 0.02 90)");
  assert.deepEqual(visual.children.map((child) => child.className), ["pair-title", "pair-text"]);
  assert.match(card.children[3].textContent, /^Sotto il target · 4,44:1$/);
  assert.match(card.children[4].textContent, /Minimo applicato 4,50:1 · target 4,60:1/);
  const tokenDetail = card.children[5];
  assert.equal(tokenDetail.children[0].textContent, "Token esatti");
  assert.match(tokenDetail.children[1].textContent, /--color-primary-text su --color-primary-surface · proprietà color/);
  assert.match(card.children[6].textContent, /rivedi la palette sorgente/);
  assert.ok(hits.some(([method]) => method === "pairTitle"), "the presenter must use the injected designer language");
  assert.ok(hits.some(([method]) => method === "themeLabel"), "the presenter must use the injected theme label");
  // Raw measurements live inside a native details, with a valid caption, headers and scroller.
  const details = panel.children.find((child) => child.className === "local-details");
  assert.equal(details.children[0].tagName, "summary");
  const scroll = details.children[1];
  assert.equal(scroll.className, "local-table-scroll");
  assert.equal(scroll.getAttribute("role"), "region");
  const table = scroll.children[0];
  const head = table.children.find((child) => child.tagName === "thead");
  assert.deepEqual(head.children[0].children.map((cell) => cell.textContent), ["Scenario", "Coppia", "Rapporto", "Minimo", "Target", "Esito", "Nota"]);
  assert.ok(head.children[0].children.every((cell) => cell.getAttribute("scope") === "col"));
  const body = table.children.find((child) => child.tagName === "tbody");
  assert.equal(body.children[0].children[0].getAttribute("scope"), "row");
  assert.equal(body.children[0].children[2].textContent, "4,44:1");
  assert.equal(body.children[0].children[2].getAttribute("data-ratio"), "4.44");
  const headings = panel.children.filter((child) => child.tagName === "h3").map((child) => child.textContent);
  assert.deepEqual(headings, ["Misure locali di questo browser", "Problemi nelle coppie misurate (1)", "Scenari non supportati", "Errori della verifica locale"]);
  assert.equal(listener instanceof Function, true);
  // A fresh subscriber snapshot must repaint the same panel without duplicating it.
  listener({ state: "pending", report: null });
  assert.equal(dom.host.children.filter((child) => child.className === "local-rows").length, 1);
});

test("the presenter degrades to technical wording when no designer language is available", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] },
    expected: { scenarios: ["baseline-light-light"], pairs: {} },
    executed: { scenarios: ["baseline-light-light"] },
    measurements: [{ pairId: "light|color|--color-a|--color-b", scenarioId: "baseline-light-light", foreground: "oklch(0.4 0.1 350)", background: "oklch(0.95 0.02 90)", ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", error: null }],
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const card = panel.children.find((child) => child.className === "local-problems").children[0];
  assert.equal(card.children[1].textContent, "--color-a su --color-b");
  assert.equal(card.children[0].textContent, "Misurato in questo browser · baseline · light");
  assert.match(panel.children.find((child) => child.className === "local-combos").children[0].textContent, /baseline · light: 1 misurate/);
});

test("a session preview stays useful without JavaScript and keeps the model out of any verified verdict", () => {
  const html = preview(diagSession());
  assert.match(html, /<h1>La tua palette, in uso\.<\/h1>/);
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  assert.match(html, /<main id="contenuto">/);
  // Three explicit channels, never one global verdict: model forecast, this browser, automation.
  assert.match(html, /<strong>Modello<\/strong> Stima del modello/);
  assert.match(html, /<strong>Questo browser<\/strong>/);
  assert.match(html, /<strong>Automazione<\/strong> Automazione: disattivata o non richiesta/);
  assert.doesNotMatch(html, /badge badge--dashed">Snapshot non verificato/);
  assert.doesNotMatch(html, /class="verdict"/);
  // One single family catalog, presented as a model forecast, with no verification badge.
  assert.equal((html.match(/Famiglia <code>--color-primary<\/code>/g) ?? []).length, 1, "one single family catalog");
  assert.doesNotMatch(html, /id="modello"/);
  assert.doesNotMatch(html, /Campioni dal modello \(senza browser\)/);
  assert.match(html, /stime del modello/);
  assert.doesNotMatch(html, /class="color-choice color-choice--suggested"/);
  assert.match(html, /Verifica automatizzata/);
  assert.match(html, /Automazione disattivata/);
  assert.match(html, /Misure locali non eseguite: serve JavaScript nel browser/);
  assert.match(html, /Snapshot incorporato: <code>snap-123<\/code> · Versione tool: <code>0\.3\.0<\/code>/);
  assert.match(html, /<a href="smart-colors\.html">/);
});

test("session markup follows the navigation, keeps a logical heading order and never moves focus", () => {
  const html = preview(diagSession());
  const anchors = [...html.match(/<nav aria-label="Sezioni dell’anteprima">([\s\S]*?)<\/nav>/)[1].matchAll(/href="#([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(anchors, ["banco", "palette", "diagnostica"]);
  // Every navigation target exists; the workbench leads, the raw source archive follows, the technical archive closes.
  for (const id of anchors) assert.ok(html.includes('id="' + id + '"'), "the navigation target #" + id + " must exist");
  assert.ok(html.indexOf('id="banco"') < html.indexOf('id="palette"'), "the workbench leads the source archive");
  assert.ok(html.indexOf('id="palette"') < html.indexOf('id="diagnostica"'), "the source archive precedes the technical archive");
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

// Final preview budget, explicitly approved: 768 KiB (786.432 B). The preview keeps every
// scope/coverage/engine/error/unsupported automation summary and accurate measurement counts, while
// the wide measurement/exploration tables live only in the full static report (compact preview).
// Measured (2026-10-18, mandatory workbench runtime + additive `session.paletteSource` + controller-
// driven UI + explicit-value controls + controller-projected selection + verified proposal frames +
// compact preview automation): starter 371.964 B, extended stress fixture 478.967 B (both asserted);
// real root snapshot `report --automation=off` 691.487 B and automation-enabled (2.176 measurements)
// 694.045 B (16 captured sources, 5.170 B of captured palette CSS). Both root artifacts stay inside
// the budget; the stress fixture is the heaviest case asserted here.
const PREVIEW_BUDGET_BYTES = 768 * 1024;

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

test("a session preview stays inside the mandatory offline budget on the starter and the stress palette", () => {
  const starter = Buffer.byteLength(preview(diagSession()), "utf8");
  const extended = Buffer.byteLength(preview(extendedSession()), "utf8");
  if (process.env.SMART_COLORS_PREVIEW_BUDGET_REPORT) {
    console.log(`preview bytes: starter ${starter} · stress ${extended} · budget ${PREVIEW_BUDGET_BYTES}`);
  }
  assert.ok(starter <= PREVIEW_BUDGET_BYTES, `starter preview is ${starter} bytes, over the budget`);
  assert.ok(extended <= PREVIEW_BUDGET_BYTES, `stress preview is ${extended} bytes, over the budget`);
  assert.ok(extended > starter, "the stress palette must be the heavier measurement");
});

test("the session family catalog keeps technical tokens inside collapsed native details", () => {
  const html = preview(diagSession());
  assert.match(html, /<details class="is-detail"><summary>Token e soglie<\/summary>/);
  const sample = html.match(/<li class="family-sample">([\s\S]*?)<\/li>/)[1];
  assert.match(sample, /<details class="is-detail">/);
  assert.doesNotMatch(sample.split("<details")[0], /--color-primary-text/, "the token line stays inside the collapsed detail");
});

test("the local presenter never writes markup and drops an unvalidated color", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const hostile = "</style><img src=x onerror=alert(1)>";
  const report = {
    preference: { active: "light", unmeasured: [] }, coverage: { complete: true }, executed: { scenarios: ["baseline-light-light"] },
    scenarios: [{ id: "baseline-light-light", variant: "baseline", theme: "light", status: "measured" }],
    measurements: [{ pairId: hostile, scenarioId: "baseline-light-light", foreground: hostile, background: hostile, ratio: 2.1, minimum: 4.5, target: 4.6, status: "below-minimum", error: null }],
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const card = panel.children.find((child) => child.className === "local-problems").children[0];
  // An unvalidated color never reaches a style property and no sample figure is built.
  assert.equal(card.children.length, 6, "no sample figure for an unvalidated color");
  assert.equal(card.children[2].tagName, "p");
  assert.doesNotMatch(createLocalPresenter.toString(), /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
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
function tableOf(panel) {
  const details = panel.children.find((child) => child.className === "local-details");
  return details.children[1].children[0];
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
  const body = tableOf(panel).children.find((child) => child.tagName === "tbody");
  const cell = body.children[0].children[2];
  assert.equal(cell.textContent, "< 4,5:1");
  assert.notEqual(cell.textContent, "4,50:1");
  assert.equal(cell.getAttribute("data-ratio"), "4.4999");
  assert.match(panel.children.find((child) => child.className === "local-scope").textContent, /Preferenza attiva: light/);
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
  assert.match(html, /<span class="badge badge--outline">Verifica automatizzata completa negli ambienti eseguiti<\/span>/);
  assert.match(html, /Automazione: copertura completa negli ambienti eseguiti \(motori e scenari elencati\), non universale\./);
  assert.match(html, /Copertura completa negli ambienti eseguiti \(i motori e gli scenari elencati qui sotto\), non universale/);
  assert.match(html, /<h4>Motori richiesti<\/h4>/);
  assert.match(html, /<code>chromium<\/code> 151\.0\.7922\.34 · Completa · eseguito/);
});

test("an incomplete or partial automation run cannot render a positive preview header", () => {
  const html = preview(diagSession({ automation: automationRun({ partial: true, status: "incomplete", coverage: { complete: false, expectedCount: 1, measuredCount: 0 } }) }));
  assert.doesNotMatch(html, /Verifica automatizzata completa negli ambienti eseguiti/);
  assert.doesNotMatch(html, /badge badge--dashed">Snapshot non verificato/);
  assert.doesNotMatch(html, /class="verdict"/);
  assert.match(html, /Automazione: copertura parziale o incompleta/);
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
  // Compact preview: the wide measurement/exploration tables move to the full report, while the
  // failing measurement stays visible through accurate counts and an explicit link.
  assert.doesNotMatch(markup, /<caption>Misure automatizzate per coppia<\/caption>/);
  assert.match(markup, /<h4>Misure automatizzate \(1\)<\/h4>/);
  assert.match(markup, /<ul class="automation-counts"><li><strong>1<\/strong> sotto il minimo<\/li><li><strong>0<\/strong> sotto il target<\/li><li><strong>0<\/strong> non misurate<\/li><li><strong>0<\/strong> raggiungono minimo e target<\/li><\/ul>/);
  assert.match(markup, /<a href="smart-colors.html">Apri misure complete nel report<\/a>/);
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
    assert.doesNotMatch(html, /Verifica automatizzata completa negli ambienti eseguiti/, label);
    assert.doesNotMatch(html, /Copertura completa negli ambienti eseguiti/, label);
    assert.doesNotMatch(html, /Snapshot non verificato/, label);
    assert.doesNotMatch(html, /class="color-choice color-choice--suggested"/, label);
    assert.match(html, /Nessun colore suggerito/, label);
    assert.match(html, /<strong>Modello<\/strong>/, label);
    assert.match(html, /Dettagli della verifica automatizzata \(tecnici\)|Nessuna verifica automatizzata inclusa/, label);
  }
});

test("a session preview with valid scenarios and complete automation may be positive", () => {
  const html = preview(sessionWithIssue({ automation: automationRun() }));
  assert.match(html, /Verifica automatizzata completa negli ambienti eseguiti/);
  assert.match(html, /class="color-choice color-choice--suggested"/);
  assert.match(section(html, "correzioni"), /<h4>Correzione locale del primo piano<\/h4>/);
  assert.doesNotMatch(html, /class="verdict"/);
});

test("a session preview never claims a global verdict", () => {
  const gated = preview(sessionAllPass({ automation: automationRun({ status: "incomplete", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [] }) }));
  assert.doesNotMatch(gated, /class="verdict"/);
  assert.doesNotMatch(gated, /Esito positivo dello snapshot/);
  assert.doesNotMatch(gated, /Verifica automatizzata completa negli ambienti eseguiti/);
  assert.match(gated, /Automazione: copertura parziale o incompleta/);
  const positive = preview(sessionAllPass({ automation: automationRun() }));
  assert.match(positive, /Verifica automatizzata completa negli ambienti eseguiti/);
  assert.doesNotMatch(positive, /class="verdict"/);
});

// --- Reviewer fixes: provenance/scope correctness on a REAL session and honest local scoping. ---

test("the source palette prints the exact token name and role from a real session", async () => {
  const { createDiagnosticSession } = await import("../src/diagnostic-session.mjs");
  // Self-contained fixture: a temporary directory with a minimal palette and no monorepo or CWD
  // dependency. The session is created from that root only, and only this directory is removed.
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-preview-"));
  try {
    await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
    await writeFile(path.join(root, "src/styles/tokens/palette.css"), [
      "@property --palette-canvas { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.97 0.005 250); role: canvas; }",
      "@property --palette-ink { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.24 0.01 250); role: ink; }",
      "@property --palette-brand { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; dark-blend: 80; }",
      "@property --palette-success { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.6 0.13 150); role: feedback; }",
      "",
    ].join("\n"));
    // An identity keyed by `paletteName` must win over the palette annotation: the brand identity is
    // declared as `feedback`, while the palette block says `ui`.
    const config = {
      ...defaultSmartColorsConfig,
      roles: { ...defaultSmartColorsConfig.roles, identities: { brand: { token: "--palette-brand", role: "feedback" } } },
    };
    const { session } = await createDiagnosticSession({ root, config, automation: "off", suggest: false });
    const html = preview(session);
    // The exact source contract moved to the additive `session.paletteSource`; `session.palette`
    // stays the legacy array the static report validates.
    const source = session.paletteSource ?? session.palette;
    assert.ok(source && Array.isArray(source.sources) && source.sources.length > 0, "the real session must expose palette sources");
    assert.equal(source.path, "src/styles/tokens/palette.css");
    assert.equal(typeof source.sha256, "string");
    assert.equal(source.css, await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), "the captured CSS must be the exact palette bytes");
    if (session.paletteSource) assert.ok(Array.isArray(session.palette), "the legacy palette array is preserved for the static report");
    for (const entry of source.sources) {
      const escaped = entry.token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      assert.match(html, new RegExp(`<code>${escaped}</code>`), `the exact token ${entry.token} must appear verbatim`);
    }
    // Raw source value and the real @property declaration are served statically, escaped.
    // (No macro editor scope: only the selected pair's declared public controls are exposed.)
    assert.match(html, /Valore sorgente dichiarato: <code>oklch\(0\.56 0\.14 255\)<\/code>/);
    assert.match(html, /<code class="wb-declaration">@property --palette-brand \{ syntax: &quot;&lt;color&gt;&quot;; inherits: true; initial-value: oklch\(0\.56 0\.14 255\); role: ui; dark-blend: 80; \}<\/code>/);
    assert.doesNotMatch(html, /--color--/, "the already-prefixed palette name must never be re-prefixed");
    // The declared `@property` role is preserved; a differing configured role is shown separately
    // and explicitly, never silently substituted as authored.
    assert.match(html, /<code>--palette-brand<\/code> · ruolo dichiarato: interfaccia · ruolo effettivo \(config\): feedback/);
    assert.match(html, /<code>--palette-canvas<\/code> · ruolo dichiarato: sfondo della pagina/);
    // Real generator metadata: authored dark-blend 80 maps to 77.6% source / 22.4% white (percents,
    // never multiplied), and the surface mix fractions 0.1/0.18 render as 10%/18% (×100, not 0.1%).
    assert.match(html, /dark-blend 80 → source 77\.6% \/ white 22\.4%/);
    assert.match(html, /mix 10% source \/ 90% base \(chiaro\), 18%\/82% \(scuro\), sostituibile da un controllo — regola di progetto, non WCAG/);
    assert.doesNotMatch(html, /default 0[.,]/, "a fractional defaultMix is never shown as a fraction-percent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real integrity errors stay visible while an absent automation is not an error", () => {
  const clean = preview(diagSession());
  assert.doesNotMatch(clean, /Problemi di integrità o errori dello snapshot/, "an absent automation is not an integrity error");
  const strict = preview(diagSession({ generationErrors: ["canvas non risolve un colore valido"] }));
  assert.match(strict, /Problemi di integrità o errori dello snapshot/);
  assert.match(strict, /canvas non risolve un colore valido/);
  assert.ok(strict.indexOf("Problemi di integrità") < strict.indexOf('id="palette"'), "errors stay above the content");
  const corrupt = preview(diagSession({ inputDigest: "not-a-digest" }));
  assert.match(corrupt, /Problemi di integrità o errori dello snapshot/);
  assert.match(corrupt, /Impronta SHA-256 degli input assente o non valida/);
});

test("the presenter combination list is honest about missing, unmeasured and unrun scenarios", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] },
    expected: { scenarios: ["baseline-light-light", "baseline-dark-light", "tuned-light-light", "tuned-dark-light"] },
    executed: { scenarios: ["baseline-light-light", "tuned-light-light"] },
    measurements: [
      { pairId: "light|color|--color-a|--color-b", scenarioId: "baseline-light-light", ratio: 5, minimum: 4.5, target: 7, status: "below-target", error: null },
      { pairId: "light|color|--color-a|--color-b", scenarioId: "tuned-light-light", ratio: null, minimum: 4.5, target: 7, status: "unmeasured", error: "computed-empty" },
    ],
    errors: [], unsupported: [{ id: "baseline-dark-light", reason: "forced-colors" }],
  };
  const controller = { status: () => ({ state: "incomplete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const combos = panel.children.find((child) => child.className === "local-combos").children.map((item) => item.textContent);
  assert.match(combos[0], /baseline · light: 1 misurate · 1 sotto il target/);
  assert.match(combos[1], /baseline · dark: non eseguita \(attesa\)/);
  assert.match(combos[2], /tuned · light: nessuna misurata · 1 non misurate/);
  assert.match(combos[3], /tuned · dark: non eseguita \(attesa\)/);
  assert.doesNotMatch(panel.children.find((child) => child.className === "local-scope").textContent, /entrambi i temi/, "never claim both themes without evidence");
});

test("a non-text local problem shows a border indicator, deduped thresholds and exact tokens", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] }, executed: { scenarios: ["baseline-light-light"] },
    measurements: [{ pairId: "light|borderColor|--color-border-strong|--color-surface", scenarioId: "baseline-light-light", foreground: "oklch(0.6 0.1 30)", background: "oklch(0.95 0.02 90)", ratio: 2, minimum: 3, target: 3, status: "below-minimum", error: null }],
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const card = panel.children.find((child) => child.className === "local-problems").children[0];
  const visual = card.children[2];
  assert.deepEqual(visual.children.map((child) => child.className), ["pair-border", "pair-border pair-border--2", "pair-border pair-border--3"]);
  assert.equal(visual.children[0].textContent, "", "a border pair must not render sample text");
  assert.match(card.children[4].textContent, /^Soglia 3,00:1\.$/, "an equal minimum and target is not duplicated");
  assert.match(card.children[5].children[1].textContent, /--color-border-strong su --color-surface · proprietà borderColor/);
});

test("the presenter re-renders when the controller publishes a new preference", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  let listener = null;
  const reportFor = (active) => ({ preference: { active, unmeasured: [active === "light" ? "dark" : "light"] }, executed: { scenarios: ["baseline-light-light"] }, measurements: [], errors: [], unsupported: [] });
  const controller = { status: () => ({ state: "complete", report: reportFor("light") }), subscribe: (fn) => { listener = fn; return () => {}; } };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  assert.match(panel.children[1].textContent, /Preferenza attiva: light/);
  listener({ state: "complete", report: reportFor("dark") });
  assert.match(panel.children[1].textContent, /Preferenza attiva: dark/);
  assert.equal(dom.host.children.filter((child) => child.className === "local-rows").length, 1);
});

test("the presenter shows a neutral pending state without claiming results", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const controller = { status: () => ({ state: "running", report: null }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  assert.equal(panel.children[0].textContent, "Misure locali di questo browser");
  assert.match(panel.children[1].textContent, /Nessuna misura locale disponibile/);
  assert.equal(panel.children.some((child) => child.className === "local-problems"), false);
});

test("the combination list counts only finite ratios and reports missing pairs", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] },
    expected: { scenarios: ["baseline-light-light"], pairs: { "baseline-light-light": ["light|color|--color-a|--color-b", "light|color|--color-c|--color-d", "light|color|--color-e|--color-f"] } },
    executed: { scenarios: ["baseline-light-light"] },
    measurements: [
      { pairId: "light|color|--color-a|--color-b", scenarioId: "baseline-light-light", ratio: 5, minimum: 4.5, target: 7, status: "pass", error: null },
      { pairId: "light|color|--color-c|--color-d", scenarioId: "baseline-light-light", ratio: null, minimum: 4.5, target: 7, status: "unmeasured", error: "computed-empty" },
    ],
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "incomplete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const combo = panel.children.find((child) => child.className === "local-combos").children[0].textContent;
  assert.match(combo, /1 misurate/);
  assert.match(combo, /1 non misurate/);
  assert.match(combo, /1 mancanti/);
  assert.doesNotMatch(combo, /3 misurate/);
});

test("an unmeasured local problem is labelled Non misurato and gets no sample", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] }, executed: { scenarios: ["baseline-light-light"] },
    measurements: [{ pairId: "light|color|--color-a|--color-b", scenarioId: "baseline-light-light", foreground: null, background: null, ratio: null, minimum: 4.5, target: 7, status: "unmeasured", error: "computed-empty" }],
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const card = panel.children.find((child) => child.className === "local-problems").children[0];
  assert.match(card.children[0].textContent, /^Non misurato in questo browser · baseline · light$/);
  // eyebrow, title, status, threshold, token details, next step — no sample figure.
  assert.equal(card.children.length, 6);
  assert.equal(card.children[2].tagName, "p");
  assert.equal(panel.children.some((child) => child.className === "local-problems" && child.children[0].children.some((c) => c.className === "pair-visual")), false);
});

test("the read-only next step follows the variant without naming a specific file", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] }, executed: { scenarios: ["baseline-light-light", "tuned-light-light"] },
    measurements: [
      { pairId: "light|color|--color-a|--color-b", scenarioId: "baseline-light-light", foreground: "oklch(0.4 0.1 350)", background: "oklch(0.95 0.02 90)", ratio: 3, minimum: 4.5, target: 4.6, status: "below-minimum", error: null },
      { pairId: "light|color|--color-a|--color-b", scenarioId: "tuned-light-light", foreground: "oklch(0.4 0.1 350)", background: "oklch(0.95 0.02 90)", ratio: 3, minimum: 4.5, target: 4.6, status: "below-minimum", error: null },
    ],
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const cards = panel.children.find((child) => child.className === "local-problems").children;
  const baseline = cards[0].children[6].textContent;
  const tuned = cards[1].children[6].textContent;
  assert.match(baseline, /rivedi la palette sorgente/);
  assert.match(tuned, /confronta prima il caso senza tuning/);
  for (const text of [baseline, tuned]) assert.doesNotMatch(text, /palette\.css|colors-tuning\.css/);
});

test("the model catalog is separated from the local run and the first family is open", () => {
  const html = preview(diagSession());
  assert.match(html, /Fallback senza browser — stime del modello:/);
  assert.match(html, /Sono previsioni, non verifiche/);
  assert.match(html, /<details class="card family-strip" open>/);
  assert.match(html, /Stima: <span class="contrast-value">/);
  assert.doesNotMatch(html, /class="tier">AA</, "no AA pass badge in the model catalog");
});

// --- Frozen freeze: design provenance, real measured visuals, explorations, provenance metadata. ---

function designFixture() {
  return {
    version: 1,
    sources: [
      { token: "--palette-brand", name: "brand", role: "ui", darkBlend: 80, darkMix: { mode: "explicit", sourcePercent: 77.6, whitePercent: 22.4 } },
      { token: "--palette-canvas", name: "canvas", role: "canvas", darkBlend: 40, darkMix: { mode: "explicit", sourcePercent: 88.8, whitePercent: 11.2 } },
      { token: "--palette-ink", name: "ink", role: "ink", darkBlend: null, darkMix: { mode: "adaptive", sourcePercent: 60, whitePercent: 40 } },
      { token: "--palette-highlight", name: "highlight", role: "decorative", darkBlend: 10, darkMix: { mode: "explicit", sourcePercent: 97.2, whitePercent: 2.8 } },
      { token: "--palette-success", name: "success", role: "feedback", darkBlend: 50, darkMix: { mode: "explicit", sourcePercent: 86, whitePercent: 14 } },
    ],
    recipes: { text: { kind: "contrast", basis: "contrast", usage: "family text" }, surface: { kind: "mix", basis: "design", usage: "tinted background" } },
    tokens: {
      "--color-primary-text": { sources: ["--palette-brand"], recipe: "text", usage: "Testo della famiglia", controls: { light: { override: "--color-tune-light-warmth" }, dark: { mix: "--color-tune-brand-dark-mix", defaultMix: 0.78 } } },
      "--color-primary-surface": { sources: ["--palette-brand"], recipe: "surface", usage: "Sfondo tinto", controls: { light: { override: "--color-tune-dark-surface-mix" } } },
    },
  };
}

const designToolsStub = () => ({
  surfaceRatio: (variant, theme) => (theme === "dark" ? (variant === "surface-strong" ? 0.28 : 0.18) : (variant === "surface-strong" ? 0.18 : 0.1)),
  darkBlendMix: (value) => ({ sourcePercent: 100 - value * 0.28, whitePercent: value * 0.28 }),
  describeToken: () => null,
});

test("the payload carries design as inert data without widening the executable config", () => {
  const html = preview(diagSession({ design: designFixture() }));
  const payload = JSON.parse(payloadBlock(html));
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.design.version, 1);
  assert.deepEqual(Object.keys(payload.config).sort(), ["contrast", "roles"]);
  assert.ok(!payloadBlock(html).includes("<"), "the payload block stays tag-free inert JSON");
});

test("design metadata is escaped in the drawn-color panel", () => {
  const hostile = "</style><img src=x onerror=alert(1)>";
  const design = designFixture();
  design.tokens["--color-primary-text"].usage = hostile;
  design.sources[0].name = hostile;
  const html = preview(diagSession({ design }));
  assert.doesNotMatch(markupOf(html), /<img/);
  assert.ok(!markupOf(html).includes(hostile));
  assert.match(html, /&lt;img src=x/);
});

test("dark-blend is shown for every role from the shared factory values", () => {
  const html = preview(diagSession({ design: designFixture() }));
  assert.match(html, /<code>--palette-brand<\/code> · ui · dark-blend 80 → source 77\.6% \/ white 22\.4%/);
  assert.match(html, /<code>--palette-canvas<\/code> · canvas · dark-blend 40 → source 88\.8% \/ white 11\.2%/);
  assert.match(html, /<code>--palette-ink<\/code> · ink · dark-blend adattivo → source 60% \/ white 40%/);
  assert.match(html, /<code>--palette-highlight<\/code> · decorative · dark-blend 10 → source 97\.2% \/ white 2\.8%/);
  assert.match(html, /<code>--palette-success<\/code> · feedback · dark-blend 50 → source 86% \/ white 14%/);
  assert.match(html, /Regola di progetto 10\/90 \(source↔white\), non una soglia WCAG/);
});

test("each sample exposes the public control, the recipe and the surface mix rule", () => {
  const html = preview(diagSession({ design: designFixture() }));
  assert.match(html, /--color-tune-brand-dark-mix \(default 78%\)/);
  assert.doesNotMatch(html, /default 0[.,]/, "a fractional defaultMix is never shown as a fraction-percent");
  assert.match(html, /--color-tune-light-warmth/);
  assert.match(html, /mix 10% source \/ 90% base \(chiaro\), 18%\/82% \(scuro\), sostituibile da un controllo — regola di progetto, non WCAG/);
  assert.match(html, /Ricetta di partenza \(generatore\): text \(contrast\)/);
});

test("the preview states the CSS source and never presents the model as the current output", () => {
  const html = preview(diagSession({ css: { baseline: ":root{}", tuning: null, tuningSupport: "absent", source: "generated-candidate", status: "stale", digest: { generated: "a".repeat(64), baseline: "b".repeat(64) } } }));
  assert.match(html, /CSS misurato: candidato generato/);
  assert.match(html, /stato: non aggiornato/);
  assert.match(html, /impronta misurata <code>bbbbbbbb<\/code>/);
  assert.match(html, /Nessun modello è mostrato come stato attuale/);
  assert.doesNotMatch(html, /\[object Object\]/, "the digest object is never stringified");
});

test("an absent generated candidate is stated explicitly and the measured digest is used", () => {
  const html = preview(diagSession({ css: { baseline: "", tuning: null, tuningSupport: "absent", source: "generated-candidate", status: "absent", digest: { generated: "c".repeat(64), baseline: null } } }));
  assert.match(html, /Il candidato generato è misurato dai byte catturati; nel progetto non esiste ancora un file di output/);
  assert.match(html, /<code>cccccccc<\/code> \(atteso, non misurato\)/);
  assert.doesNotMatch(html, /candidato generato è assente/, "an absent output is not an absent candidate");
});

test("the presenter source serializes the design tools factory self-contained", () => {
  const source = localPresenterSource();
  assert.match(source, /var createDesignTools = function createDesignTools/);
  assert.match(source, /createLocalPresenter\(\{ controller: globalThis\.__smartColorsDiagnostic, document: document, language: language, tools: tools \}\)/);
  assert.ok(!source.includes("</"));
});

test("the presenter builds measured visuals per theme and variant, and drops them while pending", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  let listener = null;
  const report = {
    preference: { active: "light", unmeasured: ["dark"] },
    executed: { scenarios: ["baseline-light-light", "tuned-dark-light"] },
    measurements: [
      { pairId: "light|color|--color-text|--color-bg", scenarioId: "baseline-light-light", foreground: "oklch(0.28 0.007 3.68)", background: "oklch(0.95 0.01 86)", ratio: 12.6, minimum: 4.5, target: 7, status: "pass", error: null },
      { pairId: "dark|color|--color-text|--color-bg", scenarioId: "tuned-dark-light", foreground: "oklch(0.9 0.01 86)", background: "oklch(0.2 0.007 3.68)", ratio: 11.1, minimum: 4.5, target: 7, status: "pass", error: null },
    ],
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: (fn) => { listener = fn; return () => {}; } };
  factory({ document: dom.document, controller, tools: designToolsStub() });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const catalog = panel.children.find((child) => child.className === "local-catalog");
  assert.ok(catalog, "the measured catalog is rendered");
  const items = catalog.children[2].children.map((li) => li.children.map((child) => child.textContent).join(""));
  assert.ok(items.some((text) => /Testo sulla pagina · baseline · light/.test(text)), "baseline light sample present");
  assert.ok(items.some((text) => /Testo sulla pagina · tuned · dark/.test(text)));
  listener({ state: "pending", report });
  assert.equal(panel.children.some((child) => child.className === "local-catalog"), false, "no visuals while pending");
});

test("the presenter surfaces measured explorations and their coverage", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] },
    executed: { scenarios: ["overlap-light-light"] },
    measurements: [],
    explorations: [
      { pairId: "light|color|--color-primary|--color-secondary", scenarioId: "overlap-light-light", foreground: "oklch(0.4 0.1 30)", background: "oklch(0.5 0.12 200)", ratio: 2.1, minimum: 4.5, target: 4.5, status: "below-minimum", error: null },
    ],
    explorationCoverage: { expected: 3, measured: 1, unmeasured: 2, complete: false },
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller, tools: designToolsStub() });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const explorations = panel.children.find((child) => child.className === "local-explorations");
  assert.ok(explorations, "explorations are rendered");
  const scope = explorations.children[2].textContent;
  assert.match(scope, /Copertura esplorativa parziale: 1 di 3 misurate · 2 non misurate/);
  const first = explorations.children[3].children[0].textContent;
  assert.match(first, /--color-primary su --color-secondary · Sotto il minimo 2,10:1 · minimo 4,50:1 · target 4,50:1/);
  assert.equal(explorations.children[3].children[0].children.length, 0, "an exploration pair is text: no border/indicator visual");
  assert.doesNotMatch(explorations.textContent ?? "", /raccomand|usabile per testo/);
});

test("every drawn color exposes token, sources, recipe and public control without inspection", () => {
  const html = preview(diagSession({ design: designFixture() }));
  const usi = html.match(/<section id="usi"[\s\S]*?<\/section>/)[0];
  assert.match(usi, /<code>--color-primary-text<\/code>/);
  assert.match(usi, /<code>--color-primary-surface<\/code>/);
  assert.match(usi, /sorgenti: brand/);
  assert.match(usi, /Ricetta di partenza \(generatore\): text \(contrast\)/);
  assert.match(usi, /Ricetta di partenza \(generatore\): surface \(mix\)/);
  assert.match(usi, /Controllo per personalizzare/);
  assert.match(usi, /--color-tune-brand-dark-mix \(default 78%\)/);
  assert.match(usi, /--color-tune-light-warmth/);
  assert.doesNotMatch(usi, /--_color-/, "only public --color-tune-* control names, never an internal prefix");
});

test("for a tuned sample the start recipe is labelled generator and never claims the measured value", () => {
  // A full surface override exists: the measured value stays authoritative and the recipe is only a
  // starting point that an override can replace.
  const design = designFixture();
  design.tokens["--color-primary-surface"].controls = { dark: { override: "--color-tune-brand-dark-full" } };
  const html = preview(diagSession({ design }));
  const usi = html.match(/<section id="usi"[\s\S]*?<\/section>/)[0];
  assert.match(usi, /Ricetta di partenza \(generatore\)/);
  assert.match(usi, /sostituibile da un controllo/);
  assert.match(usi, /Controllo per personalizzare — dark: --color-tune-brand-dark-full/);
  assert.doesNotMatch(usi, /colore misurato deriva|il misurato deriva/);
});

test("exploration coverage mirrors the report fields and fails closed", () => {
  const factory = new Function("return (" + createLocalPresenter.toString() + ");")();
  const dom = presenterDom();
  const report = {
    preference: { active: "light", unmeasured: ["dark"] }, executed: { scenarios: [] }, measurements: [],
    explorations: [],
    explorationCoverage: { expected: ["a", "b"], measured: ["a"], unmeasured: ["b"], omittedFamilies: ["f1", "f2", "f3"], complete: true },
    errors: [], unsupported: [],
  };
  const controller = { status: () => ({ state: "complete", report }), subscribe: () => () => {} };
  factory({ document: dom.document, controller, tools: designToolsStub() });
  const panel = dom.host.children.find((child) => child.className === "local-rows");
  const scope = panel.children.find((child) => child.className === "local-explorations").children[2].textContent;
  assert.match(scope, /Copertura esplorativa parziale: 1 di 2 misurate · 1 non misurate · 3 famiglie omesse/, "complete is fail-closed when a unit is unmeasured");
});
