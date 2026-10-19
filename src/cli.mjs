#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { badge, check, cssNotice, cssState, file, measurementAvailable, note, provenance, title, verdict, verificationComplete, warn } from "./cli-style.mjs";
import { createDesignerLanguage } from "./designer-language.mjs";
import { compactRatio } from "./format-report-html.mjs";
import { runDiagnosticWorkflow } from "./diagnostic-workflow.mjs";
import { initSmartColors } from "./init.mjs";
import { DEFAULT_CONFIG_FILE } from "./load-config.mjs";
import { inspectTuningStatus } from "./report-data.mjs";

// One shared, self-contained language instance for human usage names. The token-faithful fallback
// for unknown cases lives in the helper, never as a copied table here.
const designerLanguage = createDesignerLanguage();

const VALID_COMMANDS = new Set(["build", "check", "init", "audit", "report"]);
const BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const AUTOMATION_MODES = new Set(["auto", "off", "required"]);
// Console stdout is the human channel: cap dynamic prose text and escape terminal control
// characters so a hostile palette, path or error string cannot inject ANSI/newlines. Clickable
// file URLs and command lines are escaped but never truncated.
const MAX_CONSOLE_TEXT = 160;
const MAX_SHOWN_PROBLEMS = 5;
const MAX_DIAGNOSTIC_LINES = 40;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

// Terminal layout: one compact labelled line per fact, so the terminal accompanies the work instead
// of walling it. `CONT` is the continuation indent aligned under the labelled text.
const LABEL_WIDTH = 10;
const CONT = " ".repeat(LABEL_WIDTH + 2);
// Stable order for the source/role breakdown in the subject line.
const ROLE_ORDER = ["canvas", "ink", "ui", "feedback", "decorative"];
// Stable, plain progress phases (no spinner, no invented percentages). The automation label must
// not promise a browser run before discovery: `auto` only announces that the optional automation
// is being checked.
const STATUS_LABELS = {
  analysis: "analisi palette",
  generation: "generazione token",
  automation: "controllo automazione opzionale",
  publication: "anteprima e report",
};
const AUTOMATION_REQUIRED_LABEL = "verifica automatizzata richiesta";
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
    // The created list stays exact; this block explains the roles of the three files a designer
    // touches, so the generated output is never edited by hand and the palette/tuning split is clear.
    `  ${title("Come funziona")}`,
    `    palette   ${file(safeText(generation.palettePath ?? created[0] ?? ""))} — la tua sorgente: qui modifichi colori e ruoli.`,
    `    output    ${file(safeText(generation.outputPath ?? "src/styles/tokens/colors.css"))} — generato da build: non modificarlo a mano.`,
    `    tuning    ${file(safeText(generation.tuningPath ?? created[1] ?? ""))} — rifiniture opzionali applicate a runtime.`,
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
    ? `    ${check()} Contrasti non misurati (stima del modello): 0 errori, 0 avvisi, 0 suggerimenti.`
    : `    ${warn()} Contrasti non misurati (stima del modello): 0 errori, ${warnings.length} ${agree(warnings.length, "avviso", "avvisi")}, ${suggestions.length} ${agree(suggestions.length, "suggerimento", "suggerimenti")} ${note("(vedi dettagli su stderr)")}.`);
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

// Build and report share one pipeline; the exit policy and the verdict come from the workflow.
// Progress lines are plain and streamed live as each real phase starts, so the terminal accompanies
// the work without a spinner, a TUI or invented percentages. Only started phases ever reach stdout;
// usage errors are resolved before the workflow and keep stdout empty.
async function runWorkflow({ command, root, configFile, automation, browsers }) {
  const mode = automation ?? (command === "report" && browsers ? "required" : "auto");
  const result = await runDiagnosticWorkflow({
    root,
    configFile,
    command,
    automation: mode,
    browsers: browsers && browsers.length ? browsers : undefined,
    onProgress: (phase) => console.log(`smart-colors · ${progressLabel(phase, mode)}`),
  });

  const heading = result.command === "build" ? `${badge()} build` : `${badge()} report`;
  const lines = [heading, "", ...outcomeLines(result)];
  console.log(`${lines.join("\n")}\n`);

  // stderr is the raw technical channel, shown once each: the blocking model errors (previously
  // dropped here), the model warning/suggestion strings verbatim, then the deduplicated engine/run
  // detail. Errors and warnings are disjoint, so nothing is duplicated across the two loops.
  for (const error of boundedLines(result.analysis?.errors, MAX_DIAGNOSTIC_LINES, "errori")) {
    console.error(`[smart-colors] ${error}`);
  }
  for (const warning of result.warnings) console.warn(`[smart-colors] ${warning}`);
  for (const suggestion of result.suggestions) console.warn(`[smart-colors] Suggestion: ${suggestion}`);
  for (const detail of coverageDiagnostics(result)) console.warn(`[smart-colors] ${detail}`);

  process.exitCode = result.exitCode;
}

// Contesto (oggetto) -> stato generazione -> stato verifica -> esito -> problemi -> link -> azione.
function outcomeLines(result) {
  return [
    ...subjectLines(result),
    ...designLines(result),
    ...generationLines(result),
    ...verificationLines(result),
    ...explorationLines(result),
    esitoLine(result),
    ...problemLines(result),
    ...linkLines(result),
    ...actionLines(result),
  ];
}

// A stable, plain label per started phase. `auto` announces the optional automation check rather
// than promising a browser verification that discovery may not deliver.
function progressLabel(phase, mode) {
  if (phase === "automation") return mode === "required" ? AUTOMATION_REQUIRED_LABEL : STATUS_LABELS.automation;
  return STATUS_LABELS[phase] ?? phase;
}

// One compact labelled line per fact; the label is dimmed and padded so the values stay aligned.
function block(label, text) {
  return `  ${note(label.padEnd(LABEL_WIDTH))}${text}`;
}

// The effective config's roles, counted for the subject line. `focus` references an existing
// identity rather than a separate authored colour, so it is not counted.
function countRoles(roles = {}) {
  const counts = new Map();
  const bump = (role) => counts.set(role, (counts.get(role) ?? 0) + 1);
  if (roles.canvas) bump("canvas");
  if (roles.ink) bump("ink");
  for (const def of Object.values(roles.identities ?? {})) bump(def?.role === "feedback" ? "feedback" : "ui");
  for (const _def of Object.values(roles.decoratives ?? {})) bump("decorative");
  return counts;
}

// Designer-facing subject: the effective palette/output paths and the source/role count.
function subjectLines(result) {
  const config = result.analysis?.config ?? {};
  const counts = countRoles(config.roles);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const breakdown = ROLE_ORDER
    .filter((role) => counts.has(role))
    .map((role) => `${counts.get(role)} ${designerLanguage.roleLabel(role)}`)
    .join(", ");
  const sources = `${total} ${total === 1 ? "colore" : "colori"}${breakdown ? ` (${breakdown})` : ""}`;
  return [
    block("Palette", `${file(safeText(config.palette ?? "src/styles/tokens/palette.css"))} · ${sources}`),
    block("Output", file(safeText(config.output ?? "src/styles/tokens/colors.css"))),
  ];
}

// Brief, honest traceability of where the authored sources feed and where tuning applies. Optional
// `analysis.design` tracing metadata is never dumped: the full controls live in the report/preview.
function designLines(result) {
  const output = safeText(result.analysis?.config?.output ?? "src/styles/tokens/colors.css");
  return [block("Design", `le sorgenti della palette generano ${file(output)}; il tuning si applica nell'anteprima. Controlli completi nel report.`)];
}

// Exploratory overlaps never count toward the pass criteria or the exit code: they are only pointed
// at (without a count) when the run exposes them, and never claimed when unavailable.
function explorationLines(result) {
  const explorations = result.run?.explorations;
  const available = Array.isArray(explorations)
    ? explorations.length > 0
    : Boolean(explorations && typeof explorations === "object" && Object.keys(explorations).length > 0);
  if (!available) return [];
  return [block("Extra", "Abbinamenti esplorativi disponibili in anteprima (fuori dai criteri di esito).")];
}

// Generation status is a separate fact from the verification outcome: a successful write is never a
// positive verification. `report` writes nothing by design and names the non-production candidate.
function generationLines(result) {
  if (result.command === "report") {
    const lines = [block("Generato", "Nessun file CSS, palette, config o tuning è stato modificato.")];
    const notice = cssNotice(cssState(result));
    if (notice) lines.push(block("Nota", safeText(notice)));
    return lines;
  }
  if (result.strictInvalid) {
    return [block("Generato", "non eseguito: contratto non valido, nessun CSS scritto.")];
  }
  const outputs = result.writeOutcome?.outputs ?? [];
  if (result.writeOutcome?.changed) {
    const paths = outputs.filter((output) => output.changed).map((output) => safeText(output.path)).join(", ");
    return [block("Generato", `${file(paths)} rigenerato.`)];
  }
  const paths = outputs.map((output) => safeText(output.path)).join(", ");
  return [block("Generato", `${file(paths)} ${outputs.length === 1 ? "è già aggiornato" : "sono già aggiornati"}.`)];
}

// What was actually verified, with the provenance made explicit. Zero engines launched keeps its
// honest per-engine reasons; a partial run is never reported as an executed verification.
function verificationLines(result) {
  if (result.strictInvalid) {
    return [block("Verifica", "STIMA DEL MODELLO · Automazione non eseguita: contratto di contrasto del modello non valido; i due HTML diagnostici sono pubblicati.")];
  }
  // A partial run still has real measurements: it stays MISURATO and declares its incomplete coverage.
  if (measurementAvailable(result)) {
    if (verificationComplete(result)) {
      return [block("Verifica", `MISURATO · ${gridSummary(result.coverage)} nel browser.`)];
    }
    const coverage = result.coverage;
    const missing = Number.isFinite(coverage.missingPairs) ? coverage.missingPairs : coverage.unmeasured;
    return [block("Verifica", `MISURATO · copertura incompleta: ${coverage.measuredPairs} coppie misurate, ${missing} mancanti.`)];
  }
  const coverage = result.coverage;
  if (coverage.status === "disabled" || coverage.mode === "off") {
    return [block("Verifica", "STIMA DEL MODELLO · Automazione disattivata: nessuna coppia misurata.")];
  }
  if ((coverage.launched ?? 0) === 0) {
    return zeroLaunchLines(result);
  }
  const missing = Number.isFinite(coverage.missingPairs) ? coverage.missingPairs : coverage.unmeasured;
  return [block("Verifica", `STIMA DEL MODELLO · verifica incompleta: copertura parziale (coppie mancanti: ${missing}).`)];
}

function esitoLine(result) {
  const outcome = verdict(result);
  return block("Esito", `${outcome.label} — ${outcome.detail}`);
}

// Short list: at most a few problems, always with human usage labels (token names and raw ratios
// stay in the stderr/report detail) and always a pointer to the full set in the report.
function problemLines(result) {
  // A strict-invalid model is described by its blocking errors, not by the advisory superset.
  if (result.strictInvalid) {
    const count = result.analysis?.errors?.length ?? 0;
    return [block("Problemi", `${count} ${count === 1 ? "errore bloccante" : "errori bloccanti"} nel modello; dettagli su stderr.`)];
  }
  // Availability (measuredPairs > 0) selects the measured facts; completeness only decides whether a
  // clean result may be presented positively. A partial measured run keeps its measured problems, so
  // a measured shortfall is never dropped in favour of an empty model list.
  const available = measurementAvailable(result);
  const problems = (available ? result.problems : result.modelProblems) ?? [];
  const incomplete = available && !verificationComplete(result);
  if (!problems.length) {
    if (available) {
      return [block("Problemi", incomplete
        ? "nessuna coppia misurata sotto soglia, ma la copertura è incompleta: nessun esito positivo confermato."
        : "nessuna coppia misurata sotto soglia.")];
    }
    return [block("Problemi", "nessun avviso del modello nelle coppie dichiarate.")];
  }
  const shown = problems.slice(0, MAX_SHOWN_PROBLEMS);
  const header = `${problems.length} ${problems.length === 1 ? "coppia" : "coppie"} da rivedere (${provenance(result).toLowerCase()})${incomplete ? "; copertura incompleta" : ""}.`;
  const lines = [block("Problemi", header)];
  for (const problem of shown) lines.push(`${CONT}· ${problemText(problem)}`);
  if (problems.length > shown.length) {
    lines.push(`${CONT}…e altre ${problems.length - shown.length}; tutte nel report.`);
  }
  return lines;
}

// Human pair label + theme, the threshold-aware measured ratio, and the shortfall against the
// distinct project target or reference minimum. Equal thresholds are shown once, never twice.
function problemText(problem) {
  const pair = designerLanguage.pairTitle(problem.foregroundToken, problem.backgroundToken);
  const theme = designerLanguage.themeLabel(problem.scheme);
  const measured = ratio(problem.ratio, [problem.minimum, problem.target]);
  const threshold = problem.minimum === problem.target
    ? `sotto la soglia ${ratio(problem.minimum)}`
    : problem.status === "below-minimum"
      ? `sotto il minimo ${ratio(problem.minimum)}`
      : `sotto il target del progetto ${ratio(problem.target)}`;
  return `${pair} (${theme}) — ${measured}, ${threshold}.`;
}

// Zero engines launched: name every selected engine with a brief reason. The install is the
// project's responsibility, so no installer command is invented and no nag is shown in `auto`.
function zeroLaunchLines(result) {
  const engines = (result.run.engines ?? []).filter((engine) => engine.launched !== true);
  const expected = expectedAbsenceReasons(result);
  const allExpected = engines.length > 0 && engines.every((engine) => expected.has(engine.reason));
  const nativeNote = `${CONT}La verifica nativa è disponibile nell’anteprima.`;

  // Expected optional absence (Playwright simply not installed): a brief note, not a per-engine
  // technical breakdown.
  if (result.mode !== "required" && allExpected) {
    return [
      block("Verifica", "STIMA DEL MODELLO · Automazione opzionale non eseguita: Playwright non installato, misure browser non eseguite."),
      nativeNote,
    ];
  }

  const causes = causeByReason(result.run);
  const selected = engines.length
    ? engines.map((engine) => ({ name: engine.name, phase: engine.phase, cause: causes.get(engine.reason) ?? null }))
    : (result.coverage.requestedEngines ?? []).map((name) => ({ name, phase: null, cause: null }));

  const lines = [block("Verifica", "STIMA DEL MODELLO · nessuno dei motori richiesti è stato avviato.")];
  const groups = new Map();
  for (const engine of selected) {
    const brief = briefEngineReason(engine);
    const names = groups.get(brief) ?? [];
    names.push(safeText(engine.name));
    groups.set(brief, names);
  }
  for (const [brief, names] of groups) lines.push(`${CONT}motori ${names.join(", ")}: ${brief}.`);

  if (result.mode === "required") {
    lines.push(`${CONT}Azione: verifica l’installazione di Playwright e dei motori richiesti nel progetto (pacchetto e binari); il progetto gestisce l’installazione.`);
    lines.push(`${CONT}Nel frattempo apri l’anteprima generata: la verifica nativa misura i byte incorporati senza Playwright.`);
  } else {
    lines.push(nativeNote);
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

function gridSummary(coverage) {
  const launched = (coverage.engines ?? []).filter((engine) => engine.launched).length;
  const expected = (coverage.requestedEngines ?? coverage.engines ?? []).length;
  return `${launched} di ${expected} motori eseguiti`;
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
    block("Anteprima", file(escapeControl(previewUrl))),
    block("Report", file(escapeControl(reportUrl))),
  ];
}

// Exactly one next action. A strict-invalid model points at the palette; `build` points at the
// regeneration command (with the effective root/config); `report` opens the preview without
// recycling an identical report invocation.
// The next action opens the preview first (the single primary step). Regeneration is a separate,
// conditional secondary step: the `build` command (with root/config), never a `report`→`report`
// tautology, and only when the generated CSS actually needs to be (re)written.
function actionLines(result) {
  const lines = [block("Fai ora", "Apri l'anteprima per vedere i campioni e verificare nel browser.")];
  if (cssNeedsBuild(result)) {
    lines.push(`${CONT}Quando il CSS è da (ri)generare: ${buildCommandFor(result.root, result.configFile)}`);
  }
  return lines;
}

function cssNeedsBuild(result) {
  if (result.strictInvalid) return true;
  if (result.command !== "report") return false;
  const shape = cssState(result).shape;
  return shape === "stale" || shape === "absent" || shape === "empty";
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

// Bound a technical line list on stderr while preserving the first lines verbatim and naming the
// remainder, so a hostile or huge error set can never become an unbounded wall.
function boundedLines(lines, max, noun) {
  const list = lines ?? [];
  if (list.length <= max) return list;
  return [...list.slice(0, max), `…e altri ${list.length - max} ${noun} (dettagli completi nel report).`];
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
