/**
 * SC-08 tests: the unified diagnostic workflow.
 *
 * The Node-only block drives `runDiagnosticWorkflow` with an injected fake provider, so the whole
 * pipeline (single session analysis → optional CSS write → automation → legacy mapping → proposals
 * → publication → exit policy) is exercised without Playwright. The browser is only ever a stub:
 * no real browser, no network and no project file outside a tmp fixture is touched.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createDiagnosticSession } from "../src/diagnostic-session.mjs";
import { runDiagnosticWorkflow } from "../src/diagnostic-workflow.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { createVerificationCore } from "../src/verification-core.mjs";

const core = createVerificationCore();
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const PREFERENCES = ["light", "dark"];
const VARIANTS = ["baseline", "tuned"];
const THEMES = ["light", "dark"];

const PALETTE = `@property --palette-bg { syntax: "<color>"; inherits: true; initial-value: oklch(0.962 0.015 88); role: canvas; }
@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.28 0.007 3.68); role: ink; }
@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.300049 32.00005); role: ui; }`;

const PALETTE_PATH = "src/styles/tokens/palette.css";
const OUTPUT_PATH = "src/styles/tokens/colors.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
// A non-empty tuning so the planned matrix (baseline + tuned) matches what the stub runtime reports.
const WORKFLOW_TUNING = ":root { --color-text-muted: rgb(0, 0, 255); }";

// A mid-gray ink/canvas cannot reach a 21:1 text contract: the model is strict-invalid while every
// input still passes validation.
const UNREACHABLE_PALETTE = `@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.52 0 0); role: canvas; }
@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0 0); role: ink; }
@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.16 32); role: ui; }`;

async function fixture(t, { directory = "smart-colors-workflow-", palette = PALETTE, tuning = null } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), directory));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, PALETTE_PATH), palette);
  if (tuning !== null) await writeFile(path.join(root, TUNING_PATH), tuning);
  return root;
}

// A complete runtime report for one emulated preference, built from the very contract the workflow
// resolves from the resolved config, so ids/labels/thresholds match the real mapping. `variants`
// mirrors the real runtime: it emits `tuned` only when a non-empty tuning stylesheet exists.
function runtimeReport(contract, preference, { status = "complete", variants = VARIANTS, failingPairId = null, failRatio = null } = {}) {
  const scenarios = [];
  const pairs = {};
  const measurements = [];
  const records = [];
  for (const variant of variants) {
    for (const theme of THEMES) {
      const id = `${variant}-${theme}-${preference}`;
      const pairIds = contract.pairs[theme].map((pair) => pair.id);
      scenarios.push(id);
      pairs[id] = pairIds;
      records.push({ id, theme, variant, preference, status: "measured", reason: null });
      for (const pair of contract.pairs[theme]) {
        const failing = variant === variants[variants.length - 1] && pair.id === failingPairId;
        measurements.push({
          pairId: pair.id, scenarioId: id, foreground: "rgb(0, 0, 0)", background: "rgb(255, 255, 255)",
          target: pair.target, minimum: pair.minimum,
          ratio: failing ? (failRatio ?? pair.minimum - 0.5) : 21,
          status: failing ? "below-minimum" : "pass", error: null,
        });
      }
    }
  }
  return {
    provenance: "browser-local", mode: "off", status,
    snapshotId: "sc08-test-snapshot",
    preference: { active: preference, unmeasured: PREFERENCES.filter((candidate) => candidate !== preference), source: "emulated" },
    environment: { userAgent: "fake/1.0", language: "it", preference, forcedColors: false },
    expected: { scenarios, pairs }, executed: { scenarios: [...scenarios], pairs: { ...pairs } },
    scenarios: records, measurements,
    coverage: core.coverage(scenarios.map((id) => ({ id, pairIds: pairs[id] })), measurements),
    unsupported: [], errors: [], notes: [], measuredAt: "2026-01-01T00:00:00.000Z",
  };
}

function failingReport({ phase = "measure", cause = "runtime-run-failed", message = "the payload could not be measured" } = {}) {
  return {
    provenance: "browser-local", mode: "off", status: "incomplete",
    snapshotId: "sc08-test-snapshot",
    preference: { active: "light", unmeasured: ["dark"], source: "emulated" },
    environment: { userAgent: "fake/1.0", language: "it", preference: "light", forcedColors: false },
    expected: { scenarios: [], pairs: {} }, executed: { scenarios: [], pairs: {} },
    scenarios: [], measurements: [], coverage: core.coverage([], []),
    unsupported: [], errors: [{ phase, cause, scenarioId: null, pairId: null, message }],
    notes: [], measuredAt: "2026-01-01T00:00:00.000Z",
  };
}

function createFakeProvider(config = {}) {
  const record = { openCalls: 0, launch: [], closed: 0, closedBrowsers: 0 };
  const reportFor = config.reportFor ?? (() => ({ status: "complete" }));
  let payload = null;
  const browserFor = (name) => ({
    version: () => `0.0.0-${name}`,
    async newContext(options) {
      return {
        async route() {},
        async newPage() {
          return {
            setDefaultTimeout() {},
            async setContent(html) { payload = diagnosticPayloadOf(html); },
            async waitForFunction() {},
            async evaluate() { return reportFor(name, options.colorScheme, payload); },
          };
        },
        async close() {},
      };
    },
    async close() { record.closedBrowsers += 1; },
  });
  return {
    record,
    async open() { record.openCalls += 1; return config.open ?? { ok: true, request: "playwright", resolved: "/fake/playwright", browsers: {} }; },
    async availability(name) { return (config.availability ?? ((candidate) => ({ name: candidate, available: true, executable: `/fake/${candidate}` })))(name); },
    async launch(name) { record.launch.push(name); if (config.launch) return config.launch(name, record); return browserFor(name); },
    async close() { record.closed += 1; },
  };
}

// Reads the inert payload the real runtime would consume, so the stub can tell the main run from a
// candidate trial by their effective CSS bytes instead of by call order.
function diagnosticPayloadOf(html) {
  const match = /<script type="application\/json" id="[^"]+">([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try { return JSON.parse(match[1].replace(/\\u003c/g, "<")); } catch { return null; }
}

async function resolvedContract(root, configFile) {
  const { analysis } = await createDiagnosticSession({ root, configFile, suggest: false });
  return core.createContract(analysis.config);
}

async function resolved(root, configFile) {
  const { analysis } = await createDiagnosticSession({ root, configFile, suggest: false });
  return { analysis, contract: core.createContract(analysis.config) };
}

// The first light neutral pair on the surface background: a failing one drives the light-surface
// branch of reportCandidates, including its structural config twin.
function surfaceTextPair(contract) {
  return contract.pairs.light.find((pair) => pair.background === "--color-surface" && pair.kind === "text");
}

// ---------------------------------------------------------------------------

test("report maps a complete run into scenarios, coverage and exit 0 without writing CSS", async (t) => {
  const root = await fixture(t, { tuning: WORKFLOW_TUNING });
  const contract = await resolvedContract(root);
  const provider = createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference) });

  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider });

  assert.equal(result.run.status, "complete");
  assert.equal(result.exitCode, 0);
  assert.equal(result.strictInvalid, false);
  assert.equal(result.problems.length, 0);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.launched, 1);
  assert.ok(result.session.scenarios.length >= 1);
  for (const scenario of result.session.scenarios) {
    assert.equal(scenario.provenance, "browser-automation");
    assert.ok(scenario.diagnostics.length > 0);
  }
  assert.equal(result.session.automation.status, "complete");
  assert.equal(result.publication.previewPath, path.join(root, "reports/smart-colors-preview.html"));
  assert.equal(result.publication.reportPath, path.join(root, "reports/smart-colors.html"));

  // report never writes the generated CSS: the artifact is a declared diagnostic candidate instead.
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
});

test("report auto keeps an unavailable environment non-blocking while required is strict", async (t) => {
  const root = await fixture(t);
  const discoveryFailure = { ok: false, phase: "discovery", cause: "playwright-not-found", message: "Playwright non trovato nel consumer" };

  const auto = await runDiagnosticWorkflow({ root, command: "report", automation: "auto", provider: createFakeProvider({ open: discoveryFailure }) });
  assert.equal(auto.run.status, "unavailable");
  assert.equal(auto.exitCode, 0);
  assert.equal(auto.session.scenarios.length, 0);
  assert.equal(auto.proposals.length, 0);

  const required = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider: createFakeProvider({ open: discoveryFailure }) });
  assert.equal(required.exitCode, 1);
});

test("build auto returns 0 with visible problems; report auto is strict on the same run", async (t) => {
  const root = await fixture(t);
  const contract = await resolvedContract(root);
  const failingPairId = contract.pairs.light[0].id;
  const provider = () => createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference, { failingPairId }) });

  const built = await runDiagnosticWorkflow({ root, command: "build", automation: "auto", provider: provider() });
  assert.equal(built.exitCode, 0);
  assert.ok(built.problems.length >= 1);
  assert.ok(built.problems.every((problem) => problem.status === "below-minimum"));
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), built.writeOutcome.css);

  const reported = await runDiagnosticWorkflow({ root, command: "report", automation: "auto", provider: provider() });
  assert.equal(reported.exitCode, 1);
});

test("an incomplete run is non-blocking for build auto and strict for report auto, and promotes no proposal", async (t) => {
  const root = await fixture(t);
  const provider = () => createFakeProvider({ reportFor: () => failingReport() });

  const built = await runDiagnosticWorkflow({ root, command: "build", automation: "auto", provider: provider() });
  assert.equal(built.run.status, "incomplete");
  assert.equal(built.exitCode, 0);
  assert.equal(built.coverage.measurementErrors > 0, true);
  assert.equal(built.proposals.length, 0);

  const reported = await runDiagnosticWorkflow({ root, command: "report", automation: "auto", provider: provider() });
  assert.equal(reported.exitCode, 1);
  assert.equal(reported.proposals.length, 0);
});

test("automation off performs zero discovery and never touches the provider", async (t) => {
  const root = await fixture(t);
  const provider = createFakeProvider();
  const result = await runDiagnosticWorkflow({ root, command: "build", automation: "off", provider });

  assert.equal(result.run.status, "disabled");
  assert.equal(result.exitCode, 0);
  assert.equal(provider.record.openCalls, 0);
  assert.equal(provider.record.launch.length, 0);
  assert.equal(provider.record.closed, 0);
});

test("build publishes the two HTML artifacts and keeps the generator CSS bytes identical", async (t) => {
  const root = await fixture(t);
  const provider = createFakeProvider({ open: { ok: false, phase: "discovery", cause: "playwright-not-found", message: "assente" } });
  const result = await runDiagnosticWorkflow({ root, command: "build", automation: "auto", provider });

  const generated = await generateColorTokens({ root, check: true });
  assert.equal(result.writeOutcome.css, generated.css);
  assert.equal(generated.errors.length, 0);
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), result.writeOutcome.css);
  for (const artifact of [result.publication.previewPath, result.publication.reportPath]) {
    const html = await readFile(artifact, "utf8");
    assert.ok(html.startsWith("<!-- smart-colors-report:v1 -->"));
  }
});

test("a resolved custom config and its tuning path are the effective ones passed to publication", async (t) => {
  const root = await fixture(t);
  const configFile = "config/personal.mjs";
  const tuningPath = "config/custom-tuning.css";
  const outputPath = "src/styles/tokens/personal-colors.css";
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, configFile), `export default { palette: "${PALETTE_PATH}", output: "${outputPath}" };\n`);
  await writeFile(path.join(root, tuningPath), ":root { --color-tune-x: 1; }");
  const provider = createFakeProvider({ open: { ok: false, phase: "discovery", cause: "playwright-not-found", message: "assente" } });

  const result = await runDiagnosticWorkflow({ root, command: "build", configFile, automation: "auto", provider, inlineConfig: undefined });

  assert.equal(result.configFile, configFile);
  assert.equal(result.session.files.config, configFile);
  assert.equal(result.session.files.output, outputPath);
  assert.equal(await readFile(path.join(root, outputPath), "utf8"), result.writeOutcome.css);
});

test("special characters in the root resolve to valid file URLs without opening a browser", async (t) => {
  const root = await fixture(t, { directory: "smart colors #100% " });
  const provider = createFakeProvider({ open: { ok: false, phase: "discovery", cause: "playwright-not-found", message: "assente" } });
  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "off", provider });

  for (const artifact of [result.publication.previewPath, result.publication.reportPath]) {
    const url = pathToFileURL(artifact);
    assert.equal(url.protocol, "file:");
    assert.ok(url.href.includes("%"));
    assert.match(await readFile(artifact, "utf8"), /^<!-- smart-colors-report:v1 -->/);
  }
  assert.equal(provider.record.openCalls, 0);
});

test("a report never modifies palette, config, tuning or CSS bytes", async (t) => {
  const root = await fixture(t, { tuning: ":root { --color-tune-dark-warmth: 75%; }" });
  const before = {
    palette: await readFile(path.join(root, PALETTE_PATH), "utf8"),
    tuning: await readFile(path.join(root, TUNING_PATH), "utf8"),
  };
  const contract = await resolvedContract(root);
  const provider = createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference) });
  await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider });

  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), before.palette);
  assert.equal(await readFile(path.join(root, TUNING_PATH), "utf8"), before.tuning);
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
});

test("an explicit multi-engine request aggregates engines and reports partial coverage policy", async (t) => {
  const root = await fixture(t, { tuning: WORKFLOW_TUNING });
  const contract = await resolvedContract(root);
  const complete = () => createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference) });

  const full = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium", "webkit"], provider: complete() });
  assert.equal(full.exitCode, 0);
  assert.equal(full.coverage.requested, 2);
  assert.equal(full.coverage.launched, 2);
  assert.equal(full.coverage.complete, true);

  const partial = () => createFakeProvider({
    reportFor: (_engine, preference) => (preference === "light" ? runtimeReport(contract, preference) : failingReport()),
    availability: (name) => (name === "webkit"
      ? { name, available: false, phase: "availability", cause: "binary-missing", message: "webkit: binary unavailable", executable: null }
      : { name, available: true, executable: `/fake/${name}` }),
  });
  const degraded = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium", "webkit"], provider: partial() });
  assert.equal(degraded.run.partial, true);
  assert.equal(degraded.exitCode, 1);
  assert.ok(degraded.coverage.environmentErrors >= 1);
  assert.equal(degraded.proposals.length, 0);

  const buildDegraded = await runDiagnosticWorkflow({ root, command: "build", automation: "auto", provider: partial() });
  assert.equal(buildDegraded.exitCode, 0);
});

test("a stale or absent output stays a declared non-production candidate", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, OUTPUT_PATH), "/* foreign bytes */");
  const provider = createFakeProvider({ open: { ok: false, phase: "discovery", cause: "playwright-not-found", message: "assente" } });

  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "off", provider });
  assert.equal(result.exitCode, 0);
  assert.ok(result.session.notes.some((note) => /non approvato come produzione/.test(note)));
  // The stale output is never promoted: report does not write CSS at all.
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), "/* foreign bytes */");
});

test("a baseline-only run (no tuning) is the final source of problems and exit policy", async (t) => {
  const root = await fixture(t);
  const { contract } = await resolved(root);
  const failingPairId = surfaceTextPair(contract).id;
  const provider = () => createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference, { variants: ["baseline"], failingPairId, failRatio: 1 }) });

  const reported = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider: provider() });
  assert.equal(reported.problems.length, 1);
  assert.equal(reported.problems[0].status, "below-minimum");
  assert.equal(reported.exitCode, 1);
  assert.equal(reported.session.scenarios.length, 4);

  const buildRequired = await runDiagnosticWorkflow({ root, command: "build", automation: "required", browsers: ["chromium"], provider: provider() });
  assert.equal(buildRequired.exitCode, 1);

  const buildAuto = await runDiagnosticWorkflow({ root, command: "build", automation: "auto", provider: provider() });
  assert.equal(buildAuto.exitCode, 0);
  assert.equal(buildAuto.problems.length, 1);
  const html = await readFile(buildAuto.publication.reportPath, "utf8");
  assert.ok(html.includes("muted text"), "the report must show the measured problem");
});

test("a config proposal verified with the same collector is published, and a non-improving one is not", async (t) => {
  const root = await fixture(t, { tuning: WORKFLOW_TUNING });
  const { analysis, contract } = await resolved(root);
  const failingPairId = surfaceTextPair(contract).id;

  // The stub tells the main run from a candidate trial by the payload's effective CSS bytes.
  const candidateAware = () => createFakeProvider({
    reportFor: (_engine, preference, payload) => {
      const isCandidate = payload !== null && payload.css.baseline !== analysis.css;
      return runtimeReport(contract, preference, { failingPairId: isCandidate ? null : failingPairId });
    },
  });
  const promoted = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider: candidateAware() });
  assert.ok(promoted.proposals.some((proposal) => proposal.kind === "config"), "a verified structural proposal must be published");
  assert.equal(promoted.rejectedSources.some((entry) => entry.id === "config-default-surface-lightness-shift"), false);

  // Same failing measurements for the candidate: nothing improves, nothing is published, no autofix.
  const blind = () => createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference, { failingPairId }) });
  const notPromoted = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider: blind() });
  assert.equal(notPromoted.proposals.length, 0);
  assert.ok(notPromoted.rejectedSources.length >= 1);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE);
});

test("report measures the actual on-disk output and never substitutes the generated candidate", async (t) => {
  const root = await fixture(t);
  const FOREIGN = ":root { color-scheme: light dark; --color-bg: light-dark(rgb(7, 8, 9), rgb(10, 11, 12)); }\n";
  await writeFile(path.join(root, OUTPUT_PATH), FOREIGN);
  const { contract } = await resolved(root);
  let seen = null;
  const provider = createFakeProvider({ reportFor: (_engine, preference, payload) => { seen = payload; return runtimeReport(contract, preference); } });

  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider });

  assert.equal(result.session.css.source, "output");
  assert.equal(result.session.css.status, "stale");
  assert.equal(result.session.css.production, false);
  assert.equal(result.session.css.baseline, FOREIGN);
  assert.notEqual(result.session.css.baseline, result.session.css.generated);
  assert.equal(result.session.css.digest.baseline, sha256(FOREIGN));
  assert.ok(seen, "the browser payload must have been captured");
  assert.equal(seen.css.baseline, FOREIGN, "the payload must carry the actual stale bytes");
  assert.equal(seen.css.source, "output");
  assert.equal(seen.css.status, "stale");
  assert.equal(seen.css.production, false);
  assert.equal(Object.hasOwn(seen.css, "generated"), false, "the runtime payload never embeds the generated CSS twice");
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), FOREIGN, "report never writes CSS");
});

test("build measures the freshly written output, not the pre-write capture", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, OUTPUT_PATH), "/* stale foreign output */\n");
  const { analysis, contract } = await resolved(root);
  let seen = null;
  const provider = createFakeProvider({ reportFor: (_engine, preference, payload) => { seen = payload; return runtimeReport(contract, preference); } });

  const result = await runDiagnosticWorkflow({ root, command: "build", automation: "required", browsers: ["chromium"], provider });

  assert.equal(result.writeOutcome.css, analysis.css);
  assert.equal(result.session.css.baseline, analysis.css, "build measures the new bytes");
  assert.equal(result.session.css.status, "current");
  assert.equal(result.session.css.source, "output");
  assert.equal(result.session.css.production, true);
  assert.equal(result.session.css.digest.baseline, result.session.css.digest.generated);
  assert.ok(seen && seen.css.baseline === analysis.css, "the payload baseline is the written output");
  assert.equal(await readFile(path.join(root, OUTPUT_PATH), "utf8"), analysis.css);
});

test("a stale actual baseline verifies no proposal and says why", async (t) => {
  const root = await fixture(t, { tuning: WORKFLOW_TUNING });
  const { contract } = await resolved(root);
  const failingPairId = surfaceTextPair(contract).id;
  await writeFile(path.join(root, OUTPUT_PATH), ":root { color-scheme: light dark; --color-bg: light-dark(rgb(1, 1, 1), rgb(2, 2, 2)); }\n");
  const provider = createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference, { failingPairId }) });

  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider });

  assert.equal(result.proposals.length, 0, "no proposal on a divergent actual baseline");
  assert.ok(result.rejectedSources.some((entry) => entry.id === "baseline" && /actual differente/.test(entry.reason)), JSON.stringify(result.rejectedSources));
});

test("a strict-invalid report with an explicit browser list still writes fresh HTML, imports no PW, exit 1", async (t) => {
  const root = await fixture(t, { palette: UNREACHABLE_PALETTE });
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { contrast: { text: 21, maxIdentity: 21 } };\n");
  const provider = createFakeProvider();

  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider });

  assert.equal(result.strictInvalid, true);
  assert.equal(result.run.status, "disabled");
  assert.equal(result.run.mode, "off");
  assert.equal(result.exitCode, 1);
  // An explicit list must never be forwarded alongside the forced off mode: zero discovery/import.
  assert.equal(provider.record.openCalls, 0);
  assert.deepEqual(provider.record.launch, []);
  assert.deepEqual(result.requestedAutomation, { mode: "required", browsers: ["chromium"], skipped: true });
  assert.ok(result.session.notes.some((note) => /Automazione non eseguita/.test(note)));
  assert.match(await readFile(result.publication.reportPath, "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(result.publication.previewPath, "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), UNREACHABLE_PALETTE);
});

test("a config that changes while it is imported blocks the session before any write", async (t) => {
  const root = await fixture(t);
  const racing = [
    `import { writeFileSync } from "node:fs";`,
    `const self = new URL(import.meta.url);`,
    `self.search = "";`,
    `writeFileSync(self, "export default {}; // rewritten during import\\n");`,
    `export default { palette: "${PALETTE_PATH}", output: "${OUTPUT_PATH}" };`,
    "",
  ].join("\n");
  await writeFile(path.join(root, "smart-colors.config.mjs"), racing);

  await assert.rejects(
    runDiagnosticWorkflow({ root, command: "build", automation: "off", provider: createFakeProvider() }),
    { code: "SMART_COLORS_INPUTS_CHANGED" },
  );
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
});

// ---------------------------------------------------------------------------
// Reliability: shared budget, published HTML and the exit matrix under a stall.
// ---------------------------------------------------------------------------

const HANG = () => new Promise(() => {});

async function readArtifacts(result) {
  return {
    report: await readFile(result.publication.reportPath, "utf8"),
    preview: await readFile(result.publication.previewPath, "utf8"),
  };
}

test("a hanging automation deadline still publishes both HTML and keeps the build/report exit matrix", async (t) => {
  const root = await fixture(t);

  const built = await runDiagnosticWorkflow({ root, command: "build", automation: "auto", provider: createFakeProvider({ open: HANG }), overallTimeoutMs: 120 });
  assert.equal(built.run.status, "unavailable");
  assert.equal(built.exitCode, 0);
  assert.ok(built.production && Array.isArray(built.production.outputs), "production handoff is { accepted, outputs, candidates }");
  for (const html of Object.values(await readArtifacts(built))) assert.match(html, /^<!-- smart-colors-report:v1 -->/);

  const reported = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider: createFakeProvider({ open: HANG }), overallTimeoutMs: 120 });
  assert.equal(reported.run.status, "unavailable");
  assert.equal(reported.exitCode, 1, "required stays strict on an unavailable environment");
  for (const html of Object.values(await readArtifacts(reported))) assert.match(html, /^<!-- smart-colors-report:v1 -->/);
});

test("a measure failure is an incomplete report: exit 1, published HTML and planned coverage nonzero", async (t) => {
  const root = await fixture(t, { tuning: ":root { --color-text-muted: black; }" });
  const provider = createFakeProvider({ fail: () => "wait" });
  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider, overallTimeoutMs: 1000 });

  assert.equal(result.run.status, "incomplete");
  assert.equal(result.exitCode, 1);
  assert.equal(result.coverage.measuredPairs, 0);
  assert.ok(result.coverage.expectedPairs > 0, "expected pairs must not collapse to 0");
  assert.ok(result.coverage.missingPairs > 0, "missing pairs are counted by expected identity");
  assert.equal(result.coverage.complete, false);
  for (const html of Object.values(await readArtifacts(result))) assert.match(html, /^<!-- smart-colors-report:v1 -->/);
});

test("a partial multi-engine run stays exit 0 under auto with no all-clear, and strict under required", async (t) => {
  const root = await fixture(t, { tuning: WORKFLOW_TUNING });
  const contract = await resolvedContract(root);
  const provider = () => createFakeProvider({
    reportFor: (_engine, preference) => runtimeReport(contract, preference),
    availability: (name) => (name === "webkit"
      ? { name, available: false, phase: "availability", cause: "binary-missing", message: "webkit: binary unavailable", executable: null }
      : { name, available: true, executable: `/fake/${name}` }),
  });

  const auto = await runDiagnosticWorkflow({ root, command: "report", automation: "auto", provider: provider() });
  assert.equal(auto.run.status, "complete");
  assert.equal(auto.run.partial, true);
  assert.equal(auto.exitCode, 0, "auto must keep an environmentally-unavailable engine non-blocking");
  assert.equal(auto.coverage.complete, false, "a partial run is never an all-clear");
  assert.equal(auto.coverage.planned.engines.length, 3, "requested coverage names every requested engine");
  assert.equal(auto.coverage.launched, 2);

  const required = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium", "webkit"], provider: provider() });
  assert.equal(required.run.partial, true);
  assert.equal(required.exitCode, 1);
  assert.equal(required.coverage.complete, false);
});

test("proposal trials share the workflow budget and never make the current audit incomplete", async (t) => {
  const root = await fixture(t, { tuning: WORKFLOW_TUNING });
  const { contract } = await resolved(root);
  const failingPairId = surfaceTextPair(contract).id;
  // The main run is the first open; every proposal trial re-opens, so those runs hang: the shared
  // budget must stop them and declare the proposals unverified without touching the current audit.
  let currentRun = 0;
  const provider = {
    record: { openCalls: 0 },
    async open() { this.record.openCalls += 1; currentRun = this.record.openCalls; return { ok: true, request: "playwright", resolved: "/fake/pw", browsers: {} }; },
    async availability(name) { return { name, available: true, executable: `/fake/${name}` }; },
    async launch(name) {
      return {
        version: () => `0.0.0-${name}`,
        async newContext(options) {
          const preference = options.colorScheme;
          return {
            async route() {},
            async newPage() {
              return {
                setDefaultTimeout() {},
                async setContent() {},
                async waitForFunction() { if (currentRun > 1) return HANG(); },
                async evaluate() { return runtimeReport(contract, preference, { failingPairId }); },
              };
            },
            async close() {},
          };
        },
        async close() {},
      };
    },
    async close() {},
  };

  const result = await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider, overallTimeoutMs: 800 });
  assert.equal(result.run.status, "complete", "the current-pairs audit is unaffected by a rejected proposal");
  assert.ok(result.problems.length >= 1);
  assert.equal(result.proposals.length, 0);
  assert.ok(result.rejectedSources.length >= 1, "the unverified proposal is declared, not silently dropped");
  assert.ok(result.rejectedSources.some((entry) => /budget|incompleta/.test(entry.reason)));
});

// ---------------------------------------------------------------------------
// Progress phases: presentation-only, emitted only for real phases, never altering the result.
// ---------------------------------------------------------------------------

test("progress phases follow the executed phases and a throwing callback never alters the result", async (t) => {
  const root = await fixture(t);
  const contract = await resolvedContract(root);

  // build off: analysis -> generation -> publication (no automation requested).
  const buildOff = [];
  const built = await runDiagnosticWorkflow({ root, command: "build", automation: "off", provider: createFakeProvider(), onProgress: (phase) => buildOff.push(phase) });
  assert.deepEqual(buildOff, ["analysis", "generation", "publication"]);
  assert.equal(built.exitCode, 0);

  // report off: no generation phase because no CSS write is attempted.
  const reportOff = [];
  await runDiagnosticWorkflow({ root, command: "report", automation: "off", provider: createFakeProvider(), onProgress: (phase) => reportOff.push(phase) });
  assert.deepEqual(reportOff, ["analysis", "publication"]);

  // build auto with an unavailable environment: automation is requested, so its phase is emitted.
  const buildAuto = [];
  const unavailable = createFakeProvider({ open: { ok: false, phase: "discovery", cause: "playwright-not-found", message: "assente" } });
  await runDiagnosticWorkflow({ root, command: "build", automation: "auto", provider: unavailable, onProgress: (phase) => buildAuto.push(phase) });
  assert.deepEqual(buildAuto, ["analysis", "generation", "automation", "publication"]);

  // report required with a complete run: automation runs, no generation.
  const reportRequired = [];
  const complete = createFakeProvider({ reportFor: (_engine, preference) => runtimeReport(contract, preference) });
  await runDiagnosticWorkflow({ root, command: "report", automation: "required", browsers: ["chromium"], provider: complete, onProgress: (phase) => reportRequired.push(phase) });
  assert.deepEqual(reportRequired, ["analysis", "automation", "publication"]);

  // A strict-invalid model disables both the write and automation: only analysis and publication.
  const invalid = await fixture(t, { palette: UNREACHABLE_PALETTE });
  await writeFile(path.join(invalid, "smart-colors.config.mjs"), "export default { contrast: { text: 21, maxIdentity: 21 } };\n");
  const invalidPhases = [];
  const invalidResult = await runDiagnosticWorkflow({ root: invalid, command: "build", automation: "off", provider: createFakeProvider(), onProgress: (phase) => invalidPhases.push(phase) });
  assert.equal(invalidResult.strictInvalid, true);
  assert.deepEqual(invalidPhases, ["analysis", "publication"]);

  // A throwing callback is swallowed: the result and the exit policy are untouched.
  const guarded = await runDiagnosticWorkflow({ root, command: "build", automation: "off", provider: createFakeProvider(), onProgress: () => { throw new Error("presentation boom"); } });
  assert.equal(guarded.exitCode, 0);
  assert.equal(typeof guarded.publication.previewPath, "string");
});
