#!/usr/bin/env node
import { generateColorTokens } from "./generate-colors.mjs";

const command = process.argv[2] ?? "build";
const configFile = getOption("--config");
const root = getOption("--root") ?? process.cwd();

if (!["build", "check"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: smart-colors [build|check] [--config smart-colors.config.mjs] [--root .]");
  process.exit(1);
}

try {
  const report = await generateColorTokens({
    root,
    configFile,
    check: command === "check",
  });

  for (const warning of report.warnings) {
    console.warn(`[smart-colors] ${warning}`);
  }

  if (report.changed) {
    console.log(command === "check"
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
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function getOption(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
