import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { analyzeColorTokens } from "../colors/generate-colors.mjs";
import { DEFAULT_CONFIG_FILE, loadSmartColorsConfig, paletteNotFoundError } from "../colors/load-config.mjs";
import { parsePaletteWithDiagnostics } from "../colors/parse-palette.mjs";
import { captureReportInputs, reportSnapshot } from "./report-data.mjs";

const { version: TOOL_VERSION } = createRequire(import.meta.url)("../../package.json");

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
  const paletteInput = captured.inputs.find(([name]) => name === "palette");
  // A missing palette is named explicitly (path/root/configFile) before any analysis: an empty
  // read would otherwise surface as contract errors about canvas/ink instead of a clear diagnosis.
  if (paletteInput && paletteInput[3] === false) {
    throw paletteNotFoundError({ palettePath: captured.files.palette, root, configFile });
  }
  const paletteCss = paletteInput[2];
  // The palette source contract is built from the already-captured bytes (never a second read) so
  // the session, its raw CSS and its per-token sources describe the same bytes the analysis saw.
  const paletteSource = paletteSourceContract(paletteCss, captured.files.palette, paletteInput[4]);
  const analysis = await analyzeColorTokens({ root, config: selected, configFile, ...restOptions }, paletteCss);
  const snapshot = await reportSnapshot(root, analysis, captured);
  const tuning = tuningContent(captured);
  const session = {
    ...snapshot,
    schemaVersion: DIAGNOSTIC_SESSION_SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    snapshotId: randomUUID(),
    config: jsonClone(analysis.config),
    // Additive source contract only. It never supersedes the legacy `snapshot.palette` array: report
    // validation, the palette gallery and the proposal/variant views keep reading `session.palette`.
    paletteSource,
    inputs: inputDescriptors(captured),
    css: applyDiagnosticOutput({ css: { tuning, tuningSupport: tuningSupport(tuning) } }, analysis, captured),
    model: { diagnostics: analysis.model.diagnostics, errors: analysis.errors, warnings: analysis.warnings },
    samples: nativeSamples(analysis),
    automation: automationRecord(automation),
  };
  // `design` is owned by another module; forwarded verbatim when the analysis carries it.
  if (analysis && analysis.design !== undefined) session.design = jsonClone(analysis.design);
  if (session.css.tuningSupport === "unsupported") {
    session.notes.push("Il tuning contiene @import o risorse esterne non supportate: le misure del modello non coprono il tuning attivo.");
  }
  if (session.css.status === "empty") {
    session.notes.push("L'output colore su disco è vuoto: nessun byte utilizzabile. Il candidato generato non viene mai sostituito e le misure restano non attendibili.");
  }
  if (session.css.baselineSupport === "unsupported" && session.css.status !== "empty") {
    session.notes.push("Il CSS baseline (output reale) contiene @import o risorse esterne non supportate: gli scenari non saranno misurati.");
  }
  return { session, analysis, captured };
}

/**
 * Derive the additive `session.css` descriptor that separates the expected CSS from the measured one.
 *
 * `generated` is always the model output (`analysis.css`), never read from disk. `baseline` is the
 * actual captured output bytes when the file is present (even when empty), otherwise the declared
 * generated candidate — a present-but-empty output is never replaced by `generated`. `production`
 * is true only when the on-disk output is the accepted, byte-identical production output (the caller's
 * `acceptance.outputs` entry for `output` is honored when present, so a rejected sibling never blesses
 * the CSS). `digest`
 * gives the stable identity of both byte strings; `baselineSupport` is `unsupported` for an empty
 * or `@import`/`url()`-referencing baseline, so it can never be read as a green pass. When `written`
 * is provided (a `build` after its intentional write), the new bytes are the measured baseline.
 * The helper only reads `captured.acceptedOutputs` semantics; it never writes CSS or inputs.
 */
export function applyDiagnosticOutput(session, analysis, captured, acceptance, options = {}) {
  const generated = typeof analysis?.css === "string" ? analysis.css : "";
  const written = options.written;
  let baseline;
  let source;
  let status;
  if (typeof written === "string") {
    baseline = written;
    source = "output";
    status = baseline === generated ? "current" : "stale";
  } else {
    const input = Array.isArray(captured?.inputs) ? captured.inputs.find(([name]) => name === "output") : null;
    const present = Boolean(input && input[3]);
    const bytes = present && typeof input[2] === "string" ? input[2] : "";
    if (!present) {
      baseline = generated;
      source = "generated-candidate";
      status = "absent";
    } else if (bytes.replace(/\s+/g, "") === "") {
      baseline = bytes;
      source = "output";
      status = "empty";
    } else {
      baseline = bytes;
      source = "output";
      status = bytes === generated ? "current" : "stale";
    }
  }
  const base = session && typeof session.css === "object" && session.css !== null ? session.css : {};
  const acceptedOutput = acceptance && Array.isArray(acceptance.outputs)
    ? acceptance.outputs.find((output) => output && output.name === "output")
    : null;
  const acceptedByOutput = acceptedOutput ? acceptedOutput.matches === true : null;
  const descriptor = {
    ...base,
    generated,
    baseline,
    source,
    status,
    production: source === "output" && status === "current" && acceptedByOutput !== false,
    digest: { generated: sha256Hex(generated), baseline: baseline === "" ? null : sha256Hex(baseline) },
    baselineSupport: baseline === "" || scanUnsupported(baseline) ? "unsupported" : "supported",
  };
  if (session && typeof session === "object") session.css = descriptor;
  return descriptor;
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

// ---------------------------------------------------------------------------
// Palette source contract: the exact captured bytes plus one source per authored token.
// ---------------------------------------------------------------------------

// Length-preserving comment removal: every comment character except line breaks becomes a space,
// so a position in the stripped text maps 1:1 onto the authored bytes. This mirrors the parser's
// own stripping (parse-palette) so the contract describes exactly the bytes the parser evaluated.
function stripCommentsInPlace(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The whole `@property --token { ... }` block for a typed palette, sliced from the original bytes.
// Returns the exact declaration span and the exact `initial-value` color span, or null.
function locatePropertyBlock(stripped, key) {
  const block = new RegExp(`@property\\s+--${escapeRegExp(key)}\\s*\\{([^}]*)\\}`, "di").exec(stripped);
  if (!block) return null;
  const bodyStart = block.indices[1][0];
  const initial = /initial-value:\s*(oklch\([^;]*\))\s*(?:;|$)/di.exec(stripped.slice(bodyStart, block.indices[1][1]));
  if (!initial) return null;
  return {
    value: [bodyStart + initial.indices[1][0], bodyStart + initial.indices[1][1]],
    declaration: [block.indices[0][0], block.indices[0][1]],
  };
}

// Legacy `--token: oklch(...);` declarations. The last declaration wins, matching parse-palette's
// overwrite-on-duplicate behavior for the legacy syntax. A legacy palette has no @property block,
// so nothing is invented: `declaration` stays null and only the exact value text is retained.
function locateLegacyDeclaration(stripped, key) {
  const pattern = new RegExp(`(?<![\\w-])--${escapeRegExp(key)}\\s*:\\s*(oklch\\([^;]*\\))\\s*;`, "dgi");
  let span = null;
  let match;
  while ((match = pattern.exec(stripped))) span = match.indices[1];
  return span ? { value: [span[0], span[1]], declaration: null } : null;
}

// Build the additive `session.paletteSource` contract from captured bytes: the full raw CSS for a
// static export, the source path and SHA-256, and one source per authored token in authored order
// (unique). It is purely additive and never replaces the legacy `session.palette` array.
function paletteSourceContract(css, file, sha256) {
  const stripped = stripCommentsInPlace(css);
  const parsed = parsePaletteWithDiagnostics(css);
  const propertyMode = /@property\s+--/i.test(stripped);
  const sources = Object.keys(parsed.authoredTokens).map((key) => {
    const located = propertyMode ? locatePropertyBlock(stripped, key) : locateLegacyDeclaration(stripped, key);
    return {
      token: `--${key}`,
      value: located ? css.slice(located.value[0], located.value[1]) : null,
      role: Object.hasOwn(parsed.annotatedRoles, key) ? parsed.annotatedRoles[key] : null,
      darkBlend: Object.hasOwn(parsed.annotatedDarkBlends, key) ? parsed.annotatedDarkBlends[key] : null,
      declaration: located && located.declaration ? css.slice(located.declaration[0], located.declaration[1]) : null,
    };
  });
  return { css, path: file, sha256: typeof sha256 === "string" ? sha256 : null, sources };
}

function tuningContent(captured) {
  const tuning = captured.inputs.find(([name]) => name === "tuning");
  return tuning?.[3] ? tuning[2] : null;
}

// "absent" is valid; "unsupported" is explicit so an unevaluated tuning is never read as a pass.
function tuningSupport(content) {
  if (content === null) return "absent";
  return scanUnsupported(content) ? "unsupported" : "supported";
}

// Conservative syntax scan shared by the tuning state and the baseline support: `@import`/`url()`
// inside a comment never counts, anything else that references an external resource is flagged.
function scanUnsupported(css) {
  const active = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
  return UNSUPPORTED_TUNING.test(active);
}

function sha256Hex(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
