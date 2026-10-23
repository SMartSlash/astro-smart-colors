import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultSmartColorsConfig } from "./defaults.mjs";
import { MARKER, formatContrastReportBundle } from "./format-report-html.mjs";
import { formatContrastPreviewBundle } from "./format-report-preview.mjs";
import { DEFAULT_CONFIG_FILE, resolveProjectUrl } from "./load-config.mjs";
import { validateOutputPaths } from "./output-paths.mjs";
import { REPORT_ASSETS, REPORT_ASSET_MARKER, REPORT_DIRECTORY, REPORT_DOCUMENTS } from "./report-paths.mjs";

const DEFAULT_TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const DOCUMENTS = [
  { name: "report", relativePath: REPORT_DOCUMENTS.report, render: formatContrastReportBundle },
  { name: "preview", relativePath: REPORT_DOCUMENTS.preview, render: formatContrastPreviewBundle },
];
const ASSET_PATHS = new Set(Object.values(REPORT_ASSETS));
// Every path this module can publish, whether or not the current call requests it. A palette,
// config or generated output that resolves to one of them is always a mistake, so the guard does
// not depend on the `preview` flag or on a renderer choosing to emit a particular asset. The
// document constants are already relative to the project root; the asset constants are relative
// to the report folder.
const CONTRACT_PATHS = [
  ...Object.values(REPORT_DOCUMENTS),
  ...[...ASSET_PATHS].map((relativePath) => path.join(REPORT_DIRECTORY, relativePath)),
];

/**
 * Write the fixed Smart Colors documents and their relative assets for one snapshot.
 *
 * The report document is always written and keeps its historical return value: the absolute
 * report path. With `preview: true` the compact preview is written in the same call and both
 * absolute paths are returned as `{ reportPath, previewPath }`. Stylesheets and scripts are
 * emitted next to the documents, under the report folder, and are published before the HTML
 * that references them.
 *
 * Every candidate goes through one channel: bundle shape check, ownership marker, protection of
 * the configured paths, refusal of symbolic links in any report-folder ancestor and of
 * hard-linked or unowned target files. Nothing is written until every document and asset has
 * rendered and validated; staging then happens in the target directories before the renames.
 */
export async function writeContrastReport({ root = process.cwd(), report, config, configFile = DEFAULT_CONFIG_FILE, tuningPath = DEFAULT_TUNING_PATH, preview = false }) {
  const documents = preview ? DOCUMENTS : [DOCUMENTS[0]];

  // Render and shape-check everything first: a renderer that returns an unexpected path or an
  // unmarked document must fail before the filesystem is touched.
  const rendered = [];
  for (const document of documents) {
    const bundle = document.render(report);
    rendered.push({ kind: "document", name: document.name, relativePath: document.relativePath, marker: MARKER, content: checkedHtml(bundle, document.name) });
    for (const asset of checkedAssets(bundle, document.name)) rendered.push({ kind: "asset", ...asset });
  }
  const entries = mergeAssets(rendered);

  const protectedPaths = [
    { label: "config.palette", value: config?.palette ?? defaultSmartColorsConfig.palette },
    { label: "config.output", value: config?.output ?? defaultSmartColorsConfig.output },
    { label: "config.motion.output", value: config?.motion?.output ?? defaultSmartColorsConfig.motion.output },
    { label: "tuningPath", value: tuningPath },
  ];
  const reportRoot = fileURLToPath(resolveProjectUrl(root, REPORT_DIRECTORY));
  // Check every ancestor inside the report folder, including styles/ and scripts/, even when the
  // current call requests fewer assets: a redirect there can never be safe for a later write.
  for (const relativePath of CONTRACT_PATHS) await validateDirectoryChain({ root, reportRoot, relativePath });
  const targets = [];
  for (const entry of entries) {
    targets.push({ ...entry, target: await validateDestination({ root, reportRoot, relativePath: entry.relativePath, marker: entry.marker }) });
  }

  // Destination checks run first so a non-directory report folder or a redirected ancestor keeps
  // its own precise error; the collision guard then protects the configured paths.
  await validateProtectedPaths({ root, configFile, protectedPaths });

  // Assets first: an HTML document must never point at a stylesheet or script from an older run.
  // The order is stable inside each group, and staging still precedes every rename. A failure
  // before the renames leaves all pre-existing artifacts untouched; only temporaries created
  // here are removed.
  const temporaryPaths = [];
  try {
    for (const entry of targets) {
      const directory = path.dirname(entry.target);
      await mkdir(directory, { recursive: true });
      const temporaryPath = path.join(directory, `.smart-colors-${entry.name}-${randomUUID()}.tmp`);
      const temporaryFile = await open(temporaryPath, "wx");
      temporaryPaths.push(temporaryPath);
      try {
        await temporaryFile.writeFile(entry.content, "utf8");
      } finally {
        await temporaryFile.close();
      }
    }
    for (const [index, entry] of targets.entries()) await rename(temporaryPaths[index], entry.target);
  } finally {
    for (const temporaryPath of temporaryPaths) await rm(temporaryPath, { force: true });
  }

  const documentTargets = new Map(targets.filter((entry) => entry.kind === "document").map((entry) => [entry.name, entry.target]));
  const reportPath = documentTargets.get("report");
  return preview ? { reportPath, previewPath: documentTargets.get("preview") } : reportPath;
}

async function validateProtectedPaths({ root, configFile, protectedPaths }) {
  for (const relativePath of CONTRACT_PATHS) {
    for (const source of protectedPaths) {
      try {
        // Treat each protected path as a source and the candidate as the only output. Invalid
        // inputs may alias each other; that must not prevent an error report.
        await validateOutputPaths({ root, configFile, config: { palette: source.value, output: relativePath } });
      } catch (cause) {
        throw new Error(`Smart Colors report path validation failed against ${source.label} (${source.value}) or configFile (${configFile}): ${cause.message}`, { cause });
      }
    }
  }
}

function checkedHtml(bundle, name) {
  if (!bundle || typeof bundle.html !== "string" || !bundle.html.startsWith(MARKER)) {
    throw new Error(`Smart Colors ${name} renderer did not return a marked HTML document.`);
  }
  return bundle.html;
}

function checkedAssets(bundle, name) {
  if (bundle.assets === undefined) return [];
  if (!Array.isArray(bundle.assets)) throw new Error(`Smart Colors ${name} renderer did not return an asset list.`);
  return bundle.assets.map((asset) => {
    const relativePath = asset && typeof asset.relativePath === "string" ? asset.relativePath.replaceAll("\\", "/") : null;
    if (!relativePath || !ASSET_PATHS.has(relativePath)) {
      throw new Error(`Smart Colors ${name} renderer returned an undeclared asset path: ${String(asset?.relativePath)}.`);
    }
    if (typeof asset.content !== "string" || !asset.content.startsWith(REPORT_ASSET_MARKER)) {
      throw new Error(`Smart Colors ${name} renderer did not return marked content for ${relativePath}.`);
    }
    return {
      name: path.posix.basename(relativePath, path.posix.extname(relativePath)),
      relativePath: path.join(REPORT_DIRECTORY, relativePath),
      marker: REPORT_ASSET_MARKER,
      content: asset.content,
    };
  });
}

// Two renderers may contribute the same asset path; identical bytes are one file, different bytes
// are an internal contradiction that must not be resolved by silently preferring one of them.
function mergeAssets(rendered) {
  const assets = new Map();
  const documents = [];
  for (const entry of rendered) {
    if (entry.kind === "document") {
      documents.push(entry);
      continue;
    }
    const existing = assets.get(entry.relativePath);
    if (existing && existing.content !== entry.content) {
      throw new Error(`Smart Colors renderers returned conflicting content for asset ${entry.relativePath}.`);
    }
    if (!existing) assets.set(entry.relativePath, entry);
  }
  return [...assets.values(), ...documents];
}

async function entryIfPresent(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return null;
  }
}

async function validateDirectoryChain({ root, reportRoot, relativePath }) {
  const target = fileURLToPath(resolveProjectUrl(root, relativePath));
  // Refuse any symbolic link or non-directory between the report folder and the target; a link in
  // `styles/` or `scripts/` would redirect the write as effectively as one at the target itself.
  const relativeDirectory = path.relative(reportRoot, path.dirname(target));
  if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
    throw new Error(`Smart Colors report path escapes the report directory: ${relativePath}.`);
  }
  for (const directory of [reportRoot, ...pathSegments(reportRoot, relativeDirectory)]) {
    const entry = await entryIfPresent(directory);
    if (!entry) break;
    if (entry.isSymbolicLink()) {
      throw new Error(`Smart Colors report refuses a symbolic link at report directory ${directory}.`);
    }
    if (!entry.isDirectory()) {
      throw new Error(`Smart Colors report directory is not a directory: ${directory}.`);
    }
  }
  return target;
}

async function validateDestination({ root, reportRoot, relativePath, marker }) {
  const target = await validateDirectoryChain({ root, reportRoot, relativePath });

  const existing = await entryIfPresent(target);
  if (!existing) return target;
  if (existing.isSymbolicLink()) {
    throw new Error(`Smart Colors report refuses a symbolic link at report file ${target}.`);
  }
  if (!existing.isFile()) {
    throw new Error(`Smart Colors report refuses a non-regular report file: ${target}.`);
  }
  if (existing.nlink > 1) {
    throw new Error(`Smart Colors report refuses a hard-linked report file: ${target}.`);
  }
  if (!await hasPrefix(target, marker)) {
    throw new Error(`Smart Colors report refuses to overwrite an unowned file at ${target}; expected ${marker} at byte zero.`);
  }
  return target;
}

function pathSegments(base, relativeDirectory) {
  if (!relativeDirectory) return [];
  const segments = [];
  let current = base;
  for (const part of relativeDirectory.split(path.sep)) {
    if (!part || part === ".") continue;
    current = path.join(current, part);
    segments.push(current);
  }
  return segments;
}

async function hasPrefix(filePath, marker) {
  const file = await open(filePath, "r");
  try {
    const prefix = Buffer.alloc(Buffer.byteLength(marker));
    const { bytesRead } = await file.read(prefix, 0, prefix.length, 0);
    return bytesRead === prefix.length && prefix.toString("utf8") === marker;
  } finally {
    await file.close();
  }
}
