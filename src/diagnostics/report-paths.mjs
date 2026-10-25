import { fileURLToPath } from "node:url";
import { DEFAULT_REPORT_DIRECTORY } from "../colors/defaults.mjs";
import { resolveProjectUrl } from "../colors/load-config.mjs";

// The portable default stays the historical folder name. A consumer may override it with the
// additive `reports.directory` config field, resolved from the consumer root by the writer.
export const REPORT_DIRECTORY = DEFAULT_REPORT_DIRECTORY;

export const REPORT_DOCUMENTS = Object.freeze({
  preview: `${REPORT_DIRECTORY}/index.html`,
  report: `${REPORT_DIRECTORY}/report.html`,
});

export const REPORT_ASSETS = Object.freeze({
  previewStyle: "styles/preview.css",
  reportStyle: "styles/report.css",
  previewScript: "scripts/preview.js",
});

export const REPORT_ASSET_MARKER = "/* smart-colors-report:v1 */";

const ABSOLUTE_URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Resolve the configured report directory without touching the filesystem.
 *
 * The field is additive: a legacy config without `reports` keeps the portable default. A configured
 * value is used literally and always resolved from the consumer root by the writer, or taken as an
 * absolute file path / `file:` URL. Remote URLs are rejected because a report must stay local.
 */
export function resolveReportDirectory(config) {
  const reports = config?.reports;
  if (reports === undefined) return REPORT_DIRECTORY;

  const error = reportsConfigError(reports);
  if (error) throw new Error(error);
  return reports.directory;
}

// Absolute filesystem root of the configured report folder. Relative values resolve from the
// consumer root; absolute file paths and `file:` URLs are taken literally. Inputs never resolve
// from here, so a custom report directory can never reinterpret the configured palette/output.
export function resolveReportRoot(root, directory) {
  try {
    return fileURLToPath(resolveProjectUrl(root, directory));
  } catch (cause) {
    const error = new Error(`Smart Colors reports.directory is not a resolvable file path or file: URL: ${directory} (root ${root}).`, { cause });
    error.code = cause.code;
    throw error;
  }
}

function reportsConfigError(reports) {
  if (reports === null || typeof reports !== "object" || Array.isArray(reports)) {
    return `Smart Colors reports must be an object with a non-empty "directory" string; received ${describe(reports)}.`;
  }

  const directory = reports.directory;
  if (typeof directory !== "string" || directory.trim() === "") {
    return `Smart Colors reports.directory must be a non-empty string path relative to the consumer root or an absolute file path; received ${describe(directory)}.`;
  }

  if (ABSOLUTE_URL_SCHEME.test(directory)) {
    let url;
    try {
      url = new URL(directory);
    } catch {
      return `Smart Colors reports.directory is not a valid file path or URL: ${directory}.`;
    }
    if (url.protocol !== "file:") {
      return `Smart Colors reports.directory must be a file path or a file: URL, not a ${url.protocol} URL: ${directory}.`;
    }
  }

  return null;
}

function describe(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}
