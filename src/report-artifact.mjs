import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSmartColorsConfig } from "./defaults.mjs";
import { formatContrastReportHtml } from "./format-report-html.mjs";
import { DEFAULT_CONFIG_FILE, resolveProjectUrl } from "./load-config.mjs";
import { validateOutputPaths } from "./output-paths.mjs";

const REPORT_PATH = "reports/smart-colors.html";
const MARKER = "<!-- smart-colors-report:v1 -->";
const DEFAULT_TUNING_PATH = "src/styles/tokens/colors-tuning.css";

export async function writeContrastReport({ root = process.cwd(), report, config, configFile = DEFAULT_CONFIG_FILE, tuningPath = DEFAULT_TUNING_PATH }) {
  const reportPath = fileURLToPath(resolveProjectUrl(root, REPORT_PATH));
  const directory = path.dirname(reportPath);
  const html = formatContrastReportHtml(report);
  if (typeof html !== "string" || !html.startsWith(MARKER)) {
    throw new Error("Smart Colors report renderer did not return a marked HTML document.");
  }

  await validateDestination(reportPath);
  const protectedPaths = [
    { label: "config.palette", value: config?.palette ?? defaultSmartColorsConfig.palette },
    { label: "config.output", value: config?.output ?? defaultSmartColorsConfig.output },
    { label: "config.motion.output", value: config?.motion?.output ?? defaultSmartColorsConfig.motion.output },
    { label: "tuningPath", value: tuningPath },
  ];
  for (const source of protectedPaths) {
    try {
      // Treat each protected path as a source and the report as the only output.
      // Invalid inputs may alias each other; that must not prevent an error report.
      // Motion is protected even when disabled, including without a loaded config.
      await validateOutputPaths({ root, configFile, config: { palette: source.value, output: REPORT_PATH } });
    } catch (cause) {
      throw new Error(`Smart Colors report path validation failed against ${source.label} (${source.value}) or configFile (${configFile}): ${cause.message}`, { cause });
    }
  }

  const temporaryPath = path.join(directory, `.smart-colors-report-${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  let temporaryFile;
  let created = false;
  try {
    temporaryFile = await open(temporaryPath, "wx");
    created = true;
    await temporaryFile.writeFile(html, "utf8");
    await temporaryFile.close();
    temporaryFile = undefined;
    await rename(temporaryPath, reportPath);
    created = false;
  } finally {
    try {
      await temporaryFile?.close();
    } finally {
      // Never remove a pre-existing file if exclusive creation failed.
      if (created) await rm(temporaryPath, { force: true });
    }
  }
  return reportPath;
}

async function entryIfPresent(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function validateDestination(reportPath) {
  const directory = path.dirname(reportPath);
  const parent = await entryIfPresent(directory);
  if (parent?.isSymbolicLink()) {
    throw new Error(`Smart Colors report refuses a symbolic link at reports directory ${directory}.`);
  }
  if (parent && !parent.isDirectory()) {
    throw new Error(`Smart Colors report directory is not a directory: ${directory}.`);
  }
  const existing = await entryIfPresent(reportPath);
  if (!existing) return;
  if (existing.isSymbolicLink()) {
    throw new Error(`Smart Colors report refuses a symbolic link at report file ${reportPath}.`);
  }
  if (!existing.isFile()) {
    throw new Error(`Smart Colors report refuses a non-regular report file: ${reportPath}.`);
  }
  if (existing.nlink > 1) {
    throw new Error(`Smart Colors report refuses a hard-linked report file: ${reportPath}.`);
  }
  const file = await open(reportPath, "r");
  try {
    const prefix = Buffer.alloc(Buffer.byteLength(MARKER));
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    if (bytesRead !== prefix.length || prefix.toString("utf8") !== MARKER) {
      throw new Error(`Smart Colors report refuses to overwrite an unowned file at ${reportPath}; expected ${MARKER} at byte zero.`);
    }
  } finally {
    await file.close();
  }
}
