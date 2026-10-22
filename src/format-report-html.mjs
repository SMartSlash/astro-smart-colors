import { createDesignerLanguage } from "./designer-language.mjs";
import { createDesignTools } from "./design-recipes.mjs";

export const MARKER = "<!-- smart-colors-report:v1 -->";
// The report and the preview must name the same pair identically, so the shared lexicon is
// instantiated once here instead of copying the labels into every renderer.
const designer = createDesignerLanguage();
const designTools = createDesignTools();
const FILE_KEYS = ["palette", "config", "tuning", "output"];
const STATUSES = {
  pass: "Target e minimo raggiunti",
  "below-target": "Sotto il target",
  "below-minimum": "Sotto il minimo",
};
export const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

const CSS = `
@layer reset, tokens, base, components, pages, animations, layout, utilities, capabilities, preferences, overrides;
@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
  body, h1, h2, h3, h4, h5, p, ul, ol, dl, dd, figure { margin: 0; }
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
    --line-strong: #9aa0a6;
    --accent: #1f3a5f;
    --accent-soft: #eef2f7;
    --warn-soft: #fdf6e8;
    --metric: 1.05;
    --space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem; --space-5: 1.5rem; --space-6: 2rem; --space-7: 3rem;
    --radius-sm: 4px; --radius: 8px; --radius-lg: 14px;
    --shadow-1: 0 1px 2px rgba(16, 18, 22, .06), 0 1px 3px rgba(16, 18, 22, .04);
    --shadow-2: 0 2px 4px rgba(16, 18, 22, .06), 0 8px 24px rgba(16, 18, 22, .06);
    --text-xs: .8125rem; --text-sm: .875rem; --text-base: 1rem; --text-md: 1.0625rem;
    --text-lg: 1.25rem; --text-xl: 1.5rem; --text-2xl: clamp(1.75rem, 1.2rem + 2vw, 2.375rem);
    --measure: 72ch;
  }
}
@layer base {
  html { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.6; color: var(--ink); background: var(--paper-soft); -webkit-text-size-adjust: 100%; }
  body { overflow-wrap: anywhere; }
  h1, h2, h3, h4, h5 { line-height: 1.2; text-wrap: balance; }
  h1 { font-size: var(--text-2xl); letter-spacing: -.015em; }
  h2 { font-size: var(--text-xl); letter-spacing: -.01em; }
  h3 { font-size: var(--text-md); }
  h4 { font-size: var(--text-base); }
  h5 { font-size: var(--text-sm); text-transform: uppercase; letter-spacing: .06em; color: var(--ink-soft); }
  p, li, dd { max-width: var(--measure); }
  a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: .18em; }
  a:hover { text-decoration-thickness: 2px; }
  :focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; border-radius: var(--radius-sm); }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; user-select: text; }
  code { padding: .1em .35em; border-radius: var(--radius-sm); background: var(--soft); font-size: .92em; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); }
  pre code { padding: 0; background: none; }
  summary { cursor: pointer; padding: var(--space-3) var(--space-4); min-height: 44px; font-weight: 650; display: flex; gap: var(--space-3); align-items: baseline; }
  summary::marker { content: ""; }
  summary::before { content: "▸"; color: var(--ink-muted); font-weight: 400; }
  details[open] > summary::before { content: "▾"; }
  details { border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); }
  details + details { margin-block-start: var(--space-3); }
  details > :not(summary) { margin-inline: var(--space-4); }
  details > :last-child:not(summary) { margin-block-end: var(--space-4); }
  table { border-collapse: collapse; width: 100%; min-width: 48rem; font-size: var(--text-sm); }
  caption { text-align: start; font-weight: 650; padding-block: var(--space-3); }
  th, td { border-block-end: 1px solid var(--line); padding: var(--space-3); text-align: start; vertical-align: top; }
  thead th { background: var(--soft); border-block-end: 1px solid var(--line-strong); position: sticky; top: 0; z-index: 1; }
  tbody tr:nth-child(even) td, tbody tr:nth-child(even) th { background: color-mix(in oklab, var(--soft) 40%, var(--paper)); }
  figure { margin: 0; }
  figcaption { padding-block: var(--space-2); color: var(--ink-soft); }
  dt { font-weight: 650; }
  dd { margin-block-end: var(--space-3); color: var(--ink-soft); }
}
@layer components {
  .notice, .card { border: 1px solid var(--line); border-radius: var(--radius); padding: var(--space-4); background: var(--paper); color: var(--ink); box-shadow: var(--shadow-1); }
  .notice { border-inline-start: .35rem solid var(--line-strong); background: var(--warn-soft); }
  .notice > :first-child, .card > :first-child { margin-block-start: 0; }
  .recommendation { border-color: var(--accent); border-inline-start-width: .4rem; box-shadow: var(--shadow-2); }
  .status { font-weight: 700; }
  .overview { font-size: var(--text-lg); font-weight: 700; margin-block-end: var(--space-2); }
  .eyebrow { font-size: var(--text-xs); font-weight: 750; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-muted); }
  .badge { display: inline-block; padding: .15rem .6rem; border-radius: 999px; background: var(--ink); color: var(--paper); font-size: var(--text-xs); font-weight: 750; letter-spacing: .02em; }
  .table-scroll { overflow-x: auto; max-width: 100%; border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); }
  .table-scroll:focus-visible { outline-offset: 2px; }
  .swatch { height: 4rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sample-color, var(--soft)); }
  .color-choice { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); }
  .color-choice--suggested { border: 2px solid var(--accent); box-shadow: var(--shadow-1); }
  .color-choice .swatch { height: 7rem; }
  .color-choice figcaption strong { display: block; margin-block-end: var(--space-2); }
  .color-choice--suggested figcaption strong { font-size: var(--text-md); }
  .contrast-value { display: block; margin-block: var(--space-2); font-size: var(--text-xl); font-weight: 750; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
  .problem-card h3 { margin-block-end: var(--space-2); }
  .snippet-label { font-weight: 750; margin-block-start: var(--space-4); }
  .destination dt, .destination dd { display: inline; }
  .destination dd { margin-inline-start: var(--space-2); color: var(--ink); }
  .destination div + div { margin-block-start: var(--space-2); }
  .pair-visual { display: grid; gap: .35rem; min-height: 6rem; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); }
  .pair-title { font-size: 1.2rem; font-weight: 700; line-height: 1.25; }
  .pair-text { font-size: 1rem; font-weight: 400; }
  .pair-label { font-size: var(--text-xs); }
  .pair-border { display: block; width: 4rem; height: 1.25rem; border: 1px solid var(--sample-fg, var(--ink)); border-radius: 2px; }
  .pair-border--2 { border-width: 2px; }
  .pair-border--3 { border-width: 3px; }
  .skip { display: inline-block; padding: var(--space-2) var(--space-3); }
  .usage-card { padding: var(--space-4); }
  .usage-card h3 { margin-block-end: var(--space-3); }
  .usage-state { display: block; padding: .3rem .6rem; border: 1px solid var(--line); border-radius: var(--radius-sm); margin-block-start: var(--space-1); }
  .usage-state--attention { border-inline-start: .3rem solid var(--ink); font-weight: 650; background: var(--warn-soft); }
  .usage-state--avoid { background: var(--ink); color: var(--paper); font-weight: 750; }
  .usage-state--pass { border-color: var(--line-strong); }
  .usage-count { display: block; font-size: var(--text-xs); color: var(--ink-muted); }
  .overlap-card .pair-visual { min-height: 4rem; }
  .overlap-card .contrast-value { font-size: var(--text-lg); }
  .overlap-card h5 { margin-block: var(--space-4) var(--space-2); }
  .family-card { padding: var(--space-4); }
  .family-card h4 { margin-block-end: var(--space-3); }
  .model-atlas-title { margin-block: var(--space-4) var(--space-3); }
  .family-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--space-3); }
  .family-sample { border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); overflow: hidden; }
  .family-visual { display: grid; gap: .35rem; padding: var(--space-3); border-block-end: 1px solid var(--line); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); box-shadow: inset 0 0 0 3px var(--sample-border, transparent); }
  .family-visual .pair-border { width: 4rem; height: 1.25rem; }
  .family-sample ul { padding: var(--space-3); padding-inline-start: 1.9rem; font-size: var(--text-xs); color: var(--ink-soft); }
  .family-sample li + li { margin-block-start: var(--space-1); }
  .family-title { padding: var(--space-3) var(--space-3) 0; font-weight: 700; font-size: var(--text-sm); }
  .family-sample .contrast-value { display: inline; margin: 0; font-size: var(--text-base); }
  .pair-list { padding-inline-start: 1.4rem; font-size: var(--text-sm); }
  .pair-list li { margin-block: var(--space-1); }
  .pair-list .contrast-value { display: inline; margin: 0; font-size: var(--text-base); }
  .pair-chip { display: inline-block; margin-inline-end: var(--space-2); padding: 0 .45rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); }
  .scope-note { border-inline-start: .35rem solid var(--line-strong); padding-inline-start: var(--space-3); color: var(--ink-soft); }
  .preview-cta { font-weight: 650; }
  .session-evidence { display: grid; gap: var(--space-3); grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); margin-block: var(--space-3); }
  .session-evidence dd { margin-block-end: 0; color: var(--ink); }
  .baseline-note { border-inline-start: .3rem solid var(--line-strong); padding-inline-start: var(--space-3); color: var(--ink-soft); }
  .margin-note { font-size: var(--text-sm); color: var(--ink-muted); }
  .overlap-matrix { margin-block: var(--space-3); }
  .overlap-matrix table { min-width: 0; font-size: var(--text-xs); }
  .overlap-matrix th, .overlap-matrix td { padding: .35rem .45rem; }
  .matrix-badge { display: inline-block; padding: 0 .35rem; border: 1px solid var(--line-strong); border-radius: 999px; font-weight: 700; font-size: .75rem; }
  .matrix-badge--aa { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .matrix-badge--no { border-style: dashed; color: var(--ink-soft); }
  .matrix-ratio { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .variant-swatch, .palette-swatch { display: inline-block; width: 1.2rem; height: 1.2rem; vertical-align: -.25rem; margin-inline-end: var(--space-2); border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--sample-color, var(--soft)); }
  .variant-list li { margin-block: var(--space-2); }
  .side-effect { margin-block-start: var(--space-3); padding: var(--space-3); border: 1px dashed var(--line-strong); border-radius: var(--radius); background: var(--paper-soft); }
  .side-effect ul { padding-inline-start: 1.2rem; }
  .side-effect .contrast-value { display: inline; margin: 0; font-size: var(--text-base); }
  .summary-facts { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); list-style: none; padding: 0; margin-block: var(--space-3) 0; }
  .summary-facts li { border: 1px solid var(--line); border-radius: 999px; padding: .2rem .7rem; font-size: var(--text-sm); background: var(--paper); max-width: none; }
  .summary-facts strong { font-variant-numeric: tabular-nums; }
  .file-group { border-inline-start: .35rem solid var(--accent); }
  .file-group > h3 { margin-block-end: var(--space-1); }
  .palette-suggestions { padding-inline-start: 1.4rem; }
  .palette-suggestions li { margin-block: var(--space-3); }
  .palette-actions { margin-block-start: var(--space-1); color: var(--ink-soft); font-size: var(--text-sm); }
  .sample-meta { margin-block-start: var(--space-2); color: var(--ink-soft); font-size: var(--text-xs); }
  .design-note { border-inline-start: .35rem solid var(--accent); padding-inline-start: var(--space-3); }
  .design-token { white-space: nowrap; }
  .exploration-scope { border-inline-start: .35rem solid var(--line-strong); padding-inline-start: var(--space-3); color: var(--ink-soft); }
}
@layer layout {
  .shell { max-width: 76rem; margin-inline: auto; padding: var(--space-4) var(--space-4) var(--space-6); }
  main > section, footer { margin-block: var(--space-7); }
  section > h2 { margin-block-end: var(--space-2); }
  section > h2 + p { color: var(--ink-soft); }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: var(--space-4); }
  .comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: var(--space-4); }
  .usage-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: var(--space-4); }
  .grid > *, .comparison > *, .usage-grid > *, .card { min-width: 0; }
  .card > :first-child { margin-block-start: 0; }
  .color-change + .color-change { margin-block-start: var(--space-5); }
  main > section > h3 { margin-block: var(--space-6) var(--space-3); }
  nav { position: sticky; top: 0; z-index: 2; background: color-mix(in oklab, var(--paper) 88%, transparent); backdrop-filter: blur(6px); border-block: 1px solid var(--line); margin-block: var(--space-4) 0; }
  nav ul { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); padding: var(--space-2) var(--space-3) var(--space-2) 1.25rem; list-style: none; }
  nav a { font-size: var(--text-sm); font-weight: 650; text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  :target { scroll-margin-top: 5rem; }
  article + article { margin-block-start: var(--space-5); }
  .grid > article + article, .usage-grid > article + article, .family-card + .family-card, .overlap-card + .overlap-card { margin-block-start: 0; }
  header { border-block-end: 1px solid var(--line); padding-block-end: var(--space-4); }
  footer { border-block-start: 1px solid var(--line); padding-block-start: var(--space-4); color: var(--ink-muted); font-size: var(--text-sm); }
  .file-group + .file-group { margin-block-start: var(--space-5); }
}
@layer preferences {
  @media (forced-colors: active) {
    :root { --ink: CanvasText; --paper: Canvas; --paper-soft: Canvas; --soft: Canvas; --line: CanvasText; --line-strong: CanvasText; --accent: LinkText; --accent-soft: Canvas; --warn-soft: Canvas; }
    .card, .notice, .table-scroll, details, .color-choice, .usage-state, .matrix-badge { border: 1px solid CanvasText; box-shadow: none; }
    .badge, .usage-state--avoid, .matrix-badge--aa { background: CanvasText; color: Canvas; }
  }
  @media (prefers-reduced-motion: no-preference) {
    summary::before { transition: none; }
    a, .card { transition: box-shadow 120ms ease; }
  }
  @media print {
    :root { --shadow-1: none; --shadow-2: none; }
    body { background: #fff; }
    nav, .skip { display: none; }
    details { border-color: #767676; }
    .card, .notice, details { break-inside: avoid; }
    main > section { margin-block: 1.5rem; }
  }
}
`;

export const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const list = (value) => Array.isArray(value) ? value : [];
// Italian copy agrees with the number printed next to it: "1 problema" but "2 problemi".
export const agree = (count, one, many) => count === 1 ? one : many;
const text = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const ratioValid = (value) => finite(value) && value >= 1 && value <= 21;
const schemeValid = (value) => value === "light" || value === "dark";
// Non-lossy turn: adding 360 to a positive hue loses low mantissa bits (86.83 → 86.82999999999998).
const hue = (value) => { const remainder = value % 360; return remainder < 0 ? remainder + 360 : (remainder === 0 ? 0 : remainder); };

function printable(value) {
  if (value === undefined || value === null) return "Non disponibile";
  if (typeof value !== "object") return String(value);
  try { return JSON.stringify(value, null, 2) ?? "Dato non valido"; }
  catch { return "Dato non serializzabile"; }
}

export function escape(value) {
  return printable(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function colorValid(color) {
  return record(color) && finite(color.l) && color.l >= 0 && color.l <= 1
    && finite(color.c) && color.c >= 0 && finite(color.h);
}

// Only validated primitive numbers may enter CSS; names, paths and snippets never do.
export function colorCss(color) {
  return colorValid(color) ? `oklch(${color.l} ${color.c} ${color.h})` : null;
}

function colorCode(color) {
  const css = colorCss(color);
  return `<code>${escape(css ?? `OKLCH non valido: ${printable(color)}`)}</code>`;
}

function provenanceValid(value) {
  return text(value) || (record(value) && Object.keys(value).length > 0);
}

// ---------------------------------------------------------------------------
// Designer provenance metadata. The analysis owns the derivation rules; this
// renderer only follows the registry it receives (source -> recipe -> public
// token -> control). It never recomputes a recipe, a surface mix or a contrast.
// ---------------------------------------------------------------------------

const DESIGN_VERSION = 1;
const MAX_EXPLORATION_FAMILIES = 24;
const EXPLORATION_TOP_GROUPS = 6;

function internalToken(value) {
  return typeof value === "string" && value.startsWith("--_");
}

function publicToken(value) {
  return text(value) && !internalToken(value);
}

function percentText(value) {
  return finite(value) ? `${it(value, 2)}%` : null;
}

function darkBlendText(source) {
  if (!record(source) || source.darkBlend === undefined || source.darkBlend === null) {
    return "Automatico per ruolo (nessun dark-blend dichiarato: non equivale a 0)";
  }
  if (!finite(source.darkBlend) || source.darkBlend < 0 || source.darkBlend > 100) {
    return "Non dichiarato o non valido";
  }
  return it(source.darkBlend, 2);
}

function darkMixText(source) {
  // The shared factory owns the bounded white-wash mapping; the report only renders it.
  const mix = record(source) && record(source.darkMix)
    ? source.darkMix
    : (record(source) && finite(source.darkBlend) ? designTools.darkBlendMix(source.darkBlend) : null);
  if (!record(mix)) {
    return record(source) && source.darkBlend !== undefined && source.darkBlend !== null
      ? "Percentuali non dichiarate"
      : "Automatico per ruolo (non = 0)";
  }
  if (text(mix.mode) && /^automatic/i.test(mix.mode) && !finite(mix.sourcePercent) && !finite(mix.whitePercent)) {
    return "Automatico per ruolo (nessun dark-blend dichiarato: non equivale a 0)";
  }
  const parts = [];
  if (text(mix.mode)) parts.push(`modo <code>${escape(mix.mode)}</code>`);
  const sourcePercent = percentText(mix.sourcePercent);
  const whitePercent = percentText(mix.whitePercent);
  if (sourcePercent) parts.push(`sorgente ${sourcePercent}`);
  if (whitePercent) parts.push(`bianco ${whitePercent}`);
  return parts.length ? parts.join(" · ") : "Dichiarata, percentuali non disponibili";
}

function recipeLabel(key, recipes) {
  if (!publicToken(key)) return "Nessuna ricetta dichiarata";
  const recipe = record(recipes) && record(recipes[key]) ? recipes[key] : null;
  const kind = recipe && text(recipe.kind) ? ` — ${escape(recipe.kind)}` : " — ricetta non dichiarata";
  return `<code>${escape(key)}</code>${kind}`;
}

function mixPercentValue(value) {
  if (!finite(value)) return null;
  // Registry metadata stores the surface source quota as a 0–1 fraction; a value
  // already expressed as a percentage (>1) is kept as declared.
  return value > 1 ? value : value * 100;
}

function controlText(control) {
  if (!record(control)) return "Predefinito";
  const parts = [];
  if (publicToken(control.override)) parts.push(`override <code>${escape(control.override)}</code>`);
  const mix = publicToken(control.mix) ? `<code>${escape(control.mix)}</code>` : percentText(control.mix);
  const defaultMix = mixPercentValue(control.defaultMix);
  if (mix) parts.push(`mix ${mix}`);
  if (defaultMix !== null) parts.push(`default ${it(defaultMix, 2)}%`);
  return parts.length ? parts.join(" · ") : "Predefinito";
}

function designSources(design) {
  return list(design.sources).filter((source) => record(source) && publicToken(source.token) && text(source.name) && text(source.role));
}

function designTokens(design) {
  return Object.entries(record(design.tokens) ? design.tokens : {})
    .filter(([token, definition]) => publicToken(token) && record(definition));
}

function sourceTokenList(source) {
  return list(source && source.sources).filter(publicToken);
}

function designHtml(design) {
  if (!record(design)) return "";
  const sources = designSources(design);
  const tokens = designTokens(design);
  const recipes = record(design.recipes) ? design.recipes : {};
  if (!sources.length && !tokens.length && !Object.keys(recipes).length) return "";
  const version = design.version === undefined ? "non dichiarata" : escape(design.version);
  const versionNote = design.version !== undefined && design.version !== DESIGN_VERSION
    ? `<p class="notice">Versione del registry design non riconosciuta (${version}): i dati sono mostrati come dichiarati, senza interpretazione.</p>`
    : "";
  const tokensForSource = (sourceToken) => tokens.filter(([, definition]) => sourceTokenList(definition).includes(sourceToken));
  const sourceRows = sources.map((source) => {
    const linked = tokensForSource(source.token).map(([token]) => `<code>${escape(token)}</code>`);
    return `<tr><th scope="row"><code>${escape(source.token)}</code></th><td>${escape(source.name)}</td><td><code>${escape(source.role)}</code></td><td>${escape(darkBlendText(source))}</td><td>${darkMixText(source)}</td><td>${linked.length ? linked.join("<br>") : "Nessun token pubblico dichiarato"}</td></tr>`;
  });
  const recipesForToken = (definition) => record(definition) && publicToken(definition.recipe) ? definition.recipe : null;
  const recipeRows = Object.entries(recipes)
    .filter(([key, recipe]) => publicToken(key) && record(recipe))
    .map(([key, recipe]) => {
      const linked = tokens.filter(([, definition]) => recipesForToken(definition) === key).map(([token]) => `<code>${escape(token)}</code>`);
      return `<tr><th scope="row"><code>${escape(key)}</code></th><td>${escape(recipe.kind ?? "non indicato")}</td><td>${escape(recipe.usage ?? "non indicato")}</td><td>${escape(recipe.basis ?? "non indicata")}</td><td>${linked.length ? linked.join("<br>") : "Nessun token pubblico dichiarato"}</td></tr>`;
    });
  const tokenRows = tokens.map(([token, definition]) => {
    // The registry helper is the single origin of the token binding: the report only
    // renders what it returns and never re-derives a recipe, a mix or a control.
    const lightTrace = designTools.describeToken(design, token, "light") ?? {};
    const darkTrace = designTools.describeToken(design, token, "dark") ?? {};
    const linkedSources = list(lightTrace.sources ?? definition.sources).filter(publicToken).map((source) => `<code>${escape(source)}</code>`);
    const recipeKey = lightTrace.recipe ?? definition.recipe;
    const recipe = record(recipes) && record(recipes[recipeKey]) ? recipes[recipeKey] : null;
    const usage = lightTrace.usage ?? definition.usage ?? (recipe ? recipe.usage : null) ?? "non indicato";
    const surfaceRule = recipeKey === "surface" || recipeKey === "surface-strong"
      ? `<br><span class="margin-note">mix ${Math.round(designTools.surfaceRatio(recipeKey, "light") * 100)}% source / ${Math.round(100 - designTools.surfaceRatio(recipeKey, "light") * 100)}% base (chiaro), ${Math.round(designTools.surfaceRatio(recipeKey, "dark") * 100)}%/${Math.round(100 - designTools.surfaceRatio(recipeKey, "dark") * 100)}% (scuro) — regola di progetto, non WCAG</span>`
      : "";
    return `<tr><th scope="row" class="design-token"><code>${escape(token)}</code></th><td>${linkedSources.length ? linkedSources.join("<br>") : "Nessuna sorgente dichiarata"}</td><td>${recipeLabel(recipeKey, recipes)}${surfaceRule}</td><td>${escape(usage)}</td><td>${controlText(lightTrace.control)}</td><td>${controlText(darkTrace.control)}</td></tr>`;
  });
  return `<section aria-labelledby="design"><h2 id="design">Sorgenti, ricette e controlli</h2>
<p class="scope-note">Questa sezione legge i metadati del registry della sessione: <strong>sorgenti e ricette sono le aspettative di partenza del generatore</strong>, non la formula certamente attiva. Il <strong>CSS misurato (baseline) resta la fonte finale</strong>: se l'output è obsoleto o un controllo full-color è attivo, la quota della ricetta non è necessariamente quella che disegna. Il report non applica override e non ricalcola contrasti.</p>
<p class="design-note margin-note">Il <code>dark-blend</code> mescola bianco (al massimo 28%), non nero; quando è omesso resta la derivazione automatica del ruolo e non equivale a 0. Le percentuali non sono una soglia WCAG. I controlli sono opzioni di personalizzazione: i valori effettivi restano quelli del CSS misurato finché un controllo non è attivo; le superfici sono espressioni runtime (mix), non letterali risolti.</p>
${versionNote}
<h3>Sorgenti della palette</h3>
${sources.length ? table("Sorgenti della palette (aspettative del generatore) e token pubblici collegati", ["Sorgente", "Nome", "Ruolo", "dark-blend", "Miscela dark", "Token pubblici"], sourceRows) : "<p>Nessuna sorgente valida dichiarata.</p>"}
<h3>Ricette di partenza del generatore</h3>
${recipeRows.length ? table("Ricette di partenza e token che le usano", ["Ricetta di partenza", "Tipo", "Uso", "Base", "Token pubblici"], recipeRows) : "<p>Nessuna ricetta valida dichiarata.</p>"}
<h3>Token pubblici e controlli</h3>
${tokenRows.length ? table("Traccia dei token pubblici misurati e dei controlli per personalizzarli", ["Token pubblico", "Sorgenti", "Ricetta di partenza", "Uso", "Controllo per personalizzare (chiaro)", "Controllo per personalizzare (scuro)"], tokenRows) : "<p>Nessun token pubblico valido dichiarato.</p>"}</section>`;
}

function sampleMeta(item) {
  if (!record(item)) return "";
  const parts = [];
  if (text(item.label)) parts.push(`Nome: ${escape(item.label)}`);
  if (!internalToken(item.foregroundToken) && text(item.foregroundToken) && !internalToken(item.backgroundToken) && text(item.backgroundToken)) {
    parts.push(`Token: <code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code>`);
  }
  if (text(item.source) && !internalToken(item.source)) parts.push(`Sorgente: <code>${escape(item.source)}</code>`);
  if (provenanceValid(item.provenance)) parts.push(`Provenienza: ${escape(item.provenance)}`);
  if (text(item.rendered) && !internalToken(item.rendered)) parts.push(`Rendered: ${escape(item.rendered)}`);
  else if (record(item.rendered)) parts.push(`Rendered: ${escape(printable(item.rendered))}`);
  return parts.length ? `<p class="sample-meta">${parts.join(" · ")}</p>` : "";
}

function expectedStatus(item) {
  return item.ratio < item.minimum ? "below-minimum" : item.ratio < item.target ? "below-target" : "pass";
}

function diagnosticValid(item) {
  return record(item) && text(item.label) && schemeValid(item.scheme)
    && text(item.foregroundToken) && text(item.backgroundToken)
    && colorValid(item.foreground) && colorValid(item.background)
    && ratioValid(item.ratio) && ratioValid(item.minimum) && ratioValid(item.target)
    && ["text", "non-text"].includes(item.kind) && item.status === expectedStatus(item)
    && (item.baselineRatio === undefined || ratioValid(item.baselineRatio));
}

export function status(item, valid = diagnosticValid(item)) {
  return valid ? STATUSES[item.status] : "Non verificato: dati mancanti, non validi o incoerenti";
}

// Human usage title for a token pair; the tokens stay visible beside it as provenance.
function pairName(item) {
  return designer.pairTitle(item.foregroundToken, item.backgroundToken);
}

// A lowercase lexicon fragment starts a table cell or a heading, not a sentence.
function capitalized(value) {
  const text = typeof value === "string" ? value : "";
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function themeText(scheme) {
  return ["light", "dark"].includes(scheme) ? capitalized(designer.themeLabel(scheme)) : "";
}

// Minimum and project target are distinct thresholds; when the project sets them equal,
// printing the same ratio twice is noise.
function thresholds(item) {
  return ratioValid(item.minimum) && ratioValid(item.target) && item.minimum === item.target
    ? `Minimo e target: ${ratio(item.minimum)}`
    : `Minimo: ${ratio(item.minimum)} · Target: ${ratio(item.target)}`;
}

function ratio(value) {
  return ratioValid(value) ? `<code>${String(value)}:1</code>` : `${escape(value)} (non valido)`;
}

function table(caption, headings, rows) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escape(caption)}"><table>
<caption>${escape(caption)}</caption><thead><tr>${headings.map((heading) => `<th scope="col">${escape(heading)}</th>`).join("")}</tr></thead>
<tbody>${rows.join("")}</tbody></table></div>`;
}

function diagnosticTable(caption, entries) {
  return table(caption, ["Coppia", "Scenario (browser / schema / preferenza)", "Uso", "Primo piano → sfondo", "Rapporto completo", "Minimo", "Target", "Baseline", "Esito", "Provenienza"], entries.map(({ item, scenario, valid }) => {
    const kind = item.kind === "text" ? "Testo" : item.kind === "non-text" ? "Non testuale (bordo)" : "Uso non valido";
    return `<tr><th scope="row">${escape(item.label)}</th><td>${escape(item.browser ?? scenario.browser)} / ${escape(item.scheme)} / ${escape(item.preference ?? scenario.preference)}</td><td>${kind}</td><td><code>${escape(item.foregroundToken)}</code> → <code>${escape(item.backgroundToken)}</code></td>
<td>${ratio(item.ratio)}</td><td>${ratio(item.minimum)}</td><td>${ratio(item.target)}</td><td>${item.baselineRatio === undefined ? "Non fornita" : ratio(item.baselineRatio)}</td>
<td>${status(item, valid ?? diagnosticValid(item))}</td><td>Scenario: ${escape(scenario.provenance)}<br>Diagnostica: ${escape(item.provenance)}</td></tr>`;
  }));
}

function colorSwatch(color, label) {
  const css = colorCss(color);
  return `<figure>${css ? `<div class="swatch" aria-hidden="true" style="--sample-color:${css}"></div>` : "<p>Campione non disponibile: colore non valido.</p>"}
<figcaption><strong>${escape(label)}</strong> — ${colorCode(color)}. Campione cromatico, non indicazione di leggibilità.</figcaption></figure>`;
}

export function colorChoice(color, label, suggested = false) {
  const css = colorCss(color);
  return `<figure class="color-choice${suggested ? " color-choice--suggested" : ""}">${css ? `<div class="swatch" aria-hidden="true" style="--sample-color:${css}"></div>` : "<p>Campione non disponibile: colore non valido.</p>"}
<figcaption><strong>${escape(label)}</strong> ${colorCode(color)}</figcaption></figure>`;
}

// Compact human reading of a metric. Full precision stays in the technical disclosures.
export function it(value, digits = 2) {
  if (!finite(value)) return "non disponibile";
  const rounded = Number(Math.abs(value).toFixed(digits));
  return `${value < 0 ? "-" : ""}${String(rounded).replace(".", ",")}`;
}

// Real-scale sample: a title (3:1), body text (4.5:1) and a small label, or borders at 1, 2 and 3 px.
export function sampleVisual(item) {
  return item.kind === "non-text"
    ? '<span class="pair-border"></span><span class="pair-border pair-border--2"></span><span class="pair-border pair-border--3"></span>'
    : '<span class="pair-title">Titolo grande</span><span class="pair-text">Corpo del testo di esempio</span><span class="pair-label">Etichetta piccola</span>';
}

function sampleScaleNote(item) {
  return item.kind === "non-text"
    ? " Scala reale: bordi a 1, 2 e 3 px."
    : " Scala reale: titolo, corpo, etichetta.";
}

function marginText(item) {
  if (!diagnosticValid(item)) return "verifica non disponibile";
  if (item.status === "below-minimum") return `sotto il minimo di ${it(item.minimum - item.ratio)}`;
  if (item.status === "below-target") return `mancano ${it(item.target - item.ratio)} al target`;
  return `oltre il target di ${it(item.ratio - item.target)}`;
}

function pairSample(item, label, valid = diagnosticValid(item)) {
  const fg = colorCss(item.foreground);
  const bg = colorCss(item.background);
  const usable = fg && bg && ["text", "non-text"].includes(item.kind);
  return `<figure>${usable ? `<div class="pair-visual" aria-hidden="true" style="--sample-fg:${fg};--sample-bg:${bg}">${sampleVisual(item)}</div>` : "<p>Campione non disponibile: coppia non valida.</p>"}
<figcaption><strong>${escape(label)}</strong>. Campione intenzionale ${item.kind === "non-text" ? "di bordo sullo sfondo" : "di testo sullo sfondo"}: può risultare illeggibile; i dati sono sulla UI neutra.${sampleScaleNote(item)}</figcaption></figure>
${sampleMeta(item)}
<dl><dt>Primo piano (foreground)</dt><dd><code>${escape(item.foregroundToken)}</code>: ${colorCode(item.foreground)}</dd>
<dt>Sfondo (background)</dt><dd><code>${escape(item.backgroundToken)}</code>: ${colorCode(item.background)}</dd>
<dt>Rapporto / minimo / target</dt><dd>${ratio(item.ratio)} / ${ratio(item.minimum)} / ${ratio(item.target)} — ${status(item, valid)}</dd></dl>`;
}

function deltaValues(before, after) {
  const radians = (color) => hue(color.h) * Math.PI / 180;
  return [
    after.l - before.l,
    after.c - before.c,
    ((hue(after.h) - hue(before.h) + 540) % 360) - 180,
    Math.hypot(after.l - before.l,
      after.c * Math.cos(radians(after)) - before.c * Math.cos(radians(before)),
      after.c * Math.sin(radians(after)) - before.c * Math.sin(radians(before))),
  ];
}

function deltas(before, after) {
  if (!colorValid(before) || !colorValid(after)) return "ΔL, ΔC, ΔH e ΔEOK non disponibili: colori non validi.";
  const values = deltaValues(before, after);
  const show = (value) => finite(value) ? String(Number(value.toPrecision(8))) : "non disponibile";
  return `ΔL ${show(values[0])}; ΔC ${show(values[1])}; ΔH ${show(values[2])}° (arco più breve); ΔEOK ${show(values[3])} (distanza euclidea OKLab, scala 0–1, non ×100).`;
}

export function deltaSummary(before, after) {
  if (!colorValid(before) || !colorValid(after)) return "";
  const [dl, dc, dh, distance] = deltaValues(before, after);
  return `ΔL ${it(dl, 4)} · ΔC ${it(dc, 4)} · ΔH ${it(dh, 3)}° · ΔEOK ${it(distance, 4)}`;
}

// Measured without the project tuning layer. The wording never blames tuning for a pre-existing shortfall.
export function baselineNote(item, group) {
  const measured = group.filter((entry) => ratioValid(entry.item.baselineRatio));
  if (!measured.length || !ratioValid(item.baselineRatio)) return "";
  const delta = item.ratio - item.baselineRatio;
  if (Math.abs(delta) <= 1e-9) return "";
  const thresholds = [item.minimum, item.target];
  const opening = item.baselineRatio >= Math.max(item.minimum, item.target)
    ? `Senza i tuning di progetto questa coppia rispettava le soglie (${compactRatio(item.baselineRatio, thresholds)});`
    : `Anche senza i tuning di progetto questa coppia non raggiungeva le soglie (${compactRatio(item.baselineRatio, thresholds)});`;
  return `<p class="baseline-note">${opening} con i tuning attivi misura ${compactRatio(item.ratio, thresholds)} (${delta < 0 ? "-" : "+"}${it(Math.abs(delta))}).</p>`;
}

function paletteHtml(palette) {
  if (!palette.length) return "<p>Palette originale non disponibile.</p>";
  return `<div class="grid">${palette.map((value) => {
    const item = record(value) ? value : {};
    const valid = text(item.name) && text(item.role) && colorValid(item.authored) && colorValid(item.resolved);
    const same = valid && item.authored.l === item.resolved.l && item.authored.c === item.resolved.c && hue(item.authored.h) === hue(item.resolved.h);
    return `<article class="card"><h3>${escape(item.name)}</h3><p>Ruolo: <code>${escape(item.role)}</code></p>
<div class="grid">${colorSwatch(item.authored, "Fonte originale")}${colorSwatch(item.resolved, "Colore risolto")}</div>
<p>${!valid ? "Confronto gamut non verificato: dati non validi." : same ? "Nessuna differenza fonte/risolto." : "Differenza fonte/risolto presente (eventuale adattamento gamut)."}</p>
<p>${deltas(item.authored, item.resolved)}</p>${item.darkBlend === undefined ? "" : `<p>Miscela dark dichiarata: <code>${escape(item.darkBlend)}</code></p>`}</article>`;
  }).join("")}</div>`;
}

function scenarioValid(scenario) {
  return record(scenario) && text(scenario.browser) && schemeValid(scenario.scheme)
    && text(scenario.preference) && provenanceValid(scenario.provenance) && Array.isArray(scenario.diagnostics);
}

export function entriesFor(scenarios) {
  return scenarios.flatMap((value, scenarioIndex) => {
    const scenario = record(value) ? value : {};
    return list(scenario.diagnostics).map((value, index) => {
      const item = record(value) ? value : {};
      return { item, scenario, scenarioIndex, key: `${scenarioIndex}-${index}`,
        valid: scenarioValid(scenario) && item.scheme === scenario.scheme && diagnosticValid(item) };
    });
  });
}

function samePair(before, after) {
  return before.item.label === after.label && before.item.scheme === after.scheme
    && before.item.kind === after.kind && before.item.foregroundToken === after.foregroundToken
    && before.item.backgroundToken === after.backgroundToken
    && (after.browser === undefined || before.scenario.browser === after.browser)
    && (after.preference === undefined || before.scenario.preference === after.preference);
}

export function proposalView(proposal, index, entries) {
  const labels = list(proposal.issueLabels);
  const checks = list(proposal.checks).map((value) => {
    const item = record(value) ? value : {};
    const matches = entries.filter((before) => before.valid && samePair(before, item));
    return { item, before: matches.length === 1 && diagnosticValid(item) ? matches[0] : null };
  });
  const expected = entries.filter((entry) => entry.valid && entry.item.status !== "pass" && labels.includes(entry.item.label));
  const paired = checks.filter((check) => check.before);
  const covered = new Set(paired.filter(({ item, before }) => item.status === "pass"
      && item.ratio >= Math.max(before.item.minimum, before.item.target)
      && labels.includes(before.item.label)).map(({ before }) => before.key));
    const rank = { pass: 0, "below-target": 1, "below-minimum": 2 };
  const changes = list(proposal.changes);
  // Every original pair needs a control, including previously passing pairs.
  const complete = checks.length > 0 && checks.length === entries.length && paired.length === checks.length
    && new Set(paired.map(({ before }) => before.key)).size === paired.length
    && paired.every(({ item, before }) => rank[expectedStatus({ ...item, minimum: before.item.minimum, target: before.item.target })] <= rank[before.item.status])
    && labels.length > 0 && labels.every((label) => text(label) && expected.some(({ item }) => item.label === label))
    && expected.every(({ key }) => covered.has(key))
    && changes.length > 0 && changes.every((change) => record(change) && text(change.label) && colorValid(change.before) && colorValid(change.after))
    && text(proposal.id) && text(proposal.title) && text(proposal.kind) && text(proposal.impact) && text(proposal.search)
    && record(proposal.destination) && text(proposal.destination.file) && text(proposal.destination.path) && text(proposal.destination.snippet);
  return { proposal, id: `proposal-${index + 1}`, checks, expected, paired, covered: complete ? covered : new Set(), complete };
}

// Group only the presentation: every original measurement remains in the audit.
// Different themes, uses, thresholds or outcomes must never share a problem card.
export function issueGroups(entries) {
  const groups = new Map();
  for (const entry of entries.filter(({ valid, item }) => valid && item.status !== "pass")) {
    const item = entry.item;
    const key = JSON.stringify([item.label, item.scheme, item.kind, item.foregroundToken, item.backgroundToken, item.minimum, item.target, item.status]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()];
}

export function compactRatio(value, thresholds = []) {
  if (!ratioValid(value)) return ratio(value);
  const rounded = Number(value.toFixed(2));
  // A compact value must not visually promote a shortfall onto its threshold.
  const crossed = thresholds.filter((threshold) => ratioValid(threshold) && value < threshold && rounded >= threshold);
  if (crossed.length) return `&lt; ${String(Math.min(...crossed)).replace(".", ",")}:1`;
  return `${rounded === value ? "" : "≈ "}${rounded.toFixed(2).replace(".", ",")}:1`;
}

function compactPair(item, label, thresholds = [item.minimum, item.target]) {
  const fg = colorCss(item.foreground), bg = colorCss(item.background);
  return `<figure><div class="pair-visual" aria-hidden="true" style="--sample-fg:${fg};--sample-bg:${bg}">${sampleVisual(item)}</div>
<figcaption><strong>${escape(label)}</strong><span class="contrast-value">${compactRatio(item.ratio, thresholds)}</span>${status(item)}</figcaption>${sampleMeta(item)}</figure>`;
}

function usageCategory(item) {
  if (item.kind === "non-text") return "boundaries";
  if (item.kind !== "text") return "other";
  if (["--color-bg", "--color-surface"].includes(item.backgroundToken)) return "neutral";
  if (/^--color-on-/.test(item.foregroundToken) || /-(?:on-solid|ink|solid-text)$/.test(item.foregroundToken)) return "fills";
  return "surfaces";
}

function usageHtml(entries, scenarios, verified) {
  const categories = [
    ["neutral", "Testi su pagina e card", "Usa le varianti per il testo sugli sfondi indicati, non il colore base solo perché sembra leggibile."],
    ["fills", "Testi su colori pieni", "Abbina il riempimento al suo on-solid o on-color previsto: il bianco non è sempre la scelta giusta."],
    ["surfaces", "Callout e controlli", "Mantieni le coppie testo/superficie della stessa famiglia e controlla anche gli stati attivi e di focus."],
    ["boundaries", "Bordi e focus", "Controllati bordi opachi e focus. Un separatore decorativo non basta come unico segnale di un controllo."],
  ];
  const rank = { pass: 0, "below-target": 1, "below-minimum": 2 };
  return `<div class="usage-grid">${categories.map(([category, title, advice]) => `<article class="card usage-card"><h3>${title}</h3>
${["light", "dark"].map((scheme) => {
    const facts = entries.filter(({ item, scenario }) => scenario.scheme === scheme && usageCategory(item) === category);
    const expected = scenarios.filter((scenario) => record(scenario) && scenario.scheme === scheme);
    const complete = verified && facts.length > 0 && facts.every(({ valid }) => valid)
      && expected.every((scenario) => facts.some((entry) => entry.scenario === scenario));
    const pairs = new Map();
    for (const { item } of facts.filter(({ valid }) => valid)) {
      const key = JSON.stringify([item.foregroundToken, item.backgroundToken, item.kind, item.minimum, item.target]);
      if (!pairs.has(key) || rank[item.status] > rank[pairs.get(key)]) pairs.set(key, item.status);
    }
    const counts = [...pairs.values()];
    const avoid = counts.filter((status) => status === "below-minimum").length;
    const attention = counts.filter((status) => status === "below-target").length;
    const state = !complete ? "unknown" : avoid ? "avoid" : attention ? "attention" : "pass";
    const label = !complete ? "Non verificato" : avoid ? `Da evitare: ${avoid}` : attention ? `Da migliorare: ${attention}` : "OK nelle coppie controllate";
    return `<p><strong>${capitalized(designer.themeLabel(scheme))}</strong><span class="usage-state usage-state--${state}">${label}</span>${complete ? `<span class="usage-count">${pairs.size} abbinamenti · ${avoid} sotto minimo · ${attention} sotto target</span>` : ""}</p>`;
  }).join("")}
<p>${advice}</p></article>`).join("")}</div>`;
}

export function overlapView(overlaps, scenarios, verified) {
  const sources = list(overlaps);
  const entries = entriesFor(sources);
  const identity = (scenario) => JSON.stringify([scenario.browser, scenario.scheme, scenario.preference]);
  const pair = (item) => JSON.stringify([item.foregroundToken, item.backgroundToken].sort());
  const expected = scenarios.filter(record).map(identity);
  const identities = sources.filter(record).map(identity);
  const firstPairs = entries.filter(({ scenarioIndex }) => scenarioIndex === 0).map(({ item }) => pair(item));
  const complete = verified && expected.length > 0 && sources.length === expected.length
    && new Set(expected).size === expected.length && new Set(identities).size === expected.length
    && identities.every((key) => expected.includes(key)) && firstPairs.length > 0 && new Set(firstPairs).size === firstPairs.length
    && entries.length > 0 && entries.every(({ item, scenario, valid }) => valid
      && scenario.provenance === "browser-resolved-overlap" && item.provenance === scenario.provenance
      && item.browser === scenario.browser && item.preference === scenario.preference
      && item.kind === "text" && item.minimum === 4.5 && item.target === 4.5 && item.foregroundToken !== item.backgroundToken)
    && sources.every((_, index) => {
      const keys = entries.filter(({ scenarioIndex }) => scenarioIndex === index).map(({ item }) => pair(item));
      return keys.length === firstPairs.length && new Set(keys).size === keys.length && keys.every((key) => firstPairs.includes(key));
    });
  const groups = new Map();
  if (complete) for (const entry of entries) {
    const key = JSON.stringify([entry.item.scheme, pair(entry.item)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return { complete, sources, entries, groups: [...groups.values()] };
}

export function overlapList(items, thresholds) {
  if (!items.length) return "<p>Nessuno.</p>";
  return `<ul class="pair-list">${items.map(({ item }) => {
    const foreground = colorCss(item.foreground), background = colorCss(item.background);
    if (!foreground || !background) return "";
    return `<li><span class="pair-chip" aria-hidden="true" style="--sample-fg:${foreground};--sample-bg:${background}">Aa</span> <code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code> <span class="contrast-value">${compactRatio(item.ratio, thresholds)}</span></li>`;
  }).join("")}</ul>`;
}

function overlapsHtml(view) {
  if (!view.complete) return '<p class="usage-state">Sovrapposizioni libere non verificate: nessuna conclusione sui colori non misurati.</p>';
  const neutrals = ["--color-bg", "--color-surface"];
  const baseColors = [...new Set(view.entries.flatMap(({ item }) => [item.foregroundToken, item.backgroundToken])
    .filter((token) => !neutrals.includes(token)))].sort();
  const measured = new Map();
  for (const { item } of view.entries) {
    const key = `${item.scheme}|${[item.foregroundToken, item.backgroundToken].sort().join("|")}`;
    const current = measured.get(key);
    if (!current || item.ratio < current.ratio) measured.set(key, item);
  }
  const lookup = (scheme, first, second) => measured.get(`${scheme}|${[first, second].sort().join("|")}`);
  const cell = (scheme, foreground, background) => {
    if (foreground === background) return "<td>—</td>";
    const item = lookup(scheme, foreground, background);
    if (!item) return "<td>Non misurato</td>";
    const tier = item.ratio >= 4.5 ? "aa" : item.ratio >= 3 ? "ui" : "no";
    const label = tier === "aa" ? "AA" : tier === "ui" ? "3:1" : "no";
    return `<td><span class="matrix-badge matrix-badge--${tier}">${label}</span> <span class="matrix-ratio">${compactRatio(item.ratio, [4.5, 3])}</span></td>`;
  };
  // Symmetric crossings only: a cell never invents a measurement that the snapshot does not contain.
  // A theme without measurements gets no matrix at all instead of a grid of empty cells.
  const themes = ["light", "dark"].filter((scheme) => view.entries.some(({ item }) => item.scheme === scheme));
  const matrix = (scheme) => {
    const columns = [...neutrals, ...baseColors];
    const themeLabel = designer.themeLabel(scheme);
    return `<div class="overlap-matrix">${table(`Matrice sovrapposizioni — tema ${themeLabel}`, ["Primo piano ↓ / sfondo →", ...columns.map((token) => token.replace("--color-", ""))], baseColors.map((foreground) => `<tr><th scope="row"><code>${escape(foreground)}</code></th>${columns.map((background) => cell(scheme, foreground, background)).join("")}</tr>`))}</div>`;
  };
  return `<p>Simulazioni sui colori opachi risolti dal browser, <strong>non problemi già presenti nei componenti</strong>. Il confronto include colori base su pagina/card e colori base tra loro; non include trasparenze o immagini.</p>
<div class="grid">${["light", "dark"].map((scheme) => {
    const groups = view.groups.filter((group) => group[0].item.scheme === scheme);
    if (!groups.length) return `<p>${capitalized(designer.themeLabel(scheme))}: non verificato.</p>`;
    const ranked = groups.map((group) => group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst))
      .sort((a, b) => b.item.ratio - a.item.ratio);
    const textSafe = ranked.filter(({ item }) => item.ratio >= 4.5);
    const largeOnly = ranked.filter(({ item }) => item.ratio >= 3 && item.ratio < 4.5);
    const avoid = ranked.filter(({ item }) => item.ratio < 3);
    const worst = ranked[ranked.length - 1];
    return `<article class="card overlap-card"><h4>Tema ${designer.themeLabel(scheme)}</h4>
<p><strong>${textSafe.length}</strong> abbinamenti utilizzabili per testo normale · <strong>${largeOnly.length}</strong> solo per titoli grandi, bordi o icone · <strong>${avoid.length}</strong> da evitare.</p>
<h5>Usabili per testo normale (almeno 4,5:1)</h5>
${overlapList(textSafe, [4.5])}
<h5>Solo per titoli grandi, bordi e icone (almeno 3:1)</h5>
${overlapList(largeOnly, [3])}
<p>Esempio da evitare per il testo: <code>${escape(worst.item.foregroundToken)}</code> su <code>${escape(worst.item.backgroundToken)}</code>.</p>
${compactPair(worst.item, "Esempio da valutare, non un uso consigliato", [3, 4.5])}
<p class="margin-note">Non usare il solo colore per distinguere stati o significati. Le soglie restano distinte: 4,5:1 per il testo normale, 3:1 per titoli grandi, bordi e icone essenziali.</p></article>`;
  }).join("")}</div>
<p><strong>Scelta pratica:</strong> per sovrapporre testo, preferisci le coppie semantiche controllate qui sopra. Cambiare sfondo, opacità o stato richiede una nuova verifica della coppia.</p>
<details><summary>Tutte le sovrapposizioni esplorative — ${view.groups.length} abbinamenti nei temi controllati</summary>
<p>Il rapporto tra due colori opachi è uguale invertendo primo piano e sfondo. Ogni coppia di colori base compare una sola volta per tema con il caso peggiore fra gli scenari, e la colonna dello scenario indica quale misura l’ha prodotto; gli altri scenari non vengono duplicati qui.</p>
${baseColors.length && themes.length ? `<p class="margin-note">Righe: colore in primo piano. Colonne: sfondo. <span class="matrix-badge matrix-badge--aa">AA</span> usabile per testo normale (almeno 4,5:1); <span class="matrix-badge">3:1</span> solo titoli grandi, bordi e icone (almeno 3:1); <span class="matrix-badge matrix-badge--no">no</span> da evitare.</p>${themes.map(matrix).join("")}` : ""}
${themes.map((scheme) => {
    const groups = view.groups.filter((group) => group[0].item.scheme === scheme);
    if (!groups.length) return "";
    const name = designer.themeLabel(scheme);
    const rows = groups.map((group) => group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst));
    return `<h4>Tema ${name} — ${rows.length} abbinamenti</h4>${diagnosticTable(`Sovrapposizioni esplorative — tema ${name}`, rows)}`;
  }).join("")}</details>`;
}

// Data half of the family atlas: the measured families and the worst measurement per pair.
// The compact preview reads the same structure so both artifacts agree on what was measured.
export function familyAtlasData(entries) {
  const valid = entries.filter(({ valid }) => valid);
  const names = [...new Set([
    ...valid.map(({ item }) => /^--color-(.+)-text$/.exec(item.foregroundToken)?.[1]).filter((name) => name && !name.endsWith("-solid")),
    ...valid.map(({ item }) => /^--color-(.+)-ink$/.exec(item.foregroundToken)?.[1]),
    ...valid.map(({ item }) => /^--color-on-(.+)$/.exec(item.foregroundToken)?.[1]),
  ].filter(Boolean))];
  const worst = new Map();
  for (const { item } of valid) {
    const key = `${item.scheme}|${item.kind}|${item.foregroundToken}|${item.backgroundToken}`;
    const current = worst.get(key);
    if (!current || item.ratio < current.ratio) worst.set(key, item);
  }
  return { names, find: (scheme, kind, foreground, background) => worst.get(`${scheme}|${kind}|${foreground}|${background}`) };
}

// Visual catalog of the generated families: only pairs that were actually measured,
// each shown with its worst measurement across browser/preference scenarios. With
// `options.model` the same catalog renders the browser-free model samples instead.
function familyAtlas(entries, verified, options = {}) {
  const { names, find } = familyAtlasData(entries);
  if (!names.length) return "";
  const meta = (item) => item && diagnosticValid(item)
    ? `<li><code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code>: <span class="contrast-value">${compactRatio(item.ratio, [item.minimum, item.target])}</span> ${escape(status(item))} (${escape(marginText(item))})</li>` : "";
  const sample = (title, item, extra = [], border = null) => {
    const foreground = item ? colorCss(item.foreground) : null;
    const background = item ? colorCss(item.background) : null;
    if (!foreground || !background) return "";
    const borderColor = border ? colorCss(border.foreground) : null;
    return `<div class="family-sample">
<div class="family-visual" aria-hidden="true" style="--sample-fg:${foreground};--sample-bg:${background}${borderColor ? `;--sample-border:${borderColor}` : ""}"><span class="pair-text">Aa · Testo di esempio</span></div>
<p class="family-title">${escape(title)}</p>${sampleMeta(item)}
<ul>${meta(item)}${extra.map(meta).join("")}</ul>
</div>`;
  };
  const theme = (scheme, name) => {
    const card = find(scheme, "text", `--color-${name}-text`, `--color-${name}-surface`);
    const border = find(scheme, "non-text", `--color-${name}-border-strong`, `--color-${name}-surface`);
    const button = find(scheme, "text", `--color-${name}-solid-text`, `--color-${name}-solid`);
    const hover = find(scheme, "text", `--color-${name}-solid-text`, `--color-${name}-solid-hover`);
    const direct = find(scheme, "text", `--color-${name}-ink`, `--color-${name}`);
    return [
      card ? sample("Testo su callout", card, border ? [border] : [], border) : "",
      button ? sample("Bottone", button, hover ? [hover] : []) : "",
      direct ? sample("Chip o badge", direct) : "",
    ].join("");
  };
  const cards = names.map((name) => {
    const light = theme("light", name), dark = theme("dark", name);
    if (!light && !dark) return "";
    return `<article class="card family-card"><h4>Famiglia <code>--color-${escape(name)}</code></h4>
${light ? `<p class="eyebrow">Tema ${designer.themeLabel("light")}</p><div class="family-list">${light}</div>` : ""}
${dark ? `<p class="eyebrow">Tema ${designer.themeLabel("dark")}</p><div class="family-list">${dark}</div>` : ""}</article>`;
  }).join("");
  if (!cards) return "";
  const note = options.model
    ? "Campioni calcolati dal modello del generatore, non da misure browser: ogni valore è una previsione e nessun campione riceve un badge di verifica. I rapporti esatti e gli esiti restano nel dettaglio del campione."
    : `Solo coppie misurate negli scenari${verified ? "" : "; verifica incompleta: il quadro può essere parziale"}. Per ogni abbinamento è mostrato il caso peggiore fra browser e preferenze; i rapporti esatti restano nei dettagli tecnici.`;
  return `<div class="grid">${cards}</div>
<p class="margin-note">${note}</p>`;
}

// Model atlas: the same family catalog rendered from the browser-free model samples,
// so the preview and the report stay useful without Playwright or a local run.
function modelAtlasHtml(samples) {
  const entries = entriesFor(list(samples));
  if (!familyAtlasData(entries).names.length) return "";
  return familyAtlas(entries, false, { model: true });
}

// A functional variant normally shifts away from its brand source; only large shifts are reported,
// using the same ΔL threshold the generator historically used before that check was removed.
export const VARIANT_SHIFT_THRESHOLD = 0.04;

export function variantShiftView(entries, palette, roles) {
  const identities = list(roles?.identities).filter((item) => record(item) && text(item.name) && text(item.paletteName));
  if (!identities.length) return null;
  const sources = new Map(list(palette).filter((item) => record(item) && text(item.name) && colorValid(item.resolved)).map((item) => [item.name, item.resolved]));
  const worst = new Map();
  for (const { valid, item } of entries) {
    if (!valid || !colorValid(item.foreground)) continue;
    const identity = identities.find((entry) => item.foregroundToken === `--color-${entry.name}-text` || item.foregroundToken === `--color-${entry.name}-border-strong`);
    if (!identity || !["--color-bg", "--color-surface"].includes(item.backgroundToken)) continue;
    const source = sources.get(identity.paletteName);
    if (!colorValid(source)) continue;
    const variant = item.foregroundToken === `--color-${identity.name}-text` ? "text" : "border-strong";
    const shift = { name: identity.name, variant, scheme: item.scheme, token: item.foregroundToken, sourceToken: identity.paletteName,
      source, variantColor: item.foreground, deltaL: item.foreground.l - source.l, deltaC: item.foreground.c - source.c };
    const key = `${shift.scheme}|${shift.name}|${shift.variant}`;
    const current = worst.get(key);
    if (!current || Math.abs(shift.deltaL) > Math.abs(current.deltaL)) worst.set(key, shift);
  }
  // No comparison was possible (unknown sources or no measured variant): stay silent rather than implying a clean result.
  if (!worst.size) return null;
  const shifts = [...worst.values()].filter((shift) => Math.abs(shift.deltaL) >= VARIANT_SHIFT_THRESHOLD || Math.abs(shift.deltaC) >= VARIANT_SHIFT_THRESHOLD)
    .sort((a, b) => Math.abs(b.deltaL) - Math.abs(a.deltaL));
  return shifts;
}

function variantShiftsHtml(shifts) {
  if (shifts === null) return "";
  if (!shifts.length) return `<h3>Varianti vicine al colore di marca</h3><p>Nessuna variante <code>*-text</code> o <code>*-border-strong</code> si allontana oltre la soglia (|ΔL| o |ΔC| ≥ ${it(VARIANT_SHIFT_THRESHOLD)}): le varianti funzionali restano vicine alla sorgente.</p>`;
  const significant = shifts.filter((shift) => Math.abs(shift.deltaL) >= 0.25);
  const minor = shifts.length - significant.length;
  return `<h3>Varianti che si allontanano dal colore di marca</h3>
<p>Un testo o un bordo molto più chiaro o scuro della sorgente non è più “quel” colore. ${shifts.length} ${shifts.length === 1 ? "variante supera" : "varianti superano"} la soglia (|ΔL| o |ΔC| ≥ ${it(VARIANT_SHIFT_THRESHOLD)}), dalla più divergente: le voci sono ordinate per scostamento.</p>
<ul class="variant-list">${shifts.map((shift) => {
    const source = colorCss(shift.source), variant = colorCss(shift.variantColor);
    if (!source || !variant) return "";
    // A chroma-only shift has ΔL = 0: the sentence must not claim a lightness direction it lacks.
    const direction = shift.deltaL < 0 ? "più scura" : shift.deltaL > 0 ? "più chiara" : "di pari lightness";
    return `<li><span class="variant-swatch" aria-hidden="true" style="--sample-color:${variant}"></span><code>${escape(shift.token)}</code> (tema ${designer.themeLabel(shift.scheme)}) rispetto a <code>${escape(shift.sourceToken)}</code>: ΔL ${it(shift.deltaL, 3)} · ΔC ${it(shift.deltaC, 3)} — la variante è ${direction} della sorgente.</li>`;
  }).join("")}</ul>
<h4>Come intervenire su palette.css</h4>
<p>Questi sono gli scostamenti che nascono dalle scelte di sorgente, non da errori di contrasto. Sono indicazioni da valutare, <strong>non verifiche</strong>: dopo ogni modifica rigenera il report per confermare le coppie.</p>
<ul class="palette-suggestions">${significant.map((shift) => {
    const sourceCode = colorCode(shift.source), variantCode = colorCode(shift.variantColor);
    const action = `La distanza è ampia: se la sorgente serve come riempimento o come accento grafico, valuta <code>role: decorative</code> e assegna testo e bordi a un’identità più vicina; se invece vuoi che il testo assomigli di più alla sorgente, avvicina la lightness di <code>${escape(shift.sourceToken)}</code> a quella della variante.`;
    return `<li><span class="palette-swatch" aria-hidden="true" style="--sample-color:${colorCss(shift.variantColor)}"></span><code>${escape(shift.sourceToken)}</code> (tema ${designer.themeLabel(shift.scheme)}): sorgente ${sourceCode}, variante <code>${escape(shift.token)}</code> ${variantCode}.<span class="palette-actions">${action} Ogni modifica a palette.css cambia surface, bordi e solid della stessa identità in entrambi i temi.</span></li>`;
  }).join("")}${minor ? `<li class="margin-note">Altre ${minor} ${minor === 1 ? "variante" : "varianti"} restano oltre la soglia con uno scostamento contenuto: nessuna azione necessaria se l’uso previsto è quello misurato.</li>` : ""}</ul>`;
}

// Verified corrections grouped by the file the designer has to touch, palette first:
// palette.css is the single source of the initial choices.
export function fileRole(file) {
  if (/palette\.css$/i.test(file)) return "Fonte iniziale delle scelte del designer: qui si cambiano i colori di marca.";
  if (/colors-tuning\.css$/i.test(file)) return "Regolazioni a runtime: sovrascrivono i --color-tune-* senza toccare palette.css.";
  if (/smart-colors\.config\.mjs$/i.test(file)) return "Definizioni strutturali di build (derivazioni e companion): la build rigenera i token derivati.";
  return "File di destinazione della modifica.";
}

// Build-time and runtime are different homes for the same knob: colors-tuning.css only
// overrides --color-tune-* at runtime, while the generator keeps the derived text tokens
// computed for the configured value. Invalid values are omitted, never replaced by a guess.
function structuralHtml(proposal) {
  const key = text(proposal.configKey) ? proposal.configKey : null;
  if (!key) return "";
  if (proposal.kind === "tuning") {
    const value = finite(proposal.configValue) ? ` = ${it(proposal.configValue, 4)}` : "";
    const restore = proposal.restoresConfig === true
      ? " Il valore proposto coincide già con quello in <code>smart-colors.config.mjs</code>: allineare o rimuovere l’override lo ripristina."
      : proposal.restoresConfig === false
        ? ` L’alternativa strutturale è cambiare <code>${escape(key)}</code> in <code>smart-colors.config.mjs</code>.`
        : "";
    return `<p class="margin-note">Il valore di build vive in <code>smart-colors.config.mjs</code> (<code>${escape(key)}${value}</code>), ma <code>colors-tuning.css</code> sovrascrive <code>--color-tune-*</code> solo a runtime: i token di testo derivati (<code>--color-text-muted</code>, <code>--color-*-text</code>) restano quelli calcolati per il valore configurato.${restore}</p>`;
  }
  if (proposal.kind === "config") {
    if (!finite(proposal.promotedValue)) return "";
    const token = text(proposal.configToken) ? ` <code>${escape(proposal.configToken)}</code>` : "";
    return `<p class="margin-note">Definizione strutturale in <code>smart-colors.config.mjs</code>: <code>${escape(key)} = ${it(proposal.promotedValue, 4)}</code>. La build rigenera i token di testo derivati (<code>--color-text-muted</code>, <code>--color-*-text</code>). La dichiarazione${token} in <code>colors-tuning.css</code> diventa ridondante: va rimossa o allineata.</p>`;
  }
  return "";
}

// Rejected candidates are informational only: no positive verdict and no new suggestion.
function rejectedSourcesHtml(value) {
  const sources = list(value);
  if (!sources.length) return "";
  return `<div class="side-effect"><p><strong>Nessuna alternativa verificata in palette.css</strong></p>
<p>Per questi problemi non esiste un’alternativa verificata in palette.css. Candidati scartati:</p>
<ul>${sources.map((source) => `<li><code>${escape(source.id)}</code> — ${escape(source.reason)}</li>`).join("")}</ul></div>`;
}

function proposalsHtml(proposals, variantShifts, rejectedSources) {
  const rejected = rejectedSourcesHtml(rejectedSources);
  if (!proposals.length) {
    const hint = variantShifts === null ? ""
      : variantShifts.length ? " Le varianti da rivedere sono elencate in «Colpo d’occhio sugli usi», con le modifiche da valutare su palette.css."
      : "";
    return `<p>Nessuna proposta verificata disponibile.${hint}</p>${rejected}`;
  }
  const order = ["palette", "tuning", "config"];
  const key = (file) => /palette\.css$/i.test(file) ? "palette" : /colors-tuning\.css$/i.test(file) ? "tuning" : "config";
  const titles = { palette: "Modifiche in palette.css", tuning: "Modifiche in colors-tuning.css", config: "Modifiche in smart-colors.config.mjs" };
  return order.map((bucket) => {
    const items = proposals.filter((view) => key(record(view.proposal.destination) ? view.proposal.destination.file : "") === bucket);
    if (!items.length) return "";
    const file = items[0].proposal.destination.file;
    const pointer = bucket === "palette" ? "" : ` <a href="#usi">Varianti e usi</a> rimandano alla fonte delle scelte.`;
    return `<div class="card file-group"><h3>${titles[bucket]}</h3><p class="margin-note"><code>${escape(file)}</code> — ${escape(fileRole(file))}${pointer}</p>${items.map(proposalHtml).join("")}</div>`;
  }).join("") + rejected;
}

function problemsHtml(groups, proposals, verified) {
  if (!groups.length) return `<p>${verified ? "Nessun problema nelle coppie misurate." : "Riepilogo non disponibile: verifica incompleta. Consulta gli errori nei dettagli tecnici."}</p>`;
  return groups.map((group) => {
    const before = group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst);
    const { item } = before;
    const view = proposals.find((view) => view.complete && group.every((entry) => view.covered.has(entry.key)));
    const after = view?.paired.find((check) => check.before.key === before.key)?.item;
    const context = (entry) => `${escape(entry.scenario.browser)} / ${escape(entry.scenario.scheme)} / ${escape(entry.scenario.preference)}`;
    const ratios = group.map(({ item }) => item.ratio);
    const title = pairName(item);
    return `<article class="card problem-card"><p class="eyebrow">Tema ${designer.themeLabel(item.scheme)} · ${item.kind === "text" ? "Testo" : "Non testuale (bordo)"}</p>
<h3>${escape(title)}</h3><p class="margin-note">${escape(item.label)}</p><p><code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code></p>
<p>${item.status === "below-minimum" ? "Il contrasto è sotto il minimo richiesto." : "Il minimo è rispettato; manca il target di progetto."} ${thresholds(item)}.</p>
${baselineNote(item, group)}
<div class="comparison">${compactPair(item, "Attuale")}${after ? compactPair(after, "Con la correzione") : '<div><p class="status">Nessuna proposta verificata per questa coppia.</p><p>Il report non suggerisce un colore senza una verifica completa.</p></div>'}</div>
${view ? `<p><a href="#${view.id}">Usa la correzione ${proposals.indexOf(view) + 1}</a>. ${group.length} ${group.length === 1 ? "misura coperta" : "misure coperte"}.</p>` : ""}
<p>${group.length} ${group.length === 1 ? "misura" : "misure raggruppate"}. Scenario col contrasto più basso: ${context(before)}.</p>
<details><summary>Valori esatti e differenze tra gli scenari</summary>
<p>Coppia: ${escape(item.label)}. Intervallo attuale: ${ratio(Math.min(...ratios))} – ${ratio(Math.max(...ratios))}. Ogni misura e ogni colore sono conservati separatamente.</p>
${table("Misure del problema", ["Scenario", "Primo piano", "Sfondo", "Rapporto completo", "Minimo", "Target", "Esito"], group.map((entry) => `<tr><th scope="row">${context(entry)}</th><td>${colorCode(entry.item.foreground)}</td><td>${colorCode(entry.item.background)}</td><td>${ratio(entry.item.ratio)}</td><td>${ratio(entry.item.minimum)}</td><td>${ratio(entry.item.target)}</td><td>${status(entry.item)}</td></tr>`))}
</details></article>`;
  }).join("");
}

// One visual card per distinct measured pair: repeated browser/preference measurements stay counted.
function dedupeChecks(checks) {
  const groups = new Map();
  for (const check of checks) {
    const item = check.item;
    const key = JSON.stringify([item.label, item.scheme, item.kind, item.foregroundToken, item.backgroundToken, item.foreground, item.background, item.minimum, item.target, item.status]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(check);
  }
  return [...groups.values()];
}

// Public one-liner per proposal kind. Knob wording stays specific only when it is exactly true:
// a dark knob must never be described as a light-surface adjustment.
export function proposalSentence(proposal) {
  const destination = record(proposal.destination) ? proposal.destination : {};
  const path = text(destination.path) ? destination.path : "";
  if (proposal.kind === "tuning") {
    if (path === "--color-tune-surface-lightness-shift") return "Regola la superficie del tema chiaro senza cambiare la palette di partenza.";
    if (/^--color-tune-dark-/.test(path)) return "Regola il tema scuro senza cambiare la palette di partenza.";
    if (/^--color-tune-/.test(path)) return "Regola una manopola di tuning senza cambiare la palette di partenza.";
    return "Regola una manopola di tuning senza cambiare la palette di partenza.";
  }
  if (proposal.kind === "foreground") return "Cambia il testo sul riempimento indicato, mantenendo il colore di sfondo.";
  return text(proposal.impact) ? proposal.impact : "Modifica locale della palette di partenza.";
}

// Informational only: these measurements never enter the proposal verification or its outcome.
export function sideEffectsHtml(value) {
  const declared = list(value);
  if (!declared.length) return "";
  const entries = declared.filter((item) => {
    const entry = record(item) ? item : {};
    return text(entry.label) && schemeValid(entry.scheme) && text(entry.foregroundToken) && text(entry.backgroundToken)
      && record(entry.before) && colorValid(entry.before.color) && ratioValid(entry.before.ratio)
      && record(entry.after) && colorValid(entry.after.color) && ratioValid(entry.after.ratio);
  });
  if (!entries.length) return '<div class="side-effect"><p class="status">Effetto collaterale dichiarato ma non misurabile: nessun dato valido.</p></div>';
  return `<div class="side-effect"><p><strong>Altro effetto della stessa modifica</strong></p><ul>${entries.map((entry) => {
    const direction = entry.after.ratio > entry.before.ratio ? "in aumento" : entry.after.ratio < entry.before.ratio ? "in calo" : "invariato";
    const warning = entry.after.ratio < 3 ? " Resta sotto il riferimento 3:1 per bordi e icone necessari: valuta un bordo dedicato." : "";
    return `<li><code>${escape(entry.foregroundToken)}</code> su <code>${escape(entry.backgroundToken)}</code> (tema ${entry.scheme === "light" ? "chiaro" : "scuro"}): da <span class="contrast-value">${compactRatio(entry.before.ratio, [3])}</span> a <span class="contrast-value">${compactRatio(entry.after.ratio, [3])}</span> — ${direction}.${warning}</li>`;
  }).join("")}</ul><p class="margin-note">Misura informativa: questo bordo non fa parte delle coppie verificate e non decide l’esito della proposta.</p></div>`;
}

function proposalHtml(view, index) {
  const { proposal, id, checks, expected, paired, complete } = view;
  const destination = record(proposal.destination) ? proposal.destination : {};
  const valid = checks.filter(({ item }) => diagnosticValid(item));
  const minimumFor = (kind) => {
    const values = valid.filter(({ item }) => (item.kind === "non-text" ? "non-text" : "text") === kind).map(({ item }) => item.ratio);
    return values.length ? values.reduce((a, b) => Math.min(a, b)) : null;
  };
  const textMinimum = minimumFor("text"), uiMinimum = minimumFor("non-text");
  const completeness = checks.length && valid.length === checks.length ? "insieme completo" : "validi disponibili (insieme incompleto)";
  const issues = dedupeChecks(checks.filter(({ item }) => list(proposal.issueLabels).includes(item.label)));
  // Unchanged rows stay counted, not reprinted: their values are already measured in the scenarios section.
  const controlRows = checks.map(({ item, before }) => ({ item, scenario: before?.scenario ?? {}, original: before?.item ?? null }));
  const changedRows = controlRows.filter((row) => !row.original || row.item.ratio !== row.original.ratio || row.item.status !== row.original.status);
  const unchangedCount = controlRows.length - changedRows.length;
  const context = (scenario) => `${escape(scenario.browser)} / ${escape(scenario.scheme)} / ${escape(scenario.preference)}`;
  const where = ({ item, before }) => before ? context(before.scenario) : `${escape(item.browser ?? "browser non indicato")} / ${escape(item.scheme)} / ${escape(item.preference ?? "preferenza non indicata")}`;
  return `<article class="card${complete ? " recommendation" : ""}" id="${id}"><h3>Correzione ${index + 1} · ${escape(proposal.title)}</h3>
<p><span class="badge">${complete ? "Verificata nello snapshot" : "Verifica incompleta: nessuna copertura attribuita"}</span></p>
<p>${escape(proposal.kind === "tuning" || proposal.kind === "foreground" ? proposalSentence(proposal)
    : proposal.impact)}</p>
${structuralHtml(proposal)}
${list(proposal.changes).map((value) => {
    const change = record(value) ? value : {};
    const summary = deltaSummary(change.before, change.after);
    return `<div class="color-change"><p><strong>Colore che cambia:</strong> <code>${escape(change.label)}</code></p>
<div class="comparison">${colorChoice(change.before, "Attuale")}${colorChoice(change.after, complete ? "Suggerito" : "Dopo (non verificato)", complete)}</div>
<p class="margin-note">${summary ? `${summary}. Variazioni OKLCH e distanza percettiva 0–1: non sono misure di contrasto.` : "Differenze non disponibili: colore non valido."}</p></div>`;
  }).join("")}
${sideEffectsHtml(proposal.sideEffects)}
<p class="snippet-label">Modifica da applicare manualmente</p>
<dl class="destination"><div><dt>File</dt><dd><code>${escape(destination.file)}</code></dd></div><div><dt>Percorso nella configurazione</dt><dd><code>${escape(destination.path)}</code></dd></div></dl>
<pre tabindex="0" role="group" aria-label="Snippet della proposta"><code>${escape(destination.snippet)}</code></pre>
<p>Applicazione manuale: il report non modifica file. Dopo la modifica, rigenera il report per confermare il risultato.</p>
<details><summary>Verifica e misure complete della correzione</summary>
<p class="status">${complete ? "Proposta verificata per le coppie coperte nello snapshot" : "Verifica incompleta: nessuna copertura attribuita"}.</p>
<p>ID: <code>${escape(proposal.id)}</code> · Tipo: ${escape(proposal.kind)}</p><p>Impatto dichiarato: ${escape(proposal.impact)}</p>
<p>Ambito della ricerca: ${escape(proposal.search)}. Nessuna garanzia di palette ottimale o di soluzione più vicina globale.</p>
<p>Coppie complete: ${paired.length}/${checks.length}; issue coperte: ${view.covered.size}/${expected.length}.
Rapporto minimo del testo: ${textMinimum === null ? "non disponibile" : ratio(textMinimum)} · minimo UI/bordi: ${uiMinimum === null ? "non disponibile" : ratio(uiMinimum)} (${completeness}).</p>
<div class="grid">${issues.map((group) => {
      const { item, before } = group[0];
      return `<div class="card"><p><strong>${escape(item.label)}</strong></p>
${before ? `<p>Scenario: ${where(group[0])}${group.length > 1 ? ` — ${group.length} misure identiche in scenari diversi: ${group.map((entry) => where(entry)).join(", ")}` : ""}</p><div class="grid"><div><p><strong>Prima — snapshot originale</strong></p>${pairSample(before.item, "Prima")}</div><div><p><strong>Dopo — proposta</strong></p>${pairSample(item, "Dopo")}</div></div>
<p>Provenienza prima: ${escape(before.scenario.provenance)}; diagnostica: ${escape(before.item.provenance)}. Provenienza dopo: ${escape(item.provenance)} (se assente, non dedotta).</p>` : "<p>Prima/dopo non verificato: coppia originale assente, ambigua o controllo non valido. Nessun campione precedente inventato.</p>"}</div>`;
    }).join("")}</div>
${checks.length ? `<details><summary>Controlli cambiati dalla proposta — ${changedRows.length} di ${controlRows.length}</summary>
${changedRows.length ? diagnosticTable("Controlli cambiati dalla proposta", changedRows) : "<p>Nessuna coppia ha cambiato rapporto o esito: la proposta non altera i valori misurati.</p>"}
<p>Altri ${unchangedCount} controlli invariati: rapporto identico al valore già misurato negli scenari (nessuna regressione). Vedi <a href="#scenari">Scenari, misure e issue</a>.</p></details>` : "<p>Nessun controllo disponibile.</p>"}
<details><summary>Modifiche cromatiche e differenze numeriche</summary>
${table("Variazioni proposte", ["Colore", "Prima", "Dopo", "Differenze"], list(proposal.changes).map((value) => {
    const change = record(value) ? value : {};
    return `<tr><th scope="row">${escape(change.label)}</th><td>${colorCode(change.before)}</td><td>${colorCode(change.after)}</td><td>${deltas(change.before, change.after)}</td></tr>`;
  }))}<p>ΔH è nominale e non significativo per colori acromatici; ΔEOK non è una misura di contrasto.</p></details>
</details></article>`;
}

function scenariosHtml(scenarios, entries, proposals) {
  if (!scenarios.length) return "<p>Nessuno scenario disponibile: esito non verificato.</p>";
  return scenarios.map((value, index) => {
    const scenario = record(value) ? value : {};
    const facts = entries.filter((entry) => entry.scenarioIndex === index);
    const issues = facts.filter(({ valid, item }) => !valid || item.status !== "pass");
    return `<article class="card"><h3>${escape(scenario.browser)} · ${escape(scenario.scheme)} · ${escape(scenario.preference)}</h3>
<p>Browser: ${escape(scenario.browser)}; schema: ${escape(scenario.scheme)}; preferenza: ${escape(scenario.preference)}.</p>
<p>Provenienza dello scenario: <code>${escape(scenario.provenance)}</code>.</p>
${!scenarioValid(scenario) ? "<p>Scenario non valido: esito non verificato.</p>" : ""}
${facts.length ? `<details><summary>Dati completi: ${facts.length} coppie misurate nello scenario</summary>${diagnosticTable("Coppie misurate nello scenario", facts)}</details>` : "<p>Nessuna coppia misurata: esito non verificato.</p>"}
${!issues.length && facts.length ? `<p>Nessuna issue nelle coppie misurate di questo scenario (${facts.length}).</p>` : ""}
${issues.map((entry) => {
      const covered = proposals.filter((proposal) => proposal.covered.has(entry.key));
      return `<details><summary>Issue: ${escape(entry.item.label)} — ${status(entry.item, entry.valid)}</summary>
<p><strong>${escape(pairName(entry.item))}</strong></p>
${pairSample(entry.item, "Coppia dello snapshot", entry.valid)}
<p>${covered.length ? `Proposte verificate per questa coppia: ${covered.map((view) => `<a href="#${view.id}">${escape(view.proposal.title)}</a>`).join(", ")}.` : "Nessuna proposta verificata per questa coppia nello scenario."}</p></details>`;
    }).join("")}</article>`;
  }).join("");
}

export function validation(report, scenarios, entries) {
  const problems = [];
  const iso = typeof report.generatedAt === "string" && report.generatedAt === report.generatedAt.trim() && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(report.generatedAt)
    && Number.isFinite(Date.parse(report.generatedAt))
        && new Date(`${report.generatedAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === report.generatedAt.slice(0, 10);
  const digest = typeof report.inputDigest === "string" && report.inputDigest.length === 64 && /^[a-f\d]{64}$/i.test(report.inputDigest);
  if (!iso) problems.push("Data di generazione assente o non valida.");
  if (!digest) problems.push("Impronta SHA-256 degli input assente o non valida.");
  if (!record(report.files) || !text(report.files.palette) || !text(report.files.output) || !FILE_KEYS.every((key) => Object.hasOwn(report.files, key) && (report.files[key] === null || text(report.files[key])))) problems.push("Identità dei file incompleta o non valida.");
  for (const key of ["palette", "scenarios", "proposals", "generationErrors", "auditErrors", "notes"]) {
    if (!Array.isArray(report[key])) problems.push(`Campo ${key} assente o non valido.`);
  }
  if (list(report.palette).some((item) => !record(item) || !text(item.name) || !text(item.role) || !colorValid(item.authored) || !colorValid(item.resolved))) problems.push("La palette contiene dati non validi.");
  if (!scenarios.length || scenarios.some((scenario) => !scenarioValid(scenario) || !scenario.diagnostics.length)) problems.push("Scenari mancanti, non validi o senza misure.");
  if (!entries.length || entries.some(({ valid }) => !valid)) problems.push("Diagnostiche mancanti, non valide o incoerenti con lo scenario o con le soglie.");
  for (const key of ["generationErrors", "auditErrors", "notes"]) {
    if (list(report[key]).some((item) => typeof item !== "string")) problems.push(`Il campo ${key} contiene dati non validi.`);
  }
  return { problems, iso, digest };
}

// ---------------------------------------------------------------------------
// Diagnostic session extras (SC-03 payload, plan §5.2/§6.2). The static report and
// the preview read the same session; neither promotes the model or the automation
// run to a browser-verified, local result.
// ---------------------------------------------------------------------------

/** True for the SC-03 diagnostic session (schemaVersion 1) rather than the legacy snapshot. */
export function isDiagnosticSession(value) {
  return record(value) && value.schemaVersion === 1 && record(value.css)
    && (typeof value.css.baseline === "string" || typeof value.css.generated === "string")
    && record(value.model) && Array.isArray(value.samples);
}

/** Declared snapshot identity: stable id, tool version and captured inputs. */
export function sessionIdentityHtml(value) {
  if (!isDiagnosticSession(value)) return "";
  const snapshotId = text(value.snapshotId) ? escape(value.snapshotId) : "non disponibile";
  const toolVersion = text(value.toolVersion) ? escape(value.toolVersion) : "non disponibile";
  const inputs = list(value.inputs).filter((item) => record(item) && text(item.name));
  const present = inputs.filter((item) => item.present === true).length;
  const captured = inputs.length ? ` · Input catturati: ${present}/${inputs.length}` : "";
  const design = record(value.design) ? value.design : null;
  const sourceCount = design ? designSources(design).length : 0;
  const tokenCount = design ? designTokens(design).length : 0;
  const designLine = design
    ? ` · Design: v${escape(design.version ?? "non dichiarata")} · ${sourceCount} ${agree(sourceCount, "sorgente", "sorgenti")} · ${tokenCount} ${agree(tokenCount, "token pubblico", "token pubblici")}`
    : "";
  return `<p>Snapshot incorporato: <code>${snapshotId}</code> · Versione tool: <code>${toolVersion}</code>${captured}.${designLine}</p>`;
}

/**
 * Explicit inventory of the evidence actually contained in this static document: a
 * browser-free model estimate and the automated measurements limited to the engines and
 * scenarios that ran. It states plainly that no browser-local measurement is included and
 * points at the preview, so no reader mistakes this report for a local run.
 */
function sessionEvidenceHtml(value, prepared) {
  if (!isDiagnosticSession(value)) return "";
  const scope = record(prepared) && record(prepared.verification) ? prepared.verification.scope : null;
  const samples = entriesFor(list(value.samples)).length;
  const measurements = scope ? scope.measurements.length : 0;
  const engines = scope ? scope.launched.length : 0;
  const roles = record(value.config) && record(value.config.roles) ? value.config.roles : {};
  // `roles.identities` is an array in a report snapshot and a record in a config layer; accept both.
  const declared = Array.isArray(roles.identities)
    ? roles.identities
    : Object.entries(record(roles.identities) ? roles.identities : {}).map(([name, role]) => ({ name, role: record(role) ? role.role : role }));
  const rolesLine = declared.filter((item) => record(item) && text(item.name))
    .map((item) => `${escape(item.name)}: ${escape(designer.roleLabel(item.role))}`).join(" · ");
  const modelNote = samples ? `${samples} ${agree(samples, "coppia prevista", "coppie previste")} — stima del modello, non una verifica` : "Nessun campione del modello in questa sessione";
  const automationNote = scope
    ? `${escape(automationScopeSentence(scope))}${measurements ? ` Misure incluse: ${measurements} in ${engines} ${agree(engines, "motore eseguito", "motori eseguiti")}.` : ""}`
    : "Nessun dato di automazione dichiarato in questa sessione";
  return `<p class="scope-note">Questa sessione contiene solo le evidenze dichiarate qui sotto. Nessun contrasto di questo browser è misurato in questo documento: <a href="smart-colors-preview.html">verifica i contrasti nel browser attivo</a> dalla preview diagnostica.</p>
<dl class="session-evidence">
<div><dt>Modello</dt><dd>${modelNote}</dd></div>
<div><dt>Automazione</dt><dd>${automationNote}</dd></div>
${rolesLine ? `<div><dt>Ruoli della palette</dt><dd>${rolesLine}</dd></div>` : ""}
<div><dt>Verifica locale</dt><dd>Non inclusa in questo report statico; resta nella <a href="smart-colors-preview.html">preview diagnostica</a>.</dd></div>
</dl>`;
}

const AUTOMATION_STATES = { pending: "In attesa", running: "In corso", complete: "Completa", incomplete: "Incompleta", unavailable: "Non disponibile", unsupported: "Non supportata", disabled: "Disattivata" };
// Environment phases are never a measurement problem; a run can be complete while a requested
// engine was simply unavailable in discovery/import/availability/launch.
const AUTOMATION_ENVIRONMENT_PHASES = ["discovery", "import", "availability", "launch"];
const AUTOMATION_MAX_ERRORS = 40;
const AUTOMATION_MAX_MEASUREMENT_GROUPS = 60;

/**
 * Scope of a VerificationRun, never a global verdict. `complete` requires the run status, the
 * coverage flag, zero measurement-phase errors AND no partial coverage, all limited to the engines
 * and scenarios actually executed, so a partial run can never look like a universal pass.
 */
export function automationScope(value) {
  const run = record(value) ? value : {};
  const engines = list(run.engines).filter(record);
  const errors = list(run.errors).filter((error) => record(error) && text(error.message));
  const measurements = list(run.measurements).filter(record);
  const coverage = record(run.coverage) ? run.coverage : null;
  const measurementErrors = errors.filter((error) => !AUTOMATION_ENVIRONMENT_PHASES.includes(error.phase));
  const environmentErrors = errors.filter((error) => AUTOMATION_ENVIRONMENT_PHASES.includes(error.phase));
  const launched = engines.filter((engine) => engine.launched === true);
  const coverageComplete = Boolean(coverage && coverage.complete === true);
  const partial = run.partial === true;
  const status = text(run.status) ? run.status : "disabled";
  const complete = status === "complete" && coverageComplete && measurementErrors.length === 0 && !partial
    && launched.length > 0 && measurements.length > 0;
  return { run, status, engines, errors, measurements, coverage, measurementErrors, environmentErrors, launched, coverageComplete, partial, complete, unsupported: list(run.unsupported).filter(record),
    explorations: list(run.explorations).filter(record), explorationCoverage: record(run.explorationCoverage) ? run.explorationCoverage : null };
}

function automationStateLabel(state) {
  return AUTOMATION_STATES[state] ?? (text(state) ? state : "Stato non indicato");
}

function explorationMeasurementValid(item) {
  return record(item) && text(item.pairId) && ratioValid(item.minimum) && ratioValid(item.target)
    && finite(item.ratio) && ratioValid(item.ratio);
}

function explorationFamily(item) {
  return text(item.family) ? item.family : "famiglia non indicata";
}

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  return finite(value) ? value : null;
}

function namesValue(value) {
  return list(value).filter(text);
}

/** Exploration coverage is separate from the expected/executed pair coverage of the verified run. */
function explorationCoverageView(value) {
  if (!record(value)) return null;
  const unmeasuredNames = namesValue(value.unmeasured);
  const unmeasured = countValue(value.unmeasured);
  const omittedFamilies = namesValue(value.omittedFamilies);
  const expected = countValue(value.expected);
  const measured = countValue(value.measured);
  return {
    expected,
    measured,
    unmeasured,
    unmeasuredNames,
    omittedFamilies,
    omittedCount: countValue(value.omittedFamilies),
    // Fail closed: an explicit true, no declared missing unit and coherent counts.
    complete: value.complete === true && (unmeasured ?? 0) === 0
      && (expected === null || measured === null || measured <= expected),
  };
}

function explorationTier(ratio) {
  // Same reference thresholds the static overlap section uses: normal text starts at 4.5:1,
  // 3:1–4.5:1 is only large text, borders and icons, below 3:1 is not a usable pairing.
  return ratio >= 4.5 ? 0 : ratio >= 3 ? 1 : 2;
}

function explorationRows(items) {
  const groups = new Map();
  for (const item of items) {
    const key = JSON.stringify([item.pairId, item.minimum, item.target]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.values()].map((group) => {
    const worst = group.reduce((current, item) => {
      if (!finite(item.ratio)) return current;
      return !finite(current.ratio) || item.ratio < current.ratio ? item : current;
    }, group[0]);
    return { measurement: worst, count: group.length };
  }).sort((a, b) => {
    const first = finite(a.measurement.ratio) ? a.measurement.ratio : -1;
    const second = finite(b.measurement.ratio) ? b.measurement.ratio : -1;
    return explorationTier(first) - explorationTier(second) || second - first;
  });
}

function explorationCell(measurement) {
  const parts = pairParts(measurement.pairId);
  return parts
    ? `<code>${escape(parts.foreground)}</code> su <code>${escape(parts.background)}</code>`
    : `<code>${escape(measurement.pairId == null ? "coppia non indicata" : measurement.pairId)}</code>`;
}

function explorationTable(caption, rows) {
  return table(caption, ["Coppia", "Tema", "Rapporto (peggiore)", "Minimo", "Target", "Esito", "Misure"], rows.map(({ measurement, count }) => {
    const parts = pairParts(measurement.pairId);
    return `<tr><th scope="row">${explorationCell(measurement)}</th><td>${parts ? (themeText(parts.theme) || escape(parts.theme)) : "—"}</td><td>${ratio(measurement.ratio)}</td><td>${ratio(measurement.minimum)}</td><td>${ratio(measurement.target)}</td><td>${escape(automationMeasurementStatus(measurement))}</td><td>${count}</td></tr>`;
  }));
}

// Single source for the exploration coverage sentence: the full report and the compact preview both
// reuse it, so the compact mode never re-derives the same numbers with different wording.
function explorationCoverageLine(coverage, itemsLength) {
  if (!coverage) return "<p class=\"exploration-scope\">Copertura esplorativa non dichiarata: le misure presenti non vengono promosse a verifica.</p>";
  const measured = coverage.measured ?? itemsLength;
  const expected = coverage.expected;
  const unmeasured = coverage.unmeasured;
  return `<p class="exploration-scope">Copertura esplorativa ${coverage.complete ? "completa" : "parziale"}: ${measured === null ? "non dichiarata" : measured}${expected === null ? "" : ` di ${expected}`} misurate${unmeasured === null ? "" : ` · ${unmeasured} ${agree(unmeasured, "non misurata", "non misurate")}`}${coverage.omittedCount === null ? "" : ` · ${coverage.omittedCount} ${agree(coverage.omittedCount, "famiglia omessa", "famiglie omesse")}`}.</p>`;
}

// Exploratory overlaps are a separate channel: they never change the verified-pair coverage,
// never become an issue and never receive an accessibility certification.
function explorationHtml(run) {
  const raw = list(run.explorations).filter(record);
  const items = raw.filter(explorationMeasurementValid);
  const coverage = explorationCoverageView(run.explorationCoverage);
  if (!raw.length && !coverage) return "";
  const families = [...new Set(items.map(explorationFamily))];
  const visibleFamilies = families.slice(0, MAX_EXPLORATION_FAMILIES);
  const omittedFamilies = families.slice(MAX_EXPLORATION_FAMILIES);
  const scoped = items.filter((item) => visibleFamilies.includes(explorationFamily(item)));
  const rows = explorationRows(scoped);
  const top = rows.slice(0, EXPLORATION_TOP_GROUPS);
  const rest = rows.slice(EXPLORATION_TOP_GROUPS);
  const coverageLine = explorationCoverageLine(coverage, items.length);
  return `<h4>Esplorazioni di sovrapposizione (${items.length} misure, canale separato)</h4>
<p>Coppie esplorative fuori dalle coppie previste e dalle misure automatiche principali. Restano una simulazione scoped per tema, proprietà e colori misurati: non sono un problema accertato, non attivano correzioni automatiche e non sostituiscono un audit di accessibilità. Gli abbinamenti sono ordinati per fascia d'uso: testo normale (almeno 4,5:1), poi solo titoli grandi, bordi e icone (3:1–4,5:1), poi da evitare (sotto 3:1).</p>
${coverageLine}
${top.length ? explorationTable("Primi abbinamenti esplorativi", top) : "<p>Nessuna misura esplorativa valida.</p>"}
${rest.length ? `<details><summary>Altre ${rest.length} coppie esplorative</summary>${explorationTable("Altre coppie esplorative", rest)}</details>` : ""}
${coverage && coverage.unmeasuredNames.length ? `<h5>Coppie non misurate</h5><ul>${coverage.unmeasuredNames.map((name) => `<li><code>${escape(name)}</code></li>`).join("")}</ul>` : ""}
${coverage && coverage.omittedFamilies.length ? `<h5>Famiglie omesse dalla copertura</h5><ul>${coverage.omittedFamilies.map((name) => `<li><code>${escape(name)}</code></li>`).join("")}</ul>` : ""}
${omittedFamilies.length ? `<p class="margin-note">${omittedFamilies.length} ${agree(omittedFamilies.length, "famiglia supera", "famiglie superano")} il limite di schema di ${MAX_EXPLORATION_FAMILIES} e resta fuori da questa sintesi: ${omittedFamilies.map((name) => `<code>${escape(name)}</code>`).join(", ")}.</p>` : ""}`;
}

function automationMeasurementStatus(item) {
  if (text(item.error)) return `Non misurata: ${item.error}`;
  if (item.status === "pass") return "Raggiunge minimo e target";
  if (item.status === "below-target") return "Sotto il target";
  if (item.status === "below-minimum") return "Sotto il minimo";
  if (item.status === "unmeasured") return "Non misurata";
  return text(item.status) ? String(item.status) : "Esito non indicato";
}

// Counts reuse the exact status vocabulary of `automationMeasurementStatus` (an item with an error
// counts as unmeasured). No second numerical engine and no HTML parsing: the compact preview only
// summarises the same rows the full report renders as a table.
function automationMeasurementCounts(measurements) {
  const counts = { total: measurements.length, pass: 0, belowTarget: 0, belowMinimum: 0, unmeasured: 0, other: 0 };
  for (const item of measurements) {
    if (text(item.error)) { counts.unmeasured += 1; continue; }
    const status = typeof item.status === "string" ? item.status : "";
    if (status === "pass") counts.pass += 1;
    else if (status === "below-target") counts.belowTarget += 1;
    else if (status === "below-minimum") counts.belowMinimum += 1;
    else if (status === "unmeasured") counts.unmeasured += 1;
    else counts.other += 1;
  }
  return counts;
}

function automationCountsHtml(counts) {
  const rows = [
    `<li><strong>${counts.belowMinimum}</strong> sotto il minimo</li>`,
    `<li><strong>${counts.belowTarget}</strong> sotto il target</li>`,
    `<li><strong>${counts.unmeasured}</strong> non misurate</li>`,
    `<li><strong>${counts.pass}</strong> raggiungono minimo e target</li>`,
  ];
  if (counts.other) rows.push(`<li><strong>${counts.other}</strong> con esito non indicato</li>`);
  return `<h4>Misure automatizzate (${counts.total})</h4>\n<ul class="automation-counts">${rows.join("")}</ul>`;
}

// Compact exploration block: same heading and coverage sentence as the full report, without the
// bulky grouped tables or the itemised unmeasured/omitted name lists (their counts stay visible).
function explorationSummaryHtml(run, items, coverage) {
  const raw = list(run.explorations).filter(record);
  if (!raw.length && !coverage) return "";
  return `<h4>Esplorazioni di sovrapposizione (${items.length} misure, canale separato)</h4>
${explorationCoverageLine(coverage, items.length)}`;
}

function countPairIds(pairs) {
  if (!record(pairs)) return 0;
  let total = 0;
  for (const value of Object.values(pairs)) total += list(value).length;
  return total;
}

// Compact, explicit scope sentence. "Complete" only ever refers to the executed environments.
function automationScopeSentence(scope) {
  if (scope.status === "disabled") return "Automazione disattivata: nessuna misura browser è inclusa in questo snapshot.";
  if (scope.launched.length === 0) return "Ambiente di automazione non disponibile: nessun motore ha misurato, quindi l'automazione non conferma nessuna coppia.";
  if (scope.complete) return "Copertura completa negli ambienti eseguiti (i motori e gli scenari elencati qui sotto), non universale: vale solo per i motori richiesti che hanno completato la verifica.";
  return `Copertura parziale o incompleta: ${scope.partial ? "non tutti i motori richiesti hanno completato la verifica" : "non tutte le coppie attese sono coperte"}; le misure eseguite non coprono gli ambienti o gli scenari mancanti.`;
}

/** Static summary of the VerificationRun; never merged with the model or the local run.
 *
 * `options.compact === true` is the preview mode: it keeps the scope sentence, coverage facts, the
 * engine list, the error list and the unsupported list, summarises the measurements with accurate
 * counts (below-minimum, below-target, unmeasured, pass) and replaces only the bulky measurement and
 * exploration tables with a link to the full report. The default (`compact` absent/false) emits the
 * exact same full document as before, tables included.
 */
export function automationHtml(value, options = {}) {
  if (!record(value)) return "";
  const compact = record(options) && options.compact === true;
  const scope = automationScope(value);
  const { run, status, engines, errors, measurements, launched, complete, measurementErrors, environmentErrors, unsupported } = scope;
  const explorationItems = list(run.explorations).filter(explorationMeasurementValid);
  const rawExplorations = list(run.explorations).filter(record);
  const explorationCoverage = explorationCoverageView(run.explorationCoverage);
  const mode = text(run.mode) ? run.mode : "off";
  const expected = record(run.expected) ? run.expected : {};
  const executed = record(run.executed) ? run.executed : {};
  const facts = [
    `<div><dt>Modalità</dt><dd><code>${escape(mode)}</code></dd></div>`,
    `<div><dt>Stato</dt><dd>${escape(automationStateLabel(status))}</dd></div>`,
    `<div><dt>Motori eseguiti</dt><dd>${launched.length} di ${engines.length}</dd></div>`,
    `<div><dt>Scenari</dt><dd>${list(executed.scenarios).length} di ${list(expected.scenarios).length} eseguiti</dd></div>`,
    `<div><dt>Coppie</dt><dd>${countPairIds(executed.pairs)} di ${countPairIds(expected.pairs)} eseguite</dd></div>`,
    `<div><dt>Misure</dt><dd>${measurements.length}</dd></div>`,
    `<div><dt>Copertura</dt><dd>${complete ? "completa negli ambienti eseguiti" : "parziale o incompleta"}</dd></div>`,
  ];
  if (measurementErrors.length) facts.push(`<div><dt>Errori di misura</dt><dd>${measurementErrors.length}</dd></div>`);
  if (environmentErrors.length) facts.push(`<div><dt>Errori d&#39;ambiente</dt><dd>${environmentErrors.length}</dd></div>`);
  if (text(run.measuredAt)) facts.push(`<div><dt>Istante più recente</dt><dd>${escape(run.measuredAt)}</dd></div>`);
  if (explorationCoverage || explorationItems.length) {
    const measured = explorationCoverage?.measured ?? explorationItems.length;
    const expectedExplorations = explorationCoverage?.expected;
    facts.push(`<div><dt>Esplorazioni</dt><dd>${measured}${finite(expectedExplorations) ? ` di ${expectedExplorations}` : ""} misurate · canale separato</dd></div>`);
  }

  const enginesHtml = engines.length ? `<h4>Motori richiesti</h4>
<ul class="automation-engines">${engines.map((engine) => {
    const name = text(engine.name) ? engine.name : "motore non indicato";
    const version = text(engine.version) ? ` ${escape(engine.version)}` : "";
    const state = automationStateLabel(engine.status);
    const launch = engine.launched === true ? "eseguito" : "non eseguito";
    const phase = text(engine.phase) ? ` · fase <code>${escape(engine.phase)}</code>` : "";
    const reason = text(engine.reason) ? ` — ${escape(engine.reason)}` : "";
    return `<li><code>${escape(name)}</code>${version} · ${escape(state)} · ${launch}${phase}${reason}</li>`;
  }).join("")}</ul>` : "";

  // Error causes are always listed, even when the run produced zero measurements.
  const shownErrors = errors.slice(0, AUTOMATION_MAX_ERRORS);
  const errorsHtml = errors.length ? `<h4>Errori dell'automazione (${errors.length})</h4>
<ul class="automation-errors">${shownErrors.map((error) => {
    const phase = text(error.phase) ? `<code>${escape(error.phase)}</code>` : "<code>fase non indicata</code>";
    const cause = text(error.cause) ? `<code>${escape(error.cause)}</code>` : "<code>causa non indicata</code>";
    const engine = text(error.engine) ? ` · motore <code>${escape(error.engine)}</code>` : "";
    const scenario = text(error.scenarioId) ? ` · scenario <code>${escape(error.scenarioId)}</code>` : "";
    return `<li>${phase} · ${cause} — ${escape(error.message)}${engine}${scenario}</li>`;
  }).join("")}</ul>${errors.length > shownErrors.length ? `<p class="margin-note">Altre ${errors.length - shownErrors.length} voci d'errore sono omesse da questa sintesi; il run completo resta nei dati strutturati.</p>` : ""}` : "";

  const unsupportedHtml = unsupported.length ? `<h4>Scenari non supportati (${unsupported.length})</h4>
<ul class="automation-unsupported">${unsupported.map((entry) => {
    const engine = text(entry.engine) ? ` · motore <code>${escape(entry.engine)}</code>` : "";
    return `<li><code>${escape(entry.id)}</code> — ${escape(entry.reason)}${engine}</li>`;
  }).join("")}</ul>` : "";

  const groups = new Map();
  for (const measurement of measurements) {
    const key = JSON.stringify([measurement.pairId, measurement.minimum, measurement.target]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(measurement);
  }
  const shownGroups = [...groups.values()].slice(0, AUTOMATION_MAX_MEASUREMENT_GROUPS);
  const fullMeasurementsHtml = measurements.length ? `<h4>Misure automatizzate (${measurements.length})</h4>
<p class="margin-note">Raggruppate per coppia, minimo e target: è mostrato il rapporto peggiore fra i motori e gli scenari eseguiti, con soglie ed esito. Il run locale di un browser è nella preview, separato da queste misure.</p>
${table("Misure automatizzate per coppia", ["Coppia", "Tema", "Minimo", "Target", "Rapporto (peggiore)", "Esito", "Misure"], shownGroups.map((group) => {
    const worst = group.reduce((current, item) => (finite(item.ratio) && (!finite(current.ratio) || item.ratio < current.ratio) ? item : current), group[0]);
    const parts = pairParts(worst.pairId);
    const pairCell = parts
      ? `<code>${escape(parts.foreground)}</code> su <code>${escape(parts.background)}</code>`
      : `<code>${escape(worst.pairId == null ? "coppia non indicata" : worst.pairId)}</code>`;
    const themeCell = parts ? (themeText(parts.theme) || escape(parts.theme)) : "—";
    return `<tr><th scope="row">${pairCell}</th><td>${themeCell}</td><td>${ratio(worst.minimum)}</td><td>${ratio(worst.target)}</td><td>${compactRatio(worst.ratio, [worst.minimum, worst.target])}</td><td>${escape(automationMeasurementStatus(worst))}</td><td>${group.length}</td></tr>`;
  }))}${groups.size > shownGroups.length ? `<p class="margin-note">Altre ${groups.size - shownGroups.length} coppie sono omesse da questa sintesi; il run completo resta nei dati strutturati.</p>` : ""}` : "";
  // The compact mode reuses the same measurement rows for the counts and the same exploration
  // coverage view; it only drops the wide tables, which the full report keeps.
  const measurementsHtml = compact
    ? (measurements.length ? automationCountsHtml(automationMeasurementCounts(measurements)) : "")
    : fullMeasurementsHtml;
  const explorationBlock = compact ? explorationSummaryHtml(run, explorationItems, explorationCoverage) : explorationHtml(run);
  const omittedTables = compact && (measurements.length > 0 || rawExplorations.length > 0 || explorationCoverage !== null);
  const fullReportLink = omittedTables
    ? `<p class="margin-note"><a href="smart-colors.html">Apri misure complete nel report</a> per le tabelle complete delle misure automatizzate e delle esplorazioni, con soglie, esiti e conteggi per coppia.</p>`
    : "";

  return `<h3>Verifica automatizzata (Playwright)</h3>
<p>Misura separata dal modello e dalla verifica locale: usa i motori richiesti e non sostituisce né i campioni del modello né le misure di questo browser. <strong>${escape(automationScopeSentence(scope))}</strong></p>
<dl>${facts.join("")}</dl>
${enginesHtml}${errorsHtml}${unsupportedHtml}${measurementsHtml}${explorationBlock}${fullReportLink}`;
}

function pairParts(pairId) {
  const parts = typeof pairId === "string" ? pairId.split("|") : [];
  return parts.length === 4 ? { theme: parts[0], property: parts[1], foreground: parts[2], background: parts[3] } : null;
}

// `validation` raises these two only because the legacy scenario matrix is empty for a session whose
// evidence lives in the automation run; every identity problem still blocks a positive header.
const SCENARIO_PROBLEMS = new Set([
  "Scenari mancanti, non validi o senza misure.",
  "Diagnostiche mancanti, non valide o incoerenti con lo scenario o con le soglie.",
]);

/**
 * Header-level verification of a session: the snapshot identity stays intact AND the automation run
 * is complete in the executed engines. The model never contributes to this positive and a partial or
 * incomplete automation run can never claim it.
 */
export function sessionVerification(value) {
  if (!isDiagnosticSession(value)) return null;
  const scenarios = list(value.scenarios);
  const entries = entriesFor(scenarios);
  const { problems } = validation(value, scenarios, entries);
  const identityProblems = problems.filter((problem) => !SCENARIO_PROBLEMS.has(problem));
  const errors = [...list(value.generationErrors), ...list(value.auditErrors)];
  const scope = record(value.automation) ? automationScope(value.automation) : null;
  const identityOk = identityProblems.length === 0 && errors.length === 0;
  return { scope, identityProblems, identityOk, verified: identityOk && Boolean(scope && scope.complete) };
}

// UTF-8 byte size without a build step; the pages measure the embedded CSS bytes.
const utf8Bytes = (value) => typeof value === "string" ? new TextEncoder().encode(value).length : 0;

const CSS_STATUS_LABELS = { current: "Corrente", stale: "Obsoleto", absent: "Assente", empty: "Vuoto" };
const CSS_SOURCE_LABELS = {
  output: "Output reale catturato",
  "generated-candidate": "Candidato generato (non misurato su disco)",
};
const SHA256 = /^[a-f\d]{64}$/i;

function digestText(value) {
  return typeof value === "string" && SHA256.test(value) ? `<code>${escape(value)}</code>` : "non fornito";
}

function digestField(css, key) {
  if (record(css.digest) && typeof css.digest[key] === "string") return css.digest[key];
  const direct = key === "generated" ? css.generatedDigest : css.baselineDigest;
  return typeof direct === "string" ? direct : null;
}

/** Technical note on the CSS bytes embedded in the snapshot (generated model vs captured baseline). */
export function cssEmbedHtml(value) {
  if (!record(value)) return "";
  const generated = typeof value.generated === "string" ? value.generated : null;
  const captured = typeof value.baseline === "string" ? value.baseline : null;
  const declaredSource = ["output", "generated-candidate"].includes(value.source) ? value.source : null;
  const source = declaredSource ?? (captured === null && generated !== null ? "generated-candidate" : null);
  // The contract states that the baseline is the captured output when it exists, even when empty;
  // otherwise it is the generated candidate. Never present the candidate as an on-disk measurement.
  const baseline = captured ?? (source === "generated-candidate" ? generated : null);
  const status = ["current", "stale", "absent", "empty"].includes(value.status) ? value.status : null;
  const production = value.production === true && status === "current" && source === "output" && utf8Bytes(baseline) > 0;
  const statusLabel = status ? CSS_STATUS_LABELS[status] : "Non dichiarato";
  const sourceLabel = source ? CSS_SOURCE_LABELS[source] : "Non dichiarata";
  const tuning = typeof value.tuning === "string" ? value.tuning : null;
  const support = ["absent", "supported", "unsupported"].includes(value.tuningSupport) ? value.tuningSupport : null;
  const tuningLine = tuning === null || support === "absent"
    ? "Assente: nessun override a runtime."
    : support === "unsupported"
      ? `Incorporato (${utf8Bytes(tuning)} byte) ma non valutato: contiene <code>@import</code> o <code>url()</code> non caricabili offline, quindi le misure del modello non lo coprono.`
      : `Incorporato: ${utf8Bytes(tuning)} byte.`;
  const generatedLine = generated === null
    ? "Non fornito dal modello."
    : `${utf8Bytes(generated)} byte · SHA-256 ${digestText(digestField(value, "generated"))}`;
  const baselineLine = baseline === null
    ? "Non disponibile."
    : `${utf8Bytes(baseline)} byte · SHA-256 ${digestText(digestField(value, "baseline"))}`;
  const productionLine = production ? "Sì" : "No";
  const warning = source === "generated-candidate"
    ? "<p class=\"baseline-note\">La baseline mostrata è il candidato generato dal modello, non un file misurato su disco.</p>"
    : status === "stale" && source === "output"
      ? "<p class=\"baseline-note\">Stato obsoleto: la baseline è l'output reale catturato, non un candidato generato. Le previsioni del modello non sostituiscono quella misura.</p>"
      : status === "absent"
        ? "<p class=\"baseline-note\">Nessun output reale disponibile: la baseline non è una misura su disco.</p>"
        : status === "empty"
          ? "<p class=\"baseline-note\">L'output reale esiste ma è vuoto (0 byte): non è una baseline di produzione.</p>"
          : "";
  return `<p>Il report non scrive CSS e non ricalcola il contrasto: confronta il modello atteso con la baseline catturata al momento della generazione. La build misura dopo la scrittura.</p>
<dl><div><dt>Modello atteso (generated)</dt><dd>${generatedLine}</dd></div>
<div><dt>Baseline incorporata</dt><dd>${baselineLine}</dd></div>
<div><dt>Stato dell'output</dt><dd>${escape(statusLabel)}</dd></div>
<div><dt>Provenienza della baseline</dt><dd>${escape(sourceLabel)}</dd></div>
<div><dt>Produzione</dt><dd>${productionLine}</dd></div>
<div><dt>Tuning</dt><dd>${tuningLine}</dd></div></dl>
${warning}`;
}

/** Internal snapshot preparation shared by renderers and report summaries; no I/O or contrast recalculation. */
export function prepareContrastReport(value) {
  const report = record(value) ? value : {};
  const scenarios = list(report.scenarios);
  const entries = entriesFor(scenarios);
  const { problems, iso, digest } = validation(report, scenarios, entries);
  const issues = entries.filter(({ valid, item }) => valid && item.status !== "pass");
  const errors = [...list(report.generationErrors), ...list(report.auditErrors)];
  const verified = !problems.length && !errors.length;
  const proposals = list(report.proposals).filter((item) => record(item) && item.verified === true)
    .map((item, index) => proposalView(item, index, entries))
    .map((view) => verified ? view : { ...view, complete: false, covered: new Set() });
  const groups = issueGroups(entries);
  const overlaps = overlapView(report.overlaps, scenarios, verified);
  const variantShifts = verified ? variantShiftView(entries, list(report.palette), record(report.roles) ? report.roles : null) : null;
  const tuningGroups = groups.filter((group) => group.some(({ item }) => ratioValid(item.baselineRatio)
    && Math.abs(item.baselineRatio - item.ratio) > 1e-9 && item.baselineRatio >= Math.max(item.minimum, item.target)));
  const complete = proposals.filter((view) => view.complete);
  const rejectedSources = list(report.rejectedSources)
    .filter((item) => record(item) && text(item.id) && text(item.file) && text(item.reason))
    .map(({ id, file, reason }) => ({ id, file, reason }));
  const outcome = !verified ? "Esito non verificato o incompleto" : issues.length
    ? `${groups.length} ${groups.length === 1 ? "problema di contrasto" : "problemi di contrasto"} · ${complete.length} ${complete.length === 1 ? "correzione verificata" : "correzioni verificate"}`
    : "Esito positivo dello snapshot: 0 issue";
  const files = record(report.files) ? report.files : {};
  return { report, scenarios, entries, problems, iso, digest, issues, errors, verified, proposals,
    groups, overlaps, variantShifts, tuningGroups, complete, rejectedSources, outcome, files };
}

/**
 * Prepared view for a diagnostic session: the legacy snapshot view with every positive verdict,
 * verified proposal and exploratory overlap ALSO gated by `sessionVerification` (automation complete
 * in the executed engines, identity intact). A session can only ever be downgraded here, so an
 * incomplete, partial, unsupported, disabled or missing automation run never inherits the legacy
 * "0 issue" outcome. `sessionVerification` calls `validation`/`automationScope`, never this function,
 * so the two helpers cannot recurse into each other.
 */
export function prepareDiagnosticReport(value) {
  const prepared = prepareContrastReport(value);
  if (!isDiagnosticSession(value)) return { ...prepared, verification: null };
  const verification = sessionVerification(value);
  const verified = prepared.verified && Boolean(verification && verification.verified);
  if (verified === prepared.verified) return { ...prepared, verification };
  // Downgrade only: strip the positive outcome, proposal coverage and exploratory overlaps.
  return {
    ...prepared,
    verification,
    verified: false,
    outcome: "Esito non verificato o incompleto",
    proposals: prepared.proposals.map((view) => ({ ...view, complete: false, covered: new Set() })),
    complete: [],
    overlaps: overlapView(prepared.report.overlaps, prepared.scenarios, false),
    variantShifts: null,
  };
}

/** Render a supplied snapshot only: no I/O, recalculation of contrast or client code. */
export function formatContrastReportHtml(value) {
  const session = isDiagnosticSession(value) ? value : null;
  const prepared = session ? prepareDiagnosticReport(value) : prepareContrastReport(value);
  const { report, scenarios, entries, problems, iso, digest, issues, errors, verified, proposals,
    groups, overlaps, variantShifts, tuningGroups, complete, rejectedSources, outcome, files } = prepared;
  const identity = session ? sessionIdentityHtml(session) : "";
  const design = session ? designHtml(session.design) : "";
  const modelAtlas = session ? modelAtlasHtml(session.samples) : "";
  const automation = session ? automationHtml(session.automation) : "";
  const cssEmbed = session ? cssEmbedHtml(session.css) : "";
  const entriesAtlas = familyAtlas(entries, verified);
  const verification = prepared.verification ?? null;
  const verificationLine = verification
    ? verification.verified
      ? "<p><strong>Copertura verificata:</strong> le coppie automatizzate sono complete negli ambienti eseguiti (motori e scenari elencati). Il modello resta una previsione, non una verifica.</p>"
      : "<p><strong>Copertura non verificata:</strong> l'automazione non copre tutte le coppie negli ambienti eseguiti; il modello resta una previsione, non una verifica.</p>"
    : "";
  // The static document holds no browser-local measurement, so its headline is scoped to the
  // snapshot and to the environments actually executed; the preview link is the primary way to
  // check the active browser.
  const scopeNote = session
    ? `<p class="scope-note">L'esito sopra riguarda solo le coppie dello snapshot e l'automazione <strong>negli ambienti eseguiti</strong>: non è la misura di questo browser e non copre usi o stati non misurati. I metadati di design sono dichiarazioni del modello: il report li mostra senza applicare override.</p>`
    : "";
  const previewLink = session
    ? `<p class="preview-cta"><a href="smart-colors-preview.html">Apri la preview diagnostica e verifica i contrasti nel browser attivo</a> — stessi campioni, più la verifica locale; non modifica questo report statico.</p>`
    : "";
  const sessionEvidence = session ? sessionEvidenceHtml(session, prepared) : "";
  // One family catalog by default: the measured atlas wins when it exists, and the model
  // estimate follows inside a native disclosure so the data survives without duplication.
  const modelAtlasHeading = `<h3 class="model-atlas-title">Famiglie di colori nel modello</h3>`;
  const modelAtlasBlock = modelAtlas
    ? entriesAtlas
      ? `<details><summary>Campioni dal modello — previsioni senza browser</summary>${modelAtlasHeading}${modelAtlas}</details>`
      : `${modelAtlasHeading}${modelAtlas}`
    : "";
  // Engines, causes and measurements are technical evidence: they stay in a native disclosure so a
  // missing package or browser never dominates the designer's first reading.
  const automationBlock = automation
    ? `<details><summary>Verifica automatizzata (Playwright) — dettagli, cause e misure</summary>${automation}</details>`
    : "";
  const sessionSection = sessionEvidence
    ? `<section aria-labelledby="sessione"><h2 id="sessione">Sessione diagnostica: ambito ed evidenze</h2>
${sessionEvidence}
${modelAtlasBlock}
${automationBlock}</section>`
    : "";
  const sessionNav = sessionSection ? `<li><a href="#sessione">Sessione diagnostica</a></li>` : "";
  const designNav = design ? `<li><a href="#design">Sorgenti e ricette</a></li>` : "";
  const cssDetails = cssEmbed
    ? `<details><summary>CSS incorporato nello snapshot</summary>
<section aria-labelledby="css"><h2 id="css">CSS incorporato nello snapshot</h2>${cssEmbed}</section></details>`
    : "";
  const messages = (heading, values) => `<h3>${heading}</h3>${values.length ? `<ul>${values.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : "<p>Nessuno.</p>"}`;
  return `${MARKER}
<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapporto contrasto — snapshot ${escape(report.generatedAt)}</title>
<style>${CSS}</style></head><body><div class="shell">
<a class="skip" href="#contenuto">Vai al contenuto</a>
<header><h1>Rapporto di contrasto</h1><p class="status overview">${outcome}</p>
${scopeNote}
<ul class="summary-facts"><li><strong>${groups.length}</strong> ${agree(groups.length, "problema distinto", "problemi distinti")}</li><li><strong>${complete.length}</strong> ${agree(complete.length, "correzione verificata", "correzioni verificate")}</li><li><strong>${entries.length}</strong> ${agree(entries.length, "coppia misurata", "coppie misurate")}</li><li><strong>${variantShifts === null ? "n.d." : variantShifts.length}</strong> ${agree(variantShifts?.length ?? 0, "variante da rivedere", "varianti da rivedere")}</li><li><strong>${scenarios.length}</strong> ${agree(scenarios.length, "scenario", "scenari")}</li></ul>
<p>Generato il ${iso ? `<time datetime="${escape(report.generatedAt)}">${escape(report.generatedAt)}</time>` : escape(report.generatedAt)}.</p>
${identity}${verificationLine}${previewLink}<p><strong>Snapshot statico, non stato attuale del progetto.</strong> Rigenera il report dopo ogni modifica ai colori. Data, file e impronta sono nei dettagli tecnici.</p>
<nav aria-label="Sezioni del rapporto"><ul><li><a href="#proposte">Correzione consigliata</a></li><li><a href="#problemi">Problemi e risultato atteso</a></li><li><a href="#usi">Colpo d’occhio sugli usi</a></li>${designNav}${sessionNav}<li><a href="#tecnici">Dettagli tecnici</a></li></ul></nav></header>
<main id="contenuto">
${verified ? "" : `<div class="notice"><p class="status">Nessuna conclusione positiva: dati assenti, non validi, incoerenti o errori impediscono di verificare lo snapshot.</p><ul>${[...problems, ...errors].map((item) => `<li>${escape(item)}</li>`).join("")}</ul></div>`}
${list(report.notes).length ? `<p>${escape(report.notes[0])}</p>` : ""}
<section aria-labelledby="proposte"><h2 id="proposte">${complete.length > 1 ? "Correzioni da valutare" : "Correzione consigliata"}</h2>
<p>${complete.length ? "Usa il colore suggerito applicando la modifica nel file indicato." : verified && !issues.length ? "Non serve una correzione per le coppie misurate." : "Non applicare correzioni non verificate: i dati disponibili non permettono di consigliarne una."}${complete.length > 1 ? " Le opzioni sono verificate separatamente: non sommarle senza una nuova verifica." : ""}</p>
${proposalsHtml(proposals, variantShifts, rejectedSources)}</section>
<section aria-labelledby="problemi"><h2 id="problemi">${groups.length ? "Cosa migliora" : "Problemi rilevati"}</h2>
${groups.length ? '<p>Confronta il contrasto attuale con quello ottenuto dalla correzione. I rapporti sono sintetici; minimo, target ed esiti restano distinti.</p>' : ""}
${tuningGroups.length ? `<p><strong>${tuningGroups.length} di ${groups.length}</strong> problemi compaiono con i tuning di progetto: senza tuning il generatore rispettava il target. La riga “Senza i tuning” lo mostra coppia per coppia.</p>` : ""}
<div class="grid">${problemsHtml(groups, proposals, verified)}</div></section>
<section aria-labelledby="usi"><h2 id="usi">Palette: colpo d’occhio sugli usi</h2>
<p><strong>Situazione attuale, prima delle correzioni.</strong> OK vale solo per gli abbinamenti controllati; da migliorare significa minimo rispettato ma target mancato; da evitare significa sotto il minimo per quell’uso.</p>
${usageHtml(entries, scenarios, verified)}
<h3>Famiglie di colori: come appaiono nei componenti</h3>
<p>Ogni famiglia mostra testo su callout, bottone e chip con i rapporti misurati: vedi subito se la variante regge nell’uso previsto.</p>
${entriesAtlas}
${variantShiftsHtml(variantShifts)}
<h3>Se sovrapponi liberamente i colori base</h3>${overlapsHtml(overlaps)}
<p>Su foto, gradienti o trasparenze, verifica il risultato sullo sfondo reale. Colori diversi per tonalità possono avere poco contrasto: non basta che sembrino diversi.</p></section>
${design}${sessionSection}<section aria-labelledby="tecnici"><h2 id="tecnici">Dettagli tecnici</h2><p>Non servono per leggere la correzione. Tutti i dati originali restano disponibili qui.</p>
<details><summary>Misure complete — ${scenarios.length} scenari, ${entries.length} controlli</summary>
<section aria-labelledby="scenari"><h2 id="scenari">Scenari, misure e issue</h2><p>Ogni rapporto riguarda la coppia primo piano/sfondo indicata, non il colore isolato. Minimo e target sono distinti; i rapporti sono mostrati con la precisione completa del dato numerico fornito.</p>${scenariosHtml(scenarios, entries, proposals)}</section></details>
<details><summary>Palette completa — fonte e colori risolti</summary>
<section aria-labelledby="palette"><h2 id="palette">Palette originale e colori risolti</h2><p>I campioni possono essere alterati dal gamut del display, dal browser o dai colori forzati. I valori OKLCH restano disponibili sulla UI neutra.</p>${paletteHtml(list(report.palette))}</section></details>
<details><summary>File, impronta dello snapshot ed errori</summary>
<section aria-labelledby="esito"><h2 id="esito">Esito e integrità dello snapshot</h2>
<p>${verified ? `${entries.length} ${agree(entries.length, "coppia misurata", "coppie misurate")}; ${issues.length} ${agree(issues.length, "rilevazione", "rilevazioni")} sotto minimo o target, raggruppate in ${groups.length} ${agree(groups.length, "problema distinto", "problemi distinti")}. Esito limitato a questi scenari e alla provenienza dichiarata.` : "Nessuna conclusione positiva: dati assenti, non validi, incoerenti o errori impediscono di verificare lo snapshot."}</p>
<p>Questo report non legge i file attuali, non ne ricalcola l’impronta e non si aggiorna. Confrontare data e SHA-256 con l’ultima esecuzione prima di applicare proposte.</p>
<dl><dt>Generato il (dato dichiarato)</dt><dd>${escape(report.generatedAt)}</dd><dt>SHA-256 degli input (dichiarato, non ricalcolato)</dt><dd><code>${escape(report.inputDigest)}</code>${digest ? "" : " — non valido"}</dd></dl>
${table("File dello snapshot", ["Ruolo", "Percorso dichiarato"], FILE_KEYS.map((key) => `<tr><th scope="row">${key}</th><td><code>${escape(files[key] === null ? "Non fornito" : files[key])}</code></td></tr>`))}
${messages("Problemi di integrità", problems)}${messages("Errori di generazione", list(report.generationErrors))}${messages("Errori di audit", list(report.auditErrors))}${messages("Note", list(report.notes))}</section></details>
${cssDetails}<details><summary>Limiti delle verifiche e metodo</summary>
<section aria-labelledby="limiti"><h2 id="limiti">Limiti e metodo di lettura</h2>
<ul><li>Il comando di report verifica i colori calcolati nei browser indicati negli scenari. Le correzioni complete raggiungono le soglie delle coppie coperte, non di qualsiasi uso futuro.</li>
<li>Le sovrapposizioni libere sono simulazioni separate: segnalano rischi d’uso, non difetti accertati del sito. Un contrasto sufficiente non garantisce che due colori siano distinguibili per ogni persona: usa anche etichette, forme o icone.</li>
<li>Trasparenze, foto, gradienti, personalizzazioni CSS locali e stati non misurati richiedono una verifica nel componente reale. Il campione non certifica dimensioni, peso o contesto del testo.</li>
<li>Questo report non sostituisce un audit completo di accessibilità e non promette una palette esteticamente ottimale.</li></ul>
<p>Dettaglio di calcolo: rapporti WCAG 2.x in sRGB con canali clipped (limitati a 0–1), non letture dei pixel del display. La pagina HTML visualizza i risultati ricevuti e la loro provenienza: non esegue nuove misure né ricalcola i contrasti. Le differenze OKLCH/OKLab non sono una misura di contrasto né una ricerca globale della soluzione più vicina.</p></section></details></section></main>
<footer><p>Report autonomo e statico: nessuno script, risorsa di rete o framework. Validità circoscritta allo snapshot e alla sua impronta dichiarata.</p></footer>
</div></body></html>\n`;
}
