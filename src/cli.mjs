#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { arrow, badge, check, file, note, title, warn } from "./cli-style.mjs";
import { generateColorTokens } from "./generate-colors.mjs";
import { initSmartColors } from "./init.mjs";
import { DEFAULT_CONFIG_FILE } from "./load-config.mjs";
import { inspectTuningStatus } from "./report-data.mjs";

const VALID_COMMANDS = new Set(["build", "check", "init", "audit", "report"]);
const BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const USAGE = `Usage: smart-colors [build|check|init|audit|report] [options]

Commands:
  build   Generate semantic color tokens (default)
  check   Verify generated color tokens are up to date
  init    Create a starter palette and colors-tuning.css
  audit   Audit generated tokens and colors-tuning.css in a browser
  report  Generate reports/smart-colors.html and reports/smart-colors-preview.html

Options:
  -c, --config <file>   Config file relative to --root (default: ${DEFAULT_CONFIG_FILE})
  -r, --root <dir>      Project root (default: current working directory)
      --palette <file>  Palette path for init (default: config.palette)
      --tuning <file>   Tuning path for init (default: <palette dir>/colors-tuning.css)
  -d, --dir <dir>       Token directory for init (default: src/styles/tokens)
  -y, --yes             Skip the init confirmation prompt
  -h, --help            Show this help message`;

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
  } else if (parsed.command === "audit" || parsed.command === "report") {
    await runAuditOrReport(parsed);
  } else {
    await runBuildOrCheck(parsed);
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

async function runAuditOrReport({ command, browsers, root, configFile }) {
  const { projectAudit } = await import("./browser-audit.mjs");
  await projectAudit(browsers, { root, configFile, emitReport: command === "report" });
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
    "    2. Genera i token CSS:   smart-colors build",
    '    3. Importa nel tuo CSS:  @import "./colors.css";',
    '                              @import "./colors-tuning.css";',
    "",
  ].join("\n"));
}

async function runBuildOrCheck({ root, configFile, command }) {
  const report = await generateColorTokens({
    root,
    configFile,
    check: command === "check",
  });

  for (const warning of report.warnings) {
    console.warn(`[smart-colors] ${warning}`);
  }
  for (const suggestion of report.suggestions) {
    console.warn(`[smart-colors] Suggestion: ${suggestion}`);
  }

  const generated = report.outputs.filter((output) => output.changed).map((output) => output.path);
  const outputs = report.outputs.map((output) => output.path);
  const tuning = await inspectTuningStatus(root, report.config);
  const header = report.changed
    ? (command === "check" ? "Controllo token" : "Token colore generati")
    : "Controllo token completato";
  const lines = [`${badge()} ${header}`, ""];

  lines.push(`  ${title("Stato")}`);
  if (!(report.changed && command === "check")) {
    const paths = report.changed ? generated.join(", ") : outputs.join(", ");
    const suffix = report.changed ? " generated." : ` ${outputs.length === 1 ? "is" : "are"} up to date.`;
    lines.push(`    ${check()} ${file(paths)}${suffix}`);
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
    "    nota      build/check verificano solo i default generati, NON il tuning nel browser né i componenti reali.",
  );

  if (await hasProjectReportScript({ root, configFile })) {
    lines.push(
      "",
      `  ${title("Verifica nel browser")}`,
      `    ${arrow()} Dalla root del progetto, esegui pnpm colors:report, poi apri ${file("reports/smart-colors-preview.html")}`,
      "      per esempi realmente misurati e proposte manuali. Un'anteprima già presente potrebbe essere obsoleta.",
    );
  }

  lines.push("");
  console.log(lines.join("\n"));

  if (report.errors.length) {
    for (const error of report.errors) console.error(`[smart-colors] ${error}`);
    process.exitCode = 1;
  }
}

function dimParenthetical(summary) {
  const match = /^(.*?)\s*(\([^()]*\))$/.exec(summary);
  return match ? `${match[1]} ${note(match[2])}` : summary;
}

async function hasProjectReportScript({ root, configFile }) {
  if (configFile !== undefined && path.resolve(root, configFile) !== path.resolve(root, DEFAULT_CONFIG_FILE)) return false;

  try {
    const projectPackage = JSON.parse(await readFile(path.resolve(root, "package.json"), "utf8"));
    const script = projectPackage?.scripts?.["colors:report"];
    return typeof script === "string" && script.trim().length > 0;
  } catch {
    // Optional project guidance must not affect generation diagnostics or exit status.
    return false;
  }
}

function parseArgs(args) {
  const parsedArgs = {
    command: "build",
    configFile: undefined,
    root: process.cwd(),
    palette: undefined,
    tuning: undefined,
    dir: undefined,
    browsers: [],
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

  if (extraPositionals.length) {
    if (parsedArgs.command === "audit" || parsedArgs.command === "report") {
      parsedArgs.browsers = [...new Set(extraPositionals)];
      for (const name of parsedArgs.browsers) {
        if (!BROWSERS.has(name)) parsedArgs.errors.push(`Unknown browser ${name}. Supported browsers: chromium, firefox, webkit.`);
      }
    } else {
      parsedArgs.errors.push(`Unexpected arguments: ${extraPositionals.join(", ")}.`);
    }
  } else if (parsedArgs.command === "audit" || parsedArgs.command === "report") {
    parsedArgs.browsers = ["chromium"];
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
