/**
 * Preview layout contract: static assertions always run; native DOM/layout proofs opt in with
 * SMART_COLORS_NATIVE_PROOF=1. Only an already-installed Playwright/Chromium is used. The consumer,
 * generated CSS, supported tuning and emitted preview live in a disposable offline fixture.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WORKBENCH_RUNTIME_GLOBAL } from "../src/contrast-workbench-runtime.mjs";
import { renderContrastWorkbench } from "../src/contrast-workbench-view.mjs";
import { createDiagnosticSession } from "../src/diagnostic-session.mjs";
import { formatContrastPreviewHtml } from "../src/format-report-preview.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";
const OPT_IN = "opt-in: set SMART_COLORS_NATIVE_PROOF=1; requires existing Playwright and Chromium (no install/download)";
const PREFIX = "#smart-colors-workbench-";
const HOOK = "data-smart-colors-workbench";
const PAGE_SIZE = 8;
const PALETTE = [
  ["canvas", "canvas", "0.97 0.005 250"],
  ["ink", "ink", "0.28 0.01 250"],
  ["lagoon2", "ui", "0.56 0.14 255"],
  ["coral", "feedback", "0.62 0.18 25"],
].map(([name, role, value]) => `@property --palette-${name} { syntax: "<color>"; inherits: true; initial-value: oklch(${value}); role: ${role}; }`).join("\n");
const SAVED_CONTROL = "--color-tune-text-light";
const SAVED_TUNING = `:root {\n  ${SAVED_CONTROL}: oklch(0.66 0 0);\n}\n`;

async function buildFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-preview-layout-"));
  try {
    await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
    await writeFile(path.join(root, "src/styles/tokens/palette.css"), PALETTE, "utf8");
    await writeFile(path.join(root, "smart-colors.config.mjs"), "export default {};\n", "utf8");
    await generateColorTokens({ root, suggest: false });
    await writeFile(path.join(root, "src/styles/tokens/colors-tuning.css"), SAVED_TUNING, "utf8");
    const { session } = await createDiagnosticSession({ root, suggest: false });
    const workbench = renderContrastWorkbench(session);
    const html = formatContrastPreviewHtml(session);
    const file = path.join(root, "preview.html");
    await writeFile(file, html, "utf8");
    return { root, session, workbench, html, file };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

// Small emitted-fragment helpers, not an HTML parser. Native proofs below independently check the
// browser-parsed ancestry; substring order alone cannot catch a stray closing section/div.
function attributes(open) {
  return Object.fromEntries(Array.from(open.matchAll(/\s([\w:-]+)(?:="([^"]*)")?/g), (match) => [match[1], match[2] ?? ""]));
}
function hasClass(attrs, name) {
  return (attrs.class || "").split(/\s+/).includes(name);
}
function elements(html, tag, predicate = () => true) {
  const found = [];
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))) {
    const attrs = attributes(match[0]);
    if (!predicate(attrs)) continue;
    const tokens = new RegExp(`</?${tag}\\b[^>]*>`, "g");
    tokens.lastIndex = match.index + match[0].length;
    let depth = 1;
    let token;
    while (depth && (token = tokens.exec(html))) depth += token[0].startsWith("</") ? -1 : 1;
    assert.equal(depth, 0, `unclosed <${tag}> fragment: ${match[0]}`);
    found.push({ attrs, open: match[0], html: html.slice(match.index, tokens.lastIndex), start: match.index, end: tokens.lastIndex });
  }
  return found;
}
function one(html, tag, predicate) {
  const matches = elements(html, tag, predicate);
  assert.equal(matches.length, 1, `expected one <${tag}> matching the layout hook`);
  return matches[0];
}
function byId(html, id) {
  const opening = Array.from(html.matchAll(/<([a-z][\w:-]*)\b[^>]*>/g)).find((match) => attributes(match[0]).id === id);
  assert.ok(opening, `missing #${id}`);
  return one(html, opening[1], (attrs) => attrs.id === id);
}
function inputAttrs(html, id) {
  const input = Array.from(html.matchAll(/<input\b[^>]*>/g), (match) => attributes(match[0])).find((attrs) => attrs.id === id);
  assert.ok(input, `missing input #${id}`);
  return input;
}
function catalogueValues(html) {
  return elements(byId(html, "smart-colors-workbench-pair").html, "option").map((option) => option.attrs.value).filter(Boolean);
}
function resolveChromium() {
  const require = createRequire(path.join(WORKSPACE_ROOT, "package.json"));
  for (const name of ["@playwright/test", "playwright"]) {
    try {
      const api = require(name);
      const chromium = api?.chromium || api?.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // Resolve the next existing consumer dependency; never install packages or browsers.
    }
  }
  return null;
}
async function waitComplete(page, revision = -1) {
  await page.waitForFunction(({ name, revision }) => {
    const state = window[name]?.state();
    return state?.phase === "complete" && state.revision > revision;
  }, { name: WORKBENCH_RUNTIME_GLOBAL, revision }, { timeout: 30_000 });
}
async function revisionOf(page) {
  return page.evaluate((name) => window[name].state().revision, WORKBENCH_RUNTIME_GLOBAL);
}
async function compareMode(page, mode) {
  if (await page.isChecked(PREFIX + "comparison-" + mode)) return waitComplete(page);
  const revision = await revisionOf(page);
  await page.check(PREFIX + "comparison-" + mode);
  await waitComplete(page, revision);
}
async function projection(page) {
  return page.evaluate(({ hook, prefix }) => {
    const values = (selector) => Array.from(document.querySelectorAll(selector))
      .filter((node) => !node.hidden).map((node) => node.getAttribute("data-pair-value"));
    return {
      tiles: values("li.wb-matrix-tile"),
      rows: values(`[${hook}="matrix-row"]`),
      page: document.querySelector(prefix + "matrix-page").textContent.trim(),
      previousDisabled: document.querySelector(prefix + "matrix-prev").disabled,
      nextDisabled: document.querySelector(prefix + "matrix-next").disabled,
      count: document.querySelector(prefix + "matrix-count").textContent.trim(),
    };
  }, { hook: HOOK, prefix: PREFIX });
}
function assertProjection(snapshot, pageNumber) {
  assert.deepEqual(snapshot.tiles, snapshot.rows, "table and grid share scope, filters, ordering and pagination even while one is hidden");
  assert.ok(snapshot.tiles.length <= PAGE_SIZE, "at most eight results per page");
  assert.equal(new Set(snapshot.tiles).size, snapshot.tiles.length, "no duplicate pair on a page");
  if (pageNumber !== undefined) assert.equal(Number(snapshot.page.match(/\d+/)?.[0]), pageNumber, "the readable page indicator follows navigation");
}
async function collectPages(page) {
  const seen = [];
  const total = await page.locator(PREFIX + "pair option").count();
  for (let number = 1; number <= Math.ceil(total / PAGE_SIZE) + 1; number += 1) {
    const snapshot = await projection(page);
    assertProjection(snapshot, number);
    assert.equal(snapshot.previousDisabled, number === 1, "previous is disabled only on the first page");
    if (!snapshot.nextDisabled) assert.equal(snapshot.tiles.length, PAGE_SIZE, "non-final pages contain eight pairs");
    seen.push(...snapshot.tiles);
    if (snapshot.nextDisabled) {
      assert.equal(new Set(seen).size, seen.length, "pagination never repeats pairs");
      return seen;
    }
    await page.click(PREFIX + "matrix-next");
  }
  assert.fail("pagination did not reach the end of the finite generated catalogue");
}

// Read each tile against its own pair in each full measurements array, never view.measurement
// (which describes only the selected pair). Normalize colours with the same native CSS engine.
async function measuredSamples(page, visibleOnly = true) {
  return page.evaluate(({ name, visibleOnly, hook }) => {
    const controller = window[name];
    const state = controller.state();
    const options = Array.from(document.getElementById("smart-colors-workbench-pair").options);
    const probe = document.createElement("span");
    probe.hidden = true;
    document.body.appendChild(probe);
    const result = [];
    for (const tile of document.querySelectorAll("li.wb-matrix-tile")) {
      if (visibleOnly && tile.hidden) continue;
      const value = tile.getAttribute("data-pair-value");
      const option = options.find((entry) => entry.value === value);
      for (const slot of ["left", "right"]) {
        const view = state.views.find((entry) => entry.slot === slot);
        const pair = view && option && controller.pairs(view.theme).find((entry) =>
          entry.foreground === option.getAttribute("data-fg") && entry.background === option.getAttribute("data-bg"));
        const measurement = view?.measurements?.find((entry) => entry.pairId === pair?.id);
        const tileView = tile.querySelector(`span.wb-tile-view[data-slot="${slot}"]`);
        const swatch = tileView?.querySelector("span.wb-pair-swatch");
        const cell = Array.from(document.querySelectorAll(`[${hook}="matrix-row"]`))
          .find((row) => row.getAttribute("data-pair-value") === value)?.querySelector(`[${hook}="matrix-cell"][data-slot="${slot}"]`);
        if (!measurement || !swatch || !tileView || !cell) {
          result.push({ value, slot, missing: "pair measurement, tile view, swatch or corresponding table cell" });
          continue;
        }
        probe.style.color = measurement.foreground;
        probe.style.backgroundColor = measurement.background;
        const expected = getComputedStyle(probe);
        const actual = getComputedStyle(swatch);
        result.push({
          value, slot, theme: view.theme, variant: view.variant, kind: option.getAttribute("data-kind"),
          measurement,
          foreground: swatch.style.getPropertyValue("--pair-foreground").trim(),
          background: swatch.style.getPropertyValue("--pair-background").trim(),
          color: actual.color, backgroundColor: actual.backgroundColor,
          expectedColor: expected.color, expectedBackground: expected.backgroundColor,
          unmeasured: swatch.classList.contains("is-unmeasured"),
          source: tileView.getAttribute("data-source"), status: tileView.getAttribute("data-status"),
          ratio: tileView.querySelector(".wb-matrix-ratio")?.textContent,
          statusText: tileView.querySelector(".wb-matrix-status")?.textContent,
          sourceText: tileView.querySelector(".wb-matrix-source")?.textContent,
          tableSource: cell.getAttribute("data-source"), tableStatus: cell.getAttribute("data-status"),
          tableRatio: cell.querySelector(".wb-matrix-ratio")?.textContent,
          statusMarkup: tileView.querySelector(".wb-matrix-status")?.outerHTML,
          badgeCount: tileView.querySelectorAll(".wb-matrix-badge").length,
        });
      }
    }
    probe.remove();
    return result;
  }, { name: WORKBENCH_RUNTIME_GLOBAL, visibleOnly, hook: HOOK });
}
function assertSamples(samples) {
  assert.ok(samples.length >= 2, "both views expose real colour samples");
  for (const sample of samples) {
    const context = `${sample.value}, ${sample.slot} (${sample.variant})`;
    assert.equal(sample.missing, undefined, context);
    assert.equal(sample.foreground, sample.measurement.foreground, `computed foreground from the matching runtime pair: ${context}`);
    assert.equal(sample.background, sample.measurement.background, `computed background from the matching runtime pair: ${context}`);
    assert.doesNotMatch(sample.foreground + sample.background, /var\s*\(/i, "no host token lookup paints a consumer sample");
    assert.equal(sample.color, sample.expectedColor, `painted foreground: ${context}`);
    assert.equal(sample.backgroundColor, sample.expectedBackground, `painted background: ${context}`);
    assert.equal(sample.unmeasured, false, context);
    assert.equal(sample.source, "live", context);
    assert.equal(sample.tableSource, "live", context);
    assert.match(sample.sourceText, /live/i, context);
    assert.equal(sample.status, sample.measurement.status, context);
    assert.equal(sample.tableStatus, sample.measurement.status, context);
    assert.match(sample.statusText, /minimo|target/i, "the verdict names the minimum or project target");
    assert.equal(sample.ratio, sample.tableRatio, `table/grid ratio agreement: ${context}`);
    const ratio = Number(sample.ratio?.match(/\d+(?:[.,]\d+)?/)?.[0].replace(",", "."));
    assert.ok(Math.abs(ratio - sample.measurement.ratio) <= 0.02, `labelled ratio follows its own measurement: ${context}`);
    assert.equal(sample.badgeCount, 0, "automatic AA/AAA badges are not emitted for any pair");
    if (sample.kind === "non-text") assert.doesNotMatch(sample.statusMarkup, /\bAA(?:A)?\b/, "a real non-text status does not grant AA/AAA");
  }
}

describe("generated preview layout contract", () => {
  let built;
  before(async () => { built = await buildFixture(); });
  after(async () => { if (built) await rm(built.root, { recursive: true, force: true }); });

  test("the fixture keeps at least twelve real diagnostic pairs and supported saved tuning", () => {
    const pairs = catalogueValues(built.workbench);
    assert.ok(pairs.length >= 12, "a single page must not accidentally satisfy the catalogue proof");
    assert.equal(new Set(pairs).size, pairs.length);
    assert.equal(built.session.css.baselineSupport, "supported");
    assert.equal(built.session.css.tuningSupport, "supported");
    assert.match(built.session.css.tuning, /--color-tune-text-light: oklch\(0\.66 0 0\)/);
    assert.ok(built.session.model.diagnostics.some((entry) => entry.kind === "non-text"));
    for (const value of pairs) {
      const [foreground, background] = value.split("|");
      assert.ok(built.session.model.diagnostics.some((entry) => entry.foregroundToken === foreground && entry.backgroundToken === background), "every option comes from generated diagnostics");
    }
  });

  test("static overview is open and emits a labelled native list with inert pressed-state buttons", () => {
    const overview = one(built.workbench, "details", (attrs) => hasClass(attrs, "wb-overview"));
    assert.ok(Object.hasOwn(overview.attrs, "open"), "the no-JS overview starts open");
    const grid = one(overview.html, "ul", (attrs) => hasClass(attrs, "wb-matrix-grid"));
    assert.match(grid.attrs["aria-label"], /\S/);
    const tiles = elements(grid.html, "li", (attrs) => hasClass(attrs, "wb-matrix-tile"));
    assert.ok(tiles.length > 0, "the renderer emits static tiles before enhancement");
    for (const tile of tiles) {
      assert.ok(tile.attrs["data-pair-value"]);
      assert.notEqual(tile.attrs.role, "button", "list items are not fake buttons");
      const button = one(tile.html, "button", (attrs) => hasClass(attrs, "wb-tile-select"));
      assert.equal(button.attrs.type, "button");
      assert.ok(Object.hasOwn(button.attrs, "disabled"), "static selection is natively disabled");
      assert.match(button.attrs["aria-pressed"], /^(?:true|false)$/);
      assert.doesNotMatch(button.html, /<(?:div|section|button)\b[\s\S]*<(?:div|section|button)\b/, "button content stays phrasing content");
      const views = elements(button.html, "span", (attrs) => hasClass(attrs, "wb-tile-view"));
      assert.deepEqual(views.map((view) => view.attrs["data-slot"]), ["left", "right"]);
    }
  });

  test("static samples are honestly unmeasured and each view labels its own build estimate", () => {
    const grid = one(built.workbench, "ul", (attrs) => hasClass(attrs, "wb-matrix-grid"));
    const views = elements(grid.html, "span", (attrs) => hasClass(attrs, "wb-tile-view"));
    assert.ok(views.length > 0);
    for (const view of views) {
      const swatch = one(view.html, "span", (attrs) => hasClass(attrs, "wb-pair-swatch"));
      assert.ok(hasClass(swatch.attrs, "is-unmeasured"), "build ratios alone cannot supply live colours");
      assert.match(view.html, /Colori live non disponibili/i);
      assert.doesNotMatch(view.html, /style="[^"]*var\s*\(/i, "no unresolved consumer token is used in a host sample");
      assert.match(one(view.html, "span", (attrs) => hasClass(attrs, "wb-matrix-source")).html, /stima|build/i);
      assert.match(one(view.html, "span", (attrs) => hasClass(attrs, "wb-matrix-ratio")).html, /\d|non misurat/i);
      assert.match(one(view.html, "span", (attrs) => hasClass(attrs, "wb-matrix-status")).html, /minimo|target|non misurat/i);
    }
    const nonTextSession = { ...built.session, samples: [], model: { ...built.session.model, diagnostics: built.session.model.diagnostics.filter((entry) => entry.kind === "non-text") } };
    const nonTextHtml = renderContrastWorkbench(nonTextSession);
    const nonTextGrid = one(nonTextHtml, "ul", (attrs) => hasClass(attrs, "wb-matrix-grid"));
    const nonTextTable = byId(nonTextHtml, "smart-colors-workbench-matrix-table");
    const nonTextTiles = elements(nonTextGrid.html, "li", (attrs) => attrs["data-pair-value"]?.endsWith("|non-text"));
    const nonTextRows = elements(nonTextTable.html, "tr", (attrs) => attrs["data-pair-value"]?.endsWith("|non-text"));
    assert.ok(nonTextTiles.length > 0 && nonTextRows.length > 0, "both presentations emit real non-text pairs, not only text pairs from the sample manifest");
    for (const pair of [...nonTextTiles, ...nonTextRows]) {
      const statuses = elements(pair.html, "span", (attrs) => hasClass(attrs, "wb-matrix-status"));
      assert.equal(statuses.length, 2, "each non-text pair has one real verdict per comparison view");
      for (const status of statuses) {
        assert.match(status.attrs["data-status"], /^(?:pass|below-minimum|below-target)$/);
        assert.match(status.html, /minimo|target/i, "a measured non-text status names the minimum or target");
      }
      assert.doesNotMatch(pair.html, /\bAA(?:A)?\b/, "non-text results never infer AA/AAA conformance");
    }
    assert.equal(elements(grid.html, "span", (attrs) => hasClass(attrs, "wb-matrix-badge")).length, 0, "all-pair tiles replace automatic badges with textual statuses");
  });

  test("display, pagination and filters stay inert in static HTML while the snapshot table is present", () => {
    const table = byId(built.workbench, "smart-colors-workbench-matrix-table");
    assert.match(table.html, /<table\b/);
    const radios = ["grid", "table"].map((mode) => inputAttrs(built.workbench, "smart-colors-workbench-display-" + mode));
    for (const radio of radios) {
      assert.equal(radio.type, "radio");
      assert.ok(Object.hasOwn(radio, "disabled"));
    }
    assert.ok(radios[0].name && radios[0].name === radios[1].name, "native radios share one group");
    for (const action of ["prev", "next"]) {
      const button = byId(built.workbench, "smart-colors-workbench-matrix-" + action);
      assert.ok(Object.hasOwn(button.attrs, "disabled"));
      assert.equal(button.attrs.type, "button");
    }
    assert.match(byId(built.workbench, "smart-colors-workbench-matrix-page").html, /\d/);
    assert.ok(Object.hasOwn(inputAttrs(built.workbench, "smart-colors-workbench-matrix-search"), "disabled"));
    assert.ok(Object.hasOwn(inputAttrs(built.workbench, "smart-colors-workbench-matrix-all"), "disabled"));
    assert.ok(Object.hasOwn(byId(built.workbench, "smart-colors-workbench-matrix-filter").attrs, "disabled"));
    assert.match(built.workbench, /<noscript>[\s\S]*?snapshot di build[\s\S]*?<\/noscript>/);
  });

  test("inspector has a fragment target, samples precede disclosed CSS, and export stays in the workbench", () => {
    const host = byId(built.workbench, "smart-colors-workbench");
    const inspector = byId(host.html, "smart-colors-workbench-inspector");
    assert.equal(inspector.attrs.tabindex, "-1");
    const frames = byId(inspector.html, "smart-colors-workbench-result");
    assert.ok(hasClass(frames.attrs, "wb-frames"));
    const code = one(inspector.html, "details", (attrs) => hasClass(attrs, "wb-code-details"));
    assert.ok(frames.end <= code.start, "real samples precede the optional CSS disclosure");
    assert.match(code.html, /smart-colors-workbench-snippet-code/);
    const split = one(host.html, "div", (attrs) => hasClass(attrs, "wb-main-split"));
    const pane = one(split.html, "section", (attrs) => hasClass(attrs, "wb-pane-inspector"));
    const exported = byId(split.html, "smart-colors-workbench-tuning");
    assert.ok(hasClass(exported.attrs, "wb-pane-export"));
    assert.ok(exported.start >= pane.end, "export follows, rather than nests inside, the inspector");
    const link = one(host.html, "a", (attrs) => attrs.href === "#smart-colors-workbench-inspector");
    assert.match(link.html, /Vai al dettaglio/);
    const grid = one(host.html, "ul", (attrs) => hasClass(attrs, "wb-matrix-grid"));
    assert.ok(link.start > grid.end, "explicit navigation follows the matrix");
  });

  describe("offline Chromium proof", { skip: NATIVE_PROOF ? false : OPT_IN }, () => {
    let browser;
    before(async () => {
      const chromium = resolveChromium();
      assert.ok(chromium, "BLOCKED: existing Playwright/Chromium is not resolvable from the workspace; nothing is installed or downloaded");
      browser = await chromium.launch({ headless: true, timeout: 60_000 });
    });
    after(async () => { if (browser) await browser.close(); });

    async function withPage(options, run) {
      const context = await browser.newContext({ offline: true, colorScheme: "light", reducedMotion: "reduce", viewport: { width: 1440, height: 1000 }, ...options });
      const forbiddenRequests = [];
      const errors = [];
      try {
        await context.route("**/*", async (route) => {
          const url = route.request().url();
          if (/^(?:file|data|about|blob):/.test(url)) return route.continue();
          forbiddenRequests.push(url);
          return route.abort();
        });
        const page = await context.newPage();
        page.setDefaultTimeout(10_000);
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(pathToFileURL(built.file).href, { waitUntil: "load", timeout: 30_000 });
        if (options.javaScriptEnabled !== false) await waitComplete(page);
        const missingHooks = await page.evaluate((selectors) => selectors.filter((selector) => !document.querySelector(selector)), [
          "ul.wb-matrix-grid", "li.wb-matrix-tile button.wb-tile-select", "span.wb-tile-view[data-slot=left]", "span.wb-tile-view[data-slot=right]",
          PREFIX + "inspector", PREFIX + "tuning", PREFIX + "matrix-table", PREFIX + "matrix-prev", PREFIX + "matrix-next", PREFIX + "matrix-page",
          PREFIX + "display-grid", PREFIX + "display-table", "details.wb-code-details",
        ]);
        assert.deepEqual(missingHooks, [], "the emitted DOM must expose the agreed preview layout hooks");
        await run(page);
        assert.deepEqual(forbiddenRequests, [], "the emitted fixture never attempts an external resource request");
        assert.deepEqual(errors, [], "no pageerror or console error in the native proof");
      } finally {
        await context.close();
      }
    }

    test("browser parsing keeps export inside the host, full-width panes stack at 1440 and 390 without document overflow", { timeout: 90_000 }, async () => {
      await withPage({}, async (page) => {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          const layout = await page.evaluate(() => {
            const host = document.getElementById("smart-colors-workbench");
            const overview = host.querySelector("details.wb-overview");
            const pane = host.querySelector(".wb-pane-inspector");
            const exported = document.getElementById("smart-colors-workbench-tuning");
            const target = document.getElementById("smart-colors-workbench-inspector");
            const split = host.querySelector(".wb-main-split");
            const frames = target?.querySelector("#smart-colors-workbench-result");
            const code = target?.querySelector("details.wb-code-details");
            const box = (node) => { const rect = node.getBoundingClientRect(); return { left: rect.left, width: rect.width, top: rect.top, bottom: rect.bottom }; };
            const grid = host.querySelector("ul.wb-matrix-grid");
            const table = document.getElementById("smart-colors-workbench-matrix-table");
            return {
              overviewOpen: overview.open, overview: box(overview), pane: box(pane), exported: box(exported),
              exportCount: document.querySelectorAll(".wb-pane-export").length,
              insideHost: host.contains(exported), siblings: pane.parentElement === split && exported.parentElement === split && pane.nextElementSibling === exported,
              target: target === pane || Boolean(target?.contains(pane)), tabindex: target?.getAttribute("tabindex"),
              samplesBeforeCode: Boolean(frames && code && (frames.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING)),
              invalidButtonContent: grid.querySelectorAll("button div, button section, button button, [role=button]").length,
              gridVisible: grid.getClientRects().length > 0 && getComputedStyle(grid).display !== "none",
              tableHidden: table.hidden || getComputedStyle(table).display === "none",
              gridChecked: document.getElementById("smart-colors-workbench-display-grid").checked,
              documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, viewport: document.documentElement.clientWidth,
            };
          });
          assert.equal(layout.overviewOpen, true);
          assert.equal(layout.exportCount, 1);
          assert.equal(layout.insideHost, true, "browser repair must not eject export from the host");
          assert.equal(layout.siblings, true, "export is the inspector's immediate next sibling inside main-split");
          assert.equal(layout.target, true);
          assert.equal(layout.tabindex, "-1");
          assert.equal(layout.samplesBeforeCode, true);
          assert.equal(layout.invalidButtonContent, 0);
          assert.equal(layout.gridVisible, true);
          assert.equal(layout.tableHidden, true);
          assert.equal(layout.gridChecked, true);
          for (const box of [layout.pane, layout.exported]) {
            assert.ok(box.width > 0 && Math.abs(box.width - layout.overview.width) <= Math.max(3, layout.overview.width * 0.015), `both panes use approximately the overview width at ${width}px`);
            assert.ok(Math.abs(box.left - layout.overview.left) <= 3, `panes align with the overview at ${width}px`);
          }
          assert.ok(layout.exported.top >= layout.pane.bottom - 1, "export is below the inspector, never a desktop side column");
          assert.ok(layout.documentWidth <= layout.viewport + 1 && layout.bodyWidth <= layout.viewport + 1, `no document overflow at ${width}px`);
          await page.check(PREFIX + "display-table");
          const tableLayout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
          assert.ok(tableLayout.width <= tableLayout.viewport + 1, `the enhanced table also contains horizontal overflow at ${width}px`);
          await page.check(PREFIX + "display-grid");
        }
      });
    });

    test("eight-pair pages reach the whole catalogue; table/grid toggles, source scope, outcome, search and empty recovery agree", { timeout: 90_000 }, async () => {
      await withPage({}, async (page) => {
        await page.check(PREFIX + "matrix-all");
        const catalogue = await page.locator(PREFIX + "pair option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
        const all = await collectPages(page);
        assert.ok(all.length >= 12);
        assert.deepEqual([...all].sort(), [...catalogue].sort(), "every generated pair is reachable, not just a sliced prefix");
        await page.click(PREFIX + "matrix-clear");
        assertProjection(await projection(page), 1);
        await page.click(PREFIX + "matrix-next");
        const second = await projection(page);
        assertProjection(second, 2);
        await page.check(PREFIX + "display-table");
        assert.equal(await page.locator(PREFIX + "matrix-table").isVisible(), true);
        assert.equal(await page.locator("ul.wb-matrix-grid").isVisible(), false);
        assert.deepEqual(await projection(page), second, "changing presentation does not reset the page or filters");
        await page.check(PREFIX + "display-grid");
        assert.deepEqual(await projection(page), second);

        await page.uncheck(PREFIX + "matrix-all");
        assertProjection(await projection(page), 1);
        const scoped = await collectPages(page);
        assert.ok(scoped.length > 0 && scoped.length < all.length, "the selected source narrows the full catalogue");
        await page.check(PREFIX + "matrix-all");
        assertProjection(await projection(page), 1);
        await page.click(PREFIX + "matrix-next");
        await page.selectOption(PREFIX + "matrix-filter", "issues");
        assertProjection(await projection(page), 1);
        const issues = await collectPages(page);
        assert.ok(issues.length > 0 && issues.length < all.length, "saved tuning supplies real below-minimum/target results");
        const issueStatuses = await page.locator(`[${HOOK}="matrix-row"]`).evaluateAll((rows, values) => rows
          .filter((row) => values.includes(row.getAttribute("data-pair-value")))
          .map((row) => row.getAttribute("data-status-effective") || row.getAttribute("data-status")), issues);
        assert.ok(issueStatuses.every((status) => status === "below-minimum" || status === "below-target"));

        await page.click(PREFIX + "matrix-clear");
        await page.click(PREFIX + "matrix-next");
        await page.fill(PREFIX + "matrix-search", "--color-text");
        assertProjection(await projection(page), 1);
        const searched = await collectPages(page);
        assert.ok(searched.length > 0 && searched.length < all.length);
        assert.ok(searched.every((value) => value.includes("--color-text")), "search does not silently broaden the selected token");
        await page.fill(PREFIX + "matrix-search", "no-such-pair-layout-proof");
        const empty = await projection(page);
        assertProjection(empty, 1);
        assert.deepEqual(empty.tiles, []);
        assert.equal(empty.previousDisabled, true);
        assert.equal(empty.nextDisabled, true);
        assert.match(empty.count, /\b0\b|nessun/i);
        await page.check(PREFIX + "display-table");
        assert.equal(await page.locator(`[${HOOK}="matrix-empty"]`).isVisible(), true, "the table exposes its empty state");
        await page.click(PREFIX + "matrix-clear");
        const recovered = await projection(page);
        assertProjection(recovered, 1);
        assert.equal(recovered.tiles.length, PAGE_SIZE);
        await page.check(PREFIX + "display-grid");
        assert.equal(await page.locator("ul.wb-matrix-grid li.wb-matrix-tile:visible").count(), PAGE_SIZE);
      });
    });

    test("the native tile list is Tab-reachable without grid roles or arrow-key activation", { timeout: 60_000 }, async () => {
      await withPage({}, async (page) => {
        await page.check(PREFIX + "matrix-all");
        const buttons = page.locator("li.wb-matrix-tile:not([hidden]) button.wb-tile-select");
        assert.equal(await buttons.count(), PAGE_SIZE);
        assert.deepEqual(await buttons.evaluateAll((nodes) => nodes.map((node) => ({ tag: node.tagName, tabIndex: node.tabIndex, disabled: node.disabled }))),
          Array.from({ length: PAGE_SIZE }, () => ({ tag: "BUTTON", tabIndex: 0, disabled: false })), "every visible native button participates in the regular Tab order");
        assert.equal(await page.locator('ul.wb-matrix-grid[role="grid"], ul.wb-matrix-grid [role="gridcell"]').count(), 0, "a list is not an ARIA grid");
        const first = buttons.first();
        await first.focus();
        const before = await page.evaluate((name) => ({ selection: window[name].state().selection, revision: window[name].state().revision }), WORKBENCH_RUNTIME_GLOBAL);
        await first.press("ArrowRight");
        await first.press("ArrowLeft");
        assert.equal(await first.evaluate((node) => document.activeElement === node), true, "arrows do not invent a custom grid focus model");
        assert.deepEqual(await page.evaluate((name) => ({ selection: window[name].state().selection, revision: window[name].state().revision }), WORKBENCH_RUNTIME_GLOBAL), before, "arrow keys never activate a pair or trigger a measurement");
        for (let index = 1; index < PAGE_SIZE; index += 1) {
          await page.keyboard.press("Tab");
          assert.equal(await buttons.nth(index).evaluate((node) => document.activeElement === node), true, `Tab reaches tile ${index + 1}`);
        }
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest("li.wb-matrix-tile"))), false, "Tab leaves the list after its last visible tile");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await buttons.last().evaluate((node) => document.activeElement === node), true, "reverse Tab returns to the last tile");
      });
    });

    for (const display of ["grid", "table"]) {
      test(`live-filter page two keeps ${display} selection, focus and scroll while measurements refresh`, { timeout: 60_000 }, async () => {
        await withPage({}, async (page) => {
          await page.check(PREFIX + "matrix-all");
          await page.selectOption(PREFIX + "matrix-filter", "live");
          await page.click(PREFIX + "matrix-next");
          await page.check(PREFIX + "display-" + display);
          const before = await projection(page);
          assertProjection(before, 2);
          assert.equal(before.tiles.length, PAGE_SIZE, "the live filter has a genuine second page before selection");
          const catalogueCount = await page.locator(PREFIX + "pair option").count();
          const value = await page.locator('li.wb-matrix-tile:not([hidden]) button.wb-tile-select[aria-pressed="false"]').first()
            .evaluate((node) => node.closest("li").getAttribute("data-pair-value"));
          const pairSelector = `[data-pair-value=${JSON.stringify(value)}]`;
          const selector = display === "grid"
            ? `li.wb-matrix-tile${pairSelector} button.wb-tile-select`
            : `[${HOOK}="matrix-row"]${pairSelector} [${HOOK}="matrix-inspect"]`;
          const button = page.locator(selector);
          assert.equal(await button.isVisible(), true, "Enter targets a visible button on the active second page");
          await button.scrollIntoViewIfNeeded();
          await button.focus();
          const scrollBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY, table: document.getElementById("smart-colors-workbench-matrix-table").scrollTop }));
          const revision = await revisionOf(page);

          // Subscribe after the real view: each observation sees the DOM projected for that published
          // running state, even if Chromium completes the local measurement between Playwright calls.
          const observation = await page.evaluateHandle(({ name, selector, hook }) => {
            const target = document.querySelector(selector);
            const proof = { running: [], unsubscribe: null };
            proof.unsubscribe = window[name].subscribe((state) => {
              if (state.phase !== "running") return;
              const values = (query) => Array.from(document.querySelectorAll(query)).filter((node) => !node.hidden)
                .map((node) => node.getAttribute("data-pair-value"));
              const swatches = Array.from(document.querySelectorAll(".wb-pair-swatch, .wb-matrix-cell-swatch"));
              proof.running.push({
                tiles: values("li.wb-matrix-tile"), rows: values(`[${hook}="matrix-row"]`),
                page: document.getElementById("smart-colors-workbench-matrix-page").textContent,
                focused: document.activeElement === target,
                visible: target.isConnected && target.getClientRects().length > 0,
                gridBusy: document.querySelector("ul.wb-matrix-grid").getAttribute("aria-busy"),
                tableBusy: document.getElementById("smart-colors-workbench-matrix-table").getAttribute("aria-busy"),
                pendingText: ["matrix-page", "matrix-count", "status"].map((suffix) => document.getElementById("smart-colors-workbench-" + suffix).textContent).join(" "),
                swatches: swatches.length,
                retainedColors: swatches.filter((node) => node.style.getPropertyValue("--pair-foreground").trim() || node.style.getPropertyValue("--pair-background").trim()).length,
                measuredSwatches: swatches.filter((node) => !node.classList.contains("is-unmeasured")).length,
                liveResults: document.querySelectorAll(`.wb-tile-view[data-source="live"], [${hook}="matrix-cell"][data-source="live"]`).length,
                x: scrollX, y: scrollY, tableScroll: document.getElementById("smart-colors-workbench-matrix-table").scrollTop,
              });
            });
            return proof;
          }, { name: WORKBENCH_RUNTIME_GLOBAL, selector, hook: HOOK });
          try {
            await button.press("Enter");
            await waitComplete(page, revision);
            const running = await observation.evaluate((proof) => proof.running);
            assert.ok(running.length > 0, "a real running publication is observed, not only the eventual complete state");
            for (const pending of running) {
              assertProjection(pending, 2);
              assert.deepEqual(pending.tiles, before.tiles, "running preserves the live-filter membership and page, not a zero-result projection");
              assert.equal(pending.focused, true, "the original pair button retains focus during measurement");
              assert.equal(pending.visible, true, "the focused button is never hidden by the transient absence of live results");
              assert.equal(pending.gridBusy, "true");
              assert.equal(pending.tableBusy, "true");
              assert.match(pending.pendingText, /Verifica in corso/i);
              assert.equal(pending.swatches, catalogueCount * 4, "both views of every tile and table row participate in invalidation");
              assert.equal(pending.retainedColors, 0, "preserving membership must not preserve stale live colours");
              assert.equal(pending.measuredSwatches, 0);
              assert.equal(pending.liveResults, 0, "old ratios must not remain labelled live during remeasurement");
              assert.ok(Math.abs(pending.y - scrollBefore.y) <= 2 && Math.abs(pending.x - scrollBefore.x) <= 1, "running does not scroll the document");
              assert.ok(Math.abs(pending.tableScroll - scrollBefore.table) <= 1, "running does not reset the table's local scroll");
            }

            const after = await projection(page);
            assertProjection(after, 2);
            assert.deepEqual(after.tiles, before.tiles, "fresh complete measurements restore the same live membership on page two");
            assert.equal(await button.evaluate((node) => document.activeElement === node), true, "complete keeps focus on the same button, not another pair or the search field");
            assert.equal(await button.isVisible(), true);
            const selected = await page.evaluate((name) => {
              const state = window[name].state();
              const pair = window[name].pairs(state.selection.theme).find((entry) => entry.id === state.selection.pairId);
              return {
                foreground: pair.foreground, background: pair.background,
                filter: document.getElementById("smart-colors-workbench-matrix-filter").value,
                gridBusy: document.querySelector("ul.wb-matrix-grid").getAttribute("aria-busy"),
                tableBusy: document.getElementById("smart-colors-workbench-matrix-table").getAttribute("aria-busy"),
                x: scrollX, y: scrollY, tableScroll: document.getElementById("smart-colors-workbench-matrix-table").scrollTop,
              };
            }, WORKBENCH_RUNTIME_GLOBAL);
            assert.deepEqual([selected.foreground, selected.background], value.split("|").slice(0, 2), "Enter selects exactly the requested pair");
            assert.equal(selected.filter, "live");
            assert.notEqual(selected.gridBusy, "true");
            assert.notEqual(selected.tableBusy, "true");
            assert.ok(Math.abs(selected.y - scrollBefore.y) <= 2 && Math.abs(selected.x - scrollBefore.x) <= 1, "complete does not scroll to the inspector or a reset page");
            assert.ok(Math.abs(selected.tableScroll - scrollBefore.table) <= 1, "complete preserves the table's local scroll");
            const samples = await measuredSamples(page, false);
            assert.equal(samples.length, catalogueCount * 2, "the catalogue still exposes both fresh measured views for every pair");
            assertSamples(samples);
          } finally {
            await observation.evaluate((proof) => proof.unsubscribe());
            await observation.dispose();
          }
        });
      });
    }

    test("both tile views use their own measured colours; selection does not scroll and measurement/tuning/draft keep the page", { timeout: 120_000 }, async () => {
      await withPage({}, async (page) => {
        await page.check(PREFIX + "matrix-all");
        await compareMode(page, "themes");
        await page.click(PREFIX + "matrix-next");
        const second = await projection(page);
        assertProjection(second, 2);
        const themes = await measuredSamples(page);
        assertSamples(themes);
        assert.ok(themes.some((sample) => sample.slot === "left" && sample.theme === "light"));
        assert.ok(themes.some((sample) => sample.slot === "right" && sample.theme === "dark"));

        const choice = page.locator('li.wb-matrix-tile:not([hidden]) button.wb-tile-select[aria-pressed="false"]').first();
        const value = await choice.evaluate((node) => node.closest("li").getAttribute("data-pair-value"));
        const button = page.locator(`li.wb-matrix-tile[data-pair-value=${JSON.stringify(value)}] button.wb-tile-select`);
        await button.scrollIntoViewIfNeeded();
        await button.focus();
        const before = await page.evaluate(() => ({ y: window.scrollY, x: window.scrollX }));
        const revision = await revisionOf(page);
        await button.press("Enter");
        await waitComplete(page, revision);
        assert.equal(await button.getAttribute("aria-pressed"), "true", "native keyboard selection updates pressed state");
        const selected = await page.evaluate((name) => {
          const state = window[name].state();
          const pair = window[name].pairs(state.selection.theme).find((entry) => entry.id === state.selection.pairId);
          return { foreground: pair.foreground, background: pair.background, y: window.scrollY, x: window.scrollX, focus: document.activeElement?.className };
        }, WORKBENCH_RUNTIME_GLOBAL);
        assert.deepEqual([selected.foreground, selected.background], value.split("|").slice(0, 2));
        assert.ok(Math.abs(selected.y - before.y) <= 2 && Math.abs(selected.x - before.x) <= 1, "selecting a tile never scrolls to the inspector");
        assert.match(selected.focus, /wb-tile-select/, "measurement does not steal focus from the native tile button");
        assert.deepEqual((await projection(page)).tiles, second.tiles, "selection/measurement does not reset page two");
        assertProjection(await projection(page), 2);

        await compareMode(page, "tuning");
        assertProjection(await projection(page), 2);
        const tuning = await measuredSamples(page, false);
        assertSamples(tuning);
        const text = tuning.filter((sample) => sample.value.startsWith("--color-text|--color-bg|"));
        assert.equal(text.length, 2, "the real generated neutral text pair is present even off-page");
        assert.notEqual(text[0].color, text[1].color, "baseline and saved tuning actually paint different colours");
        const pageBeforeDraft = await projection(page);
        const draftRevision = await revisionOf(page);
        await page.evaluate(async ({ name, control }) => { await window[name].setOverride(control, "oklch(0.35 0 0)"); }, { name: WORKBENCH_RUNTIME_GLOBAL, control: SAVED_CONTROL });
        await waitComplete(page, draftRevision);
        assertProjection(await projection(page), 2);
        assert.deepEqual((await projection(page)).tiles, pageBeforeDraft.tiles, "a draft remeasurement preserves the same page");
        const draft = await measuredSamples(page, false);
        assertSamples(draft);
        const draftText = draft.filter((sample) => sample.value.startsWith("--color-text|--color-bg|"));
        assert.equal(draftText.length, 2);
        assert.equal(draftText.find((sample) => sample.slot === "right").variant, "draft");
        assert.equal(draftText.find((sample) => sample.slot === "left").color, text.find((sample) => sample.slot === "right").color, "before/draft retains the saved tuning on the left");
        assert.notEqual(draftText.find((sample) => sample.slot === "right").color, draftText.find((sample) => sample.slot === "left").color, "the right swatch follows the changed draft, not a cached build ratio");
        assert.equal(await page.evaluate((name) => window[name].state().draft["--color-tune-text-light"], WORKBENCH_RUNTIME_GLOBAL), "oklch(0.35 0 0)");
        await page.getByRole("link", { name: /^Vai al dettaglio/ }).click();
        await page.waitForFunction(() => location.hash === "#smart-colors-workbench-inspector" && document.activeElement?.id === "smart-colors-workbench-inspector");
      });
    });

    test("without JavaScript the open snapshot table is readable, grid is hidden and interactive controls do not pretend to work", { timeout: 60_000 }, async () => {
      await withPage({ javaScriptEnabled: false }, async (page) => {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 });
          const noJs = await page.evaluate(({ name, hook }) => {
            const overview = document.querySelector("details.wb-overview");
            const table = document.getElementById("smart-colors-workbench-matrix-table");
            const grid = document.querySelector("ul.wb-matrix-grid");
            const controls = ["matrix-search", "matrix-filter", "matrix-all", "matrix-prev", "matrix-next", "display-grid", "display-table"]
              .map((suffix) => document.getElementById("smart-colors-workbench-" + suffix));
            const rows = Array.from(table.querySelectorAll(`[${hook}="matrix-row"]`));
            return {
              runtime: typeof window[name], overviewOpen: overview.open,
              tableVisible: table.getClientRects().length > 0 && getComputedStyle(table).display !== "none" && !table.hidden,
              gridHidden: grid.hidden || getComputedStyle(grid).display === "none",
              rows: rows.length, snapshot: rows.map((row) => row.textContent).join(" "),
              controlsDisabled: controls.every((node) => node?.disabled),
              tileButtonsDisabled: Array.from(grid.querySelectorAll("button.wb-tile-select")).every((node) => node.disabled),
              rowButtonsDisabled: Array.from(table.querySelectorAll("button")).every((node) => node.disabled),
              allChecked: document.getElementById("smart-colors-workbench-matrix-all").checked,
              frames: document.querySelectorAll("iframe[data-smart-colors-workbench-frame]").length,
              note: document.getElementById("smart-colors-workbench-matrix-note").textContent,
              width: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth,
            };
          }, { name: WORKBENCH_RUNTIME_GLOBAL, hook: HOOK });
          assert.equal(noJs.runtime, "undefined");
          assert.equal(noJs.overviewOpen, true);
          assert.equal(noJs.tableVisible, true, "the no-JS fallback is not trapped in a closed disclosure or hidden table");
          assert.equal(noJs.gridHidden, true);
          assert.ok(noJs.rows > 0);
          assert.match(noJs.snapshot, /stima build/i);
          assert.match(noJs.snapshot, /\d+(?:[.,]\d+)?:1/);
          assert.equal(noJs.controlsDisabled, true);
          assert.equal(noJs.tileButtonsDisabled, true);
          assert.equal(noJs.rowButtonsDisabled, true);
          assert.equal(noJs.allChecked, true, "the static scope does not falsely claim a source filter");
          assert.equal(noJs.frames, 0);
          assert.match(noJs.note, /stime di build/);
          assert.ok(noJs.width <= noJs.viewport + 1, `no no-JS document overflow at ${width}px`);
        }
      });
    });
  });
});
