/**
 * End-to-end integration proof for the guided contrast workbench.
 *
 * This is deliberately NOT the runtime-only proof in `contrast-workbench-runtime.test.mjs`.
 * Here the product's OWN emitted preview is produced from a real temporary consumer project
 * through `createDiagnosticSession` + `formatContrastPreviewHtml` (the same session -> preview
 * path the CLI uses), opened as a `file://` document in an already-installed Chromium, and driven
 * exclusively through the rendered UI: the source/pair `<select>`s, the theme/comparison radios,
 * the override inputs, the suggestion/apply/export/reset buttons. No runtime controller method is
 * called to shortcut a UI path and no fixture is a hand-built HTML stub, so a breakage in the
 * emitted markup, the wiring, or the real frames surfaces here.
 *
 * The fixtures are temporary consumer projects: a deliberately failing tuning with a known fix, an
 * arbitrary (hyphenated/digit) family name, a hostile-bytes palette, and stale/empty outputs. No
 * project input is ever read or written outside the temporary directory; no server and no network
 * are used.
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

// The pair is always chosen through the real <select>, by its declared data attributes, never by a
// hard-coded pair id: the UI is the source of the mapping under test.
function optionFor(page, { fg, bg, kind }) {
  return page.evaluate((query) => {
    const options = Array.from(document.querySelectorAll("#smart-colors-workbench-pair option"));
    const match = options.find((option) => {
      if (query.fg !== undefined && option.getAttribute("data-fg") !== query.fg) return false;
      if (query.bg !== undefined && option.getAttribute("data-bg") !== query.bg) return false;
      if (query.kind !== undefined && option.getAttribute("data-kind") !== query.kind) return false;
      return true;
    });
    return match ? { value: match.value, usage: match.getAttribute("data-usage"), sources: match.getAttribute("data-sources"), hidden: match.hidden } : null;
  }, { fg, bg, kind });
}

// Advanced selects, manual controls and the export live inside closed native details so the primary
// surface stays light. A real user opens them first, so the proof opens them before interacting.
async function revealDetails(page, selector = "#smart-colors-workbench details") {
  await page.evaluate((query) => {
    for (const details of document.querySelectorAll(query)) details.open = true;
  }, selector);
}

async function choosePair(page, query) {
  await revealDetails(page);
  const option = await optionFor(page, query);
  assert.ok(option, "no real pair option for " + JSON.stringify(query));
  await page.selectOption("#smart-colors-workbench-pair", option.value);
  await page.click("#smart-colors-workbench-submit");
  await settle(page);
  return option;
}

// The baseline/tuned split is the "tuning" comparison; the workbench starts on the light/dark
// ("themes") comparison, so a baseline-vs-candidate proof selects it explicitly.
async function selectComparison(page, value) {
  await page.click("#smart-colors-workbench-comparison-" + value);
  await settle(page);
  return state(page);
}

// Real source choice: open the technical details, pick the source in the native select, then settle.
async function selectSource(page, token) {
  await revealDetails(page);
  await page.selectOption("#smart-colors-workbench-source", token);
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

test("the source swatches are native buttons that choose a source, and the use chips stay bounded with a native detail for the rest", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const { page } = await openWorkbenchPage(mainContext, main.file);
  try {
    await revealDetails(page);
    // A real swatch is a native button the factory enables; a click is THE source choice.
    const swatch = await page.evaluate(() => {
      const button = document.querySelector('#smart-colors-workbench [data-smart-colors-workbench="swatch"]');
      return { tag: button.tagName, token: button.getAttribute("data-token"), disabled: button.disabled, pressed: button.getAttribute("aria-pressed") };
    });
    assert.equal(swatch.tag, "BUTTON", "the source swatch is a native button");
    assert.equal(swatch.disabled, false, "the factory enables the source swatches");

    await page.click('#smart-colors-workbench [data-smart-colors-workbench="swatch"][data-token="--palette-sea-gull"]');
    await settle(page);
    const afterSwatch = await page.evaluate(() => {
      const select = document.getElementById("smart-colors-workbench-pair");
      const option = select.options[select.selectedIndex];
      const uses = Array.from(document.querySelectorAll("#smart-colors-workbench-uses > ul.wb-uses > li > button.wb-use"));
      const more = document.querySelector("#smart-colors-workbench-uses > details.wb-more");
      return {
        source: document.getElementById("smart-colors-workbench-source").value,
        selectedFgSources: option.getAttribute("data-fg-sources") || "",
        uses: uses.length,
        useText: uses.map((button) => button.textContent.trim()).slice(0, 6),
        morePresent: Boolean(more),
        swatchPressed: document.querySelector('#smart-colors-workbench [data-smart-colors-workbench="swatch"][data-token="--palette-sea-gull"]').getAttribute("aria-pressed"),
      };
    });
    assert.equal(afterSwatch.source, "--palette-sea-gull", "clicking the swatch sets the real source");
    assert.match(afterSwatch.selectedFgSources, /--palette-sea-gull/, "the swatch selects the source's own preferred foreground use");
    assert.equal(afterSwatch.swatchPressed, "true", "the chosen swatch is announced as pressed");
    assert.ok(afterSwatch.uses >= 1 && afterSwatch.uses <= 6, "at most six use chips stay on the primary surface: " + afterSwatch.uses);
    assert.ok(afterSwatch.useText.every((text) => text.length > 0), "every use chip carries a label");

    // A use chip is a real action: it selects that pair.
    const chipValue = await page.evaluate(() => document.querySelector("#smart-colors-workbench-uses > ul.wb-uses > li > button.wb-use").getAttribute("data-pair-value"));
    await page.click("#smart-colors-workbench-uses > ul.wb-uses > li > button.wb-use");
    await settle(page);
    const afterChip = await page.evaluate(() => document.getElementById("smart-colors-workbench-pair").value);
    assert.equal(afterChip, chipValue, "clicking a use chip selects that pair");
    // Exactly one chip is pressed for the active pair.
    const pressed = await page.evaluate(() => Array.from(document.querySelectorAll('#smart-colors-workbench-uses button.wb-use')).filter((button) => button.getAttribute("aria-pressed") === "true").length);
    assert.ok(pressed <= 1, "at most one use chip is pressed: " + pressed);
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
    assert.equal(focusSpecimen.tag, "BUTTON");
    assert.equal(focusSpecimen.property, "outlineColor");
    assert.match(focusSpecimen.inlineStyle, /var\(--color-focus-ring\)/);
    assert.equal(focusSpecimen.outlineColor, (await measurement(page, "right")).foreground);

    await choosePair(page, { fg: "--color-sea-gull-border-strong", bg: "--color-bg", kind: "non-text" });
    const border = await page.evaluate(() => document.querySelector("#smart-colors-workbench-details pre code").textContent);
    assert.match(border, /^border: 2px solid var\(--color-sea-gull-border-strong\);/);
    assert.match(border, /background-color: var\(--color-bg\);/);
    assert.doesNotMatch(border, /^\s*color:/);

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
    assert.match(text.measure, /Target del progetto/);
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
    await page.selectOption("#smart-colors-workbench-source", "--palette-lagoon2");
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
    await page.click("#smart-colors-workbench-apply");
    await settle(page);
    const applied = await state(page);
    assert.equal(applied.draft[again.control], again.value, "apply writes exactly the proposed candidate value");
    assert.equal(await page.evaluate(() => document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length), 0, "the proposal frames are removed after apply");
    assert.equal(await page.evaluate(() => document.getElementById("smart-colors-workbench-proposal-frames").hidden), true);
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
