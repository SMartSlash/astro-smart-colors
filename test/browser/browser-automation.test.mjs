/**
 * SC-05 tests: the structured automation adapter.
 *
 * The Node-only block drives `runAutomation` with an injected fake provider and a fake browser, so
 * every phase (discovery/import/availability/launch vs payload/setup/measure), the mode selection,
 * the emulated-preference matrix aggregation and the cleanup are exercised without Playwright.
 * The opt-in block is the real smoke on Chromium and WebKit (opt-in mirrors SC-04; the SC-09 harness
 * runs it as a gate). No file in the project is written.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { runAutomation } from "../../src/diagnostics/browser/browser-audit.mjs";
import { createPlaywrightProvider } from "../../src/diagnostics/browser/playwright-provider.mjs";
import { createVerificationCore } from "../../src/colors/verification-core.mjs";
import { browserSelection, declareSelection, discoveryRoot } from "../helpers/playwright.mjs";

const core = createVerificationCore();
// Injected providers never resolve this path; it only proves `off` never imports a consumer module.
const PROVIDER_ROOT = path.join(path.sep, "fake", "consumer");
const ENGINES = ["chromium", "firefox", "webkit"];
const PREFERENCES = ["light", "dark"];
const SCENARIO_VARIANTS = ["baseline", "tuned"];
const SCENARIO_THEMES = ["light", "dark"];

const SYNTHETIC_CONFIG = {
  contrast: { text: 4.6, onColor: 4.6, ui: 3, maxIdentity: 7.5, darkRichness: 1.15 },
  roles: { identities: {}, decoratives: {} },
};
const CONTRACT = core.createContract(SYNTHETIC_CONFIG);

function syntheticSession() {
  return {
    schemaVersion: 1,
    toolVersion: "0.0.0-test",
    snapshotId: "sc05-test-snapshot",
    css: { baseline: ":root { --color-bg: white; }\n", tuning: ":root { --color-text-muted: black; }\n", tuningSupport: "supported" },
    config: SYNTHETIC_CONFIG,
    model: { diagnostics: [], errors: [], warnings: [] },
    samples: [],
    notes: [],
  };
}

// A complete runtime report for one emulated preference: both variants, both themes, every declared
// pair measured. Its shape matches the SC-04 controller report so the aggregation is realistic.
function runtimeReport(preference) {
  const scenarios = [];
  const pairs = {};
  const measurements = [];
  const records = [];
  for (const variant of SCENARIO_VARIANTS) {
    for (const theme of SCENARIO_THEMES) {
      const id = `${variant}-${theme}-${preference}`;
      const pairIds = CONTRACT.pairs[theme].map((pair) => pair.id);
      scenarios.push(id);
      pairs[id] = pairIds;
      records.push({ id, theme, variant, preference, status: "measured", reason: null });
      for (const pairId of pairIds) {
        measurements.push({ pairId, scenarioId: id, foreground: "rgb(0, 0, 0)", background: "rgb(255, 255, 255)", target: 4.6, minimum: 4.5, ratio: 21, status: "pass", error: null });
      }
    }
  }
  return {
    provenance: "browser-local",
    mode: "off",
    status: "complete",
    snapshotId: "sc05-test-snapshot",
    preference: { active: preference, unmeasured: PREFERENCES.filter((candidate) => candidate !== preference), source: "emulated" },
    environment: { userAgent: "fake/1.0", language: "it", preference, forcedColors: false },
    expected: { scenarios, pairs },
    executed: { scenarios: [...scenarios], pairs: { ...pairs } },
    scenarios: records,
    measurements,
    coverage: core.coverage(scenarios.map((id) => ({ id, pairIds: pairs[id] })), measurements),
    unsupported: [],
    errors: [],
    notes: [],
    measuredAt: `2026-01-01T00:00:0${preference === "light" ? 0 : 1}.000Z`,
  };
}

function failingReport({ status = "incomplete", phase = "payload", cause = "payload-schema", message = "the payload is invalid" }) {
  return {
    provenance: "browser-local",
    mode: "off",
    status,
    snapshotId: "sc05-test-snapshot",
    preference: { active: "light", unmeasured: ["dark"], source: "emulated" },
    environment: { userAgent: "fake/1.0", language: "it", preference: "light", forcedColors: false },
    expected: { scenarios: [], pairs: {} },
    executed: { scenarios: [], pairs: {} },
    scenarios: [],
    measurements: [],
    coverage: core.coverage([], []),
    unsupported: [],
    errors: [{ phase, cause, scenarioId: null, pairId: null, message }],
    notes: [],
    measuredAt: "2026-01-01T00:00:00.000Z",
  };
}

function createFakeProvider(config = {}) {
  const record = { openCalls: 0, availability: [], launch: [], closed: 0, contexts: [], routes: [], contents: [], closedBrowsers: 0, closedContexts: 0 };
  const reportFor = config.reportFor ?? ((_engine, colorScheme) => runtimeReport(colorScheme));
  const browserFor = (name) => ({
    version: () => (config.versions && config.versions[name]) || `0.0.0-${name}`,
    async newContext(options) {
      const colorScheme = options.colorScheme;
      const fail = config.fail ? config.fail(name, colorScheme) : null;
      record.contexts.push({ engine: name, colorScheme });
      return {
        async route(matcher) { record.routes.push(matcher); },
        async newPage() {
          return {
            setDefaultTimeout(milliseconds) { record.defaultTimeout = milliseconds; },
            async setContent(html, setContentOptions) {
              record.contents.push(html);
              record.setContentOptions = setContentOptions;
              if (fail === "setContent") throw new Error("setContent timeout waiting for load");
            },
            async waitForFunction() { if (fail === "wait") throw new Error("waitForFunction timeout"); },
            async evaluate() { if (fail === "evaluate") throw new Error("evaluate failed on the runtime report"); return reportFor(name, colorScheme); },
          };
        },
        async close() { record.closedContexts += 1; },
      };
    },
    async close() { record.closedBrowsers += 1; },
  });
  return {
    record,
    async open() { record.openCalls += 1; return typeof config.open === "function" ? config.open() : (config.open ?? { ok: true, request: "playwright", resolved: "/fake/playwright", browsers: {} }); },
    async availability(name) { record.availability.push(name); return (config.availability ?? ((candidate) => ({ name: candidate, available: true, executable: `/fake/${candidate}` })))(name); },
    async launch(name, options) { record.launch.push({ name, options }); if (config.launch) return config.launch(name, options, record); return browserFor(name); },
    async close() { record.closed += 1; },
  };
}

// ---------------------------------------------------------------------------
// Node-only: modes, phases, aggregation and cleanup.
// ---------------------------------------------------------------------------

test("mode off performs zero discovery, zero import and zero launch", async () => {
  const provider = createFakeProvider({
    open: () => { throw new Error("open must not be called in off mode"); },
    launch: () => { throw new Error("launch must not be called in off mode"); },
  });
  const run = await runAutomation(syntheticSession(), { mode: "off", provider });
  assert.equal(run.status, "disabled");
  assert.equal(run.provenance, "browser-automation");
  assert.equal(run.mode, "off");
  assert.equal(run.snapshotId, "sc05-test-snapshot");
  assert.deepEqual(run.measurements, []);
  assert.deepEqual(run.expected, { scenarios: [], pairs: {} });
  assert.deepEqual(run.engines, []);
  assert.equal(run.coverage.complete, false);
  assert.equal(provider.record.openCalls, 0);
  assert.equal(provider.record.launch.length, 0);
});

test("a discovery failure is an unavailable environment, not a measurement result", async () => {
  const provider = createFakeProvider({ open: () => ({ ok: false, phase: "discovery", cause: "playwright-not-found", message: "Playwright non trovato nel consumer /tmp/x" }) });
  const run = await runAutomation(syntheticSession(), { mode: "auto", provider });
  assert.equal(run.status, "unavailable");
  assert.equal(run.measurements.length, 0);
  assert.deepEqual(run.engines.map((engine) => engine.name), ENGINES);
  assert.ok(run.engines.every((engine) => engine.launched === false && engine.status === "unavailable" && engine.phase === "discovery"));
  assert.equal(run.errors[0].phase, "discovery");
  assert.equal(run.errors[0].cause, "playwright-not-found");
});

test("an import failure keeps its distinct phase", async () => {
  const provider = createFakeProvider({ open: () => ({ ok: false, phase: "import", cause: "import-failed", message: "import failed" }) });
  const run = await runAutomation(syntheticSession(), { mode: "auto", provider });
  assert.equal(run.status, "unavailable");
  assert.equal(run.errors[0].phase, "import");
});

test("auto tries every supported engine and aggregates a complete namespaced run", async () => {
  const provider = createFakeProvider();
  const run = await runAutomation(syntheticSession(), { mode: "auto", provider });
  assert.equal(run.status, "complete");
  assert.equal(run.partial, false);
  assert.equal(run.coverage.complete, true);
  assert.deepEqual(run.engines.map((engine) => engine.name), ENGINES);
  assert.ok(run.engines.every((engine) => engine.launched === true && engine.status === "complete"));
  assert.deepEqual(run.errors, []);
  assert.equal(run.measurements.length, run.coverage.expectedCount);
  assert.equal(run.measurements.length, 240);
  assert.ok(run.measurements.every((measurement) => measurement.scenarioId.startsWith(measurement.engine + "/")));
  assert.ok(run.scenarios.every((scenario) => scenario.id.startsWith(scenario.engine + "/")));
  assert.equal(run.expected.scenarios.length, 24);
  assert.equal(run.environment.engines.length, 3);
  assert.ok(run.environment.engines.every((engine) => engine.environments.length === 2), "one environment per emulated preference");
});

test("required defaults to Chromium and an explicit list is honored", async () => {
  const chromiumOnly = createFakeProvider();
  const defaultRun = await runAutomation(syntheticSession(), { mode: "required", provider: chromiumOnly });
  assert.deepEqual(chromiumOnly.record.availability, ["chromium"]);
  assert.deepEqual(defaultRun.engines.map((engine) => engine.name), ["chromium"]);

  const listed = createFakeProvider();
  const listRun = await runAutomation(syntheticSession(), { mode: "required", browsers: ["webkit", "chromium"], provider: listed });
  assert.deepEqual(listRun.engines.map((engine) => engine.name), ["webkit", "chromium"]);
});

test("an unavailable engine yields explicit partial coverage without hiding the measurement", async () => {
  const provider = createFakeProvider({
    availability: (name) => (name === "webkit"
      ? { name, available: false, phase: "availability", cause: "binary-missing", message: "webkit: browser binary unavailable at /x. No automatic download is performed.", executable: "/x" }
      : { name, available: true, executable: `/fake/${name}` }),
  });
  const run = await runAutomation(syntheticSession(), { mode: "required", browsers: ["chromium", "webkit"], provider });
  assert.equal(run.status, "complete", "the executed measures had no problem");
  assert.equal(run.partial, true);
  assert.equal(run.coverage.complete, true);
  const webkit = run.engines.find((engine) => engine.name === "webkit");
  assert.equal(webkit.launched, false);
  assert.equal(webkit.status, "unavailable");
  assert.ok(run.errors.some((error) => error.phase === "availability" && error.engine === "webkit"));
});

test("no engine launching is unavailable", async () => {
  const provider = createFakeProvider({ availability: (name) => ({ name, available: false, phase: "availability", cause: "binary-missing", message: `${name}: missing`, executable: null }) });
  const run = await runAutomation(syntheticSession(), { mode: "required", browsers: ["chromium", "webkit"], provider });
  assert.equal(run.status, "unavailable");
  assert.equal(run.measurements.length, 0);
  assert.equal(run.partial, true);
});

test("a launch failure is unavailable and never a measurement result", async () => {
  const provider = createFakeProvider({ launch: () => { throw Object.assign(new Error("chromium: binary exists but launch failed. No automatic download is performed."), { phase: "launch" }); } });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "unavailable");
  assert.equal(run.errors[0].phase, "launch");
  assert.equal(run.engines[0].launched, false);
});

test("a payload failure is an incomplete verification even before the first measurement", async () => {
  const provider = createFakeProvider({ reportFor: () => failingReport({ status: "incomplete", phase: "payload", cause: "payload-schema", message: "unsupported payload schemaVersion 2" }) });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "incomplete");
  assert.equal(run.measurements.length, 0);
  assert.ok(run.errors.some((error) => error.phase === "payload" && error.engine === "chromium"));
  assert.equal(run.coverage.complete, false);
});

test("an unsupported document is surfaced as unsupported, not as a pass", async () => {
  const provider = createFakeProvider({ reportFor: () => ({ ...failingReport({ status: "unsupported", phase: "measure", cause: "forced-colors-active", message: "forced-colors is active" }), unsupported: [{ id: "baseline-light-light", reason: "forced-colors is active" }] }) });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "unsupported");
  assert.equal(run.measurements.length, 0);
  assert.equal(run.coverage.complete, false);
  assert.ok(run.unsupported.every((entry) => entry.engine === "chromium"));
});

test("a missing pair is reported as incomplete coverage, never suppressed", async () => {
  const provider = createFakeProvider({
    reportFor: (_engine, colorScheme) => {
      const report = runtimeReport(colorScheme);
      report.measurements = report.measurements.slice(1);
      report.coverage = core.coverage(report.expected.scenarios.map((id) => ({ id, pairIds: report.expected.pairs[id] })), report.measurements);
      report.status = "incomplete";
      return report;
    },
  });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "incomplete");
  assert.equal(run.coverage.complete, false);
  assert.ok(run.coverage.scenarios.some((scenario) => scenario.missing.length === 1));
});

test("coverage verifies identity and duplicates, not just a matching count", async () => {
  const duplicate = createFakeProvider({
    reportFor: (_engine, colorScheme) => {
      const report = runtimeReport(colorScheme);
      report.measurements.push({ ...report.measurements[0] });
      report.status = "incomplete";
      return report;
    },
  });
  const duplicated = await runAutomation(syntheticSession(), { mode: "required", provider: duplicate });
  assert.equal(duplicated.coverage.complete, false);
  assert.ok(duplicated.coverage.duplicates.length > 0);
  assert.equal(duplicated.status, "incomplete");

  const stray = createFakeProvider({
    reportFor: (_engine, colorScheme) => {
      const report = runtimeReport(colorScheme);
      report.measurements = report.measurements.map((measurement) => ({ ...measurement, scenarioId: "unknown-scenario" }));
      report.status = "incomplete";
      return report;
    },
  });
  const strayed = await runAutomation(syntheticSession(), { mode: "required", provider: stray });
  assert.equal(strayed.coverage.complete, false);
  assert.ok(strayed.coverage.unexpectedScenarios.some((id) => id === "chromium/unknown-scenario"));
  assert.ok(strayed.coverage.missingScenarios.length > 0);
});

test("a launched engine whose both pages fail in the run phase is incomplete, not unavailable", async () => {
  const provider = createFakeProvider({ fail: () => "setContent" });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "incomplete");
  assert.notEqual(run.status, "unavailable");
  assert.equal(run.measurements.length, 0);
  assert.equal(run.engines[0].launched, true);
  assert.equal(run.engines[0].status, "incomplete");
  assert.equal(run.engines[0].phase, "measure");
  assert.equal(run.errors.length, 2, "one run-phase error per emulated preference");
  assert.ok(run.errors.every((error) => error.phase === "measure" && error.cause === "runtime-run-failed" && error.engine === "chromium"));
  assert.ok(run.errors.some((error) => /preference light/.test(error.message)));
  assert.ok(run.errors.some((error) => /preference dark/.test(error.message)));
  assert.equal(run.coverage.complete, false);
  assert.equal(run.partial, true);
});

test("a launched engine whose both pages fail at evaluate is incomplete, not unavailable", async () => {
  const provider = createFakeProvider({ fail: () => "evaluate" });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "incomplete");
  assert.equal(run.measurements.length, 0);
  assert.equal(run.engines[0].status, "incomplete");
  assert.equal(run.engines[0].phase, "measure");
  assert.ok(run.errors.every((error) => error.phase === "measure"));
  assert.ok(run.errors.every((error) => /evaluate failed/.test(error.message)));
});

test("one preference succeeding and the other failing is incomplete with an accurate engine phase", async () => {
  const provider = createFakeProvider({ fail: (_engine, colorScheme) => (colorScheme === "dark" ? "evaluate" : null) });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "incomplete");
  assert.ok(run.measurements.length > 0, "the successful preference is still measured");
  assert.equal(run.engines[0].launched, true);
  assert.equal(run.engines[0].status, "incomplete", "a missing preference must not read as a complete engine");
  assert.equal(run.engines[0].phase, "measure");
  assert.ok(run.errors.some((error) => error.phase === "measure" && /preference dark/.test(error.message)));
  assert.equal(run.partial, true);
});

test("network is blocked and every context and browser is closed", async () => {
  const provider = createFakeProvider();
  await runAutomation(syntheticSession(), { mode: "auto", provider });
  assert.equal(provider.record.contexts.length, 6, "one context per engine and emulated preference");
  assert.deepEqual(provider.record.contexts.map((context) => context.colorScheme), ["light", "dark", "light", "dark", "light", "dark"]);
  assert.equal(provider.record.routes.length, 6, "network is blocked in every context");
  assert.ok(provider.record.routes.every((matcher) => matcher instanceof RegExp && matcher.test("https://example.invalid/x")));
  assert.ok(provider.record.routes.every((matcher) => !matcher.test("about:srcdoc")), "the srcdoc measurement frame is never aborted");
  assert.equal(provider.record.closedContexts, 6);
  assert.equal(provider.record.closedBrowsers, 3);
  assert.equal(provider.record.closed, 1);
  assert.equal(provider.record.defaultTimeout, 15000);
});

test("usage errors are thrown as SMART_COLORS_USAGE and never reach the network", async () => {
  const provider = createFakeProvider();
  await assert.rejects(runAutomation(syntheticSession(), { mode: "auto", browsers: ["chromium"], provider }), (error) => error.code === "SMART_COLORS_USAGE");
  await assert.rejects(runAutomation(syntheticSession(), { mode: "off", browsers: ["chromium"] }), (error) => error.code === "SMART_COLORS_USAGE");
  await assert.rejects(runAutomation(syntheticSession(), { mode: "nonsense" }), (error) => error.code === "SMART_COLORS_USAGE");
  await assert.rejects(runAutomation(syntheticSession(), { mode: "required", browsers: ["safari"], provider }), (error) => error.code === "SMART_COLORS_USAGE");
  await assert.rejects(runAutomation(syntheticSession(), { mode: "required", browsers: [], provider }), (error) => error.code === "SMART_COLORS_USAGE");
  assert.equal(provider.record.openCalls, 0);
});

test("runAutomation never logs and never sets an exit code", async () => {
  const provider = createFakeProvider();
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  let logged = 0;
  console.log = () => { logged += 1; };
  try {
    const run = await runAutomation(syntheticSession(), { mode: "required", provider });
    assert.equal(run.status, "complete");
  } finally {
    console.log = originalLog;
  }
  assert.equal(logged, 0);
  assert.equal(process.exitCode, originalExitCode);
});

test("the VerificationRun is JSON-serializable and carries no function", async () => {
  const provider = createFakeProvider();
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  const json = JSON.stringify(run);
  const parsed = JSON.parse(json);
  assert.equal(parsed.provenance, "browser-automation");
  assert.equal(typeof parsed.measurements[0].ratio, "number");
  assert.ok(!json.includes("=>"), "no function may leak into the payload");
});

// ---------------------------------------------------------------------------
// Reliability: bounded waits, late cleanup and planned coverage.
// ---------------------------------------------------------------------------

function never() { return new Promise(() => {}); }
function deferred() { let resolve; const promise = new Promise((resolver) => { resolve = resolver; }); return { promise, resolve }; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

test("off never imports the consumer module for an ESM or a CJS resolution", async () => {
  for (const request of ["playwright", "@playwright/test"]) {
    const imported = [];
    const provider = createPlaywrightProvider({
      root: PROVIDER_ROOT,
      resolve: () => (request === "playwright" ? "/fake/consumer.mjs" : "/fake/consumer.cjs"),
      importModule: async (url) => { imported.push(url); return { chromium: { executablePath: () => "/fake/c", launch: async () => ({}) } }; },
    });
    const run = await runAutomation(syntheticSession(), { mode: "off", provider });
    assert.equal(run.status, "disabled");
    assert.equal(imported.length, 0, `${request}: off must not import the consumer module`);
    assert.equal(run.engines.length, 0);
  }
});

test("a hanging discovery/import is bounded by the overall budget and reported unavailable", async () => {
  const provider = createFakeProvider({ open: () => never() });
  const started = Date.now();
  const run = await runAutomation(syntheticSession(), { mode: "auto", provider, overallTimeoutMs: 120 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `bounded within the budget guard: ${elapsed}ms`);
  assert.equal(run.status, "unavailable");
  assert.equal(run.errors.length, 1);
  assert.equal(run.errors[0].cause, "timeout");
  assert.ok(run.engines.every((engine) => engine.launched === false));
  assert.ok(run.planned.scenarios.length > 0, "requested coverage metadata survives an unavailable run");
});

test("a hanging launch is bounded and unavailable, never a measurement result", async () => {
  const provider = createFakeProvider({ launch: () => never() });
  const started = Date.now();
  const run = await runAutomation(syntheticSession(), { mode: "required", provider, overallTimeoutMs: 150 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `bounded within the budget guard: ${elapsed}ms`);
  assert.equal(run.status, "unavailable");
  assert.equal(run.engines[0].launched, false);
  assert.equal(run.engines[0].phase, "launch");
  assert.ok(run.errors.some((error) => error.phase === "launch" && error.cause === "timeout"));
});

test("a hanging context creation is an incomplete verification, not unavailable", async () => {
  const provider = createFakeProvider({ launch: () => ({ version: () => "0.0.0-fake", async newContext() { return never(); }, async close() {} }) });
  const started = Date.now();
  const run = await runAutomation(syntheticSession(), { mode: "required", provider, overallTimeoutMs: 150 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `bounded within the budget guard: ${elapsed}ms`);
  assert.equal(run.status, "incomplete");
  assert.notEqual(run.status, "unavailable");
  assert.equal(run.engines[0].launched, true);
  assert.equal(run.engines[0].status, "incomplete");
  assert.ok(run.errors.every((error) => error.phase === "measure" && error.cause === "timeout"), "a measure timeout keeps its structured cause");
  assert.equal(run.measurements.length, 0);
  assert.equal(run.coverage.complete, false);
});

test("a browser delivered after the deadline is closed best-effort and never leaks", async () => {
  const gate = deferred();
  let closed = 0;
  const provider = createFakeProvider({ launch: () => gate.promise.then(() => ({ version: () => "late", async newContext() { return never(); }, async close() { closed += 1; } })) });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider, overallTimeoutMs: 60 });
  assert.equal(run.status, "unavailable");
  gate.resolve();
  await delay(50);
  assert.equal(closed, 1, "the late browser is closed exactly once");
});

test("a hanging context.close is bounded and recorded, never a silent pass", async () => {
  const provider = createFakeProvider({ launch: () => ({ version: () => "0.0.0-fake", async newContext() { return { async route() {}, async newPage() { return { setDefaultTimeout() {}, async setContent() {}, async waitForFunction() {}, async evaluate() { return runtimeReport("light"); } }; }, async close() { return never(); } }; }, async close() {} }) });
  const started = Date.now();
  const run = await runAutomation(syntheticSession(), { mode: "required", provider, overallTimeoutMs: 300 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `bounded cleanup: ${elapsed}ms`);
  assert.ok(run.errors.some((error) => error.cause === "cleanup-timeout"), "a failed cleanup is recorded, not swallowed");
});

test("a hanging provider.close is bounded and never blocks the run", async () => {
  const provider = createFakeProvider();
  provider.close = () => never();
  const started = Date.now();
  const run = await runAutomation(syntheticSession(), { mode: "required", provider, overallTimeoutMs: 250 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3000, `bounded close: ${elapsed}ms`);
  assert.ok(run.errors.some((error) => error.phase === "cleanup" && error.cause === "cleanup-timeout"), "a provider.close timeout is recorded, never silent");
  assert.notEqual(run.status, "complete");
});

test("a measure-failed engine keeps a planned expectation, never a misleading 0/0", async () => {
  const provider = createFakeProvider({ fail: () => "wait" });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider, overallTimeoutMs: 1000 });
  assert.equal(run.measurements.length, 0);
  assert.equal(run.coverage.complete, false);
  // baseline + tuned × 2 themes × 2 preferences = 8 planned scenarios for the one launched engine.
  assert.equal(run.expected.scenarios.length, 8);
  assert.equal(run.planned.scenarios.length, 8);
  assert.ok(run.coverage.expectedCount > 0, "the planned pair expectation survives a measure failure");
  assert.equal(run.coverage.measuredCount, 0);
  assert.deepEqual(run.requestedEngines, ["chromium"]);
  assert.equal(run.status, "incomplete");
});

test("without tuning the planned expectation is baseline-only (4 scenarios per launched engine)", async () => {
  const session = { ...syntheticSession(), css: { baseline: ":root { --color-bg: white; }\n", tuning: null, tuningSupport: "absent" } };
  const provider = createFakeProvider({ fail: () => "wait" });
  const run = await runAutomation(session, { mode: "required", provider, overallTimeoutMs: 1000 });
  assert.equal(run.planned.scenarios.length, 4);
  assert.equal(run.expected.scenarios.length, 4);
  assert.equal(run.coverage.measuredCount, 0);
});

test("a second-preference failure keeps the full planned expectation (complete false, missing ids)", async () => {
  const provider = createFakeProvider({ fail: (_engine, colorScheme) => (colorScheme === "dark" ? "evaluate" : null) });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.expected.scenarios.length, 8, "both preferences × both variants × both themes are expected");
  assert.equal(run.coverage.complete, false);
  assert.ok(run.coverage.missingScenarios.length > 0, "the failed preference's scenarios are missing, not dropped");
  assert.ok(run.coverage.missingScenarios.some((id) => id.endsWith("-dark")), "the missing identity is the dark preference");
  assert.equal(run.engines[0].status, "incomplete");
  assert.equal(run.partial, true);
});

test("a report that declares no expected but carries unknown ids cannot pass", async () => {
  const provider = createFakeProvider({ reportFor: () => ({
    ...failingReport({ status: "incomplete", phase: "measure", cause: "runtime-run-failed", message: "reduced report" }),
    measurements: [{ pairId: "ghost", scenarioId: "not-a-scenario", foreground: "rgb(0, 0, 0)", background: "rgb(255, 255, 255)", target: 4.6, minimum: 4.5, ratio: 21, status: "pass", error: null }],
  }) });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.coverage.complete, false);
  assert.ok(run.coverage.unexpectedScenarios.length > 0, "unknown ids are rejected, not absorbed");
  assert.ok(run.coverage.missingScenarios.length > 0);
  assert.notEqual(run.status, "complete");
});

test("a context delivered after the deadline is closed best-effort", async () => {
  const gate = deferred();
  let closed = 0;
  const provider = createFakeProvider({ launch: () => ({ version: () => "v", async newContext() { return gate.promise.then(() => ({ async route() {}, async newPage() { return { setDefaultTimeout() {}, async setContent() {}, async waitForFunction() {}, async evaluate() {} }; }, async close() { closed += 1; } })); }, async close() {} }) });
  const run = await runAutomation(syntheticSession(), { mode: "required", provider, overallTimeoutMs: 50 });
  assert.equal(run.status, "incomplete");
  gate.resolve();
  await delay(110);
  assert.ok(closed >= 1, "the late context is closed best-effort");
});

// ---------------------------------------------------------------------------
// Opt-in: real smoke on Chromium and WebKit.
// ---------------------------------------------------------------------------

test("exploration data is aggregated separately and never touches the primary run", async () => {
  const explorationOf = (scenarioId, pairId) => ({ pairId, scenarioId, foreground: "rgb(0, 0, 0)", background: "rgb(255, 255, 255)", target: 3, minimum: 3, ratio: 3, status: "pass", error: null });
  const provider = createFakeProvider({
    reportFor: (_engine, colorScheme) => {
      const report = runtimeReport(colorScheme);
      const scenarioId = report.scenarios[0].id;
      report.explorations = [explorationOf(scenarioId, "light|exploration|--color-bg|--color-primary")];
      report.explorationErrors = [{ phase: "exploration", cause: "exploration-unsupported", scenarioId, pairId: null, message: "exploration not measured" }];
      report.explorationCoverage = { expected: 2, measured: 1, unmeasured: 1, omittedFamilies: ["ghost"], complete: false };
      return report;
    },
  });

  const run = await runAutomation(syntheticSession(), { mode: "required", provider });
  assert.equal(run.status, "complete", "exploration never changes the primary status");
  assert.equal(run.coverage.complete, true, "primary coverage stays intact");
  assert.equal(run.measurements.length, 80, "exploration is never merged into the primary measurements");
  assert.equal(run.explorations.length, 2, "one exploration per preference report");
  assert.ok(run.explorations.every((measurement) => measurement.scenarioId.startsWith("chromium/")), "exploration scenario ids are namespaced per engine");
  assert.equal(run.explorationErrors.length, 2);
  assert.equal(run.explorationCoverage.expected, 4);
  assert.equal(run.explorationCoverage.measured, 2);
  assert.equal(run.explorationCoverage.unmeasured, 2);
  assert.deepEqual(run.explorationCoverage.omittedFamilies, ["ghost"]);
  assert.equal(run.explorationCoverage.complete, false);
  assert.ok(!run.errors.some((error) => error.phase === "exploration"), "exploration errors stay out of the primary errors");
});

test("sessionPayload passes css source/status/production/digest through and never the generated string", async () => {
  const provider = createFakeProvider({ reportFor: () => failingReport() });
  const session = {
    ...syntheticSession(),
    css: {
      baseline: ":root { --color-bg: white; }\n", tuning: null, tuningSupport: "absent",
      generated: "SHOULD-NOT-APPEAR-IN-THE-PAYLOAD",
      source: "output", status: "stale", production: false,
      digest: { generated: "g".repeat(64), baseline: "b".repeat(64) },
    },
  };
  await runAutomation(session, { mode: "required", provider });
  const html = provider.record.contents[0];
  const payload = JSON.parse(/<script type="application\/json" id="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1].replace(/\\u003c/g, "<"));
  assert.equal(payload.css.source, "output");
  assert.equal(payload.css.status, "stale");
  assert.equal(payload.css.production, false);
  assert.deepEqual(payload.css.digest, { generated: "g".repeat(64), baseline: "b".repeat(64) });
  assert.equal(Object.hasOwn(payload.css, "generated"), false, "the payload never duplicates the generated string");
  assert.equal(html.includes("SHOULD-NOT-APPEAR-IN-THE-PAYLOAD"), false);
});

test("a hostile session string cannot close the payload script", async () => {
  const provider = createFakeProvider({ reportFor: () => failingReport() });
  const session = { ...syntheticSession(), notes: ["</script><script>globalThis.smartColorsPwned = true</script>"] };
  await runAutomation(session, { mode: "required", provider });
  const html = provider.record.contents[0];
  assert.equal(html.includes("</script><script>globalThis.smartColorsPwned"), false);
  assert.ok(html.includes("\\u003c/script>"), "the payload escapes '<' so the JSON stays inert");
});

const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";
const SMOKE_ENGINES = ["chromium", "webkit"];
const SMOKE_SELECTION = browserSelection(SMOKE_ENGINES);

// Only the tokens the default catalog's pairs read, so the run is complete; the tuning changes the
// muted token so the tuned variant is observable.
const SMOKE_BASELINE = [
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
  "",
].join("\n");
const SMOKE_TUNING = ":root { --color-text-muted: light-dark(rgb(0, 0, 255), rgb(0, 0, 255)); }\n";

function smokeSession() {
  return {
    schemaVersion: 1,
    toolVersion: "0.0.0-smoke",
    snapshotId: "sc05-smoke-snapshot",
    css: { baseline: SMOKE_BASELINE, tuning: SMOKE_TUNING, tuningSupport: "supported" },
    config: SYNTHETIC_CONFIG,
    model: { diagnostics: [], errors: [], warnings: [] },
    samples: [],
    notes: [],
  };
}

test("SC-05 browser smoke: runAutomation in Chromium and WebKit on a temporary fixture", { skip: NATIVE_PROOF ? SMOKE_SELECTION.skip : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the real Chromium+WebKit automation smoke; no project file is written" }, async (t) => {
  declareSelection(t, SMOKE_SELECTION);
  const engines = SMOKE_SELECTION.engines;
  const run = await runAutomation(smokeSession(), { root: discoveryRoot(), mode: "required", browsers: engines });
  assert.equal(run.status, "complete", JSON.stringify({ errors: run.errors, engines: run.engines }));
  assert.equal(run.partial, false);
  assert.equal(run.coverage.complete, true, JSON.stringify({ unmeasured: run.coverage.unmeasured, missing: run.coverage.missingScenarios }));
  assert.equal(run.coverage.expectedCount, run.measurements.length);
  assert.equal(run.measurements.length, engines.length * 2 * 4 * 10, "selected engines x 2 preferences x 4 scenarios x 10 pairs");
  assert.deepEqual(run.engines.map((engine) => engine.name), engines);
  assert.ok(run.engines.every((engine) => engine.launched && engine.status === "complete" && typeof engine.version === "string" && engine.version.length > 0));
  assert.ok(run.measurements.every((measurement) => measurement.error === null), "no fabricated or missing value in the automation run");
  assert.ok(run.measurements.every((measurement) => ["pass", "below-target", "below-minimum"].includes(measurement.status)));
  assert.ok(run.environment.engines.every((engine) => engine.environments.length === 2));
  console.log("SC-05 smoke:", JSON.stringify(run.engines.map((engine) => ({ name: engine.name, version: engine.version }))));
});
