import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSmartColorsConfig } from "./defaults.mjs";
import { MARKER, formatContrastReportHtml } from "./format-report-html.mjs";
import { formatContrastPreviewHtml } from "./format-report-preview.mjs";
import { DEFAULT_CONFIG_FILE, resolveProjectUrl } from "./load-config.mjs";
import { validateOutputPaths } from "./output-paths.mjs";

const ARTIFACTS = [
  { name: "report", relativePath: "reports/smart-colors.html", render: formatContrastReportHtml },
  { name: "preview", relativePath: "reports/smart-colors-preview.html", render: formatContrastPreviewHtml },
];
const REPORT_ARTIFACT = ARTIFACTS[0];
const DEFAULT_TUNING_PATH = "src/styles/tokens/colors-tuning.css";

/**
 * Write the fixed Smart Colors artifacts for one snapshot.
 *
 * The full report is always written and keeps its historical return value: the absolute
 * report path. With `preview: true` the compact preview of the same snapshot is written in
 * the same call and both absolute paths are returned as `{ reportPath, previewPath }`.
 * Every requested artifact goes through one channel: ownership marker, protection of the
 * configured paths, symbolic/hard link refusal and an atomic rename over a fresh temporary
 * file. Nothing is written until every requested document has rendered and validated.
 */
export async function writeContrastReport({ root = process.cwd(), report, config, configFile = DEFAULT_CONFIG_FILE, tuningPath = DEFAULT_TUNING_PATH, preview = false }) {
  const artifacts = preview ? ARTIFACTS : [REPORT_ARTIFACT];
  const rendered = artifacts.map((artifact) => ({ ...artifact, html: artifact.render(report) }));
  for (const artifact of rendered) {
    if (typeof artifact.html !== "string" || !artifact.html.startsWith(MARKER)) {
      throw new Error(`Smart Colors ${artifact.name} renderer did not return a marked HTML document.`);
    }
  }

  const protectedPaths = [
    { label: "config.palette", value: config?.palette ?? defaultSmartColorsConfig.palette },
    { label: "config.output", value: config?.output ?? defaultSmartColorsConfig.output },
    { label: "config.motion.output", value: config?.motion?.output ?? defaultSmartColorsConfig.motion.output },
    { label: "tuningPath", value: tuningPath },
  ];
  const targets = [];
  for (const artifact of rendered) {
    const target = fileURLToPath(resolveProjectUrl(root, artifact.relativePath));
    targets.push(target);
    await validateDestination(target);
    for (const source of protectedPaths) {
      try {
        // Treat each protected path as a source and the artifact as the only output.
        // Invalid inputs may alias each other; that must not prevent an error report.
        // Motion is protected even when disabled, including without a loaded config.
        await validateOutputPaths({ root, configFile, config: { palette: source.value, output: artifact.relativePath } });
      } catch (cause) {
        throw new Error(`Smart Colors report path validation failed against ${source.label} (${source.value}) or configFile (${configFile}): ${cause.message}`, { cause });
      }
    }
  }

  // Stage every document first, then rename: a failure before the renames leaves all
  // pre-existing artifacts untouched, and only temporaries created here are removed.
  const temporaryPaths = [];
  try {
    for (const [index, target] of targets.entries()) {
      const directory = path.dirname(target);
      await mkdir(directory, { recursive: true });
      const temporaryPath = path.join(directory, `.smart-colors-${rendered[index].name}-${randomUUID()}.tmp`);
      const temporaryFile = await open(temporaryPath, "wx");
      temporaryPaths.push(temporaryPath);
      try {
        await temporaryFile.writeFile(rendered[index].html, "utf8");
      } finally {
        await temporaryFile.close();
      }
    }
    for (const [index, target] of targets.entries()) await rename(temporaryPaths[index], target);
  } finally {
    for (const temporaryPath of temporaryPaths) await rm(temporaryPath, { force: true });
  }
  return preview ? { reportPath: targets[0], previewPath: targets[1] } : targets[0];
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
