/**
 * Browser workbench for guided Smart Colors tuning (guided pair contrast + public tuning).
 *
 * `createContrastWorkbenchSource()` assembles a classic script from the same factories the Node
 * side uses: the pure core (`createVerificationCore`), the isolated DOM collector
 * (`createDomVerifier`), the contrast-advice factory (`createContrastAdvice` from
 * `./contrast-advice.mjs`) and this module's `createContrastWorkbench`. The emitted bytes contain
 * no import, no `eval`, no network call and no reference to the checkout. The script installs the
 * controller on `globalThis.__smartColorsWorkbench`.
 *
 * The workbench consumes the inert `#smart-colors-payload` captured by the preview (baseline,
 * saved tuning, provenance, design metadata). It never calls the generator, never replaces an
 * empty captured output with the model candidate and never paints a specimen from resolved RGB:
 * every visible sample and every measurement reads the applied CSS (`var(--color-*)`) in an
 * isolated `iframe srcdoc` with `sandbox="allow-same-origin"` and no scripts.
 *
 * Frozen controller surface for the UI agent:
 *   payload(), pairs(theme), mount({ left, right }),
 *   select({ pairId, theme, comparison }) async,
 *   setOverride(control, value) async, reset(control?) async,
 *   suggest(side) async, applySuggestion() async,
 *   exportTuning() -> string, state(), subscribe(listener) -> unsubscribe, destroy().
 * Additive helpers: controls(), containsUnsupportedResources(css), mounted/destroyed/frames getters.
 *
 * Additive 2026-10 tuning surface (no change to the frozen methods above):
 *   setLightness(control, L) async, removeOverride(control) async,
 *   explorationPairs(theme) -> Pair[], measureExploration(theme) async,
 *   exportTuningFile() -> { css, mode, warnings, removed, unmatched }.
 * `exportTuning()` stays the legacy unsaved-draft fragment and never emits a tombstone.
 * `measureExploration` is advisory: it never changes the primary phase, error, views or coverage.
 */
import { createContrastAdvice } from "./contrast-advice.mjs";
import { createDomVerifier } from "./verification-dom.mjs";
import { createVerificationCore } from "./verification-core.mjs";

export const WORKBENCH_RUNTIME_GLOBAL = "__smartColorsWorkbench";
export const WORKBENCH_RUNTIME_MARKER = "SMART_COLORS_WORKBENCH_RUNTIME_V1";
export const WORKBENCH_RUNTIME_VERSION = 1;
export const WORKBENCH_PAYLOAD_ID = "smart-colors-payload";
export const WORKBENCH_FRAME_TIMEOUT_MS = 5000;
// The carrier element must declare both schemes before navigation. A host UI that pins a single
// `color-scheme` would otherwise force every child to report that preference, so the actual OS
// preference could never be measured. The child still pins its own theme after load.
export const WORKBENCH_FRAME_COLOR_SCHEME = "light dark";
export const WORKBENCH_PHASES = Object.freeze(["idle", "running", "complete", "incomplete", "unavailable"]);
export const WORKBENCH_COMPARISONS = Object.freeze(["themes", "tuning", "draft"]);
export const WORKBENCH_SIDES = Object.freeze(["foreground", "background"]);
export const WORKBENCH_VISIBLE_FOREGROUND_ATTRIBUTE = "data-smart-colors-foreground";
export const WORKBENCH_VISIBLE_BACKGROUND_ATTRIBUTE = "data-smart-colors-background";
export const WORKBENCH_VISIBLE_PROPERTY_ATTRIBUTE = "data-smart-colors-property";
export const WORKBENCH_VISIBLE_SPECIMEN_ATTRIBUTE = "data-smart-colors-specimen";

// The only macro knobs the workbench accepts outside the per-token design controls. They are the
// ones emitted by the generator's tuning contract; every value is range-checked before it is
// stored, so a draft can never inject an arbitrary declaration.
export const WORKBENCH_MACRO_CONTROLS = Object.freeze([
  Object.freeze({ name: "--color-tune-light-warmth", theme: "light", kind: "percent" }),
  Object.freeze({ name: "--color-tune-dark-warmth", theme: "dark", kind: "percent" }),
  Object.freeze({ name: "--color-tune-dark-bg-mix", theme: "dark", kind: "percent" }),
  Object.freeze({ name: "--color-tune-dark-surface-mix", theme: "dark", kind: "percent" }),
  Object.freeze({ name: "--color-tune-dark-text-mix", theme: "dark", kind: "percent" }),
  Object.freeze({ name: "--color-tune-dark-muted-mix", theme: "dark", kind: "percent" }),
  Object.freeze({ name: "--color-tune-surface-lightness-shift", theme: "light", kind: "number" }),
]);

/**
 * Assemble the classic script the preview embeds. The output is one IIFE that installs the
 * controller on `globalThis`; it is the only origin of the emitted bytes, so a CSP hash computed
 * over them covers the runtime that actually runs. `createContrastAdvice` is the single shared
 * factory imported from `./contrast-advice.mjs`: the workbench runs the exact same numerical
 * implementation as the generator and the reports, with no second search.
 */
export function createContrastWorkbenchSource() {
  return [
    "(function () {",
    '  "use strict";',
    "  var createVerificationCore = " + createVerificationCore.toString() + ";",
    "  var createDomVerifier = " + createDomVerifier.toString() + ";",
    "  var createContrastAdvice = " + createContrastAdvice.toString() + ";",
    "  var createContrastWorkbench = " + createContrastWorkbench.toString() + ";",
    "  globalThis." + WORKBENCH_RUNTIME_GLOBAL + " = createContrastWorkbench({",
    "    createVerificationCore: createVerificationCore,",
    "    createDomVerifier: createDomVerifier,",
    "    createContrastAdvice: createContrastAdvice,",
    "    document: document,",
    "    window: window,",
    "    globalThis: globalThis",
    "  });",
    "})();",
    "",
  ].join("\n");
}

/**
 * Workbench factory. Self-contained: it only reads its `deps` and browser globals, so it is safe
 * to serialize with `Function.prototype.toString()`. `deps` is
 * `{ createVerificationCore, createDomVerifier, createContrastAdvice, document, window, globalThis? }`.
 */
export function createContrastWorkbench(deps) {
  if (!deps || typeof deps !== "object") throw new TypeError("createContrastWorkbench requires a deps object");
  const doc = deps.document;
  const win = deps.window;
  if (!doc || typeof doc !== "object") throw new TypeError("createContrastWorkbench requires a document");
  if (!win || typeof win !== "object") throw new TypeError("createContrastWorkbench requires a window");
  if (typeof deps.createVerificationCore !== "function") throw new TypeError("createContrastWorkbench requires deps.createVerificationCore");
  if (typeof deps.createDomVerifier !== "function") throw new TypeError("createContrastWorkbench requires deps.createDomVerifier");
  if (typeof deps.createContrastAdvice !== "function") throw new TypeError("createContrastWorkbench requires deps.createContrastAdvice");

  const core = deps.createVerificationCore();
  const verifier = deps.createDomVerifier(core);
  const advice = deps.createContrastAdvice(core);
  if (!advice || typeof advice.suggestLightness !== "function") throw new TypeError("createContrastAdvice must return a suggestLightness function");
  const GLOBAL = deps.globalThis && typeof deps.globalThis === "object" ? deps.globalThis : (typeof globalThis !== "undefined" ? globalThis : null);

  const MARKER = "SMART_COLORS_WORKBENCH_RUNTIME_V1";
  const VERSION = 1;
  const PAYLOAD_ID = "smart-colors-payload";
  const GLOBAL_NAME = "__smartColorsWorkbench";
  const FRAME_TIMEOUT_MS = 5000;
  const FRAME_COLOR_SCHEME = "light dark";
  const PHASES = ["idle", "running", "complete", "incomplete", "unavailable"];
  const COMPARISONS = ["themes", "tuning", "draft"];
  const SIDES = ["foreground", "background"];
  const MACRO_CONTROLS = [
    { name: "--color-tune-light-warmth", theme: "light", kind: "percent" },
    { name: "--color-tune-dark-warmth", theme: "dark", kind: "percent" },
    { name: "--color-tune-dark-bg-mix", theme: "dark", kind: "percent" },
    { name: "--color-tune-dark-surface-mix", theme: "dark", kind: "percent" },
    { name: "--color-tune-dark-text-mix", theme: "dark", kind: "percent" },
    { name: "--color-tune-dark-muted-mix", theme: "dark", kind: "percent" },
    { name: "--color-tune-surface-lightness-shift", theme: "light", kind: "number" },
  ];
  const FRAME_ATTRIBUTE = "data-smart-colors-workbench-frame";
  const TRIAL_ATTRIBUTE = "data-smart-colors-workbench-trial";
  const SLOT_ATTRIBUTE = "data-smart-colors-workbench-slot";
  const VARIANT_ATTRIBUTE = "data-smart-colors-workbench-variant";
  const THEME_ATTRIBUTE = "data-smart-colors-workbench-theme";
  const CSS_ATTRIBUTE = "data-smart-colors-css";
  const PROBE_HOST_ATTRIBUTE = "data-smart-colors-probes";
  const VISIBLE_FOREGROUND_ATTRIBUTE = "data-smart-colors-foreground";
  const VISIBLE_BACKGROUND_ATTRIBUTE = "data-smart-colors-background";
  const VISIBLE_PROPERTY_ATTRIBUTE = "data-smart-colors-property";
  const VISIBLE_PAIR_ATTRIBUTE = "data-smart-colors-pair";
  const VISIBLE_SPECIMEN_ATTRIBUTE = "data-smart-colors-specimen";
  const UNSUPPORTED_RESOURCE = /@import\b|url\(/i;
  const KNOWN_KNOB = /^--[A-Za-z0-9_-]+$/;
  const PERCENT = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))%$/;
  const NUMBER_ONLY = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const SKIN = '<!doctype html><html lang="it"><head><meta charset="utf-8"><body>';

  const listeners = [];
  const visibleFrames = [];
  // Each suggestion trial owns its own off-screen container and frame list, so a superseded trial
  // can clean up only its frames while a newer trial keeps running.
  const trialSessions = [];
  let leftSlot = null;
  let rightSlot = null;
  let proposalSlots = null;
  let proposal = null;
  let mounted = false;
  let destroyed = false;
  let revision = 0;
  let currentRun = null;
  let phase = "idle";
  let views = [];
  let suggestion = null;
  // Advisory exploration is deliberately separate from the primary run: its own phase, measurements
  // and errors can never confirm or block a primary pair.
  let exploration = null;
  let error = null;
  let notes = [];
  let parsedPayload = null;
  let payloadRead = { ok: false, cause: "payload-missing", message: "the inert payload block #" + PAYLOAD_ID + " is missing" };
  let contract = null;
  let selection = { pairId: null, theme: "light", comparison: "tuning" };
  let draft = {};
  let controls = [];
  let controlIndex = new Map();
  let suggestGeneration = 0;
  let preferenceQuery = null;
  let preferenceListener = null;
  let listenerAttached = false;

  // ---------------------------------------------------------------------------
  // Small serializable helpers
  // ---------------------------------------------------------------------------

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  function isArray(value) {
    return Array.isArray(value);
  }

  function finite(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    if (isArray(value)) return value.map(clone);
    if (isRecord(value)) {
      const out = {};
      for (const key of Object.keys(value)) out[key] = clone(value[key]);
      return out;
    }
    return value;
  }

  function deepFreeze(value) {
    if (isArray(value)) {
      for (const entry of value) deepFreeze(entry);
      if (!Object.isFrozen(value)) Object.freeze(value);
      return value;
    }
    if (isRecord(value)) {
      for (const key of Object.keys(value)) deepFreeze(value[key]);
      if (!Object.isFrozen(value)) Object.freeze(value);
    }
    return value;
  }

  function messageOf(value) {
    return value && value.message ? String(value.message) : String(value);
  }

  function setTimer(callback, ms) {
    if (typeof win.setTimeout === "function") return win.setTimeout(callback, ms);
    if (typeof setTimeout === "function") return setTimeout(callback, ms);
    return null;
  }

  function clearTimer(id) {
    if (id == null) return;
    if (typeof win.clearTimeout === "function") win.clearTimeout(id);
    else if (typeof clearTimeout === "function") clearTimeout(id);
  }

  function containsUnsupported(css) {
    if (typeof css !== "string" || css === "") return false;
    const active = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
    return UNSUPPORTED_RESOURCE.test(active);
  }

  function observePreference() {
    try {
      if (!win || typeof win.matchMedia !== "function") return { active: null, unmeasured: [], source: null };
      return verifier.observePreference(win);
    } catch {
      return { active: null, unmeasured: [], source: null };
    }
  }

  function cssSupports(property, value) {
    const css = win.CSS;
    if (!css || typeof css.supports !== "function") return false;
    try {
      return css.supports(property, value) === true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Payload and design controls
  // ---------------------------------------------------------------------------

  function readPayload() {
    let block = null;
    try {
      block = doc.getElementById(PAYLOAD_ID);
    } catch {
      block = null;
    }
    if (!block) {
      return { ok: false, cause: "payload-missing", message: "the inert payload block #" + PAYLOAD_ID + " is missing" };
    }
    let value;
    try {
      value = JSON.parse(block.textContent);
    } catch (cause) {
      return { ok: false, cause: "payload-invalid", message: "the payload is not valid JSON: " + messageOf(cause) };
    }
    const validation = validatePayload(value);
    if (!validation.ok) return { ok: false, cause: validation.cause, message: validation.message, value };
    return { ok: true, value };
  }

  function supportValue(css, name) {
    if (!isRecord(css)) return null;
    const direct = css[name + "Support"];
    if (typeof direct === "string") return direct;
    if (isRecord(css.support) && typeof css.support[name] === "string") return css.support[name];
    if (typeof css.support === "string" && name === "baseline") return css.support;
    return null;
  }

  function validatePayload(value) {
    const reject = (cause, message) => ({ ok: false, cause, message });
    if (!isRecord(value)) return reject("payload-invalid", "the payload must be a JSON object");
    if (value.schemaVersion !== VERSION) return reject("payload-schema", "unsupported payload schemaVersion " + String(value.schemaVersion) + "; expected " + VERSION);
    if (!isRecord(value.config)) return reject("payload-invalid", "the payload must carry a verifiable config object");
    if (!isRecord(value.css)) return reject("payload-invalid", "the payload must carry a css object");
    if (typeof value.css.baseline !== "string") return reject("payload-invalid", "css.baseline must be a string");
    // An empty captured output is never replaced by the generated candidate: nothing is measured
    // instead of silently confirming model bytes as the project's real CSS.
    if (value.css.baseline === "" && value.css.source === "output") {
      return reject("baseline-empty", "the captured output is empty; the generated candidate is never substituted, so nothing is measured");
    }
    if (value.css.baseline === "") return reject("payload-invalid", "the payload must carry non-empty baseline CSS bytes");
    if (value.css.tuning != null && typeof value.css.tuning !== "string") return reject("payload-invalid", "css.tuning must be a string or null");
    const knownSupport = ["absent", "supported", "unsupported"];
    if (value.css.tuningSupport != null && knownSupport.indexOf(value.css.tuningSupport) === -1) return reject("payload-invalid", "css.tuningSupport is not a known state");
    if (value.css.baselineSupport != null && knownSupport.indexOf(value.css.baselineSupport) === -1) return reject("payload-invalid", "css.baselineSupport is not a known state");
    if (value.css.support != null && typeof value.css.support !== "string" && !isRecord(value.css.support)) return reject("payload-invalid", "css.support must be a known state, an object or null");
    const baselineSupport = supportValue(value.css, "baseline");
    if (baselineSupport != null && knownSupport.indexOf(baselineSupport) === -1) return reject("payload-invalid", "css.support.baseline is not a known state");
    const tuningSupport = supportValue(value.css, "tuning");
    if (tuningSupport != null && knownSupport.indexOf(tuningSupport) === -1) return reject("payload-invalid", "css.support.tuning is not a known state");
    if (value.css.source != null && ["output", "generated-candidate"].indexOf(value.css.source) === -1) return reject("payload-invalid", "css.source is not a known state");
    if (value.css.status != null && ["current", "stale", "absent", "empty"].indexOf(value.css.status) === -1) return reject("payload-invalid", "css.status is not a known state");
    if (value.css.digest != null && !isRecord(value.css.digest)) return reject("payload-invalid", "css.digest must be an object or null");
    if (value.snapshotId != null && typeof value.snapshotId !== "string") return reject("payload-invalid", "snapshotId must be a string");
    if (value.toolVersion != null && typeof value.toolVersion !== "string") return reject("payload-invalid", "toolVersion must be a string");
    if (value.design != null && !isRecord(value.design)) return reject("payload-invalid", "design must be an object or null");
    if (value.design && value.design.tokens != null && !isRecord(value.design.tokens)) return reject("payload-invalid", "design.tokens must be an object");
    if (value.design && value.design.sources != null && !isArray(value.design.sources)) return reject("payload-invalid", "design.sources must be an array");
    if (value.palette != null && !isArray(value.palette) && !isRecord(value.palette)) return reject("payload-invalid", "palette must be an array, an object or null");
    if (value.paletteSource != null && !isArray(value.paletteSource) && !isRecord(value.paletteSource) && typeof value.paletteSource !== "string") return reject("payload-invalid", "paletteSource must be an array, an object, a string or null");
    return { ok: true };
  }

  function loadPayload() {
    payloadRead = readPayload();
    parsedPayload = payloadRead.value !== undefined ? payloadRead.value : null;
    if (parsedPayload) deepFreeze(parsedPayload);
    contract = null;
    if (parsedPayload && isRecord(parsedPayload.config)) {
      try {
        contract = core.createContract(parsedPayload.config);
      } catch (cause) {
        contract = null;
        if (payloadRead.ok) payloadRead = { ok: false, cause: "contract-invalid", message: "the payload config cannot form a verification contract: " + messageOf(cause) };
      }
    }
    buildControls();
    resolveInitialSelection();
    buildNotes();
    if (!payloadRead.ok) {
      phase = "unavailable";
      error = payloadRead.message;
    }
  }

  function designMetadata() {
    return parsedPayload && isRecord(parsedPayload.design) ? parsedPayload.design : null;
  }

  function buildControls() {
    const registry = [];
    const index = new Map();
    const add = (descriptor) => {
      if (!descriptor || typeof descriptor.name !== "string" || !KNOWN_KNOB.test(descriptor.name)) return;
      if (index.has(descriptor.name)) return;
      index.set(descriptor.name, descriptor);
      registry.push(descriptor);
    };
    const design = designMetadata();
    const tokens = design && isRecord(design.tokens) ? design.tokens : null;
    if (tokens) {
      for (const token of Object.keys(tokens)) {
        const binding = tokens[token];
        if (!isRecord(binding) || !isRecord(binding.controls)) continue;
        for (const theme of ["light", "dark"]) {
          const control = isRecord(binding.controls[theme]) ? binding.controls[theme] : null;
          if (!control) continue;
          if (typeof control.override === "string") {
            add({ name: control.override, theme, token, kind: "override", macro: false, defaultMix: null });
          }
          if (typeof control.mix === "string") {
            add({ name: control.mix, theme, token, kind: "mix", macro: false, defaultMix: finite(control.defaultMix) ? control.defaultMix : null });
          }
        }
      }
    }
    for (const macro of MACRO_CONTROLS) {
      add({ name: macro.name, theme: macro.theme, token: null, kind: macro.kind, macro: true, defaultMix: null });
    }
    controls = registry;
    controlIndex = index;
  }

  // ---------------------------------------------------------------------------
  // Contract, selection and provenance
  // ---------------------------------------------------------------------------

  function pairsFor(theme) {
    return contract && contract.pairs && isArray(contract.pairs[theme]) ? contract.pairs[theme] : [];
  }

  function findPair(theme, pairId) {
    if (typeof pairId !== "string" || pairId === "") return null;
    for (const pair of pairsFor(theme)) if (pair.id === pairId) return pair;
    return null;
  }

  function firstTextPairId() {
    const light = pairsFor("light");
    const first = light.find((pair) => pair.kind === "text") || light[0];
    return first ? first.id : null;
  }

  function resolveInitialSelection() {
    selection = { pairId: firstTextPairId(), theme: "light", comparison: "tuning" };
  }

  // Pair ids embed the theme (`theme|property|foreground|background`). Switching theme must keep
  // the same semantic pair, so the id and then the foreground/background/property triad are
  // normalized instead of silently selecting an unrelated row.
  function normalizePairId(pairId, theme) {
    if (typeof pairId !== "string" || pairId === "") return null;
    const target = pairsFor(theme);
    for (const pair of target) if (pair.id === pairId) return pairId;
    const parts = pairId.split("|");
    if (parts.length >= 4) {
      const reconstructed = [theme].concat(parts.slice(1)).join("|");
      for (const pair of target) if (pair.id === reconstructed) return reconstructed;
      const property = parts[1];
      const foreground = parts[2];
      const background = parts[3];
      const match = target.find((pair) => pair.property === property && pair.foreground === foreground && pair.background === background);
      if (match) return match.id;
    }
    for (const sourceTheme of ["light", "dark"]) {
      const source = findPair(sourceTheme, pairId);
      if (!source) continue;
      const match = target.find((pair) => pair.property === source.property && pair.foreground === source.foreground && pair.background === source.background);
      if (match) return match.id;
    }
    return null;
  }

  function baselineBytes() {
    const css = parsedPayload && isRecord(parsedPayload.css) ? parsedPayload.css : null;
    if (!css || typeof css.baseline !== "string" || css.baseline === "") {
      return { present: false, support: "absent", css: null, message: "the payload carries no baseline CSS bytes; nothing is measured" };
    }
    if (supportValue(css, "baseline") === "unsupported" || containsUnsupported(css.baseline)) {
      return { present: false, support: "unsupported", css: css.baseline, message: "the baseline CSS references @import or url() resources the isolated runner does not load" };
    }
    return { present: true, support: "supported", css: css.baseline, message: null };
  }

  function savedTuning() {
    const css = parsedPayload && isRecord(parsedPayload.css) ? parsedPayload.css : null;
    if (!css || typeof css.tuning !== "string" || css.tuning === "") {
      return { present: false, support: "absent", css: null, message: "no saved tuning bytes are embedded" };
    }
    if (supportValue(css, "tuning") === "unsupported" || containsUnsupported(css.tuning)) {
      return { present: false, support: "unsupported", css: css.tuning, message: "the saved tuning references @import or url() resources the isolated runner does not load" };
    }
    return { present: true, support: "supported", css: css.tuning, message: null };
  }

  function savedVariant() {
    return savedTuning().present ? "tuned" : "baseline";
  }

  // Advisory exploration catalog from the existing core contract. It is read-only and never enters
  // the primary `pairs()` surface, coverage or exit policy.
  function explorationPairs(theme) {
    if (theme !== "light" && theme !== "dark") return [];
    const source = contract && isRecord(contract.explorationPairs) ? contract.explorationPairs[theme] : null;
    return isArray(source) ? clone(source) : [];
  }

  function explorationOmitted(theme) {
    const scope = contract && isRecord(contract.explorationScope) ? contract.explorationScope : null;
    const families = scope && isRecord(scope.omittedFamilies) ? scope.omittedFamilies : null;
    return families && isArray(families[theme]) ? clone(families[theme]) : [];
  }

  function tombstoneNames(values) {
    const source = values || draft;
    return Object.keys(source).filter((name) => source[name] === "initial").sort();
  }

  function hasSavedDeclaration(control) {
    const saved = savedTuning();
    if (!saved.present || typeof saved.css !== "string") return false;
    const active = saved.css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
    return new RegExp("(^|[;{])\\s*" + escapeRegExp(control) + "\\s*:").test(active);
  }

  function visibleFrameFor(theme, variant) {
    for (const handle of visibleFrames) {
      const frame = handle && handle.frame;
      if (!frame || typeof frame.getAttribute !== "function") continue;
      if (frame.getAttribute(THEME_ATTRIBUTE) !== theme) continue;
      if (variant && frame.getAttribute(VARIANT_ATTRIBUTE) !== variant) continue;
      return handle;
    }
    return null;
  }

  // The frame whose CSS the user is actually looking at for this theme. `currentView()` is declared
  // later in the factory; function declarations are hoisted, so this is one shared rule, not a copy.
  function currentVariantFor(theme) {
    const view = currentView();
    if (view && view.theme === theme && typeof view.variant === "string") return view.variant;
    if (selection.theme === theme && selection.comparison === "draft") return "draft";
    return savedVariant();
  }

  // Resolve a real token colour in the measured frame. The scratch span is the same mechanism the
  // verifier uses for a visible pair: no RGB round-trip and no second colour model is introduced.
  function computedTokenColor(handle, token) {
    const frame = handle && handle.frame;
    const frameDocument = frame && frame.contentDocument;
    if (!frameDocument || !frameDocument.defaultView) throw new Error("the measured frame document is not available");
    const view = frameDocument.defaultView;
    if (typeof view.getComputedStyle !== "function") throw new Error("the measured frame cannot compute styles");
    const computed = resolveCssColor(frameDocument, view, "var(" + token + ")");
    if (computed === "") throw new Error(token + " resolved to an empty colour");
    return { computed, parsed: core.parseComputedColor(computed, token) };
  }

  function buildNotes() {
    const list = [];
    const baseline = baselineBytes();
    const tuning = savedTuning();
    if (baseline.support === "unsupported") list.push("The baseline references unsupported resources (@import or url()); nothing is measured.");
    if (tuning.support === "unsupported") list.push("The saved tuning references unsupported resources and is not applied; tuned comparisons fall back to the baseline.");
    if (tuning.support === "absent") list.push("No saved tuning bytes are embedded; tuned comparisons fall back to the baseline.");
    const css = parsedPayload && isRecord(parsedPayload.css) ? parsedPayload.css : null;
    if (css) {
      if (css.status === "stale") list.push("The embedded CSS is marked stale: measurements describe these bytes, not the current project inputs.");
      if (css.status === "empty") list.push("The captured output is empty: no model bytes are substituted.");
      if (css.source === "generated-candidate") list.push("The embedded CSS is the generated candidate, not the captured output on disk.");
    }
    if (!controls.some((entry) => entry.macro === false)) list.push("No per-token design controls are available; only the known macro knobs can be drafted.");
    notes = list;
  }

  function provenance() {
    const css = parsedPayload && isRecord(parsedPayload.css) ? parsedPayload.css : null;
    const design = designMetadata();
    const baseline = baselineBytes();
    const tuning = savedTuning();
    return {
      source: css && typeof css.source === "string" ? css.source : null,
      status: css && typeof css.status === "string" ? css.status : null,
      production: Boolean(css && css.production === true),
      support: { baseline: baseline.support, tuning: tuning.support },
      digest: css && isRecord(css.digest) ? clone(css.digest) : null,
      snapshotId: parsedPayload && typeof parsedPayload.snapshotId === "string" ? parsedPayload.snapshotId : null,
      toolVersion: parsedPayload && typeof parsedPayload.toolVersion === "string" ? parsedPayload.toolVersion : null,
      palette: parsedPayload && parsedPayload.paletteSource != null
        ? clone(parsedPayload.paletteSource)
        : (design && isArray(design.sources) ? clone(design.sources) : null),
      preference: observePreference(),
    };
  }

  function provenanceText() {
    const value = provenance();
    return "source: " + (value.source || "unknown") + ", status: " + (value.status || "unknown");
  }

  // ---------------------------------------------------------------------------
  // Draft state and serialization
  // ---------------------------------------------------------------------------

  function draftDeclarations(values, includeTombstones) {
    const source = values || draft;
    const lines = [];
    for (const name of Object.keys(source).sort()) {
      const value = source[name];
      if (typeof value !== "string" || value === "") continue;
      if (!KNOWN_KNOB.test(name)) continue;
      // The legacy export and any "saved file" view never receive the live tombstone keyword.
      if (!includeTombstones && value === "initial") continue;
      lines.push("  " + name + ": " + value + ";");
    }
    return lines;
  }

  function draftCssFor(values, includeTombstones) {
    const lines = draftDeclarations(values, includeTombstones === true);
    if (lines.length === 0) return "";
    return ":root {\n" + lines.join("\n") + "\n}\n";
  }

  // Legacy fragment: unsaved draft only, never a tombstone and never a claim to be the whole file.
  function exportTuning() {
    return draftCssFor(draft, false);
  }

  // ---------------------------------------------------------------------------
  // Source-aware tuning export
  //
  // A conservative scanner, not a CSS parser: comments and strings are masked before any structural
  // search, braces delimit blocks, and an edited declaration is only patched when it is unique and
  // lives in a top-level `:root` (there may be several). Anything ambiguous is a declared fragment;
  // the original user file is never deleted or rebuilt.
  // ---------------------------------------------------------------------------

  function scanCssStructure(text) {
    const source = String(text);
    const mask = source.split("");
    const blocks = [];
    const comments = [];
    const stack = [];
    let statementStart = 0;
    let index = 0;
    let malformed = false;
    const blank = (at) => {
      if (at >= 0 && at < mask.length && mask[at] !== "\n") mask[at] = " ";
    };
    while (index < source.length) {
      const character = source[index];
      if (character === "/" && source[index + 1] === "*") {
        const commentStart = index;
        blank(index);
        blank(index + 1);
        index += 2;
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
          blank(index);
          index += 1;
        }
        if (index < source.length) {
          blank(index);
          blank(index + 1);
          index += 2;
          comments.push({ start: commentStart, end: index });
        } else {
          malformed = true;
        }
        continue;
      }
      if (character === "\"" || character === "'") {
        const quote = character;
        blank(index);
        index += 1;
        let closed = false;
        while (index < source.length) {
          if (source[index] === "\\") {
            blank(index);
            blank(index + 1);
            index += 2;
            continue;
          }
          if (source[index] === quote) {
            blank(index);
            index += 1;
            closed = true;
            break;
          }
          blank(index);
          index += 1;
        }
        if (!closed) malformed = true;
        continue;
      }
      if (character === "{") {
        const block = { selector: mask.slice(statementStart, index).join("").trim(), open: index, close: -1, depth: stack.length };
        blocks.push(block);
        stack.push(block);
        statementStart = index + 1;
        index += 1;
        continue;
      }
      if (character === "}") {
        const block = stack.pop();
        if (block) block.close = index;
        else malformed = true;
        statementStart = index + 1;
        index += 1;
        continue;
      }
      if (character === ";") statementStart = index + 1;
      index += 1;
    }
    if (stack.length > 0) malformed = true;
    return { mask: mask.join(""), blocks, comments, malformed };
  }

  function enclosingBlock(blocks, index) {
    let best = null;
    for (const block of blocks) {
      if (block.close <= block.open) continue;
      if (block.open < index && index < block.close) {
        if (!best || (block.close - block.open) < (best.close - best.open)) best = block;
      }
    }
    return best;
  }

  function scanDeclarations(text, mask, blocks, comments) {
    const pattern = /(^|[;{])\s*(--[A-Za-z0-9_-]+)\s*:/g;
    const declarations = [];
    const commentRanges = isArray(comments) ? comments : [];
    let malformed = false;
    let match;
    while ((match = pattern.exec(mask))) {
      const name = match[2];
      const nameStart = mask.indexOf(name, match.index);
      const colon = mask.indexOf(":", nameStart + name.length);
      const block = enclosingBlock(blocks, nameStart);
      if (colon === -1 || !block || block.close <= nameStart) {
        malformed = true;
        continue;
      }
      const semicolon = mask.indexOf(";", colon + 1);
      if (semicolon === -1 || semicolon > block.close) {
        malformed = true;
        continue;
      }
      let valueStart = colon + 1;
      while (valueStart < semicolon && /\s/.test(mask[valueStart])) valueStart += 1;
      let valueEnd = semicolon;
      while (valueEnd > valueStart && /\s/.test(mask[valueEnd - 1])) valueEnd -= 1;
      const declarationEnd = semicolon + 1;
      const hasComment = commentRanges.some((comment) => comment.start < declarationEnd && comment.end > nameStart);
      declarations.push({
        name,
        start: nameStart,
        end: declarationEnd,
        valueStart,
        valueEnd,
        // The mask blanks comments and strings, so `! /* hint */ important` cannot hide precedence.
        important: /!\s*important\s*$/i.test(mask.slice(colon + 1, semicolon).trimEnd()),
        comment: hasComment,
        block,
      });
    }
    return { declarations, malformed };
  }

  function patchTuningText(base, values) {
    const text = String(base);
    const edited = Object.keys(values).filter((name) => typeof values[name] === "string" && values[name] !== "").sort();
    if (edited.length === 0) return { ok: true, css: text, unmatched: [] };

    const scan = scanCssStructure(text);
    if (scan.malformed) {
      return { ok: false, reason: "unbalanced braces, comments or strings; no complete file was produced", unmatched: [] };
    }
    if (scan.blocks.some((block) => block.close === -1)) {
      return { ok: false, reason: "unclosed CSS block; no complete file was produced", unmatched: [] };
    }
    // An active escape can spell the same custom property with a different source text; the plain
    // control name would no longer prove which declaration is edited. Refuse rather than guess.
    if (scan.mask.indexOf("\\") !== -1) {
      return { ok: false, reason: "active CSS escapes make declaration precedence ambiguous", unmatched: [] };
    }
    // Multiple top-level `:root` blocks are legitimate (macro + elevation). Patch only a globally
    // unique knob inside one of them; duplicates and conditional/nested declarations stay fragments.
    const roots = scan.blocks.filter((block) => block.depth === 0 && block.selector === ":root" && block.close > block.open);
    const appendRoot = roots.length > 0 ? roots[roots.length - 1] : null;
    const scanned = scanDeclarations(text, scan.mask, scan.blocks, scan.comments);
    if (scanned.malformed) {
      return { ok: false, reason: "unparseable declaration; no complete file was produced", unmatched: [] };
    }

    const unmatched = [...new Set(scanned.declarations
      .filter((declaration) => /^--color-tune-/.test(declaration.name) && !controlIndex.has(declaration.name))
      .map((declaration) => declaration.name))].sort();
    const operations = [];
    const missing = [];

    for (const name of edited) {
      const found = scanned.declarations.filter((declaration) => declaration.name === name);
      if (found.length > 1) {
        return { ok: false, reason: "duplicate declaration for " + name + "; precedence is ambiguous", unmatched };
      }
      if (found.length === 1) {
        if (!roots.includes(found[0].block)) {
          return { ok: false, reason: name + " is declared outside a top-level :root; conditional or selector precedence is ambiguous", unmatched };
        }
        if (found[0].important) {
          return { ok: false, reason: name + " uses !important; the workbench does not rewrite important precedence", unmatched };
        }
        if (found[0].comment) {
          return { ok: false, reason: name + " contains an author comment inside the declaration; it is not rewritten", unmatched };
        }
        if (values[name] === "initial") operations.push({ start: found[0].start, end: found[0].end, text: "" });
        else operations.push({ start: found[0].valueStart, end: found[0].valueEnd, text: values[name] });
        continue;
      }
      // A name that exists in the masked source but did not parse is not safe to patch.
      if (scan.mask.indexOf(name) !== -1) {
        return { ok: false, reason: name + " has an unparseable declaration", unmatched };
      }
      if (values[name] !== "initial") missing.push(name);
    }

    if (!appendRoot) {
      const substantive = scan.mask.replace(/\s+/g, "");
      if (substantive !== "") {
        return { ok: false, reason: "no top-level :root block; a new root would be ambiguous", unmatched };
      }
      if (!missing.length) return { ok: true, css: text, unmatched };
      const lines = missing.map((name) => "  " + name + ": " + values[name] + ";");
      const ending = text === "" || text.endsWith("\n") ? "" : "\n";
      return { ok: true, css: text + ending + ":root {\n" + lines.join("\n") + "\n}\n", unmatched };
    }

    if (missing.length) {
      const lines = missing.map((name) => "  " + name + ": " + values[name] + ";");
      // New declarations go to the last top-level root; existing bytes stay untouched.
      operations.push({ start: appendRoot.close, end: appendRoot.close, text: "\n" + lines.join("\n") + "\n" });
    }
    operations.sort((left, right) => right.start - left.start || right.end - left.end);
    let css = text;
    for (const operation of operations) css = css.slice(0, operation.start) + operation.text + css.slice(operation.end);
    return { ok: true, css, unmatched };
  }

  // Read-only analysis used when there are no edits: it never changes the bytes, but it still
  // reports saved overrides that no longer belong to a current control. Unsupported or ambiguous
  // sources return the exact bytes with an explicit warning instead of a fabricated orphan list.
  function analyzeTuningText(text) {
    const scan = scanCssStructure(text);
    if (scan.malformed) return { ok: false, reason: "unbalanced braces, comments or strings" };
    if (scan.mask.indexOf("\\") !== -1) return { ok: false, reason: "active CSS escapes make declaration analysis ambiguous" };
    const scanned = scanDeclarations(text, scan.mask, scan.blocks, scan.comments);
    if (scanned.malformed) return { ok: false, reason: "unparseable declaration" };
    const unmatched = [...new Set(scanned.declarations
      .filter((declaration) => /^--color-tune-/.test(declaration.name) && !controlIndex.has(declaration.name))
      .map((declaration) => declaration.name))].sort();
    return { ok: true, unmatched };
  }

  function exportTuningFile() {
    const removed = tombstoneNames(draft);
    if (!payloadRead.ok || !parsedPayload) {
      return { css: "", mode: "unavailable", warnings: [payloadRead.message || "the payload is unavailable"], removed, unmatched: [] };
    }
    const saved = savedTuning();
    // `present` describes whether the bytes are applied; an unsupported saved file still exists and
    // must be returned exactly when there are no edits.
    const base = typeof saved.css === "string" ? saved.css : "";
    const edits = Object.keys(draft).filter((name) => typeof draft[name] === "string" && draft[name] !== "");
    if (edits.length === 0) {
      const warnings = [];
      if (base === "") warnings.push("Nessun file di tuning salvato: il testo restituito è la sorgente esatta disponibile.");
      if (saved.support === "unsupported") warnings.push("Il tuning salvato non è applicato (unsupported): i byte sono restituiti esatti e nessuna patch viene proposta.");
      const analysis = analyzeTuningText(base);
      if (!analysis.ok) {
        // `complete` is the whole saved file verbatim, not a verified interpretation.
        warnings.push("Analisi degli override salvati non disponibile: " + analysis.reason + ". Il file salvato è restituito esatto e completo; l'interpretazione non è verificata.");
      } else if (analysis.unmatched.length) {
        warnings.push("Override salvati non più corrispondenti a un controllo corrente (non rimossi): " + analysis.unmatched.join(", ") + ".");
      }
      return {
        css: base,
        mode: "complete",
        warnings,
        removed,
        unmatched: analysis.ok ? analysis.unmatched : [],
      };
    }
    if (saved.support === "unsupported") {
      return {
        css: draftCssFor(draft, false),
        mode: "fragment",
        warnings: ["Il tuning salvato contiene @import o url(): non viene riscritto. Esportato solo il frammento della bozza." + (removed.length ? " Rimozioni non applicate al file salvato: " + removed.join(", ") + "." : "")],
        removed,
        unmatched: [],
      };
    }
    const patch = patchTuningText(base, draft);
    if (!patch.ok) {
      return {
        css: draftCssFor(draft, false),
        mode: "fragment",
        warnings: [patch.reason + ". Esportato solo il frammento della bozza." + (removed.length ? " Rimozioni non applicate al file salvato: " + removed.join(", ") + "." : "")],
        removed,
        unmatched: patch.unmatched,
      };
    }
    const warnings = [];
    if (!saved.present) warnings.push("Nessun file di tuning salvato: creato un nuovo :root con i soli override della bozza.");
    if (patch.unmatched.length) warnings.push("Override salvati non più corrispondenti a un controllo corrente (non rimossi): " + patch.unmatched.join(", ") + ".");
    return { css: patch.css, mode: "complete", warnings, removed, unmatched: patch.unmatched };
  }

  // A successful public edit always shows its result: the draft comparison becomes the displayed
  // one before the next measurement. Error paths never call this.
  function showDraft() {
    selection = { pairId: selection.pairId, theme: selection.theme, comparison: "draft" };
  }

  function rerun(reason) {
    revision += 1;
    suggestion = null;
    exploration = null;
    views = [];
    phase = mounted ? "running" : "idle";
    error = null;
    destroyVisibleFrames();
    destroyTrialFrames();
    destroyProposalFrames();
    publish(reason);
    if (!mounted || destroyed) {
      currentRun = Promise.resolve(state());
      return currentRun;
    }
    const token = revision;
    currentRun = run(token).catch((cause) => {
      if (token !== revision || destroyed) return state();
      phase = "incomplete";
      error = "the run failed: " + messageOf(cause);
      publish("run-error");
      return state();
    });
    return currentRun;
  }

  // A user mutation also cancels any in-flight suggestion trial. An internal re-render (the
  // transparent suggestion switch) uses `rerun` instead, so it does not cancel the call that asked
  // for it.
  function invalidateDraftState(reason) {
    suggestGeneration += 1;
    return rerun(reason);
  }

  function setError(message) {
    error = String(message);
    publish("error");
    return state();
  }

  // ---------------------------------------------------------------------------
  // Frames
  // ---------------------------------------------------------------------------

  function appendStyle(frameDocument, kind, text) {
    const style = frameDocument.createElement("style");
    style.setAttribute(CSS_ATTRIBUTE, kind);
    style.textContent = text;
    (frameDocument.head || frameDocument.documentElement).appendChild(style);
    return style;
  }

  function injectCssFor(frameDocument, variant, values, extraValues) {
    const baseline = baselineBytes();
    if (!baseline.present) return;
    appendStyle(frameDocument, "baseline", "@layer tokens {\n" + baseline.css + "\n}");
    const tuning = savedTuning();
    if ((variant === "tuned" || variant === "draft") && tuning.present) {
      appendStyle(frameDocument, "tuning", "@layer tokens {\n" + tuning.css + "\n}");
    }
    if (variant === "draft") {
      const css = draftCssFor(values, true);
      if (css !== "") appendStyle(frameDocument, "draft", "@layer tokens {\n" + css + "}");
    }
    // Trial-only declaration(s) are injected after the base variant, whatever that variant is, so a
    // suggestion is verified against the CSS the user actually sees plus the candidate control.
    if (extraValues) {
      const extra = draftCssFor(extraValues, true);
      if (extra !== "") appendStyle(frameDocument, "draft-trial", "@layer tokens {\n" + extra + "}");
    }
  }

  function createFrame(descriptor, parent, kind, collection) {
    const frame = doc.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("title", descriptor.label || ("Smart Colors workbench " + descriptor.slot + " " + descriptor.variant + " " + descriptor.theme));
    frame.setAttribute(FRAME_ATTRIBUTE, kind === "trial" ? "trial" : (kind === "proposal" ? "proposal" : "visible"));
    frame.setAttribute(SLOT_ATTRIBUTE, descriptor.slot);
    frame.setAttribute(VARIANT_ATTRIBUTE, descriptor.variant);
    frame.setAttribute(THEME_ATTRIBUTE, descriptor.theme);
    // The carrier declares both schemes BEFORE `srcdoc` starts navigation: a host UI that pins a
    // single scheme would otherwise force the child media query to that scheme.
    frame.style.colorScheme = FRAME_COLOR_SCHEME;
    frame.style.display = "block";
    frame.style.border = "0";
    if (kind === "trial") {
      frame.style.position = "absolute";
      frame.style.insetInlineStart = "-10000px";
      frame.style.inlineSize = "360px";
      frame.style.blockSize = "480px";
    } else if (kind === "proposal") {
      // Visible, but exactly the trial viewport (360x480): the displayed proposal must be measured
      // under the same conditions as the verification, never a differently sized media condition.
      frame.style.inlineSize = "360px";
      frame.style.blockSize = "480px";
    } else {
      frame.style.inlineSize = "100%";
      frame.style.minBlockSize = "200px";
    }
    let settle = null;
    const ready = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      if (typeof frame.removeEventListener === "function") frame.removeEventListener("load", onLoad);
    };
    function onLoad() {
      if (settled) return;
      settled = true;
      cleanup();
      const frameDocument = frame.contentDocument;
      if (frameDocument && frameDocument.documentElement) settle.resolve(frameDocument);
      else settle.reject(new Error("frame-document-unavailable"));
    }
    if (typeof frame.addEventListener === "function") frame.addEventListener("load", onLoad);
    timer = setTimer(() => {
      if (settled) return;
      settled = true;
      cleanup();
      settle.reject(new Error("frame-timeout"));
    }, FRAME_TIMEOUT_MS);
    frame.setAttribute("srcdoc", SKIN);
    parent.appendChild(frame);
    const list = collection || (kind === "visible" ? visibleFrames : null);
    const handle = {
      frame,
      ready,
      kind,
      discard(cancelPending) {
        cleanup();
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        if (list) {
          const index = list.indexOf(handle);
          if (index !== -1) list.splice(index, 1);
        }
        if (cancelPending && !settled) {
          settled = true;
          settle.reject(new Error("frame-discarded"));
        }
      },
    };
    if (list) list.push(handle);
    return handle;
  }

  function destroyVisibleFrames() {
    for (const handle of visibleFrames.slice()) handle.discard(true);
    visibleFrames.length = 0;
  }

  // Proposal frames are the visible base/candidate comparison. They belong to one suggestion
  // generation, so a superseded (older) search can never remove the frames a newer one created.
  function destroyProposalFrames(generation) {
    if (!proposal) return;
    if (generation !== undefined && proposal.generation !== generation) return;
    for (const handle of proposal.frames.slice()) handle.discard(true);
    proposal = null;
  }

  function previewLabels() {
    return { before: "Base corrente", after: "Candidato" };
  }

  function proposalMounted() {
    return Boolean(proposalSlots && proposalSlots.before && proposalSlots.after);
  }

  // Render the CURRENT base (saved tuning or the real current draft) and the CANDIDATE into two
  // separate visible frames with the same `var()` specimen and the exact bytes the trial verified.
  // The draft is never touched. The visible frames are measured and must reproduce the verified
  // ratios; otherwise the preview (and the positive claim) fails closed.
  async function renderProposal(context) {
    if (!proposalMounted()) return { preview: null };
    const generation = context.generation;
    const staleNow = () => destroyed || generation !== suggestGeneration;
    if (staleNow()) return { stale: true };
    destroyProposalFrames();
    proposal = { generation, frames: [] };
    const entries = [
      { mode: "before", slot: "proposal-before", container: proposalSlots.before, label: previewLabels().before },
      { mode: "after", slot: "proposal-after", container: proposalSlots.after, label: previewLabels().after },
    ];
    const jobs = entries.map((entry) => {
      const descriptor = { slot: entry.slot, theme: context.view.theme, variant: context.baseVariant, pairId: context.pair.id, label: entry.label };
      const scenario = {
        id: "proposal-" + entry.mode + "-" + context.view.theme,
        theme: context.view.theme,
        variant: context.baseVariant,
        preference: observePreference().active,
      };
      const handle = createFrame(descriptor, entry.container, "proposal", proposal.frames);
      return (async () => {
        try {
          const frameDocument = await handle.ready;
          if (staleNow()) return { mode: entry.mode, stale: true };
          const values = draft;
          if (entry.mode === "before") injectCssFor(frameDocument, context.baseVariant, values);
          else injectCssFor(frameDocument, context.baseVariant, values, { [context.control]: context.candidateValue });
          const specimen = buildSpecimen(frameDocument, context.pair);
          const measured = verifier.measureDocument(frameDocument, scenario, contract, { elements: specimen.elements });
          markTechnicalProbes(frameDocument);
          return { mode: entry.mode, measured };
        } catch (cause) {
          return { mode: entry.mode, error: messageOf(cause) };
        }
      })();
    });
    const results = await Promise.all(jobs);
    if (staleNow()) {
      destroyProposalFrames(generation);
      return { stale: true };
    }
    const byMode = new Map();
    for (const entry of results) {
      if (!entry || entry.stale) {
        destroyProposalFrames(generation);
        return { stale: true };
      }
      if (entry.error || !entry.measured || entry.measured.support !== "supported") {
        destroyProposalFrames(generation);
        return { failClosed: true, reason: "the visible proposal frames could not be measured at the displayed size", preview: { status: "unavailable", theme: context.view.theme, labels: previewLabels(), reason: "the visible proposal frames could not be measured" } };
      }
      byMode.set(entry.mode, entry.measured);
    }
    const beforeMeasurement = measurementMap(byMode.get("before")).get(context.pair.id);
    const afterMeasurement = measurementMap(byMode.get("after")).get(context.pair.id);
    if (!beforeMeasurement || !afterMeasurement || beforeMeasurement.status === "unmeasured" || afterMeasurement.status === "unmeasured" || !finite(beforeMeasurement.ratio) || !finite(afterMeasurement.ratio)) {
      destroyProposalFrames(generation);
      return { failClosed: true, reason: "the visible proposal frames did not measure the selected pair", preview: { status: "unavailable", theme: context.view.theme, labels: previewLabels(), reason: "the visible proposal frames did not measure the selected pair" } };
    }
    const matches = Math.abs(beforeMeasurement.ratio - context.suggestion.before) <= 1e-3
      && Math.abs(afterMeasurement.ratio - context.suggestion.after) <= 1e-3;
    if (!matches) {
      destroyProposalFrames(generation);
      return { failClosed: true, reason: "the visible proposal frames measure differently from the verified trial; no positive preview is shown", preview: { status: "unavailable", theme: context.view.theme, labels: previewLabels(), reason: "the visible proposal frames measure differently from the verified trial" } };
    }
    return {
      preview: {
        status: "shown",
        theme: context.view.theme,
        labels: previewLabels(),
        before: beforeMeasurement.ratio,
        after: afterMeasurement.ratio,
      },
    };
  }

  function createTrialContainer() {
    const container = doc.createElement("div");
    container.setAttribute(TRIAL_ATTRIBUTE, "");
    container.setAttribute("aria-hidden", "true");
    container.style.position = "absolute";
    container.style.inlineSize = "0";
    container.style.blockSize = "0";
    container.style.overflow = "hidden";
    container.style.pointerEvents = "none";
    (doc.body || doc.documentElement).appendChild(container);
    return container;
  }

  function destroyTrialSession(session) {
    for (const handle of session.frames.slice()) handle.discard(true);
    if (session.container && session.container.parentNode) session.container.parentNode.removeChild(session.container);
    const index = trialSessions.indexOf(session);
    if (index !== -1) trialSessions.splice(index, 1);
  }

  function destroyTrialFrames() {
    for (const session of trialSessions.slice()) destroyTrialSession(session);
    trialSessions.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Visible specimen
  // ---------------------------------------------------------------------------

  // The frame shows exactly one consumer for the selected pair. The primary surface is a human
  // sample only: token names, usage strings and property metadata stay in data attributes and in
  // the host's closed details, never in the visible copy. There is no unrelated overview strip: a
  // generic neutral/primary sample would give a false focus and context for a palette the user did
  // not select.
  function specimenCss() {
    return [
      "html, body { margin: 0; padding: 0; }",
      "body { padding: 16px; font: 16px/1.5 system-ui, sans-serif; background: var(--color-bg, Canvas); color: var(--color-text, CanvasText); }",
      ".scw-specimen { display: grid; min-inline-size: 0; }",
      ".scw-specimen-empty { margin: 0; font-size: 14px; line-height: 1.5; }",
      ".scw-selected { box-sizing: border-box; max-inline-size: 100%; margin: 0; padding: 24px; border-radius: 8px; font: inherit; overflow-wrap: break-word; }",
      // Border and outline samples are pure geometry: no text and no fake control. The sample box
      // keeps a deterministic size so the complete ring is painted, never a zero-height line.
      ".scw-selected-ring { padding: 0; inline-size: 100%; block-size: 48px; }",
      ".scw-selected-title { margin: 0 0 8px; font-size: 22px; line-height: 1.25; font-weight: 650; }",
      ".scw-selected-text { margin: 0; font-size: 16px; line-height: 1.55; }",
      // The technical probe host is pushed out of flow and out of the accessibility tree. It stays
      // rendered (never `display:none`) so every collateral pair is still computed, and it never
      // contains the selected visible specimen.
      "[" + PROBE_HOST_ATTRIBUTE + "] { position: absolute; inset-block-start: 0; inset-inline-start: -10000px; inline-size: 1px; block-size: 1px; overflow: hidden; }",
      "",
    ].join("\n");
  }

  function selectedSpecimen(frameDocument, pair) {
    if (!pair) return null;
    const wrapper = frameDocument.createElement("div");
    let node;
    if (pair.kind === "on-color") {
      node = frameDocument.createElement("button");
      node.type = "button";
      node.tabIndex = -1;
      node.setAttribute("aria-label", "Esempio non interattivo: Un messaggio da leggere");
      node.textContent = "Un messaggio da leggere";
      node.style.appearance = "none";
      node.style.border = "0";
    } else if (pair.property === "borderColor") {
      // Static geometry, not a control: a border sample proves the painted colour only.
      node = frameDocument.createElement("div");
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", "Campione statico del bordo: mostra solo il colore del bordo rispetto allo sfondo, non il comportamento di focus.");
      node.style.borderStyle = "solid";
      node.style.borderWidth = "2px";
    } else if (pair.property === "outlineColor") {
      // Static geometry, not a focusable control: the ring is shown to verify colour adjacency,
      // never to test focus behaviour.
      node = frameDocument.createElement("div");
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", "Campione statico dell'anello: mostra solo il colore dell'anello rispetto allo sfondo, non il comportamento di focus.");
      node.style.outlineStyle = "solid";
      node.style.outlineWidth = "3px";
      node.style.outlineOffset = "2px";
    } else {
      node = frameDocument.createElement("article");
      const title = frameDocument.createElement("h2");
      title.className = "scw-selected-title";
      title.textContent = "Le modifiche sono pronte";
      const paragraph = frameDocument.createElement("p");
      paragraph.className = "scw-selected-text";
      paragraph.textContent = "Controlla i dettagli prima di continuare. Puoi modificare questa scelta in qualsiasi momento.";
      node.appendChild(title);
      node.appendChild(paragraph);
    }
    node.className = pair.property === "borderColor" || pair.property === "outlineColor" ? "scw-selected scw-selected-ring" : "scw-selected";
    node.setAttribute(VISIBLE_SPECIMEN_ATTRIBUTE, "selected");
    node.setAttribute(VISIBLE_PAIR_ATTRIBUTE, pair.id);
    node.setAttribute(VISIBLE_FOREGROUND_ATTRIBUTE, pair.foreground);
    node.setAttribute(VISIBLE_BACKGROUND_ATTRIBUTE, pair.background);
    node.setAttribute(VISIBLE_PROPERTY_ATTRIBUTE, pair.property);
    node.style.color = "var(" + pair.foreground + ")";
    node.style.backgroundColor = "var(" + pair.background + ")";
    if (pair.property === "borderColor") {
      node.style.borderColor = "var(" + pair.foreground + ")";
      node.style.color = "inherit";
    }
    if (pair.property === "outlineColor") {
      node.style.outlineColor = "var(" + pair.foreground + ")";
      node.style.color = "inherit";
    }
    if (pair.property === "borderColor" || pair.property === "outlineColor") {
      // A border's outer edge and an offset outline live OUTSIDE the node's own box. Without this
      // wrapper they would sit on the frame canvas (--color-bg), while the reported ratio is the
      // pair's background token. The padded wrapper paints the measured surface around the whole
      // ring, and its padding is larger than the outline offset + width so the ring always fits.
      wrapper.style.padding = "12px";
      wrapper.style.backgroundColor = "var(" + pair.background + ")";
      wrapper.style.borderRadius = "8px";
    }
    wrapper.appendChild(node);
    return { wrapper, node };
  }

  function buildSpecimen(frameDocument, pair) {
    const style = frameDocument.createElement("style");
    style.setAttribute("data-smart-colors-specimen-style", "");
    style.textContent = specimenCss();
    (frameDocument.head || frameDocument.documentElement).appendChild(style);

    const section = frameDocument.createElement("section");
    section.className = "scw-specimen";
    section.setAttribute("lang", "it");
    section.setAttribute("aria-label", "Esempio visivo");
    const selected = selectedSpecimen(frameDocument, pair);
    if (selected) {
      section.appendChild(selected.wrapper);
    } else {
      const empty = frameDocument.createElement("p");
      empty.className = "scw-specimen-empty";
      empty.textContent = "Nessuna coppia selezionata.";
      section.appendChild(empty);
    }
    (frameDocument.body || frameDocument.documentElement).appendChild(section);

    const elements = new Map();
    if (selected && pair) elements.set(pair.id, selected.node);
    return { elements, section, node: selected ? selected.node : null };
  }

  // The probe host is technical: offscreen, `aria-hidden` and `inert`. It is never removed and the
  // selected visible specimen is never inside it, so collateral measurements stay complete.
  function markTechnicalProbes(frameDocument) {
    const host = frameDocument.querySelector("[" + PROBE_HOST_ATTRIBUTE + "]");
    if (!host) return;
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("inert", "");
  }

  // ---------------------------------------------------------------------------
  // Draft application check
  // ---------------------------------------------------------------------------

  function resolveCssColor(frameDocument, view, cssValue) {
    const scratch = frameDocument.createElement("span");
    scratch.style.color = cssValue;
    (frameDocument.body || frameDocument.documentElement).appendChild(scratch);
    const computed = trim(view.getComputedStyle(scratch).color);
    if (typeof scratch.remove === "function") scratch.remove();
    return computed;
  }

  function sameParsedColor(first, second) {
    try {
      const left = core.parseComputedColor(first, "draft value");
      const right = core.parseComputedColor(second, "draft value");
      if (Math.abs(left.l - right.l) > 1e-6) return false;
      if (Math.abs(left.c - right.c) > 1e-6) return false;
      const hue = Math.abs(left.h - right.h);
      return Math.min(hue, 360 - hue) <= 1e-6;
    } catch {
      return false;
    }
  }

  function percentNumber(value) {
    const match = PERCENT.exec(trim(value));
    if (!match) return null;
    const number = Number(match[1]);
    return Number.isFinite(number) ? number : null;
  }

  // A draft that is blocked by an unrelated `!important` declaration must be visible: the computed
  // custom property on the isolated root is compared with the declared draft value.
  function verifyDraftApplied(frameDocument) {
    const view = frameDocument.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") return [];
    const rootStyle = view.getComputedStyle(frameDocument.documentElement);
    const errors = [];
    for (const name of Object.keys(draft).sort()) {
      const descriptor = controlIndex.get(name);
      if (!descriptor) continue;
      const expected = draft[name];
      const actual = trim(rootStyle.getPropertyValue(name));
      // A tombstone is a guaranteed-invalid custom property: the computed root must be empty so a
      // `var(--knob, fallback)` reads the generated fallback. A stronger `!important` rule is named.
      if (expected === "initial") {
        if (actual !== "") {
          errors.push({ phase: "draft", cause: "draft-not-applied", knob: name, message: name + " tombstone is blocked by a stronger declaration: " + actual });
        }
        continue;
      }
      if (actual === "") {
        errors.push({ phase: "draft", cause: "draft-not-applied", knob: name, message: name + " was drafted but is not declared on the isolated root" });
        continue;
      }
      if (descriptor.kind === "override") {
        const actualColor = resolveCssColor(frameDocument, view, "var(" + name + ")");
        const expectedColor = resolveCssColor(frameDocument, view, expected);
        if (!sameParsedColor(actualColor, expectedColor)) {
          errors.push({ phase: "draft", cause: "draft-not-applied", knob: name, message: name + " was drafted but the applied value is " + actual + " instead of " + expected });
        }
      } else if (descriptor.kind === "mix" || descriptor.kind === "percent") {
        const actualValue = percentNumber(actual);
        const expectedValue = percentNumber(expected);
        if (actualValue === null || expectedValue === null || Math.abs(actualValue - expectedValue) > 1e-4) {
          errors.push({ phase: "draft", cause: "draft-not-applied", knob: name, message: name + " was drafted but the applied value is " + actual + " instead of " + expected });
        }
      } else if (descriptor.kind === "number") {
        const actualValue = Number(actual);
        const expectedValue = Number(expected);
        if (!Number.isFinite(actualValue) || !Number.isFinite(expectedValue) || Math.abs(actualValue - expectedValue) > 1e-9) {
          errors.push({ phase: "draft", cause: "draft-not-applied", knob: name, message: name + " was drafted but the applied value is " + actual + " instead of " + expected });
        }
      }
    }
    return errors;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  function plan() {
    const comparison = COMPARISONS.indexOf(selection.comparison) !== -1 ? selection.comparison : "tuning";
    const theme = selection.theme === "dark" ? "dark" : "light";
    const saved = savedVariant();
    if (comparison === "themes") {
      return [
        { slot: "left", theme: "light", variant: saved, pairId: normalizePairId(selection.pairId, "light") },
        { slot: "right", theme: "dark", variant: saved, pairId: normalizePairId(selection.pairId, "dark") },
      ];
    }
    if (comparison === "draft") {
      return [
        { slot: "left", theme, variant: saved, pairId: normalizePairId(selection.pairId, theme) },
        { slot: "right", theme, variant: "draft", pairId: normalizePairId(selection.pairId, theme) },
      ];
    }
    return [
      { slot: "left", theme, variant: "baseline", pairId: normalizePairId(selection.pairId, theme) },
      { slot: "right", theme, variant: saved, pairId: normalizePairId(selection.pairId, theme) },
    ];
  }

  function scenarioIdFor(descriptor) {
    return "workbench-" + descriptor.slot + "-" + descriptor.variant + "-" + descriptor.theme;
  }

  function viewShell(descriptor, pair) {
    return {
      slot: descriptor.slot,
      theme: descriptor.theme,
      variant: descriptor.variant,
      pair: pair ? clone(pair) : null,
      measurement: null,
      measurements: [],
      errors: [],
      scenarioId: scenarioIdFor(descriptor),
    };
  }

  // Additive metadata: the shared core parses the browser serialization into {l,c,h}, or null.
  function oklchMetadata(value) {
    try {
      const parsed = core.parseComputedColor(value, "workbench measurement");
      return { l: parsed.l, c: parsed.c, h: parsed.h };
    } catch (cause) {
      return null;
    }
  }

  function withOklchMetadata(entry) {
    const next = clone(entry);
    next.foregroundOklch = oklchMetadata(entry.foreground);
    next.backgroundOklch = oklchMetadata(entry.background);
    return next;
  }

  async function renderView(descriptor, token) {
    const pair = findPair(descriptor.theme, descriptor.pairId);
    const view = viewShell(descriptor, pair);
    if (!payloadRead.ok) {
      view.errors.push({ phase: "payload", cause: payloadRead.cause, scenarioId: view.scenarioId, pairId: pair ? pair.id : null, message: payloadRead.message });
      return view;
    }
    const baseline = baselineBytes();
    if (!baseline.present) {
      view.errors.push({
        phase: "css",
        cause: baseline.support === "unsupported" ? "unsupported-resource" : "baseline-empty",
        scenarioId: view.scenarioId,
        pairId: pair ? pair.id : null,
        message: baseline.message,
      });
      return view;
    }
    if (!contract) {
      view.errors.push({ phase: "contract", cause: "contract-missing", scenarioId: view.scenarioId, pairId: null, message: "the payload config does not form a verification contract" });
      return view;
    }
    if (!pair) {
      view.errors.push({ phase: "selection", cause: "pair-missing", scenarioId: view.scenarioId, pairId: null, message: "pair " + String(descriptor.pairId) + " is not declared in theme " + descriptor.theme });
      return view;
    }
    const slot = descriptor.slot === "left" ? leftSlot : rightSlot;
    if (!mounted || destroyed || !slot) {
      view.errors.push({ phase: "mount", cause: "slot-missing", scenarioId: view.scenarioId, pairId: pair.id, message: "the " + descriptor.slot + " mount slot is not available" });
      return view;
    }
    const preference = observePreference();
    const scenario = {
      id: view.scenarioId,
      theme: descriptor.theme,
      variant: descriptor.variant,
      preference: preference.active,
    };
    let handle = null;
    try {
      handle = createFrame(descriptor, slot, "visible");
      const frameDocument = await handle.ready;
      if (token !== revision || destroyed) {
        handle.discard(false);
        return null;
      }
      injectCssFor(frameDocument, descriptor.variant, draft);
      const specimen = buildSpecimen(frameDocument, pair);
      const draftErrors = descriptor.variant === "draft" ? verifyDraftApplied(frameDocument) : [];
      const measured = verifier.measureDocument(frameDocument, scenario, contract, { elements: specimen.elements });
      markTechnicalProbes(frameDocument);
      view.support = measured.support;
      view.colorScheme = measured.colorScheme;
      view.observedPreference = measured.observedPreference;
      view.measurements = measured.measurements.map(withOklchMetadata);
      view.errors = measured.errors.concat(draftErrors);
      view.measurement = view.measurements.find((entry) => entry.pairId === pair.id) || null;
      if (measured.support !== "supported" && measured.error) {
        view.errors.push({ phase: "measure", cause: "unsupported-document", scenarioId: view.scenarioId, pairId: pair.id, message: measured.error });
      }
      return view;
    } catch (cause) {
      if (handle) handle.discard(true);
      if (token !== revision || destroyed) return null;
      const message = messageOf(cause);
      view.errors.push({
        phase: "frame",
        cause: message === "frame-timeout" ? "frame-timeout" : (message === "frame-discarded" ? "frame-discarded" : "frame-unavailable"),
        scenarioId: view.scenarioId,
        pairId: pair.id,
        message,
      });
      return view;
    }
  }

  function viewComplete(view) {
    if (!view || !view.pair || !view.measurement) return false;
    if (view.measurement.status === "unmeasured") return false;
    if (view.errors.length > 0) return false;
    const expected = pairsFor(view.theme);
    if (expected.length === 0) return false;
    const measured = view.measurements.filter((entry) => entry.status !== "unmeasured");
    const ids = new Set(measured.map((entry) => entry.pairId));
    if (measured.length !== expected.length || ids.size !== expected.length) return false;
    return expected.every((pair) => ids.has(pair.id));
  }

  function computePhase(list) {
    if (!list || list.length === 0) return "unavailable";
    const anyMeasured = list.some((view) => view.measurements.some((entry) => entry.status !== "unmeasured"));
    const allComplete = list.length === 2 && list.every(viewComplete);
    if (allComplete) return "complete";
    if (anyMeasured) return "incomplete";
    return "unavailable";
  }

  function computeGlobalError(list) {
    if (!payloadRead.ok) return payloadRead.message;
    const baseline = baselineBytes();
    if (!baseline.present) return baseline.message;
    if (!contract) return "the payload config does not form a verification contract";
    if (!list || list.length === 0) return "no view could be rendered";
    if (list.every((view) => view.measurements.every((entry) => entry.status === "unmeasured"))) {
      const first = list.map((view) => view.errors[0]).find(Boolean);
      return first ? first.message : "no pair could be measured";
    }
    return null;
  }

  async function run(token) {
    const descriptors = plan();
    const results = await Promise.all(descriptors.map((descriptor) => renderView(descriptor, token).catch((cause) => {
      const view = viewShell(descriptor, null);
      view.errors.push({ phase: "run", cause: "view-failed", scenarioId: view.scenarioId, pairId: null, message: messageOf(cause) });
      return view;
    })));
    if (token !== revision || destroyed) return state();
    views = results.filter(Boolean);
    phase = computePhase(views);
    error = computeGlobalError(views);
    publish("run");
    return state();
  }

  // ---------------------------------------------------------------------------
  // Suggestion
  // ---------------------------------------------------------------------------

  function currentView() {
    if (views.length === 0) return null;
    if (selection.comparison === "draft" || selection.comparison === "tuning") {
      return views.find((view) => view.slot === "right") || null;
    }
    return views.find((view) => view.theme === selection.theme) || views[0] || null;
  }

  function measurementFor(view, pairId) {
    if (!view) return null;
    return view.measurements.find((entry) => entry.pairId === pairId) || null;
  }

  function controlForToken(token, theme) {
    for (const descriptor of controls) {
      if (descriptor.macro === false && descriptor.token === token && descriptor.theme === theme && descriptor.kind === "override") return descriptor;
    }
    return null;
  }

  function emptySuggestion(status, side, pair, descriptor, extra) {
    return {
      status,
      side,
      token: extra && extra.token ? extra.token : null,
      control: descriptor ? descriptor.name : null,
      value: null,
      before: extra && finite(extra.before) ? extra.before : null,
      after: extra && finite(extra.after) ? extra.after : null,
      reason: extra && extra.reason ? extra.reason : null,
      checked: extra && finite(extra.checked) ? extra.checked : 0,
      unmeasured: extra && finite(extra.unmeasured) ? extra.unmeasured : 0,
      regressions: extra && isArray(extra.regressions) ? extra.regressions : [],
      authored: null,
      deltaL: null,
      gamutAdjusted: false,
      revision,
      scope: null,
      // Labels/status metadata for the optional visible base/candidate proposal frames. Never part of
      // the serialized draft or export; `null` unless a verified candidate was rendered.
      preview: null,
    };
  }

  function suggestionUnavailable(side, pair, token, descriptor, reason, extra) {
    const value = emptySuggestion("unavailable", side, pair, descriptor, Object.assign({ reason }, extra || {}));
    value.token = token || null;
    suggestion = value;
    publish("suggestion");
    return state();
  }

  function candidateCss(result) {
    if (result && typeof result.value === "string" && result.value.trim() !== "") return result.value.trim();
    if (result && typeof result.authored === "string" && result.authored.trim() !== "") return result.authored.trim();
    if (result && isRecord(result.authored) && finite(result.authored.l) && finite(result.authored.c) && finite(result.authored.h)) return core.oklch(result.authored);
    if (result && isRecord(result.color) && finite(result.color.l) && finite(result.color.c) && finite(result.color.h)) return core.oklch(result.color);
    return null;
  }

  function measurementMap(measured) {
    const map = new Map();
    if (!measured || !isArray(measured.measurements)) return map;
    for (const entry of measured.measurements) if (!map.has(entry.pairId)) map.set(entry.pairId, entry);
    return map;
  }

  // The shared factory documents `authored` as the input OKLCH object, not a CSS string. Preserve
  // the validated object (never coerce it), so the suggestion describes the real source color.
  function adviceAuthored(advice) {
    if (!advice || !isRecord(advice.authored)) return null;
    const authored = advice.authored;
    if (!finite(authored.l) || !finite(authored.c) || !finite(authored.h)) return null;
    return { l: authored.l, c: authored.c, h: authored.h };
  }

  async function verifyCandidate(context) {
    const tokenRevision = revision;
    const tokenGeneration = context.generation;
    const stale = () => destroyed || tokenRevision !== revision || tokenGeneration !== suggestGeneration;
    const themes = ["light", "dark"];
    const session = { container: createTrialContainer(), frames: [] };
    trialSessions.push(session);
    const jobs = [];
    let results;
    try {
      for (const theme of themes) {
        const pairId = normalizePairId(context.pair.id, theme);
        const trialPair = findPair(theme, pairId);
        for (const mode of ["before", "after"]) {
          const descriptor = { slot: "trial", theme, variant: context.baseVariant, pairId };
          const scenario = {
            id: "trial-" + mode + "-" + theme,
            theme,
            variant: context.baseVariant,
            preference: observePreference().active,
          };
          const handle = createFrame(descriptor, session.container, "trial", session.frames);
          jobs.push((async () => {
            try {
              const frameDocument = await handle.ready;
              if (stale()) return null;
              const values = draft;
              if (mode === "before") injectCssFor(frameDocument, context.baseVariant, values);
              else injectCssFor(frameDocument, context.baseVariant, values, { [context.descriptor.name]: context.candidateValue });
              const specimen = buildSpecimen(frameDocument, trialPair);
              const measured = verifier.measureDocument(frameDocument, scenario, contract, { elements: specimen.elements });
              markTechnicalProbes(frameDocument);
              handle.discard(false);
              return { mode, theme, pair: trialPair, measured };
            } catch (cause) {
              handle.discard(false);
              return { mode, theme, pair: trialPair, error: messageOf(cause) };
            }
          })());
        }
      }
      results = await Promise.all(jobs);
    } catch (cause) {
      return { revision: tokenRevision, failure: "the trial could not be prepared: " + messageOf(cause) };
    } finally {
      destroyTrialSession(session);
    }
    if (stale()) return { revision: tokenRevision, stale: true };
    const byKey = new Map();
    for (const entry of results) {
      if (!entry) continue;
      if (entry.error) return { revision: tokenRevision, failure: "the trial frame failed: " + entry.error };
      if (!entry.measured || entry.measured.support !== "supported") {
        return { revision: tokenRevision, failure: entry.measured && entry.measured.error ? entry.measured.error : "a trial document could not be measured" };
      }
      byKey.set(entry.mode + "-" + entry.theme, entry);
    }
    const scope = [];
    for (const theme of themes) {
      const before = byKey.get("before-" + theme);
      const after = byKey.get("after-" + theme);
      if (!before || !after) return { revision: tokenRevision, failure: "the trial did not produce both documents for theme " + theme };
      scope.push({ theme, before: before.measured, after: after.measured });
    }
    let checked = 0;
    let unmeasured = 0;
    const regressions = [];
    let selectedBefore = null;
    let selectedAfter = null;
    for (const entry of scope) {
      const beforeMap = measurementMap(entry.before);
      const afterMap = measurementMap(entry.after);
      for (const pair of pairsFor(entry.theme)) {
        const before = beforeMap.get(pair.id);
        const after = afterMap.get(pair.id);
        const beforeMeasured = before && before.status !== "unmeasured" && finite(before.ratio);
        const afterMeasured = after && after.status !== "unmeasured" && finite(after.ratio);
        if (afterMeasured) checked += 1;
        else {
          unmeasured += 1;
          if (beforeMeasured && before.ratio >= pair.minimum) {
            regressions.push({ pairId: pair.id, theme: entry.theme, label: pair.label, before: before.ratio, after: after && finite(after.ratio) ? after.ratio : null, reason: "unmeasured" });
          }
        }
        if (beforeMeasured && afterMeasured && before.ratio >= pair.minimum && after.ratio < pair.minimum) {
          regressions.push({ pairId: pair.id, theme: entry.theme, label: pair.label, before: before.ratio, after: after.ratio, reason: "below-minimum" });
        }
        if (pair.id === context.pair.id && entry.theme === context.view.theme) {
          selectedBefore = beforeMeasured ? before.ratio : null;
          selectedAfter = afterMeasured ? after.ratio : null;
        }
      }
    }
    const result = {
      status: "unavailable",
      side: context.side,
      token: context.token,
      control: context.descriptor.name,
      value: context.candidateValue,
      before: selectedBefore,
      after: selectedAfter,
      reason: null,
      checked,
      unmeasured,
      regressions,
      authored: adviceAuthored(context.advice),
      deltaL: context.advice && finite(context.advice.deltaL) ? context.advice.deltaL : null,
      gamutAdjusted: Boolean(context.advice && context.advice.gamutAdjusted === true),
      revision: tokenRevision,
      preview: null,
      scope: {
        affectedTheme: context.view.theme,
        measuredThemes: ["light", "dark"],
        unchangedThemes: ["light", "dark"].filter((theme) => theme !== context.view.theme),
        note: "the candidate is applied to the affected theme; the other theme is re-measured only to catch collateral changes",
      },
    };
    if (selectedBefore === null) {
      result.status = "unavailable";
      result.reason = "the selected pair is unmeasured in the fresh before trial, so the candidate cannot be verified (" + provenanceText() + ")";
      return { revision: tokenRevision, suggestion: result };
    }
    if (selectedBefore >= context.pair.minimum) {
      result.status = "none";
      result.reason = "the selected pair is no longer below its WCAG minimum in the fresh trial (" + provenanceText() + ")";
      return { revision: tokenRevision, suggestion: result };
    }
    if (unmeasured > 0 || regressions.length > 0) {
      result.status = regressions.length > 0 ? "regression" : "unavailable";
      result.reason = "the trial could not be verified completely: " + checked + " pairs checked, " + unmeasured + " unmeasured, " + regressions.length + " regression(s) (" + provenanceText() + ")";
      return { revision: tokenRevision, suggestion: result };
    }
    if (selectedAfter === null || selectedAfter < context.pair.minimum) {
      result.status = "regression";
      result.reason = "the candidate does not reach the WCAG minimum on the selected pair in the real CSS (" + provenanceText() + ")";
      return { revision: tokenRevision, suggestion: result };
    }
    result.status = "verified";
    result.reason = "Verified on the embedded CSS bytes (" + provenanceText() + "), both themes and " + checked + " contract pairs; this is a draft, not a disk change.";
    return { revision: tokenRevision, suggestion: result };
  }

  // `suggest` must describe the CSS the user will actually get. Any existing draft override is
  // part of the applied result, so when one is present the measured base is the draft view: the
  // comparison is switched transparently and the real frames are awaited before the candidate is
  // computed. Nothing is ever verified against the saved-only view and then silently merged with a
  // hidden override.
  async function prepareSuggestionBase(generation) {
    if (!payloadRead.ok) return { error: payloadRead.message };
    if (!contract) return { error: "the payload config does not form a verification contract" };
    if (!mounted || destroyed) return { error: "no measured view is available for the current selection" };
    if (Object.keys(draft).length > 0 && selection.comparison !== "draft") {
      showDraft();
      await rerun("suggest-draft");
      if (destroyed || generation !== suggestGeneration) return { stale: true };
    }
    let guard = 0;
    while (phase === "running" && guard < 8) {
      guard += 1;
      const pending = currentRun;
      if (!pending) break;
      await pending;
      if (destroyed || generation !== suggestGeneration) return { stale: true };
    }
    if (phase === "running") return { error: "the current measurements did not settle in time" };
    return {};
  }

  async function suggest(side) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    if (SIDES.indexOf(side) === -1) {
      setError("suggest expects 'foreground' or 'background'");
      return state();
    }
    const generation = suggestGeneration + 1;
    suggestGeneration = generation;
    suggestion = null;
    destroyTrialFrames();
    destroyProposalFrames();
    publish("suggestion");
    const prepared = await prepareSuggestionBase(generation);
    if (prepared.stale) return state();
    if (prepared.error) return suggestionUnavailable(side, null, null, null, prepared.error);
    if (destroyed || generation !== suggestGeneration) return state();
    const view = currentView();
    if (!view || !view.pair) return suggestionUnavailable(side, view ? view.pair : null, null, null, "no measured view is available for the current selection");
    const pair = view.pair;
    const measured = view.measurement;
    if (!measured || measured.status === "unmeasured") {
      return suggestionUnavailable(side, pair, side === "foreground" ? pair.foreground : pair.background, null, "the selected pair is unmeasured; a suggestion cannot be verified");
    }
    if (measured.status !== "below-minimum") {
      const none = emptySuggestion("none", side, pair, null, { before: measured.ratio, after: measured.ratio, reason: "the selected pair is not below its WCAG minimum" });
      none.token = side === "foreground" ? pair.foreground : pair.background;
      suggestion = none;
      publish("suggestion");
      return state();
    }
    let foreground;
    let background;
    try {
      foreground = core.parseComputedColor(measured.foreground, pair.label + " foreground");
      background = core.parseComputedColor(measured.background, pair.label + " background");
    } catch (cause) {
      return suggestionUnavailable(side, pair, side === "foreground" ? pair.foreground : pair.background, null, "the measured pair cannot be parsed: " + messageOf(cause));
    }
    const token = side === "foreground" ? pair.foreground : pair.background;
    const tokenColor = side === "foreground" ? foreground : background;
    const descriptor = controlForToken(token, view.theme);
    if (!descriptor) {
      return suggestionUnavailable(side, pair, token, null, "no public full-override control is available for " + token + " in " + view.theme);
    }
    const constraints = [];
    const seen = new Set();
    const missingPairs = [];
    for (const otherPair of pairsFor(view.theme)) {
      if (otherPair.foreground !== token && otherPair.background !== token) continue;
      const otherMeasurement = measurementFor(view, otherPair.id);
      if (!otherMeasurement || otherMeasurement.status === "unmeasured") {
        missingPairs.push(otherPair.id);
        continue;
      }
      try {
        const otherColor = core.parseComputedColor(
          otherPair.foreground === token ? otherMeasurement.background : otherMeasurement.foreground,
          otherPair.label + " other side",
        );
        const minimum = Number(otherPair.minimum);
        if (!Number.isFinite(minimum) || minimum <= 0) {
          missingPairs.push(otherPair.id);
          continue;
        }
        const key = otherColor.l + "|" + otherColor.c + "|" + otherColor.h + "|" + minimum;
        if (seen.has(key)) continue;
        seen.add(key);
        constraints.push({ other: otherColor, minimum });
      } catch {
        missingPairs.push(otherPair.id);
      }
    }
    if (constraints.length === 0) {
      return suggestionUnavailable(side, pair, token, descriptor, "no measurable affected pair uses " + token + " in " + view.theme);
    }
    if (missingPairs.length > 0) {
      return suggestionUnavailable(side, pair, token, descriptor, "incomplete data: " + missingPairs.length + " affected pair(s) are unmeasured (" + missingPairs.slice(0, 3).join(", ") + "); the suggestion cannot be verified", {
        unmeasured: missingPairs.length,
        before: measured.ratio,
      });
    }
    let adviceResult;
    try {
      adviceResult = advice.suggestLightness({ color: tokenColor, constraints, margin: 0.02 });
    } catch (cause) {
      return suggestionUnavailable(side, pair, token, descriptor, "contrast advice failed: " + messageOf(cause));
    }
    if (!adviceResult || adviceResult.status !== "candidate") {
      const status = adviceResult && adviceResult.status === "none" ? "none" : "unavailable";
      const value = emptySuggestion(status, side, pair, descriptor, {
        reason: (adviceResult && adviceResult.reason) || "no viable lightness candidate was found",
        before: measured.ratio,
      });
      value.token = token;
      suggestion = value;
      publish("suggestion");
      return state();
    }
    const candidateValue = candidateCss(adviceResult);
    if (!candidateValue || !cssSupports("color", candidateValue)) {
      return suggestionUnavailable(side, pair, token, descriptor, "the advice candidate is not a valid opaque CSS color");
    }
    const trial = await verifyCandidate({
      pair,
      view,
      side,
      token,
      descriptor,
      candidateValue,
      advice: adviceResult,
      baseVariant: view.variant,
      generation,
    });
    if (trial.stale) return state();
    if (trial.failure) return suggestionUnavailable(side, pair, token, descriptor, trial.failure);
    if (trial.revision !== revision || generation !== suggestGeneration) return state();
    // A positive visual preview is only ever shown for a VERIFIED candidate, and only after the trial
    // has completed against the real CSS. The displayed frames are measured at the trial viewport and
    // must reproduce the verified ratios or the whole suggestion fails closed. The draft is never
    // touched here: the candidate is a draft only after an explicit applySuggestion.
    if (trial.suggestion.status === "verified") {
      const preview = await renderProposal({
        generation,
        view,
        pair,
        control: descriptor.name,
        candidateValue,
        baseVariant: view.variant,
        suggestion: trial.suggestion,
      });
      if (preview.stale) return state();
      if (preview.failClosed) return suggestionUnavailable(side, pair, token, descriptor, preview.reason, { before: trial.suggestion.before });
      trial.suggestion.preview = preview.preview;
    }
    suggestion = trial.suggestion;
    publish("suggestion");
    return state();
  }

  // ---------------------------------------------------------------------------
  // Public controller
  // ---------------------------------------------------------------------------

  function payload() {
    return parsedPayload;
  }

  function pairs(theme) {
    if (theme !== "light" && theme !== "dark") return [];
    return clone(pairsFor(theme));
  }

  function controlsList() {
    return clone(controls);
  }

  function isMountable(node) {
    return Boolean(node && typeof node === "object" && node.nodeType === 1 && typeof node.appendChild === "function");
  }

  // `mount` accepts the two comparison slots and, additively, two optional proposal containers. When
  // both proposal containers are present the verified suggestion is rendered into them as a real
  // `var()` base/candidate comparison; when they are omitted the controller behaves exactly as
  // before (no proposal frames, `state().suggestion.preview` stays null).
  function mount(slots) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    if (!isRecord(slots)) throw new TypeError("mount expects { left: HTMLElement, right: HTMLElement }");
    if (!isMountable(slots.left) || !isMountable(slots.right)) throw new TypeError("mount expects two HTMLElement slots (left, right)");
    if (typeof doc.contains === "function" && (!doc.contains(slots.left) || !doc.contains(slots.right))) {
      throw new TypeError("mount slots must be attached to the document");
    }
    const askedProposal = (slots.proposalBefore !== undefined && slots.proposalBefore !== null)
      || (slots.proposalAfter !== undefined && slots.proposalAfter !== null);
    let nextProposal = null;
    if (askedProposal) {
      if (!isMountable(slots.proposalBefore) || !isMountable(slots.proposalAfter)) {
        throw new TypeError("mount proposal slots must both be HTMLElement containers (proposalBefore, proposalAfter)");
      }
      if (typeof doc.contains === "function" && (!doc.contains(slots.proposalBefore) || !doc.contains(slots.proposalAfter))) {
        throw new TypeError("mount proposal slots must be attached to the document");
      }
      nextProposal = { before: slots.proposalBefore, after: slots.proposalAfter };
    }
    destroyProposalFrames();
    leftSlot = slots.left;
    rightSlot = slots.right;
    proposalSlots = nextProposal;
    mounted = true;
    invalidateDraftState("mount");
    return state();
  }

  async function select(input) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    if (!isRecord(input)) return setError("select expects an object");
    const theme = input.theme === undefined ? selection.theme : input.theme;
    if (theme !== "light" && theme !== "dark") return setError("select expects theme 'light' or 'dark'");
    const comparison = input.comparison === undefined ? selection.comparison : input.comparison;
    if (COMPARISONS.indexOf(comparison) === -1) return setError("select expects comparison 'themes', 'tuning' or 'draft'");
    const requested = typeof input.pairId === "string" && input.pairId !== "" ? input.pairId : selection.pairId;
    const normalized = normalizePairId(requested, theme);
    if (!normalized) return setError("pair " + String(requested) + " is not declared in theme " + theme + " and cannot be normalized by foreground/background/property");
    selection = { pairId: normalized, theme, comparison };
    return invalidateDraftState("select");
  }

  // Advisory, on-demand exploration. It reuses the already mounted frame, the same DOM collector and
  // the same core contract shape the diagnostic runtime uses; it never touches the primary run.
  async function measureExploration(theme) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    if (theme !== "light" && theme !== "dark") return setError("measureExploration expects theme 'light' or 'dark'");
    if (!payloadRead.ok || !parsedPayload) return setError("measureExploration is unavailable: " + (payloadRead.message || "the payload is unavailable"));
    if (!contract) return setError("measureExploration is unavailable: the payload config did not form a contract");
    if (phase === "running") return setError("measureExploration cannot run while a primary measurement is running; wait for the current run");
    const pairs = explorationPairs(theme);
    if (!pairs.length) return setError("measureExploration found no exploration pairs for theme " + theme);
    if (!mounted) return setError("measureExploration requires a mounted frame; mount and select a pair first");
    const variant = currentVariantFor(theme);
    if (exploration && exploration.phase === "complete" && exploration.revision === revision && exploration.theme === theme && exploration.variant === variant) return state();
    const handle = visibleFrameFor(theme, variant);
    if (!handle) return setError("measureExploration cannot use a current " + theme + " frame; select that theme first");
    const frame = handle.frame;
    const frameDocument = frame && frame.contentDocument;
    if (!frameDocument || !frameDocument.documentElement) return setError("measureExploration cannot read the " + theme + " frame document");

    const tokenRevision = revision;
    const tokenTheme = selection.theme;
    const tokenVariant = variant;
    exploration = { theme, variant, revision: tokenRevision, phase: "running", measurements: [], errors: [], omittedFamilies: explorationOmitted(theme) };
    publish("exploration-running");

    let measured;
    try {
      measured = verifier.measureDocument(
        frameDocument,
        { id: "workbench-exploration-" + theme, theme, variant, preference: observePreference().active },
        { pairs: { [theme]: pairs } },
      );
      markTechnicalProbes(frameDocument);
    } catch (cause) {
      if (destroyed || revision !== tokenRevision) return state();
      exploration = { theme, variant, revision: tokenRevision, phase: "incomplete", measurements: [], errors: [{ phase: "exploration", cause: "exploration-failed", message: messageOf(cause) }], omittedFamilies: explorationOmitted(theme) };
      publish("exploration-error");
      return state();
    }

    // A late advisory result is discarded; it can never overwrite a newer revision or theme.
    if (destroyed || revision !== tokenRevision || selection.theme !== tokenTheme || currentVariantFor(theme) !== tokenVariant) return state();
    const errors = isArray(measured.errors) ? clone(measured.errors) : [];
    if (measured.support !== "supported" && !errors.length) {
      errors.push({ phase: "exploration", cause: "exploration-unsupported", message: measured.error || "the exploration pairs could not be measured" });
    }
    exploration = {
      theme,
      variant,
      revision: tokenRevision,
      phase: measured.support === "supported" ? "complete" : "incomplete",
      measurements: isArray(measured.measurements) ? measured.measurements.map(withOklchMetadata) : [],
      errors,
      omittedFamilies: explorationOmitted(theme),
    };
    publish("exploration-measured");
    return state();
  }

  function normalizePercent(value) {
    let number = null;
    if (typeof value === "number") {
      number = value;
    } else if (typeof value === "string") {
      const match = PERCENT.exec(value.trim());
      if (!match) return null;
      number = Number(match[1]);
    } else {
      return null;
    }
    if (!Number.isFinite(number) || number < 0 || number > 100) return null;
    return String(number) + "%";
  }

  function normalizeNumber(value) {
    let number = null;
    if (typeof value === "number") {
      number = value;
    } else if (typeof value === "string" && NUMBER_ONLY.test(value.trim())) {
      number = Number(value);
    } else {
      return null;
    }
    if (!Number.isFinite(number) || number < -1 || number > 1) return null;
    return String(number);
  }

  function validateControlValue(descriptor, value) {
    if (descriptor.kind === "override") {
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      if (trimmed === "" || /[;{}\r\n]/.test(trimmed)) return null;
      // The workbench drafts opaque colours only; alpha and compositing are outside the measured
      // scope even when the browser accepts the declaration.
      if (trimmed.indexOf("/") !== -1 || /^transparent$/i.test(trimmed)) return null;
      if (!cssSupports("color", trimmed)) return null;
      return trimmed;
    }
    if (descriptor.kind === "mix" || descriptor.kind === "percent") {
      const normalized = normalizePercent(value);
      if (normalized === null) return null;
      if (!cssSupports("width", normalized)) return null;
      return normalized;
    }
    if (descriptor.kind === "number") return normalizeNumber(value);
    return null;
  }

  // Manual OKLCH lightness edit: the current computed colour supplies C/H, so only L moves and no
  // second colour conversion is introduced. The resulting full override goes through setOverride.
  async function setLightness(control, lightness) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    const descriptor = typeof control === "string" ? controlIndex.get(control) : null;
    if (!descriptor) return setError("setLightness: unknown tuning control " + String(control));
    if (descriptor.macro || descriptor.kind !== "override" || !descriptor.token) {
      return setError("setLightness requires a per-token full colour control; " + control + " is a " + descriptor.kind + " knob");
    }
    if (typeof lightness !== "number" || !Number.isFinite(lightness) || lightness < 0 || lightness > 1) {
      return setError("setLightness expects a finite number between 0 and 1 for " + control);
    }
    if (phase === "running") return setError("setLightness cannot run while a measurement is running; wait for the current run");
    if (!mounted) return setError("setLightness requires a mounted measured frame; mount and select a pair first");
    const variant = currentVariantFor(descriptor.theme);
    const handle = visibleFrameFor(descriptor.theme, variant);
    if (!handle) return setError("setLightness cannot resolve a current " + descriptor.theme + " frame for " + control + "; select that theme first");
    let parsed;
    try {
      parsed = computedTokenColor(handle, descriptor.token).parsed;
    } catch (cause) {
      return setError("setLightness cannot read the computed colour of " + descriptor.token + " in " + descriptor.theme + ": " + messageOf(cause));
    }
    const value = core.oklch({ l: lightness, c: parsed.c, h: parsed.h });
    return setOverride(descriptor.name, value);
  }

  async function setOverride(control, value) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    const descriptor = typeof control === "string" ? controlIndex.get(control) : null;
    if (!descriptor) return setError("unknown tuning control " + String(control) + "; only public design controls and known macro knobs are accepted");
    const normalized = validateControlValue(descriptor, value);
    if (normalized === null) return setError("invalid value for " + control + "; expected " + (descriptor.kind === "override" ? "an opaque CSS color" : descriptor.kind === "number" ? "a unitless number in -1..1" : "a percentage in 0%..100%"));
    draft[descriptor.name] = normalized;
    showDraft();
    return invalidateDraftState("override");
  }

  async function reset(control) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    if (control !== undefined && control !== null) {
      if (typeof control !== "string" || !controlIndex.has(control)) return setError("unknown tuning control " + String(control));
      if (!Object.prototype.hasOwnProperty.call(draft, control)) {
        error = null;
        publish("reset-noop");
        return state();
      }
      delete draft[control];
    } else {
      if (Object.keys(draft).length === 0) {
        error = null;
        publish("reset-noop");
        return state();
      }
      draft = {};
    }
    showDraft();
    return invalidateDraftState("reset");
  }

  // Remove a saved or draft override without copying the generated colour: the tombstone makes the
  // unregistered knob guaranteed-invalid, so every `var(--knob, fallback)` reads its generated
  // fallback. The export removes the declaration instead of writing `initial`.
  async function removeOverride(control) {
    if (destroyed) throw new Error("the workbench has been destroyed");
    const descriptor = typeof control === "string" ? controlIndex.get(control) : null;
    if (!descriptor) return setError("removeOverride: unknown tuning control " + String(control));
    if (draft[control] === "initial") {
      error = null;
      publish("remove-noop");
      return state();
    }
    const wasSaved = hasSavedDeclaration(control);
    if (!wasSaved && !Object.prototype.hasOwnProperty.call(draft, control)) {
      error = null;
      publish("remove-noop");
      return state();
    }
    draft[descriptor.name] = "initial";
    showDraft();
    const snapshot = await invalidateDraftState("remove-override");
    if (destroyed) return state();
    const variant = currentVariantFor(descriptor.theme);
    const view = isArray(snapshot.views) ? snapshot.views.find((entry) => entry && entry.theme === descriptor.theme && entry.variant === variant) : null;
    if (!view) return setError("removeOverride could not verify " + control + ": no measured " + descriptor.theme + " draft frame is available");
    const blocked = (isArray(view.errors) ? view.errors : []).find((entry) => entry && entry.phase === "draft" && entry.knob === control);
    if (blocked) return setError("removeOverride did not take effect for " + control + ": " + (blocked.message || "the tombstone is blocked"));
    return snapshot;
  }

  // `discardSuggestion` is a synchronous, additive escape hatch for the host UI. It drops only the
  // suggestion layer: the pending metadata, any in-flight trial/verification frames and the visible
  // proposal frames. Bumping the generation first makes a suggestion that is still resolving fail its
  // own staleness checks, so it can never publish itself afterwards. The draft, the selection, the
  // main measurements and the export are untouched: this is neither a reset nor a rerun.
  function discardSuggestion() {
    if (destroyed) throw new Error("the workbench has been destroyed");
    suggestGeneration += 1;
    destroyTrialFrames();
    destroyProposalFrames();
    suggestion = null;
    publish("discard-suggestion");
    return state();
  }

  async function applySuggestion() {
    if (destroyed) throw new Error("the workbench has been destroyed");
    if (!suggestion || suggestion.status !== "verified") return setError("no verified suggestion is available to apply");
    if (suggestion.revision !== revision) {
      suggestion = null;
      publish("stale-suggestion");
      return setError("the suggestion is stale; run suggest again");
    }
    const descriptor = controlIndex.get(suggestion.control);
    if (!descriptor) return setError("the suggested control is no longer in the design whitelist");
    const normalized = validateControlValue(descriptor, suggestion.value);
    if (normalized === null) return setError("the suggested value is no longer valid for " + suggestion.control);
    draft[descriptor.name] = normalized;
    showDraft();
    return invalidateDraftState("apply-suggestion");
  }

  function state() {
    return clone({
      phase,
      revision,
      selection: clone(selection),
      draft: clone(draft),
      removed: tombstoneNames(draft),
      exploration: clone(exploration),
      views: clone(views),
      suggestion: clone(suggestion),
      error,
      notes: clone(notes),
      preference: observePreference(),
      provenance: provenance(),
    });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("subscribe expects a function");
    if (destroyed) throw new Error("the workbench has been destroyed");
    listeners.push(listener);
    return function unsubscribe() {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  function publish(reason) {
    if (destroyed) return;
    const snapshot = state();
    for (const listener of listeners.slice()) {
      try {
        listener(snapshot, reason == null ? null : String(reason));
      } catch {
        // A subscriber must never break the workbench.
      }
    }
  }

  function initPreference() {
    if (listenerAttached || !win || typeof win.matchMedia !== "function") return;
    try {
      preferenceQuery = win.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      preferenceQuery = null;
      return;
    }
    if (!preferenceQuery) return;
    const onChange = () => {
      if (destroyed) return;
      if (mounted) {
        invalidateDraftState("preference-change");
      } else {
        revision += 1;
        suggestGeneration += 1;
        suggestion = null;
        views = [];
        phase = payloadRead.ok ? "idle" : "unavailable";
        publish("preference-change");
      }
    };
    if (typeof preferenceQuery.addEventListener === "function") {
      preferenceQuery.addEventListener("change", onChange);
      preferenceListener = onChange;
      listenerAttached = true;
    } else if (typeof preferenceQuery.addListener === "function") {
      preferenceQuery.addListener(onChange);
      preferenceListener = onChange;
      listenerAttached = true;
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    revision += 1;
    suggestGeneration += 1;
    destroyVisibleFrames();
    destroyTrialFrames();
    destroyProposalFrames();
    if (preferenceQuery) {
      if (typeof preferenceQuery.removeEventListener === "function" && preferenceListener) preferenceQuery.removeEventListener("change", preferenceListener);
      if (typeof preferenceQuery.removeListener === "function" && preferenceListener) preferenceQuery.removeListener(preferenceListener);
      preferenceQuery = null;
      preferenceListener = null;
      listenerAttached = false;
    }
    listeners.length = 0;
    views = [];
    suggestion = null;
    error = null;
    phase = "idle";
    if (GLOBAL && GLOBAL[GLOBAL_NAME] === controller) {
      try {
        delete GLOBAL[GLOBAL_NAME];
      } catch {
        // A frozen global cannot be cleaned; the controller is still inert.
      }
    }
  }

  const controller = {
    marker: MARKER,
    version: VERSION,
    global: GLOBAL_NAME,
    payloadId: PAYLOAD_ID,
    frameTimeoutMs: FRAME_TIMEOUT_MS,
    frameColorScheme: FRAME_COLOR_SCHEME,
    phases: PHASES.slice(),
    states: PHASES.slice(),
    comparisons: COMPARISONS.slice(),
    sides: SIDES.slice(),
    macroControls: MACRO_CONTROLS.map((entry) => ({ name: entry.name, theme: entry.theme, kind: entry.kind })),
    attributes: {
      frame: FRAME_ATTRIBUTE,
      trial: TRIAL_ATTRIBUTE,
      slot: SLOT_ATTRIBUTE,
      variant: VARIANT_ATTRIBUTE,
      theme: THEME_ATTRIBUTE,
      stylesheet: CSS_ATTRIBUTE,
      payloadId: PAYLOAD_ID,
      visibleForeground: VISIBLE_FOREGROUND_ATTRIBUTE,
      visibleBackground: VISIBLE_BACKGROUND_ATTRIBUTE,
      visibleProperty: VISIBLE_PROPERTY_ATTRIBUTE,
      visibleSpecimen: VISIBLE_SPECIMEN_ATTRIBUTE,
    },
    containsUnsupportedResources: containsUnsupported,
    payload,
    pairs,
    controls: controlsList,
    mount,
    select,
    setOverride,
    setLightness,
    removeOverride,
    reset,
    explorationPairs,
    measureExploration,
    suggest,
    discardSuggestion,
    applySuggestion,
    exportTuning,
    exportTuningFile,
    state,
    subscribe,
    destroy,
    get frames() {
      return visibleFrames.map((handle) => handle.frame);
    },
    get mounted() {
      return mounted;
    },
    get destroyed() {
      return destroyed;
    },
  };

  loadPayload();
  initPreference();
  return controller;
}
