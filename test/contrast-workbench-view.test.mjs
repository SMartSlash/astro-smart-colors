import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WORKBENCH_RUNTIME_GLOBAL } from "../src/contrast-workbench-runtime.mjs";
import { createDiagnosticSession } from "../src/diagnostic-session.mjs";
import { formatContrastPreviewHtml } from "../src/format-report-preview.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import {
  CONTRAST_WORKBENCH_CSS,
  createContrastWorkbenchView,
  createContrastWorkbenchViewSource,
  renderContrastWorkbench,
} from "../src/contrast-workbench-view.mjs";

// Opt-in native proof, same convention as the other browser proofs: an already-installed Chromium
// must be resolvable from the workspace root. Nothing is downloaded and no network is used.
const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";
const OPT_IN = "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the narrow-viewport Chromium smoke";
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, "../../..");

// --- Fixtures -----------------------------------------------------------------

function workbenchSession(overrides = {}) {
  const design = {
    version: 1,
    sources: [
      { token: "--palette-brand", name: "brand", role: "ui", darkBlend: 80, darkMix: { mode: "explicit", sourcePercent: 77.6, whitePercent: 22.4 } },
      { token: "--palette-canvas", name: "canvas", role: "canvas", darkBlend: null, darkMix: { mode: "automatic", sourcePercent: 60, whitePercent: 40 } },
    ],
    recipes: {
      text: { kind: "contrast", basis: "contrast", usage: "family text" },
      surface: { kind: "mix", basis: "design", usage: "tinted surface" },
      scale: { kind: "literal", basis: "design", usage: "numeric step" },
    },
    tokens: {
      "--color-primary-text": { sources: ["--palette-brand"], recipe: "text", usage: "Testo della famiglia primaria", controls: { light: { override: "--color-tune-primary-text-light" }, dark: { mix: "--color-tune-primary-text-dark-mix", defaultMix: 0.78 } } },
      "--color-primary-surface": { sources: ["--palette-brand"], recipe: "surface", usage: "Superficie tinta primaria", controls: { light: { override: "--color-tune-primary-surface-light" } } },
      "--color-text": { sources: ["--palette-canvas"], recipe: "text", usage: "Testo sul canvas", controls: {} },
      "--color-bg": { sources: ["--palette-canvas"], recipe: "surface", usage: "Sfondo della pagina", controls: {} },
      "--color-orphan": { sources: ["--palette-brand"], recipe: "scale", usage: "Passo di scala senza coppia", controls: {} },
    },
  };
  return {
    schemaVersion: 1,
    snapshotId: "snap-workbench",
    toolVersion: "0.4.0",
    paletteSource: {
      css: ":root {}\n@property --palette-brand { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; dark-blend: 80; }\n",
      path: "src/styles/tokens/palette.css",
      sha256: "a".repeat(64),
      sources: [
        { token: "--palette-brand", value: "oklch(0.56 0.14 255)", role: "ui", darkBlend: 80, declaration: "@property --palette-brand { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; dark-blend: 80; }" },
        { token: "--palette-canvas", value: "oklch(0.97 0.005 250)", role: "canvas", darkBlend: null, declaration: "@property --palette-canvas { syntax: \"<color>\"; inherits: true; initial-value: oklch(0.97 0.005 250); role: canvas; }" },
      ],
    },
    design,
    config: { contrast: { text: 4.6, onColor: 4.6, ui: 3 }, roles: { identities: { primary: { token: "--palette-brand", role: "ui" } } } },
    files: { palette: "src/styles/tokens/palette.css" },
    inputs: [{ name: "palette", path: "src/styles/tokens/palette.css", present: true, sha256: "a".repeat(64) }],
    css: { baseline: ":root { --color-bg: oklch(1 0 0); }", tuning: ":root { --color-tune-primary-text-light: oklch(0.4 0.1 250); }", tuningSupport: "supported", source: "output", status: "current", baselineSupport: "supported" },
    model: {
      diagnostics: [
        { label: "primary-text / family surface", scheme: "light", foregroundToken: "--color-primary-text", backgroundToken: "--color-primary-surface", ratio: 3.1, minimum: 4.5, target: 4.6, kind: "text", status: "below-minimum", provenance: "generated" },
        { label: "primary-text / family surface", scheme: "dark", foregroundToken: "--color-primary-text", backgroundToken: "--color-primary-surface", ratio: 5.2, minimum: 4.5, target: 4.6, kind: "text", status: "pass", provenance: "generated" },
        { label: "text / canvas", scheme: "light", foregroundToken: "--color-text", backgroundToken: "--color-bg", ratio: 6.4, minimum: 4.5, target: 4.6, kind: "text", status: "pass", provenance: "generated" },
      ],
      errors: [],
      warnings: [],
    },
    samples: [],
    scenarios: [],
    automation: { provenance: "model", mode: "off", status: "disabled", expected: { scenarios: [], pairs: [] }, executed: { scenarios: [], pairs: [] }, measurements: [], errors: [], environment: null, measuredAt: null },
    ...overrides,
  };
}

// --- Static rendering --------------------------------------------------------

test("renderContrastWorkbench leads with the guided workbench and keeps the raw source metadata after it, inside a closed native detail", () => {
  const html = renderContrastWorkbench(workbenchSession());
  // Redesigned order: the interactive workbench is the main content, the verbose source archive follows it.
  assert.ok(html.indexOf('id="banco"') < html.indexOf('id="palette"'), "the guided workbench is the first content, before the raw source archive");
  assert.match(html, /<details class="is-detail wb-palette-details"><summary>Dettagli tecnici della palette sorgente<\/summary>/, "the raw source metadata stays in a closed native detail");
  // Raw authored value and declared role, explicitly labelled as the raw value (not the live rendering).
  assert.match(html, /<code>--palette-brand<\/code> · ruolo dichiarato: interfaccia/);
  assert.match(html, /Valore sorgente dichiarato: <code>oklch\(0\.56 0\.14 255\)<\/code>/);
  assert.match(html, /valore grezzo, non la resa live/);
  // Real @property declaration, exact bytes.
  assert.match(html, /@property --palette-brand \{ syntax: &quot;&lt;color&gt;&quot;; inherits: true;/);
  // Explicit vs automatic dark blend, from the shared factory values.
  assert.match(html, /dark-blend 80 → source 77\.6% \/ white 22\.4% · esplicito/);
  assert.match(html, /<code>--palette-canvas<\/code> · ruolo dichiarato: sfondo della pagina/);
  assert.match(html, /dark-blend adattivo → source 60% \/ white 40%/);
  // Full captured CSS copy + a data-URI download (manual action, validated offline).
  assert.match(html, /Copia completa del CSS sorgente/);
  assert.match(html, /<textarea id="smart-colors-workbench-palette-source" data-smart-colors-workbench="palette-source" readonly rows="10">/);
  assert.match(html, /<a class="wb-download" download="palette\.css" href="data:text\/css;charset=utf-8,/);
  assert.match(html, /Il download è manuale: aprire l'anteprima non scrive file\./);
  // No scripts, no inline handlers. The only external URLs are official W3C criterion links in the
  // closed thresholds reference; they are links, not loaded resources.
  assert.doesNotMatch(html, /<script|\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\/(?!www\.w3\.org\/)/i);
  assert.match(html, /href="https:\/\/www\.w3\.org\/TR\/WCAG22\/#contrast-minimum"/);
});

test("the captured palette keeps the DECLARED role and shows a differing effective role separately", () => {
  const session = workbenchSession({
    roles: { identities: [{ name: "brand", role: "feedback", token: "--palette-brand", paletteName: "--palette-brand" }] },
    paletteSource: {
      ...workbenchSession().paletteSource,
      sources: [
        { token: "--palette-brand", value: "oklch(0.56 0.14 255)", role: "ui", darkBlend: 80, declaration: "@property --palette-brand { initial-value: oklch(0.56 0.14 255); role: ui; dark-blend: 80; }" },
        { token: "--palette-canvas", value: "oklch(0.97 0.005 250)", role: "canvas", darkBlend: null, declaration: null },
      ],
    },
  });
  const html = renderContrastWorkbench(session);
  // The declared `@property` role stays authoritative; the config role is never substituted for it.
  assert.match(html, /<code>--palette-brand<\/code> · ruolo dichiarato: interfaccia · ruolo effettivo \(config\): feedback/);
  // A source whose declared and effective roles agree shows the declared one exactly once.
  assert.match(html, /<code>--palette-canvas<\/code> · ruolo dichiarato: sfondo della pagina(?! · ruolo effettivo)/);
  // Exact raw bytes are served, escaped, and the source value stays labelled as raw.
  assert.match(html, /Valore sorgente dichiarato: <code>oklch\(0\.56 0\.14 255\)<\/code>/);
});

test("a source with no declared role shows the effective config role as explicitly mapped", () => {
  const session = workbenchSession({
    roles: { identities: [{ name: "brand", role: "feedback", token: "--palette-brand", paletteName: "--palette-brand" }] },
    paletteSource: {
      ...workbenchSession().paletteSource,
      sources: [{ token: "--palette-brand", value: "oklch(0.56 0.14 255)", role: null, darkBlend: null, declaration: null }],
    },
  });
  const html = renderContrastWorkbench(session);
  assert.match(html, /ruolo dichiarato: non indicato · ruolo effettivo \(config\): feedback/);
});

test("renderContrastWorkbench lists only real pairs, filters by design sources and keeps the catalogue complete", () => {
  const html = renderContrastWorkbench(workbenchSession());
  // Real pairs from the model diagnostics only.
  assert.match(html, /data-fg="--color-primary-text" data-bg="--color-primary-surface"/);
  assert.match(html, /data-fg="--color-text" data-bg="--color-bg"/);
  // The `--color-orphan` token has no diagnostic: it is listed, never given a made-up pair.
  assert.match(html, /<code>--color-orphan<\/code> · scale · nessun abbinamento verificato/);
  // Source filter metadata carries the declared design sources, including canvas dependency.
  assert.match(html, /<code>--palette-brand<\/code> · ruolo dichiarato: interfaccia/);
  assert.match(html, /data-sources="--palette-brand"/);
  assert.match(html, /data-sources="--palette-canvas"/);
  assert.match(html, /Catalogo completo: 5 token, nessun limite nascosto/);
  // A pair with a non-text diagnostic is described as an indicator, not as text.
  const indicator = renderContrastWorkbench(workbenchSession({
    model: { diagnostics: [{ label: "border", scheme: "light", foregroundToken: "--color-primary-border-strong", backgroundToken: "--color-primary-surface", ratio: 2.8, minimum: 3, target: 3, kind: "non-text", status: "below-minimum", provenance: "generated" }], errors: [], warnings: [] },
  }));
  assert.match(indicator, /data-kind="non-text"/);
  assert.match(indicator, /data-fg="--color-primary-border-strong"/);
});

test("a stale snapshot labels the recipe as the initial generator rationale, never the active formula", () => {
  const stale = renderContrastWorkbench(workbenchSession({
    css: { baseline: ":root{}", tuning: null, tuningSupport: "absent", source: "output", status: "stale", baselineSupport: "supported" },
  }));
  assert.match(stale, /Ricetta iniziale del generatore/);
  assert.match(stale, /non la formula attiva dei byte correnti/);
  assert.match(stale, /output non aggiornato \(stale\)/);
  const candidate = renderContrastWorkbench(workbenchSession({
    css: { baseline: ":root{}", tuning: null, tuningSupport: "absent", source: "generated-candidate", status: "absent", baselineSupport: "supported" },
  }));
  assert.match(candidate, /candidato generato \(diagnostico\), non output/);
  assert.match(candidate, /le misure riguardano un candidato generato, non un file di output/);
});

test("the selected pair explains usage, exact var() snippet and keeps minimum and target separate", () => {
  const html = renderContrastWorkbench(workbenchSession());
  assert.match(html, /Testo della famiglia primaria/);
  assert.match(html, /Superficie tinta primaria/);
  assert.match(html, /<pre role="group" tabindex="0" aria-label="Snippet CSS della coppia, con le stesse variabili della resa"><code>color: var\(--color-primary-text\);/);
  assert.match(html, /background-color: var\(--color-primary-surface\);/);
  assert.match(html, /Minimo 4,5:1 · target 4,6:1/);
  assert.match(html, /la preferenza di sistema \(<code>prefers-color-scheme<\/code>\) resta separata e non viene emulata/);
});

test("the static pair details keep sources, declared roles, the initial recipe and public controls", () => {
  const html = renderContrastWorkbench(workbenchSession());
  assert.match(html, /Sorgenti: <code>--palette-brand \(nome brand · ruolo dichiarato: interfaccia\)<\/code>/);
  assert.match(html, /Ricetta iniziale del generatore: text \(contrast\)/);
  assert.match(html, /Ricetta iniziale del generatore: surface \(mix\)/);
  assert.match(html, /Controlli pubblici \(tema chiaro\): <code>--color-tune-primary-text-light<\/code> override completo/);
  assert.match(html, /<code>--color-tune-primary-surface-light<\/code> override completo/);
});

test("override controls are whitelisted from the design metadata and never edit a source role", () => {
  const html = renderContrastWorkbench(workbenchSession());
  assert.match(html, /data-control="--color-tune-primary-text-light" data-kind="override"/);
  assert.match(html, /data-control="--color-tune-primary-surface-light" data-kind="override"/);
  assert.match(html, /Scarta la bozza della coppia/);
  assert.match(html, /Scarta la bozza di tuning/);
  assert.match(html, /Un override completo ha precedenza sul mix della superficie/);
  // A mix control is only rendered for the theme that declares it (dark).
  assert.doesNotMatch(html, /data-control="--color-tune-primary-text-dark-mix" data-kind="mix"\>/);
  // Source roles and dark blend stay read-only: no input ever carries a source token.
  assert.doesNotMatch(html, /data-control="--palette-brand"/);
});

test("the suggestion copy states a bounded min-lightness search for the minimum, not a global deltaE closest match", () => {
  const html = renderContrastWorkbench(workbenchSession());
  assert.match(html, /La ricerca varia la luminosità quanto basta per raggiungere il minimo dichiarato/);
  assert.match(html, /non il target del progetto/);
  assert.match(html, /non cerca il colore più vicino in ΔE/);
  assert.doesNotMatch(html, /con chroma e hue invariati/);
  assert.match(html, /Cerca una correzione/);
  assert.doesNotMatch(html, /Correggi il minimo/);
  assert.match(html, /Correggi testo/);
  assert.match(html, /Correggi sfondo/);
  assert.match(html, /<button type="button" id="smart-colors-workbench-apply" data-smart-colors-workbench="apply" hidden disabled>Prova proposta<\/button>/);
  assert.doesNotMatch(html, /id="smart-colors-workbench-export"/, "the shell owns the single export command");
  assert.match(html, /Seleziona il CSS esportato/);
  assert.match(html, /<a id="smart-colors-workbench-download" data-smart-colors-workbench="download" hidden>Scarica colors-tuning\.css \(azione manuale\)<\/a>/);
  assert.doesNotMatch(html, /id="smart-colors-workbench-download"[^>]*\bdownload=/, "the static placeholder never carries download without a real href");
  assert.doesNotMatch(html, /id="smart-colors-workbench-download"[^>]*\bhref=/, "the static placeholder never carries a fake or empty href");
  assert.match(html, /id="smart-colors-workbench-discard-suggestion" data-smart-colors-workbench="discard-suggestion" hidden disabled>Scarta proposta<\/button>/);
  // The redundant restore/reset-all duplicate is gone: reset-all lives once, in the controls scope.
  assert.doesNotMatch(html, /Ripristina<\/button>/);
  assert.equal((html.match(/Scarta la bozza di tuning<\/button>/g) ?? []).length, 1);
  assert.match(html, /L e mix agiscono sulla bozza temporanea della coppia e del tema attivo/);
});

test("captured palette bytes cannot break the textarea, the download or the inert payload", () => {
  const raw = ":root { --x: '</textarea></script><img src=x>'; }";
  const session = workbenchSession({
    paletteSource: { css: raw, path: "palette.css", sha256: "c".repeat(64), sources: [{ token: "--palette-x", value: "oklch(0.5 0.1 250)", role: "ui", darkBlend: null, declaration: null }] },
  });
  const html = renderContrastWorkbench(session);
  assert.ok(!html.includes("</script><img"), "no raw closing-tag sequence may survive");
  assert.match(html, /&lt;\/textarea&gt;&lt;\/script&gt;&lt;img src=x&gt;/);
  // The exact bytes remain recoverable: the download is URL-encoded and the textarea holds escaped text.
  assert.match(html, /href="data:text\/css;charset=utf-8,%3Aroot/);
});

test("hostile source and design labels are escaped and cannot close a tag or inject markup", () => {
  const attack = "</script><img src=x onerror=alert(1)>";
  const session = workbenchSession({
    paletteSource: {
      css: `:root { --x: '${attack}'; }`,
      path: attack,
      sha256: "b".repeat(64),
      sources: [{ token: `--palette-${attack}`, value: attack, role: attack, darkBlend: null, declaration: `@property ${attack}` }],
    },
  });
  session.design.tokens["--color-primary-text"].usage = attack;
  session.design.sources[0].name = attack;
  const html = renderContrastWorkbench(session);
  assert.doesNotMatch(html, /<img/i);
  assert.ok(!html.includes(attack), "the raw hostile string must never reach the markup");
  assert.match(html, /&lt;\/script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("the workbench frames stay empty for the runtime and the specimen precedes its scoped result", () => {
  const html = renderContrastWorkbench(workbenchSession());
  assert.match(html, /<div id="smart-colors-workbench-result" data-smart-colors-workbench="result" class="wb-frames" role="group" aria-label="Campioni CSS del consumatore">/);
  assert.doesNotMatch(html, /<div id="smart-colors-workbench" data-smart-colors-workbench="host"[^>]*role="region"/, "the outer workbench section owns the landmark, not the inner host");
  assert.match(html, /<div class="wb-view-head"><span data-smart-colors-workbench="left-sample" class="wb-aa is-unmeasured" aria-hidden="true">Aa<\/span><h3 id="smart-colors-workbench-left-title" class="wb-view-title">Tema chiaro<\/h3><\/div>/);
  assert.match(html, /id="smart-colors-workbench-left-meta" data-smart-colors-workbench="left-meta" class="wb-view-meta wb-visually-hidden"><\/span>/);
  assert.match(html, /class="wb-measure-row wb-measure-ratio"/);
  assert.doesNotMatch(html, /wb-view-chrome/, "the repeated metadata row is gone");
  assert.match(html, /<div id="smart-colors-workbench-left" data-smart-colors-workbench="left" class="wb-frame" role="group" aria-label="Vista CSS sinistra"><\/div>/);
  assert.match(html, /<div id="smart-colors-workbench-right" data-smart-colors-workbench="right" class="wb-frame" role="group" aria-label="Vista CSS destra"><\/div>/);
  // Proposal frames are real consumer slots too: empty in the markup, populated only by the runtime.
  assert.match(html, /<section id="smart-colors-workbench-proposal-frames"[^>]*hidden[^>]*aria-labelledby="smart-colors-workbench-proposal-frames-title">/);
  assert.match(html, /<div id="smart-colors-workbench-proposal-before"[^>]*><\/div>/);
  assert.match(html, /<div id="smart-colors-workbench-proposal-after"[^>]*><\/div>/);
  assert.match(html, /<div id="smart-colors-workbench-proposal-before"[^>]*role="region"[^>]*tabindex="0"[^>]*><\/div>/);
  assert.match(html, /<div id="smart-colors-workbench-proposal-after"[^>]*role="region"[^>]*tabindex="0"[^>]*><\/div>/);
  assert.match(html, /Vista CSS attuale della proposta: viewport di verifica fisso 360×480; scorri orizzontalmente/);
  assert.match(html, /Vista CSS proposta: viewport di verifica fisso 360×480; scorri orizzontalmente/);
  assert.match(html, /<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-frames-title smart-colors-workbench-proposal-before-title"><h4 id="smart-colors-workbench-proposal-before-title">Attuale<\/h4>/);
  assert.match(html, /<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-frames-title smart-colors-workbench-proposal-after-title"><h4 id="smart-colors-workbench-proposal-after-title">Proposta<\/h4>/);
  // The archive uses resolved `--sample-*` swatches; the guided workbench must not.
  assert.doesNotMatch(html, /--sample-fg|--sample-bg/);
  assert.match(html, /color: var\(--color-primary-text\)/);
  assert.match(html, /background-color: var\(--color-primary-surface\)/);
  // The visible specimen comes BEFORE its scoped ratio; the result is read after the sample.
  const leftMeasure = html.indexOf('id="smart-colors-workbench-left-measure"');
  const leftFrame = html.indexOf('id="smart-colors-workbench-left"');
  const rightMeasure = html.indexOf('id="smart-colors-workbench-right-measure"');
  const rightFrame = html.indexOf('id="smart-colors-workbench-right"');
  assert.ok(leftFrame >= 0 && leftFrame < leftMeasure, "the left specimen precedes its measure");
  assert.ok(rightFrame >= 0 && rightFrame < rightMeasure, "the right specimen precedes its measure");
  // The selection toolbar owns the controls and precedes the full-width comparison area.
  const toolbar = html.indexOf('class="wb-toolbar"');
  const main = html.indexOf('class="wb-main"');
  assert.ok(toolbar >= 0 && toolbar < main, "the horizontal toolbar precedes the comparison area in DOM order");
  assert.doesNotMatch(html, /wb-rail|wb-layout/, "the old source sidebar is gone");
});

test("the extracted workbench stylesheet wraps the palette, scopes focus and keeps container-driven layout", () => {
  const source = readFileSync(new URL("../src/report-styles/workbench.css", import.meta.url), "utf8");
  assert.equal(CONTRAST_WORKBENCH_CSS, source, "the exported constant is the shipped stylesheet, loaded once");
  // Source chips wrap in a real grid instead of a horizontal carousel.
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(8\.5rem, 1fr\)\);[^}]*\}/);
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{[^}]*overflow-x: auto;/, "no hidden horizontal carousel survives");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-swatch \{[^}]*min-height: 44px;[^}]*\}/, "every source target keeps a 44px target");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{ display: grid; \}/, "the wrapping grid is the desktop source control");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-source-select \{ display: none; \}/, "the native select is fully removed on desktop");
  assert.match(CONTRAST_WORKBENCH_CSS, /@container preview-section \(min-width: 45rem\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /@container wb-main \(min-width: 36rem\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /@container wb-main \(min-width: 48rem\) \{\s*\.wb-proposal-frames \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}\s*\}/, "the fixed proposal frames sit side by side from 48rem");
  assert.match(CONTRAST_WORKBENCH_CSS, /@container wb-catalogue \(max-width: 32rem\)/, "the matrix adapts to its own column, not only the viewport");
  assert.match(CONTRAST_WORKBENCH_CSS, /@container wb-shell \(min-width: 64rem\) \{\s*\.wb-workspace \{ grid-template-columns: minmax\(0, 2fr\) minmax\(0, 3fr\); \}/, "desktop catalogue and inspector stay roughly 40/60");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-picker-dialog \{[^}]*width: min\(40rem, calc\(100vw - 2rem\)\);[^}]*max-block-size: 90dvh;/, "the picker is a compact native dialog");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-picker-results \{[^}]*overflow: auto;/, "only the results area scrolls inside the picker");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-scope-toggle \{[^}]*min-height: 2\.75rem;/, "the all-pairs control has a full target");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-field select \{ block-size: 2\.75rem; \}/, "WebKit native selects keep the 44px target via block-size");
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /appearance:\s*none/, "the native select appearance is never replaced");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-overview-summary \{[^}]*display: flex;/, "the active scope is visible even when the matrix is closed");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-measure-more > summary/, "long measurement documentation is a native detail");
  assert.match(CONTRAST_WORKBENCH_CSS, /color-mix\(in oklab, var\(--accent\) 6%, var\(--paper\)\)/, "selection uses a restrained accent tint");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-frames:not\(\.wb-proposal-frames\) \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/, "the two specimens share the full width when the workbench is wide");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-frames:not\(\.wb-proposal-frames\) \.wb-frame iframe \{ block-size: 13rem; \}/, "side-by-side specimens stay compact");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-compare \.wb-fieldset \{ flex: 1 1 auto;/, "the comparison group takes the flexible space");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-compare \.wb-theme-fieldset \{ flex: 0 0 auto; \}/, "the theme group stays compact and overrides the shared fieldset");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-measure-ratio \{ display: block; \}/, "the ratio uses the full column under the specimen");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-aa \{[^}]*min-inline-size: 2rem;[^}]*\}/, "the Aa sample is a small heading companion");
  assert.match(CONTRAST_WORKBENCH_CSS, /@media \(forced-colors: active\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /@media print/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-proposal-frames\[hidden\] \{ display: none; \}/, "the hidden attribute must beat the grid display");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-action-strip \[hidden\] \{ display: none; \}/, "the discard action is never painted without a suggestion");
  const layoutLayer = CONTRAST_WORKBENCH_CSS.indexOf("@layer layout {");
  const preferencesLayer = CONTRAST_WORKBENCH_CSS.indexOf("@layer preferences {");
  const hiddenRule = CONTRAST_WORKBENCH_CSS.indexOf(".wb-proposal-frames[hidden]");
  assert.ok(layoutLayer >= 0 && hiddenRule > layoutLayer && hiddenRule < preferencesLayer, "the hidden rule sits in the layout layer with the grid it overrides");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-proposal-frames \.wb-frame \{ overflow: auto; overscroll-behavior: contain;[^}]*\}/, "proposal containers scroll locally instead of clipping");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-frame \{ min-height: 7rem;[^}]*overflow: hidden; \}/, "the main views keep clipping");
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /@import|url\(|https?:/i);
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /position:\s*fixed/);
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /border-radius: 999px/);
});

test("the static workspace separates source values from the generated catalogue and shows the pair identity outside the closed details", () => {
  const html = renderContrastWorkbench(workbenchSession());
  // Toolbar copy is short and explicit; the detailed source archive owns role metadata.
  assert.match(html, /Usi generati dalla palette, non rilevati nel sito\./);
  assert.doesNotMatch(html, /Valori dichiarati nel file di palette del progetto; non sono una scansione del sito/);
  assert.match(html, /<label for="smart-colors-workbench-pair">Abbinamento tecnico<\/label>/);

  assert.match(html, /<span class="wb-use-kind">testo<\/span>/);
  // The primary toolbar shows a human current use and one opener; the technical pair select moves
  // into the technical disclosure as a fallback.
  const workspace = html.indexOf('class="wb-workspace"');
  const sourceSelect = html.indexOf('id="smart-colors-workbench-source"');
  const swatches = html.indexOf('class="wb-palette"');
  const currentUse = html.indexOf('id="smart-colors-workbench-current-use"');
  const opener = html.indexOf('id="smart-colors-workbench-open-picker"');
  const comparison = html.indexOf('id="smart-colors-workbench-comparison-themes"');
  const theme = html.indexOf('id="smart-colors-workbench-theme-light"');
  const main = html.indexOf('class="wb-main"');
  assert.ok(workspace >= 0 && sourceSelect > workspace && sourceSelect < swatches && swatches < currentUse && currentUse < opener && opener < comparison && comparison < main, "the toolbar shows current use and the change-use opener before comparison and theme");
  assert.equal((html.match(/id="smart-colors-workbench-source"/g) ?? []).length, 1, "the native source select exists exactly once");
  const technical = html.indexOf('class="is-detail wb-technical"');
  const pairSelect = html.indexOf('id="smart-colors-workbench-pair"');
  assert.ok(technical >= 0 && pairSelect > technical, "the native pairing selector lives inside the technical disclosure");
  assert.equal((html.match(/id="smart-colors-workbench-pair"/g) ?? []).length, 1, "the native pairing selector exists exactly once");
  assert.doesNotMatch(html, /wb-uses-details|Altre coppie/, "the duplicate long uses disclosure is gone");
  assert.match(html, /<dialog id="smart-colors-workbench-picker"/);
  const currentUseBlock = /<p id="smart-colors-workbench-current-use"[^>]*>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(currentUseBlock, "the toolbar exposes a current-use summary");
  assert.match(currentUseBlock[1], /Testo sul callout primary/);
  assert.doesNotMatch(currentUseBlock[1], /--color-primary-text|--color-primary-surface/, "the primary summary never leads with tokens");
  assert.match(html, /Chiaro\/scuro/);
  assert.match(html, /Generato\/tuning/);
  assert.match(html, /Prima\/dopo/);
  assert.match(html, /<fieldset class="wb-fieldset wb-theme-fieldset"><legend>Tema<\/legend>/);
  // The dialog owns the search, category, paginated results and native footer.
  assert.match(html, /<h2 id="smart-colors-workbench-picker-title">Scegli cosa verificare<\/h2>/);
  assert.match(html, /id="smart-colors-workbench-picker-source"[^>]*>Sorgente: /);
  assert.match(html, /<label for="smart-colors-workbench-use-search">Cerca un uso<\/label><input id="smart-colors-workbench-use-search"[^>]*type="search"[^>]*placeholder="es\. testo card"[^>]*disabled>/);
  assert.match(html, /<label for="smart-colors-workbench-use-category">Tipo di uso<\/label><select id="smart-colors-workbench-use-category"[^>]*disabled>/);
  assert.match(html, /<option value="">Tutti gli usi<\/option><option value="callout">Riquadri<\/option>/);
  assert.match(html, /id="smart-colors-workbench-use-prev"[^>]*disabled>Precedenti<\/button>/);
  assert.match(html, /id="smart-colors-workbench-use-next"[^>]*disabled>Successivi<\/button>/);
  assert.match(html, /id="smart-colors-workbench-close-picker"[^>]*disabled>Chiudi<\/button>/);
  assert.match(html, /id="smart-colors-workbench-open-picker"[^>]*aria-haspopup="dialog"[^>]*disabled>Cambia uso<\/button>/);
  assert.match(html, /id="smart-colors-workbench-use-count"[^>]*role="status"/);
  assert.ok(html.indexOf('id="smart-colors-workbench-uses"') > html.indexOf('<dialog id="smart-colors-workbench-picker"'), "the uses hook lives inside the dialog");
  assert.ok((html.match(/class="wb-use"/g) ?? []).length <= 6, "at most six real uses are rendered per page");
  assert.match(html, /aria-pressed="true"[^>]*disabled><span class="wb-use-main">/, "the current use is selected in the results");
  // The misleading usage wording is gone from the file's own UI.
  assert.doesNotMatch(html, /Dove lo usi\?/);
  assert.doesNotMatch(html, /abbinamenti reali/i);
  assert.doesNotMatch(html, /Coppia reale/);
  assert.doesNotMatch(html, /vedere dove è usato/);
  // The human pair heading and the exact tokens live in the main area, not only in the details.
  const identityIndex = html.indexOf('id="smart-colors-workbench-identity"');
  const detailsIndex = html.indexOf('class="is-detail wb-technical"');
  assert.ok(identityIndex >= 0 && identityIndex < detailsIndex, "the identity is visible before any closed detail");
  assert.match(html, /<code>--color-primary-text<\/code> su <code>--color-primary-surface<\/code> · testo/);
  assert.match(html, /Testo normale · AA 4,5:1 \(SC 1\.4\.3\) · campione a 16 px\./);
  assert.doesNotMatch(html, /titolo 22 px non bold/);
  // The mode form stays above the specimen; the theme recovery fieldset lives in the toolbar,
  // outside the correction strip, and keeps its form association.
  const modeForm = html.indexOf('id="smart-colors-workbench-selection"');
  const frames = html.indexOf('id="smart-colors-workbench-left"');
  const correction = html.indexOf('id="smart-colors-workbench-suggestions-title"');
  const themeFieldset = html.indexOf('class="wb-fieldset wb-theme-fieldset"');
  assert.ok(modeForm >= 0 && modeForm < frames, "the mode radio form stays above the specimen");
  assert.ok(themeFieldset >= 0 && themeFieldset < correction, "the theme recovery fieldset precedes the correction section");
  assert.ok(themeFieldset < html.indexOf('class="wb-action-strip wb-suggestions"'), "the theme fieldset is outside the correction box");
  assert.match(html, /id="smart-colors-workbench-theme-light" type="radio"[^>]*form="smart-colors-workbench-selection"/);
  assert.match(html, /id="smart-colors-workbench-theme-dark" type="radio"[^>]*form="smart-colors-workbench-selection"/);
  // Scope guidance lives under the results, not before them.
  const scope = html.indexOf('class="wb-scope-note"');
  assert.ok(html.indexOf('id="smart-colors-workbench-result"') < scope, "the scope sentence follows the result frames");
  // The criterion reference is a closed native detail with normal/large text and the project target.
  assert.match(html, /<details class="is-detail wb-criteria"[^>]*><summary>Soglie di riferimento e testo grande<\/summary>/);
  assert.match(html, /Testo normale · AAA<\/dt><dd>7:1 · <a href="https:\/\/www\.w3\.org\/TR\/WCAG22\/#contrast-enhanced">SC 1\.4\.6<\/a>/);
  assert.match(html, /Testo grande · AA<\/dt><dd>3:1 · 18 pt \/ 24 CSS px regular oppure 14 pt \/ ~18,67 CSS px bold · <a href="https:\/\/www\.w3\.org\/TR\/WCAG22\/#contrast-minimum">SC 1\.4\.3<\/a>/);
  assert.match(html, /Testo grande · AAA<\/dt><dd>4,5:1 · <a href="https:\/\/www\.w3\.org\/TR\/WCAG22\/#contrast-enhanced">SC 1\.4\.6<\/a>/);
  assert.match(html, /<a href="https:\/\/www\.w3\.org\/TR\/WCAG22\/#non-text-contrast">SC 1\.4\.11<\/a>/);
  assert.match(html, /per esempio 7,5:1 non è una soglia WCAG/);
  // Manual L is discoverable and open; the export and other archives stay closed.
  assert.match(html, /<details class="is-detail wb-advanced"[^>]*\bopen\b[^>]*><summary>Regola la coppia \(L\)<\/summary>/);
  assert.match(html, /<details class="is-detail wb-export"[^>]*><summary>Esporta modifiche<\/summary>/);
  assert.doesNotMatch(html, /<details class="is-detail wb-export"[^>]*\bopen\b/);
});

test("a known on-color pair has one readable selection label and keeps the exact technical identity", () => {
  const base = workbenchSession();
  const warmSettings = {
    ...base,
    design: {
      ...base.design,
      sources: [...base.design.sources, { token: "--palette-warm", name: "warm", role: "decorative", darkBlend: null, darkMix: { mode: "automatic", sourcePercent: null, whitePercent: null } }],
      tokens: {
        ...base.design.tokens,
        "--color-warm-ink": { sources: ["--palette-warm"], recipe: "ink", usage: "Testo sul riempimento warm", controls: {} },
        "--color-warm": { sources: ["--palette-warm"], recipe: "identity", usage: "Riempimento warm", controls: {} },
      },
    },
    paletteSource: {
      ...base.paletteSource,
      sources: [...base.paletteSource.sources, { token: "--palette-warm", value: "oklch(0.6 0.15 40)", role: "decorative", darkBlend: null, declaration: null }],
    },
    model: {
      diagnostics: [{ label: "warm ink / warm", scheme: "light", foregroundToken: "--color-warm-ink", backgroundToken: "--color-warm", ratio: 3, minimum: 4.5, target: 4.6, kind: "text", status: "below-minimum", provenance: "generated" }],
      errors: [], warnings: [],
    },
  };
  const html = renderContrastWorkbench(warmSettings);
  assert.match(html, /data-picker-label="Testo sul colore Warm"/, "the option serializes the authoritative picker label");
  assert.match(html, /<span class="wb-use-label">Testo sul colore Warm<\/span>/);
  assert.doesNotMatch(html, /<span class="wb-use-tech"><code>--color-warm-ink<\/code>/, "a known on-color picker label needs no technical fallback");
  const summary = /<p id="smart-colors-workbench-current-use"[^>]*>([\s\S]*?)<\/p>/.exec(html)[1];
  assert.match(summary, /Testo sul colore Warm/);
  assert.doesNotMatch(summary, /--color-warm/);
  assert.doesNotMatch(html, /<\/p>\s*<code class="wb-current-use-tech">/, "no unprojected static identity may survive a runtime selection");
});

test("the toolbar keeps current use, the change-use opener, comparison and theme above one full-width specimen row", () => {
  const html = renderContrastWorkbench(workbenchSession());
  const toolbar = html.indexOf('class="wb-toolbar"');
  const currentUse = html.indexOf('id="smart-colors-workbench-current-use"');
  const opener = html.indexOf('id="smart-colors-workbench-open-picker"');
  const comparison = html.indexOf('id="smart-colors-workbench-comparison-themes"');
  const theme = html.indexOf('id="smart-colors-workbench-theme-light"');
  const result = html.indexOf('id="smart-colors-workbench-result"');
  const correction = html.indexOf('class="wb-action-strip wb-suggestions"');
  const technical = html.indexOf('class="is-detail wb-technical"');
  const pair = html.indexOf('id="smart-colors-workbench-pair"');
  assert.ok(toolbar >= 0 && currentUse > toolbar && opener > currentUse && comparison > opener && theme > comparison && theme < result, "current use, opener, comparison and theme stay adjacent in the toolbar");
  assert.ok(result >= 0 && result < correction, "the single correction strip sits below the full-width specimens");
  assert.doesNotMatch(html, /wb-rail|wb-layout/, "no left rail or workspace split remains");
  assert.ok(pair > technical, "the technical pair fallback is not a primary toolbar control");
  // The theme recovery control lives outside the correction strip and keeps its form association.
  assert.ok(theme < correction, "theme selection survives even when the correction strip is hidden");
  assert.match(html, /id="smart-colors-workbench-theme-dark" type="radio"[^>]*form="smart-colors-workbench-selection"/);
});

test("the palette keeps 16 source buttons at 44px targets and uses the native select on narrow containers", () => {
  const session = workbenchSession({
    design: { ...workbenchSession().design, sources: [] },
    paletteSource: {
      ...workbenchSession().paletteSource,
      sources: Array.from({ length: 16 }, (_, index) => ({
        token: `--palette-source-${index}`,
        value: `oklch(0.6 0.1 ${200 + index})`,
        role: "ui",
        darkBlend: null,
        declaration: null,
      })),
    },
  });
  const html = renderContrastWorkbench(session);
  assert.equal((html.match(/data-smart-colors-workbench="swatch"/g) ?? []).length, 16, "all 16 source buttons are present");
  assert.match(html, /class="wb-field wb-source-select"/, "the single native source select stays available on narrow containers");
  assert.equal((html.match(/id="smart-colors-workbench-source"/g) ?? []).length, 1);
  // A wrapping grid of 44px targets; the native select is the narrow-container fallback.
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-swatch \{[^}]*min-height: 44px;[^}]*\}/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(8\.5rem, 1fr\)\);/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{ display: grid; \}/);
  assert.doesNotMatch(html, /wb-swatch-role/, "the compact toolbar drops the human role");
  assert.match(html, /<code>--palette-source-0<\/code> · ruolo dichiarato: interfaccia/, "the source archive keeps the human role");
});

// --- Serialized factory ------------------------------------------------------

test("the view factory source is self-contained, compiles and carries no unsafe primitive", () => {
  assert.throws(() => createContrastWorkbenchViewSource(), /requires the workbench controller global name/);
  const source = createContrastWorkbenchViewSource(WORKBENCH_RUNTIME_GLOBAL);
  assert.match(source, /createContrastWorkbenchView/);
  assert.ok(source.includes(WORKBENCH_RUNTIME_GLOBAL));
  assert.ok(!source.includes("</"), "no closing-tag sequence may appear in the hashed fragment");
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  assert.doesNotMatch(source, /https?:|fetch\(|XMLHttpRequest|WebSocket|\beval\s*\(/);
  assert.doesNotThrow(() => new Function(source));
  const factory = new Function("return (" + createContrastWorkbenchView.toString() + ");")();
  assert.equal(typeof factory, "function");
});

// --- Browser behaviour (test-only DOM + frozen controller stub) ---------------

function inputValidity(node) {
  if (node.tagName !== "input") return true;
  if (node.type !== "range" && node.type !== "number") return true;
  const raw = node.value === undefined || node.value === null ? "" : String(node.value);
  if (raw === "") return true;
  const value = Number(raw);
  if (!Number.isFinite(value)) return false;
  const min = node.getAttribute("min");
  const max = node.getAttribute("max");
  if (min !== null && value < Number(min)) return false;
  if (max !== null && value > Number(max)) return false;
  const step = node.getAttribute("step");
  if (step && step !== "any") {
    const stepValue = Number(step);
    const base = min !== null ? Number(min) : 0;
    if (Number.isFinite(stepValue) && stepValue > 0) {
      const quotient = (value - base) / stepValue;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-6) return false;
    }
  }
  return true;
}
function makeNode(tag) {
  const el = {
    tagName: tag, className: "", textContent: "", value: "", checked: false, selected: false, hidden: false, disabled: false,
    attributes: {}, children: [], parentNode: null, listeners: {},
    style: { props: {}, setProperty(name, value) { this.props[name] = String(value); } },
    get firstChild() { return this.children[0] ?? null; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    insertBefore(child, reference) { child.parentNode = this; const index = this.children.indexOf(reference); this.children.splice(index < 0 ? this.children.length : index, 0, child); return child; },
    removeChild(child) { const index = this.children.indexOf(child); if (index >= 0) this.children.splice(index, 1); child.parentNode = null; return child; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    dispatch(type, event) { (this.listeners[type] || []).forEach((handler) => handler(event ?? { type, preventDefault() {} })); },
    focus() { this.focused = true; },
    select() { this.selectedText = true; },
    setSelectionRange() {},
    checkValidity() { return this.children.every((child) => child.checkValidity()) && inputValidity(this); },
    querySelector(selector) { return findIn(this, selector); },
    querySelectorAll(selector) { return findAllIn(this, selector); },
  };
  return el;
}
function matches(node, selector) {
  const attribute = /^\[([a-zA-Z-]+)="([^"]*)"\]$/.exec(selector);
  if (attribute) return node.getAttribute(attribute[1]) === attribute[2];
  if (/^\[([a-zA-Z-]+)\]$/.test(selector)) return node.getAttribute(selector.slice(1, -1)) !== null;
  if (/^[a-z]+$/.test(selector)) return node.tagName === selector;
  return false;
}
function findIn(root, selector) {
  const stack = [...root.children];
  while (stack.length) {
    const node = stack.shift();
    if (matches(node, selector)) return node;
    stack.push(...node.children);
  }
  return null;
}
function findAllIn(root, selector) {
  const found = [];
  const stack = [...root.children];
  while (stack.length) {
    const node = stack.shift();
    if (matches(node, selector)) found.push(node);
    stack.push(...node.children);
  }
  return found;
}
function flat(node) {
  let out = node.textContent || "";
  for (const child of node.children) out += " " + flat(child);
  return out;
}
function snippetOf(html) {
  const match = /<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(html);
  return match ? match[1] : "";
}
function optionOf(value, data) {
  const option = makeNode("option");
  option.value = value;
  option.textContent = value;
  for (const [name, attribute] of Object.entries(data)) option.setAttribute(name, attribute);
  return option;
}
function workbenchDom(session) {
  const registry = new Map();
  function register(node, id) { node.id = id; registry.set(id, node); return node; }
  const host = register(makeNode("div"), "smart-colors-workbench");
  const status = makeNode("p"); status.setAttribute("data-smart-colors-workbench", "status"); host.appendChild(status);
  const selection = makeNode("form"); selection.setAttribute("data-smart-colors-workbench", "selection"); host.appendChild(selection);
  const controlsForm = makeNode("form"); controlsForm.setAttribute("data-smart-colors-workbench", "controls"); host.appendChild(controlsForm);
  // Primary picker: the source swatches (real buttons) and the uses container the factory owns.
  function swatch(token) { const button = makeNode("button"); button.setAttribute("data-smart-colors-workbench", "swatch"); button.setAttribute("data-token", token); return button; }
  const swatchBrand = swatch("--palette-brand"); host.appendChild(swatchBrand);
  const swatchCanvas = swatch("--palette-canvas"); host.appendChild(swatchCanvas);
  const swatchOrphan = swatch("--palette-orphan"); host.appendChild(swatchOrphan);
  const usesBox = makeNode("div"); usesBox.setAttribute("data-smart-colors-workbench", "uses"); usesBox.className = "wb-picker-results";
  const currentUse = register(makeNode("p"), "smart-colors-workbench-current-use"); currentUse.setAttribute("data-smart-colors-workbench", "current-use"); host.appendChild(currentUse);
  const openPicker = register(makeNode("button"), "smart-colors-workbench-open-picker"); openPicker.disabled = true; host.appendChild(openPicker);
  const pickerDialog = register(makeNode("dialog"), "smart-colors-workbench-picker"); pickerDialog.open = false;
  pickerDialog.showModal = function () { this.open = true; };
  pickerDialog.close = function () { this.open = false; this.dispatch("close"); };
  pickerDialog.appendChild(usesBox);
  host.appendChild(pickerDialog);
  const pickerSource = register(makeNode("p"), "smart-colors-workbench-picker-source"); pickerDialog.appendChild(pickerSource);
  const useSearch = register(makeNode("input"), "smart-colors-workbench-use-search"); useSearch.value = ""; useSearch.disabled = true; pickerDialog.appendChild(useSearch);
  const useCategory = register(makeNode("select"), "smart-colors-workbench-use-category"); useCategory.value = ""; useCategory.disabled = true; pickerDialog.appendChild(useCategory);
  const useClear = register(makeNode("button"), "smart-colors-workbench-clear-search"); useClear.disabled = true; pickerDialog.appendChild(useClear);
  const useCount = register(makeNode("p"), "smart-colors-workbench-use-count"); useCount.setAttribute("role", "status"); pickerDialog.appendChild(useCount);
  const usePrev = register(makeNode("button"), "smart-colors-workbench-use-prev"); usePrev.disabled = true; usePrev.setAttribute("aria-disabled", "true"); pickerDialog.appendChild(usePrev);
  const useNext = register(makeNode("button"), "smart-colors-workbench-use-next"); useNext.disabled = true; useNext.setAttribute("aria-disabled", "true"); pickerDialog.appendChild(useNext);
  const closePicker = register(makeNode("button"), "smart-colors-workbench-close-picker"); closePicker.disabled = true; pickerDialog.appendChild(closePicker);
  const current = register(makeNode("p"), "smart-colors-workbench-current");
  const identity = register(makeNode("p"), "smart-colors-workbench-identity"); identity.setAttribute("data-smart-colors-workbench", "identity");
  const purpose = register(makeNode("p"), "smart-colors-workbench-purpose"); purpose.setAttribute("data-smart-colors-workbench", "purpose");
  const actionTheme = register(makeNode("p"), "smart-colors-workbench-action-theme"); actionTheme.setAttribute("data-smart-colors-workbench", "action-theme");
  const resultBox = register(makeNode("div"), "smart-colors-workbench-result");
  const emptyNote = makeNode("p"); emptyNote.setAttribute("data-smart-colors-workbench", "empty"); emptyNote.hidden = true; register(emptyNote, "smart-colors-workbench-empty");
  const correctionBox = makeNode("section"); correctionBox.setAttribute("data-smart-colors-workbench", "correction"); host.appendChild(correctionBox);
  const manualBox = makeNode("details"); manualBox.setAttribute("data-smart-colors-workbench", "manual"); host.appendChild(manualBox);
  const exportBox = makeNode("details"); exportBox.setAttribute("data-smart-colors-workbench", "export"); exportBox.open = false; host.appendChild(exportBox);
  const overviewBox = makeNode("section"); overviewBox.setAttribute("data-smart-colors-workbench", "overview"); host.appendChild(overviewBox);
  const matrixSearch = register(makeNode("input"), "smart-colors-workbench-matrix-search"); matrixSearch.value = ""; matrixSearch.disabled = true; overviewBox.appendChild(matrixSearch);
  const matrixFilter = register(makeNode("select"), "smart-colors-workbench-matrix-filter"); matrixFilter.value = ""; matrixFilter.disabled = true; overviewBox.appendChild(matrixFilter);
  const matrixClear = register(makeNode("button"), "smart-colors-workbench-matrix-clear"); matrixClear.disabled = true; overviewBox.appendChild(matrixClear);
  const matrixAll = register(makeNode("input"), "smart-colors-workbench-matrix-all"); matrixAll.checked = true; matrixAll.disabled = true; overviewBox.appendChild(matrixAll);
  const overviewScope = register(makeNode("span"), "smart-colors-workbench-overview-scope"); overviewBox.appendChild(overviewScope);
  const matrixCount = register(makeNode("p"), "smart-colors-workbench-matrix-count"); overviewBox.appendChild(matrixCount);
  const matrixViewA = register(makeNode("th"), "smart-colors-workbench-matrix-a"); overviewBox.appendChild(matrixViewA);
  const matrixViewB = register(makeNode("th"), "smart-colors-workbench-matrix-b"); overviewBox.appendChild(matrixViewB);
  const matrixBody = makeNode("tbody"); matrixBody.setAttribute("data-smart-colors-workbench", "matrix-body"); overviewBox.appendChild(matrixBody);
  function matrixRow(value, status, search) {
    const row = makeNode("tr");
    row.setAttribute("data-smart-colors-workbench", "matrix-row");
    row.setAttribute("data-pair-value", value);
    row.setAttribute("data-status", status);
    row.setAttribute("data-search", search);
    row.setAttribute("data-live-status", "false");
    const live = makeNode("td"); live.setAttribute("data-smart-colors-workbench", "matrix-live"); live.textContent = "Da misurare con JavaScript."; row.appendChild(live);
    const button = makeNode("button"); button.setAttribute("data-smart-colors-workbench", "matrix-inspect"); button.setAttribute("data-pair-value", value); button.disabled = true; button.textContent = "Ispeziona"; row.appendChild(button);
    matrixBody.appendChild(row);
    return { row, button, live };
  }
  const matrixPrimary = matrixRow("--color-primary-text|--color-primary-surface|text", "below-minimum", "testo della famiglia primaria primary text primary surface testo");
  const matrixText = matrixRow("--color-text|--color-bg|text", "pass", "testo sulla pagina text bg canvas testo");

  const source = register(makeNode("select"), "smart-colors-workbench-source");
  for (const value of ["", "--palette-brand", "--palette-canvas"]) { const option = optionOf(value || "all", {}); option.value = value; source.appendChild(option); }
  source.value = "--palette-brand";
  const pair = register(makeNode("select"), "smart-colors-workbench-pair");
  const primary = optionOf("--color-primary-text|--color-primary-surface|text", {
    "data-fg": "--color-primary-text", "data-bg": "--color-primary-surface", "data-kind": "text", "data-catalogue-kind": "text",
    "data-usage": "Testo della famiglia primaria", "data-sources": "--palette-brand",
    "data-fg-sources": "--palette-brand", "data-bg-sources": "--palette-canvas --palette-brand",
    "data-thresholds": "4.5,4.6;4.5,4.6", "data-matrix": "3.1,below-minimum,5.2,pass",
  });
  primary.selected = true;
  const text = optionOf("--color-text|--color-bg|text", {
    "data-fg": "--color-text", "data-bg": "--color-bg", "data-kind": "text", "data-catalogue-kind": "text",
    "data-usage": "Testo sulla pagina", "data-sources": "--palette-canvas",
    "data-fg-sources": "--palette-canvas", "data-bg-sources": "--palette-canvas",
    "data-thresholds": "4.5,4.6;", "data-matrix": "6.4,pass,,unmeasured",
  });
  pair.appendChild(primary); pair.appendChild(text);
  Object.defineProperty(pair, "options", { get() { return this.children.filter((child) => child.tagName === "option"); } });
  pair.value = primary.value;
  selection.appendChild(source); selection.appendChild(pair);
  const themeLight = register(makeNode("input"), "smart-colors-workbench-theme-light"); themeLight.checked = true;
  const themeDark = register(makeNode("input"), "smart-colors-workbench-theme-dark");
  const comparisonThemes = register(makeNode("input"), "smart-colors-workbench-comparison-themes"); comparisonThemes.checked = true;
  const comparisonTuning = register(makeNode("input"), "smart-colors-workbench-comparison-tuning");
  const comparisonDraft = register(makeNode("input"), "smart-colors-workbench-comparison-draft");
  selection.appendChild(themeLight); selection.appendChild(themeDark);
  selection.appendChild(comparisonThemes); selection.appendChild(comparisonTuning); selection.appendChild(comparisonDraft);

  register(makeNode("div"), "smart-colors-workbench-details");
  register(makeNode("h3"), "smart-colors-workbench-left-title");
  register(makeNode("h3"), "smart-colors-workbench-right-title");
  register(makeNode("div"), "smart-colors-workbench-left").setAttribute("data-smart-colors-workbench", "left");
  register(makeNode("div"), "smart-colors-workbench-right").setAttribute("data-smart-colors-workbench", "right");
  const leftSample = makeNode("span"); leftSample.setAttribute("data-smart-colors-workbench", "left-sample");
  const leftMeta = makeNode("span"); leftMeta.setAttribute("data-smart-colors-workbench", "left-meta");
  const rightSample = makeNode("span"); rightSample.setAttribute("data-smart-colors-workbench", "right-sample");
  const rightMeta = makeNode("span"); rightMeta.setAttribute("data-smart-colors-workbench", "right-meta");
  host.appendChild(leftSample); host.appendChild(leftMeta); host.appendChild(rightSample); host.appendChild(rightMeta);
  const explorationBox = makeNode("details"); explorationBox.setAttribute("data-smart-colors-workbench", "exploration"); explorationBox.hidden = true; host.appendChild(explorationBox);
  const explorationRun = register(makeNode("button"), "smart-colors-workbench-exploration-run"); explorationRun.disabled = true; explorationBox.appendChild(explorationRun);
  const explorationStatus = makeNode("p"); explorationStatus.setAttribute("data-smart-colors-workbench", "exploration-status"); explorationBox.appendChild(explorationStatus);
  const explorationResults = makeNode("div"); explorationResults.setAttribute("data-smart-colors-workbench", "exploration-results"); explorationBox.appendChild(explorationResults);
  register(makeNode("dl"), "smart-colors-workbench-left-measure");
  register(makeNode("dl"), "smart-colors-workbench-right-measure");
  const controlsBody = register(makeNode("div"), "smart-colors-workbench-controls");
  controlsForm.appendChild(controlsBody);
  const proposal = register(makeNode("div"), "smart-colors-workbench-proposal");
  const proposalFrames = register(makeNode("section"), "smart-colors-workbench-proposal-frames");
  proposalFrames.hidden = true;
  const proposalBefore = register(makeNode("div"), "smart-colors-workbench-proposal-before");
  const proposalAfter = register(makeNode("div"), "smart-colors-workbench-proposal-after");
  proposalFrames.appendChild(proposalBefore);
  proposalFrames.appendChild(proposalAfter);
  register(makeNode("button"), "smart-colors-workbench-apply");
  const discard = register(makeNode("button"), "smart-colors-workbench-discard-suggestion"); discard.hidden = true; discard.disabled = true;
  const sessionStatus = register(makeNode("p"), "smart-colors-workbench-session-status"); sessionStatus.textContent = "Anteprima locale";
  register(makeNode("button"), "smart-colors-workbench-export");
  register(makeNode("textarea"), "smart-colors-workbench-export-text");
  register(makeNode("p"), "smart-colors-workbench-export-note");
  register(makeNode("a"), "smart-colors-workbench-download");
  register(makeNode("textarea"), "smart-colors-workbench-palette-source");
  register(makeNode("button"), "smart-colors-workbench-copy-palette");
  register(makeNode("button"), "smart-colors-workbench-copy-export");
  register(makeNode("button"), "smart-colors-workbench-submit");
  register(makeNode("button"), "smart-colors-workbench-controls-submit");
  register(makeNode("button"), "smart-colors-workbench-reset-pair");
  register(makeNode("button"), "smart-colors-workbench-reset-all");
  register(makeNode("button"), "smart-colors-workbench-suggest-foreground");
  register(makeNode("button"), "smart-colors-workbench-suggest-background");
  const payload = register(makeNode("script"), "smart-colors-payload");
  payload.textContent = JSON.stringify({ design: session.design, css: session.css, paletteSource: session.paletteSource });
  const exportMode = register(makeNode("p"), "smart-colors-workbench-export-mode");

  const document = {
    activeElement: null,
    getElementById: (id) => registry.get(id) ?? null,
    createElement: (tag) => makeNode(tag),
  };
  return { host, status, selection, controlsForm, source, pair, themeLight, themeDark, comparisonThemes, comparisonTuning, comparisonDraft, controlsBody, proposal, proposalFrames, proposalBefore, proposalAfter, usesBox, current, currentUse, openPicker, pickerDialog, pickerSource, useSearch, useCategory, useClear, useCount, usePrev, useNext, closePicker, identity, purpose, actionTheme, resultBox, emptyNote, correctionBox, manualBox, exportBox, sessionStatus, discard, swatchBrand, swatchCanvas, swatchOrphan, overviewBox, matrixSearch, matrixFilter, matrixClear, matrixAll, overviewScope, matrixCount, matrixViewA, matrixViewB, matrixBody, leftSample, leftMeta, rightSample, rightMeta, explorationBox, explorationRun, explorationStatus, explorationResults, exportMode, document };
}

function controllerStub(options = {}) {
  const calls = { mount: [], select: [], setOverride: [], setLightness: [], removeOverride: [], reset: [], suggest: [], apply: [], discard: [], explore: [], unsubscribed: false, destroy: 0 };
  let state = options.state ?? { phase: "idle", revision: 0, selection: { pairId: null, theme: "light", comparison: "themes" }, draft: {}, removed: [], views: [], suggestion: null, error: null };
  let listener = null;
  return {
    calls,
    state: () => state,
    publish(next) { state = { removed: [], ...next }; if (listener) listener(state); },
    subscribe(handler) { listener = handler; return () => { listener = null; calls.unsubscribed = true; }; },
    pairs: options.pairs ?? (() => [
      { id: "light|color|--color-primary-text|--color-primary-surface", foreground: "--color-primary-text", background: "--color-primary-surface", property: "color" },
      { id: "light|color|--color-text|--color-bg", foreground: "--color-text", background: "--color-bg", property: "color" },
    ]),
    mount(argument) { calls.mount.push(argument); return Promise.resolve(); },
    select(argument) { calls.select.push(argument); return Promise.resolve(); },
    setOverride(control, value) { calls.setOverride.push([control, value]); return Promise.resolve(); },
    setLightness(control, value) { calls.setLightness.push([control, value]); return Promise.resolve(); },
    removeOverride(control) { calls.removeOverride.push(control); return Promise.resolve(); },
    reset(control) { calls.reset.push(control); return Promise.resolve(); },
    suggest(side) { calls.suggest.push(side); return Promise.resolve(); },
    applySuggestion() { calls.apply.push(true); return Promise.resolve(); },
    discardSuggestion() {
      calls.discard.push(true);
      state = { ...state, suggestion: null, revision: Number(state.revision || 0) + 1 };
      if (listener) listener(state);
      return state;
    },
    exportTuning() { return typeof options.tuning === "function" ? options.tuning() : (options.tuning ?? ":root { --color-tune-primary-text-light: oklch(0.4 0.1 250); }"); },
    exportTuningFile: options.exportTuningFile,
    explorationPairs: options.explorationPairs,
    measureExploration: options.measureExploration,
    destroy() { calls.destroy += 1; },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function install(session, controller = controllerStub()) {
  const dom = workbenchDom(session);
  const view = createContrastWorkbenchView({ document: dom.document, controller });
  return { dom, controller, view };
}

function addUseOptions(dom, count) {
  for (let index = 0; index < count; index += 1) {
    const option = optionOf(`--color-extra-${index}|--color-bg|text`, {
      "data-fg": `--color-extra-${index}`,
      "data-bg": "--color-bg",
      "data-kind": "text",
      "data-usage": `Uso extra ${index}`,
      "data-sources": "--palette-brand",
      "data-fg-sources": "--palette-brand",
      "data-bg-sources": "--palette-brand",
      "data-use-bucket": index % 2 === 0 ? "page" : "border",
      "data-use-rank": String(10 + index),
      "data-thresholds": "4.5,4.6;4.5,4.6",
    });
    dom.pair.appendChild(option);
  }
}

function addSearchOption(dom, foreground, background, usage) {
  const option = optionOf(`${foreground}|${background}|text`, {
    "data-fg": foreground,
    "data-bg": background,
    "data-kind": "text",
    "data-usage": usage,
    "data-sources": "--palette-brand",
    "data-fg-sources": "--palette-brand",
    "data-bg-sources": "--palette-brand",
    "data-use-bucket": "page",
    "data-use-rank": "30",
    "data-thresholds": "4.5,4.6;4.5,4.6",
  });
  dom.pair.appendChild(option);
  return option;
}

function matrixRowByValue(dom, value) {
  const row = findAllIn(dom.matrixBody, '[data-smart-colors-workbench="matrix-row"]').find((item) => item.getAttribute("data-pair-value") === value);
  assert.ok(row, "missing matrix row " + value);
  const cells = row.querySelectorAll('[data-smart-colors-workbench="matrix-cell"]');
  return {
    row,
    button: row.querySelector('[data-smart-colors-workbench="matrix-inspect"]'),
    cells: Array.from(cells),
    left: cells[0],
    right: cells[1],
  };
}

test("mount is called only with the real left/right containers and phases are announced concisely", async () => {
  const { dom, controller } = install(workbenchSession());
  assert.equal(controller.calls.mount.length, 1);
  assert.equal(controller.calls.mount[0].left, dom.document.getElementById("smart-colors-workbench-left"));
  assert.equal(controller.calls.mount[0].right, dom.document.getElementById("smart-colors-workbench-right"));
  assert.equal(controller.calls.mount[0].proposalBefore, dom.document.getElementById("smart-colors-workbench-proposal-before"));
  assert.equal(controller.calls.mount[0].proposalAfter, dom.document.getElementById("smart-colors-workbench-proposal-after"));
  assert.match(dom.status.textContent, /In attesa: scegli un colore/);

  controller.publish({ phase: "running", revision: 1, views: [], draft: {}, suggestion: null, error: null });
  assert.match(dom.status.textContent, /Verifica in corso/);
  assert.doesNotMatch(dom.status.className, /wb-visually-hidden/, "busy status remains visible");
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-left-measure")), /Verifica in corso/);

  controller.publish({
    phase: "complete", revision: 2, draft: {}, suggestion: null, error: null,
    views: [
      { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum" }, measurements: [{}, {}], errors: [] },
      { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 5.2, minimum: 4.5, target: 4.6, status: "pass" }, measurements: [{}], errors: [] },
    ],
  });
  const left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /3,10:1/);
  assert.match(left, /Soglia AA per testo normale non raggiunta/);
  assert.match(left, /SC 1\.4\.3 · 4,50:1/);
  assert.match(left, /Minimo richiesto e criterio/);
  assert.match(left, /4,50:1/);
  assert.match(left, /Obiettivo progetto \(non WCAG\)/);
  assert.match(left, /4,60:1 · non raggiunto/);
  assert.doesNotMatch(left, /obiettivo del progetto, non una soglia WCAG/, "the closed reference owns the non-WCAG target explanation");
  assert.doesNotMatch(left, /corpo 16 px|nota 14 px/, "common applicability is not repeated per card");
  assert.match(flat(dom.purpose), /Testo normale · AA 4,5:1 \(SC 1\.4\.3\) · campione a 16 px\./);
  assert.doesNotMatch(flat(dom.purpose), /titolo 22 px non bold/, "the actual 650 title is never claimed as bold or non-bold large text");
  assert.match(dom.status.className, /wb-visually-hidden/, "routine complete status is visually hidden but remains a live region");
  assert.doesNotMatch(left, /Contrasto sufficiente|Contrasto insufficiente/, "no universal pass/fail badge survives");
  // The visible ratio row is a direct dl group; the long criterion/target documentation lives in
  // one native disclosure, still as semantic dt/dd groups.
  const leftMeasureNode = dom.document.getElementById("smart-colors-workbench-left-measure");
  assert.equal(leftMeasureNode.tagName, "dl");
  const collect = (node, found) => {
    for (const child of node.children) {
      if (/(^|\s)wb-threshold(\s|$)/.test(child.className)) found.push(child);
      collect(child, found);
    }
    return found;
  };
  const thresholdRows = collect(leftMeasureNode, []);
  assert.equal(thresholdRows.length, 2, "minimum and target stay two semantic threshold rows");
  for (const row of thresholdRows) {
    assert.equal(row.tagName, "div");
    assert.equal(row.children.map((child) => child.tagName).join(","), "span,span", "each threshold row is a label/value group");
    assert.equal(row.parentNode.tagName, "details", "the threshold groups live in the measurement detail");
  }
  assert.equal(leftMeasureNode.children.filter((child) => /(^|\s)wb-measure-row(\s|$)/.test(child.className)).length >= 1, true, "the ratio stays visible outside the detail");
  assert.equal(leftMeasureNode.children.filter((child) => /(^|\s)wb-thresholds-inline(\s|$)/.test(child.className)).length, 0, "the invalid inline wrapper is gone");
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-right-measure")), /Soglia AA per testo normale raggiunta/);
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-right-measure")), /4,60:1 · raggiunto/);
  assert.match(dom.status.textContent, /Misure di questa coppia aggiornate in questo browser/);

  controller.publish({
    phase: "incomplete", revision: 3, draft: {}, suggestion: null, error: "coverage incompleta",
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 6.4, minimum: 4.5, target: 4.6, status: "pass" }, measurements: [{}], errors: [] }],
  });
  assert.match(dom.status.textContent, /Misura incompleta/);
  assert.doesNotMatch(dom.status.className, /wb-visually-hidden/, "incomplete/error status remains visible");
  assert.doesNotMatch(dom.status.textContent, /complete per la selezione/);
  // A per-pair pass must never be promoted to a global verdict on incomplete coverage.
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-left-measure")), /Copertura incompleta: questo esito è locale e non un verdetto globale/);

  controller.publish({ phase: "unavailable", revision: 4, views: [], draft: {}, suggestion: null, error: "payload non supportato" });
  assert.match(dom.status.textContent, /Misura non disponibile/);
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-left-measure")), /Non disponibile/);
});

test("the action theme follows the checked theme immediately, before any measurement returns", async () => {
  const { dom } = install(workbenchSession());
  dom.themeLight.checked = false;
  dom.themeDark.checked = true;
  dom.themeDark.dispatch("change");
  assert.match(dom.actionTheme.textContent, /Tema per proposta e override: scuro/);
  await tick();
});

test("each specimen reports its scoped AA criterion and the project target separately, and fails closed when unmeasured", () => {
  const { dom, controller } = install(workbenchSession());
  const selection = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" };
  controller.publish({
    phase: "complete", revision: 1, draft: {}, suggestion: null, error: null, selection,
    views: [
      { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 4.8, minimum: 4.5, target: 7.5, status: "below-target" }, measurements: [{}], errors: [] },
      { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 3.1, minimum: 4.5, target: 7.5, status: "below-minimum" }, measurements: [{}], errors: [] },
    ],
  });
  const left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /4,80:1/);
  assert.match(left, /Soglia AA per testo normale raggiunta/);
  assert.match(left, /SC 1\.4\.3 · 4,50:1/);
  assert.doesNotMatch(left, /corpo 16 px|nota 14 px/, "applicability is stated once above the frames");
  assert.match(left, /Obiettivo progetto \(non WCAG\)/);
  assert.match(left, /7,50:1 · non raggiunto/, "a below-target pass keeps the project target unmet");
  assert.doesNotMatch(left, /non una soglia WCAG/, "the per-card result stays concise");
  assert.doesNotMatch(left, /Contrasto sufficiente|Contrasto insufficiente/, "no universal badge");
  const right = flat(dom.document.getElementById("smart-colors-workbench-right-measure"));
  assert.match(right, /Soglia AA per testo normale non raggiunta/);
  assert.match(right, /7,50:1 · non raggiunto/);

  // The exact identity and the contextual criterion are visible in the main area.
  assert.match(flat(dom.identity), /--color-primary-text/);
  assert.match(flat(dom.identity), /--color-primary-surface/);
  assert.match(flat(dom.identity), /testo/);
  assert.match(flat(dom.purpose), /Testo normale · AA 4,5:1 \(SC 1\.4\.3\) · campione a 16 px\./);
  assert.doesNotMatch(flat(dom.purpose), /titolo 22 px non bold/);
  // The selected theme is stated next to the suggestion action.
  assert.match(dom.actionTheme.textContent, /Tema per proposta e override: chiaro/);

  // An explicitly unmeasured record never inherits a threshold or a pass, even with stale numbers.
  controller.publish({
    phase: "complete", revision: 2, draft: {}, suggestion: null, error: null, selection,
    views: [
      { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 6, minimum: 4.5, target: 7, status: "unmeasured" }, measurements: [{}], errors: [] },
      { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 6, minimum: 4.5, target: 7, status: "unmeasured" }, measurements: [{}], errors: [] },
    ],
  });
  const unmeasured = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(unmeasured, /Non misurato/);
  assert.match(unmeasured, /Stato di misura non supportato o incoerente: nessun esito/);
  assert.match(unmeasured, /Obiettivo progetto \(non WCAG\)/);
  assert.match(unmeasured, /7,00:1 · non misurato/);
  assert.doesNotMatch(unmeasured, /raggiunta|non raggiunta/);
});

test("a criterion is never inferred from a numeric threshold: unknown kind fails closed", () => {
  const dom = workbenchDom(workbenchSession());
  const unknown = optionOf("--color-unknown|--color-bg|widget", {
    "data-fg": "--color-unknown", "data-bg": "--color-bg", "data-kind": "widget", "data-catalogue-kind": "widget",
    "data-usage": "Widget sconosciuto", "data-sources": "--palette-brand", "data-thresholds": "4.5,7;4.5,7",
  });
  dom.pair.appendChild(unknown);
  for (const candidate of dom.pair.options) candidate.selected = candidate === unknown;
  dom.pair.value = unknown.value;
  const controller = controllerStub({
    pairs: () => [{ id: "light|color|--color-unknown|--color-bg", foreground: "--color-unknown", background: "--color-bg", property: "color" }],
    state: {
      phase: "complete", revision: 1, draft: {}, suggestion: null, error: null,
      selection: { pairId: "light|color|--color-unknown|--color-bg", theme: "light", comparison: "themes" },
      views: [
        { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 8, minimum: 4.5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
        { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 8, minimum: 4.5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
      ],
    },
  });
  createContrastWorkbenchView({ document: dom.document, controller });
  const left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /Non applicabile/);
  assert.match(left, /Tipo di coppia non riconosciuto: nessun criterio WCAG applicato/);
  assert.doesNotMatch(left, /SC 1\.4\.3|SC 1\.4\.11|Soglia AA per testo normale|Soglia di confronto/, "an unknown kind never receives a normative label");
  assert.match(flat(dom.purpose), /Tipo di coppia non riconosciuto/);
  assert.match(flat(dom.identity), /tipo non riconosciuto/);
});

test("an unsupported or incoherent measurement status fails closed", () => {
  const { dom, controller } = install(workbenchSession());
  const selection = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" };
  const view = (measurement) => ({ slot: "left", theme: "light", variant: "baseline", pair: null, measurement, measurements: [{}], errors: [] });
  controller.publish({ phase: "complete", revision: 1, draft: {}, suggestion: null, error: null, selection, views: [view({ ratio: 8, minimum: 4.5, target: 7, status: "mystery" })] });
  let left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /Non misurato/);
  assert.match(left, /Stato di misura non supportato o incoerente: nessun esito/);
  assert.doesNotMatch(left, /Soglia AA per testo normale|SC 1\.4\.3/);

  // A supported status that contradicts the numbers is also fail-closed.
  controller.publish({ phase: "complete", revision: 2, draft: {}, suggestion: null, error: null, selection, views: [view({ ratio: 2, minimum: 4.5, target: 7, status: "pass" })] });
  left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /Non misurato/);
  assert.match(left, /Stato di misura non supportato o incoerente: nessun esito/);
  assert.doesNotMatch(left, /raggiunta|non raggiunta/);
});

test("a noncanonical threshold never earns a normative positive", () => {
  const { dom, controller } = install(workbenchSession());
  const option = dom.pair.options.find((candidate) => candidate.value === "--color-primary-text|--color-primary-surface|text");
  option.setAttribute("data-thresholds", "5,7;5,7");
  const selection = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" };
  controller.publish({
    phase: "complete", revision: 1, draft: {}, suggestion: null, error: null, selection,
    views: [
      { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 8, minimum: 5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
      { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 8, minimum: 5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
    ],
  });
  const left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /Non applicabile/);
  assert.match(left, /Soglia non canonica per questo tipo: nessun criterio WCAG applicato/);
  assert.doesNotMatch(left, /SC 1\.4\.3|SC 1\.4\.11|Soglia AA per testo normale/, "a noncanonical threshold is never called normative");
  // The purpose sentence still states the normative rule for the catalogue kind, not the odd threshold.
  assert.match(flat(dom.purpose), /Testo normale · AA 4,5:1 \(SC 1\.4\.3\)/);
});

test("an on-color specimen states only its 16px button label, never the title/note pair", () => {
  // Static build: the token shape (ink on its own fill) is enough to distinguish the on-color sample.
  const staticHtml = renderContrastWorkbench(workbenchSession({
    model: { diagnostics: [{ label: "on-primary", scheme: "light", foregroundToken: "--color-primary-ink", backgroundToken: "--color-primary", ratio: 6, minimum: 4.5, target: 4.6, kind: "text", status: "pass", provenance: "generated" }], errors: [], warnings: [] },
  }));
  assert.match(staticHtml, /Testo su riempimento · AA 4,5:1 \(SC 1\.4\.3\) · etichetta a 16 px\./);
  assert.doesNotMatch(staticHtml, /nota 14 px|corpo 16 px/);
  assert.match(staticHtml, /data-catalogue-kind="on-color"/);

  const dom = workbenchDom(workbenchSession());
  const onColor = optionOf("--color-primary-ink|--color-primary|text", {
    "data-fg": "--color-primary-ink", "data-bg": "--color-primary", "data-kind": "text", "data-catalogue-kind": "on-color",
    "data-usage": "Testo sul riempimento primary", "data-sources": "--palette-brand", "data-thresholds": "4.5,4.6;4.5,4.6",
  });
  dom.pair.appendChild(onColor);
  for (const candidate of dom.pair.options) candidate.selected = candidate === onColor;
  dom.pair.value = onColor.value;
  const controller = controllerStub({
    pairs: () => [{ id: "light|color|--color-primary-ink|--color-primary", foreground: "--color-primary-ink", background: "--color-primary", property: "color" }],
    state: {
      phase: "complete", revision: 1, draft: {}, suggestion: null, error: null,
      selection: { pairId: "light|color|--color-primary-ink|--color-primary", theme: "light", comparison: "themes" },
      views: [
        { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 6, minimum: 4.5, target: 4.6, status: "pass" }, measurements: [{}], errors: [] },
        { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 6, minimum: 4.5, target: 4.6, status: "pass" }, measurements: [{}], errors: [] },
      ],
    },
  });
  createContrastWorkbenchView({ document: dom.document, controller });
  assert.match(flat(dom.identity), /testo su riempimento/);
  assert.match(flat(dom.purpose), /Testo su riempimento · AA 4,5:1 \(SC 1\.4\.3\) · etichetta a 16 px\./);
  assert.doesNotMatch(flat(dom.purpose), /nota 14 px|corpo 16 px/);
  const left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /Soglia AA per testo normale raggiunta/);
  assert.match(left, /SC 1\.4\.3 · 4,50:1/);
});

test("a non-text pair reports SC 1.4.11 and 3:1 with its applicability, never the text criterion", () => {
  const dom = workbenchDom(workbenchSession());
  const focus = optionOf("--color-focus-ring|--color-bg|non-text", {
    "data-fg": "--color-focus-ring", "data-bg": "--color-bg", "data-kind": "non-text",
    "data-usage": "Anello di focus", "data-sources": "--palette-brand",
    "data-fg-sources": "--palette-brand", "data-bg-sources": "--palette-canvas",
    "data-thresholds": "3,3;3,3",
  });
  dom.pair.appendChild(focus);
  for (const candidate of dom.pair.options) candidate.selected = candidate === focus;
  dom.pair.value = focus.value;
  const controller = controllerStub({
    pairs: () => [{ id: "light|outlineColor|--color-focus-ring|--color-bg", foreground: "--color-focus-ring", background: "--color-bg", property: "outlineColor" }],
    state: {
      phase: "complete", revision: 1, draft: {}, suggestion: null, error: null,
      selection: { pairId: "light|outlineColor|--color-focus-ring|--color-bg", theme: "light", comparison: "themes" },
      views: [
        { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 2.9, minimum: 3, target: 3, status: "below-minimum" }, measurements: [{}], errors: [] },
        { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 3.4, minimum: 3, target: 3, status: "pass" }, measurements: [{}], errors: [] },
      ],
    },
  });
  createContrastWorkbenchView({ document: dom.document, controller });
  const left = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(left, /Soglia di confronto 3:1 non raggiunta/);
  assert.match(left, /SC 1\.4\.11 · 3,00:1/);
  assert.match(left, /3,00:1 · non raggiunto/);
  assert.doesNotMatch(left, /Soglia AA per testo normale/);
  assert.doesNotMatch(left, /bordo decorativo|oscuramento/, "applicability is stated once above the frames");
  const right = flat(dom.document.getElementById("smart-colors-workbench-right-measure"));
  assert.match(right, /Soglia di confronto 3:1 raggiunta/);
  assert.match(right, /3,00:1 · raggiunto/);
  assert.match(flat(dom.identity), /--color-focus-ring/);
  assert.match(flat(dom.identity), /--color-bg/);
  assert.match(flat(dom.identity), /anello/);
  assert.match(flat(dom.purpose), /Componente non testuale · 3:1 \(SC 1\.4\.11\)/);
  assert.match(flat(dom.purpose), /non verifica focus, comportamento o oscuramento/);

  // A declared non-text kind with a text threshold is a mismatch: it never becomes SC 1.4.11.
  focus.setAttribute("data-thresholds", "4.5,7;4.5,7");
  controller.publish({
    phase: "complete", revision: 2, draft: {}, suggestion: null, error: null,
    selection: { pairId: "light|outlineColor|--color-focus-ring|--color-bg", theme: "light", comparison: "themes" },
    views: [
      { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 8, minimum: 4.5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
      { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 8, minimum: 4.5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
    ],
  });
  const mismatch = flat(dom.document.getElementById("smart-colors-workbench-left-measure"));
  assert.match(mismatch, /Non applicabile/);
  assert.match(mismatch, /Soglia non canonica per questo tipo: nessun criterio WCAG applicato/);
  assert.doesNotMatch(mismatch, /SC 1\.4\.11|Soglia di confronto/);
});

test("the view factory fails loud when the mandatory controller is missing", () => {
  const dom = workbenchDom(workbenchSession());
  assert.throws(
    () => createContrastWorkbenchView({ document: dom.document, controller: null }),
    /requires the workbench controller/,
  );
});

test("the runtime selection and views drive the radios, the pair select and the panel headings", () => {
  const { dom, controller } = install(workbenchSession());
  const leftTitle = dom.document.getElementById("smart-colors-workbench-left-title");
  const rightTitle = dom.document.getElementById("smart-colors-workbench-right-title");
  // The default comparison is "themes": neutral light/dark titles, not the left/right technical labels.
  assert.equal(leftTitle.textContent, "Tema chiaro");
  assert.equal(rightTitle.textContent, "Tema scuro");
  assert.equal(dom.themeLight.checked, true);
  assert.equal(dom.comparisonThemes.checked, true);

  controller.publish({
    phase: "complete", revision: 1, draft: {}, suggestion: null, error: null,
    selection: { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "dark", comparison: "tuning" },
    views: [
      { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: null, measurements: [], errors: [] },
      { slot: "right", theme: "dark", variant: "tuned", pair: null, measurement: null, measurements: [], errors: [] },
    ],
  });
  assert.equal(dom.themeDark.checked, true);
  assert.equal(dom.themeLight.checked, false);
  assert.equal(dom.comparisonTuning.checked, true);
  assert.equal(dom.comparisonThemes.checked, false);
  assert.equal(dom.pair.value, "--color-primary-text|--color-primary-surface|text");
  assert.equal(dom.pair.options[0].selected, true);
  // A tuned/draft comparison uses the neutral "Attuale"/"Modifica" titles; theme and variant live in the aria-label.
  assert.equal(leftTitle.textContent, "Attuale");
  assert.equal(rightTitle.textContent, "Modifica");
  assert.equal(dom.document.getElementById("smart-colors-workbench-right").getAttribute("aria-label"), "Vista CSS destra · Modifica · tema scuro · con tuning");

  // The runtime switches to `draft` after an edit/apply/suggest: the UI must follow immediately.
  controller.publish({
    phase: "complete", revision: 2, draft: {}, suggestion: null, error: null,
    selection: { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "dark", comparison: "draft" },
    views: [
      { slot: "left", theme: "dark", variant: "tuned", pair: null, measurement: null, measurements: [], errors: [] },
      { slot: "right", theme: "dark", variant: "draft", pair: null, measurement: null, measurements: [], errors: [] },
    ],
  });
  assert.equal(dom.comparisonDraft.checked, true);
  assert.equal(dom.comparisonTuning.checked, false);
  assert.equal(rightTitle.textContent, "Modifica");
  assert.equal(dom.document.getElementById("smart-colors-workbench-right").getAttribute("aria-label"), "Vista CSS destra · Modifica · tema scuro · bozza");
  // Projecting state must never call the runtime back (no loop) and must not move focus.
  assert.equal(controller.calls.select.length, 0);
});

test("the initial render projects the runtime pair over a stale static pair: source, details, controls and views agree", () => {
  // Static build-time prioritisation picks the failing warm pair; the runtime selects the neutral
  // text/canvas pair with target 7. On first render every projected surface must follow the runtime.
  const session = workbenchSession();
  session.design.sources.push({ token: "--palette-warm", name: "warm", role: "decorative", darkBlend: null, darkMix: { mode: "automatic", sourcePercent: null, whitePercent: null } });
  session.design.tokens["--color-warm-ink"] = { sources: ["--palette-warm"], recipe: "ink", usage: "Testo sul riempimento warm", controls: {} };
  session.design.tokens["--color-warm"] = { sources: ["--palette-warm"], recipe: "identity", usage: "Riempimento warm", controls: {} };
  session.paletteSource.sources.push({ token: "--palette-warm", value: "oklch(0.6 0.15 40)", role: "decorative", darkBlend: null, declaration: null });
  session.model.diagnostics = [
    { label: "warm ink / warm", scheme: "light", foregroundToken: "--color-warm-ink", backgroundToken: "--color-warm", ratio: 3, minimum: 4.5, target: 4.6, kind: "text", status: "below-minimum", provenance: "generated" },
    { label: "warm ink / warm", scheme: "dark", foregroundToken: "--color-warm-ink", backgroundToken: "--color-warm", ratio: 5, minimum: 4.5, target: 4.6, kind: "text", status: "pass", provenance: "generated" },
    { label: "text / canvas", scheme: "light", foregroundToken: "--color-text", backgroundToken: "--color-bg", ratio: 12.6, minimum: 4.5, target: 7, kind: "text", status: "pass", provenance: "generated" },
    { label: "text / canvas", scheme: "dark", foregroundToken: "--color-text", backgroundToken: "--color-bg", ratio: 11.2, minimum: 4.5, target: 7, kind: "text", status: "pass", provenance: "generated" },
  ];
  // The static document prioritises the failing warm pair.
  const staticHtml = renderContrastWorkbench(session);
  assert.match(staticHtml, /<option value="--palette-warm" selected>/);
  assert.match(staticHtml, /<option value="--color-warm-ink\|--color-warm\|text" selected/);
  assert.match(staticHtml, /Testo sul riempimento warm/);
  assert.match(staticHtml, /color: var\(--color-warm-ink\)/);

  // Build a DOM already showing the static warm choice, then hand the neutral runtime selection.
  const dom = workbenchDom(session);
  const warmSource = optionOf("--palette-warm", {});
  warmSource.value = "--palette-warm";
  dom.source.appendChild(warmSource);
  const warm = optionOf("--color-warm-ink|--color-warm|text", {
    "data-fg": "--color-warm-ink", "data-bg": "--color-warm", "data-kind": "text",
    "data-usage": "Testo sul riempimento warm", "data-sources": "--palette-warm", "data-thresholds": "4.5,4.6;4.5,4.6",
  });
  dom.pair.appendChild(warm);
  const neutral = dom.pair.options.find((option) => option.value === "--color-text|--color-bg|text");
  neutral.setAttribute("data-thresholds", "4.5,7;4.5,7");
  for (const option of dom.pair.options) option.selected = option === warm;
  dom.pair.value = warm.value;
  dom.source.value = "--palette-warm";

  const controller = controllerStub({
    pairs: () => [{ id: "light|color|--color-text|--color-bg", foreground: "--color-text", background: "--color-bg", property: "color" }],
    state: {
      phase: "complete", revision: 1, draft: {}, suggestion: null, error: null,
      selection: { pairId: "light|color|--color-text|--color-bg", theme: "light", comparison: "themes" },
      views: [
        { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 12.6, minimum: 4.5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
        { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 11.2, minimum: 4.5, target: 7, status: "pass" }, measurements: [{}], errors: [] },
      ],
    },
  });
  createContrastWorkbenchView({ document: dom.document, controller });

  // No button click: the first render itself must agree end to end.
  assert.equal(controller.calls.select.length, 0);
  assert.equal(dom.pair.value, "--color-text|--color-bg|text");
  assert.equal(dom.source.value, "--palette-canvas", "the leftover warm filter is replaced by the active pair source");
  const details = flat(dom.document.getElementById("smart-colors-workbench-details"));
  assert.match(details, /--color-text/);
  assert.match(details, /--color-bg/);
  assert.doesNotMatch(details, /--color-warm/);
  assert.match(details, /color: var\(--color-text\)/);
  assert.match(details, /Target tema chiaro 7,00:1/);
  assert.doesNotMatch(details, /4,60:1/);
  const controls = flat(dom.controlsBody);
  assert.doesNotMatch(controls, /--color-tune-primary-text-light/);
  assert.doesNotMatch(controls, /--color-tune-warm/);
  assert.equal(dom.document.getElementById("smart-colors-workbench-left-title").textContent, "Tema chiaro");
  assert.equal(dom.document.getElementById("smart-colors-workbench-right-title").textContent, "Tema scuro");

  // A user pair change invalidates the previous ratio synchronously: pending details never sit
  // beside the old measurement.
  dom.pair.dispatch("change");
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-left-measure")), /Verifica in corso/);
  assert.doesNotMatch(flat(dom.document.getElementById("smart-colors-workbench-left-measure")), /12,60:1/);
});

test("the pair snippet uses the real CSS property with the padded background wrapper for non-text geometry", () => {
  const border = renderContrastWorkbench(workbenchSession({
    model: { diagnostics: [{ label: "border", scheme: "light", foregroundToken: "--color-primary-border-strong", backgroundToken: "--color-primary-surface", ratio: 2.8, minimum: 3, target: 3, kind: "non-text", status: "below-minimum", provenance: "generated" }], errors: [], warnings: [] },
  }));
  const borderSnippet = snippetOf(border);
  assert.ok(borderSnippet.startsWith("border: 2px solid var(--color-primary-border-strong);"), "the border is never written as color: " + borderSnippet);
  assert.match(borderSnippet, /background-color: var\(--color-primary-surface\);/);
  assert.match(borderSnippet, /padding: 0;/);
  assert.match(borderSnippet, /width: 100%;/);
  assert.match(borderSnippet, /box-sizing: border-box;/);
  assert.match(borderSnippet, /height: 48px;/);
  assert.match(borderSnippet, /Campione vuoto: &lt;div/);
  // The outer border edge lives outside the specimen box: the copied snippet keeps the padded wrapper
  // that paints the measured background around the whole geometry (same as the runtime fix).
  assert.match(borderSnippet, /\.surface \{\n  padding: 12px;\n  background: var\(--color-primary-surface\);\n  border-radius: 8px;\n\}/);
  assert.ok(!/^\s*color:/.test(borderSnippet), "no text declaration leads the border snippet");

  const focus = renderContrastWorkbench(workbenchSession({
    model: { diagnostics: [{ label: "focus", scheme: "light", foregroundToken: "--color-focus-ring", backgroundToken: "--color-bg", ratio: 2.9, minimum: 3, target: 3, kind: "non-text", status: "below-minimum", provenance: "generated" }], errors: [], warnings: [] },
  }));
  const focusSnippet = snippetOf(focus);
  assert.ok(focusSnippet.startsWith("outline: 3px solid var(--color-focus-ring);"), "the ring keeps its own property: " + focusSnippet);
  assert.match(focusSnippet, /outline-offset: 2px;/);
  assert.match(focusSnippet, /background-color: var\(--color-bg\);/);
  assert.match(focusSnippet, /padding: 0;/);
  assert.match(focusSnippet, /width: 100%;/);
  assert.match(focusSnippet, /box-sizing: border-box;/);
  assert.match(focusSnippet, /height: 48px;/);
  assert.match(focusSnippet, /Campione vuoto: &lt;div/);
  assert.match(focusSnippet, /\.surface \{\n  padding: 12px;\n  background: var\(--color-bg\);\n  border-radius: 8px;\n\}/);
  assert.ok(!/^\s*color:/.test(focusSnippet), "no text declaration leads the outline snippet");

  // The runtime-rendered details use the same property mapping and the same padded wrapper.
  const { dom } = install(workbenchSession());
  const option = optionOf("--color-primary-border-strong|--color-primary-surface|non-text", {
    "data-fg": "--color-primary-border-strong", "data-bg": "--color-primary-surface", "data-kind": "non-text",
    "data-usage": "Bordo della card", "data-sources": "--palette-brand", "data-thresholds": "3,3;",
  });
  dom.pair.appendChild(option);
  for (const candidate of dom.pair.options) candidate.selected = candidate === option;
  dom.pair.value = option.value;
  dom.pair.dispatch("change");
  const details = flat(dom.document.getElementById("smart-colors-workbench-details"));
  assert.match(details, /border: 2px solid var\(--color-primary-border-strong\)/);
  assert.match(details, /\.surface/);
  assert.match(details, /padding: 12px/);
  assert.match(details, /background: var\(--color-primary-surface\)/);
  assert.match(details, /padding: 0;/);
  assert.match(details, /width: 100%;/);
  assert.match(details, /box-sizing: border-box;/);
  assert.match(details, /height: 48px;/);
});

test("the exported CSS always follows the current draft and copy never claims an empty copy", () => {
  let tuning = "";
  const { dom, controller } = install(workbenchSession(), controllerStub({ tuning: () => tuning }));
  const exportText = dom.document.getElementById("smart-colors-workbench-export-text");
  const copyExport = dom.document.getElementById("smart-colors-workbench-copy-export");

  controller.publish({
    phase: "complete", revision: 1, suggestion: null, error: null, views: [],
    draft: { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" },
  });
  tuning = ":root { --color-tune-primary-text-light: oklch(0.4 0.1 250); }";
  controller.publish({
    phase: "complete", revision: 2, suggestion: null, error: null, views: [],
    draft: { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" },
  });
  assert.equal(exportText.value, tuning, "the export reflects the current draft, not an earlier one");

  // A newer draft must replace the previously exported text, never leave it stale.
  tuning = ":root { --color-tune-primary-text-light: oklch(0.3 0.1 250); }";
  controller.publish({
    phase: "complete", revision: 3, suggestion: null, error: null, views: [],
    draft: { "--color-tune-primary-text-light": "oklch(0.3 0.1 250)" },
  });
  assert.equal(exportText.value, tuning);

  // No override: the copy action must refuse, not announce a copy of nothing.
  tuning = "";
  controller.publish({ phase: "complete", revision: 4, suggestion: null, error: null, views: [], draft: {} });
  copyExport.dispatch("click");
  assert.match(dom.status.textContent, /Nessun CSS pubblico da copiare/);
  assert.doesNotMatch(dom.status.textContent, /copiato|selezionato/);

  // With content, copy announces a real selection/copy, never an empty one.
  tuning = ":root { --color-tune-primary-text-light: oklch(0.2 0.1 250); }";
  controller.publish({ phase: "complete", revision: 5, suggestion: null, error: null, views: [], draft: { "--color-tune-primary-text-light": "oklch(0.2 0.1 250)" } });
  copyExport.dispatch("click");
  assert.match(dom.status.textContent, /CSS pubblico (copiato|selezionato)/);
});

test("a source choice drives its preferred use and reconciles the pair id with the runtime descriptors", async () => {
  const { dom, controller } = install(workbenchSession());
  // A source is a real choice: it selects the source's own preferred foreground use and compares immediately.
  dom.source.value = "--palette-canvas";
  dom.source.dispatch("change");
  await tick();
  assert.equal(dom.pair.value, "--color-text|--color-bg|text", "the canvas source selects its own measured pair");
  assert.deepEqual(controller.calls.select[0], { pairId: "light|color|--color-text|--color-bg", theme: "light", comparison: "themes" });
  assert.equal(dom.swatchCanvas.getAttribute("aria-pressed"), "true", "the chosen source swatch is pressed");

  controller.calls.select.length = 0;
  dom.source.value = "--palette-brand";
  dom.source.dispatch("change");
  await tick();
  assert.equal(dom.pair.value, "--color-primary-text|--color-primary-surface|text");
  assert.deepEqual(controller.calls.select[0], { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" });

  controller.calls.select.length = 0;
  dom.selection.dispatch("submit");
  await tick();
  assert.equal(controller.calls.select.length, 1);
  assert.deepEqual(controller.calls.select[0], { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" });
});

test("a source swatch selects the source's own preferred foreground use, never a background-only dependency", async () => {
  const { dom, controller } = install(workbenchSession());
  // The primary option lists --palette-canvas only as a background dependency (data-bg-sources),
  // while the canvas option uses it as a foreground source. The canvas swatch must pick the latter.
  dom.swatchCanvas.dispatch("click");
  await tick();
  assert.equal(dom.pair.value, "--color-text|--color-bg|text");
  assert.deepEqual(controller.calls.select[controller.calls.select.length - 1], { pairId: "light|color|--color-text|--color-bg", theme: "light", comparison: "themes" });
  assert.equal(dom.swatchCanvas.getAttribute("aria-pressed"), "true");
});

test("the change-use button opens a modal picker focused on search and closes back to the opener", () => {
  const { dom } = install(workbenchSession());
  assert.equal(dom.openPicker.disabled, false, "the opener is enabled by the view");
  assert.equal(dom.useSearch.disabled, false, "the search is enabled by the view");
  assert.equal(dom.useCategory.disabled, false, "the category is enabled by the view");
  assert.equal(dom.pickerDialog.open, false);
  dom.openPicker.dispatch("click");
  assert.equal(dom.pickerDialog.open, true, "the native modal is open");
  assert.equal(dom.useSearch.focused, true, "opening focuses the search field");
  assert.match(dom.useCount.textContent, /1 uso · pagina 1 di 1/);
  assert.equal(findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]').length, 1);
  dom.closePicker.dispatch("click");
  assert.equal(dom.pickerDialog.open, false);
  assert.equal(dom.openPicker.focused, true, "closing returns focus to the stable opener");
});

test("the picker searches, filters and paginates every real use, then resets only on a source change", async () => {
  const { dom, controller } = install(workbenchSession());
  addUseOptions(dom, 10);
  dom.openPicker.dispatch("click");

  const pageOne = findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]');
  assert.equal(pageOne.length, 6, "a page contains at most six real result buttons");
  assert.match(dom.useCount.textContent, /11 usi · pagina 1 di 2/);
  assert.equal(dom.usePrev.getAttribute("aria-disabled"), "true");
  assert.equal(dom.useNext.getAttribute("aria-disabled"), "false");
  const seen = new Set(pageOne.map((button) => button.getAttribute("data-pair-value")));

  dom.useNext.dispatch("click");
  assert.equal(dom.useSearch.focused, true, "paging never moves focus out of the search field");
  const pageTwo = findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]');
  assert.equal(pageTwo.length, 5);
  assert.match(dom.useCount.textContent, /pagina 2 di 2/);
  for (const button of pageTwo) seen.add(button.getAttribute("data-pair-value"));
  assert.equal(seen.size, 11, "every matching use is reachable across pages");
  dom.useNext.dispatch("click");
  assert.match(dom.useCount.textContent, /pagina 2 di 2/, "the last page does not advance");

  dom.useSearch.value = "extra 9";
  dom.useSearch.dispatch("input");
  const searched = findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]');
  assert.equal(searched.length, 1);
  assert.match(flat(searched[0]), /Uso extra 9/);
  assert.match(dom.useCount.textContent, /1 uso · pagina 1 di 1/);

  dom.useSearch.value = "";
  dom.useSearch.dispatch("input");
  dom.useCategory.value = "border";
  dom.useCategory.dispatch("change");
  assert.equal(findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]').length, 5);
  assert.match(dom.useCount.textContent, /5 usi/);

  // A measurement update with the same source must not reset the user's filters.
  controller.publish({ phase: "complete", revision: 9, draft: {}, error: null, views: [], suggestion: null, selection: { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" } });
  assert.equal(dom.useSearch.value, "", "the search stays as the user set it");
  assert.equal(dom.useCategory.value, "border", "the category stays as the user set it");
  assert.match(dom.useCount.textContent, /5 usi/);

  // A source change resets search, category and page.
  dom.useSearch.value = "extra";
  dom.useSearch.dispatch("input");
  dom.source.value = "--palette-canvas";
  dom.source.dispatch("change");
  assert.equal(dom.useSearch.value, "", "a source change clears the search");
  assert.equal(dom.useCategory.value, "", "a source change clears the category");
  assert.match(dom.useCount.textContent, /1 uso · pagina 1 di 1/);
  await tick();
  assert.ok(controller.calls.select.length >= 1);
});

test("the clear-filters action resets the category filter as well as the query", () => {
  const { dom } = install(workbenchSession());
  addUseOptions(dom, 10);
  dom.openPicker.dispatch("click");
  dom.useCategory.value = "border";
  dom.useCategory.dispatch("change");
  assert.match(dom.useCount.textContent, /5 usi/);
  dom.useClear.dispatch("click");
  assert.equal(dom.useCategory.value, "", "the category select says Tutti gli usi after the reset");
  assert.equal(dom.useSearch.value, "");
  assert.match(dom.useCount.textContent, /11 usi/, "every use is listed again, not only the category subset");
  assert.equal(dom.useSearch.focused, true, "the reset returns focus to the search field");
});

test("the picker matches natural multiword queries in any order, ignoring extra spaces and accents", () => {
  const { dom } = install(workbenchSession());
  addSearchOption(dom, "--color-card-text", "--color-card", "Testo sulla card");
  addSearchOption(dom, "--color-city-text", "--color-city", "Testo sulla città");
  dom.openPicker.dispatch("click");
  function results(query) {
    dom.useSearch.value = query;
    dom.useSearch.dispatch("input");
    return findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]');
  }
  assert.equal(results("testo card").length, 1, "words may span the natural label");
  assert.equal(results("card testo").length, 1, "word order is irrelevant");
  assert.equal(results("  testo   card  ").length, 1, "extra whitespace is ignored");
  assert.equal(results("testo sulla card").length, 1);
  assert.equal(results("--color-card-text --color-card").length, 1, "public fg/bg tokens match all words");
  assert.equal(results("testo nonexistent").length, 0, "an unmatched word yields no results");
  assert.match(dom.useCount.textContent, /Nessun uso corrisponde/);
  assert.equal(results("citta").length, 1, "accents are removed from the query");
  assert.equal(results("città").length, 1);
  assert.equal(results("CITTÀ testo").length, 1, "case and accents are normalized together");
  assert.equal(results("testo").length, 3, "the shared word still matches every text use");
});

test("a known on-color uses the same human label in the picker and current-use summary", () => {
  const controller = controllerStub({ pairs: () => [{ id: "light|color|--color-warm-ink|--color-warm", foreground: "--color-warm-ink", background: "--color-warm", property: "color" }] });
  const { dom } = install(workbenchSession(), controller);
  const warm = optionOf("--color-warm-ink|--color-warm|text", {
    "data-fg": "--color-warm-ink", "data-bg": "--color-warm", "data-kind": "text",
    "data-usage": "--color-warm-ink su --color-warm",
    "data-picker-label": "Testo sul colore Warm",
    "data-sources": "--palette-brand", "data-fg-sources": "--palette-brand", "data-bg-sources": "--palette-brand",
    "data-use-bucket": "page", "data-use-rank": "5", "data-thresholds": "4.5,4.6;4.5,4.6",
  });
  dom.pair.appendChild(warm);
  controller.publish({ phase: "complete", revision: 1, draft: {}, error: null, views: [], suggestion: null, selection: { pairId: "light|color|--color-warm-ink|--color-warm", theme: "light", comparison: "themes" } });
  assert.match(flat(dom.currentUse), /Testo sul colore Warm/);
  assert.doesNotMatch(flat(dom.currentUse), /--color-warm/);
  assert.equal(warm.getAttribute("data-usage"), "--color-warm-ink su --color-warm", "technical metadata is not rewritten by the human label");
  dom.openPicker.dispatch("click");
  const button = findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]').find((node) => node.getAttribute("data-pair-value") === "--color-warm-ink|--color-warm|text");
  assert.ok(button);
  assert.match(flat(button), /Testo sul colore Warm/);
  assert.doesNotMatch(flat(button), /--color-warm-ink/, "the known picker label hides the technical identifier");
  assert.equal(findAllIn(button, "code").length, 0, "the known on-color label has no technical fallback");
  dom.useSearch.value = "colore warm";
  dom.useSearch.dispatch("input");
  assert.equal(findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]').length, 1, "the authoritative picker label is searchable");
});

test("choosing a picker result applies the use, closes the dialog and returns focus to the opener", async () => {
  const { dom, controller } = install(workbenchSession());
  dom.openPicker.dispatch("click");
  const selected = findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]')[0];
  assert.equal(selected.getAttribute("aria-pressed"), "true", "the current use is selected");
  selected.dispatch("click");
  await tick();
  assert.equal(dom.pickerDialog.open, false, "choosing closes the dialog");
  assert.equal(dom.openPicker.focused, true, "focus returns to the stable picker opener");
  assert.equal(controller.calls.select.length, 1);
  assert.equal(dom.pair.value, selected.getAttribute("data-pair-value"));
});

test("an external selection syncs the current-use summary, the technical select and the picker selected state", () => {
  const { dom, controller } = install(workbenchSession());
  controller.publish({ phase: "complete", revision: 2, draft: {}, error: null, views: [], suggestion: null, selection: { pairId: "light|color|--color-text|--color-bg", theme: "light", comparison: "themes" } });
  assert.equal(dom.pair.value, "--color-text|--color-bg|text");
  assert.match(flat(dom.currentUse), /Testo sulla pagina/);
  assert.equal(dom.source.value, "--palette-canvas", "the technical source follows the selected pair");
  dom.openPicker.dispatch("click");
  const selected = findAllIn(dom.usesBox, '[data-smart-colors-workbench="use"]').find((button) => button.getAttribute("data-pair-value") === "--color-text|--color-bg|text");
  assert.ok(selected, "the externally selected use is in the picker");
  assert.equal(selected.getAttribute("aria-pressed"), "true");
});

test("programmatic controller updates never steal focus from the open picker", () => {
  const { dom, controller } = install(workbenchSession());
  dom.openPicker.dispatch("click");
  dom.document.activeElement = dom.useSearch;
  controller.publish({ phase: "complete", revision: 3, draft: {}, error: null, views: [], suggestion: null, selection: { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" } });
  assert.equal(dom.document.activeElement, dom.useSearch);
  assert.equal(dom.openPicker.focused, undefined);
});

test("a source with no verified use clears the result and hides the correction instead of keeping a stale ratio", async () => {
  const { dom, controller } = install(workbenchSession());
  dom.swatchOrphan.dispatch("click");
  await tick();
  assert.equal(dom.emptyNote.hidden, false, "an explicit empty state is shown");
  assert.equal(dom.resultBox.hidden, true, "the previous result is hidden, never kept stale");
  assert.equal(dom.correctionBox.hidden, true, "the correction action is hidden");
  assert.equal(dom.manualBox.hidden, true, "the manual controls are hidden");
  assert.equal(dom.exportBox.hidden, true, "the export controls are hidden");
  assert.equal(controller.calls.select.length, 0, "no measurement is requested for a source with no verified use");
  assert.match(dom.status.textContent, /Nessuna coppia diagnostica/);
  assert.match(dom.emptyNote.textContent, /Nessuna coppia diagnostica/);
});

test("initialization never overrides an existing draft or a non-idle phase", () => {
  const draft = { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" };
  const idle = install(workbenchSession(), controllerStub({ state: { phase: "idle", revision: 0, selection: { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "tuning" }, draft, views: [], suggestion: null, error: null } }));
  assert.equal(idle.controller.calls.select.length, 0, "a preexisting draft is left untouched by initialization");
  const running = install(workbenchSession(), controllerStub({ state: { phase: "running", revision: 1, selection: { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "tuning" }, draft: {}, views: [], suggestion: null, error: null } }));
  assert.equal(running.controller.calls.select.length, 0, "a running measurement is never re-selected by initialization");
});

test("apply stays disabled until a verified suggestion exists", async () => {
  const { dom, controller } = install(workbenchSession());
  const apply = dom.document.getElementById("smart-colors-workbench-apply");
  assert.equal(apply.disabled, true, "no suggestion means apply is gated");
  controller.publish({ phase: "complete", revision: 1, draft: {}, error: null, views: [], suggestion: { status: "none", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 5, after: null, reason: null, checked: 1, unmeasured: 0, regressions: [] } });
  assert.equal(apply.disabled, true, "a non-verified suggestion never enables apply");
  controller.publish({ phase: "complete", revision: 2, draft: {}, error: null, views: [], suggestion: { status: "verified", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 3.1, after: 4.6, reason: null, checked: 1, unmeasured: 0, regressions: [] } });
  assert.equal(apply.disabled, false, "only a verified suggestion enables apply");
});

test("apply keeps focus near the proposal and never sends it to the header export", async () => {
  const { dom, controller } = install(workbenchSession());
  const apply = dom.document.getElementById("smart-colors-workbench-apply");
  const exportButton = dom.document.getElementById("smart-colors-workbench-export");
  const suggest = dom.document.getElementById("smart-colors-workbench-suggest-foreground");
  const suggestion = { status: "verified", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 3.1, after: 4.6, checked: 1, unmeasured: 0, regressions: [] };
  // The real runtime publishes the applied override with the successful apply. Mirror that here so
  // the shell export command is enabled exactly as it is after a genuine apply.
  controller.applySuggestion = () => {
    controller.publish({ ...controller.state(), revision: Number(controller.state().revision || 0) + 1, draft: { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" }, suggestion: null });
    return Promise.resolve();
  };

  // A programmatic publish never moves focus away from the user's current control.
  dom.document.activeElement = dom.themeDark;
  controller.publish({ phase: "complete", revision: 1, draft: {}, error: null, views: [], suggestion });
  assert.equal(exportButton.focused, undefined);
  assert.equal(suggest.focused, undefined);
  assert.equal(dom.document.activeElement, dom.themeDark);

  // An explicit apply keeps focus in the correction context, never on the header export.
  dom.document.activeElement = apply;
  apply.dispatch("click");
  await tick();
  assert.equal(exportButton.focused, undefined, "apply never jumps to the header export");
  assert.equal(suggest.focused, true, "the visible correction action keeps the user in context");

  // A user who moved focus during the action keeps it.
  exportButton.focused = false;
  controller.publish({ phase: "complete", revision: 2, draft: {}, error: null, views: [], suggestion });
  dom.document.activeElement = dom.themeDark;
  apply.dispatch("click");
  await tick();
  assert.equal(exportButton.focused, false, "focus is never stolen when it moved elsewhere");
});

test("apply keeps focus on the proposal action while it is still available", async () => {
  const { dom, controller } = install(workbenchSession());
  const apply = dom.document.getElementById("smart-colors-workbench-apply");
  const exportButton = dom.document.getElementById("smart-colors-workbench-export");
  const suggestion = { status: "verified", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 3.1, after: 4.6, checked: 1, unmeasured: 0, regressions: [] };
  controller.applySuggestion = () => { controller.publish({ ...controller.state(), revision: 2, draft: { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" }, suggestion }); return Promise.resolve(); };
  controller.publish({ phase: "complete", revision: 1, draft: {}, removed: [], suggestion, error: null, views: [] });
  dom.document.activeElement = apply;
  apply.dispatch("click");
  await tick();
  assert.equal(apply.focused, true, "the still-available proposal action keeps focus");
  assert.equal(exportButton.focused, undefined, "the header export is not focused without a request");
});

test("apply focus falls back to a visible correction action when the proposal action disappears", async () => {
  const { dom, controller } = install(workbenchSession());
  const apply = dom.document.getElementById("smart-colors-workbench-apply");
  const suggest = dom.document.getElementById("smart-colors-workbench-suggest-foreground");
  controller.applySuggestion = () => {
    controller.publish({ ...controller.state(), revision: 2, draft: { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" }, suggestion: null });
    return Promise.resolve();
  };
  apply.hidden = true;
  controller.publish({
    phase: "complete", revision: 1, draft: {}, error: null, views: [],
    suggestion: { status: "verified", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 3.1, after: 4.6, checked: 1, unmeasured: 0, regressions: [] },
  });
  dom.document.activeElement = apply;
  apply.dispatch("click");
  await tick();
  assert.equal(suggest.focused, true, "the visible correction action is the stable fallback");
});

test("a below-target status none keeps the project target unmet and never says no change is needed", () => {
  const { dom, controller } = install(workbenchSession());
  const textOption = dom.pair.options.find((option) => option.value === "--color-text|--color-bg|text");
  textOption.setAttribute("data-thresholds", "4.5,7;4.5,7");
  for (const option of dom.pair.options) option.selected = option === textOption;
  dom.pair.value = textOption.value;
  const selection = { pairId: "light|color|--color-text|--color-bg", theme: "light", comparison: "themes" };
  controller.publish({
    phase: "complete", revision: 3, draft: {}, error: null, selection, views: [],
    suggestion: { status: "none", side: "foreground", token: "--color-text", control: "--color-tune-primary-text-light", value: null, before: 4.8, after: 4.8, reason: "the selected pair is not below its WCAG minimum", checked: 1, unmeasured: 0, regressions: [] },
  });
  const text = flat(dom.proposal);
  assert.match(text, /Minimo già raggiunto/);
  assert.match(text, /Target del progetto 7,00:1 non raggiunto\. Questa ricerca corregge solo il minimo 4,50:1\./);
  assert.match(text, /Prima: 4,80:1/);
  assert.doesNotMatch(text, /Soglia rilevante/, "the none result already states both thresholds without repeating them");
  assert.doesNotMatch(text, /non serve una modifica/);
  assert.doesNotMatch(text, /se non è raggiunto, resta non raggiunto/);
  assert.doesNotMatch(text, /Valore proposto:/);
  assert.equal(dom.document.getElementById("smart-colors-workbench-apply").disabled, true);

  // The same result states a reached target explicitly, and an unknown ratio fails closed.
  textOption.setAttribute("data-thresholds", "4.5,4.6;4.5,4.6");
  controller.publish({
    phase: "complete", revision: 4, draft: {}, error: null, selection, views: [],
    suggestion: { status: "none", side: "foreground", token: "--color-text", control: "--color-tune-primary-text-light", value: null, before: 4.8, after: 4.8, reason: "already above minimum", checked: 1, unmeasured: 0, regressions: [] },
  });
  assert.match(flat(dom.proposal), /Target del progetto 4,60:1 raggiunto\. Questa ricerca corregge solo il minimo 4,50:1\./);
  textOption.setAttribute("data-thresholds", "4.5,7;4.5,7");
  controller.publish({
    phase: "complete", revision: 5, draft: {}, error: null, selection, views: [],
    suggestion: { status: "none", side: "foreground", token: "--color-text", control: "--color-tune-primary-text-light", value: null, before: null, after: null, reason: "already above minimum", checked: 1, unmeasured: 0, regressions: [] },
  });
  assert.match(flat(dom.proposal), /Target del progetto non verificabile con questa misura\. Questa ricerca corregge solo il minimo 4,50:1\./);
});

test("tuning comparisons are refused when the snapshot has no supported tuning", async () => {
  const session = workbenchSession({ css: { baseline: ":root{}", tuning: null, tuningSupport: "absent", source: "output", status: "current", baselineSupport: "supported" } });
  const { dom, controller } = install(session);
  dom.comparisonTuning.checked = true;
  dom.comparisonThemes.checked = false;
  dom.selection.dispatch("submit");
  await tick();
  assert.equal(controller.calls.select.length, 0);
  assert.match(dom.status.textContent, /Confronto non disponibile/);
});

test("controls apply the public override through the runtime API, with the mix value as a percentage", async () => {
  const { dom, controller } = install(workbenchSession());
  // Default theme light renders the override controls only.
  assert.equal(dom.controlsBody.children.length, 2);
  // Dark declares a mix for the primary text token.
  dom.themeLight.checked = false;
  dom.themeDark.checked = true;
  dom.themeDark.dispatch("change");
  const mix = findAllIn(dom.controlsBody, '[data-kind="mix"]');
  assert.equal(mix.length, 1);
  assert.equal(mix[0].value, "", "the declared mix default is a placeholder, not an active value");
  assert.equal(mix[0].placeholder, "78");
  mix[0].value = "12";
  mix[0].dispatch("input");
  dom.controlsForm.dispatch("submit");
  await tick();
  assert.deepEqual(controller.calls.setOverride, [["--color-tune-primary-text-dark-mix", "12%"]]);
});

test("a foreground-only edit never submits the pre-filled mix default", async () => {
  const session = workbenchSession();
  session.design.tokens["--color-primary-text"].controls.light = {
    override: "--color-tune-primary-text-light",
    mix: "--color-tune-primary-text-light-mix",
    defaultMix: 0.1,
  };
  const { dom, controller } = install(session);
  const overrides = findAllIn(dom.controlsBody, '[data-kind="override"]');
  const mixes = findAllIn(dom.controlsBody, '[data-kind="mix"]');
  assert.equal(overrides.length, 2);
  assert.equal(mixes.length, 1);
  assert.equal(mixes[0].value, "");
  assert.equal(mixes[0].placeholder, "10");
  overrides[0].value = "oklch(0.4 0.1 250)";
  overrides[0].dispatch("input");
  dom.controlsForm.dispatch("submit");
  await tick();
  assert.deepEqual(controller.calls.setOverride, [["--color-tune-primary-text-light", "oklch(0.4 0.1 250)"]]);
  assert.ok(!controller.calls.setOverride.some(([control]) => /-mix$/.test(control)), "the untouched 10% mix must stay out of the export");
});

test("an untouched saved draft mix is preserved and not re-sent; an explicit edit sends only that control", async () => {
  const session = workbenchSession();
  session.design.tokens["--color-primary-text"].controls.light = {
    override: "--color-tune-primary-text-light",
    mix: "--color-tune-primary-text-light-mix",
    defaultMix: 0.1,
  };
  const { dom, controller } = install(session);
  controller.publish({ phase: "complete", revision: 1, suggestion: null, error: null, views: [], draft: { "--color-tune-primary-text-light-mix": "37%" } });
  const mixes = findAllIn(dom.controlsBody, '[data-kind="mix"]');
  assert.equal(mixes[0].value, "37", "the saved draft is reflected in the control");
  dom.controlsForm.dispatch("submit");
  await tick();
  assert.equal(controller.calls.setOverride.length, 0, "an untouched saved value is not re-sent");
  mixes[0].value = "42";
  mixes[0].dispatch("input");
  dom.controlsForm.dispatch("submit");
  await tick();
  assert.deepEqual(controller.calls.setOverride, [["--color-tune-primary-text-light-mix", "42%"]]);
});

test("reset per pair calls reset(control) for each public control and reset-all clears the form", async () => {
  const { dom, controller } = install(workbenchSession());
  dom.themeDark.checked = true;
  dom.themeDark.dispatch("change");
  dom.document.getElementById("smart-colors-workbench-reset-pair").dispatch("click");
  await tick();
  const controls = controller.calls.reset.filter((value) => typeof value === "string");
  assert.ok(controls.includes("--color-tune-primary-text-dark-mix"));
  dom.document.getElementById("smart-colors-workbench-reset-all").dispatch("click");
  await tick();
  assert.ok(controller.calls.reset.some((value) => value === undefined));
});

test("suggestions expose verified and rejected states and apply only the verified proposal", async () => {
  const { dom, controller } = install(workbenchSession());
  dom.document.getElementById("smart-colors-workbench-suggest-background").dispatch("click");
  await tick();
  assert.deepEqual(controller.calls.suggest, ["background"]);

  controller.publish({
    phase: "complete", revision: 1, draft: {}, error: null,
    suggestion: { status: "verified", side: "foreground", token: "--color-primary-text", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: "oklch(0.5 0.1 250)", after: "oklch(0.4 0.1 250)", reason: null, checked: 4, unmeasured: 1, regressions: [] },
    views: [],
  });
  assert.match(flat(dom.proposal), /Proposta verificata/);
  assert.match(flat(dom.proposal), /Controlli eseguiti: 4 · non misurati: 1/);
  const apply = dom.document.getElementById("smart-colors-workbench-apply");
  assert.equal(apply.disabled, false);
  apply.dispatch("click");
  await tick();
  assert.equal(controller.calls.apply.length, 1);

  controller.publish({
    phase: "complete", revision: 2, draft: {}, error: null, views: [],
    suggestion: { status: "regression", side: "background", control: "--color-tune-primary-surface-light", reason: "introduce un sotto-minimo", checked: 3, unmeasured: 0, regressions: ["primary / canvas"] },
  });
  assert.match(flat(dom.proposal), /Proposta scartata per regressioni/);
  assert.match(flat(dom.proposal), /Regressioni: primary \/ canvas/);
  assert.equal(apply.disabled, true);
});

test("a verified suggestion shows the proposed value, ratio thresholds, delta L and real proposal frames", () => {
  const { dom, controller } = install(workbenchSession());
  const selection = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "tuning" };
  controller.publish({
    phase: "complete", revision: 3, draft: {}, error: null, selection, views: [],
    suggestion: {
      status: "verified", side: "foreground", token: "--color-primary-text", control: "--color-tune-primary-text-light",
      value: "oklch(0.4 0.1 250)", before: 3.1, after: 4.62,
      reason: "Verified on the embedded CSS bytes, both themes and 6 contract pairs.",
      checked: 6, unmeasured: 0, regressions: [], authored: null, deltaL: -0.1, gamutAdjusted: true, revision: 3,
      scope: { affectedTheme: "light", measuredThemes: ["light", "dark"], unchangedThemes: ["dark"], note: "other theme is re-measured for collateral changes" },
    },
  });
  const text = flat(dom.proposal);
  assert.match(text, /Valore proposto:/);
  assert.match(text, /oklch\(0\.4 0\.1 250\)/);
  assert.match(text, /controllo --color-tune-primary-text-light · token --color-primary-text · lato primo piano/);
  assert.match(text, /Prima: 3,10:1 · Dopo: 4,62:1/);
  assert.match(text, /Soglia rilevante: minimo 4,50:1 · target 4,60:1/);
  assert.match(text, /ΔL −0,10/);
  assert.match(text, /Il fit di gamut ha ridotto il chroma: hue resta l'intento, ma non è garantito identico/);
  assert.match(text, /Controlli eseguiti: 6 · non misurati: 0/);
  assert.match(text, /Ambito: tema chiaro modificato · temi misurati: chiaro, scuro/);
  assert.match(text, /Verified on the embedded CSS bytes/, "the technical reason stays available in the details");
  assert.equal(dom.proposalFrames.hidden, false, "the verified proposal exposes the real-frame section");
  assert.equal(dom.proposalBefore.children.length, 0, "the factory never paints the runtime frames");
  assert.equal(dom.proposalAfter.children.length, 0, "the factory never paints the runtime frames");
  assert.equal(dom.document.getElementById("smart-colors-workbench-apply").disabled, false);

  controller.publish({
    phase: "complete", revision: 4, draft: {}, error: null, selection, views: [],
    suggestion: {
      status: "regression", side: "background", token: "--color-primary-surface", control: "--color-tune-primary-surface-light",
      value: "oklch(0.7 0.1 250)", before: 4.5, after: 3.9, reason: "regression on another pair",
      checked: 6, unmeasured: 0, deltaL: 0.08, gamutAdjusted: false,
      regressions: [{ pairId: "light|color|--color-text|--color-bg", theme: "light", label: "Testo su canvas", before: 4.5, after: 3.9, reason: "below-minimum" }],
      scope: { affectedTheme: "light", measuredThemes: ["light", "dark"], unchangedThemes: ["dark"] },
    },
  });
  const rejected = flat(dom.proposal);
  assert.match(rejected, /Proposta scartata per regressioni/);
  assert.match(rejected, /Candidato scartato:/);
  assert.match(rejected, /Regressioni: Testo su canvas \(tema chiaro\): 4,50:1 → 3,90:1/);
  assert.match(rejected, /Nessun aggiustamento di gamut applicato/);
  assert.equal(dom.proposalFrames.hidden, true, "no verified proposal means no proposal frames");
  assert.equal(dom.proposalBefore.children.length, 0);
  assert.equal(dom.proposalAfter.children.length, 0);
  assert.equal(dom.document.getElementById("smart-colors-workbench-apply").disabled, true);

  controller.publish({
    phase: "complete", revision: 5, draft: {}, error: null, selection, views: [],
    suggestion: { status: "none", side: "foreground", token: "--color-primary-text", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 4.8, after: null, reason: "already above minimum", checked: 6, unmeasured: 0, regressions: [] },
  });
  assert.match(flat(dom.proposal), /Minimo già raggiunto/);
  assert.match(flat(dom.proposal), /Target del progetto 4,60:1 raggiunto\. Questa ricerca corregge solo il minimo 4,50:1\./);
  assert.doesNotMatch(flat(dom.proposal), /non serve una modifica/);
  assert.doesNotMatch(flat(dom.proposal), /se non è raggiunto, resta non raggiunto/);
  assert.doesNotMatch(flat(dom.proposal), /Valore proposto:/, "a non-verified result is never presented as a proposal");
  assert.equal(dom.proposalFrames.hidden, true);
});

test("details keep source, declared role and initial recipe after a runtime refresh", () => {
  const { dom, controller } = install(workbenchSession());
  const selection = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "dark", comparison: "tuning" };
  controller.publish({ phase: "complete", revision: 1, draft: {}, suggestion: null, error: null, selection, views: [] });
  const first = flat(dom.document.getElementById("smart-colors-workbench-details"));
  assert.match(first, /Sorgenti: --palette-brand \(nome brand · ruolo dichiarato: interfaccia\)/);
  assert.match(first, /Ricetta iniziale del generatore: text \(contrast\)/);
  assert.match(first, /Ricetta iniziale del generatore: surface \(mix\)/);
  assert.match(first, /--color-tune-primary-text-dark-mix · mix superficie \(default 78%\)/);
  assert.match(first, /Nessun override in bozza/);

  controller.publish({ phase: "complete", revision: 2, draft: { "--color-tune-primary-text-dark-mix": "20%" }, suggestion: null, error: null, selection, views: [] });
  const second = flat(dom.document.getElementById("smart-colors-workbench-details"));
  assert.match(second, /Sorgenti: --palette-brand \(nome brand · ruolo dichiarato: interfaccia\)/, "the source binding survives the refresh");
  assert.match(second, /Ricetta iniziale del generatore: text \(contrast\)/, "the recipe survives the refresh");
  assert.match(second, /Bozza attiva: --color-tune-primary-text-dark-mix/);
});

test("export removes href and download again when the runtime has no CSS", async () => {
  let file = { css: ":root { --a: 1; }", mode: "complete", warnings: [], removed: [], unmatched: [] };
  const { dom } = install(workbenchSession(), controllerStub({ exportTuningFile: () => file }));
  const download = dom.document.getElementById("smart-colors-workbench-download");
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(download.download, "colors-tuning.css");
  assert.ok(download.href.startsWith("data:text/css;charset=utf-8,"));

  file = { css: ":root { --a: 2; }", mode: "fragment", warnings: [], removed: [], unmatched: [] };
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(download.download, "colors-tuning.patch.css");
  assert.ok(download.href.startsWith("data:text/css;charset=utf-8,"));

  download.setAttribute("href", "data:text/css;charset=utf-8,stale");
  download.setAttribute("download", "colors-tuning.css");
  file = { css: "", mode: "unavailable", warnings: [], removed: [], unmatched: [] };
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(download.hidden, true);
  assert.equal(download.getAttribute("href"), null, "an empty export never leaves a placeholder href");
  assert.equal(download.getAttribute("download"), null, "an empty export never leaves download without href");
});

test("export writes the runtime tuning into a selectable textarea with a manual data-URI download", async () => {
  const tuning = ":root { --color-tune-primary-text-light: oklch(0.4 0.1 250); }";
  const { dom } = install(workbenchSession(), controllerStub({ tuning }));
  assert.equal(dom.exportBox.open, false, "the export disclosure starts closed");
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(dom.exportBox.open, true, "the shell export command opens the export disclosure");
  const text = dom.document.getElementById("smart-colors-workbench-export-text");
  const download = dom.document.getElementById("smart-colors-workbench-download");
  assert.equal(text.value, tuning);
  assert.equal(download.hidden, false);
  assert.ok(download.href.startsWith("data:text/css;charset=utf-8,"));
  assert.ok(decodeURIComponent(download.href.split(",")[1]).includes("--color-tune-primary-text-light"));
});

test("the shell session status stays a local preview and names unapplied proposals or unsaved drafts", () => {
  const { dom, controller } = install(workbenchSession());
  assert.equal(dom.sessionStatus.textContent, "Anteprima locale");

  controller.publish({
    phase: "complete", revision: 1, draft: {}, error: null, views: [],
    suggestion: { status: "verified", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 3.1, after: 4.6, checked: 1, unmeasured: 0, regressions: [] },
  });
  assert.match(dom.sessionStatus.textContent, /^Anteprima locale · proposta verificata in attesa$/);

  controller.publish({ phase: "complete", revision: 2, draft: { "--color-tune-primary-text-light": "oklch(0.3 0.1 250)" }, error: null, views: [], suggestion: null });
  assert.match(dom.sessionStatus.textContent, /^Anteprima locale · 1 modifica in bozza non salvata$/);

  controller.publish({ phase: "running", revision: 3, draft: {}, error: null, views: [], suggestion: null });
  assert.equal(dom.sessionStatus.textContent, "Anteprima locale · verifica in corso");

  controller.publish({ phase: "idle", revision: 4, draft: {}, error: null, views: [], suggestion: null });
  assert.equal(dom.sessionStatus.textContent, "Anteprima locale");
});

test("the session badge never invents a pending proposal for none, unavailable or regression outcomes", () => {
  const { dom, controller } = install(workbenchSession());
  for (const [status, expected] of [["none", "minimo già raggiunto"], ["unavailable", "ricerca non disponibile"], ["regression", "candidato scartato"]]) {
    controller.publish({ phase: "complete", revision: 1, draft: {}, error: null, views: [], suggestion: { status, side: "foreground" } });
    assert.equal(dom.sessionStatus.textContent, "Anteprima locale · " + expected);
    assert.equal(dom.document.getElementById("smart-colors-workbench-apply").hidden, true);
  }
  controller.publish({ phase: "complete", revision: 2, draft: { "--color-tune-primary-text-light": "oklch(0.3 0.1 250)" }, error: null, views: [], suggestion: { status: "none", side: "foreground" } });
  assert.equal(dom.sessionStatus.textContent, "Anteprima locale · 1 modifica in bozza non salvata · minimo già raggiunto");
});

test("all-sources recovery restores the header export without needing a new measurement", async () => {
  const { dom, controller } = install(workbenchSession());
  const draft = { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" };
  controller.publish({ phase: "complete", revision: 1, draft, error: null, views: [], suggestion: { status: "verified", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)" } });
  dom.swatchOrphan.dispatch("click");
  await tick();
  assert.equal(dom.document.getElementById("smart-colors-workbench-export").disabled, true);
  assert.equal(dom.sessionStatus.textContent, "Anteprima locale · selezione non disponibile");
  dom.source.value = "";
  dom.source.dispatch("change");
  await tick();
  assert.equal(dom.exportBox.hidden, false);
  assert.equal(dom.document.getElementById("smart-colors-workbench-export").disabled, false);
  assert.equal(dom.sessionStatus.textContent, "Anteprima locale · proposta verificata in attesa");
  assert.deepEqual(controller.state().draft, draft);
  assert.equal(controller.calls.select.length, 0, "recovery is a presentation change, not a new measurement");
});

test("Scarta proposta discards only the suggestion and never resets public overrides", async () => {
  const { dom, controller } = install(workbenchSession());
  assert.equal(dom.discard.hidden, true, "no suggestion means no discard control");
  assert.equal(dom.discard.disabled, true, "the hidden discard control is never actionable");

  controller.publish({
    phase: "complete", revision: 1, draft: { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" }, error: null, views: [],
    suggestion: { status: "verified", side: "foreground", control: "--color-tune-primary-text-light", value: "oklch(0.4 0.1 250)", before: 3.1, after: 4.6, checked: 1, unmeasured: 0, regressions: [] },
  });
  assert.equal(dom.discard.hidden, false, "an existing suggestion exposes the discard action");
  assert.equal(dom.discard.disabled, false);

  dom.document.activeElement = dom.discard;
  dom.discard.dispatch("click");
  await tick();
  assert.equal(controller.calls.discard.length, 1, "discard calls the dedicated runtime method");
  assert.equal(controller.calls.reset.length, 0, "discarding a proposal is not a tuning reset");
  assert.equal(dom.discard.hidden, true, "the discard action disappears with the suggestion");
  assert.match(dom.status.textContent, /Proposta scartata/);
  assert.match(dom.sessionStatus.textContent, /modifica in bozza non salvata/, "saved overrides survive the discard");
  assert.equal(dom.document.getElementById("smart-colors-workbench-suggest-foreground").focused, true, "focus moves to the stable correction action");
});

test("destroy unsubscribes and tears the controller down", () => {
  const { controller, view } = install(workbenchSession());
  view.destroy();
  assert.equal(controller.calls.unsubscribed, true);
  assert.equal(controller.calls.destroy, 1);
});

// --- Opt-in narrow-viewport native smoke --------------------------------------

// Resolve the already-installed Playwright from the workspace root. A missing resolution is a
// BLOCKED failure, never a silent skip, exactly like the other browser proofs.
function resolvePlaywright() {
  const base = createRequire(path.join(WORKSPACE_ROOT, "package.json"));
  for (const request of ["@playwright/test", "playwright"]) {
    let api;
    try { api = base(request); } catch { continue; }
    const browsers = api && api.chromium ? api : api && api.default ? api.default : null;
    if (browsers && browsers.chromium) return browsers;
  }
  throw new Error("BLOCKED: Playwright is not resolvable from the workspace root " + WORKSPACE_ROOT + "; the opted-in narrow-viewport smoke cannot be skipped.");
}

// A palette plus a saved tuning knob that drops `--color-text` below 4.5, so the real runtime
// produces a verified foreground suggestion. Generated into a temporary consumer project only.
const NARROW_PALETTE = [
  '@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.97 0.005 250); role: canvas; }',
  '@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.28 0.01 250); role: ink; }',
  '@property --palette-brand { syntax: "<color>"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; }',
  "",
].join("\n");
const NARROW_TUNING = ":root {\n  --color-tune-text-light: oklch(0.66 0 0);\n}\n";

test("a frozen controller without the additive APIs keeps the legacy fragment and disables L instead of failing", () => {
  const legacy = controllerStub({ tuning: () => ":root { --legacy: 1; }" });
  delete legacy.setLightness;
  delete legacy.removeOverride;
  delete legacy.exportTuningFile;
  delete legacy.explorationPairs;
  delete legacy.measureExploration;
  const { dom } = install(workbenchSession(), legacy);
  assert.equal(dom.explorationBox.hidden, true, "the optional exploration disclosure stays hidden");
  const lightness = findAllIn(dom.controlsBody, '[data-kind="lightness"]');
  assert.ok(lightness.length > 0 && lightness.every((node) => node.disabled), "L inputs stay labelled but disabled");
  assert.doesNotMatch(flat(dom.controlsBody), /Rimuovi personalizzazione/);
  assert.match(flat(dom.controlsBody), /Rimozione della personalizzazione salvata non disponibile/);
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(dom.document.getElementById("smart-colors-workbench-download").download, "colors-tuning.patch.css");
  assert.match(dom.document.getElementById("smart-colors-workbench-export-text").value, /--legacy: 1/);
});

test("the static overview is a bounded semantic matrix with scoped headers and explicit snapshot/live separation", () => {
  const html = renderContrastWorkbench(workbenchSession());
  assert.match(html, /<details class="wb-overview" data-smart-colors-workbench="overview"/);
  assert.match(html, /<summary id="smart-colors-workbench-overview-title" class="wb-overview-summary">Abbinamenti e filtri <span id="smart-colors-workbench-overview-scope" class="wb-overview-scope">Tutti gli abbinamenti<\/span><\/summary>/);
  assert.match(html, /<table class="wb-matrix">/);
  assert.match(html, /<caption id="smart-colors-workbench-matrix-caption">/);
  assert.match(html, /<th scope="col" class="wb-matrix-uso">Uso e criterio<\/th>/);
  assert.match(html, /<th scope="col" id="smart-colors-workbench-matrix-a" class="wb-matrix-view">/);
  assert.match(html, /<th scope="col" id="smart-colors-workbench-matrix-b" class="wb-matrix-view">/);
  assert.match(html, /<th scope="row" class="wb-matrix-uso">/);
  assert.match(html, /data-smart-colors-workbench="matrix-inspect"[^>]*disabled>Ispeziona<span class="wb-visually-hidden">/);
  assert.match(html, /Misure live quando disponibili; altrimenti stime di build etichettate\./);
  assert.match(html, /stime di build/);
  assert.match(html, /<label for="smart-colors-workbench-matrix-search">Cerca un abbinamento<\/label>/);
  assert.match(html, /<label for="smart-colors-workbench-matrix-filter">Filtra per esito<\/label>/);
  assert.match(html, /<label class="wb-scope-toggle"><input id="smart-colors-workbench-matrix-all"[^>]*type="checkbox" checked disabled> Tutti gli abbinamenti<\/label>/, "the wrapping label needs no redundant for");
  assert.match(html, /data-smart-colors-workbench="matrix-empty" hidden><td colspan="3">Nessun abbinamento corrisponde alla selezione corrente\.<\/td><\/tr>/, "an explicit empty row exists instead of a blank table");
  assert.match(html, /<noscript><p class="wb-snapshot-note">Senza JavaScript la matrice mostra solo le prime stime di build, non le misure live\.<\/p><\/noscript>/);
  assert.match(html, /<details class="is-detail wb-matrix-help"><summary>Come leggere la matrice<\/summary>/);
  // The static no-JS L controls already use the same reachable step as the hydrated ones.
  assert.match(html, /data-kind="lightness" type="range" min="0" max="100" step="0\.1"/);
  assert.match(html, /data-kind="lightness" type="number" min="0" max="100" step="any"/);
  assert.doesNotMatch(html, /type="(range|number)"[^>]*step="0\.5"/, "a 0.5 step would reject a real 49.6 L");
  assert.doesNotMatch(html, /Contrasto sufficiente|Contrasto insufficiente/, "the matrix never uses a universal pass/fail badge");
  assert.doesNotMatch(html, /<span class="wb-matrix-status" data-status="[^"]*">[^<]*AAA/, "no universal AAA badge in the matrix");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-matrix-scroll \{[^}]*max-block-size: 24rem;[^}]*overflow: auto;/, "the matrix is a bounded local scroll");
  assert.match(CONTRAST_WORKBENCH_CSS, /@container wb-shell \(min-width: 64rem\)/, "desktop overview + inspector is container-driven");
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /min-inline-size: 38rem/, "the matrix no longer forces a 38rem table");
  assert.match(CONTRAST_WORKBENCH_CSS, /@container wb-shell \(max-width: 48rem\)/, "narrow containers keep the three columns adaptive");
  const rows = html.match(/<tr data-smart-colors-workbench="matrix-row"/g) ?? [];
  const rowHeaders = html.match(/<th scope="row" class="wb-matrix-uso">/g) ?? [];
  assert.ok(rows.length >= 2);
  assert.equal(rowHeaders.length, rows.length, "every matrix row has its own row header");
  assert.match(html, /<details class="is-detail wb-advanced"[^>]*\bopen\b/, "only the manual L disclosure opens by default");
});

test("the matrix uses one roving tab stop, filters real rows and selects a pair", async () => {
  const { dom, controller } = install(workbenchSession());
  const primary = matrixRowByValue(dom, "--color-primary-text|--color-primary-surface|text");
  const textRow = matrixRowByValue(dom, "--color-text|--color-bg|text");
  assert.equal(primary.button.disabled, false, "the factory enables the real matrix buttons");
  // The active source scopes the catalogue before any user filter runs.
  assert.equal(primary.row.hidden, false, "the selected source's pair is visible");
  assert.equal(textRow.row.hidden, true, "an unrelated source's pair is not in the default scope");
  assert.equal(dom.matrixAll.checked, false, "a selected source starts scoped");
  assert.match(flat(dom.matrixCount), /1 abbinamento per Brand/);
  assert.match(flat(dom.overviewScope), /Brand/);
  const zero = findAllIn(dom.overviewBox, '[data-smart-colors-workbench="matrix-inspect"]').filter((button) => button.getAttribute("tabindex") === "0");
  assert.equal(zero.length, 1, "only one matrix row owns the tab stop");
  assert.equal(zero[0], primary.button, "the selected row owns the tab stop");

  // The explicit control widens the catalogue back to every pair.
  dom.matrixAll.checked = true;
  dom.matrixAll.dispatch("change");
  assert.equal(textRow.row.hidden, false, "Tutti gli abbinamenti shows the full catalogue");

  dom.matrixSearch.value = "pagina";
  dom.matrixSearch.dispatch("input");
  assert.equal(primary.row.hidden, true, "a non-matching row is hidden");
  assert.equal(textRow.row.hidden, false, "the matching row stays visible");
  assert.equal(textRow.button.getAttribute("tabindex"), "0", "the visible row receives the tab stop");
  assert.match(flat(dom.matrixCount), /1 abbinamento visibile su 2/);

  textRow.button.dispatch("click");
  await tick();
  assert.equal(dom.pair.value, "--color-text|--color-bg|text");
  assert.deepEqual(controller.calls.select[0], { pairId: "light|color|--color-text|--color-bg", theme: "light", comparison: "themes" });

  dom.matrixClear.dispatch("click");
  assert.equal(primary.row.hidden, false);
  dom.matrixFilter.value = "unmeasured";
  dom.matrixFilter.dispatch("change");
  assert.equal(primary.row.hidden, true, "a row with a measured theme is not listed as unmeasured");
  assert.equal(textRow.row.hidden, false, "a row with an unmeasured theme is listed");
  dom.matrixFilter.value = "pass";
  dom.matrixFilter.dispatch("change");
  assert.equal(primary.row.hidden, true, "pass requires both themes, never a single pass");
  assert.equal(textRow.row.hidden, true);
  dom.matrixClear.dispatch("click");
  primary.button.dispatch("keydown", { key: "ArrowDown", preventDefault() {} });
  assert.equal(textRow.button.focused, true, "arrow keys move focus without selecting");
  assert.equal(textRow.button.getAttribute("tabindex"), "0");
});

test("a new source restores the scoped catalogue and the all-pairs control remains explicit", async () => {
  const { dom } = install(workbenchSession());
  const primary = matrixRowByValue(dom, "--color-primary-text|--color-primary-surface|text");
  const textRow = matrixRowByValue(dom, "--color-text|--color-bg|text");
  dom.matrixAll.checked = true;
  dom.matrixAll.dispatch("change");
  assert.equal(textRow.row.hidden, false);
  dom.swatchCanvas.dispatch("click");
  await tick();
  assert.equal(dom.source.value, "--palette-canvas");
  assert.equal(dom.matrixAll.checked, false, "selecting a new source restores scoped mode");
  assert.equal(textRow.row.hidden, false, "the canvas pair is in the canvas scope");
  assert.equal(primary.row.hidden, true, "the brand pair leaves the canvas scope");
  assert.match(flat(dom.matrixCount), /per Canvas/);
  assert.match(flat(dom.overviewScope), /Canvas/);
  // Clearing the source has nothing to scope; the catalogue is all-pairs again.
  dom.source.value = "";
  dom.source.dispatch("change");
  assert.equal(dom.matrixAll.checked, true);
  assert.equal(dom.matrixAll.disabled, true);
  assert.equal(textRow.row.hidden, false);
  assert.equal(primary.row.hidden, false);
  assert.match(flat(dom.overviewScope), /Tutti gli abbinamenti/);
});

test("every matrix row takes its own pair measurement from each view, and running never keeps an old live result", () => {
  const { dom, controller } = install(workbenchSession());
  // Measurement assertions span every row; widen the catalogue first.
  dom.matrixAll.checked = true;
  dom.matrixAll.dispatch("change");
  const selection = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" };
  const primaryLight = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum" };
  const textLight = { pairId: "light|color|--color-text|--color-bg", theme: "light", ratio: 4.2, minimum: 4.5, target: 4.6, status: "below-minimum" };
  const primaryDark = { pairId: "dark|color|--color-primary-text|--color-primary-surface", theme: "dark", ratio: 5.2, minimum: 4.5, target: 4.6, status: "pass" };
  const textDark = { pairId: "dark|color|--color-text|--color-bg", theme: "dark", ratio: 5, minimum: 4.5, target: 4.6, status: "pass" };
  const views = [
    { slot: "left", theme: "light", variant: "baseline", pair: { foreground: "--color-primary-text", background: "--color-primary-surface", property: "color" }, measurement: primaryLight, measurements: [primaryLight, textLight], errors: [] },
    { slot: "right", theme: "dark", variant: "baseline", pair: { foreground: "--color-primary-text", background: "--color-primary-surface", property: "color" }, measurement: primaryDark, measurements: [primaryDark, textDark], errors: [] },
  ];
  controller.publish({ phase: "complete", revision: 1, selection, draft: {}, removed: [], suggestion: null, error: null, views });
  const primary = matrixRowByValue(dom, "--color-primary-text|--color-primary-surface|text");
  const textRow = matrixRowByValue(dom, "--color-text|--color-bg|text");
  assert.match(flat(primary.left), /3,10:1/);
  assert.match(flat(primary.left), /live/);
  assert.match(flat(primary.right), /5,20:1/);
  assert.match(flat(textRow.left), /4,20:1/, "a non-selected pair takes its own measurement, never the selected one");
  assert.match(flat(textRow.right), /5,00:1/);
  assert.doesNotMatch(flat(textRow.left), /3,10:1/);
  assert.equal(primary.row.getAttribute("data-live-revision"), "1");
  assert.equal(textRow.row.getAttribute("data-status-effective"), "below-minimum", "live problems override the build pass");
  assert.match(flat(dom.matrixViewA), /tema chiaro/);
  assert.match(flat(dom.matrixViewB), /tema scuro/);

  dom.matrixFilter.value = "issues";
  dom.matrixFilter.dispatch("change");
  assert.equal(textRow.row.hidden, false, "the live below-minimum row is a problem even when the build estimate passes");
  dom.matrixFilter.value = "pass";
  dom.matrixFilter.dispatch("change");
  assert.equal(textRow.row.hidden, true, "a live below-minimum row is not a pass");

  controller.publish({ phase: "running", revision: 2, selection, draft: {}, removed: [], suggestion: null, error: null, views });
  assert.equal(textRow.row.getAttribute("data-live-status"), "false", "running never keeps an old live result");
  assert.match(flat(textRow.left), /stima build/);
  assert.doesNotMatch(flat(textRow.left), /live/);
  dom.matrixFilter.value = "issues";
  dom.matrixFilter.dispatch("change");
  assert.equal(textRow.row.hidden, true, "while running the filters fall back to the explicit build estimate");

  controller.publish({
    phase: "complete", revision: 3, draft: {}, removed: [], suggestion: null, error: null,
    selection: { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "tuning" },
    views: [
      { slot: "left", theme: "light", variant: "baseline", measurements: [primaryLight], errors: [] },
      { slot: "right", theme: "light", variant: "draft", measurements: [primaryLight], errors: [] },
    ],
  });
  assert.match(flat(dom.matrixViewA), /Attuale · tema chiaro · senza tuning/);
  assert.match(flat(dom.matrixViewB), /Modifica · tema chiaro · bozza/);
});

test("the live Aa sample is painted only from the runtime computed colours and clears on idle", () => {
  const { dom, controller } = install(workbenchSession());
  const selection = { pairId: "light|color|--color-primary-text|--color-primary-surface", theme: "light", comparison: "themes" };
  controller.publish({
    phase: "complete", revision: 1, selection, draft: { "--color-tune-primary-text-light": "oklch(0.4 0.1 250)" }, removed: [], suggestion: null, error: null,
    views: [
      { slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", foreground: "rgb(30, 40, 50)", background: "rgb(250, 250, 250)" }, measurements: [{}], errors: [] },
      { slot: "right", theme: "dark", variant: "baseline", pair: null, measurement: { ratio: 5.2, minimum: 4.5, target: 4.6, status: "pass", foreground: "rgb(245, 245, 245)", background: "rgb(12, 12, 12)" }, measurements: [{}], errors: [] },
    ],
  });
  assert.equal(dom.leftSample.style.props.color, "rgb(30, 40, 50)");
  assert.equal(dom.leftSample.style.props["background-color"], "rgb(250, 250, 250)");
  assert.equal(dom.leftSample.getAttribute("class"), "wb-aa");
  assert.match(flat(dom.leftMeta), /colori CSS calcolati/i);
  assert.match(flat(dom.leftMeta), /tema chiaro/);
  assert.match(flat(dom.leftMeta), /override attivo/);
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-left-measure")), /Colori CSS calcolati \(runtime\)/);
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-left-measure")), /rgb\(30, 40, 50\)\s+su\s+rgb\(250, 250, 250\)/);

  controller.publish({ phase: "idle", revision: 2, selection, draft: {}, removed: [], suggestion: null, error: null, views: [] });
  assert.equal(dom.leftSample.style.props.color, "");
  assert.equal(dom.leftSample.style.props["background-color"], "");
  assert.equal(dom.leftSample.getAttribute("class"), "wb-aa is-unmeasured");
  assert.match(flat(dom.leftMeta), /avvia il confronto/);
  assert.match(flat(matrixRowByValue(dom, "--color-primary-text|--color-primary-surface|text").left), /stima build/i);

  controller.publish({
    phase: "complete", revision: 3, selection, draft: {}, removed: [], suggestion: null, error: null,
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 4.6, minimum: 4.5, target: 4.6, status: "pass", foreground: "not-a-colour", background: "rgb(250, 250, 250)" }, measurements: [{}], errors: [] }],
  });
  assert.equal(dom.leftSample.style.props.color, "", "an invalid computed string is never painted");
  assert.match(flat(dom.leftMeta), /non disponibili/i);
});

test("manual L controls debounce one setLightness call, preserve focus and keep removal distinct from draft reset", async () => {
  const { dom, controller } = install(workbenchSession());
  const lightness = findAllIn(dom.controlsBody, '[data-kind="lightness"]');
  const range = lightness.find((node) => node.type === "range");
  const number = lightness.find((node) => node.type === "number");
  assert.ok(range && number, "the override control exposes a range and a numeric L input");
  const control = range.getAttribute("data-control");
  assert.equal(control, "--color-tune-primary-text-light");
  assert.equal(range.hidden, true, "without a readable L the range is hidden");
  assert.equal(range.disabled, true);
  assert.equal(number.disabled, true);
  assert.equal(number.value, "", "no implicit 50 is presented as the current L");
  assert.match(flat(dom.controlsBody), /L non disponibile/);

  controller.publish({
    phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null,
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", foreground: "oklch(0.6 0.1 250)", background: "oklch(0.98 0 0)" }, measurements: [{}], errors: [] }],
  });
  assert.equal(range.hidden, false, "a readable OKLCH measurement exposes the range");
  assert.equal(range.disabled, false);
  assert.equal(number.disabled, false);
  assert.equal(range.value, "60");
  assert.equal(number.value, "60");
  assert.match(flat(dom.controlsBody), /L letta dal colore CSS calcolato/);
  assert.match(flat(dom.controlsBody), /altri knob \(mix\/macro\) restano attivi/);

  dom.document.activeElement = range;
  range.value = "42";
  range.dispatch("input");
  assert.equal(number.value, "42");
  controller.publish({ phase: "complete", revision: 2, draft: { [control]: "oklch(0.2 0.1 250)" }, removed: [], suggestion: null, error: null, views: [] });
  assert.equal(range.value, "42", "a focused range is never overwritten by a publish");
  dom.document.activeElement = null;
  await pause(240);
  assert.deepEqual(controller.calls.setLightness, [[control, 0.42]], "the view sends L/100 and never a generated colour");

  controller.publish({ phase: "complete", revision: 3, draft: { [control]: "oklch(0.4 0.1 250)" }, removed: [], suggestion: null, error: null, views: [] });
  assert.equal(range.value, "40", "the range follows the runtime draft when it is not focused");

  controller.publish({ phase: "complete", revision: 4, draft: {}, removed: [control], suggestion: null, error: null, views: [] });
  assert.match(flat(dom.controlsBody), /Personalizzazione rimossa: si usa il fallback del token/);
  const remove = findAllIn(dom.controlsBody, '[data-smart-colors-workbench="remove-override"]')[0];
  const discard = findAllIn(dom.controlsBody, '[data-smart-colors-workbench="discard-draft"]')[0];
  assert.ok(remove && discard, "removal and draft discard are distinct controls");
  remove.dispatch("click");
  await tick();
  assert.deepEqual(controller.calls.removeOverride, [control]);
  controller.publish({ phase: "complete", revision: 5, draft: { [control]: "oklch(0.4 0.1 250)" }, removed: [], suggestion: null, error: null, views: [] });
  discard.dispatch("click");
  await tick();
  assert.ok(controller.calls.reset.includes(control));
});

test("an RGB computed colour never invents L=50 and keeps the range disabled", () => {
  const { dom, controller } = install(workbenchSession());
  const range = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "range");
  const number = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "number");
  controller.publish({
    phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null,
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", foreground: "rgb(30, 40, 50)", background: "rgb(250, 250, 250)" }, measurements: [{}], errors: [] }],
  });
  assert.equal(range.hidden, true, "the range is not shown with an invented value");
  assert.equal(range.disabled, true);
  assert.equal(number.disabled, true);
  assert.equal(number.value, "", "the numeric input remains empty");
  assert.match(flat(dom.controlsBody), /non ha restituito una L leggibile/);
  assert.match(flat(dom.controlsBody), /Nessun valore viene inventato/);
});

test("a fractional measured L keeps the L inputs and the override form valid, and the override text can be submitted", async () => {
  const { dom, controller } = install(workbenchSession());
  const lightness = findAllIn(dom.controlsBody, '[data-kind="lightness"]');
  const range = lightness.find((node) => node.type === "range");
  const number = lightness.find((node) => node.type === "number");
  assert.ok(range && number, "the override control exposes a range and a numeric L input");
  controller.publish({
    phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null,
    views: [{
      slot: "left", theme: "light", variant: "baseline", pair: null, measurements: [{}], errors: [],
      // The saved cohort exposes the parsed channels per side; the computed colour stays RGB.
      measurement: {
        ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum",
        foreground: "rgb(120, 130, 140)", background: "rgb(250, 250, 250)",
        foregroundOklch: { l: 0.4963, c: 0.012, h: 245.4 },
        backgroundOklch: { l: 0.9431, c: 0.004, h: 250 },
      },
    }],
  });
  assert.equal(range.hidden, false, "the saved per-side channels expose the range");
  assert.equal(range.disabled, false);
  assert.equal(range.getAttribute("step"), "0.1", "the range uses a reachable step");
  assert.equal(number.getAttribute("step"), "any", "the numeric input accepts any real fraction");
  assert.equal(range.value, "49.6");
  assert.equal(number.value, "49.6");
  assert.equal(range.checkValidity(), true, "a real fractional L is not a range step mismatch");
  assert.equal(number.checkValidity(), true, "a real fractional L is not a number step mismatch");
  assert.equal(dom.controlsForm.checkValidity(), true, "the override form is never blocked by a valid measured L");
  assert.match(flat(dom.controlsBody), /arrotondata a 0,1/);

  const text = findAllIn(dom.controlsBody, '[data-kind="override"]')[0];
  text.value = "oklch(0.58 0.11 255)";
  text.dispatch("input");
  assert.equal(dom.controlsForm.checkValidity(), true);
  dom.controlsForm.dispatch("submit", { type: "submit", preventDefault() {} });
  await tick();
  assert.deepEqual(controller.calls.setOverride, [[range.getAttribute("data-control"), "oklch(0.58 0.11 255)"]], "the text override submits while L holds a real value");
});

test("the background L reads backgroundOklch and never converts the RGB computed colour", () => {
  const { dom, controller } = install(workbenchSession());
  controller.publish({
    phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null,
    views: [{
      slot: "left", theme: "light", variant: "baseline", pair: null, measurements: [{}], errors: [],
      measurement: {
        ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum",
        foreground: "rgb(120, 130, 140)", background: "rgb(250, 250, 250)",
        foregroundOklch: { l: 0.4963, c: 0.012, h: 245.4 },
        backgroundOklch: { l: 0.9431, c: 0.004, h: 250 },
      },
    }],
  });
  const values = findAllIn(dom.controlsBody, '[data-kind="lightness"]')
    .filter((node) => node.type === "number")
    .map((node) => [node.getAttribute("data-control"), node.value]);
  assert.deepEqual(values, [
    ["--color-tune-primary-text-light", "49.6"],
    ["--color-tune-primary-surface-light", "94.3"],
  ], "each side reads its own saved channels, with no second conversion");
});

test("a pending 180ms L commit is cancelled when the pair or theme changes and on destroy", async () => {
  const { dom, controller, view } = install(workbenchSession());
  function publishLight(revision) {
    controller.publish({
      phase: "complete", revision, draft: {}, removed: [], suggestion: null, error: null,
      views: [{
        slot: "left", theme: "light", variant: "baseline", pair: null, measurements: [{}], errors: [],
        measurement: {
          ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum",
          foreground: "rgb(120, 130, 140)", background: "rgb(250, 250, 250)",
          foregroundOklch: { l: 0.4963, c: 0.012, h: 245.4 },
          backgroundOklch: { l: 0.9431, c: 0.004, h: 250 },
        },
      }],
    });
  }
  function rangeNow() {
    return findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "range");
  }

  publishLight(1);
  assert.equal(rangeNow().disabled, false);
  rangeNow().value = "42";
  rangeNow().dispatch("input");
  dom.themeDark.checked = true;
  dom.themeLight.checked = false;
  dom.themeDark.dispatch("change");
  await pause(240);
  assert.deepEqual(controller.calls.setLightness, [], "a theme change cancels the pending edit before it is sent");

  dom.themeLight.checked = true;
  dom.themeDark.checked = false;
  dom.themeLight.dispatch("change");
  publishLight(2);
  assert.equal(rangeNow().disabled, false);
  rangeNow().value = "43";
  rangeNow().dispatch("input");
  view.destroy();
  await pause(240);
  assert.deepEqual(controller.calls.setLightness, [], "destroy cancels the pending edit before it is sent");
});

test("export prefers exportTuningFile, names complete and fragment downloads, and reports dirty vs the last export", async () => {
  let file = { css: ":root { --a: 1; }", mode: "complete", warnings: ["Avviso del runtime."], removed: ["--removed-a"], unmatched: ["--unmatched-a"] };
  const { dom, controller } = install(workbenchSession(), controllerStub({ exportTuningFile: () => file }));
  controller.publish({ phase: "complete", revision: 1, draft: { "--a": "1" }, removed: [], suggestion: null, error: null, views: [] });
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(dom.document.getElementById("smart-colors-workbench-export-text").value, ":root { --a: 1; }");
  const download = dom.document.getElementById("smart-colors-workbench-download");
  assert.equal(download.download, "colors-tuning.css");
  assert.equal(download.hidden, false);
  const exportNoteNode = dom.document.getElementById("smart-colors-workbench-export-note");
  const exportModeNode = dom.document.getElementById("smart-colors-workbench-export-mode");
  assert.match(flat(exportNoteNode), /CSS della bozza corrente: file completo/);
  assert.match(flat(exportNoteNode), /Rimozioni incluse nel file: --removed-a/);
  assert.match(flat(exportNoteNode), /non trovati nei token attuali: --unmatched-a/);
  assert.match(flat(exportNoteNode), /Avviso del runtime/);
  assert.match(flat(exportModeNode), /File completo/);

  file = { css: ":root { --a: 2; }", mode: "complete", warnings: [], removed: [], unmatched: [] };
  controller.publish({ phase: "complete", revision: 2, draft: { "--a": "2" }, removed: [], suggestion: null, error: null, views: [] });
  assert.match(flat(exportNoteNode), /Modifiche non esportate rispetto all'ultima esportazione/);

  file = { css: ":root { --a: 3; }", mode: "fragment", warnings: [], removed: ["--removed-b"], unmatched: [] };
  controller.publish({ phase: "complete", revision: 3, draft: { "--a": "3" }, removed: [], suggestion: null, error: null, views: [] });
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(download.download, "colors-tuning.patch.css");
  assert.match(flat(exportNoteNode), /CSS della bozza corrente come frammento: colors-tuning\.patch\.css/);
  assert.match(flat(exportNoteNode), /Rimozioni non applicabili in questo export: --removed-b/);
});

test("export with no draft shows the preserved saved source from exportTuningFile", () => {
  const file = { css: ":root { --saved-source: 1; }", mode: "complete", warnings: [], removed: [], unmatched: [] };
  const { dom } = install(workbenchSession(), controllerStub({ exportTuningFile: () => file }));
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  assert.equal(dom.document.getElementById("smart-colors-workbench-export-text").value, ":root { --saved-source: 1; }", "no draft still shows the preserved saved source, never an arbitrary empty string");
  assert.equal(dom.document.getElementById("smart-colors-workbench-download").download, "colors-tuning.css");
  assert.match(flat(dom.document.getElementById("smart-colors-workbench-export-note")), /Nessuna modifica in bozza: file completo del tuning salvato preservato/);
});

test("exploration is an optional advisory disclosure and a stale revision is never shown as current", async () => {
  let explored = 0;
  const controller = controllerStub({
    explorationPairs: () => [{ id: "explore|color|--a|--b", label: "A su B", foreground: "--a", background: "--b" }],
    measureExploration: () => { explored += 1; return Promise.resolve(); },
  });
  const { dom } = install(workbenchSession(), controller);
  assert.equal(dom.explorationBox.hidden, false, "the disclosure is revealed only when the runtime exposes both APIs");
  assert.equal(dom.explorationRun.disabled, false);

  controller.publish({
    phase: "complete", revision: 5, draft: {}, removed: [], suggestion: null, error: null, views: [],
    exploration: { theme: "light", variant: "baseline", revision: 5, phase: "complete", measurements: [{ pairId: "explore|color|--a|--b", ratio: 4.6, minimum: 4.5, target: 7, status: "pass", foreground: "rgb(1,1,1)", background: "rgb(255,255,255)" }], errors: [], omittedFamilies: ["gamma"] },
  });
  const results = flat(dom.explorationResults);
  assert.match(results, /Combinazioni dei colori base/);
  assert.match(results, /A su B/);
  assert.match(results, /4,60:1/);
  assert.match(results, /minimo raggiunto/);
  assert.match(flat(dom.explorationStatus), /advisory/);
  assert.match(flat(dom.explorationStatus), /Famiglie omesse dal limite: gamma/);
  assert.equal(findAllIn(dom.explorationResults, "button").length, 0, "exploration is read-only");

  controller.publish({
    phase: "complete", revision: 6, draft: {}, removed: [], suggestion: null, error: null, views: [],
    exploration: { theme: "light", variant: "baseline", revision: 5, phase: "complete", measurements: [{ pairId: "explore|color|--a|--b", ratio: 4.6, minimum: 4.5, target: 7, status: "pass" }], errors: [], omittedFamilies: [] },
  });
  assert.match(flat(dom.explorationStatus), /non sono aggiornati/);
  assert.equal(dom.explorationResults.children.length, 0, "stale exploration data is cleared, never shown as current");

  controller.publish({ phase: "idle", revision: 7, draft: {}, removed: [], suggestion: null, error: null, views: [], exploration: null });
  assert.match(flat(dom.explorationStatus), /Non misurato/);
  dom.explorationRun.dispatch("click");
  await tick();
  assert.equal(explored, 1);
});

test("exploration controls recover before the cache and render 240 real rows", async () => {
  let explored = 0;
  const controller = controllerStub({
    state: { phase: "running", revision: 1, selection: { pairId: null, theme: "light", comparison: "themes" }, draft: {}, removed: [], views: [], suggestion: null, error: null },
    explorationPairs: () => [{ id: "explore|color|--a|--b", label: "A su B", foreground: "--a", background: "--b" }],
    measureExploration: () => { explored += 1; return Promise.resolve(); },
  });
  const { dom } = install(workbenchSession(), controller);
  assert.equal(dom.explorationRun.disabled, true, "a running primary phase gates the exploration action");
  controller.publish({ phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null, views: [], exploration: null });
  assert.equal(dom.explorationRun.disabled, false, "the same revision must still refresh the action when the phase changes");
  const measurements = Array.from({ length: 240 }, (_, index) => ({
    pairId: "explore|color|--a|--b", ratio: 4.6, minimum: 4.5, target: 7, status: "pass", foreground: "rgb(1,1,1)", background: "rgb(255,255,255)", index,
  }));
  controller.publish({ phase: "complete", revision: 2, draft: {}, removed: [], suggestion: null, error: null, views: [], exploration: { theme: "light", variant: "baseline", revision: 2, phase: "complete", measurements, errors: [], omittedFamilies: [] } });
  const body = findAllIn(dom.explorationResults, "tbody")[0];
  assert.ok(body, "the real exploration table exposes a tbody");
  assert.equal(body.children.length, 240, "every measurement is rendered as a real row");
  assert.match(flat(dom.explorationStatus), /240 combinazioni misurate/);
  dom.explorationRun.dispatch("click");
  await tick();
  assert.equal(explored, 1, "the enabled button reaches the runtime at startup");

  controller.publish({
    phase: "complete", revision: 3, draft: {}, removed: [], suggestion: null, error: null, exploration: null,
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurements: [{}], errors: [], measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", foreground: "rgb(120, 130, 140)", background: "rgb(250, 250, 250)", foregroundOklch: { l: 0.4963, c: 0.012, h: 245.4 }, backgroundOklch: { l: 0.9431, c: 0.004, h: 250 } } }],
  });
  const range = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "range");
  range.value = "42";
  range.dispatch("input");
  await pause(240);
  assert.equal(dom.explorationRun.disabled, false, "L work never leaves the exploration action disabled");
  dom.document.getElementById("smart-colors-workbench-reset-pair").dispatch("click");
  await tick();
  assert.equal(dom.explorationRun.disabled, false, "reset work never leaves the exploration action disabled");
});

test("submitting before the L debounce flushes once and explains the automatic draft", async () => {
  const { dom, controller } = install(workbenchSession());
  controller.publish({
    phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null,
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurements: [{}], errors: [], measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", foreground: "rgb(120, 130, 140)", background: "rgb(250, 250, 250)", foregroundOklch: { l: 0.4963, c: 0.012, h: 245.4 }, backgroundOklch: { l: 0.9431, c: 0.004, h: 250 } } }],
  });
  const range = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "range");
  const control = range.getAttribute("data-control");
  dom.document.activeElement = range;
  range.value = "42";
  range.dispatch("input");
  dom.controlsForm.dispatch("submit", { type: "submit", preventDefault() {} });
  await tick();
  await tick();
  assert.deepEqual(controller.calls.setLightness, [[control, 0.42]], "the pending L is flushed exactly once");
  assert.equal(controller.calls.setOverride.length, 0, "no text override is invented");
  assert.match(dom.status.textContent, /L già nella bozza, nessun altro campo CSS da applicare/);
});

test("submitting a pending L together with a text field flushes L once and sends one text override", async () => {
  const { dom, controller } = install(workbenchSession());
  controller.publish({
    phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null,
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurements: [{}], errors: [], measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", foreground: "rgb(120, 130, 140)", background: "rgb(250, 250, 250)", foregroundOklch: { l: 0.4963, c: 0.012, h: 245.4 }, backgroundOklch: { l: 0.9431, c: 0.004, h: 250 } } }],
  });
  const range = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "range");
  const control = range.getAttribute("data-control");
  range.value = "42";
  range.dispatch("input");
  const text = findAllIn(dom.controlsBody, '[data-kind="override"]')[0];
  text.value = "oklch(0.58 0.11 255)";
  text.dispatch("input");
  dom.controlsForm.dispatch("submit", { type: "submit", preventDefault() {} });
  await tick();
  await tick();
  assert.deepEqual(controller.calls.setLightness, [[control, 0.42]], "L is flushed once, never three times");
  assert.deepEqual(controller.calls.setOverride, [[control, "oklch(0.58 0.11 255)"]], "the text override is sent once after the flush");
});

test("a repeated override submit while busy never sends the same control twice", async () => {
  const { dom, controller } = install(workbenchSession());
  const text = findAllIn(dom.controlsBody, '[data-kind="override"]')[0];
  const control = text.getAttribute("data-control");
  text.value = "oklch(0.58 0.11 255)";
  text.dispatch("input");
  dom.controlsForm.dispatch("submit", { type: "submit", preventDefault() {} });
  dom.controlsForm.dispatch("submit", { type: "submit", preventDefault() {} });
  await tick();
  await tick();
  assert.deepEqual(controller.calls.setOverride, [[control, "oklch(0.58 0.11 255)"]], "one submit, one override");
});

test("reset restores focus without stealing it from a control the user chose", async () => {
  const { dom } = install(workbenchSession());
  const reset = dom.document.getElementById("smart-colors-workbench-reset-pair");
  dom.document.activeElement = reset;
  reset.dispatch("click");
  await tick();
  assert.equal(reset.focused, true, "a lost focus returns to the reset control");
  reset.focused = false;
  dom.document.activeElement = dom.themeDark;
  reset.dispatch("click");
  await tick();
  assert.equal(reset.focused, false, "focus is never stolen from a control the user moved to");
});

test("invalid numeric L keeps the last valid range and marks the field", async () => {
  const { dom, controller } = install(workbenchSession());
  controller.publish({
    phase: "complete", revision: 1, draft: {}, removed: [], suggestion: null, error: null,
    views: [{ slot: "left", theme: "light", variant: "baseline", pair: null, measurements: [{}], errors: [], measurement: { ratio: 3.1, minimum: 4.5, target: 4.6, status: "below-minimum", foreground: "rgb(120, 130, 140)", background: "rgb(250, 250, 250)", foregroundOklch: { l: 0.4963, c: 0.012, h: 245.4 }, backgroundOklch: { l: 0.9431, c: 0.004, h: 250 } } }],
  });
  const number = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "number");
  const range = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "range");
  const control = number.getAttribute("data-control");
  number.value = "150";
  number.dispatch("input");
  assert.equal(number.getAttribute("aria-invalid"), "true");
  assert.match(flat(dom.controlsBody), /L non valida/);
  assert.equal(range.value, "49.6", "the thumb never jumps to an invented or clamped value");
  assert.equal(range.getAttribute("aria-valuetext"), "49.6%", "the announced value stays the last valid one");
  number.dispatch("blur");
  await tick();
  assert.equal(controller.calls.setLightness.length, 0, "an invalid L is never applied to the draft");
  number.value = "40";
  number.dispatch("input");
  assert.equal(number.getAttribute("aria-invalid"), "false");
  assert.equal(range.value, "40");
  assert.equal(range.getAttribute("aria-valuetext"), "40%");
  number.dispatch("change");
  await tick();
  assert.deepEqual(controller.calls.setLightness, [[control, 0.4]], "a restored valid value applies normally");
});

test("the L error text leaves the description as soon as the typed value is valid again", () => {
  const { dom } = install(workbenchSession());
  const number = findAllIn(dom.controlsBody, '[data-kind="lightness"]').find((node) => node.type === "number");
  const note = findAllIn(dom.controlsBody, "span").find((node) => String(node.id || "").endsWith("-note"));
  const before = note.textContent;
  assert.ok(before, "the field starts with its own description");
  number.value = "150";
  number.dispatch("input");
  assert.equal(number.getAttribute("aria-invalid"), "true");
  assert.equal(note.textContent, "L non valida: 0–100.");
  number.value = "40";
  number.dispatch("input");
  assert.equal(number.getAttribute("aria-invalid"), "false");
  assert.equal(note.textContent, before, "the aria-describedby text returns to the L provenance sentence");
  assert.doesNotMatch(flat(dom.controlsBody), /L non valida/, "a valid value never keeps the error in its description");
});

test("the comparison submit is never disabled by its own run, so keyboard focus is not lost", async () => {
  const { dom, controller } = install(workbenchSession());
  const submit = dom.document.getElementById("smart-colors-workbench-submit");
  dom.document.activeElement = submit;
  dom.selection.dispatch("submit", { type: "submit", preventDefault() {} });
  assert.equal(submit.disabled, false, "disabling the activated submit would move focus to the body");
  assert.equal(dom.document.activeElement, submit, "the submit keeps focus while its own run is in flight");
  // Re-entrancy stays guarded: a second submit during the same run sends no second selection.
  dom.selection.dispatch("submit", { type: "submit", preventDefault() {} });
  assert.match(dom.status.textContent, /già in corso/, "the busy state explains why the repeat is ignored");
  await tick();
  assert.equal(controller.calls.select.length, 1, "only one selection is requested");
  assert.equal(submit.disabled, false);
  assert.equal(dom.document.activeElement, submit, "focus stays on the submit after the run");
});

test("narrow viewport keeps the proposal locally scrollable and the document narrow, and desktop becomes overview + inspector", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { chromium } = resolvePlaywright();
  let browser = null;
  let root = null;
  try {
    browser = await chromium.launch({ headless: true, timeout: 60_000 });
    root = await mkdtemp(path.join(tmpdir(), "smart-colors-proposal-narrow-"));
    await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
    await writeFile(path.join(root, "src/styles/tokens/palette.css"), NARROW_PALETTE, "utf8");
    await writeFile(path.join(root, "smart-colors.config.mjs"), "// Narrow-viewport fixture; only the generated output is written here.\nexport default {};\n", "utf8");
    await writeFile(path.join(root, "src/styles/tokens/colors-tuning.css"), NARROW_TUNING, "utf8");
    await generateColorTokens({ root, suggest: false });
    const built = await createDiagnosticSession({ root, suggest: false });
    const file = path.join(root, "reports/smart-colors-preview.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, formatContrastPreviewHtml(built.session), "utf8");

    const context = await browser.newContext({ viewport: { width: 320, height: 720 }, colorScheme: "light", reducedMotion: "reduce" });
    const requests = [];
    await context.route("**/*", (route) => {
      const request = route.request();
      requests.push(request.url());
      if (request.isNavigationRequest() && request.resourceType() === "document") return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 });

    // Choose the failing canvas source, then use the primary picker to find the exact use.
    await page.evaluate(() => {
      const source = document.getElementById("smart-colors-workbench-source");
      const canvas = Array.from(source.options).find((option) => option.value === "--palette-canvas");
      if (!canvas) throw new Error("the --palette-canvas source is missing from the preview");
      source.value = canvas.value;
      source.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(200);
    await page.waitForFunction(() => window.__smartColorsWorkbench && window.__smartColorsWorkbench.state().phase !== "running", null, { timeout: 30_000 });

    await page.click("#smart-colors-workbench-open-picker");
    const pickerState = await page.evaluate(() => {
      const dialog = document.getElementById("smart-colors-workbench-picker");
      const rect = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        focused: document.activeElement && document.activeElement.id,
        width: rect.width,
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        results: document.querySelectorAll("#smart-colors-workbench-uses .wb-use").length,
        count: document.getElementById("smart-colors-workbench-use-count").textContent,
        categories: Array.from(document.querySelectorAll("#smart-colors-workbench-use-category option")).map((option) => option.textContent),
        searchDisabled: document.getElementById("smart-colors-workbench-use-search").disabled,
        technicalPairPresent: Boolean(document.getElementById("smart-colors-workbench-pair")),
      };
    });
    assert.equal(pickerState.open, true, "the native picker opens with showModal");
    assert.equal(pickerState.focused, "smart-colors-workbench-use-search", "opening focuses the search field");
    assert.ok(pickerState.width <= pickerState.viewport - 1, "the dialog never exceeds the 320px viewport: " + JSON.stringify(pickerState));
    assert.ok(pickerState.document <= pickerState.viewport + 1, "the open dialog never widens the document: " + JSON.stringify(pickerState));
    assert.ok(pickerState.results >= 1 && pickerState.results <= 6, "the first page holds at most six real uses: " + JSON.stringify(pickerState));
    assert.match(pickerState.count, /pagina 1 di|uso|usi/);
    assert.equal(pickerState.searchDisabled, false, "JavaScript enables the search field");
    assert.ok(pickerState.categories.includes("Tutti gli usi"), "the category select starts with all uses");
    assert.ok(pickerState.technicalPairPresent, "the technical pair fallback stays in the DOM");

    await page.selectOption("#smart-colors-workbench-use-category", "page");
    await page.waitForFunction(() => /uso|usi/.test(document.getElementById("smart-colors-workbench-use-count").textContent), null, { timeout: 10_000 });
    await page.fill("#smart-colors-workbench-use-search", "pagina");
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll("#smart-colors-workbench-uses .wb-use"));
      return buttons.some((button) => button.getAttribute("data-pair-value") === "--color-text|--color-bg|text");
    }, null, { timeout: 10_000 });
    await page.click('#smart-colors-workbench-uses .wb-use[data-pair-value="--color-text|--color-bg|text"]');
    await page.waitForFunction(() => !document.getElementById("smart-colors-workbench-picker").open, null, { timeout: 10_000 });
    const afterPick = await page.evaluate(() => ({
      open: document.getElementById("smart-colors-workbench-picker").open,
      focused: document.activeElement && document.activeElement.id,
      pair: document.getElementById("smart-colors-workbench-pair").value,
      currentUse: document.getElementById("smart-colors-workbench-current-use").textContent,
    }));
    assert.equal(afterPick.open, false, "choosing a use closes the picker");
    assert.equal(afterPick.focused, "smart-colors-workbench-open-picker", "focus returns to the stable opener");
    assert.equal(afterPick.pair, "--color-text|--color-bg|text", "the technical select follows the chosen use");
    assert.match(afterPick.currentUse, /Testo sulla pagina/);
    assert.doesNotMatch(afterPick.currentUse, /--color-/, "the primary summary stays human");
    // The saved tuning only shows in the tuned comparison, so select it as a real user would.
    await page.click("#smart-colors-workbench-comparison-tuning");
    await page.waitForFunction(() => /Soglia AA per testo normale non raggiunta/.test(document.getElementById("smart-colors-workbench-right-measure").textContent), null, { timeout: 30_000 });

    // No suggestion has been requested: the proposal area is not painted at all.
    const proposalVisibility = await page.evaluate(() => {
      const section = document.getElementById("smart-colors-workbench-proposal-frames");
      const result = document.getElementById("smart-colors-workbench-result");
      return {
        proposalHidden: section.hidden,
        proposalDisplay: getComputedStyle(section).display,
        resultHidden: result.hidden,
        resultDisplay: getComputedStyle(result).display,
      };
    });
    assert.equal(proposalVisibility.proposalHidden, true, "no verified proposal yet");
    assert.equal(proposalVisibility.proposalDisplay, "none", "the hidden proposal section is not painted: " + JSON.stringify(proposalVisibility));
    assert.equal(proposalVisibility.resultHidden, false, "the measured result is visible");
    assert.notEqual(proposalVisibility.resultDisplay, "none", "the measured result is painted");

    await page.click("#smart-colors-workbench-suggest-foreground");
    await page.waitForFunction(() => {
      const section = document.getElementById("smart-colors-workbench-proposal-frames");
      return Boolean(section) && !section.hidden && document.querySelectorAll("#smart-colors-workbench-proposal-frames iframe[data-smart-colors-workbench-frame='proposal']").length >= 2;
    }, null, { timeout: 30_000 });

    const measured = await page.evaluate(() => {
      const doc = document.documentElement;
      const containers = ["smart-colors-workbench-proposal-before", "smart-colors-workbench-proposal-after"].map((id) => document.getElementById(id));
      return {
        viewport: doc.clientWidth,
        document: doc.scrollWidth,
        body: document.body.scrollWidth,
        mainOverflow: ["left", "right"].map((slot) => getComputedStyle(document.getElementById("smart-colors-workbench-" + slot)).overflowX),
        mainFrames: ["left", "right"].map((slot) => {
          const container = document.getElementById("smart-colors-workbench-" + slot);
          const frame = container ? container.querySelector("iframe") : null;
          const frameDoc = frame && frame.contentDocument;
          return {
            slot,
            present: Boolean(frame),
            height: frame ? frame.clientHeight : null,
            contentHeight: frameDoc && frameDoc.documentElement ? frameDoc.documentElement.clientHeight : null,
            scrollHeight: frameDoc && frameDoc.documentElement ? frameDoc.documentElement.scrollHeight : null,
          };
        }),
        containers: containers.map((node) => {
          const frame = node.querySelector("iframe");
          return {
            overflowX: getComputedStyle(node).overflowX,
            tabIndex: node.tabIndex,
            label: node.getAttribute("aria-label"),
            scrollWidth: node.scrollWidth,
            clientWidth: node.clientWidth,
            frame: frame ? { width: frame.offsetWidth, height: frame.offsetHeight } : null,
          };
        }),
      };
    });
    assert.ok(measured.viewport >= 300 && measured.viewport <= 320, "the layout viewport must stay the narrow 320px: " + measured.viewport);
    assert.ok(measured.document <= measured.viewport + 1 && measured.body <= measured.viewport + 1, "no document-level widening: " + JSON.stringify(measured));
    assert.deepEqual(measured.mainOverflow, ["hidden", "hidden"], "the main views keep their clipping");
    for (const frame of measured.mainFrames) {
      assert.equal(frame.present, true, "main frame " + frame.slot + " is mounted");
      assert.ok(frame.contentHeight !== null && frame.scrollHeight !== null, "main frame " + frame.slot + " exposes its content box: " + JSON.stringify(frame));
      assert.ok(frame.scrollHeight <= frame.contentHeight + 1, "primary text sample " + frame.slot + " must not need a nested vertical scroll at 320px: " + JSON.stringify(frame));
      assert.ok(frame.scrollHeight <= frame.height + 1, "primary text sample " + frame.slot + " fits the main iframe height at 320px: " + JSON.stringify(frame));
    }
    const narrowLayout = await page.evaluate(() => {
      const workspace = document.querySelector("#banco .wb-workspace");
      const toolbar = document.querySelector("#banco .wb-toolbar");
      const main = document.querySelector("#banco .wb-main");
      const results = document.getElementById("smart-colors-workbench-result");
      const toolbarBox = toolbar.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      return {
        columns: getComputedStyle(workspace).gridTemplateColumns.split(" ").length,
        specimenColumns: getComputedStyle(results).gridTemplateColumns.split(" ").length,
        proposalColumns: getComputedStyle(document.getElementById("smart-colors-workbench-proposal-frames")).gridTemplateColumns.split(" ").length,
        paletteDisplay: getComputedStyle(document.querySelector("#banco .wb-palette")).display,
        sourceDisplay: getComputedStyle(document.querySelector("#banco .wb-source-select")).display,
        currentUseDisplay: getComputedStyle(document.querySelector("#banco .wb-current-use")).display,
        openerDisplay: getComputedStyle(document.querySelector("#banco .wb-open-picker")).display,
        specimenTop: window.scrollY + document.getElementById("smart-colors-workbench-left").getBoundingClientRect().top,
        toolbarTop: toolbarBox.top,
        mainTop: mainBox.top,
        toolbarWidth: toolbarBox.width,
      };
    });
    assert.equal(narrowLayout.columns, 1, "the workspace is a single full-width column at 320px: " + JSON.stringify(narrowLayout));
    assert.equal(narrowLayout.specimenColumns, 1, "the two specimens stack at 320px: " + JSON.stringify(narrowLayout));
    assert.equal(narrowLayout.proposalColumns, 1, "the proposal frames stack at 320px: " + JSON.stringify(narrowLayout));
    assert.equal(narrowLayout.paletteDisplay, "none", "the horizontal swatch strip is not used at 320px: " + JSON.stringify(narrowLayout));
    assert.notEqual(narrowLayout.sourceDisplay, "none", "the compact native source select is visible at 320px");
    assert.notEqual(narrowLayout.currentUseDisplay, "none", "the human current use is visible at 320px");
    assert.notEqual(narrowLayout.openerDisplay, "none", "the change-use opener is visible at 320px");
    assert.ok(narrowLayout.specimenTop < 1200, "the result stays reasonably reachable at 320px: " + narrowLayout.specimenTop);
    assert.ok(narrowLayout.toolbarTop < narrowLayout.mainTop, "the toolbar precedes the comparison at 320px");
    assert.ok(narrowLayout.toolbarWidth <= measured.viewport, "the toolbar never exceeds the 320px viewport: " + narrowLayout.toolbarWidth);
    for (const container of measured.containers) {
      assert.equal(container.overflowX, "auto", "the proposal container scrolls locally");
      assert.equal(container.tabIndex, 0, "the proposal container is keyboard focusable");
      assert.match(container.label, /viewport di verifica fisso 360×480/);
      assert.ok(container.frame && container.frame.width === 360 && container.frame.height === 480, "the verification viewport stays 360x480: " + JSON.stringify(container.frame));
      assert.ok(container.clientWidth <= measured.viewport + 1, "the proposal container never exceeds the viewport");
      assert.ok(container.scrollWidth > container.clientWidth + 1, "the fixed frame overflows locally instead of being clipped");
    }

    const reach = await page.evaluate(() => {
      const node = document.getElementById("smart-colors-workbench-proposal-after");
      node.scrollLeft = node.scrollWidth;
      return { left: node.scrollLeft, max: node.scrollWidth - node.clientWidth };
    });
    assert.ok(reach.max > 0 && reach.left >= reach.max - 1, "the far edge of the proposed frame is reachable by scrolling: " + JSON.stringify(reach));

    // Keyboard reachability: both proposal regions must sit in the native Tab order. Chromium's
    // headless CDP key events do not perform arrow-key scroll defaults, so reachability is proven
    // by Tab focus plus the scrollable overflow asserted above.
    await page.focus("#smart-colors-workbench-suggest-background");
    const tabbed = [];
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("Tab");
      tabbed.push(await page.evaluate(() => document.activeElement && document.activeElement.id));
    }
    assert.ok(tabbed.includes("smart-colors-workbench-proposal-before") && tabbed.includes("smart-colors-workbench-proposal-after"), "both proposal regions are keyboard reachable: " + JSON.stringify(tabbed));

    // Desktop: the workbench is now overview + inspector. The three-column overview occupies the
    // first column, the comparison/inspector the second, and the toolbar spans both. Inside the
    // narrower inspector column the two specimens stack, because the container query follows that
    // column and not the viewport.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForFunction(() => {
      const node = document.querySelector("#banco .wb-overview");
      return Boolean(node) && node.open;
    }, null, { timeout: 10_000 });
    const wideLayout = await page.evaluate(() => {
      const workspace = document.querySelector("#banco .wb-workspace");
      const toolbar = document.querySelector("#banco .wb-toolbar");
      const overview = document.querySelector("#banco .wb-overview");
      const matrixScroll = overview.querySelector(".wb-matrix-scroll");
      const main = document.querySelector("#banco .wb-main");
      const results = document.getElementById("smart-colors-workbench-result");
      const toolbarBox = toolbar.getBoundingClientRect();
      const overviewBox = overview.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      const sourceBox = document.querySelector("#banco .wb-source-select");
      const palette = document.querySelector("#banco .wb-palette");
      return {
        columns: getComputedStyle(workspace).gridTemplateColumns.split(" ").length,
        overviewOpen: overview.open,
        overviewHeight: Math.round(overviewBox.height),
        overviewTable: Boolean(overview.querySelector("table.wb-matrix")),
        matrixScrollHeight: matrixScroll ? matrixScroll.clientHeight : 0,
        specimenColumns: getComputedStyle(results).gridTemplateColumns.split(" ").length,
        proposalColumns: getComputedStyle(document.getElementById("smart-colors-workbench-proposal-frames")).gridTemplateColumns.split(" ").length,
        proposalFrames: [...document.querySelectorAll("#smart-colors-workbench-proposal-frames .wb-frame")].map((node) => {
          const frame = node.querySelector("iframe");
          return { overflowX: getComputedStyle(node).overflowX, width: frame ? frame.offsetWidth : null, height: frame ? frame.offsetHeight : null };
        }),
        paletteDisplay: getComputedStyle(palette).display,
        paletteOverflow: getComputedStyle(palette).overflowX,
        paletteScroll: palette.scrollWidth > palette.clientWidth,
        sourceDisplay: getComputedStyle(sourceBox).display,
        specimenTop: window.scrollY + document.getElementById("smart-colors-workbench-left").getBoundingClientRect().top,
        toolbarWidth: toolbarBox.width,
        toolbarTop: toolbarBox.top,
        toolbarLeft: toolbarBox.left,
        overviewLeft: overviewBox.left,
        overviewTop: overviewBox.top,
        mainLeft: mainBox.left,
        mainTop: mainBox.top,
        mainWidth: mainBox.width,
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      };
    });
    assert.equal(wideLayout.columns, 2, "desktop is the overview + inspector layout: " + JSON.stringify(wideLayout));
    assert.equal(wideLayout.overviewOpen, true, "the desktop overview is open by default");
    assert.ok(wideLayout.overviewTable, "the overview column carries the semantic matrix");
    assert.ok(wideLayout.overviewHeight > 200, "the overview column has real content: " + wideLayout.overviewHeight);
    assert.ok(wideLayout.matrixScrollHeight > 0 && wideLayout.matrixScrollHeight <= 400, "the matrix stays bounded inside the overview column: " + wideLayout.matrixScrollHeight);
    assert.ok(wideLayout.overviewLeft < wideLayout.mainLeft, "the overview is the first column and the inspector the second: " + JSON.stringify(wideLayout));
    assert.equal(wideLayout.specimenColumns, 2, "the broader inspector column fits the two specimens side by side: " + JSON.stringify(wideLayout));
    assert.equal(wideLayout.proposalColumns, 1, "the fixed proposal frames stack inside the narrower inspector column: " + JSON.stringify(wideLayout));
    assert.equal(wideLayout.proposalFrames.length, 2, "both proposal frames are mounted");
    for (const frame of wideLayout.proposalFrames) {
      assert.equal(frame.overflowX, "auto", "each proposal container keeps local scrolling");
      assert.equal(frame.width, 360, "the proposal viewport stays 360px wide");
      assert.equal(frame.height, 480, "the proposal viewport stays 480px tall");
    }
    assert.equal(wideLayout.paletteDisplay, "grid", "the wrapping swatch grid is the desktop counterpart");
    assert.equal(wideLayout.paletteOverflow, "visible", "the palette never needs a local horizontal scroll");
    assert.equal(wideLayout.paletteScroll, false, "every desktop source chip wraps inside the toolbar");
    assert.equal(wideLayout.sourceDisplay, "none", "the native select is removed on desktop, with no invisible focus stop: " + JSON.stringify(wideLayout));
    assert.ok(wideLayout.specimenTop < 600, "the specimen stays high enough to be visible at 1280: " + wideLayout.specimenTop);
    assert.ok(wideLayout.toolbarWidth > 600, "the toolbar spans both desktop columns: " + wideLayout.toolbarWidth);
    assert.ok(Math.abs(wideLayout.toolbarLeft - wideLayout.overviewLeft) <= 1, "the toolbar starts at the overview edge and spans both columns");
    assert.ok(wideLayout.toolbarTop < wideLayout.overviewTop && wideLayout.toolbarTop < wideLayout.mainTop, "the toolbar precedes overview and inspector");
    assert.ok(wideLayout.document <= wideLayout.viewport + 1, "the desktop layout never widens the document: " + JSON.stringify(wideLayout));

    assert.ok(requests.every((url) => url.startsWith("file:")), "offline: no remote request " + JSON.stringify(requests));
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

test("blocked source leaves the theme recovery control visible and a valid swatch restores the result", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { chromium } = resolvePlaywright();
  let browser = null;
  let root = null;
  try {
    browser = await chromium.launch({ headless: true, timeout: 60_000 });
    root = await mkdtemp(path.join(tmpdir(), "smart-colors-blocked-"));
    await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
    await writeFile(path.join(root, "src/styles/tokens/palette.css"), NARROW_PALETTE, "utf8");
    await writeFile(path.join(root, "smart-colors.config.mjs"), "// Blocked-state fixture; only the generated output is written here.\nexport default {};\n", "utf8");
    await writeFile(path.join(root, "src/styles/tokens/colors-tuning.css"), NARROW_TUNING, "utf8");
    await generateColorTokens({ root, suggest: false });
    const built = await createDiagnosticSession({ root, suggest: false });
    const file = path.join(root, "reports/smart-colors-preview.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, formatContrastPreviewHtml(built.session), "utf8");

    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
    await context.route("**/*", (route) => {
      const request = route.request();
      if (request.isNavigationRequest() && request.resourceType() === "document") return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 });

    // Force the real blocked path through the existing native source control: a source value with no
    // catalogue pairs. The desktop swatches remain the visible source choice.
    await page.evaluate(() => {
      const source = document.getElementById("smart-colors-workbench-source");
      const missing = document.createElement("option");
      missing.value = "--palette-missing";
      missing.textContent = "--palette-missing";
      source.appendChild(missing);
      source.value = "--palette-missing";
      source.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const empty = document.getElementById("smart-colors-workbench-empty");
      return Boolean(empty) && !empty.hidden;
    }, null, { timeout: 30_000 });

    const blocked = await page.evaluate(() => {
      const fieldset = document.querySelector("#banco .wb-theme-fieldset");
      const correction = document.querySelector("#smart-colors-workbench [data-smart-colors-workbench='correction']");
      return {
        correctionHidden: correction.hidden,
        fieldsetVisible: Boolean(fieldset.offsetParent),
        fieldsetHeight: Math.round(fieldset.getBoundingClientRect().height),
        sourceDisplay: getComputedStyle(document.querySelector("#banco .wb-source-select")).display,
        paletteDisplay: getComputedStyle(document.querySelector("#banco .wb-palette")).display,
      };
    });
    assert.equal(blocked.correctionHidden, true, "the correction action is hidden while blocked");
    assert.ok(blocked.fieldsetVisible && blocked.fieldsetHeight > 0, "the theme recovery control stays visible: " + JSON.stringify(blocked));
    assert.equal(blocked.sourceDisplay, "none", "desktop uses the swatch strip, not a hidden focusable select");
    assert.equal(blocked.paletteDisplay, "grid", "desktop swatches are visible");

    // The picker stays available as a recovery surface: it opens with an explicit empty state and
    // returns focus to its opener.
    await page.click("#smart-colors-workbench-open-picker");
    const blockedPicker = await page.evaluate(() => ({
      open: document.getElementById("smart-colors-workbench-picker").open,
      focused: document.activeElement && document.activeElement.id,
      count: document.getElementById("smart-colors-workbench-use-count").textContent,
      results: document.querySelectorAll("#smart-colors-workbench-uses .wb-use").length,
      currentUse: document.getElementById("smart-colors-workbench-current-use").textContent,
    }));
    assert.equal(blockedPicker.open, true);
    assert.equal(blockedPicker.focused, "smart-colors-workbench-use-search");
    assert.match(blockedPicker.count, /Nessun uso disponibile|Nessun uso corrisponde/);
    assert.equal(blockedPicker.results, 0);
    assert.match(blockedPicker.currentUse, /Nessun uso disponibile/);
    await page.click("#smart-colors-workbench-close-picker");
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "smart-colors-workbench-open-picker");

    // The theme radio remains operable while the correction box is hidden.
    await page.click("#smart-colors-workbench-theme-dark");
    assert.equal(await page.isChecked("#smart-colors-workbench-theme-dark"), true, "the blocked user can select a recovery theme");

    // A valid visible swatch restores the result and the correction action.
    await page.click('#smart-colors-workbench [data-smart-colors-workbench="swatch"][data-token="--palette-brand"]');
    await page.waitForFunction(() => {
      const result = document.getElementById("smart-colors-workbench-result");
      const correction = document.querySelector("#smart-colors-workbench [data-smart-colors-workbench='correction']");
      return Boolean(result) && !result.hidden && Boolean(correction) && !correction.hidden;
    }, null, { timeout: 30_000 });
    const recovered = await page.evaluate(() => ({
      resultHidden: document.getElementById("smart-colors-workbench-result").hidden,
      correctionHidden: document.querySelector("#smart-colors-workbench [data-smart-colors-workbench='correction']").hidden,
      themeDark: document.getElementById("smart-colors-workbench-theme-dark").checked,
      fieldsetVisible: Boolean(document.querySelector("#banco .wb-theme-fieldset").offsetParent),
    }));
    assert.equal(recovered.resultHidden, false, "a valid source restores the result");
    assert.equal(recovered.correctionHidden, false, "a valid source restores the correction action");
    assert.equal(recovered.themeDark, true, "the selected recovery theme survives");
    assert.equal(recovered.fieldsetVisible, true, "the recovery control remains visible");

    await context.close();
  } finally {
    if (browser) await browser.close();
    if (root) await rm(root, { recursive: true, force: true });
  }
});
