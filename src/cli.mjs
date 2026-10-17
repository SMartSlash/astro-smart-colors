#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { generateColorTokens } from "./generate-colors.mjs";
import { initSmartColors } from "./init.mjs";
import { DEFAULT_CONFIG_FILE } from "./load-config.mjs";

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

async function runInit({ root, configFile, palette, tuning, yes }) {
  const result = await initSmartColors({ root, configFile, palette, tuning, yes });

  if (!result.written) {
    console.log("[smart-colors] Nothing written.");
    return;
  }

  for (const file of result.files) console.log(`[smart-colors] Created ${file}.`);
  console.log(`[smart-colors] Next: edit ${result.files[0]} and run smart-colors build.`);
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

  if (report.changed && command !== "check") {
    const generated = report.outputs.filter((output) => output.changed).map((output) => output.path);
    console.log(`[smart-colors] ${generated.join(", ")} generated.`);
  } else if (!report.changed) {
    const outputs = report.outputs.map((output) => output.path);
    console.log(`[smart-colors] ${outputs.join(", ")} ${outputs.length === 1 ? "is" : "are"} up to date.`);
  }

  if (report.errors.length) {
    for (const error of report.errors) console.error(`[smart-colors] ${error}`);
    process.exitCode = 1;
  }

  console.log(`[smart-colors] config.palette (${report.config.palette}) è la sorgente del designer. build/check verificano solo i default generati, NON il tuning nel browser né i componenti reali.`);
  if (await hasProjectReportScript({ root, configFile })) {
    console.log("[smart-colors] Dalla root del progetto, esegui pnpm colors:report, poi apri reports/smart-colors-preview.html per esempi realmente misurati e proposte manuali. Un'anteprima già presente potrebbe essere obsoleta.");
  }
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
    for (const [flag, value] of [["--palette", parsedArgs.palette], ["--tuning", parsedArgs.tuning]]) {
      if (value !== undefined) parsedArgs.errors.push(`Option ${flag} is only supported by init.`);
    }
    if (parsedArgs.yes) parsedArgs.errors.push("Option --yes is only supported by init.");
  }

  return parsedArgs;
}

function isMissingOptionValue(value) {
  return value == null || value === "" || value.startsWith("-");
}
