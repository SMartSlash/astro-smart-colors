/**
 * Reference-site proofs: the real root inputs, read read-only through temporary session copies.
 *
 * These three proofs are the only tests that require the actual site checkout. They are excluded
 * from the default and browser groups and run only through `node scripts/run-tests.mjs site
 * --browser=chromium`, which preflights the inputs before starting. A missing root is a failure,
 * not a skip. The approved 896 KiB preview budget covers the HTML and its local assets.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { pathToFileURL } from "node:url";
import { createDiagnosticSession } from "../../src/diagnostics/diagnostic-session.mjs";
import { runDiagnosticWorkflow } from "../../src/diagnostics/diagnostic-workflow.mjs";
import { formatContrastPreviewHtml } from "../../src/diagnostics/preview/format-report-preview.mjs";
import { WORKBENCH_RUNTIME_GLOBAL } from "../../src/diagnostics/preview/contrast-workbench-runtime.mjs";
import { REPORT_ASSETS } from "../../src/diagnostics/report-paths.mjs";
import { PACKAGE_ROOT, SITE_ROOT, assertSiteRoot } from "../helpers/roots.mjs";
import { browserSelection, declareSelection, loadPlaywright } from "../helpers/playwright.mjs";

const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";
const OPT_IN = "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium root-input proof";
const NATIVE_SELECTION = browserSelection(["chromium"]);

const PALETTE_PATH = "src/styles/tokens/palette.css";
const OUTPUT_PATH = "src/styles/tokens/colors.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const CONFIG_PATH = "smart-colors.config.mjs";
const ROOT_INPUTS = [PALETTE_PATH, OUTPUT_PATH, TUNING_PATH, CONFIG_PATH];

// The preview budget under test (the report harness's MAX_PREVIEW_BYTES) and the legacy cap it must
// provably exceed. Kept as literals so the proof is independent of the harness constant.
const PREVIEW_BUDGET_BYTES = 917_504;
const LEGACY_PREVIEW_BYTES = 225_280;

let playwright = null;
let browser = null;
let mainContext = null;

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

async function copyRootInputs(target) {
  await mkdir(path.join(target, "src/styles/tokens"), { recursive: true });
  for (const file of ROOT_INPUTS) await cp(path.join(SITE_ROOT, file), path.join(target, file));
  const scope = path.join(target, "node_modules", "@smartslash");
  await mkdir(scope, { recursive: true });
  await symlink(path.relative(scope, PACKAGE_ROOT), path.join(scope, "astro-smart-colors"), "dir");
  return target;
}

async function openPage(context, file) {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 });
  return page;
}

function settle(page) {
  return page.waitForFunction((name) => {
    const controller = window[name];
    return Boolean(controller && ["complete", "incomplete", "unavailable"].includes(controller.state().phase));
  }, WORKBENCH_RUNTIME_GLOBAL, { timeout: 30_000 });
}

async function openWorkbenchPage(context, file) {
  const page = await openPage(context, file);
  await page.waitForFunction((name) => Boolean(window[name]), WORKBENCH_RUNTIME_GLOBAL, { timeout: 20_000 });
  await settle(page);
  return { page };
}

const state = (page) => page.evaluate((name) => window[name].state(), WORKBENCH_RUNTIME_GLOBAL);

async function openUsePicker(page) {
  await page.click("#smart-colors-workbench-open-picker");
  await page.waitForFunction(() => {
    const dialog = document.getElementById("smart-colors-workbench-picker");
    return Boolean(dialog && dialog.open);
  }, null, { timeout: 5_000 });
}

before(async () => {
  if (!NATIVE_PROOF) return;
  await assertSiteRoot();
  if (NATIVE_SELECTION.skip) return;
  const loaded = loadPlaywright(NATIVE_SELECTION.engines);
  playwright = loaded.browsers;
  browser = await playwright.chromium.launch({ headless: true, timeout: 60_000 });
  mainContext = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce", viewport: { width: 1100, height: 900 } });
  // Only document navigation may proceed; any other request is aborted, so egress cannot pass.
  await mainContext.route("**/*", (route) => {
    const request = route.request();
    if (request.isNavigationRequest() && request.resourceType() === "document") return route.continue();
    return route.abort();
  });
});

after(async () => {
  if (browser) await browser.close();
});

test("the real root inputs, read read-only through a temp session copy, render an initial state that matches the measured pair", { skip: NATIVE_PROOF ? NATIVE_SELECTION.skip : OPT_IN }, async (t) => {
  declareSelection(t, NATIVE_SELECTION);
  const temp = await mkdtemp(path.join(tmpdir(), "smart-colors-root-qa-"));
  try {
    await copyRootInputs(temp);
    const rootBefore = await hashInputs(SITE_ROOT);
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
    assert.deepEqual(await hashInputs(SITE_ROOT), rootBefore, "the real root inputs must not be mutated");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("the Primary source surfaces representative semantic uses (page, button, callout, border, focus) instead of six borders", { skip: NATIVE_PROOF ? NATIVE_SELECTION.skip : OPT_IN }, async (t) => {
  declareSelection(t, NATIVE_SELECTION);
  const temp = await mkdtemp(path.join(tmpdir(), "smart-colors-primary-uses-"));
  try {
    await copyRootInputs(temp);
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

test("a real root-sized automation session keeps the preview within the 896 KiB budget and compacts only the preview, not the static report", { skip: NATIVE_PROOF ? NATIVE_SELECTION.skip : OPT_IN }, async (t) => {
  declareSelection(t, NATIVE_SELECTION);
  const temp = await mkdtemp(path.join(tmpdir(), "smart-colors-root-automation-"));
  try {
    await copyRootInputs(temp);
    const rootBefore = await hashInputs(SITE_ROOT);
    const copyBefore = await hashInputs(temp);

    // The documented explicit-browser automation path: one injected provider over the installed
    // Chromium, so no Playwright needs to resolve from the temp consumer. `runAutomation` closes the
    // launched browser and calls `provider.close()` in its own finally.
    const provider = {
      async open() { return { ok: true, request: "@playwright/test", resolved: PACKAGE_ROOT, browsers: playwright }; },
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
    // The offline budget covers the published bundle, not the HTML alone.
    const previewDir = path.dirname(workflow.publication.previewPath);
    const previewAssetPaths = [REPORT_ASSETS.previewStyle, REPORT_ASSETS.previewScript];
    const previewAssetBytes = (await Promise.all(previewAssetPaths.map((relativePath) => readFile(path.join(previewDir, relativePath)))))
      .reduce((total, content) => total + content.length, 0);
    const previewBundleBytes = previewBytes + previewAssetBytes;
    const assetSizes = (await Promise.all(previewAssetPaths.map(async (relativePath) => relativePath + ":" + (await readFile(path.join(previewDir, relativePath))).length))).join(", ");
    assert.ok(previewBundleBytes <= PREVIEW_BUDGET_BYTES, "the root-sized automation preview bundle (HTML + assets) must stay within " + PREVIEW_BUDGET_BYTES + " bytes: " + previewBundleBytes + " (html " + previewBytes + ", " + assetSizes + ")");
    // Compact preview vs full static report: the wide automation tables live only in the report.
    assert.match(previewHtml, /Apri misure complete nel report/, "the compact preview must link to the complete report");
    assert.doesNotMatch(previewHtml, /Misure automatizzate per coppia/, "the preview must not carry the wide automation table");
    assert.match(reportHtml, /Misure automatizzate per coppia/, "the static report keeps the full automation table");

    // Read-only: neither the temp copy nor the real root inputs changed.
    assert.deepEqual(await hashInputs(temp), copyBefore, "the root-sized automation run must not mutate its inputs");
    assert.deepEqual(await hashInputs(SITE_ROOT), rootBefore, "the real root inputs must not be mutated");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
