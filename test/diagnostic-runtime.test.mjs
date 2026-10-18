/**
 * SC-04 tests: the isolated DOM collector and the browser bootstrap.
 *
 * The first block is a Node-only unit test of the pieces that do not need a browser. The second
 * block is the real proof the task requires: temporary `file://` fixtures generated here, opened
 * in Chromium and WebKit (both mandatory — a missing engine or binary is a failure, never a skip),
 * with the same CSP shape the preview will use. The fixtures use only the modules under test and
 * write exclusively inside a temporary directory.
 *
 * `@playwright/test` is resolved from the workspace root at test time; it is never a product
 * dependency of the package.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { createDiagnosticSession } from "../src/diagnostic-session.mjs";
import {
  DIAGNOSTIC_CSS_ATTRIBUTE,
  DIAGNOSTIC_FRAME_TIMEOUT_MS,
  DIAGNOSTIC_HOOK_ATTRIBUTE,
  DIAGNOSTIC_HOOKS,
  DIAGNOSTIC_HOST_ID,
  DIAGNOSTIC_PAYLOAD_ID,
  DIAGNOSTIC_RETRY_LABEL,
  DIAGNOSTIC_RUNTIME_GLOBAL,
  DIAGNOSTIC_RUNTIME_MARKER,
  DIAGNOSTIC_RUNTIME_VERSION,
  DIAGNOSTIC_SCENARIO_ATTRIBUTE,
  DIAGNOSTIC_STATE_ATTRIBUTE,
  DIAGNOSTIC_STATES,
  containsUnsupportedResources,
  createDiagnosticRuntimeSource,
} from "../src/diagnostic-runtime.mjs";
import {
  DOM_MEASUREMENT_STYLE_ATTRIBUTE,
  DOM_PROBE_ATTRIBUTE,
  DOM_REGISTRATION_PROBE,
  DOM_REGISTRATION_PROBE_INITIAL,
  DOM_THEME_PROBE_CLASS,
  createDomVerifier,
} from "../src/verification-dom.mjs";
import { createVerificationCore } from "../src/verification-core.mjs";

const core = createVerificationCore();
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, "../../..");
const ENGINES = ["chromium", "webkit"];
const TERMINAL_STATES = ["complete", "incomplete", "unavailable", "unsupported"];

const SYNTHETIC_CONFIG = {
  contrast: { text: 4.6, onColor: 4.6, ui: 3, maxIdentity: 7.5, darkRichness: 1.15 },
  roles: { identities: {}, decoratives: {} },
};

// §8.1 T-PREF matrix, expressed as the expected ratio of the text/canvas pair per
// (preference, theme). The fixture is authored so the oracles are exactly 21:1 and 1:1.
const PREFERENCE_MATRIX = {
  light: { light: 21, dark: 21 },
  dark: { light: 1, dark: 21 },
};
const PREFERENCE_BASELINE = { light: 21, dark: 21 };

// Independent WCAG oracle over known sRGB triplets, written without the code under test.
const WHITE_RGB = [255, 255, 255];
const BLACK_RGB = [0, 0, 0];
const BLUE_RGB = [0, 0, 255];
const RED_RGB = [255, 0, 0];

function luminanceRgb(channels) {
  const linear = (value) => {
    const ratio = value / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
}

function contrastRgb(first, second) {
  const a = luminanceRgb(first);
  const b = luminanceRgb(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PREF_BASELINE = [
  ":root {",
  "  color-scheme: light dark;",
  "  --color-bg: light-dark(white, black);",
  "  --color-surface: light-dark(white, black);",
  "  --color-text: light-dark(black, white);",
  "  --color-text-muted: light-dark(black, white);",
  "  --color-focus-ring: light-dark(black, black);",
  "  --color-control-active-text: light-dark(white, white);",
  "  --color-control-bg-active: light-dark(black, black);",
  "  --color-control-focus-bg: light-dark(black, black);",
  "  --color-control-border-active: light-dark(black, black);",
  "}",
  "@media (prefers-color-scheme: dark) {",
  "  :root { --color-text: white; }",
  "}",
  "",
].join("\n");
// The tuning deliberately changes only the muted token, so isolation is observable and the
// text/canvas rows of the matrix stay untouched.
const PREF_TUNING = ":root { --color-text-muted: light-dark(rgb(0, 0, 255), rgb(0, 0, 255)); }\n";

// Tuning that animates a root custom property with a long, `!important` animation. If motion were
// not frozen (or if the freeze were layered, losing to the tuning's important declaration) the
// animated value would replace the endpoint and the ratio would drift towards red.
const MOTION_TUNING = [
  '@property --color-text-muted { syntax: "<color>"; inherits: true; initial-value: oklch(0.5 0 0); }',
  "@keyframes sc-tune-root { from { --color-text-muted: rgb(255, 0, 0); } to { --color-text-muted: rgb(255, 0, 0); } }",
  ":root { --color-text-muted: rgb(0, 0, 255); animation: sc-tune-root 600s linear infinite !important; }",
  "",
].join("\n");

// `color-scheme: light dark !important` beats the runtime's inline (normal) color-scheme, so the
// theme stays unpinned: the run must be declared unsupported instead of measured by omission.
const UNPINNED_BASELINE = [
  ":root {",
  "  color-scheme: light dark !important;",
  "  --color-bg: light-dark(white, black);",
  "  --color-surface: light-dark(white, black);",
  "  --color-text: light-dark(black, white);",
  "  --color-text-muted: light-dark(black, white);",
  "  --color-focus-ring: light-dark(black, black);",
  "  --color-control-active-text: light-dark(white, white);",
  "  --color-control-bg-active: light-dark(black, black);",
  "  --color-control-focus-bg: light-dark(black, black);",
  "  --color-control-border-active: light-dark(black, black);",
  "}",
  "",
].join("\n");

const FAIL_CLOSED_BASELINE = [
  ":root {",
  "  color-scheme: light dark;",
  "  --color-bg: light-dark(white, black);",
  "  --color-surface: light-dark(white, black);",
  "  --color-text: light-dark(black, white);",
  "  --color-focus-ring: light-dark(black, black);",
  "  --color-control-active-text: light-dark(white, white);",
  "  --color-control-bg-active: light-dark(black, black);",
  "  --color-control-border-active: light-dark(black, black);",
  "}",
  // A registered token that nothing declares: its registered initial must not become a pass.
  '@property --color-text-muted { syntax: "<color>"; inherits: true; initial-value: oklch(0.5 0 0); }',
  "",
].join("\n");

function buildPayload({ baseline, tuning = null, tuningSupport = "absent", config = SYNTHETIC_CONFIG, schemaVersion = 1 }) {
  return {
    schemaVersion,
    toolVersion: "0.0.0-test",
    snapshotId: "sc04-test-snapshot",
    css: { baseline, tuning, tuningSupport },
    config,
    model: { diagnostics: [], errors: [], warnings: [] },
    samples: [],
    notes: [],
  };
}

function sha256Base64(value) {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

function inertJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Mirrors the isolation approved in SC-01: strict CSP, one script hash over the exact emitted
// bytes, `frame-src 'none'` for the srcdoc measurement frames.
function buildFixtureHtml({ title, payload, runtimeSource }) {
  const csp = [
    "default-src 'none'",
    "script-src 'sha256-" + sha256Base64(runtimeSource) + "'",
    "style-src 'unsafe-inline'",
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
  return [
    "<!doctype html>",
    '<html lang="it"><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + title + "</title>",
    "</head><body>",
    '<section id="' + DIAGNOSTIC_HOST_ID + '" ' + DIAGNOSTIC_HOOK_ATTRIBUTE + '="' + DIAGNOSTIC_HOOKS.host + '" aria-label="Verifica locale dei contrasti Smart Colors">',
    '  <div ' + DIAGNOSTIC_HOOK_ATTRIBUTE + '="' + DIAGNOSTIC_HOOKS.frames + '"></div>',
    '  <p ' + DIAGNOSTIC_HOOK_ATTRIBUTE + '="' + DIAGNOSTIC_HOOKS.status + '" role="status"></p>',
    '  <button type="button" ' + DIAGNOSTIC_HOOK_ATTRIBUTE + '="' + DIAGNOSTIC_HOOKS.retry + '">' + DIAGNOSTIC_RETRY_LABEL + "</button>",
    "</section>",
    '<script type="application/json" id="' + DIAGNOSTIC_PAYLOAD_ID + '">' + inertJson(payload) + "</script>",
    '<script id="smart-colors-runtime">' + runtimeSource + "</script>",
    "</body></html>",
    "",
  ].join("\n");
}

function contractFor(config) {
  return core.createContract(config);
}

function pairIdOf(contract, theme, label) {
  const pair = contract.pairs[theme].find((entry) => entry.label === theme + " " + label);
  assert.ok(pair, "missing pair " + theme + " " + label);
  return pair.id;
}

// ---------------------------------------------------------------------------
// Unit: serialization contract and the Node-side pieces.
// ---------------------------------------------------------------------------

test("createDiagnosticRuntimeSource emits one self-contained classic script", () => {
  const source = createDiagnosticRuntimeSource();
  assert.equal(typeof source, "string");
  assert.ok(Buffer.byteLength(source, "utf8") > 10_000, "the source must embed the real factories");
  for (const marker of ["createVerificationCore", "createDomVerifier", "createDiagnosticRuntime", DIAGNOSTIC_RUNTIME_GLOBAL]) {
    assert.ok(source.includes(marker), "the source must define " + marker);
  }
  assert.ok(!source.includes("</"), "no </ sequence may appear, so no escaping rewrites the hashed bytes");
  assert.ok(!/\bimport\s*\(/.test(source), "no dynamic import");
  assert.ok(!/\brequire\s*\(/.test(source), "no require");
  assert.ok(!/\bexport\b|\bmodule\b/.test(source), "no module system reference");
  assert.ok(!/\beval\s*\(|\bnew Function\b/.test(source), "no eval or Function constructor");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|importScripts/.test(source), "no network access");
  assert.ok(!/document\.write|innerHTML|insertAdjacentHTML|outerHTML/.test(source), "no markup injection from strings");
  assert.ok(!source.includes("node_modules"), "no checkout reference");
  assert.doesNotThrow(() => new Function(source), "the emitted source must compile as a classic script");
});

test("containsUnsupportedResources flags only real @import/url references", () => {
  const flagged = [
    '@import "other.css";',
    "@import url(x.css);",
    ":root { background-image: url(pixel.png); }",
    "a { background: URL( x ); }",
    // A conservative syntax scan: `url(` inside a string is still flagged, never a pass.
    "a { content: 'import url('; }",
  ];
  const clean = [
    "",
    ":root { --color-x: oklch(0.5 0.1 200); }",
    "/* @import url(x.css) */ :root { --color-x: red; }",
    "a { content: 'import'; }",
  ];
  for (const css of flagged) assert.equal(containsUnsupportedResources(css), true, css);
  for (const css of clean) assert.equal(containsUnsupportedResources(css), false, css);
});

test("createDomVerifier exposes the same hook constants the collector declares internally", () => {
  const verifier = createDomVerifier(core);
  assert.equal(verifier.probeAttribute, DOM_PROBE_ATTRIBUTE);
  assert.equal(verifier.measurementStyleAttribute, DOM_MEASUREMENT_STYLE_ATTRIBUTE);
  assert.equal(verifier.registrationProbe, DOM_REGISTRATION_PROBE);
  assert.equal(verifier.registrationProbeInitial, DOM_REGISTRATION_PROBE_INITIAL);
  assert.equal(verifier.themeProbeClass, DOM_THEME_PROBE_CLASS);
  assert.equal(typeof verifier.measureDocument, "function");
  assert.equal(typeof verifier.observePreference, "function");
  assert.equal(typeof verifier.forcedColorsActive, "function");
});

test("measureDocument fails closed on forced colors instead of confirming the authored palette", () => {
  const verifier = createDomVerifier(core);
  const contract = contractFor(SYNTHETIC_CONFIG);
  const view = { matchMedia: (query) => ({ matches: /forced-colors/.test(query) }) };
  const document = {
    defaultView: view,
    documentElement: { style: {}, setAttribute() {} },
    querySelector: () => null,
    createElement: () => ({ style: { setProperty() {} }, setAttribute() {}, appendChild() {}, remove() {} }),
  };
  const result = verifier.measureDocument(document, { id: "baseline-light-light", theme: "light", variant: "baseline", preference: "light" }, contract);
  assert.equal(result.forcedColors, true);
  assert.equal(result.support, "unsupported");
  assert.equal(result.measurements.length, contract.pairs.light.length);
  assert.ok(result.measurements.every((measurement) => measurement.status === "unmeasured" && measurement.ratio === null));
  assert.equal(result.errors[0].cause, "forced-colors-active");
});

// Minimal DOM stub: enough to reach `themeEffect` without a browser. A stub never closes the task
// on its own (the proof below does), but it exercises the fail-closed branches directly.
function stubDocument({ colorScheme, themeColor, forcedColors = false }) {
  const makeElement = (tag) => ({
    tagName: String(tag).toUpperCase(),
    style: { setProperty() {} },
    className: "",
    textContent: "",
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    remove() {},
  });
  const root = makeElement("html");
  const document = {
    documentElement: root,
    head: makeElement("head"),
    body: makeElement("body"),
    querySelector: () => null,
    createElement: makeElement,
  };
  const view = {
    matchMedia: (query) => ({ matches: forcedColors === true && /forced-colors/.test(query) }),
    CSS: { supports: () => true },
    getComputedStyle: (element) => {
      if (element === root) return { colorScheme, getPropertyValue: () => "" };
      if (element.className === DOM_THEME_PROBE_CLASS) return { color: themeColor };
      return { color: "", backgroundColor: "", getPropertyValue: () => "" };
    },
  };
  document.defaultView = view;
  return document;
}

test("measureDocument requires the exact theme schema and a verifiable light-dark sentinel", () => {
  const verifier = createDomVerifier(core);
  const contract = contractFor(SYNTHETIC_CONFIG);
  const scenario = { id: "baseline-light-light", theme: "light", variant: "baseline", preference: "light" };
  const rejected = [
    // A multi-value color-scheme leaves the theme unpinned: `light-dark()` would follow the preference.
    { colorScheme: "light dark", themeColor: "rgb(255, 255, 255)", cause: "theme-not-applied" },
    { colorScheme: "", themeColor: "rgb(255, 255, 255)", cause: "theme-not-applied" },
    { colorScheme: "dark", themeColor: "rgb(255, 255, 255)", cause: "theme-not-applied" },
    { colorScheme: "light", themeColor: "rgb(0, 0, 0)", cause: "theme-not-applied" },
    // A sentinel that cannot be verified is unsupported, never an inferred pass.
    { colorScheme: "light", themeColor: "transparent", cause: "theme-unsupported" },
    { colorScheme: "light", themeColor: "", cause: "theme-unsupported" },
  ];
  for (const entry of rejected) {
    const result = verifier.measureDocument(stubDocument(entry), scenario, contract);
    assert.equal(result.support, "unsupported", JSON.stringify(entry));
    assert.equal(result.errors[0].cause, entry.cause, JSON.stringify(entry));
    assert.equal(result.measurements.length, contract.pairs.light.length, JSON.stringify(entry));
    assert.ok(result.measurements.every((measurement) => measurement.status === "unmeasured" && measurement.ratio === null), JSON.stringify(entry));
  }
  const accepted = verifier.measureDocument(stubDocument({ colorScheme: "light", themeColor: "rgb(255, 255, 255)" }), scenario, contract);
  assert.equal(accepted.support, "supported", "an exactly pinned theme with a verified sentinel is supported");
});

test("the exported runtime constants are complete and stable", () => {
  assert.equal(DIAGNOSTIC_RUNTIME_VERSION, 1);
  assert.ok(/^SMART_COLORS_DIAGNOSTIC_RUNTIME_V\d+$/.test(DIAGNOSTIC_RUNTIME_MARKER));
  assert.equal(DIAGNOSTIC_RUNTIME_GLOBAL, "__smartColorsDiagnostic");
  assert.deepEqual(Object.keys(DIAGNOSTIC_HOOKS).sort(), ["frames", "host", "retry", "scenario", "status"]);
  assert.deepEqual(DIAGNOSTIC_STATES, ["pending", "running", "complete", "incomplete", "unavailable", "unsupported", "disabled"]);
  assert.ok(DIAGNOSTIC_FRAME_TIMEOUT_MS > 0);
  assert.equal(typeof createDiagnosticRuntimeSource(), "string");
});

// ---------------------------------------------------------------------------
// Proof: real file:// fixtures in Chromium and WebKit.
// ---------------------------------------------------------------------------

// Playwright is resolved from the workspace root only (no global/consumer fallback) and only when
// the browser proof is explicitly opted in. The package suite stays Node-only and Playwright-free.
const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";

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
    if (browsers && browsers.chromium && browsers.webkit) {
      return { request, browsers, resolved: base.resolve(request) };
    }
  }
  throw new Error("BLOCKED SC-04: Playwright is not resolvable from the workspace root " + WORKSPACE_ROOT + "; the opted-in browser proof is mandatory and cannot be skipped.");
}

async function openEngine(name, browserType) {
  const executable = browserType.executablePath();
  try {
    await access(executable);
  } catch (cause) {
    throw new Error("BLOCKED SC-04: " + name + " binary unavailable at " + executable + "; install it explicitly. No automatic download is performed.", { cause });
  }
  const browser = await browserType.launch({ headless: true, timeout: 60_000 });
  return browser;
}

async function loadFixture(context, file) {
  const requests = [];
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("request", (request) => requests.push(request.url()));
  const url = pathToFileURL(file);
  await page.goto(url.href, { waitUntil: "load", timeout: 20_000 });
  await page.waitForFunction(
    (states) => {
      const controller = window.__smartColorsDiagnostic;
      return Boolean(controller && controller.report() && states.includes(controller.status().state));
    },
    TERMINAL_STATES,
    { timeout: 20_000 },
  );
  return { page, requests, url };
}

function scenarioIdOf(report, variant, theme) {
  const record = report.scenarios.find((entry) => entry.variant === variant && entry.theme === theme);
  assert.ok(record, "missing scenario " + variant + " " + theme);
  return record.id;
}

function measurementOf(report, scenarioId, pairId) {
  const measurement = report.measurements.find((entry) => entry.scenarioId === scenarioId && entry.pairId === pairId);
  assert.ok(measurement, "missing measurement for " + scenarioId + " " + pairId);
  return measurement;
}

function closeTo(actual, expected, message, tolerance = 1e-6) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) < tolerance, message + ": expected " + expected + " +/- " + tolerance + ", got " + actual);
}

async function assertRuntimeConstants(page) {
  const meta = await page.evaluate(() => {
    const controller = window.__smartColorsDiagnostic;
    return {
      marker: controller.marker,
      version: controller.version,
      ready: controller.ready,
      hooks: controller.hooks,
      attributes: controller.attributes,
      retryLabel: controller.retryLabel,
      frameTimeoutMs: controller.frameTimeoutMs,
      states: controller.states,
      retryTag: controller.button ? controller.button.tagName : null,
      retryType: controller.button ? controller.button.type : null,
      hostId: controller.host ? controller.host.id : null,
      hostState: controller.host ? controller.host.getAttribute("data-smart-colors-state") : null,
    };
  });
  assert.equal(meta.marker, DIAGNOSTIC_RUNTIME_MARKER);
  assert.equal(meta.version, DIAGNOSTIC_RUNTIME_VERSION);
  assert.equal(meta.ready, true);
  assert.deepEqual(meta.hooks, DIAGNOSTIC_HOOKS);
  assert.deepEqual(meta.attributes, {
    hook: DIAGNOSTIC_HOOK_ATTRIBUTE,
    state: DIAGNOSTIC_STATE_ATTRIBUTE,
    scenario: DIAGNOSTIC_SCENARIO_ATTRIBUTE,
    stylesheet: DIAGNOSTIC_CSS_ATTRIBUTE,
    hostId: DIAGNOSTIC_HOST_ID,
    payloadId: DIAGNOSTIC_PAYLOAD_ID,
  });
  assert.equal(meta.retryLabel, DIAGNOSTIC_RETRY_LABEL);
  assert.equal(meta.frameTimeoutMs, DIAGNOSTIC_FRAME_TIMEOUT_MS);
  assert.deepEqual(meta.states, DIAGNOSTIC_STATES);
  assert.equal(meta.retryTag, "BUTTON");
  assert.equal(meta.retryType, "button");
  assert.equal(meta.hostId, DIAGNOSTIC_HOST_ID);
  assert.ok(TERMINAL_STATES.includes(meta.hostState), "the host must expose a terminal state attribute");
  // The serialized copy must agree with the Node-side check SC-05/06 import.
  const samples = ['@import "x";', "a{background:url(y.png)}", "/* @import url(x) */ a{color:red}", ":root{--x:red}"];
  const fromBrowser = await page.evaluate((input) => input.map((css) => window.__smartColorsDiagnostic.containsUnsupportedResources(css)), samples);
  assert.deepEqual(fromBrowser, samples.map(containsUnsupportedResources));
}

async function assertFrames(page, expectedCount) {
  const frames = await page.evaluate(() => Array.prototype.slice.call(document.querySelectorAll("iframe")).map((frame) => {
    const frameDocument = frame.contentDocument;
    return {
      sandbox: frame.getAttribute("sandbox"),
      srcdoc: frame.hasAttribute("srcdoc"),
      src: frame.getAttribute("src"),
      title: frame.getAttribute("title"),
      scenario: frame.getAttribute("data-smart-colors-scenario"),
      scripts: frameDocument ? frameDocument.querySelectorAll("script").length : -1,
      styles: frameDocument ? frameDocument.querySelectorAll("style").length : -1,
      hasProbe: frameDocument ? frameDocument.querySelectorAll("[data-smart-colors-pair]").length : -1,
      hasThemeProbe: frameDocument ? frameDocument.querySelectorAll(".smart-colors-theme-probe").length : -1,
      measurement: frameDocument && frameDocument.querySelector("style[data-smart-colors-measurement]") ? frameDocument.querySelector("style[data-smart-colors-measurement]").textContent : "",
    };
  }));
  assert.equal(frames.length, expectedCount, "one fresh frame per scenario");
  for (const frame of frames) {
    assert.equal(frame.sandbox, "allow-same-origin", "frames keep the minimal sandbox");
    assert.equal(frame.srcdoc, true, "frames load from srcdoc, never from a remote src");
    assert.equal(frame.src, null);
    assert.ok(frame.title && frame.title.trim().length > 0, "every frame needs an accessible name");
    assert.ok(frame.scenario && frame.scenario.length > 0);
    assert.equal(frame.scripts, 0, "measurement frames must stay script-less");
    assert.equal(frame.hasThemeProbe, 1);
    assert.ok(frame.hasProbe > 0, "frames must expose the pair probes");
    assert.ok(frame.measurement.indexOf("animation: none !important") !== -1, "endpoints are measured with motion frozen");
    assert.ok(frame.measurement.indexOf("@property --smart-colors-registration-probe") !== -1, "the registration sentinel must be present");
  }
  return frames;
}

async function assertNoNetwork(requests, url) {
  assert.deepEqual([...new Set(requests)], [url.href], "the run must attempt no request beyond the file:// document");
}

async function runPreferenceFixture(page, requests, url, contract) {
  await assertNoNetwork(requests, url);
  const light = await page.evaluate(() => window.__smartColorsDiagnostic.report());
  assert.equal(light.status, "complete", "the synthetic fixture must measure completely");
  assert.equal(light.coverage.complete, true);
  assert.equal(light.provenance, "browser-local");
  assert.equal(light.mode, "off");
  assert.deepEqual(light.preference, { active: "light", unmeasured: ["dark"], source: "(prefers-color-scheme)" });
  assert.equal(light.expected.scenarios.length, 4);
  assert.deepEqual(light.executed.scenarios.slice().sort(), light.expected.scenarios.slice().sort());
  assert.ok(light.scenarios.every((scenario) => scenario.preference === "light"), "an explicit color-scheme must never be read as the preference");
  assert.ok(light.notes.some((note) => /non misurata/.test(note)), "the unmeasured preference must be declared");

  const pairFor = (theme, label) => pairIdOf(contract, theme, label);

  for (const theme of ["light", "dark"]) {
    const scenarioId = scenarioIdOf(light, "baseline", theme);
    const measurement = measurementOf(light, scenarioId, pairFor(theme, "neutral text / canvas"));
    assert.equal(measurement.status, "pass", theme + " baseline must pass under a light preference");
    closeTo(measurement.ratio, PREFERENCE_MATRIX.light[theme], theme + " baseline ratio under light preference");
    // The border/outline pairs are read from the applied border-color/outline-color, not from color.
    assert.ok(Number.isFinite(measurementOf(light, scenarioId, pairFor(theme, "focus / canvas")).ratio), "focus/outline pair must be measured");
    assert.ok(Number.isFinite(measurementOf(light, scenarioId, pairFor(theme, "control active border / canvas")).ratio), "border pair must be measured");
  }

  // Tuning isolation: the tuned frame must differ from the baseline frame for the tuned token.
  const mutedPair = pairFor("light", "muted text / canvas");
  const baselineMuted = measurementOf(light, scenarioIdOf(light, "baseline", "light"), mutedPair);
  const tunedMuted = measurementOf(light, scenarioIdOf(light, "tuned", "light"), mutedPair);
  assert.equal(baselineMuted.status, "pass");
  assert.ok(tunedMuted.ratio !== baselineMuted.ratio, "the tuning must be measured in its own frame, not mixed with the baseline");
  assert.ok(Number.isFinite(tunedMuted.ratio));

  const frames = await assertFrames(page, 4);
  const tuned = frames.find((frame) => frame.scenario === scenarioIdOf(light, "tuned", "light"));
  assert.ok(tuned.styles >= 2, "the tuned frame must carry the baseline and the tuning stylesheets in order");

  // Exact bytes: the payload CSS is written with DOM style.textContent, so the audited bytes are
  // preserved in order (baseline then tuning) with no escaping rewrite.
  const injected = await page.evaluate(() => {
    const frame = Array.prototype.slice.call(document.querySelectorAll("iframe")).find((element) => element.getAttribute("data-smart-colors-scenario").indexOf("tuned-") === 0);
    return Array.prototype.slice.call(frame.contentDocument.querySelectorAll("style[data-smart-colors-css]")).map((style) => ({ kind: style.getAttribute("data-smart-colors-css"), text: style.textContent }));
  });
  assert.deepEqual(injected.map((entry) => entry.kind), ["baseline", "tuning"]);
  assert.ok(injected[0].text.indexOf(PREF_BASELINE) !== -1, "the baseline bytes must be preserved exactly");
  assert.ok(injected[1].text.indexOf(PREF_TUNING) !== -1, "the tuning bytes must be preserved exactly");

  // Invalidation on preference change, then a rerun of both themes with the new preference.
  await page.evaluate(() => {
    window.__events = [];
    window.__smartColorsDiagnostic.subscribe((snapshot) => {
      window.__events.push({ state: snapshot.state, hasReport: snapshot.report !== null });
    });
  });
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await (async () => {
    await page.waitForFunction(
      () => {
        const controller = window.__smartColorsDiagnostic;
        const report = controller.report();
        return Boolean(report && report.preference && report.preference.active === "dark" && controller.status().state === "complete");
      },
      null,
      { timeout: 20_000 },
    );
    return page.evaluate(() => window.__smartColorsDiagnostic.report());
  })();

  const events = await page.evaluate(() => window.__events);
  const invalidated = events.findIndex((event) => event.state === "pending" && event.hasReport === false);
  const reported = events.findIndex((event) => event.state === "complete" && event.hasReport === true);
  assert.ok(invalidated !== -1, "a preference change must invalidate the local results immediately");
  assert.ok(reported > invalidated, "the invalidation must be followed by a fresh report");

  assert.deepEqual(dark.preference, { active: "dark", unmeasured: ["light"], source: "(prefers-color-scheme)" });
  assert.equal(dark.status, "complete");
  const matrix = PREFERENCE_MATRIX.dark;
  for (const theme of ["light", "dark"]) {
    const measurement = measurementOf(dark, scenarioIdOf(dark, "baseline", theme), pairFor(theme, "neutral text / canvas"));
    closeTo(measurement.ratio, matrix[theme], theme + " baseline ratio under dark preference");
    assert.equal(measurement.status, theme === "light" ? "below-minimum" : "pass", "the light theme is the one that breaks under a dark preference");
  }
  // Only the token the media query declares follows the preference; the rest stays at the theme value.
  closeTo(measurementOf(dark, scenarioIdOf(dark, "baseline", "light"), mutedPair).ratio, PREFERENCE_BASELINE.light, "the preference must not rewrite tokens the media query does not declare");

  await assertFrames(page, 4);

  // The retry action is a native button and must not move focus.
  const afterRetry = await page.evaluate(async () => {
    const controller = window.__smartColorsDiagnostic;
    const before = controller.report().measuredAt;
    controller.button.click();
    await new Promise((resolve) => {
      const stop = controller.subscribe((snapshot) => {
        if (snapshot.state === "complete" && snapshot.report && snapshot.report.measuredAt !== before) {
          stop();
          resolve();
        }
      });
    });
    return { active: document.activeElement ? document.activeElement.tagName : null, measuredAt: controller.report().measuredAt, before };
  });
  assert.notEqual(afterRetry.measuredAt, afterRetry.before, "the retry button must run the verification again");
  assert.equal(afterRetry.active, "BODY", "focus must not be moved automatically");

  const serializable = await page.evaluate(() => {
    const json = JSON.stringify(window.__smartColorsDiagnostic.report());
    return { stable: JSON.stringify(JSON.parse(json)) === json, bytes: json.length };
  });
  assert.equal(serializable.stable, true, "the run payload must be JSON-stable for SC-05/SC-06");
  assert.ok(serializable.bytes > 0);
}

async function runFailClosedFixture(page, contract) {
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => window.__smartColorsDiagnostic.report() && ["incomplete", "unsupported"].includes(window.__smartColorsDiagnostic.status().state), null, { timeout: 20_000 });
  const report = await page.evaluate(() => window.__smartColorsDiagnostic.report());
  assert.equal(report.status, "incomplete");
  assert.equal(report.coverage.complete, false);

  const registeredTokenPair = pairIdOf(contract, "light", "muted text / canvas");
  const missingTokenPair = pairIdOf(contract, "light", "control text / focus background");
  const scenarioId = scenarioIdOf(report, "baseline", "light");

  const registered = measurementOf(report, scenarioId, registeredTokenPair);
  assert.equal(registered.status, "unmeasured");
  assert.equal(registered.ratio, null);
  assert.match(registered.error, /registered initial-value/, "a registered initial must never be inherited as a pass");

  const missing = measurementOf(report, scenarioId, missingTokenPair);
  assert.equal(missing.status, "unmeasured");
  assert.match(missing.error, /not declared|guaranteed-invalid/, "an undeclared token must never be inherited as a pass");

  // The pairs whose tokens are declared are still measured: fail-closed is per pair, not global.
  const healthy = measurementOf(report, scenarioId, pairIdOf(contract, "light", "neutral text / canvas"));
  assert.equal(healthy.status, "pass");
  assert.ok(Number.isFinite(healthy.ratio));
}

test("SC-04 browser proof: isolated collector and runtime on file://", { skip: NATIVE_PROOF ? false : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the mandatory Chromium+WebKit proof; the SC-09 harness runs it as a gate without the opt-in" }, async (t) => {
  const playwright = resolvePlaywright();
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-diagnostic-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const runtimeSource = createDiagnosticRuntimeSource();
  const contract = contractFor(SYNTHETIC_CONFIG);

  const files = {
    pref: buildFixtureHtml({ title: "Smart Colors T-PREF fixture", runtimeSource, payload: buildPayload({ baseline: PREF_BASELINE, tuning: PREF_TUNING, tuningSupport: "supported" }) }),
    failClosed: buildFixtureHtml({ title: "Smart Colors fail-closed fixture", runtimeSource, payload: buildPayload({ baseline: FAIL_CLOSED_BASELINE }) }),
    unsupportedTuning: buildFixtureHtml({ title: "Smart Colors unsupported tuning", runtimeSource, payload: buildPayload({ baseline: PREF_BASELINE, tuning: '@import url("https://example.invalid/x.css");\n', tuningSupport: "unsupported" }) }),
    unsupportedBaseline: buildFixtureHtml({ title: "Smart Colors unsupported baseline", runtimeSource, payload: buildPayload({ baseline: ':root { background-image: url("https://example.invalid/a.png"); }\n' }) }),
    badPayload: buildFixtureHtml({ title: "Smart Colors invalid payload", runtimeSource, payload: buildPayload({ baseline: PREF_BASELINE, schemaVersion: 2 }) }),
    unpinnedTheme: buildFixtureHtml({ title: "Smart Colors unpinned theme", runtimeSource, payload: buildPayload({ baseline: UNPINNED_BASELINE }) }),
    motion: buildFixtureHtml({ title: "Smart Colors tuning animation", runtimeSource, payload: buildPayload({ baseline: PREF_BASELINE, tuning: MOTION_TUNING, tuningSupport: "supported" }) }),
  };

  // The real payload path: the SC-03 session output feeds the runner unchanged.
  const sessionRoot = path.join(root, "session");
  await mkdir(path.join(sessionRoot, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(sessionRoot, "src/styles/tokens/palette.css"), [
    "@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; }",
    "@property --palette-ink { initial-value: oklch(.28 .007 3.68); role: ink; }",
    "@property --palette-primary { initial-value: oklch(.62 .15 32.41); role: ui; }",
    "",
  ].join("\n"));
  const session = (await createDiagnosticSession({ root: sessionRoot, suggest: false })).session;
  await writeFile(path.join(sessionRoot, session.files.tuning), ":root { --color-tune-dark-muted-mix: 40%; }\n");
  const tunedSession = (await createDiagnosticSession({ root: sessionRoot, suggest: false })).session;
  files.real = buildFixtureHtml({
    title: "Smart Colors session payload",
    runtimeSource,
    payload: buildPayload({ baseline: tunedSession.css.baseline, tuning: tunedSession.css.tuning, tuningSupport: tunedSession.css.tuningSupport, config: tunedSession.config }),
  });

  for (const key of Object.keys(files)) {
    await writeFile(path.join(root, key + ".html"), files[key], "utf8");
  }

  const results = [];
  for (const engineName of ENGINES) {
    const browserType = playwright.browsers[engineName];
    assert.ok(browserType, "engine " + engineName + " must exist");
    const browser = await openEngine(engineName, browserType);
    const version = browser.version();
    const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
    try {
      // 1. T-PREF fixture: preference semantics, matrix and invalidation.
      const pref = await loadFixture(context, path.join(root, "pref.html"));
      await assertRuntimeConstants(pref.page);
      await runPreferenceFixture(pref.page, pref.requests, pref.url, contract);

      // 2. Fail-closed fixture: registered initial and undeclared token.
      const failClosed = await loadFixture(context, path.join(root, "failClosed.html"));
      await assertNoNetwork(failClosed.requests, failClosed.url);
      await runFailClosedFixture(failClosed.page, contract);

      // 3. Unsupported tuning: the tuned scenarios are declared, never counted as passes.
      const unsupportedTuning = await loadFixture(context, path.join(root, "unsupportedTuning.html"));
      const tuningReport = await unsupportedTuning.page.evaluate(() => window.__smartColorsDiagnostic.report());
      assert.equal(tuningReport.status, "incomplete");
      assert.equal(tuningReport.unsupported.length, 2, "both tuned scenarios must be declared unsupported");
      assert.ok(tuningReport.unsupported.every((entry) => /@import|url\(/.test(entry.reason)));
      assert.ok(tuningReport.executed.scenarios.every((id) => id.startsWith("baseline-")), "only the baseline scenarios may be measured");
      await assertNoNetwork(unsupportedTuning.requests, unsupportedTuning.url);

      // 4. Unsupported baseline: the whole run is unsupported and nothing is measured.
      const unsupportedBaseline = await loadFixture(context, path.join(root, "unsupportedBaseline.html"));
      const baselineReport = await unsupportedBaseline.page.evaluate(() => window.__smartColorsDiagnostic.report());
      assert.equal(baselineReport.status, "unsupported");
      assert.equal(baselineReport.measurements.length, 0, "no measurement may be produced for unsupported CSS");
      assert.equal(baselineReport.unsupported.length, 2);
      await assertNoNetwork(unsupportedBaseline.requests, unsupportedBaseline.url);

      // 5. Invalid payload: fail-closed, no measurements, explicit payload phase.
      const badPayload = await loadFixture(context, path.join(root, "badPayload.html"));
      const badReport = await badPayload.page.evaluate(() => window.__smartColorsDiagnostic.report());
      assert.equal(badReport.status, "incomplete");
      assert.equal(badReport.errors[0].phase, "payload");
      assert.equal(badReport.measurements.length, 0);
      await assertNoNetwork(badPayload.requests, badPayload.url);

      // 6. Unpinned theme: `color-scheme: light dark !important` beats the runtime's inline value,
      //    so the exact-theme proof fails and the run is declared unsupported with no measurement.
      const unpinned = await loadFixture(context, path.join(root, "unpinnedTheme.html"));
      const unpinnedReport = await unpinned.page.evaluate(() => window.__smartColorsDiagnostic.report());
      assert.equal(unpinnedReport.status, "unsupported");
      assert.equal(unpinnedReport.measurements.length, 0, "no measurement may be inferred when the theme is unpinned");
      assert.equal(unpinnedReport.unsupported.length, 2);
      assert.ok(unpinnedReport.unsupported.every((entry) => /color-scheme/.test(entry.reason)), JSON.stringify(unpinnedReport.unsupported));
      await assertNoNetwork(unpinned.requests, unpinned.url);

      // 7. Tuning that animates a root custom property with a long `!important` animation: the
      //    endpoint must stay at the static tuning value, stable across reruns, with zero active
      //    animation left in the frame.
      const motion = await loadFixture(context, path.join(root, "motion.html"));
      const motionReport = await motion.page.evaluate(() => window.__smartColorsDiagnostic.report());
      assert.equal(motionReport.status, "complete", JSON.stringify(motionReport.unsupported));
      const motionLightMuted = pairIdOf(contract, "light", "muted text / canvas");
      const motionDarkMuted = pairIdOf(contract, "dark", "muted text / canvas");
      const frozenLight = measurementOf(motionReport, scenarioIdOf(motionReport, "tuned", "light"), motionLightMuted);
      closeTo(frozenLight.ratio, contrastRgb(BLUE_RGB, WHITE_RGB), "the frozen tuning value must be the static blue", 1e-3);
      assert.ok(Math.abs(frozenLight.ratio - contrastRgb(RED_RGB, WHITE_RGB)) > 0.5, "the animated value must not replace the endpoint");
      closeTo(measurementOf(motionReport, scenarioIdOf(motionReport, "tuned", "dark"), motionDarkMuted).ratio, contrastRgb(BLUE_RGB, BLACK_RGB), "the frozen tuning value must be the static blue in dark", 1e-3);
      await motion.page.evaluate(async () => {
        const controller = window.__smartColorsDiagnostic;
        const before = controller.report().measuredAt;
        controller.button.click();
        await new Promise((resolve) => {
          const stop = controller.subscribe((snapshot) => {
            if (snapshot.state === "complete" && snapshot.report && snapshot.report.measuredAt !== before) {
              stop();
              resolve();
            }
          });
        });
      });
      const motionAgain = await motion.page.evaluate(() => window.__smartColorsDiagnostic.report());
      assert.equal(
        measurementOf(motionAgain, scenarioIdOf(motionAgain, "tuned", "light"), motionLightMuted).ratio,
        frozenLight.ratio,
        "endpoint measures must be stable across reruns",
      );
      const motionState = await motion.page.evaluate(() => {
        const frame = Array.prototype.slice.call(document.querySelectorAll("iframe")).find((element) => element.getAttribute("data-smart-colors-scenario").indexOf("tuned-") === 0);
        const frameDocument = frame.contentDocument;
        return {
          active: frameDocument.getAnimations().length,
          rootAnimation: frameDocument.defaultView.getComputedStyle(frameDocument.documentElement).animationName,
        };
      });
      assert.equal(motionState.active, 0, "no active animation may remain in the measurement frame");
      assert.equal(motionState.rootAnimation, "none", "the tuning root animation must be frozen");
      await assertNoNetwork(motion.requests, motion.url);

      // 8. Real session payload: complete coverage, and the tuning isolated to the dark theme.
      const real = await loadFixture(context, path.join(root, "real.html"));
      await real.page.emulateMedia({ colorScheme: "light" });
      await real.page.waitForFunction(() => window.__smartColorsDiagnostic.report() && window.__smartColorsDiagnostic.status().state === "complete", null, { timeout: 20_000 });
      const realReport = await real.page.evaluate(() => window.__smartColorsDiagnostic.report());
      assert.equal(realReport.status, "complete", "the real generated payload must measure completely");
      assert.equal(realReport.coverage.complete, true, "the real catalog must be covered: " + JSON.stringify(realReport.coverage.unmeasured));
      assert.equal(realReport.coverage.expectedCount, realReport.coverage.measuredCount);
      assert.ok(realReport.measurements.every((measurement) => measurement.error === null), "no fabricated or missing value in the real payload");
      const realContract = contractFor(tunedSession.config);
      const realMuted = pairIdOf(realContract, "dark", "muted text / canvas");
      const realBaselineDark = measurementOf(realReport, scenarioIdOf(realReport, "baseline", "dark"), realMuted);
      const realTunedDark = measurementOf(realReport, scenarioIdOf(realReport, "tuned", "dark"), realMuted);
      assert.ok(realBaselineDark.ratio !== realTunedDark.ratio, "the dark tuning must change the dark measurement");
      const realLightPair = pairIdOf(realContract, "light", "muted text / canvas");
      assert.equal(
        measurementOf(realReport, scenarioIdOf(realReport, "baseline", "light"), realLightPair).ratio,
        measurementOf(realReport, scenarioIdOf(realReport, "tuned", "light"), realLightPair).ratio,
        "a dark-only tuning must not change the light theme",
      );
      await assertNoNetwork(real.requests, real.url);

      results.push({ engine: engineName, version, status: "pass", realExpected: realReport.coverage.expectedCount });
    } finally {
      await context.close();
      await browser.close();
    }
  }

  assert.deepEqual(results.map((entry) => entry.engine), ENGINES, "both engines must run, never skipped");
  console.log("SC-04 proof:", JSON.stringify(results));
});
