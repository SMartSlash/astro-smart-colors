/**
 * Browser bootstrap for the Smart Colors native verification runner (plan §5.1.1, §6.1).
 *
 * `createDiagnosticRuntimeSource()` assembles a classic script out of the *same* factories the
 * Node side uses: the pure core (`createVerificationCore`), the isolated DOM collector
 * (`createDomVerifier`) and the bootstrap (`createDiagnosticRuntime`) are serialized from their
 * function source, so the emitted bytes carry no import, no `eval`, no network call and no
 * reference to the checkout. The renderer (SC-06) hashes exactly these bytes for its CSP.
 *
 * The runner, on load, validates the inert payload fail-closed, then measures the baseline and,
 * when present, the tuned stylesheet, for both themes, using the *active* preference. Each
 * scenario gets a fresh `iframe srcdoc` with `sandbox="allow-same-origin"` and no scripts; the
 * payload CSS is written into each frame with DOM `style.textContent` so the audited bytes are
 * preserved exactly. A preference change invalidates the local results immediately and reruns;
 * a native `button` repeats the run without moving focus.
 *
 * Frozen hooks for SC-06 and the automation contract for SC-05 (see the module exports): the
 * controller is exposed at `globalThis.__smartColorsDiagnostic` with `preference()`, `scenarios()`,
 * `status()`, `report()`, `run()`, `invalidate(reason)` and `subscribe(listener)`. Theme and
 * preference stay distinct: `scenario.theme` drives `color-scheme`/`data-theme` on the isolated
 * root, while the preference is always read from `(prefers-color-scheme)`.
 */
import { createDomVerifier } from "./verification-dom.mjs";
import { createVerificationCore } from "./verification-core.mjs";

export const DIAGNOSTIC_RUNTIME_GLOBAL = "__smartColorsDiagnostic";
export const DIAGNOSTIC_RUNTIME_MARKER = "SMART_COLORS_DIAGNOSTIC_RUNTIME_V1";
export const DIAGNOSTIC_RUNTIME_VERSION = 1;
export const DIAGNOSTIC_PAYLOAD_ID = "smart-colors-payload";
export const DIAGNOSTIC_HOOK_ATTRIBUTE = "data-smart-colors-diagnostic";
export const DIAGNOSTIC_STATE_ATTRIBUTE = "data-smart-colors-state";
export const DIAGNOSTIC_HOST_ID = "smart-colors-diagnostic";
export const DIAGNOSTIC_SCENARIO_ATTRIBUTE = "data-smart-colors-scenario";
export const DIAGNOSTIC_CSS_ATTRIBUTE = "data-smart-colors-css";
export const DIAGNOSTIC_RETRY_LABEL = "Ripeti verifica";
export const DIAGNOSTIC_FRAME_TIMEOUT_MS = 5000;
export const DIAGNOSTIC_HOOKS = Object.freeze({ host: "host", frames: "frames", status: "status", retry: "retry", scenario: "scenario" });
export const DIAGNOSTIC_STATES = Object.freeze(["pending", "running", "complete", "incomplete", "unavailable", "unsupported", "disabled"]);
// The measurement carriers must declare support for BOTH schemes on the iframe element itself. An
// embedded document inherits the embedding element's `color-scheme` for its `prefers-color-scheme`
// (MDN /Web/CSS/@media/prefers-color-scheme): a UI that pins `color-scheme: light` on its root would
// otherwise force every child to report `light`, so a dark OS preference could never be measured.
// Declaring `light dark` lets the child keep the native preference and never emulates it arbitrarily.
export const DIAGNOSTIC_FRAME_COLOR_SCHEME = "light dark";

// Tuning may reference resources the isolated runner cannot load; this is the same syntax check
// the session uses, not a CSS parser. Anything it flags is declared unsupported, never a pass.
const UNSUPPORTED_RESOURCE = /@import\b|url\(/i;

/**
 * `true` when the CSS references `@import` or `url()` resources the offline runner does not load.
 * Mirrors the check the browser bootstrap performs; the runtime test asserts they agree.
 */
export function containsUnsupportedResources(css) {
  if (typeof css !== "string" || css === "") return false;
  const active = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
  return UNSUPPORTED_RESOURCE.test(active);
}

/**
 * Assemble the classic script the preview embeds. The output is a single IIFE that installs the
 * controller on `globalThis`; it is the only origin of the emitted bytes, so a CSP hash computed
 * over them covers the runtime that actually runs.
 */
export function createDiagnosticRuntimeSource() {
  return [
    "(function () {",
    '  "use strict";',
    "  var createVerificationCore = " + createVerificationCore.toString() + ";",
    "  var createDomVerifier = " + createDomVerifier.toString() + ";",
    "  var createDiagnosticRuntime = " + createDiagnosticRuntime.toString() + ";",
    "  globalThis." + DIAGNOSTIC_RUNTIME_GLOBAL + " = createDiagnosticRuntime({",
    "    createVerificationCore: createVerificationCore,",
    "    createDomVerifier: createDomVerifier,",
    "    document: document,",
    "    window: window",
    "  });",
    "})();",
    "",
  ].join("\n");
}

/**
 * Bootstrap factory. Self-contained: it only reads its `deps` and browser globals, so it is safe
 * to serialize with `Function.prototype.toString()`.
 */
export function createDiagnosticRuntime(deps) {
  const doc = deps.document;
  const win = deps.window;
  const core = deps.createVerificationCore();
  const verifier = deps.createDomVerifier(core);

  const MARKER = "SMART_COLORS_DIAGNOSTIC_RUNTIME_V1";
  const VERSION = 1;
  const PAYLOAD_ID = "smart-colors-payload";
  const HOOK_ATTRIBUTE = "data-smart-colors-diagnostic";
  const STATE_ATTRIBUTE = "data-smart-colors-state";
  const HOST_ID = "smart-colors-diagnostic";
  const SCENARIO_ATTRIBUTE = "data-smart-colors-scenario";
  const CSS_ATTRIBUTE = "data-smart-colors-css";
  const RETRY_LABEL = "Ripeti verifica";
  const FRAME_TIMEOUT_MS = 5000;
  // Re-declared inside the factory so the serialized source stays self-contained; the entry-point
  // DIAGNOSTIC_FRAME_COLOR_SCHEME is asserted equal by the runtime test to prevent drift.
  const FRAME_COLOR_SCHEME = "light dark";
  const HOOKS = { host: "host", frames: "frames", status: "status", retry: "retry", scenario: "scenario" };
  const STATES = ["pending", "running", "complete", "incomplete", "unavailable", "unsupported", "disabled"];
  const STATE_LABELS = {
    pending: "in attesa",
    running: "in corso",
    complete: "completa",
    incomplete: "incompleta",
    unavailable: "non disponibile",
    unsupported: "non supportata",
    disabled: "disattivata",
  };
  const SKIN = '<!doctype html><html lang="it"><head><meta charset="utf-8"><body>';
  const UNSUPPORTED_RESOURCE = /@import\b|url\(/i;

  const listeners = [];
  const frames = [];
  let host = null;
  let framesContainer = null;
  let statusRegion = null;
  let retryButton = null;
  let preferenceQuery = null;
  let initialized = false;
  let running = false;
  let pendingRun = false;
  let generation = 0;
  let currentReport = null;
  let currentState = "pending";
  let scenarioCache = [];

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parent() {
    return doc.body || doc.documentElement;
  }

  function containsUnsupported(css) {
    if (typeof css !== "string" || css === "") return false;
    const active = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
    return UNSUPPORTED_RESOURCE.test(active);
  }

  // ---------------------------------------------------------------------------
  // Host wiring. SC-06 authors the markup; the runtime only creates the minimum when a hook is
  // missing, and never moves focus or injects markup from strings.
  // ---------------------------------------------------------------------------

  function ensureHook(hook, tag, attributes) {
    const existing = doc.querySelector("[" + HOOK_ATTRIBUTE + '="' + hook + '"]');
    if (existing) return existing;
    const created = doc.createElement(tag);
    created.setAttribute(HOOK_ATTRIBUTE, hook);
    if (attributes) {
      for (const name of Object.keys(attributes)) created.setAttribute(name, attributes[name]);
    }
    (host || parent()).appendChild(created);
    return created;
  }

  function ensureHost() {
    const existing = doc.getElementById(HOST_ID);
    if (existing) return existing;
    const created = doc.createElement("section");
    created.id = HOST_ID;
    created.setAttribute(HOOK_ATTRIBUTE, HOOKS.host);
    created.setAttribute("aria-label", "Verifica locale dei contrasti Smart Colors");
    parent().appendChild(created);
    return created;
  }

  function init() {
    if (initialized) return;
    host = ensureHost();
    framesContainer = ensureHook(HOOKS.frames, "div", null);
    statusRegion = ensureHook(HOOKS.status, "p", { role: "status" });
    retryButton = ensureHook(HOOKS.retry, "button", { type: "button" });
    if (retryButton.textContent === "") retryButton.textContent = RETRY_LABEL;
    retryButton.addEventListener("click", onRetry);
    preferenceQuery = win.matchMedia("(prefers-color-scheme: dark)");
    if (typeof preferenceQuery.addEventListener === "function") preferenceQuery.addEventListener("change", onPreferenceChange);
    else if (typeof preferenceQuery.addListener === "function") preferenceQuery.addListener(onPreferenceChange);
    initialized = true;
    applyHost();
    updateStatusText();
    requestRun("boot");
  }

  function onRetry() {
    requestRun("retry");
  }

  // A preference change invalidates the local results at once, then reruns both themes.
  function onPreferenceChange() {
    invalidate("preference-change");
    requestRun("preference-change");
  }

  function requestRun(reason) {
    if (running) {
      pendingRun = true;
      return null;
    }
    return run(reason);
  }

  function applyHost() {
    if (host) host.setAttribute(STATE_ATTRIBUTE, currentState);
  }

  function countExpected(expected) {
    if (!expected || !isRecord(expected.pairs)) return 0;
    let total = 0;
    for (const id of Object.keys(expected.pairs)) total += expected.pairs[id].length;
    return total;
  }

  // One honest, non-live-exclusive summary: an execution terminal state is never a contrast pass,
  // both themes are always measured under the active preference, and the OTHER `prefers-color-scheme`
  // value is declared as an unmeasured preference (not a second theme). The runtime still publishes a
  // single status region; this function only shapes its text.
  function statusText() {
    const label = STATE_LABELS[currentState] || String(currentState);
    if (!currentReport) return "Misure locali non eseguite: " + label + ". Nessun contrasto locale è stato verificato in questa pagina.";
    const parts = ["Misure locali: " + label + " (stato di esecuzione, non esito dei contrasti)."];
    const preference = currentReport.preference;
    if (preference) {
      const active = preference.active == null ? "non disponibile" : String(preference.active);
      const other = preference.unmeasured && preference.unmeasured.length
        ? " La preferenza di sistema " + preference.unmeasured.join(", ") + " NON è misurata: è un'altra preferenza, non un altro tema; entrambi i temi sono misurati sotto la preferenza attiva."
        : "";
      parts.push("Preferenza attiva: " + active + "." + other);
    }
    parts.push("Coppie misurate: " + currentReport.measurements.length + " su " + countExpected(currentReport.expected) + ".");
    if (currentReport.unsupported && currentReport.unsupported.length) parts.push("Scenari non supportati: " + currentReport.unsupported.length + ".");
    if (currentReport.coverage) parts.push(currentReport.coverage.complete ? "Copertura completa." : "Copertura incompleta.");
    return parts.join(" ");
  }

  function updateStatusText() {
    if (statusRegion) statusRegion.textContent = statusText();
  }

  function publish(reason) {
    applyHost();
    updateStatusText();
    const snapshot = status();
    for (const listener of listeners.slice()) {
      try {
        listener(snapshot, reason == null ? null : String(reason));
      } catch {
        // A subscriber must never break the run.
      }
    }
  }

  // Bumping the generation marks any in-flight run stale so a preference change can invalidate
  // the local results without waiting for the current measurement pass to finish.
  function invalidate(reason) {
    generation += 1;
    currentReport = null;
    currentState = "pending";
    publish(reason == null ? "invalidate" : reason);
  }

  function finish(report) {
    currentReport = report;
    currentState = report.status;
    publish("report");
    return report;
  }

  // ---------------------------------------------------------------------------
  // Payload
  // ---------------------------------------------------------------------------

  function readPayload() {
    const block = doc.getElementById(PAYLOAD_ID);
    if (!block) return { ok: false, cause: "payload-missing", message: "the inert payload block #" + PAYLOAD_ID + " is missing" };
    let value;
    try {
      value = JSON.parse(block.textContent);
    } catch (error) {
      return { ok: false, cause: "payload-invalid", message: "the payload is not valid JSON: " + (error && error.message ? error.message : error) };
    }
    const validation = validatePayload(value);
    if (!validation.ok) return validation;
    return { ok: true, value };
  }

  function validatePayload(value) {
    const reject = (cause, message) => ({ ok: false, cause, message });
    if (!isRecord(value)) return reject("payload-invalid", "the payload must be a JSON object");
    if (value.schemaVersion !== VERSION) return reject("payload-schema", "unsupported payload schemaVersion " + String(value.schemaVersion) + "; expected " + VERSION);
    if (!isRecord(value.config)) return reject("payload-invalid", "the payload must carry a verifiable config object");
    if (!isRecord(value.css)) return reject("payload-invalid", "the payload must carry a css object");
    if (typeof value.css.baseline !== "string") return reject("payload-invalid", "css.baseline must be a string");
    // A captured output that is empty is never replaced by the generated candidate: it is declared
    // unavailable so nothing is measured, instead of silently confirming the model bytes as real.
    if (value.css.baseline === "" && value.css.source === "output") return reject("baseline-empty", "the captured output is empty; the generated candidate is never substituted, so nothing is measured");
    if (value.css.baseline === "") return reject("payload-invalid", "the payload must carry non-empty baseline CSS bytes");
    if (value.css.tuning != null && typeof value.css.tuning !== "string") return reject("payload-invalid", "css.tuning must be a string or null");
    if (value.css.tuningSupport != null && ["absent", "supported", "unsupported"].indexOf(value.css.tuningSupport) === -1) return reject("payload-invalid", "css.tuningSupport is not a known state");
    // Additive fields: tolerated when absent (legacy payloads) and validated when present.
    if (value.css.source != null && ["output", "generated-candidate"].indexOf(value.css.source) === -1) return reject("payload-invalid", "css.source is not a known state");
    if (value.css.status != null && ["current", "stale", "absent", "empty"].indexOf(value.css.status) === -1) return reject("payload-invalid", "css.status is not a known state");
    if (value.snapshotId != null && typeof value.snapshotId !== "string") return reject("payload-invalid", "snapshotId must be a string");
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // Frames and injection
  // ---------------------------------------------------------------------------

  function clearFrames() {
    for (const frame of frames.slice()) {
      if (frame.parentNode) frame.parentNode.removeChild(frame);
    }
    frames.length = 0;
  }

  function appendStyle(frameDocument, value, text) {
    const style = frameDocument.createElement("style");
    style.setAttribute(CSS_ATTRIBUTE, value);
    style.textContent = text;
    (frameDocument.head || frameDocument.documentElement).appendChild(style);
  }

  function injectPayloadCss(frameDocument, session, variant) {
    appendStyle(frameDocument, "baseline", "@layer tokens {\n" + session.css.baseline + "\n}");
    if (variant === "tuned") appendStyle(frameDocument, "tuning", "@layer tokens {\n" + session.css.tuning + "\n}");
  }

  function createFrame(scenario) {
    const frame = doc.createElement("iframe");
    frame.setAttribute("sandbox", "allow-same-origin");
    frame.setAttribute("title", "Smart Colors " + scenario.variant + " " + scenario.theme);
    frame.setAttribute(HOOK_ATTRIBUTE, HOOKS.scenario);
    frame.setAttribute(SCENARIO_ATTRIBUTE, scenario.id);
    // Declare both schemes on the carrier element BEFORE the srcdoc loads, so the isolated document's
    // `prefers-color-scheme` follows the native/OS preference instead of the embedding UI's pinned
    // color-scheme. The child still pins its own theme via `color-scheme`/`data-theme` after load.
    frame.style.colorScheme = FRAME_COLOR_SCHEME;
    let settle = null;
    const ready = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    let settled = false;
    let timer = null;
    const cleanup = () => {
      if (timer !== null) {
        win.clearTimeout(timer);
        timer = null;
      }
      frame.removeEventListener("load", onLoad);
    };
    function onLoad() {
      if (settled) return;
      settled = true;
      cleanup();
      const frameDocument = frame.contentDocument;
      if (frameDocument && frameDocument.documentElement) settle.resolve(frameDocument);
      else settle.reject(new Error("frame-document-unavailable"));
    }
    frame.addEventListener("load", onLoad);
    timer = win.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      settle.reject(new Error("frame-timeout"));
    }, FRAME_TIMEOUT_MS);
    frame.setAttribute("srcdoc", SKIN);
    (framesContainer || parent()).appendChild(frame);
    frames.push(frame);
    return {
      frame,
      ready,
      cleanup,
      discard() {
        cleanup();
        if (frame.parentNode) frame.parentNode.removeChild(frame);
        const index = frames.indexOf(frame);
        if (index !== -1) frames.splice(index, 1);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  function buildScenarios(session, preference) {
    const variants = ["baseline"];
    if (typeof session.css.tuning === "string" && session.css.tuning !== "") variants.push("tuned");
    const scenarios = [];
    for (const variant of variants) {
      for (const theme of ["light", "dark"]) {
        scenarios.push({ id: variant + "-" + theme + "-" + preference.active, variant, theme, preference: preference.active });
      }
    }
    return scenarios;
  }

  function measureScenario(scenario, contract, session, flags) {
    // The tuned variant injects baseline AND tuning, so an unsupported baseline makes it unsupported
    // too: the tuning state alone must never let a scenario through with unsupported baseline bytes.
    const baselineMessage = "the baseline CSS references @import or url() resources the isolated runner does not load";
    const tuningMessage = "the tuning references @import or url() resources the isolated runner does not load";
    const unsupportedReason = flags.baselineUnsupported
      ? baselineMessage
      : (scenario.variant === "tuned" && flags.tuningUnsupported ? tuningMessage : null);
    if (unsupportedReason) {
      return {
        scenario,
        ran: false,
        reason: unsupportedReason,
        measurements: [],
        errors: [{ phase: "inject", cause: "unsupported-resource", scenarioId: scenario.id, pairId: null, message: unsupportedReason }],
        explorations: [],
        explorationErrors: [],
      };
    }
    const created = createFrame(scenario);
    return created.ready.then(
      (frameDocument) => {
        injectPayloadCss(frameDocument, session, scenario.variant);
        const measured = verifier.measureDocument(frameDocument, scenario, contract);
        // Exploration is measured in the SAME isolated document, on the guaranteed base tokens, with
        // the same collector and core.measurePair: no new frame, no new algorithm and no network.
        // Any exploration failure is kept apart and can never affect the primary scenario.
        let explorations = [];
        const explorationErrors = [];
        if (measured.support === "supported") {
          const explorationPairs = contract && contract.explorationPairs ? contract.explorationPairs[scenario.theme] : null;
          if (Array.isArray(explorationPairs) && explorationPairs.length > 0) {
            try {
              const explorationContract = { pairs: {} };
              explorationContract.pairs[scenario.theme] = explorationPairs;
              const explored = verifier.measureDocument(frameDocument, scenario, explorationContract);
              if (explored.support === "supported") explorations = explored.measurements;
              else explorationErrors.push({ phase: "exploration", cause: "exploration-unsupported", scenarioId: scenario.id, pairId: null, message: explored.error || "the exploration pairs could not be measured" });
            } catch (error) {
              explorationErrors.push({ phase: "exploration", cause: "exploration-failed", scenarioId: scenario.id, pairId: null, message: error && error.message ? error.message : String(error) });
            }
          }
        }
        created.cleanup();
        // A document that could not be proven measurable (unpinned theme, unverifiable light-dark,
        // forced colours, indeterminate registration) is declared unsupported, never measured.
        if (measured.support !== "supported") {
          const reason = measured.error || "the isolated document could not be measured";
          return { scenario, ran: false, reason, measurements: [], errors: measured.errors.length ? measured.errors : [{ phase: "measure", cause: "unsupported-document", scenarioId: scenario.id, pairId: null, message: reason }], explorations: [], explorationErrors: [] };
        }
        return { scenario, ran: true, reason: null, measurements: measured.measurements, errors: measured.errors, explorations, explorationErrors };
      },
      (error) => {
        const message = error && error.message ? error.message : String(error);
        created.discard();
        return {
          scenario,
          ran: false,
          reason: message,
          measurements: [],
          errors: [{ phase: "frame", cause: message === "frame-timeout" ? "frame-timeout" : "frame-unavailable", scenarioId: scenario.id, pairId: null, message }],
          explorations: [],
          explorationErrors: [],
        };
      },
    );
  }

  function buildReport(parts) {
    return {
      provenance: "browser-local",
      mode: "off",
      status: parts.status,
      runtime: { marker: MARKER, version: VERSION },
      snapshotId: parts.snapshotId == null ? null : parts.snapshotId,
      preference: parts.preference == null ? null : parts.preference,
      environment: parts.environment == null ? null : parts.environment,
      expected: parts.expected == null ? { scenarios: [], pairs: {} } : parts.expected,
      executed: parts.executed == null ? { scenarios: [], pairs: {} } : parts.executed,
      scenarios: parts.scenarios == null ? [] : parts.scenarios,
      measurements: parts.measurements == null ? [] : parts.measurements,
      coverage: parts.coverage == null ? null : parts.coverage,
      unsupported: parts.unsupported == null ? [] : parts.unsupported,
      errors: parts.errors == null ? [] : parts.errors,
      notes: parts.notes == null ? [] : parts.notes,
      // Exploration stays in its own slots: it never enters `measurements`, `coverage` or the status.
      explorations: parts.explorations == null ? [] : parts.explorations,
      explorationErrors: parts.explorationErrors == null ? [] : parts.explorationErrors,
      explorationCoverage: parts.explorationCoverage == null ? null : parts.explorationCoverage,
      measuredAt: parts.measuredAt == null ? null : parts.measuredAt,
    };
  }

  // Advisory exploration coverage, computed from the scenarios that actually ran: expected is the
  // bounded exploration pair count per measured scenario, never part of `coverage` or the status.
  function explorationCoverageFor(contract, results, explorations, explorationErrors) {
    let expected = 0;
    const omitted = [];
    for (const result of results) {
      if (!result.ran) continue;
      const theme = result.scenario.theme;
      const pairs = contract && contract.explorationPairs ? contract.explorationPairs[theme] : null;
      expected += Array.isArray(pairs) ? pairs.length : 0;
      const families = contract && contract.explorationScope && contract.explorationScope.omittedFamilies ? contract.explorationScope.omittedFamilies[theme] : null;
      if (Array.isArray(families)) for (const family of families) if (omitted.indexOf(family) === -1) omitted.push(family);
    }
    const measured = explorations.filter((measurement) => measurement.status !== "unmeasured").length;
    return {
      expected,
      measured,
      unmeasured: Math.max(0, expected - measured),
      omittedFamilies: omitted,
      complete: expected > 0 && measured === expected && explorationErrors.length === 0,
    };
  }

  function environment() {
    const navigator = win.navigator || {};
    const preference = verifier.observePreference(win);
    return {
      userAgent: navigator.userAgent ? String(navigator.userAgent) : null,
      language: navigator.language ? String(navigator.language) : null,
      preference: preference.active,
      forcedColors: verifier.forcedColorsActive(win),
    };
  }

  function assembleReport(session, preference, scenarios, contract, results, measuredAt) {
    const expectedPairs = {};
    for (const scenario of scenarios) expectedPairs[scenario.id] = (contract.pairs[scenario.theme] || []).map((pair) => pair.id);
    const expectedList = scenarios.map((scenario) => ({ id: scenario.id, pairIds: expectedPairs[scenario.id] }));

    const executedPairs = {};
    const executedScenarios = [];
    const measurements = [];
    const errors = [];
    const unsupported = [];
    const scenarioRecords = [];
    const explorations = [];
    const explorationErrors = [];
    for (const result of results) {
      const id = result.scenario.id;
      scenarioRecords.push({
        id,
        theme: result.scenario.theme,
        variant: result.scenario.variant,
        preference: result.scenario.preference,
        status: result.ran ? "measured" : "unsupported",
        reason: result.reason == null ? null : result.reason,
      });
      if (result.ran) {
        executedScenarios.push(id);
        executedPairs[id] = result.measurements.map((measurement) => measurement.pairId);
        for (const measurement of result.measurements) measurements.push(measurement);
      } else if (result.reason != null) {
        unsupported.push({ id, reason: result.reason });
      }
      for (const error of result.errors) errors.push(error);
      if (Array.isArray(result.explorations)) for (const measurement of result.explorations) explorations.push(measurement);
      if (Array.isArray(result.explorationErrors)) for (const error of result.explorationErrors) explorationErrors.push(error);
    }

    const coverage = core.coverage(expectedList, measurements);
    const explorationCoverage = explorationCoverageFor(contract, results, explorations, explorationErrors);
    const ranAny = results.some((result) => result.ran);
    const allUnsupported = results.length > 0 && results.every((result) => !result.ran);
    let status = "incomplete";
    if (allUnsupported) status = "unsupported";
    else if (!ranAny) status = "unavailable";
    else if (coverage.complete && errors.length === 0) status = "complete";

    const notes = ["Le misure locali riguardano i byte CSS incorporati nel payload, non il progetto su disco; rigenera dopo ogni modifica."];
    if (preference.unmeasured.length) notes.push("Preferenza " + preference.unmeasured.join(", ") + " non misurata: il runner locale non riscrive i media query per simulare l'altra preferenza (la copertura completa arriva dall'automazione).");
    for (const entry of unsupported) notes.push("Scenario " + entry.id + " non supportato: " + entry.reason + ".");

    return buildReport({
      status,
      snapshotId: session.snapshotId,
      preference,
      environment: environment(),
      expected: { scenarios: scenarios.map((scenario) => scenario.id), pairs: expectedPairs },
      executed: { scenarios: executedScenarios, pairs: executedPairs },
      scenarios: scenarioRecords,
      measurements,
      coverage,
      unsupported,
      errors,
      notes,
      explorations,
      explorationErrors,
      explorationCoverage,
      measuredAt,
    });
  }

  function run(reason) {
    init();
    if (running) {
      pendingRun = true;
      return Promise.resolve(currentReport);
    }
    running = true;
    // The trigger is published, not a generic "run": subscribers can tell a retry or a queued run
    // from the boot run without inspecting the state twice.
    invalidate(reason == null ? "run" : String(reason));
    const token = generation;
    currentState = "running";
    publish("running");
    let work;
    try {
      work = execute();
    } catch (error) {
      work = Promise.resolve(buildReport({
        status: "incomplete",
        preference: verifier.observePreference(win),
        environment: environment(),
        errors: [{ phase: "run", cause: "runtime-error", scenarioId: null, pairId: null, message: error && error.message ? error.message : String(error) }],
        measuredAt: nowIso(),
      }));
    }
    const settle = (report) => {
      running = false;
      const finished = token === generation ? finish(report) : currentReport;
      if (pendingRun) {
        pendingRun = false;
        requestRun("queued");
      }
      return finished;
    };
    return work.then(
      (report) => settle(report),
      (error) => settle(buildReport({
        status: "incomplete",
        preference: verifier.observePreference(win),
        environment: environment(),
        errors: [{ phase: "run", cause: "runtime-error", scenarioId: null, pairId: null, message: error && error.message ? error.message : String(error) }],
        measuredAt: nowIso(),
      })),
    );
  }

  async function execute() {
    const measuredAt = nowIso();
    const payload = readPayload();
    if (!payload.ok) {
      return buildReport({
        status: "incomplete",
        preference: verifier.observePreference(win),
        environment: environment(),
        errors: [{ phase: "payload", cause: payload.cause, scenarioId: null, pairId: null, message: payload.message }],
        measuredAt,
      });
    }
    const session = payload.value;
    const preference = verifier.observePreference(win);
    const contract = core.createContract(session.config);
    const flags = {
      baselineUnsupported: containsUnsupported(session.css.baseline),
      tuningUnsupported: containsUnsupported(session.css.tuning),
    };
    const scenarios = buildScenarios(session, preference);
    scenarioCache = scenarios;
    clearFrames();
    const results = [];
    for (const scenario of scenarios) results.push(await measureScenario(scenario, contract, session, flags));
    return assembleReport(session, preference, scenarios, contract, results, measuredAt);
  }

  // ---------------------------------------------------------------------------
  // Public controller
  // ---------------------------------------------------------------------------

  function preference() {
    return verifier.observePreference(win);
  }

  function scenarios() {
    return scenarioCache.map((scenario) => ({ id: scenario.id, variant: scenario.variant, theme: scenario.theme, preference: scenario.preference }));
  }

  function status() {
    return {
      state: currentState,
      preference: currentReport ? currentReport.preference : (initialized ? verifier.observePreference(win) : null),
      report: currentReport,
      scenarios: scenarioCache.map((scenario) => scenario.id),
      snapshotId: currentReport ? currentReport.snapshotId : null,
      measuredAt: currentReport ? currentReport.measuredAt : null,
    };
  }

  function report() {
    return currentReport;
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("subscribe expects a function");
    listeners.push(listener);
    return function unsubscribe() {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  const controller = {
    marker: MARKER,
    version: VERSION,
    states: STATES.slice(),
    hooks: {
      host: HOOKS.host,
      frames: HOOKS.frames,
      status: HOOKS.status,
      retry: HOOKS.retry,
      scenario: HOOKS.scenario,
    },
    attributes: {
      hook: HOOK_ATTRIBUTE,
      state: STATE_ATTRIBUTE,
      scenario: SCENARIO_ATTRIBUTE,
      stylesheet: CSS_ATTRIBUTE,
      hostId: HOST_ID,
      payloadId: PAYLOAD_ID,
    },
    retryLabel: RETRY_LABEL,
    frameTimeoutMs: FRAME_TIMEOUT_MS,
    frameColorScheme: FRAME_COLOR_SCHEME,
    ready: true,
    preference,
    scenarios,
    status,
    report,
    run,
    invalidate,
    subscribe,
    containsUnsupportedResources: containsUnsupported,
    get host() {
      init();
      return host;
    },
    get button() {
      init();
      return retryButton;
    },
    get region() {
      init();
      return statusRegion;
    },
    get frames() {
      return frames.slice();
    },
  };

  init();
  return controller;
}
