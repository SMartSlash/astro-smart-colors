/**
 * End-to-end integration proof for the guided contrast workbench.
 *
 * This is deliberately NOT the runtime-only proof in `contrast-workbench-runtime.test.mjs`.
 * Here the product's OWN emitted preview is produced from a real temporary consumer project
 * through `createDiagnosticSession` + `formatContrastPreviewHtml` (the same session -> preview
 * path the CLI uses), opened as a `file://` document in an already-installed Chromium, and driven
 * exclusively through the rendered UI: the source swatches, the "Cambia uso" picker dialog, the
 * technical pair fallback, the theme/comparison radios, the override inputs and the
 * suggestion/apply/export/reset buttons. No runtime controller method is called to shortcut a UI
 * path and no fixture is a hand-built HTML stub, so a breakage in the emitted markup, the wiring,
 * or the real frames surfaces here.
 *
 * The fixtures are temporary consumer projects: a deliberately failing tuning with a known fix, an
 * arbitrary (hyphenated/digit) family name, a hostile-bytes palette, stale/empty outputs, and a
 * 16-source/136-pair catalogue that exercises picker search, categories and pagination. No project
 * input is ever read or written outside the temporary directory; no server and no network are used.
 *
 * Opt-in, same convention as the other native proofs: set `SMART_COLORS_NATIVE_PROOF=1`. The
 * browser must already be installed; the resolution never downloads anything.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDiagnosticSession } from "../src/diagnostic-session.mjs";
import { runDiagnosticWorkflow } from "../src/diagnostic-workflow.mjs";
import { formatContrastPreviewHtml } from "../src/format-report-preview.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { createVerificationCore } from "../src/verification-core.mjs";
import { WORKBENCH_RUNTIME_GLOBAL } from "../src/contrast-workbench-runtime.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, "../../..");
const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";
const OPT_IN = "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium integration proof";
const core = createVerificationCore();

const PALETTE_PATH = "src/styles/tokens/palette.css";
const OUTPUT_PATH = "src/styles/tokens/colors.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const CONFIG_PATH = "smart-colors.config.mjs";

// `<` in the JSON is escaped as `\u003c`, so the inert payload can never close a tag even before the
// browser reads it. A comment carrying a script-close + script-open is the strongest captured-bytes
// probe: it reaches the palette textarea AND the payload verbatim.
const HOSTILE = "</script><script>window.__pwned=1</script>";

// A dynamic family name (digits + hyphen) and a light text override that drops `--color-text` below
// the 4.5 minimum at runtime without touching the generator's model: the temporary failure the
// suggestion flow must repair. A second override collapses the `--color-lagoon2-ink` pair so it is
// repairable from EITHER side (foreground and background).
const MAIN_PALETTE = [
  '@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.97 0.005 250); role: canvas; }',
  '@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.28 0.01 250); role: ink; }',
  '@property --palette-lagoon2 { syntax: "<color>"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; }',
  '@property --palette-sea-gull { syntax: "<color>"; inherits: true; initial-value: oklch(0.7 0.1 180); role: feedback; }',
  "",
].join("\n");
const MAIN_TUNING = [
  ":root {",
  "  --color-tune-text-light: oklch(0.66 0 0);",
  "  --color-tune-lagoon2-ink-light: oklch(0.52 0.13 255);",
  "}",
  "",
].join("\n");

const HOSTILE_PALETTE = `/* ${HOSTILE} */\n${MAIN_PALETTE}`;
const HOSTILE_TUNING = `:root {\n  --color-tune-text-light: oklch(0.66 0 0);\n} /* ${HOSTILE} */\n`;

// Reproduces the real root split: the static build-time renderer prioritizes a decorative pair whose
// title sorts first (the `warm` name is a NON_BASE suffix, so its pair title falls back to the raw
// tokens and sorts before "Testo sulla pagina"), while the runtime measures the neutral `--color-text`
// on `--color-bg` first. The initial DOM must therefore be re-projected from the runtime, and a
// decorative pair that carries no failure must never be shown next to a different measured pair.
const MISMATCH_PALETTE = [
  '@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.97 0.005 250); role: canvas; }',
  '@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.28 0.01 250); role: ink; }',
  '@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; }',
  '@property --palette-warm { syntax: "<color>"; inherits: true; initial-value: oklch(0.68 0.17 55); role: decorative; }',
  "",
].join("\n");
const MISMATCH_TUNING = [
  ":root {",
  "  --color-tune-text-light: oklch(0.66 0 0);",
  "}",
  "",
].join("\n");

// A deliberately broad catalogue: MAIN_PALETTE contributes canvas/ink plus two identities,
// then six more identities and six decoratives produce 16 palette sources and 136 unique pairs.
// `citta` is intentionally a friendly multiword family so the picker can be searched with an
// accented query ("callout città") and still fold to the authored ASCII token name.
const LARGE_PALETTE = `${MAIN_PALETTE}${[
  '@property --palette-citta { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.16 25); role: ui; }',
  '@property --palette-foresta { syntax: "<color>"; inherits: true; initial-value: oklch(0.5 0.12 145); role: ui; }',
  '@property --palette-montagna { syntax: "<color>"; inherits: true; initial-value: oklch(0.45 0.08 280); role: feedback; }',
  '@property --palette-deserto { syntax: "<color>"; inherits: true; initial-value: oklch(0.68 0.11 70); role: ui; }',
  '@property --palette-corallo { syntax: "<color>"; inherits: true; initial-value: oklch(0.64 0.18 15); role: feedback; }',
  '@property --palette-notte { syntax: "<color>"; inherits: true; initial-value: oklch(0.4 0.1 300); role: ui; }',
  '@property --palette-grano { syntax: "<color>"; inherits: true; initial-value: oklch(0.78 0.12 95); role: decorative; }',
  '@property --palette-sabbia { syntax: "<color>"; inherits: true; initial-value: oklch(0.82 0.06 80); role: decorative; }',
  '@property --palette-rame { syntax: "<color>"; inherits: true; initial-value: oklch(0.66 0.13 45); role: decorative; }',
  '@property --palette-salvia { syntax: "<color>"; inherits: true; initial-value: oklch(0.7 0.09 150); role: decorative; }',
  '@property --palette-lavanda { syntax: "<color>"; inherits: true; initial-value: oklch(0.72 0.1 300); role: decorative; }',
  '@property --palette-arancio { syntax: "<color>"; inherits: true; initial-value: oklch(0.75 0.16 60); role: decorative; }',
  "",
].join("\n")}`;
const LARGE_SOURCE_COUNT = 16;
const LARGE_PAIR_COUNT = 136;
const ROOT_INPUTS = [PALETTE_PATH, OUTPUT_PATH, TUNING_PATH, CONFIG_PATH];
// The preview budget under test (the report harness's MAX_PREVIEW_BYTES) and the legacy cap it must
// provably exceed. Kept as literals so the integration proof is independent of the harness constant.
const PREVIEW_BUDGET_BYTES = 786_432;
const LEGACY_PREVIEW_BYTES = 225_280;

let playwright = null;
let browser = null;
let mainContext = null;
let staticContext = null;
let root = null;
let main = null;

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

// Mirror of the report harness: resolve the already-installed Playwright from the workspace root.
// A missing resolution is a BLOCKED failure, never a silent skip.
function resolvePlaywright() {
  const base = createRequire(path.join(WORKSPACE_ROOT, "package.json"));
  for (const request of ["@playwright/test", "playwright"]) {
    let api;
    try {
      api = base(request);
    } catch {
      continue;
    }
    const browsers = api && api.chromium ? api : api && api.default ? api.default : null;
    if (browsers && browsers.chromium) return browsers;
  }
  throw new Error("BLOCKED: Playwright is not resolvable from the workspace root " + WORKSPACE_ROOT + "; the opted-in browser proof is mandatory and cannot be skipped.");
}

async function writeConsumer(target, { palette, tuning = null, generate = true, emptyOutput = false, appendOutput = null }) {
  await mkdir(path.join(target, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(target, PALETTE_PATH), palette, "utf8");
  await writeFile(path.join(target, CONFIG_PATH), "// Integration fixture configuration; no source regeneration here.\nexport default {};\n", "utf8");
  if (generate) {
    const report = await generateColorTokens({ root: target, suggest: false });
    assert.equal(report.config.palette, PALETTE_PATH);
    assert.equal(report.config.output, OUTPUT_PATH);
  }
  if (emptyOutput) await writeFile(path.join(target, OUTPUT_PATH), "", "utf8");
  if (appendOutput) await writeFile(path.join(target, OUTPUT_PATH), (await readFile(path.join(target, OUTPUT_PATH), "utf8")) + appendOutput, "utf8");
  if (tuning !== null) await writeFile(path.join(target, TUNING_PATH), tuning, "utf8");
  return target;
}

// The whole product preview, from the real session. Returns the session too, so the proof can assert
// the honest provenance (digest/status) the payload was built from.
async function buildPreview(target, { keepSession = false } = {}) {
  const built = await createDiagnosticSession({ root: target, suggest: false });
  const html = formatContrastPreviewHtml(built.session);
  const file = path.join(target, "reports/smart-colors-preview.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
  return { session: built.session, file, html };
}

async function snapshotTree(target) {
  const result = [];
  async function walk(relative) {
    const entries = await readdir(path.join(target, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else {
        const info = await stat(path.join(target, name));
        result.push([name, info.size, info.mtimeMs, sha256Hex(await readFile(path.join(target, name), "utf8"))]);
      }
    }
  }
  await walk("");
  return result;
}

function isRemote(url) {
  return /^(?:https?|ws|wss):/i.test(String(url));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Read-only digest of the four consumer inputs, used to prove a session/preview run never mutated them.
async function hashInputs(target) {
  const result = {};
  for (const file of ROOT_INPUTS) result[file] = sha256Hex(await readFile(path.join(target, file), "utf8"));
  return result;
}

async function openPage(context, file, options = {}) {
  const requests = [];
  const blocked = [];
  const consoleErrors = [];
  const pageErrors = [];
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  if (options.viewport) await page.setViewportSize(options.viewport);
  page.on("request", (request) => requests.push(request.url()));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 });
  return { page, requests, blocked, consoleErrors, pageErrors };
}

async function openWorkbenchPage(context, file, options = {}) {
  const opened = await openPage(context, file, options);
  await opened.page.waitForFunction((name) => Boolean(window[name]), WORKBENCH_RUNTIME_GLOBAL, { timeout: 20_000 });
  await settle(opened.page);
  return opened;
}

function settle(page) {
  return page.waitForFunction((name) => {
    const controller = window[name];
    return Boolean(controller && ["complete", "incomplete", "unavailable"].includes(controller.state().phase));
  }, WORKBENCH_RUNTIME_GLOBAL, { timeout: 30_000 });
}

function settleSuggestion(page) {
  return page.waitForFunction((name) => {
    const controller = window[name];
    if (!controller || controller.state().suggestion === null) return false;
    const button = document.querySelector("#smart-colors-workbench-suggest-foreground");
    return Boolean(button && !button.disabled);
  }, WORKBENCH_RUNTIME_GLOBAL, { timeout: 40_000 });
}

const state = (page) => page.evaluate((name) => window[name].state(), WORKBENCH_RUNTIME_GLOBAL);

// Pair metadata is read from the technical fallback select, but the pair is chosen through the
// primary "Cambia uso" picker. The technical select is never used as a selection shortcut.
function optionFor(page, { fg, bg, kind }) {
  return page.evaluate((query) => {
    const options = Array.from(document.querySelectorAll("#smart-colors-workbench-pair option"));
    const match = options.find((option) => {
      if (query.fg !== undefined && option.getAttribute("data-fg") !== query.fg) return false;
      if (query.bg !== undefined && option.getAttribute("data-bg") !== query.bg) return false;
      if (query.kind !== undefined && option.getAttribute("data-kind") !== query.kind) return false;
      return true;
    });
    return match ? {
      value: match.value,
      usage: match.getAttribute("data-usage"),
      sources: match.getAttribute("data-sources"),
      fgSources: match.getAttribute("data-fg-sources"),
      bgSources: match.getAttribute("data-bg-sources"),
      bucket: match.getAttribute("data-use-bucket"),
      hidden: match.hidden,
    } : null;
  }, { fg, bg, kind });
}

function tokensOf(value) {
  return String(value || "").split(/\s+/).filter(Boolean);
}

async function openUsePicker(page) {
  await page.click("#smart-colors-workbench-open-picker");
  await page.waitForFunction(() => {
    const dialog = document.getElementById("smart-colors-workbench-picker");
    return Boolean(dialog && dialog.open);
  }, null, { timeout: 5_000 });
}

function pickerTotal(page) {
  return page.evaluate(() => {
    const text = document.getElementById("smart-colors-workbench-use-count").textContent || "";
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) : null;
  });
}

function pickerPageValues(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-uses button.wb-use"))
    .map((button) => button.getAttribute("data-pair-value")));
}

async function ensurePairSource(page, option) {
  const current = await page.evaluate(() => document.getElementById("smart-colors-workbench-source").value);
  if (current === "") return;
  const foreground = tokensOf(option.fgSources);
  const all = tokensOf(option.sources);
  // Prefer a source where the pair is a foreground use, so it cannot be filtered out of the
  // source's preferred-use pool. Fall back to any declared source only when necessary.
  if (foreground.length && !foreground.includes(current)) {
    await selectSource(page, foreground[0]);
    return;
  }
  if (!all.includes(current) && (foreground.length || all.length)) await selectSource(page, foreground[0] || all[0]);
}

// Advanced selects, manual controls and the export live inside closed native details so the primary
// surface stays light. A real user opens them first, so the proof opens them before interacting.
async function revealDetails(page, selector = "#smart-colors-workbench details") {
  await page.evaluate((query) => {
    for (const details of document.querySelectorAll(query)) details.open = true;
  }, selector);
}

async function choosePair(page, query) {
  const option = await optionFor(page, query);
  assert.ok(option, "no real pair option for " + JSON.stringify(query));
  await ensurePairSource(page, option);
  await openUsePicker(page);
  const [foreground, background] = option.value.split("|");
  // The picker searches usage, foreground and background concatenated. The two exact tokens are
  // adjacent, so this is a real user query (not a controller shortcut) that always selects one pair.
  await page.fill("#smart-colors-workbench-use-search", [foreground, background].filter(Boolean).join(" "));
  await page.waitForFunction((value) => {
    const button = Array.from(document.querySelectorAll("#smart-colors-workbench-uses button.wb-use"))
      .find((node) => node.getAttribute("data-pair-value") === value);
    return Boolean(button && button.checkVisibility());
  }, option.value, { timeout: 10_000 });
  await page.click(`#smart-colors-workbench-uses button.wb-use[data-pair-value="${option.value}"]`);
  await page.waitForFunction(({ name, foreground, background }) => {
    const current = window[name].state();
    return Boolean(current && current.selection && current.selection.pairId
      && current.selection.pairId.includes(foreground) && current.selection.pairId.includes(background));
  }, { name: WORKBENCH_RUNTIME_GLOBAL, foreground, background }, { timeout: 10_000 });
  await settle(page);
  // Existing manual/snippet assertions work on the technical disclosure; open it only after the
  // primary picker flow so the picker itself is exercised first.
  await revealDetails(page);
  return option;
}

// The baseline/tuned split is the "tuning" comparison; the workbench starts on the light/dark
// ("themes") comparison, so a baseline-vs-candidate proof selects it explicitly.
async function selectComparison(page, value) {
  await page.click("#smart-colors-workbench-comparison-" + value);
  await settle(page);
  return state(page);
}

// Real source choice: use the visible native swatch on desktop, then settle. The source select is
// mobile-only and display:none at the integration viewport.
async function selectSource(page, token) {
  await page.click(`#smart-colors-workbench [data-smart-colors-workbench="swatch"][data-token="${token}"]`);
  await settle(page);
}

function measurement(page, slot) {
  return page.evaluate(({ name, slot }) => {
    const view = window[name].state().views.find((entry) => entry.slot === slot);
    return view ? { variant: view.variant, theme: view.theme, property: view.pair && view.pair.property, ratio: view.measurement && view.measurement.ratio, status: view.measurement && view.measurement.status, foreground: view.measurement && view.measurement.foreground, background: view.measurement && view.measurement.background, pair: view.pair } : null;
  }, { name: WORKBENCH_RUNTIME_GLOBAL, slot });
}

function selectedSpecimen(page, slot) {
  return page.evaluate((slot) => {
    const frame = document.querySelector(`iframe[data-smart-colors-workbench-slot="${slot}"]`);
    if (!frame || !frame.contentDocument) return null;
    const doc = frame.contentDocument;
    const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
    if (!node) return null;
    const style = frame.contentWindow.getComputedStyle(node);
    return {
      tag: node.tagName,
      inlineStyle: node.getAttribute("style") || "",
      foreground: node.getAttribute("data-smart-colors-foreground"),
      background: node.getAttribute("data-smart-colors-background"),
      property: node.getAttribute("data-smart-colors-property"),
      color: style.color,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      outlineColor: style.outlineColor,
      text: node.textContent,
      childCount: node.children.length,
      role: node.getAttribute("role"),
      ariaLabel: node.getAttribute("aria-label"),
      scripts: doc.querySelectorAll("script").length,
    };
  }, slot);
}

// A visible proposal frame (base/candidate), identified by its slot, not by a serialized swatch.
function proposalFrame(page, slot) {
  return page.evaluate((slot) => {
    const frame = document.querySelector(`iframe[data-smart-colors-workbench-frame="proposal"][data-smart-colors-workbench-slot="${slot}"]`);
    if (!frame || !frame.contentDocument) return null;
    const doc = frame.contentDocument;
    const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
    if (!node) return null;
    const style = frame.contentWindow.getComputedStyle(node);
    return {
      slot,
      theme: frame.getAttribute("data-smart-colors-workbench-theme"),
      variant: frame.getAttribute("data-smart-colors-workbench-variant"),
      width: Math.round(frame.getBoundingClientRect().width),
      height: Math.round(frame.getBoundingClientRect().height),
      inlineStyle: node.getAttribute("style") || "",
      color: style.color,
      backgroundColor: style.backgroundColor,
      scripts: doc.querySelectorAll("script").length,
    };
  }, slot);
}

before(async () => {
  if (!NATIVE_PROOF) return;
  playwright = resolvePlaywright();
  browser = await playwright.chromium.launch({ headless: true, timeout: 60_000 });
  root = await mkdtemp(path.join(tmpdir(), "smart-colors-workbench-integration-"));
  // One guard route per context: only the document navigation may proceed; everything else is
  // aborted and recorded, so any egress shows up as a blocked remote request.
  const guard = async (context) => {
    context.__requests = [];
    await context.route("**/*", (route) => {
      const request = route.request();
      context.__requests.push(request.url());
      if (request.isNavigationRequest() && request.resourceType() === "document") return route.continue();
      return route.abort();
    });
  };
  mainContext = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce", viewport: { width: 1100, height: 900 } });
  staticContext = await browser.newContext({ javaScriptEnabled: false, reducedMotion: "reduce", viewport: { width: 1100, height: 900 } });
  await guard(mainContext);
  await guard(staticContext);

  const mainRoot = await writeConsumer(path.join(root, "main"), { palette: MAIN_PALETTE, tuning: MAIN_TUNING });
  main = await buildPreview(mainRoot);

  const staleRoot = await writeConsumer(path.join(root, "stale"), { palette: MAIN_PALETTE, tuning: MAIN_TUNING });
  await appendOutputInto(staleRoot, "\n/* drift appended after generation */\n");
  main.stale = await buildPreview(staleRoot);

  const emptyRoot = await writeConsumer(path.join(root, "empty"), { palette: MAIN_PALETTE, tuning: MAIN_TUNING, emptyOutput: true });
  main.empty = await buildPreview(emptyRoot);

  const hostileRoot = await writeConsumer(path.join(root, "hostile"), { palette: HOSTILE_PALETTE, tuning: HOSTILE_TUNING });
  main.hostile = await buildPreview(hostileRoot);
  main.hostileDir = hostileRoot;

  const mismatchRoot = await writeConsumer(path.join(root, "mismatch"), { palette: MISMATCH_PALETTE, tuning: MISMATCH_TUNING });
  main.mismatch = await buildPreview(mismatchRoot);
  main.mismatchDir = mismatchRoot;

  const largeRoot = await writeConsumer(path.join(root, "large"), { palette: LARGE_PALETTE });
  main.large = await buildPreview(largeRoot);
});

async function appendOutputInto(target, text) {
  await writeFile(path.join(target, OUTPUT_PATH), (await readFile(path.join(target, OUTPUT_PATH), "utf8")) + text, "utf8");
}

after(async () => {
  if (browser) await browser.close();
  if (root) await rm(root, { recursive: true, force: true });
});

test("generated preview leads with the workbench over the raw source archive and keeps current baseline/tuning provenance", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  assert.equal(main.session.css.status, "current", "the generated output must be the current baseline");
  assert.equal(main.session.css.tuningSupport, "supported", "the fixture tuning must be evaluated");
  const paletteText = await readFile(path.join(root, "main", PALETTE_PATH), "utf8");
  const { page, requests, pageErrors, consoleErrors } = await openWorkbenchPage(mainContext, main.file);
  try {
    const view = await page.evaluate(() => ({
      palette: document.getElementById("palette").textContent,
      workbenchBeforePalette: document.getElementById("banco").compareDocumentPosition(document.getElementById("palette")) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      paletteBeforeDiagnostics: document.getElementById("palette").compareDocumentPosition(document.getElementById("diagnostica")) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
      cssSource: document.getElementById("contenuto").textContent,
      themesRadioChecked: document.getElementById("smart-colors-workbench-comparison-themes").checked,
      tuningRadioChecked: document.getElementById("smart-colors-workbench-comparison-tuning").checked,
      tuningRadioDisabled: document.getElementById("smart-colors-workbench-comparison-tuning").disabled,
      leftMeasure: document.getElementById("smart-colors-workbench-left-measure").textContent,
      rightMeasure: document.getElementById("smart-colors-workbench-right-measure").textContent,
      options: Array.from(document.querySelectorAll("#smart-colors-workbench-pair option")).map((option) => ({
        usage: option.getAttribute("data-usage"),
        fg: option.getAttribute("data-fg"),
      })),
    }));
    assert.equal(view.workbenchBeforePalette, true, "the guided workbench leads the raw source archive");
    assert.equal(view.paletteBeforeDiagnostics, true, "the raw source archive precedes the technical archive");
    // Declared roles, verbatim from the authored @property annotations.
    assert.match(view.palette, /--palette-canvas · ruolo dichiarato: sfondo della pagina/);
    assert.match(view.palette, /--palette-ink · ruolo dichiarato: testo di base/);
    assert.match(view.palette, /--palette-lagoon2 · ruolo dichiarato: interfaccia/);
    assert.match(view.palette, /--palette-sea-gull · ruolo dichiarato: feedback/);
    // The raw authored value is labelled as the raw value, never the live rendering.
    assert.match(view.palette, /Valore sorgente dichiarato: oklch\(0\.7 0\.1 180\)/);
    assert.match(view.palette, /valore grezzo, non la resa live/);
    // Real palette provenance: the path and the first 12 hex of the real file digest.
    assert.match(view.palette, new RegExp("impronta " + sha256Hex(paletteText).slice(0, 12)));
    // An arbitrary (hyphenated) family name survives the designer lexicon verbatim in a real pair title.
    const seaGull = view.options.find((option) => option.fg === "--color-sea-gull-text");
    assert.ok(seaGull, "a sea-gull family pair must exist");
    assert.match(seaGull.usage, /sea-gull/);
    // The default is the clean light/dark comparison; the tuned comparison stays offered but unselected.
    assert.match(view.cssSource, /output attuale del progetto/);
    assert.equal(view.themesRadioChecked, true, "the idle default is the light/dark comparison");
    assert.equal(view.tuningRadioChecked, false);
    assert.equal(view.tuningRadioDisabled, false);
    assert.match(view.leftMeasure, /tuning pubblico applicato ai byte catturati/);
    assert.match(view.rightMeasure, /tuning pubblico applicato ai byte catturati/);
    assert.deepEqual(pageErrors, [], "the emitted preview must not throw");
    assert.deepEqual(consoleErrors.filter((text) => !/favicon/i.test(text)), [], "no unexpected console error");
    assert.deepEqual(requests.filter(isRemote), [], "the preview must make no network request");
  } finally {
    await page.close();
  }
});

test("the visible frames are real var(--color-*) consumer nodes that drive the measurement, and theme radios/headings follow the state", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page, requests } = await openWorkbenchPage(mainContext, main.file);
  try {
    const initial = await state(page);
    assert.deepEqual(initial.selection, { pairId: "light|color|--color-text|--color-bg", theme: "light", comparison: "themes" });
    const ui = await page.evaluate(() => ({
      light: document.getElementById("smart-colors-workbench-theme-light").checked,
      dark: document.getElementById("smart-colors-workbench-theme-dark").checked,
      themes: document.getElementById("smart-colors-workbench-comparison-themes").checked,
      tuning: document.getElementById("smart-colors-workbench-comparison-tuning").checked,
      draft: document.getElementById("smart-colors-workbench-comparison-draft").checked,
      leftTitle: document.getElementById("smart-colors-workbench-left-title").textContent,
      rightTitle: document.getElementById("smart-colors-workbench-right-title").textContent,
    }));
    assert.equal(ui.light, true);
    assert.equal(ui.themes, true);
    assert.equal(ui.tuning, false);
    assert.equal(ui.draft, false);
    // The idle default is the clean light/dark comparison: neutral theme titles, not left/right labels.
    assert.equal(ui.leftTitle, "Tema chiaro");
    assert.equal(ui.rightTitle, "Tema scuro");

    // The baseline-vs-tuned split is the "tuning" comparison; select it as a real UI action.
    await selectComparison(page, "tuning");
    const split = await page.evaluate(() => ({
      leftTitle: document.getElementById("smart-colors-workbench-left-title").textContent,
      rightTitle: document.getElementById("smart-colors-workbench-right-title").textContent,
      tuning: document.getElementById("smart-colors-workbench-comparison-tuning").checked,
    }));
    assert.equal(split.tuning, true);
    assert.equal(split.leftTitle, "Attuale");
    assert.equal(split.rightTitle, "Modifica");

    // The right (tuned) view is measured from the node inside the visible frame, not from a resolved RGB.
    const baseline = await measurement(page, "left");
    const tuned = await measurement(page, "right");
    assert.ok(baseline.ratio >= 4.5, "the saved-only baseline passes");
    assert.ok(tuned.ratio < 4.5, "the tuned light view is below the minimum");
    const specimen = await selectedSpecimen(page, "right");
    assert.ok(specimen);
    assert.match(specimen.inlineStyle, /var\(--color-text\)/);
    assert.match(specimen.inlineStyle, /var\(--color-bg\)/);
    assert.equal(specimen.foreground, "--color-text");
    assert.equal(specimen.background, "--color-bg");
    assert.equal(specimen.property, "color");
    assert.equal(specimen.scripts, 0, "a measured frame carries no script");
    assert.equal(specimen.color, tuned.foreground, "the measurement reads the visible node colour");
    assert.equal(specimen.backgroundColor, tuned.background, "the measurement reads the visible node background");

    // Switching the theme is a real UI action: radio + submit, then the state, headings and frames follow.
    await revealDetails(page);
    await page.click("#smart-colors-workbench-theme-dark");
    await page.click("#smart-colors-workbench-submit");
    await settle(page);
    const dark = await state(page);
    assert.equal(dark.selection.theme, "dark");
    const after = await page.evaluate(() => ({
      leftTitle: document.getElementById("smart-colors-workbench-left-title").textContent,
      rightTitle: document.getElementById("smart-colors-workbench-right-title").textContent,
      frames: document.querySelectorAll('iframe[data-smart-colors-workbench-slot]').length,
      frameThemes: Array.from(document.querySelectorAll("iframe[data-smart-colors-workbench-slot]")).map((frame) => frame.getAttribute("data-smart-colors-workbench-theme")),
    }));
    // In the tuning comparison both views use the selected theme; the neutral titles stay.
    assert.equal(after.leftTitle, "Attuale");
    assert.equal(after.rightTitle, "Modifica");
    assert.equal(after.frames, 2, "still exactly two visible frames");
    assert.deepEqual(after.frameThemes, ["dark", "dark"]);
    assert.deepEqual(requests.filter(isRemote), []);
  } finally {
    await page.close();
  }
});

test("choosing a source then a pair, a full-color override visibly switches to the draft and the pair survives a source change", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    // A source is a real choice: it selects the source's own preferred foreground use immediately.
    await selectSource(page, "--palette-sea-gull");
    const chosen = await page.evaluate(() => {
      const select = document.getElementById("smart-colors-workbench-pair");
      const option = select.options[select.selectedIndex];
      return { value: option.value, sources: option.getAttribute("data-sources"), fgSources: option.getAttribute("data-fg-sources") };
    });
    assert.match(chosen.fgSources, /--palette-sea-gull/, "the selected use binds the sea-gull source as its foreground");

    const option = await choosePair(page, { fg: "--color-sea-gull-text", bg: "--color-sea-gull-surface" });
    assert.equal(option.hidden, false);
    let current = await state(page);
    assert.equal(current.selection.pairId, "light|color|--color-sea-gull-text|--color-sea-gull-surface");

    // The override inputs are the ones declared for this pair's tokens (they live in a native detail).
    await revealDetails(page);
    const controls = await page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-controls input"))
      .map((input) => ({ control: input.getAttribute("data-control"), kind: input.getAttribute("data-kind"), id: input.id })));
    const fg = controls.find((entry) => entry.control === "--color-tune-sea-gull-text-light");
    assert.ok(fg && fg.kind === "override", "the foreground override control must be offered: " + JSON.stringify(controls));

    await page.fill("#" + fg.id, "oklch(0.42 0.02 180)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    current = await state(page);
    assert.equal(current.selection.comparison, "draft", "a successful override shows the draft without an explicit select");
    assert.equal(current.draft["--color-tune-sea-gull-text-light"], "oklch(0.42 0.02 180)");
    const radios = await page.evaluate(() => ({
      themes: document.getElementById("smart-colors-workbench-comparison-themes").checked,
      tuning: document.getElementById("smart-colors-workbench-comparison-tuning").checked,
      draft: document.getElementById("smart-colors-workbench-comparison-draft").checked,
    }));
    assert.deepEqual(radios, { themes: false, tuning: false, draft: true });
    const draftView = await measurement(page, "right");
    assert.equal(draftView.variant, "draft");
    const specimen = await selectedSpecimen(page, "right");
    const parsed = core.parseComputedColor(specimen.color, "drafted foreground");
    assert.ok(Math.abs(parsed.l - 0.42) < 0.02, "the visible frame paints the drafted override, not the saved value");

    // Selecting another source then this one again re-resolves the preferred use and never touches the draft.
    await selectSource(page, "--palette-ink");
    await selectSource(page, "--palette-sea-gull");
    const reselected = await page.evaluate(() => {
      const select = document.getElementById("smart-colors-workbench-pair");
      return select.options[select.selectedIndex].getAttribute("data-sources") || "";
    });
    assert.match(reselected, /--palette-sea-gull/, "the sea-gull source re-selects one of its own pairs");
    const afterSource = await state(page);
    assert.equal(afterSource.draft["--color-tune-sea-gull-text-light"], "oklch(0.42 0.02 180)", "a source change never touches the runtime draft");
  } finally {
    await page.close();
  }
});

test("the source swatches are native buttons that choose a source, and the picker keeps uses bounded and selectable", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    // A real swatch is a native button the factory enables; a click is THE source choice.
    const swatch = await page.evaluate(() => {
      const button = document.querySelector('#smart-colors-workbench [data-smart-colors-workbench="swatch"]');
      return { tag: button.tagName, token: button.getAttribute("data-token"), disabled: button.disabled, pressed: button.getAttribute("aria-pressed") };
    });
    assert.equal(swatch.tag, "BUTTON", "the source swatch is a native button");
    assert.equal(swatch.disabled, false, "the factory enables the source swatches");

    await page.click('#smart-colors-workbench [data-smart-colors-workbench="swatch"][data-token="--palette-sea-gull"]');
    await settle(page);
    await openUsePicker(page);
    const afterSwatch = await page.evaluate(() => {
      const select = document.getElementById("smart-colors-workbench-pair");
      const option = select.options[select.selectedIndex];
      const uses = Array.from(document.querySelectorAll("#smart-colors-workbench-uses > ul.wb-uses > li > button.wb-use"));
      return {
        source: document.getElementById("smart-colors-workbench-source").value,
        selectedFgSources: option.getAttribute("data-fg-sources") || "",
        uses: uses.length,
        useText: uses.map((button) => button.textContent.trim()).slice(0, 6),
        morePresent: document.querySelectorAll("#smart-colors-workbench-uses details.wb-more").length,
        legacyDisclosure: document.querySelectorAll("#smart-colors-workbench .wb-uses-details").length,
        swatchPressed: document.querySelector('#smart-colors-workbench [data-smart-colors-workbench="swatch"][data-token="--palette-sea-gull"]').getAttribute("aria-pressed"),
        dialogOpen: document.getElementById("smart-colors-workbench-picker").open,
      };
    });
    assert.equal(afterSwatch.source, "--palette-sea-gull", "clicking the swatch sets the real source");
    assert.match(afterSwatch.selectedFgSources, /--palette-sea-gull/, "the swatch selects the source's own preferred foreground use");
    assert.equal(afterSwatch.swatchPressed, "true", "the chosen swatch is announced as pressed");
    assert.equal(afterSwatch.dialogOpen, true, "the primary uses control is a native dialog");
    assert.ok(afterSwatch.uses >= 1 && afterSwatch.uses <= 6, "at most six use chips stay on the picker page: " + afterSwatch.uses);
    assert.ok(afterSwatch.useText.every((text) => text.length > 0), "every use chip carries a label");
    assert.equal(afterSwatch.morePresent, 0, "the old inline more-pairs disclosure is gone");
    assert.equal(afterSwatch.legacyDisclosure, 0, "the old uses disclosure is gone");

    // A result is a real action: it selects that pair and closes the picker.
    const chip = await page.evaluate(() => {
      const button = document.querySelector("#smart-colors-workbench-uses > ul.wb-uses > li > button.wb-use");
      return { value: button.getAttribute("data-pair-value"), label: button.querySelector(".wb-use-label").textContent.trim() };
    });
    await page.click("#smart-colors-workbench-uses > ul.wb-uses > li > button.wb-use");
    await settle(page);
    const afterChip = await page.evaluate(() => ({
      pair: document.getElementById("smart-colors-workbench-pair").value,
      dialogOpen: document.getElementById("smart-colors-workbench-picker").open,
      focused: document.activeElement && document.activeElement.id,
      currentUse: document.getElementById("smart-colors-workbench-current-use").textContent,
      pressed: Array.from(document.querySelectorAll("#smart-colors-workbench-uses button.wb-use")).filter((button) => button.getAttribute("aria-pressed") === "true").length,
    }));
    assert.equal(afterChip.pair, chip.value, "clicking a use result selects that pair");
    assert.equal(afterChip.dialogOpen, false, "choosing a result closes the picker");
    assert.equal(afterChip.focused, "smart-colors-workbench-open-picker", "the picker opener regains focus");
    assert.match(afterChip.currentUse, new RegExp(escapeRegex(chip.label)), "the human current-use summary follows the chosen result");
    assert.ok(afterChip.pressed <= 1, "at most one use result is pressed: " + afterChip.pressed);
  } finally {
    await page.close();
  }
});

test("the 16-source catalogue routes uses through a bounded picker with category and unaccented search filters", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page, requests } = await openWorkbenchPage(mainContext, main.large.file);
  try {
    assert.equal(main.large.session.paletteSource.sources.length, LARGE_SOURCE_COUNT, "the large fixture must expose exactly sixteen palette sources");
    const catalog = await page.evaluate(() => {
      const opener = document.getElementById("smart-colors-workbench-open-picker");
      const pair = document.getElementById("smart-colors-workbench-pair");
      const technical = pair && pair.closest("details");
      const ids = [
        "smart-colors-workbench-open-picker",
        "smart-colors-workbench-current-use",
        "smart-colors-workbench-pair",
        "smart-colors-workbench-picker",
        "smart-colors-workbench-picker-title",
        "smart-colors-workbench-picker-source",
        "smart-colors-workbench-use-search",
        "smart-colors-workbench-use-category",
        "smart-colors-workbench-use-count",
        "smart-colors-workbench-uses",
        "smart-colors-workbench-use-prev",
        "smart-colors-workbench-use-next",
        "smart-colors-workbench-clear-search",
        "smart-colors-workbench-close-picker",
      ];
      return {
        swatches: document.querySelectorAll('#smart-colors-workbench [data-smart-colors-workbench="swatch"]').length,
        pairs: document.querySelectorAll("#smart-colors-workbench-pair option").length,
        openerVisible: Boolean(opener && opener.checkVisibility() && opener.getBoundingClientRect().width > 0),
        openerDisabled: Boolean(opener && opener.disabled),
        openerText: opener ? opener.textContent.trim() : null,
        pairInTechnical: Boolean(technical && technical.classList.contains("wb-technical")),
        pairVisible: Boolean(pair && pair.checkVisibility()),
        technicalOpen: Boolean(technical && technical.open),
        currentUse: document.getElementById("smart-colors-workbench-current-use").textContent.trim(),
        oldDisclosures: document.querySelectorAll("#smart-colors-workbench .wb-uses-details, #smart-colors-workbench .wb-more").length,
        searchType: document.getElementById("smart-colors-workbench-use-search").type,
        countRole: document.getElementById("smart-colors-workbench-use-count").getAttribute("role"),
        countLive: document.getElementById("smart-colors-workbench-use-count").getAttribute("aria-live"),
        ids: ids.map((id) => document.querySelectorAll("#" + id).length),
      };
    });
    assert.equal(catalog.swatches, LARGE_SOURCE_COUNT, "every palette source is a real swatch");
    assert.equal(catalog.pairs, LARGE_PAIR_COUNT, "the fixture exposes the full 136-pair catalogue");
    assert.equal(catalog.openerVisible, true, "the primary 'Cambia uso' opener is visible");
    assert.equal(catalog.openerDisabled, false, "the factory enables the primary opener");
    assert.equal(catalog.openerText, "Cambia uso");
    assert.equal(catalog.pairInTechnical, true, "the full pair select is the technical fallback");
    assert.equal(catalog.pairVisible, false, "the full pair select stays inside the closed technical detail");
    assert.equal(catalog.technicalOpen, false);
    assert.ok(catalog.currentUse.length > 0, "the toolbar names the human current use");
    assert.equal(catalog.oldDisclosures, 0, "the old inline uses disclosures are gone");
    assert.equal(catalog.searchType, "search");
    assert.equal(catalog.countRole, "status");
    assert.equal(catalog.countLive, "polite");
    assert.deepEqual(catalog.ids, Array(catalog.ids.length).fill(1), "each picker id exists exactly once");

    // No new CSP escape hatches for the dialog: the runtime stays hash-pinned and offline.
    const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]').content);
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'sha256-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(csp, /script-src[^;]*(?:unsafe-inline|unsafe-eval)/, "the dialog must not relax script execution");
    assert.doesNotMatch(csp, /unsafe-eval/, "the preview must never permit eval");
    assert.match(csp, /frame-src 'none'/);
    assert.match(csp, /connect-src 'none'/);

    // The canvas source is a background dependency: the picker scopes the catalogue and says so.
    await selectSource(page, "--palette-canvas");
    await openUsePicker(page);
    const canvas = await page.evaluate(() => ({
      source: document.getElementById("smart-colors-workbench-picker-source").textContent,
      note: document.querySelector("#smart-colors-workbench-uses .wb-uses-note")?.textContent || "",
      count: document.getElementById("smart-colors-workbench-use-count").textContent,
      visible: document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length,
    }));
    assert.match(canvas.source, /Sorgente: Canvas/);
    assert.match(canvas.note, /dipendenza del token di sfondo/);
    assert.match(canvas.count, /usi · pagina 1 di/);
    const canvasTotal = Number((canvas.count.match(/(\d+)/) || [])[1]);
    assert.ok(canvasTotal > 0 && canvasTotal < LARGE_PAIR_COUNT, "canvas must be a scoped background-only subset: " + canvasTotal);
    assert.ok(canvas.visible >= 1 && canvas.visible <= 6, "the picker never renders more than six results");

    // A real category narrows the current scope, and clearing it restores the full scope.
    const categories = await page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-use-category option"))
      .map((option) => ({ value: option.value, label: option.textContent.trim() })));
    const categoryChoices = categories.filter((entry) => entry.value);
    assert.ok(categoryChoices.length >= 2, "the picker derives several real categories: " + JSON.stringify(categories));
    let reduced = null;
    for (const category of categoryChoices) {
      await page.selectOption("#smart-colors-workbench-use-category", category.value);
      const total = await pickerTotal(page);
      if (total !== null && total > 0 && total < canvasTotal) { reduced = { ...category, total }; break; }
    }
    assert.ok(reduced, "a real category must reduce the canvas-scoped result set");
    const categoryView = await page.evaluate(() => ({
      results: document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length,
      count: document.getElementById("smart-colors-workbench-use-count").textContent,
      selected: document.getElementById("smart-colors-workbench-use-category").value,
    }));
    assert.equal(categoryView.selected, reduced.value);
    assert.ok(categoryView.results >= 1 && categoryView.results <= 6);
    assert.match(categoryView.count, /pagina 1 di/);
    await page.selectOption("#smart-colors-workbench-use-category", "");
    assert.equal(await pickerTotal(page), canvasTotal, "clearing the category restores the source scope");

    // Search a friendly multiword name (and prove accent folding) on a foreground-capable source.
    await page.click("#smart-colors-workbench-close-picker");
    await page.waitForFunction(() => !document.getElementById("smart-colors-workbench-picker").open, null, { timeout: 5_000 });
    await selectSource(page, "--palette-citta");
    await openUsePicker(page);
    const cittaTotal = await pickerTotal(page);
    assert.ok(cittaTotal >= 1, "the citta source must expose real uses: " + cittaTotal);
    await page.fill("#smart-colors-workbench-use-search", "testo card");
    const naturalTotal = await pickerTotal(page);
    assert.ok(naturalTotal > 0, "natural words must match across the human label, not only an exact phrase");
    await page.fill("#smart-colors-workbench-use-search", "  CARD   testo  ");
    assert.equal(await pickerTotal(page), naturalTotal, "word order, case and repeated spaces do not change matches");
    await page.fill("#smart-colors-workbench-use-search", "callout citta");
    await page.waitForFunction(() => {
      const count = document.getElementById("smart-colors-workbench-use-count").textContent || "";
      return !/Nessun uso/.test(count) && document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length > 0;
    }, null, { timeout: 5_000 });
    const unaccentedTotal = await pickerTotal(page);
    assert.ok(unaccentedTotal > 0);
    const searchRows = await page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-uses button.wb-use"))
      .map((button) => ({ value: button.getAttribute("data-pair-value"), label: button.textContent.trim() })));
    assert.ok(searchRows.length >= 1 && searchRows.length <= 6);
    assert.ok(searchRows.every((row) => /citta/.test(row.label.toLowerCase()) || /citta/.test(row.value.toLowerCase())), "the multiword query stays scoped to the citta family: " + JSON.stringify(searchRows));
    assert.ok(searchRows.some((row) => /callout/.test(row.label.toLowerCase())), "the friendly query matches the human callout title, not only the raw tokens");
    await page.fill("#smart-colors-workbench-use-search", "callout città");
    await page.waitForFunction(() => {
      const count = document.getElementById("smart-colors-workbench-use-count").textContent || "";
      return !/Nessun uso/.test(count) && document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length > 0;
    }, null, { timeout: 5_000 });
    assert.equal(await pickerTotal(page), unaccentedTotal, "the accented query folds to the same unaccented result set");

    // A no-results state is explicit and clearing the search restores the real scope.
    await page.fill("#smart-colors-workbench-use-search", "zzz nessun uso");
    await page.waitForFunction(() => /Nessun uso corrisponde/.test(document.getElementById("smart-colors-workbench-use-count").textContent), null, { timeout: 5_000 });
    const empty = await page.evaluate(() => ({
      results: document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length,
      message: document.getElementById("smart-colors-workbench-uses").textContent,
    }));
    assert.equal(empty.results, 0);
    assert.match(empty.message, /Nessun uso corrisponde/);
    await page.click("#smart-colors-workbench-clear-search");
    await page.waitForFunction((expected) => {
      const text = document.getElementById("smart-colors-workbench-use-count").textContent || "";
      const match = text.match(/(\d+)/);
      return Boolean(match) && Number(match[1]) === expected;
    }, cittaTotal, { timeout: 5_000 });
    const cleared = await page.evaluate(() => ({
      value: document.getElementById("smart-colors-workbench-use-search").value,
      focused: document.activeElement && document.activeElement.id,
      category: document.getElementById("smart-colors-workbench-use-category").value,
      results: document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length,
    }));
    assert.equal(cleared.value, "");
    assert.equal(cleared.focused, "smart-colors-workbench-use-search", "clearing the search restores focus to the search field");
    assert.equal(cleared.category, "");
    assert.equal(cleared.results, 6, "the first page is bounded to six results again");
    assert.deepEqual(requests.filter(isRemote), [], "the picker makes no remote request");
  } finally {
    await page.close();
  }
});

test("the all-sources picker reaches every 136 uses at 320px, keeps pager focus and restores the opener on Escape", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page, requests } = await openWorkbenchPage(mainContext, main.large.file, { viewport: { width: 320, height: 720 } });
  try {
    // At 320px the native source select is the visible source control and "Tutte le sorgenti" is a real choice.
    const mobile = await page.evaluate(() => {
      const select = document.getElementById("smart-colors-workbench-source");
      const all = Array.from(select.options).find((option) => option.value === "");
      return { display: getComputedStyle(select).display, allLabel: all ? all.textContent : null, allValue: all ? all.value : null };
    });
    assert.notEqual(mobile.display, "none", "the mobile source select is visible");
    assert.equal(mobile.allValue, "");
    assert.match(mobile.allLabel, /Tutte le sorgenti/);
    await page.selectOption("#smart-colors-workbench-source", "");
    await settle(page);
    await openUsePicker(page);
    const all = await page.evaluate(() => {
      const dialog = document.getElementById("smart-colors-workbench-picker");
      const rect = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        source: document.getElementById("smart-colors-workbench-picker-source").textContent,
        count: document.getElementById("smart-colors-workbench-use-count").textContent,
        results: document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.documentElement.clientWidth,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
      };
    });
    assert.equal(all.open, true);
    assert.match(all.source, /Sorgente: Tutte le sorgenti/);
    assert.match(all.count, new RegExp("^" + LARGE_PAIR_COUNT + " usi · pagina 1 di " + Math.ceil(LARGE_PAIR_COUNT / 6) + "$"));
    assert.equal(all.results, 6, "the picker starts with six results");
    assert.ok(all.documentOverflow <= 1 && all.bodyOverflow <= 1, "the dialog must not widen the document: " + JSON.stringify(all));
    assert.ok(all.rect.left >= -1 && all.rect.right <= all.viewport.width + 1 && all.rect.top >= -1 && all.rect.bottom <= all.viewport.height + 1, "the dialog stays inside the 320px viewport: " + JSON.stringify(all));

    // Traverse every page without drops, keeping the pager focusable at the boundary.
    const expected = await page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-pair option")).map((option) => option.value));
    assert.equal(expected.length, LARGE_PAIR_COUNT);
    const seen = [];
    let pages = 0;
    while (true) {
      const rows = await pickerPageValues(page);
      assert.ok(rows.length >= 1 && rows.length <= 6, "each picker page is bounded to six results");
      for (const value of rows) {
        assert.ok(!seen.includes(value), "the picker repeats a result across pages: " + value);
        seen.push(value);
      }
      const pager = await page.evaluate(() => ({
        aria: document.getElementById("smart-colors-workbench-use-next").getAttribute("aria-disabled"),
        disabled: document.getElementById("smart-colors-workbench-use-next").disabled,
        count: document.getElementById("smart-colors-workbench-use-count").textContent,
      }));
      assert.equal(pager.disabled, false, "the next pager remains a focusable native button at every boundary");
      if (pager.aria === "true") break;
      await page.focus("#smart-colors-workbench-use-next");
      await page.keyboard.press("Enter");
      await page.waitForFunction((previous) => document.getElementById("smart-colors-workbench-use-count").textContent !== previous, pager.count, { timeout: 5_000 });
      assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "smart-colors-workbench-use-next", "paging keeps keyboard focus on the pager");
      pages += 1;
      assert.ok(pages < 30, "the pager did not advance");
    }
    assert.equal(seen.length, LARGE_PAIR_COUNT, "every result is reachable exactly once");
    assert.deepEqual([...seen].sort(), [...expected].sort(), "the picker exposes exactly the catalogue pairs");

    // The last-page boundary is an aria-disabled no-op, not a disabled button that loses focus.
    const last = await page.evaluate(() => ({
      count: document.getElementById("smart-colors-workbench-use-count").textContent,
      aria: document.getElementById("smart-colors-workbench-use-next").getAttribute("aria-disabled"),
    }));
    assert.equal(last.aria, "true");
    await page.focus("#smart-colors-workbench-use-next");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "smart-colors-workbench-use-next", "the boundary pager keeps focus");
    assert.equal(await page.evaluate(() => document.getElementById("smart-colors-workbench-use-count").textContent), last.count);

    // Escape closes the modal and returns focus to the opener that opened it.
    await page.focus("#smart-colors-workbench-close-picker");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.getElementById("smart-colors-workbench-picker").open, null, { timeout: 5_000 });
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === "smart-colors-workbench-open-picker", null, { timeout: 5_000 });
    assert.equal(await page.evaluate(() => document.activeElement.id), "smart-colors-workbench-open-picker");

    // Reopening starts on page one; the previous-page boundary is also a focusable no-op.
    await openUsePicker(page);
    const first = await page.evaluate(() => ({
      count: document.getElementById("smart-colors-workbench-use-count").textContent,
      aria: document.getElementById("smart-colors-workbench-use-prev").getAttribute("aria-disabled"),
      disabled: document.getElementById("smart-colors-workbench-use-prev").disabled,
    }));
    assert.match(first.count, new RegExp("pagina 1 di " + Math.ceil(LARGE_PAIR_COUNT / 6)));
    assert.equal(first.aria, "true");
    assert.equal(first.disabled, false);
    await page.focus("#smart-colors-workbench-use-prev");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "smart-colors-workbench-use-prev", "the previous boundary keeps focus");
    assert.equal(await page.evaluate(() => document.getElementById("smart-colors-workbench-use-count").textContent), first.count);

    // No-results feedback is explicit; clearing restores the full catalogue and search focus.
    await page.fill("#smart-colors-workbench-use-search", "zzz nessun uso");
    await page.waitForFunction(() => /Nessun uso corrisponde/.test(document.getElementById("smart-colors-workbench-use-count").textContent), null, { timeout: 5_000 });
    assert.equal(await page.evaluate(() => document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length), 0);
    await page.click("#smart-colors-workbench-clear-search");
    await page.waitForFunction((expected) => {
      const text = document.getElementById("smart-colors-workbench-use-count").textContent || "";
      const match = text.match(/(\d+)/);
      return Boolean(match) && Number(match[1]) === expected;
    }, LARGE_PAIR_COUNT, { timeout: 5_000 });
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "smart-colors-workbench-use-search");

    // A result chosen with the keyboard updates the human summary and the measured runtime pair.
    await page.fill("#smart-colors-workbench-use-search", "callout città");
    await page.waitForFunction(() => {
      const count = document.getElementById("smart-colors-workbench-use-count").textContent || "";
      return !/Nessun uso/.test(count) && document.querySelectorAll("#smart-colors-workbench-uses button.wb-use").length > 0;
    }, null, { timeout: 5_000 });
    const choice = await page.evaluate(() => {
      const current = document.getElementById("smart-colors-workbench-pair").value;
      const rows = Array.from(document.querySelectorAll("#smart-colors-workbench-uses button.wb-use"));
      const button = rows.find((node) => node.getAttribute("data-pair-value") !== current) || rows[0];
      return button ? { value: button.getAttribute("data-pair-value"), label: button.querySelector(".wb-use-label").textContent.trim() } : null;
    });
    assert.ok(choice, "the citta callout search must expose a selectable result");
    const [choiceForeground, choiceBackground] = choice.value.split("|");
    await page.evaluate((value) => {
      const button = Array.from(document.querySelectorAll("#smart-colors-workbench-uses button.wb-use"))
        .find((node) => node.getAttribute("data-pair-value") === value);
      button.focus();
    }, choice.value);
    await page.keyboard.press("Enter");
    await page.waitForFunction(({ name, foreground, background }) => {
      const current = window[name].state();
      return Boolean(current && current.selection && current.selection.pairId
        && current.selection.pairId.includes(foreground) && current.selection.pairId.includes(background));
    }, { name: WORKBENCH_RUNTIME_GLOBAL, foreground: choiceForeground, background: choiceBackground }, { timeout: 10_000 });
    await settle(page);
    const after = await page.evaluate(() => ({
      dialogOpen: document.getElementById("smart-colors-workbench-picker").open,
      focused: document.activeElement && document.activeElement.id,
      currentUse: document.getElementById("smart-colors-workbench-current-use").textContent,
      pairValue: document.getElementById("smart-colors-workbench-pair").value,
    }));
    assert.equal(after.dialogOpen, false, "choosing a result closes the picker");
    assert.equal(after.focused, "smart-colors-workbench-open-picker", "the picker opener regains focus");
    assert.match(after.currentUse, new RegExp(escapeRegex(choice.label)), "the human summary follows the chosen result");
    assert.equal(after.pairValue, choice.value, "the technical fallback follows the chosen result");
    const selected = await state(page);
    assert.ok(selected.selection.pairId.includes(choiceForeground) && selected.selection.pairId.includes(choiceBackground), "the runtime measures the chosen pair");
    assert.deepEqual(requests.filter(isRemote), [], "the picker makes no remote request");
  } finally {
    await page.close();
  }
});

test("a full-color override outranks the surface mix in the real CSS", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    await choosePair(page, { fg: "--color-sea-gull-text", bg: "--color-sea-gull-surface" });
    const controls = await page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-controls input"))
      .map((input) => ({ control: input.getAttribute("data-control"), kind: input.getAttribute("data-kind"), id: input.id })));
    const override = controls.find((entry) => entry.control === "--color-tune-sea-gull-surface-light");
    const mix = controls.find((entry) => entry.control === "--color-tune-sea-gull-surface-light-mix");
    assert.ok(override && override.kind === "override", "the surface override must be offered");
    assert.ok(mix && mix.kind === "mix", "the surface mix must be offered");

    await page.fill("#" + mix.id, "99");
    await page.fill("#" + override.id, "oklch(0.8 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const current = await state(page);
    assert.equal(current.draft["--color-tune-sea-gull-surface-light-mix"], "99%");
    assert.equal(current.draft["--color-tune-sea-gull-surface-light"], "oklch(0.8 0 0)");
    const specimen = await selectedSpecimen(page, "right");
    const background = core.parseComputedColor(specimen.backgroundColor, "override-vs-mix background");
    assert.ok(Math.abs(background.l - 0.8) < 0.02, "the full override wins over the 99% mix in the painted frame");
    assert.ok(background.c < 0.001);
    const exported = await page.evaluate(() => window.__smartColorsWorkbench.exportTuning());
    assert.match(exported, /--color-tune-sea-gull-surface-light: oklch\(0\.8 0 0\);/);
    assert.match(exported, /--color-tune-sea-gull-surface-light-mix: 99%;/);
  } finally {
    await page.close();
  }
});

test("the code snippet uses the pair's real property for border and outline, and minimum stays separate from target", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    await choosePair(page, { fg: "--color-focus-ring", kind: "non-text" });
    const focus = await page.evaluate(() => ({
      snippet: document.querySelector("#smart-colors-workbench-details pre code").textContent,
      property: document.querySelector("#smart-colors-workbench-details").textContent,
    }));
    assert.match(focus.snippet, /^outline: 3px solid var\(--color-focus-ring\);/);
    assert.match(focus.snippet, /background-color: var\(--color-(?:bg|surface)\);/);
    assert.doesNotMatch(focus.snippet, /^\s*color:/);
    const focusSpecimen = await selectedSpecimen(page, "right");
    assert.equal(focusSpecimen.tag, "DIV", "the outline sample is static geometry, not a fake control");
    assert.equal(focusSpecimen.property, "outlineColor");
    assert.equal(focusSpecimen.text.trim(), "", "the outline sample carries no unmeasured copy");
    assert.equal(focusSpecimen.childCount, 0, "the outline sample is geometry only");
    assert.equal(focusSpecimen.role, "img");
    assert.match(focusSpecimen.ariaLabel, /Campione statico dell.{1,2}anello/);
    assert.match(focusSpecimen.ariaLabel, /non il comportamento di focus/);
    assert.match(focusSpecimen.inlineStyle, /var\(--color-focus-ring\)/);
    assert.equal(focusSpecimen.outlineColor, (await measurement(page, "right")).foreground);

    await choosePair(page, { fg: "--color-sea-gull-border-strong", bg: "--color-bg", kind: "non-text" });
    const border = await page.evaluate(() => document.querySelector("#smart-colors-workbench-details pre code").textContent);
    assert.match(border, /^border: 2px solid var\(--color-sea-gull-border-strong\);/);
    assert.match(border, /background-color: var\(--color-bg\);/);
    assert.doesNotMatch(border, /^\s*color:/);
    const borderSpecimen = await selectedSpecimen(page, "right");
    assert.equal(borderSpecimen.tag, "DIV", "the border sample is static geometry, not a fake control");
    assert.equal(borderSpecimen.property, "borderColor");
    assert.equal(borderSpecimen.text.trim(), "", "the border sample carries no unmeasured copy");
    assert.equal(borderSpecimen.childCount, 0, "the border sample is geometry only");
    assert.equal(borderSpecimen.role, "img");
    assert.match(borderSpecimen.ariaLabel, /Campione statico del bordo/);
    assert.match(borderSpecimen.ariaLabel, /non il comportamento di focus/);
    assert.match(borderSpecimen.inlineStyle, /var\(--color-sea-gull-border-strong\)/);

    // A text pair keeps `color`, and the two thresholds are shown separately.
    await choosePair(page, { fg: "--color-text", bg: "--color-bg" });
    const text = await page.evaluate(() => ({
      snippet: document.querySelector("#smart-colors-workbench-details pre code").textContent,
      thresholds: document.querySelector("#smart-colors-workbench-details .wb-thresholds").textContent,
      measure: document.getElementById("smart-colors-workbench-right-measure").textContent,
    }));
    assert.match(text.snippet, /^color: var\(--color-text\);/);
    assert.match(text.thresholds, /Minimo tema chiaro/);
    assert.match(text.thresholds, /Target tema chiaro/);
    assert.match(text.thresholds, /4,50:1/);
    assert.match(text.thresholds, /4,60:1/);
    assert.notEqual("4,50:1", "4,60:1");
    assert.match(text.measure, /Minimo richiesto/);
    assert.match(text.measure, /4,50:1/);
    assert.match(text.measure, /Obiettivo progetto \(non WCAG\)/);
    assert.match(text.measure, /[0-9]+,[0-9]{2}:1/, "the project target is reported as a real ratio, distinct from the minimum");
  } finally {
    await page.close();
  }
});

test("a temporary failure yields verified foreground AND background suggestions with an honest scope, and applying preserves other draft values", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    // Seed an unrelated draft value on another pair first, so "preserve" has something to preserve.
    await choosePair(page, { fg: "--color-text", bg: "--color-bg" });
    const bgControl = await page.evaluate(() => {
      const input = Array.from(document.querySelectorAll("#smart-colors-workbench-controls input")).find((node) => node.getAttribute("data-control") === "--color-tune-bg-light");
      return input ? input.id : null;
    });
    assert.ok(bgControl);
    await page.fill("#" + bgControl, "oklch(0.78 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);

    // A pair that fails at runtime and is repairable from either side.
    await selectSource(page, "--palette-lagoon2");
    await choosePair(page, { fg: "--color-lagoon2-ink", bg: "--color-lagoon2" });
    const failing = await measurement(page, "right");
    assert.ok(failing.ratio < 4.5, "the lagoon2-ink pair must fail at runtime");

    await page.click("#smart-colors-workbench-suggest-foreground");
    await settleSuggestion(page);
    const fg = (await state(page)).suggestion;
    assert.equal(fg.status, "verified", JSON.stringify(fg));
    assert.equal(fg.side, "foreground");
    assert.equal(fg.token, "--color-lagoon2-ink");
    assert.equal(fg.control, "--color-tune-lagoon2-ink-light");
    assert.match(fg.value, /^oklch\(/);
    assert.ok(fg.before < 4.5 && fg.after >= 4.5);
    assert.equal(fg.unmeasured, 0);
    assert.deepEqual(fg.regressions, []);
    assert.equal(fg.scope.affectedTheme, "light");
    assert.deepEqual(fg.scope.measuredThemes, ["light", "dark"]);
    assert.deepEqual(fg.scope.unchangedThemes, ["dark"]);
    const proposal = await page.evaluate(() => document.getElementById("smart-colors-workbench-proposal").textContent);
    assert.match(proposal, /Proposta verificata/);
    assert.match(proposal, /controllo --color-tune-lagoon2-ink-light/, "the proposal names its public control");

    await page.click("#smart-colors-workbench-apply");
    await settle(page);
    const appliedFg = await state(page);
    assert.equal(appliedFg.selection.comparison, "draft");
    assert.equal(appliedFg.draft["--color-tune-lagoon2-ink-light"], fg.value);
    assert.equal(appliedFg.draft["--color-tune-bg-light"], "oklch(0.78 0 0)", "applying a suggestion preserves the other draft value");
    const appliedRatio = await measurement(page, "right");
    assert.ok(Math.abs(appliedRatio.ratio - fg.after) < 1e-3, "the applied draft measures the verified after");

    // The same pair is repairable from the background side too.
    await page.click("#smart-colors-workbench-reset-all");
    await settle(page);
    await page.click("#smart-colors-workbench-suggest-background");
    await settleSuggestion(page);
    const bg = (await state(page)).suggestion;
    assert.equal(bg.status, "verified", JSON.stringify(bg));
    assert.equal(bg.side, "background");
    assert.equal(bg.token, "--color-lagoon2");
    assert.equal(bg.control, "--color-tune-lagoon2-light");
    assert.ok(bg.before < 4.5 && bg.after >= 4.5);
    assert.deepEqual(bg.scope.unchangedThemes, ["dark"]);
    await page.click("#smart-colors-workbench-apply");
    await settle(page);
    const appliedBg = await state(page);
    assert.equal(appliedBg.draft["--color-tune-lagoon2-light"], bg.value);
    assert.ok(Math.abs((await measurement(page, "right")).ratio - bg.after) < 1e-3);
  } finally {
    await page.close();
  }
});

test("apply stays gated when the pair needs no correction", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    await selectComparison(page, "tuning");
    await choosePair(page, { fg: "--color-sea-gull-text", bg: "--color-sea-gull-surface" });
    const before = await measurement(page, "right");
    assert.ok(before.ratio >= 4.5, "the chosen pair must already pass: " + JSON.stringify(before));
    assert.equal(await page.isDisabled("#smart-colors-workbench-apply"), true, "apply starts gated");
    await page.click("#smart-colors-workbench-suggest-foreground");
    await settleSuggestion(page);
    const suggestion = (await state(page)).suggestion;
    assert.equal(suggestion.status, "none", JSON.stringify(suggestion));
    assert.equal(suggestion.after, suggestion.before, "a no-op suggestion keeps the measured ratio");
    assert.equal(await page.isDisabled("#smart-colors-workbench-apply"), true, "a no-op suggestion never enables apply");
    assert.deepEqual((await state(page)).draft, {}, "no draft is written without an explicit verified apply");
  } finally {
    await page.close();
  }
});

test("an existing draft hidden by the tuning/themes comparison is re-shown by suggest and verified against the draft", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    await choosePair(page, { fg: "--color-text", bg: "--color-bg" });
    // The saved-only base is the "tuning" comparison's baseline view; select it explicitly.
    await selectComparison(page, "tuning");
    const savedOnly = await measurement(page, "right");
    assert.equal(savedOnly.variant, "tuned");
    assert.ok(savedOnly.ratio < 4.5);

    const bgControl = await page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-controls input"))
      .find((node) => node.getAttribute("data-control") === "--color-tune-bg-light").id);
    await page.fill("#" + bgControl, "oklch(0.8 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const drafted = await measurement(page, "right");
    assert.equal(drafted.variant, "draft");
    assert.ok(drafted.ratio < 4.5, "the different-side draft keeps the pair below minimum");
    assert.ok(Math.abs(drafted.ratio - savedOnly.ratio) > 0.1, "the hidden draft measurably changes the base");

    // Hide the draft behind the themes comparison: the light view is the saved-only tuning again.
    await page.click("#smart-colors-workbench-comparison-themes");
    await settle(page);
    const themed = await state(page);
    assert.equal(themed.selection.comparison, "themes");
    assert.equal(themed.views.length, 2);
    assert.equal(themed.views[1].variant, "tuned");
    assert.equal(themed.views[1].theme, "dark");
    assert.ok(Math.abs(themed.views[0].measurement.ratio - savedOnly.ratio) < 1e-3, "the themes comparison shows the saved-only base, not the hidden draft");
    assert.equal(themed.draft["--color-tune-bg-light"], "oklch(0.8 0 0)", "the hidden draft is preserved");

    await page.click("#smart-colors-workbench-suggest-foreground");
    await settleSuggestion(page);
    const suggestion = (await state(page)).suggestion;
    assert.equal((await state(page)).selection.comparison, "draft", "suggest transparently switches back to the draft comparison");
    assert.equal(suggestion.status, "verified", JSON.stringify(suggestion));
    assert.ok(Math.abs(suggestion.before - drafted.ratio) < 1e-3, "the verified before is the real draft measurement");
    assert.ok(Math.abs(suggestion.before - savedOnly.ratio) > 0.1, "the verified before is not the saved-only measurement");
    await page.click("#smart-colors-workbench-apply");
    await settle(page);
    const applied = await state(page);
    assert.equal(applied.selection.comparison, "draft");
    assert.equal(applied.draft["--color-tune-bg-light"], "oklch(0.8 0 0)");
    assert.equal(applied.draft["--color-tune-text-light"], suggestion.value);
  } finally {
    await page.close();
  }
});

test("export and copy always reflect the current draft, and an empty export is never a success", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    // The export controls live in a native detail: open it as a real user would.
    await revealDetails(page);
    // Empty: export and copy must announce the emptiness, not a success, and leave the field empty.
    await page.click("#smart-colors-workbench-export");
    let exported = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      status: document.getElementById("smart-colors-workbench-status").textContent,
      downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
    }));
    assert.equal(exported.text, "");
    assert.match(exported.status, /Nessun tuning pubblico da esportare/);
    assert.equal(exported.downloadHidden, true);
    await page.click("#smart-colors-workbench-copy-export");
    exported = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      status: document.getElementById("smart-colors-workbench-status").textContent,
    }));
    assert.equal(exported.text, "");
    assert.match(exported.status, /Nessun CSS pubblico da copiare/);

    // Set a draft, then change it: the published export follows the current draft every time.
    await choosePair(page, { fg: "--color-text", bg: "--color-bg" });
    const bgControl = await page.evaluate(() => Array.from(document.querySelectorAll("#smart-colors-workbench-controls input"))
      .find((node) => node.getAttribute("data-control") === "--color-tune-bg-light").id);
    await page.fill("#" + bgControl, "oklch(0.7 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const afterFirst = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      live: window.__smartColorsWorkbench.exportTuning(),
    }));
    assert.match(afterFirst.text, /--color-tune-bg-light: oklch\(0\.7 0 0\);/);
    assert.equal(afterFirst.text, afterFirst.live, "the published export equals the current draft");

    await page.click("#smart-colors-workbench-copy-export");
    await page.waitForFunction(() => /copiato|selezionato/.test(document.getElementById("smart-colors-workbench-status").textContent), null, { timeout: 5000 });
    const afterCopy = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      live: window.__smartColorsWorkbench.exportTuning(),
      status: document.getElementById("smart-colors-workbench-status").textContent,
      downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
    }));
    assert.equal(afterCopy.text, afterCopy.live);
    assert.ok(afterCopy.text.length > 0);
    assert.match(afterCopy.status, /copiato|selezionato/);
    assert.equal(afterCopy.downloadHidden, false);

    await page.fill("#" + bgControl, "oklch(0.6 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const afterSecond = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      live: window.__smartColorsWorkbench.exportTuning(),
    }));
    assert.match(afterSecond.text, /--color-tune-bg-light: oklch\(0\.6 0 0\);/);
    assert.equal(afterSecond.text, afterSecond.live, "the export is recomputed for every draft change");

    // Reset all: the export empties and a fresh export is again not a success.
    await page.click("#smart-colors-workbench-reset-all");
    await settle(page);
    await page.click("#smart-colors-workbench-export");
    const reset = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      status: document.getElementById("smart-colors-workbench-status").textContent,
      downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
    }));
    assert.equal(reset.text, "");
    assert.match(reset.status, /Nessun tuning pubblico da esportare/);
    assert.equal(reset.downloadHidden, true);
  } finally {
    await page.close();
  }
});

test("the shell header owns the single export command and the session badge, and a newer draft never leaves a stale export", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    // The shell, not the workbench, owns the export command and the honest local-session badge.
    const shell = await page.evaluate(() => {
      const workbench = document.getElementById("smart-colors-workbench");
      const button = document.getElementById("smart-colors-workbench-export");
      const badge = document.getElementById("smart-colors-workbench-session-status");
      const exportBox = document.querySelector('#smart-colors-workbench [data-smart-colors-workbench="export"]');
      const opener = document.getElementById("smart-colors-workbench-open-picker");
      const pair = document.getElementById("smart-colors-workbench-pair");
      const technical = pair && pair.closest("details");
      return {
        exportCount: document.querySelectorAll("#smart-colors-workbench-export").length,
        badgeCount: document.querySelectorAll("#smart-colors-workbench-session-status").length,
        buttonInHeader: Boolean(button && button.closest("header")),
        buttonInWorkbench: Boolean(button && workbench && workbench.contains(button)),
        badgeInWorkbench: Boolean(badge && workbench && workbench.contains(badge)),
        exportOpen: Boolean(exportBox && exportBox.open),
        badgeText: badge ? badge.textContent : null,
        text: document.getElementById("smart-colors-workbench-export-text").value,
        downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
        openerVisible: Boolean(opener && opener.checkVisibility() && opener.getBoundingClientRect().width > 0),
        openerDisabled: Boolean(opener && opener.disabled),
        openerText: opener ? opener.textContent.trim() : null,
        currentUse: document.getElementById("smart-colors-workbench-current-use").textContent.trim(),
        pairInTechnical: Boolean(technical && technical.classList.contains("wb-technical")),
        pairVisible: Boolean(pair && pair.checkVisibility()),
        technicalOpen: Boolean(technical && technical.open),
        legacyUses: document.querySelectorAll("#smart-colors-workbench .wb-uses-details, #smart-colors-workbench .wb-more").length,
        legacyRail: document.querySelectorAll('#smart-colors-workbench [class*="rail"]').length,
      };
    });
    assert.equal(shell.exportCount, 1, "the shell header must own exactly one export command");
    assert.equal(shell.buttonInHeader, true, "the export command lives in the page header");
    assert.equal(shell.buttonInWorkbench, false, "the workbench must not duplicate the shell export command");
    assert.equal(shell.badgeCount, 1, "the shell header must own exactly one session-status badge");
    assert.equal(shell.badgeInWorkbench, false, "the session badge belongs to the shell, not the workbench body");
    assert.equal(shell.exportOpen, false, "the export disclosure starts closed");
    assert.equal(shell.badgeText, "Anteprima locale", "a local preview must not claim persistence");
    assert.equal(shell.text, "");
    assert.equal(shell.downloadHidden, true);
    // The primary toolbar is the visible "Cambia uso" opener with a human current-use summary; the
    // full native pair select is the technical fallback inside a closed disclosure.
    assert.equal(shell.openerVisible, true, "the 'Cambia uso' opener is visible in the toolbar");
    assert.equal(shell.openerDisabled, false, "the primary opener is enabled by the factory");
    assert.equal(shell.openerText, "Cambia uso");
    assert.ok(shell.currentUse.length > 0, "the toolbar names the human current use");
    assert.doesNotMatch(shell.currentUse, /--color-/, "the human summary never falls back to a raw token when a name exists");
    assert.equal(shell.pairInTechnical, true, "the full pair select lives in the technical fallback detail");
    assert.equal(shell.pairVisible, false, "the full pair select is not a primary toolbar control");
    assert.equal(shell.technicalOpen, false, "the technical fallback starts closed");
    assert.equal(shell.legacyUses, 0, "the old bounded uses disclosure is gone");
    assert.equal(shell.legacyRail, 0, "the toolbar carries no legacy source rail");

    // The header command reveals the real textarea/download; an empty export is never a success.
    await page.click("#smart-colors-workbench-export");
    const opened = await page.evaluate(() => ({
      open: document.querySelector('#smart-colors-workbench [data-smart-colors-workbench="export"]').open,
      text: document.getElementById("smart-colors-workbench-export-text").value,
      downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
      focused: document.activeElement && document.activeElement.id,
      status: document.getElementById("smart-colors-workbench-status").textContent,
      note: document.getElementById("smart-colors-workbench-export-note").textContent,
      noteVisible: document.getElementById("smart-colors-workbench-export-note").checkVisibility(),
      description: document.getElementById("smart-colors-workbench-export-text").getAttribute("aria-describedby"),
    }));
    assert.equal(opened.open, true, "the header export command opens the export disclosure");
    assert.equal(opened.text, "");
    assert.equal(opened.downloadHidden, true);
    assert.equal(opened.focused, "smart-colors-workbench-export-text", "the revealed CSS field receives keyboard focus");
    assert.match(opened.status, /Nessun tuning pubblico da esportare/);
    assert.doesNotMatch(opened.status, /esportato nel campo selezionabile/);
    assert.match(opened.note, /Nessun tuning pubblico da esportare/);
    assert.equal(opened.noteVisible, true, "the empty export has visible feedback, not only a hidden live announcement");
    assert.equal(opened.description, "smart-colors-workbench-export-note");

    // A real draft is exported verbatim, then changing it replaces the published text instead of
    // leaving the previous CSS behind. The badge names the unsaved state in both cases.
    await choosePair(page, { fg: "--color-text", bg: "--color-bg" });
    const bgControl = await page.evaluate(() => {
      const input = Array.from(document.querySelectorAll("#smart-colors-workbench-controls input"))
        .find((node) => node.getAttribute("data-control") === "--color-tune-bg-light");
      return input ? input.id : null;
    });
    assert.ok(bgControl, "the pair must expose its background override control");
    await page.fill("#" + bgControl, "oklch(0.7 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const drafted = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      live: window.__smartColorsWorkbench.exportTuning(),
      downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
      badge: document.getElementById("smart-colors-workbench-session-status").textContent,
      note: document.getElementById("smart-colors-workbench-export-note").textContent,
    }));
    assert.match(drafted.note, /CSS della bozza corrente/);
    assert.match(drafted.text, /--color-tune-bg-light: oklch\(0\.7 0 0\);/);
    assert.equal(drafted.text, drafted.live, "the published export re-reads the current draft");
    assert.equal(drafted.downloadHidden, false, "a non-empty export offers the manual download");
    assert.match(drafted.badge, /1 modifica in bozza non salvata/, "the badge names the unsaved draft");

    await page.fill("#" + bgControl, "oklch(0.55 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const changed = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      live: window.__smartColorsWorkbench.exportTuning(),
    }));
    assert.match(changed.text, /--color-tune-bg-light: oklch\(0\.55 0 0\);/);
    assert.doesNotMatch(changed.text, /oklch\(0\.7 0 0\)/, "a previous export is never left stale after a draft change");
    assert.equal(changed.text, changed.live);

    // Resetting the draft clears the published export and the download, rather than keeping stale CSS.
    await page.click("#smart-colors-workbench-reset-all");
    await settle(page);
    const cleared = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      live: window.__smartColorsWorkbench.exportTuning(),
      downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
      badge: document.getElementById("smart-colors-workbench-session-status").textContent,
    }));
    assert.equal(cleared.text, "");
    assert.equal(cleared.live, "");
    assert.equal(cleared.downloadHidden, true, "a cleared export hides the stale download");
    assert.equal(cleared.badge, "Anteprima locale", "an empty draft returns the badge to the plain local-preview state");
  } finally {
    await page.close();
  }
});

test("discarding a verified proposal preserves the draft and export and keeps keyboard focus off the body", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    // Seed a real draft first, so discard can be proven not to reset the public overrides.
    await choosePair(page, { fg: "--color-text", bg: "--color-bg" });
    const bgControl = await page.evaluate(() => {
      const input = Array.from(document.querySelectorAll("#smart-colors-workbench-controls input"))
        .find((node) => node.getAttribute("data-control") === "--color-tune-bg-light");
      return input ? input.id : null;
    });
    assert.ok(bgControl);
    await page.fill("#" + bgControl, "oklch(0.78 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const drafted = await state(page);
    assert.equal(drafted.draft["--color-tune-bg-light"], "oklch(0.78 0 0)");

    // Publish the real export before the proposal, so its contents can be compared after the discard.
    await page.click("#smart-colors-workbench-export");
    const exportedBefore = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      live: window.__smartColorsWorkbench.exportTuning(),
    }));
    assert.match(exportedBefore.text, /--color-tune-bg-light: oklch\(0\.78 0 0\);/);
    assert.equal(exportedBefore.text, exportedBefore.live);

    // A failing pair offers a verified proposal: preview frames are visible, the draft is untouched.
    await selectSource(page, "--palette-lagoon2");
    await choosePair(page, { fg: "--color-lagoon2-ink", bg: "--color-lagoon2" });
    await page.click("#smart-colors-workbench-suggest-foreground");
    await settleSuggestion(page);
    const proposed = await state(page);
    assert.equal(proposed.suggestion.status, "verified", JSON.stringify(proposed.suggestion));
    assert.deepEqual(proposed.draft, drafted.draft, "a proposal preview never mutates the draft");
    const preview = await page.evaluate(() => ({
      frames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
      hidden: document.getElementById("smart-colors-workbench-proposal-frames").hidden,
      applyDisabled: document.getElementById("smart-colors-workbench-apply").disabled,
      discardHidden: document.getElementById("smart-colors-workbench-discard-suggestion").hidden,
      discardDisabled: document.getElementById("smart-colors-workbench-discard-suggestion").disabled,
      badge: document.getElementById("smart-colors-workbench-session-status").textContent,
    }));
    assert.equal(preview.frames, 2, "a verified proposal mounts its two real preview frames");
    assert.equal(preview.hidden, false);
    assert.equal(preview.applyDisabled, false, "a verified preview enables apply");
    assert.equal(preview.discardHidden, false, "a discard action is offered for the proposal");
    assert.equal(preview.discardDisabled, false);
    assert.match(preview.badge, /proposta verificata in attesa/, "the badge names the unapplied verified proposal");

    // Activate discard from the keyboard, not only with a pointer.
    await page.focus("#smart-colors-workbench-discard-suggestion");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__smartColorsWorkbench.state().suggestion === null, null, { timeout: 5000 });
    await settle(page);
    const after = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        suggestion: window.__smartColorsWorkbench.state().suggestion,
        draft: window.__smartColorsWorkbench.state().draft,
        text: document.getElementById("smart-colors-workbench-export-text").value,
        live: window.__smartColorsWorkbench.exportTuning(),
        downloadHidden: document.getElementById("smart-colors-workbench-download").hidden,
        frames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
        hidden: document.getElementById("smart-colors-workbench-proposal-frames").hidden,
        discardHidden: document.getElementById("smart-colors-workbench-discard-suggestion").hidden,
        badge: document.getElementById("smart-colors-workbench-session-status").textContent,
        status: document.getElementById("smart-colors-workbench-status").textContent,
        focus: active ? { tag: active.tagName, id: active.id, inWorkbench: Boolean(active.closest && active.closest("#smart-colors-workbench")) } : null,
      };
    });
    assert.equal(after.suggestion, null);
    assert.deepEqual(after.draft, drafted.draft, "discarding a proposal never resets the saved draft");
    assert.match(after.text, /--color-tune-bg-light: oklch\(0\.78 0 0\);/);
    assert.equal(after.text, after.live, "the discard preserves the current export");
    assert.equal(after.downloadHidden, false, "the discard preserves the manual download");
    assert.equal(after.frames, 0, "the discard removes the proposal frames");
    assert.equal(after.hidden, true);
    assert.equal(after.discardHidden, true);
    assert.match(after.badge, /1 modifica in bozza non salvata/, "the badge returns to the unsaved-draft state");
    assert.match(after.status, /Proposta scartata/);
    assert.ok(after.focus, "focus must remain on a real element after a discard");
    assert.notEqual(after.focus.tag, "BODY", "discarding a proposal must not drop keyboard focus to the document body: " + JSON.stringify(after.focus));
  } finally {
    await page.close();
  }
});

test("the workbench stays within a small viewport and every control is a labelled, keyboard-reachable native element", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file, { viewport: { width: 320, height: 720 } });
  try {
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      offenders: Array.from(document.querySelectorAll("#smart-colors-workbench *")).filter((element) => {
        if (!element.checkVisibility()) return false;
        for (let node = element; node && node !== document.body; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (/(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1) return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1);
      }).map((element) => element.tagName + "." + element.className),
    }));
    assert.ok(overflow.document <= overflow.viewport + 1 && overflow.body <= overflow.viewport + 1, "no document-level horizontal overflow at 320px: " + JSON.stringify(overflow));
    assert.deepEqual(overflow.offenders, [], "no unintended element overflow at 320px");

    // Open the native details so the advanced controls are reachable, then check every visible control.
    await revealDetails(page);
    const a11y = await page.evaluate(() => {
      const workbench = document.getElementById("smart-colors-workbench");
      const controls = Array.from(workbench.querySelectorAll("button, input, select, textarea, pre[tabindex]"));
      const report = [];
      for (const node of controls) {
        if (node.disabled || !node.checkVisibility()) continue;
        node.focus();
        const focused = node === document.activeElement;
        let name = "";
        if (node.tagName === "BUTTON") name = node.textContent.trim();
        else {
          const explicit = node.id ? workbench.querySelector('label[for="' + CSS.escape(node.id) + '"]') : null;
          const wrapping = explicit || node.closest("label");
          name = wrapping ? wrapping.textContent.trim() : (node.getAttribute("aria-label") || "");
        }
        report.push({ tag: node.tagName, id: node.id, focused, name });
      }
      return { report, labelCount: workbench.querySelectorAll("label[for]").length };
    });
    assert.ok(a11y.report.length >= 8, "the workbench exposes several native controls");
    for (const entry of a11y.report) {
      assert.equal(entry.focused, true, entry.tag + "#" + entry.id + " must accept focus");
      assert.ok(entry.name.length > 0, entry.tag + "#" + entry.id + " must have a visible name");
    }
    // Tab from the top eventually reaches the workbench (it is keyboard reachable in document order).
    await page.evaluate(() => document.body.focus());
    let reached = false;
    for (let step = 0; step < 80 && !reached; step += 1) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => Boolean(document.activeElement && document.activeElement.closest("#smart-colors-workbench")));
    }
    assert.equal(reached, true, "tabbing reaches the workbench controls");
  } finally {
    await page.close();
  }
});

test("without JavaScript the static source palette, catalogue and byte status stay readable and no frames are created", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const opened = await openPage(staticContext, main.file);
  const { page } = opened;
  try {
    const view = await page.evaluate((name) => ({
      runtime: typeof window[name],
      palette: document.getElementById("palette").textContent,
      status: document.getElementById("smart-colors-workbench-status").textContent,
      catalogue: document.getElementById("smart-colors-workbench-catalogue").textContent,
      frames: document.querySelectorAll("iframe[data-smart-colors-workbench-frame]").length,
    }), WORKBENCH_RUNTIME_GLOBAL);
    assert.equal(view.runtime, "undefined", "no runtime may be installed without JavaScript");
    assert.match(view.palette, /--palette-sea-gull · ruolo dichiarato: feedback/);
    assert.match(view.palette, /Valore sorgente dichiarato/);
    assert.match(view.status, /senza JavaScript/);
    assert.match(view.catalogue, /Catalogo completo/);
    assert.equal(view.frames, 0, "without JavaScript no measurement frame exists");
  } finally {
    await page.close();
  }
});

test("hostile captured bytes stay inert, the preview makes no network request and writes no fixture file", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const before = await snapshotTree(main.hostileDir);
  const { page, requests, pageErrors, consoleErrors } = await openWorkbenchPage(mainContext, main.hostile.file);
  try {
    const view = await page.evaluate(() => ({
      pwned: typeof window.__pwned,
      scripts: document.querySelectorAll("script").length,
      textarea: document.getElementById("smart-colors-workbench-palette-source").textContent,
      workbenchFrames: document.querySelectorAll("iframe[data-smart-colors-workbench-frame]").length,
    }));
    assert.equal(view.pwned, "undefined", "the hostile payload must not execute");
    assert.equal(view.scripts, 2, "only the inert payload and the runtime script exist: no injected script");
    assert.ok(view.textarea.includes("window.__pwned=1"), "the hostile bytes are shown as inert text");
    assert.equal(view.workbenchFrames, 2, "the workbench still renders its two real frames");
    assert.deepEqual(pageErrors, [], "no script breakout error");
    assert.deepEqual(consoleErrors.filter((text) => !/favicon/i.test(text)), []);
    assert.deepEqual(requests.filter(isRemote), [], "no remote request");
    assert.deepEqual(await snapshotTree(main.hostileDir), before, "opening the preview must not modify any fixture byte");
  } finally {
    await page.close();
  }
});

test("source digest, current/stale/empty provenance and the never-substituted empty output are honest", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  // current
  assert.equal(main.session.css.status, "current");
  const currentPalette = await readFile(path.join(root, "main", PALETTE_PATH), "utf8");
  assert.equal(main.session.paletteSource.sha256, sha256Hex(currentPalette), "the palette source digest is the real file digest");
  const currentOutput = await readFile(path.join(root, "main", OUTPUT_PATH), "utf8");
  assert.equal(main.session.css.digest.baseline, sha256Hex(currentOutput), "the measured baseline digest is the real output bytes");
  assert.equal(main.session.css.digest.generated, main.session.css.digest.baseline, "a current output equals the generated candidate");

  // stale: an output that drifted from the model is declared stale, and the recipe is not the active formula.
  assert.equal(main.stale.session.css.status, "stale");
  const stale = await openWorkbenchPage(mainContext, main.stale.file);
  try {
    const text = await stale.page.evaluate(() => document.getElementById("contenuto").textContent);
    assert.match(text, /output non aggiornato \(stale\)/);
    assert.match(text, /non la formula attiva dei byte correnti/);
  } finally {
    await stale.page.close();
  }

  // empty: a present-but-empty output is never replaced by the generated candidate.
  assert.equal(main.empty.session.css.status, "empty");
  assert.equal(main.empty.session.css.baseline, "");
  const empty = await openWorkbenchPage(mainContext, main.empty.file);
  try {
    const view = await empty.page.evaluate((name) => ({
      phase: window[name].state().phase,
      error: window[name].state().error,
      frames: document.querySelectorAll("iframe[data-smart-colors-workbench-frame]").length,
      text: document.getElementById("contenuto").textContent,
    }), WORKBENCH_RUNTIME_GLOBAL);
    assert.equal(view.phase, "unavailable");
    assert.match(view.error, /never substituted/);
    assert.equal(view.frames, 0, "an empty output produces no measurement frame");
    assert.match(view.text, /output vuoto: nessun byte utilizzabile/);
  } finally {
    await empty.page.close();
  }
});

test("the session keeps the legacy palette array beside paletteSource, and a current preview declares no false integrity problem", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  // The legacy resolved gallery must survive verbatim for downstream consumers; the exact authored
  // source metadata travels beside it, never replacing the array.
  assert.ok(Array.isArray(main.session.palette), "session.palette must stay the legacy resolved-source array");
  assert.ok(main.session.palette.length > 0);
  assert.ok(main.session.palette.every((entry) => entry && typeof entry.name === "string" && typeof entry.role === "string" && "authored" in entry && "resolved" in entry), "legacy palette entries keep name/role/authored/resolved");
  const source = main.session.paletteSource;
  assert.ok(source && typeof source === "object" && !Array.isArray(source), "session.paletteSource must be the source contract object");
  const paletteBytes = await readFile(path.join(root, "main", PALETTE_PATH), "utf8");
  assert.equal(source.css, paletteBytes, "paletteSource.css must be the exact authored bytes");
  assert.equal(source.sha256, sha256Hex(paletteBytes), "paletteSource.sha256 must be the real file digest");
  assert.equal(source.path, PALETTE_PATH);
  assert.ok(Array.isArray(source.sources) && source.sources.length > 0 && source.sources.every((entry) => /^--palette-/.test(entry.token) && "role" in entry && "declaration" in entry), "paletteSource.sources must carry per-source metadata");

  // The exact source metadata reaches the inert payload; the preview must not invent an integrity failure.
  const { page } = await openPage(mainContext, main.file);
  try {
    const view = await page.evaluate(() => {
      const payload = JSON.parse(document.getElementById("smart-colors-payload").textContent);
      const content = document.getElementById("contenuto").textContent;
      const source = payload.paletteSource;
      return {
        paletteSourceIsObject: Boolean(source) && typeof source === "object" && !Array.isArray(source),
        paletteSourceSha: source && source.sha256,
        paletteSourceCss: source && source.css,
        paletteSourceTokens: source && Array.isArray(source.sources) ? source.sources.map((entry) => entry.token) : null,
        integrityBanner: /Problemi di integrità o errori dello snapshot/.test(content),
        paletteProblem: /Campo palette assente o non valido/.test(content),
      };
    });
    assert.equal(view.paletteSourceIsObject, true, "the inert payload carries paletteSource as an object");
    assert.equal(view.paletteSourceSha, source.sha256, "the payload source digest matches the session");
    assert.equal(view.paletteSourceCss, source.css, "the payload forwards the exact authored bytes");
    assert.deepEqual(view.paletteSourceTokens, source.sources.map((entry) => entry.token));
    assert.equal(view.integrityBanner, false, "a current, valid snapshot must not declare an integrity problem");
    assert.equal(view.paletteProblem, false, "the palette field must not be reported missing or invalid");
  } finally {
    await page.close();
  }
});

test("the initial workbench DOM matches the measured pair without any click, and a source/pair change never shows an unrelated old ratio", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  // The static build prioritizes a decorative pair whose title sorts first; the runtime measures the
  // neutral pair first. This is the exact real-root split.
  const staticHtml = await readFile(main.mismatch.file, "utf8");
  assert.match(staticHtml, /<option value="--color-warm-ink\|--color-warm\|text" selected [^>]*data-fg="--color-warm-ink"/, "the static build must prioritize the decorative warm pair");
  assert.match(staticHtml, /<h3>--color-warm-ink su --color-warm<\/h3>/, "the static details must start on the decorative pair");

  const { page } = await openWorkbenchPage(mainContext, main.mismatch.file);
  try {
    const initial = await page.evaluate(() => {
      const select = document.getElementById("smart-colors-workbench-pair");
      const selected = select.options[select.selectedIndex] || select.querySelector("option[selected]");
      const details = document.getElementById("smart-colors-workbench-details");
      return {
        pairValue: select.value,
        selectedValue: selected ? selected.value : null,
        selectedSources: selected ? (selected.getAttribute("data-sources") || "").split(/\s+/).filter(Boolean) : [],
        selectedHidden: selected ? selected.hidden : null,
        sourceValue: document.getElementById("smart-colors-workbench-source").value,
        detailsText: details.textContent,
        snippet: details.querySelector("pre code").textContent,
        thresholds: details.querySelector(".wb-thresholds").textContent,
        rightMeasure: document.getElementById("smart-colors-workbench-right-measure").textContent,
      };
    });
    const current = await state(page);
    const [theme, , foreground, background] = current.selection.pairId.split("|");
    assert.equal(theme, "light");
    const pairText = foreground + " su " + background;
    // Independent exact DOM match against the pair the runtime actually measured (not a state ratio).
    assert.equal(initial.pairValue, foreground + "|" + background + "|text", "the pair select shows the measured pair");
    assert.equal(initial.selectedValue, initial.pairValue, "exactly the measured pair option is selected");
    assert.equal(initial.selectedHidden, false, "the measured pair option is visible under the initial filter");
    assert.match(initial.detailsText, new RegExp(escapeRegex(pairText)), "the details describe the measured pair");
    assert.doesNotMatch(initial.detailsText, /warm/, "the stale decorative pair must not survive in the details");
    assert.match(initial.snippet, new RegExp("^color: var\\(" + escapeRegex(foreground) + "\\);"));
    assert.match(initial.snippet, new RegExp("background-color: var\\(" + escapeRegex(background) + "\\);"));
    assert.match(initial.thresholds, /Minimo tema chiaro/, "the thresholds describe the measured pair");
    // The measurement panel describes the theme/variant of the measured view, not a stale pair.
    assert.match(initial.rightMeasure, /tema scuro · con tuning/);
    assert.match(initial.rightMeasure, /[0-9]+,[0-9]{2}:1/, "the panel shows a real measured ratio");
    assert.doesNotMatch(initial.sourceValue, /warm/, "the initial source filter must not keep the static decorative source");
    assert.ok(initial.sourceValue === "" || initial.selectedSources.includes(initial.sourceValue), "the source filter must be compatible with the measured pair: " + initial.sourceValue + " not in " + JSON.stringify(initial.selectedSources));

    // A source/pair change must not leave the previous pair's ratio displayed for the new selection.
    const switched = await page.evaluate(() => {
      const select = document.getElementById("smart-colors-workbench-pair");
      const target = Array.from(select.options).find((option) => option.getAttribute("data-fg") === "--color-primary-text");
      if (!target) return { missing: true };
      select.value = target.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return { missing: false, value: target.value };
    });
    assert.equal(switched.missing, false, "the fixture must expose a second real pair to switch to");
    await page.waitForTimeout(300);
    await settle(page);
    const afterSwitch = await page.evaluate(() => ({
      details: document.getElementById("smart-colors-workbench-details").textContent,
      measure: document.getElementById("smart-colors-workbench-right-measure").textContent,
    }));
    assert.match(afterSwitch.details, /--color-primary-text/, "the details follow the newly selected pair");
    assert.notEqual(afterSwitch.details, initial.detailsText, "the stale details are replaced, not kept");
    // The panel must show the new pair's own measurement (or a pending state), never the previous pair's ratio.
    const afterState = await state(page);
    assert.match(afterState.selection.pairId, /--color-primary-text/, "the runtime selection follows the switch");
    const right = afterState.views.find((view) => view.slot === "right");
    if (right && right.measurement && Number.isFinite(right.measurement.ratio)) {
      const label = right.measurement.ratio.toFixed(2).replace(".", ",");
      assert.match(afterSwitch.measure, new RegExp(label), "the panel shows the new pair's own ratio: " + afterSwitch.measure);
    } else {
      assert.match(afterSwitch.measure, /Verifica in corso|non misurata|Non disponibile/, "a pending panel replaces the previous ratio");
    }
  } finally {
    await page.close();
  }
});

test("technical reference probes stay offscreen and out of the accessibility tree, the selected visible measurement is real and the full pair count is unchanged", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    const contractPairs = await page.evaluate((name) => window[name].pairs("light").length, WORKBENCH_RUNTIME_GLOBAL);
    assert.ok(contractPairs > 0);
    const probeFacts = await page.evaluate(() => Array.from(document.querySelectorAll('iframe[data-smart-colors-workbench-frame="visible"]')).map((frame) => {
      const doc = frame.contentDocument;
      const win = frame.contentWindow;
      const host = doc.querySelector("[data-smart-colors-probes]");
      // Only probes inside the reference host count; the visible specimen legitimately carries the pair attribute.
      const exposed = host ? Array.from(host.querySelectorAll("[data-smart-colors-pair]")).filter((probe) => !probe.closest('[aria-hidden="true"]')).map((probe) => probe.textContent) : [];
      let offscreen = null;
      let ariaHidden = null;
      if (host) {
        const rect = host.getBoundingClientRect();
        ariaHidden = host.getAttribute("aria-hidden");
        offscreen = rect.right <= 1 || rect.left >= win.innerWidth - 1 || rect.bottom <= 1 || rect.top >= win.innerHeight - 1 || (rect.width <= 1 && rect.height <= 1);
      }
      return {
        present: Boolean(host),
        ariaHidden,
        offscreen,
        exposed,
        documentScrollWidth: doc.documentElement.scrollWidth,
        documentClientWidth: doc.documentElement.clientWidth,
        views: 1,
      };
    }));
    assert.equal(probeFacts.length, 2, "two visible frames are measured");
    for (const probe of probeFacts) {
      assert.equal(probe.present, true, "the reference probe host must exist");
      assert.equal(probe.ariaHidden, "true", "the reference probe host must be aria-hidden");
      assert.equal(probe.offscreen, true, "the reference probe host must be offscreen");
      assert.deepEqual(probe.exposed, [], "no technical probe label may remain exposed in the accessibility tree");
      assert.ok(probe.documentScrollWidth <= probe.documentClientWidth + 1, "the reference probes must not extend the horizontal scroll extent");
    }
    // The full pair count is unchanged: every visible view still measures every contract pair.
    const current = await state(page);
    for (const view of current.views) {
      assert.equal(view.measurements.length, contractPairs, "visible view " + view.slot + " must still measure the full contract pair count");
    }
    // The selected pair is still measured from its real visible node.
    const specimen = await selectedSpecimen(page, "right");
    const right = await measurement(page, "right");
    assert.ok(specimen && specimen.inlineStyle.includes("var(--color-text)"));
    assert.equal(specimen.color, right.foreground, "the measurement reads the selected visible node");
    assert.equal(specimen.backgroundColor, right.background, "the measurement reads the selected visible node background");
  } finally {
    await page.close();
  }
});

test("the real root inputs, read read-only through a temp session copy, render an initial state that matches the measured pair", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const temp = await mkdtemp(path.join(tmpdir(), "smart-colors-root-qa-"));
  try {
    await mkdir(path.join(temp, "src/styles/tokens"), { recursive: true });
    for (const file of ROOT_INPUTS) await cp(path.join(WORKSPACE_ROOT, file), path.join(temp, file));
    const scope = path.join(temp, "node_modules", "@smartslash");
    await mkdir(scope, { recursive: true });
    await symlink(path.relative(scope, path.join(WORKSPACE_ROOT, "packages/astro-smart-colors")), path.join(scope, "astro-smart-colors"), "dir");
    const rootBefore = await hashInputs(WORKSPACE_ROOT);
    const copyBefore = await hashInputs(temp);
    assert.deepEqual(copyBefore, rootBefore, "the temp copy must start byte-identical to the real root inputs");

    const built = await createDiagnosticSession({ root: temp, suggest: false });
    const html = formatContrastPreviewHtml(built.session);
    const file = path.join(temp, "reports/smart-colors-preview.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, html, "utf8");
    // The real root still reproduces the static-vs-runtime split (decorative pair statically, neutral measured).
    const staticPair = (html.match(/<option value="([^"]*)" selected [^>]*data-fg/) || [])[1];
    assert.ok(staticPair && staticPair.includes("--color-warm-ink"), "the real root must still render the decorative pair statically: " + staticPair);

    const { page } = await openWorkbenchPage(mainContext, file);
    try {
      const initial = await page.evaluate(() => {
        const select = document.getElementById("smart-colors-workbench-pair");
        const selected = select.options[select.selectedIndex] || select.querySelector("option[selected]");
        return {
          pairValue: select.value,
          selectedHidden: selected ? selected.hidden : null,
          sourceValue: document.getElementById("smart-colors-workbench-source").value,
          detailsText: document.getElementById("smart-colors-workbench-details").textContent,
          rightMeasure: document.getElementById("smart-colors-workbench-right-measure").textContent,
        };
      });
      const current = await state(page);
      const [theme, , foreground, background] = current.selection.pairId.split("|");
      const pairText = foreground + " su " + background;
      assert.equal(theme, "light");
      assert.notEqual(initial.pairValue, staticPair, "the runtime initial pair must be re-projected, never the static decorative one");
      assert.equal(initial.pairValue, foreground + "|" + background + "|text", "the pair select shows the measured pair");
      assert.equal(initial.selectedHidden, false);
      assert.match(initial.detailsText, new RegExp(escapeRegex(pairText)));
      assert.doesNotMatch(initial.detailsText, /warm/);
      assert.match(initial.rightMeasure, /tema scuro · con tuning/);
      assert.doesNotMatch(initial.sourceValue, /warm/);
    } finally {
      await page.close();
    }
    // Read-only: neither the temp copy nor the real root inputs changed.
    assert.deepEqual(await hashInputs(temp), copyBefore, "the temp session copy must not mutate its inputs");
    assert.deepEqual(await hashInputs(WORKSPACE_ROOT), rootBefore, "the real root inputs must not be mutated");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the Primary source surfaces representative semantic uses (page, button, callout, border, focus) instead of six borders", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const temp = await mkdtemp(path.join(tmpdir(), "smart-colors-primary-uses-"));
  try {
    await mkdir(path.join(temp, "src/styles/tokens"), { recursive: true });
    for (const file of ROOT_INPUTS) await cp(path.join(WORKSPACE_ROOT, file), path.join(temp, file));
    const scope = path.join(temp, "node_modules", "@smartslash");
    await mkdir(scope, { recursive: true });
    await symlink(path.relative(scope, path.join(WORKSPACE_ROOT, "packages/astro-smart-colors")), path.join(scope, "astro-smart-colors"), "dir");
    const built = await createDiagnosticSession({ root: temp, suggest: false });
    const file = path.join(temp, "reports/smart-colors-preview.html");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, formatContrastPreviewHtml(built.session), "utf8");

    const { page } = await openWorkbenchPage(mainContext, file);
    try {
      const primary = await page.evaluate(() => Array.from(document.querySelectorAll('#smart-colors-workbench [data-smart-colors-workbench="swatch"]')).map((button) => button.getAttribute("data-token")));
      assert.ok(primary.includes("--palette-primary"), "the real root exposes a Primary source swatch: " + JSON.stringify(primary.slice(0, 6)));
      await page.click('#smart-colors-workbench [data-smart-colors-workbench="swatch"][data-token="--palette-primary"]');
      await settle(page);
      await openUsePicker(page);
      const buckets = await page.evaluate(() => {
        const pair = document.getElementById("smart-colors-workbench-pair");
        const byValue = new Map(Array.from(pair.options).map((option) => [option.value, option.getAttribute("data-use-bucket")]));
        const buttons = Array.from(document.querySelectorAll("#smart-colors-workbench-uses > ul.wb-uses > li > button.wb-use"));
        return {
          selected: byValue.get(pair.value),
          visible: buttons.map((button) => byValue.get(button.getAttribute("data-pair-value"))),
        };
      });
      assert.equal(buckets.selected, "page", "the default primary use is text/page, not a border");
      assert.ok(buckets.visible.length >= 5 && buckets.visible.length <= 6, "the primary surface shows at most six uses: " + JSON.stringify(buckets.visible));
      assert.deepEqual([...new Set(buckets.visible)].sort(), ["border", "button", "callout", "focus", "page"], "the primary uses span the semantic buckets: " + JSON.stringify(buckets.visible));
      assert.ok(buckets.visible.filter((bucket) => bucket === "border").length < 6, "the six primary choices are not six borders: " + JSON.stringify(buckets.visible));
    } finally {
      await page.close();
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("a verified suggestion previews the real CSS base vs candidate in two proposal frames without touching the draft, and any newer edit removes the preview", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page, requests } = await openWorkbenchPage(mainContext, main.file);
  try {
    // The suggestion flow works on the tuned/draft view, so select the "tuning" comparison first.
    await selectComparison(page, "tuning");
    const tunedBefore = await measurement(page, "right");
    assert.equal(tunedBefore.status, "below-minimum", "the fixture pair must fail before the suggestion");

    // Real UI only: request a foreground suggestion.
    await page.click("#smart-colors-workbench-suggest-foreground");
    await settleSuggestion(page);
    const suggested = (await state(page)).suggestion;
    assert.equal(suggested.status, "verified", JSON.stringify(suggested));
    assert.equal(suggested.control, "--color-tune-text-light");
    assert.match(suggested.value, /^oklch\(/);

    // The proposal section is visible with exactly two proposal frames. The TOTAL frame count is
    // deliberately not constrained: the two visible frames coexist with the two proposal frames.
    const section = await page.evaluate(() => {
      const node = document.getElementById("smart-colors-workbench-proposal-frames");
      return { hidden: node.hidden, proposalFrames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length };
    });
    assert.equal(section.hidden, false, "the proposal preview section must be visible for a verified suggestion");
    assert.equal(section.proposalFrames, 2, "exactly two proposal frames must be mounted");

    const before = await proposalFrame(page, "proposal-before");
    const after = await proposalFrame(page, "proposal-after");
    assert.ok(before && after, "both proposal frames must render a real specimen");
    for (const frame of [before, after]) {
      assert.equal(frame.scripts, 0, "a proposal frame carries no script");
      assert.match(frame.inlineStyle, /var\(--color-text\)/, "the proposal specimen consumes the real token, not a painted swatch");
      assert.match(frame.inlineStyle, /var\(--color-bg\)/);
      assert.ok(frame.width > 0 && frame.height > 0, "a proposal frame is a real visible frame");
    }
    // Real CSS before/after: the base frame matches the current measured base, the candidate frame the proposal.
    assert.equal(before.color, tunedBefore.foreground, "the before frame shows the current base CSS");
    const beforeParsed = core.parseComputedColor(before.color, "proposal before");
    const afterParsed = core.parseComputedColor(after.color, "proposal after");
    const candidate = core.parseComputedColor(suggested.value, "candidate value");
    assert.ok(Math.abs(afterParsed.l - candidate.l) < 1e-3 && Math.abs(afterParsed.c - candidate.c) < 0.01, "the after frame paints the proposed candidate value through the real CSS");
    assert.ok(Math.abs(afterParsed.l - beforeParsed.l) > 0.05, "the two proposal frames are visibly different");

    // The view shows the proposed value and the formatted numbers.
    const panel = await page.evaluate(() => {
      const node = document.getElementById("smart-colors-workbench-proposal");
      return { text: node.textContent, value: (node.querySelector(".wb-proposal-value") || {}).textContent || null };
    });
    assert.equal(panel.value, suggested.value, "the proposed value is shown verbatim");
    assert.match(panel.text, /Prima: /, "the formatted before ratio is shown");
    assert.match(panel.text, /Dopo: /, "the formatted after ratio is shown");
    assert.match(panel.text, /Soglia rilevante: minimo/, "the relevant threshold is shown");

    // No draft mutation and no export until apply.
    const untouched = await page.evaluate(() => ({
      draft: window.__smartColorsWorkbench.state().draft,
      exportTuning: window.__smartColorsWorkbench.exportTuning(),
      exportText: document.getElementById("smart-colors-workbench-export-text").value,
      applyDisabled: document.getElementById("smart-colors-workbench-apply").disabled,
    }));
    assert.deepEqual(untouched.draft, {}, "a verified suggestion must not mutate the draft");
    assert.equal(untouched.exportTuning, "", "a verified suggestion must not publish an export");
    assert.equal(untouched.exportText, "");
    assert.equal(untouched.applyDisabled, false, "apply is enabled for a verified suggestion");

    // A newer edit removes the preview and the suggestion, without applying it.
    const overrideId = await page.evaluate(() => {
      const input = Array.from(document.querySelectorAll("#smart-colors-workbench-controls input")).find((node) => node.getAttribute("data-control") === "--color-tune-text-light");
      return input ? input.id : null;
    });
    assert.ok(overrideId, "the pair must expose the foreground override control");
    await revealDetails(page);
    await page.fill("#" + overrideId, "oklch(0.45 0 0)");
    await page.click("#smart-colors-workbench-controls-submit");
    await settle(page);
    const edited = await page.evaluate(() => ({
      suggestion: window.__smartColorsWorkbench.state().suggestion,
      draft: window.__smartColorsWorkbench.state().draft,
      proposalFrames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
      hidden: document.getElementById("smart-colors-workbench-proposal-frames").hidden,
    }));
    assert.equal(edited.suggestion, null, "the edit clears the suggestion");
    assert.equal(edited.proposalFrames, 0, "the edit removes the proposal frames");
    assert.equal(edited.hidden, true);
    assert.equal(edited.draft["--color-tune-text-light"], "oklch(0.45 0 0)");

    // A fresh suggestion after reset, then apply: the draft equals the candidate and the preview is gone.
    await page.click("#smart-colors-workbench-reset-all");
    await settle(page);
    await page.click("#smart-colors-workbench-suggest-foreground");
    await settleSuggestion(page);
    const again = (await state(page)).suggestion;
    assert.equal(again.status, "verified", JSON.stringify(again));
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length), 2, "a fresh verified suggestion mounts the two proposal frames again");
    await page.focus("#smart-colors-workbench-apply");
    await page.keyboard.press("Enter");
    await settle(page);
    const applied = await state(page);
    assert.equal(applied.draft[again.control], again.value, "apply writes exactly the proposed candidate value");
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length), 0, "the proposal frames are removed after apply");
    assert.equal(await page.evaluate(() => document.getElementById("smart-colors-workbench-proposal-frames").hidden), true);
    const applyFocus = await page.evaluate(() => {
      const active = document.activeElement;
      return active ? { tag: active.tagName, id: active.id, inWorkbench: Boolean(active.closest && active.closest("#smart-colors-workbench")) } : null;
    });
    assert.ok(applyFocus, "focus must remain on a real element after apply");
    assert.notEqual(applyFocus.tag, "BODY", "applying a proposal must not drop keyboard focus to the document body: " + JSON.stringify(applyFocus));
    assert.deepEqual(requests.filter(isRemote), [], "the proposal preview makes no network request");
  } finally {
    await page.close();
  }
});

test("a real root-sized automation session keeps the preview within the 768 KiB budget and compacts only the preview, not the static report", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const temp = await mkdtemp(path.join(tmpdir(), "smart-colors-root-automation-"));
  try {
    await mkdir(path.join(temp, "src/styles/tokens"), { recursive: true });
    for (const file of ROOT_INPUTS) await cp(path.join(WORKSPACE_ROOT, file), path.join(temp, file));
    const scope = path.join(temp, "node_modules", "@smartslash");
    await mkdir(scope, { recursive: true });
    await symlink(path.relative(scope, path.join(WORKSPACE_ROOT, "packages/astro-smart-colors")), path.join(scope, "astro-smart-colors"), "dir");
    const rootBefore = await hashInputs(WORKSPACE_ROOT);
    const copyBefore = await hashInputs(temp);

    // The documented explicit-browser automation path: one injected provider over the installed
    // Chromium, so no Playwright needs to resolve from the temp consumer. `runAutomation` closes the
    // launched browser and calls `provider.close()` in its own finally.
    const provider = {
      async open() { return { ok: true, request: "@playwright/test", resolved: WORKSPACE_ROOT, browsers: playwright }; },
      async availability(name) { return { name, available: true, executable: playwright[name].executablePath() }; },
      async launch(name, options) { return playwright[name].launch({ headless: true, timeout: options && options.timeout ? options.timeout : 30_000 }); },
      async close() {},
    };
    const workflow = await runDiagnosticWorkflow({
      root: temp,
      command: "report",
      automation: "required",
      browsers: ["chromium"],
      provider,
      timeoutMs: 90_000,
      overallTimeoutMs: 240_000,
    });
    assert.equal(workflow.requestedAutomation.mode, "required");
    assert.equal(workflow.run.provenance, "browser-automation", "a real automation run must be produced");
    assert.ok(workflow.run.measurements.length > 0, "the root-sized automation session must measure the root");

    const previewHtml = await readFile(workflow.publication.previewPath, "utf8");
    const reportHtml = await readFile(workflow.publication.reportPath, "utf8");
    const previewBytes = Buffer.byteLength(previewHtml, "utf8");
    assert.ok(previewBytes <= PREVIEW_BUDGET_BYTES, "the root-sized automation preview must stay within " + PREVIEW_BUDGET_BYTES + " bytes: " + previewBytes);
    assert.ok(previewBytes > LEGACY_PREVIEW_BYTES, "the root-sized automation preview is provably above the legacy cap: " + previewBytes);
    // Compact preview vs full static report: the wide automation tables live only in the report.
    assert.match(previewHtml, /Apri misure complete nel report/, "the compact preview must link to the complete report");
    assert.doesNotMatch(previewHtml, /Misure automatizzate per coppia/, "the preview must not carry the wide automation table");
    assert.match(reportHtml, /Misure automatizzate per coppia/, "the static report keeps the full automation table");

    // Read-only: neither the temp copy nor the real root inputs changed.
    assert.deepEqual(await hashInputs(temp), copyBefore, "the root-sized automation run must not mutate its inputs");
    assert.deepEqual(await hashInputs(WORKSPACE_ROOT), rootBefore, "the real root inputs must not be mutated");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
