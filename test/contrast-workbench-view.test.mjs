import assert from "node:assert/strict";
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
  assert.match(html, /<pre tabindex="0" aria-label="Snippet CSS della coppia, con le stesse variabili della resa"><code>color: var\(--color-primary-text\);/);
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
  assert.match(html, /Azzera i controlli della coppia/);
  assert.match(html, /Azzera tutto il tuning/);
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
  assert.match(html, /<button type="button" id="smart-colors-workbench-apply" data-smart-colors-workbench="apply" disabled>Prova proposta<\/button>/);
  assert.match(html, /Esporta CSS pubblico/);
  assert.match(html, /Seleziona il CSS esportato/);
  // The redundant restore/reset-all duplicate is gone: reset-all lives once, in the controls scope.
  assert.doesNotMatch(html, /Ripristina<\/button>/);
  assert.equal((html.match(/Azzera tutto il tuning<\/button>/g) ?? []).length, 1);
  assert.match(html, /Ambito: solo i controlli pubblici dichiarati per i due token della coppia selezionata/);
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
  assert.match(html, /<h4 id="smart-colors-workbench-proposal-before-title">Attuale<\/h4>/);
  assert.match(html, /<h4 id="smart-colors-workbench-proposal-after-title">Proposta<\/h4>/);
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
  // The selection rail is the quieter first column of the natural DOM order.
  const rail = html.indexOf('class="wb-rail"');
  const main = html.indexOf('class="wb-main"');
  assert.ok(rail >= 0 && rail < main, "the source rail precedes the comparison area in DOM order");
});

test("CONTRAST_WORKBENCH_CSS is container-query based, forced-colors aware and resource-free", () => {
  // Workspace split and specimen pair are named container queries, never viewport media queries.
  assert.match(CONTRAST_WORKBENCH_CSS, /@container preview-section \(min-width: 60rem\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /grid-template-columns: minmax\(15rem, 17rem\) minmax\(0, 1fr\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /@container wb-main \(min-width: 34rem\)/);
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /@container preview-section \(min-width: 44rem\)/);
  // The rail is a compact two-column swatch grid and the generated pairs are readable rows.
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{ display: none; gap:[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{ display: grid; \}/, "the swatches are the desktop counterpart");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-source-select \{ display: none; \}/, "the native select is fully removed on desktop, not an invisible focus stop");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-swatch \{[^}]*height: 44px;[^}]*\}/, "every source target is 44px high");
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /wb-swatch-role/, "the compact rail drops the secondary role");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-theme-fieldset \{[^}]*border: 0;/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-uses \{[^}]*display: grid/);
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /border-radius: 999px/);
  assert.match(CONTRAST_WORKBENCH_CSS, /@media \(forced-colors: active\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /@media print/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-proposal-frames\[hidden\] \{ display: none; \}/, "the hidden attribute must beat the grid display");
  // The hidden rules must live in `layout`, otherwise the later `layout` grid rule would win the cascade.
  const layoutLayer = CONTRAST_WORKBENCH_CSS.indexOf("@layer layout {");
  const preferencesLayer = CONTRAST_WORKBENCH_CSS.indexOf("@layer preferences {");
  const hiddenRule = CONTRAST_WORKBENCH_CSS.indexOf(".wb-proposal-frames[hidden]");
  assert.ok(layoutLayer >= 0 && hiddenRule > layoutLayer && hiddenRule < preferencesLayer, "the hidden rule sits in the layout layer with the grid it overrides");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-proposal-frames \.wb-frame \{ overflow: auto; overscroll-behavior: contain; \}/, "proposal containers scroll locally instead of clipping");
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-frame \{ min-height: 7rem;[^}]*overflow: hidden; \}/, "the main views keep clipping");
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /@import|url\(|https?:/i);
  assert.doesNotMatch(CONTRAST_WORKBENCH_CSS, /position:\s*fixed/);
});

test("the static workspace separates source values from the generated catalogue and shows the pair identity outside the closed details", () => {
  const html = renderContrastWorkbench(workbenchSession());
  // Rail copy is short and explicit; the detailed source archive owns role metadata.
  assert.match(html, /Colori originali da palette\.css\./);
  assert.match(html, /Abbinamenti generati, non usi rilevati nel sito\./);
  assert.doesNotMatch(html, /Valori dichiarati nel file di palette del progetto; non sono una scansione del sito/);
  assert.match(html, /Coppia dal catalogo generato/);
  assert.match(html, /Solo coppie presenti nella diagnostica generata; nessuna coppia inventata\./);
  assert.match(html, /<span class="wb-use-kind">testo<\/span>/);
  // The compact source select is promoted into the rail as the single instance, before the swatches.
  const rail = html.indexOf('class="wb-rail"');
  const sourceSelect = html.indexOf('id="smart-colors-workbench-source"');
  const swatches = html.indexOf('class="wb-palette"');
  const main = html.indexOf('class="wb-main"');
  assert.ok(rail >= 0 && sourceSelect > rail && sourceSelect < swatches && swatches < main, "the rail owns the only source select and the desktop swatches");
  assert.equal((html.match(/id="smart-colors-workbench-source"/g) ?? []).length, 1, "the native source select exists exactly once");
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
  assert.match(html, /Testo normale · soglia AA 4,5:1 \(SC 1\.4\.3\)\. Il corpo del campione è da 16 px\./);
  assert.doesNotMatch(html, /titolo 22 px non bold/);
  // The mode form stays above the specimen; the theme fieldset moves next to the correction action
  // but keeps its form association.
  const modeForm = html.indexOf('id="smart-colors-workbench-selection"');
  const frames = html.indexOf('id="smart-colors-workbench-left"');
  const correction = html.indexOf('id="smart-colors-workbench-suggestions-title"');
  const themeFieldset = html.indexOf('class="wb-fieldset wb-theme-fieldset"');
  assert.ok(modeForm >= 0 && modeForm < frames, "the mode radio form stays above the specimen");
  assert.ok(themeFieldset >= 0 && themeFieldset < correction, "the theme recovery fieldset precedes the correction section");
  assert.ok(themeFieldset < html.indexOf('<section class="wb-suggestions"'), "the theme fieldset is outside the correction box");
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
  // Manual and export stay closed; no detail is opened by the build.
  assert.match(html, /<details class="is-detail wb-advanced"[^>]*><summary>Modifica manualmente \(avanzato\)<\/summary>/);
  assert.match(html, /<details class="is-detail wb-export"[^>]*><summary>Esporta modifiche<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
});

test("the compact rail keeps 16 source buttons at 44px targets and uses the native select on narrow containers", () => {
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
  assert.match(html, /class="wb-field wb-source-select"/, "the single native source select lives in the rail");
  assert.equal((html.match(/id="smart-colors-workbench-source"/g) ?? []).length, 1);
  // Eight rows of 44px targets (352px) plus the 4px grid gaps; the swatches are desktop-only.
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-swatch \{[^}]*height: 44px;[^}]*\}/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{ display: none; gap: var\(--space-1\); grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(CONTRAST_WORKBENCH_CSS, /\.wb-palette \{ display: grid; \}/);
  assert.doesNotMatch(html, /wb-swatch-role/, "the compact rail drops the human role");
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
    addEventListener(type, handler) { (this.listeners[type] = this.listeners[type] || []).push(handler); },
    dispatch(type, event) { (this.listeners[type] || []).forEach((handler) => handler(event ?? { type, preventDefault() {} })); },
    focus() { this.focused = true; },
    select() { this.selectedText = true; },
    setSelectionRange() {},
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
  const usesBox = makeNode("div"); usesBox.setAttribute("data-smart-colors-workbench", "uses"); host.appendChild(usesBox);
  const current = register(makeNode("p"), "smart-colors-workbench-current");
  const identity = register(makeNode("p"), "smart-colors-workbench-identity"); identity.setAttribute("data-smart-colors-workbench", "identity");
  const purpose = register(makeNode("p"), "smart-colors-workbench-purpose"); purpose.setAttribute("data-smart-colors-workbench", "purpose");
  const actionTheme = register(makeNode("p"), "smart-colors-workbench-action-theme"); actionTheme.setAttribute("data-smart-colors-workbench", "action-theme");
  const resultBox = register(makeNode("div"), "smart-colors-workbench-result");
  const emptyNote = makeNode("p"); emptyNote.setAttribute("data-smart-colors-workbench", "empty"); emptyNote.hidden = true; register(emptyNote, "smart-colors-workbench-empty");
  const correctionBox = makeNode("section"); correctionBox.setAttribute("data-smart-colors-workbench", "correction"); host.appendChild(correctionBox);
  const manualBox = makeNode("details"); manualBox.setAttribute("data-smart-colors-workbench", "manual"); host.appendChild(manualBox);
  const exportBox = makeNode("details"); exportBox.setAttribute("data-smart-colors-workbench", "export"); host.appendChild(exportBox);

  const source = register(makeNode("select"), "smart-colors-workbench-source");
  for (const value of ["", "--palette-brand", "--palette-canvas"]) { const option = optionOf(value || "all", {}); option.value = value; source.appendChild(option); }
  source.value = "--palette-brand";
  const pair = register(makeNode("select"), "smart-colors-workbench-pair");
  const primary = optionOf("--color-primary-text|--color-primary-surface|text", {
    "data-fg": "--color-primary-text", "data-bg": "--color-primary-surface", "data-kind": "text",
    "data-usage": "Testo della famiglia primaria", "data-sources": "--palette-brand",
    "data-fg-sources": "--palette-brand", "data-bg-sources": "--palette-canvas --palette-brand",
    "data-thresholds": "4.5,4.6;4.5,4.6",
  });
  primary.selected = true;
  const text = optionOf("--color-text|--color-bg|text", {
    "data-fg": "--color-text", "data-bg": "--color-bg", "data-kind": "text",
    "data-usage": "Testo sulla pagina", "data-sources": "--palette-canvas",
    "data-fg-sources": "--palette-canvas", "data-bg-sources": "--palette-canvas",
    "data-thresholds": "4.5,4.6;",
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
  register(makeNode("button"), "smart-colors-workbench-export");
  register(makeNode("textarea"), "smart-colors-workbench-export-text");
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

  const document = {
    activeElement: null,
    getElementById: (id) => registry.get(id) ?? null,
    createElement: (tag) => makeNode(tag),
  };
  return { host, status, selection, controlsForm, source, pair, themeLight, themeDark, comparisonThemes, comparisonTuning, comparisonDraft, controlsBody, proposal, proposalFrames, proposalBefore, proposalAfter, usesBox, current, identity, purpose, actionTheme, resultBox, emptyNote, correctionBox, manualBox, exportBox, swatchBrand, swatchCanvas, swatchOrphan, document };
}

function controllerStub(options = {}) {
  const calls = { mount: [], select: [], setOverride: [], reset: [], suggest: [], apply: [], unsubscribed: false, destroy: 0 };
  let state = options.state ?? { phase: "idle", revision: 0, selection: { pairId: null, theme: "light", comparison: "themes" }, draft: {}, views: [], suggestion: null, error: null };
  let listener = null;
  return {
    calls,
    state: () => state,
    publish(next) { state = next; if (listener) listener(next); },
    subscribe(handler) { listener = handler; return () => { listener = null; calls.unsubscribed = true; }; },
    pairs: options.pairs ?? (() => [
      { id: "light|color|--color-primary-text|--color-primary-surface", foreground: "--color-primary-text", background: "--color-primary-surface", property: "color" },
      { id: "light|color|--color-text|--color-bg", foreground: "--color-text", background: "--color-bg", property: "color" },
    ]),
    mount(argument) { calls.mount.push(argument); return Promise.resolve(); },
    select(argument) { calls.select.push(argument); return Promise.resolve(); },
    setOverride(control, value) { calls.setOverride.push([control, value]); return Promise.resolve(); },
    reset(control) { calls.reset.push(control); return Promise.resolve(); },
    suggest(side) { calls.suggest.push(side); return Promise.resolve(); },
    applySuggestion() { calls.apply.push(true); return Promise.resolve(); },
    exportTuning() { return typeof options.tuning === "function" ? options.tuning() : (options.tuning ?? ":root { --color-tune-primary-text-light: oklch(0.4 0.1 250); }"); },
    destroy() { calls.destroy += 1; },
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function install(session, controller = controllerStub()) {
  const dom = workbenchDom(session);
  const view = createContrastWorkbenchView({ document: dom.document, controller });
  return { dom, controller, view };
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
  assert.match(flat(dom.purpose), /Testo normale · soglia AA 4,5:1 \(SC 1\.4\.3\)\. Il corpo del campione è da 16 px\./);
  assert.doesNotMatch(flat(dom.purpose), /titolo 22 px non bold/, "the actual 650 title is never claimed as bold or non-bold large text");
  assert.match(dom.status.className, /wb-visually-hidden/, "routine complete status is visually hidden but remains a live region");
  assert.doesNotMatch(left, /Contrasto sufficiente|Contrasto insufficiente/, "no universal pass/fail badge survives");
  // The two threshold rows are DIRECT semantic groups of the measure <dl>: div.wb-measure-row.wb-threshold > dt/dd.
  const leftMeasureNode = dom.document.getElementById("smart-colors-workbench-left-measure");
  assert.equal(leftMeasureNode.tagName, "dl");
  const thresholdRows = leftMeasureNode.children.filter((child) => /(^|\s)wb-measure-row(\s|$)/.test(child.className) && /(^|\s)wb-threshold(\s|$)/.test(child.className));
  assert.equal(thresholdRows.length, 2, "minimum and target are two direct semantic threshold rows");
  for (const row of thresholdRows) {
    assert.equal(row.tagName, "div");
    assert.equal(row.children.map((child) => child.tagName).join(","), "dt,dd", "each threshold row is a dt/dd group");
    assert.equal(row.parentNode, leftMeasureNode, "the threshold group is a direct child of the measure dl");
  }
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
  assert.match(flat(dom.purpose), /Testo normale · soglia AA 4,5:1 \(SC 1\.4\.3\)\. Il corpo del campione è da 16 px\./);
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
  assert.match(flat(dom.purpose), /Testo normale · soglia AA 4,5:1 \(SC 1\.4\.3\)/);
});

test("an on-color specimen states only its 16px button label, never the title/note pair", () => {
  // Static build: the token shape (ink on its own fill) is enough to distinguish the on-color sample.
  const staticHtml = renderContrastWorkbench(workbenchSession({
    model: { diagnostics: [{ label: "on-primary", scheme: "light", foregroundToken: "--color-primary-ink", backgroundToken: "--color-primary", ratio: 6, minimum: 4.5, target: 4.6, kind: "text", status: "pass", provenance: "generated" }], errors: [], warnings: [] },
  }));
  assert.match(staticHtml, /Testo su riempimento · soglia AA 4,5:1 \(SC 1\.4\.3\)\. L(?:&#39;|')etichetta del campione è da 16 px\./);
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
  assert.match(flat(dom.purpose), /Testo su riempimento · soglia AA 4,5:1 \(SC 1\.4\.3\)\. L'etichetta del campione è da 16 px\./);
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
  assert.match(flat(dom.purpose), /Componente non testuale · soglia 3:1 \(SC 1\.4\.11\)/);
  assert.match(flat(dom.purpose), /per le informazioni necessarie a identificare componenti e stati/);
  assert.match(flat(dom.purpose), /bordo decorativo non è automaticamente soggetto/);
  assert.match(flat(dom.purpose), /non verifica focus, comportamento, visibilità o oscuramento/);

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

test("export writes the runtime tuning into a selectable textarea with a manual data-URI download", async () => {
  const tuning = ":root { --color-tune-primary-text-light: oklch(0.4 0.1 250); }";
  const { dom } = install(workbenchSession(), controllerStub({ tuning }));
  dom.document.getElementById("smart-colors-workbench-export").dispatch("click");
  const text = dom.document.getElementById("smart-colors-workbench-export-text");
  const download = dom.document.getElementById("smart-colors-workbench-download");
  assert.equal(text.value, tuning);
  assert.equal(download.hidden, false);
  assert.ok(download.href.startsWith("data:text/css;charset=utf-8,"));
  assert.ok(decodeURIComponent(download.href.split(",")[1]).includes("--color-tune-primary-text-light"));
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

test("narrow viewport: the verified proposal stays locally scrollable and never widens the document", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
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

    // Pick the real failing pair through the native selects, then wait for its measured shortfall.
    await page.evaluate(() => {
      const source = document.getElementById("smart-colors-workbench-source");
      const canvas = Array.from(source.options).find((option) => option.value === "--palette-canvas");
      if (canvas) { source.value = canvas.value; source.dispatchEvent(new Event("change", { bubbles: true })); }
      const pair = document.getElementById("smart-colors-workbench-pair");
      const option = Array.from(pair.options).find((item) => item.getAttribute("data-fg") === "--color-text" && item.getAttribute("data-bg") === "--color-bg");
      if (!option) throw new Error("the --color-text/--color-bg option is missing from the preview");
      pair.value = option.value;
      pair.dispatchEvent(new Event("change", { bubbles: true }));
    });
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
      const layout = document.querySelector("#banco .wb-layout");
      const rail = document.querySelector("#banco .wb-rail");
      const main = document.querySelector("#banco .wb-main");
      const results = document.getElementById("smart-colors-workbench-result");
      const railBox = rail.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      return {
        columns: getComputedStyle(layout).gridTemplateColumns.split(" ").length,
        specimenColumns: getComputedStyle(results).gridTemplateColumns.split(" ").length,
        paletteDisplay: getComputedStyle(document.querySelector("#banco .wb-palette")).display,
        sourceDisplay: getComputedStyle(document.querySelector("#banco .wb-source-select")).display,
        specimenTop: window.scrollY + document.getElementById("smart-colors-workbench-left").getBoundingClientRect().top,
        railTop: railBox.top,
        mainTop: mainBox.top,
        railWidth: railBox.width,
      };
    });
    assert.equal(narrowLayout.columns, 1, "the workspace is a single column at 320px: " + JSON.stringify(narrowLayout));
    assert.equal(narrowLayout.specimenColumns, 1, "the two specimens stack at 320px: " + JSON.stringify(narrowLayout));
    assert.equal(narrowLayout.paletteDisplay, "none", "the full swatch rail is not used at 320px: " + JSON.stringify(narrowLayout));
    assert.notEqual(narrowLayout.sourceDisplay, "none", "the compact native source select is visible at 320px");
    assert.ok(narrowLayout.specimenTop < 1200, "the result stays reasonably reachable at 320px: " + narrowLayout.specimenTop);
    assert.ok(narrowLayout.railTop < narrowLayout.mainTop, "the rail keeps the natural DOM order above the comparison at 320px");
    assert.ok(narrowLayout.railWidth <= measured.viewport, "the rail never exceeds the 320px viewport: " + narrowLayout.railWidth);
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

    // Desktop: the same DOM becomes the two-column workspace inside the preview container.
    await page.setViewportSize({ width: 1280, height: 900 });
    const wideLayout = await page.evaluate(() => {
      const layout = document.querySelector("#banco .wb-layout");
      const rail = document.querySelector("#banco .wb-rail");
      const main = document.querySelector("#banco .wb-main");
      const results = document.getElementById("smart-colors-workbench-result");
      const railBox = rail.getBoundingClientRect();
      const mainBox = main.getBoundingClientRect();
      const sourceBox = document.querySelector("#banco .wb-source-select");
      return {
        columns: getComputedStyle(layout).gridTemplateColumns.split(" ").length,
        specimenColumns: getComputedStyle(results).gridTemplateColumns.split(" ").length,
        paletteDisplay: getComputedStyle(document.querySelector("#banco .wb-palette")).display,
        sourceDisplay: getComputedStyle(sourceBox).display,
        specimenTop: window.scrollY + document.getElementById("smart-colors-workbench-left").getBoundingClientRect().top,
        railWidth: railBox.width,
        railTop: railBox.top,
        mainTop: mainBox.top,
        railLeft: railBox.left,
        mainLeft: mainBox.left,
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
      };
    });
    assert.equal(wideLayout.columns, 2, "the workspace splits into rail + comparison: " + JSON.stringify(wideLayout));
    assert.equal(wideLayout.specimenColumns, 2, "light and dark specimens sit side by side: " + JSON.stringify(wideLayout));
    assert.equal(wideLayout.paletteDisplay, "grid", "the swatch rail is the desktop counterpart");
    assert.equal(wideLayout.sourceDisplay, "none", "the native select is removed on desktop, with no invisible focus stop: " + JSON.stringify(wideLayout));
    assert.ok(wideLayout.specimenTop < 450, "the specimen starts above 450px at 1280: " + wideLayout.specimenTop);
    assert.ok(wideLayout.railWidth >= 240 && wideLayout.railWidth <= 272, "the selection rail keeps its 15-17rem width: " + wideLayout.railWidth);
    assert.ok(Math.abs(wideLayout.railTop - wideLayout.mainTop) <= 1, "rail and comparison start on the same row");
    assert.ok(wideLayout.mainLeft > wideLayout.railLeft, "the comparison area is the right column");
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
    assert.equal(blocked.sourceDisplay, "none", "desktop uses the swatch counterpart, not a hidden focusable select");
    assert.equal(blocked.paletteDisplay, "grid", "desktop swatches are visible");

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
