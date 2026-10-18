#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { arrow, badge, check, file, note, title, warn } from "./cli-style.mjs";
import { compactRatio } from "./format-report-html.mjs";
import { runDiagnosticWorkflow } from "./diagnostic-workflow.mjs";
import { initSmartColors } from "./init.mjs";
import { DEFAULT_CONFIG_FILE } from "./load-config.mjs";
import { inspectTuningStatus } from "./report-data.mjs";

const VALID_COMMANDS = new Set(["build", "check", "init", "audit", "report"]);
const BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const AUTOMATION_MODES = new Set(["auto", "off", "required"]);
const USAGE = `Usage: smart-colors [build|check|init|audit|report] [options]

Commands:
  build   Generate semantic color tokens and the two HTML artifacts (default)
  check   Verify generated color tokens are up to date
  init    Create a starter palette and colors-tuning.css
  audit   Audit generated tokens and colors-tuning.css in a browser
  report  Generate reports/smart-colors.html and reports/smart-colors-preview.html

Options:
  -c, --config <file>        Config file relative to --root (default: ${DEFAULT_CONFIG_FILE})
  -r, --root <dir>           Project root (default: current working directory)
      --automation <mode>    Playwright automation for build/report: auto|off|required (default: auto)
      --palette <file>       Palette path for init (default: config.palette)
      --tuning <file>        Tuning path for init (default: <palette dir>/colors-tuning.css)
  -d, --dir <dir>            Token directory for init (default: src/styles/tokens)
  -y, --yes                  Skip the init confirmation prompt
  -h, --help                 Show this help message`;

const parsed = parseArgs(process.argv.slice(2));

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
  console.error(`[smart-colors] ${formatCliError(error)}`);
  process.exitCode = 1;
}

function formatCliError(error) {
  if (error instanceof Error && error.name && error.name !== "Error" && !error.message.startsWith(error.name)) {
    return `${error.name}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
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

  const [palettePath, tuningPath, configPath] = result.files;
  const created = [
    [palettePath, "sorgente creativa del designer"],
    [tuningPath, "override opzionali di progetto"],
    ...(configPath ? [[configPath, "configurazione percorsi token"]] : []),
  ];
  const width = Math.max(...created.map(([createdPath]) => createdPath.length));

  console.log([
    `${badge()} Inizializzazione completata`,
    "",
    `  ${title("File creati")}`,
    ...created.map(([createdPath, label]) => `    ${check()} ${file(createdPath.padEnd(width))}  ${note(`(${label})`)}`),
    "",
    `  ${title("Prossimi passi")}`,
    `    1. Modifica la palette in ${file(palettePath)}`,
    "    2. Genera i token CSS:   pnpm exec smart-colors build",
    '    3. Importa nel tuo CSS:  @import "./colors.css";',
    '                              @import "./colors-tuning.css";',
    "",
  ].join("\n"));
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

  const lines = command === "build" ? buildOutcome(result) : reportOutcome(result);
  console.log(`${lines.join("\n")}\n`);

  for (const warning of result.warnings) console.warn(`[smart-colors] ${warning}`);
  for (const suggestion of result.suggestions) console.warn(`[smart-colors] Suggestion: ${suggestion}`);

  process.exitCode = result.exitCode;
}

// Legacy read-only check: it never writes, never audits and never presents a previous HTML as current.
async function runCheck({ root, configFile }) {
  const { generateColorTokens } = await import("./generate-colors.mjs");
  const report = await generateColorTokens({ root, configFile, check: true });

  for (const warning of report.warnings) console.warn(`[smart-colors] ${warning}`);
  for (const suggestion of report.suggestions) console.warn(`[smart-colors] Suggestion: ${suggestion}`);

  const outputs = report.outputs.map((output) => output.path);
  const tuning = await inspectTuningStatus(root, report.config);
  const lines = [`${badge()} Controllo token`, ""];

  lines.push(`  ${title("Stato")}`);
  // A stale check reports the failing paths through the error channel only, so "out of date" is
  // emitted exactly once and never as a success line.
  if (!report.changed) {
    lines.push(`    ${check()} ${file(outputs.join(", "))} ${outputs.length === 1 ? "is" : "are"} up to date.`);
  }
  const { warnings, suggestions } = report;
  lines.push(warnings.length === 0 && suggestions.length === 0
    ? `    ${check()} Contrasto baseline: 0 errori, 0 avvisi, 0 suggerimenti.`
    : `    ${warn()} Contrasto baseline: 0 errori, ${warnings.length} ${warnings.length === 1 ? "avviso" : "avvisi"}, ${suggestions.length} ${suggestions.length === 1 ? "suggerimento" : "suggerimenti"} ${note("(vedi dettagli su stderr)")}.`);
  if (tuning.activeCount > 0) {
    lines.push(`    ${warn()} Tuning runtime: ${tuning.activeCount} ${tuning.activeCount === 1 ? "override attivo" : "override attivi"} in ${file(tuning.path)} ${note("(da verificare con audit/report)")}.`);
  } else if (tuning.exists) {
    lines.push(`    ${check()} Tuning runtime: nessun override attivo in ${file(tuning.path)}.`);
  } else {
    lines.push(`    ${check()} Tuning runtime: nessun file ${file(tuning.path)} attivo.`);
  }

  lines.push(
    "",
    `  ${title("Sorgenti e ambito")}`,
    `    palette   config.palette (${file(report.config.palette)}) è la sorgente del designer.`,
    `    tuning    ${file(tuning.path)} — ${dimParenthetical(tuning.summary)}.`,
    "    nota      check è in sola lettura: non rigenera, non presenta HTML precedenti come correnti, non esegue audit.",
  );

  console.log(`${lines.join("\n")}\n`);

  if (report.errors.length) {
    for (const error of report.errors) console.error(`[smart-colors] ${error}`);
    process.exitCode = 1;
  }
}

function dimParenthetical(summary) {
  const match = /^(.*?)\s*(\([^()]*\))$/.exec(summary);
  return match ? `${match[1]} ${note(match[2])}` : summary;
}

function buildOutcome(result) {
  const lines = [`${badge()} Build completata`, ""];
  appendedOutcomeSections(lines, result, { headline: buildHeadline(result) });
  return lines;
}

function reportOutcome(result) {
  const lines = [`${badge()} Report contrasto generato`, ""];
  appendedOutcomeSections(lines, result, { headline: reportHeadline() });
  return lines;
}

function buildHeadline(result) {
  if (result.strictInvalid) return `Contratto di contrasto non valido: nessun CSS scritto (${agree(result.analysis.errors.length, "errore", "errori")} nel modello).`;
  const outputs = result.writeOutcome?.outputs ?? [];
  if (result.writeOutcome?.changed) return `${file(outputs.filter((output) => output.changed).map((output) => output.path).join(", "))} generated.`;
  const paths = outputs.map((output) => output.path).join(", ");
  return `${file(paths)} ${outputs.length === 1 ? "is" : "are"} up to date.`;
}

function reportHeadline() {
  return "Nessun file CSS, palette, config o tuning è stato modificato.";
}

// esito -> problemi (grouped per pair/theme) -> copertura -> modello -> due link -> azione.
function appendedOutcomeSections(lines, result, { headline }) {
  lines.push(`  ${title("Esito")}`);
  lines.push(`    ${result.strictInvalid ? warn() : check()} ${headline}`);

  lines.push("", `  ${title("Problemi")}`);
  if (result.problems.length) {
    for (const problem of result.problems) lines.push(`    ${warn()} ${problemLine(problem)}`);
    lines.push(`    ${note("Sotto minimo: evita la coppia per l'uso indicato. Sotto target: minimo rispettato, manca il margine del progetto.")}`);
  } else if (result.coverage.measuredPairs === 0) {
    // No browser measurement: surface the model explicitly, never an "all clear" that was not measured.
    if (result.modelProblems.length) {
      lines.push(`    ${warn()} Nessuna coppia misurata nel browser: avvisi del modello (advisory), non una misura eseguita.`);
      for (const problem of result.modelProblems) lines.push(`    ${note("MODELLO")} ${problemLine(problem)}`);
    } else {
      lines.push(`    ${check()} Nessuna coppia misurata nel browser e nessun avviso del modello nelle coppie dichiarate.`);
    }
  } else {
    lines.push(`    ${check()} Nessun problema nelle coppie misurate. Non è una certificazione dell'interfaccia completa.`);
  }

  lines.push("", `  ${title("Copertura")}`);
  for (const line of coverageLines(result)) lines.push(`    ${line}`);

  lines.push("", `  ${title("Modello")}`);
  for (const line of modelLines(result)) lines.push(`    ${line}`);

  lines.push("", `  ${title("Link")}`);
  const previewUrl = pathToFileURL(result.publication.previewPath).href;
  const reportUrl = pathToFileURL(result.publication.reportPath).href;
  lines.push(`    ${check()} Anteprima: ${file(result.publication.previewPath)}`);
  lines.push(`    ${check()} Report:    ${file(result.publication.reportPath)}`);
  lines.push(`    ${arrow()} ${previewUrl}`);
  lines.push(`    ${arrow()} ${reportUrl}`);

  lines.push("", `  ${title("Prossimo passo")}`);
  lines.push(`    ${arrow()} ${nextCommand(result)}`);
  lines.push(`      Snapshot statico: misura i byte incorporati, non i file sul disco. Dopo ogni modifica rigenera.`);
}

function problemLine(problem) {
  const status = problem.status === "below-minimum" ? "SOTTO MINIMO" : "SOTTO TARGET";
  const scheme = problem.scheme === "light" ? "chiaro" : "scuro";
  return `${status} · ${scheme} · ${problem.foregroundToken} su ${problem.backgroundToken}: ${ratio(problem.ratio, [problem.minimum, problem.target])} (minimo ${ratio(problem.minimum)}, target ${ratio(problem.target)}).`;
}

// Model facts before the links: strict errors, warnings and suggestions are the baseline advisory
// and must be visible without opening an artifact. The detailed warning strings stay on stderr.
function modelLines(result) {
  const errors = result.analysis.errors.length;
  const warnings = result.analysis.warnings.length;
  const suggestions = result.analysis.suggestions.length;
  const clean = errors === 0 && warnings === 0 && suggestions === 0;
  const lines = [clean
    ? `${check()} Contrasto baseline: 0 errori, 0 avvisi, 0 suggerimenti.`
    : `${warn()} Contrasto baseline: ${errors} ${agree(errors, "errore", "errori")}, ${warnings} ${agree(warnings, "avviso", "avvisi")}, ${suggestions} ${agree(suggestions, "suggerimento", "suggerimenti")} ${note("(vedi dettagli su stderr)")}.`];
  for (const error of result.analysis.errors) lines.push(`${warn()} ${error.split("\n")[0]}`);
  return lines;
}

function coverageLines(result) {
  const { coverage } = result;
  const engines = coverage.engines.map((engine) => `${engine.name}${engine.version ? ` ${engine.version}` : ""}${engine.launched ? "" : ` (${engine.status})`}`);
  const engineText = engines.length ? engines.join(", ") : "nessun motore";
  if (result.strictInvalid) {
    const requested = result.requestedAutomation ?? {};
    return [`Automazione non eseguita: contratto di contrasto del modello non valido (richiesta: modalità ${requested.mode ?? "n/d"}${requested.browsers ? `, browser ${requested.browsers.join(", ")}` : ""}). Gli HTML restano diagnostici e nessun browser è stato risolto.`];
  }
  if (coverage.status === "disabled") {
    return ["Automazione disattivata: nessuna misura browser è inclusa e Playwright non è stato risolto."];
  }
  if (coverage.launched === 0) {
    const reason = result.run.errors?.find((error) => error.message)?.message ?? "motivo non disponibile";
    return [`Playwright non disponibile: ${reason}`, "Gli HTML sono comunque generati senza misure automatiche."];
  }
  const status = coverage.complete ? "completa negli ambienti eseguiti" : "parziale o incompleta";
  const lines = [
    `Automazione ${status} · ${gridSummary(coverage)} · motori: ${engineText}.`,
    `Scenari attesi/eseguiti: ${coverage.expectedScenarios}/${coverage.executedScenarios} · coppie attese/misurate: ${coverage.expectedPairs}/${coverage.measuredPairs} · non misurate: ${coverage.unmeasured} · non supportate: ${coverage.unsupported}.`,
  ];
  // After a launch the phase, engine and reason must be visible: a skipped or failed engine is not
  // a silent gap. Causes come from the structured run, never from a guess.
  for (const engine of result.run.engines ?? []) {
    if (engine.launched === true && engine.status === "complete") continue;
    lines.push(`${warn()} motore ${engine.name}: ${engine.status}${engine.reason ? ` — ${engine.reason}` : ""}${engine.phase ? ` (fase ${engine.phase})` : ""}.`);
  }
  for (const error of result.run.errors ?? []) {
    if (!error.message) continue;
    lines.push(`${note(`fase ${error.phase ?? "n/d"} · ${error.engine ?? "ambiente"}`)} ${error.message}`);
  }
  return lines;
}

function gridSummary(coverage) {
  const launched = coverage.engines.filter((engine) => engine.launched);
  return `${launched.length} di ${coverage.requested} motori eseguiti`;
}

function nextCommand(result) {
  const parts = ["pnpm", "exec", "smart-colors", "report", "--root", shellQuote(result.root)];
  if (result.configFile && result.configFile !== DEFAULT_CONFIG_FILE) parts.push("--config", shellQuote(result.configFile));
  return parts.join(" ");
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
        parsedArgs.errors.push(`Missing value for ${arg}.`);
      } else {
        parsedArgs.configFile = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) {
        parsedArgs.errors.push("Missing value for --config.");
      } else {
        parsedArgs.configFile = value;
      }
      continue;
    }

    if (arg === "--automation") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${arg}.`);
      } else {
        parsedArgs.automation = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--automation=")) {
      const value = arg.slice("--automation=".length);
      if (!value) {
        parsedArgs.errors.push("Missing value for --automation.");
      } else {
        parsedArgs.automation = value;
      }
      continue;
    }

    if (arg === "--palette") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${arg}.`);
      } else {
        parsedArgs.palette = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--palette=")) {
      const value = arg.slice("--palette=".length);
      if (!value) {
        parsedArgs.errors.push("Missing value for --palette.");
      } else {
        parsedArgs.palette = value;
      }
      continue;
    }

    if (arg === "--tuning") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${arg}.`);
      } else {
        parsedArgs.tuning = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--tuning=")) {
      const value = arg.slice("--tuning=".length);
      if (!value) {
        parsedArgs.errors.push("Missing value for --tuning.");
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
        parsedArgs.errors.push(`Missing value for ${arg}.`);
      } else {
        parsedArgs.dir = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--dir=")) {
      const value = arg.slice("--dir=".length);
      if (!value) {
        parsedArgs.errors.push("Missing value for --dir.");
      } else {
        parsedArgs.dir = value;
      }
      continue;
    }

    if (arg === "--root" || arg === "-r") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${arg}.`);
      } else {
        parsedArgs.root = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (!value) {
        parsedArgs.errors.push("Missing value for --root.");
      } else {
        parsedArgs.root = value;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      parsedArgs.errors.push(`Unknown option: ${arg}.`);
      continue;
    }

    positionals.push(arg);
  }

  const [command, ...extraPositionals] = positionals;

  if (command) {
    if (VALID_COMMANDS.has(command)) {
      parsedArgs.command = command;
    } else {
      parsedArgs.errors.push(`Unknown command: ${command}.`);
    }
  }

  // §4.2: only report and audit accept a browser list; build must not introduce one.
  if (extraPositionals.length) {
    if (parsedArgs.command === "audit" || parsedArgs.command === "report") {
      parsedArgs.browsers = [...new Set(extraPositionals)];
      for (const name of parsedArgs.browsers) {
        if (!BROWSERS.has(name)) parsedArgs.errors.push(`Unknown browser ${name}. Supported browsers: chromium, firefox, webkit.`);
      }
    } else {
      parsedArgs.errors.push(`Unexpected arguments: ${extraPositionals.join(", ")}.`);
    }
  } else if (parsedArgs.command === "audit") {
    parsedArgs.browsers = ["chromium"];
  }

  if (parsedArgs.automation !== undefined) {
    if (!AUTOMATION_MODES.has(parsedArgs.automation)) {
      parsedArgs.errors.push(`Unknown automation mode ${parsedArgs.automation}. Expected one of auto, off, required.`);
    } else if (parsedArgs.command !== "build" && parsedArgs.command !== "report") {
      parsedArgs.errors.push("Option --automation is only supported by build and report.");
    }
  }

  if (parsedArgs.browsers && (parsedArgs.command === "report")) {
    if (parsedArgs.automation === "off") {
      parsedArgs.errors.push("An explicit browser list cannot be combined with automation mode off.");
    } else if (parsedArgs.automation === "auto") {
      parsedArgs.errors.push("An explicit browser list cannot be combined with automation mode auto; use required.");
    } else if (parsedArgs.automation === undefined) {
      // An explicit report browser list implies a deterministic, strict request.
      parsedArgs.automation = "required";
    }
  }

  if (parsedArgs.command !== "init") {
    for (const [flag, value] of [["--palette", parsedArgs.palette], ["--tuning", parsedArgs.tuning], ["--dir", parsedArgs.dir]]) {
      if (value !== undefined) parsedArgs.errors.push(`Option ${flag} is only supported by init.`);
    }
    if (parsedArgs.yes) parsedArgs.errors.push("Option --yes is only supported by init.");
  }

  return parsedArgs;
}

function isMissingOptionValue(value) {
  return value == null || value === "" || value.startsWith("-");
}
