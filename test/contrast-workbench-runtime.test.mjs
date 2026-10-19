/**
 * Workbench runtime tests.
 *
 * The first block is Node-only: factory serialization and security, payload validation, control
 * whitelisting, theme normalization, serialization of state, cancellation/invalid-input basics and
 * the visible-node fail-closed paths in `measureDocument`.
 *
 * The second block is the real proof: `file://` fixtures opened in an already installed Chromium
 * (opt-in with `SMART_COLORS_NATIVE_PROOF=1`, never a package dependency). It uses a real generated
 * baseline from `analyzeColorTokens` in a temporary project, a visible specimen measured through
 * `measureDocument(..., { elements })`, a verified suggestion, draft application, full-override
 * precedence, stale-input provenance, cancellation and the alpha/gradient/backdrop fail-closed
 * cases. No install, server or network access is used.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { analyzeColorTokens } from "../src/generate-colors.mjs";
import { createContrastAdvice } from "../src/contrast-advice.mjs";
import { createVerificationCore } from "../src/verification-core.mjs";
import {
  DOM_VISIBLE_BACKGROUND_ATTRIBUTE,
  DOM_VISIBLE_FOREGROUND_ATTRIBUTE,
  DOM_VISIBLE_PROPERTY_ATTRIBUTE,
  DOM_VISIBLE_SPECIMEN_ATTRIBUTE,
  createDomVerifier,
} from "../src/verification-dom.mjs";
import {
  WORKBENCH_COMPARISONS,
  WORKBENCH_FRAME_COLOR_SCHEME,
  WORKBENCH_FRAME_TIMEOUT_MS,
  WORKBENCH_MACRO_CONTROLS,
  WORKBENCH_PAYLOAD_ID,
  WORKBENCH_PHASES,
  WORKBENCH_RUNTIME_GLOBAL,
  WORKBENCH_RUNTIME_MARKER,
  WORKBENCH_RUNTIME_VERSION,
  WORKBENCH_SIDES,
  WORKBENCH_VISIBLE_BACKGROUND_ATTRIBUTE,
  WORKBENCH_VISIBLE_FOREGROUND_ATTRIBUTE,
  WORKBENCH_VISIBLE_PROPERTY_ATTRIBUTE,
  WORKBENCH_VISIBLE_SPECIMEN_ATTRIBUTE,
  createContrastWorkbench,
  createContrastWorkbenchSource,
} from "../src/contrast-workbench-runtime.mjs";

const core = createVerificationCore();
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, "../../..");
const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";

const SYNTHETIC_CONFIG = {
  contrast: { text: 4.5, onColor: 4.5, ui: 3, maxIdentity: 7.5, darkRichness: 1.15 },
  roles: { identities: {}, decoratives: {} },
};

const SYNTHETIC_BASELINE = [
  ":root {",
  "  color-scheme: light dark;",
  "  --color-bg: light-dark(white, black);",
  "  --color-surface: light-dark(white, white);",
  "  --color-text: light-dark(var(--color-tune-text-light, oklch(0.62 0 0)), oklch(0.62 0 0));",
  "  --color-text-muted: light-dark(var(--color-tune-text-muted-light, black), white);",
  "  --color-focus-ring: light-dark(black, black);",
  "  --color-control-active-text: light-dark(white, white);",
  "  --color-control-bg-active: light-dark(black, black);",
  "  --color-control-focus-bg: light-dark(white, white);",
  "  --color-control-border-active: light-dark(black, black);",
  "}",
  "",
].join("\n");

const SYNTHETIC_DESIGN = {
  version: 1,
  sources: [
    { token: "--palette-ink", name: "ink", role: "ink", darkBlend: null, darkMix: { mode: "automatic", sourcePercent: null, whitePercent: null } },
    { token: "--palette-canvas", name: "canvas", role: "canvas", darkBlend: null, darkMix: { mode: "automatic", sourcePercent: null, whitePercent: null } },
  ],
  recipes: { "neutral-text": { kind: "contrast", basis: "contrast", usage: "neutral text" } },
  tokens: {
    "--color-text": {
      sources: ["--palette-ink"],
      recipe: "neutral-text",
      usage: "neutral text",
      controls: { light: { override: "--color-tune-text-light" }, dark: { override: "--color-tune-text-dark" } },
    },
    "--color-bg": {
      sources: ["--palette-canvas"],
      recipe: "neutral",
      usage: "canvas",
      controls: { light: { override: "--color-tune-bg-light" }, dark: { override: "--color-tune-bg-dark" } },
    },
    "--color-text-muted": {
      sources: ["--palette-ink"],
      recipe: "neutral-text",
      usage: "muted text",
      controls: { light: { override: "--color-tune-text-muted-light" }, dark: { override: "--color-tune-text-muted-dark" } },
    },
    "--color-brand-surface": {
      sources: ["--palette-brand"],
      recipe: "surface",
      usage: "brand surface",
      controls: {
        light: { override: "--color-tune-brand-surface-light", mix: "--color-tune-brand-surface-light-mix", defaultMix: 0.1 },
        dark: { override: "--color-tune-brand-surface-dark", mix: "--color-tune-brand-surface-dark-mix", defaultMix: 0.18 },
      },
    },
  },
};

function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function syntheticPayload(options = {}) {
  const css = Object.assign({
    baseline: SYNTHETIC_BASELINE,
    tuning: null,
    tuningSupport: "absent",
    baselineSupport: "supported",
    source: "output",
    status: "current",
    production: true,
    digest: { baseline: sha256Hex(SYNTHETIC_BASELINE), generated: sha256Hex(SYNTHETIC_BASELINE) },
  }, options.css || {});
  const payload = {
    schemaVersion: 1,
    toolVersion: "0.0.0-test",
    snapshotId: "scw-workbench-test",
    config: SYNTHETIC_CONFIG,
    css,
    design: Object.prototype.hasOwnProperty.call(options, "design") ? options.design : SYNTHETIC_DESIGN,
    paletteSource: SYNTHETIC_DESIGN.sources,
    // Legacy decoy: provenance must read the additive `paletteSource`, never this field.
    palette: [{ decoy: true }],
  };
  if (Object.prototype.hasOwnProperty.call(options, "top")) return Object.assign(payload, options.top);
  return payload;
}

function defaultSupports(property, value) {
  const text = String(value);
  if (property === "color") {
    if (/^(?:oklch|rgb|rgba|hsl|hsla|color)\(/i.test(text)) return true;
    if (/^#[0-9a-f]{3,8}$/i.test(text)) return true;
    return /^[a-z]+$/i.test(text);
  }
  if (property === "width") return /^(?:\d+(?:\.\d*)?|\.\d+)%$/.test(text);
  return false;
}

function fakeEnvironment(payload, options = {}) {
  const payloadNode = { textContent: typeof payload === "string" ? payload : JSON.stringify(payload) };
  const preferenceListeners = new Set();
  const preferenceQuery = {
    matches: options.preferenceMatches === true,
    addEventListener(type, listener) {
      if (type === "change") preferenceListeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "change") preferenceListeners.delete(listener);
    },
  };
  const globalObject = {};
  const win = {
    matchMedia: () => preferenceQuery,
    CSS: { supports: options.supports || defaultSupports },
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (id) => clearTimeout(id),
    navigator: { userAgent: "node-test", language: "it" },
  };
  const documentElement = {
    style: {},
    setAttribute() {},
    contains: () => true,
  };
  const doc = {
    getElementById: (id) => (id === WORKBENCH_PAYLOAD_ID ? payloadNode : null),
    body: { appendChild() {} },
    documentElement,
    createElement: () => ({
      nodeType: 1,
      style: {},
      setAttribute() {},
      appendChild() {},
      remove() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    contains: () => false,
  };
  return { doc, win, payloadNode, preferenceListeners, preferenceQuery, globalObject };
}

function makeWorkbench(payload, options = {}) {
  const env = fakeEnvironment(payload, options);
  const controller = createContrastWorkbench({
    createVerificationCore: () => core,
    createDomVerifier,
    createContrastAdvice,
    document: env.doc,
    window: env.win,
    globalThis: env.globalObject,
  });
  env.globalObject[WORKBENCH_RUNTIME_GLOBAL] = controller;
  return Object.assign(env, { controller });
}

function countFrames(state) {
  return state.views.reduce((total, view) => total + (view.frame ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------
// Node-only: serialization, security and the frozen surface
// ---------------------------------------------------------------------------

test("createContrastWorkbenchSource is one self-contained classic script with no imports, eval or network", () => {
  const source = createContrastWorkbenchSource();
  assert.match(source, /^\(function \(\) \{/);
  assert.ok(source.endsWith("})();\n"));
  assert.equal(createContrastWorkbenchSource(), source, "the emitted bytes are deterministic");
  assert.ok(source.includes(WORKBENCH_RUNTIME_GLOBAL));
  assert.ok(source.includes("createVerificationCore"));
  assert.ok(source.includes("createDomVerifier"));
  assert.ok(source.includes("createContrastAdvice"));
  assert.ok(source.includes("createContrastWorkbench"));
  // The emitted runtime carries the shared task-A factory verbatim and no local search copy.
  assert.ok(source.includes("No lightness on the 0..1 grid"), "the shared createContrastAdvice implementation is embedded");
  assert.ok(!source.includes("no lightness on the 0.0001 grid"), "no local advice fallback is embedded");
  assert.ok(source.includes("allow-same-origin"));
  assert.ok(!source.includes("allow-scripts"));
  assert.ok(!source.includes("</"), "no closing tag may terminate the embedding script");
  assert.match(source, /frame\.style\.colorScheme = FRAME_COLOR_SCHEME/);
  assert.doesNotMatch(source, /\bimport\s*\(/, "no dynamic import");
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /\bnew\s+Function\s*\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /XMLHttpRequest/);
  assert.doesNotMatch(source, /WebSocket/);
  assert.doesNotMatch(source, /https?:\/\//);
  // A static `import`/`export` statement or any other module syntax would make this fail; the
  // emitted bytes must stay a plain classic script.
  assert.doesNotThrow(() => new Function(source), "the emitted source compiles as a classic script");
});

test("the exported workbench constants describe the frozen surface", () => {
  assert.equal(WORKBENCH_RUNTIME_VERSION, 1);
  assert.ok(/^SMART_COLORS_WORKBENCH_RUNTIME_V\d+$/.test(WORKBENCH_RUNTIME_MARKER));
  assert.equal(WORKBENCH_RUNTIME_GLOBAL, "__smartColorsWorkbench");
  assert.equal(WORKBENCH_PAYLOAD_ID, "smart-colors-payload");
  assert.equal(WORKBENCH_FRAME_COLOR_SCHEME, "light dark");
  assert.ok(WORKBENCH_FRAME_TIMEOUT_MS > 0);
  assert.deepEqual(WORKBENCH_PHASES, ["idle", "running", "complete", "incomplete", "unavailable"]);
  assert.deepEqual(WORKBENCH_COMPARISONS, ["themes", "tuning", "draft"]);
  assert.deepEqual(WORKBENCH_SIDES, ["foreground", "background"]);
  assert.deepEqual(WORKBENCH_MACRO_CONTROLS.map((entry) => entry.name), [
    "--color-tune-light-warmth",
    "--color-tune-dark-warmth",
    "--color-tune-dark-bg-mix",
    "--color-tune-dark-surface-mix",
    "--color-tune-dark-text-mix",
    "--color-tune-dark-muted-mix",
    "--color-tune-surface-lightness-shift",
  ]);
  assert.equal(WORKBENCH_VISIBLE_FOREGROUND_ATTRIBUTE, DOM_VISIBLE_FOREGROUND_ATTRIBUTE);
  assert.equal(WORKBENCH_VISIBLE_BACKGROUND_ATTRIBUTE, DOM_VISIBLE_BACKGROUND_ATTRIBUTE);
  assert.equal(WORKBENCH_VISIBLE_PROPERTY_ATTRIBUTE, DOM_VISIBLE_PROPERTY_ATTRIBUTE);
  assert.equal(WORKBENCH_VISIBLE_SPECIMEN_ATTRIBUTE, DOM_VISIBLE_SPECIMEN_ATTRIBUTE);
});

test("createContrastWorkbench validates its dependencies instead of failing later", () => {
  assert.throws(() => createContrastWorkbench(), /deps object/);
  assert.throws(() => createContrastWorkbench({}), /document/);
  const base = {
    document: {},
    window: { matchMedia: () => ({ matches: false }) },
    createVerificationCore: () => core,
    createDomVerifier,
    createContrastAdvice: () => ({}),
  };
  assert.throws(() => createContrastWorkbench(base), /suggestLightness/);
  assert.throws(() => createContrastWorkbench(Object.assign({}, base, { createContrastAdvice: undefined })), /createContrastAdvice/);
});

test("payload() is parsed, frozen and preserves palette roles and css provenance", () => {
  const { controller } = makeWorkbench(syntheticPayload());
  const payload = controller.payload();
  assert.ok(payload && Object.isFrozen(payload));
  assert.ok(Object.isFrozen(payload.css));
  assert.equal(payload.css.source, "output");
  assert.equal(payload.css.status, "current");
  assert.equal(payload.css.baselineSupport, "supported");
  assert.equal(payload.css.digest.baseline, sha256Hex(SYNTHETIC_BASELINE));
  assert.deepEqual(controller.pairs("light").length, 10);
  assert.deepEqual(controller.pairs("dark").length, 10);
  assert.deepEqual(controller.pairs("nope"), []);
  const state = controller.state();
  assert.equal(state.phase, "idle");
  assert.equal(state.selection.theme, "light");
  assert.equal(state.selection.comparison, "tuning");
  assert.equal(state.selection.pairId, "light|color|--color-text|--color-bg");
  assert.deepEqual(state.draft, {});
  assert.equal(state.suggestion, null);
  assert.equal(state.error, null);
  assert.equal(state.provenance.source, "output");
  assert.equal(state.provenance.status, "current");
  assert.equal(state.provenance.support.baseline, "supported");
  assert.equal(state.provenance.support.tuning, "absent");
  assert.ok(Array.isArray(state.provenance.palette));
  assert.ok(state.provenance.palette.some((entry) => entry.role === "ink"));
  assert.deepEqual(state.provenance.palette, payload.paletteSource, "provenance reads payload.paletteSource, not the legacy palette field");
  assert.ok(!state.provenance.palette.some((entry) => entry && entry.decoy === true));
  assert.deepEqual(countFrames(state), 0);
  assert.doesNotThrow(() => JSON.stringify(state));
  assert.ok(!JSON.stringify(state).includes("iframe"));
});

test("an empty captured output is never replaced by the generated candidate", () => {
  const payload = syntheticPayload({ css: { baseline: "", status: "empty" } });
  const { controller } = makeWorkbench(payload);
  assert.equal(controller.payload().css.baseline, "");
  const state = controller.state();
  assert.equal(state.phase, "unavailable");
  assert.match(state.error, /never substituted/);
  assert.equal(state.views.length, 0);
});

test("missing and invalid payloads fail closed", () => {
  const missing = makeWorkbench(syntheticPayload());
  missing.doc.getElementById = () => null;
  const missingController = createContrastWorkbench({
    createVerificationCore: () => core,
    createDomVerifier,
    createContrastAdvice,
    document: missing.doc,
    window: missing.win,
    globalThis: missing.globalObject,
  });
  assert.equal(missingController.payload(), null);
  assert.equal(missingController.state().phase, "unavailable");
  assert.match(missingController.state().error, /missing/);

  const invalidJson = makeWorkbench("{not json");
  assert.equal(invalidJson.controller.payload(), null);
  assert.equal(invalidJson.controller.state().phase, "unavailable");
  assert.match(invalidJson.controller.state().error, /valid JSON/);
});

test("select normalizes a pair by foreground/background/property when the theme changes", async () => {
  const { controller } = makeWorkbench(syntheticPayload());
  const lightId = controller.state().selection.pairId;
  await controller.select({ pairId: lightId, theme: "dark", comparison: "tuning" });
  assert.deepEqual(controller.state().selection, {
    pairId: "dark|color|--color-text|--color-bg",
    theme: "dark",
    comparison: "tuning",
  });
  await controller.select({ pairId: "dark|color|--color-text|--color-bg", theme: "light", comparison: "draft" });
  assert.deepEqual(controller.state().selection, {
    pairId: "light|color|--color-text|--color-bg",
    theme: "light",
    comparison: "draft",
  });
  const before = controller.state().selection;
  await controller.select({ pairId: "light|color|--color-does-not-exist|--color-bg", theme: "light", comparison: "tuning" });
  assert.deepEqual(controller.state().selection, before, "an unknown pair is rejected without changing selection");
  assert.match(controller.state().error, /not declared/);
  await controller.select({ pairId: lightId, theme: "sepia", comparison: "tuning" });
  assert.match(controller.state().error, /theme/);
  await controller.select({ pairId: lightId, theme: "light", comparison: "side-by-side" });
  assert.match(controller.state().error, /comparison/);
});

test("setOverride accepts only whitelisted controls and validated values", async () => {
  const { controller } = makeWorkbench(syntheticPayload());
  const controls = controller.controls();
  const byName = new Map(controls.map((entry) => [entry.name, entry]));
  assert.ok(byName.has("--color-tune-text-light"));
  assert.ok(byName.has("--color-tune-brand-surface-light-mix"));
  assert.equal(byName.get("--color-tune-brand-surface-light-mix").kind, "mix");
  assert.equal(byName.get("--color-tune-brand-surface-light-mix").defaultMix, 0.1);
  assert.ok(byName.has("--color-tune-surface-lightness-shift"));
  assert.ok(!byName.has("--color-tune-evil"));

  await controller.setOverride("--color-tune-evil", "10%");
  assert.match(controller.state().error, /unknown tuning control/);
  assert.deepEqual(controller.state().draft, {});
  assert.equal(controller.state().selection.comparison, "tuning", "an error does not change the displayed comparison");

  await controller.setOverride("--color-tune-text-light", "red; } body{");
  assert.match(controller.state().error, /invalid value/);
  assert.deepEqual(controller.state().draft, {});

  await controller.setOverride("--color-tune-text-light", "transparent");
  assert.match(controller.state().error, /invalid value/);
  assert.deepEqual(controller.state().draft, {});
  assert.equal(controller.state().selection.comparison, "tuning", "an invalid value does not change the displayed comparison");

  const revision = controller.state().revision;
  await controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)");
  assert.equal(controller.state().error, null);
  assert.equal(controller.state().draft["--color-tune-text-light"], "oklch(0.5 0 0)");
  assert.ok(controller.state().revision > revision);
  assert.equal(controller.state().suggestion, null);
  assert.equal(controller.state().selection.comparison, "draft", "a successful edit shows the draft");

  await controller.setOverride("--color-tune-brand-surface-light-mix", "42%");
  assert.equal(controller.state().draft["--color-tune-brand-surface-light-mix"], "42%");
  await controller.setOverride("--color-tune-brand-surface-light-mix", 120);
  assert.match(controller.state().error, /invalid value/);
  assert.equal(controller.state().draft["--color-tune-brand-surface-light-mix"], "42%");
  await controller.setOverride("--color-tune-brand-surface-light-mix", "42");
  assert.match(controller.state().error, /invalid value/);

  await controller.setOverride("--color-tune-light-warmth", "100%");
  assert.equal(controller.state().draft["--color-tune-light-warmth"], "100%");
  await controller.setOverride("--color-tune-light-warmth", "101%");
  assert.match(controller.state().error, /invalid value/);
  await controller.setOverride("--color-tune-surface-lightness-shift", -0.02);
  assert.equal(controller.state().draft["--color-tune-surface-lightness-shift"], "-0.02");
  await controller.setOverride("--color-tune-surface-lightness-shift", 2);
  assert.match(controller.state().error, /invalid value/);

  // A full override and a mix can coexist in the draft; the public declaration comparison lets the
  // UI show that the generator's full control wins over the mix knob.
  await controller.setOverride("--color-tune-brand-surface-light", "oklch(0.9 0.02 255)");
  assert.equal(controller.state().draft["--color-tune-brand-surface-light"], "oklch(0.9 0.02 255)");
  assert.equal(controller.state().draft["--color-tune-brand-surface-light-mix"], "42%");

  const exportValue = controller.exportTuning();
  assert.match(exportValue, /^:root \{\n/);
  assert.match(exportValue, /--color-tune-brand-surface-light: oklch\(0\.9 0\.02 255\);/);
  assert.match(exportValue, /--color-tune-brand-surface-light-mix: 42%;/);
  assert.match(exportValue, /--color-tune-text-light: oklch\(0\.5 0 0\);/);
  assert.ok(!exportValue.includes("@layer"));
  assert.ok(!exportValue.includes("body"));
  const declarations = exportValue.split("\n").filter((line) => line.includes(":") && line.includes(";"));
  assert.equal(declarations.length, Object.keys(controller.state().draft).length);

  await controller.reset("--color-tune-text-light");
  assert.ok(!Object.prototype.hasOwnProperty.call(controller.state().draft, "--color-tune-text-light"));
  assert.equal(controller.state().selection.comparison, "draft", "a successful reset keeps the draft comparison");
  await controller.reset();
  assert.deepEqual(controller.state().draft, {});
  assert.equal(controller.exportTuning(), "");
});

test("subscribe is isolated, preference changes invalidate, and destroy is idempotent", async () => {
  const { controller, preferenceListeners, globalObject } = makeWorkbench(syntheticPayload());
  const received = [];
  const throwing = () => {
    throw new Error("subscriber failure");
  };
  const unsubscribe = controller.subscribe((state, reason) => {
    received.push({ state, reason });
  });
  controller.subscribe(throwing);
  await controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)");
  assert.ok(received.length > 0);
  assert.ok(received.every((entry) => typeof entry.state.phase === "string"));
  const count = received.length;
  unsubscribe();
  await controller.reset();
  assert.equal(received.length, count, "unsubscribe stops delivery");

  const before = controller.state().revision;
  for (const listener of preferenceListeners) listener({ matches: true });
  assert.ok(controller.state().revision > before);
  assert.equal(controller.state().suggestion, null);
  assert.deepEqual(controller.state().views, []);

  assert.equal(globalObject[WORKBENCH_RUNTIME_GLOBAL], controller);
  controller.destroy();
  assert.equal(preferenceListeners.size, 0, "destroy removes the preference listener");
  assert.equal(globalObject[WORKBENCH_RUNTIME_GLOBAL], undefined);
  assert.equal(controller.state().phase, "idle");
  assert.equal(controller.destroyed, true);
  controller.destroy();
  await assert.rejects(controller.select({ pairId: null, theme: "light", comparison: "tuning" }), /destroyed/);
  await assert.rejects(controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)"), /destroyed/);
  assert.throws(() => controller.subscribe(() => {}), /destroyed/);
});

test("suggest before a measured pick is unavailable and applySuggestion rejects", async () => {
  const { controller } = makeWorkbench(syntheticPayload());
  await controller.suggest("foreground");
  const suggestion = controller.state().suggestion;
  assert.equal(suggestion.status, "unavailable");
  assert.equal(suggestion.value, null);
  assert.equal(suggestion.checked, 0);
  assert.equal(suggestion.unmeasured, 0);
  assert.match(suggestion.reason, /no measured view/);
  const selectionBefore = controller.state().selection;
  await controller.applySuggestion();
  assert.match(controller.state().error, /no verified suggestion/);
  assert.deepEqual(controller.state().selection, selectionBefore, "a rejected apply does not change the selection");
  await controller.suggest("sideways");
  assert.match(controller.state().error, /foreground/);
  assert.deepEqual(controller.state().selection, selectionBefore, "a rejected suggest does not change the selection");
});

test("the shared createContrastAdvice factory returns the documented candidate shape", () => {
  const advice = createContrastAdvice(core);
  assert.equal(typeof advice.nearestLightness, "function");
  assert.equal(typeof advice.suggestLightness, "function");

  const white = { l: 1, c: 0, h: 0 };
  const result = advice.suggestLightness({
    color: { l: 0.8, c: 0, h: 0 },
    constraints: [{ other: white, minimum: 4.5 }],
    margin: 0.02,
  });
  assert.equal(result.status, "candidate");
  assert.equal(typeof result.value, "string");
  assert.match(result.value, /^oklch\(/);
  assert.ok(Number.isFinite(result.color.l));
  assert.ok(core.contrast(result.color, white) >= 4.5);
  assert.deepEqual(result.authored, { l: 0.8, c: 0, h: 0 });
  assert.equal(result.deltaL, Number((result.color.l - 0.8).toFixed(4)));
  assert.ok(result.deltaL < 0);
  assert.equal(result.gamutAdjusted, false);
  assert.equal(result.reason, null);

  // Documented validation: a non-empty constraint list, finite colour, minimum >= 1 and margin >= 0.
  assert.equal(advice.suggestLightness({ color: { l: 0.8, c: 0, h: 0 }, constraints: [] }).status, "invalid");
  assert.equal(advice.suggestLightness({ color: { l: 0.8, c: 0, h: 0 }, constraints: [{ other: white, minimum: 0.5 }] }).status, "invalid");
  assert.equal(advice.suggestLightness({ color: { l: 0.8, c: 0, h: 0 }, constraints: [{ other: white, minimum: 4.5 }], margin: -1 }).status, "invalid");
  // A minimum above the 21:1 WCAG ceiling is unreachable by definition and returns `none`, never a
  // fabricated candidate. This is the documented API behaviour, not a fallback expectation.
  const unreachable = advice.suggestLightness({
    color: { l: 0.8, c: 0, h: 0 },
    constraints: [{ other: white, minimum: 30 }],
  });
  assert.equal(unreachable.status, "none");
  assert.equal(unreachable.value, null);
  assert.deepEqual(unreachable.authored, { l: 0.8, c: 0, h: 0 });
});

// ---------------------------------------------------------------------------
// Node-only: visible-node fail-closed paths in the collector
// ---------------------------------------------------------------------------

function verifierStubDocument() {
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
  const body = makeElement("body");
  const document = {
    documentElement: root,
    head: makeElement("head"),
    body,
    querySelector: () => null,
    createElement: makeElement,
  };
  const view = {
    matchMedia: () => ({ matches: false }),
    CSS: { supports: () => true },
    getComputedStyle: (element) => {
      if (element === root) return { colorScheme: "light", getPropertyValue: () => "" };
      if (element.className === "smart-colors-theme-probe") return { color: "rgb(255, 255, 255)" };
      return { color: "", backgroundColor: "", getPropertyValue: () => "" };
    },
  };
  document.defaultView = view;
  return document;
}

test("measureDocument rejects a non-Map visible element option", () => {
  const verifier = createDomVerifier(core);
  const contract = core.createContract(SYNTHETIC_CONFIG);
  const document = verifierStubDocument();
  const result = verifier.measureDocument(
    document,
    { id: "baseline-light", theme: "light", variant: "baseline", preference: "light" },
    contract,
    { elements: { "light|color|--color-text|--color-bg": {} } },
  );
  assert.equal(result.support, "unsupported");
  assert.equal(result.errors[0].cause, "elements-invalid");
  assert.ok(result.measurements.every((measurement) => measurement.status === "unmeasured"));
});

test("measureDocument fails closed on a provided visible node that is detached or mismatched", () => {
  const verifier = createDomVerifier(core);
  const contract = core.createContract(SYNTHETIC_CONFIG);
  const pair = contract.pairs.light.find((entry) => entry.id === "light|color|--color-text|--color-bg");
  assert.ok(pair);

  const detached = verifier.measureDocument(
    verifierStubDocument(),
    { id: "baseline-light", theme: "light", variant: "baseline", preference: "light" },
    contract,
    { elements: new Map([[pair.id, { nodeType: 1, isConnected: false, ownerDocument: verifierStubDocument(), getAttribute: () => null }]]) },
  );
  const detachedMeasurement = detached.measurements.find((measurement) => measurement.pairId === pair.id);
  assert.ok(detachedMeasurement);
  assert.equal(detachedMeasurement.status, "unmeasured");
  assert.match(detachedMeasurement.error, /not connected|another document/);
  assert.ok(detached.visible.missing.includes(pair.id));

  const mapped = new Map([[pair.id, {
    nodeType: 1,
    isConnected: true,
    ownerDocument: null,
    getAttribute: (name) => {
      if (name === DOM_VISIBLE_FOREGROUND_ATTRIBUTE) return "--color-wrong";
      return null;
    },
  }]]);
  const document = verifierStubDocument();
  for (const [, node] of mapped) node.ownerDocument = document;
  const mismatched = verifier.measureDocument(
    document,
    { id: "baseline-light", theme: "light", variant: "baseline", preference: "light" },
    contract,
    { elements: mapped },
  );
  const mismatchedMeasurement = mismatched.measurements.find((measurement) => measurement.pairId === pair.id);
  assert.ok(mismatchedMeasurement);
  assert.equal(mismatchedMeasurement.status, "unmeasured");
  assert.match(mismatchedMeasurement.error, /declares foreground/);
});

// The proposal containers are additive and validated as a pair: a single container is a programming
// error in the host UI, and omitting both keeps the controller exactly as it was (no proposal frames).
test("mount validates the optional proposal containers instead of half-mounting them", () => {
  const env = makeWorkbench(syntheticPayload());
  const controller = env.controller;
  // The fake document reports every node as detached; pretend the host attached the containers.
  env.doc.contains = () => true;
  const left = env.doc.createElement();
  const right = env.doc.createElement();
  const before = env.doc.createElement();
  const after = env.doc.createElement();

  assert.throws(
    () => controller.mount({ left, right, proposalBefore: before }),
    /proposal/i,
    "a single proposal container is rejected instead of silently ignored",
  );
  assert.throws(
    () => controller.mount({ left, right, proposalAfter: after }),
    /proposal/i,
    "the proposal containers are required as a pair",
  );
  assert.throws(() => controller.mount({ left, right: null }), /HTMLElement/);

  // Mounting with both containers is accepted; the serializable state shape does not change.
  const state = controller.mount({ left, right, proposalBefore: before, proposalAfter: after });
  assert.equal(state.suggestion, null);
  assert.ok(state.selection && state.selection.comparison === "tuning");
  assert.equal(Array.isArray(state.views), true);
  controller.destroy();
});

// ---------------------------------------------------------------------------
// Real browser proof (Chromium already installed; opt-in, no install, no server)
// ---------------------------------------------------------------------------

const REAL_PALETTE = [
  '@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.97 0.005 250); role: canvas; }',
  '@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.24 0.01 250); role: ink; }',
  '@property --palette-brand { syntax: "<color>"; inherits: true; initial-value: oklch(0.56 0.14 255); role: ui; }',
  "",
].join("\n");

// The light text is deliberately pushed below the 4.5 WCAG minimum: the workbench must offer a
// verified lightness suggestion without touching the dark theme.
const REAL_TUNING = [
  ":root {",
  "  --color-tune-text-light: oklch(0.66 0 0);",
  "}",
  "",
].join("\n");

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

async function openChromium(browserType) {
  const executable = browserType.executablePath();
  assert.ok(executable, "Chromium must expose an executable path");
  const browser = await browserType.launch({ headless: true, timeout: 60_000 });
  return browser;
}

function sha256Base64(value) {
  return createHash("sha256").update(value, "utf8").digest("base64");
}

function inertJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function buildFixtureHtml({ title, payload, source, hostColorScheme = null }) {
  const csp = [
    "default-src 'none'",
    "script-src 'sha256-" + sha256Base64(source) + "'",
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
  const hostStyle = hostColorScheme ? "<style>:root { color-scheme: " + hostColorScheme + "; }</style>" : "";
  return [
    "<!doctype html>",
    '<html lang="it"><head><meta charset="utf-8">',
    '<meta http-equiv="Content-Security-Policy" content="' + csp + '">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>" + title + "</title>",
    hostStyle,
    "</head><body>",
    '<main><div id="scw-left"></div><div id="scw-right"></div>',
    '<section id="scw-proposal" aria-label="Confronto proposta"><div id="scw-proposal-before"></div><div id="scw-proposal-after"></div></section></main>',
    '<script type="application/json" id="' + WORKBENCH_PAYLOAD_ID + '">' + inertJson(payload) + "</script>",
    '<script id="scw-runtime">' + source + "</script>",
    "</body></html>",
    "",
  ].join("\n");
}

async function createRealPayload(t, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-workbench-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, "src/styles/tokens/palette.css"), REAL_PALETTE, "utf8");
  await writeFile(path.join(root, "src/styles/tokens/colors.css"), "", "utf8");
  const analysis = await analyzeColorTokens({ root, suggest: false });
  assert.deepEqual(analysis.errors, []);
  const baseline = options.baseline == null ? analysis.css : options.baseline;
  const tuning = options.tuning === undefined ? REAL_TUNING : options.tuning;
  return {
    schemaVersion: 1,
    toolVersion: "0.0.0-test",
    snapshotId: "scw-workbench-native",
    config: { contrast: analysis.config.contrast, roles: analysis.config.roles },
    css: {
      baseline,
      tuning,
      tuningSupport: options.tuningSupport || (tuning == null ? "absent" : "supported"),
      baselineSupport: options.baseline == null && options.baselineSupport !== false ? "supported" : (options.baselineSupport || "supported"),
      source: options.source || "output",
      status: options.status || "current",
      production: true,
      digest: { baseline: sha256Hex(baseline), generated: sha256Hex(analysis.css) },
    },
    design: analysis.design,
    paletteSource: analysis.design.sources,
  };
}

async function loadFixture(context, file) {
  const requests = [];
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(pathToFileURL(file).href, { waitUntil: "load", timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__smartColorsWorkbench), null, { timeout: 20_000 });
  return { page, requests };
}

async function mountAndSettle(page) {
  await page.evaluate(() => {
    const controller = window.__smartColorsWorkbench;
    controller.mount({ left: document.getElementById("scw-left"), right: document.getElementById("scw-right") });
  });
  await page.waitForFunction(() => {
    const controller = window.__smartColorsWorkbench;
    return controller && ["complete", "incomplete", "unavailable"].includes(controller.state().phase);
  }, null, { timeout: 30_000 });
  return page.evaluate(() => window.__smartColorsWorkbench.state());
}

function ratioOf(state, slot) {
  const view = state.views.find((entry) => entry.slot === slot);
  assert.ok(view, "missing view " + slot);
  assert.ok(view.measurement, "missing selected measurement in " + slot);
  return view.measurement.ratio;
}

test("browser proof: visible specimen, real CSS measurement, verified suggestion and safety", { skip: NATIVE_PROOF ? false : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium proof" }, async (t) => {
  if (!NATIVE_PROOF) return;
  const playwright = resolvePlaywright();
  const browser = await openChromium(playwright.chromium);
  t.after(() => browser.close());
  const source = createContrastWorkbenchSource();
  const dir = await mkdtemp(path.join(tmpdir(), "smart-colors-workbench-proof-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const real = await createRealPayload(t);
  const stale = await createRealPayload(t, { status: "stale" });
  const unsupported = await createRealPayload(t, { baseline: '@import url("x.css");\n' + real.css.baseline });
  const empty = await createRealPayload(t, { baseline: "", source: "output", status: "empty" });
  const alpha = await createRealPayload(t, {
    tuning: ":root { --color-surface: rgb(0 0 0 / 50%); }\n",
  });
  const gradient = await createRealPayload(t, {
    tuning: "* { background-image: linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255)); }\n",
  });
  const backdrop = await createRealPayload(t, {
    tuning: "* { backdrop-filter: blur(2px); }\n",
  });
  const ancestor = await createRealPayload(t, {
    tuning: "body { opacity: 0.9; }\n",
  });
  const textFill = await createRealPayload(t, {
    tuning: "* { -webkit-text-fill-color: rgb(255, 0, 0); }\n",
  });
  const noTuning = await createRealPayload(t, { tuning: null });
  const unsupportedTuning = await createRealPayload(t, {
    tuning: '@import url("x.css");\n',
    tuningSupport: "unsupported",
  });

  const files = {
    main: path.join(dir, "main.html"),
    stale: path.join(dir, "stale.html"),
    unsupported: path.join(dir, "unsupported.html"),
    empty: path.join(dir, "empty.html"),
    alpha: path.join(dir, "alpha.html"),
    gradient: path.join(dir, "gradient.html"),
    backdrop: path.join(dir, "backdrop.html"),
    ancestor: path.join(dir, "ancestor.html"),
    textFill: path.join(dir, "text-fill.html"),
    noTuning: path.join(dir, "no-tuning.html"),
    unsupportedTuning: path.join(dir, "unsupported-tuning.html"),
  };
  await writeFile(files.main, buildFixtureHtml({ title: "Workbench main", payload: real, source, hostColorScheme: "light" }), "utf8");
  await writeFile(files.stale, buildFixtureHtml({ title: "Workbench stale", payload: stale, source }), "utf8");
  await writeFile(files.unsupported, buildFixtureHtml({ title: "Workbench unsupported", payload: unsupported, source }), "utf8");
  await writeFile(files.empty, buildFixtureHtml({ title: "Workbench empty", payload: empty, source }), "utf8");
  await writeFile(files.alpha, buildFixtureHtml({ title: "Workbench alpha", payload: alpha, source }), "utf8");
  await writeFile(files.gradient, buildFixtureHtml({ title: "Workbench gradient", payload: gradient, source }), "utf8");
  await writeFile(files.backdrop, buildFixtureHtml({ title: "Workbench backdrop", payload: backdrop, source }), "utf8");
  await writeFile(files.ancestor, buildFixtureHtml({ title: "Workbench ancestor", payload: ancestor, source }), "utf8");
  await writeFile(files.textFill, buildFixtureHtml({ title: "Workbench text fill", payload: textFill, source }), "utf8");
  await writeFile(files.noTuning, buildFixtureHtml({ title: "Workbench no tuning", payload: noTuning, source }), "utf8");
  await writeFile(files.unsupportedTuning, buildFixtureHtml({ title: "Workbench unsupported tuning", payload: unsupportedTuning, source }), "utf8");

  const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });

  // ---- Main fixture: initial tuning view, visible specimen, measurement on the visible node ----
  const main = await loadFixture(context, files.main);
  const meta = await main.page.evaluate(() => {
    const controller = window.__smartColorsWorkbench;
    return {
      marker: controller.marker,
      version: controller.version,
      frameColorScheme: controller.frameColorScheme,
      frameTimeoutMs: controller.frameTimeoutMs,
      phases: controller.phases,
      comparisons: controller.comparisons,
      sides: controller.sides,
      payload: controller.payload(),
      lightPairs: controller.pairs("light").map((pair) => ({ id: pair.id, kind: pair.kind, property: pair.property, minimum: pair.minimum })),
    };
  });
  assert.equal(meta.marker, WORKBENCH_RUNTIME_MARKER);
  assert.equal(meta.version, WORKBENCH_RUNTIME_VERSION);
  assert.equal(meta.frameColorScheme, WORKBENCH_FRAME_COLOR_SCHEME);
  assert.equal(meta.frameTimeoutMs, WORKBENCH_FRAME_TIMEOUT_MS);
  assert.deepEqual(meta.phases, WORKBENCH_PHASES);
  assert.deepEqual(meta.comparisons, WORKBENCH_COMPARISONS);
  assert.deepEqual(meta.sides, WORKBENCH_SIDES);
  assert.ok(meta.payload.css.baseline.length > 0);
  assert.equal(meta.payload.css.source, "output");
  assert.equal(meta.payload.css.status, "current");
  assert.ok(meta.payload.design && meta.payload.design.tokens);
  assert.ok(Array.isArray(meta.payload.paletteSource), "the payload carries the additive paletteSource metadata");
  assert.ok(meta.lightPairs.length > 0);

  const state = await mountAndSettle(main.page);
  assert.equal(state.phase, "complete");
  assert.deepEqual(state.selection, {
    pairId: "light|color|--color-text|--color-bg",
    theme: "light",
    comparison: "tuning",
  });
  assert.equal(state.draft ? Object.keys(state.draft).length : 0, 0);
  assert.equal(state.suggestion, null);
  assert.equal(state.views.length, 2);
  assert.equal(state.views[0].slot, "left");
  assert.equal(state.views[1].slot, "right");
  assert.equal(state.views[0].variant, "baseline");
  assert.equal(state.views[1].variant, "tuned");
  assert.equal(state.views[0].theme, "light");
  assert.equal(state.views[1].theme, "light");
  assert.equal(state.views[0].measurements.length, meta.lightPairs.length);
  assert.equal(state.views[1].measurements.length, meta.lightPairs.length);
  assert.equal(state.views[0].measurement.status, "pass");
  assert.equal(state.views[1].measurement.status, "below-minimum");
  assert.ok(ratioOf(state, "left") >= 4.5);
  assert.ok(ratioOf(state, "right") < 4.5);
  assert.deepEqual(state.provenance.palette, meta.payload.paletteSource, "provenance exposes the real paletteSource, not an invented output");
  assert.ok(!JSON.stringify(state).includes("contentDocument"));

  const frames = await main.page.evaluate(() => Array.from(document.querySelectorAll("iframe")).map((frame) => {
    const frameDocument = frame.contentDocument;
    return {
      slot: frame.getAttribute("data-smart-colors-workbench-slot"),
      variant: frame.getAttribute("data-smart-colors-workbench-variant"),
      theme: frame.getAttribute("data-smart-colors-workbench-theme"),
      sandbox: frame.getAttribute("sandbox"),
      srcdoc: frame.hasAttribute("srcdoc"),
      src: frame.getAttribute("src"),
      carrierColorScheme: frame.style.colorScheme,
      scripts: frameDocument ? frameDocument.querySelectorAll("script").length : -1,
      styles: frameDocument ? Array.from(frameDocument.querySelectorAll("style[data-smart-colors-css]")).map((style) => style.getAttribute("data-smart-colors-css")) : [],
      rootColorScheme: frameDocument ? frameDocument.documentElement.style.colorScheme : null,
      themeAttribute: frameDocument ? frameDocument.documentElement.getAttribute("data-theme") : null,
      reportPreference: frameDocument && frameDocument.defaultView ? frameDocument.defaultView.matchMedia("(prefers-color-scheme: dark)").matches : null,
      specimenTitle: frameDocument && frameDocument.querySelector(".scw-selected-title") ? frameDocument.querySelector(".scw-selected-title").textContent : null,
      specimenText: frameDocument && frameDocument.querySelector(".scw-selected-text") ? frameDocument.querySelector(".scw-selected-text").textContent : null,
      house: frameDocument ? frameDocument.querySelectorAll(".scw-house").length : -1,
      selected: frameDocument ? Boolean(frameDocument.querySelector('[data-smart-colors-specimen="selected"]')) : false,
    };
  }));
  assert.equal(frames.length, 2);
  assert.deepEqual(frames.map((frame) => frame.slot), ["left", "right"]);
  assert.deepEqual(frames.map((frame) => frame.variant), ["baseline", "tuned"]);
  assert.deepEqual(frames.map((frame) => frame.theme), ["light", "light"]);
  for (const frame of frames) {
    assert.equal(frame.sandbox, "allow-same-origin");
    assert.equal(frame.srcdoc, true);
    assert.equal(frame.src, null);
    assert.equal(frame.carrierColorScheme, WORKBENCH_FRAME_COLOR_SCHEME);
    assert.equal(frame.scripts, 0);
    assert.equal(frame.rootColorScheme, "light");
    assert.equal(frame.themeAttribute, "light");
    assert.equal(frame.reportPreference, false);
    assert.equal(frame.specimenTitle, "Un messaggio da leggere", "the sample shows a human title, not a token caption");
    assert.equal(frame.specimenText, "Il colore deve aiutarti a leggere, non mettersi in mezzo.", "the sample shows human copy, not diagnostics");
    assert.equal(frame.house, 0, "the unrelated overview strip is removed");
    assert.equal(frame.selected, true);
    assert.ok(frame.styles.includes("baseline"));
  }
  assert.ok(frames[0].styles.includes("baseline"));
  assert.ok(!frames[0].styles.includes("tuning"));
  assert.ok(frames[1].styles.includes("baseline"));
  assert.ok(frames[1].styles.includes("tuning"));

  // ---- The technical probe host is offscreen, out of the accessibility tree and out of layout,
  // while the selected visible specimen stays painted and every collateral pair stays computed.
  const layout = await main.page.evaluate(() => {
    const frame = document.querySelector('iframe[data-smart-colors-workbench-slot="right"]');
    const doc = frame.contentDocument;
    const view = frame.contentWindow;
    const host = doc.querySelector("[data-smart-colors-probes]");
    const selectedNode = doc.querySelector('[data-smart-colors-specimen="selected"]');
    const hostRect = host ? host.getBoundingClientRect() : null;
    const selectedRect = selectedNode ? selectedNode.getBoundingClientRect() : null;
    return {
      frameHeight: frame.getBoundingClientRect().height,
      bodyScrollHeight: doc.body.scrollHeight,
      rootScrollHeight: doc.documentElement.scrollHeight,
      hostExists: Boolean(host),
      hostPosition: host ? view.getComputedStyle(host).position : null,
      hostDisplay: host ? view.getComputedStyle(host).display : null,
      hostAriaHidden: host ? host.getAttribute("aria-hidden") : null,
      hostInert: host ? host.hasAttribute("inert") : null,
      hostRect: hostRect ? { top: hostRect.top, left: hostRect.left, width: hostRect.width, height: hostRect.height } : null,
      probeCount: host ? host.querySelectorAll("[data-smart-colors-pair]").length : -1,
      selectedInsideHost: host && selectedNode ? host.contains(selectedNode) : null,
      selectedRect: selectedRect ? { width: selectedRect.width, height: selectedRect.height } : null,
    };
  });
  assert.equal(layout.hostExists, true);
  assert.equal(layout.hostPosition, "absolute", "the technical host is out of flow");
  assert.notEqual(layout.hostDisplay, "none", "the host stays rendered so collateral pairs are computed");
  assert.equal(layout.hostAriaHidden, "true");
  assert.equal(layout.hostInert, true);
  assert.ok(layout.hostRect.width <= 2 && layout.hostRect.height <= 2, "the host box does not participate in layout");
  assert.ok(layout.hostRect.left < -1000, "the host is offscreen");
  assert.equal(layout.selectedInsideHost, false, "the selected visible specimen is never inside the technical host");
  assert.ok(layout.selectedRect.width > 0 && layout.selectedRect.height > 0, "the selected specimen stays painted");
  assert.equal(layout.probeCount, meta.lightPairs.length, "collateral probe coverage is unchanged");
  assert.ok(layout.rootScrollHeight < 800, "the frame no longer scrolls through thousands of pixels of probe labels: " + layout.rootScrollHeight);
  assert.ok(layout.bodyScrollHeight < 800, "the body does not grow by the probe flow: " + layout.bodyScrollHeight);

  // ---- The human sample stays inside a 320px-wide frame without horizontal clipping --------
  const narrow = await main.page.evaluate(() => {
    const frame = document.querySelector('iframe[data-smart-colors-workbench-slot="right"]');
    const doc = frame.contentDocument;
    const root = doc.documentElement;
    const body = doc.body;
    const selected = doc.querySelector('[data-smart-colors-specimen="selected"]');
    const title = doc.querySelector(".scw-selected-title");
    const text = doc.querySelector(".scw-selected-text");
    const previous = frame.style.inlineSize;
    frame.style.inlineSize = "320px";
    const selectedRect = selected.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const textRect = text.getBoundingClientRect();
    const out = {
      viewportWidth: frame.getBoundingClientRect().width,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      selectedLeft: selectedRect.left,
      selectedRight: selectedRect.right,
      selectedWidth: selectedRect.width,
      titleHeight: titleRect.height,
      textHeight: textRect.height,
    };
    frame.style.inlineSize = previous;
    return out;
  });
  assert.ok(narrow.viewportWidth >= 319 && narrow.viewportWidth <= 321, "the narrow fixture is 320px wide: " + narrow.viewportWidth);
  assert.ok(narrow.bodyScrollWidth <= narrow.bodyClientWidth, "the sample does not overflow horizontally at 320px");
  assert.ok(narrow.rootScrollWidth <= narrow.rootClientWidth, "the root does not overflow horizontally at 320px");
  assert.ok(narrow.selectedLeft >= 0 && narrow.selectedRight <= narrow.bodyClientWidth, "the selected sample stays inside the 320px frame");
  assert.ok(narrow.selectedWidth > 0 && narrow.titleHeight > 0 && narrow.textHeight > 0, "the human sample stays rendered at 320px");

  // Accessibility: technical probe labels are not exposed; the human sample is.
  const aria = await main.page.locator('iframe[data-smart-colors-workbench-slot="right"]').contentFrame().locator("body").ariaSnapshot();
  assert.ok(!/muted text/.test(aria), "no probe-only label is exposed to assistive tech");
  assert.ok(!/focus \/ canvas/.test(aria), "no probe-only label is exposed to assistive tech");
  assert.ok(!/on-brand/.test(aria), "no probe-only label is exposed to assistive tech");
  assert.ok(/Un messaggio da leggere/.test(aria), "the human sample title remains exposed");
  assert.ok(/Il colore deve aiutarti a leggere, non mettersi in mezzo\./.test(aria), "the human sample copy remains exposed");
  assert.ok(!/proprietà/.test(aria), "no technical property metadata is exposed in the visible sample");

  const visible = await main.page.evaluate(() => {
    const controller = window.__smartColorsWorkbench;
    const state = controller.state();
    const view = state.views.find((entry) => entry.slot === "right");
    const frame = document.querySelector('iframe[data-smart-colors-workbench-slot="right"]');
    const doc = frame.contentDocument;
    const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
    const style = frame.contentWindow.getComputedStyle(node);
    return {
      measurement: view.measurement,
      pair: view.pair,
      inlineStyle: node.getAttribute("style"),
      foregroundAttribute: node.getAttribute("data-smart-colors-foreground"),
      backgroundAttribute: node.getAttribute("data-smart-colors-background"),
      propertyAttribute: node.getAttribute("data-smart-colors-property"),
      color: style.color,
      backgroundColor: style.backgroundColor,
    };
  });
  assert.equal(visible.foregroundAttribute, visible.pair.foreground);
  assert.equal(visible.backgroundAttribute, visible.pair.background);
  assert.equal(visible.propertyAttribute, visible.pair.property);
  assert.match(visible.inlineStyle, /var\(--color-text\)/);
  assert.match(visible.inlineStyle, /var\(--color-bg\)/);
  assert.equal(visible.measurement.foreground, visible.color, "measurement reads the visible node");
  assert.equal(visible.measurement.background, visible.backgroundColor, "measurement reads the visible node");
  assert.ok(visible.measurement.ratio < 4.5);

  // ---- The visible node is also measured for border and outline pairs ----------------
  const pairSpecimens = await main.page.evaluate(async (pairId) => {
    const controller = window.__smartColorsWorkbench;
    const pairs = controller.pairs("light");
    const focus = pairs.find((entry) => entry.property === "outlineColor");
    const border = pairs.find((entry) => entry.property === "borderColor");
    const out = {};
    for (const [name, pair] of [["focus", focus], ["border", border]]) {
      if (!pair) {
        out[name] = null;
        continue;
      }
      await controller.select({ pairId: pair.id, theme: "light", comparison: "tuning" });
      const state = controller.state();
      const view = state.views.find((entry) => entry.slot === "right");
      const frame = document.querySelector('iframe[data-smart-colors-workbench-slot="right"]');
      const doc = frame.contentDocument;
      const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
      const style = frame.contentWindow.getComputedStyle(node);
      out[name] = {
        pairId: pair.id,
        property: pair.property,
        foregroundToken: pair.foreground,
        status: view.measurement.status,
        measurement: view.measurement,
        inlineStyle: node.getAttribute("style"),
        propertyAttribute: node.getAttribute("data-smart-colors-property"),
        computed: pair.property === "outlineColor" ? style.outlineColor : style.borderColor,
        background: style.backgroundColor,
        tag: node.tagName,
      };
    }
    await controller.select({ pairId, theme: "light", comparison: "tuning" });
    return out;
  }, state.selection.pairId);
  assert.ok(pairSpecimens.focus);
  assert.notEqual(pairSpecimens.focus.status, "unmeasured");
  assert.equal(pairSpecimens.focus.measurement.foreground, pairSpecimens.focus.computed);
  assert.equal(pairSpecimens.focus.measurement.background, pairSpecimens.focus.background);
  assert.equal(pairSpecimens.focus.propertyAttribute, "outlineColor");
  assert.equal(pairSpecimens.focus.tag, "BUTTON");
  assert.ok(pairSpecimens.focus.inlineStyle.includes("var(" + pairSpecimens.focus.foregroundToken + ")"));
  assert.ok(pairSpecimens.border);
  assert.notEqual(pairSpecimens.border.status, "unmeasured");
  assert.equal(pairSpecimens.border.measurement.foreground, pairSpecimens.border.computed);
  assert.equal(pairSpecimens.border.measurement.background, pairSpecimens.border.background);
  assert.equal(pairSpecimens.border.propertyAttribute, "borderColor");
  assert.ok(pairSpecimens.border.inlineStyle.includes("var(" + pairSpecimens.border.foregroundToken + ")"));

  // ---- Theme comparison normalizes the same pair across both themes ------------------
  const themes = await main.page.evaluate(async (pairId) => {
    const controller = window.__smartColorsWorkbench;
    await controller.select({ pairId, theme: "light", comparison: "themes" });
    const state = controller.state();
    await controller.select({ pairId, theme: "light", comparison: "tuning" });
    return state;
  }, state.selection.pairId);
  assert.equal(themes.selection.comparison, "themes");
  assert.deepEqual(themes.views.map((entry) => entry.slot), ["left", "right"]);
  assert.deepEqual(themes.views.map((entry) => entry.theme), ["light", "dark"]);
  assert.equal(themes.views[0].pair.theme, "light");
  assert.equal(themes.views[1].pair.theme, "dark");
  assert.equal(themes.views[0].pair.foreground, themes.views[1].pair.foreground);
  assert.equal(themes.views[0].pair.background, themes.views[1].pair.background);
  assert.equal(themes.views[0].pair.property, themes.views[1].pair.property);
  assert.equal(themes.views[1].pair.id.split("|")[0], "dark");

  // ---- Invalid input does not mutate the draft; valid input does, then reset ----
  const invalid = await main.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const before = controller.state();
    await controller.setOverride("--color-tune-text-light", "red; } body {");
    const afterUnknown = controller.state();
    await controller.setOverride("--color-tune-brand-surface-light-mix", "120%");
    const afterMix = controller.state();
    return { before: before.draft, unknownError: afterUnknown.error, mixError: afterMix.error, draft: afterMix.draft };
  });
  assert.match(invalid.unknownError, /invalid value/);
  assert.match(invalid.mixError, /invalid value/);
  assert.deepEqual(invalid.before, {});
  assert.deepEqual(invalid.draft, {});

  // ---- Verified suggestion: no draft contamination, fresh trial over both themes ----
  const suggestion = await main.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.suggest("foreground");
    return { state: controller.state(), iframes: document.querySelectorAll("iframe").length };
  });
  const suggested = suggestion.state.suggestion;
  assert.equal(suggestion.iframes, 2, "trial frames are removed and the visible frames are restored");
  assert.equal(suggested.status, "verified", JSON.stringify(suggested));
  assert.equal(suggested.side, "foreground");
  assert.equal(suggested.token, "--color-text");
  assert.equal(suggested.control, "--color-tune-text-light");
  assert.equal(typeof suggested.value, "string");
  assert.match(suggested.value, /^oklch\(/);
  assert.ok(suggested.before < 4.5);
  assert.ok(suggested.after >= 4.5);
  assert.ok(suggested.authored && typeof suggested.authored === "object", "the suggestion preserves the shared factory's authored colour object");
  assert.ok(Number.isFinite(suggested.authored.l) && Number.isFinite(suggested.authored.c) && Number.isFinite(suggested.authored.h));
  assert.ok(Math.abs(suggested.authored.l - 0.66) < 0.02, "authored is the real tuned source colour, not null");
  assert.ok(suggested.checked >= 2 * meta.lightPairs.length);
  assert.equal(suggested.unmeasured, 0);
  assert.deepEqual(suggested.regressions, []);
  assert.equal(suggested.scope.affectedTheme, "light");
  assert.deepEqual(suggested.scope.measuredThemes, ["light", "dark"]);
  assert.deepEqual(suggested.scope.unchangedThemes, ["dark"], "the unaffected theme is labelled, not claimed as a change");
  assert.match(suggested.reason, /Verified on the embedded CSS bytes/);
  assert.deepEqual(suggestion.state.draft, {}, "a candidate is not a draft before applySuggestion");

  // ---- applySuggestion writes the draft AND shows it, without an explicit select ----
  const applied = await main.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.applySuggestion();
    return controller.state();
  });
  assert.equal(applied.selection.comparison, "draft", "applySuggestion switches the displayed comparison to the draft");
  assert.equal(applied.draft["--color-tune-text-light"], suggested.value);
  assert.equal(applied.suggestion, null);
  assert.equal(applied.phase, "complete");
  const draftView = applied.views.find((entry) => entry.slot === "right");
  const tunedView = applied.views.find((entry) => entry.slot === "left");
  assert.equal(draftView.variant, "draft");
  assert.ok(draftView.measurement.ratio >= 4.5);
  assert.ok(tunedView.measurement.ratio < 4.5);
  assert.equal(draftView.errors.length, 0);
  const exported = await main.page.evaluate(() => window.__smartColorsWorkbench.exportTuning());
  assert.match(exported, /^:root \{\n/);
  assert.ok(exported.includes("--color-tune-text-light: " + suggested.value + ";"));
  assert.ok(!exported.includes("@layer"));

  // ---- Full override outranks the mix knob in the real CSS ----
  const overrideTest = await main.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const pair = controller.pairs("dark").find((entry) => entry.kind === "on-color" && entry.label === "dark on-brand / brand");
    if (!pair) return { missing: true };
    await controller.reset();
    await controller.setOverride("--color-tune-brand-dark-mix", "0%");
    await controller.setOverride("--color-tune-brand-dark", "oklch(0.7 0 0)");
    await controller.select({ pairId: pair.id, theme: "dark", comparison: "draft" });
    return { missing: false, state: controller.state(), pairId: pair.id };
  });
  assert.equal(overrideTest.missing, false);
  const overrideView = overrideTest.state.views.find((entry) => entry.slot === "right");
  const backgroundColor = core.parseComputedColor(overrideView.measurement.background, "override background");
  assert.ok(Math.abs(backgroundColor.l - 0.7) < 0.01, "the full override wins over the mix knob");
  assert.ok(backgroundColor.c < 0.001);

  // ---- Cancellation: a newer mutation discards the older run and its frames ----
  const cancellation = await main.page.evaluate(async (pairId) => {
    const controller = window.__smartColorsWorkbench;
    await controller.reset();
    const first = controller.select({ pairId, theme: "light", comparison: "draft" });
    const second = controller.setOverride("--color-tune-text-light", "oklch(0.4 0 0)");
    await Promise.all([first, second]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { state: controller.state(), iframes: document.querySelectorAll("iframe").length };
  }, state.selection.pairId);
  assert.equal(cancellation.state.selection.pairId, state.selection.pairId);
  assert.equal(cancellation.state.draft["--color-tune-text-light"], "oklch(0.4 0 0)");
  assert.equal(cancellation.state.views.length, 2);
  assert.equal(cancellation.state.views[1].variant, "draft");
  assert.ok(cancellation.state.views[1].measurement.ratio >= 4.5);
  assert.equal(cancellation.iframes, 2, "only the current run's frames remain");

  // ---- Regression: an immediate override shows the draft and the right frame changes ----
  const immediateFixture = await loadFixture(context, files.main);
  const immediateInitial = await mountAndSettle(immediateFixture.page);
  assert.equal(immediateInitial.selection.comparison, "tuning");
  assert.equal(immediateInitial.views[1].variant, "tuned");
  const immediateTunedRatio = immediateInitial.views[1].measurement.ratio;
  assert.ok(immediateTunedRatio < 4.5);
  const immediate = await immediateFixture.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.setOverride("--color-tune-text-light", "oklch(0.4 0 0)");
    const state = controller.state();
    const frame = document.querySelector('iframe[data-smart-colors-workbench-slot="right"]');
    const doc = frame.contentDocument;
    const draftStyle = doc.querySelector('style[data-smart-colors-css="draft"]');
    const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
    const style = frame.contentWindow.getComputedStyle(node);
    return {
      state,
      draftCss: draftStyle ? draftStyle.textContent : null,
      color: style.color,
      frames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="visible"]').length,
      trialFrames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="trial"]').length,
    };
  });
  assert.equal(immediate.state.selection.comparison, "draft", "the edit switches the displayed comparison to the draft");
  assert.equal(immediate.state.views[0].variant, "tuned");
  assert.equal(immediate.state.views[1].variant, "draft");
  assert.ok(immediate.draftCss.includes("--color-tune-text-light: oklch(0.4 0 0);"));
  assert.ok(immediate.state.views[1].measurement.ratio > immediateTunedRatio + 0.1, "the right frame changed without an explicit select");
  const immediateColor = core.parseComputedColor(immediate.color, "immediate override");
  assert.ok(Math.abs(immediateColor.l - 0.4) < 0.02);
  assert.ok(Math.abs(immediateColor.c) < 0.001);
  assert.equal(immediate.frames, 2);
  assert.equal(immediate.trialFrames, 0);
  await immediateFixture.page.close();

  // ---- Regression: an existing different-side draft is part of suggest and apply ----
  const draftBaseFixture = await loadFixture(context, files.main);
  const draftBaseInitial = await mountAndSettle(draftBaseFixture.page);
  const draftBasePairId = draftBaseInitial.selection.pairId;
  const draftBaseRatio = await draftBaseFixture.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.setOverride("--color-tune-bg-light", "oklch(0.8 0 0)");
    const state = controller.state();
    const right = state.views.find((view) => view.slot === "right");
    return { comparison: state.selection.comparison, variant: right.variant, ratio: right.measurement.ratio, draft: state.draft };
  });
  assert.equal(draftBaseRatio.comparison, "draft");
  assert.equal(draftBaseRatio.variant, "draft");
  assert.ok(draftBaseRatio.ratio < 4.5, "the different-side draft keeps the pair below minimum");
  const savedOnlyRatio = await draftBaseFixture.page.evaluate(async (pairId) => {
    const controller = window.__smartColorsWorkbench;
    await controller.select({ pairId, theme: "light", comparison: "tuning" });
    const state = controller.state();
    const right = state.views.find((view) => view.slot === "right");
    return { comparison: state.selection.comparison, ratio: right.measurement.ratio };
  }, draftBasePairId);
  assert.equal(savedOnlyRatio.comparison, "tuning");
  assert.ok(Math.abs(savedOnlyRatio.ratio - draftBaseRatio.ratio) > 0.1, "the hidden draft measurably changes the base");
  const draftSuggested = await draftBaseFixture.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.suggest("foreground");
    const state = controller.state();
    return { comparison: state.selection.comparison, suggestion: state.suggestion, draft: state.draft };
  });
  assert.equal(draftSuggested.comparison, "draft", "suggest transparently switches to the draft comparison");
  assert.equal(draftSuggested.suggestion.status, "verified", JSON.stringify(draftSuggested.suggestion));
  assert.equal(draftSuggested.suggestion.scope.affectedTheme, "light");
  assert.deepEqual(draftSuggested.suggestion.scope.unchangedThemes, ["dark"]);
  assert.ok(Math.abs(draftSuggested.suggestion.before - draftBaseRatio.ratio) < 1e-3, "the verified before is the real draft measurement");
  assert.ok(Math.abs(draftSuggested.suggestion.before - savedOnlyRatio.ratio) > 0.1, "the verified before is not the saved-only measurement");
  assert.ok(draftSuggested.suggestion.after >= 4.5);
  const draftApplied = await draftBaseFixture.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.applySuggestion();
    const state = controller.state();
    const right = state.views.find((view) => view.slot === "right");
    const frame = document.querySelector('iframe[data-smart-colors-workbench-slot="right"]');
    const draftStyle = frame.contentDocument.querySelector('style[data-smart-colors-css="draft"]');
    return { comparison: state.selection.comparison, variant: right.variant, ratio: right.measurement.ratio, draft: state.draft, draftCss: draftStyle ? draftStyle.textContent : null };
  });
  assert.equal(draftApplied.comparison, "draft");
  assert.equal(draftApplied.variant, "draft");
  assert.ok(Math.abs(draftApplied.ratio - draftSuggested.suggestion.after) < 1e-3, "the applied draft measures the verified after");
  assert.ok(draftApplied.ratio >= 4.5);
  assert.equal(draftApplied.draft["--color-tune-bg-light"], "oklch(0.8 0 0)");
  assert.equal(draftApplied.draft["--color-tune-text-light"], draftSuggested.suggestion.value);
  assert.ok(draftApplied.draftCss.includes("--color-tune-bg-light: oklch(0.8 0 0);"));
  assert.ok(draftApplied.draftCss.includes("--color-tune-text-light: " + draftSuggested.suggestion.value + ";"));
  await draftBaseFixture.page.close();

  // ---- Regression: a mutation during suggest leaves no stale verified proposal ----
  const suggestCancelFixture = await loadFixture(context, files.main);
  const suggestCancelInitial = await mountAndSettle(suggestCancelFixture.page);
  assert.ok(suggestCancelInitial.views[1].measurement.ratio < 4.5);
  const suggestCancelled = await suggestCancelFixture.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const suggestPromise = controller.suggest("foreground");
    const overridePromise = controller.setOverride("--color-tune-text-light", "oklch(0.45 0 0)");
    await Promise.all([suggestPromise, overridePromise]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      state: controller.state(),
      trialFrames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="trial"]').length,
      visibleFrames: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="visible"]').length,
    };
  });
  assert.equal(suggestCancelled.state.suggestion, null, "the mutation cancels the in-flight suggestion; no stale verified");
  assert.equal(suggestCancelled.state.selection.comparison, "draft");
  assert.equal(suggestCancelled.state.draft["--color-tune-text-light"], "oklch(0.45 0 0)");
  const suggestCancelView = suggestCancelled.state.views.find((view) => view.slot === "right");
  assert.equal(suggestCancelView.variant, "draft");
  const suggestCancelColor = core.parseComputedColor(suggestCancelView.measurement.foreground, "cancelled suggestion");
  assert.ok(Math.abs(suggestCancelColor.l - 0.45) < 0.02, "the displayed measurement is the applied override, not a stale proposal");
  assert.equal(suggestCancelled.trialFrames, 0);
  assert.equal(suggestCancelled.visibleFrames, 2);
  await suggestCancelFixture.page.close();

  // ---- Preference change invalidates and reruns under the actual OS preference ----
  const beforePreference = await main.page.evaluate(() => window.__smartColorsWorkbench.state());
  await main.page.emulateMedia({ colorScheme: "dark" });
  await main.page.waitForFunction((previousRevision) => {
    const controller = window.__smartColorsWorkbench;
    if (!controller) return false;
    const state = controller.state();
    return state.preference.active === "dark"
      && state.revision > previousRevision
      && ["complete", "incomplete", "unavailable"].includes(state.phase);
  }, beforePreference.revision, { timeout: 30_000 });
  const afterPreference = await main.page.evaluate(() => window.__smartColorsWorkbench.state());
  assert.ok(afterPreference.revision > beforePreference.revision);
  assert.equal(afterPreference.preference.active, "dark");
  assert.equal(afterPreference.provenance.preference.active, "dark");
  assert.equal(afterPreference.suggestion, null);
  const prefFrames = await main.page.evaluate(() => Array.from(document.querySelectorAll("iframe")).map((frame) => ({
    carrier: frame.style.colorScheme,
    childPreference: frame.contentDocument.defaultView.matchMedia("(prefers-color-scheme: dark)").matches,
    rootColorScheme: frame.contentDocument.documentElement.style.colorScheme,
    themeAttribute: frame.contentDocument.documentElement.getAttribute("data-theme"),
  })));
  for (const frame of prefFrames) {
    assert.equal(frame.carrier, WORKBENCH_FRAME_COLOR_SCHEME);
    assert.equal(frame.childPreference, true, "the carrier keeps the child on the actual OS preference");
    assert.equal(frame.rootColorScheme, frame.themeAttribute);
  }
  assert.ok(main.requests.every((url) => !/^https?:/i.test(url)), "the runtime makes no network requests");

  // ---- Stale source: provenance is reported, never invented ----
  const staleFixture = await loadFixture(context, files.stale);
  const staleState = await mountAndSettle(staleFixture.page);
  assert.equal(staleState.phase, "complete");
  assert.equal(staleState.provenance.status, "stale");
  assert.ok(staleState.notes.some((note) => /stale/.test(note)));
  const staleSuggestion = await staleFixture.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.suggest("foreground");
    return controller.state().suggestion;
  });
  assert.equal(staleSuggestion.status, "verified");
  assert.match(staleSuggestion.reason, /status: stale/);
  assert.ok(!/status: current/.test(staleSuggestion.reason));

  // ---- Unsupported resources: no frame, no pass ----
  const unsupportedFixture = await loadFixture(context, files.unsupported);
  const unsupportedState = await mountAndSettle(unsupportedFixture.page);
  assert.equal(unsupportedState.phase, "unavailable");
  assert.equal(unsupportedState.views.length, 2);
  assert.ok(unsupportedState.views.every((view) => view.measurements.length === 0));
  assert.ok(unsupportedState.views.every((view) => view.errors.some((error) => error.cause === "unsupported-resource")));
  const unsupportedFrames = await unsupportedFixture.page.evaluate(() => document.querySelectorAll("iframe").length);
  assert.equal(unsupportedFrames, 0);

  // ---- Empty output: never model fallback ----
  const emptyFixture = await loadFixture(context, files.empty);
  const emptyState = await mountAndSettle(emptyFixture.page);
  assert.equal(emptyState.phase, "unavailable");
  assert.match(emptyState.error, /never substituted/);
  const emptyPayload = await emptyFixture.page.evaluate(() => window.__smartColorsWorkbench.payload());
  assert.equal(emptyPayload.css.baseline, "");
  assert.equal(await emptyFixture.page.evaluate(() => document.querySelectorAll("iframe").length), 0);

  // ---- Alpha, gradient and backdrop are unmeasured, never a pass ----
  const alphaFixture = await loadFixture(context, files.alpha);
  const alphaState = await mountAndSettle(alphaFixture.page);
  assert.ok(["incomplete", "unavailable"].includes(alphaState.phase));
  const alphaView = alphaState.views.find((view) => view.slot === "right");
  const surfacePairId = meta.lightPairs.find((pair) => pair.id === "light|color|--color-text|--color-surface").id;
  const alphaMeasurement = alphaView.measurements.find((entry) => entry.pairId === surfacePairId);
  assert.equal(alphaMeasurement.status, "unmeasured");
  assert.match(alphaMeasurement.error, /translucent|outside this verification's scope/);

  const gradientFixture = await loadFixture(context, files.gradient);
  const gradientState = await mountAndSettle(gradientFixture.page);
  assert.ok(["incomplete", "unavailable"].includes(gradientState.phase));
  const gradientView = gradientState.views.find((view) => view.slot === "right");
  assert.equal(gradientView.measurement.status, "unmeasured");
  assert.match(gradientView.measurement.error, /background-image|opaque scope/);

  const backdropFixture = await loadFixture(context, files.backdrop);
  const backdropState = await mountAndSettle(backdropFixture.page);
  assert.ok(["incomplete", "unavailable"].includes(backdropState.phase));
  const backdropView = backdropState.views.find((view) => view.slot === "right");
  assert.equal(backdropView.measurement.status, "unmeasured");
  assert.match(backdropView.measurement.error, /backdrop-filter|opaque scope/);

  // ---- Ancestor compositing is unknown, never a pass ----------------
  const ancestorFixture = await loadFixture(context, files.ancestor);
  const ancestorState = await mountAndSettle(ancestorFixture.page);
  assert.ok(["incomplete", "unavailable"].includes(ancestorState.phase));
  const ancestorView = ancestorState.views.find((view) => view.slot === "right");
  assert.equal(ancestorView.measurement.status, "unmeasured");
  assert.match(ancestorView.measurement.error, /ancestor|opacity/);

  // ---- Gradient text fill is unmeasured, never a pass ----------------
  const textFillFixture = await loadFixture(context, files.textFill);
  const textFillState = await mountAndSettle(textFillFixture.page);
  assert.ok(["incomplete", "unavailable"].includes(textFillState.phase));
  const textFillView = textFillState.views.find((view) => view.slot === "right");
  assert.equal(textFillView.measurement.status, "unmeasured");
  assert.match(textFillView.measurement.error, /text-fill-color/);

  // ---- Missing and unsupported saved tuning fall back to the baseline ----------------
  const noTuningFixture = await loadFixture(context, files.noTuning);
  const noTuningState = await mountAndSettle(noTuningFixture.page);
  assert.equal(noTuningState.phase, "complete");
  assert.deepEqual(noTuningState.views.map((view) => view.variant), ["baseline", "baseline"]);
  assert.equal(noTuningState.provenance.support.tuning, "absent");
  assert.ok(noTuningState.notes.some((note) => /No saved tuning/.test(note)));

  const unsupportedTuningFixture = await loadFixture(context, files.unsupportedTuning);
  const unsupportedTuningState = await mountAndSettle(unsupportedTuningFixture.page);
  assert.equal(unsupportedTuningState.phase, "complete");
  assert.deepEqual(unsupportedTuningState.views.map((view) => view.variant), ["baseline", "baseline"]);
  assert.equal(unsupportedTuningState.provenance.support.tuning, "unsupported");
  assert.ok(unsupportedTuningState.notes.some((note) => /unsupported resources/.test(note)));
  const unsupportedTuningStyles = await unsupportedTuningFixture.page.evaluate(() => Array.from(document.querySelectorAll("iframe")).flatMap((frame) => Array.from(frame.contentDocument.querySelectorAll("style[data-smart-colors-css]")).map((style) => style.getAttribute("data-smart-colors-css"))));
  assert.ok(!unsupportedTuningStyles.includes("tuning"), "unsupported tuning bytes are not injected");

  await Promise.all([main.page.close(), staleFixture.page.close(), unsupportedFixture.page.close(), emptyFixture.page.close(), alphaFixture.page.close(), gradientFixture.page.close(), backdropFixture.page.close(), ancestorFixture.page.close(), textFillFixture.page.close(), noTuningFixture.page.close(), unsupportedTuningFixture.page.close()]);
  await context.close();
});

// ---------------------------------------------------------------------------
// Proposal preview: the base/candidate comparison is a real, visible `var()` specimen rendered into
// two separate frames. It never writes the draft or the export, is measured at the trial viewport,
// and is invalidated by every mutation, preference change and destroy.
// ---------------------------------------------------------------------------
test("browser proof: the proposal preview shows base and candidate without writing the draft", { skip: NATIVE_PROOF ? false : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium proof" }, async (t) => {
  if (!NATIVE_PROOF) return;
  const playwright = resolvePlaywright();
  const browser = await openChromium(playwright.chromium);
  t.after(() => browser.close());
  const source = createContrastWorkbenchSource();
  const dir = await mkdtemp(path.join(tmpdir(), "smart-colors-workbench-proposal-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const real = await createRealPayload(t);
  const file = path.join(dir, "proposal.html");
  await writeFile(file, buildFixtureHtml({ title: "Workbench proposal", payload: real, source, hostColorScheme: "light" }), "utf8");
  const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
  const loaded = await loadFixture(context, file);

  await loaded.page.evaluate(() => {
    window.__smartColorsWorkbench.mount({
      left: document.getElementById("scw-left"),
      right: document.getElementById("scw-right"),
      proposalBefore: document.getElementById("scw-proposal-before"),
      proposalAfter: document.getElementById("scw-proposal-after"),
    });
  });
  await loaded.page.waitForFunction(() => {
    const controller = window.__smartColorsWorkbench;
    return controller && ["complete", "incomplete", "unavailable"].includes(controller.state().phase);
  }, null, { timeout: 30_000 });
  const initial = await loaded.page.evaluate(() => ({
    state: window.__smartColorsWorkbench.state(),
    proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
    all: document.querySelectorAll("iframe").length,
  }));
  assert.equal(initial.state.views[1].measurement.status, "below-minimum");
  assert.equal(initial.proposal, 0, "no proposal frame exists before a verified suggestion");
  assert.equal(initial.all, 2, "optional proposal containers do not add frames on their own");

  // ---- Verified suggestion: two visible proposal frames appear, nothing is written.
  const suggested = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.suggest("foreground");
    const frames = Array.from(document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]'));
    const read = (frame) => {
      const doc = frame.contentDocument;
      const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
      const style = frame.contentWindow.getComputedStyle(node);
      const draftTrial = doc.querySelector('style[data-smart-colors-css="draft-trial"]');
      const rect = frame.getBoundingClientRect();
      return {
        inlineStyle: node.getAttribute("style"),
        color: style.color,
        backgroundColor: style.backgroundColor,
        scripts: doc.querySelectorAll("script").length,
        sandbox: frame.getAttribute("sandbox"),
        srcdoc: frame.hasAttribute("srcdoc"),
        src: frame.getAttribute("src"),
        carrierColorScheme: frame.style.colorScheme,
        styleKinds: Array.from(doc.querySelectorAll("style[data-smart-colors-css]")).map((entry) => entry.getAttribute("data-smart-colors-css")),
        draftTrialCss: draftTrial ? draftTrial.textContent : null,
        width: rect.width,
        height: rect.height,
      };
    };
    return {
      state: controller.state(),
      before: frames[0] ? read(frames[0]) : null,
      after: frames[1] ? read(frames[1]) : null,
      proposal: frames.length,
      visible: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="visible"]').length,
      trial: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="trial"]').length,
      all: document.querySelectorAll("iframe").length,
      exportNow: controller.exportTuning(),
    };
  });
  const preview = suggested.state.suggestion;
  assert.equal(preview.status, "verified", JSON.stringify(preview));
  assert.equal(suggested.proposal, 2, "a verified suggestion renders exactly two proposal frames");
  assert.equal(suggested.visible, 2, "the comparison frames are restored");
  assert.equal(suggested.trial, 0, "no trial frame leaks");
  assert.equal(suggested.all, 4, "two comparison + two proposal frames, nothing else");
  assert.deepEqual(suggested.state.draft, {}, "the proposal preview never writes the draft");
  assert.equal(suggested.exportNow, "", "the proposal preview never exports a draft");
  assert.equal(preview.preview.status, "shown");
  assert.equal(preview.preview.theme, "light");
  assert.equal(preview.preview.labels.before, "Base corrente");
  assert.equal(preview.preview.labels.after, "Candidato");

  for (const frame of [suggested.before, suggested.after]) {
    assert.equal(frame.sandbox, "allow-same-origin");
    assert.equal(frame.srcdoc, true);
    assert.equal(frame.src, null);
    assert.equal(frame.carrierColorScheme, WORKBENCH_FRAME_COLOR_SCHEME);
    assert.equal(frame.scripts, 0, "proposal frames run no scripts");
    assert.match(frame.inlineStyle, /var\(--color-text\)/, "the specimen reads the public token, never a resolved RGB chip");
    assert.match(frame.inlineStyle, /var\(--color-bg\)/);
    assert.equal(Math.round(frame.width), 360, "the visible proposal uses the trial viewport width");
    assert.equal(Math.round(frame.height), 480, "the visible proposal uses the trial viewport height");
    assert.ok(frame.styleKinds.includes("baseline"));
    assert.ok(frame.styleKinds.includes("tuning"));
  }
  assert.ok(!suggested.before.styleKinds.includes("draft-trial"), "the base frame carries no candidate bytes");
  assert.ok(suggested.after.styleKinds.includes("draft-trial"), "the candidate frame carries the trial bytes");
  assert.ok(suggested.after.draftTrialCss.includes("--color-tune-text-light: " + preview.value + ";"));

  // The displayed nodes are re-measured in Node and must reproduce the verified ratios exactly.
  const beforeRatio = core.contrast(core.parseComputedColor(suggested.before.color, "proposal before fg"), core.parseComputedColor(suggested.before.backgroundColor, "proposal before bg"));
  const afterRatio = core.contrast(core.parseComputedColor(suggested.after.color, "proposal after fg"), core.parseComputedColor(suggested.after.backgroundColor, "proposal after bg"));
  assert.ok(Math.abs(beforeRatio - preview.before) < 1e-3, "the visible base reproduces the verified before: " + beforeRatio + " vs " + preview.before);
  assert.ok(Math.abs(afterRatio - preview.after) < 1e-3, "the visible candidate reproduces the verified after: " + afterRatio + " vs " + preview.after);
  assert.ok(beforeRatio < 4.5, "the visible base is still below the minimum");
  assert.ok(afterRatio >= 4.5, "the visible candidate reaches the minimum");
  assert.ok(afterRatio > beforeRatio + 0.1, "the candidate is visibly different from the base");
  assert.notEqual(suggested.before.color, suggested.after.color, "the proposed color is actually displayed");

  // ---- Any mutation removes the proposal frames and the suggestion.
  const mutated = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.setOverride("--color-tune-text-light", "oklch(0.4 0 0)");
    return {
      proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
      suggestion: controller.state().suggestion,
    };
  });
  assert.equal(mutated.proposal, 0, "a mutation removes the proposal frames");
  assert.equal(mutated.suggestion, null);

  // ---- The preview base is the real current draft, not a saved-only view.
  const draftBase = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.reset();
    await controller.setOverride("--color-tune-bg-light", "oklch(0.8 0 0)");
    await controller.suggest("foreground");
    const state = controller.state();
    const frames = Array.from(document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]'));
    const read = (frame) => {
      const node = frame.contentDocument.querySelector('[data-smart-colors-specimen="selected"]');
      const style = frame.contentWindow.getComputedStyle(node);
      return { color: style.color, backgroundColor: style.backgroundColor };
    };
    return {
      status: state.suggestion ? state.suggestion.status : null,
      suggestion: state.suggestion,
      draft: state.draft,
      before: frames[0] ? read(frames[0]) : null,
      after: frames[1] ? read(frames[1]) : null,
      proposal: frames.length,
    };
  });
  assert.equal(draftBase.status, "verified", JSON.stringify(draftBase.suggestion));
  assert.equal(draftBase.proposal, 2);
  assert.equal(draftBase.draft["--color-tune-bg-light"], "oklch(0.8 0 0)");
  assert.ok(!Object.prototype.hasOwnProperty.call(draftBase.draft, "--color-tune-text-light"), "the verified candidate is still not a draft");
  const draftBaseBg = core.parseComputedColor(draftBase.before.backgroundColor, "draft-base bg");
  assert.ok(Math.abs(draftBaseBg.l - 0.8) < 0.01, "the base preview shows the real draft background, not the saved one");
  const draftBaseBeforeRatio = core.contrast(core.parseComputedColor(draftBase.before.color, "draft-base fg"), core.parseComputedColor(draftBase.before.backgroundColor, "draft-base bg"));
  assert.ok(Math.abs(draftBaseBeforeRatio - draftBase.suggestion.before) < 1e-3, "the verified before is the draft measurement, not the saved-only one");
  assert.ok(Math.abs(draftBaseBeforeRatio - draftBase.suggestion.after) > 0.1, "the candidate visibly differs from the draft base");

  // ---- Apply is the only thing that writes the draft; it also clears the preview.
  const applied = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.reset();
    await controller.suggest("foreground");
    const beforeApply = {
      draft: Object.assign({}, controller.state().draft),
      exportNow: controller.exportTuning(),
      proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
      suggestion: controller.state().suggestion,
    };
    await controller.applySuggestion();
    return {
      beforeApply,
      afterApply: {
        draft: controller.state().draft,
        comparison: controller.state().selection.comparison,
        exportNow: controller.exportTuning(),
        proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
      },
    };
  });
  assert.equal(applied.beforeApply.proposal, 2, "a fresh verified suggestion shows the preview again");
  assert.equal(applied.beforeApply.suggestion.status, "verified");
  assert.deepEqual(applied.beforeApply.draft, {}, "still no draft before applySuggestion");
  assert.equal(applied.beforeApply.exportNow, "", "still no export before applySuggestion");
  assert.equal(applied.afterApply.comparison, "draft");
  assert.equal(applied.afterApply.draft["--color-tune-text-light"], applied.beforeApply.suggestion.value);
  assert.ok(applied.afterApply.exportNow.includes("--color-tune-text-light: " + applied.beforeApply.suggestion.value + ";"));
  assert.equal(applied.afterApply.proposal, 0, "applySuggestion invalidates the proposal frames");

  // ---- A preference change clears a shown preview and cannot resurrect a stale one.
  const beforePreference = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.reset();
    await controller.suggest("foreground");
    const state = controller.state();
    return {
      revision: state.revision,
      proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
      status: state.suggestion ? state.suggestion.status : null,
    };
  });
  assert.equal(beforePreference.proposal, 2);
  assert.equal(beforePreference.status, "verified");
  await loaded.page.emulateMedia({ colorScheme: "dark" });
  await loaded.page.waitForFunction((previousRevision) => {
    const controller = window.__smartColorsWorkbench;
    const state = controller.state();
    return state.revision > previousRevision && ["complete", "incomplete", "unavailable"].includes(state.phase);
  }, beforePreference.revision, { timeout: 30_000 });
  const afterPreference = await loaded.page.evaluate(() => ({
    proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
    suggestion: window.__smartColorsWorkbench.state().suggestion,
  }));
  assert.equal(afterPreference.proposal, 0, "a preference change clears the proposal preview");
  assert.equal(afterPreference.suggestion, null);

  // ---- A superseded search never leaves proposal frames behind.
  const race = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.reset();
    await controller.suggest("foreground");
    const pending = controller.suggest("foreground");
    const mutate = controller.setOverride("--color-tune-text-light", "oklch(0.45 0 0)");
    await Promise.all([pending, mutate]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
      trial: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="trial"]').length,
      suggestion: controller.state().suggestion,
    };
  });
  assert.equal(race.proposal, 0, "a superseded search leaves no proposal frame");
  assert.equal(race.trial, 0, "a superseded search leaves no trial frame");
  assert.equal(race.suggestion, null);

  // ---- A pair that already passes yields no candidate and therefore no positive preview.
  const noCandidate = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.reset();
    await controller.setOverride("--color-tune-text-light", "oklch(0.2 0 0)");
    await controller.suggest("foreground");
    return {
      status: controller.state().suggestion ? controller.state().suggestion.status : null,
      proposal: document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length,
    };
  });
  assert.equal(noCandidate.status, "none", "a passing pair yields no candidate");
  assert.equal(noCandidate.proposal, 0, "no positive preview is rendered without a candidate");

  // ---- destroy() removes the proposal frames with everything else.
  const destroyed = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    await controller.reset();
    await controller.suggest("foreground");
    const shown = document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]').length;
    controller.destroy();
    return { shown, all: document.querySelectorAll("iframe").length };
  });
  assert.equal(destroyed.shown, 2, "the preview is shown before destroy");
  assert.equal(destroyed.all, 0, "destroy removes the proposal frames too");

  await loaded.page.close();
  await context.close();
});
