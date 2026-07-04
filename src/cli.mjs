#!/usr/bin/env node
import { generateColorTokens } from "./generate-colors.mjs";
import { DEFAULT_CONFIG_FILE } from "./load-config.mjs";

const VALID_COMMANDS = new Set(["build", "check"]);
const USAGE = `Usage: smart-colors [build|check] [options]

Commands:
  build   Generate semantic color tokens (default)
  check   Verify generated color tokens are up to date

Options:
  -c, --config <file>   Config file relative to --root (default: ${DEFAULT_CONFIG_FILE})
  -r, --root <dir>      Project root (default: current working directory)
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
  const report = await generateColorTokens({
    root: parsed.root,
    configFile: parsed.configFile,
    check: parsed.command === "check",
  });

  for (const warning of report.warnings) {
    console.warn(`[smart-colors] ${warning}`);
  }

  if (report.changed) {
    console.log(parsed.command === "check"
      ? `[smart-colors] ${report.config.output} is out of date.`
      : `[smart-colors] ${report.config.output} generated.`);
  } else {
    console.log(`[smart-colors] ${report.config.output} is up to date.`);
  }

  if (report.errors.length) {
    for (const error of report.errors) console.error(`[smart-colors] ${error}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`[smart-colors] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const parsedArgs = {
    command: "build",
    configFile: undefined,
    root: process.cwd(),
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
    parsedArgs.errors.push(`Unexpected arguments: ${extraPositionals.join(", ")}.`);
  }

  return parsedArgs;
}

function isMissingOptionValue(value) {
  return value == null || value === "" || value.startsWith("-");
}
