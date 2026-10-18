// Compact companion artifact of reports/smart-colors.html. It reads the same frozen
// snapshot through the same internal helpers, keeps the same fail-closed contract and
// never measures, recalculates or invents anything: an unverified snapshot gets no
// positive verdict and no color is labeled as suggested.
//
// For the SC-03 diagnostic session it also embeds the SC-04 browser runtime (plus a
// presentation-only presenter serialized from this module) and an inert JSON payload
// of the exact CSS bytes, so the page can add local measurements from `file://`. The
// CSP hash is computed over the final emitted script bytes; the static report never
// gains a script. Local measurements only touch the in-memory DOM: they never rewrite
// this file or the report.
import { createHash } from "node:crypto";
import { createDiagnosticRuntimeSource, DIAGNOSTIC_RUNTIME_GLOBAL } from "./diagnostic-runtime.mjs";
import {
  CSP, MARKER, VARIANT_SHIFT_THRESHOLD, agree, automationHtml, baselineNote, colorChoice, colorCss, compactRatio, cssEmbedHtml,
  deltaSummary, entriesFor, escape, familyAtlasData, fileRole, isDiagnosticSession, it, list, overlapList, prepareContrastReport,
  proposalSentence, prepareDiagnosticReport, record, sampleVisual, sessionIdentityHtml, sideEffectsHtml, status,
} from "./format-report-html.mjs";

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
  .variant-swatch { display: inline-block; width: 1.4rem; height: 1.4rem; vertical-align: -.4rem; margin-inline-end: var(--space-2); border: 1px solid var(--ink-soft); border-radius: var(--radius-sm); background: var(--sample-color, var(--soft)); }
  .variant-list { padding-inline-start: 1.2rem; font-size: var(--text-sm); }
  .variant-list li { margin-block: var(--space-2); }
  .pair-list { padding-inline-start: 1.2rem; font-size: var(--text-sm); }
  .pair-list li { margin-block: var(--space-1); }
  .pair-list .contrast-value { font-size: var(--text-base); }
  .pair-chip { display: inline-block; margin-inline-end: var(--space-2); padding: 0 .5rem; border: 1px solid var(--ink-soft); border-radius: var(--radius-sm); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); }
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
  nav { position: sticky; top: 0; z-index: 2; margin-block-start: var(--space-3); border-block: 1px solid var(--ink-muted); background: color-mix(in oklab, var(--paper) 90%, transparent); backdrop-filter: blur(6px); }
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
@layer components {
  .local-frames { display: grid; gap: var(--space-3); margin-block-start: var(--space-3); }
  .local-frames iframe { width: 100%; min-height: 4rem; border: 1px solid var(--ink-muted); border-radius: var(--radius); background: var(--paper); }
  .local-rows { margin-block-start: var(--space-4); }
  .local-rows h3 { margin-block-end: var(--space-2); }
  .local-state { font-weight: 650; }
  .local-scope, .local-empty, .local-errors { font-size: var(--text-sm); color: var(--ink-soft); }
  .local-errors, .local-unsupported, .automation-engines, .automation-errors, .automation-unsupported { padding-inline-start: 1.2rem; font-size: var(--text-sm); }
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
    .local-frames iframe, .local-table-scroll, .local-table th, .local-table td, .table-scroll, .table-scroll th, .table-scroll td { border: 1px solid CanvasText; }
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

function sampleFigure(item) {
  const foreground = colorCss(item.foreground), background = colorCss(item.background);
  if (!foreground || !background) return "";
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

function problemCard(group, proposals) {
  const before = group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst);
  const { item } = before;
  const view = proposals.find((proposal) => proposal.complete && group.every((entry) => proposal.covered.has(entry.key)));
  const title = item.backgroundToken === "--color-surface" && item.foregroundToken === "--color-text-muted" ? "Testo secondario sulla superficie"
    : item.backgroundToken === "--color-surface" && item.foregroundToken === "--color-tertiary-text" ? "Testo terziario sulla superficie" : item.label;
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

function problemsHtml(groups, proposals, verified) {
  if (!groups.length) return `<p>${verified ? "Nessun problema nelle coppie misurate." : "Riepilogo non disponibile: verifica incompleta."}</p>`;
  const ordered = [...groups].sort((a, b) => (a[0].item.status === "below-minimum" ? 0 : 1) - (b[0].item.status === "below-minimum" ? 0 : 1));
  return `<p>Una card per gruppo di misure, prima i problemi sotto il minimo e poi quelli sotto il target. I rapporti sono sintetici; minimo e target restano distinti.</p>
<div class="card-grid">${ordered.map((group) => problemCard(group, proposals)).join("")}</div>`;
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
  var HOST_ID = "smart-colors-diagnostic";
  var HOOK = "data-smart-colors-diagnostic";
  var STATE_LABELS = {
    pending: "in attesa",
    running: "in corso",
    complete: "completa",
    incomplete: "incompleta",
    unavailable: "non disponibile",
    unsupported: "non supportata",
    disabled: "disattivata",
  };
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
  function pairLabel(pairId) {
    var parts = typeof pairId === "string" ? pairId.split("|") : [];
    if (parts.length !== 4) return typeof pairId === "string" ? pairId : "coppia non indicata";
    return parts[2] + " su " + parts[3] + " (" + parts[1] + ", tema " + parts[0] + ")";
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
      row.appendChild(element("td", null, pairLabel(item.pairId)));
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
  function render(snapshot) {
    var panel = ensurePanel();
    clear(panel);
    var state = snapshot && typeof snapshot.state === "string" ? snapshot.state : "pending";
    var report = snapshot && isRecord(snapshot.report) ? snapshot.report : null;
    panel.appendChild(element("h3", null, "Misure locali di questo browser"));
    panel.appendChild(element("p", "local-state", "Stato della verifica locale: " + (STATE_LABELS[state] || String(state)) + "."));
    if (!report) {
      panel.appendChild(element("p", "local-empty", "Nessuna misura locale disponibile in questa pagina: lo snapshot statico e i campioni del modello restano la fonte."));
      return;
    }
    var preference = isRecord(report.preference) ? report.preference : {};
    var coverage = isRecord(report.coverage) ? report.coverage : {};
    var executed = isRecord(report.executed) ? report.executed : {};
    var scenarioCount = Array.isArray(executed.scenarios) ? executed.scenarios.length : 0;
    var unmeasured = Array.isArray(preference.unmeasured) ? preference.unmeasured : [];
    panel.appendChild(element("p", "local-scope", "Provenienza: browser-local, separata dal modello e dall'automazione. Preferenza attiva: "
      + (typeof preference.active === "string" ? preference.active : "non disponibile")
      + "; scenari misurati: " + scenarioCount + "; copertura: " + (coverage.complete ? "completa negli scenari locali eseguiti (non universale)" : "incompleta")
      + (unmeasured.length ? "; preferenza non misurata: " + unmeasured.join(", ") : "") + "."));
    var measurements = Array.isArray(report.measurements) ? report.measurements : [];
    if (measurements.length) panel.appendChild(rowsTable(measurements));
    else panel.appendChild(element("p", "local-empty", "Nessuna coppia misurata in questo browser: vedi lo stato e gli errori qui sotto."));
    var unsupported = Array.isArray(report.unsupported) ? report.unsupported : [];
    if (unsupported.length) {
      panel.appendChild(element("h3", null, "Scenari non supportati"));
      panel.appendChild(unsupportedList(unsupported));
    }
    var errors = Array.isArray(report.errors) ? report.errors : [];
    if (errors.length) {
      panel.appendChild(element("h3", null, "Errori della verifica locale"));
      panel.appendChild(errorsList(errors));
    }
  }
  function listener(snapshot) {
    try { render(snapshot); } catch (error) { /* presentation must never break the run */ }
  }
  try { render(controller.status()); } catch (error) { /* the initial render is best-effort */ }
  controller.subscribe(listener);
  return { render: render };
}

/** Classic-script fragment that installs the local presenter on the runtime controller. */
export function localPresenterSource() {
  return [
    "(function () {",
    '  "use strict";',
    "  var createLocalPresenter = " + createLocalPresenter.toString() + ";",
    "  createLocalPresenter({ controller: globalThis." + DIAGNOSTIC_RUNTIME_GLOBAL + ", document: document });",
    "})();",
    "",
  ].join("\n");
}

// The exact bytes the preview hashes: the runtime plus the presenter, nothing else.
function previewScriptSource() {
  return createDiagnosticRuntimeSource() + localPresenterSource();
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

// Inert payload for the runtime: only the verifiable config subset, the exact CSS bytes
// and the declared identity. The model, the samples and the automation stay in the
// static HTML and are never merged with the browser-local run.
function diagnosticPayload(session) {
  const config = record(session.config) ? session.config : {};
  const css = record(session.css) ? session.css : {};
  const support = ["absent", "supported", "unsupported"].includes(css.tuningSupport) ? css.tuningSupport : "absent";
  return {
    schemaVersion: 1,
    toolVersion: typeof session.toolVersion === "string" ? session.toolVersion : null,
    snapshotId: typeof session.snapshotId === "string" ? session.snapshotId : null,
    config: { contrast: record(config.contrast) ? config.contrast : {}, roles: record(config.roles) ? config.roles : {} },
    css: {
      baseline: typeof css.baseline === "string" ? css.baseline : "",
      tuning: typeof css.tuning === "string" ? css.tuning : null,
      tuningSupport: support,
    },
  };
}

// Escaping `<` (as `\u003c`) makes the JSON inert inside `<script type="application/json">`:
// no `</script>` can terminate the block and JSON.parse restores the exact bytes.
function inertJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function previewModelAtlas(samples) {
  const families = familyAtlasData(entriesFor(list(samples)));
  if (!families.names.length) return "<p>Nessun campione dal modello disponibile per questa palette.</p>";
  return `<p>Campioni calcolati dal modello del generatore, senza browser: ogni coppia è una previsione, non una verifica. Per questo nessun campione riceve un badge di verifica.</p>
<div class="card-grid card-grid--wide">${families.names.map((name) => familyCard(name, families.find)).join("")}</div>`;
}

function renderDiagnosticPreview(value) {
  const prepared = prepareDiagnosticReport(value);
  const { report, scenarios, entries, problems, iso, digest, issues, errors, verified, proposals,
    complete, groups, overlaps, variantShifts, rejectedSources, outcome } = prepared;
  const generated = iso
    ? `<time datetime="${escape(report.generatedAt)}">${escape(report.generatedAt)}</time>`
    : escape(report.generatedAt);
  const fingerprint = digest ? `<code>${escape(String(report.inputDigest).slice(0, 8))}</code>` : "<strong>non disponibile</strong>";
  const script = previewScriptSource();
  const csp = previewCsp(script);
  const payload = inertJson(diagnosticPayload(value));
  const atlas = previewModelAtlas(list(value.samples));
  const automation = automationHtml(value.automation);
  const cssEmbed = cssEmbedHtml(value.css);
  const verification = prepared.verification;
  const scopeNote = verification.verified
    ? "Verifica circoscritta ai motori e agli scenari automatizzati elencati: non è una conferma universale, e i campioni del modello restano previsioni. Le misure locali di questo browser restano separate."
    : "Nessuna conclusione positiva: l'automazione non copre tutte le coppie negli ambienti eseguiti, oppure lo snapshot ha problemi di identità. I campioni del modello restano previsioni e le misure locali di questo browser restano separate.";
  return `${MARKER}
<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contrasto colori — anteprima diagnostica ${escape(report.generatedAt)}</title>
<style>${PREVIEW_CSS}${LOCAL_CSS}</style></head><body><div class="shell">
<a class="skip" href="#contenuto">Vai al contenuto</a>
<header>
<p class="eyebrow">Smart Colors · anteprima diagnostica</p>
<h1>Contrasto colori — anteprima</h1>
<p class="verdict">${outcome}</p>
<p>${verification.verified ? badge("outline", "Snapshot verificato: coppie automatizzate negli ambienti eseguiti") : badge("dashed", "Snapshot non verificato")}</p>
<p class="margin-note">${scopeNote}</p>
<ul class="facts"><li><strong>${groups.length}</strong> ${agree(groups.length, "problema distinto", "problemi distinti")}</li><li><strong>${complete.length}</strong> ${agree(complete.length, "correzione verificata", "correzioni verificate")}</li><li><strong>${entries.length}</strong> ${agree(entries.length, "coppia misurata", "coppie misurate")}</li><li><strong>${scenarios.length}</strong> ${agree(scenarios.length, "scenario", "scenari")}</li></ul>
<p>Snapshot del ${generated} · SHA-256 abbreviato: ${fingerprint} · <a href="smart-colors.html">Apri il report completo</a></p>
${sessionIdentityHtml(value)}
<nav aria-label="Sezioni dell’anteprima"><ul><li><a href="#locale">Verifica locale</a></li><li><a href="#azione">Cosa fare adesso</a></li><li><a href="#problemi">Problemi</a></li><li><a href="#modello">Campioni dal modello</a></li><li><a href="#palette">Palette</a></li><li><a href="#varianti">Varianti</a></li><li><a href="#abbinamenti">Abbinamenti</a></li><li><a href="#automazione">Automazione</a></li></ul></nav>
</header>
<main id="contenuto">
${verified ? "" : `<div class="notice"><p class="status">Nessuna conclusione positiva: dati assenti, non validi, incoerenti o errori impediscono di verificare lo snapshot.</p><ul>${[...problems, ...errors].map((item) => `<li>${escape(item)}</li>`).join("")}</ul></div>`}
${list(report.notes).length ? `<p>${escape(report.notes[0])}</p>` : ""}
<section id="locale" aria-labelledby="locale-titolo"><h2 id="locale-titolo">Verifica locale in questo browser</h2>
<p>Questa sezione misura i byte CSS incorporati nella pagina, senza rete e senza leggere il progetto su disco. Le misure modificano solo il DOM di questa pagina: non riscrivono il file né il report completo. Senza JavaScript restano leggibili lo snapshot, i campioni del modello e questa spiegazione.</p>
<div id="smart-colors-diagnostic" data-smart-colors-diagnostic="host" role="region" aria-label="Verifica locale dei contrasti Smart Colors">
<p data-smart-colors-diagnostic="status" role="status">Misure locali non eseguite: serve JavaScript nel browser. Lo snapshot e i campioni del modello restano la fonte.</p>
<div data-smart-colors-diagnostic="frames" class="local-frames"></div>
<button type="button" data-smart-colors-diagnostic="retry" hidden>Ripeti verifica</button>
</div>
${cssEmbed ? `<details><summary>CSS incorporato nello snapshot</summary>${cssEmbed}</details>` : ""}</section>
<section id="azione" aria-labelledby="azione-titolo"><h2 id="azione-titolo">Cosa fare adesso</h2>
${actionHtml(complete, verified, issues)}${rejectedSourcesHtml(rejectedSources)}</section>
<section id="problemi" aria-labelledby="problemi-titolo"><h2 id="problemi-titolo">Problemi e misure</h2>
${problemsHtml(groups, proposals, verified)}</section>
<section id="modello" aria-labelledby="modello-titolo"><h2 id="modello-titolo">Campioni dal modello (senza browser)</h2>
${atlas}
<p class="margin-note">I campioni del modello non ricevono un badge di verifica: la verifica locale è nella sezione “Verifica locale” e, quando richiesta, nell’automazione.</p></section>
<section id="palette" aria-labelledby="palette-titolo"><h2 id="palette-titolo">Palette: famiglie nei componenti</h2>
${paletteHtml(familyAtlasData(entries), verified)}</section>
<section id="varianti" aria-labelledby="varianti-titolo"><h2 id="varianti-titolo">Varianti lontane dalla sorgente</h2>
${variantsHtml(variantShifts)}</section>
<section id="abbinamenti" aria-labelledby="abbinamenti-titolo"><h2 id="abbinamenti-titolo">Abbinamenti liberi</h2>
${pairingsHtml(overlaps)}</section>
<section id="automazione" aria-labelledby="automazione-titolo"><h2 id="automazione-titolo">Verifica automatizzata</h2>
${automation}</section>
</main>
<footer>
<p class="cta"><a href="smart-colors.html">Apri il report completo (smart-colors.html)</a></p>
<p>Anteprima dello stesso snapshot del report completo. Alle sezioni statiche si aggiunge la verifica locale del browser: usa i byte CSS incorporati, non legge il progetto, non contatta la rete e non modifica il file. Riferimento WCAG 2.x clipped-sRGB sui colori opachi risolti dal browser; trasparenze, foto, gradienti e stati non misurati restano fuori, e nessun contrasto sufficiente garantisce che due colori siano distinguibili per ogni persona.</p>
<p>Questa anteprima non sostituisce un audit completo di accessibilità.</p>
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
