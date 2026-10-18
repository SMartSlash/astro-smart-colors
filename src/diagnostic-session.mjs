import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { analyzeColorTokens } from "./generate-colors.mjs";
import { DEFAULT_CONFIG_FILE, loadSmartColorsConfig } from "./load-config.mjs";
import { captureReportInputs, reportSnapshot } from "./report-data.mjs";

const { version: TOOL_VERSION } = createRequire(import.meta.url)("../package.json");

export const DIAGNOSTIC_SESSION_SCHEMA_VERSION = 1;

const AUTOMATION_MODES = new Set(["auto", "off", "required"]);
// Native (browser-free) samples are marked so a consumer can tell them from measured scenarios.
const SAMPLE_PROVENANCE = "model";
const SAMPLE_BROWSER = "model";
const SAMPLE_PREFERENCE = "no-preference";
// Tuning may reference resources the model cannot evaluate; this is a syntax check, not CSS parsing.
const UNSUPPORTED_TUNING = /@import\b|url\(/i;

/**
 * Capture the effective inputs and one coherent analysis into a JSON-only diagnostic session.
 *
 * The selected configuration is either a caller-provided `config` (authoritative, never replaced
 * by the default preset) or loaded from `configFile`; the caller's `inlineConfig` is honored in
 * both cases. The captured palette bytes are the single source of the analysis, so the session,
 * its CSS baseline and its diagnostics all describe the same bytes. `analysis` and `captured`
 * stay Node-only: only `session` is a serializable payload, with no functions and no reference
 * to the checkout.
 */
export async function createDiagnosticSession({ root = process.cwd(), configFile, config, automation = "off", ...analysisOptions } = {}) {
  const { inlineConfig, ...restOptions } = analysisOptions;
  const selected = config
    ? mergeConfigLayers(config, inlineConfig ?? {})
    : await loadStableConfig(root, configFile, inlineConfig ?? {});
  const captured = await captureReportInputs(root, selected, { configFile });
  const paletteCss = captured.inputs.find(([name]) => name === "palette")[2];
  const analysis = await analyzeColorTokens({ root, config: selected, configFile, ...restOptions }, paletteCss);
  const snapshot = await reportSnapshot(root, analysis, captured);
  const tuning = tuningContent(captured);
  const session = {
    ...snapshot,
    schemaVersion: DIAGNOSTIC_SESSION_SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    snapshotId: randomUUID(),
    config: jsonClone(analysis.config),
    inputs: inputDescriptors(captured),
    css: { baseline: analysis.css, tuning, tuningSupport: tuningSupport(tuning) },
    model: { diagnostics: analysis.model.diagnostics, errors: analysis.errors, warnings: analysis.warnings },
    samples: nativeSamples(analysis),
    automation: automationRecord(automation),
  };
  if (session.css.tuningSupport === "unsupported") {
    session.notes.push("Il tuning contiene @import o risorse esterne non supportate: le misure del modello non coprono il tuning attivo.");
  }
  return { session, analysis, captured };
}

/**
 * Assert that every captured input still matches its captured bytes before publication.
 *
 * A source input (palette, config, tuning) that changed always blocks. An output that changed
 * also blocks, unless it was accepted as the intentional output of this analysis: accept the
 * output first with acceptDiagnosticOutput, then call this final check. An output left untouched
 * is allowed through, so a stale-but-stable output stays a declared non-production candidate
 * rather than a silent failure.
 */
export async function assertDiagnosticInputsUnchanged(root, captured) {
  const accepted = captured.acceptedOutputs ?? {};
  for (const [name, file, content, present, sha256] of captured.inputs) {
    const [currentContent, currentPresent, currentSha] = await readInput(root, file, name);
    if (currentContent === content && currentPresent === present && currentSha === sha256) continue;
    if (Object.hasOwn(accepted, name) && accepted[name] === currentSha) continue;
    throw inputsChanged("Smart Colors inputs changed during the report session; no report was published. Rerun with stable inputs.");
  }
}

/**
 * Decide whether the on-disk production outputs are the intentional output of this analysis.
 *
 * Only byte-identical outputs count as accepted, and an accepted run is recorded on the Node-only
 * `captured.acceptedOutputs` baseline so the final assert can allow exactly that write without
 * touching the session `inputDigest`. Absent or different outputs are declared as non-production
 * diagnostic candidates, so a stale or foreign write is never published as the current output.
 * The function returns data; the final exit policy belongs to the caller.
 */
export async function acceptDiagnosticOutput(root, captured, analysis) {
  const capturedHashes = new Map((captured?.inputs ?? []).map(([name, , , , sha256]) => [name, sha256]));
  const outputs = [];
  const candidates = [];
  for (const spec of outputSpecs(captured, analysis)) {
    const [content, present, sha256] = await readInput(root, spec.path, spec.name);
    const matches = present && typeof spec.expected === "string" && content === spec.expected;
    const known = capturedHashes.has(spec.name);
    const changed = known ? capturedHashes.get(spec.name) !== sha256 : null;
    outputs.push({ name: spec.name, path: spec.path, present, matches, sha256, capturedSha256: known ? capturedHashes.get(spec.name) : null, changed });
    if (!matches) candidates.push({ name: spec.name, path: spec.path, present, reason: !present ? "absent" : changed ? "changed" : "differs" });
  }
  if (captured && typeof captured === "object") {
    captured.acceptedOutputs = Object.fromEntries(outputs.filter((output) => output.matches).map((output) => [output.name, output.sha256]));
  }
  return { accepted: outputs.length > 0 && outputs.every((output) => output.matches), outputs, candidates };
}

function outputSpecs(captured, analysis) {
  const specs = [];
  const output = typeof analysis?.config?.output === "string" ? analysis.config.output : captured?.files?.output;
  if (typeof output === "string") specs.push({ name: "output", path: output, expected: analysis?.css });
  const motion = analysis?.config?.motion?.output;
  if (typeof analysis?.motionCss === "string" && typeof motion === "string") specs.push({ name: "motion", path: motion, expected: analysis.motionCss });
  return specs;
}

// Load the config through the loader, but hash the effective file before and after the import so a
// concurrent write cannot silently desync the analysis from the bytes the session captured.
async function loadStableConfig(root, configFile, inlineConfig) {
  const configPath = configFile ?? DEFAULT_CONFIG_FILE;
  const before = await readInput(root, configPath, "config");
  const loaded = await loadSmartColorsConfig({ root, configFile, inlineConfig });
  const after = await readInput(root, configPath, "config");
  if (!sameRead(before, after)) {
    throw inputsChanged("Smart Colors config changed while it was being imported; no session was created. Rerun with stable inputs.");
  }
  return loaded;
}

function inputDescriptors(captured) {
  return captured.inputs.map(([name, file, , present, sha256]) => ({ name, path: file, present, sha256 }));
}

function tuningContent(captured) {
  const tuning = captured.inputs.find(([name]) => name === "tuning");
  return tuning?.[3] ? tuning[2] : null;
}

// "absent" is valid; "unsupported" is explicit so an unevaluated tuning is never read as a pass.
function tuningSupport(content) {
  if (content === null) return "absent";
  const active = content.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
  return UNSUPPORTED_TUNING.test(active) ? "unsupported" : "supported";
}

function jsonClone(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

// Browser-free samples derived from the generator model, in the report diagnostic shape
// (provenance "model", browser "model"), so a report can build its atlas without Playwright.
function nativeSamples(analysis) {
  const diagnostics = Array.isArray(analysis?.model?.diagnostics) ? analysis.model.diagnostics : [];
  const byScheme = new Map();
  for (const item of diagnostics) {
    if (!item || typeof item !== "object" || !["light", "dark"].includes(item.scheme)) continue;
    const group = byScheme.get(item.scheme) ?? [];
    group.push({
      label: item.label, scheme: item.scheme, browser: SAMPLE_BROWSER, preference: SAMPLE_PREFERENCE,
      provenance: SAMPLE_PROVENANCE,
      foregroundToken: item.foregroundToken, backgroundToken: item.backgroundToken,
      foreground: { ...item.foreground }, background: { ...item.background },
      ratio: item.ratio, target: item.target, minimum: item.minimum, kind: item.kind, status: item.status,
    });
    byScheme.set(item.scheme, group);
  }
  return ["light", "dark"].filter((scheme) => byScheme.has(scheme)).map((scheme) => ({
    browser: SAMPLE_BROWSER, scheme, preference: SAMPLE_PREFERENCE, provenance: SAMPLE_PROVENANCE,
    diagnostics: byScheme.get(scheme),
  }));
}

// Structured placeholder for the VerificationRun contract: SC-05/SC-08 fill measurements and the
// resolved contract once the automation adapter exists. No Playwright is resolved here.
function automationRecord(mode) {
  const resolved = AUTOMATION_MODES.has(mode) ? mode : "off";
  return {
    provenance: "model",
    mode: resolved,
    status: resolved === "off" ? "disabled" : "pending",
    expected: { scenarios: [], pairs: [] },
    executed: { scenarios: [], pairs: [] },
    measurements: [],
    errors: [],
    environment: null,
    measuredAt: null,
  };
}

// Minimal private duplicate of the loader's deep merge, used only to layer inlineConfig over an
// already-resolved config so the option is not silently ignored. The file path keeps using the
// loader itself, so normalization stays owned by load-config.
function mergeConfigLayers(base, override) {
  if (!isPlainObject(override)) return override === undefined ? base : override;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (key === "aliases" && isPlainObject(value)) output[key] = { ...value };
    else if (isPlainObject(value) && isPlainObject(output[key])) output[key] = mergeConfigLayers(output[key], value);
    else output[key] = value;
  }
  return output;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readInput(root, file, name) {
  try {
    const bytes = await readFile(path.resolve(root, file));
    return [bytes.toString("utf8"), true, createHash("sha256").update(bytes).digest("hex")];
  } catch (error) {
    if (error.code === "ENOENT") return ["", false, null];
    const wrapped = new Error(`Smart Colors input ${name ? `"${name}"` : file} is unreadable at ${file}: ${error.message}`, { cause: error });
    wrapped.code = "SMART_COLORS_INPUT_UNREADABLE";
    throw wrapped;
  }
}

function sameRead(first, second) {
  return first[0] === second[0] && first[1] === second[1] && first[2] === second[2];
}

function inputsChanged(message) {
  const error = new Error(message);
  error.code = "SMART_COLORS_INPUTS_CHANGED";
  return error;
}
