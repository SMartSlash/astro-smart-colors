#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { arrow, badge, buildHeading, check, file, note, reportHeading, title, verificationComplete, warn } from "./cli-style.mjs";
import { compactRatio } from "./format-report-html.mjs";
import { runDiagnosticWorkflow } from "./diagnostic-workflow.mjs";
import { initSmartColors } from "./init.mjs";
import { DEFAULT_CONFIG_FILE } from "./load-config.mjs";
import { inspectTuningStatus } from "./report-data.mjs";

const VALID_COMMANDS = new Set(["build", "check", "init", "audit", "report"]);
const BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const AUTOMATION_MODES = new Set(["auto", "off", "required"]);
// Console stdout is the human channel: cap dynamic prose text and escape terminal control
// characters so a hostile palette, path or error string cannot inject ANSI/newlines. Clickable
// file URLs and command lines are escaped but never truncated.
const MAX_CONSOLE_TEXT = 160;
const MAX_PROBLEM_LINES = 40;
const MAX_DIAGNOSTIC_LINES = 40;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const USAGE = `Uso: smart-colors [build|check|init|audit|report] [opzioni]

Comandi:
  build   Genera i token colore semantici e i due artefatti HTML (predefinito)
  check   Verifica che i token colore generati siano aggiornati
  init    Crea una palette iniziale e colors-tuning.css
  audit   Analizza in un browser i token generati e colors-tuning.css
  report  Genera reports/smart-colors.html e reports/smart-colors-preview.html

Opzioni:
  -c, --config <file>        File di configurazione relativo a --root (predefinito: ${DEFAULT_CONFIG_FILE})
  -r, --root <dir>           Radice del progetto (predefinita: cartella corrente)
      --automation <mode>    Automazione Playwright per build/report: auto|off|required (predefinita: auto)
      --palette <file>       Percorso della palette per init (predefinito: config.palette)
      --tuning <file>        Percorso del tuning per init (predefinito: <cartella palette>/colors-tuning.css)
  -d, --dir <dir>            Cartella dei token per init (predefinita: src/styles/tokens)
  -y, --yes                  Salta la conferma interattiva di init
  -h, --help                 Mostra questo messaggio`;

const parsed = parseArgs(process.argv.slice(2));

// Help wins over any parsing problem; that is the conventional precedence and is kept.
if (parsed.help) {
  console.log(USAGE);
  process.exit(0);
}

if (parsed.errors.length) {
  for (const error of parsed.errors) {
    console.error(`[smart-colors] ${error}`);
  }
  console.error(USAGE);
  process.exit(1);
}

try {
  if (parsed.command === "init") {
    await runInit(parsed);
  } else if (parsed.command === "audit") {
    await runAudit(parsed);
  } else if (parsed.command === "check") {
    await runCheck(parsed);
  } else {
    await runWorkflow(parsed);
  }
} catch (error) {
  // Raw core/technical errors stay on stderr; only the two typed "absent input" cases get a
  // localized, actionable message. English core messages are otherwise preserved verbatim.
  console.error(`[smart-colors] ${formatCliError(error)}`);
  process.exitCode = 1;
}

function formatCliError(error) {
  const code = error?.smartColorsCode ?? error?.code;
  const raw = error instanceof Error ? error.message : String(error);

  if (code === "SMART_COLORS_CONFIG_NOT_FOUND") {
    const selected = error.path ?? error.configFile ?? DEFAULT_CONFIG_FILE;
    const root = error.root ?? process.cwd();
    return `Configurazione non trovata: "${safeText(selected)}" sotto ${safeText(root)}. Crea il file di configurazione, oppure ometti --config per usare "${DEFAULT_CONFIG_FILE}" quando il modello predefinito basta. Non passare a init un --config inesistente: init non crea il file selezionato.`;
  }

  if (code === "SMART_COLORS_PALETTE_NOT_FOUND") {
    const palette = error.path ?? error.palettePath ?? "la palette";
    const root = error.root ?? process.cwd();
    const configFile = error.configFile ?? DEFAULT_CONFIG_FILE;
    const configArg = configFile !== DEFAULT_CONFIG_FILE ? ` --config ${shellQuote(commandText(configFile))}` : "";
    return `Palette non trovata: "${safeText(palette)}". Crea la palette, ad esempio con: pnpm exec smart-colors init --root ${shellQuote(commandText(root))}${configArg}.`;
  }

  if (error instanceof Error && error.name && error.name !== "Error" && !raw.startsWith(error.name)) {
    return `${error.name}: ${raw}`;
  }
  return raw;
}

// Legacy strict/read-only audit: a separate writer path, never the new pipeline (§4.1).
async function runAudit({ browsers, root, configFile }) {
  const { projectAudit } = await import("./browser-audit.mjs");
  await projectAudit(browsers, { root, configFile, emitReport: false });
}

async function runInit({ root, configFile, dir, palette, tuning, yes }) {
  const result = await initSmartColors({ root, configFile, dir, palette, tuning, yes });

  if (!result.written) {
    console.log(`${badge()} Operazione annullata. Nessun file scritto.\n`);
    return;
  }

  // "File creati" lists exactly what init wrote (`result.files`). The effective config path in
  // `result.generation` may be the default name that was never created, so it is used only for the
  // next-step command, never presented as a created file.
  const created = result.files ?? [];
  const generation = result.generation ?? {};
  const labels = ["sorgente creativa del designer", "override opzionali di progetto", "configurazione percorsi token"];
  const rows = created.map((createdPath, index) => [createdPath, labels[index] ?? ""]);
  const width = rows.length ? Math.max(...rows.map(([createdPath]) => safeText(createdPath).length)) : 0;

  // The next command preserves the effective root and config so it also works when init was
  // invoked from another working directory with an explicit --root.
  const buildCommand = ["pnpm", "exec", "smart-colors", "build", "--root", shellQuote(commandText(root))];
  if (generation.configFile && generation.configFile !== DEFAULT_CONFIG_FILE) {
    buildCommand.push("--config", shellQuote(commandText(generation.configFile)));
  }

  const lines = [
    `${badge()} Inizializzazione completata`,
    "",
    `  ${title("File creati")}`,
    ...rows.map(([createdPath, label]) => `    ${check()} ${file(safeText(createdPath).padEnd(width))}  ${note(`(${label})`)}`),
    "",
  ];

  // Guidance the init owner provides (for example a tuning file build would never read). Printed
  // verbatim instead of a false "all good" success line.
  if (result.warnings?.length) {
    lines.push(`  ${title("Avvisi")}`);
    for (const warning of result.warnings) lines.push(`    ${warn()} ${safeText(warning)}`);
    lines.push("");
  }

  lines.push(
    `  ${title("Prossimi passi")}`,
    `    1. Modifica la palette in ${file(safeText(generation.palettePath ?? created[0]))}`,
    `    2. Genera i token CSS:   ${buildCommand.join(" ")}`,
    "    3. Importa i file generati nel tuo CSS:",
    `         ${file(safeText(generation.outputPath ?? "src/styles/tokens/colors.css"))}`,
    `         ${file(safeText(generation.tuningPath ?? created[1]))}`,
    "",
  );

  console.log(lines.join("\n"));
}

// Legacy read-only check: it never writes, never audits and never presents a previous HTML as current.
async function runCheck({ root, configFile }) {
  const { generateColorTokens } = await import("./generate-colors.mjs");
  const report = await generateColorTokens({ root, configFile, check: true });

  const outputs = report.outputs.map((output) => safeText(output.path));
  const tuning = await inspectTuningStatus(root, report.config);
  const lines = [`${badge()} Controllo token`, "", `  ${title("Esito")}`];

  // The stale verdict is visible immediately, brief, and suggests the real regeneration command with
  // the effective root/config. The actionable detail stays a single structured error on stderr.
  if (report.changed) {
    lines.push(`    ${warn()} ${file(outputs.join(", "))} non è aggiornato: esegui ${note(buildCommandFor(root, configFile))} per rigenerarlo.`);
  } else {
    lines.push(`    ${check()} ${file(outputs.join(", "))} ${outputs.length === 1 ? "è aggiornato" : "sono aggiornati"}.`);
  }

  const { warnings, suggestions } = report;
  lines.push(warnings.length === 0 && suggestions.length === 0
    ? `    ${check()} Contrasto baseline: 0 errori, 0 avvisi, 0 suggerimenti.`
    : `    ${warn()} Contrasto baseline: 0 errori, ${warnings.length} ${agree(warnings.length, "avviso", "avvisi")}, ${suggestions.length} ${agree(suggestions.length, "suggerimento", "suggerimenti")} ${note("(vedi dettagli su stderr)")}.`);
  if (tuning.activeCount > 0) {
    lines.push(`    ${warn()} Tuning runtime: ${tuning.activeCount} ${tuning.activeCount === 1 ? "override attivo" : "override attivi"} in ${file(safeText(tuning.path))} ${note("(da verificare con audit/report)")}.`);
  } else if (tuning.exists) {
    lines.push(`    ${check()} Tuning runtime: nessun override attivo in ${file(safeText(tuning.path))}.`);
  } else {
    lines.push(`    ${check()} Tuning runtime: nessun file ${file(safeText(tuning.path))} attivo.`);
  }

  lines.push(
    "",
    `  ${title("Sorgenti e ambito")}`,
    `    palette   config.palette (${file(safeText(report.config.palette))}) è la sorgente del designer.`,
    `    tuning    ${file(safeText(tuning.path))} — ${dimParenthetical(safeText(tuning.summary))}.`,
    "    nota      check è in sola lettura: non rigenera, non presenta HTML precedenti come correnti, non esegue audit.",
  );

  // Summary first, raw technical channel last.
  console.log(`${lines.join("\n")}\n`);

  for (const warning of report.warnings) console.warn(`[smart-colors] ${warning}`);
  for (const suggestion of report.suggestions) console.warn(`[smart-colors] Suggestion: ${suggestion}`);
  if (report.errors.length) {
    for (const error of report.errors) console.error(`[smart-colors] ${error}`);
    process.exitCode = 1;
  }
}

function buildCommandFor(root, configFile) {
  const parts = ["pnpm", "exec", "smart-colors", "build", "--root", shellQuote(commandText(root))];
  if (configFile && configFile !== DEFAULT_CONFIG_FILE) parts.push("--config", shellQuote(commandText(configFile)));
  return escapeControl(parts.join(" "));
}

function dimParenthetical(summary) {
  const match = /^(.*?)\s*(\([^()]*\))$/.exec(summary);
  return match ? `${match[1]} ${note(match[2])}` : summary;
}

// Build and report share one pipeline; the exit policy and the summary come from the workflow.
async function runWorkflow({ command, root, configFile, automation, browsers }) {
  const mode = automation ?? (command === "report" && browsers ? "required" : "auto");
  const result = await runDiagnosticWorkflow({
    root,
    configFile,
    command,
    automation: mode,
    browsers: browsers && browsers.length ? browsers : undefined,
  });

  // `result.production` is part of the workflow handoff (acceptDiagnosticOutput); no second
  // analysis or I/O is performed here.
  const production = result.command === "report" ? result.production ?? null : null;
  const heading = result.command === "build" ? buildHeading(result) : reportHeading(result);

  const lines = [`${badge()} ${heading}`, "", ...outcomeLines(result, production)];
  console.log(`${lines.join("\n")}\n`);

  // stderr is the raw technical channel: model warning/suggestion strings stay verbatim, then the
  // deduplicated engine/run detail, never a repeat on stdout.
  for (const warning of result.warnings) console.warn(`[smart-colors] ${warning}`);
  for (const suggestion of result.suggestions) console.warn(`[smart-colors] Suggestion: ${suggestion}`);
  for (const detail of coverageDiagnostics(result)) console.warn(`[smart-colors] ${detail}`);

  process.exitCode = result.exitCode;
}

// esito -> problemi (grouped) -> copertura -> modello (una sola sintesi) -> due link -> azione.
function outcomeLines(result, production) {
  const lines = [];
  lines.push(`  ${title("Esito")}`);
  for (const line of esitoLines(result, production)) lines.push(`    ${line}`);
  lines.push("", `  ${title("Problemi")}`);
  for (const line of problemLines(result)) lines.push(`    ${line}`);
  lines.push("", `  ${title("Copertura")}`);
  for (const line of coverageLines(result)) lines.push(`    ${line}`);
  lines.push("", `  ${title("Modello")}`);
  for (const line of modelLines(result)) lines.push(`    ${line}`);
  lines.push("", `  ${title("Link")}`);
  for (const line of linkLines(result)) lines.push(`    ${line}`);
  lines.push("", `  ${title("Prossimo passo")}`);
  for (const line of nextStepLines(result)) lines.push(`    ${line}`);
  return lines;
}

function esitoLines(result, production) {
  const out = [];
  if (result.command === "build") {
    if (result.strictInvalid) {
      const count = result.analysis.errors.length;
      out.push(`${warn()} Contratto di contrasto non valido: ${count} ${agree(count, "errore", "errori")} nel modello. Nessun CSS scritto; i due HTML diagnostici sono pubblicati.`);
    } else {
      const outputs = result.writeOutcome?.outputs ?? [];
      if (result.writeOutcome?.changed) {
        out.push(`${check()} ${file(outputs.filter((output) => output.changed).map((output) => safeText(output.path)).join(", "))} rigenerato.`);
      } else {
        const paths = outputs.map((output) => safeText(output.path)).join(", ");
        out.push(`${check()} ${file(paths)} ${outputs.length === 1 ? "è già aggiornato" : "sono già aggiornati"}.`);
      }
    }
  } else {
    out.push(`${check()} Nessun file CSS, palette, config o tuning è stato modificato.`);
    if (result.strictInvalid) {
      const count = result.analysis.errors.length;
      out.push(`${warn()} Contratto di contrasto non valido: ${count} ${agree(count, "errore", "errori")} nel modello.`);
    }
    if (production && production.accepted === false && production.candidates.length) {
      out.push(`${warn()} CSS assente o non aggiornato: i risultati si riferiscono a un candidato diagnostico, non alla produzione.`);
    }
  }
  return out;
}

function problemLines(result) {
  const lines = [];
  const coverage = result.coverage;
  if (result.problems.length) {
    for (const problem of result.problems.slice(0, MAX_PROBLEM_LINES)) lines.push(`${warn()} ${problemLine(problem)}`);
    if (result.problems.length > MAX_PROBLEM_LINES) lines.push(note(`…e altri ${result.problems.length - MAX_PROBLEM_LINES}; dettagli completi nel report.`));
    lines.push(note("Sotto minimo: evita la coppia per l'uso indicato. Sotto target: minimo rispettato, manca il margine del progetto."));
  } else if (coverage.measuredPairs === 0) {
    // No browser measurement: surface the model once, never an "all clear" that was not measured.
    if (result.modelProblems.length) {
      lines.push(`${warn()} Nessuna coppia misurata nel browser: avvisi del modello (advisory), non una misura eseguita.`);
      const model = result.modelProblems.slice(0, MAX_PROBLEM_LINES);
      for (const problem of model) lines.push(`${note("MODELLO")} ${problemLine(problem)}`);
      if (result.modelProblems.length > MAX_PROBLEM_LINES) lines.push(note(`…e altri ${result.modelProblems.length - MAX_PROBLEM_LINES}; dettagli completi nel report.`));
    } else if ((coverage.launched ?? 0) > 0) {
      lines.push(`${warn()} Verifica incompleta: nessuna coppia misurata nel browser benché un motore sia stato avviato. Non è un esito positivo.`);
    } else {
      lines.push(`${warn()} Nessuna coppia misurata nel browser e nessun avviso del modello nelle coppie dichiarate; non è una verifica eseguita.`);
    }
  } else if (!verificationComplete(result)) {
    // Finite measurements that pass, but the coverage is partial: never a false positive verdict.
    const missing = Number.isFinite(coverage.missingPairs) ? coverage.missingPairs : coverage.unmeasured;
    lines.push(`${warn()} Verifica incompleta: le coppie misurate non mostrano problemi, ma la copertura è parziale (mancanti: ${missing}). Non è una certificazione.`);
  } else {
    lines.push(`${check()} Nessun problema nelle coppie misurate. Non è una certificazione dell'interfaccia completa.`);
  }
  return lines;
}

function problemLine(problem) {
  const status = problem.status === "below-minimum" ? "SOTTO MINIMO" : "SOTTO TARGET";
  const scheme = problem.scheme === "light" ? "chiaro" : "scuro";
  return `${status} · ${scheme} · ${safeText(problem.foregroundToken)} su ${safeText(problem.backgroundToken)}: ${ratio(problem.ratio, [problem.minimum, problem.target])} (minimo ${ratio(problem.minimum)}, target ${ratio(problem.target)}).`;
}

// One synthesis of the model facts: counts only here, the grouped problem lines live in
// "Problemi" and the raw warning/suggestion strings stay on stderr. No triple dump.
function modelLines(result) {
  const errors = result.analysis.errors.length;
  const warnings = result.analysis.warnings.length;
  const suggestions = result.analysis.suggestions.length;
  const clean = errors === 0 && warnings === 0 && suggestions === 0;
  return [clean
    ? `${check()} Contrasto baseline: 0 errori, 0 avvisi, 0 suggerimenti.`
    : `${warn()} Contrasto baseline: ${errors} ${agree(errors, "errore", "errori")}, ${warnings} ${agree(warnings, "avviso", "avvisi")}, ${suggestions} ${agree(suggestions, "suggerimento", "suggerimenti")} ${note("(vedi dettagli su stderr)")}.`];
}

function coverageLines(result) {
  const coverage = result.coverage;
  if (result.strictInvalid) {
    const requested = result.requestedAutomation ?? {};
    return [`Automazione non eseguita: contratto di contrasto del modello non valido (richiesta: modalità ${requested.mode ?? "n/d"}${requested.browsers ? `, browser ${requested.browsers.join(", ")}` : ""}). Gli HTML restano diagnostici.`];
  }
  if (coverage.status === "disabled" || coverage.mode === "off") {
    return ["Automazione disattivata: nessuna misura browser inclusa; Playwright non è stato risolto."];
  }
  if (coverage.launched === 0) {
    return zeroLaunchLines(result);
  }
  const engineNames = coverage.requestedEngines ?? coverage.engines.map((engine) => engine.name);
  const engineText = coverage.engines.length
    ? coverage.engines.map((engine) => `${safeText(engine.name)}${engine.version ? ` ${safeText(engine.version)}` : ""}${engine.launched ? "" : ` (${safeText(engine.status)})`}`).join(", ")
    : (engineNames.length ? engineNames.map((name) => safeText(name)).join(", ") : "nessun motore");
  const complete = verificationComplete(result);
  const missing = Number.isFinite(coverage.missingPairs) ? coverage.missingPairs : coverage.unmeasured;
  const counts = [
    `Scenari attesi/eseguiti: ${coverage.expectedScenarios}/${coverage.executedScenarios}`,
    `coppie attese/misurate: ${coverage.expectedPairs}/${coverage.measuredPairs}`,
    `mancanti: ${missing}`,
    `non supportate: ${coverage.unsupported}`,
  ].join(" · ");
  return [
    `Automazione ${complete ? "completa negli ambienti eseguiti" : "parziale o incompleta"} · ${gridSummary(coverage, engineNames)} · motori: ${engineText}.`,
    `${counts}.`,
  ];
}

// Zero engines launched: name every selected engine with a brief reason, and never invent an
// installer command (the person installs the package and the requested engines).
function zeroLaunchLines(result) {
  const engines = (result.run.engines ?? []).filter((engine) => engine.launched !== true);
  const expected = expectedAbsenceReasons(result);
  const allExpected = engines.length > 0 && engines.every((engine) => expected.has(engine.reason));

  // Expected optional absence (Playwright simply not installed): a brief stdout note, not a
  // per-engine technical breakdown.
  if (result.mode !== "required" && allExpected) {
    return [
      "Automazione opzionale non eseguita: Playwright non installato, misure browser non eseguite.",
      "La verifica nativa è disponibile nell’anteprima.",
    ];
  }

  const causes = causeByReason(result.run);
  const selected = engines.length
    ? engines.map((engine) => ({ name: engine.name, phase: engine.phase, cause: causes.get(engine.reason) ?? null }))
    : (result.coverage.requestedEngines ?? []).map((name) => ({ name, phase: null, cause: null }));

  const lines = ["Automazione non eseguita: nessuno dei motori richiesti è stato avviato."];
  const groups = new Map();
  for (const engine of selected) {
    const brief = briefEngineReason(engine);
    const names = groups.get(brief) ?? [];
    names.push(safeText(engine.name));
    groups.set(brief, names);
  }
  for (const [brief, names] of groups) lines.push(`motori ${names.join(", ")}: ${brief}.`);

  if (result.mode === "required") {
    lines.push("Azione: verifica l’installazione di Playwright e dei motori richiesti nel progetto (pacchetto e binari); il progetto gestisce l’installazione.");
    lines.push("Nel frattempo apri l’anteprima generata: la verifica nativa misura i byte incorporati senza Playwright.");
  } else {
    lines.push("La verifica nativa è disponibile nell’anteprima.");
  }
  return lines;
}

// Package vs binary are distinct causes: never claim a missing binary when only the module/API is
// incompatible, and never claim the module is absent when only that engine's binary is missing.
function briefEngineReason(engine) {
  switch (engine.cause) {
    case "playwright-not-found": return "Playwright non installato nel progetto";
    case "import-failed": return "pacchetto Playwright non importabile nel progetto";
    case "import-incompatible": return "API Playwright non compatibile nel progetto";
    case "engine-unknown": return "il modulo Playwright non espone questo motore";
    case "executable-path-failed": return "impossibile determinare il percorso del binario del motore";
    case "binary-missing":
    case "engine-unavailable": return "binario del motore non disponibile nel progetto";
    default: break;
  }
  switch (engine.phase) {
    case "discovery":
    case "import":
      return "pacchetto Playwright non risolto o API non compatibile nel progetto";
    case "availability":
      return "binario del motore non disponibile nel progetto";
    case "launch":
      return "avvio del motore non riuscito";
    default:
      return "non avviato";
  }
}

// The structured "expected optional absence": discovery failed only because Playwright is not
// installed in the consumer. In `auto` this is an expected condition, not a technical failure.
function expectedAbsenceReasons(result) {
  const reasons = new Set();
  if (result.mode === "required") return reasons;
  for (const error of result.run.errors ?? []) {
    if (error.phase === "discovery" && error.cause === "playwright-not-found" && error.message) reasons.add(error.message);
  }
  return reasons;
}

function causeByReason(run) {
  const map = new Map();
  for (const error of run.errors ?? []) {
    if (error.message && !map.has(error.message)) map.set(error.message, error.cause);
  }
  return map;
}

function gridSummary(coverage, engineNames) {
  const launched = coverage.engines.filter((engine) => engine.launched).length;
  return `${launched} di ${engineNames.length} motori eseguiti`;
}

// Raw, deduplicated engine/run detail. Technical cause preserved; the install hint is only
// kept when automation was explicitly required, never as a default nag.
function coverageDiagnostics(result) {
  const coverage = result.coverage;
  if (result.strictInvalid) return [];
  if (coverage.status === "disabled" || coverage.mode === "off") return [];
  const keepInstallHint = result.mode === "required";
  const clean = (line) => (keepInstallHint ? line : stripInstallHint(line));
  // In auto, a discovery-only "Playwright not installed" is expected optional absence: suppress
  // exactly that shared cause/reason, never the whole run. Real failures stay detailed.
  const expectedAbsence = expectedAbsenceReasons(result);

  // Group engines that share the same status/reason/phase so three skipped engines with one
  // cause become one line instead of a wall.
  const groups = new Map();
  for (const engine of result.run.engines ?? []) {
    if (engine.launched === true && engine.status === "complete") continue;
    if (expectedAbsence.has(engine.reason)) continue;
    const key = `${engine.status}\u0000${engine.reason ?? ""}\u0000${engine.phase ?? ""}`;
    const group = groups.get(key) ?? { names: [], status: engine.status, reason: engine.reason, phase: engine.phase };
    group.names.push(engine.name);
    groups.set(key, group);
  }

  const lines = [];
  const reasons = new Set();
  for (const group of groups.values()) {
    if (group.reason) reasons.add(group.reason);
    const reason = group.reason ? ` — ${clean(group.reason)}` : "";
    lines.push(`copertura · ${group.names.join(", ")}: ${group.status}${reason}${group.phase ? ` (fase ${group.phase})` : ""}`);
  }
  // A run error that only echoes an engine reason already shown, or that is the expected absence,
  // adds nothing.
  for (const error of result.run.errors ?? []) {
    if (!error.message || reasons.has(error.message) || expectedAbsence.has(error.message)) continue;
    lines.push(`errore · ${error.phase ?? "n/d"} · ${error.engine ?? "ambiente"}: ${clean(error.message)}`);
  }

  if (lines.length > MAX_DIAGNOSTIC_LINES) {
    const extra = lines.length - MAX_DIAGNOSTIC_LINES;
    return [...lines.slice(0, MAX_DIAGNOSTIC_LINES), `…e altri ${extra} messaggi tecnici (deduplicati).`];
  }
  return lines;
}

// Drop an explanatory install sentence while preserving the diagnostic cause.
function stripInstallHint(text) {
  if (!/playwright install|Installa playwright/i.test(text)) return text;
  const kept = text
    .split(/(?<=\.)\s+/)
    .filter((part) => !/playwright install|Installa playwright/i.test(part))
    .join(" ")
    .trim();
  return kept || text;
}

function linkLines(result) {
  const previewUrl = pathToFileURL(result.publication.previewPath).href;
  const reportUrl = pathToFileURL(result.publication.reportPath).href;
  return [
    `${arrow()} Anteprima: ${file(escapeControl(previewUrl))}`,
    `${arrow()} Report:    ${file(escapeControl(reportUrl))}`,
  ];
}

function nextStepLines(result) {
  const lines = [`${arrow()} Apri l'anteprima nel browser.`];
  // The regenerate command is a useful secondary step after an edit; `report` does not
  // recycle an identical `report` invocation as its only next action.
  if (result.command === "build") {
    lines.push(`${note("Dopo una modifica rigenera:")} ${nextCommand(result)}`);
  }
  return lines;
}

function nextCommand(result) {
  const parts = ["pnpm", "exec", "smart-colors", "report", "--root", shellQuote(commandText(result.root))];
  if (result.configFile && result.configFile !== DEFAULT_CONFIG_FILE) parts.push("--config", shellQuote(commandText(result.configFile)));
  return escapeControl(parts.join(" "));
}

function shellQuote(value) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

// Threshold-aware: a value that only rounds up to a threshold must never be shown as if it met it.
function ratio(value, thresholds = []) {
  if (!Number.isFinite(value)) return "non disponibile";
  return compactRatio(value, thresholds).replace("&lt;", "<");
}

function agree(count, one, many) {
  return count === 1 ? one : many;
}

function escapeControl(value) {
  return String(value).replace(CONTROL_CHARS, (char) => `\\x${char.codePointAt(0).toString(16).padStart(2, "0")}`);
}

function safeText(value, max = MAX_CONSOLE_TEXT) {
  const escaped = escapeControl(value);
  return escaped.length > max ? `${escaped.slice(0, Math.max(0, max - 1))}…` : escaped;
}

// Command operands keep their visible characters (quoted by shellQuote) but lose control chars.
function commandText(value) {
  return escapeControl(value);
}

function parseArgs(args) {
  const parsedArgs = {
    command: "build",
    configFile: undefined,
    root: process.cwd(),
    palette: undefined,
    tuning: undefined,
    dir: undefined,
    automation: undefined,
    browsers: undefined,
    yes: false,
    help: false,
    errors: [],
  };
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsedArgs.help = true;
      continue;
    }

    if (arg === "--config" || arg === "-c") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Valore mancante per ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.configFile = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) {
        parsedArgs.errors.push('Valore mancante per "--config".');
      } else {
        parsedArgs.configFile = value;
      }
      continue;
    }

    if (arg === "--automation") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Valore mancante per ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.automation = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--automation=")) {
      const value = arg.slice("--automation=".length);
      if (!value) {
        parsedArgs.errors.push('Valore mancante per "--automation".');
      } else {
        parsedArgs.automation = value;
      }
      continue;
    }

    if (arg === "--palette") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Valore mancante per ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.palette = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--palette=")) {
      const value = arg.slice("--palette=".length);
      if (!value) {
        parsedArgs.errors.push('Valore mancante per "--palette".');
      } else {
        parsedArgs.palette = value;
      }
      continue;
    }

    if (arg === "--tuning") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Valore mancante per ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.tuning = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--tuning=")) {
      const value = arg.slice("--tuning=".length);
      if (!value) {
        parsedArgs.errors.push('Valore mancante per "--tuning".');
      } else {
        parsedArgs.tuning = value;
      }
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      parsedArgs.yes = true;
      continue;
    }

    if (arg === "--dir" || arg === "-d") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Valore mancante per ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.dir = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--dir=")) {
      const value = arg.slice("--dir=".length);
      if (!value) {
        parsedArgs.errors.push('Valore mancante per "--dir".');
      } else {
        parsedArgs.dir = value;
      }
      continue;
    }

    if (arg === "--root" || arg === "-r") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Valore mancante per ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.root = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (!value) {
        parsedArgs.errors.push('Valore mancante per "--root".');
      } else {
        parsedArgs.root = value;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      parsedArgs.errors.push(`Opzione sconosciuta: ${JSON.stringify(arg)}.`);
      continue;
    }

    // An empty positional is never a valid command or browser; it must not fall back
    // to the default `build` command. Reject it explicitly, in any position.
    if (arg === "") {
      parsedArgs.errors.push(`Argomento vuoto non consentito: ${JSON.stringify(arg)}.`);
      continue;
    }

    positionals.push(arg);
  }

  const [command, ...extraPositionals] = positionals;

  if (command) {
    if (VALID_COMMANDS.has(command)) {
      parsedArgs.command = command;
    } else {
      parsedArgs.errors.push(`Comando sconosciuto: ${JSON.stringify(command)}.`);
    }
  }

  // §4.2: only report and audit accept a browser list; build must not introduce one.
  if (extraPositionals.length) {
    if (parsedArgs.command === "audit" || parsedArgs.command === "report") {
      parsedArgs.browsers = [...new Set(extraPositionals)];
      for (const name of parsedArgs.browsers) {
        if (!BROWSERS.has(name)) parsedArgs.errors.push(`Browser sconosciuto ${JSON.stringify(name)}. Browser supportati: chromium, firefox, webkit.`);
      }
    } else {
      parsedArgs.errors.push(`Argomenti inattesi: ${extraPositionals.map((value) => JSON.stringify(value)).join(", ")}.`);
    }
  } else if (parsedArgs.command === "audit") {
    parsedArgs.browsers = ["chromium"];
  }

  if (parsedArgs.automation !== undefined) {
    if (!AUTOMATION_MODES.has(parsedArgs.automation)) {
      parsedArgs.errors.push(`Modalità di automazione sconosciuta ${JSON.stringify(parsedArgs.automation)}. Valori ammessi: auto, off, required.`);
    } else if (parsedArgs.command !== "build" && parsedArgs.command !== "report") {
      parsedArgs.errors.push("L'opzione --automation è supportata solo da build e report.");
    }
  }

  if (parsedArgs.browsers && (parsedArgs.command === "report")) {
    if (parsedArgs.automation === "off") {
      parsedArgs.errors.push("Un elenco di browser esplicito non può essere combinato con la modalità di automazione off.");
    } else if (parsedArgs.automation === "auto") {
      parsedArgs.errors.push("Un elenco di browser esplicito non può essere combinato con la modalità di automazione auto; usa required.");
    } else if (parsedArgs.automation === undefined) {
      // An explicit report browser list implies a deterministic, strict request.
      parsedArgs.automation = "required";
    }
  }

  if (parsedArgs.command !== "init") {
    for (const [flag, value] of [["--palette", parsedArgs.palette], ["--tuning", parsedArgs.tuning], ["--dir", parsedArgs.dir]]) {
      if (value !== undefined) parsedArgs.errors.push(`L'opzione ${flag} è supportata solo da init.`);
    }
    if (parsedArgs.yes) parsedArgs.errors.push("L'opzione --yes è supportata solo da init.");
  }

  return parsedArgs;
}

function isMissingOptionValue(value) {
  return value == null || value === "" || value.startsWith("-");
}
