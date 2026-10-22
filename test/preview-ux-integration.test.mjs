/**
 * UX integration proof for the guided preview.
 *
 * The static test always runs and proves the emitted preview carries the semantic matrix, its
 * snapshot/live separation and the no-JavaScript labels. The browser proof is opt-in with
 * `SMART_COLORS_NATIVE_PROOF=1`; it resolves an already-installed Playwright/Chromium from the
 * workspace root, never installs anything and never downloads a browser.
 *
 * The browser proof intentionally uses the real emitted preview (temporary consumer -> generate ->
 * diagnostic session -> HTML) and only the API the runtime exposes. When the runtime cohort has not
 * landed `setLightness` yet, the L part is skipped explicitly instead of asserting a fake success.
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDiagnosticSession } from "../src/diagnostic-session.mjs";
import { formatContrastPreviewHtml } from "../src/format-report-preview.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { WORKBENCH_RUNTIME_GLOBAL } from "../src/contrast-workbench-runtime.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, "../../..");
const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";
const OPT_IN = "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium UX proof";
const PALETTE_PATH = "src/styles/tokens/palette.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const CONFIG_PATH = "smart-colors.config.mjs";
const PALETTE = [
  '@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.97 0.005 250); role: canvas; }',
  '@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.28 0.01 250); role: ink; }',
  '@property --palette-lagoon2 { syntax: "<color>"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; }',
  "",
].join("\n");
const TUNING = ":root {\n  --color-tune-text-light: oklch(0.66 0 0);\n}\n";
// A complete catalogue without any root-file dependency: 16 authored sources, generated scales
// (`--color-<name>-<step>`) and the design metadata the preview embeds as inert data.
const LARGE_PALETTE = [
  ["canvas", "canvas"], ["ink", "ink"], ["lagoon2", "ui"], ["sea-gull", "feedback"],
  ["citta", "ui"], ["foresta", "ui"], ["montagna", "feedback"], ["deserto", "ui"],
  ["corallo", "feedback"], ["notte", "ui"], ["grano", "decorative"], ["sabbia", "decorative"],
  ["rame", "decorative"], ["salvia", "decorative"], ["lavanda", "decorative"], ["arancio", "decorative"],
].map(([name, role], index) => `@property --palette-${name} { syntax: "<color>"; inherits: true; initial-value: oklch(0.${40 + index} 0.1 ${(index * 37) % 360}); role: ${role}; }`).join("\n");
const SCALES_CONFIG = "// Budget fixture: generated scales and design metadata, temporary output only.\nexport default { scales: { enabled: true, applyTo: [] } };\n";
// The approved preview budget (768 KiB). This fixture (16 sources + generated scales, 195 public
// tokens, 272 diagnostics) renders 761.480 B. The assertion is the contract; the measured number is
// only orientation and must never be raised to make the test pass.
const PREVIEW_BUDGET_BYTES = 768 * 1024;

function resolvePlaywright() {
  const base = createRequire(path.join(WORKSPACE_ROOT, "package.json"));
  for (const request of ["@playwright/test", "playwright"]) {
    try {
      const api = base(request);
      const browsers = api && api.chromium ? api : api && api.default ? api.default : null;
      if (browsers && browsers.chromium) return browsers;
    } catch {
      // Try the next already-installed consumer; nothing is installed here.
    }
  }
  return null;
}

async function buildPreview(palette = PALETTE, config = "// Preview UX fixture. Only the temporary output is written.\nexport default {};\n") {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-preview-ux-"));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, PALETTE_PATH), palette, "utf8");
  await writeFile(path.join(root, CONFIG_PATH), config, "utf8");
  await generateColorTokens({ root, suggest: false });
  await writeFile(path.join(root, TUNING_PATH), TUNING, "utf8");
  const built = await createDiagnosticSession({ root, suggest: false });
  const html = formatContrastPreviewHtml(built.session);
  const file = path.join(root, "reports/smart-colors-preview.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
  return { root, file, html, session: built.session };
}

test("the emitted preview labels the matrix as snapshot data and keeps the no-JS surface readable", async () => {
  const built = await buildPreview();
  try {
    assert.match(built.html, /<details class="wb-overview" data-smart-colors-workbench="overview"/);
    assert.match(built.html, /<summary id="smart-colors-workbench-overview-title" class="wb-overview-summary">Abbinamenti e filtri<\/summary>/);
    assert.match(built.html, /<table class="wb-matrix">/);
    assert.match(built.html, /<caption id="smart-colors-workbench-matrix-caption">/);
    assert.match(built.html, /<th scope="col" class="wb-matrix-uso">Uso e criterio<\/th>/);
    assert.match(built.html, /<th scope="col" id="smart-colors-workbench-matrix-a" class="wb-matrix-view">/);
    assert.match(built.html, /<th scope="row" class="wb-matrix-uso">/);
    assert.match(built.html, /data-smart-colors-workbench="matrix-inspect"[^>]*disabled>Ispeziona/);
    assert.match(built.html, /Ogni cella mostra la misura live quando il runtime ne ha una per quella coppia e quella vista/);
    assert.match(built.html, /stime di build/);
    assert.match(built.html, /La matrice mostra solo dati dello snapshot di build/);
    assert.match(built.html, /<label for="smart-colors-workbench-matrix-search">Cerca un abbinamento<\/label>/);
    assert.match(built.html, /<label for="smart-colors-workbench-matrix-filter">Filtra per esito<\/label>/);
    assert.match(built.html, /live dove misurato, altrimenti stima build/);
    assert.match(built.html, /id="smart-colors-workbench-result"[^>]*role="group"/);
    assert.match(built.html, /<pre role="group" tabindex="0" aria-label="Snippet CSS della coppia/);
    assert.match(built.html, /<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-frames-title smart-colors-workbench-proposal-before-title">/);
    assert.match(built.html, /<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-frames-title smart-colors-workbench-proposal-after-title">/);
    assert.match(built.html, /<a id="smart-colors-workbench-download" data-smart-colors-workbench="download" hidden>Scarica colors-tuning\.css \(azione manuale\)<\/a>/);
    assert.doesNotMatch(built.html, /id="smart-colors-workbench-download"[^>]*\bdownload=/);
    assert.doesNotMatch(built.html, /id="smart-colors-workbench-download"[^>]*\bhref=/);
    assert.doesNotMatch(built.html, /<div id="smart-colors-workbench"[^>]*role="region"/);
    assert.doesNotMatch(built.html, /Contrasto sufficiente|Contrasto insufficiente/);
  } finally {
    await rm(built.root, { recursive: true, force: true });
  }
});

test("a complete generated session keeps the preview inside the approved 768 KiB budget", async () => {
  const built = await buildPreview(LARGE_PALETTE, SCALES_CONFIG);
  try {
    // The fixture must stay a full catalogue, otherwise the byte assertion stops meaning anything.
    assert.equal(built.session.design.sources.length, 16, "the fixture keeps 16 real sources");
    assert.ok(Object.keys(built.session.design.tokens).length > 150, "the design metadata keeps the generated scales");
    assert.ok((built.session.model?.diagnostics?.length ?? 0) > 200, "the fixture measures the whole catalogue");
    const bytes = Buffer.byteLength(built.html, "utf8");
    assert.ok(bytes <= PREVIEW_BUDGET_BYTES, `preview is ${bytes} bytes, over the ${PREVIEW_BUDGET_BYTES}-byte budget`);
    // The budget may never be met by dropping the surfaces it protects.
    for (const marker of [
      'id="banco"', 'class="wb-matrix"', 'id="smart-colors-workbench-uses"', 'id="smart-colors-workbench-exploration-run"',
      'id="palette-titolo"', 'id="smart-colors-payload"', 'id="smart-colors-runtime"', "sha256-", "Sorgente CSS",
    ]) assert.ok(built.html.includes(marker), `the preview keeps ${marker}`);
    // The catalogue kind is a refinement of data-kind: an equal value is never serialized twice.
    assert.doesNotMatch(built.html, /data-catalogue-kind="(?:text|non-text)"/, "no redundant catalogue kind");
  } finally {
    await rm(built.root, { recursive: true, force: true });
  }
});

test("browser proof: full view measurements fill the matrix, a dependent pair changes, L is real and reset preserves the tuning source", { skip: NATIVE_PROOF ? false : OPT_IN }, async () => {
  if (!NATIVE_PROOF) return;
  const playwright = resolvePlaywright();
  assert.ok(playwright, "BLOCKED: Playwright is not resolvable from the workspace root; nothing is installed or downloaded");
  const built = await buildPreview();
  let browser = null;
  let staticContext = null;
  try {
    browser = await playwright.chromium.launch({ headless: true, timeout: 60_000 });
    const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce", viewport: { width: 1100, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });
    await page.goto(pathToFileURL(built.file).href);
    await page.waitForFunction((name) => Boolean(window[name]), WORKBENCH_RUNTIME_GLOBAL);
    await page.waitForFunction(() => window.__smartColorsWorkbench.state().phase === "complete", null, { timeout: 30_000 });

    const initial = await page.evaluate(() => {
      const state = window.__smartColorsWorkbench.state();
      return {
        phase: state.phase,
        views: state.views.map((view) => ({ slot: view.slot, theme: view.theme, variant: view.variant, count: Array.isArray(view.measurements) ? view.measurements.length : 0 })),
        rows: document.querySelectorAll('[data-smart-colors-workbench="matrix-row"]').length,
        liveCells: document.querySelectorAll('[data-smart-colors-workbench="matrix-cell"][data-source="live"]').length,
        matrixHeight: (() => { const node = document.querySelector('[data-smart-colors-workbench="overview"] .wb-matrix-scroll'); return node ? node.clientHeight : 0; })(),
        tabStops: Array.from(document.querySelectorAll('[data-smart-colors-workbench="matrix-inspect"]')).filter((node) => node.getAttribute("tabindex") === "0").length,
        disabled: Array.from(document.querySelectorAll('[data-smart-colors-workbench="matrix-inspect"]')).filter((node) => node.disabled).length,
        headers: [document.getElementById("smart-colors-workbench-matrix-a").textContent, document.getElementById("smart-colors-workbench-matrix-b").textContent],
        originalSource: window.__smartColorsWorkbench.exportTuningFile().css,
        // The bounded scroll region must not leak its clipped rows into document height.
        trailingGap: Math.round(document.documentElement.scrollHeight - document.body.getBoundingClientRect().height),
        scrollRegion: (() => { const node = document.querySelector('[data-smart-colors-workbench="overview"] .wb-matrix-scroll'); return node ? { client: node.clientHeight, scroll: node.scrollHeight } : null; })(),
      };
    });
    assert.equal(initial.phase, "complete");
    assert.ok(initial.views.length >= 2, "the runtime exposes both comparison views");
    assert.ok(initial.views.every((view) => view.count > 1), "every view carries the full measurements array, not only the selected pair");
    assert.ok(initial.liveCells >= initial.rows, "the matrix fills live cells for the measured pairs");
    assert.ok(initial.matrixHeight > 0, "the desktop overview keeps the matrix body visible");
    assert.ok(initial.scrollRegion.scroll > initial.scrollRegion.client, "the matrix really scrolls inside its bounded region");
    assert.ok(initial.trailingGap < 120, `the bounded matrix must not add document whitespace (gap ${initial.trailingGap}px)`);
    assert.equal(initial.tabStops, 1, "the matrix exposes one roving tab stop");
    assert.equal(initial.disabled, 0, "the factory enables the real matrix buttons");
    assert.match(initial.headers.join(" "), /tema (chiaro|scuro)/);
    assert.match(initial.headers.join(" "), /senza tuning|con tuning|bozza/);
    assert.ok(initial.originalSource.length > 0, "the fixture must carry a saved tuning source");
    assert.equal(await page.getAttribute("#smart-colors-workbench-details pre", "role"), "group", "the hydrated snippet keeps an explicit group role after the initial complete phase");

    // Exploration: the real button must be enabled at startup and produce a real table, not only an API call.
    await page.locator('details[data-smart-colors-workbench="exploration"] summary').click();
    const exploreButton = page.locator("#smart-colors-workbench-exploration-run");
    assert.equal(await exploreButton.isDisabled(), false, "exploration is enabled immediately after the startup measurement");
    await exploreButton.click();
    await page.waitForFunction(() => {
      const state = window.__smartColorsWorkbench.state();
      return state.exploration && state.exploration.phase === "complete";
    }, null, { timeout: 30_000 });
    const exploration = await page.evaluate(() => ({
      rows: document.querySelectorAll("#smart-colors-workbench-exploration-results tbody tr").length,
      status: document.getElementById("smart-colors-workbench-exploration-status").textContent,
    }));
    assert.ok(exploration.rows > 0, "the exploration table has real measurement rows");
    assert.match(exploration.status, /combinazioni misurate/);

    // Keyboard: arrows move focus without selecting; Enter activates the chosen native button.
    const before = await page.evaluate(() => ({
      pairId: window.__smartColorsWorkbench.state().selection.pairId,
    }));
    const firstButton = await page.$('[data-smart-colors-workbench="matrix-inspect"]');
    assert.ok(firstButton, "the matrix exposes real inspect buttons");
    await firstButton.focus();
    const firstValue = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-pair-value"));
    await page.keyboard.press("ArrowDown");
    const arrow = await page.evaluate(() => ({
      role: document.activeElement && document.activeElement.getAttribute("data-smart-colors-workbench"),
      value: document.activeElement && document.activeElement.getAttribute("data-pair-value"),
    }));
    assert.equal(arrow.role, "matrix-inspect");
    assert.notEqual(arrow.value, firstValue, "ArrowDown moves focus to another matrix row");
    assert.equal(await page.evaluate(() => window.__smartColorsWorkbench.state().selection.pairId), before.pairId, "focus movement alone does not select");

    // Select the text pair with the keyboard, then verify its live cells are real measurements.
    const selectedValue = "--color-text|--color-bg|text";
    const textButton = await page.$('[data-smart-colors-workbench="matrix-inspect"][data-pair-value="' + selectedValue + '"]');
    assert.ok(textButton, "the text pair row must exist");
    await textButton.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.__smartColorsWorkbench.state().phase === "complete" && /--color-text\|--color-bg/.test(window.__smartColorsWorkbench.state().selection.pairId || ""), null, { timeout: 30_000 });
    const textCells = await page.evaluate((value) => {
      const row = Array.from(document.querySelectorAll('[data-smart-colors-workbench="matrix-row"]')).find((item) => item.getAttribute("data-pair-value") === value);
      const cells = Array.from(row.querySelectorAll('[data-smart-colors-workbench="matrix-cell"]'));
      return cells.map((cell) => ({ text: cell.textContent, source: cell.getAttribute("data-source") }));
    }, selectedValue);
    assert.ok(textCells.every((cell) => cell.source === "live"), "both view cells use a live measurement for the selected pair");
    assert.ok(textCells.every((cell) => /:1/.test(cell.text)), "the live cells carry a real ratio");

    // The Aa sample is painted from the same computed colours as the real iframe specimen.
    const sample = await page.evaluate(() => {
      const sample = document.querySelector('[data-smart-colors-workbench="left-sample"]');
      const frame = document.querySelector("#smart-colors-workbench-left iframe");
      const node = frame && frame.contentDocument ? frame.contentDocument.querySelector('[data-smart-colors-specimen="selected"]') : null;
      if (!sample || !node) return null;
      const sampleStyle = getComputedStyle(sample);
      const specimenStyle = getComputedStyle(node);
      return {
        className: sample.getAttribute("class"),
        sampleColor: sampleStyle.color,
        sampleBackground: sampleStyle.backgroundColor,
        specimenColor: specimenStyle.color,
        specimenBackground: specimenStyle.backgroundColor,
      };
    });
    assert.ok(sample, "the Aa sample and the visible iframe specimen must exist");
    assert.equal(sample.className, "wb-aa");
    assert.equal(sample.sampleColor, sample.specimenColor, "the Aa sample uses the real computed text colour");
    assert.equal(sample.sampleBackground, sample.specimenBackground, "the Aa sample uses the real computed background");

    // L control: the runtime cohort now exists, so this is an assertion, never a functional skip.
    await page.evaluate(() => { document.querySelector('[data-smart-colors-workbench="manual"]').open = true; });
    const lightness = await page.evaluate(() => {
      const range = Array.from(document.querySelectorAll("#smart-colors-workbench-controls input[type=range]"))
        .find((node) => /^--color-tune-/.test(node.getAttribute("data-control") || ""));
      if (!range) return null;
      const group = range.closest('[data-smart-colors-workbench="lightness"]');
      return { id: range.id, control: range.getAttribute("data-control"), token: group && group.getAttribute("data-token"), disabled: range.disabled, step: range.getAttribute("step"), api: typeof window.__smartColorsWorkbench.setLightness };
    });
    assert.ok(lightness, "setLightness must expose an L range for the selected full-colour control");
    assert.equal(lightness.api, "function", "the runtime cohort exposes the real setLightness method");
    assert.equal(lightness.disabled, false, "the L range must be enabled when the runtime exposes setLightness");
    assert.ok(lightness.token, "the L control must identify the token it modifies");
    assert.equal(lightness.step, "0.1", "the range step can represent a real measured L");

    // A real fractional L must not make the override form invalid: the inputs hold the measured
    // fraction and the numeric input accepts any fraction.
    const lValidity = await page.evaluate(() => {
      const form = document.querySelector('[data-smart-colors-workbench="controls"]');
      const inputs = Array.from(document.querySelectorAll('[data-kind="lightness"]'));
      const state = window.__smartColorsWorkbench.state();
      const select = document.getElementById("smart-colors-workbench-pair");
      const option = select ? Array.from(select.options).find((node) => node.value === select.value) : null;
      const leftView = state.views.find((view) => view.slot === "left");
      const token = option ? option.getAttribute("data-fg") : null;
      const group = token ? Array.from(document.querySelectorAll('[data-smart-colors-workbench="lightness"]')).find((node) => node.getAttribute("data-token") === token) : null;
      const number = group ? group.querySelector('input[type="number"]') : null;
      return {
        form: form ? form.checkValidity() : null,
        numbers: inputs.filter((node) => node.type === "number").map((node) => ({ value: node.value, step: node.getAttribute("step"), valid: node.checkValidity() })),
        ranges: inputs.filter((node) => node.type === "range").map((node) => ({ value: node.value, step: node.getAttribute("step"), valid: node.checkValidity() })),
        measuredL: leftView && leftView.measurement && leftView.measurement.foregroundOklch ? leftView.measurement.foregroundOklch.l : null,
        shownValue: number ? number.value : null,
      };
    });
    assert.equal(lValidity.form, true, "the override form is valid while L holds the measured value");
    assert.ok(lValidity.numbers.length > 0, "the pair exposes numeric L inputs");
    assert.ok(lValidity.numbers.every((entry) => entry.valid && entry.step === "any"), "the numeric L is valid for the real fraction");
    assert.ok(lValidity.ranges.every((entry) => entry.valid && entry.step === "0.1"), "the range is valid for the real fraction");

    assert.ok(lValidity.numbers.every((entry) => entry.value !== ""), "the measured L is never replaced by an empty or invented value");
    assert.ok(lValidity.measuredL !== null && lValidity.measuredL >= 0 && lValidity.measuredL <= 1, "the runtime exposes the parsed per-side channels");
    assert.equal(lValidity.shownValue, String(Math.round(lValidity.measuredL * 100 * 10) / 10), "the shown L is the runtime channel, one-decimal display only");

    const dependents = await page.evaluate(({ token, selected }) => {
      const map = {};
      for (const row of document.querySelectorAll('[data-smart-colors-workbench="matrix-row"]')) {
        const value = row.getAttribute("data-pair-value");
        if (value === selected) continue;
        if (row.getAttribute("data-fg") !== token && row.getAttribute("data-bg") !== token) continue;
        const left = row.querySelector('[data-smart-colors-workbench="matrix-cell"][data-slot="left"]');
        const right = row.querySelector('[data-smart-colors-workbench="matrix-cell"][data-slot="right"]');
        map[value] = {
          left: left.textContent,
          right: right.textContent,
          leftSource: left.getAttribute("data-source"),
          rightSource: right.getAttribute("data-source"),
        };
      }
      return map;
    }, { token: lightness.token, selected: selectedValue });
    const dependentValues = Object.keys(dependents);
    assert.ok(dependentValues.length > 0, "at least one other pair must depend on the modified token");
    assert.ok(dependentValues.some((value) => dependents[value].leftSource === "live" || dependents[value].rightSource === "live"), "the dependent pair is measured live");

    const revision = await page.evaluate(() => window.__smartColorsWorkbench.state().revision);
    await page.focus("#" + lightness.id);
    await page.$eval("#" + lightness.id, (node) => {
      node.value = "40";
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(({ control, revision }) => {
      const state = window.__smartColorsWorkbench.state();
      return state.phase === "complete" && state.revision > revision && typeof (state.draft || {})[control] === "string" && /oklch\(/i.test(state.draft[control]);
    }, { control: lightness.control, revision }, { timeout: 30_000 });
    const focused = await page.evaluate(() => ({ id: document.activeElement && document.activeElement.id, value: document.activeElement && document.activeElement.value }));
    assert.equal(focused.id, lightness.id, "the focused L range keeps focus after the runtime publish");
    assert.equal(focused.value, "40", "the focused L range keeps the user's value");
    await page.waitForFunction(({ selected, before }) => {
      for (const row of document.querySelectorAll('[data-smart-colors-workbench="matrix-row"]')) {
        const value = row.getAttribute("data-pair-value");
        if (value === selected || !before[value]) continue;
        for (const slot of ["left", "right"]) {
          const cell = row.querySelector('[data-smart-colors-workbench="matrix-cell"][data-slot="' + slot + '"]');
          if (cell && cell.textContent !== before[value][slot]) return true;
        }
      }
      return false;
    }, { selected: selectedValue, before: dependents }, { timeout: 30_000 });

    // Invalid numeric L: mark the field, keep the last valid thumb/aria value and never touch the draft.
    const numberId = lightness.id.replace(/-range$/, "-number");
    const beforeInvalid = await page.evaluate(({ numberId, control }) => {
      const range = document.getElementById(numberId.replace(/-number$/, "-range"));
      return { draft: (window.__smartColorsWorkbench.state().draft || {})[control] ?? null, range: range.value, valuetext: range.getAttribute("aria-valuetext") };
    }, { numberId, control: lightness.control });
    await page.focus("#" + numberId);
    await page.fill("#" + numberId, "150");
    await page.keyboard.press("Tab");
    const invalidL = await page.evaluate(({ numberId, control }) => {
      const number = document.getElementById(numberId);
      const range = document.getElementById(numberId.replace(/-number$/, "-range"));
      return { number: number.value, invalid: number.getAttribute("aria-invalid"), range: range.value, valuetext: range.getAttribute("aria-valuetext"), draft: (window.__smartColorsWorkbench.state().draft || {})[control] ?? null };
    }, { numberId, control: lightness.control });
    assert.equal(invalidL.number, "150", "the typed invalid value stays visible for correction");
    assert.equal(invalidL.invalid, "true", "the invalid field is marked for assistive tech");
    assert.equal(invalidL.range, beforeInvalid.range, "the thumb never jumps to a clamped value");
    assert.equal(invalidL.valuetext, beforeInvalid.valuetext, "the announced value stays the last valid one");
    assert.equal(invalidL.draft, beforeInvalid.draft, "an invalid L never changes the draft");
    await page.fill("#" + numberId, "40");
    const restoredNote = await page.evaluate((id) => document.getElementById(id.replace(/-number$/, "-note")).textContent, numberId);
    assert.equal(await page.getAttribute("#" + numberId, "aria-invalid"), "false", "a valid value never keeps aria-invalid");
    assert.doesNotMatch(restoredNote, /L non valida/, "the described-by text drops the error as soon as the value is valid");
    await page.keyboard.press("Tab");
    await page.waitForFunction(({ control }) => /oklch\(/i.test(((window.__smartColorsWorkbench.state().draft || {})[control] || "")), { control: lightness.control }, { timeout: 30_000 });
    assert.equal(await page.getAttribute("#" + numberId, "aria-invalid"), "false", "a restored valid value clears the error state");
    await page.fill("#" + numberId, beforeInvalid.range);
    await page.keyboard.press("Tab");
    await page.waitForFunction(({ control, value }) => {
      const draft = (window.__smartColorsWorkbench.state().draft || {})[control] || "";
      const match = /oklch\(([\d.]+)/i.exec(draft);
      return Boolean(match) && Math.abs(Number(match[1]) - Number(value) / 100) < 0.01;
    }, { control: lightness.control, value: beforeInvalid.range }, { timeout: 30_000 });

    // The typed full-colour override must submit even while L holds the real measured fraction.
    const overrideField = await page.$('#smart-colors-workbench-controls [data-kind="override"]');
    assert.ok(overrideField, "the full-colour override text input exists for the selected pair");
    const draftBefore = await page.evaluate((control) => (window.__smartColorsWorkbench.state().draft || {})[control] ?? null, lightness.control);
    await overrideField.fill("oklch(0.57 0.12 255)");
    const formValidBeforeSubmit = await page.evaluate(() => {
      const form = document.querySelector('[data-smart-colors-workbench="controls"]');
      return form ? form.checkValidity() : null;
    });
    assert.equal(formValidBeforeSubmit, true, "a typed override with a real L value keeps the form valid");
    await page.click("#smart-colors-workbench-controls-submit");
    await page.waitForFunction(({ control, before }) => {
      const state = window.__smartColorsWorkbench.state();
      const value = (state.draft || {})[control];
      return state.phase === "complete" && typeof value === "string" && value !== before && /oklch\(/i.test(value);
    }, { control: lightness.control, before: draftBefore }, { timeout: 30_000 });

    // Reset with Enter keeps focus in the same controls context and does not scroll the page.
    const resetPair = page.locator("#smart-colors-workbench-reset-pair");
    await resetPair.scrollIntoViewIfNeeded();
    await resetPair.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Object.keys(window.__smartColorsWorkbench.state().draft || {}).length === 0, null, { timeout: 30_000 });
    await page.waitForTimeout(50);
    const resetFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(resetFocus, "smart-colors-workbench-reset-pair", "Enter keeps focus on the reset control");

    // The primary comparison submit is never disabled by its own run: a disabled button would blur
    // to <body> and send a keyboard user back to the top of the document.
    const technical = page.locator("details.wb-technical");
    if (!(await technical.evaluate((node) => node.open))) await technical.locator("summary").first().click();
    const comparisonSubmit = page.locator("#smart-colors-workbench-submit");
    await comparisonSubmit.scrollIntoViewIfNeeded();
    await comparisonSubmit.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => {
      const host = document.getElementById("smart-colors-workbench");
      return host.getAttribute("aria-busy") === "false" && window.__smartColorsWorkbench.state().phase === "complete";
    }, null, { timeout: 30_000 });
    await page.waitForTimeout(50);
    const submitState = await page.evaluate(() => ({
      focused: document.activeElement && document.activeElement.id,
      disabled: document.getElementById("smart-colors-workbench-submit").disabled,
    }));
    assert.equal(submitState.focused, "smart-colors-workbench-submit", "Enter on the comparison submit keeps focus");
    assert.equal(submitState.disabled, false, "the comparison submit is never disabled by its own run");

    // Export and reset: the original saved tuning source is preserved, never an arbitrary empty string.
    await page.click("#smart-colors-workbench-export");
    const exported = await page.evaluate(() => ({
      text: document.getElementById("smart-colors-workbench-export-text").value,
      download: document.getElementById("smart-colors-workbench-download").download,
      hidden: document.getElementById("smart-colors-workbench-download").hidden,
    }));
    assert.match(exported.text, new RegExp(lightness.control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "the exported file contains the modified control");
    assert.equal(exported.hidden, false);
    assert.match(exported.download, /^colors-tuning(\.patch)?\.css$/);

    const resetAll = page.locator("#smart-colors-workbench-reset-all");
    await resetAll.focus();
    await resetAll.click();
    await page.waitForFunction(() => {
      const state = window.__smartColorsWorkbench.state();
      return !state.draft || Object.keys(state.draft).length === 0;
    });
    await page.waitForTimeout(50);
    const resetAllFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(resetAllFocus, "smart-colors-workbench-reset-all", "a real click keeps focus on the reset-all control");
    assert.equal(await exploreButton.isDisabled(), false, "reset leaves the exploration action enabled");
    await exploreButton.click();
    await page.waitForFunction(() => {
      const state = window.__smartColorsWorkbench.state();
      return state.exploration && state.exploration.phase === "complete" && document.querySelectorAll("#smart-colors-workbench-exploration-results tbody tr").length > 0;
    }, null, { timeout: 30_000 });
    await page.waitForFunction((original) => document.getElementById("smart-colors-workbench-export-text").value === original, initial.originalSource, { timeout: 30_000 });
    const preserved = await page.evaluate(() => ({
      controller: window.__smartColorsWorkbench.exportTuningFile().css,
      text: document.getElementById("smart-colors-workbench-export-text").value,
      download: document.getElementById("smart-colors-workbench-download").download,
      hidden: document.getElementById("smart-colors-workbench-download").hidden,
    }));
    assert.equal(preserved.controller, initial.originalSource, "reset all preserves the original tuning source");
    assert.equal(preserved.text, initial.originalSource, "the UI shows the preserved source, not an arbitrary empty string");
    assert.equal(preserved.hidden, false, "the preserved complete file remains downloadable");
    assert.match(preserved.download, /^colors-tuning(\.patch)?\.css$/);

    // The runtime renderer must keep the snippet role after real pair, theme, manual and export changes.
    const pairBefore = await page.evaluate(() => window.__smartColorsWorkbench.state().selection.pairId);
    const otherPair = await page.evaluate(() => {
      const current = document.getElementById("smart-colors-workbench-pair").value;
      const button = Array.from(document.querySelectorAll('[data-smart-colors-workbench="matrix-inspect"]')).find((node) => node.getAttribute("data-pair-value") !== current);
      return button ? button.getAttribute("data-pair-value") : null;
    });
    assert.ok(otherPair, "the matrix exposes a second pair for the rendered role check");
    await page.locator('[data-smart-colors-workbench="matrix-inspect"][data-pair-value="' + otherPair + '"]').click();
    await page.waitForFunction((before) => window.__smartColorsWorkbench.state().selection.pairId !== before, pairBefore, { timeout: 30_000 });
    assert.equal(await page.getAttribute("#smart-colors-workbench-details pre", "role"), "group", "pair change keeps the snippet group role");
    await page.locator("label", { has: page.locator("#smart-colors-workbench-theme-dark") }).click();
    await page.waitForFunction(() => document.querySelector('input[name="smart-colors-workbench-theme"]:checked').value === "dark");
    assert.equal(await page.getAttribute("#smart-colors-workbench-details pre", "role"), "group", "theme change keeps the snippet group role");
    const manualDetails = page.locator('details[data-smart-colors-workbench="manual"]');
    if (!(await manualDetails.evaluate((node) => node.open))) await manualDetails.locator("summary").click();
    const roleNumber = await page.evaluate(() => {
      const node = document.querySelector('#smart-colors-workbench-controls input[type="number"][data-kind="lightness"]:not([disabled])');
      return node ? node.id : null;
    });
    if (roleNumber) {
      await page.fill("#" + roleNumber, "40");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(250);
    }
    assert.equal(await page.getAttribute("#smart-colors-workbench-details pre", "role"), "group", "manual L work keeps the snippet group role");
    await page.click("#smart-colors-workbench-export");
    assert.equal(await page.getAttribute("#smart-colors-workbench-details pre", "role"), "group", "export keeps the snippet group role");

    // Draft context: main left is “Attuale”, so the proposal children must qualify it with the parent heading.
    await page.locator("label", { has: page.locator("#smart-colors-workbench-comparison-draft") }).click();
    await page.waitForFunction(() => document.querySelector('input[name="smart-colors-workbench-comparison"]:checked').value === "draft");
    const proposalLabels = await page.evaluate(() => {
      const text = (node) => node ? node.textContent.trim() : "";
      const label = (node) => node.getAttribute("aria-labelledby").split(/\s+/).map((id) => text(document.getElementById(id))).join(" ");
      const frames = Array.from(document.querySelectorAll("#smart-colors-workbench-proposal-frames .wb-view"));
      return {
        frames: frames.map(label),
        mainLeft: text(document.getElementById("smart-colors-workbench-left-title")),
        mainRight: text(document.getElementById("smart-colors-workbench-right-title")),
      };
    });
    assert.deepEqual(proposalLabels.frames, ["Viste verificate della proposta Attuale", "Viste verificate della proposta Proposta"], "proposal labels include the parent context before the child title");
    assert.equal(proposalLabels.mainLeft, "Attuale", "the main draft view keeps its short copy");
    assert.notEqual(proposalLabels.frames[0], proposalLabels.mainLeft, "the proposal child label is unique against the main view");
    assert.equal(new Set([...proposalLabels.frames, proposalLabels.mainLeft, proposalLabels.mainRight]).size, 4, "draft and proposal accessible names are all distinct");
    await context.close();

    // Mobile with JavaScript: the same three columns fit the 390px container without global overflow.
    const mobileContext = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce", viewport: { width: 390, height: 780 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(pathToFileURL(built.file).href);
    await mobilePage.waitForFunction(() => window.__smartColorsWorkbench && window.__smartColorsWorkbench.state().phase === "complete", null, { timeout: 30_000 });
    await mobilePage.evaluate(() => { const node = document.querySelector('[data-smart-colors-workbench="overview"]'); if (node) node.open = true; });
    await mobilePage.waitForTimeout(50);
    const mobile = await mobilePage.evaluate(() => {
      const scroll = document.querySelector('[data-smart-colors-workbench="overview"] .wb-matrix-scroll');
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        matrixWidth: scroll ? scroll.scrollWidth : 0,
        matrixClient: scroll ? scroll.clientWidth : 0,
        rows: document.querySelectorAll('[data-smart-colors-workbench="matrix-row"]').length,
        columns: document.querySelectorAll('.wb-matrix thead th').length,
      };
    });
    assert.ok(mobile.documentWidth <= mobile.viewportWidth + 1, "no global horizontal overflow at 390px with JavaScript");
    assert.ok(mobile.matrixWidth <= mobile.matrixClient + 1, "the three-column matrix does not force horizontal scroll at 390px");
    assert.ok(mobile.matrixClient > 0, "the opened mobile overview exposes the matrix");
    assert.ok(mobile.rows > 0);
    assert.equal(mobile.columns, 3);
    await mobileContext.close();

    // 320px gate: the native disclosure starts collapsed so the selected-context inspector stays high.
    const narrowContext = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce", viewport: { width: 320, height: 720 } });
    const narrowPage = await narrowContext.newPage();
    await narrowPage.goto(pathToFileURL(built.file).href);
    await narrowPage.waitForFunction(() => window.__smartColorsWorkbench && window.__smartColorsWorkbench.state().phase === "complete", null, { timeout: 30_000 });
    const narrow = await narrowPage.evaluate(() => {
      const overview = document.querySelector('[data-smart-colors-workbench="overview"]');
      const specimen = document.getElementById("smart-colors-workbench-left");
      return {
        overviewOpen: overview.open,
        overviewHeight: Math.round(overview.getBoundingClientRect().height),
        specimenTop: Math.round(specimen.getBoundingClientRect().top + scrollY),
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      };
    });
    assert.equal(narrow.overviewOpen, false, "the 320px overview starts collapsed");
    assert.ok(narrow.overviewHeight <= 64, "the collapsed disclosure stays compact");
    assert.ok(narrow.specimenTop < 1200, "the selected specimen stays above the 1200px narrow gate");
    assert.ok(narrow.documentWidth <= narrow.viewportWidth + 1, "no global horizontal overflow at 320px");
    await narrowPage.evaluate(() => { const node = document.querySelector('[data-smart-colors-workbench="overview"]'); if (node) node.open = true; });
    const narrowMatrix = await narrowPage.evaluate(() => {
      const scroll = document.querySelector('[data-smart-colors-workbench="overview"] .wb-matrix-scroll');
      return scroll ? { width: scroll.scrollWidth, client: scroll.clientWidth } : null;
    });
    assert.ok(narrowMatrix && narrowMatrix.width <= narrowMatrix.client + 1, "the opened 320px matrix fits without horizontal scroll");
    await narrowContext.close();

    // No-JS: the static matrix is readable, the runtime is absent, no measurement frame exists.
    staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 720 } });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(pathToFileURL(built.file).href);
    const noJs = await staticPage.evaluate((name) => ({
      runtime: typeof window[name],
      rows: document.querySelectorAll('[data-smart-colors-workbench="matrix-row"]').length,
      buttons: Array.from(document.querySelectorAll('[data-smart-colors-workbench="matrix-inspect"]')).filter((node) => node.disabled).length,
      frames: document.querySelectorAll("iframe[data-smart-colors-workbench-frame]").length,
      note: document.getElementById("smart-colors-workbench-matrix-note").textContent,
      summary: document.querySelector('[data-smart-colors-workbench="overview"] summary').textContent,
      width: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }), WORKBENCH_RUNTIME_GLOBAL);
    assert.equal(noJs.runtime, "undefined");
    assert.ok(noJs.rows > 0);
    assert.equal(noJs.buttons, noJs.rows, "without JS the inspect buttons stay inert");
    assert.equal(noJs.frames, 0);
    assert.match(noJs.note, /stime di build/);
    assert.match(noJs.summary, /Abbinamenti e filtri/);
    assert.ok(noJs.width <= noJs.viewport + 1, "the static matrix has no global horizontal overflow at 390px");
    assert.deepEqual(pageErrors, [], "the emitted browser surface raises no pageerror or console error");
    await staticPage.close();
  } finally {
    if (staticContext) await staticContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await rm(built.root, { recursive: true, force: true });
  }
});
