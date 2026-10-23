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
 *
 * A third opt-in Chromium regression uses a synthetic white canvas / black surface / #9a9a9a
 * ring to prove that border and outline samples paint the measured background around the whole
 * ring (7.462:1), in both themes and in the 360x480 proposal preview, without unmeasured copy.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
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

// Authored multi-root tuning is a package fixture, never a file from the reference site.
const MULTI_ROOT_TUNING = [
  "/* 1. MACRO THEME TUNING",
  "   --color-tune-dark-warmth",
  "     Quanto calore conservare nel tema scuro. */",
  ":root {",
  "  --color-tune-dark-warmth: 75%;",
  "  /* A second public control and its explanation must survive a focused patch. */",
  "  --color-tune-text-light: oklch(0.4 0.01 250);",
  "}",
  "",
  "/* 3. ELEVATION TUNING */",
  ":root {",
  "  --elevation-filter-1: brightness(1.04);",
  "  --elevation-filter-surface: var(--elevation-filter-1);",
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
  assert.ok(source.includes("discardSuggestion"), "the additive discard API is embedded in the emitted runtime");
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

test("a payload failure survives a public action that does not measure", async () => {
  const { controller } = makeWorkbench(syntheticPayload({ css: { baseline: "", status: "empty" } }));
  assert.equal(controller.state().phase, "unavailable");

  // `select` is a legal call before `mount`; it must not turn the declared payload failure into a
  // neutral "idle" state with no error, or the host loses the only diagnosis it has.
  const selected = await controller.select({ theme: "dark" });
  assert.equal(selected.phase, "unavailable");
  assert.match(selected.error, /never substituted/);
  const reset = await controller.reset();
  assert.equal(reset.phase, "unavailable");
  assert.match(reset.error, /never substituted/);
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

test("setLightness validates the additive full-colour surface and fails closed without a measured frame", async () => {
  const { controller } = makeWorkbench(syntheticPayload());

  await controller.setLightness("--color-tune-evil", 0.5);
  assert.match(controller.state().error, /unknown tuning control/);
  await controller.setLightness("--color-tune-light-warmth", 0.5);
  assert.match(controller.state().error, /per-token full colour control|full color control/);
  await controller.setLightness("--color-tune-brand-surface-light-mix", 0.5);
  assert.match(controller.state().error, /per-token full colour control|full color control/);
  for (const value of ["0.5", -0.01, 1.01, Number.NaN]) {
    await controller.setLightness("--color-tune-text-light", value);
    assert.match(controller.state().error, /between 0 and 1/, "rejects " + String(value));
  }
  assert.deepEqual(controller.state().draft, {});

  await controller.setLightness("--color-tune-text-light", 0.5);
  assert.match(controller.state().error, /mounted measured frame/);
  assert.deepEqual(controller.state().draft, {}, "a missing frame never writes a colour");
});

test("removeOverride uses a live tombstone, keeps reset() as draft discard, and removes it from the legacy export", async () => {
  const { controller } = makeWorkbench(syntheticPayload());

  await controller.removeOverride("--color-tune-evil");
  assert.match(controller.state().error, /unknown tuning control/);

  // No saved declaration and no draft edit: nothing to remove, no tombstone is invented.
  const noop = await controller.removeOverride("--color-tune-text-light");
  assert.deepEqual(noop.removed, []);
  assert.deepEqual(noop.draft, {});

  await controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)");
  const removed = await controller.removeOverride("--color-tune-text-light");
  assert.equal(removed.draft["--color-tune-text-light"], "initial");
  assert.deepEqual(removed.removed, ["--color-tune-text-light"]);
  assert.match(removed.error, /no measured light draft frame/, "the fake DOM must fail closed instead of claiming success");
  assert.equal(controller.exportTuning(), "", "the legacy export never writes initial");

  const resetState = await controller.reset("--color-tune-text-light");
  assert.deepEqual(resetState.draft, {});
  assert.deepEqual(resetState.removed, []);
  assert.equal(resetState.error, null);
});

test("removeOverride measures the tombstone in a draft comparison instead of an unverified removal", async () => {
  const saved = ":root {\n  --color-tune-text-light: oklch(0.66 0 0);\n}\n";
  const { controller } = makeWorkbench(syntheticPayload({ css: { tuning: saved, tuningSupport: "supported" } }));
  assert.equal(controller.state().selection.comparison, "tuning");

  const removed = await controller.removeOverride("--color-tune-text-light");
  assert.equal(removed.draft["--color-tune-text-light"], "initial");
  assert.equal(removed.selection.comparison, "draft", "the tombstone is displayed in the draft frame that verifies it");
  assert.match(removed.error, /no measured light draft frame/, "an unmeasured tombstone is still declared, never reported as verified");
  assert.ok(!controller.exportTuningFile().css.includes("--color-tune-text-light"), "the removed declaration is no longer active in the export");
});

test("a new suggestion attempt never carries the previous action error", async () => {
  const { controller } = makeWorkbench(syntheticPayload());
  await controller.select({ theme: "sepia" });
  assert.match(controller.state().error, /theme/);

  const state = await controller.suggest("foreground");
  assert.equal(state.error, null, "the suggestion publishes its own outcome, not a stale action error");
  assert.equal(state.suggestion.status, "unavailable");
  assert.match(state.suggestion.reason, /no measured view/);
});

test("exportTuningFile preserves the saved source and patches only whitelisted declarations", async () => {
  const saved = [
    "/* keep this comment */",
    ":root {",
    "  /* header */",
    "  --color-tune-text-light: oklch(0.66 0 0);",
    "  --color-tune-dark-warmth: 90%;",
    "  --color-tune-not-managed: 12%;",
    "}",
    ".keep { color: red; }",
    "",
  ].join("\n");
  const { controller } = makeWorkbench(syntheticPayload({ css: { tuning: saved, tuningSupport: "supported" } }));

  const untouched = controller.exportTuningFile();
  assert.equal(untouched.mode, "complete");
  assert.equal(untouched.css, saved, "no edits always return the exact saved bytes");
  assert.deepEqual(untouched.removed, []);
  assert.deepEqual(untouched.unmatched, ["--color-tune-not-managed"], "orphan saved overrides are reported without editing");
  assert.match(untouched.warnings.join(" "), /non più corrispondenti/);

  await controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)");
  const merged = controller.exportTuningFile();
  assert.equal(merged.mode, "complete");
  assert.ok(merged.css.includes("/* keep this comment */"));
  assert.ok(merged.css.includes("/* header */"));
  assert.ok(merged.css.includes("--color-tune-text-light: oklch(0.5 0 0);"));
  assert.ok(merged.css.includes("--color-tune-not-managed: 12%;"), "unknown saved knobs are preserved");
  assert.ok(merged.css.includes(".keep { color: red; }"), "unknown rules are preserved");
  assert.deepEqual(merged.unmatched, ["--color-tune-not-managed"]);
  assert.match(merged.warnings.join(" "), /non più corrispondenti/);

  const unsupportedText = '@import url("x.css");\n:root { --color-tune-text-light: oklch(0.66 0 0); }\n';
  const unsupported = makeWorkbench(syntheticPayload({ css: { tuning: unsupportedText, tuningSupport: "unsupported" } })).controller;
  const unsupportedResult = unsupported.exportTuningFile();
  assert.equal(unsupportedResult.css, unsupportedText, "no edits always return the exact saved source, even when it is not applied");
  assert.equal(unsupportedResult.mode, "complete");
  assert.deepEqual(unsupportedResult.removed, []);
  assert.deepEqual(unsupportedResult.unmatched, []);
  assert.match(unsupportedResult.warnings.join(" "), /non è applicato \(unsupported\)/);

  const escapedText = ":root { --color-tune-text-li\\67 ht: oklch(0.66 0 0); }";
  const escaped = makeWorkbench(syntheticPayload({ css: { tuning: escapedText, tuningSupport: "supported" } })).controller.exportTuningFile();
  assert.equal(escaped.css, escapedText, "no edits still return the exact escaped source");
  assert.equal(escaped.mode, "complete", "no edits return the whole saved file even when its analysis is unavailable");
  assert.deepEqual(escaped.unmatched, []);
  assert.match(escaped.warnings.join(" "), /escape/);
  assert.match(escaped.warnings.join(" "), /non è verificata/, "the warning states the interpretation is not verified");

  const brokenText = ":root { --color-tune-text-light: oklch(0.66 0 0); } }";
  const broken = makeWorkbench(syntheticPayload({ css: { tuning: brokenText, tuningSupport: "supported" } })).controller.exportTuningFile();
  assert.equal(broken.css, brokenText);
  assert.equal(broken.mode, "complete", "no edits return the whole saved file even when braces are unbalanced");
  assert.match(broken.warnings.join(" "), /unbalanced braces/);
  assert.match(broken.warnings.join(" "), /non è verificata/);

  await controller.removeOverride("--color-tune-dark-warmth");
  const removed = controller.exportTuningFile();
  assert.equal(removed.mode, "complete");
  assert.ok(!removed.css.includes("--color-tune-dark-warmth"));
  assert.ok(!removed.css.includes("initial"), "a tombstone is never exported as a saved value");
  assert.deepEqual(removed.removed, ["--color-tune-dark-warmth"]);
});

test("exportTuningFile never claims a new :root when the export carries no declaration", async () => {
  const { controller } = makeWorkbench(syntheticPayload());
  await controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)");
  await controller.removeOverride("--color-tune-text-light");

  // Only a tombstone is left: no saved file, nothing to write, so no root is created and no success
  // is claimed for an empty file.
  const exported = controller.exportTuningFile();
  assert.equal(exported.css, "");
  assert.deepEqual(exported.removed, ["--color-tune-text-light"]);
  assert.ok(!exported.warnings.some((warning) => /creato un nuovo :root/.test(warning)), exported.warnings.join(" | "));
});

test("exportTuningFile fails closed to a fragment on ambiguous precedence and never deletes user content", async () => {
  const cases = [
    {
      name: "duplicate declaration",
      css: ":root { --color-tune-text-light: oklch(0.66 0 0); --color-tune-text-light: oklch(0.6 0 0); }",
      reason: /duplicate declaration/,
    },
    {
      name: "conditional selector",
      css: "[data-theme=\"dark\"] { --color-tune-text-light: oklch(0.66 0 0); }",
      reason: /no top-level :root|outside a top-level :root/,
    },
    {
      name: "conditional selector beside a root",
      css: ":root { --color-bg: white; }\n[data-theme=\"dark\"] { --color-tune-text-light: oklch(0.66 0 0); }",
      reason: /outside a top-level :root/,
    },
    {
      name: "nested block inside a root",
      css: ":root { .theme { --color-tune-text-light: oklch(0.66 0 0); } }",
      reason: /outside a top-level :root/,
    },
    {
      name: "duplicate declaration across roots",
      css: ":root { --color-tune-text-light: oklch(0.66 0 0); }\n:root { --color-tune-text-light: oklch(0.6 0 0); }",
      reason: /duplicate declaration/,
    },
    {
      name: "important precedence",
      css: ":root { --color-tune-text-light: oklch(0.66 0 0) !important; }",
      reason: /!important/,
    },
    {
      name: "commented important precedence",
      css: ":root { --color-tune-text-light: oklch(0.66 0 0) ! /* hint */ important; }",
      reason: /!important/,
    },
    {
      name: "author comment inside the declaration",
      css: ":root { --color-tune-text-light: /* motivo autore */ oklch(0.66 0 0); }",
      reason: /author comment/,
    },
    {
      name: "active CSS escape",
      css: ":root { --color-tune-text-li\\67 ht: oklch(0.66 0 0); }",
      reason: /escape/,
    },
    {
      name: "unmatched closing brace",
      css: ":root { --color-tune-text-light: oklch(0.66 0 0); } }",
      reason: /unbalanced braces/,
    },
  ];
  for (const item of cases) {
    const { controller } = makeWorkbench(syntheticPayload({ css: { tuning: item.css, tuningSupport: "supported" } }));
    // No edits: the ambiguous file is still the complete source copy, byte-exact; only its analysis
    // is declared unavailable. It is never disguised as a patch.
    const untouched = controller.exportTuningFile();
    assert.equal(untouched.mode, "complete", "no edits: " + item.name);
    assert.equal(untouched.css, item.css, "no edits return the raw source unchanged: " + item.name);
    assert.deepEqual(untouched.unmatched, [], "no edits: " + item.name);
    const noEditWarning = untouched.warnings.join(" ");
    if (noEditWarning) assert.match(noEditWarning, /non è verificata/, "an unavailable analysis is declared, not verified: " + item.name);

    // With an edit the same ambiguous source cannot be patched: only the draft delta is emitted.
    await controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)");
    const result = controller.exportTuningFile();
    assert.equal(result.mode, "fragment", item.name);
    assert.match(result.warnings.join(" "), item.reason, item.name);
    assert.ok(result.css.includes("--color-tune-text-light: oklch(0.5 0 0);"), "the fragment still carries the draft");
    assert.ok(!result.css.includes(item.css), "the fragment never includes the ambiguous saved file");
    assert.ok(!result.css.includes("initial"), "the fragment never carries a tombstone");
  }
});

test("exportTuningFile patches a unique knob across an authored two-root tuning file and preserves the other root", async () => {
  const real = MULTI_ROOT_TUNING;
  assert.equal((real.match(/:root \{/g) || []).length, 2, "the fixture keeps two top-level roots");
  const { controller } = makeWorkbench(syntheticPayload({ css: { tuning: real, tuningSupport: "supported" } }));

  const untouched = controller.exportTuningFile();
  assert.equal(untouched.mode, "complete");
  assert.equal(untouched.css, real, "no edits return the real file byte-exact");
  assert.deepEqual(untouched.unmatched, [], "the real template has no orphan public knobs");

  await controller.setOverride("--color-tune-dark-warmth", "60%");
  const patched = controller.exportTuningFile();
  assert.equal(patched.mode, "complete", "a unique declaration in the first root is patchable");
  assert.equal(patched.css, real.replace("--color-tune-dark-warmth: 75%;", "--color-tune-dark-warmth: 60%;"),
    "only the unique declaration changes; both roots and every comment stay byte-exact");
  assert.equal((patched.css.match(/:root \{/g) || []).length, 2, "both top-level roots survive");
  assert.match(patched.css, /1\. MACRO THEME TUNING/);
  assert.match(patched.css, /3\. ELEVATION TUNING/);
  assert.ok(patched.css.includes("--elevation-filter-surface: var(--elevation-filter-1);"), "the elevation root is untouched");
});

test("exportTuningFile appends new knobs to the last top-level root and removes a unique declaration in place", async () => {
  const real = MULTI_ROOT_TUNING;
  const { controller } = makeWorkbench(syntheticPayload({ css: { tuning: real, tuningSupport: "supported" } }));

  await controller.setOverride("--color-tune-bg-light", "oklch(0.97 0.005 250)");
  const appended = controller.exportTuningFile();
  assert.equal(appended.mode, "complete");
  const lastRoot = appended.css.lastIndexOf(":root {");
  const lastClose = appended.css.indexOf("}", lastRoot);
  const newIndex = appended.css.indexOf("--color-tune-bg-light:");
  assert.ok(newIndex > lastRoot && newIndex < lastClose, "a new knob is appended to the last top-level root");
  assert.equal(appended.css.slice(0, lastRoot).indexOf("--color-tune-bg-light:"), -1, "the first root is not used for a new knob");
  assert.equal(appended.css, real.replace(/\}\n$/, "\n  --color-tune-bg-light: oklch(0.97 0.005 250);\n}\n"),
    "all other bytes are preserved when the new declaration is appended");

  const { controller: removal } = makeWorkbench(syntheticPayload({ css: { tuning: real, tuningSupport: "supported" } }));
  await removal.removeOverride("--color-tune-dark-warmth");
  const removed = removal.exportTuningFile();
  assert.equal(removed.mode, "complete");
  assert.equal(removed.css, real.replace("--color-tune-dark-warmth: 75%;", ""),
    "removal keeps the declaration position, both roots and every comment");
  assert.ok(!/^\s*--color-tune-dark-warmth\s*:/m.test(removed.css), "the active declaration is gone, while comments naming it remain");
  assert.match(removed.css, /--color-tune-dark-warmth\n     Quanto calore/, "the macro comment is preserved");
});

test("exportTuningFile reports unmatched knobs across roots without blocking a unique patch", async () => {
  const css = ":root { --color-tune-dark-warmth: 75%; }\n:root { --color-tune-not-managed: 12%; }\n";
  const { controller } = makeWorkbench(syntheticPayload({ css: { tuning: css, tuningSupport: "supported" } }));
  await controller.setOverride("--color-tune-dark-warmth", "60%");
  const result = controller.exportTuningFile();
  assert.equal(result.mode, "complete");
  assert.equal(result.css, css.replace("--color-tune-dark-warmth: 75%;", "--color-tune-dark-warmth: 60%;"));
  assert.deepEqual(result.unmatched, ["--color-tune-not-managed"], "orphans are reported across every root");
  assert.match(result.warnings.join(" "), /non più corrispondenti/);
});

test("explorationPairs exposes the bounded advisory catalog and measureExploration fails closed without a frame", async () => {
  const { controller } = makeWorkbench(syntheticPayload());
  assert.equal(controller.explorationPairs("light").length, 2);
  assert.equal(controller.explorationPairs("dark").length, 2);
  assert.deepEqual(controller.explorationPairs("sepia"), []);
  assert.ok(controller.explorationPairs("light").every((pair) => pair.exploration === true));
  assert.equal(controller.state().exploration, null);

  await controller.measureExploration("sepia");
  assert.match(controller.state().error, /theme 'light' or 'dark'/);
  await controller.measureExploration("light");
  assert.match(controller.state().error, /mounted frame/);
  assert.equal(controller.state().exploration, null);
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

test("discardSuggestion is synchronous, clears the suggestion and preserves draft, selection and export", async () => {
  const { controller } = makeWorkbench(syntheticPayload());
  await controller.setOverride("--color-tune-text-light", "oklch(0.5 0 0)");
  const before = controller.state();
  const exported = controller.exportTuning();
  await controller.suggest("foreground");
  assert.ok(controller.state().suggestion, "the unmeasured suggestion metadata is present before discard");

  const reasons = [];
  controller.subscribe((state, reason) => reasons.push({ state, reason }));
  const returned = controller.discardSuggestion();
  assert.equal(returned.suggestion, null);
  assert.deepEqual(returned.draft, before.draft, "discard never mutates the draft");
  assert.deepEqual(returned.selection, before.selection, "discard never changes the selection");
  assert.equal(returned.revision, before.revision, "discard never invalidates the measured revision");
  assert.equal(controller.exportTuning(), exported, "discard never changes the export");
  assert.ok(reasons.some((entry) => entry.reason === "discard-suggestion"), "discard publishes its reason");
  assert.ok(reasons.every((entry) => entry.state.suggestion === null), "every published snapshot is already cleared");

  const again = controller.discardSuggestion();
  assert.equal(again.suggestion, null, "discarding an empty suggestion is a safe no-op");
  assert.deepEqual(again.draft, before.draft);
  await controller.applySuggestion();
  assert.match(controller.state().error, /no verified suggestion/, "a discarded suggestion can never be applied");

  controller.destroy();
  assert.throws(() => controller.discardSuggestion(), /destroyed/);
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
  const base = createRequire(import.meta.url);
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
  throw new Error("BLOCKED: Playwright is not resolvable from the package; the opted-in browser proof is mandatory and cannot be skipped.");
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

async function mountAndSettle(page, options = {}) {
  await page.evaluate((withProposal) => {
    const controller = window.__smartColorsWorkbench;
    const slots = { left: document.getElementById("scw-left"), right: document.getElementById("scw-right") };
    if (withProposal) {
      slots.proposalBefore = document.getElementById("scw-proposal-before");
      slots.proposalAfter = document.getElementById("scw-proposal-after");
    }
    controller.mount(slots);
  }, Boolean(options.proposal));
  await page.waitForFunction(() => {
    const controller = window.__smartColorsWorkbench;
    return controller && ["complete", "incomplete", "unavailable"].includes(controller.state().phase);
  }, null, { timeout: 30_000 });
  return page.evaluate(() => window.__smartColorsWorkbench.state());
}

function oklchOf(value) {
  try {
    const parsed = core.parseComputedColor(value, "test metadata");
    return { l: parsed.l, c: parsed.c, h: parsed.h };
  } catch {
    return null;
  }
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
  // Additive metadata: every shown measurement carries the shared core's {l,c,h} for the exact
  // browser serialization, or null when that serialization cannot be parsed. Ratio/status are intact.
  for (const view of state.views) {
    for (const measurement of view.measurements) {
      assert.deepEqual(measurement.foregroundOklch, oklchOf(measurement.foreground), "foregroundOklch mirrors the shared core");
      assert.deepEqual(measurement.backgroundOklch, oklchOf(measurement.background), "backgroundOklch mirrors the shared core");
    }
  }
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
    assert.equal(frame.specimenTitle, "Le modifiche sono pronte", "the sample shows a human title, not a token caption");
    assert.equal(frame.specimenText, "Controlla i dettagli prima di continuare. Puoi modificare questa scelta in qualsiasi momento.", "the sample shows human copy, not diagnostics");
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
  assert.ok(/Le modifiche sono pronte/.test(aria), "the human sample title remains exposed");
  assert.ok(/Controlla i dettagli prima di continuare\. Puoi modificare questa scelta in qualsiasi momento\./.test(aria), "the human sample copy remains exposed");
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
      const wrapper = node.parentElement;
      const style = frame.contentWindow.getComputedStyle(node);
      const wrapperStyle = frame.contentWindow.getComputedStyle(wrapper);
      const nodeRect = node.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const ringExtent = pair.property === "outlineColor"
        ? Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
        : Number.parseFloat(style.borderWidth);
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
        text: node.textContent,
        role: node.getAttribute("role"),
        ariaLabel: node.getAttribute("aria-label"),
        wrapperBackground: wrapperStyle.backgroundColor,
        wrapperPaddingLeft: Number.parseFloat(wrapperStyle.paddingLeft),
        ringExtent,
        ringFits: wrapperRect.left <= nodeRect.left - ringExtent + 0.5
          && wrapperRect.top <= nodeRect.top - ringExtent + 0.5
          && wrapperRect.right >= nodeRect.right + ringExtent - 0.5
          && wrapperRect.bottom >= nodeRect.bottom + ringExtent - 0.5,
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
  assert.equal(pairSpecimens.focus.tag, "DIV", "the outline sample is static geometry, not a fake control");
  assert.equal(pairSpecimens.focus.text.trim(), "", "the outline sample carries no unmeasured copy");
  assert.equal(pairSpecimens.focus.role, "img");
  assert.match(pairSpecimens.focus.ariaLabel, /Campione statico/);
  assert.match(pairSpecimens.focus.ariaLabel, /non il comportamento di focus/);
  assert.equal(pairSpecimens.focus.wrapperBackground, pairSpecimens.focus.background, "the surface around the ring is the measured background token");
  assert.ok(pairSpecimens.focus.wrapperPaddingLeft >= pairSpecimens.focus.ringExtent, "the wrapper padding contains the full ring");
  assert.equal(pairSpecimens.focus.ringFits, true, "the complete outline is painted inside the measured surface");
  assert.ok(pairSpecimens.focus.inlineStyle.includes("var(" + pairSpecimens.focus.foregroundToken + ")"));
  assert.ok(pairSpecimens.border);
  assert.notEqual(pairSpecimens.border.status, "unmeasured");
  assert.equal(pairSpecimens.border.measurement.foreground, pairSpecimens.border.computed);
  assert.equal(pairSpecimens.border.measurement.background, pairSpecimens.border.background);
  assert.equal(pairSpecimens.border.propertyAttribute, "borderColor");
  assert.equal(pairSpecimens.border.tag, "DIV", "the border sample is static geometry, not a fake control");
  assert.equal(pairSpecimens.border.text.trim(), "", "the border sample carries no unmeasured copy");
  assert.equal(pairSpecimens.border.role, "img");
  assert.match(pairSpecimens.border.ariaLabel, /Campione statico/);
  assert.match(pairSpecimens.border.ariaLabel, /non il comportamento di focus/);
  assert.equal(pairSpecimens.border.wrapperBackground, pairSpecimens.border.background, "the surface around the border is the measured background token");
  assert.ok(pairSpecimens.border.wrapperPaddingLeft >= pairSpecimens.border.ringExtent, "the wrapper padding contains the full border");
  assert.equal(pairSpecimens.border.ringFits, true, "the complete border is painted inside the measured surface");
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

// ---------------------------------------------------------------------------
// Discard: the additive synchronous API drops only the suggestion layer. The draft, the selection,
// the main measurements and the export must survive both a verified discard and a discard that
// happens while the trial frames are live; the invalidated call can never publish afterwards.
// ---------------------------------------------------------------------------
test("browser proof: discardSuggestion clears verified and pending suggestions without touching the draft", { skip: NATIVE_PROOF ? false : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium proof" }, async (t) => {
  if (!NATIVE_PROOF) return;
  const playwright = resolvePlaywright();
  const browser = await openChromium(playwright.chromium);
  t.after(() => browser.close());
  const source = createContrastWorkbenchSource();
  const dir = await mkdtemp(path.join(tmpdir(), "smart-colors-workbench-discard-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const real = await createRealPayload(t);
  const file = path.join(dir, "discard.html");
  await writeFile(file, buildFixtureHtml({ title: "Workbench discard", payload: real, source, hostColorScheme: "light" }), "utf8");
  const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
  t.after(() => context.close());
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

  const verified = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const count = (kind) => document.querySelectorAll('iframe[data-smart-colors-workbench-frame="' + kind + '"]').length;
    const snapshot = () => {
      const state = controller.state();
      return {
        phase: state.phase,
        revision: state.revision,
        draft: state.draft,
        selection: state.selection,
        suggestion: state.suggestion,
        exportNow: controller.exportTuning(),
        views: state.views.map((view) => ({
          slot: view.slot,
          variant: view.variant,
          theme: view.theme,
          status: view.measurement ? view.measurement.status : null,
          ratio: view.measurement ? view.measurement.ratio : null,
        })),
        proposal: count("proposal"),
        trial: count("trial"),
        visible: count("visible"),
      };
    };
    // A real draft on the other side of the pair is the base the suggestion is verified against.
    await controller.setOverride("--color-tune-bg-light", "oklch(0.8 0 0)");
    await controller.suggest("foreground");
    const before = snapshot();
    const reasons = [];
    const unsubscribe = controller.subscribe((state, reason) => reasons.push(reason));
    const returned = controller.discardSuggestion();
    const immediate = {
      suggestion: returned.suggestion,
      draft: returned.draft,
      selection: returned.selection,
      revision: returned.revision,
      exportNow: controller.exportTuning(),
      proposal: count("proposal"),
      trial: count("trial"),
      visible: count("visible"),
    };
    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const later = snapshot();
    await controller.applySuggestion();
    const applyError = controller.state().error;
    await controller.suggest("foreground");
    const recovered = controller.state().suggestion ? controller.state().suggestion.status : null;
    controller.discardSuggestion();
    return { before, immediate, later, reasons, applyError, recovered };
  });

  assert.equal(verified.before.suggestion.status, "verified", JSON.stringify(verified.before.suggestion));
  assert.equal(verified.before.proposal, 2, "the verified suggestion renders the proposal preview");
  assert.equal(verified.before.trial, 0);
  assert.equal(verified.before.visible, 2);
  assert.ok(verified.before.draft["--color-tune-bg-light"], "the draft is present before the discard");
  assert.equal(verified.immediate.suggestion, null, "discard clears verified metadata synchronously");
  assert.deepEqual(verified.immediate.draft, verified.before.draft, "discard never mutates the draft");
  assert.deepEqual(verified.immediate.selection, verified.before.selection, "discard never changes the selection");
  assert.equal(verified.immediate.revision, verified.before.revision, "discard does not invalidate the measured revision");
  assert.equal(verified.immediate.exportNow, verified.before.exportNow, "discard never changes the export");
  assert.equal(verified.immediate.proposal, 0, "discard removes the proposal frames");
  assert.equal(verified.immediate.trial, 0);
  assert.equal(verified.immediate.visible, 2, "the main comparison frames survive a discard");
  assert.equal(verified.later.suggestion, null);
  assert.equal(verified.later.proposal, 0, "the discarded preview never comes back");
  assert.equal(verified.later.trial, 0);
  assert.equal(verified.later.visible, 2);
  assert.deepEqual(verified.later.draft, verified.before.draft);
  assert.deepEqual(verified.later.selection, verified.before.selection);
  assert.deepEqual(verified.later.views, verified.before.views, "the main measurement is untouched");
  assert.equal(verified.later.exportNow, verified.before.exportNow);
  assert.ok(verified.reasons.includes("discard-suggestion"), "discard publishes its reason");
  assert.match(verified.applyError, /no verified suggestion/, "a discarded suggestion can never be applied");
  assert.equal(verified.recovered, "verified", "a later suggest still works after a discard");

  // The MutationObserver callback runs as a microtask right after the trial frames are inserted and
  // therefore before their load events: `discardSuggestion` is guaranteed to hit a live in-flight
  // verification rather than a settled one.
  const pending = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const count = (kind) => document.querySelectorAll('iframe[data-smart-colors-workbench-frame="' + kind + '"]').length;
    const snapshot = () => {
      const state = controller.state();
      return {
        phase: state.phase,
        revision: state.revision,
        draft: state.draft,
        selection: state.selection,
        suggestion: state.suggestion,
        exportNow: controller.exportTuning(),
        views: state.views.map((view) => ({
          slot: view.slot,
          variant: view.variant,
          theme: view.theme,
          status: view.measurement ? view.measurement.status : null,
          ratio: view.measurement ? view.measurement.ratio : null,
        })),
        proposal: count("proposal"),
        trial: count("trial"),
        visible: count("visible"),
      };
    };
    const before = snapshot();
    let observed = 0;
    let discarded = false;
    let immediate = null;
    const observer = new MutationObserver(() => {
      if (discarded) return;
      const live = count("trial");
      if (live === 0) return;
      observed = live;
      discarded = true;
      observer.disconnect();
      const returned = controller.discardSuggestion();
      immediate = {
        suggestion: returned.suggestion,
        draft: returned.draft,
        revision: returned.revision,
        proposal: count("proposal"),
        trial: count("trial"),
        visible: count("visible"),
      };
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const running = controller.suggest("foreground");
    await running;
    observer.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { before, observed, discarded, immediate, after: snapshot() };
  });

  assert.ok(pending.observed > 0, "discard was called while trial frames were live");
  assert.equal(pending.discarded, true);
  assert.equal(pending.immediate.suggestion, null, "the pending metadata is cleared synchronously");
  assert.equal(pending.immediate.trial, 0, "the in-flight trial frames are removed synchronously");
  assert.equal(pending.immediate.proposal, 0);
  assert.equal(pending.immediate.visible, 2);
  assert.deepEqual(pending.immediate.draft, pending.before.draft);
  assert.equal(pending.immediate.revision, pending.before.revision);
  assert.equal(pending.after.suggestion, null, "an invalidated suggest can never publish itself later");
  assert.equal(pending.after.trial, 0);
  assert.equal(pending.after.proposal, 0);
  assert.equal(pending.after.visible, 2);
  assert.deepEqual(pending.after.draft, pending.before.draft, "the draft survives a pending discard");
  assert.deepEqual(pending.after.selection, pending.before.selection);
  assert.deepEqual(pending.after.views, pending.before.views, "the main measurement survives a pending discard");
  assert.equal(pending.after.exportNow, pending.before.exportNow, "the export survives a pending discard");

  await loaded.page.close();
});

// ---------------------------------------------------------------------------
// Chromium regression: an offset ring must be adjacent to the measured surface.
//
// The light canvas is white while the surface/active background is black. A border's outer edge
// and an offset outline live outside the node box, so the old specimen painted the ring against
// the frame canvas (white) while reporting the ring/black ratio. The padded wrapper must paint
// the pair background around the entire ring, and non-text samples must not carry copy that is
// outside the measured pair.
// ---------------------------------------------------------------------------

const RING_ADJACENCY_BASELINE = [
  ":root {",
  "  color-scheme: light dark;",
  "  --color-bg: white;",
  "  --color-surface: black;",
  "  --color-text: light-dark(black, white);",
  "  --color-text-muted: light-dark(black, white);",
  "  --color-focus-ring: light-dark(var(--color-tune-focus-ring-light, #9a9a9a), var(--color-tune-focus-ring-dark, #9a9a9a));",
  "  --color-control-active-text: light-dark(white, white);",
  "  --color-control-bg-active: black;",
  "  --color-control-focus-bg: white;",
  "  --color-control-border-active: #9a9a9a;",
  "}",
  "",
].join("\n");

function ringAdjacencyDesign() {
  const design = JSON.parse(JSON.stringify(SYNTHETIC_DESIGN));
  design.tokens["--color-focus-ring"] = {
    sources: ["--palette-ink"],
    recipe: "neutral",
    usage: "focus ring",
    controls: {
      light: { override: "--color-tune-focus-ring-light" },
      dark: { override: "--color-tune-focus-ring-dark" },
    },
  };
  return design;
}

function ringAdjacencyPayload() {
  return syntheticPayload({
    design: ringAdjacencyDesign(),
    css: {
      baseline: RING_ADJACENCY_BASELINE,
      tuning: null,
      tuningSupport: "absent",
      baselineSupport: "supported",
      source: "output",
      status: "current",
      production: true,
      digest: { baseline: sha256Hex(RING_ADJACENCY_BASELINE), generated: sha256Hex(RING_ADJACENCY_BASELINE) },
    },
  });
}

test("browser regression: border/outline samples sit on the measured surface with no unmeasured text", { skip: NATIVE_PROOF ? false : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium proof" }, async (t) => {
  if (!NATIVE_PROOF) return;
  const playwright = resolvePlaywright();
  const browser = await openChromium(playwright.chromium);
  t.after(() => browser.close());
  const source = createContrastWorkbenchSource();
  const dir = await mkdtemp(path.join(tmpdir(), "smart-colors-workbench-ring-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "ring.html");
  await writeFile(file, buildFixtureHtml({ title: "Workbench ring adjacency", payload: ringAdjacencyPayload(), source }), "utf8");
  const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
  t.after(() => context.close());
  const loaded = await loadFixture(context, file);
  const initial = await mountAndSettle(loaded.page, { proposal: true });
  assert.equal(initial.phase, "complete");

  const adjacency = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const effectiveSurface = (doc, view, x, y) => {
      const stack = doc.elementsFromPoint ? doc.elementsFromPoint(x, y) : [];
      for (const element of stack) {
        const background = view.getComputedStyle(element).backgroundColor;
        if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent") {
          return { tag: element.tagName, background };
        }
      }
      return null;
    };
    const out = {};
    for (const theme of ["light", "dark"]) {
      const outlinePair = controller.pairs(theme).find((entry) => entry.property === "outlineColor" && entry.background === "--color-surface");
      const borderPair = controller.pairs(theme).find((entry) => entry.property === "borderColor" && entry.background === "--color-control-bg-active");
      out[theme] = {};
      for (const [name, pair] of [["outline", outlinePair], ["border", borderPair]]) {
        if (!pair) {
          out[theme][name] = null;
          continue;
        }
        await controller.select({ pairId: pair.id, theme, comparison: "tuning" });
        const state = controller.state();
        const view = state.views.find((entry) => entry.slot === "right");
        const frame = document.querySelector('iframe[data-smart-colors-workbench-slot="right"]');
        const doc = frame.contentDocument;
        const frameView = frame.contentWindow;
        const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
        const wrapper = node.parentElement;
        const style = frameView.getComputedStyle(node);
        const wrapperStyle = frameView.getComputedStyle(wrapper);
        const nodeRect = node.getBoundingClientRect();
        const wrapperRect = wrapper.getBoundingClientRect();
        const ringExtent = name === "outline"
          ? Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
          : Number.parseFloat(style.borderWidth);
        const centerY = nodeRect.top + nodeRect.height / 2;
        out[theme][name] = {
          pairId: pair.id,
          property: pair.property,
          status: view.measurement.status,
          measurement: view.measurement,
          text: node.textContent,
          childCount: node.children.length,
          role: node.getAttribute("role"),
          ariaLabel: node.getAttribute("aria-label"),
          wrapperBackground: wrapperStyle.backgroundColor,
          wrapperPaddingLeft: Number.parseFloat(wrapperStyle.paddingLeft),
          ringExtent,
          gapSurface: effectiveSurface(doc, frameView, nodeRect.left - 1, centerY),
          outsideRingSurface: effectiveSurface(doc, frameView, nodeRect.left - ringExtent - 1, centerY),
          ringFits: wrapperRect.left <= nodeRect.left - ringExtent + 0.5
            && wrapperRect.top <= nodeRect.top - ringExtent + 0.5
            && wrapperRect.right >= nodeRect.right + ringExtent - 0.5
            && wrapperRect.bottom >= nodeRect.bottom + ringExtent - 0.5,
        };
      }
    }
    return out;
  });

  for (const theme of ["light", "dark"]) {
    for (const name of ["outline", "border"]) {
      const entry = adjacency[theme] && adjacency[theme][name];
      assert.ok(entry, "missing " + name + " specimen in " + theme);
      assert.notEqual(entry.status, "unmeasured", name + " specimen must be measured in " + theme);
      assert.ok(Math.abs(entry.measurement.ratio - 7.462) < 1e-3, name + " ratio should be 7.462 on black: " + entry.measurement.ratio);
      assert.equal(entry.measurement.background, "rgb(0, 0, 0)", name + " must report the black surface in " + theme);
      assert.equal(entry.wrapperBackground, entry.measurement.background, "the wrapper paints the reported surface around the " + name);
      assert.equal(entry.gapSurface && entry.gapSurface.background, entry.measurement.background, "the surface in the " + name + " gap must be the reported background");
      assert.equal(entry.outsideRingSurface && entry.outsideRingSurface.background, entry.measurement.background, "the surface outside the full " + name + " must be the reported background");
      assert.ok(entry.wrapperPaddingLeft >= entry.ringExtent, "the wrapper padding must contain the full " + name);
      assert.equal(entry.ringFits, true, "the full " + name + " must fit inside the painted wrapper");
      assert.equal(entry.text.trim(), "", "the " + name + " specimen must not contain unmeasured text");
      assert.equal(entry.childCount, 0, "the " + name + " specimen must be geometry only");
      assert.equal(entry.role, "img");
      assert.match(entry.ariaLabel, /Campione statico/);
      assert.match(entry.ariaLabel, /non il comportamento di focus/);
    }
  }

  // The accessibility tree exposes the static-geometry label, never the retired sample copy.
  const selectPair = async (property) => {
    await loaded.page.evaluate(async (propertyName) => {
      const controller = window.__smartColorsWorkbench;
      const pair = controller.pairs("light").find((entry) => entry.property === propertyName);
      await controller.select({ pairId: pair.id, theme: "light", comparison: "tuning" });
    }, property);
  };
  await selectPair("outlineColor");
  const outlineAria = await loaded.page.locator('iframe[data-smart-colors-workbench-slot="right"]').contentFrame().locator("body").ariaSnapshot();
  assert.doesNotMatch(outlineAria, /Le modifiche sono pronte/, "the outline sample exposes no unmeasured copy");
  assert.match(outlineAria, /Campione statico dell.{1,2}anello/);
  assert.match(outlineAria, /non il comportamento di focus/);
  await selectPair("borderColor");
  const borderAria = await loaded.page.locator('iframe[data-smart-colors-workbench-slot="right"]').contentFrame().locator("body").ariaSnapshot();
  assert.doesNotMatch(borderAria, /Le modifiche sono pronte/, "the border sample exposes no unmeasured copy");
  assert.match(borderAria, /Campione statico del bordo/);
  assert.match(borderAria, /non il comportamento di focus/);

  // ---- Proposal preview: the same geometry is measured at the 360x480 trial viewport --------
  const proposal = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const pair = controller.pairs("light").find((entry) => entry.property === "outlineColor" && entry.background === "--color-surface");
    await controller.select({ pairId: pair.id, theme: "light", comparison: "tuning" });
    await controller.setOverride("--color-tune-focus-ring-light", "#555555");
    const draftState = controller.state();
    await controller.suggest("foreground");
    const state = controller.state();
    const frames = Array.from(document.querySelectorAll('iframe[data-smart-colors-workbench-frame="proposal"]')).map((frame) => {
      const doc = frame.contentDocument;
      const frameView = frame.contentWindow;
      const node = doc.querySelector('[data-smart-colors-specimen="selected"]');
      const wrapper = node.parentElement;
      const style = frameView.getComputedStyle(node);
      return {
        slot: frame.getAttribute("data-smart-colors-workbench-slot"),
        variant: frame.getAttribute("data-smart-colors-workbench-variant"),
        theme: frame.getAttribute("data-smart-colors-workbench-theme"),
        sandbox: frame.getAttribute("sandbox"),
        width: frame.getBoundingClientRect().width,
        height: frame.getBoundingClientRect().height,
        scripts: doc.querySelectorAll("script").length,
        text: node.textContent,
        role: node.getAttribute("role"),
        ariaLabel: node.getAttribute("aria-label"),
        property: node.getAttribute("data-smart-colors-property"),
        outlineColor: style.outlineColor,
        background: style.backgroundColor,
        wrapperBackground: frameView.getComputedStyle(wrapper).backgroundColor,
      };
    });
    return {
      draftStatus: draftState.views.find((entry) => entry.slot === "right").measurement.status,
      suggestion: state.suggestion,
      preview: state.suggestion ? state.suggestion.preview : null,
      frames,
    };
  });
  assert.equal(proposal.draftStatus, "below-minimum");
  assert.equal(proposal.suggestion.status, "verified", proposal.suggestion.reason);
  assert.equal(proposal.preview.status, "shown");
  assert.ok(proposal.preview.before < 3, "the draft ring is below the UI minimum: " + proposal.preview.before);
  assert.ok(proposal.preview.after >= 3, "the candidate ring reaches the UI minimum: " + proposal.preview.after);
  assert.equal(proposal.frames.length, 2);
  assert.deepEqual(proposal.frames.map((frame) => frame.slot), ["proposal-before", "proposal-after"]);
  for (const frame of proposal.frames) {
    assert.equal(frame.variant, "draft");
    assert.equal(frame.theme, "light");
    assert.equal(frame.width, 360);
    assert.equal(frame.height, 480);
    assert.equal(frame.sandbox, "allow-same-origin");
    assert.equal(frame.scripts, 0);
    assert.equal(frame.text.trim(), "", "the proposal ring sample must not contain unmeasured text");
    assert.equal(frame.role, "img");
    assert.match(frame.ariaLabel, /Campione statico dell'anello/);
    assert.match(frame.ariaLabel, /non il comportamento di focus/);
    assert.equal(frame.property, "outlineColor");
    assert.equal(frame.background, "rgb(0, 0, 0)");
    assert.equal(frame.wrapperBackground, "rgb(0, 0, 0)");
  }
  assert.notEqual(proposal.frames[0].outlineColor, proposal.frames[1].outlineColor, "the candidate frame paints the proposed ring colour");

  await loaded.page.close();
  await context.close();
});

test("browser proof: OKLCH lightness, saved-override tombstone and advisory exploration", { skip: NATIVE_PROOF ? false : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the Chromium proof" }, async (t) => {
  if (!NATIVE_PROOF) return;
  const playwright = resolvePlaywright();
  const browser = await openChromium(playwright.chromium);
  t.after(() => browser.close());
  const source = createContrastWorkbenchSource();
  const dir = await mkdtemp(path.join(tmpdir(), "smart-colors-workbench-tuning-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const tuning = [
    "/* keep this comment */",
    ":root {",
    "  --color-tune-text-light: oklch(0.66 0 0);",
    "  --color-tune-brand-light: oklch(0.56 0.14 255);",
    "  --color-tune-not-managed: 12%;",
    "}",
    ".keep { color: red; }",
    "",
  ].join("\n");
  const real = await createRealPayload(t, { tuning });
  const file = path.join(dir, "tuning.html");
  await writeFile(file, buildFixtureHtml({ title: "Workbench tuning", payload: real, source, hostColorScheme: "light" }), "utf8");
  const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
  t.after(() => context.close());
  const loaded = await loadFixture(context, file);
  t.after(() => loaded.page.close());
  const initial = await mountAndSettle(loaded.page);
  assert.equal(initial.phase, "complete");

  const result = await loaded.page.evaluate(async () => {
    const controller = window.__smartColorsWorkbench;
    const pair = controller.pairs("light").find((entry) => entry.foreground === "--color-brand-ink" && entry.background === "--color-brand");
    if (!pair) return { missing: true };
    await controller.select({ pairId: pair.id, theme: "light", comparison: "tuning" });
    const before = controller.state();
    const beforeView = before.views.find((view) => view.measurement && view.measurement.pairId === pair.id) || before.views[0];
    const beforeMetadata = beforeView && beforeView.measurement
      ? { foreground: beforeView.measurement.foregroundOklch, background: beforeView.measurement.backgroundOklch }
      : null;
    // Force a real RGB computed color first: the metadata must come from the shared core and then
    // supply the exact C/H reused by the additive lightness edit.
    const rgbState = await controller.setOverride("--color-tune-brand-light", "rgb(128 64 32)");
    const rgbView = rgbState.views.find((view) => view.measurement && view.measurement.pairId === pair.id && view.variant === "draft")
      || rgbState.views.find((view) => view.measurement && view.measurement.pairId === pair.id);
    const rgbRaw = rgbView && rgbView.measurement ? rgbView.measurement.background : null;
    const rgbMetadata = rgbView && rgbView.measurement ? rgbView.measurement.backgroundOklch : null;
    const afterLightness = await controller.setLightness("--color-tune-brand-light", 0.5);
    const lightnessValue = afterLightness.draft["--color-tune-brand-light"];
    const firstExport = controller.exportTuningFile();
    const afterRemoval = await controller.removeOverride("--color-tune-text-light");
    const secondExport = controller.exportTuningFile();
    const explorationPairs = controller.explorationPairs("light");
    const afterExploration = await controller.measureExploration("light");
    return {
      missing: false,
      beforeViews: before.views.length,
      beforeMetadata,
      rgbRaw,
      rgbMetadata,
      lightnessValue,
      firstExport,
      removalError: afterRemoval.error,
      removed: afterRemoval.removed,
      removalDraft: afterRemoval.draft["--color-tune-text-light"],
      secondExport,
      explorationPairs: explorationPairs.length,
      exploration: afterExploration.exploration,
      phaseAfter: afterExploration.phase,
      viewsAfter: afterExploration.views.length,
      removedAfter: afterExploration.removed,
    };
  });

  assert.equal(result.missing, false);
  assert.ok(result.beforeMetadata && result.beforeMetadata.background, "the before view exposes OKLCH metadata");
  assert.ok(result.rgbRaw, "the forced override must produce a measured RGB background");
  assert.match(result.rgbRaw, /^(?:rgb|color\(srgb)/, "the forced override is measured through an RGB serialization");
  assert.ok(result.rgbMetadata, "the RGB serialization must produce OKLCH metadata");
  assert.deepEqual(result.rgbMetadata, oklchOf(result.rgbRaw), "RGB serialization is parsed by the shared core");
  const lightnessColor = core.parseComputedColor(result.lightnessValue, "lightness value");
  assert.ok(Math.abs(lightnessColor.l - 0.5) < 1e-6, "the lightness edit keeps the requested L");
  assert.ok(Math.abs(lightnessColor.c - result.rgbMetadata.c) < 1e-3, "the lightness edit preserves C from the RGB metadata");
  const hueDelta = Math.min(Math.abs(lightnessColor.h - result.rgbMetadata.h), 360 - Math.abs(lightnessColor.h - result.rgbMetadata.h));
  assert.ok(hueDelta < 1e-3, "the lightness edit preserves H from the RGB metadata");
  assert.match(result.lightnessValue, /^oklch\(0\.5 /);
  assert.equal(result.firstExport.mode, "complete");
  assert.ok(result.firstExport.css.includes("/* keep this comment */"));
  assert.ok(result.firstExport.css.includes(".keep { color: red; }"));
  assert.ok(result.firstExport.css.includes("--color-tune-brand-light: " + result.lightnessValue + ";"));
  assert.ok(result.firstExport.css.includes("--color-tune-not-managed: 12%;"));
  assert.deepEqual(result.firstExport.unmatched, ["--color-tune-not-managed"]);
  assert.equal(result.removalError, null);
  assert.ok(result.removed.includes("--color-tune-text-light"));
  assert.equal(result.removalDraft, "initial");
  assert.equal(result.secondExport.mode, "complete");
  assert.ok(!result.secondExport.css.includes("--color-tune-text-light"));
  assert.ok(!result.secondExport.css.includes("initial"));
  assert.ok(result.secondExport.css.includes("/* keep this comment */"));
  assert.ok(result.explorationPairs > 0);
  assert.equal(result.exploration.phase, "complete");
  assert.ok(result.exploration.measurements.length > 0);
  assert.equal(result.phaseAfter, "complete");
  assert.equal(result.viewsAfter, result.beforeViews);
  assert.deepEqual(result.removedAfter, result.removed);
});
