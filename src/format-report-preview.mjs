// Compact companion artifact of reports/smart-colors.html. It reads the same frozen
// snapshot through the same internal helpers, keeps the same fail-closed contract and
// never measures, recalculates or invents anything: an unverified snapshot gets no
// positive verdict and no color is labeled as suggested.
//
// For the SC-03 diagnostic session it also embeds the SC-04 browser runtime, the workbench
// runtime and the workbench view factory (plus a presentation-only presenter serialized
// from this module) and an inert JSON payload of the exact CSS bytes, so the page can add
// local measurements from `file://`. The workbench runtime is a mandatory dependency: a
// missing module fails at import time, never silently. The CSP hash is computed over the
// final emitted script bytes; the static report never gains a script. Local measurements
// only touch the in-memory DOM: they never rewrite this file or the report.
import { createHash } from "node:crypto";
import { createContrastAdvice } from "./contrast-advice.mjs";
import { createContrastWorkbench, WORKBENCH_RUNTIME_GLOBAL } from "./contrast-workbench-runtime.mjs";
import { CONTRAST_WORKBENCH_CSS, createContrastWorkbenchView, renderContrastWorkbench } from "./contrast-workbench-view.mjs";
import { createDesignerLanguage } from "./designer-language.mjs";
import { createDesignTools } from "./design-recipes.mjs";
import { createDiagnosticRuntime, DIAGNOSTIC_RUNTIME_GLOBAL } from "./diagnostic-runtime.mjs";
import { createDomVerifier } from "./verification-dom.mjs";
import { createVerificationCore } from "./verification-core.mjs";
import {
  CSP, MARKER, VARIANT_SHIFT_THRESHOLD, agree, automationHtml, baselineNote, colorChoice, colorCss, compactRatio, cssEmbedHtml,
  deltaSummary, entriesFor, escape, familyAtlasData, fileRole, isDiagnosticSession, it, list, overlapList, prepareContrastReport,
  proposalSentence, prepareDiagnosticReport, record, sampleVisual, sessionIdentityHtml, sideEffectsHtml, status,
} from "./format-report-html.mjs";

// Designer vocabulary is owned by the single internal factory (`designer-language.mjs`), used here at
// build time AND re-serialized verbatim into the browser presenter, so the algorithm and its labels
// are never duplicated between the two runtimes. The import is mandatory: a missing module must fail
// loudly, never silently degrade the designer-facing artifacts.

const FILE_TITLES = {
  palette: "Modifiche in palette.css",
  tuning: "Modifiche in colors-tuning.css",
  config: "Modifiche in smart-colors.config.mjs",
};

const PREVIEW_CSS = `
@layer reset, tokens, base, components, pages, animations, layout, utilities, capabilities, preferences, overrides;
@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
  body, h1, h2, h3, h4, p, ul, ol, dl, dd, figure { margin: 0; }
}
@layer tokens {
  :root {
    color-scheme: light;
    --ink: #14161a;
    --ink-soft: #4a4f57;
    --ink-muted: #6b7280;
    --paper: #ffffff;
    --paper-soft: #f7f7f5;
    --soft: #f2f2ef;
    --line: #d6d7d2;
    --accent: #1f3a5f;
    --warn-soft: #fdf6e8;
    --space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem; --space-5: 1.5rem; --space-6: 2rem; --space-7: 3rem;
    --radius-sm: 4px; --radius: 8px; --radius-lg: 14px;
    --shadow-1: 0 1px 2px rgba(16, 18, 22, .06), 0 1px 3px rgba(16, 18, 22, .04);
    --shadow-2: 0 2px 4px rgba(16, 18, 22, .06), 0 8px 24px rgba(16, 18, 22, .06);
    --text-xs: .8125rem; --text-sm: .875rem; --text-base: 1rem; --text-md: 1.0625rem;
    --text-lg: 1.25rem; --text-xl: 1.5rem;
    --measure: 72ch;
  }
}
@layer base {
  html { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.6; color: var(--ink); background: var(--paper-soft); -webkit-text-size-adjust: 100%; }
  body { overflow-wrap: anywhere; }
  h1, h2, h3, h4 { line-height: 1.2; text-wrap: balance; }
  h1 { font-size: var(--text-xl); letter-spacing: -.015em; }
  h2 { font-size: var(--text-xl); letter-spacing: -.01em; }
  h3 { font-size: var(--text-md); }
  h4 { font-size: var(--text-base); }
  p, li, dd { max-width: var(--measure); }
  a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: .18em; }
  a:hover { text-decoration-thickness: 2px; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: var(--radius-sm); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; user-select: text; }
  code { padding: .1em .35em; border-radius: var(--radius-sm); background: var(--soft); font-size: .92em; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--space-4); border: 1px solid var(--ink-muted); border-radius: var(--radius); background: var(--paper); }
  pre code { padding: 0; background: none; }
  time { font-variant-numeric: tabular-nums; }
}
@layer components {
  .card, .notice { border: 1px solid var(--ink-muted); border-radius: var(--radius); padding: var(--space-4); background: var(--paper); box-shadow: var(--shadow-1); }
  .notice { border-inline-start: .35rem solid var(--accent); background: var(--warn-soft); }
  .card > :first-child, .notice > :first-child { margin-block-start: 0; }
  .card > * + * { margin-block-start: var(--space-3); }
  .eyebrow { font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
  .verdict { font-size: clamp(1.75rem, 1.2rem + 2vw, 2.5rem); font-weight: 700; line-height: 1.15; margin-block: var(--space-2) var(--space-3); }
  .facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 9.5rem), 1fr)); gap: var(--space-2); list-style: none; padding: 0; margin-block: var(--space-4); }
  .facts li { border: 1px solid var(--ink-muted); border-radius: var(--radius); padding: var(--space-2) var(--space-3); background: var(--paper); font-size: var(--text-xs); color: var(--ink-soft); max-width: none; }
  .facts strong { display: block; font-size: var(--text-lg); color: var(--ink); font-variant-numeric: tabular-nums; }
  .badge, .tier { display: inline-block; padding: .15rem .6rem; border-radius: 999px; font-size: var(--text-xs); font-weight: 750; letter-spacing: .02em; }
  .badge--solid { border: 1px solid var(--ink); background: var(--ink); color: var(--paper); }
  .badge--outline { border: 1px solid var(--ink); background: var(--paper); color: var(--ink); }
  .badge--dashed { border: 1px dashed var(--ink-soft); background: var(--paper); color: var(--ink-soft); }
  .tier { border: 1px solid var(--ink-soft); background: var(--paper); color: var(--ink-soft); }
  .contrast-value, .count { font-variant-numeric: tabular-nums; }
  .contrast-value { font-weight: 750; }
  .pair-visual { display: grid; gap: .45rem; align-content: center; min-height: 7rem; padding: var(--space-4); border: 1px solid var(--ink-soft); border-radius: var(--radius); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); }
  .pair-title { font-size: 1.4rem; font-weight: 700; line-height: 1.25; }
  .pair-text { font-size: 1.0625rem; }
  .pair-label { font-size: var(--text-sm); }
  .pair-visual--sample { display: flex; flex-direction: column; justify-content: center; gap: .45rem; font-size: 1.0625rem; }
  .pair-visual--sample::before { content: "Titolo grande"; font-size: 1.4rem; font-weight: 700; line-height: 1.25; }
  .pair-visual--sample::after { content: "Etichetta piccola"; font-size: var(--text-sm); }
  .pair-border { display: block; width: 6rem; height: 1.5rem; border: 1px solid var(--sample-fg, var(--ink)); border-radius: 2px; }
  .pair-border--2 { border-width: 2px; }
  .pair-border--3 { border-width: 3px; }
  .color-choice { padding: var(--space-3); border: 1px solid var(--ink-muted); border-radius: var(--radius); background: var(--paper); }
  .color-choice--suggested { border: 2px solid var(--accent); box-shadow: var(--shadow-1); }
  .change-label { margin-block-end: var(--space-2); font-size: var(--text-sm); font-weight: 750; color: var(--ink); overflow-wrap: anywhere; }
  .swatch { height: 7.5rem; border: 1px solid var(--ink-soft); border-radius: var(--radius-sm); background: var(--sample-color, var(--soft)); }
  .color-choice figcaption strong { display: block; margin-block-end: var(--space-1); }
  .destination dt, .destination dd { display: inline; }
  .destination dd { margin-inline-start: var(--space-2); }
  .destination div + div { margin-block-start: var(--space-1); }
  .margin-note { font-size: var(--text-sm); color: var(--ink-soft); }
  .baseline-note { border-inline-start: .3rem solid var(--ink-muted); padding-inline-start: var(--space-3); color: var(--ink-soft); font-size: var(--text-sm); }
  .side-effect { padding: var(--space-3); border: 1px dashed var(--ink-muted); border-radius: var(--radius); background: var(--paper-soft); }
  .side-effect ul { padding-inline-start: 1.2rem; }
  .side-effect .contrast-value { font-size: var(--text-base); }
  .sample-list { display: grid; gap: var(--space-3); list-style: none; padding: 0; }
  .sample-list li { max-width: none; }
  .family-sample { border: 1px solid var(--ink-muted); border-radius: var(--radius); background: var(--paper); overflow: hidden; }
  .family-visual { display: grid; gap: .35rem; padding: var(--space-3); border-block-end: 1px solid var(--line); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); }
  .sample-title { padding: var(--space-2) var(--space-3) 0; font-weight: 700; font-size: var(--text-sm); }
  .sample-note { padding: var(--space-2) var(--space-3) var(--space-3); font-size: var(--text-xs); color: var(--ink-soft); }
  .family-sample details > p { margin: 0; font-size: var(--text-sm); color: var(--ink-soft); }
  .variant-swatch { display: inline-block; width: 1.4rem; height: 1.4rem; vertical-align: -.4rem; margin-inline-end: var(--space-2); border: 1px solid var(--ink-soft); border-radius: var(--radius-sm); background: var(--sample-color, var(--soft)); }
  .variant-list { padding-inline-start: 1.2rem; font-size: var(--text-sm); }
  .variant-list li { margin-block: var(--space-2); }
  .pair-list { padding-inline-start: 1.2rem; font-size: var(--text-sm); }
  .pair-list li { margin-block: var(--space-1); }
  .pair-list .contrast-value { font-size: var(--text-base); }
  .pair-chip { display: inline-block; margin-inline-end: var(--space-2); padding: 0 .5rem; border: 1px solid var(--ink-soft); border-radius: var(--radius-sm); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); }
  .lede { font-size: var(--text-md); color: var(--ink-soft); max-width: var(--measure); margin-block-start: var(--space-2); }
  .channels { display: grid; gap: var(--space-1); margin-block: var(--space-3); padding: 0; list-style: none; font-size: var(--text-sm); color: var(--ink-soft); }
  .channels li { max-width: var(--measure); }
  .channels strong { color: var(--ink); }
  .role-list { display: grid; gap: var(--space-1); padding: 0; list-style: none; font-size: var(--text-sm); }
  .role-list li { max-width: var(--measure); }
  details.is-detail { margin-block-start: var(--space-1); }
  details.is-detail > summary { cursor: pointer; font-size: var(--text-sm); color: var(--ink-soft); }
  .family-list { display: grid; gap: var(--space-3); }
  details.family-strip > summary { cursor: pointer; font-weight: 750; font-size: var(--text-md); }
  details.family-strip[open] > summary { margin-block-end: var(--space-3); }
  .design-list, .dark-blend-list { padding-inline-start: 1.2rem; font-size: var(--text-sm); color: var(--ink-soft); }
  .design-list li, .dark-blend-list li { max-width: none; margin-block: var(--space-1); }
}
@layer layout {
  .shell { max-width: 76rem; margin-inline: auto; padding: var(--space-4) var(--space-4) var(--space-6); }
  header { border-block-end: 1px solid var(--ink-muted); padding-block-end: var(--space-2); }
  main > section, footer { margin-block: var(--space-6); }
  main > section { container-name: preview-section; container-type: inline-size; scroll-margin-top: 5rem; }
  section > h2 { margin-block-end: var(--space-2); }
  section > h2 + p { color: var(--ink-soft); }
  .grid-2 { display: grid; gap: var(--space-3); grid-template-columns: minmax(0, 1fr); }
  .card-grid { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr)); }
  .card-grid--wide { grid-template-columns: repeat(auto-fit, minmax(min(100%, 26rem), 1fr)); }
  .grid-2 > *, .card-grid > *, .card, .family-theme { min-width: 0; }
  @container preview-section (min-width: 40rem) {
    .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  nav { position: sticky; top: 0; z-index: 2; margin-block-start: var(--space-3); }
    body:not(.preview-studio) nav { border-block: 1px solid var(--ink-muted); background: color-mix(in oklab, var(--paper) 90%, transparent); backdrop-filter: blur(6px); }
  nav ul { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin: 0; padding: var(--space-2) var(--space-3); list-style: none; }
  nav a { font-size: var(--text-sm); font-weight: 650; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  :target { scroll-margin-top: 5rem; }
  .skip { display: inline-block; padding: var(--space-2) var(--space-3); }
  .file-group + .file-group { margin-block-start: var(--space-4); }
  .file-group > h3 { margin-block-end: var(--space-1); }
  .change + .change { margin-block-start: var(--space-4); }
  footer { border-block-start: 1px solid var(--ink-muted); padding-block-start: var(--space-4); color: var(--ink-soft); font-size: var(--text-sm); }
  footer .cta { font-size: var(--text-md); font-weight: 700; }
  footer p + p { margin-block-start: var(--space-2); }
}
@layer preferences {
  @media (forced-colors: active) {
    :root { --ink: CanvasText; --paper: Canvas; --paper-soft: Canvas; --soft: Canvas; --line: CanvasText; --accent: LinkText; --warn-soft: Canvas; }
    .card, .notice, .tier, .badge, .color-choice, .pair-visual, .family-sample, .side-effect { border: 1px solid CanvasText; box-shadow: none; }
    .badge--solid { background: CanvasText; color: Canvas; }
  }
  @media (prefers-reduced-motion: no-preference) {
    a, .card { transition: box-shadow 120ms ease; }
  }
  @media print {
    :root { --shadow-1: none; --shadow-2: none; }
    body { background: #fff; }
    nav, .skip { display: none; }
    .card, .notice, .family-sample { break-inside: avoid; }
    main > section { margin-block: 1.5rem; }
  }
}
`;

// Presentation-only CSS for the diagnostic session preview: the local panel, its
// result table and the isolated measurement frames. Kept separate from PREVIEW_CSS so
// the legacy static preview output stays byte-identical.
const LOCAL_CSS = `
@layer pages {
  .preview-studio { background: var(--paper-soft); }
  .preview-studio h1 { font-size: var(--text-base); letter-spacing: -.025em; }
  .preview-studio .studio-header { border-color: var(--line); }
  .studio-session { color: var(--ink-soft); background: var(--soft); border-radius: var(--radius-sm); padding: .2rem .5rem; font-size: var(--text-xs); }
  .studio-export { min-height: 44px; padding: .5rem 1rem; border: 1px solid var(--ink); border-radius: var(--radius-sm); font: inherit; font-size: var(--text-sm); font-weight: 650; color: var(--paper); background: var(--ink); cursor: pointer; }
  .studio-export:hover { background: var(--ink-soft); }
  .studio-export:disabled { cursor: not-allowed; opacity: .65; }
  .studio-report-link { font-size: var(--text-sm); }
  .preview-studio nav { border: 0; background: none; backdrop-filter: none; }
  .preview-studio .skip:not(:focus) { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .preview-studio .preview-technical { border-block-start: 1px solid var(--line); padding-block: var(--space-4); }
  .preview-studio summary { cursor: pointer; padding-block: var(--space-2); }
  .preview-technical > summary { font-weight: 650; }
  .preview-technical section { container: preview-section / inline-size; margin-block: var(--space-5); }
  .preview-studio footer { border-color: var(--line); }
}
@layer layout {
  .preview-studio .shell { max-width: 96rem; padding-block-start: 0; container: studio-shell / inline-size; }
  .preview-studio .studio-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); padding-block: var(--space-2); }
  .studio-brand { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); min-width: 0; }
  .studio-session { max-width: 100%; }
  @container studio-shell (max-width: 30rem) {
    .studio-brand { flex: 1 1 9rem; }
    .studio-session { flex-basis: 100%; }
  }
  .preview-studio main > section { margin-block: var(--space-4); }
  .preview-studio nav { position: static; }
  .preview-studio nav ul { padding-inline: 0; }
}
@layer components {
  .local-frames { display: grid; gap: var(--space-3); margin-block-start: var(--space-3); }
  .local-frames iframe { width: 100%; min-height: 4rem; border: 1px solid var(--ink-muted); border-radius: var(--radius); background: var(--paper); }
  .local-rows { margin-block-start: var(--space-4); }
  .local-rows h3 { margin-block-end: var(--space-2); }
  .local-state { font-weight: 650; }
  .local-scope, .local-empty, .local-errors, .local-summary, .local-synthesis { font-size: var(--text-sm); color: var(--ink-soft); }
  .local-combos, .local-problem-list { padding-inline-start: 1.2rem; font-size: var(--text-sm); color: var(--ink-soft); }
  .local-combos li, .local-problem-list li { margin-block: var(--space-1); }
  .local-errors, .local-unsupported, .automation-engines, .automation-errors, .automation-unsupported { padding-inline-start: 1.2rem; font-size: var(--text-sm); }
  .local-problems { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); list-style: none; padding: 0; margin-block-start: var(--space-3); }
  .local-problem { border: 1px solid var(--ink-muted); border-radius: var(--radius); padding: var(--space-3); background: var(--paper); }
  .local-problem .pair-visual { min-height: 3.5rem; padding: var(--space-3); margin-block: var(--space-2); }
  .local-details { margin-block-start: var(--space-4); }
  .local-details > summary { cursor: pointer; font-weight: 650; font-size: var(--text-sm); }
  .local-catalog, .local-explorations { margin-block-start: var(--space-3); }
  .local-catalog > summary, .local-explorations > summary { cursor: pointer; font-weight: 650; font-size: var(--text-sm); }
  .local-catalog-list, .local-exploration-list { list-style: none; padding: 0; font-size: var(--text-sm); }
  .local-catalog-item { display: flex; align-items: center; gap: var(--space-2); margin-block: var(--space-1); }
  .local-catalog .pair-chip { flex: 0 0 auto; }
  .table-scroll { overflow-x: auto; max-width: 100%; border: 1px solid var(--ink-muted); border-radius: var(--radius); }
  .table-scroll table { border-collapse: collapse; width: 100%; min-width: 40rem; font-size: var(--text-sm); }
  .table-scroll caption { text-align: start; font-weight: 650; padding: var(--space-2) var(--space-3); }
  .table-scroll th, .table-scroll td { border-block-end: 1px solid var(--line); padding: var(--space-2) var(--space-3); text-align: start; vertical-align: top; }
  .table-scroll thead th { background: var(--soft); border-block-end: 1px solid var(--ink-muted); }
  .local-table-scroll { overflow-x: auto; max-width: 100%; margin-block-start: var(--space-3); border: 1px solid var(--ink-muted); border-radius: var(--radius); }
  .local-table { border-collapse: collapse; width: 100%; min-width: 40rem; font-size: var(--text-sm); }
  .local-table caption { text-align: start; font-weight: 650; padding: var(--space-2) var(--space-3); }
  .local-table th, .local-table td { border-block-end: 1px solid var(--line); padding: var(--space-2) var(--space-3); text-align: start; vertical-align: top; }
  .local-table thead th { background: var(--soft); border-block-end: 1px solid var(--ink-muted); }
}
@layer preferences {
  @media (forced-colors: active) {
    .local-frames iframe, .local-table-scroll, .local-table th, .local-table td, .table-scroll, .table-scroll th, .table-scroll td, .local-problem { border: 1px solid CanvasText; }
  }
}
`;

const badge = (shape, label) => `<span class="badge badge--${shape}">${escape(label)}</span>`;
const count = (value) => `<strong class="count">${value}</strong>`;

// One reading per measured pair: shortfalls get a shaped status badge plus their compact
// ratio, validated passing pairs get a discreet pass marker. Text always carries the state.
function measureState(item) {
  const ratio = `<span class="contrast-value">${compactRatio(item.ratio, [item.minimum, item.target])}</span>`;
  if (item.status !== "pass") return `${badge(item.status === "below-minimum" ? "solid" : "outline", status(item))} ${ratio}`;
  return `<span class="tier">${item.kind === "non-text" ? "3:1" : "AA"}</span> ${ratio}`;
}

function sampleFigure(item, compact = false) {
  const foreground = colorCss(item.foreground), background = colorCss(item.background);
  if (!foreground || !background) return "";
  // The session archive repeats the same decorative specimen 90+ times. Its two caption lines are
  // constant copy, so the compact form moves them into the scoped CSS above and keeps one real text
  // node for the body. The legacy preview still renders the full inline specimen.
  if (compact && item.kind !== "non-text") {
    return `<div class="pair-visual pair-visual--sample" aria-hidden="true" style="--sample-fg:${foreground};--sample-bg:${background}">Corpo del testo di esempio</div>`;
  }
  return `<div class="pair-visual" aria-hidden="true" style="--sample-fg:${foreground};--sample-bg:${background}">${sampleVisual(item)}</div>`;
}

function bucketFor(file) {
  if (/palette\.css$/i.test(file)) return "palette";
  if (/colors-tuning\.css$/i.test(file)) return "tuning";
  return "config";
}

// Two short lines keep build-time definitions and runtime overrides near the destination.
// Invalid keys, values or flags add nothing: the preview never fills gaps with a guess.
function structuralLines(proposal) {
  const key = typeof proposal.configKey === "string" && proposal.configKey.trim() ? proposal.configKey : null;
  if (!key) return "";
  if (proposal.kind === "tuning") {
    const value = typeof proposal.configValue === "number" && Number.isFinite(proposal.configValue) ? ` = ${it(proposal.configValue, 4)}` : "";
    const line = proposal.restoresConfig === true
      ? "colors-tuning.css lo sovrascrive solo a runtime; il valore proposto è già in <code>smart-colors.config.mjs</code>: allineare o rimuovere l’override lo ripristina."
      : proposal.restoresConfig === false
        ? `colors-tuning.css lo sovrascrive solo a runtime; l’alternativa strutturale è cambiare <code>${escape(key)}</code> in <code>smart-colors.config.mjs</code>.`
        : "colors-tuning.css lo sovrascrive solo a runtime: i token di testo derivati restano quelli calcolati per il valore configurato.";
    return `<p class="margin-note">Build: <code>${escape(key)}${value}</code> in <code>smart-colors.config.mjs</code>.</p>
<p class="margin-note">${line}</p>`;
  }
  if (proposal.kind === "config") {
    if (typeof proposal.promotedValue !== "number" || !Number.isFinite(proposal.promotedValue)) return "";
    const token = typeof proposal.configToken === "string" && proposal.configToken.trim() ? ` <code>${escape(proposal.configToken)}</code>` : "";
    return `<p class="margin-note">Struttura: <code>${escape(key)} = ${it(proposal.promotedValue, 4)}</code> in <code>smart-colors.config.mjs</code>.</p>
<p class="margin-note">La build rigenera i token di testo derivati; la dichiarazione${token} in <code>colors-tuning.css</code> diventa ridondante: rimuovila o allineala.</p>`;
  }
  return "";
}

// Informational only: rejected candidates get no positive verdict and no new suggestion.
function rejectedSourcesHtml(sources) {
  if (!sources.length) return "";
  return `<div class="side-effect"><p><strong>Nessuna alternativa verificata in palette.css</strong></p>
<p>Per questi problemi non esiste un’alternativa verificata in palette.css. Candidati scartati:</p>
<ul>${sources.map((source) => `<li><code>${escape(source.id)}</code> — ${escape(source.reason)}</li>`).join("")}</ul></div>`;
}

function actionCard(view) {
  const { proposal } = view;
  const destination = record(proposal.destination) ? proposal.destination : {};
  const sentence = proposal.kind === "tuning" || proposal.kind === "foreground" ? proposalSentence(proposal) : proposal.impact;
  return `<article class="card" id="${view.id}">
<h4>${escape(proposal.title)}</h4>
<p>${escape(sentence)}</p>
${list(proposal.changes).map((value) => {
    const change = record(value) ? value : {};
    const label = typeof change.label === "string" && change.label.trim() ? change.label.trim() : "";
    const summary = deltaSummary(change.before, change.after);
    return `<div class="change">${label ? `<p class="change-label">${escape(label)}</p>` : ""}<div class="grid-2">${colorChoice(change.before, "Attuale")}${colorChoice(change.after, "Suggerito", true)}</div>
<p class="margin-note">${summary ? `${summary}. Variazioni OKLCH, non misure di contrasto.` : "Differenze non disponibili: colore non valido."}</p></div>`;
  }).join("")}
${sideEffectsHtml(proposal.sideEffects)}
<dl class="destination"><div><dt>File</dt><dd><code>${escape(destination.file)}</code></dd></div><div><dt>Percorso nella configurazione</dt><dd><code>${escape(destination.path)}</code></dd></div></dl>
${structuralLines(proposal)}
<pre tabindex="0" aria-label="Snippet della proposta"><code>${escape(destination.snippet)}</code></pre>
<p class="margin-note">Applicazione manuale: questa anteprima non modifica file. Dopo la modifica, rigenera il report.</p>
</article>`;
}

function actionHtml(complete, verified, issues) {
  if (!complete.length) {
    const reason = !verified
      ? "Nessun colore suggerito: lo snapshot non è verificato, quindi nessuna proposta può essere considerata verificata. Gli errori sono elencati sopra e i dettagli restano nel report completo."
      : issues.length
        ? "Nessuna correzione verificata: i problemi misurati non hanno una proposta che li copra completamente. Il report non suggerisce un colore senza una verifica completa."
        : "Nessuna correzione necessaria: le coppie misurate rispettano minimo e target dichiarati nello snapshot.";
    return `<p>${reason}</p>`;
  }
  const groups = ["palette", "tuning", "config"].map((bucket) => {
    const items = complete.filter((view) => bucketFor(record(view.proposal.destination) ? view.proposal.destination.file : "") === bucket);
    if (!items.length) return "";
    const file = items[0].proposal.destination.file;
    return `<div class="file-group"><h3>${FILE_TITLES[bucket]}</h3>
<p class="margin-note"><code>${escape(file)}</code> — ${escape(fileRole(file))}</p>
<div class="card-grid">${items.map(actionCard).join("")}</div></div>`;
  }).join("");
  return `<p>Correzioni verificate nello snapshot: applica la modifica nel file indicato.${complete.length > 1 ? " Le opzioni sono verificate separatamente: non sommarle senza una nuova verifica." : ""}</p>
${groups}`;
}

function problemTitle(item, language) {
  if (language && typeof language.pairTitle === "function") {
    const label = language.pairTitle(item.foregroundToken, item.backgroundToken, item.kind);
    if (label !== null && label !== undefined && String(label) !== "") return String(label);
  }
  return item.backgroundToken === "--color-surface" && item.foregroundToken === "--color-text-muted" ? "Testo secondario sulla superficie"
    : item.backgroundToken === "--color-surface" && item.foregroundToken === "--color-tertiary-text" ? "Testo terziario sulla superficie" : item.label;
}

function problemCard(group, proposals, language) {
  const before = group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst);
  const { item } = before;
  const view = proposals.find((proposal) => proposal.complete && group.every((entry) => proposal.covered.has(entry.key)));
  const title = problemTitle(item, language);
  return `<article class="card problem-card">
<p class="eyebrow">Tema ${item.scheme === "light" ? "chiaro" : "scuro"} · ${item.kind === "text" ? "Testo" : "Non testuale (bordo)"}</p>
<h3>${escape(title)}</h3>
<p><code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code></p>
${sampleFigure(item)}
<p>${badge(item.status === "below-minimum" ? "solid" : "outline", status(item))} <span class="contrast-value">${compactRatio(item.ratio, [item.minimum, item.target])}</span></p>
<p class="margin-note">Minimo ${compactRatio(item.minimum)} · target ${compactRatio(item.target)} · ${group.length} ${group.length === 1 ? "misura" : "misure"} · scenario con il valore più basso: ${escape(before.scenario.browser)} / ${escape(before.scenario.scheme)} / ${escape(before.scenario.preference)}</p>
${baselineNote(item, group)}
<p>${view ? `Coperta da <a href="#${view.id}">${escape(view.proposal.title)}</a>.` : "Nessuna correzione verificata copre questa coppia."}</p>
</article>`;
}

function problemsHtml(groups, proposals, verified, language) {
  if (!groups.length) return `<p>${verified ? "Nessun problema nelle coppie misurate." : "Riepilogo non disponibile: verifica incompleta."}</p>`;
  const ordered = [...groups].sort((a, b) => (a[0].item.status === "below-minimum" ? 0 : 1) - (b[0].item.status === "below-minimum" ? 0 : 1));
  return `<p>Una card per gruppo di misure, prima i problemi sotto il minimo e poi quelli sotto il target. I rapporti sono sintetici; minimo e target restano distinti.</p>
<div class="card-grid">${ordered.map((group) => problemCard(group, proposals, language)).join("")}</div>`;
}

function familyCard(name, find) {
  const themes = ["light", "dark"].map((scheme) => {
    const samples = [
      ["Testo su callout", find(scheme, "text", `--color-${name}-text`, `--color-${name}-surface`)],
      ["Bordo forte sul callout", find(scheme, "non-text", `--color-${name}-border-strong`, `--color-${name}-surface`)],
      ["Bottone (solid)", find(scheme, "text", `--color-${name}-solid-text`, `--color-${name}-solid`)],
      ["Bottone (hover)", find(scheme, "text", `--color-${name}-solid-text`, `--color-${name}-solid-hover`)],
      ["Chip o badge", find(scheme, "text", `--color-${name}-ink`, `--color-${name}`)],
    ].filter(([, item]) => item && colorCss(item.foreground) && colorCss(item.background));
    if (!samples.length) return "";
    return `<div class="family-theme"><p class="eyebrow">Tema ${scheme === "light" ? "chiaro" : "scuro"}</p>
<ul class="sample-list">${samples.map(([label, item]) => `<li class="family-sample">
${sampleFigure(item)}
<p class="sample-title">${escape(label)}</p>
<p class="sample-note">${measureState(item)} · <code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code></p></li>`).join("")}</ul></div>`;
  }).join("");
  if (!themes) return "";
  return `<article class="card family-strip"><h3>Famiglia <code>--color-${escape(name)}</code></h3>
<div class="grid-2">${themes}</div></article>`;
}

function paletteHtml(families, verified) {
  if (!families.names.length) return `<p>Nessuna famiglia misurata nello snapshot: nessun campione da mostrare.</p>`;
  const note = verified
    ? "Solo coppie realmente misurate negli scenari; per ogni abbinamento è mostrato il caso peggiore fra browser e preferenze."
    : "Verifica incompleta: il quadro è parziale e nessun campione vale come conferma.";
  return `<p>${note} Il badge <span class="tier">AA</span> indica una coppia che raggiunge minimo e target dichiarati; sotto minimo o target compare il rapporto con l'esito.</p>
<div class="card-grid card-grid--wide">${families.names.map((name) => familyCard(name, families.find)).join("")}</div>`;
}

function variantsHtml(shifts) {
  if (shifts === null) return "<p>Varianti non confrontabili: sorgenti di marca o misure mancanti nello snapshot.</p>";
  if (!shifts.length) return `<p>Nessuna variante <code>*-text</code> o <code>*-border-strong</code> si allontana oltre la soglia (|ΔL| o |ΔC| ≥ ${it(VARIANT_SHIFT_THRESHOLD)}).</p>`;
  const shown = shifts.slice(0, 5);
  return `<p>Ordinate per scostamento di lightness dalla sorgente: le prime ${shown.length} di ${shifts.length}. Non sono errori di contrasto, ma indicazioni da valutare su palette.css.</p>
<ul class="variant-list">${shown.map((shift) => {
    const source = colorCss(shift.source), variant = colorCss(shift.variantColor);
    if (!source || !variant) return "";
    return `<li><span class="variant-swatch" aria-hidden="true" style="--sample-color:${source}"></span>da <code>${escape(shift.sourceToken)}</code> a <span class="variant-swatch" aria-hidden="true" style="--sample-color:${variant}"></span><code>${escape(shift.token)}</code> (tema ${shift.scheme === "light" ? "chiaro" : "scuro"}): ΔL ${it(shift.deltaL, 3)} · ΔC ${it(shift.deltaC, 3)}</li>`;
  }).join("")}</ul>
${shifts.length > shown.length ? `<p class="margin-note">Altre ${shifts.length - shown.length} varianti oltre soglia nel <a href="smart-colors.html#usi">report completo</a>.</p>` : ""}`;
}

function pairingsHtml(overlaps) {
  if (!overlaps.complete) return "<p>Sovrapposizioni libere non verificate: nessun conteggio e nessuna coppia consigliata.</p>";
  const cards = ["light", "dark"].map((scheme) => {
    const groups = overlaps.groups.filter((group) => group[0].item.scheme === scheme);
    if (!groups.length) return `<p>Tema ${scheme === "light" ? "chiaro" : "scuro"}: non misurato.</p>`;
    const ranked = groups.map((group) => group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst))
      .sort((a, b) => b.item.ratio - a.item.ratio);
    const textSafe = ranked.filter(({ item }) => item.ratio >= 4.5);
    const largeOnly = ranked.filter(({ item }) => item.ratio >= 3 && item.ratio < 4.5);
    const avoid = ranked.filter(({ item }) => item.ratio < 3);
    return `<article class="card"><h3>Tema ${scheme === "light" ? "chiaro" : "scuro"}</h3>
<p>${count(textSafe.length)} usabili per testo normale · ${count(largeOnly.length)} solo per titoli grandi, bordi e icone · ${count(avoid.length)} da evitare.</p>
<h4>Le 3 coppie migliori per testo normale</h4>
${textSafe.length ? overlapList(textSafe.slice(0, 3), [4.5]) : "<p>Nessuna coppia raggiunge 4,5:1 in questo tema.</p>"}</article>`;
  }).join("");
  return `<p>Conteggi sui colori base opachi realmente misurati: trasparenze, foto e gradienti restano fuori. Le soglie restano distinte: 4,5:1 per il testo normale, 3:1 per titoli grandi, bordi e icone.</p>
<div class="grid-2">${cards}</div>`;
}

// ---------------------------------------------------------------------------
// Diagnostic session preview (SC-03 payload + SC-04 runtime).
// The static document below is complete without JavaScript; the embedded runtime and
// the local presenter only add in-memory measurements. The presenter is serialized
// from this module and appended to the runtime, so the CSP hash covers exactly the
// emitted bytes. No user data reaches `innerHTML`; every dynamic node is created with
// `createElement`/`textContent`.
// ---------------------------------------------------------------------------

/** Presentation-only companion of the browser runtime: renders the local rows, status and scope. */
export function createLocalPresenter(deps) {
  var doc = deps && deps.document;
  var controller = deps && deps.controller;
  var language = deps && deps.language ? deps.language : null;
  var tools = deps && deps.tools ? deps.tools : null;
  var design = null; // read from the inert payload on first render
  var HOST_ID = "smart-colors-diagnostic";
  var HOOK = "data-smart-colors-diagnostic";
  if (!doc || typeof doc.createElement !== "function" || typeof doc.getElementById !== "function") return null;
  if (!controller || typeof controller.subscribe !== "function" || typeof controller.status !== "function") return null;
  var host = doc.getElementById(HOST_ID);
  if (!host) return null;
  // The retry control is authored hidden so a JavaScript-free page shows no dead button;
  // the presenter reveals it only once the runtime controller is actually available.
  var retryControl = host.querySelector("[" + HOOK + '="retry"]');
  if (retryControl) retryControl.hidden = false;

  function element(tag, className, value) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function isRecord(value) {
    return value !== null && typeof value === "object";
  }
  function finite(value) {
    return typeof value === "number" && isFinite(value);
  }
  // Designer vocabulary comes from the single serialized factory; a missing factory degrades to the
  // raw technical value instead of inventing a label here (no vocabulary duplication).
  function word(method, raw) {
    if (language && typeof language[method] === "function") {
      var label = language[method](raw);
      if (label !== null && label !== undefined && String(label) !== "") return String(label);
    }
    return raw === null || raw === undefined ? "non indicato" : String(raw);
  }
  function pairTitle(foreground, background, property) {
    if (language && typeof language.pairTitle === "function") {
      var label = language.pairTitle(foreground, background, property);
      if (label !== null && label !== undefined && String(label) !== "") return String(label);
    }
    return String(foreground) + " su " + String(background);
  }
  function safeColor(value) {
    // A resolved color may only reach a style property; never markup. Anything else is dropped.
    return typeof value === "string" && /^(oklch|rgb|rgba|hsl|hsla|color|lab|lch|oklab)\(/i.test(value) ? value : null;
  }
  function formatRatio(value, thresholds) {
    if (!finite(value)) return "non misurata";
    var rounded = Math.round(value * 100) / 100;
    var crossed = [];
    for (var index = 0; thresholds && index < thresholds.length; index += 1) {
      var threshold = thresholds[index];
      if (finite(threshold) && value < threshold && rounded >= threshold) crossed.push(threshold);
    }
    // Threshold-aware: a below-threshold value must never round UP onto its own minimum/target.
    if (crossed.length) return "< " + String(Math.min.apply(null, crossed)).replace(".", ",") + ":1";
    return (rounded === value ? "" : "circa ") + rounded.toFixed(2).replace(".", ",") + ":1";
  }
  function formatStatus(value) {
    if (value === "pass") return "Raggiunge minimo e target";
    if (value === "below-target") return "Sotto il target";
    if (value === "below-minimum") return "Sotto il minimo";
    if (value === "unmeasured") return "Non misurata";
    return value == null ? "Non misurata" : String(value);
  }
  function parsePair(pairId) {
    var parts = typeof pairId === "string" ? pairId.split("|") : [];
    if (parts.length !== 4) return null;
    return { theme: parts[0], property: parts[1], foreground: parts[2], background: parts[3] };
  }
  function parseScenario(scenarioId) {
    var parts = typeof scenarioId === "string" ? scenarioId.split("-") : [];
    return { variant: parts[0] || null, theme: parts[1] || null };
  }
  var panel = null;
  function ensurePanel() {
    if (panel && panel.parentNode) return panel;
    panel = host.querySelector(".local-rows");
    if (!panel) {
      panel = element("div", "local-rows");
      var anchor = host.querySelector("[" + HOOK + '="frames"]');
      if (anchor && anchor.parentNode === host) host.insertBefore(panel, anchor);
      else host.appendChild(panel);
    }
    return panel;
  }
  // At most this many problem cards are rendered by default; the rest stay in a collapsed list.
  var LOCAL_PROBLEM_DEFAULT = 8;
  function scenarioKey(id) {
    var parts = typeof id === "string" ? id.split("-") : [];
    return { variant: parts[0] || null, theme: parts[1] || null };
  }
  // Combinations are derived from the PLANNED (expected) and EXECUTED scenarios plus the real
  // measurements per scenario, never from the plan alone. A combination is only reported as measured
  // when it actually has measurements, and unmeasured/missing states are kept explicit.
  function isMeasured(measurement) {
    // Only a finite ratio without an explicit error counts as measured; "unmeasured" and null ratios
    // stay unmeasured so a combination or a card can never claim a measurement it does not have.
    return finite(measurement && measurement.ratio) && measurement.status !== "unmeasured" && !measurement.error;
  }
  function reliablePairIds(list) {
    if (!Array.isArray(list) || !list.length) return null;
    var unique = [];
    var seen = {};
    for (var index = 0; index < list.length; index += 1) {
      var id = list[index];
      if (typeof id !== "string" || !id || seen[id]) return null; // empty or duplicate ids are not reliable
      seen[id] = true;
      unique.push(id);
    }
    return unique;
  }
  // Combinations are derived from the PLANNED (expected) and EXECUTED scenarios plus the real
  // measurements per scenario, never from the plan alone. "Measured" counts only finite ratios, the
  // rest is unmeasured, and "missing" is only reported when the declared expected pairs are reliable
  // (non-empty, unique, and not one identical list for every scenario).
  function combinationList(report) {
    var expected = report.expected && Array.isArray(report.expected.scenarios) ? report.expected.scenarios : [];
    var executed = report.executed && Array.isArray(report.executed.scenarios) ? report.executed.scenarios : [];
    var measures = Array.isArray(report.measurements) ? report.measurements : [];
    var declared = report.expected && report.expected.pairs && typeof report.expected.pairs === "object" ? report.expected.pairs : {};
    var expectedPairs = {};
    var referenceSignature = null;
    var degenerate = expected.length > 1;
    for (var e = 0; e < expected.length; e += 1) {
      var unique = reliablePairIds(declared[expected[e]]);
      expectedPairs[expected[e]] = unique;
      if (!unique) { degenerate = false; continue; }
      var signature = unique.join("|");
      if (referenceSignature === null) referenceSignature = signature;
      else if (referenceSignature !== signature) degenerate = false;
    }
    if (degenerate) for (var key in expectedPairs) expectedPairs[key] = null;
    var order = [];
    var seen = {};
    function add(id) {
      if (typeof id !== "string" || seen[id]) return;
      seen[id] = true;
      order.push(id);
    }
    for (var i = 0; i < expected.length; i += 1) add(expected[i]);
    for (var x = 0; x < executed.length; x += 1) add(executed[x]);
    for (var m = 0; m < measures.length; m += 1) add(measures[m] && measures[m].scenarioId);
    return order.map(function (id) {
      var parsed = scenarioKey(id);
      var rows = measures.filter(function (measure) { return measure && measure.scenarioId === id; });
      var counts = { measured: 0, belowMinimum: 0, belowTarget: 0, unmeasured: 0, missing: 0 };
      var presentIds = {};
      for (var r = 0; r < rows.length; r += 1) {
        var row = rows[r];
        if (typeof row.pairId === "string") presentIds[row.pairId] = true;
        if (isMeasured(row)) {
          counts.measured += 1;
          if (row.status === "below-minimum") counts.belowMinimum += 1;
          else if (row.status === "below-target") counts.belowTarget += 1;
        } else {
          counts.unmeasured += 1;
        }
      }
      // A pair that has a row (even unmeasured) is not missing; missing means declared but absent.
      var declaredIds = expectedPairs[id];
      if (declaredIds) for (var d = 0; d < declaredIds.length; d += 1) if (!presentIds[declaredIds[d]]) counts.missing += 1;
      return { id: id, variant: parsed.variant, theme: parsed.theme, expected: expected.indexOf(id) !== -1, executed: executed.indexOf(id) !== -1, counts: counts };
    });
  }
  function combinationText(combo) {
    var title = word("variantLabel", combo.variant) + " · " + word("themeLabel", combo.theme);
    if (!combo.executed) return title + ": non eseguita" + (combo.expected ? " (attesa)" : "");
    var counts = combo.counts;
    var parts = [counts.measured === 0 ? "nessuna misurata" : counts.measured + " misurate"];
    if (counts.belowMinimum) parts.push(counts.belowMinimum + " sotto il minimo");
    if (counts.belowTarget) parts.push(counts.belowTarget + " sotto il target");
    if (counts.unmeasured) parts.push(counts.unmeasured + " non misurate");
    if (counts.missing) parts.push(counts.missing + " mancanti");
    return title + ": " + parts.join(" · ");
  }
  // Read-only next step: the wording follows the variant and names no file of a specific setup, so it
  // stays valid for a custom palette or tuning path. No cause is attributed.
  function nextStepText(scenario) {
    if (scenario.variant === "tuned") return "Coppia " + word("variantLabel", scenario.variant) + ": confronta prima il caso senza tuning, poi rivedi l'override del tuning. Questa anteprima non modifica file.";
    if (scenario.variant === "baseline") return "Coppia " + word("variantLabel", scenario.variant) + ": rivedi la palette sorgente come origine dei token. Questa anteprima non modifica file.";
    return "Rivedi la palette sorgente o l'override del tuning secondo la variante. Questa anteprima non modifica file.";
  }
  function problemCard(measurement) {
    var pair = parsePair(measurement.pairId);
    var scenario = scenarioKey(measurement.scenarioId);
    var nonText = pair ? pair.property !== "color" : true;
    var measured = isMeasured(measurement);
    var card = element("article", "local-problem");
    card.appendChild(element("p", "eyebrow", (measured ? "Misurato in questo browser · " : "Non misurato in questo browser · ")
      + word("variantLabel", scenario.variant) + " · " + word("themeLabel", scenario.theme)));
    card.appendChild(element("h4", null, pair ? pairTitle(pair.foreground, pair.background, pair.property) : "Coppia non indicata"));
    // A sample is only rendered for a finite measurement with a validated color: an unmeasured pair
    // never gets a visual that could be read as reliable.
    var foreground = measured ? safeColor(measurement.foreground) : null;
    var background = measured ? safeColor(measurement.background) : null;
    if (foreground && background) {
      var visual = element("div", "pair-visual");
      visual.setAttribute("aria-hidden", "true");
      visual.style.setProperty("--sample-fg", foreground);
      visual.style.setProperty("--sample-bg", background);
      // A border/outline pair is shown as an indicator, never as body text.
      if (nonText) {
        visual.appendChild(element("span", "pair-border", null));
        visual.appendChild(element("span", "pair-border pair-border--2", null));
        visual.appendChild(element("span", "pair-border pair-border--3", null));
      } else {
        visual.appendChild(element("span", "pair-title", "Titolo grande"));
        visual.appendChild(element("span", "pair-text", "Corpo del testo di esempio"));
      }
      card.appendChild(visual);
    }
    card.appendChild(element("p", null, formatStatus(measurement.status) + " · " + formatRatio(measurement.ratio, [measurement.minimum, measurement.target])));
    var threshold = measurement.minimum === measurement.target
      ? "Soglia " + formatRatio(measurement.minimum)
      : "Minimo applicato " + formatRatio(measurement.minimum) + " · target " + formatRatio(measurement.target);
    card.appendChild(element("p", "margin-note", threshold + "."));
    var details = element("details", "is-detail");
    details.appendChild(element("summary", null, "Token esatti"));
    details.appendChild(element("p", "margin-note", (pair ? pair.foreground + " su " + pair.background : "coppia non indicata") + (pair ? " · proprietà " + pair.property : "")));
    card.appendChild(details);
    var designDetails = drawnColorDetails(pair ? pair.foreground : null, pair ? pair.background : null, scenario.theme);
    if (designDetails) card.appendChild(designDetails);
    card.appendChild(element("p", "margin-note", nextStepText(scenario)));
    return card;
  }
  function rowsTable(measurements) {
    var scroll = element("div", "local-table-scroll");
    scroll.setAttribute("tabindex", "0");
    scroll.setAttribute("role", "region");
    scroll.setAttribute("aria-label", "Tabella delle misure locali di questo browser");
    var table = element("table", "local-table");
    table.appendChild(element("caption", null, "Misure locali eseguite in questo browser"));
    var head = element("thead");
    var headRow = element("tr");
    var columns = ["Scenario", "Coppia", "Rapporto", "Minimo", "Target", "Esito", "Nota"];
    for (var column = 0; column < columns.length; column += 1) {
      var th = element("th", null, columns[column]);
      th.setAttribute("scope", "col");
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    var body = element("tbody");
    for (var index = 0; index < measurements.length; index += 1) {
      var item = isRecord(measurements[index]) ? measurements[index] : {};
      var row = element("tr");
      var scenario = element("th", null, item.scenarioId == null ? "non indicato" : item.scenarioId);
      scenario.setAttribute("scope", "row");
      row.appendChild(scenario);
      var pair = parsePair(item.pairId);
      row.appendChild(element("td", null, pair ? pairTitle(pair.foreground, pair.background, pair.property) : (item.pairId == null ? "coppia non indicata" : String(item.pairId))));
      // Exact numbers stay in data attributes so a threshold-aware label never hides the real value.
      var ratioCell = element("td", null, formatRatio(item.ratio, [item.minimum, item.target]));
      if (finite(item.ratio)) ratioCell.setAttribute("data-ratio", String(item.ratio));
      if (finite(item.minimum)) ratioCell.setAttribute("data-minimum", String(item.minimum));
      if (finite(item.target)) ratioCell.setAttribute("data-target", String(item.target));
      row.appendChild(ratioCell);
      row.appendChild(element("td", null, formatRatio(item.minimum)));
      row.appendChild(element("td", null, formatRatio(item.target)));
      row.appendChild(element("td", null, formatStatus(item.status)));
      row.appendChild(element("td", null, item.error ? String(item.error) : "Nessun errore"));
      body.appendChild(row);
    }
    table.appendChild(body);
    scroll.appendChild(table);
    return scroll;
  }
  function errorsList(errors) {
    var node = element("ul", "local-errors");
    for (var index = 0; index < errors.length; index += 1) {
      var item = isRecord(errors[index]) ? errors[index] : {};
      var phase = typeof item.phase === "string" ? item.phase : "fase non indicata";
      var cause = typeof item.cause === "string" ? item.cause : "causa non indicata";
      var message = item.message == null ? "" : String(item.message);
      var scenario = item.scenarioId == null ? "" : "; scenario " + String(item.scenarioId);
      var pair = item.pairId == null ? "" : "; coppia " + String(item.pairId);
      node.appendChild(element("li", null, phase + " · " + cause + " — " + message + scenario + pair));
    }
    return node;
  }
  function unsupportedList(entries) {
    var node = element("ul", "local-unsupported");
    for (var index = 0; index < entries.length; index += 1) {
      var item = isRecord(entries[index]) ? entries[index] : {};
      var engine = typeof item.engine === "string" ? "; motore " + item.engine : "";
      node.appendChild(element("li", null, (item.id == null ? "scenario non indicato" : String(item.id)) + " — " + String(item.reason) + engine));
    }
    return node;
  }
  // ---- Design provenance + measured catalog (representation only; no new math). ----
  function payloadDesign() {
    // The design block is pure data in the inert payload; the runtime never widens the executable
    // config with it. Parsing only reads the DOM, never the network.
    try {
      var node = doc.getElementById("smart-colors-payload");
      if (!node) return null;
      var parsed = JSON.parse(node.textContent || "");
      return isRecord(parsed) && isRecord(parsed.design) ? parsed.design : null;
    } catch (error) { return null; }
  }
  function darkMixText(source) {
    var mix = isRecord(source.darkMix) ? source.darkMix : null;
    if (!mix && tools && typeof tools.darkBlendMix === "function" && finite(source.darkBlend)) mix = tools.darkBlendMix(source.darkBlend);
    if (!mix || !finite(mix.sourcePercent) || !finite(mix.whitePercent)) return null;
    return "dark-blend " + (source.darkBlend == null ? "adattivo" : String(source.darkBlend)) + " → source " + mix.sourcePercent + "% / white " + mix.whitePercent + "%";
  }
  function sourceName(token) {
    if (!design || !Array.isArray(design.sources)) return null;
    for (var i = 0; i < design.sources.length; i += 1) {
      var entry = design.sources[i];
      if (isRecord(entry) && entry.token === token) return entry.name || token;
    }
    return null;
  }
  function mixPercentLabel(fraction) {
    // Contract unit for controls.defaultMix is a FRACTION 0..1; convert once, deterministically
    // (0.1 -> 10, 0.7592 -> 75.92). No heuristic percent/fraction detection, no threshold change.
    if (!finite(fraction)) return null;
    return String(Math.round(fraction * 100 * 100) / 100).replace(".", ",") + "%";
  }
  function controlLines(entry) {
    var lines = [];
    var controls = isRecord(entry.controls) ? entry.controls : null;
    if (!controls) return lines;
    ["light", "dark"].forEach(function (theme) {
      var c = isRecord(controls[theme]) ? controls[theme] : null;
      if (!c) return;
      var override = typeof c.override === "string" ? c.override : null;
      var mix = typeof c.mix === "string" ? c.mix : null;
      if (override) lines.push("Controllo per personalizzare — " + word("themeLabel", theme) + ": " + override);
      if (mix) {
        var defaultMix = mixPercentLabel(c.defaultMix);
        lines.push("Controllo per personalizzare — " + word("themeLabel", theme) + " mix: " + mix + (defaultMix ? " (default " + defaultMix + ")" : ""));
      }
    });
    return lines;
  }
  function designRecipeLine(token, theme) {
    if (!design || !isRecord(design.tokens)) return null;
    var described = tools && typeof tools.describeToken === "function" ? tools.describeToken(design, token, theme) : null;
    var binding = described || (isRecord(design.tokens[token]) ? design.tokens[token] : null);
    if (!binding) return null;
    var parts = [token];
    if (typeof binding.usage === "string" && binding.usage) parts.push("uso: " + binding.usage);
    if (typeof binding.recipe === "string" && binding.recipe) {
      var recipe = isRecord(design.recipes) && isRecord(design.recipes[binding.recipe]) ? design.recipes[binding.recipe] : null;
      parts.push("Ricetta di partenza (generatore): " + binding.recipe + (recipe && typeof recipe.kind === "string" ? " (" + recipe.kind + ")" : ""));
    }
    if (Array.isArray(binding.sources) && binding.sources.length) {
      parts.push("sorgenti: " + binding.sources.map(function (id) { return sourceName(id) || id; }).join(", "));
    }
    if ((binding.recipe === "surface" || binding.recipe === "surface-strong") && tools && typeof tools.surfaceRatio === "function") {
      var light = tools.surfaceRatio(binding.recipe, "light") * 100;
      var dark = tools.surfaceRatio(binding.recipe, "dark") * 100;
      parts.push("ricetta di partenza — mix " + Math.round(light) + "% source / " + Math.round(100 - light) + "% base (chiaro), " + Math.round(dark) + "%/" + Math.round(100 - dark) + "% (scuro), sostituibile da un controllo — regola di progetto, non WCAG");
    }
    return parts.join(" · ");
  }
  function drawnColorDetails(foreground, background, theme) {
    if (!design || !isRecord(design.tokens)) return null;
    var rows = [];
    [foreground, background].forEach(function (token) {
      if (typeof token !== "string") return;
      var info = designRecipeLine(token, theme);
      if (info) rows.push(info);
      if (isRecord(design.tokens[token])) {
        var controls = controlLines(design.tokens[token]);
        for (var i = 0; i < controls.length; i += 1) rows.push(controls[i]);
      }
    });
    if (!rows.length) return null;
    var details = element("details", "is-detail");
    details.appendChild(element("summary", null, "Colore: ricetta di partenza e controllo"));
    var list = element("ul", "design-list");
    for (var r = 0; r < rows.length; r += 1) list.appendChild(element("li", null, rows[r]));
    details.appendChild(list);
    return details;
  }
  function canonicalUse(foreground, background, property) {
    if (foreground === "--color-text" && background === "--color-bg") return "Testo sulla pagina";
    if (foreground === "--color-text" && background === "--color-surface") return "Testo sulla card";
    if (foreground === "--color-focus-ring") return "Focus";
    var match = /^--color-(.+?)-(text|border-strong|solid-text)$/.exec(foreground);
    if (!match) return null;
    var name = match[1], kind = match[2];
    if (kind === "text" && background === "--color-" + name + "-surface") return "Card o box " + name;
    if (kind === "border-strong" && background === "--color-" + name + "-surface") return "Bordo card " + name;
    if (kind === "solid-text" && background === "--color-" + name + "-solid") return "Pulsante " + name;
    if (kind === "solid-text" && background === "--color-" + name + "-solid-hover") return "Pulsante " + name + " al passaggio";
    return null;
  }
  function measuredCatalog(report) {
    // Builds the ACTUAL visuals from finite, error-free measurements, per theme × baseline/tuned.
    var measures = Array.isArray(report.measurements) ? report.measurements : [];
    var groups = [];
    var index = {};
    for (var i = 0; i < measures.length; i += 1) {
      var m = measures[i];
      if (!isMeasured(m)) continue;
      var pair = parsePair(m.pairId), scene = scenarioKey(m.scenarioId);
      if (!pair || !scene.variant || !scene.theme) continue;
      var use = canonicalUse(pair.foreground, pair.background, pair.property);
      if (!use) continue;
      var key = use + "|" + scene.variant + "|" + scene.theme;
      if (index[key]) continue;
      index[key] = true;
      groups.push({ use: use, variant: scene.variant, theme: scene.theme, item: m, pair: pair });
    }
    return groups;
  }
  function catalogPanel(report) {
    // The measured catalog is the MAIN path: shown as a visible block, not a collapsed detail.
    var groups = measuredCatalog(report);
    if (!groups.length) return null;
    var cap = Math.min(groups.length, 24);
    var block = element("section", "local-catalog");
    block.appendChild(element("h4", null, "Misure effettive in questo browser (" + groups.length + ")"));
    block.appendChild(element("p", "margin-note", "Colori risolti e misurati qui per tema e variante, non stime del modello."));
    var list = element("ul", "local-catalog-list");
    for (var i = 0; i < cap; i += 1) {
      var g = groups[i];
      var item = element("li", "local-catalog-item");
      var visual = element("span", "pair-chip");
      visual.setAttribute("aria-hidden", "true");
      var fg = safeColor(g.item.foreground), bg = safeColor(g.item.background);
      if (fg) visual.style.setProperty("--sample-fg", fg);
      if (bg) visual.style.setProperty("--sample-bg", bg);
      visual.textContent = "Aa";
      item.appendChild(visual);
      item.appendChild(element("span", null, g.use + " · " + word("variantLabel", g.variant) + " · " + word("themeLabel", g.theme)
        + " · " + formatStatus(g.item.status) + " " + formatRatio(g.item.ratio, [g.item.minimum, g.item.target])));
      list.appendChild(item);
    }
    block.appendChild(list);
    if (groups.length > cap) block.appendChild(element("p", "margin-note", "Altre " + (groups.length - cap) + " misure: usa la tabella completa qui sotto."));
    return block;
  }
  function explorationCount(value) { return Array.isArray(value) ? value.length : (finite(value) ? value : null); }
  function explorationNames(value) { return (Array.isArray(value) ? value : []).filter(function (item) { return typeof item === "string" && item; }); }
  function explorationValid(item) {
    return isRecord(item) && typeof item.pairId === "string" && item.pairId
      && finite(item.minimum) && item.minimum >= 1 && item.minimum <= 21
      && finite(item.target) && item.target >= 1 && item.target <= 21
      && finite(item.ratio) && item.ratio >= 1 && item.ratio <= 21;
  }
  function explorationFamily(item) { return typeof item.family === "string" && item.family ? item.family : "famiglia non indicata"; }
  function explorationItemNode(item) {
    var pair = parsePair(item.pairId);
    var label = pair ? pair.foreground + " su " + pair.background : String(item.pairId);
    return element("li", null, label + " · " + formatStatus(item.status) + " " + formatRatio(item.ratio, [item.minimum, item.target])
      + " · minimo " + formatRatio(item.minimum) + " · target " + formatRatio(item.target));
  }
  function explorationsPanel(report) {
    // Mirrors the report's exploration coverage (fail-closed `complete`, family cap 24). The channel
    // stays separate: no recommendation, no "body usable" label, no autofix.
    var raw = (Array.isArray(report.explorations) ? report.explorations : []).filter(isRecord);
    var items = raw.filter(explorationValid);
    var declared = isRecord(report.explorationCoverage) ? report.explorationCoverage : null;
    if (!raw.length && !declared) return null;
    var coverage = declared ? {
      expected: explorationCount(declared.expected),
      measured: explorationCount(declared.measured),
      unmeasured: explorationCount(declared.unmeasured),
      unmeasuredNames: explorationNames(declared.unmeasured),
      omitted: explorationNames(declared.omittedFamilies),
      complete: declared.complete === true && (explorationCount(declared.unmeasured) || 0) === 0
        && (explorationCount(declared.expected) === null || explorationCount(declared.measured) === null || explorationCount(declared.measured) <= explorationCount(declared.expected)),
    } : null;
    var families = [];
    for (var f = 0; f < items.length; f += 1) { var family = explorationFamily(items[f]); if (families.indexOf(family) === -1) families.push(family); }
    var visible = families.slice(0, 24);
    var omittedFamilies = families.slice(24);
    var scoped = items.filter(function (item) { return visible.indexOf(explorationFamily(item)) !== -1; });
    var byKey = {}, groups = [];
    for (var i = 0; i < scoped.length; i += 1) {
      var key = scoped[i].pairId + "|" + scoped[i].minimum + "|" + scoped[i].target;
      if (!byKey[key]) { byKey[key] = scoped[i]; groups.push(scoped[i]); }
      else if (finite(scoped[i].ratio) && (!finite(byKey[key].ratio) || scoped[i].ratio < byKey[key].ratio)) byKey[key] = scoped[i];
    }
    groups.sort(function (a, b) { return (finite(b.ratio) ? b.ratio : -1) - (finite(a.ratio) ? a.ratio : -1); });
    var top = groups.slice(0, 6), rest = groups.slice(6);
    var block = element("section", "local-explorations");
    block.appendChild(element("h4", null, "Esplorazioni di sovrapposizione (canale separato)"));
    block.appendChild(element("p", "margin-note", "Coppie fuori dalle misure principali: simulazione scoped, non un problema accertato e senza correzioni automatiche."));
    var measured = coverage && coverage.measured !== null ? coverage.measured : items.length;
    var scope = coverage
      ? "Copertura esplorativa " + (coverage.complete ? "completa" : "parziale") + ": " + measured + (coverage.expected === null ? "" : " di " + coverage.expected) + " misurate"
        + (coverage.unmeasured === null ? "" : " · " + coverage.unmeasured + " non misurate") + (coverage.omitted.length ? " · " + coverage.omitted.length + " famiglie omesse" : "") + "."
      : "Copertura esplorativa non dichiarata: le misure presenti non vengono promosse a verifica.";
    block.appendChild(element("p", "local-scope", scope));
    var list = element("ul", "local-exploration-list");
    for (var t = 0; t < top.length; t += 1) list.appendChild(explorationItemNode(top[t]));
    block.appendChild(list);
    if (rest.length) {
      var details = element("details", "local-details");
      details.appendChild(element("summary", null, "Altre " + rest.length + " coppie esplorative"));
      var restList = element("ul", "local-exploration-list");
      for (var r = 0; r < rest.length; r += 1) restList.appendChild(explorationItemNode(rest[r]));
      details.appendChild(restList);
      block.appendChild(details);
    }
    if (coverage && coverage.unmeasuredNames.length) block.appendChild(element("p", "margin-note", "Non misurate: " + coverage.unmeasuredNames.join(", ")));
    if (omittedFamilies.length) block.appendChild(element("p", "margin-note", omittedFamilies.length + " famiglie oltre il limite di 24 restano fuori da questa sintesi."));
    return block;
  }
  function render(snapshot) {
    var panel = ensurePanel();
    clear(panel);
    var report = snapshot && isRecord(snapshot.report) ? snapshot.report : null;
    panel.appendChild(element("h3", null, "Misure locali di questo browser"));
    if (!report) {
      // The live state summary is the runtime status region; the panel adds no second live region.
      panel.appendChild(element("p", "local-empty", "Nessuna misura locale disponibile in questa pagina: lo snapshot statico e i campioni del modello restano la fonte."));
      return;
    }
    design = payloadDesign();
    if (snapshot && (snapshot.state === "pending" || snapshot.state === "running")) {
      // Intermediate state: no visualization and no positive may be shown while results are invalidated.
      panel.appendChild(element("p", "local-empty", "Verifica in corso: nessuna misura è ancora affidabile. I campioni del modello restano stime."));
      return;
    }
    var preference = isRecord(report.preference) ? report.preference : {};
    var unmeasuredPreference = Array.isArray(preference.unmeasured) ? preference.unmeasured : [];
    var activePreference = typeof preference.active === "string" ? preference.active : "non disponibile";
    // Short scope: this is the local browser run, separate from the model and the automation. The
    // other `prefers-color-scheme` value is a PREFERENCE, never a second theme, and no theme is
    // claimed as measured here — the per-combination list below carries the evidence.
    panel.appendChild(element("p", "local-scope", "Verifica locale di questo browser, separata dal modello e dall'automazione. Preferenza attiva: "
      + activePreference + "; l'altra preferenza di sistema (" + (unmeasuredPreference.length ? unmeasuredPreference.join(", ") : "nessuna")
      + ") non è misurata: è un'altra preferenza, non un tema."));
    var combinations = combinationList(report);
    if (combinations.length) {
      var comboList = element("ul", "local-combos");
      for (var combo = 0; combo < combinations.length; combo += 1) comboList.appendChild(element("li", null, combinationText(combinations[combo])));
      panel.appendChild(comboList);
    }
    var catalog = catalogPanel(report);
    if (catalog) panel.appendChild(catalog);
    var measurements = Array.isArray(report.measurements) ? report.measurements : [];
    if (!measurements.length) panel.appendChild(element("p", "local-empty", "Nessuna coppia misurata in questo browser: vedi gli errori qui sotto."));
    var problems = measurements.filter(function (measurement) { return measurement && measurement.status && measurement.status !== "pass"; });
    problems.sort(function (a, b) { return (a.status === "below-minimum" ? 0 : 1) - (b.status === "below-minimum" ? 0 : 1); });
    if (problems.length) {
      panel.appendChild(element("h3", null, "Problemi nelle coppie misurate (" + problems.length + ")"));
      var grid = element("div", "local-problems");
      for (var shown = 0; shown < problems.length && shown < LOCAL_PROBLEM_DEFAULT; shown += 1) grid.appendChild(problemCard(problems[shown]));
      panel.appendChild(grid);
      if (problems.length > LOCAL_PROBLEM_DEFAULT) {
        // The remaining problems are counted, never dropped: only their cards are collapsed.
        var rest = element("details", "local-details");
        rest.appendChild(element("summary", null, "Altri problemi (" + (problems.length - LOCAL_PROBLEM_DEFAULT) + ")"));
        var restList = element("ul", "local-problem-list");
        for (var extra = LOCAL_PROBLEM_DEFAULT; extra < problems.length; extra += 1) {
          var restPair = parsePair(problems[extra].pairId);
          var restScenario = scenarioKey(problems[extra].scenarioId);
          restList.appendChild(element("li", null, (restPair ? pairTitle(restPair.foreground, restPair.background, restPair.property) : "coppia non indicata")
            + " · " + word("variantLabel", restScenario.variant) + " · " + word("themeLabel", restScenario.theme)
            + " · " + formatStatus(problems[extra].status) + " " + formatRatio(problems[extra].ratio, [problems[extra].minimum, problems[extra].target])));
        }
        rest.appendChild(restList);
        panel.appendChild(rest);
      }
    } else if (measurements.length && isRecord(report.coverage) && report.coverage.complete === true && snapshot.state === "complete") {
      // A positive summary is only ever shown when the local run completed with full coverage.
      // pending/running/incomplete/unsupported never reach here: no false positive.
      panel.appendChild(element("p", "local-summary", "Nessun problema nelle coppie misurate. Lo stato di esecuzione non implica che ogni contrasto passi: vale solo per le coppie qui misurate."));
    }
    var unsupported = Array.isArray(report.unsupported) ? report.unsupported : [];
    if (unsupported.length) {
      panel.appendChild(element("h3", null, "Scenari non supportati"));
      panel.appendChild(unsupportedList(unsupported));
    }
    var explorations = explorationsPanel(report);
    if (explorations) panel.appendChild(explorations);
    var errors = Array.isArray(report.errors) ? report.errors : [];
    if (errors.length) {
      // Blocking failures stay visible above the raw data, never tucked under a collapse.
      panel.appendChild(element("h3", null, "Errori della verifica locale"));
      panel.appendChild(errorsList(errors));
    }
    if (measurements.length) {
      var details = element("details", "local-details");
      details.appendChild(element("summary", null, "Tutte le misure locali (" + measurements.length + ")"));
      details.appendChild(rowsTable(measurements));
      panel.appendChild(details);
    }
  }
  function listener(snapshot) {
    try { render(snapshot); } catch (error) { /* presentation must never break the run */ }
  }
  try { render(controller.status()); } catch (error) { /* the initial render is best-effort */ }
  controller.subscribe(listener);
  return { render: render };
}

// Same serialization normalization already used by `createContrastWorkbenchViewSource`: drop only
// the leading line indentation, keeping every comment, newline, string and executable token. None of
// the serialized factories contains a multiline template literal or a line-continuation escape, so
// leading spaces are never payload data. This is not a minifier: no token is removed or rewritten.
function serializedFactory(factory) {
  return factory.toString().replace(/^[\t ]+/gm, "");
}

// The designer factory and the generator's design tools are serialized verbatim so the browser
// reuses the exact same algorithms and labels as the build. The imports are mandatory: a missing
// module fails at import time, never silently.
function presenterInstallLines() {
  return [
    "  var createDesignerLanguage = " + serializedFactory(createDesignerLanguage) + ";",
    "  var language = createDesignerLanguage();",
    "  var createDesignTools = " + serializedFactory(createDesignTools) + ";",
    "  var tools = createDesignTools();",
    "  var createLocalPresenter = " + serializedFactory(createLocalPresenter) + ";",
    "  createLocalPresenter({ controller: globalThis." + DIAGNOSTIC_RUNTIME_GLOBAL + ", document: document, language: language, tools: tools });",
  ];
}

/** Classic-script fragment that installs the local presenter on the runtime controller. */
export function localPresenterSource() {
  return ["(function () {", '  "use strict";', ...presenterInstallLines(), "})();", ""].join("\n");
}

// The exact bytes the preview hashes. The preview used to concatenate the two standalone runtime
// bundles, which serialized `createVerificationCore` and `createDomVerifier` twice (~54 KB). One
// outer IIFE now serializes the shared factories exactly once and installs both controllers in the
// same order as before: diagnostic controller, presenter, workbench controller, workbench view.
// The standalone `createDiagnosticRuntimeSource`/`createContrastWorkbenchSource` stay untouched for
// their own consumers; no new global helper is introduced and the CSP hash covers these final bytes.
function previewScriptSource() {
  return [
    "(function () {",
    '  "use strict";',
    "  var createVerificationCore = " + serializedFactory(createVerificationCore) + ";",
    "  var createDomVerifier = " + serializedFactory(createDomVerifier) + ";",
    "  var createContrastAdvice = " + serializedFactory(createContrastAdvice) + ";",
    "  var createDiagnosticRuntime = " + serializedFactory(createDiagnosticRuntime) + ";",
    "  globalThis." + DIAGNOSTIC_RUNTIME_GLOBAL + " = createDiagnosticRuntime({",
    "    createVerificationCore: createVerificationCore,",
    "    createDomVerifier: createDomVerifier,",
    "    document: document,",
    "    window: window",
    "  });",
    ...presenterInstallLines(),
    "  var createContrastWorkbench = " + serializedFactory(createContrastWorkbench) + ";",
    "  globalThis." + WORKBENCH_RUNTIME_GLOBAL + " = createContrastWorkbench({",
    "    createVerificationCore: createVerificationCore,",
    "    createDomVerifier: createDomVerifier,",
    "    createContrastAdvice: createContrastAdvice,",
    "    document: document,",
    "    window: window,",
    "    globalThis: globalThis",
    "  });",
    "  var createContrastWorkbenchView = " + serializedFactory(createContrastWorkbenchView) + ";",
    "  createContrastWorkbenchView({ controller: globalThis[" + JSON.stringify(WORKBENCH_RUNTIME_GLOBAL) + "], document: document });",
    "})();",
    "",
  ].join("\n");
}

// Same isolation shape validated in SC-01/SC-04: one script hash, inline styles only,
// `frame-src 'none'` for the srcdoc measurement frames and no network.
function previewCsp(source) {
  const hash = createHash("sha256").update(source, "utf8").digest("base64");
  return [
    "default-src 'none'",
    `script-src 'sha256-${hash}'`,
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// Conservative syntax check shared with the session: a comment never counts. Used only
// to keep a legacy payload honest when the session did not declare `baselineSupport`.
const UNSUPPORTED_RESOURCE = /@import\b|url\(/i;
function scanUnsupportedCss(css) {
  const active = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
  return UNSUPPORTED_RESOURCE.test(active);
}

// Inert payload for the runtime: only the verifiable config subset, the exact CSS bytes,
// the captured palette bytes/provenance and the declared identity. The model, the samples
// and the automation stay in the static HTML and are never merged with the browser-local run.
function diagnosticPayload(session) {
  const config = record(session.config) ? session.config : {};
  const css = record(session.css) ? session.css : {};
  const support = ["absent", "supported", "unsupported"].includes(css.tuningSupport) ? css.tuningSupport : "absent";
  const baseline = typeof css.baseline === "string" ? css.baseline : "";
  // New sessions declare baselineSupport; legacy sessions get the same conservative
  // derivation (never a positive assumption about an unsupported baseline).
  const baselineSupport = ["supported", "unsupported"].includes(css.baselineSupport)
    ? css.baselineSupport
    : (baseline === "" || scanUnsupportedCss(baseline) ? "unsupported" : "supported");
  return {
    schemaVersion: 1,
    toolVersion: typeof session.toolVersion === "string" ? session.toolVersion : null,
    snapshotId: typeof session.snapshotId === "string" ? session.snapshotId : null,
    // The captured palette block is forwarded as inert data under the canonical additive name:
    // exact CSS bytes, path, SHA-256 and per-source declarations/values. The legacy array stays in
    // `session.palette` for the static report and is never forwarded as captured source bytes.
    paletteSource: record(session.paletteSource)
      ? session.paletteSource
      : (record(session.palette) ? session.palette : null),
    config: { contrast: record(config.contrast) ? config.contrast : {}, roles: record(config.roles) ? config.roles : {} },
    css: {
      baseline,
      tuning: typeof css.tuning === "string" ? css.tuning : null,
      tuningSupport: support,
      baselineSupport,
      // Provenance metadata only; the generated CSS is never duplicated as a string here. `digest`
      // stays the real object {generated, baseline}: the measured fingerprint is digest.baseline.
      source: typeof css.source === "string" ? css.source : null,
      status: typeof css.status === "string" ? css.status : null,
      production: css.production === true,
      digest: record(css.digest)
        ? { generated: typeof css.digest.generated === "string" ? css.digest.generated : null, baseline: typeof css.digest.baseline === "string" ? css.digest.baseline : null }
        : null,
    },
    // Pure design metadata, injected as data only; the executable config is never widened by it.
    design: record(session.design) ? session.design : null,
  };
}

// Escaping `<` (as `\u003c`) makes the JSON inert inside `<script type="application/json">`:
// no `</script>` can terminate the block and JSON.parse restores the exact bytes.
function inertJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Node-side designer labels reuse the single factory; a null factory falls back to the raw value,
// never to a locally re-invented vocabulary.
function labelFrom(language, method, value, fallback) {
  if (language && typeof language[method] === "function") {
    const label = language[method](value);
    if (label !== null && label !== undefined && String(label) !== "") return String(label);
  }
  return fallback === undefined ? (value === null || value === undefined ? "non indicato" : String(value)) : fallback;
}
function pairTitleOf(language, item, fallback) {
  if (language && typeof language.pairTitle === "function") {
    const label = language.pairTitle(item.foregroundToken, item.backgroundToken, item.kind);
    if (label !== null && label !== undefined && String(label) !== "") return String(label);
  }
  return fallback === undefined ? `${item.foregroundToken} su ${item.backgroundToken}` : fallback;
}

// Design provenance and dark-blend, driven by the compact `design` metadata. Representation only:
// no ratio, threshold or color is recomputed here.
function designSourceName(design, token) {
  if (!record(design) || !Array.isArray(design.sources)) return null;
  const entry = design.sources.find((source) => record(source) && source.token === token);
  return entry && typeof entry.name === "string" ? entry.name : null;
}
// controls.defaultMix is a contract FRACTION 0..1: convert once, deterministically. darkMix
// sourcePercent/whitePercent are ALREADY percentages and are never multiplied here.
function formatMixPercent(fraction) {
  return Number.isFinite(fraction) ? `${String(Math.round(fraction * 100 * 100) / 100).replace(".", ",")}%` : null;
}
function designControlLines(design, token) {
  if (!record(design) || !record(design.tokens) || !record(design.tokens[token])) return [];
  const controls = record(design.tokens[token].controls) ? design.tokens[token].controls : null;
  if (!controls) return [];
  const lines = [];
  for (const theme of ["light", "dark"]) {
    const control = record(controls[theme]) ? controls[theme] : null;
    if (!control) continue;
    if (typeof control.override === "string" && control.override) lines.push(`Controllo per personalizzare — ${theme}: ${control.override}`);
    if (typeof control.mix === "string" && control.mix) {
      const defaultMix = formatMixPercent(control.defaultMix);
      lines.push(`Controllo per personalizzare — ${theme} mix: ${control.mix}${defaultMix ? ` (default ${defaultMix})` : ""}`);
    }
  }
  return lines;
}
function designRecipeLine(design, tools, token, theme) {
  // Single origin: the shared factory resolves the binding + recipe when available.
  const described = tools && typeof tools.describeToken === "function" ? tools.describeToken(design, token, theme) : null;
  const binding = described || (record(design) && record(design.tokens) && record(design.tokens[token]) ? design.tokens[token] : null);
  if (!binding) return null;
  const parts = [`<code>${escape(token)}</code>`];
  if (typeof binding.usage === "string" && binding.usage) parts.push(`uso: ${escape(binding.usage)}`);
  const recipeKey = typeof binding.recipe === "string" ? binding.recipe : null;
  if (recipeKey) {
    const recipe = record(design) && record(design.recipes) && record(design.recipes[recipeKey]) ? design.recipes[recipeKey] : null;
    parts.push(`Ricetta di partenza (generatore): ${escape(recipeKey)}${recipe && typeof recipe.kind === "string" ? ` (${escape(recipe.kind)})` : ""}`);
  }
  if (Array.isArray(binding.sources) && binding.sources.length) {
    parts.push(`sorgenti: ${binding.sources.map((id) => escape(designSourceName(design, id) || id)).join(", ")}`);
  }
  if (recipeKey === "surface" || recipeKey === "surface-strong") {
    const light = tools.surfaceRatio(recipeKey, "light") * 100;
    const dark = tools.surfaceRatio(recipeKey, "dark") * 100;
    parts.push(`ricetta di partenza — mix ${Math.round(light)}% source / ${Math.round(100 - light)}% base (chiaro), ${Math.round(dark)}%/${Math.round(100 - dark)}% (scuro), sostituibile da un controllo — regola di progetto, non WCAG`);
  }
  return parts.join(" · ");
}
// One row per token keeps the same public control names, themes and defaults while avoiding one
// `<li>` plus the repeated prose prefix for every single knob (the gallery is a compact archive).
function designControlsInline(design, token) {
  if (!record(design) || !record(design.tokens) || !record(design.tokens[token])) return "";
  const controls = record(design.tokens[token].controls) ? design.tokens[token].controls : null;
  if (!controls) return "";
  const parts = [];
  for (const theme of ["light", "dark"]) {
    const control = record(controls[theme]) ? controls[theme] : null;
    if (!control) continue;
    // The public control name already carries its `-light`/`-dark` suffix, so the theme word would
    // only repeat it. `override`/`mix` still distinguishes the two public control kinds.
    if (typeof control.override === "string" && control.override) parts.push(`override ${escape(control.override)}`);
    if (typeof control.mix === "string" && control.mix) {
      const defaultMix = formatMixPercent(control.defaultMix);
      parts.push(`mix ${escape(control.mix)}${defaultMix ? ` (default ${defaultMix})` : ""}`);
    }
  }
  return parts.join("; ");
}
function designFamilyHtml(design, tools, tokens) {
  if (!record(design) || !record(design.tokens)) return "";
  const rows = [];
  for (const token of tokens) {
    const parts = [];
    const line = designRecipeLine(design, tools, token, "light");
    if (line) parts.push(line);
    const controls = designControlsInline(design, token);
    if (controls) parts.push(`controlli: ${controls}`);
    if (parts.length) rows.push(parts.join(" · "));
  }
  if (!rows.length) return "";
  return `<details class="is-detail"><summary>Ricetta e controlli</summary><ul class="design-list">${rows.map((row) => `<li>${row}</li>`).join("")}</ul></details>`;
}
function designDrawnHtml(design, foreground, background, theme, tools) {
  if (!record(design) || !record(design.tokens)) return "";
  const rows = [];
  for (const token of [foreground, background]) {
    const line = designRecipeLine(design, tools, token, theme);
    if (line) rows.push(line);
    if (record(design.tokens[token])) {
      for (const controlLine of designControlLines(design, token)) rows.push(escape(controlLine));
    }
  }
  if (!rows.length) return "";
  return `<ul class="design-list">${rows.map((row) => `<li>${row}</li>`).join("")}</ul>`;
}
function darkBlendHtml(design, tools) {
  if (!record(design) || !Array.isArray(design.sources)) return "";
  const items = design.sources.map((source) => {
    if (!record(source)) return "";
    const mix = record(source.darkMix) ? source.darkMix : (tools && Number.isFinite(source.darkBlend) ? tools.darkBlendMix(source.darkBlend) : null);
    if (!record(mix) || !Number.isFinite(mix.sourcePercent) || !Number.isFinite(mix.whitePercent)) return "";
    const blend = source.darkBlend == null ? "adattivo" : String(source.darkBlend);
    return `<li><code>${escape(source.token)}</code> · ${escape(source.role ?? "ruolo non indicato")} · dark-blend ${escape(blend)} → source ${escape(String(mix.sourcePercent))}% / white ${escape(String(mix.whitePercent))}%</li>`;
  }).filter(Boolean);
  if (!items.length) return "";
  return `<h3>dark-blend per ruolo</h3>
<p class="margin-note">Regola di progetto 10/90 (source↔white), non una soglia WCAG.</p>
<ul class="dark-blend-list">${items.join("")}</ul>`;
}
function cssSourceHtml(value) {
  const css = record(value) && record(value.css) ? value.css : {};
  const source = typeof css.source === "string" ? css.source : null;
  const status = typeof css.status === "string" ? css.status : null;
  if (!source && !status) return "";
  const sourceLabels = { output: "output del progetto", "generated-candidate": "candidato generato (diagnostico)" };
  const statusLabels = { current: "aggiornato", stale: "non aggiornato: l'output attuale differisce dall'atteso", absent: "assente", empty: "vuoto" };
  // `digest` is an object {generated, baseline}; the measured fingerprint is baseline, never a
  // stringified object. When only the expected candidate exists it is labelled "atteso".
  const digest = record(css.digest) ? css.digest : null;
  const baselineDigest = digest && typeof digest.baseline === "string" ? digest.baseline : null;
  const generatedDigest = digest && typeof digest.generated === "string" ? digest.generated : null;
  const fingerprint = baselineDigest
    ? `<code>${escape(baselineDigest.slice(0, 8))}</code>`
    : generatedDigest ? `<code>${escape(generatedDigest.slice(0, 8))}</code> (atteso, non misurato)` : "<strong>non disponibile</strong>";
  let note = "";
  if (source === "generated-candidate" && (status === "absent" || status === "empty")) note = " Il candidato generato è misurato dai byte catturati; nel progetto non esiste ancora un file di output.";
  else if (status === "stale") note = " L'output attuale differisce dall'atteso: le misure si riferiscono ai byte catturati, non all'atteso. Nessun modello è mostrato come stato attuale.";
  else if (source === "generated-candidate") note = " Le misure si riferiscono a un candidato diagnostico, non all'output del progetto.";
  else if (status === "absent" || status === "empty") note = " Nessun file di output: le misure si riferiscono ai byte catturati.";
  return `<p class="margin-note">CSS misurato: ${escape(source ? sourceLabels[source] || source : "non indicato")} · stato: ${escape(status ? statusLabels[status] || status : "non indicato")} · impronta misurata ${fingerprint}.${note}</p>`;
}

// Model estimates counted from the browser-free samples, separate from the local run and the
// automation. Never a global "0": the numbers are forecasts and are labelled as such.
function modelEstimates(samples) {
  const diagnostics = list(samples).flatMap((entry) => list(record(entry) ? entry.diagnostics : null)).filter(record);
  const belowMinimum = diagnostics.filter((item) => item.status === "below-minimum").length;
  const belowTarget = diagnostics.filter((item) => item.status === "below-target").length;
  return { total: diagnostics.length, belowMinimum, belowTarget };
}

function modelEstimateLine(samples) {
  const estimates = modelEstimates(samples);
  if (!estimates.total) return "Nessuna stima del modello disponibile per questa palette.";
  return `Fallback senza browser — stime del modello: <strong>${estimates.total}</strong> ${agree(estimates.total, "coppia stimata", "coppie stimate")}, di cui <strong>${estimates.belowMinimum}</strong> sotto il minimo e <strong>${estimates.belowTarget}</strong> sotto il target. Sono previsioni, non verifiche: nessun campione qui è verificato.`;
}

// Usage samples: the note is a model ESTIMATE, never a verified ratio and never an "AA" pass badge.
function thresholdsText(item) {
  return item.minimum === item.target ? `soglia ${compactRatio(item.minimum)}` : `minimo ${compactRatio(item.minimum)} · target ${compactRatio(item.target)}`;
}

// The single visual catalog: both themes, one entry per family, the first open and the rest native
// <details> so the default view is not a wall. Exact tokens live in the collapsed detail.
function sessionFamiliesHtml(samples, language, design, tools) {
  const entries = entriesFor(list(samples));
  const { names, find } = familyAtlasData(entries);
  const estimate = `<p>${modelEstimateLine(samples)}</p>`;
  if (!names.length) return `${estimate}<p>Nessun campione dal modello disponibile per questa palette.</p>`;
  const words = [
    ["Testo su card o box", "text", "-text", "-surface"],
    ["Bordo della card", "non-text", "-border-strong", "-surface"],
    ["Pulsante", "text", "-solid-text", "-solid"],
    ["Pulsante al passaggio", "text", "-solid-text", "-solid-hover"],
    ["Etichetta su colore", "text", "-ink", ""],
  ];
  const cards = names.map((name, index) => {
    const tokens = new Set();
    const blocks = ["light", "dark"].map((scheme) => {
      const found = words.map(([label, kind, suffix, backgroundSuffix]) => {
        const item = find(scheme, kind, `--color-${name}${suffix}`, backgroundSuffix ? `--color-${name}${backgroundSuffix}` : `--color-${name}`);
        if (!item || !colorCss(item.foreground) || !colorCss(item.background)) return "";
        tokens.add(item.foregroundToken);
        tokens.add(item.backgroundToken);
        return `<li class="family-sample">${sampleFigure(item, true)}<p class="sample-title">${escape(pairTitleOf(language, item, label))}</p><p class="sample-note">Stima: <span class="contrast-value">${compactRatio(item.ratio, [item.minimum, item.target])}</span> · non verificata</p><details class="is-detail"><summary>Token e soglie</summary><p><code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code> · ${item.kind === "non-text" ? "bordo/indicatore" : "testo"} · ${thresholdsText(item)}</p></details></li>`;
      }).filter(Boolean);
      if (!found.length) return "";
      return `<div class="family-theme"><p class="eyebrow">${escape(labelFrom(language, "themeLabel", scheme))}</p>
<ul class="sample-list">${found.join("")}</ul></div>`;
    }).filter(Boolean);
    if (!blocks.length) return "";
    return `<details class="card family-strip"${index === 0 ? " open" : ""}><summary>Famiglia <code>--color-${escape(name)}</code></summary>
<div class="grid-2">${blocks.join("")}</div>
${designFamilyHtml(design, tools, tokens)}</details>`;
  }).filter(Boolean);
  if (!cards.length) return `${estimate}<p>Nessun campione dal modello disponibile per questa palette.</p>`;
  return `${estimate}<div class="family-list">${cards.join("")}</div>`;
}

// Source palette with the designer role of each color. `palette[].name` is already the exact token
// name (for example `--palette-brand`), so it is printed verbatim. The role prefers the session
// `roles.identities` mapping keyed by `paletteName`, then falls back to the entry's own role.
function sourcePaletteHtml(session, language) {
  const palette = list(session.palette);
  const roles = record(session.roles) ? session.roles : {};
  const roleByPaletteName = new Map();
  for (const identity of list(roles.identities)) {
    if (!record(identity)) continue;
    if (typeof identity.paletteName === "string" && identity.paletteName.trim()) roleByPaletteName.set(identity.paletteName, identity.role);
  }
  const items = palette.map((entry) => {
    const item = record(entry) ? entry : {};
    const name = typeof item.name === "string" && item.name.trim() ? item.name : null;
    if (!name) return "";
    const role = roleByPaletteName.has(name) ? roleByPaletteName.get(name) : item.role;
    const color = colorCss(item.resolved);
    const swatch = color ? `<span class="variant-swatch" aria-hidden="true" style="--sample-color:${color}"></span>` : "";
    return `<li>${swatch}<code>${escape(name)}</code> · ${escape(labelFrom(language, "roleLabel", role))}</li>`;
  }).filter(Boolean);
  if (!items.length) return "<p>Nessuna voce di palette con ruolo disponibile nello snapshot.</p>";
  return `<p>Fonte iniziale delle scelte del designer: la palette dichiarata e il ruolo di ogni colore.</p><ul class="role-list">${items.join("")}</ul>`;
}

// Three explicit channels, never one global verdict: model forecast, this browser, automation.
function channelScopesHtml(prepared) {
  const verification = prepared.verification;
  const scope = verification && verification.scope ? verification.scope : null;
  const model = "Stima del modello: previsione del generatore, senza browser.";
  const local = "Questo browser: misure locali dai byte CSS incorporati, nella sezione dedicata.";
  let automation;
  if (!scope || scope.status === "disabled") automation = "Automazione: disattivata o non richiesta; nessuna misura esterna è inclusa.";
  else if (scope.launched.length === 0) automation = "Automazione: ambiente non disponibile, nessun motore ha misurato.";
  else if (scope.complete) automation = "Automazione: copertura completa negli ambienti eseguiti (motori e scenari elencati), non universale.";
  else automation = "Automazione: copertura parziale o incompleta; non conferma tutte le coppie.";
  return `<ul class="channels"><li><strong>Modello</strong> ${escape(model)}</li><li><strong>Questo browser</strong> ${escape(local)}</li><li><strong>Automazione</strong> ${escape(automation)}</li></ul>`;
}

function renderDiagnosticPreview(value) {
  const prepared = prepareDiagnosticReport(value);
  const { report, scenarios, entries, iso, digest, issues, errors, verified, proposals, complete, groups, rejectedSources } = prepared;
  const language = createDesignerLanguage();
  const tools = createDesignTools();
  const design = record(value.design) ? value.design : null;
  // Provenance honesty: with an actual/stale or candidate-only CSS, the source names and recipes
  // below describe the EXPECTED (model) palette, not the authored bytes of an external output.
  const cssMeta = record(value.css) ? value.css : {};
  const designProvenanceNote = cssMeta.status === "stale"
    ? `<p class="margin-note">Stato stale: l'output attuale differisce dall'atteso. La ricetta mostrata è il <strong>rationale iniziale del generatore</strong>, non la formula attiva dei byte correnti; la provenienza misurata resta quella dei byte CSS catturati.</p>`
    : cssMeta.source === "generated-candidate"
      ? `<p class="margin-note">La ricetta è il rationale iniziale del generatore; le misure provengono dai byte CSS catturati, non da un file di output.</p>`
      : "";
  const generated = iso
    ? `<time datetime="${escape(report.generatedAt)}">${escape(report.generatedAt)}</time>`
    : escape(report.generatedAt);
  const fingerprint = digest ? `<code>${escape(String(report.inputDigest).slice(0, 8))}</code>` : "<strong>non disponibile</strong>";
  const script = previewScriptSource();
  const csp = previewCsp(script);
  const payload = inertJson(diagnosticPayload(value));
  // Compact automation: the preview keeps every scope/coverage/engine/error/unsupported summary and
  // accurate measurement counts, and defers the wide measurement/exploration tables to the full
  // report so the budgeted offline artifact stays bounded (the full report keeps all its tables).
  const automation = automationHtml(value.automation, { compact: true });
  // Automation stays technical and expandable, exactly like the report: a native <details> closed by
  // default with a scoped summary (no install obligation). The section and its id remain.
  const automationDetails = automation
    ? `<details><summary>Dettagli della verifica automatizzata (tecnici)</summary>${automation}</details>`
    : "<p>Nessuna verifica automatizzata inclusa in questo snapshot.</p>";
  const cssEmbed = cssEmbedHtml(value.css);
  const verification = prepared.verification;
  // Real integrity problems and generation/audit errors are ALWAYS visible above the content. An
  // absent or auto automation is NOT an integrity error, so it never appears here: the identity
  // problems come from `sessionVerification`, which excludes the empty-scenario-matrix noise.
  const identityProblems = verification ? verification.identityProblems : [];
  const severe = [...identityProblems, ...errors];
  const severeNotice = severe.length
    ? `<div class="notice"><p class="status">Problemi di integrità o errori dello snapshot: la verifica non può concludere.</p><ul>${severe.map((item) => `<li>${escape(item)}</li>`).join("")}</ul></div>`
    : "";
  // A positive badge is scoped to the executed environments and only ever shown when the automation
  // is complete. There is no global "non verificato" headline.
  const badgeLine = verification && verification.verified
    ? `<p class="preview-automation-badge">${badge("outline", "Verifica automatizzata completa negli ambienti eseguiti")}</p>`
    : "";
  const cssDetails = cssEmbed ? `<details><summary>CSS incorporato nello snapshot</summary>${cssEmbed}</details>` : "";
  const notesHtml = list(report.notes).length ? `<h3>Note</h3><ul>${list(report.notes).map((note) => `<li>${escape(note)}</li>`).join("")}</ul>` : "";
  const integrity = `<details><summary>File, impronta dello snapshot ed errori</summary>
<dl><div><dt>Generato il (dato dichiarato)</dt><dd>${escape(report.generatedAt)}</dd></div><div><dt>SHA-256 degli input (dichiarato, non ricalcolato)</dt><dd><code>${escape(report.inputDigest)}</code>${digest ? "" : " — non valido"}</dd></div></dl>
${notesHtml}</details>`;
  // Header stays short: palette and samples come first; channels, counters, identity and hash move
  // into a collapsed detail so the designer does not meet a wall of metadata on load.
  const stateDetails = `<details class="is-detail"><summary>Stato e provenienza dell'anteprima</summary>
${channelScopesHtml(prepared)}
<ul class="facts"><li><strong>${groups.length}</strong> ${agree(groups.length, "problema distinto", "problemi distinti")}</li><li><strong>${complete.length}</strong> ${agree(complete.length, "correzione verificata", "correzioni verificate")}</li><li><strong>${entries.length}</strong> ${agree(entries.length, "coppia misurata", "coppie misurate")}</li><li><strong>${scenarios.length}</strong> ${agree(scenarios.length, "scenario", "scenari")}</li></ul>
<p>Snapshot del ${generated} · SHA-256 abbreviato: ${fingerprint}</p>
${sessionIdentityHtml(value)}</details>`;
  const hasCorrections = groups.length > 0 || complete.length > 0 || rejectedSources.length > 0;
  const order = ["banco", "palette", "diagnostica"];
  const titles = { banco: "Palette e contrasto", palette: "Sorgente CSS", diagnostica: "Diagnostica" };
  const nav = `<nav aria-label="Sezioni dell’anteprima"><ul>${order.map((id) => `<li><a href="#${id}">${titles[id]}</a></li>`).join("")}</ul></nav>`;
  const correctionsSection = hasCorrections
    ? `<section id="correzioni" aria-labelledby="correzioni-titolo"><h2 id="correzioni-titolo">Correzioni e problemi</h2>
${actionHtml(complete, verified, issues)}${rejectedSourcesHtml(rejectedSources)}
${problemsHtml(groups, proposals, verified, language)}</section>`
    : "";
  return `${MARKER}
<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Palette e contrasti — anteprima diagnostica ${escape(report.generatedAt)}</title>
<style>${PREVIEW_CSS}${LOCAL_CSS}${CONTRAST_WORKBENCH_CSS}</style></head><body class="preview-studio"><div class="shell">
<a class="skip" href="#contenuto">Vai al contenuto</a>
<header class="studio-header">
<div class="studio-brand"><h1>Smart Colors</h1><span id="smart-colors-workbench-session-status" class="studio-session">Anteprima locale</span></div>
<button type="button" id="smart-colors-workbench-export" data-smart-colors-workbench="export" class="studio-export" disabled>Esporta CSS</button>
</header>
<main id="contenuto">
${severeNotice}
${cssMeta.status !== "current" ? `<div class="notice">${cssSourceHtml(value)}</div>` : ""}
${renderContrastWorkbench(value)}
<details id="diagnostica" class="preview-technical"><summary>Diagnostica e archivio completo</summary>
${badgeLine}
${stateDetails}
${cssMeta.status === "current" ? cssSourceHtml(value) : ""}
<section id="usi" aria-labelledby="usi-titolo"><h2 id="usi-titolo">Archivio tecnico: colori risolti e stime del modello</h2>
<p class="margin-note">Archivio secondario: i campioni qui sotto sono colori risolti dal modello, utili come riferimento tecnico. Non sono la prova live del banco e non sostituiscono le misure delle viste CSS.</p>
<details class="is-detail archive-gallery"><summary>Apri l'archivio dei campioni risolti (stime, non verifiche)</summary>
${designProvenanceNote}${sessionFamiliesHtml(value.samples, language, design, tools)}</details></section>
<section id="locale" aria-labelledby="locale-titolo"><h2 id="locale-titolo">Verifica locale completa (archivio)</h2>
<p>Misure di tutte le coppie sui CSS incorporati. Senza JavaScript rimangono disponibili lo snapshot e le stime del modello.</p>
<div id="smart-colors-diagnostic" data-smart-colors-diagnostic="host" role="region" aria-label="Verifica locale dei contrasti Smart Colors">
<p data-smart-colors-diagnostic="status" role="status">Misure locali non eseguite: serve JavaScript nel browser. Lo snapshot e i campioni del modello restano la fonte.</p>
<div data-smart-colors-diagnostic="frames" class="local-frames"></div>
<button type="button" data-smart-colors-diagnostic="retry" hidden>Ripeti verifica</button>
</div></section>
${correctionsSection}
<section id="dati" aria-labelledby="dati-titolo"><h2 id="dati-titolo">Dati tecnici</h2>
<p>Non servono per leggere la correzione. Token, soglie e impronte restano disponibili qui.</p>
${cssDetails}${integrity}</section>
<section id="automazione" aria-labelledby="automazione-titolo"><h2 id="automazione-titolo">Verifica automatizzata</h2>
${automationDetails}</section>
</details>
</main>
<footer>
${nav}
<p><a class="studio-report-link" href="smart-colors.html">Report completo ↗</a> · Le prove restano in questa pagina. Nessun file viene modificato automaticamente.</p>
<details><summary>Ambito e limiti della verifica</summary><p>Anteprima dello stesso snapshot del report completo. Le misure usano i CSS incorporati, senza leggere il progetto o contattare la rete. Riferimento WCAG 2.x clipped-sRGB sui colori opachi risolti dal browser; trasparenze, foto, gradienti e stati non misurati restano fuori. Un contrasto sufficiente non garantisce che due colori siano distinguibili per ogni persona e non sostituisce un audit completo di accessibilità.</p></details>
</footer>
</div>
<script type="application/json" id="smart-colors-payload">${payload}</script>
<script id="smart-colors-runtime">${script}</script>
</body></html>\n`;
}

/** Render the compact preview of a supplied snapshot only: no I/O, no new measurements. */
export function formatContrastPreviewHtml(value) {
  if (isDiagnosticSession(value)) return renderDiagnosticPreview(value);
  const { report, scenarios, entries, problems, iso, digest, issues, errors, verified, proposals,
    complete, groups, overlaps, variantShifts, rejectedSources, outcome } = prepareContrastReport(value);
  const generated = iso
    ? `<time datetime="${escape(report.generatedAt)}">${escape(report.generatedAt)}</time>`
    : escape(report.generatedAt);
  const fingerprint = digest ? `<code>${escape(String(report.inputDigest).slice(0, 8))}</code>` : "<strong>non disponibile</strong>";
  return `${MARKER}
<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contrasto colori — anteprima dello snapshot ${escape(report.generatedAt)}</title>
<style>${PREVIEW_CSS}</style></head><body><div class="shell">
<a class="skip" href="#contenuto">Vai al contenuto</a>
<header>
<p class="eyebrow">Smart Colors · anteprima</p>
<h1>Contrasto colori — anteprima</h1>
<p class="verdict">${outcome}</p>
<p>${verified ? badge("outline", "Snapshot verificato") : badge("dashed", "Snapshot non verificato")}</p>
<ul class="facts"><li><strong>${groups.length}</strong> ${agree(groups.length, "problema distinto", "problemi distinti")}</li><li><strong>${complete.length}</strong> ${agree(complete.length, "correzione verificata", "correzioni verificate")}</li><li><strong>${entries.length}</strong> ${agree(entries.length, "coppia misurata", "coppie misurate")}</li><li><strong>${scenarios.length}</strong> ${agree(scenarios.length, "scenario", "scenari")}</li></ul>
<p>Snapshot del ${generated} · SHA-256 abbreviato: ${fingerprint} · <a href="smart-colors.html">Apri il report completo</a></p>
<nav aria-label="Sezioni dell’anteprima"><ul><li><a href="#azione">Cosa fare adesso</a></li><li><a href="#problemi">Problemi</a></li><li><a href="#palette">Palette</a></li><li><a href="#varianti">Varianti</a></li><li><a href="#abbinamenti">Abbinamenti</a></li></ul></nav>
</header>
<main id="contenuto">
${verified ? "" : `<div class="notice"><p class="status">Nessuna conclusione positiva: dati assenti, non validi, incoerenti o errori impediscono di verificare lo snapshot.</p><ul>${[...problems, ...errors].map((item) => `<li>${escape(item)}</li>`).join("")}</ul></div>`}
<section id="azione" aria-labelledby="azione-titolo"><h2 id="azione-titolo">Cosa fare adesso</h2>
${actionHtml(complete, verified, issues)}${rejectedSourcesHtml(rejectedSources)}</section>
<section id="problemi" aria-labelledby="problemi-titolo"><h2 id="problemi-titolo">Problemi e misure</h2>
${problemsHtml(groups, proposals, verified)}</section>
<section id="palette" aria-labelledby="palette-titolo"><h2 id="palette-titolo">Palette: famiglie nei componenti</h2>
${paletteHtml(familyAtlasData(entries), verified)}</section>
<section id="varianti" aria-labelledby="varianti-titolo"><h2 id="varianti-titolo">Varianti lontane dalla sorgente</h2>
${variantsHtml(variantShifts)}</section>
<section id="abbinamenti" aria-labelledby="abbinamenti-titolo"><h2 id="abbinamenti-titolo">Abbinamenti liberi</h2>
${pairingsHtml(overlaps)}</section>
</main>
<footer>
<p class="cta"><a href="smart-colors.html">Apri il report completo (smart-colors.html)</a></p>
<p>Anteprima statica dello stesso snapshot del report completo: non misura, non ricalcola e non legge i file del progetto. Riferimento WCAG 2.x clipped-sRGB sui colori opachi risolti dal browser; trasparenze, foto, gradienti e stati non misurati restano fuori, e nessun contrasto sufficiente garantisce che due colori siano distinguibili per ogni persona.</p>
<p>Questa anteprima non sostituisce un audit completo di accessibilità.</p>
</footer>
</div></body></html>\n`;
}
