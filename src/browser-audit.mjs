import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { arrow, badge, check, file, title } from "./cli-style.mjs";
import { DIAGNOSTIC_PAYLOAD_ID, DIAGNOSTIC_RUNTIME_GLOBAL, DIAGNOSTIC_STATES, createDiagnosticRuntimeSource } from "./diagnostic-runtime.mjs";
import { analyzeColorTokens, generateColorTokens } from "./generate-colors.mjs";
import { loadSmartColorsConfig } from "./load-config.mjs";
import { createPlaywrightProvider } from "./playwright-provider.mjs";
import { writeContrastReport } from "./report-artifact.mjs";
import { assertReportInputsUnchanged, captureReportInputs, darkFillTuningIdentity, formatReportSummary, mergeSideEffect, paletteOverrideNote, proposalImproves, publishedProposal, reportCandidates, reportOverlapScenario, reportScenario, reportSideEffect, reportSnapshot, resolveTuningFile, structuralChanges, REPORT_FILES } from "./report-data.mjs";
import { REPORT_DOCUMENTS } from "./report-paths.mjs";
import { createVerificationCore } from "./verification-core.mjs";

// Single origin of the numeric contract and the pair catalog (plan §5.1.1). The legacy helpers
// below stay exported with their exact output shape and labels; they only delegate the duplicated
// parser/catalog/formulas to this core instead of carrying a second implementation.
const core = createVerificationCore();

export const SUPPORTED_BROWSERS = ["chromium", "firefox", "webkit"];

const TOLERANCE = 0.0001;
const DEFAULT_IDENTITIES = ["primary", "secondary", "info"];
const FAMILY = ["surface", "surface-strong", "border", "border-strong", "solid", "solid-hover", "solid-text", "text", "text-strong"];
// Only opaque control consumers are in scope; translucent borders/icons are not.
const CONTROLS = ["bg", "bg-active", "border-active", "active-text", "focus-bg"];

export function hue(value) { return ((value % 360) + 360) % 360; }

export function close(actual, expected, label, tolerance = TOLERANCE) {
  for (const channel of ["l", "c", "h"]) {
    assert.ok(Number.isFinite(actual[channel]), `${label}: non-finite ${channel}`);
    const difference = channel === "h"
      ? Math.min(Math.abs(hue(actual.h) - hue(expected.h)), 360 - Math.abs(hue(actual.h) - hue(expected.h)))
      : Math.abs(actual[channel] - expected[channel]);
    assert.ok(difference <= tolerance, `${label}: ${channel}=${actual[channel]}, expected ${expected[channel]} (delta ${difference}, max ${tolerance})`);
  }
}

// Legacy fixture parser: the alpha scope message and the returned coordinates are preserved, but
// the OKLCH/sRGB math is the shared core parser, not a local copy.
export function source(value, label) {
  const serialized = String(value);
  if (serialized.includes("/")) throw new assert.AssertionError({ message: `${label}: alpha colors are outside this fixture's scope` });
  return core.parseComputedColor(serialized, label);
}

export function pairsFor(scheme, identities = DEFAULT_IDENTITIES, decoratives = []) {
  // The core catalog is the single origin; the legacy shape has no id/theme fields.
  return core.pairsFor(scheme, identities, decoratives).map(({ id, theme, ...pair }) => pair);
}

export function pairTarget(config, scheme, kind) {
  return core.pairTarget(config, scheme, kind);
}

export function warningStatus(ratio, target, minimum) {
  return core.warningStatus(ratio, target, minimum);
}

export async function computedTheme(page, report, scheme, withScales, options = {}) {
  const { identities = DEFAULT_IDENTITIES, decoratives = [], tuningCss = "", colorParser = source } = options;
  assert.ok(!/@import\b/i.test(tuningCss.replace(/\/\*[\s\S]*?\*\//g, "")), "Tuning @import is unsupported by this inline offline audit; imported overrides must not be silently omitted.");
  const tokens = ["--color-bg", "--color-surface", "--color-text", "--color-text-muted", "--color-focus-ring",
    ...CONTROLS.map((suffix) => `--color-control-${suffix}`),
    ...identities.flatMap((name) => [`--color-${name}`, `--color-${name}-ink`, ...FAMILY.map((suffix) => `--color-${name}-${suffix}`), ...(withScales ? [`--color-${name}-500`] : [])]),
    ...decoratives.flatMap((name) => [`--color-${name}`, `--color-${name}-ink`])];
  const pairs = pairsFor(scheme, identities, decoratives);
  await page.emulateMedia({ colorScheme: options.preference ?? scheme });
  await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Smart Colors regression fixture</title></head><body><main></main></body></html>', { timeout: 15000 });
  // Same layer and source order as global.css: generated first, tuning second.
  await page.addStyleTag({ content: `@layer tokens {\n${report.css}\n}\n@layer tokens {\n${tuningCss}\n}` });
  const result = await page.evaluate(({ scheme, tokens, pairs, themeAttribute }) => {
    document.documentElement.style.colorScheme = scheme;
    if (themeAttribute) document.documentElement.dataset.theme = scheme;
    const main = document.querySelector("main");
    const rootStyle = getComputedStyle(document.documentElement);
    for (const token of tokens) {
      const resolved = rootStyle.getPropertyValue(token).trim();
      if (!resolved || !CSS.supports("color", resolved)) {
        throw new Error(`${scheme} ${token}: missing or invalid resolved color (${resolved}); inherited/default colors cannot count as a pass.`);
      }
    }
    const read = (foreground, background, text, property = "color") => {
      const element = document.createElement(text.includes("control ") ? "button" : "div");
      if (element instanceof HTMLButtonElement) element.type = "button";
      element.textContent = text;
      element.style[property] = `var(${foreground})`;
      element.style.backgroundColor = `var(${background})`;
      if (property === "borderColor") element.style.borderStyle = "solid";
      if (property === "outlineColor") element.style.outlineStyle = "solid";
      main.append(element);
      const computed = getComputedStyle(element);
      return { foreground: computed[property], background: computed.backgroundColor };
    };
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      tokens: Object.fromEntries(tokens.map((token) => [token, read(token, token, token)])),
      pairs: pairs.map((pair) => ({ ...pair, computed: read(pair.foreground, pair.background, pair.label, pair.property) })),
    };
  }, { scheme, tokens, pairs, themeAttribute: options.themeAttribute ?? false });
  assert.equal(result.scheme, scheme);
  return {
    tokens: new Map(Object.entries(result.tokens).map(([token, value]) => {
      const foreground = colorParser(value.foreground, `${scheme} ${token} foreground`);
      close(colorParser(value.background, `${scheme} ${token} background`), foreground, `${scheme} ${token} both properties`);
      return [token, foreground];
    })),
    pairs: result.pairs.map((pair) => ({ ...pair, foregroundColor: colorParser(pair.computed.foreground, pair.label), backgroundColor: colorParser(pair.computed.background, pair.label) })),
  };
}

// The browser resolves CSS; this parses its serialization without Color.js. The clipped-sRGB
// reference math lives in the shared core so the audit cannot drift from the generator. The one
// legacy-specific behavior kept here is the exact alpha scope message the audit harness asserts.
export function auditColor(value, label) {
  try {
    return core.parseComputedColor(String(value), label);
  } catch (error) {
    const message = String(error && error.message ? error.message : error);
    if (message.includes("translucent colors are outside")) {
      throw new assert.AssertionError({ message: `${label}: translucent colors are outside this audit's scope` });
    }
    throw error;
  }
}

export function auditPairs(report, computed, scheme) {
  // Thresholds come from the frozen contract built from the same config, so target/minimum are not
  // re-derived per pair; the ratio and the classification use the shared core functions.
  const declared = new Map(core.createContract(report.config).pairs[scheme].map((pair) => [pair.label, pair]));
  return computed.pairs.map((pair) => {
    const spec = declared.get(pair.label);
    assert.ok(spec, `Undeclared pair ${pair.label}: no contract thresholds for ${scheme}`);
    // The same fail-closed threshold contract as `measurePair`: a missing or
    // incoherent target must never fall through to `pass`.
    assert.ok(
      Number.isFinite(spec.target) && Number.isFinite(spec.minimum) && spec.target > 0 && spec.minimum > 0 && spec.minimum <= spec.target,
      `${pair.label}: pair requires finite positive thresholds with minimum <= target`,
    );
    const ratio = core.contrast(pair.foregroundColor, pair.backgroundColor);
    assert.ok(Number.isFinite(ratio), `${pair.label}: non-finite contrast`);
    return { ...pair, ratio, target: spec.target, minimum: spec.minimum, status: core.warningStatus(ratio, spec.target, spec.minimum) };
  });
}

export function canonicalRoot(css) {
  // Accept presentation-only drift, not different selectors, duplicate
  // declarations, priorities or rules that might change the cascade.
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const match = /^:root\s*\{([^{}]*)\}\s*$/.exec(uncommented);
  assert.ok(match, "Expected exactly one generated :root rule; other rule structures require regeneration");
  const entries = match[1].split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf(":");
    assert.ok(separator > 0, `Invalid generated declaration ${part}`);
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  });
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length, "Duplicate generated declarations require regeneration");
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

// The same discard is observed by every requested browser: publish each reason once.
export function uniqueRejections(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.id}\u0000${entry.file}\u0000${entry.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Legacy public launcher. Resolution is anchored at the effective root only (no global and no
// checkout fallback); the phase-specific messages are preserved for the existing harnesses.
export async function launch(name, root = process.cwd()) {
  assert.ok(SUPPORTED_BROWSERS.includes(name), `Unknown browser ${name}. Supported browsers: ${SUPPORTED_BROWSERS.join(", ")}.`);
  const provider = createPlaywrightProvider({ root });
  const opened = await provider.open();
  if (!opened.ok) {
    throw new Error(`Playwright non trovato per avviare ${name}. Installa playwright o @playwright/test nel progetto ed esegui: pnpm exec playwright install ${name}`, { cause: opened });
  }
  const available = await provider.availability(name);
  if (!available.available) {
    throw new Error(available.message, { cause: available });
  }
  const browser = await provider.launch(name);
  console.log(`${name}: launched ${browser.version()} (${available.executable})`);
  return browser;
}

// ---------------------------------------------------------------------------
// Structured automation adapter (plan §5.1.1, §7 SC-05).
//
// `runAutomation(session, options)` returns a serializable VerificationRun and never sets an exit
// code or logs. It reuses the SC-04 runtime verbatim (same core, same collector, same bytes) inside
// a controlled page, once per emulated system preference, so each engine covers the four
// theme/preference crossings for both the baseline and the tuned stylesheet. Environment phases
// (discovery/import/availability/launch) stay distinct from run phases (payload/setup/measure),
// and incomplete coverage is reported, never suppressed.
// ---------------------------------------------------------------------------

const AUTOMATION_MODES = ["auto", "off", "required"];
const AUTOMATION_RUN_PREFERENCES = ["light", "dark"];
const SCENARIO_THEMES = ["light", "dark"];
const AUTOMATION_TERMINAL_STATES = DIAGNOSTIC_STATES.filter((state) => ["complete", "incomplete", "unavailable", "unsupported"].includes(state));
// Phases that describe the environment rather than a measurement; a run can be complete while one
// requested engine was simply unavailable.
const ENVIRONMENT_PHASES = ["discovery", "import", "availability", "launch"];
const DEFAULT_AUTOMATION_TIMEOUT_MS = 15000;
// One budget for the whole automation phase of a run (discovery → launch → measure → cleanup). No
// per-operation timeout can extend it: every await is bounded by the remaining budget, so a hanging
// provider cannot withhold the HTML publication indefinitely. Tests inject a small `overallTimeoutMs`.
const DEFAULT_AUTOMATION_OVERALL_TIMEOUT_MS = 60000;
export const AUTOMATION_OVERALL_TIMEOUT_MS = DEFAULT_AUTOMATION_OVERALL_TIMEOUT_MS;
// Cleanup runs with an explicit, finite grace beyond the main budget, so the run always concludes
// within `overallTimeoutMs` plus at most this grace — a "budget + grace" bound, not an exact 60 s.
const CLEANUP_GRACE_MS = 1000;
// A late fulfillment (a browser/context delivered after the deadline) gets a shorter grace.
const LATE_CLEANUP_GRACE_MS = 250;

function usageError(message) {
  const error = new Error(message);
  error.code = "SMART_COLORS_USAGE";
  return error;
}

function inertJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// The minimum inert page the SC-04 runtime needs: the payload block plus the hashed runtime source.
function runtimeFixtureHtml(payload, runtimeSource) {
  return [
    "<!doctype html>",
    '<html lang="it"><head><meta charset="utf-8"><title>Smart Colors automation</title></head><body>',
    '<script type="application/json" id="' + DIAGNOSTIC_PAYLOAD_ID + '">' + inertJson(payload) + "</script>",
    "<script>" + runtimeSource + "</script>",
    "</body></html>",
    "",
  ].join("\n");
}

// Only the fields the runtime validates and consumes, derived from the SC-03 session. `analysis`
// and `captured` are Node-only and never reach the payload.
function sessionPayload(session) {
  const css = session && typeof session.css === "object" && session.css !== null ? session.css : {};
  const tuning = typeof css.tuning === "string" ? css.tuning : null;
  return {
    schemaVersion: session && Number.isFinite(session.schemaVersion) ? session.schemaVersion : 1,
    toolVersion: session && typeof session.toolVersion === "string" ? session.toolVersion : null,
    snapshotId: session && typeof session.snapshotId === "string" ? session.snapshotId : null,
    css: {
      baseline: typeof css.baseline === "string" ? css.baseline : "",
      tuning,
      tuningSupport: ["absent", "supported", "unsupported"].includes(css.tuningSupport) ? css.tuningSupport : (tuning === null ? "absent" : "supported"),
      // Additive passthrough only: the payload never carries the full `generated` string (it is
      // already the report meta node). `source`/`status`/`production`/`digest` describe where the
      // measured baseline came from; the runner tolerates nulls, so legacy payloads stay valid.
      source: css.source === "output" || css.source === "generated-candidate" ? css.source : null,
      status: ["current", "stale", "absent", "empty"].includes(css.status) ? css.status : null,
      production: css.production === true,
      digest: css.digest && typeof css.digest === "object"
        ? {
          generated: typeof css.digest.generated === "string" ? css.digest.generated : null,
          baseline: typeof css.digest.baseline === "string" ? css.digest.baseline : null,
        }
        : null,
    },
    config: session && typeof session.config === "object" && session.config !== null ? session.config : null,
    model: session && typeof session.model === "object" && session.model !== null ? session.model : { diagnostics: [], errors: [], warnings: [] },
    samples: session && Array.isArray(session.samples) ? session.samples : [],
    notes: session && Array.isArray(session.notes) ? session.notes : [],
  };
}

// Scenario ids are namespaced with the engine, so the same runtime scenario measured in two engines
// stays two distinct identities and coverage never silently deduplicates them.
function namespaceScenario(engine, scenarioId) {
  return engine + "/" + scenarioId;
}

function namespaceReport(engine, report) {
  const renamePairs = (pairs) => {
    const renamed = {};
    for (const [id, pairIds] of Object.entries(pairs ?? {})) renamed[namespaceScenario(engine, id)] = pairIds;
    return renamed;
  };
  return {
    engine,
    status: report.status,
    preference: report.preference,
    environment: report.environment,
    measuredAt: report.measuredAt,
    expected: {
      scenarios: (report.expected?.scenarios ?? []).map((id) => namespaceScenario(engine, id)),
      pairs: renamePairs(report.expected?.pairs),
    },
    executed: {
      scenarios: (report.executed?.scenarios ?? []).map((id) => namespaceScenario(engine, id)),
      pairs: renamePairs(report.executed?.pairs),
    },
    scenarios: (report.scenarios ?? []).map((record) => ({ ...record, id: namespaceScenario(engine, record.id), engine })),
    measurements: (report.measurements ?? []).map((measurement) => ({ ...measurement, engine, scenarioId: namespaceScenario(engine, measurement.scenarioId) })),
    unsupported: (report.unsupported ?? []).map((entry) => ({ ...entry, id: namespaceScenario(engine, entry.id), engine })),
    errors: (report.errors ?? []).map((error) => ({ ...error, engine, scenarioId: error.scenarioId == null ? null : namespaceScenario(engine, error.scenarioId) })),
    // Exploration is additive and advisory: it is namespaced like the primary data but kept in its
    // own arrays so it never enters `measurements`, primary coverage or the exit policy.
    explorations: (report.explorations ?? []).map((measurement) => ({ ...measurement, engine, scenarioId: namespaceScenario(engine, measurement.scenarioId) })),
    explorationErrors: (report.explorationErrors ?? []).map((error) => ({ ...error, engine, scenarioId: error.scenarioId == null ? null : namespaceScenario(engine, error.scenarioId) })),
    explorationCoverage: report.explorationCoverage ?? null,
  };
}

function selectEngines(mode, browsers) {
  if (browsers == null) return mode === "required" ? ["chromium"] : [...SUPPORTED_BROWSERS];
  if (!Array.isArray(browsers) || browsers.length === 0) throw usageError("An explicit browser list must be a non-empty array of engine names.");
  const unique = [];
  for (const name of browsers) {
    if (!SUPPORTED_BROWSERS.includes(name)) throw usageError(`Unknown browser ${name}. Supported browsers: ${SUPPORTED_BROWSERS.join(", ")}.`);
    if (!unique.includes(name)) unique.push(name);
  }
  return unique;
}

// Called only for an engine that already launched. A missing report means that emulated preference
// failed in the run phase (payload/setup/measure): an incomplete verification, never an unavailable
// environment. Only the environment phases can make a run unavailable.
function engineStatus(reports, attempted) {
  if (reports.length === 0 || reports.length < attempted) return "incomplete";
  if (reports.every((report) => report.status === "complete")) return "complete";
  if (reports.every((report) => report.status === "unsupported")) return "unsupported";
  return "incomplete";
}

function engineReason(reports) {
  const failed = reports.filter((report) => report.status !== "complete");
  if (failed.length === 0) return null;
  const error = failed[0].errors.find((entry) => entry.message);
  return error ? error.message : `stato ${failed.map((report) => report.status).join(", ")}`;
}

function buildRun(parts) {
  return {
    provenance: "browser-automation",
    mode: parts.mode,
    status: parts.status,
    snapshotId: parts.snapshotId ?? null,
    engines: parts.engines ?? [],
    environment: parts.environment ?? null,
    expected: parts.expected ?? { scenarios: [], pairs: {} },
    executed: parts.executed ?? { scenarios: [], pairs: {} },
    scenarios: parts.scenarios ?? [],
    measurements: parts.measurements ?? [],
    coverage: parts.coverage ?? null,
    unsupported: parts.unsupported ?? [],
    errors: parts.errors ?? [],
    // Exploration aggregation: separate from the primary measurements/coverage above; never merged
    // into them, so it can neither confirm nor block the primary verdict.
    explorations: parts.explorations ?? [],
    explorationErrors: parts.explorationErrors ?? [],
    explorationCoverage: parts.explorationCoverage ?? null,
    notes: parts.notes ?? [],
    partial: Boolean(parts.partial),
    // Planned matrix for every requested engine (the CLI's requested-coverage metadata), distinct from
    // `expected`, which only reflects the engines that actually reported plus launched-measure-failed.
    planned: parts.planned ?? { scenarios: [], pairs: {} },
    requestedEngines: parts.requestedEngines ?? [],
    measuredAt: parts.measuredAt ?? null,
  };
}

function unavailableEngines(names, phase, reason) {
  return names.map((name) => ({ name, launched: false, status: "unavailable", version: null, executable: null, phase, reason }));
}

function idleRun({ mode, status, snapshotId, engines, errors, notes, planned, requestedEngines }) {
  return buildRun({ mode, status, snapshotId, engines: engines ?? [], errors: errors ?? [], notes: notes ?? [], coverage: core.coverage([], []), environment: null, measuredAt: null, planned, requestedEngines });
}

// ---------------------------------------------------------------------------
// Overall budget: every potentially-stalling await is bounded by the remaining budget of the run.
// This bounds discovery/import/availability/launch and context/page/measure/cleanup alike, and turns
// a hung provider into a structured phase/cause timeout instead of an unresolved await. Cancelling an
// in-flight ESM import is impossible, so the deadline operates on the *wait*: a late fulfillment is
// cleaned up best-effort, never awaited further.
// ---------------------------------------------------------------------------

function createDeadline(options) {
  if (Number.isFinite(options.deadline) && options.deadline > 0) return { at: options.deadline };
  const budget = Number.isFinite(options.overallTimeoutMs) && options.overallTimeoutMs > 0 ? options.overallTimeoutMs : DEFAULT_AUTOMATION_OVERALL_TIMEOUT_MS;
  return { at: Date.now() + budget };
}

function deadlineError(phase, cause, engine, message) {
  const error = new Error(message);
  error.phase = phase;
  error.cause = cause;
  error.engine = engine ?? null;
  error.timedOut = true;
  return error;
}

// Race a promise against the remaining budget. Resolves with the value, rethrows a real error, or
// throws a structured timeout. A late fulfillment is handed to `onLate` (bounded cleanup) and a late
// rejection is swallowed, so no unhandled rejection and no leaked browser/context survive the race.
const DEADLINE = Symbol("smart-colors-deadline");

// The operation is a FACTORY, so the budget is checked *before* the first await/start: a zero/negative
// budget never starts the operation (no wasted work, nothing to clean up). A synchronous throw from
// the factory is captured as a structured failure, and a real error is rethrown unchanged (its cause
// is preserved), never rewritten into a timeout.
async function withinDeadline(factory, deadline, { phase, cause, engine = null, message, onLate = null }) {
  const remaining = deadline.at - Date.now();
  if (remaining <= 0) throw deadlineError(phase, cause, engine, message);
  const guarded = Promise.resolve().then(() => factory()).then((value) => ({ value }), (error) => ({ error }));
  const handleLate = () => {
    if (typeof onLate !== "function") return;
    guarded.then((late) => { if (late && Object.hasOwn(late, "value")) Promise.resolve(onLate(late.value)).catch(() => {}); });
  };
  let timer;
  const guard = new Promise((resolve) => { timer = setTimeout(() => resolve(DEADLINE), remaining); });
  let outcome;
  try {
    outcome = await Promise.race([guarded, guard]);
  } finally {
    clearTimeout(timer);
  }
  if (outcome === DEADLINE) { handleLate(); throw deadlineError(phase, cause, engine, message); }
  if (outcome && Object.hasOwn(outcome, "error")) throw outcome.error;
  return outcome ? outcome.value : undefined;
}

function cleanupBudget(deadline, grace = CLEANUP_GRACE_MS) {
  const remaining = deadline ? deadline.at - Date.now() : 0;
  const cap = remaining > 0 ? Math.min(remaining, grace) : grace;
  return { at: Date.now() + cap };
}

// Best-effort close with an explicit finite grace. Returns the timeout error when the close did not
// complete so the caller records it (a cleanup failure is never swallowed); a hung close can never
// block the caller. "Best effort" is accurate: if the underlying close is itself blocked, no stronger
// guarantee is claimed beyond the grace, and we keep no timer/listener that could outlive the run.
async function closeQuietly(target, deadline, grace = CLEANUP_GRACE_MS) {
  if (!target || typeof target.close !== "function") return null;
  try {
    await withinDeadline(() => target.close(), cleanupBudget(deadline, grace), { phase: "cleanup", cause: "cleanup-timeout", message: "close() did not complete within the cleanup budget" });
    return null;
  } catch (error) {
    return error;
  }
}

// Contract-backed planned matrix for one engine: baseline plus tuned (only when a non-empty tuning
// stylesheet exists), both themes, both emulated preferences — exactly the identities the SC-04
// runtime reports, namespaced per engine. Declared before measurement so a measure failure is a
// visible "expected > 0, measured 0", never a misleading "0/0".
function plannedMatrix(session, engineName, contract) {
  const css = session && typeof session.css === "object" && session.css !== null ? session.css : {};
  const variants = ["baseline"];
  if (typeof css.tuning === "string" && css.tuning !== "") variants.push("tuned");
  const scenarios = [];
  const pairs = {};
  for (const preference of AUTOMATION_RUN_PREFERENCES) {
    for (const variant of variants) {
      for (const theme of SCENARIO_THEMES) {
        const id = namespaceScenario(engineName, `${variant}-${theme}-${preference}`);
        scenarios.push(id);
        pairs[id] = (contract.pairs[theme] ?? []).map((pair) => pair.id);
      }
    }
  }
  return { scenarios, pairs };
}

// One page per emulated preference; the runtime measures both themes under that preference, so two
// pages per engine cover the four theme/preference crossings (baseline and tuned). Errors (measure and
// cleanup) are pushed into the shared run-level `errors`, so a late cleanup failure is recorded too.
async function measureEngine(browser, engineName, { payload, runtimeSource, timeoutMs, deadline, errors }) {
  const reports = [];
  const html = runtimeFixtureHtml(payload, runtimeSource);
  const measureMessage = (preference, label) => `preferenza ${preference}: budget complessivo esaurito durante ${label}.`;
  for (const preference of AUTOMATION_RUN_PREFERENCES) {
    let context = null;
    try {
      context = await withinDeadline(() => browser.newContext({ colorScheme: preference, reducedMotion: "reduce" }), deadline, {
        phase: "measure", cause: "timeout", engine: engineName, message: measureMessage(preference, "la creazione del contesto"),
        onLate: (lateContext) => closeQuietly(lateContext, deadline, LATE_CLEANUP_GRACE_MS).then((lateError) => {
          if (lateError) errors.push({ phase: "cleanup", cause: "cleanup-timeout", engine: engineName, scenarioId: null, pairId: null, message: `preferenza ${preference}: contesto tardivo non chiuso entro il grace di cleanup (${lateError.message}).` });
        }),
      });
      // Network is blocked; only http(s) is aborted so the local srcdoc measurement frames still load.
      await withinDeadline(() => context.route(/^https?:\/\//i, (route) => route.abort()), deadline, { phase: "measure", cause: "timeout", engine: engineName, message: measureMessage(preference, "il blocco della rete") });
      const page = await withinDeadline(() => context.newPage(), deadline, { phase: "measure", cause: "timeout", engine: engineName, message: measureMessage(preference, "la creazione della pagina") });
      page.setDefaultTimeout(timeoutMs);
      await withinDeadline(() => page.setContent(html, { timeout: timeoutMs, waitUntil: "load" }), deadline, { phase: "measure", cause: "timeout", engine: engineName, message: measureMessage(preference, "il caricamento della fixture") });
      await withinDeadline(() => page.waitForFunction(
        ({ global, terminal }) => {
          const controller = window[global];
          if (!controller) return false;
          const report = controller.report();
          return Boolean(report && terminal.indexOf(controller.status().state) !== -1);
        },
        { global: DIAGNOSTIC_RUNTIME_GLOBAL, terminal: AUTOMATION_TERMINAL_STATES },
        { timeout: timeoutMs },
      ), deadline, { phase: "measure", cause: "timeout", engine: engineName, message: measureMessage(preference, "l'attesa dello stato terminale") });
      reports.push(await withinDeadline(() => page.evaluate((global) => window[global].report(), DIAGNOSTIC_RUNTIME_GLOBAL), deadline, { phase: "measure", cause: "timeout", engine: engineName, message: measureMessage(preference, "la lettura del report") }));
    } catch (error) {
      // Keep the structured timeout cause; only a real run failure becomes
      // `runtime-run-failed`. The message already carries the preference.
      const cause = error && error.timedOut ? "timeout" : "runtime-run-failed";
      errors.push({
        phase: "measure", cause, engine: engineName, scenarioId: null, pairId: null,
        message: `preferenza ${preference}: ${error && error.message ? error.message : error}`,
      });
    } finally {
      if (context) {
        // A cleanup failure is never a silent pass: it is recorded and leaves coverage unconfirmed.
        const cleanupError = await closeQuietly(context, deadline);
        if (cleanupError) errors.push({ phase: "cleanup", cause: "cleanup-timeout", engine: engineName, scenarioId: null, pairId: null, message: `preferenza ${preference}: contesto non chiuso entro il grace di cleanup (${cleanupError.message}); la copertura non è confermata.` });
      }
    }
  }
  return { reports, attempted: AUTOMATION_RUN_PREFERENCES.length };
}

/**
 * Run the shared verification runtime through Playwright and return a structured VerificationRun.
 *
 * `mode` is `auto|off|required` (plan §4.2): `auto` tries every supported engine and declares the
 * ones it skips, `required` defaults to Chromium, `off` performs no discovery and no import at all.
 * `browsers` is an explicit engine list; the CLI validates the flag/browser-list combination later,
 * so combining a list with `auto`/`off` is rejected here as a usage error too. `provider` allows a
 * fully injected fake in the tests. The function returns data only: no `process.exitCode`, no log.
 */
export async function runAutomation(session, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const mode = options.mode ?? "auto";
  if (!AUTOMATION_MODES.includes(mode)) throw usageError(`Unknown automation mode ${mode}. Expected one of ${AUTOMATION_MODES.join(", ")}.`);
  const browsers = options.browsers;
  if (browsers != null && mode === "off") throw usageError("An explicit browser list cannot be combined with automation mode off.");
  if (browsers != null && mode === "auto") throw usageError("An explicit browser list cannot be combined with automation mode auto; use required.");
  const selected = selectEngines(mode, browsers);
  const snapshotId = session && typeof session === "object" && typeof session.snapshotId === "string" ? session.snapshotId : null;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_AUTOMATION_TIMEOUT_MS;

  if (mode === "off") {
    return idleRun({ mode, status: "disabled", snapshotId, notes: ["Automazione disattivata: Playwright non viene né risolto né importato."] });
  }

  // The deadline exists only when automation is actually requested: off creates no timer at all.
  const deadline = createDeadline(options);
  const contract = core.createContract(session && typeof session === "object" ? session.config : null);
  const requestedEngines = [...selected];
  // Planned matrix for every requested engine, even ones that never launch: the CLI's metadata stays
  // complete while `coverage`/exit keeps the auto policy (an unavailable engine is not coverage).
  const planned = { scenarios: [], pairs: {} };
  for (const name of selected) {
    const matrix = plannedMatrix(session, name, contract);
    planned.scenarios.push(...matrix.scenarios);
    Object.assign(planned.pairs, matrix.pairs);
  }

  const provider = options.provider ?? createPlaywrightProvider({ root });
  const runtimeSource = options.runtimeSource ?? createDiagnosticRuntimeSource();
  const payload = sessionPayload(session);
  const engines = [];
  const errors = [];
  const reports = [];

  try {
    let opened;
    try {
      opened = await withinDeadline(() => provider.open(), deadline, {
        phase: ENVIRONMENT_PHASES[0], cause: "timeout",
        message: `Budget automazione esaurito durante discovery/import di Playwright (consumer ${root}). Nessun browser è stato avviato.`,
      });
    } catch (error) {
      const phase = error.phase ?? ENVIRONMENT_PHASES[0];
      // Preserve the real cause of a non-timeout failure; only the deadline maps to "timeout".
      const cause = error.timedOut ? "timeout" : (error.cause && error.cause.code ? error.cause.code : (error.code ?? "open-failed"));
      errors.push({ phase, cause, engine: null, scenarioId: null, pairId: null, message: error.message });
      return idleRun({ mode, status: "unavailable", snapshotId, engines: unavailableEngines(selected, phase, error.message), errors, notes: [`Ambiente non disponibile: ${error.message}`], planned, requestedEngines });
    }
    if (!opened.ok) {
      errors.push({ phase: opened.phase, cause: opened.cause, engine: null, scenarioId: null, pairId: null, message: opened.message });
      return idleRun({ mode, status: "unavailable", snapshotId, engines: unavailableEngines(selected, opened.phase, opened.message), errors, notes: [`Ambiente non disponibile: ${opened.message}`], planned, requestedEngines });
    }
    for (const name of selected) {
      // Budget exhausted: never start the next engine (no work started, nothing to clean up).
      if (Date.now() >= deadline.at) {
        engines.push({ name, launched: false, status: "unavailable", version: null, executable: null, phase: "launch", reason: "Budget automazione esaurito prima dell'avvio del motore." });
        errors.push({ phase: "launch", cause: "timeout", engine: name, scenarioId: null, pairId: null, message: `${name}: budget automazione esaurito prima dell'avvio del motore.` });
        continue;
      }
      let availability;
      try {
        availability = await withinDeadline(() => provider.availability(name), deadline, {
          phase: "availability", cause: "timeout", engine: name,
          message: `${name}: budget automazione esaurito durante la verifica del binario (availability).`,
        });
      } catch (error) {
        const phase = error.phase ?? "availability";
        const cause = error.timedOut ? "timeout" : (error.cause && error.cause.code ? error.cause.code : (error.code ?? "availability-failed"));
        engines.push({ name, launched: false, status: "unavailable", version: null, executable: null, phase, reason: error.message });
        errors.push({ phase, cause, engine: name, scenarioId: null, pairId: null, message: error.message });
        continue;
      }
      if (!availability.available) {
        engines.push({ name, launched: false, status: "unavailable", version: null, executable: availability.executable ?? null, phase: availability.phase ?? "availability", reason: availability.message });
        errors.push({ phase: availability.phase ?? "availability", cause: availability.cause ?? "engine-unavailable", engine: name, scenarioId: null, pairId: null, message: availability.message });
        continue;
      }
      let browser;
      try {
        browser = await withinDeadline(() => provider.launch(name, { timeout: timeoutMs }), deadline, {
          phase: "launch", cause: "timeout", engine: name,
          message: `${name}: budget automazione esaurito durante l'avvio del browser (launch).`,
          onLate: (lateBrowser) => closeQuietly(lateBrowser, deadline, LATE_CLEANUP_GRACE_MS).then((lateError) => {
            if (lateError) errors.push({ phase: "cleanup", cause: "cleanup-timeout", engine: name, scenarioId: null, pairId: null, message: `${name}: browser tardivo non chiuso entro il grace di cleanup (${lateError.message}).` });
          }),
        });
      } catch (error) {
        const phase = error.phase ?? "launch";
        engines.push({ name, launched: false, status: "unavailable", version: null, executable: availability.executable, phase, reason: error.message });
        const cause = error.timedOut ? "timeout" : (error.cause && error.cause.code ? error.cause.code : "launch-failed");
        errors.push({ phase, cause, engine: name, scenarioId: null, pairId: null, message: error.message });
        continue;
      }
      let version = null;
      try { version = typeof browser.version === "function" ? browser.version() : null; } catch { version = null; }
      try {
        const before = errors.length;
        const engineRun = await measureEngine(browser, name, { payload, runtimeSource, timeoutMs, deadline, errors });
        for (const report of engineRun.reports) reports.push(namespaceReport(name, report));
        const engineErrors = errors.slice(before);
        const status = engineStatus(engineRun.reports, engineRun.attempted);
        const reason = status === "complete" ? null : (engineErrors.find((error) => error.message)?.message ?? engineReason(engineRun.reports));
        engines.push({ name, launched: true, status, version, executable: availability.executable, phase: status === "complete" ? null : "measure", reason });
      } catch (error) {
        const message = error && error.message ? error.message : String(error);
        errors.push({ phase: "measure", cause: "engine-run-failed", engine: name, scenarioId: null, pairId: null, message });
        engines.push({ name, launched: true, status: "incomplete", version, executable: availability.executable, phase: "measure", reason: message });
      } finally {
        const cleanupError = await closeQuietly(browser, deadline);
        if (cleanupError) errors.push({ phase: "cleanup", cause: "cleanup-timeout", engine: name, scenarioId: null, pairId: null, message: `${name}: browser.close non completato entro il grace di cleanup (${cleanupError.message}); la copertura non è confermata.` });
      }
    }
  } finally {
    const cleanupError = await closeQuietly(provider, deadline);
    if (cleanupError) errors.push({ phase: "cleanup", cause: "cleanup-timeout", engine: null, scenarioId: null, pairId: null, message: `provider.close non completato entro il grace di cleanup (${cleanupError.message}); la copertura non è confermata.` });
  }

  const measurements = [];
  const scenarioRecords = [];
  const unsupported = [];
  const explorations = [];
  const explorationErrors = [];
  const explorationCoverages = [];
  const expectedPairs = {};
  const executedPairs = {};
  const expectedScenarioIds = [];
  const executedScenarioIds = [];
  const environmentsByEngine = new Map();
  let measuredAt = null;
  // Expected identities are the contract-backed plannedMatrix of every LAUNCHED engine, computed
  // before any report is trusted: an engine that loses one preference (or a report that shrank its
  // expected set) can never shrink the expected matrix. Unavailable engines stay out of the current
  // coverage, preserving the auto/partial policy.
  for (const engine of engines) {
    if (engine.launched !== true) continue;
    const matrix = plannedMatrix(session, engine.name, contract);
    for (const id of matrix.scenarios) expectedScenarioIds.push(id);
    Object.assign(expectedPairs, matrix.pairs);
  }
  for (const report of reports) {
    scenarioRecords.push(...report.scenarios);
    measurements.push(...report.measurements);
    unsupported.push(...report.unsupported);
    errors.push(...report.errors);
    if (Array.isArray(report.explorations)) explorations.push(...report.explorations);
    if (Array.isArray(report.explorationErrors)) explorationErrors.push(...report.explorationErrors);
    if (report.explorationCoverage) explorationCoverages.push(report.explorationCoverage);
    // The adapter's own `expected` is never trusted for the identity set: a measurement with an
    // unknown scenario id is left for core.coverage to reject as unexpected, not silently absorbed.
    Object.assign(executedPairs, report.executed.pairs);
    executedScenarioIds.push(...report.executed.scenarios);
    if (report.environment) {
      const group = environmentsByEngine.get(report.engine) ?? [];
      group.push({ ...report.environment, measuredAt: report.measuredAt });
      environmentsByEngine.set(report.engine, group);
    }
    if (report.measuredAt && (measuredAt === null || report.measuredAt > measuredAt)) measuredAt = report.measuredAt;
  }

  const expectedList = expectedScenarioIds.map((id) => ({ id, pairIds: Array.isArray(expectedPairs[id]) ? expectedPairs[id] : [] }));
  const coverage = core.coverage(expectedList, measurements);

  // Exploration coverage is aggregated only from the engines that reported it; it is never folded
  // into `coverage`, so an exploration shortfall cannot change the primary status or the exit code.
  const explorationCoverage = explorationCoverages.length === 0 ? null : {
    expected: explorationCoverages.reduce((total, entry) => total + (Number.isFinite(entry.expected) ? entry.expected : 0), 0),
    measured: explorationCoverages.reduce((total, entry) => total + (Number.isFinite(entry.measured) ? entry.measured : 0), 0),
    unmeasured: explorationCoverages.reduce((total, entry) => total + (Number.isFinite(entry.unmeasured) ? entry.unmeasured : 0), 0),
    omittedFamilies: [...new Set(explorationCoverages.flatMap((entry) => Array.isArray(entry.omittedFamilies) ? entry.omittedFamilies : []))],
    complete: explorationCoverages.every((entry) => entry.complete === true),
  };

  // Only the environment phases can make a run unavailable. A launched engine that produced no report
  // or a failure report is incomplete; an engine whose documents are all unsupported stays unsupported.
  const launchedEngines = engines.filter((engine) => engine.launched);
  const measurementErrors = errors.filter((error) => !ENVIRONMENT_PHASES.includes(error.phase));
  const partial = engines.some((engine) => engine.status !== "complete");
  let status;
  if (launchedEngines.length === 0) status = "unavailable";
  else if (launchedEngines.every((engine) => engine.status === "unsupported") && measurements.length === 0) status = "unsupported";
  else if (launchedEngines.every((engine) => engine.status === "complete") && measurements.length > 0 && coverage.complete && measurementErrors.length === 0) status = "complete";
  else status = "incomplete";

  const environment = environmentsByEngine.size === 0 ? null : {
    engines: [...environmentsByEngine.entries()].map(([name, environments]) => {
      const engine = engines.find((candidate) => candidate.name === name) ?? {};
      return { name, version: engine.version ?? null, executable: engine.executable ?? null, environments };
    }),
  };

  const notes = ["Automazione: la preferenza di sistema è emulata per ogni tema (matrice tema/preferenza), la rete è bloccata e il motion è ridotto durante le misure."];
  if (partial) notes.push("Copertura parziale: non tutti i motori richiesti hanno completato la verifica; vedi engines ed errors. Le misure eseguite non coprono i motori mancanti.");

  return buildRun({
    mode, status, snapshotId, engines, environment,
    expected: { scenarios: expectedScenarioIds, pairs: expectedPairs },
    executed: { scenarios: executedScenarioIds, pairs: executedPairs },
    scenarios: scenarioRecords, measurements, coverage, unsupported, errors, notes, partial, measuredAt,
    explorations, explorationErrors, explorationCoverage,
    planned, requestedEngines,
  });
}

export async function projectAudit(names = ["chromium"], { root = process.cwd(), configFile, emitReport = false } = {}) {
  let analysis;
  let loadedConfig;
  let capturedInputs;
  let snapshot;
  let tuningPath = null;
  try {
    // Keep configured input paths even if subsequent palette validation fails.
    // An owned report may have become an input since its previous generation.
    if (emitReport) {
      loadedConfig = await loadSmartColorsConfig({ root, configFile });
      capturedInputs = await captureReportInputs(root, loadedConfig, { configFile });
      // Protect the exact captured tuning path even if analysis fails before resolving it.
      tuningPath = capturedInputs.files.tuning;
    }
    const report = emitReport
      ? (analysis = await analyzeColorTokens({ root, config: loadedConfig }, capturedInputs.inputs.find(([name]) => name === "palette")[2]))
      : await generateColorTokens({ root, configFile, check: true, suggest: false });
    if (!emitReport) tuningPath = await resolveTuningFile(root, report.config);
    if (emitReport) snapshot = await reportSnapshot(root, analysis, capturedInputs);
    let diskCss = null;
    if (emitReport) {
      const outputInput = capturedInputs.inputs.find(([name]) => name === "output");
      diskCss = outputInput[3] ? outputInput[2] : null;
    } else {
      diskCss = await readFile(path.join(root, report.config.output), "utf8");
    }
    let equivalent = false;
    try { equivalent = diskCss !== null && JSON.stringify(canonicalRoot(diskCss)) === JSON.stringify(canonicalRoot(report.css)); }
    catch (error) { if (!emitReport) throw error; }
    if (!emitReport) assert.ok(equivalent, "Generated token declarations differ from current config/palette. Run pnpm colors:build before auditing; nothing was written.");
    if (equivalent && diskCss !== report.css) console.log("NOTICE: generated file differs only in comments/order/formatting; auditing the unchanged CSS on disk. colors:check still requires exact output.");
    const auditReport = { ...report, css: equivalent ? diskCss : report.css };
    if (emitReport) {
      snapshot.notes.push(equivalent
        ? "Misurato il CSS generato realmente presente su disco; nessun output colore sovrascritto."
        : "Output su disco assente o diverso dagli input attuali: misurato CSS diagnostico generato in memoria, non salvato né approvato come output di produzione.");
      if (!equivalent) console.warn("[smart-colors] Output colore assente o diverso: le misure riguardano CSS diagnostico in memoria, non il file di produzione. Rigenera con pnpm colors:build dopo aver valutato gli esiti.");
      snapshot.notes.push("Riferimento WCAG clipped-sRGB su stili opachi risolti dal browser; non misura i pixel di screenshot o certifica l'accessibilità complessiva. Alias, scale/hue, alpha, forced-colors e stili locali dei componenti sono esclusi.");
    }
    const tuningInput = capturedInputs?.inputs.find(([name]) => name === "tuning");
    if (emitReport && !tuningInput[3]) throw new Error(`Missing tuning file ${tuningPath}; no browser audit was completed.`);
    const tuningCss = emitReport ? tuningInput[2] : await readFile(path.join(root, tuningPath), "utf8");
    const options = {
      identities: Object.keys(report.config.roles.identities), decoratives: Object.keys(report.config.roles.decoratives),
      colorParser: auditColor, themeAttribute: true,
    };
    let belowMinimum = 0;
    let candidates;
    const verified = new Map();
    // Attempted-but-discarded candidates: the file and the reason are published
    // with the snapshot so "no palette.css proposal" is never silent.
    const rejectedSources = [];
    for (const name of names) {
      const browser = await launch(name, root);
      try {
        const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
        await context.route("**/*", (route) => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const states = [];
        let pairCount = 0;
        let shortfalls = 0;
        console.log(`AUDIT ${name}: ${report.config.output} → ${tuningPath}; clipped-sRGB WCAG reference from opaque computed styles, not a full accessibility audit.`);
        for (const [scheme, preference] of [["light", "light"], ["light", "dark"], ["dark", "light"], ["dark", "dark"]]) {
          const scenario = { ...options, preference };
          const baseline = auditPairs(auditReport, await computedTheme(page, auditReport, scheme, false, scenario), scheme);
          const computed = await computedTheme(page, auditReport, scheme, false, { ...scenario, tuningCss });
          const tuned = auditPairs(auditReport, computed, scheme);
          states.push({ scheme, preference, baseline, tuned, computed });
          if (emitReport) {
            snapshot.scenarios.push(reportScenario(name, scheme, preference, tuned, baseline));
            snapshot.overlaps.push(reportOverlapScenario(name, scheme, preference, computed.tokens, [...new Set([...options.identities, ...options.decoratives])]));
          }
          assert.deepEqual(tuned.map((pair) => pair.label), baseline.map((pair) => pair.label));
          const failures = tuned.filter((pair) => pair.status !== "pass");
          const minimumFailures = failures.filter((pair) => pair.status === "below-minimum");
          const newFailures = failures.filter((pair) => baseline.find((before) => before.label === pair.label).status === "pass");
          console.log(`  theme=${scheme}, preference=${preference}: ${tuned.length} pairs; baseline ${baseline.filter((pair) => pair.status !== "pass").length} shortfalls → tuned ${failures.length} (${newFailures.length} new, ${minimumFailures.length} below-minimum).`);
          for (const pair of emitReport ? [] : failures) {
            const before = baseline.find((entry) => entry.label === pair.label);
            console.log(`  ${pair.status}: ${pair.label}; ${pair.foreground} on ${pair.background}; ${pair.ratio}:1, target ${pair.target}:1, minimum ${pair.minimum}:1; baseline ${before.ratio}:1 (${before.status}).`);
            console.log(`    Computed foreground ${pair.computed.foreground}; background ${pair.computed.background}`);
          }
          pairCount += tuned.length;
          shortfalls += failures.length;
          belowMinimum += minimumFailures.length;
        }
        if (emitReport) {
          candidates ??= await reportCandidates(root, analysis, tuningCss, states, rejectedSources);
          for (const candidate of candidates) {
            const result = verified.get(candidate.id) ?? { valid: true, browsers: 0, checks: [], sideEffects: [], changes: [] };
            try {
              const before = [], after = [];
              // Dark-fill escape hatches share `--_color-<id>-dark` with the family
              // border alias, so they also move the unmeasured border pairs on both
              // neutral surfaces. In dark the surface is lighter than the canvas, so
              // each background keeps its own before/after comparison and the worst
              // case is aggregated per (identity, background). Both borders are read
              // from resolved themes — the audited current state (`state.computed`,
              // current tuning) and the candidate theme (candidate tuning) — and stay
              // information only: they never enter checks, validity, counts, filters
              // or the exit code.
              const identity = darkFillTuningIdentity(candidate.destination);
              for (const state of states) {
                const computed = await computedTheme(page, { ...auditReport, css: candidate.css }, state.scheme, false, { ...options, preference: state.preference, tuningCss: candidate.tuningCss });
                const rows = auditPairs(auditReport, computed, state.scheme);
                // Structural proposals change tokens the generator recomputes, so
                // their before/after colors are read from this measurement, with the
                // foregrounds of the fixed pairs leading the list.
                if (candidate.kind === "config") {
                  for (const change of structuralChanges(state.tuned, rows, candidate.issueLabels, 4 - result.changes.length)) {
                    if (!result.changes.some((entry) => entry.label === change.label)) result.changes.push(change);
                  }
                }
                before.push(...state.tuned);
                after.push(...rows);
                result.checks.push(...reportScenario(name, state.scheme, state.preference, rows, state.tuned, "browser-proposal").diagnostics);
                if (identity && state.scheme === "dark") {
                  const border = `--color-${identity}-border`;
                  for (const background of ["--color-bg", "--color-surface"]) {
                    const entry = reportSideEffect(identity,
                      { color: state.computed.tokens.get(border), background: state.computed.tokens.get(background) },
                      { color: computed.tokens.get(border), background: computed.tokens.get(background) },
                      background);
                    if (entry) result.sideEffects = mergeSideEffect(result.sideEffects, entry);
                  }
                }
              }
              result.valid &&= proposalImproves(before, after, candidate.issueLabels);
              result.browsers += 1;
            } catch (error) {
              result.valid = false;
              snapshot.notes.push(`Proposta ${candidate.id} non pubblicata: verifica incompleta (${error.message}).`);
            }
            verified.set(candidate.id, result);
            if (!result.valid) {
              // A palette.css alternative that clears the model can still fail in the
              // browser: keep the reason, plus the runtime override that keeps
              // re-applying the loss to the text tokens the build computed.
              const note = candidate.destination.file === REPORT_FILES.palette ? paletteOverrideNote(analysis, tuningCss) : "";
              rejectedSources.push({ id: candidate.id, file: candidate.destination.file, reason: `verifica browser nei quattro scenari tema/preferenza senza miglioramento completo o con regressioni${note}` });
            }
          }
          snapshot.notes.push(`${name} ${browser.version()}: verificati quattro scenari tema/preferenza.`);
        }
        console.log(`AUDIT ${name}: ${pairCount} tuned pair measurements across 4 theme/preference scenarios, ${shortfalls} shortfalls. Compare baseline/tuning before changing palette or ${tuningPath}; no fixes applied.`);
      } finally { await browser.close(); }
    }
    if (emitReport) {
      snapshot.rejectedSources = uniqueRejections(rejectedSources);
      snapshot.proposals = candidates.filter((candidate) => {
        const result = verified.get(candidate.id);
        return result?.valid && result.browsers === names.length;
      }).map((candidate) => publishedProposal(candidate, verified.get(candidate.id)));
    }
    if (diskCss !== null) assert.equal(await readFile(path.join(root, report.config.output), "utf8"), diskCss);
    assert.equal(await readFile(path.join(root, tuningPath), "utf8"), tuningCss);
    if (belowMinimum || analysis?.errors.length) process.exitCode = 1;
    console.log("Scope: neutral/family/direct/decorative and opaque control pairs in light/dark. Excludes alpha, aliases, scales/hue choices, forced colors and component/local overrides. Below-target is advisory; below-minimum exits 1. Generated checks/build behavior is unchanged.");
  } catch (error) {
    if (!emitReport || !loadedConfig || error.code === "SMART_COLORS_INPUTS_CHANGED") throw error;
    snapshot ??= await reportSnapshot(root, analysis ?? { config: loadedConfig, errors: [] }, capturedInputs);
    snapshot.auditErrors.push(error.message);
    snapshot.proposals = [];
    process.exitCode = 1;
    console.error(`[smart-colors] Audit incompleto: ${error.message}`);
  }
  if (emitReport) {
    await assertReportInputsUnchanged(root, capturedInputs);
    // One snapshot, one write pass: the compact preview is published with the full report.
    const output = await writeContrastReport({
      root, report: snapshot, config: analysis?.config ?? loadedConfig, configFile, preview: true, tuningPath,
    });
    const summary = formatReportSummary(snapshot).split("\n").map((line) => `    ${line}`);
    console.log([
      `${badge()} Report contrasto generato`,
      "",
      `  ${title("Artefatti scritti")}`,
      `    ${check()} HTML preview: ${file(output.previewPath)}`,
      `    ${check()} HTML report:  ${file(output.reportPath)}`,
      "",
      `  ${title("Riepilogo")}`,
      ...summary,
      "",
      `  ${title("Prossimo passo")}`,
      `    ${arrow()} Apri l’anteprima appena generata per vedere campioni e modifiche proposte: ${file(pathToFileURL(output.previewPath).href)}`,
      "      Snapshot statico: dopo ogni modifica rigenera con pnpm colors:report. Palette, config, tuning e token generati non modificati.",
      "",
    ].join("\n"));
  } else {
    console.log(`${badge()} Per vedere gli abbinamenti e le proposte: esegui pnpm colors:report, poi apri ${REPORT_DOCUMENTS.preview}. Un report precedente potrebbe essere obsoleto.\n`);
  }
}
