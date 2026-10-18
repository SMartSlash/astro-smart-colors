/**
 * SC-08 diagnostic workflow (plan §4, §5.1.1, §6, §7 SC-08).
 *
 * One session, one palette analysis, one publication path. The workflow captures the effective
 * inputs, makes the single strict analysis, writes the CSS only when it is intentional (build),
 * runs the shared browser automation, maps the VerificationRun back to the legacy report rows
 * through the shared core contract, re-verifies each read-only proposal with the same collector,
 * and publishes both HTML artifacts. It never re-analyzes the palette a second time and never
 * touches a legacy wrapper: `runAutomation` returns data, this module decides the CLI policy and
 * returns it as data too (the CLI is the only place that sets `process.exitCode`).
 *
 * Command boundaries (plan §4.1):
 * - `build` writes the configured CSS and always attempts both HTML artifacts;
 * - `report` writes only the two HTML artifacts (never CSS/palette/config/tuning);
 * - `check`, `init` and `audit` never reach this module.
 */
import path from "node:path";
import { AUTOMATION_OVERALL_TIMEOUT_MS, runAutomation, uniqueRejections } from "./browser-audit.mjs";
import { acceptDiagnosticOutput, assertDiagnosticInputsUnchanged, createDiagnosticSession } from "./diagnostic-session.mjs";
import { DEFAULT_CONFIG_FILE } from "./load-config.mjs";
import { writeContrastReport } from "./report-artifact.mjs";
import { proposalImproves, publishedProposal, reportCandidates, reportOverlapScenario, reportScenario, structuralChanges } from "./report-data.mjs";
import { createVerificationCore } from "./verification-core.mjs";

const core = createVerificationCore();
const AUTOMATION_MODES = ["auto", "off", "required"];
// Environment phases describe the environment rather than a measurement; a run can be
// "unavailable" for them while an executed engine still produced a complete result.
const ENVIRONMENT_PHASES = ["discovery", "import", "availability", "launch"];

function usageError(message) {
  const error = new Error(message);
  error.code = "SMART_COLORS_USAGE";
  return error;
}

function budgetExhausted(deadline) {
  return !Number.isFinite(deadline) || Date.now() >= deadline;
}

// Small local bounded wait for proposal work (not a public factory and not a general abstraction). The
// solver can do non-cancellable synchronous CPU work, so only the WAIT is bounded and a late result is
// ignored: an over-budget solver can never hold the workflow open, and it never leaks its own fixtures.
async function withinBudget(factory, deadline, message) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) { const error = new Error(message); error.timedOut = true; throw error; }
  const TIMEOUT = Symbol("smart-colors-proposal-budget");
  let timer;
  const guard = new Promise((resolve) => { timer = setTimeout(() => resolve(TIMEOUT), remaining); });
  let outcome;
  try {
    outcome = await Promise.race([Promise.resolve().then(() => factory()), guard]);
  } finally {
    clearTimeout(timer);
  }
  if (outcome === TIMEOUT) { const error = new Error(message); error.timedOut = true; throw error; }
  return outcome;
}

function validColor(color) {
  return Boolean(color) && typeof color === "object" && !Array.isArray(color)
    && Number.isFinite(color.l) && color.l >= 0 && color.l <= 1
    && Number.isFinite(color.c) && color.c >= 0 && Number.isFinite(color.h);
}

function parseColor(value) {
  if (typeof value !== "string" || value === "") return null;
  try {
    const parsed = core.parseComputedColor(value, "measurement");
    return validColor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Execute the build/report pipeline and return session, publication and the CLI policy as data.
 *
 * Returns `{ session, analysis, captured, run, publication, problems, coverage, proposals,
 * rejectedSources, warnings, suggestions, strictInvalid, exitCode }`. Browser-injectable through
 * `provider` (SC-05), so the paths are testable without Playwright. `off` performs zero discovery:
 * `runAutomation` short-circuits before the provider is ever touched.
 */
export async function runDiagnosticWorkflow(options = {}) {
  const { root, command, automation, browsers, configFile, provider, timeoutMs, overallTimeoutMs: overallTimeoutOption, ...analysisOptions } = options;
  const resolvedRoot = path.resolve(root ?? process.cwd());
  const resolvedCommand = command === "report" ? "report" : "build";
  const mode = automation ?? "auto";

  if (!AUTOMATION_MODES.includes(mode)) throw usageError(`Unknown automation mode ${mode}. Expected one of ${AUTOMATION_MODES.join(", ")}.`);

  // One shared budget for the whole automation of this workflow: the main run plus every proposal
  // trial share the same deadline, so candidates can never multiply the wall-clock indefinitely.
  const overallTimeoutMs = Number.isFinite(overallTimeoutOption) && overallTimeoutOption > 0 ? overallTimeoutOption : AUTOMATION_OVERALL_TIMEOUT_MS;
  const deadline = Date.now() + overallTimeoutMs;

  const { session, analysis, captured } = await createDiagnosticSession({ root: resolvedRoot, configFile, automation: mode, ...analysisOptions });
  const tuningPath = captured.files.tuning;
  const strictInvalid = analysis.errors.length > 0;

  // Build writes the CSS, but only after guarding that no concurrent writer changed an input since
  // capture: our own write must never clobber somebody else's bytes. The write goes through the
  // internal capability attached to the session analysis, which re-validates output paths and the
  // strict contract with the captured root/configFile before touching the disk.
  let writeOutcome = null;
  if (resolvedCommand === "build" && !strictInvalid) {
    if (typeof analysis.applyValidatedOutput !== "function") throw usageError("The session analysis is missing its internal write capability; no CSS was written.");
    await assertDiagnosticInputsUnchanged(resolvedRoot, captured);
    writeOutcome = await analysis.applyValidatedOutput();
  }

  // Guard order differs by command on purpose (plan §5.3):
  // - build: assert before the write, accept the intentional write afterwards;
  // - report: assert BEFORE accept, so a byte-conform external change is never blessed as ours.
  let acceptance;
  if (resolvedCommand === "build" && !strictInvalid) {
    acceptance = await acceptDiagnosticOutput(resolvedRoot, captured, analysis);
  } else {
    await assertDiagnosticInputsUnchanged(resolvedRoot, captured);
    acceptance = await acceptDiagnosticOutput(resolvedRoot, captured, analysis);
  }

  // A strict-invalid model disables automation. The browser list must NOT be forwarded in that
  // case: `runAutomation` rejects an explicit list combined with mode off, which would abort before
  // the HTML artifacts are written. The requested mode/browsers are kept as metadata instead.
  const effectiveMode = strictInvalid ? "off" : mode;
  const run = await runAutomation(session, {
    root: resolvedRoot,
    mode: effectiveMode,
    browsers: effectiveMode === "off" ? undefined : browsers,
    provider,
    timeoutMs,
    deadline,
  });

  const contract = core.createContract(analysis.config);
  const model = buildReportModel(contract, run);
  session.automation = run;
  session.scenarios = model.scenarios;
  session.overlaps = model.overlaps;
  session.notes = [...session.notes, ...(run.notes ?? [])];
  if (strictInvalid) {
    session.notes.push(`Automazione non eseguita: il contratto di contrasto del modello non è valido. Richiesta originale: modalità ${mode}${browsers ? `, browser ${browsers.join(", ")}` : ""}; le pagine restano diagnostiche e l'esito è non-zero.`);
  }
  // A stale or absent output stays a declared non-production diagnostic candidate, never a pass.
  if (!acceptance.accepted && acceptance.candidates.length) {
    session.notes.push(`Output colore non approvato come produzione: ${acceptance.candidates.map((candidate) => `${candidate.name} (${candidate.reason})`).join(", ")}. Le misure restano diagnostiche e nessun file di produzione è stato approvato.`);
  }

  const { proposals, rejectedSources } = await verifyProposals({
    root: resolvedRoot, mode, browsers, provider, timeoutMs, deadline, session, analysis, states: model.states, tuningCss: session.css.tuning, contract, run,
  });
  session.proposals = proposals;
  session.rejectedSources = uniqueRejections(rejectedSources);

  const coverage = coverageView(run);
  // A pair that could not be measured is declared, never silently dropped from the pair table.
  if (coverage.unmeasured > 0) {
    session.notes.push(`${coverage.unmeasured} ${coverage.unmeasured === 1 ? "coppia non misurata" : "coppie non misurate"}: la tabella mostra solo le coppie realmente misurate e nessun esito globale viene confermato senza copertura completa.`);
  }

  // Final input guard before publication: our own accepted output is allowed through, anything else
  // blocks the write so no artifact describes a state that no longer exists.
  await assertDiagnosticInputsUnchanged(resolvedRoot, captured);
  const publication = await writeContrastReport({
    root: resolvedRoot,
    report: session,
    config: analysis.config,
    configFile: configFile ?? DEFAULT_CONFIG_FILE,
    tuningPath,
    preview: true,
  });

  const belowMinimum = model.problems.some((problem) => problem.status === "below-minimum");
  const exitCode = evaluateExit({ command: resolvedCommand, mode, run, strictInvalid, belowMinimum });

  return {
    command: resolvedCommand, mode, root: resolvedRoot, configFile: configFile ?? DEFAULT_CONFIG_FILE,
    session, analysis, captured, run,
    writeOutcome,
    publication: {
      reportPath: publication.reportPath,
      previewPath: publication.previewPath,
    },
    problems: model.problems,
    modelProblems: modelProblemsFrom(analysis.model.diagnostics),
    coverage,
    // Explicit handoff for the CLI: the accepted production outputs and the non-production candidates.
    production: acceptance,
    proposals,
    rejectedSources: session.rejectedSources,
    warnings: analysis.warnings ?? [],
    suggestions: analysis.suggestions ?? [],
    strictInvalid,
    requestedAutomation: { mode, browsers: browsers ?? null, skipped: strictInvalid },
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Mapping: VerificationRun -> legacy report rows, states, overlaps and problems.
// The core contract is the single origin of labels, tokens, kinds and thresholds.
// ---------------------------------------------------------------------------

function buildReportModel(contract, run) {
  const { selections } = finalSelections(contract, run);
  const identityNames = [...contract.identities, ...contract.decoratives];
  const states = [];
  const scenarios = [];
  const overlaps = [];
  const problems = new Map();

  for (const selection of selections) {
    scenarios.push(reportScenario(selection.engine, selection.scheme, selection.preference, selection.rows, selection.baselineRows, "browser-automation"));
    const tokens = tokensOf(selection.rows);
    states.push({
      engine: selection.engine, scheme: selection.scheme, preference: selection.preference,
      baseline: selection.baselineRows, tuned: selection.rows,
      computed: { tokens, preference: selection.preference },
    });
    const overlap = tryOverlap(selection, tokens, identityNames);
    if (overlap) overlaps.push(overlap);

    for (const row of selection.rows) {
      if (row.status === "pass") continue;
      const key = `${row.scheme}|${row.label}`;
      const current = problems.get(key);
      if (!current || row.ratio < current.ratio) problems.set(key, problemView(row));
    }
  }

  return {
    states, scenarios, overlaps,
    problems: [...problems.values()].sort((left, right) => left.ratio - right.ratio),
  };
}

/**
 * Ordered final selections per (engine, theme, preference): the `tuned` variant when the runtime
 * produced one, otherwise `baseline`. The runtime only emits `tuned` when a non-empty tuning
 * stylesheet exists, so a project without tuning must still be measured through its baseline rows;
 * skipping them would silently report "no problems" for a below-minimum palette.
 */
function finalSelections(contract, run) {
  const pairById = new Map([...contract.pairs.light, ...contract.pairs.dark].map((pair) => [pair.id, pair]));
  const measurementsByScenario = new Map();
  for (const measurement of run.measurements ?? []) {
    const list = measurementsByScenario.get(measurement.scenarioId) ?? [];
    list.push(measurement);
    measurementsByScenario.set(measurement.scenarioId, list);
  }
  const measuredRows = (scenarioId) => (measurementsByScenario.get(scenarioId) ?? [])
    .map((measurement) => {
      const pair = pairById.get(measurement.pairId);
      if (!pair) return null;
      return {
        label: pair.label, scheme: pair.theme, kind: pair.kind,
        foreground: pair.foreground, background: pair.background,
        foregroundColor: parseColor(measurement.foreground), backgroundColor: parseColor(measurement.background),
        ratio: measurement.ratio, target: pair.target, minimum: pair.minimum, status: measurement.status,
      };
    })
    .filter(Boolean)
    .filter((row) => row.status !== "unmeasured" && Number.isFinite(row.ratio));

  const groups = new Map();
  for (const record of run.scenarios ?? []) {
    const key = `${record.engine}|${record.theme}|${record.preference}`;
    const group = groups.get(key) ?? { engine: record.engine, theme: record.theme, preference: record.preference };
    if (record.variant === "tuned") group.tuned = record;
    else if (record.variant === "baseline") group.baseline = record;
    groups.set(key, group);
  }

  const selections = [];
  for (const [key, group] of groups) {
    const finalRecord = group.tuned ?? group.baseline;
    if (!finalRecord) continue;
    const rows = measuredRows(finalRecord.id);
    if (rows.length === 0) continue;
    const baselineRows = group.baseline && group.baseline !== finalRecord ? measuredRows(group.baseline.id) : [];
    selections.push({ key, engine: group.engine, scheme: group.theme, preference: group.preference, rows, baselineRows, hasTuned: Boolean(group.tuned) });
  }
  return { selections };
}

function problemView(row) {
  return {
    scheme: row.scheme, label: row.label, status: row.status,
    foregroundToken: row.foreground, backgroundToken: row.background,
    ratio: row.ratio, target: row.target, minimum: row.minimum,
  };
}

// Model-only advisories: used by the CLI when there is no browser measurement, so a below-minimum
// palette is never read as "no measured problem" just because the automation was off or unavailable.
function modelProblemsFrom(diagnostics) {
  const problems = new Map();
  for (const item of diagnostics ?? []) {
    if (!item || typeof item !== "object" || item.status === "pass") continue;
    const key = `${item.scheme}|${item.label}`;
    const current = problems.get(key);
    if (!current || item.ratio < current.ratio) {
      problems.set(key, {
        scheme: item.scheme, label: item.label, status: item.status,
        foregroundToken: item.foregroundToken, backgroundToken: item.backgroundToken,
        ratio: item.ratio, target: item.target, minimum: item.minimum,
      });
    }
  }
  return [...problems.values()].sort((left, right) => left.ratio - right.ratio);
}

function tokensOf(rows) {
  const tokens = new Map();
  for (const row of rows) {
    if (validColor(row.backgroundColor)) tokens.set(row.background, row.backgroundColor);
    if (validColor(row.foregroundColor)) tokens.set(row.foreground, row.foregroundColor);
  }
  return tokens;
}

// Overlaps are exploratory diagnostics with an all-or-nothing token contract; an incomplete
// measurement simply skips them instead of inventing a colour.
function tryOverlap(selection, tokens, names) {
  if (names.length === 0) return null;
  try {
    return reportOverlapScenario(selection.engine, selection.scheme, selection.preference, tokens, names);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Read-only proposals: reportCandidates builds them (with its own temporary candidate
// analysis, the intended solver), and each is re-measured with the same collector.
// ---------------------------------------------------------------------------

async function verifyProposals({ root, mode, browsers, provider, timeoutMs, deadline, session, analysis, states, tuningCss, contract, run }) {
  if (mode === "off" || analysis.errors.length > 0 || run.status !== "complete") return { proposals: [], rejectedSources: [] };
  const failures = states.flatMap((state) => state.tuned).filter((row) => row.status !== "pass");
  if (failures.length === 0) return { proposals: [], rejectedSources: [] };

  const rejectedSources = [];
  const budgetRejection = (id, file) => ({ id, file: file ?? null, reason: "budget automazione esaurito: proposta non verificata e non promossa; l'audit delle coppie correnti resta invariato" });
  // No budget left before the solver: do not start it. A proposal trial is optional and can never make
  // the current-pairs audit incomplete (plan §4.3).
  if (budgetExhausted(deadline)) return { proposals: [], rejectedSources: [budgetRejection("budget")] };

  // The solver is bounded by the SAME workflow deadline; its result is ignored if it overruns.
  let candidates;
  try {
    candidates = await withinBudget(() => reportCandidates(root, analysis, tuningCss ?? "", states, rejectedSources), deadline,
      "budget automazione esaurito durante la generazione delle proposte (il solver è lavoro sincrono non cancellabile); l'audit delle coppie correnti resta invariato");
  } catch {
    return { proposals: [], rejectedSources: [...rejectedSources, budgetRejection("budget")] };
  }
  if (!Array.isArray(candidates) || candidates.length === 0) return { proposals: [], rejectedSources };

  const before = finalSelections(contract, run).selections;
  const proposals = [];
  for (const candidate of candidates) {
    // Never start a candidate trial once the shared budget is exhausted.
    if (budgetExhausted(deadline)) { rejectedSources.push(budgetRejection(candidate.id, candidate.destination?.file)); continue; }
    const candidateSession = {
      ...session,
      css: candidateCss(session, candidate),
    };
    let candidateRun = null;
    try {
      candidateRun = await runAutomation(candidateSession, { root, mode, browsers, provider, timeoutMs, deadline });
    } catch (error) {
      candidateRun = null;
    }
    const after = candidateRun ? finalSelections(contract, candidateRun).selections : [];
    const afterByKey = new Map(after.map((selection) => [selection.key, selection]));
    // Identity, not index: the same (engine, theme, preference) keys must be present on both sides,
    // so a candidate that adds a tuned variant aligns with the baseline-only current run.
    const aligned = after.length === before.length && before.every((selection) => afterByKey.has(selection.key));
    if (!covered(candidateRun) || !aligned) {
      // A rejected or budget-exhausted proposal trial never makes the current-pairs audit incomplete
      // (plan §4.3): it only prevents promoting that suggestion, and the reason says so explicitly.
      rejectedSources.push({ id: candidate.id, file: candidate.destination?.file ?? null, reason: "verifica browser della proposta incompleta o budget automazione esaurito: nessun miglioramento confermato; l'audit delle coppie correnti resta invariato" });
      continue;
    }
    const pairs = before.map((selection) => [selection, afterByKey.get(selection.key)]);
    const result = { checks: [], changes: [], sideEffects: [] };
    const valid = proposalImproves(pairs.flatMap(([current]) => current.rows), pairs.flatMap(([, next]) => next.rows), candidate.issueLabels ?? []);
    for (const [current, next] of pairs) {
      if (candidate.kind === "config") {
        for (const change of structuralChanges(current.rows, next.rows, candidate.issueLabels ?? [], 4 - result.changes.length)) {
          if (!result.changes.some((existing) => existing.label === change.label)) result.changes.push(change);
        }
      }
      result.checks.push(...reportScenario(current.engine, current.scheme, current.preference, next.rows, current.rows, "browser-proposal").diagnostics);
    }
    if (!valid) {
      rejectedSources.push({ id: candidate.id, file: candidate.destination?.file ?? null, reason: "verifica browser nei quattro scenari tema/preferenza senza miglioramento completo o con regressioni" });
      continue;
    }
    proposals.push(publishedProposal(candidate, result));
  }
  return { proposals, rejectedSources };
}

// A candidate run is only trusted when the run completed and every requested engine completed.
function covered(candidateRun) {
  return candidateRun !== null
    && candidateRun.status === "complete"
    && candidateRun.engines.length > 0
    && candidateRun.engines.every((engine) => engine.status === "complete");
}

function candidateCss(session, candidate) {
  const baseline = typeof candidate.css === "string" ? candidate.css : session.css.baseline;
  const tuning = candidate.tuningCss === undefined ? session.css.tuning : candidate.tuningCss;
  return {
    baseline,
    tuning,
    tuningSupport: candidate.tuningCss === undefined ? session.css.tuningSupport : (tuning === null ? "absent" : "supported"),
  };
}

// Ordered final selections (engine/theme/preference) are produced by `finalSelections`; the
// proposal check matches before/after by key, never by array index.

// ---------------------------------------------------------------------------
// Coverage view and exit policy (plan §4.3).
// ---------------------------------------------------------------------------

function coverageView(run) {
  const errors = run.errors ?? [];
  const measurementErrors = errors.filter((error) => !ENVIRONMENT_PHASES.includes(error.phase));
  const environmentErrors = errors.filter((error) => ENVIRONMENT_PHASES.includes(error.phase));
  const measurements = run.measurements ?? [];
  const engines = (run.engines ?? []).map((engine) => ({ name: engine.name, launched: engine.launched === true, status: engine.status, version: engine.version ?? null }));
  const requestedEngines = Array.isArray(run.requestedEngines) && run.requestedEngines.length ? run.requestedEngines : engines.map((engine) => engine.name);
  const planned = run.planned && typeof run.planned === "object" ? run.planned : { scenarios: [], pairs: {} };
  const plannedScenarios = Array.isArray(planned.scenarios) ? planned.scenarios : [];
  const plannedPairs = planned.pairs && typeof planned.pairs === "object" ? planned.pairs : {};
  const plannedPairCount = Object.values(plannedPairs).reduce((total, ids) => total + (Array.isArray(ids) ? ids.length : 0), 0);
  // Missing = expected identities that were never measured, computed from identity, not from a
  // measurement's own status: an engine that produced nothing is missing pairs, not merely unmeasured.
  const measuredPlanned = measurements.filter((measurement) => Array.isArray(plannedPairs[measurement.scenarioId])
    && plannedPairs[measurement.scenarioId].includes(measurement.pairId)).length;
  const missingPairs = Math.max(0, plannedPairCount - measuredPlanned);
  const executed = run.executed ?? { scenarios: [], pairs: {} };
  // Presentation-complete is strict AND full AND non-partial AND actually measured: never a positive
  // verdict for a partial or empty run. The raw run.coverage/exit keep their auto/strict semantics.
  const complete = run.status === "complete" && Boolean(run.coverage && run.coverage.complete) && !run.partial && measurements.length > 0;
  return {
    status: run.status,
    mode: run.mode,
    engines,
    // `requested` stays the numeric count the CLI already consumes; the richer matrix lives in the
    // requestedEngines/planned/executed/completion fields below.
    requested: engines.length,
    launched: engines.filter((engine) => engine.launched === true).length,
    partial: Boolean(run.partial),
    complete,
    requestedEngines,
    planned: { engines: requestedEngines, scenarios: plannedScenarios.length, pairs: plannedPairCount },
    executed: { scenarios: (executed.scenarios ?? []).length, pairs: measurements.length },
    completion: { status: run.status, complete, partial: Boolean(run.partial), measuredPairs: measurements.length, missingPairs },
    expectedScenarios: plannedScenarios.length,
    executedScenarios: (executed.scenarios ?? []).length,
    expectedPairs: plannedPairCount,
    measuredPairs: measurements.length,
    unmeasured: measurements.filter((measurement) => measurement.status === "unmeasured").length,
    missingPairs,
    unsupported: (run.unsupported ?? []).length,
    environmentErrors: environmentErrors.length,
    measurementErrors: measurementErrors.length,
  };
}

function evaluateExit({ command, mode, run, strictInvalid, belowMinimum }) {
  if (strictInvalid) return 1;
  if (command === "build") {
    // build auto/off never gates on automation; required does.
    if (mode !== "required") return 0;
    return automationFailure(run) || belowMinimum ? 1 : 0;
  }
  // report
  if (mode === "off") return belowMinimum ? 1 : 0;
  if (mode === "required") return automationFailure(run) || belowMinimum ? 1 : 0;
  // auto: an unavailable environment is non-blocking and declared; a launched run that failed to
  // complete, or a measured minimum shortfall, is not.
  if (isUnavailable(run)) return 0;
  if (measurementProblem(run)) return 1;
  return belowMinimum ? 1 : 0;
}

function isUnavailable(run) {
  return run.status === "unavailable" && (run.engines ?? []).every((engine) => engine.launched !== true);
}

function automationFailure(run) {
  return isUnavailable(run) || measurementProblem(run) || Boolean(run.partial);
}

function measurementProblem(run) {
  const errors = (run.errors ?? []).filter((error) => !ENVIRONMENT_PHASES.includes(error.phase));
  return errors.length > 0 || !(run.coverage && run.coverage.complete);
}
