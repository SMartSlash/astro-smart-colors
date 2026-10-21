// Guided contrast workbench for the diagnostic preview.
//
// Build-time responsibilities:
// - `renderContrastWorkbench(session)` emits the guided workbench first: a compact horizontal
//   toolbar with the bounded source strip, a human current-use summary with a "Cambia uso" opener,
//   the comparison modes and the theme control, then the full-width comparison area with the visible
//   pair identity, the real CSS consumer specimens and their scoped results. The opener reveals a
//   native modal picker with search, a category filter and paginated real uses; a single contextual
//   correction/action strip follows the specimens. The native pairing select stays in the technical
//   disclosure as a fallback. The verbose source-palette archive (raw authored values, roles,
//   explicit/automatic dark blend, real `@property` declarations, full captured CSS and a manual
//   download) follows it inside a closed native detail. The legacy resolved-color gallery stays
//   elsewhere as a collapsed technical archive.
// - `CONTRAST_WORKBENCH_CSS` is presentation-only CSS that reuses the preview
//   tokens; it never paints an actual specimen. Specimens are real CSS consumer
//   frames rendered by the browser runtime with `var(--token)`.
//
// Browser responsibility:
// - `createContrastWorkbenchViewSource()` serializes the self-contained view
//   factory. It binds only to the frozen controller API and uses
//   `createElement`/`textContent`, never untrusted markup.
//
// Contract notes: the source palette is read-only input (roles and dark blend are
// not editable). Overrides are temporary public CSS tuning, not a rebuilt
// generator. Suggestions only come from the runtime; this module never invents a
// ratio, a pair or a colour distance.
import { createDesignerLanguage } from "./designer-language.mjs";
import { createDesignTools } from "./design-recipes.mjs";
import { colorCss, escape, list, record } from "./format-report-html.mjs";

const HOOK = "data-smart-colors-workbench";
const HOST_ID = "smart-colors-workbench";
// Primary use choices are paginated inside one native dialog. The category list is derived from the
// real diagnostic buckets, never invented, and the known labels are stable across the build and the
// browser view.
const USE_VISIBLE_LIMIT = 6;
const PICKER_CATEGORIES = Object.freeze([
  Object.freeze(["page", "Testo su pagina"]),
  Object.freeze(["callout", "Riquadri"]),
  Object.freeze(["button", "Pulsanti"]),
  Object.freeze(["border", "Bordi"]),
  Object.freeze(["focus", "Indicatore statico"]),
  Object.freeze(["other", "Altri usi"]),
]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

// Presentation-only chrome for the guided flow. It reuses the preview tokens, adds
// no paint of its own to the specimens and keeps native control chrome readable in
// forced-colors mode. The ordinary layout is driven by named container queries
// (`preview-section` for the bounded swatch strip, `wb-main` for the specimen pair),
// never by a viewport media query.
export const CONTRAST_WORKBENCH_CSS = `
@layer components {
  /* Quiet warm neutral chrome, black primary actions, no nested decorative boxes. */
  .wb-visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }

  /* The toolbar is the only selection surface: palette, pair, comparison and theme stay together. */
  .wb-workspace { min-width: 0; }
  .wb-toolbar { min-width: 0; padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper-soft); }
  .wb-toolbar-line { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2) var(--space-3); min-width: 0; }
  .wb-toolbar-line > * { min-width: 0; max-width: 100%; }
  .wb-toolbar-line + .wb-toolbar-line { margin-block-start: var(--space-2); padding-block-start: var(--space-2); border-block-start: 1px solid var(--line); }
  .wb-palette-line { align-items: center; }
  .wb-control-line { align-items: end; }
  .wb-source-select { flex: 1 1 13rem; min-width: 0; }
  .wb-pair-field { flex: 1 1 20rem; min-width: 0; }
  .wb-current-use { flex: 1 1 16rem; min-width: 0; display: grid; gap: .15rem; align-content: center; }
  .wb-current-use-label { font-size: var(--text-xs); font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
  .wb-current-use-value { margin: 0; font-size: var(--text-base); overflow-wrap: anywhere; }
  .wb-current-use-kind { margin-inline-start: var(--space-2); font-size: var(--text-xs); font-weight: 650; color: var(--ink-soft); }
  .wb-current-use-tech { display: block; font-size: var(--text-xs); overflow-wrap: anywhere; }
  .wb-open-picker { flex: 0 0 auto; min-height: 2.75rem; font: inherit; color: var(--paper); background: var(--ink); border: 1px solid var(--ink); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-3); cursor: pointer; }
  .wb-open-picker:hover { background: var(--ink-soft); }
  .wb-open-picker:disabled { cursor: not-allowed; opacity: .65; }

  /* Source swatches: compact horizontal chips with a 44px target and a bounded scroll strip. */
  .wb-swatch { display: grid; grid-template-columns: .9rem minmax(0, 1fr); grid-template-areas: "bar name"; align-items: center; gap: .4rem; width: auto; min-width: 8.5rem; max-width: 13rem; height: 44px; min-height: 44px; padding: 0 var(--space-2); font: inherit; text-align: start; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .wb-swatch-block { grid-area: bar; width: .9rem; height: 1.5rem; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--sample-color, var(--soft)); }
  .wb-swatch-name { grid-area: name; display: block; min-width: 0; font-size: var(--text-sm); font-weight: 650; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wb-swatch-mark { display: none; margin-inline-end: .35em; color: var(--ink); font-weight: 750; }
  .wb-swatch:hover { border-color: var(--ink-soft); }
  .wb-swatch:disabled { cursor: default; }
  .wb-swatch[aria-pressed="true"] { border-color: var(--ink); background: var(--soft); box-shadow: inset 0 0 0 1px var(--ink); }
  .wb-swatch[aria-pressed="true"] .wb-swatch-mark { display: inline; }

  /* Generated pairs: readable rows in the paginated picker. */
  .wb-use { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "main mark" "kind mark"; align-items: center; gap: 0 var(--space-2); width: 100%; min-height: 44px; padding: var(--space-1) var(--space-2); font: inherit; font-size: var(--text-sm); text-align: start; color: var(--ink); background: var(--paper); border: 1px solid var(--line); border-radius: var(--radius-sm); cursor: pointer; }
  .wb-use-main { grid-area: main; display: grid; gap: 1px; min-width: 0; }
  .wb-use-label { overflow-wrap: anywhere; }
  .wb-use-tech { font-size: var(--text-xs); color: var(--ink-muted); overflow-wrap: anywhere; }
  .wb-use-tech code { padding: 0; background: none; }
  .wb-use-kind { grid-area: kind; font-size: var(--text-xs); color: var(--ink-muted); }
  .wb-use:hover { border-color: var(--ink-soft); }
  .wb-use:disabled { cursor: default; }
  .wb-use[aria-pressed="true"] { border-color: var(--ink); background: var(--soft); font-weight: 650; }
  .wb-use-mark { grid-area: mark; display: none; color: var(--ink); }
  .wb-use[aria-pressed="true"] .wb-use-mark { display: inline; }
  .wb-uses-empty, .wb-uses-note { margin: 0; font-size: var(--text-sm); color: var(--ink-soft); }

  /* Native picker dialog: human search, category and paginated real uses. */
  .wb-picker-dialog { width: min(40rem, calc(100vw - 2rem)); max-width: 40rem; max-block-size: 90dvh; padding: 0; border: 1px solid var(--ink); border-radius: var(--radius); background: var(--paper); color: var(--ink); box-shadow: 0 1.5rem 3rem rgb(0 0 0 / .22); }
  .wb-picker-dialog::backdrop { background: color-mix(in oklab, var(--ink) 35%, transparent); }
  .wb-picker-panel { display: grid; grid-template-rows: auto auto auto minmax(0, 1fr) auto; gap: var(--space-2); max-block-size: 90dvh; padding: var(--space-3); overflow: hidden; }
  .wb-picker-header { display: grid; gap: var(--space-1); }
  .wb-picker-header h2 { margin: 0; font-size: var(--text-md); }
  .wb-picker-filters { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2); }
  .wb-picker-filters .wb-field { flex: 1 1 12rem; }
  .wb-picker-filters .wb-ghost { flex: 0 0 auto; }
  .wb-picker-count { margin: 0; font-size: var(--text-xs); color: var(--ink-soft); }
  .wb-picker-results { min-height: 0; overflow: auto; overscroll-behavior: contain; }
  .wb-picker-footer { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; justify-content: space-between; padding-block-start: var(--space-2); border-block-start: 1px solid var(--line); }
  .wb-picker-footer button { min-height: 2.75rem; font: inherit; color: var(--ink); background: var(--paper-soft); border: 1px solid var(--ink); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-3); cursor: pointer; }
  .wb-picker-footer button:hover { background: var(--soft); }
  .wb-picker-footer button[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
  .wb-picker-footer button:disabled { cursor: not-allowed; opacity: .65; }

  /* Comparison: identity first, then the full-width specimens and their compact results. */
  .wb-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-1) var(--space-2); }
  .wb-current { margin: 0; font-size: var(--text-md); }
  .wb-identity { margin: 0; font-size: var(--text-sm); color: var(--ink-soft); overflow-wrap: anywhere; }
  .wb-identity code { overflow-wrap: anywhere; }
  .wb-purpose { flex-basis: 100%; margin: 0; font-size: var(--text-sm); color: var(--ink-soft); }
  .wb-status { margin: 0; font-size: var(--text-sm); color: var(--ink-soft); }
  .wb-scope-note { margin: 0; font-size: var(--text-xs); color: var(--ink-muted); }
  .wb-view-title { font-size: var(--text-base); }
  .wb-ratio { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2); margin: 0; }
  .wb-ratio-value { font-size: var(--text-lg); font-weight: 750; font-variant-numeric: tabular-nums; }
  .wb-verdict { font-size: var(--text-sm); font-weight: 750; }
  .wb-verdict[data-status="pass"], .wb-verdict[data-status="below-target"] { color: var(--ink); }
  .wb-verdict[data-status="below-minimum"] { color: var(--ink); }
  .wb-verdict[data-status="unmeasured"] { color: var(--ink-muted); }
  .wb-coverage { display: block; margin-block-start: var(--space-1); font-size: var(--text-xs); color: var(--ink-muted); }
  .wb-ghost { font: inherit; font-size: var(--text-sm); color: var(--ink-soft); background: none; border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); min-height: 2.25rem; cursor: pointer; }
  .wb-ghost:hover { color: var(--ink); border-color: var(--ink-soft); }

  /* Source palette archive (read-only details) */
  .wb-source-list { display: grid; gap: var(--space-3); list-style: none; padding: 0; margin-block: var(--space-3); }
  .wb-source-item { padding-block: var(--space-3); border-block-start: 1px solid var(--line); min-width: 0; }
  .wb-source-item:first-child { border-block-start: 0; padding-block-start: 0; }
  .wb-source-head { font-size: var(--text-sm); font-weight: 700; margin-block-end: var(--space-2); }
  .wb-source-value { display: block; font-size: var(--text-sm); margin-block-end: var(--space-2); }
  .wb-declaration { display: block; overflow-x: auto; padding: var(--space-2); border: 1px dashed var(--ink-muted); border-radius: var(--radius-sm); background: var(--paper-soft); font-size: var(--text-xs); white-space: pre-wrap; overflow-wrap: anywhere; }
  .wb-source-copy { margin-block-start: var(--space-3); }
  .wb-source-copy textarea, .wb-suggestions textarea { width: 100%; min-height: 8rem; font: inherit; font-size: var(--text-sm); color: var(--ink); background: var(--paper); border: 1px solid var(--ink-muted); border-radius: var(--radius); padding: var(--space-2); }

  .wb-selection { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-3); margin: 0; padding: 0; }
  .wb-compare { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-2) var(--space-4); flex: 1 1 auto; min-width: 0; max-width: 100%; margin: 0; padding: 0; border: 0; }
  .wb-compare .wb-fieldset { flex: 1 1 12rem; min-width: 0; max-width: 100%; padding: 0; gap: var(--space-1) var(--space-3); border: 0; }
  .wb-compare .wb-theme-fieldset { flex: 0 1 auto; }
  .wb-compare .wb-fieldset legend { font-size: var(--text-xs); font-weight: 750; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-soft); }
  .wb-compare .wb-fieldset label { min-height: 1.75rem; }
  /* The theme control stays form-associated with the selection form via the form attribute. */
  .wb-theme-fieldset { flex: 0 1 auto; min-width: 0; max-width: 100%; display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin: 0; padding: 0; border: 0; }
  .wb-field { display: grid; gap: .3rem; min-width: 0; }
  .wb-field > label { font-size: var(--text-sm); font-weight: 650; }
  .wb-field input, .wb-field select { width: 100%; min-width: 0; max-width: 100%; min-height: 2.75rem; font: inherit; color: var(--ink); background: var(--paper); border: 1px solid var(--ink-muted); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-2); }
  .wb-fieldset { flex: 1 1 12rem; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin: 0; padding: var(--space-2) 0; border: 0; border-block-start: 1px solid var(--line); }
  .wb-fieldset legend { padding: 0; font-size: var(--text-sm); font-weight: 650; }
  .wb-fieldset label { display: inline-flex; align-items: center; gap: .35rem; min-height: 2rem; font-size: var(--text-sm); }
  .wb-details { padding-block: var(--space-2); }
  .wb-thresholds { display: grid; gap: var(--space-1); font-size: var(--text-sm); margin-block: var(--space-2); }
  .wb-thresholds div { display: grid; grid-template-columns: minmax(8rem, auto) minmax(0, 1fr); gap: var(--space-2); }
  .wb-thresholds dt { font-weight: 650; }
  .wb-controls, .wb-suggestions { padding-block: var(--space-2); }
  .wb-control-grid { display: grid; gap: var(--space-3); }
  .wb-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-block: var(--space-2); }
  .wb-actions button { min-height: 2.75rem; font: inherit; color: var(--ink); background: var(--paper-soft); border: 1px solid var(--ink); border-radius: var(--radius-sm); padding: var(--space-1) var(--space-3); cursor: pointer; }
  .wb-actions button:hover { background: var(--soft); }
  .wb-actions button:disabled { cursor: not-allowed; opacity: .65; }
  /* Black primary: the three contextual actions that change or accept a correction. */
  .wb-actions button[data-smart-colors-workbench="suggest-foreground"],
  .wb-actions button[data-smart-colors-workbench="suggest-background"],
  .wb-actions button[data-smart-colors-workbench="apply"] { color: var(--paper); background: var(--ink); }
  .wb-actions button[data-smart-colors-workbench="suggest-foreground"]:hover,
  .wb-actions button[data-smart-colors-workbench="suggest-background"]:hover,
  .wb-actions button[data-smart-colors-workbench="apply"]:hover { background: var(--ink-soft); }
  .wb-actions .wb-download { display: inline-flex; align-items: center; min-height: 2.75rem; padding: var(--space-1) var(--space-3); border: 1px solid var(--ink); border-radius: var(--radius-sm); font-weight: 650; }

  /* One contextual action strip below the specimens: state, actions, proposal and frames. */
  .wb-action-strip { padding: var(--space-3); border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); }
  .wb-strip-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-1) var(--space-3); }
  .wb-strip-head h3 { margin: 0; }
  .wb-strip-head .wb-action-theme { margin: 0; }
  .wb-proposal[hidden] { display: none; }
  .wb-proposal { margin-block: var(--space-2) 0; padding-inline-start: var(--space-3); border-inline-start: .3rem solid var(--line); font-size: var(--text-sm); }
  .wb-proposal-title { font-weight: 750; }
  .wb-proposal-value { display: block; margin-block: var(--space-2); padding: var(--space-2); border: 1px dashed var(--ink-muted); border-radius: var(--radius-sm); background: var(--paper-soft); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .wb-proposal-frames { padding-block-start: var(--space-3); border-block-start: 1px solid var(--line); }
  .wb-proposal-frames > h4 { grid-column: 1 / -1; margin-block-end: var(--space-2); }
  /* The proposal frames are the exact fixed verification viewport (360x480). On a narrow host the
     frame is intentionally wider than its column: scroll locally instead of clipping it or resizing
     the measured viewport. Scoped to the proposal containers only; the main views keep clipping. */
  .wb-proposal-frames .wb-frame { overflow: auto; overscroll-behavior: contain; background: var(--soft); }
  .wb-proposal-frames .wb-frame iframe { margin-inline: auto; box-shadow: 0 0 0 1px var(--line); }
  .wb-catalogue { padding-inline-start: 1.2rem; font-size: var(--text-sm); color: var(--ink-soft); }
  .wb-catalogue li { margin-block: var(--space-1); max-width: none; }
  /* Criterion reference: a closed native detail, never a banner of universal compliance. */
  .wb-criteria-list { display: grid; gap: var(--space-1); margin: var(--space-2) 0 0; font-size: var(--text-sm); }
  .wb-criteria-list > div { display: grid; grid-template-columns: minmax(9rem, auto) minmax(0, 1fr); gap: var(--space-2); }
  .wb-criteria-list dt { font-weight: 650; }
  .wb-criteria-list dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .wb-action-theme { margin: 0; font-size: var(--text-sm); color: var(--ink-soft); }

  /* Compact per-frame results: ratio, criterion and target stay scannable. */
  .wb-measure { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr)); gap: 0 var(--space-4); margin-block: var(--space-1) 0; font-size: var(--text-xs); align-self: start; }
  .wb-measure > .wb-measure-row { grid-column: 1 / -1; }
  .wb-measure > .wb-threshold { grid-column: auto; display: block; }
  .wb-measure-row { display: grid; grid-template-columns: minmax(6rem, auto) minmax(0, 1fr); gap: var(--space-1) var(--space-2); max-width: none; padding-block: 1px; }
  .wb-measure-row dt { font-weight: 650; }
  .wb-measure-row dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
  .wb-threshold { max-width: none; }
  .wb-nojs { font-size: var(--text-sm); color: var(--ink-soft); }
  .wb-frame { min-height: 7rem; border: 1px solid var(--line); border-radius: var(--radius); background: var(--paper); overflow: hidden; }
  .wb-frame iframe { display: block; width: 100%; min-height: 7rem; border: 0; }
}
@layer layout {
  /* A single full-width workspace: toolbar above, specimens and action strip below. */
  .wb-workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--space-3); align-items: start; }
  .wb-main { display: grid; gap: var(--space-2); align-content: start; min-width: 0; container-name: wb-main; container-type: inline-size; }
  /* The shell's generic header rule must not paint the nested workbench identity as a page header. */
  .wb-head { padding-block-end: var(--space-1); border-block-end: 1px solid var(--line); }
  /* Narrow: one native source select. Desktop: the compact horizontal swatch strip. */
  .wb-palette { display: none; flex: 1 1 28rem; gap: var(--space-1); margin: 0; padding: 0 0 var(--space-1); list-style: none; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: thin; }
  .wb-palette > li { flex: none; }
  .wb-source-select { min-width: 0; }
  .wb-palette-label { display: none; flex: 0 0 auto; font-size: var(--text-sm); font-weight: 650; color: var(--ink-soft); }
  .wb-control-line .wb-compare { flex: 1 1 26rem; }
  .wb-uses { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
  /* Two full-width specimens when the workbench itself is wide enough; stacked on mobile. */
  .wb-frames { display: grid; gap: var(--space-2); grid-template-columns: minmax(0, 1fr); align-items: stretch; margin-block-start: var(--space-1); }
  .wb-frames[hidden] { display: none; }
  .wb-proposal-frames[hidden] { display: none; }
  .wb-action-strip [hidden] { display: none; }
  .wb-view { display: grid; grid-template-rows: auto auto 1fr; align-content: start; gap: var(--space-1); min-width: 0; }
  .wb-frames:not(.wb-proposal-frames) .wb-frame iframe { block-size: 18rem; }
  @container wb-main (min-width: 40rem) {
    .wb-frames:not(.wb-proposal-frames) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .wb-frames:not(.wb-proposal-frames) .wb-frame iframe { block-size: 15rem; }
  }
  /* The fixed 360x480 proposal frames sit side by side only when the workbench itself can hold two
     of them. Below that width they stay stacked and each container scrolls locally. */
  @container wb-main (min-width: 48rem) {
    .wb-proposal-frames { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @container preview-section (min-width: 45rem) {
    .wb-palette-label { display: block; }
    .wb-palette { display: flex; }
    /* Desktop uses the visible swatch strip as the source control. The native select is removed
       from layout and the tab order entirely; it is not an invisible focus stop. */
    .wb-source-select { display: none; }
  }
}
@layer preferences {
  @media (forced-colors: active) {
    .wb-toolbar, .wb-swatch, .wb-use, .wb-details, .wb-controls, .wb-suggestions, .wb-action-strip, .wb-frame, .wb-field input, .wb-field select, .wb-fieldset, .wb-source-copy textarea, .wb-suggestions textarea, .wb-picker-dialog { border: 1px solid CanvasText; }
    .wb-actions button, .wb-ghost, .wb-open-picker, .wb-picker-footer button { border: 1px solid ButtonText; color: ButtonText; background: ButtonFace; }
    .wb-swatch[aria-pressed="true"], .wb-use[aria-pressed="true"] { border-color: Highlight; background: HighlightText; color: Highlight; }
    .wb-swatch-mark, .wb-use-mark { color: Highlight; }
  }
  @media print {
    .wb-workspace { display: block; }
    .wb-actions, .wb-controls, .wb-suggestions, .wb-selection { break-inside: avoid; }
    .wb-frame { min-height: 4rem; }
    .wb-picker-dialog { display: none; }
  }
}
`;

// A source value may reach a scoped `--sample-color` custom property. Keep it to a
// colour-like literal: no semicolon, brace, quote, resource reference or function
// other than the colour functions the generator emits. The source swatch is
// explicitly labelled as the raw authored value, never as the live rendering.
function sourceColor(value) {
  const candidate = text(value);
  if (!candidate || candidate.length > 180) return null;
  if (!/^(#|oklch|oklab|rgb|rgba|hsl|hsla|hwb|lab|lch|color)\(?/i.test(candidate) && !/^#[0-9a-f]{3,8}$/i.test(candidate)) return null;
  if (/[;"'<>{}\\]|url\(|expression\(|@import/i.test(candidate)) return null;
  return candidate;
}

function sourceMix(design, entry, tools) {
  const sources = design && Array.isArray(design.sources) ? design.sources : [];
  const match = sources.find((source) => record(source) && source.token === entry.token) || null;
  if (match && record(match.darkMix)) return match.darkMix;
  if (finite(entry.darkBlend) && tools && typeof tools.darkBlendMix === "function") return tools.darkBlendMix(entry.darkBlend);
  return null;
}

function darkBlendLine(design, entry, tools) {
  const mix = sourceMix(design, entry, tools);
  const label = entry.darkBlend == null ? "dark-blend automatico" : `dark-blend ${entry.darkBlend}`;
  if (!mix || !finite(mix.sourcePercent) || !finite(mix.whitePercent)) return label;
  const explicit = entry.darkBlend == null ? "" : " · esplicito";
  return `${label} → source ${mix.sourcePercent}% / white ${mix.whitePercent}%${explicit}`;
}

// The exact source object lives in the additive `session.paletteSource`; `session.palette` stays the
// legacy array the static report validates. A legacy session with no `paletteSource` is served from
// the legacy array (parsed authored values only) — never with an invented `value`/`declaration`. The
// tolerant object check also accepts an early transitional `palette` object so a coordinated rollout
// cannot lose the captured bytes, but the canonical field name is `paletteSource`.
function paletteModel(session) {
  const value = record(session) ? session : {};
  const additive = record(value.paletteSource) ? value.paletteSource : null;
  const legacyPalette = value.palette;
  const object = additive || (record(legacyPalette) && Array.isArray(legacyPalette.sources) ? legacyPalette : null);
  const captured = object && Array.isArray(object.sources) ? object.sources : null;
  const css = object && typeof object.css === "string" ? object.css : null;
  const path = object && typeof object.path === "string" ? object.path : null;
  const sha256 = object && typeof object.sha256 === "string" ? object.sha256 : null;
  const legacy = Array.isArray(legacyPalette) ? legacyPalette : null;
  return { captured, css, path, sha256, legacy, object };
}

function designSource(design, token) {
  const sources = design && Array.isArray(design.sources) ? design.sources : [];
  return sources.find((source) => record(source) && source.token === token) || null;
}

// Effective role per token from the configured identities (`paletteName` keyed). This is NEVER used
// to overwrite the declared `@property` role: the publication keeps the declared role authoritative
// and shows the effective role as a separate, explicitly labelled fact when it differs.
function identityRoleByToken(session) {
  const roles = record(session) && record(session.roles) ? session.roles : null;
  const map = new Map();
  for (const identity of list(roles && roles.identities)) {
    if (!record(identity)) continue;
    const paletteName = text(identity.paletteName);
    const role = text(identity.role);
    if (paletteName && role) map.set(paletteName, role);
  }
  return map;
}

function sourceCatalogue(session, design, tools) {
  const model = paletteModel(session);
  const identityRole = identityRoleByToken(session);
  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    const token = text(entry.token);
    if (!token || seen.has(token)) return;
    seen.add(token);
    const binding = designSource(design, token);
    // `declared` is what the source publication states (captured `@property` annotation, or the
    // legacy annotation when the palette arrived as an array). `effective` is the configured identity
    // role. They are kept separate so the UI can never present the config role as authored.
    const declaredRole = text(entry.role) || null;
    const effectiveRole = identityRole.get(token) || (binding && text(binding.role)) || null;
    entries.push({
      token,
      value: text(entry.value) || null,
      declaredRole,
      effectiveRole,
      name: binding && text(binding.name) ? binding.name : null,
      darkBlend: Number.isFinite(Number(entry.darkBlend)) && entry.darkBlend !== null && entry.darkBlend !== ""
        ? Number(entry.darkBlend)
        : (binding && Number.isFinite(Number(binding.darkBlend)) && binding.darkBlend !== null ? Number(binding.darkBlend) : null),
      declaration: text(entry.declaration) || null,
      // `captured` = exact bytes from `paletteSource`; `legacy` = a parsed authored triple from the
      // legacy array (real evidence, but not the exact source text); `missing` = no value at all.
      origin: entry.origin === "captured" ? "captured" : entry.origin === "legacy" ? "legacy" : "missing",
    });
  };
  if (model.captured) {
    for (const entry of model.captured) {
      if (!record(entry)) continue;
      add({ token: entry.token, value: entry.value, role: entry.role, darkBlend: entry.darkBlend, declaration: entry.declaration, origin: "captured" });
    }
  } else if (model.legacy) {
    for (const entry of model.legacy) {
      if (!record(entry)) continue;
      add({
        token: entry.name,
        value: colorCss(entry.authored),
        role: entry.role,
        darkBlend: entry.darkBlend,
        declaration: null,
        origin: "legacy",
      });
    }
  }
  // Design sources add names, roles and automatic mixes when the palette block did
  // not capture them. They never replace a captured value or declaration.
  if (design && Array.isArray(design.sources)) {
    for (const entry of design.sources) {
      if (!record(entry)) continue;
      add({ token: entry.token, value: null, role: entry.role, darkBlend: entry.darkBlend, declaration: null });
    }
  }
  return { ...model, entries, tools };
}

function darkBlendRolesHtml(design, tools) {
  if (!design || !Array.isArray(design.sources)) return "";
  const items = design.sources.map((source) => {
    if (!record(source)) return "";
    const mix = record(source.darkMix) ? source.darkMix : (tools && finite(source.darkBlend) ? tools.darkBlendMix(source.darkBlend) : null);
    if (!record(mix) || !finite(mix.sourcePercent) || !finite(mix.whitePercent)) return "";
    const blend = source.darkBlend == null ? "adattivo" : String(source.darkBlend);
    return `<li><code>${escape(source.token)}</code> · ${escape(source.role ?? "ruolo non indicato")} · dark-blend ${escape(blend)} → source ${escape(String(mix.sourcePercent))}% / white ${escape(String(mix.whitePercent))}%</li>`;
  }).filter(Boolean);
  if (!items.length) return "";
  // Compact role roll-up inside a detail: the per-source rows above already carry the
  // same blend, so this stays secondary instead of duplicating the main entry.
  return `<details class="is-detail"><summary>dark-blend per ruolo</summary>
<p class="margin-note">Regola di progetto 10/90 (source↔white), non una soglia WCAG.</p>
<ul class="dark-blend-list">${items.join("")}</ul></details>`;
}

function paletteProvenance(model, session) {
  if (model.path || model.sha256) {
    const path = model.path ? `<code>${escape(model.path)}</code>` : "percorso non indicato";
    const sha = model.sha256 ? `<code>${escape(model.sha256.slice(0, 12))}</code>` : "SHA-256 non indicato";
    return `<p class="margin-note">Palette catturata: ${path} · impronta ${sha}. Il contenuto è la copia esatta dei byte letti.</p>`;
  }
  const files = record(session.files) ? session.files : {};
  const inputs = Array.isArray(session.inputs) ? session.inputs : [];
  const palette = inputs.find((item) => record(item) && item.name === "palette") || null;
  if (text(files.palette) || (palette && text(palette.sha256))) {
    const path = text(files.palette) ? `<code>${escape(files.palette)}</code>` : "percorso non indicato";
    const sha = palette && text(palette.sha256) ? `<code>${escape(palette.sha256.slice(0, 12))}</code>` : "SHA-256 non indicato";
    return `<p class="margin-note">Palette dichiarata: ${path} · impronta ${sha}. In questa sessione non è incorporata la copia completa del sorgente.</p>`;
  }
  return `<p class="margin-note">Provenienza della palette non disponibile in questa sessione.</p>`;
}

function sourcePaletteHtml(session, design, tools, language) {
  const model = sourceCatalogue(session, design, tools);
  const items = model.entries.map((entry) => {
    const color = sourceColor(entry.value);
    const swatch = color
      ? `<span class="variant-swatch" aria-hidden="true" style="--sample-color:${escape(color)}"></span>`
      : "";
    // Exact captured bytes vs a parsed legacy triple vs no evidence at all: the label always says
    // which one it is, so a fallback is never presented as the authored source text.
    const value = entry.origin === "captured" && entry.value
      ? `<span class="wb-source-value">${swatch}Valore sorgente dichiarato: <code>${escape(entry.value)}</code> <span class="margin-note">(valore grezzo, non la resa live)</span></span>`
      : entry.origin === "legacy" && entry.value
        ? `<span class="wb-source-value">${swatch}Valore autore risolto dal parser: <code>${escape(entry.value)}</code> <span class="margin-note">(i byte esatti del sorgente non sono disponibili in questa sessione)</span></span>`
        : `<span class="wb-source-value">${swatch}Valore sorgente non disponibile in questa sessione.</span>`;
    // Declared role first (authoritative), effective config role second only when it differs.
    const declared = entry.declaredRole ? `ruolo dichiarato: ${language.roleLabel(entry.declaredRole)}` : "ruolo dichiarato: non indicato";
    const effective = entry.effectiveRole && entry.effectiveRole !== entry.declaredRole
      ? ` · ruolo effettivo (config): ${language.roleLabel(entry.effectiveRole)}`
      : "";
    const declaration = entry.declaration
      ? `<code class="wb-declaration">${escape(entry.declaration)}</code>`
      : `<span class="margin-note">Dichiarazione <code>@property</code> non disponibile in questa sessione; nessuna dichiarazione viene ricostruita.</span>`;
    return `<li class="wb-source-item">
<p class="wb-source-head"><code>${escape(entry.token)}</code> · ${escape(declared)}${escape(effective)}${entry.name && entry.name !== entry.token ? ` · <span class="margin-note">nome ${escape(entry.name)}</span>` : ""}</p>
${value}
<p class="margin-note">${escape(darkBlendLine(design, entry, tools))}</p>
${declaration}
</li>`;
  }).filter(Boolean);
  const listHtml = items.length
    ? `<ul class="wb-source-list">${items.join("")}</ul>`
    : `<p>Nessuna sorgente palette disponibile: il banco non inventa sorgenti.</p>`;
  const fullCss = model.css;
  const download = fullCss
    ? `<a class="wb-download" download="palette.css" href="data:text/css;charset=utf-8,${escape(encodeURIComponent(fullCss))}">Scarica palette.css (azione manuale)</a>`
    : "";
  const sourceCopy = fullCss
    ? `<details class="is-detail wb-source-copy"><summary>Copia completa del CSS sorgente (${fullCss.length} caratteri)</summary>
<label for="smart-colors-workbench-palette-source">Sorgente completo, selezionabile senza permessi clipboard</label>
<textarea id="smart-colors-workbench-palette-source" data-smart-colors-workbench="palette-source" readonly rows="10">${escape(fullCss)}</textarea>
<div class="wb-actions"><button type="button" id="smart-colors-workbench-copy-palette" data-smart-colors-workbench="copy-palette">Seleziona il sorgente</button>${download}</div>
<p class="margin-note">Il download è manuale: aprire l'anteprima non scrive file.</p></details>`
    : `<p class="margin-note">Copia completa non disponibile in questa sessione. Il download non viene simulato.</p>`;
  return `<section id="palette" aria-labelledby="palette-titolo"><h2 id="palette-titolo">Palette sorgente e ruoli</h2>
<p class="lede">Valori sorgente del file di palette, ruoli e dark-blend di sola lettura. La scelta avviene dalla barra dei colori; qui resta l'archivio esatto dei byte.</p>
<details class="is-detail wb-palette-details"><summary>Dettagli tecnici della palette sorgente</summary>
${paletteProvenance(model, session)}
${listHtml}
${darkBlendRolesHtml(design, tools)}
${sourceCopy}
</details></section>`;
}

function diagnosticPairs(session) {
  const values = [];
  const model = record(session.model) ? session.model : {};
  for (const item of list(model.diagnostics)) values.push(item);
  for (const sample of list(session.samples)) {
    if (!record(sample)) continue;
    for (const item of list(sample.diagnostics)) values.push(item);
  }
  return values.filter(record);
}

function pairProperty(item) {
  if (item.kind !== "non-text") return "color";
  if (/focus-ring/.test(String(item.foregroundToken))) return "outlineColor";
  if (/border/.test(String(item.foregroundToken))) return "borderColor";
  return "ui";
}

// Shared pure classifier: which semantic use a pair represents. It reads only the CSS property, the
// pair kind and the token names, never a ratio, so a failing pair is ranked like any other. The
// result is serialized per option (`data-use-bucket`/`data-use-rank`) so the browser view can rank and
// diversify the primary choices without duplicating these rules.
const USE_RANK = { page: 10, button: 20, callout: 30, border: 40, focus: 50, other: 60 };

function classifyUse(kind, property, foreground, background) {
  const fg = String(foreground || "");
  const bg = String(background || "");
  const prop = String(property || "color");
  if (prop === "outlineColor" || /focus-ring/.test(fg)) return "focus";
  if (prop === "borderColor" || /(^|-)border(-strong)?$/.test(fg)) return "border";
  if (/(^|-)solid(-hover|-text)?$/.test(fg) || /(^|-)solid(-hover)?$/.test(bg) || /--color-control-/.test(fg) || /--color-control-/.test(bg)) return "button";
  if (/(^|-)surface(-strong)?$/.test(bg) || /(^|-)ink$/.test(fg)) return "callout";
  if (kind === "non-text") return "other";
  return "page";
}

function statusRank(status) {
  if (status === "below-minimum") return 0;
  if (status === "below-target") return 1;
  if (status === "pass") return 2;
  return 3;
}

function worse(existing, next) {
  if (!existing) return next;
  const existingMeasured = finite(existing.ratio);
  const nextMeasured = finite(next.ratio);
  if (nextMeasured && (!existingMeasured || next.ratio < existing.ratio)) return next;
  return existing;
}

function pairCatalogue(session, design, language) {
  const pairs = new Map();
  for (const item of diagnosticPairs(session)) {
    const theme = item.scheme === "dark" ? "dark" : item.scheme === "light" ? "light" : null;
    const foreground = text(item.foregroundToken);
    const background = text(item.backgroundToken);
    if (!theme || !foreground || !background) continue;
    const property = pairProperty(item);
    const key = `${foreground}|${background}|${item.kind === "non-text" ? "non-text" : "text"}`;
    let pair = pairs.get(key);
    if (!pair) {
      const kind = item.kind === "non-text" ? "non-text" : "text";
      const useBucket = classifyUse(kind, property, foreground, background);
      pair = {
        key,
        foreground,
        background,
        kind,
        // The original catalogue kind (for example `on-color`) is preserved separately. `kind` stays
        // the coarse text/non-text identity used for the pair key; the UI never infers a WCAG use
        // from a numeric threshold, so the catalogue kind must survive to the option.
        catalogueKind: item.kind === "on-color" ? "on-color" : isOnColorPair(foreground, background) ? "on-color" : (text(item.kind) || kind),
        property,
        title: language.pairTitle(foreground, background, property),
        sources: pairSources(design, foreground, background),
        foregroundSources: tokenSources(design, foreground),
        backgroundSources: tokenSources(design, background),
        useBucket,
        useRank: USE_RANK[useBucket],
        themes: { light: null, dark: null },
      };
      pairs.set(key, pair);
    }
    const diagnostic = {
      id: `${theme}|${property}|${foreground}|${background}`,
      minimum: finite(item.minimum) ? item.minimum : null,
      target: finite(item.target) ? item.target : null,
      ratio: finite(item.ratio) ? item.ratio : null,
      status: text(item.status) || "unmeasured",
      label: text(item.label),
    };
    pair.themes[theme] = worse(pair.themes[theme], diagnostic);
  }
  return [...pairs.values()].sort((a, b) => {
    const aStatus = worstStatus(a);
    const bStatus = worstStatus(b);
    return statusRank(aStatus) - statusRank(bStatus) || a.title.localeCompare(b.title, "it");
  });
}

function worstStatus(pair) {
  const themes = [pair.themes.light, pair.themes.dark].filter(Boolean);
  if (!themes.length) return "unmeasured";
  return themes.reduce((worst, item) => statusRank(item.status) < statusRank(worst) ? item.status : worst, themes[0].status);
}

function pairSources(design, foreground, background) {
  const sources = [];
  for (const token of [foreground, background]) {
    for (const source of tokenSources(design, token)) if (!sources.includes(source)) sources.push(source);
  }
  return sources;
}

// Sources declared for ONE token binding (one side of a pair). Keeping the two sides separate lets
// the guided picker prefer foreground uses, so a shared background dependency (for example the
// canvas) cannot dump the whole catalogue into the "where do you use it" list.
function tokenSources(design, token) {
  const binding = design && record(design.tokens) ? design.tokens[token] : null;
  if (!record(binding) || !Array.isArray(binding.sources)) return [];
  const sources = [];
  for (const source of binding.sources) if (text(source) && !sources.includes(source)) sources.push(source);
  return sources;
}

function pairRecipe(design, token) {
  if (!design || !record(design.tokens)) return null;
  const binding = record(design.tokens[token]) ? design.tokens[token] : null;
  if (!binding) return null;
  const recipe = text(binding.recipe);
  if (!recipe) return null;
  const shared = record(design.recipes) && record(design.recipes[recipe]) ? design.recipes[recipe] : null;
  return { recipe, kind: shared && text(shared.kind) ? shared.kind : null, usage: shared && text(shared.usage) ? shared.usage : null };
}

function cssBytesText(session) {
  const css = record(session.css) ? session.css : {};
  if (css.status === "stale") return "output non aggiornato (stale)";
  if (css.source === "generated-candidate") return "candidato generato (diagnostico), non output";
  if (css.status === "absent") return "output assente: byte candidati";
  if (css.status === "empty") return "output vuoto: nessun byte utilizzabile";
  if (css.source === "output") return "output attuale del progetto";
  return "provenienza CSS non indicata";
}

function generatorNote(session) {
  const css = record(session.css) ? session.css : {};
  if (css.status === "stale") {
    return "Stato: output non aggiornato (stale). Le misure riguardano i byte catturati; la ricetta descritta è il rationale iniziale del generatore, non la formula attiva dei byte correnti.";
  }
  if (css.source === "generated-candidate") {
    return "Stato: candidato generato (diagnostico), non output; le misure riguardano un candidato generato, non un file di output.";
  }
  if (css.status === "absent" || css.status === "empty") {
    return "Stato: nessun output utilizzabile; le misure riguardano i byte catturati o il candidato.";
  }
  return "Le misure riguardano i byte CSS catturati.";
}

function minimoTarget(minimum, target) {
  if (finite(minimum) && finite(target) && minimum === target) return `Soglia ${formatNumber(minimum)}:1`;
  return `Minimo ${finite(minimum) ? `${formatNumber(minimum)}:1` : "non dichiarato"} · target ${finite(target) ? `${formatNumber(target)}:1` : "non dichiarato"}`;
}

function formatNumber(value) {
  if (!finite(value)) return "non misurato";
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

// The snippet uses the pair's real CSS property: `color` for text, `border`/`outline` (with the
// width the indicator needs) for a border or focus token, plus the background it is measured against.
// Border and outline samples need the padded surface wrapper: their outer edge / offset ring lives
// outside the specimen box, so the wrapper paints the measured background around the whole geometry.
// This mirrors the runtime specimen (`padding: 12px`, same background on wrapper and specimen).
function pairSnippet(foreground, background, property) {
  const fg = `var(${foreground})`;
  const bg = `var(${background})`;
  if (property === "borderColor") {
    return `border: 2px solid ${fg};\nbackground-color: ${bg};\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class="specimen" role="img" aria-label="Campione statico del bordo"> */\n.surface {\n  padding: 12px;\n  background: ${bg};\n  border-radius: 8px;\n}`;
  }
  if (property === "outlineColor") {
    return `outline: 3px solid ${fg};\noutline-offset: 2px;\nbackground-color: ${bg};\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class="specimen" role="img" aria-label="Campione statico dell'anello"> */\n.surface {\n  padding: 12px;\n  background: ${bg};\n  border-radius: 8px;\n}`;
  }
  return `color: ${fg};\nbackground-color: ${bg};`;
}

// Human kind of a catalogue pair. The exact token identity stays visible in the main area; this
// label only names what the specimen geometry is, never a compliance claim.
function pairKindLabel(pair) {
  if (!pair || pair.kind !== "non-text") {
    return pair && pair.catalogueKind === "on-color" ? "testo su riempimento" : "testo";
  }
  return /focus-ring/.test(String(pair.foreground)) ? "anello" : "bordo";
}

// The catalogue kind for an on-color pair is a token-shape fact, never a numeric threshold: the same
// pair geometry is used by `verification-core` (`<family>-ink` on `<family>`, or `solid-text` on a
// solid fill). It only decides which specimen copy applies; it does not change the criterion.
function isOnColorPair(foreground, background) {
  const fg = String(foreground || "");
  const bg = String(background || "");
  if (/^--color-.+-ink$/.test(fg)) return bg === fg.replace(/-ink$/, "");
  if (/^--color-.+-solid-text$/.test(fg)) {
    const family = fg.replace(/-solid-text$/, "");
    return new RegExp("^" + family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(solid|solid-hover)$").test(bg);
  }
  return false;
}

function pairIdentityHtml(pair) {
  if (!pair) return "Nessuna coppia selezionata.";
  return `<code>${escape(pair.foreground)}</code> su <code>${escape(pair.background)}</code> · ${escape(pairKindLabel(pair))}`;
}

function pairPurposeText(pair) {
  if (!pair) return "Scegli una coppia dal catalogo generato per leggere il criterio applicato.";
  if (pair.kind === "non-text") {
    return "Componente non testuale · soglia 3:1 (SC 1.4.11) per le informazioni necessarie a identificare componenti e stati; un bordo decorativo non è automaticamente soggetto. Il campione statico non verifica focus, comportamento, visibilità o oscuramento.";
  }
  if (pair.catalogueKind === "on-color") {
    return "Testo su riempimento · soglia AA 4,5:1 (SC 1.4.3). L'etichetta del campione è da 16 px.";
  }
  return "Testo normale · soglia AA 4,5:1 (SC 1.4.3). Il corpo del campione è da 16 px.";
}

// Source/recipe/control metadata for one token of the selected pair. The declared role stays the
// authored fact; a differing configured role is shown under its own explicit label. The recipe is
// labelled as the generator's initial rationale, never as the active formula of current bytes.
function tokenBindingHtml(token, label, design, language, theme, sourceEntries) {
  const binding = design && record(design.tokens) && record(design.tokens[token]) ? design.tokens[token] : null;
  const recipe = pairRecipe(design, token);
  const usage = binding && text(binding.usage) ? binding.usage : recipe && recipe.usage ? recipe.usage : "uso non dichiarato";
  const sources = binding && Array.isArray(binding.sources) ? binding.sources.filter((item) => text(item)) : [];
  // The authored role belongs to the palette source, not to the semantic token. Show it next to the
  // source it belongs to; never substitute the configured role for the declared one.
  const sourceLabels = sources.map((source) => {
    const meta = designSource(design, source);
    const sourceEntry = sourceEntries.find((item) => item.token === source) || null;
    const facts = [];
    if (meta && text(meta.name)) facts.push(`nome ${meta.name}`);
    if (sourceEntry && sourceEntry.declaredRole) {
      facts.push(`ruolo dichiarato: ${language.roleLabel(sourceEntry.declaredRole)}`);
      if (sourceEntry.effectiveRole && sourceEntry.effectiveRole !== sourceEntry.declaredRole) {
        facts.push(`ruolo effettivo (config): ${language.roleLabel(sourceEntry.effectiveRole)}`);
      }
    } else if (sourceEntry && sourceEntry.effectiveRole) {
      facts.push(`ruolo effettivo: ${language.roleLabel(sourceEntry.effectiveRole)}`);
    }
    return facts.length ? `${source} (${facts.join(" · ")})` : source;
  });
  const ownEntry = sourceEntries.find((item) => item.token === token) || null;
  const ownRole = ownEntry && ownEntry.declaredRole ? ` · ruolo dichiarato del token: ${language.roleLabel(ownEntry.declaredRole)}` : "";
  const controls = controlsFor(design, token, theme).map((control) => {
    if (control.kind === "override") return `<code>${escape(control.control)}</code> override completo`;
    const percent = control.defaultMix == null ? "" : ` (default ${formatNumber(control.defaultMix * 100)}%)`;
    return `<code>${escape(control.control)}</code> mix superficie${percent}`;
  });
  return `<div>
<p class="eyebrow">${escape(label)}</p>
<p><code>${escape(token)}</code> · ${escape(usage)}</p>
<p class="margin-note">Sorgenti: ${sourceLabels.length ? sourceLabels.map((name) => `<code>${escape(name)}</code>`).join(", ") : "non dichiarate"}${escape(ownRole)}</p>
<p class="margin-note">Ricetta iniziale del generatore: ${escape(recipe ? `${recipe.recipe}${recipe.kind ? ` (${recipe.kind})` : ""}` : "non dichiarata")}.</p>
<p class="margin-note">Controlli pubblici (${escape(theme === "dark" ? "tema scuro" : "tema chiaro")}): ${controls.length ? controls.join(" · ") : "nessuno dichiarato"}.</p>
</div>`;
}

function pairDetailsHtml(pair, session, design, language, sourceEntries, theme) {
  if (!pair) return `<p>Nessuna coppia diagnostica disponibile: il banco non inventa coppie.</p>`;
  const light = pair.themes.light;
  const dark = pair.themes.dark;
  const activeTheme = theme === "dark" ? "dark" : "light";
  const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
  return `<article class="wb-details" data-smart-colors-workbench="details-body">
<h3>${escape(pair.title)}</h3>
<p><code>${escape(pair.foreground)}</code> su <code>${escape(pair.background)}</code> · ${pair.kind === "non-text" ? "bordo o indicatore" : "testo"} · proprietà <code>${escape(pair.property)}</code></p>
<div class="grid-2">
${tokenBindingHtml(pair.foreground, "Primo piano", design, language, activeTheme, entries)}
${tokenBindingHtml(pair.background, "Sfondo", design, language, activeTheme, entries)}
</div>
<pre tabindex="0" aria-label="Snippet CSS della coppia, con le stesse variabili della resa"><code>${escape(pairSnippet(pair.foreground, pair.background, pair.property))}</code></pre>
<dl class="wb-thresholds">
<div><dt>Tema chiaro</dt><dd>${escape(light ? minimoTarget(light.minimum, light.target) : "coppia non disponibile")}</dd></div>
<div><dt>Tema scuro</dt><dd>${escape(dark ? minimoTarget(dark.minimum, dark.target) : "coppia non disponibile")}</dd></div>
<div><dt>Tema e preferenza</dt><dd>Il tema è la variante misurata; la preferenza di sistema (<code>prefers-color-scheme</code>) resta separata e non viene emulata.</dd></div>
</dl>
<p class="margin-note">${escape(generatorNote(session))}</p>
<p class="margin-note">Byte associati alle viste: ${escape(cssBytesText(session))}.</p>
</article>`;
}

function sourcesAttribute(pair) {
  return pair && pair.sources.length ? pair.sources.join(" ") : "";
}

function foregroundSourcesAttribute(pair) {
  return pair && Array.isArray(pair.foregroundSources) && pair.foregroundSources.length ? pair.foregroundSources.join(" ") : "";
}

function backgroundSourcesAttribute(pair) {
  return pair && Array.isArray(pair.backgroundSources) && pair.backgroundSources.length ? pair.backgroundSources.join(" ") : "";
}

// Options stay compact: only the fields that cannot be derived cheaply in the view
// factory are serialized. Thresholds are packed as `min,target` per theme, in
// light;dark order, so a missing theme is an empty slot rather than a fabricated value.
function thresholdPack(theme) {
  if (!theme) return "";
  const minimum = finite(theme.minimum) ? String(theme.minimum) : "";
  const target = finite(theme.target) ? String(theme.target) : "";
  return `${minimum},${target}`;
}

function pairOptionsHtml(pairs, selected) {
  if (!pairs.length) return `<option value="">Nessuna coppia diagnostica disponibile</option>`;
  return pairs.map((pair) => {
    const value = `${pair.foreground}|${pair.background}|${pair.kind}`;
    const chosen = selected && selected.key === pair.key;
    const thresholds = `${thresholdPack(pair.themes.light)};${thresholdPack(pair.themes.dark)}`;
    const pickerLabel = pairPickerLabel(pair);
    // Most labels already exist in data-usage. Only embed a distinct human fallback when needed,
    // keeping the offline artifact bounded even with a full automation session.
    const pickerAttribute = pickerLabel && pickerLabel !== pair.title ? ` data-picker-label="${escape(pickerLabel)}"` : "";
    return `<option value="${escape(value)}"${chosen ? " selected" : ""} data-fg="${escape(pair.foreground)}" data-bg="${escape(pair.background)}" data-kind="${escape(pair.kind)}" data-catalogue-kind="${escape(pair.catalogueKind || pair.kind)}" data-usage="${escape(pair.title)}"${pickerAttribute} data-sources="${escape(sourcesAttribute(pair))}" data-fg-sources="${escape(foregroundSourcesAttribute(pair))}" data-bg-sources="${escape(backgroundSourcesAttribute(pair))}" data-use-bucket="${escape(pair.useBucket || "other")}" data-use-rank="${escape(String(finite(pair.useRank) ? pair.useRank : 999))}" data-thresholds="${escape(thresholds)}">${escape(pair.title)}</option>`;
  }).join("");
}

function sourceOptionsHtml(sources, selected) {
  const chosen = selected && selected.sources.length ? selected.sources[0] : null;
  const options = sources.map((entry) => {
    // The compact native fallback uses the same human name as the swatch strip; the exact token
    // remains visible so the choice is unambiguous. Declared roles stay in the source archive.
    return `<option value="${escape(entry.token)}"${chosen === entry.token ? " selected" : ""}>${escape(`${sourceSwatchName(entry)} · ${entry.token}`)}</option>`;
  });
  return `<option value=""${chosen ? "" : " selected"}>Tutte le sorgenti</option>${options.join("")}`;
}

function controlsFor(design, token, theme) {
  if (!design || !record(design.tokens) || !record(design.tokens[token])) return [];
  const controls = record(design.tokens[token].controls) ? design.tokens[token].controls : null;
  if (!controls || !record(controls[theme])) return [];
  const control = controls[theme];
  const rows = [];
  if (text(control.override)) rows.push({ control: control.override, kind: "override", defaultMix: null });
  if (text(control.mix)) rows.push({ control: control.mix, kind: "mix", defaultMix: finite(control.defaultMix) ? control.defaultMix : null });
  return rows;
}

function controlRowsHtml(pair, theme, design) {
  if (!pair) return `<p class="margin-note">Nessuna coppia selezionata: nessun controllo pubblico da mostrare.</p>`;
  const tokens = [pair.foreground, pair.background].filter((token, index, all) => all.indexOf(token) === index);
  const rows = [];
  for (const token of tokens) {
    for (const control of controlsFor(design, token, theme)) {
      const id = `smart-colors-workbench-control-${control.control.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      if (control.kind === "override") {
        rows.push(`<div class="wb-field"><label for="${escape(id)}"><code>${escape(token)}</code> · override completo</label><input id="${escape(id)}" type="text" data-control="${escape(control.control)}" data-kind="override" placeholder="es. oklch(0.5 0.1 250)" autocomplete="off" spellcheck="false"></div>`);
      } else {
        const percent = control.defaultMix == null ? "" : String(Math.round(control.defaultMix * 100 * 100) / 100).replace(".", ",");
        // The default is a PLACEHOLDER, never an active value: an untouched mix is not submitted and
        // cannot silently override a saved setting.
        rows.push(`<div class="wb-field"><label for="${escape(id)}"><code>${escape(token)}</code> · mix superficie (%)</label><input id="${escape(id)}" type="number" min="0" max="100" step="0.1" placeholder="${escape(percent)}" data-control="${escape(control.control)}" data-kind="mix"><span class="margin-note">Default dichiarato: ${control.defaultMix == null ? "non disponibile" : `${escape(percent)}%`} (segnaposto: nessun override finché non modifichi il campo).</span></div>`);
      }
    }
  }
  if (!rows.length) return `<p class="margin-note">Nessun controllo pubblico dichiarato per questa coppia e questo tema. Il banco non inventa knob.</p>`;
  return `<div class="wb-control-grid">${rows.join("")}</div>`;
}

function tokenCatalogueHtml(design, pairs, sources) {
  if (!design || !record(design.tokens)) return `<p>Metadati di design assenti: il catalogo completo non è disponibile e nessuna coppia viene inventata.</p>`;
  const names = Object.keys(design.tokens).sort((a, b) => a.localeCompare(b, "en"));
  const counts = new Map();
  for (const pair of pairs) {
    for (const token of [pair.foreground, pair.background]) counts.set(token, (counts.get(token) || 0) + 1);
  }
  const rows = names.map((token) => {
    const binding = record(design.tokens[token]) ? design.tokens[token] : {};
    const recipe = text(binding.recipe) || "ricetta non dichiarata";
    const count = counts.get(token) || 0;
    return `<li><code>${escape(token)}</code> · ${escape(recipe)} · ${count ? `${count} coppie diagnostiche` : "nessun abbinamento verificato"}</li>`;
  });
  const represented = new Set();
  for (const pair of pairs) for (const source of pair.sources) represented.add(source);
  const unrepresented = sources.entries.map((entry) => entry.token).filter((token) => !represented.has(token));
  return `<p class="margin-note">Catalogo completo: ${names.length} token, nessun limite nascosto. Un token senza coppie diagnostiche resta elencato come <strong>nessuna coppia diagnostica</strong>.</p>
<ul class="wb-catalogue">${rows.join("")}</ul>
${unrepresented.length ? `<p class="margin-note">Sorgenti senza coppia diagnostica: ${unrepresented.map((token) => `<code>${escape(token)}</code>`).join(", ")}.</p>` : ""}`;
}

function tuningState(session) {
  const css = record(session.css) ? session.css : {};
  if (!text(css.tuning)) return { available: false, reason: "tuning assente nello snapshot" };
  if (css.tuningSupport === "unsupported") return { available: false, reason: "tuning non supportato (risorse esterne non valutabili offline)" };
  return { available: true, reason: null };
}

// Short human name for a source swatch: the authored name when present, otherwise a short label
// derived from the token. Tokens are technical, so the primary surface never shows the raw string.
// The label is title-cased for readability while acronyms and mixed case stay intact.
function titleCase(value) {
  const words = String(value).split(/\s+/).filter(Boolean);
  if (!words.length) return String(value);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function sourceSwatchName(entry) {
  if (text(entry.name)) return titleCase(entry.name);
  const token = text(entry.token) || "";
  const short = token.replace(/^--/, "").replace(/^(palette|color)-/, "");
  const words = short.split("-").filter(Boolean);
  if (!words.length) return titleCase(token) || "sorgente";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

// The clickable source palette that opens the workbench. Each swatch is a real color tile with a
// neutral label below (never text painted over the authored color). Buttons ship disabled and inert
// without JS: the view factory enables them and owns the pressed state via `aria-pressed`.
function sourceSwatchesHtml(entries, selectedToken) {
  if (!entries.length) return `<p class="wb-uses-empty">Nessun colore sorgente disponibile in questa sessione: il banco non inventa sorgenti.</p>`;
  const items = entries.map((entry) => {
    const color = sourceColor(entry.value);
    const style = color ? ` style="--sample-color:${escape(color)}"` : "";
    const pressed = selectedToken && entry.token === selectedToken;
    return `<li><button type="button" class="wb-swatch" data-smart-colors-workbench="swatch" data-token="${escape(entry.token)}" aria-pressed="${pressed ? "true" : "false"}" disabled>
<span class="wb-swatch-block" aria-hidden="true"${style}></span>
<span class="wb-swatch-name"><span class="wb-swatch-mark" aria-hidden="true">✓</span>${escape(sourceSwatchName(entry))}</span>
</button></li>`;
  });
  return `<ul class="wb-palette" aria-labelledby="smart-colors-workbench-palette-label">${items.join("")}</ul>`;
}

// Uses for one source, derived from the real diagnostics only. Foreground bindings win; a source
// that is only a background dependency of other tokens is shown under an explicit note instead of
// dumping the whole catalogue. A source with no diagnostic gets an explicit empty state.
function usesForSource(pairs, design, sourceToken) {
  if (!sourceToken) return { pairs: [], backgroundOnly: false };
  const foreground = [];
  const background = [];
  for (const pair of pairs) {
    if (tokenSources(design, pair.foreground).includes(sourceToken)) foreground.push(pair);
    else if (tokenSources(design, pair.background).includes(sourceToken)) background.push(pair);
  }
  if (foreground.length) return { pairs: foreground, backgroundOnly: false };
  if (background.length) return { pairs: background, backgroundOnly: true };
  return { pairs: [], backgroundOnly: false };
}

// Round-robin across semantic buckets so the first pages are diverse (text, button, callout,
// border, focus) instead of six borders. With a single bucket (for example the ink source) it still
// yields six text choices. No pair is dropped: the paginated picker exposes every match.
function diversifyPairs(list) {
  const buckets = new Map();
  for (const pair of list) {
    const key = pair.useBucket || "other";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(pair);
  }
  const groups = [...buckets.entries()].sort((a, b) => (a[1][0].useRank ?? 999) - (b[1][0].useRank ?? 999));
  const ordered = [];
  let round = 0;
  let pushed = true;
  while (pushed) {
    pushed = false;
    for (const group of groups) {
      if (round < group[1].length) { ordered.push(group[1][round]); pushed = true; }
    }
    round += 1;
  }
  return ordered;
}

function pickerValue(pair) {
  return `${pair.foreground}|${pair.background}|${pair.kind}`;
}

function pairFallbackLabel(pair) {
  return `${pair.foreground} su ${pair.background}`;
}

function pairHasHumanName(pair) {
  return Boolean(pair && pair.title) && pair.title !== pairFallbackLabel(pair);
}


// Human selection label. A known on-color pair (`<base>-ink` on the exact `<base>`) gets a
// readable identity label without changing the pair title / `data-usage` technical contract.
function pairPickerLabel(pair) {
  if (pairHasHumanName(pair)) return pair.title;
  const ink = /^--color-(.+)-ink$/.exec(pair.foreground);
  if (pair.kind !== "non-text" && pair.catalogueKind === "on-color" && ink && pair.background === `--color-${ink[1]}`) {
    return `Testo sul colore ${sourceSwatchName({ token: pair.background })}`;
  }
  return "";
}

function pairHasPickerLabel(pair) {
  return Boolean(pairPickerLabel(pair));
}

function pairPickerDisplay(pair) {
  return pairPickerLabel(pair) || "Uso senza nome";
}


function foldSearch(value) {
  const raw = String(value == null ? "" : value).toLowerCase();
  return typeof raw.normalize === "function" ? raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : raw;
}

// Search spans the human label, the exact public tokens and the friendly source names. It never
// invents a pair: it only filters the real candidates already derived from the diagnostics.
function pairSearchText(pair, design) {
  const sourceNames = [];
  for (const source of pair.sources || []) {
    const meta = designSource(design, source);
    sourceNames.push(meta && meta.name ? meta.name : source);
  }
  return foldSearch([pair.title, pairPickerLabel(pair), pair.foreground, pair.background, pairKindLabel(pair), ...(pair.sources || []), ...sourceNames].join(" "));
}

// Preferred foreground uses win; a source that only appears as a background dependency falls back to
// that explicit scope. The current option is kept visible even if the scope would otherwise hide it,
// so an external runtime selection always has a truthful selected row.
function pickerCandidates(pairs, design, sourceToken, activeValue) {
  let pool = [];
  let backgroundOnly = false;
  if (!sourceToken) {
    pool = pairs.slice();
  } else {
    const result = usesForSource(pairs, design, sourceToken);
    pool = result.pairs.slice();
    backgroundOnly = result.backgroundOnly;
  }
  const active = activeValue ? pool.find((pair) => pickerValue(pair) === activeValue) || null : null;
  let ordered = diversifyPairs(pool);
  if (active) ordered = [active, ...ordered.filter((pair) => pair !== active)];
  return { pairs: ordered, backgroundOnly, active };
}

function pickerFiltered(candidates, query, category, design) {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  return candidates.filter((pair) => {
    if (category && (pair.useBucket || "other") !== category) return false;
    if (!words.length) return true;
    const haystack = pairSearchText(pair, design);
    return words.every((word) => haystack.includes(word));
  });
}

function pickerCountText(total, query, category) {
  if (total === 0) {
    return query || category
      ? "Nessun uso corrisponde ai filtri. Modifica la ricerca o scegli Tutti gli usi."
      : "Nessun uso disponibile per questa sorgente.";
  }
  const pages = Math.max(1, Math.ceil(total / USE_VISIBLE_LIMIT));
  return `${total} ${total === 1 ? "uso" : "usi"} · pagina 1 di ${pages}`;
}

function pickerCategoryOptionsHtml(candidates) {
  const present = new Set(candidates.map((pair) => pair.useBucket || "other"));
  return PICKER_CATEGORIES
    .filter(([bucket]) => present.has(bucket))
    .map(([bucket, label]) => `<option value="${escape(bucket)}">${escape(label)}</option>`)
    .join("");
}

function pickerSourceNote(sourceToken, sources) {
  const entries = sources && Array.isArray(sources.entries) ? sources.entries : [];
  const entry = sourceToken ? entries.find((item) => item.token === sourceToken) : null;
  const label = entry ? sourceSwatchName(entry) : sourceToken || "Tutte le sorgenti";
  return `Sorgente: ${label}. Usi generati dalla palette, non rilevati nel sito.`;
}

function usesChips(pairs, activeValue) {
  return pairs.map((pair) => {
    const value = pickerValue(pair);
    const pressed = activeValue && value === activeValue;
    const tech = pairHasPickerLabel(pair)
      ? ""
      : `<span class="wb-use-tech"><code>${escape(pair.foreground)}</code> su <code>${escape(pair.background)}</code></span>`;
    return `<li><button type="button" class="wb-use" data-smart-colors-workbench="use" data-pair-value="${escape(value)}" aria-pressed="${pressed ? "true" : "false"}" disabled><span class="wb-use-main"><span class="wb-use-label">${escape(pairPickerDisplay(pair))}</span>${tech}</span><span class="wb-use-kind">${escape(pairKindLabel(pair))}</span><span class="wb-use-mark" aria-hidden="true"> ✓</span></button></li>`;
  }).join("");
}

function pickerModel(pairs, design, sources, sourceToken, activeValue) {
  const candidates = pickerCandidates(pairs, design, sourceToken, activeValue);
  const filtered = pickerFiltered(candidates.pairs, "", "", design);
  const visible = filtered.slice(0, USE_VISIBLE_LIMIT);
  const empty = pickerCountText(0, "", "");
  const list = visible.length
    ? `<ul class="wb-uses">${usesChips(visible, activeValue)}</ul>`
    : `<p class="wb-uses-empty">${escape(empty)}</p>`;
  const note = candidates.backgroundOnly
    ? `<p class="wb-uses-note">Questo colore compare come sfondo nelle coppie del catalogo: è una dipendenza del token di sfondo.</p>`
    : "";
  return {
    total: filtered.length,
    count: pickerCountText(filtered.length, "", ""),
    categoriesHtml: pickerCategoryOptionsHtml(candidates.pairs),
    resultsHtml: `${list}${note}`,
    sourceNote: pickerSourceNote(sourceToken, sources),
  };
}

/**
 * Static guided workbench. The interactive workspace is the main content: a compact horizontal toolbar
 * with the bounded source strip, a human current-use summary and a "Cambia uso" opener, the
 * comparison modes and the theme, then the full-width comparison area with the visible pair identity,
 * the real CSS specimens and their scoped results. The opener reveals a native modal with search,
 * category and paginated uses. The verbose source-palette archive follows it inside a closed native
 * detail. Every action is a native control and remains inert without JS.
 */
export function renderContrastWorkbench(session) {
  const value = record(session) ? session : {};
  const language = createDesignerLanguage();
  const tools = createDesignTools();
  const design = record(value.design) ? value.design : null;
  const pairs = pairCatalogue(value, design, language);
  const selected = pairs.find((pair) => worstStatus(pair) !== "pass") || pairs[0] || null;
  const sources = sourceCatalogue(value, design, tools);
  const tuning = tuningState(value);
  const thresholdsNote = "Minimo e target restano separati: il minimo è la soglia dichiarata, il target è l'obiettivo del generatore. Nessun rapporto viene calcolato qui.";
  // The primary picker starts on the static best pair's own source; the runtime then keeps this in
  // sync with the active selection.
  const defaultSource = selected && selected.sources.length ? selected.sources[0] : "";
  const currentTitle = selected ? selected.title : "Nessuna coppia selezionata";
  const currentHuman = selected ? pairPickerDisplay(selected) : "Nessuna coppia selezionata";
  const currentKind = selected ? pairKindLabel(selected) : "";
  const currentTech = selected && !pairHasPickerLabel(selected) ? `${selected.foreground} su ${selected.background}` : "";
  const picker = pickerModel(pairs, design, sources, defaultSource, selected ? pickerValue(selected) : "");
  const identityHtml = pairIdentityHtml(selected);
  const purposeText = pairPurposeText(selected);
  return `<section id="banco" aria-labelledby="banco-titolo"><h2 id="banco-titolo" class="wb-visually-hidden">Banco di contrasto guidato</h2>
<div id="${HOST_ID}" ${HOOK}="host" role="region" aria-label="Banco di contrasto guidato">
<noscript><p class="wb-nojs">JavaScript è disattivato: i pulsanti dei colori restano inerti e nessuna misura live viene eseguita.</p></noscript>
<div class="wb-workspace">
<section class="wb-toolbar" aria-labelledby="smart-colors-workbench-toolbar-title">
<h3 id="smart-colors-workbench-toolbar-title" class="wb-visually-hidden">Selezione e confronto</h3>
<div class="wb-toolbar-line wb-palette-line">
<div class="wb-field wb-source-select"><label for="smart-colors-workbench-source">Colore sorgente</label><select id="smart-colors-workbench-source" ${HOOK}="source">${sourceOptionsHtml(sources.entries, selected)}</select></div>
<span id="smart-colors-workbench-palette-label" class="wb-palette-label">Colore sorgente</span>
${sourceSwatchesHtml(sources.entries, defaultSource)}
</div>
<div class="wb-toolbar-line wb-control-line">
<div class="wb-current-use">
<span class="wb-current-use-label">Uso attuale</span>
<p id="smart-colors-workbench-current-use" ${HOOK}="current-use" class="wb-current-use-value"><strong>${escape(currentHuman)}</strong>${currentKind ? `<span class="wb-current-use-kind">${escape(currentKind)}</span>` : ""}${currentTech ? `<code class="wb-current-use-tech">${escape(currentTech)}</code>` : ""}</p>
</div>
<button type="button" id="smart-colors-workbench-open-picker" ${HOOK}="open-picker" class="wb-open-picker" disabled>Cambia uso</button>
<form id="smart-colors-workbench-selection" class="wb-compare" data-smart-colors-workbench="selection">
<fieldset class="wb-fieldset"><legend>Confronta</legend><label><input id="smart-colors-workbench-comparison-themes" type="radio" name="smart-colors-workbench-comparison" value="themes" checked> Chiaro / scuro</label><label><input id="smart-colors-workbench-comparison-tuning" type="radio" name="smart-colors-workbench-comparison" value="tuning"${tuning.available ? "" : " disabled"}> Generato / personalizzato</label><label><input id="smart-colors-workbench-comparison-draft" type="radio" name="smart-colors-workbench-comparison" value="draft"${tuning.available ? "" : " disabled"}> Prima / dopo</label>${tuning.available ? "" : `<span class="margin-note">Confronti personalizzati non disponibili: ${escape(tuning.reason)}.</span>`}</fieldset>
<fieldset class="wb-fieldset wb-theme-fieldset"><legend>Tema da modificare</legend><label><input id="smart-colors-workbench-theme-light" type="radio" name="smart-colors-workbench-theme" value="light" form="smart-colors-workbench-selection" checked> chiaro</label><label><input id="smart-colors-workbench-theme-dark" type="radio" name="smart-colors-workbench-theme" value="dark" form="smart-colors-workbench-selection"> scuro</label></fieldset>
</form>
</div>
</section>
<div class="wb-main">
<header class="wb-head">
<h3 id="smart-colors-workbench-current" ${HOOK}="current" class="wb-current"><strong>${escape(currentTitle)}</strong></h3>
<p id="smart-colors-workbench-identity" ${HOOK}="identity" class="wb-identity">${identityHtml}</p>
<p id="smart-colors-workbench-purpose" ${HOOK}="purpose" class="wb-purpose">${escape(purposeText)}</p>
</header>
<p id="smart-colors-workbench-status" ${HOOK}="status" role="status" aria-live="polite" class="wb-status">Misura non disponibile senza JavaScript.</p>
<div id="smart-colors-workbench-result" ${HOOK}="result" class="wb-frames" aria-label="Campioni CSS del consumatore">
<section class="wb-view" aria-labelledby="smart-colors-workbench-left-title"><h3 id="smart-colors-workbench-left-title" class="wb-view-title">Tema chiaro</h3><div id="smart-colors-workbench-left" ${HOOK}="left" class="wb-frame" role="group" aria-label="Vista CSS sinistra"></div><dl id="smart-colors-workbench-left-measure" ${HOOK}="left-measure" class="wb-measure"><div class="wb-measure-row"><dt>Rapporto</dt><dd><span class="wb-verdict" data-status="unmeasured">Non misurato</span> · serve JavaScript</dd></div></dl></section>
<section class="wb-view" aria-labelledby="smart-colors-workbench-right-title"><h3 id="smart-colors-workbench-right-title" class="wb-view-title">Tema scuro</h3><div id="smart-colors-workbench-right" ${HOOK}="right" class="wb-frame" role="group" aria-label="Vista CSS destra"></div><dl id="smart-colors-workbench-right-measure" ${HOOK}="right-measure" class="wb-measure"><div class="wb-measure-row"><dt>Rapporto</dt><dd><span class="wb-verdict" data-status="unmeasured">Non misurato</span> · serve JavaScript</dd></div></dl></section>
</div>
<p id="smart-colors-workbench-empty" ${HOOK}="empty" class="wb-uses-empty" hidden>Nessuna coppia diagnostica per questa sorgente. Scegli un altro colore.</p>
<p class="wb-scope-note">Le misure valgono per la coppia e il tema mostrati: non sono un verdetto di conformità globale.</p>
<section class="wb-action-strip wb-suggestions" data-smart-colors-workbench="correction" aria-labelledby="smart-colors-workbench-suggestions-title">
<div class="wb-strip-head"><h3 id="smart-colors-workbench-suggestions-title">Cerca una correzione</h3><p id="smart-colors-workbench-action-theme" ${HOOK}="action-theme" class="wb-action-theme">Tema per proposta e override: chiaro.</p></div>
<div class="wb-actions"><button type="button" id="smart-colors-workbench-suggest-foreground" ${HOOK}="suggest-foreground">Correggi testo</button><button type="button" id="smart-colors-workbench-suggest-background" ${HOOK}="suggest-background">Correggi sfondo</button><button type="button" id="smart-colors-workbench-discard-suggestion" ${HOOK}="discard-suggestion" hidden disabled>Scarta proposta</button><button type="button" id="smart-colors-workbench-apply" ${HOOK}="apply" hidden disabled>Prova proposta</button></div>
<div id="smart-colors-workbench-proposal" ${HOOK}="proposal" class="wb-proposal">Nessuna proposta richiesta.</div>
<section id="smart-colors-workbench-proposal-frames" ${HOOK}="proposal-frames" class="wb-frames wb-proposal-frames" hidden aria-labelledby="smart-colors-workbench-proposal-frames-title">
<h4 id="smart-colors-workbench-proposal-frames-title">Viste verificate della proposta</h4>
<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-before-title"><h4 id="smart-colors-workbench-proposal-before-title">Attuale</h4><div id="smart-colors-workbench-proposal-before" ${HOOK}="proposal-before" class="wb-frame" role="region" tabindex="0" aria-label="Vista CSS attuale della proposta: viewport di verifica fisso 360×480; scorri orizzontalmente per vedere tutta la vista"></div></section>
<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-after-title"><h4 id="smart-colors-workbench-proposal-after-title">Proposta</h4><div id="smart-colors-workbench-proposal-after" ${HOOK}="proposal-after" class="wb-frame" role="region" tabindex="0" aria-label="Vista CSS proposta: viewport di verifica fisso 360×480; scorri orizzontalmente per vedere tutta la vista"></div></section>
</section>
<details class="is-detail wb-how"><summary>Come funziona la ricerca della correzione</summary>
<p class="margin-note">La ricerca varia la luminosità quanto basta per raggiungere il minimo dichiarato, non il target del progetto, e non cerca il colore più vicino in ΔE.</p>
</details>
</section>
<details class="is-detail wb-criteria" data-smart-colors-workbench="criteria"><summary>Soglie di riferimento e testo grande</summary>
<dl class="wb-criteria-list">
<div><dt>Testo normale · AA</dt><dd>4,5:1 · <a href="https://www.w3.org/TR/WCAG22/#contrast-minimum">SC 1.4.3</a></dd></div>
<div><dt>Testo normale · AAA</dt><dd>7:1 · <a href="https://www.w3.org/TR/WCAG22/#contrast-enhanced">SC 1.4.6</a></dd></div>
<div><dt>Testo grande · AA</dt><dd>3:1 · 18 pt / 24 CSS px regular oppure 14 pt / ~18,67 CSS px bold · <a href="https://www.w3.org/TR/WCAG22/#contrast-minimum">SC 1.4.3</a></dd></div>
<div><dt>Testo grande · AAA</dt><dd>4,5:1 · <a href="https://www.w3.org/TR/WCAG22/#contrast-enhanced">SC 1.4.6</a></dd></div>
<div><dt>Componenti non testuali</dt><dd><a href="https://www.w3.org/TR/WCAG22/#non-text-contrast">SC 1.4.11</a> · 3:1 solo per le informazioni necessarie a identificare componenti e stati; i bordi decorativi non sono automaticamente soggetti.</dd></div>
<div><dt>Anello statico</dt><dd>Test del solo colore: non verifica comportamento, visibilità, oscuramento o aspetto.</dd></div>
<div><dt>Target del progetto</dt><dd>Obiettivo separato dal minimo WCAG; per esempio 7,5:1 non è una soglia WCAG.</dd></div>
</dl>
</details>
<details class="is-detail wb-technical"><summary>Dettagli tecnici della coppia e selezione completa</summary>
<button type="submit" form="smart-colors-workbench-selection" id="smart-colors-workbench-submit" class="wb-ghost">Aggiorna il confronto</button>
<div class="wb-field wb-pair-field"><label for="smart-colors-workbench-pair">Abbinamento tecnico</label><select id="smart-colors-workbench-pair" ${HOOK}="pair"${pairs.length ? "" : " disabled"}>${pairOptionsHtml(pairs, selected)}</select><span class="margin-note">Fallback tecnico: la scelta principale è «Cambia uso»; questo selettore resta per l'accesso diretto al catalogo completo.</span></div>
<div id="smart-colors-workbench-details" ${HOOK}="details">${pairDetailsHtml(selected, value, design, language, sources.entries, "light")}</div>
<details id="smart-colors-workbench-catalogue" ${HOOK}="catalogue" class="is-detail"><summary>Catalogo completo dei token</summary>
${tokenCatalogueHtml(design, pairs, sources)}
</details>
<p class="margin-note">${escape(thresholdsNote)}</p>
</details>
<details class="is-detail wb-advanced" data-smart-colors-workbench="manual"><summary>Modifica manualmente (avanzato)</summary>
<form class="wb-controls" data-smart-colors-workbench="controls">
<p class="margin-note">Ambito: solo i controlli pubblici dichiarati per i due token della coppia selezionata e per il tema attivo; i knob macro del generatore non sono esposti qui. Si inviano solo i campi che modifichi: i default dichiarati sono segnaposto e un mix non toccato non viene esportato. Un override completo ha precedenza sul mix della superficie; il mix resta un valore pubblico separato. Queste modifiche sono temporanee: non rigenerano il generatore e non modificano <code>palette.css</code>.</p>
<div id="smart-colors-workbench-controls" ${HOOK}="controls-body">${controlRowsHtml(selected, "light", design)}</div>
<div class="wb-actions"><button type="submit" id="smart-colors-workbench-controls-submit">Applica override</button><button type="button" id="smart-colors-workbench-reset-pair" ${HOOK}="reset-pair">Azzera i controlli della coppia</button><button type="button" id="smart-colors-workbench-reset-all" ${HOOK}="reset-all">Azzera tutto il tuning</button></div>
<p class="margin-note">Gli override sono applicati all'API del runtime; la palette sorgente resta di sola lettura.</p>
</form>
</details>
<details class="is-detail wb-export" data-smart-colors-workbench="export"><summary>Esporta modifiche</summary>
<p class="margin-note">Il comando di esportazione è nell'intestazione della pagina. Qui restano il CSS generato e il download manuale.</p>
<div class="wb-actions"><button type="button" id="smart-colors-workbench-copy-export" ${HOOK}="copy-export">Seleziona il CSS esportato</button></div>
<p id="smart-colors-workbench-export-note" class="margin-note">Nessun tuning pubblico da esportare: nessun override attivo.</p>
<label for="smart-colors-workbench-export-text">CSS pubblico esportato, selezionabile senza permessi clipboard</label>
<textarea id="smart-colors-workbench-export-text" ${HOOK}="export-text" aria-describedby="smart-colors-workbench-export-note" readonly rows="8"></textarea>
<a id="smart-colors-workbench-download" ${HOOK}="download" download="colors-tuning.css" hidden>Scarica colors-tuning.css (azione manuale)</a>
</details>
</div>
</div>
<dialog id="smart-colors-workbench-picker" class="wb-picker-dialog" aria-labelledby="smart-colors-workbench-picker-title" aria-describedby="smart-colors-workbench-picker-source">
<div class="wb-picker-panel">
<div class="wb-picker-header">
<h2 id="smart-colors-workbench-picker-title">Scegli cosa verificare</h2>
<p id="smart-colors-workbench-picker-source" ${HOOK}="picker-source" class="margin-note">${escape(picker.sourceNote)}</p>
</div>
<div class="wb-picker-filters">
<div class="wb-field"><label for="smart-colors-workbench-use-search">Cerca un uso</label><input id="smart-colors-workbench-use-search" ${HOOK}="use-search" type="search" placeholder="es. testo card" autocomplete="off" spellcheck="false" disabled></div>
<div class="wb-field"><label for="smart-colors-workbench-use-category">Tipo di uso</label><select id="smart-colors-workbench-use-category" ${HOOK}="use-category" disabled><option value="">Tutti gli usi</option>${picker.categoriesHtml}</select></div>
<button type="button" id="smart-colors-workbench-clear-search" ${HOOK}="clear-search" class="wb-ghost" disabled>Azzera filtri</button>
</div>
<p id="smart-colors-workbench-use-count" ${HOOK}="use-count" role="status" aria-live="polite" class="wb-picker-count">${escape(picker.count)}</p>
<div id="smart-colors-workbench-uses" ${HOOK}="uses" class="wb-picker-results">${picker.resultsHtml}</div>
<div class="wb-picker-footer">
<button type="button" id="smart-colors-workbench-use-prev" ${HOOK}="use-prev" class="wb-pager" aria-disabled="true" disabled>Precedenti</button>
<button type="button" id="smart-colors-workbench-use-next" ${HOOK}="use-next" class="wb-pager" aria-disabled="true" disabled>Successivi</button>
<button type="button" id="smart-colors-workbench-close-picker" ${HOOK}="close-picker" disabled>Chiudi</button>
</div>
</div>
</dialog>
</div>
</section>
${sourcePaletteHtml(value, design, tools, language)}`;
}

/**
 * Serialized view factory. It is deliberately self-contained: no import, no
 * module-scope binding and no external helper. Every dynamic node is created with
 * DOM methods and written with `textContent`.
 */
export function createContrastWorkbenchView(deps) {
  var doc = deps && deps.document;
  var controller = deps && deps.controller;
  var host = doc && typeof doc.getElementById === "function" ? doc.getElementById("smart-colors-workbench") : null;
  if (!doc || !host || typeof doc.createElement !== "function") return null;
  // The workbench runtime is mandatory and always installed before this factory by the preview
  // script. A missing controller is a real integration failure: fail loud, never degrade silently.
  if (!controller || typeof controller.select !== "function" || typeof controller.subscribe !== "function") {
    throw new TypeError("createContrastWorkbenchView requires the workbench controller installed by contrast-workbench-runtime.mjs");
  }
  var HOOK = "data-smart-colors-workbench";

  function byId(id) { return doc.getElementById(id); }
  function make(tag, className, value) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function isRecord(value) { return value !== null && typeof value === "object"; }
  function finite(value) { return typeof value === "number" && isFinite(value); }
  function attribute(node, name) { return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null; }
  function setAttribute(node, name, value) { if (node && typeof node.setAttribute === "function") node.setAttribute(name, value); }
  function textOf(value) { return value === null || value === undefined ? "" : String(value); }

  var status = host.querySelector("[" + HOOK + '="status"]');
  var sourceSelect = byId("smart-colors-workbench-source");
  var pairSelect = byId("smart-colors-workbench-pair");
  var themeLight = byId("smart-colors-workbench-theme-light");
  var themeDark = byId("smart-colors-workbench-theme-dark");
  var comparisonThemes = byId("smart-colors-workbench-comparison-themes");
  var comparisonTuning = byId("smart-colors-workbench-comparison-tuning");
  var comparisonDraft = byId("smart-colors-workbench-comparison-draft");
  var details = byId("smart-colors-workbench-details");
  var left = byId("smart-colors-workbench-left");
  var right = byId("smart-colors-workbench-right");
  var leftMeasure = byId("smart-colors-workbench-left-measure");
  var rightMeasure = byId("smart-colors-workbench-right-measure");
  var controlsBody = byId("smart-colors-workbench-controls");
  var proposal = byId("smart-colors-workbench-proposal");
  var proposalFrames = byId("smart-colors-workbench-proposal-frames");
  var proposalBefore = byId("smart-colors-workbench-proposal-before");
  var proposalAfter = byId("smart-colors-workbench-proposal-after");
  var applyButton = byId("smart-colors-workbench-apply");
  var discardButton = byId("smart-colors-workbench-discard-suggestion");
  var exportButton = byId("smart-colors-workbench-export");
  var sessionStatus = byId("smart-colors-workbench-session-status");
  var exportText = byId("smart-colors-workbench-export-text");
  var exportNote = byId("smart-colors-workbench-export-note");
  var download = byId("smart-colors-workbench-download");
  var copyPalette = byId("smart-colors-workbench-copy-palette");
  var paletteSource = byId("smart-colors-workbench-palette-source");
  var selectionForm = host.querySelector("[" + HOOK + '="selection"]');
  var controlsForm = host.querySelector("[" + HOOK + '="controls"]');
  var submit = byId("smart-colors-workbench-submit");
  var controlsSubmit = byId("smart-colors-workbench-controls-submit");
  var resetPair = byId("smart-colors-workbench-reset-pair");
  var resetAll = byId("smart-colors-workbench-reset-all");
  var suggestForeground = byId("smart-colors-workbench-suggest-foreground");
  var suggestBackground = byId("smart-colors-workbench-suggest-background");
  var leftTitle = byId("smart-colors-workbench-left-title");
  var rightTitle = byId("smart-colors-workbench-right-title");
  var usesBox = host.querySelector("[" + HOOK + '="uses"]');
  var currentUse = byId("smart-colors-workbench-current-use");
  var openPicker = byId("smart-colors-workbench-open-picker");
  var pickerDialog = byId("smart-colors-workbench-picker");
  var pickerSource = byId("smart-colors-workbench-picker-source");
  var useSearch = byId("smart-colors-workbench-use-search");
  var useCategory = byId("smart-colors-workbench-use-category");
  var useClear = byId("smart-colors-workbench-clear-search");
  var useCount = byId("smart-colors-workbench-use-count");
  var usePrev = byId("smart-colors-workbench-use-prev");
  var useNext = byId("smart-colors-workbench-use-next");
  var closePicker = byId("smart-colors-workbench-close-picker");
  var currentHeading = byId("smart-colors-workbench-current");
  var identityNode = byId("smart-colors-workbench-identity");
  var purposeNode = byId("smart-colors-workbench-purpose");
  var actionThemeNode = byId("smart-colors-workbench-action-theme");
  var suggestionsTitle = byId("smart-colors-workbench-suggestions-title");
  var resultBox = byId("smart-colors-workbench-result");
  var emptyNote = byId("smart-colors-workbench-empty");
  var correctionBox = host.querySelector("[" + HOOK + '="correction"]');
  var manualBox = host.querySelector("[" + HOOK + '="manual"]');
  var exportBox = host.querySelector("[" + HOOK + '="export"]');
  var swatchNodes = host.querySelectorAll("[" + HOOK + '="swatch"]');
  var swatchButtons = [];
  for (var swatchIndex = 0; swatchIndex < swatchNodes.length; swatchIndex += 1) swatchButtons.push(swatchNodes[swatchIndex]);
  var lastState = null;
  var lastAnnouncement = "";
  var lastControlsKey = "";
  var lastSelectionKey = null;
  var lastDetailsSignature = null;
  var selectionAvailable = true;
  var lastDraftSignature = null;
  var lastRevision = null;
  var controlInputs = [];
  var useButtons = [];
  var lastUsesSource = null;
  var lastUsesKey = null;
  var pickerQuery = "";
  var pickerCategory = "";
  var pickerPage = 0;
  var busy = false;
  // Local copy: the serialized factory must not depend on any module-scope binding.
  var useVisibleLimit = 6;
  // Blocked-source state: when no verified result can be shown for the requested source (no pair at
  // all, or none available in the current theme, or a failed selection), the previous samples are
  // hidden instead of left on screen under a different pair. Recovery is a new source/theme/use.
  var sourceBlocked = false;
  var blockedSource = null;
  var blockedPairId = null;
  var suggestionVerified = false;
  var suggestionPresent = false;
  var unsubscribe = null;
  var mounted = false;
  var payload = null;

  function readPayload() {
    if (payload) return payload;
    var node = byId("smart-colors-payload");
    if (!node) return null;
    try { payload = JSON.parse(node.textContent || ""); } catch (error) { payload = null; }
    return payload;
  }
  function design() {
    var value = readPayload();
    return value && isRecord(value.design) ? value.design : null;
  }
  function cssMeta() {
    var value = readPayload();
    return value && isRecord(value.css) ? value.css : {};
  }
  function tuningAvailable() {
    var css = cssMeta();
    return typeof css.tuning === "string" && css.tuning !== "" && css.tuningSupport === "supported";
  }
  function announce(message) {
    if (!status) return;
    var next = String(message);
    if (next === lastAnnouncement) return;
    lastAnnouncement = next;
    status.textContent = next;
  }
  // Routine complete announcements stay in the live region for assistive technology but no longer
  // consume visible space. Busy, error, unavailable, incomplete and blocked states stay visible.
  function setStatusVisibility(phase, hasError, blocked) {
    if (!status) return;
    var quiet = phase === "complete" && !hasError && !blocked;
    var className = quiet ? "wb-status wb-visually-hidden" : "wb-status";
    if (status.className !== className) status.className = className;
  }
  function themeName(value) { return value === "dark" ? "scuro" : "chiaro"; }
  function variantName(value) {
    if (value === "baseline") return "senza tuning";
    if (value === "tuned") return "con tuning";
    if (value === "draft") return "bozza";
    return "variante non indicata";
  }
  // Human, scoped verdict for one measurement. The WCAG use comes ONLY from the catalogue kind and a
  // supported measurement status; a numeric threshold is never allowed to infer a use. A kind or
  // threshold that does not match the normative pair for that kind fails closed with no criterion.
  function compactThreshold(value) {
    if (!finite(value)) return "soglia non dichiarata";
    return String(Math.round(value * 100) / 100).replace(".", ",") + ":1";
  }
  function declaredKindOf(option) {
    var kind = attribute(option, "data-kind");
    // `on-color` is a known text-semantics catalogue kind: it uses the same 4.5 threshold and DOM
    // property as normal text, while its specimen copy stays distinct.
    if (kind === "on-color") return "text";
    return kind === "text" || kind === "non-text" ? kind : null;
  }
  function catalogueKindOf(option) {
    var runtime = attribute(option, "data-pair-kind");
    if (runtime === "on-color") return "on-color";
    var kind = attribute(option, "data-catalogue-kind");
    if (kind === "text" || kind === "non-text" || kind === "on-color") return kind;
    return declaredKindOf(option);
  }
  function criterionFor(option, measurement) {
    var declared = declaredKindOf(option);
    var minimum = measurement && finite(measurement.minimum) && measurement.minimum > 0 ? measurement.minimum : null;
    var target = measurement && finite(measurement.target) && measurement.target > 0 ? measurement.target : null;
    var ratio = measurement && finite(measurement.ratio) ? measurement.ratio : null;
    var status = measurement && typeof measurement.status === "string" ? measurement.status : null;
    var supportedStatus = status === "pass" || status === "below-target" || status === "below-minimum";
    var normative = declared === "text" ? 4.5 : declared === "non-text" ? 3 : null;
    var canonical = normative !== null && minimum !== null && Math.abs(minimum - normative) < 1e-9;
    var expectedStatus = ratio !== null && minimum !== null
      ? (ratio < minimum ? "below-minimum" : target !== null && ratio < target ? "below-target" : "pass")
      : null;
    var reason = null;
    if (!declared) reason = "kind";
    else if (!supportedStatus) reason = "status";
    else if (minimum === null || ratio === null) reason = "measure";
    else if (!canonical) reason = "threshold";
    else if (expectedStatus !== status) reason = "status";
    var measured = reason === null;
    return {
      kind: declared,
      catalogueKind: catalogueKindOf(option),
      minimum: minimum,
      target: target,
      ratio: ratio,
      status: status,
      normative: normative,
      canonical: canonical,
      measured: measured,
      reason: reason,
      reached: measured ? ratio >= minimum : null,
      targetReached: measured && target !== null ? ratio >= target : null,
    };
  }
  function criterionStatus(criterion) {
    if (!criterion.measured) return "unmeasured";
    if (!criterion.reached) return "below-minimum";
    return criterion.targetReached === false ? "below-target" : "pass";
  }
  function criterionLabel(criterion) {
    if (!criterion.measured) {
      return criterion.reason === "kind" || criterion.reason === "threshold" ? "Non applicabile" : "Non misurato";
    }
    if (criterion.kind === "non-text") {
      return "Soglia di confronto " + compactThreshold(criterion.minimum) + (criterion.reached ? " raggiunta" : " non raggiunta");
    }
    return "Soglia AA per testo normale " + (criterion.reached ? "raggiunta" : "non raggiunta");
  }
  function criterionValue(criterion) {
    if (criterion.measured) {
      return (criterion.kind === "non-text" ? "SC 1.4.11 · " : "SC 1.4.3 · ") + ratioText(criterion.minimum);
    }
    if (criterion.reason === "kind") return "Tipo di coppia non riconosciuto: nessun criterio WCAG applicato.";
    if (criterion.reason === "threshold") return "Soglia non canonica per questo tipo: nessun criterio WCAG applicato.";
    if (criterion.reason === "status") return "Stato di misura non supportato o incoerente: nessun esito.";
    return "Misura assente o incompleta.";
  }
  function targetText(criterion) {
    if (criterion.target === null) return "non dichiarato";
    if (!criterion.measured) return ratioText(criterion.target) + " · non misurato";
    return ratioText(criterion.target) + (criterion.targetReached ? " · raggiunto" : " · non raggiunto");
  }
  function optionKindLabel(option) {
    if (!option) return "coppia non indicata";
    if (!declaredKindOf(option)) return "tipo non riconosciuto";
    if (catalogueKindOf(option) === "on-color") return "testo su riempimento";
    if (attribute(option, "data-kind") !== "non-text") return "testo";
    return /focus-ring/.test(attribute(option, "data-fg") || "") ? "anello" : "bordo";
  }
  function purposeFor(option) {
    if (!option) return "Scegli una coppia dal catalogo generato per leggere il criterio applicato.";
    var kind = declaredKindOf(option);
    if (!kind) return "Tipo di coppia non riconosciuto: nessun criterio WCAG viene applicato.";
    if (kind === "non-text") {
      return "Componente non testuale · soglia 3:1 (SC 1.4.11) per le informazioni necessarie a identificare componenti e stati; un bordo decorativo non è automaticamente soggetto. Il campione statico non verifica focus, comportamento, visibilità o oscuramento.";
    }
    if (catalogueKindOf(option) === "on-color") {
      return "Testo su riempimento · soglia AA 4,5:1 (SC 1.4.3). L'etichetta del campione è da 16 px.";
    }
    return "Testo normale · soglia AA 4,5:1 (SC 1.4.3). Il corpo del campione è da 16 px.";
  }
  function ratioText(value, thresholds) {
    if (!finite(value)) return "non misurata";
    var rounded = Math.round(value * 100) / 100;
    var crossed = [];
    for (var index = 0; thresholds && index < thresholds.length; index += 1) {
      var threshold = thresholds[index];
      if (finite(threshold) && value < threshold && rounded >= threshold) crossed.push(threshold);
    }
    if (crossed.length) return "< " + String(Math.min.apply(null, crossed)).replace(".", ",") + ":1";
    return (rounded === value ? "" : "circa ") + rounded.toFixed(2).replace(".", ",") + ":1";
  }
  function bytesText(variant) {
    var css = cssMeta();
    if (variant === "tuned") return "tuning pubblico applicato ai byte catturati";
    if (variant === "draft") return "bozza temporanea di override";
    if (css.status === "stale") return "output non aggiornato (stale)";
    if (css.source === "generated-candidate") return "candidato generato (diagnostico), non output";
    if (css.status === "absent") return "output assente: byte candidati";
    if (css.status === "empty") return "output vuoto: nessun byte utilizzabile";
    if (css.source === "output") return "output attuale del progetto";
    return "provenienza CSS non indicata";
  }
  function checkedTheme() { return themeDark && themeDark.checked ? "dark" : "light"; }
  function checkedComparison() {
    if (comparisonTuning && comparisonTuning.checked) return "tuning";
    if (comparisonDraft && comparisonDraft.checked) return "draft";
    return "themes";
  }
  function options() {
    if (!pairSelect) return [];
    if (pairSelect.options && typeof pairSelect.options.length === "number") return Array.prototype.slice.call(pairSelect.options);
    return [];
  }
  function selectedOption() {
    var list = options();
    for (var index = 0; index < list.length; index += 1) {
      if (list[index].selected || list[index].value === pairSelect.value) return list[index];
    }
    return list.length ? list[0] : null;
  }
  function thresholdsFor(option) {
    var packed = (attribute(option, "data-thresholds") || "").split(";");
    function read(index) {
      var slot = packed[index] || "";
      var parts = slot.split(",");
      return { minimum: parts[0], target: parts[1] };
    }
    return { light: read(0), dark: read(1) };
  }
  function propertyFor(option) {
    if (attribute(option, "data-kind") !== "non-text") return "color";
    var foreground = attribute(option, "data-fg") || "";
    if (/focus-ring/.test(foreground)) return "outlineColor";
    if (/border/.test(foreground)) return "borderColor";
    return "ui";
  }
  function optionAvailable(option, theme) {
    var slot = thresholdsFor(option)[theme];
    return Boolean(slot && (slot.minimum !== "" || slot.target !== ""));
  }
  function pairIdFor(option, theme) {
    var slot = thresholdsFor(option)[theme];
    if (!slot || (slot.minimum === "" && slot.target === "")) return null;
    var property = propertyFor(option);
    var provisional = theme + "|" + property + "|" + (attribute(option, "data-fg") || "") + "|" + (attribute(option, "data-bg") || "");
    var pairs = controller.pairs(theme);
    if (Array.isArray(pairs) && pairs.length) {
      var foreground = attribute(option, "data-fg");
      var background = attribute(option, "data-bg");
      for (var index = 0; index < pairs.length; index += 1) {
        var pair = pairs[index];
        if (!isRecord(pair)) continue;
        var pairForeground = pair.foreground || pair.foregroundToken;
        var pairBackground = pair.background || pair.backgroundToken;
        // The same token pair can exist under different CSS properties: never collapse fg/bg alone.
        if (pairForeground === foreground && pairBackground === background && (!pair.property || pair.property === property)) return pair.id || provisional;
      }
      return null;
    }
    return provisional;
  }
  function field(label, value, className) {
    var row = make("div", className || "wb-measure-row");
    row.appendChild(make("dt", null, label));
    row.appendChild(make("dd", null, value));
    return row;
  }
  function roleName(value) {
    var key = textOf(value).toLowerCase();
    if (key === "canvas") return "sfondo della pagina";
    if (key === "ink") return "testo di base";
    if (key === "ui") return "interfaccia";
    if (key === "feedback") return "feedback";
    if (key === "decorative") return "decorativo";
    return textOf(value) || "ruolo non indicato";
  }
  function percentLabel(value) {
    return String(Math.round(value * 100 * 100) / 100).replace(".", ",");
  }
  function paletteEntry(token) {
    var value = readPayload();
    var source = value && isRecord(value.paletteSource) ? value.paletteSource : null;
    var entries = source && Array.isArray(source.sources) ? source.sources : [];
    for (var index = 0; index < entries.length; index += 1) {
      if (isRecord(entries[index]) && entries[index].token === token) return entries[index];
    }
    return null;
  }
  function designEntry(token) {
    var value = design();
    var entries = value && Array.isArray(value.sources) ? value.sources : [];
    for (var index = 0; index < entries.length; index += 1) {
      if (isRecord(entries[index]) && entries[index].token === token) return entries[index];
    }
    return null;
  }
  // Rebuilds the stable source/recipe/control facts for one token of the selected pair. The declared
  // role comes from `paletteSource`; the configured role is only shown when it differs, under its own
  // label. The recipe is explicitly the generator's initial rationale, and the draft line tells the
  // user whether an override is active instead of claiming the recipe is the current formula.
  function tokenDetail(state, theme, token, label) {
    var designValue = design();
    var binding = designValue && isRecord(designValue.tokens) && isRecord(designValue.tokens[token]) ? designValue.tokens[token] : null;
    var palette = paletteEntry(token);
    var recipeKey = binding && typeof binding.recipe === "string" && binding.recipe ? binding.recipe : null;
    var shared = recipeKey && designValue && isRecord(designValue.recipes) && isRecord(designValue.recipes[recipeKey]) ? designValue.recipes[recipeKey] : null;
    var usage = binding && typeof binding.usage === "string" && binding.usage ? binding.usage : shared && typeof shared.usage === "string" && shared.usage ? shared.usage : "uso non dichiarato";
    var sources = binding && Array.isArray(binding.sources) ? binding.sources : [];
    var labels = [];
    for (var index = 0; index < sources.length; index += 1) {
      if (typeof sources[index] !== "string" || !sources[index]) continue;
      var meta = designEntry(sources[index]);
      var sourceEntry = paletteEntry(sources[index]);
      var facts = [];
      if (meta && typeof meta.name === "string" && meta.name) facts.push("nome " + meta.name);
      if (sourceEntry && typeof sourceEntry.role === "string" && sourceEntry.role) {
        facts.push("ruolo dichiarato: " + roleName(sourceEntry.role));
        if (meta && typeof meta.role === "string" && meta.role && meta.role !== sourceEntry.role) facts.push("ruolo effettivo (config): " + roleName(meta.role));
      } else if (meta && typeof meta.role === "string" && meta.role) {
        facts.push("ruolo effettivo: " + roleName(meta.role));
      }
      labels.push(sources[index] + (facts.length ? " (" + facts.join(" · ") + ")" : ""));
    }
    var ownRole = palette && typeof palette.role === "string" && palette.role ? " · ruolo dichiarato del token: " + roleName(palette.role) : "";
    var controls = binding && isRecord(binding.controls) && isRecord(binding.controls[theme]) ? binding.controls[theme] : null;
    var controlLines = [];
    if (controls && typeof controls.override === "string" && controls.override) controlLines.push(controls.override + " · override completo");
    if (controls && typeof controls.mix === "string" && controls.mix) {
      controlLines.push(controls.mix + " · mix superficie" + (finite(controls.defaultMix) ? " (default " + percentLabel(controls.defaultMix) + "%)" : ""));
    }
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var draftKeys = [];
    if (controls && typeof controls.override === "string" && Object.hasOwn(draft, controls.override)) draftKeys.push(controls.override);
    if (controls && typeof controls.mix === "string" && Object.hasOwn(draft, controls.mix)) draftKeys.push(controls.mix);
    var container = make("div");
    container.appendChild(make("p", "eyebrow", label));
    var tokenLine = make("p");
    tokenLine.appendChild(make("code", null, token));
    tokenLine.appendChild(make("span", null, " · " + usage));
    container.appendChild(tokenLine);
    container.appendChild(make("p", "margin-note", "Sorgenti: " + (labels.length ? labels.join(", ") : "non dichiarate") + ownRole + "."));
    container.appendChild(make("p", "margin-note", "Ricetta iniziale del generatore: " + (recipeKey ? recipeKey + (shared && typeof shared.kind === "string" && shared.kind ? " (" + shared.kind + ")" : "") : "non dichiarata") + "."));
    container.appendChild(make("p", "margin-note", "Controlli pubblici (tema " + themeName(theme) + "): " + (controlLines.length ? controlLines.join("; ") : "nessuno dichiarato") + "."));
    container.appendChild(make("p", "margin-note", draftKeys.length ? "Bozza attiva: " + draftKeys.join(", ") + "." : "Nessun override in bozza: vale la formula dei byte catturati."));
    return container;
  }
  function renderDetails(state) {
    if (!details || !selectionAvailable) return;
    var current = state && isRecord(state) ? state : stateNow();
    clear(details);
    var option = selectedOption();
    var article = make("article", "wb-details");
    if (!option) {
      article.appendChild(make("p", null, "Nessuna coppia selezionata: il banco non inventa coppie."));
      details.appendChild(article);
      return;
    }
    var theme = checkedTheme();
    var foreground = attribute(option, "data-fg") || "";
    var background = attribute(option, "data-bg") || "";
    var kind = attribute(option, "data-kind") || "text";
    var property = propertyFor(option);
    var usage = attribute(option, "data-usage") || (foreground + " su " + background);
    var slot = thresholdsFor(option)[theme];
    var minimum = slot ? slot.minimum : "";
    var target = slot ? slot.target : "";
    article.appendChild(make("h3", null, usage));
    article.appendChild(make("p", null, foreground + " su " + background + " · " + (kind === "non-text" ? "bordo o indicatore" : "testo") + " · proprietà " + property));
    var usageLine = make("p", "margin-note", "Tema " + themeName(theme) + ": primo piano e sfondo sono letti dalle stesse variabili CSS della resa.");
    article.appendChild(usageLine);
    var bindingGrid = make("div", "grid-2");
    bindingGrid.appendChild(tokenDetail(current, theme, foreground, "Primo piano"));
    bindingGrid.appendChild(tokenDetail(current, theme, background, "Sfondo"));
    article.appendChild(bindingGrid);
    // Border/outline need the same padded surface wrapper as the runtime specimen: the outer edge
    // and the offset ring live outside the specimen box, so the wrapper paints the measured surface.
    var snippetText = property === "borderColor"
      ? "border: 2px solid var(" + foreground + ");\nbackground-color: var(" + background + ");\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class=\"specimen\" role=\"img\" aria-label=\"Campione statico del bordo\"> */\n.surface {\n  padding: 12px;\n  background: var(" + background + ");\n  border-radius: 8px;\n}"
      : property === "outlineColor"
        ? "outline: 3px solid var(" + foreground + ");\noutline-offset: 2px;\nbackground-color: var(" + background + ");\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class=\"specimen\" role=\"img\" aria-label=\"Campione statico dell'anello\"> */\n.surface {\n  padding: 12px;\n  background: var(" + background + ");\n  border-radius: 8px;\n}"
        : "color: var(" + foreground + ");\nbackground-color: var(" + background + ");";
    var snippet = make("pre");
    setAttribute(snippet, "tabindex", "0");
    setAttribute(snippet, "aria-label", "Snippet CSS della coppia, con le stesse variabili della resa");
    snippet.appendChild(make("code", null, snippetText));
    article.appendChild(snippet);
    var thresholds = make("dl", "wb-thresholds");
    thresholds.appendChild(field("Minimo tema " + themeName(theme), minimum ? ratioText(Number(minimum)) : "non dichiarato"));
    thresholds.appendChild(field("Target tema " + themeName(theme), target ? ratioText(Number(target)) : "non dichiarato"));
    thresholds.appendChild(field("Tema e preferenza", "Il tema è la variante misurata; la preferenza di sistema è separata e non emulata."));
    article.appendChild(thresholds);
    var css = cssMeta();
    var note = css.status === "stale"
      ? "Stato: output non aggiornato (stale). Le misure riguardano i byte catturati; la ricetta descritta è il rationale iniziale, non la formula attiva dei byte correnti."
      : css.source === "generated-candidate"
        ? "Stato: candidato generato (diagnostico), non un file di output; le misure riguardano il candidato."
        : "Le misure riguardano i byte CSS catturati.";
    article.appendChild(make("p", "margin-note", note));
    article.appendChild(make("p", "margin-note", "Byte associati: " + bytesText("baseline") + "."));
    details.appendChild(article);
  }
  // A control is only submitted when the user actually changed it. The declared default is a
  // placeholder, never an active value, so an untouched mix cannot be exported as an unsolicited knob.
  function bindControl(node, control, kind) {
    var entry = { node: node, control: control, kind: kind, dirty: false };
    var mark = function () { entry.dirty = true; };
    if (node && typeof node.addEventListener === "function") {
      node.addEventListener("input", mark);
      node.addEventListener("change", mark);
    }
    return entry;
  }
  function renderControls(state) {
    if (!controlsBody) return;
    if (!selectionAvailable) {
      if (lastControlsKey === "__unavailable__") return;
      lastControlsKey = "__unavailable__";
      controlInputs = [];
      clear(controlsBody);
      controlsBody.appendChild(make("p", "margin-note", "Nessun controllo pubblico: la coppia attiva non è disponibile nel catalogo statico."));
      return;
    }
    var option = selectedOption();
    if (!option) { clear(controlsBody); controlInputs = []; controlsBody.appendChild(make("p", "margin-note", "Nessuna coppia selezionata: nessun controllo pubblico.")); return; }
    var theme = checkedTheme();
    var foreground = attribute(option, "data-fg") || "";
    var background = attribute(option, "data-bg") || "";
    var key = foreground + "|" + background + "|" + theme;
    if (key === lastControlsKey) { syncDraft(state); return; }
    lastControlsKey = key;
    clear(controlsBody);
    controlInputs = [];
    var designValue = design();
    var tokens = foreground === background ? [foreground] : [foreground, background];
    var rendered = 0;
    for (var t = 0; t < tokens.length; t += 1) {
      var binding = designValue && isRecord(designValue.tokens) ? designValue.tokens[tokens[t]] : null;
      var controls = binding && isRecord(binding.controls) && isRecord(binding.controls[theme]) ? binding.controls[theme] : null;
      if (!controls) continue;
      if (typeof controls.override === "string" && controls.override) {
        var overrideRow = make("div", "wb-field");
        var overrideId = "smart-colors-workbench-control-" + controls.override.replace(/[^a-zA-Z0-9_-]/g, "-");
        var overrideLabel = make("label", null, tokens[t] + " · override completo");
        setAttribute(overrideLabel, "for", overrideId);
        var overrideInput = make("input");
        overrideInput.type = "text";
        overrideInput.id = overrideId;
        setAttribute(overrideInput, "data-control", controls.override);
        setAttribute(overrideInput, "data-kind", "override");
        setAttribute(overrideInput, "autocomplete", "off");
        setAttribute(overrideInput, "spellcheck", "false");
        overrideInput.placeholder = "es. oklch(0.5 0.1 250)";
        overrideRow.appendChild(overrideLabel);
        overrideRow.appendChild(overrideInput);
        controlsBody.appendChild(overrideRow);
        controlInputs.push(bindControl(overrideInput, controls.override, "override"));
        rendered += 1;
      }
      if (typeof controls.mix === "string" && controls.mix) {
        var mixRow = make("div", "wb-field");
        var mixId = "smart-colors-workbench-control-" + controls.mix.replace(/[^a-zA-Z0-9_-]/g, "-");
        var mixLabel = make("label", null, tokens[t] + " · mix superficie (%)");
        setAttribute(mixLabel, "for", mixId);
        var mixInput = make("input");
        mixInput.type = "number";
        mixInput.id = mixId;
        setAttribute(mixInput, "data-control", controls.mix);
        setAttribute(mixInput, "data-kind", "mix");
        setAttribute(mixInput, "min", "0");
        setAttribute(mixInput, "max", "100");
        setAttribute(mixInput, "step", "0.1");
        var defaultPercent = finite(controls.defaultMix) ? String(Math.round(controls.defaultMix * 100 * 100) / 100) : "";
        if (defaultPercent) mixInput.placeholder = defaultPercent;
        mixRow.appendChild(mixLabel);
        mixRow.appendChild(mixInput);
        mixRow.appendChild(make("span", "margin-note", "Default: " + (defaultPercent ? defaultPercent + "%" : "non disponibile") + " (segnaposto: nessun override finché non modifichi il campo)"));
        controlsBody.appendChild(mixRow);
        controlInputs.push(bindControl(mixInput, controls.mix, "mix"));
        rendered += 1;
      }
    }
    if (!rendered) controlsBody.appendChild(make("p", "margin-note", "Nessun controllo pubblico dichiarato per questa coppia e questo tema. Il banco non inventa knob."));
    syncDraft(state);
  }
  // Control values reflect the CURRENT saved draft and clear when a control is no longer overridden.
  // A field the user is editing (dirty) is never overwritten; a restored field returns to its
  // placeholder default.
  function syncDraft(state) {
    var draft = state && isRecord(state.draft) ? state.draft : {};
    for (var index = 0; index < controlInputs.length; index += 1) {
      var entry = controlInputs[index];
      if (entry.dirty || doc.activeElement === entry.node) continue;
      var next = "";
      if (Object.hasOwn(draft, entry.control)) {
        var value = draft[entry.control];
        if (value !== null && value !== undefined) next = entry.kind === "mix" ? String(value).replace("%", "") : String(value);
      }
      if (entry.node.value !== next) entry.node.value = next;
    }
  }
  function measureRow(label, content) {
    var row = make("div", "wb-measure-row");
    row.appendChild(make("dt", null, label));
    var value = make("dd");
    if (content !== null && content !== undefined) value.appendChild(content);
    row.appendChild(value);
    return row;
  }
  // Per-specimen result: specimen first, then a scoped ratio, the exact criterion and threshold derived
  // from the measurement, the contextual applicability, and the project target with its own state.
  // Any runtime error stays listed and is never hidden.
  function renderMeasure(node, view, slot, complete, option) {
    if (!node) return;
    clear(node);
    if (!view) {
      node.appendChild(field("Rapporto", "Nessuna vista " + slot + " restituita dal runtime."));
      return;
    }
    var measurement = isRecord(view.measurement) ? view.measurement : null;
    var criterion = criterionFor(option, measurement);
    var ratio = make("p", "wb-ratio");
    ratio.appendChild(make("span", "wb-ratio-value", measurement ? ratioText(measurement.ratio, [measurement.minimum, measurement.target]) : "non misurata"));
    var verdict = make("span", "wb-verdict", criterionLabel(criterion));
    setAttribute(verdict, "data-status", criterionStatus(criterion));
    ratio.appendChild(verdict);
    var ratioDd = make("dd");
    ratioDd.appendChild(ratio);
    if (!complete) ratioDd.appendChild(make("span", "wb-coverage", "Copertura incompleta: questo esito è locale e non un verdetto globale."));
    var ratioRow = make("div", "wb-measure-row");
    ratioRow.appendChild(make("dt", null, "Rapporto"));
    ratioRow.appendChild(ratioDd);
    node.appendChild(ratioRow);
    // One criterion+threshold row, one separate target row. Common applicability is stated once
    // above the frames, so each card never repeats the same paragraph.
    var minimumRow = measureRow("Minimo richiesto e criterio", make("span", null, criterionValue(criterion)));
    minimumRow.className += " wb-threshold";
    node.appendChild(minimumRow);
    var targetRow = measureRow("Obiettivo progetto (non WCAG)", make("span", null, targetText(criterion)));
    targetRow.className += " wb-threshold";
    node.appendChild(targetRow);
    var provenance = make("details", "is-detail");
    provenance.appendChild(make("summary", null, "Provenienza della misura"));
    provenance.appendChild(make("p", null, slot + " · tema " + themeName(view.theme) + " · " + variantName(view.variant) + " · " + bytesText(view.variant)));
    var count = Array.isArray(view.measurements) ? view.measurements.length : 0;
    if (count > 1) provenance.appendChild(make("p", null, "Misure: " + String(count)));
    var provenanceRow = measureRow("Dettagli", provenance);
    provenanceRow.firstChild.className = "wb-visually-hidden";
    node.appendChild(provenanceRow);
    var errors = Array.isArray(view.errors) ? view.errors : [];
    if (errors.length) {
      var errorRow = make("div", "wb-measure-row");
      errorRow.appendChild(make("dt", null, "Errori"));
      var errorList = make("dd");
      for (var index = 0; index < errors.length; index += 1) {
        var error = isRecord(errors[index]) ? errors[index] : {};
        errorList.appendChild(make("span", null, (error.phase ? error.phase + " · " : "") + (error.message ? String(error.message) : "errore non indicato") + (index < errors.length - 1 ? "; " : "")));
      }
      errorRow.appendChild(errorList);
      node.appendChild(errorRow);
    }
  }
  function countOf(value) {
    if (Array.isArray(value)) return value.length;
    if (finite(value)) return value;
    return null;
  }
  function deltaText(value) {
    if (!finite(value)) return null;
    var magnitude = Math.abs(value).toFixed(2).replace(".", ",");
    if (value > 0) return "+" + magnitude;
    if (value < 0) return "−" + magnitude;
    return "0,00";
  }
  function sideName(value) {
    if (value === "background") return "sfondo";
    if (value === "foreground") return "primo piano";
    return "lato non indicato";
  }
  function regressionText(item) {
    if (!isRecord(item)) return textOf(item);
    var label = item.label || item.pairId || "coppia non indicata";
    var where = item.theme === "light" || item.theme === "dark" ? " (tema " + themeName(item.theme) + ")" : "";
    var before = finite(item.before) ? ratioText(item.before) : "non misurata";
    var after = finite(item.after) ? ratioText(item.after) : "non misurata";
    return label + where + ": " + before + " → " + after;
  }
  function scopeText(scope) {
    if (!isRecord(scope)) return null;
    var parts = [];
    if (scope.affectedTheme === "light" || scope.affectedTheme === "dark") parts.push("tema " + themeName(scope.affectedTheme) + " modificato");
    if (Array.isArray(scope.measuredThemes) && scope.measuredThemes.length) parts.push("temi misurati: " + scope.measuredThemes.map(themeName).join(", "));
    if (Array.isArray(scope.unchangedThemes) && scope.unchangedThemes.length) parts.push("altri temi rimisurati solo per regressioni: " + scope.unchangedThemes.map(themeName).join(", "));
    return parts.length ? "Ambito: " + parts.join(" · ") + "." : null;
  }
  // The runtime owns the two proposal frames. The factory only toggles the section visibility and
  // clears it when no verified proposal exists; it never paints a serialized swatch in those nodes.
  function setProposalFrames(verified) {
    if (proposalFrames) proposalFrames.hidden = !verified;
    if (!verified) {
      if (proposalBefore) clear(proposalBefore);
      if (proposalAfter) clear(proposalAfter);
    }
  }
  function suggestionThresholds(state) {
    var selection = state && isRecord(state.selection) ? state.selection : {};
    var theme = selection.theme === "dark" ? "dark" : "light";
    var option = selection.pairId ? optionForPairId(selection.pairId, theme) : selectedOption();
    var slot = option ? thresholdsFor(option)[theme] : null;
    var minimum = slot && slot.minimum !== "" && finite(Number(slot.minimum)) ? Number(slot.minimum) : null;
    var target = slot && slot.target !== "" && finite(Number(slot.target)) ? Number(slot.target) : null;
    return { minimum: minimum, target: target, list: [minimum, target] };
  }
  // The result the user is actually looking at: the selected theme view, or the right-hand view in a
  // tuned/draft comparison. Used only to state the project-target status honestly in a `none` result.
  function selectedMeasurement(state) {
    var selection = state && isRecord(state.selection) ? state.selection : {};
    var views = state && Array.isArray(state.views) ? state.views : [];
    var comparison = selection.comparison === "tuning" || selection.comparison === "draft" ? selection.comparison : "themes";
    var theme = selection.theme === "dark" ? "dark" : "light";
    for (var index = 0; index < views.length; index += 1) {
      var view = views[index];
      if (!isRecord(view)) continue;
      if (comparison !== "themes" ? view.slot === "right" : view.theme === theme) {
        return isRecord(view.measurement) ? view.measurement : null;
      }
    }
    return null;
  }
  // A `none` result says exactly what the current result state is. It never implies that no change is
  // ever needed: it states the minimum that the search addresses and whether the project target is met.
  function noneTargetSentence(state, suggestion) {
    var threshold = suggestionThresholds(state);
    var measurement = selectedMeasurement(state);
    var minimum = measurement && finite(measurement.minimum) ? measurement.minimum : threshold.minimum;
    var target = measurement && finite(measurement.target) ? measurement.target : threshold.target;
    var ratio = measurement && finite(measurement.ratio) ? measurement.ratio : (suggestion && finite(suggestion.before) ? suggestion.before : null);
    var targetState;
    if (target === null || ratio === null) targetState = "Target del progetto non verificabile con questa misura.";
    else if (ratio >= target) targetState = "Target del progetto " + ratioText(target) + " raggiunto.";
    else targetState = "Target del progetto " + ratioText(target) + " non raggiunto.";
    var minimumState = minimum === null ? "Questa ricerca corregge solo il minimo dichiarato." : "Questa ricerca corregge solo il minimo " + ratioText(minimum) + ".";
    return targetState + " " + minimumState;
  }
  function renderSuggestion(state) {
    if (!proposal) return;
    clear(proposal);
    var suggestion = state && isRecord(state.suggestion) ? state.suggestion : null;
    if (!suggestion) {
      suggestionVerified = false;
      suggestionPresent = false;
      setProposalFrames(false);
      if (proposal) proposal.hidden = true;
      if (suggestionsTitle) suggestionsTitle.textContent = "Cerca una correzione";
      if (applyButton) { applyButton.disabled = true; applyButton.hidden = true; }
      if (discardButton) { discardButton.hidden = true; discardButton.disabled = true; }
      return;
    }
    suggestionPresent = true;
    if (proposal) proposal.hidden = false;
    if (discardButton) { discardButton.hidden = false; discardButton.disabled = busy || typeof controller.discardSuggestion !== "function"; }
    var statusValue = suggestion.status;
    var verified = statusValue === "verified";
    if (suggestionsTitle) suggestionsTitle.textContent = verified ? "Proposta di correzione" : "Esito della ricerca";
    setProposalFrames(verified);
    var side = sideName(suggestion.side);
    var title = verified
      ? "Proposta verificata per il " + side
      : statusValue === "none"
        ? "Minimo già raggiunto"
        : statusValue === "regression"
          ? "Proposta scartata per regressioni"
          : "Ricerca non disponibile";
    proposal.appendChild(make("p", "wb-proposal-title", title));
    if (verified) proposal.appendChild(make("p", null, "La proposta raggiunge il minimo dichiarato con il CSS dei byte catturati; il target del progetto resta un obiettivo separato. Non rigenera il generatore."));
    else if (statusValue === "none") proposal.appendChild(make("p", null, noneTargetSentence(state, suggestion)));
    else if (statusValue === "regression") proposal.appendChild(make("p", null, "Il candidato non ha superato la verifica: nessun valore viene presentato come correzione."));
    else proposal.appendChild(make("p", null, "Il runtime non ha potuto verificare una proposta: nessun esito positivo viene mostrato."));
    var proposedValue = typeof suggestion.value === "string" && suggestion.value.trim() ? suggestion.value.trim() : null;
    if (proposedValue && (verified || statusValue === "regression")) {
      var valueLine = make("p", null, verified ? "Valore proposto: " : "Candidato scartato: ");
      valueLine.appendChild(make("code", "wb-proposal-value", proposedValue));
      proposal.appendChild(valueLine);
    }
    var threshold = suggestionThresholds(state);
    if (suggestion.before !== undefined || suggestion.after !== undefined) {
      proposal.appendChild(make("p", null, "Prima: " + (finite(suggestion.before) ? ratioText(suggestion.before, threshold.list) : "non misurata") + " · Dopo: " + (finite(suggestion.after) ? ratioText(suggestion.after, threshold.list) : "non misurata") + "."));
    }
    // The identity and the runtime reasoning stay available, but the decision surface stays short:
    // only the values that change and the before/after ratios remain visible by default.
    var technical = [];
    var identity = [];
    if (suggestion.control) identity.push("controllo " + suggestion.control);
    if (suggestion.token) identity.push("token " + suggestion.token);
    identity.push("lato " + side);
    technical.push(make("p", "margin-note", identity.join(" · ") + "."));
    if ((threshold.minimum !== null || threshold.target !== null) && statusValue !== "none") {
      technical.push(make("p", "margin-note", "Soglia rilevante: " + (threshold.minimum !== null ? "minimo " + ratioText(threshold.minimum) : "minimo non dichiarato") + " · " + (threshold.target !== null ? "target " + ratioText(threshold.target) : "target non dichiarato") + "."));
    }
    var delta = deltaText(suggestion.deltaL);
    var gamut = suggestion.gamutAdjusted === true;
    if (delta !== null || gamut) {
      var deltaLine = delta !== null ? "ΔL " + delta + "." : "";
      if (gamut) deltaLine += (deltaLine ? " " : "") + "Il fit di gamut ha ridotto il chroma: hue resta l'intento, ma non è garantito identico.";
      else deltaLine += (deltaLine ? " " : "") + "Nessun aggiustamento di gamut applicato.";
      technical.push(make("p", "margin-note", deltaLine));
    }
    var checked = countOf(suggestion.checked);
    if (checked !== null) technical.push(make("p", "margin-note", "Controlli eseguiti: " + checked + (countOf(suggestion.unmeasured) !== null ? " · non misurati: " + countOf(suggestion.unmeasured) : "") + "."));
    var regressions = Array.isArray(suggestion.regressions) ? suggestion.regressions : [];
    if (regressions.length) technical.push(make("p", "margin-note", "Regressioni: " + regressions.map(regressionText).join("; ") + "."));
    var scope = scopeText(suggestion.scope);
    if (scope) technical.push(make("p", "margin-note", scope));
    if (suggestion.reason) technical.push(make("p", "margin-note", String(suggestion.reason)));
    if (technical.length) {
      var technicalDetails = make("details", "is-detail");
      technicalDetails.appendChild(make("summary", null, "Dettagli tecnici della proposta"));
      for (var technicalIndex = 0; technicalIndex < technical.length; technicalIndex += 1) technicalDetails.appendChild(technical[technicalIndex]);
      proposal.appendChild(technicalDetails);
    }
    if (verified) proposal.appendChild(make("p", "margin-note", "Anteprima non applicata: usa Prova proposta per applicarla come override temporaneo."));
    suggestionVerified = Boolean(verified);
    if (applyButton) { applyButton.hidden = !verified; applyButton.disabled = !verified; }
  }
  // Honest session line owned by the shell: a local preview is not a saved report. A verified but
  // unapplied proposal and unsaved draft changes are named explicitly instead of implying persistence.
  function renderSessionStatus(state) {
    if (!sessionStatus) return;
    var suggestion = state && isRecord(state.suggestion) ? state.suggestion : null;
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var draftCount = Object.keys(draft).length;
    var phase = state && state.phase ? String(state.phase) : "idle";
    var message = "Anteprima locale";
    if (sourceBlocked) message += " · selezione non disponibile";
    else if (suggestion && suggestion.status === "verified") message += " · proposta verificata in attesa";
    else if (draftCount) message += " · " + (draftCount === 1 ? "1 modifica in bozza non salvata" : draftCount + " modifiche in bozza non salvate");
    if (!sourceBlocked && suggestion && suggestion.status !== "verified") {
      if (suggestion.status === "none") message += " · minimo già raggiunto";
      else if (suggestion.status === "regression") message += " · candidato scartato";
      else message += " · ricerca non disponibile";
    }
    if (phase === "running") message += " · verifica in corso";
    setIfChanged(sessionStatus, message);
  }
  // Details depend on the active selection and on the current draft (the draft line changes when an
  // override is saved). The signature avoids rebuilding the panel on unrelated renders, which would
  // drop focus from the keyboard-focusable snippet.
  function detailsSignature(state) {
    var selection = state && isRecord(state.selection) ? state.selection : {};
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var keys = Object.keys(draft).sort();
    var pairs = [];
    for (var index = 0; index < keys.length; index += 1) pairs.push(keys[index] + "=" + textOf(draft[keys[index]]));
    return textOf(selection.pairId) + "|" + textOf(selection.theme) + "|" + textOf(selection.comparison) + "|" + pairs.join(",");
  }
  function setIfChanged(node, value) { if (node && node.textContent !== value) node.textContent = value; }
  function renderUnavailableSelection(pairId) {
    selectionAvailable = false;
    lastControlsKey = "";
    if (!details) return;
    clear(details);
    var article = make("article", "wb-details");
    article.appendChild(make("p", null, "La coppia attiva del runtime non è nel catalogo statico: " + textOf(pairId) + ". Nessun dettaglio viene inventato."));
    details.appendChild(article);
  }
  // The runtime is authoritative for selection: radios, selects, source filter, details and panel
  // headings are projected from `state.selection`/`state.views`. DOM properties are set directly
  // (never a change event), so an update cannot re-trigger the UI or move focus. Returns true when the
  // active key changed, so the caller can rebuild details/controls (initial render included).
  function syncSelection(selection) {
    var value = isRecord(selection) ? selection : {};
    var theme = value.theme === "dark" ? "dark" : "light";
    if (themeDark) themeDark.checked = theme === "dark";
    if (themeLight) themeLight.checked = theme === "light";
    var comparison = value.comparison === "tuning" || value.comparison === "draft" ? value.comparison : "themes";
    if (comparisonThemes) comparisonThemes.checked = comparison === "themes";
    if (comparisonTuning) comparisonTuning.checked = comparison === "tuning";
    if (comparisonDraft) comparisonDraft.checked = comparison === "draft";
    var pairId = typeof value.pairId === "string" && value.pairId ? value.pairId : null;
    var key = (pairId || "") + "|" + theme + "|" + comparison;
    var changed = key !== lastSelectionKey;
    lastSelectionKey = key;
    if (!pairSelect) return changed;
    if (!pairId) {
      // No active pair yet: keep the static selection coherent with the still-selected option.
      selectionAvailable = Boolean(selectedOption());
      return changed;
    }
    var option = optionForPairId(pairId, theme);
    if (!option) {
      if (changed) renderUnavailableSelection(pairId);
      return true;
    }
    selectionAvailable = true;
    // The source filter must match the active pair: preserve a compatible user choice, otherwise
    // reset to this pair's own source (or all) instead of leaving a leftover unrelated source.
    var own = (attribute(option, "data-sources") || "").split(/\s+/).filter(Boolean);
    var currentSource = sourceSelect ? sourceSelect.value : "";
    var compatible = currentSource === "" || own.indexOf(currentSource) !== -1;
    // While an empty-source selection is pinned to the runtime's current pair, the user's source
    // choice is preserved instead of being reset to this pair's own source.
    var pinned = sourceBlocked && pairId === blockedPairId;
    var sourceReset = false;
    if (sourceSelect && !compatible && !pinned) { sourceSelect.value = own.length ? own[0] : ""; sourceReset = true; }
    if (pairSelect.value !== option.value) pairSelect.value = option.value;
    var all = options();
    for (var index = 0; index < all.length; index += 1) all[index].selected = all[index] === option;
    return changed || sourceReset;
  }
  function optionForPairId(pairId, theme) {
    if (!pairSelect) return null;
    var pairs = controller.pairs(theme);
    var descriptor = null;
    if (Array.isArray(pairs)) {
      for (var index = 0; index < pairs.length; index += 1) {
        if (isRecord(pairs[index]) && pairs[index].id === pairId) { descriptor = pairs[index]; break; }
      }
    }
    if (!descriptor) return null;
    var foreground = descriptor.foreground || descriptor.foregroundToken;
    var background = descriptor.background || descriptor.backgroundToken;
    var property = typeof descriptor.property === "string" && descriptor.property ? descriptor.property : null;
    var list = options();
    for (var candidate = 0; candidate < list.length; candidate += 1) {
      if (attribute(list[candidate], "data-fg") !== foreground || attribute(list[candidate], "data-bg") !== background) continue;
      // The same token pair can exist under different CSS properties; never collapse fg/bg alone.
      if (property && propertyFor(list[candidate]) !== property) continue;
      // The contract kind is authoritative when available (for example `on-color`). It affects the
      // specimen copy only, never the criterion: the criterion still comes from the known kind and
      // the canonical threshold.
      if (typeof descriptor.kind === "string" && descriptor.kind) setAttribute(list[candidate], "data-pair-kind", descriptor.kind);
      return list[candidate];
    }
    return null;
  }
  // Human frame titles: light/dark for the theme comparison, "Attuale"/"Modifica" otherwise. The
  // exact theme and variant stay in each frame's own measure block, not in the title.
  function frameTitle(slot, comparison) {
    if (comparison === "themes") return slot === "left" ? "Tema chiaro" : "Tema scuro";
    return slot === "left" ? "Attuale" : "Modifica";
  }
  function syncViews(views) {
    var comparison = checkedComparison();
    var list = Array.isArray(views) ? views : [];
    var leftView = null;
    var rightView = null;
    for (var index = 0; index < list.length; index += 1) {
      if (list[index] && list[index].slot === "left") leftView = list[index];
      if (list[index] && list[index].slot === "right") rightView = list[index];
    }
    setIfChanged(leftTitle, frameTitle("left", comparison));
    setIfChanged(rightTitle, frameTitle("right", comparison));
    if (left) setAttribute(left, "aria-label", "Vista CSS sinistra · " + frameTitle("left", comparison) + (leftView ? " · tema " + themeName(leftView.theme) + " · " + variantName(leftView.variant) : ""));
    if (right) setAttribute(right, "aria-label", "Vista CSS destra · " + frameTitle("right", comparison) + (rightView ? " · tema " + themeName(rightView.theme) + " · " + variantName(rightView.variant) : ""));
  }
  // Short heading for the current selection, plus the exact token identity and the contextual
  // criterion. The human title stays primary; the tokens are now visible here, not only in details.
  function renderIdentity(option) {
    if (!identityNode) return;
    clear(identityNode);
    if (!option) { identityNode.appendChild(make("span", null, "Nessuna coppia selezionata.")); return; }
    identityNode.appendChild(make("code", null, attribute(option, "data-fg") || ""));
    identityNode.appendChild(make("span", null, " su "));
    identityNode.appendChild(make("code", null, attribute(option, "data-bg") || ""));
    identityNode.appendChild(make("span", null, " · " + optionKindLabel(option)));
  }
  function renderActionTheme() {
    if (!actionThemeNode) return;
    setIfChanged(actionThemeNode, "Tema per proposta e override: " + themeName(checkedTheme()) + ".");
  }
  // The toolbar summary is a human use, not a token list. An unknown catalogue pair keeps a neutral
  // label and exposes the exact tokens only as a secondary technical identifier.
  function renderCurrentUse() {
    if (!currentUse) return;
    clear(currentUse);
    var option = sourceBlocked ? null : selectedOption();
    if (!option) { currentUse.appendChild(make("span", null, "Nessun uso disponibile")); return; }
    currentUse.appendChild(make("strong", null, pickerHuman(option)));
    currentUse.appendChild(make("span", "wb-current-use-kind", optionKindLabel(option)));
    if (!pickerHasHuman(option)) currentUse.appendChild(make("code", "wb-current-use-tech", pickerTech(option)));
  }
  function renderCurrent() {
    var option = selectedOption();
    if (currentHeading) {
      clear(currentHeading);
      if (sourceBlocked) currentHeading.appendChild(make("strong", null, "Nessun confronto disponibile"));
      else {
        var title = option ? attribute(option, "data-usage") || "" : "";
        if (title) currentHeading.appendChild(make("strong", null, title));
        else currentHeading.appendChild(make("span", null, "Nessuna coppia selezionata"));
      }
    }
    renderIdentity(sourceBlocked ? null : option);
    renderCurrentUse();
    if (purposeNode) setIfChanged(purposeNode, sourceBlocked ? "Nessun criterio applicato: la sorgente non ha una coppia disponibile." : purposeFor(option));
    renderActionTheme();
  }
  // Matched uses for one source, derived from the real diagnostics only: foreground bindings first,
  // background dependencies as an explicit fallback.
  function matchUses(chosen) {
    var list = options();
    var foreground = [];
    var background = [];
    for (var index = 0; index < list.length; index += 1) {
      var option = list[index];
      var fgSources = (attribute(option, "data-fg-sources") || "").split(/\s+/).filter(Boolean);
      var bgSources = (attribute(option, "data-bg-sources") || "").split(/\s+/).filter(Boolean);
      if (fgSources.indexOf(chosen) !== -1) foreground.push(option);
      else if (bgSources.indexOf(chosen) !== -1) background.push(option);
    }
    return { foreground: foreground, background: background };
  }
  function useRankOf(option) {
    var raw = attribute(option, "data-use-rank");
    var value = raw === null || raw === "" ? 999 : Number(raw);
    return isFinite(value) ? value : 999;
  }
  // Rank by the serialized semantic rank (stable for equal ranks), then diversify round-robin across
  // buckets so the primary choices are different uses. A single-bucket source still yields its six
  // best text choices instead of being forced to one.
  function rankOptions(list) {
    var copy = [];
    for (var index = 0; index < list.length; index += 1) copy.push(list[index]);
    copy.sort(function (a, b) { return useRankOf(a) - useRankOf(b); });
    return copy;
  }
  function diversified(list, activeOption) {
    var buckets = [];
    var seen = {};
    for (var item = 0; item < list.length; item += 1) {
      if (list[item] === activeOption) continue;
      var key = attribute(list[item], "data-use-bucket") || "other";
      if (!seen[key]) { seen[key] = { rank: useRankOf(list[item]), items: [] }; buckets.push(seen[key]); }
      seen[key].items.push(list[item]);
    }
    buckets.sort(function (a, b) { return a.rank - b.rank; });
    var ordered = [];
    if (activeOption) ordered.push(activeOption);
    var round = 0;
    var pushed = true;
    while (pushed) {
      pushed = false;
      for (var bucket = 0; bucket < buckets.length; bucket += 1) {
        if (round < buckets[bucket].items.length) { ordered.push(buckets[bucket].items[round]); pushed = true; }
      }
      round += 1;
    }
    return ordered;
  }
  function preferredUses(chosen) {
    if (!chosen) return { options: [], backgroundOnly: false };
    var matched = matchUses(chosen);
    if (matched.foreground.length) return { options: rankOptions(matched.foreground), backgroundOnly: false };
    return { options: rankOptions(matched.background), backgroundOnly: matched.background.length > 0 };
  }
  function pickerFold(value) {
    var raw = textOf(value).toLowerCase();
    if (typeof raw.normalize === "function") {
      try { return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (error) { return raw; }
    }
    return raw;
  }
  function pickerSourceName(token) {
    if (!token) return "Tutte le sorgenti";
    var meta = designEntry(token);
    if (meta && typeof meta.name === "string" && meta.name) return meta.name.charAt(0).toUpperCase() + meta.name.slice(1);
    var short = token.replace(/^--/, "").replace(/^(palette|color)-/, "");
    var words = short.split("-").filter(Boolean);
    if (!words.length) return token;
    var out = [];
    for (var index = 0; index < words.length; index += 1) out.push(words[index].charAt(0).toUpperCase() + words[index].slice(1));
    return out.join(" ");
  }
  function pickerFallback(option) {
    return (attribute(option, "data-fg") || "") + " su " + (attribute(option, "data-bg") || "");
  }
  function usageHasHuman(option) {
    var usage = attribute(option, "data-usage") || "";
    return Boolean(usage) && usage !== pickerFallback(option) && usage.indexOf("--") !== 0;
  }
  function usageHuman(option) {
    return usageHasHuman(option) ? attribute(option, "data-usage") || "" : "Uso senza nome";
  }
  // Picker labels are authoritative and serialized per option. A known on-color pair can be
  // readable in the picker while the existing data-usage / full heading contract stays untouched.
  function pickerHasHuman(option) {
    var label = attribute(option, "data-picker-label");
    if (label !== null) return Boolean(label);
    return usageHasHuman(option);
  }
  function pickerHuman(option) {
    var label = attribute(option, "data-picker-label");
    if (label !== null) return label || "Uso senza nome";
    return usageHuman(option);
  }
  function pickerTech(option) {
    return pickerFallback(option);
  }
  function pickerBucket(option) {
    return attribute(option, "data-use-bucket") || "other";
  }
  function pickerBucketLabel(bucket) {
    if (bucket === "page") return "Testo su pagina";
    if (bucket === "callout") return "Riquadri";
    if (bucket === "button") return "Pulsanti";
    if (bucket === "border") return "Bordi";
    if (bucket === "focus") return "Indicatore statico";
    return "Altri usi";
  }
  function pickerSearchText(option) {
    var parts = [
      attribute(option, "data-usage"),
      attribute(option, "data-picker-label"),
      attribute(option, "data-fg"),
      attribute(option, "data-bg"),
      optionKindLabel(option),
      attribute(option, "data-sources"),
      attribute(option, "data-fg-sources"),
      attribute(option, "data-bg-sources"),
    ];
    var sources = [attribute(option, "data-sources"), attribute(option, "data-fg-sources"), attribute(option, "data-bg-sources")].join(" ").split(/\s+/);
    for (var index = 0; index < sources.length; index += 1) {
      if (sources[index]) parts.push(pickerSourceName(sources[index]));
    }
    return pickerFold(parts.join(" "));
  }
  // Preferred foreground uses win; a source that only appears as a background dependency falls back
  // to that explicit scope. The current option is kept in the pool when it is compatible, so an
  // external runtime selection always has a truthful selected row.
  function pickerCandidates(chosen) {
    var list = options();
    var pool = [];
    var backgroundOnly = false;
    var active = null;
    var activeValue = pairSelect ? pairSelect.value : "";
    if (!chosen) {
      pool = list.slice();
      for (var allIndex = 0; allIndex < list.length; allIndex += 1) if (list[allIndex].value === activeValue) { active = list[allIndex]; break; }
    } else {
      var matched = matchUses(chosen);
      backgroundOnly = !matched.foreground.length && matched.background.length > 0;
      pool = matched.foreground.length ? matched.foreground.slice() : matched.background.slice();
      var union = matched.foreground.concat(matched.background);
      for (var match = 0; match < union.length; match += 1) if (union[match].value === activeValue) { active = union[match]; break; }
      if (active && pool.indexOf(active) === -1) pool.unshift(active);
    }
    return { options: diversified(pool, active), backgroundOnly: backgroundOnly, active: active };
  }
  function pickerFiltered(scope) {
    var words = pickerFold(pickerQuery).split(/\s+/).filter(Boolean);
    var filtered = [];
    for (var index = 0; index < scope.options.length; index += 1) {
      var option = scope.options[index];
      if (pickerCategory && pickerBucket(option) !== pickerCategory) continue;
      if (words.length) {
        var haystack = pickerSearchText(option);
        var matched = true;
        for (var word = 0; word < words.length; word += 1) {
          if (haystack.indexOf(words[word]) === -1) { matched = false; break; }
        }
        if (!matched) continue;
      }
      filtered.push(option);
    }
    return filtered;
  }
  function pickerCountText(total) {
    var pages = Math.max(1, Math.ceil(total / useVisibleLimit));
    if (total === 0) {
      return pickerQuery || pickerCategory
        ? "Nessun uso corrisponde ai filtri. Modifica la ricerca o scegli Tutti gli usi."
        : "Nessun uso disponibile per questa sorgente.";
    }
    var page = Math.min(pickerPage, pages - 1);
    return total + (total === 1 ? " uso" : " usi") + " · pagina " + (page + 1) + " di " + pages;
  }
  function renderPickerSource(chosen) {
    if (!pickerSource) return;
    setIfChanged(pickerSource, "Sorgente: " + pickerSourceName(chosen) + ". Usi generati dalla palette, non rilevati nel sito.");
  }
  function buildPickerCategories(scope) {
    if (!useCategory) return;
    var present = {};
    for (var index = 0; index < scope.options.length; index += 1) present[pickerBucket(scope.options[index])] = true;
    var keep = pickerCategory && present[pickerCategory] ? pickerCategory : "";
    clear(useCategory);
    var all = make("option", null, "Tutti gli usi");
    all.value = "";
    useCategory.appendChild(all);
    var order = ["page", "callout", "button", "border", "focus", "other"];
    for (var bucket = 0; bucket < order.length; bucket += 1) {
      if (!present[order[bucket]]) continue;
      var option = make("option", null, pickerBucketLabel(order[bucket]));
      option.value = order[bucket];
      useCategory.appendChild(option);
    }
    useCategory.value = keep;
    pickerCategory = keep;
  }
  function setPagerState(button, enabled) {
    if (!button) return;
    // Keep the pager focusable: aria-disabled communicates the boundary without dropping focus
    // to the body when the user reaches the first or last page.
    button.disabled = false;
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
  }
  function updateUsePressed(active) {
    for (var index = 0; index < useButtons.length; index += 1) {
      var button = useButtons[index];
      var on = attribute(button, "data-pair-value") === active;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.disabled = false;
    }
  }
  function resetPickerFilters() {
    pickerQuery = "";
    pickerCategory = "";
    pickerPage = 0;
    if (useSearch && useSearch.value !== "") useSearch.value = "";
    if (useCategory && useCategory.value !== "") useCategory.value = "";
  }
  function useButton(option) {
    var li = make("li");
    var button = make("button", "wb-use");
    button.type = "button";
    setAttribute(button, "data-smart-colors-workbench", "use");
    setAttribute(button, "data-pair-value", option.value);
    button.setAttribute("aria-pressed", pairSelect && pairSelect.value === option.value ? "true" : "false");
    button.disabled = false;
    var main = make("span", "wb-use-main");
    main.appendChild(make("span", "wb-use-label", pickerHuman(option)));
    if (!pickerHasHuman(option)) {
      var tech = make("span", "wb-use-tech");
      tech.appendChild(make("code", null, attribute(option, "data-fg") || ""));
      tech.appendChild(make("span", null, " su "));
      tech.appendChild(make("code", null, attribute(option, "data-bg") || ""));
      main.appendChild(tech);
    }
    button.appendChild(main);
    button.appendChild(make("span", "wb-use-kind", optionKindLabel(option)));
    var mark = make("span", "wb-use-mark", "✓");
    mark.setAttribute("aria-hidden", "true");
    button.appendChild(mark);
    li.appendChild(button);
    useButtons.push(button);
    bindUse(button);
    return li;
  }
  function buildUses(scope) {
    useButtons = [];
    if (!usesBox) return;
    clear(usesBox);
    if (pickerCategory) {
      var categoryFound = false;
      for (var candidate = 0; candidate < scope.options.length; candidate += 1) {
        if (pickerBucket(scope.options[candidate]) === pickerCategory) { categoryFound = true; break; }
      }
      if (!categoryFound) { pickerCategory = ""; if (useCategory) useCategory.value = ""; }
    }
    var filtered = pickerFiltered(scope);
    var pages = Math.max(1, Math.ceil(filtered.length / useVisibleLimit));
    if (pickerPage >= pages) pickerPage = pages - 1;
    if (pickerPage < 0) pickerPage = 0;
    var start = pickerPage * useVisibleLimit;
    var visible = filtered.slice(start, start + useVisibleLimit);
    if (visible.length) {
      var list = make("ul", "wb-uses");
      for (var index = 0; index < visible.length; index += 1) list.appendChild(useButton(visible[index]));
      usesBox.appendChild(list);
    } else {
      usesBox.appendChild(make("p", "wb-uses-empty", pickerCountText(0)));
    }
    if (scope.backgroundOnly) usesBox.appendChild(make("p", "wb-uses-note", "Questo colore compare come sfondo nelle coppie del catalogo: è una dipendenza del token di sfondo."));
    if (useCount) setIfChanged(useCount, pickerCountText(filtered.length));
    setPagerState(usePrev, pickerPage > 0);
    setPagerState(useNext, pickerPage < pages - 1);
  }
  // The result list is the only region rebuilt by paging and filtering. Query, category and pager
  // controls keep their focus; a source change resets all filters, while a measurement update with
  // the same source updates only the pressed state in place.
  function renderUses(chosen) {
    var sourceChanged = chosen !== lastUsesSource;
    if (sourceChanged) {
      lastUsesSource = chosen;
      resetPickerFilters();
      renderPickerSource(chosen);
    }
    var scope = pickerCandidates(chosen);
    if (sourceChanged) buildPickerCategories(scope);
    var key = chosen + "|" + pickerQuery + "|" + pickerCategory + "|" + pickerPage;
    if (sourceChanged || key !== lastUsesKey) {
      buildUses(scope);
      lastUsesKey = chosen + "|" + pickerQuery + "|" + pickerCategory + "|" + pickerPage;
    } else {
      updateUsePressed(pairSelect ? pairSelect.value : "");
    }
  }
  function syncPalette() {
    var chosen = sourceSelect ? sourceSelect.value : "";
    for (var index = 0; index < swatchButtons.length; index += 1) {
      var button = swatchButtons[index];
      var on = attribute(button, "data-token") === chosen;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.disabled = false;
    }
    renderUses(chosen);
  }
  function bindSwatch(button) {
    listen(button, "click", function () { if (busy) return; applySourceSelection(attribute(button, "data-token")); });
  }
  function bindUse(button) {
    listen(button, "click", function () {
      if (busy) { announce("Verifica in corso: attendi la misura prima di cambiare uso."); return; }
      var pending = applyUse(button);
      if (!pending) return;
      closePickerDialog();
      if (typeof pending.then === "function") pending.then(function () {}, function () {});
    });
  }
  function setPairOption(option) {
    if (!pairSelect || !option) return;
    pairSelect.value = option.value;
    var list = options();
    for (var index = 0; index < list.length; index += 1) list[index].selected = list[index] === option;
  }
  // The blocked presentation: nothing verified can be shown for the requested source, so the previous
  // result, the correction, the manual controls and the pair details are hidden with an explicit note.
  function applyBlockedPresentation() {
    if (resultBox) resultBox.hidden = sourceBlocked;
    if (emptyNote) emptyNote.hidden = !sourceBlocked;
    if (correctionBox) correctionBox.hidden = sourceBlocked;
    if (manualBox) manualBox.hidden = sourceBlocked;
    if (exportBox) exportBox.hidden = sourceBlocked;
    if (details) details.hidden = sourceBlocked;
    if (exportButton) exportButton.disabled = sourceBlocked || busy;
    renderSessionStatus(stateNow());
  }
  function setSourceBlocked(message, source) {
    sourceBlocked = true;
    blockedSource = source === undefined ? (sourceSelect ? sourceSelect.value : null) : source;
    var state = stateNow();
    blockedPairId = state && isRecord(state.selection) ? state.selection.pairId : null;
    if (emptyNote) emptyNote.textContent = message;
    applyBlockedPresentation();
    renderCurrent();
  }
  function clearSourceBlocked() {
    if (!sourceBlocked) return;
    sourceBlocked = false;
    blockedSource = null;
    blockedPairId = null;
    applyBlockedPresentation();
  }
  // A swatch (or the canonical source select) is THE source choice. It resolves the source's own
  // preferred foreground use (never a background-only pair from a combined dependency filter) and
  // compares immediately. With no verified use at all, or none available in the current theme, the
  // previous result is cleared with an explicit state instead of a stale pair; changing the theme or
  // the source re-attempts the selection.
  function applySourceSelection(token) {
    if (!sourceSelect) return;
    var next = token || "";
    if (sourceSelect.value !== next) sourceSelect.value = next;
    var theme = checkedTheme();
    var preferred = preferredUses(next);
    if (!preferred.options.length) {
      setSourceBlocked(next ? "Nessuna coppia diagnostica per questo colore: la misura precedente è stata rimossa." : "Scegli un colore per vedere le coppie generate che lo usano.", next);
      syncPalette();
      announce(next ? "Nessuna coppia diagnostica per questo colore." : "Scegli un colore per vedere le coppie generate che lo usano.");
      return;
    }
    var target = null;
    for (var pick = 0; pick < preferred.options.length; pick += 1) if (optionAvailable(preferred.options[pick], theme)) { target = preferred.options[pick]; break; }
    if (!target) {
      setSourceBlocked("Nessuna coppia disponibile per questo colore nel tema " + themeName(theme) + ". Cambia tema per confrontarla.", next);
      syncPalette();
      announce("Nessuna coppia disponibile per questo colore nel tema " + themeName(theme) + ". Cambia tema per confrontarla.");
      return;
    }
    clearSourceBlocked();
    var current = selectedOption();
    var keep = false;
    for (var index = 0; index < preferred.options.length; index += 1) {
      if (preferred.options[index] === current && optionAvailable(current, theme)) keep = true;
    }
    if (!keep) setPairOption(target);
    syncPalette();
    applySelection();
  }
  // A theme or comparison change re-attempts the pinned source when the result is blocked, so the
  // user can always recover from an unavailable-in-theme state.
  function resumeSelection() {
    if (sourceBlocked && blockedSource) { applySourceSelection(blockedSource); return; }
    applySelection();
  }
  function applyUse(button) {
    if (!pairSelect || !button) return null;
    var value = attribute(button, "data-pair-value");
    if (!value) return null;
    var list = options();
    var found = null;
    for (var index = 0; index < list.length; index += 1) if (list[index].value === value) found = list[index];
    if (!found) return null;
    clearSourceBlocked();
    setPairOption(found);
    renderDetails(stateNow());
    renderControls(stateNow());
    return applySelection();
  }
  function closePickerDialog() {
    if (!pickerDialog) return;
    try {
      if (typeof pickerDialog.close === "function" && pickerDialog.open) pickerDialog.close();
      else pickerDialog.open = false;
    } catch (error) {
      try { pickerDialog.open = false; } catch (ignored) { /* the dialog is already inert */ }
    }
    if (openPicker && !openPicker.disabled && typeof openPicker.focus === "function") openPicker.focus();
  }
  function openPickerDialog() {
    if (!pickerDialog) return;
    // Opening starts on the first page so the pinned current use is visible and selected.
    pickerPage = 0;
    lastUsesKey = null;
    renderUses(sourceSelect ? sourceSelect.value : "");
    try {
      if (typeof pickerDialog.showModal === "function") {
        if (!pickerDialog.open) pickerDialog.showModal();
      } else {
        pickerDialog.open = true;
      }
    } catch (error) {
      try { pickerDialog.open = true; } catch (ignored) { /* the opener remains inert */ }
    }
    if (useSearch) {
      if (typeof useSearch.focus === "function") useSearch.focus();
      if (typeof useSearch.select === "function") useSearch.select();
    }
  }
  // The primary path starts on the light/dark comparison, but ONLY from a clean idle state: an already
  // mounted, already running selection or a preexisting draft is never changed. Initialised from the
  // view through the frozen controller API, so the runtime defaults are never modified.
  function initializeSelection() {
    var state = stateNow();
    if (!state) return;
    if (state.phase && state.phase !== "idle") return;
    if (state.draft && typeof state.draft === "object" && Object.keys(state.draft).length) return;
    var selection = isRecord(state.selection) ? state.selection : {};
    if (selection.comparison === "themes") return;
    try {
      var result = controller.select({ comparison: "themes" });
      if (result && typeof result.then === "function") result.then(function () {}, function () {});
    } catch (error) { /* presentation must never break the run */ }
  }
  function render(state) {
    lastState = state;
    // An external runtime selection (a different pair) always restores the normal result; an unrelated
    // republish of the same pair keeps the pinned empty-source state.
    var projectedPairId = state && isRecord(state.selection) ? state.selection.pairId : null;
    if (sourceBlocked && projectedPairId !== blockedPairId) clearSourceBlocked();
    // Rebuild details/controls from the active controller selection whenever its key changes,
    // including the first render. This is what keeps a static build-time pair (for example a warm
    // failing pair) from surviving next to a different runtime selection.
    var selectionChanged = syncSelection(state && state.selection);
    var detailKey = detailsSignature(state);
    if (selectionChanged) filterPairs(state);
    else if (detailKey !== lastDetailsSignature && selectionAvailable) renderDetails(state);
    lastDetailsSignature = detailKey;
    syncViews(state && state.views);
    renderCurrent();
    syncPalette();
    applyBlockedPresentation();
    var phase = state && state.phase ? String(state.phase) : "unavailable";
    // One concise live announcement per state; the runtime error is folded in rather than repeated.
    var error = state && state.error ? " " + String(state.error) : "";
    setStatusVisibility(phase, Boolean(state && state.error), sourceBlocked);
    if (sourceBlocked) {
      announce(emptyNote && emptyNote.textContent ? String(emptyNote.textContent) : "Nessun confronto disponibile per questa sorgente.");
    } else if (phase === "idle") {
      announce("In attesa: scegli un colore e avvia il confronto." + error);
      if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", "Non misurato: seleziona una coppia.")); }
      if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", "Non misurato: seleziona una coppia.")); }
    } else if (phase === "running") {
      announce("Verifica in corso…" + error);
      if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", "Verifica in corso…")); }
      if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", "Verifica in corso…")); }
    } else if (phase === "unavailable") {
      announce("Misura non disponibile." + (state && state.error ? " " + String(state.error) : ""));
      if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", "Non disponibile.")); }
      if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", "Non disponibile.")); }
    } else {
      var views = state && Array.isArray(state.views) ? state.views : [];
      var leftView = null;
      var rightView = null;
      for (var index = 0; index < views.length; index += 1) {
        if (views[index] && views[index].slot === "left") leftView = views[index];
        if (views[index] && views[index].slot === "right") rightView = views[index];
      }
      renderMeasure(leftMeasure, leftView, "sinistra", phase === "complete", selectedOption());
      renderMeasure(rightMeasure, rightView, "destra", phase === "complete", selectedOption());
      if (phase === "complete") announce("Misure di questa coppia aggiornate in questo browser." + error);
      else announce("Misura incompleta: nessun esito globale." + error);
    }
    renderSuggestion(state);
    renderSessionStatus(state);
    renderControls(state);
    // The exported text is derived from the CURRENT draft: whenever the draft changes, an already
    // published export is recomputed so it can never show a stale previous state.
    var draftObject = state && isRecord(state.draft) ? state.draft : {};
    var hasDraft = Object.keys(draftObject).length > 0;
    var draftSignature = JSON.stringify(draftObject);
    var revision = state && state.revision !== undefined && state.revision !== null ? String(state.revision) : "";
    if (draftSignature !== lastDraftSignature || revision !== lastRevision) {
      lastDraftSignature = draftSignature;
      lastRevision = revision;
      if (hasDraft || (exportText && exportText.value !== "")) refreshExport();
    }
    if (exportButton) exportButton.disabled = Boolean(state && state.phase === "running") || sourceBlocked || busy;
    if (state && state.phase === "running" && applyButton) applyButton.disabled = true;
  }
  function run(action, success, failure) {
    setBusy(true);
    return Promise.resolve()
      .then(action)
      .then(function (result) {
        if (success) announce(success);
        return result;
      }, function (error) {
        announce("Azione non riuscita: " + (error && error.message ? error.message : String(error)) + ". Nessun risultato inventato.");
        if (failure) failure(error);
        return null;
      })
      .then(function (result) {
        setBusy(false);
        render(stateNow());
        return result;
      });
  }
  function stateNow() {
    try { return controller.state(); } catch (error) { return null; }
  }
  function markPending() {
    var message = "Verifica in corso…";
    if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", message)); }
    if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", message)); }
  }
  function setBusy(value) {
    busy = Boolean(value);
    setAttribute(host, "aria-busy", busy ? "true" : "false");
    // "Prova proposta" is never re-enabled blindly: it stays gated on a verified suggestion. The
    // source swatches and the use chips are deliberately NOT disabled here: disabling the control the
    // user just activated would blur it. Re-entrancy is guarded by the `busy` flag in their handlers.
    var buttons = [submit, controlsSubmit, resetPair, resetAll, suggestForeground, suggestBackground, exportButton, copyPalette];
    for (var index = 0; index < buttons.length; index += 1) {
      if (buttons[index]) buttons[index].disabled = busy;
    }
    if (discardButton) discardButton.disabled = busy || !suggestionPresent || typeof controller.discardSuggestion !== "function";
    if (applyButton) applyButton.disabled = busy || !suggestionVerified;
  }
  // Focus continuity for actions whose own control is disabled or hidden by the successful publish
  // that follows. These helpers are called ONLY from explicit click handlers, never from render or
  // subscribe, so a programmatic state update never moves focus. A user who has already moved focus
  // to another control keeps it: only a lost/body/own-button focus is recovered.
  function canTakeFocus(node) {
    if (!node || node.disabled || node.hidden || typeof node.focus !== "function") return false;
    if (typeof node.getClientRects === "function" && node.getClientRects().length === 0) return false;
    if (typeof node.closest === "function" && node.closest("details:not([open])")) return false;
    return true;
  }
  function focusAfterAction(kind) {
    var active = doc.activeElement;
    var body = doc.body || null;
    var root = doc.documentElement || null;
    var focusLost = !active || active === body || active === root || active === host || active === applyButton || active === discardButton;
    if (!focusLost) return false;
    // Apply hands focus to the shell-owned export command (the action that makes the change
    // durable), falling back to the visible contextual correction if the header is unavailable.
    var order = kind === "discard"
      ? [suggestForeground, suggestBackground, exportButton, submit]
      : [exportButton, suggestForeground, suggestBackground, submit];
    for (var index = 0; index < order.length; index += 1) {
      if (!canTakeFocus(order[index])) continue;
      try { order[index].focus(); return true; } catch (error) { /* try the next stable control */ }
    }
    return false;
  }
  function applySelection() {
    var option = selectedOption();
    var source = sourceSelect ? sourceSelect.value : null;
    if (!option) { announce("Nessuna coppia selezionata: nessuna misura viene inventata."); setSourceBlocked("Nessuna coppia selezionata.", source); return Promise.resolve(null); }
    var theme = checkedTheme();
    var comparison = checkedComparison();
    if ((comparison === "tuning" || comparison === "draft") && !tuningAvailable()) {
      announce("Confronto non disponibile: il tuning è assente o non supportato nello snapshot.");
      setSourceBlocked("Confronto personalizzato non disponibile: il tuning è assente o non supportato.", source);
      return Promise.resolve(null);
    }
    if (!optionAvailable(option, theme)) {
      announce("Questa coppia non è disponibile nel tema " + themeName(theme) + "; nessuna misura viene inventata.");
      setSourceBlocked("Nessuna coppia disponibile in questo tema. Cambia tema per confrontarla.", source);
      return Promise.resolve(null);
    }
    var pairId = pairIdFor(option, theme);
    if (!pairId) {
      announce("La coppia non è disponibile nei descrittori del runtime; nessuna misura viene inventata.");
      setSourceBlocked("La coppia non è disponibile nel runtime: nessun campione viene mostrato.", source);
      return Promise.resolve(null);
    }
    // A selection that will run clears any blocked state: the pending result replaces the old one.
    clearSourceBlocked();
    // Invalidate the previous ratio before the request: details for a pending pair must never sit
    // beside a stale measurement from the previous pair. If the request fails, the result is blocked
    // instead of showing a different pair under the requested source.
    markPending();
    return run(
      function () { return controller.select({ pairId: pairId, theme: theme, comparison: comparison }); },
      "Confronto richiesto: attendo le misure del runtime.",
      function () { setSourceBlocked("Selezione non applicata: la misura precedente è stata rimossa. Riprova.", source); }
    );
  }
  function filterPairs(state) {
    if (!sourceSelect || !pairSelect) return;
    var chosen = sourceSelect.value;
    var list = options();
    var firstVisible = null;
    for (var index = 0; index < list.length; index += 1) {
      var sources = (attribute(list[index], "data-sources") || "").split(/\s+/).filter(Boolean);
      var visible = !chosen || !sources.length || sources.indexOf(chosen) !== -1;
      list[index].hidden = !visible;
      if (visible && !firstVisible) firstVisible = list[index];
    }
    var current = selectedOption();
    if (current && current.hidden) {
      for (var index2 = 0; index2 < list.length; index2 += 1) list[index2].selected = list[index2] === firstVisible;
    }
    if (selectionAvailable) {
      renderDetails(state);
      renderControls(state || stateNow());
    }
  }
  function readValue(input) {
    var value = input && input.value !== undefined ? String(input.value).trim() : "";
    return value;
  }
  function applyOverrides() {
    // Only fields the user actually changed are submitted: a pre-filled placeholder default (for
    // example a 10% surface mix) is never exported as an unsolicited knob, and an untouched saved
    // draft value is never re-sent.
    var pending = controlInputs.filter(function (entry) { return entry.dirty && readValue(entry.node) !== ""; });
    if (!pending.length) { announce("Nessun valore modificato: nessun override applicato. I default mostrati restano segnaposto."); return Promise.resolve(null); }
    var index = 0;
    function next() {
      if (index >= pending.length) return Promise.resolve(null);
      var entry = pending[index];
      index += 1;
      var raw = readValue(entry.node);
      var value = entry.kind === "mix" ? raw + "%" : raw;
      return Promise.resolve(controller.setOverride(entry.control, value)).then(function () {
        entry.dirty = false;
        return next();
      });
    }
    return run(next, "Override pubblici applicati al runtime. La palette sorgente non è stata modificata. Solo i campi modificati sono stati inviati.");
  }
  function setDownload(css) {
    if (!download) return;
    if (typeof css === "string" && css !== "") {
      download.href = "data:text/css;charset=utf-8," + encodeURIComponent(css);
      download.hidden = false;
    } else {
      download.hidden = true;
    }
  }
  // Recompute from the controller every time: the export is always the current draft, never the
  // previously published text.
  function refreshExport() {
    var css = controller.exportTuning();
    if (typeof css !== "string") css = "";
    if (exportText) exportText.value = css;
    if (exportNote) exportNote.textContent = css === ""
      ? "Nessun tuning pubblico da esportare: nessun override attivo."
      : "CSS della bozza corrente. Copia o scarica il file per conservarlo: l'anteprima non modifica il progetto.";
    setDownload(css);
    return css;
  }
  function exportTuning() {
    // The header owns the only export command; opening it reveals the real generated CSS and the
    // manual download in the secondary disclosure. No second export button exists in the workbench.
    if (exportBox) exportBox.open = true;
    var css = refreshExport();
    if (exportText && typeof exportText.focus === "function") exportText.focus();
    if (css === "") { announce("Nessun tuning pubblico da esportare: nessun override attivo."); return; }
    announce("CSS pubblico esportato nel campo selezionabile. Il download resta un'azione manuale.");
  }
  function copyTextarea(node, label) {
    if (!node) return;
    var value = String(node.value || "");
    if (value === "") { announce("Nessun testo da copiare: il campo è vuoto."); return; }
    node.focus();
    if (typeof node.select === "function") node.select();
    if (typeof node.setSelectionRange === "function") node.setSelectionRange(0, value.length);
    var clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (clipboard && typeof clipboard.writeText === "function") {
      clipboard.writeText(value).then(function () {
        announce(label + " copiato negli appunti.");
      }, function () {
        announce(label + " selezionato: usa Cmd/Ctrl+C. Nessun permesso clipboard richiesto.");
      });
    } else {
      announce(label + " selezionato: usa Cmd/Ctrl+C. Nessun permesso clipboard richiesto.");
    }
  }
  function listen(node, event, handler) {
    if (node && typeof node.addEventListener === "function") node.addEventListener(event, handler);
  }
  function prevent(event) { if (event && typeof event.preventDefault === "function") event.preventDefault(); }

  // Establish the primary light/dark comparison before mounting, so the first measurement run already
  // uses it (the runtime defaults are never modified; only the selection is set from the view).
  initializeSelection();
  if (left && right) {
    try {
      var slots = { left: left, right: right };
      // B's runtime mounts the two real CSS consumer frames for a verified proposal. The slots are
      // passed only when the static markup provides them; the factory never paints a swatch there.
      if (proposalBefore) slots.proposalBefore = proposalBefore;
      if (proposalAfter) slots.proposalAfter = proposalAfter;
      controller.mount(slots);
      mounted = true;
    } catch (error) {
      announce("Il runtime non ha accettato i contenitori delle viste: " + (error && error.message ? error.message : String(error)));
    }
  }
  unsubscribe = controller.subscribe(function (next) {
    try { render(next); } catch (error) { /* presentation must never break the run */ }
  });
  // A source or pair choice takes effect immediately: the runtime invalidates the old ratio while it
  // measures, so the panel never shows pending details beside a stale measurement.
  listen(sourceSelect, "change", function () {
    if (sourceSelect.value === "") { clearSourceBlocked(); filterPairs(); syncPalette(); return; }
    applySourceSelection(sourceSelect.value);
  });
  listen(openPicker, "click", openPickerDialog);
  listen(closePicker, "click", closePickerDialog);
  listen(pickerDialog, "close", function () {
    if (openPicker && !openPicker.disabled && typeof openPicker.focus === "function") openPicker.focus();
  });
  listen(useSearch, "input", function () {
    pickerQuery = useSearch.value || "";
    pickerPage = 0;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(useCategory, "change", function () {
    pickerCategory = useCategory.value || "";
    pickerPage = 0;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(useClear, "click", function () {
    pickerQuery = "";
    if (useSearch) useSearch.value = "";
    pickerPage = 0;
    renderUses(sourceSelect ? sourceSelect.value : "");
    if (useSearch && typeof useSearch.focus === "function") useSearch.focus();
  });
  listen(usePrev, "click", function () {
    if (attribute(usePrev, "aria-disabled") === "true") return;
    pickerPage -= 1;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(useNext, "click", function () {
    if (attribute(useNext, "aria-disabled") === "true") return;
    pickerPage += 1;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(pairSelect, "change", function () { renderDetails(); renderControls(stateNow()); applySelection(); });
  // A theme change is an immediate selection and a recovery path: a blocked source is re-attempted.
  // The visible identity, criterion and action theme follow the checked radio immediately.
  listen(themeLight, "change", function () { renderCurrent(); renderDetails(); renderControls(stateNow()); resumeSelection(); });
  listen(themeDark, "change", function () { renderCurrent(); renderDetails(); renderControls(stateNow()); resumeSelection(); });
  listen(comparisonThemes, "change", resumeSelection);
  listen(comparisonTuning, "change", resumeSelection);
  listen(comparisonDraft, "change", resumeSelection);
  listen(selectionForm, "submit", function (event) { prevent(event); resumeSelection(); });
  listen(controlsForm, "submit", function (event) { prevent(event); applyOverrides(); });
  listen(resetPair, "click", function () {
    var controls = controlInputs.map(function (entry) { return entry.control; });
    var index = 0;
    function next() {
      if (index >= controls.length) return Promise.resolve(null);
      var control = controls[index];
      index += 1;
      return Promise.resolve(controller.reset(control)).then(next);
    }
    run(next, "Controlli pubblici della coppia azzerati.");
  });
  listen(resetAll, "click", function () { run(function () { return controller.reset(); }, "Tutto il tuning pubblico è stato azzerato."); });
  listen(suggestForeground, "click", function () { run(function () { return controller.suggest("foreground"); }, "Ricerca della proposta per il primo piano richiesta."); });
  listen(suggestBackground, "click", function () { run(function () { return controller.suggest("background"); }, "Ricerca della proposta per lo sfondo richiesta."); });
  listen(applyButton, "click", function () {
    var failed = false;
    var pending = run(
      function () { return controller.applySuggestion(); },
      "Proposta applicata come override temporaneo. Esporta il CSS pubblico per conservarla.",
      function () { failed = true; }
    );
    if (pending && typeof pending.then === "function") {
      pending.then(function () {
        // run() calls the failure callback only when the action rejects: only a successful apply hands focus on.
        if (!failed) focusAfterAction("apply");
      }, function () { /* the failure path already announced its own error */ });
    }
  });
  // Discarding a proposal is not a reset: the synchronous runtime method clears/invalidates
  // the suggestion while leaving every saved public override exactly as it is.
  listen(discardButton, "click", function () {
    if (!suggestionPresent) { announce("Nessuna proposta da scartare."); return; }
    if (typeof controller.discardSuggestion !== "function") { announce("Il runtime non espone lo scarto della proposta. Nessun override viene modificato."); return; }
    try {
      var discarded = controller.discardSuggestion();
      var finish = function () {
        render(stateNow());
        announce("Proposta scartata: nessun override pubblico è stato modificato.");
        focusAfterAction("discard");
      };
      var failed = function (error) {
        announce("Scarto non riuscito: " + (error && error.message ? error.message : String(error)) + ". Nessun override viene modificato.");
      };
      if (discarded && typeof discarded.then === "function") discarded.then(finish, failed);
      else finish();
    } catch (error) {
      announce("Scarto non riuscito: " + (error && error.message ? error.message : String(error)) + ". Nessun override viene modificato.");
    }
  });
  listen(exportButton, "click", exportTuning);
  listen(copyPalette, "click", function () { copyTextarea(paletteSource, "Sorgente palette"); });
  var copyExport = byId("smart-colors-workbench-copy-export");
  // The copy action recomputes the current draft; it never copies a stale export or announces a copy
  // of an empty string.
  listen(copyExport, "click", function () {
    var css = controller.exportTuning();
    if (typeof css !== "string" || css === "") { announce("Nessun CSS pubblico da copiare: nessun override attivo."); return; }
    if (exportText) exportText.value = css;
    setDownload(css);
    copyTextarea(exportText, "CSS pubblico");
  });

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", function () { if (unsubscribe) unsubscribe(); });
  }
  // The source swatches are inert until the factory wires them: only then are they enabled.
  if (openPicker) openPicker.disabled = false;
  if (useSearch) useSearch.disabled = false;
  if (useCategory) useCategory.disabled = false;
  if (useClear) useClear.disabled = false;
  if (closePicker) closePicker.disabled = false;
  for (var swatchBind = 0; swatchBind < swatchButtons.length; swatchBind += 1) bindSwatch(swatchButtons[swatchBind]);
  render(stateNow());
  return {
    render: render,
    destroy: function () {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      setProposalFrames(false);
      controller.destroy();
      mounted = false;
    },
  };
}

/**
 * Classic-script fragment installing the serialized view factory. It carries no
 * import and no external reference, so the preview can hash exactly these bytes.
 * `globalName` is the controller global the delivered workbench runtime installs;
 * the caller resolves it from that module so the two never drift.
 */
export function createContrastWorkbenchViewSource(globalName) {
  const name = text(globalName);
  if (!name) throw new TypeError("createContrastWorkbenchViewSource requires the workbench controller global name");
  return [
    "(function () {",
    '  "use strict";',
    // This self-contained factory uses quoted strings, not multiline template literals. Removing
    // line indentation saves artifact space without stripping comments, newlines or executable code.
    "  var createContrastWorkbenchView = " + createContrastWorkbenchView.toString().replace(/^[\t ]+/gm, "") + ";",
    "  createContrastWorkbenchView({ controller: globalThis[" + JSON.stringify(name) + "], document: document });",
    "})();",
    "",
  ].join("\n");
}
