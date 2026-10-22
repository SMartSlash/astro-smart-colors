import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSmartColorsConfig } from "./defaults.mjs";
import { analyzeColorTokens } from "./generate-colors.mjs";
import { clamp, contrast, fitToSrgb, mixOklch, oklch, serializedColor } from "./color-math.mjs";
import { nearestLightness, resolvedColor, sourceColorValue } from "./contrast-advice.mjs";
import { resolveProjectUrl } from "./load-config.mjs";
import { parsePaletteWithDiagnostics, tokenKey } from "./parse-palette.mjs";
import { agree, compactRatio, list, prepareContrastReport } from "./format-report-html.mjs";

export const REPORT_FILES = {
  palette: "src/styles/tokens/palette.css", config: "smart-colors.config.mjs",
  tuning: "src/styles/tokens/colors-tuning.css", output: "src/styles/tokens/colors.css",
};

/** Follow the palette directory for the authored tuning file when it moved there. */
export async function resolveTuningFile(root, config) {
  const palette = typeof config?.palette === "string" ? config.palette : null;
  if (palette === null) return REPORT_FILES.tuning;

  const candidate = path.posix.join(path.posix.dirname(palette.replaceAll("\\", "/")), "colors-tuning.css");
  if (candidate !== REPORT_FILES.tuning
    && !await pathExists(resolveProjectUrl(root, REPORT_FILES.tuning))
    && await pathExists(resolveProjectUrl(root, candidate))) {
    return candidate;
  }

  return REPORT_FILES.tuning;
}

async function pathExists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Read-only tuning status for CLI blocks; it never throws and never changes exit codes. */
export async function inspectTuningStatus(root, config) {
  let tuningPath = REPORT_FILES.tuning;

  try {
    tuningPath = await resolveTuningFile(root, config);
    const css = await readFile(resolveProjectUrl(root, tuningPath), "utf8");
    const activeCount = (css.replace(/\/\*[\s\S]*?\*\//g, "").match(/--[a-z0-9_-]+\s*:/gi) ?? []).length;

    if (activeCount === 0) {
      return { path: tuningPath, exists: true, activeCount, summary: "presente, nessun override attivo (verificato da audit/report)" };
    }

    return {
      path: tuningPath,
      exists: true,
      activeCount,
      summary: `presente, ${activeCount} ${activeCount === 1 ? "override attivo" : "override attivi"} (verificati da audit/report)`,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { path: tuningPath, exists: false, activeCount: 0, summary: "non presente (opzionale)" };
    return { path: tuningPath, exists: false, activeCount: 0, summary: "non leggibile (stato non verificato)" };
  }
}

/** Same integrity gates and grouping as the HTML; presentation only, no new measurements. */
export function formatReportSummary(snapshot) {
  const { verified, groups, complete, tuningGroups, entries, scenarios } = prepareContrastReport(snapshot);
  if (!verified) return "Esito non verificato o incompleto. Nessuna correzione consigliata: consulta gli errori nell’anteprima e rigenera il report dopo averli risolti.";
  const belowMinimum = groups.filter((group) => group[0].item.status === "below-minimum");
  const belowTarget = groups.filter((group) => group[0].item.status === "below-target");
  const lines = [
    groups.length
      ? `${groups.length} ${agree(groups.length, "problema distinto", "problemi distinti")}: ${belowMinimum.length} sotto il minimo · ${belowTarget.length} sotto il target.`
      : "Nessun problema nelle coppie misurate. Non è una certificazione dell’interfaccia completa.",
    `${entries.length} ${agree(entries.length, "misura", "misure")} in ${scenarios.length} ${agree(scenarios.length, "scenario", "scenari")} · ${complete.length} ${agree(complete.length, "correzione verificata", "correzioni verificate")}.`,
  ];
  // compactRatio escapes '<' for HTML; the terminal needs the literal threshold marker.
  const ratio = (value, thresholds = []) => compactRatio(value, thresholds).replace("&lt;", "<");
  for (const group of [...belowMinimum, ...belowTarget]) {
    const { item } = group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst);
    lines.push(`${item.status === "below-minimum" ? "SOTTO MINIMO" : "SOTTO TARGET"} · ${item.scheme === "light" ? "chiaro" : "scuro"} · ${item.foregroundToken} su ${item.backgroundToken}: ${ratio(item.ratio, [item.minimum, item.target])} (minimo ${ratio(item.minimum)}, target ${ratio(item.target)}).`);
  }
  if (groups.length) lines.push("Sotto minimo: evita la coppia per l’uso indicato. Sotto target: il minimo è rispettato, ma manca il margine scelto dal progetto.");
  if (tuningGroups.length) lines.push(`Per ${tuningGroups.length} ${agree(tuningGroups.length, "problema", "problemi")} la baseline rispettava le soglie; il calo compare con i tuning attivi. Non richiede necessariamente di cambiare palette.`);
  if (groups.length && !complete.length) lines.push("Nessun candidato verificato disponibile: non viene proposta una modifica non confermata.");
  if (complete.length) lines.push("Le correzioni sono opzioni manuali, verificate separatamente: file e frammenti da modificare sono nell’anteprima.");
  const paletteRejections = list(snapshot?.rejectedSources).filter((entry) => entry && typeof entry.reason === "string" && entry.file === REPORT_FILES.palette);
  if (paletteRejections.length) lines.push(`Nessuna alternativa verificata in palette.css: ${paletteRejections[0].reason}.`);
  lines.push("La palette resta la scelta del designer: questi esiti riguardano gli abbinamenti e il loro uso, non il valore estetico dei colori.");
  return lines.join("\n");
}

async function optionalRead(file, name) {
  try {
    const bytes = await readFile(file);
    return [bytes.toString("utf8"), true, createHash("sha256").update(bytes).digest("hex")];
  } catch (error) {
    if (error.code === "ENOENT") return ["", false, null];
    // An existing but unreadable input is not the same as a missing one: naming it
    // keeps the failure explicit instead of degrading to a valid absence.
    const wrapped = new Error(`Smart Colors input ${name ? `"${name}"` : file} is unreadable at ${file}: ${error.message}`, { cause: error });
    wrapped.code = "SMART_COLORS_INPUT_UNREADABLE";
    throw wrapped;
  }
}

export async function captureReportInputs(root, config, options = {}) {
  // The effective config file must be captured as-is: the default name may not stand in for a
  // caller-provided --config. The option is additive so existing two-argument callers keep the
  // legacy default path. The motion output is captured even while disabled: it is a protected
  // production output, not an optional extra.
  const configFile = options.configFile ?? REPORT_FILES.config;
  const files = {
    ...REPORT_FILES,
    config: configFile,
    ...(config ? { palette: config.palette, output: config.output } : {}),
    tuning: await resolveTuningFile(root, config),
    motion: config?.motion?.output ?? defaultSmartColorsConfig.motion.output,
  };
  const inputs = await Promise.all(Object.entries(files).map(async ([name, file]) => [name, file, ...await optionalRead(reportInputUrl(root, name, file), name)]));
  return { files, inputs };
}

// A report input is a project-relative path string: validate its type before the shared resolver
// turns it into a URL, so a bad config fails with the input name instead of a path TypeError.
function reportInputUrl(root, name, file) {
  if (typeof file !== "string" || file.trim() === "") {
    const received = file === "" ? "an empty string" : file === null ? "null" : typeof file;
    const error = new Error(`Smart Colors report input ${name} must be a non-empty project-relative path, received ${received}.`);
    error.code = "SMART_COLORS_INPUT_INVALID";
    throw error;
  }
  return resolveProjectUrl(root, file);
}

export async function assertReportInputsUnchanged(root, captured) {
  const current = await Promise.all(captured.inputs.map(async ([name, file]) => [name, file, ...await optionalRead(reportInputUrl(root, name, file), name)]));
  if (JSON.stringify(current) !== JSON.stringify(captured.inputs)) {
    const error = new Error("Smart Colors inputs changed during the report session; no report was published. Rerun with stable inputs.");
    error.code = "SMART_COLORS_INPUTS_CHANGED";
    throw error;
  }
}

export async function reportSnapshot(root, analysis, captured) {
  const { files, inputs } = captured ?? await captureReportInputs(root, analysis?.config);
  const inputDigest = createHash("sha256").update(JSON.stringify([inputs, analysis?.config ?? null])).digest("hex");
  const parsed = parsePaletteWithDiagnostics(inputs.find(([name]) => name === "palette")[2]);
  return {
    generatedAt: new Date().toISOString(), inputDigest, files,
    palette: Object.entries(parsed.authoredTokens).map(([key, authored]) => ({
      name: `--${key}`, role: parsed.annotatedRoles?.[key] ?? configuredRole(analysis?.config, key),
      authored, resolved: parsed.tokens[key], darkBlend: parsed.annotatedDarkBlends?.[key],
    })),
    // Public identity sources: lets the report compare a functional variant with its brand color.
    roles: {
      identities: Object.entries(analysis?.config?.roles?.identities ?? {}).map(([name, definition]) => ({
        name, role: typeof definition?.role === "string" ? definition.role : null,
        token: typeof definition?.token === "string" ? definition.token : null,
        paletteName: typeof definition?.token === "string" ? `--${tokenKey(definition.token)}` : null,
      })),
    },
    scenarios: [], overlaps: [], proposals: [], generationErrors: analysis?.errors ?? [], auditErrors: [], notes: [], rejectedSources: [],
  };
}

function configuredRole(config, key) {
  if (!config) return "Non verificato";
  for (const role of ["canvas", "ink"]) {
    if (typeof config.roles?.[role] === "string" && tokenKey(config.roles[role]) === key) return role;
  }
  for (const [group, fallback] of [["identities", "ui"], ["decoratives", "decorative"]]) {
    for (const definition of Object.values(config.roles?.[group] ?? {})) {
      const token = typeof definition === "string" ? definition : definition?.token;
      if (typeof token === "string" && tokenKey(token) === key) return definition.role ?? fallback;
    }
  }
  return "Non assegnato";
}

export function reportScenario(browser, scheme, preference, rows, baseline = [], provenance = "browser-after-tuning") {
  return {
    browser, scheme, preference, provenance,
    diagnostics: rows.map((pair) => ({
      label: pair.label, scheme, browser, preference, provenance,
      foregroundToken: pair.foreground, backgroundToken: pair.background,
      foreground: pair.foregroundColor, background: pair.backgroundColor,
      ratio: pair.ratio, target: pair.target, minimum: pair.minimum,
      kind: ["ui", "family-ui"].includes(pair.kind) ? "non-text" : "text", status: pair.status,
      ...(baseline.length ? { baselineRatio: baseline.find((item) => item.label === pair.label)?.ratio } : {}),
    })),
  };
}

// Exploratory ratios from opaque browser-resolved tokens, not screenshot pixels
// or actual component usage. Keep these diagnostics separate from audited pairs.
export function reportOverlapScenario(browser, scheme, preference, tokens, names) {
  if (!["chromium", "firefox", "webkit"].includes(browser)) throw new Error("Report overlap browser must be chromium, firefox or webkit.");
  if (!["light", "dark"].includes(scheme)) throw new Error("Report overlap scheme must be light or dark.");
  if (!["light", "dark"].includes(preference)) throw new Error("Report overlap preference must be light or dark.");
  if (!(tokens instanceof Map)) throw new Error("Report overlap tokens must be a Map of resolved OKLCH colors.");
  if (!Array.isArray(names)) throw new Error("Report overlap names must be an array of identity/decorative names.");
  const uniqueNames = [...new Set(names)];
  for (const name of uniqueNames) {
    if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name) || ["bg", "surface"].includes(name)) {
      throw new Error(`Report overlap name ${String(name)} is invalid; expected an identity/decorative name distinct from bg and surface.`);
    }
  }
  const foregroundTokens = uniqueNames.map((name) => `--color-${name}`);
  const backgrounds = ["--color-bg", "--color-surface"];
  const colors = new Map();
  for (const token of [...backgrounds, ...foregroundTokens]) {
    const color = tokens.get(token);
    if (!color || typeof color !== "object" || Array.isArray(color)
      || !Number.isFinite(color.l) || color.l < 0 || color.l > 1
      || !Number.isFinite(color.c) || color.c < 0 || !Number.isFinite(color.h)) {
      throw new Error(`Report overlap ${browser}/${scheme}/${preference} ${token}: missing or invalid resolved OKLCH color; expected finite l in [0, 1], c >= 0 and finite h.`);
    }
    colors.set(token, { l: color.l, c: color.c, h: color.h });
  }
  const rows = [];
  const add = (foreground, background) => {
    const foregroundColor = colors.get(foreground), backgroundColor = colors.get(background);
    const ratio = contrast(foregroundColor, backgroundColor);
    if (!Number.isFinite(ratio) || ratio < 1 || ratio > 21) {
      throw new Error(`Report overlap ${browser}/${scheme}/${preference} ${foreground} on ${background}: invalid contrast ratio ${ratio}; expected a finite ratio in [1, 21].`);
    }
    rows.push({ label: `${scheme} ${foreground} on ${background}`, foreground, background,
      foregroundColor, backgroundColor, ratio, kind: "text", target: 4.5, minimum: 4.5,
      status: ratio >= 4.5 ? "pass" : "below-minimum" });
  };
  for (const foreground of foregroundTokens) {
    for (const background of backgrounds) add(foreground, background);
  }
  for (let first = 0; first < foregroundTokens.length; first += 1) {
    for (let second = first + 1; second < foregroundTokens.length; second += 1) add(foregroundTokens[first], foregroundTokens[second]);
  }
  return reportScenario(browser, scheme, preference, rows, [], "browser-resolved-overlap");
}

export function proposalImproves(before, after, issueLabels) {
  if (!issueLabels.length || before.length !== after.length) return false;
  let improved = false;
  const unresolved = new Set(issueLabels);
  for (let index = 0; index < before.length; index += 1) {
    const a = before[index], b = after[index];
    if (a.label !== b.label || !Number.isFinite(b.ratio)) return false;
    if ((a.status === "pass" && b.status !== "pass") || (a.status !== "below-minimum" && b.status === "below-minimum")) return false;
    if (issueLabels.includes(a.label) && a.status !== "pass") {
      if (b.status !== "pass") return false;
      improved = true;
      unresolved.delete(a.label);
    }
  }
  return improved && unresolved.size === 0;
}

// `--color-tune-<id>-dark` is the escape hatch shared by the dark fill and the
// family border alias, so it moves the `--color-<id>-border` pairs on both
// neutral surfaces (`--color-bg` and `--color-surface`) that the audit
// deliberately leaves unmeasured. The comparisons built below are published as
// information only: they never feed verified, checks, issue labels, counts,
// filters or the exit code.
const DARK_FILL_TUNING_PATH = /^--color-tune-([a-z0-9-]+)-dark$/;

export function darkFillTuningIdentity(destination) {
  if (!destination || typeof destination.path !== "string") return null;
  return DARK_FILL_TUNING_PATH.exec(destination.path)?.[1] ?? null;
}

function sideEffectColor(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Number.isFinite(value.l) && value.l >= 0 && value.l <= 1
    && Number.isFinite(value.c) && value.c >= 0 && Number.isFinite(value.h)
    ? { l: value.l, c: value.c, h: value.h } : null;
}

// The two neutral surfaces the border alias can sit on, named like the audit
// pair vocabulary; any other background has no measured side-effect meaning.
const SIDE_EFFECT_BACKGROUNDS = new Map([["--color-bg", "canvas"], ["--color-surface", "surface"]]);

// The two light neutrals whose derivation follows the canvas: --color-bg is the
// canvas itself and --color-surface sits a measured lightness shift from it.
const NEUTRAL_BACKGROUNDS = new Set(["--color-bg", "--color-surface"]);

// Invalid or unavailable measurements yield null: the report never invents a
// side-effect color or ratio, and full precision is preserved end to end.
export function reportSideEffect(identity, before, after, backgroundToken = "--color-bg") {
  const backgroundName = SIDE_EFFECT_BACKGROUNDS.get(backgroundToken);
  if (!backgroundName) return null;
  const beforeColor = sideEffectColor(before?.color), beforeBackground = sideEffectColor(before?.background);
  const afterColor = sideEffectColor(after?.color), afterBackground = sideEffectColor(after?.background);
  if (!beforeColor || !beforeBackground || !afterColor || !afterBackground) return null;
  const beforeRatio = contrast(beforeColor, beforeBackground);
  const afterRatio = contrast(afterColor, afterBackground);
  const ratioOk = (ratio) => Number.isFinite(ratio) && ratio >= 1 && ratio <= 21;
  if (!ratioOk(beforeRatio) || !ratioOk(afterRatio)) return null;
  return {
    label: `dark ${identity}-border / ${backgroundName}`, scheme: "dark",
    foregroundToken: `--color-${identity}-border`, backgroundToken,
    before: { color: beforeColor, ratio: beforeRatio },
    after: { color: afterColor, ratio: afterRatio },
    provenance: "browser-proposal-side-effect",
  };
}

// One comparison per (identity, background): across theme preferences and
// browsers the worst available after state is kept, so the card cannot
// understate the side effect on a measured neutral.
export function worstSideEffect(previous, incoming) {
  if (!previous) return incoming ?? null;
  if (!incoming) return previous;
  return incoming.after.ratio < previous.after.ratio ? incoming : previous;
}

// Aggregation keyed by (identity, background): each measured neutral keeps its
// own worst after state, so the published list carries one entry per background
// and a worse neutral never replaces the other one.
export function mergeSideEffect(entries, incoming) {
  const same = entries.find((entry) => entry.foregroundToken === incoming.foregroundToken && entry.backgroundToken === incoming.backgroundToken);
  if (!same) return [...entries, incoming];
  return entries.map((entry) => entry === same ? worstSideEffect(entry, incoming) : entry);
}

// Final published shape: verification facts exactly as measured, internal
// fields stripped, and the side-effect comparisons attached only when they
// exist for a dark-fill tuning destination.
export function publishedProposal(candidate, result) {
  const { css, tuningCss, ...proposal } = candidate;
  const applicable = darkFillTuningIdentity(candidate.destination) !== null;
  const sideEffects = applicable && Array.isArray(result?.sideEffects) ? result.sideEffects : [];
  // A structural proposal carries no modelled change: the tokens the generator
  // recomputes are reported from the browser measurement itself.
  const measured = Array.isArray(result?.changes) ? result.changes : [];
  const changes = proposal.changes?.length ? proposal.changes : measured;
  return { ...proposal, verified: true, checks: result.checks, ...(changes.length ? { changes } : {}), ...(sideEffects.length ? { sideEffects } : {}) };
}

// Preserve comments and selector scope. Ambiguous repeated declarations require
// a human choice rather than a proposal tested under a different cascade.
// A token outside the custom-property grammar is never matched as a regex: an
// unescaped metacharacter would corrupt or retarget another declaration.
function isTuningToken(token) {
  return typeof token === "string" && /^--[a-z0-9-]+$/.test(token);
}

export function replaceTuningDeclaration(css, token, value) {
  if (!isTuningToken(token)) return null;
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
  const pattern = new RegExp(`(^|[;{]\\s*)(${escapeRegExp(token)}\\s*:\\s*)([^;}]+)(?=;)`, "gm");
  const matches = [...uncommented.matchAll(pattern)];
  if (matches.length > 1) return null;
  if (!matches.length) return `${css}\n:root { ${token}: ${value}; }\n`;
  const match = matches[0];
  const start = match.index + match[1].length + match[2].length;
  return css.slice(0, start) + value + css.slice(start + match[3].length);
}

// Same active-declaration rule as replaceTuningDeclaration: comments are inert
// and a duplicated declaration is ambiguous, so the reader stays silent too.
function readTuningDeclaration(css, token) {
  if (!isTuningToken(token)) return null;
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
  const pattern = new RegExp(`(^|[;{]\\s*)(${escapeRegExp(token)}\\s*:\\s*)([^;}]+)(?=;)`, "gm");
  const matches = [...uncommented.matchAll(pattern)];
  return matches.length === 1 ? matches[0][3].trim() : null;
}

// The dark neutral knobs are emitted percentages: only an active two-decimal
// percentage is measurable, anything else is left to a human decision.
function tuningPercentage(css, token) {
  const value = readTuningDeclaration(css, token);
  const match = value === null ? null : /^(\d+(?:\.\d+)?)%$/.exec(value);
  return match ? Number(match[1]) : null;
}

// The percentage grid the tuning contract emits, nearest to the active value
// first, mirroring nearestLightness' distance ordering on an editable grid.
function nearestTuningPercentage(current, accepts) {
  const candidates = Array.from({ length: 10001 }, (_, index) => index / 100)
    .sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
  for (const value of candidates) if (accepts(value)) return value;
  return null;
}

// Same safety margin as the light surface search: a proposal must clear the
// direct pairs, not sit on their threshold.
function directMargin(pair) {
  return Math.min(21, Math.max(pair.minimum, pair.target) + 0.02);
}

function percentageValue(value) {
  return `${Number(value.toFixed(2))}%`;
}

function sameColor(first, second) {
  return Boolean(first && second) && first.l === second.l && first.c === second.c && first.h === second.h;
}

// Build-time home of each tuning knob. colors-tuning.css overrides the emitted
// value at runtime, while the generator keeps deriving its text tokens from the
// configured one: promoting the runtime value here is the structural alternative.
const TUNING_CONFIG_KEYS = new Map([
  ["--color-tune-surface-lightness-shift", "derivation.surface.lightShift"],
  ["--color-tune-dark-bg-mix", "derivation.dark.bgMixRatio"],
  ["--color-tune-dark-surface-mix", "derivation.dark.surfaceMixRatio"],
  ["--color-tune-dark-text-mix", "derivation.dark.textMixRatio"],
]);

// Absent, malformed or non-numeric paths stay null: the report never invents a
// build-time value, and an unknown one suppresses the structural sibling.
export function readConfigValue(config, key) {
  const value = key.split(".").reduce((node, part) => node && typeof node === "object" ? node[part] : undefined, config);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Copy-on-write: the inspected configuration object is never mutated.
export function withConfigValue(config, key, value) {
  const clone = structuredClone(config);
  const parts = key.split(".");
  const last = parts.pop();
  let node = clone;
  for (const part of parts) {
    if (!node[part] || typeof node[part] !== "object") node[part] = {};
    node = node[part];
  }
  node[last] = value;
  return clone;
}

// A mergeable configuration fragment, never a whole replacement file.
export function configSnippet(configKey, value) {
  const parts = configKey.split(".");
  const last = parts.pop();
  return parts.reduceRight((inner, part) => `${part}: { ${inner} }`, `${last}: ${String(Number(value))}`);
}

// The causal explanation owed to the designer when palette regeneration cannot
// help: the runtime override stays in force and leaves the text tokens at the
// values the generator computed for the configured shift.
export function paletteOverrideNote(analysis, tuningCss) {
  const knob = "--color-tune-surface-lightness-shift";
  const active = tuningShift(tuningCss, knob);
  const configured = readConfigValue(analysis.config, "derivation.surface.lightShift");
  if (active === null || configured === null || active === configured) return "";
  return `; l'override runtime ${knob}: ${active} resta in vigore e lascia i token testo ai valori calcolati per ${configured}`;
}

// The emitted form of a knob value: the light shift is a signed decimal, the
// dark neutral knobs are percentages.
function formatTuningValue(knob, value) {
  return knob === "--color-tune-surface-lightness-shift" ? String(Number(value)) : percentageValue(value);
}

// Signed decimal of the light-surface knob (e.g. "-0.028").
function tuningShift(css, token) {
  const value = readTuningDeclaration(css, token);
  const match = value === null ? null : /^-?\d+(?:\.\d+)?$/.exec(value);
  return match ? Number(match[0]) : null;
}

// Build-time facts attached to a tuning proposal: where the value lives in the
// configuration and whether the proposal simply restores it.
function tuningConfigFields(knob, config, proposedValue) {
  const configKey = TUNING_CONFIG_KEYS.get(knob) ?? null;
  if (configKey === null) return {};
  const configValue = readConfigValue(config, configKey);
  return { configKey, configValue, restoresConfig: configValue !== null && proposedValue === configValue };
}

// Measured before/after colors for a structural proposal. The foregrounds of the
// pairs the proposal must fix lead the list; only then do other recomputed tokens
// fill the remaining slots, deduplicated per token and capped.
export function structuralChanges(before, after, issueLabels, limit = 4) {
  const priority = new Set(list(issueLabels));
  const changes = [];
  for (const wanted of [true, false]) {
    for (const [index, row] of after.entries()) {
      const prior = before[index];
      if (changes.length >= limit || !prior || prior.foreground !== row.foreground) continue;
      if (sameColor(prior.foregroundColor, row.foregroundColor) || priority.has(row.label) !== wanted) continue;
      if (changes.some((change) => change.label === row.foreground)) continue;
      changes.push({ label: row.foreground, before: prior.foregroundColor, after: row.foregroundColor });
    }
  }
  return changes;
}
// A configuration-only trial: the palette bytes stay the same, so the model is
// regenerated from the inspected source with the promoted build-time value.
async function inspectConfigTrial(analysis, config) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-config-trial-"));
  try {
    await writeFile(path.join(root, "palette.css"), analysis.inputs.paletteCss);
    return await analyzeColorTokens({ root, suggest: false, config: {
      ...config, palette: "palette.css", output: "colors.css",
      motion: { ...config.motion, output: "colors-motion.css" },
    } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

// The structural sibling of a tuning knob: the same value defined where the
// generator reads it, so the build regenerates the derived text tokens. The
// override is aligned to that number so both sources agree; the measured
// before/after colors are attached after browser verification, never modelled here.
async function structuralSibling(analysis, tuningCss, options) {
  const { id, knob, configKey, configValue, value, issueLabels, title, note, record } = options;
  if (configKey === null || value === null) return null;
  if (configValue !== null && value === configValue) {
    record({ id: `config:${knob}`, file: REPORT_FILES.config, reason: `il valore ${value} è già la definizione di progetto (${configKey}): nessuna modifica strutturale necessaria` });
    return null;
  }
  let trial;
  try {
    trial = await inspectConfigTrial(analysis, withConfigValue(analysis.config, configKey, value));
  } catch (error) {
    record({ id: `config:${knob}`, file: REPORT_FILES.config, reason: `verifica strutturale non eseguibile: ${String(error.message).split("\n")[0]}` });
    return null;
  }
  if (!noNewModelFailures(analysis, trial)) {
    record({ id: `config:${knob}`, file: REPORT_FILES.config, reason: `promuovere ${value} in ${configKey} introdurrebbe nuovi fallimenti di modello` });
    return null;
  }
  return {
    id, kind: "config", title,
    destination: { file: REPORT_FILES.config, path: configKey, snippet: configSnippet(configKey, value) },
    impact: `${note} La dichiarazione ${knob} in colors-tuning.css diventa ridondante: rimuovila o allineala a ${value}.`,
    search: "Rigenerazione completa del modello dalla configurazione promossa e verifica browser nei quattro scenari tema/preferenza, con margine sulle coppie coinvolte; nessuna promessa di ottimo globale.",
    changes: [], issueLabels, configKey, configValue, promotedValue: value, configToken: knob,
    css: trial.css, tuningCss: replaceTuningDeclaration(tuningCss, knob, formatTuningValue(knob, value)) ?? tuningCss,
  };
}

export function replacePaletteSource(css, token, value) {
  const escaped = escapeRegExp(token);
  // Comments are inert, and the blanked copy keeps byte offsets, so matches and
  // edits stay aligned with the original source. A commented-out block never
  // counts as a second candidate and is never rewritten.
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
  const blocks = [...uncommented.matchAll(new RegExp(`@property\\s+${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  if (blocks.length > 1) return null;
  if (blocks.length === 1) {
    const [block] = blocks;
    const bodyStart = block.index + block[0].length - block[1].length - 1;
    const initial = /(initial-value\s*:\s*)(oklch\([^;]*\))(\s*;)/.exec(block[1]);
    if (!initial) return null;
    const start = bodyStart + initial.index + initial[1].length;
    return css.slice(0, start) + value + css.slice(start + initial[2].length);
  }
  const matches = [...uncommented.matchAll(new RegExp(`(${escaped}\\s*:\\s*)(oklch\\([^;]*\\))(\\s*;)`, "g"))];
  if (matches.length !== 1) return null;
  const [match] = matches;
  const start = match.index + match[1].length;
  return css.slice(0, start) + value + css.slice(start + match[2].length);
}

// The palette documents dark-blend 0..100 as 0..28% white mixed into the
// authored source; the generator rounds the emitted percentage to 4 decimals.
const DARK_BLEND_WHITE_RATIO = 0.28;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Comments are inert and the spaced copy keeps byte offsets, so matches and
// edits stay aligned with the original source bytes.
function palettePropertyBlock(css, token) {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length));
  const blocks = [...uncommented.matchAll(new RegExp(`@property\\s+${escapeRegExp(token)}\\s*\\{([^}]*)\\}`, "g"))];
  if (blocks.length !== 1) return null;
  const [block] = blocks;
  return { body: block[1], bodyStart: block.index + block[0].length - block[1].length - 1 };
}

// `null` means the descriptor cannot be edited safely: absent, duplicated or
// malformed blocks stay a human decision. `{ value: null }` is the documented
// adaptive fallback, so the search still knows the descriptor is missing.
function paletteDarkBlendState(css, token) {
  const block = palettePropertyBlock(css, token);
  if (block === null) return null;
  const declarations = [...block.body.matchAll(/dark-blend\s*:\s*([^;]*);/g)];
  if (declarations.length > 1) return null;
  if (declarations.length === 1) {
    const raw = declarations[0][1].trim();
    if (!/^\d+(?:\.\d+)?$/.test(raw) || Number(raw) > 100) return null;
  }
  return { block, declaration: declarations[0] ?? null };
}

// Reads the declared descriptor without editing: same active-declaration rule
// as the rewrite, so only values that could also be replaced are reported.
export function readPaletteDarkBlend(css, token) {
  const state = paletteDarkBlendState(css, token);
  return state === null ? null : { value: state.declaration === null ? null : Number(state.declaration[1].trim()) };
}

// Replaces the declared descriptor or inserts it next to `role:`; a missing
// anchor or a malformed block yields null instead of a speculative write.
export function replacePaletteDarkBlend(css, token, value) {
  const state = paletteDarkBlendState(css, token);
  if (state === null) return null;
  if (state.declaration !== null) {
    const start = state.block.bodyStart + state.declaration.index;
    return `${css.slice(0, start)}dark-blend: ${value};${css.slice(start + state.declaration[0].length)}`;
  }
  const roles = [...state.block.body.matchAll(/role\s*:\s*[a-z][a-z0-9-]*\s*;/gi)];
  if (roles.length !== 1) return null;
  const [role] = roles;
  const lineStart = state.block.body.lastIndexOf("\n", role.index) + 1;
  const ownLine = state.block.body.slice(lineStart, role.index).trim() === "";
  const end = state.block.bodyStart + role.index + role[0].length;
  const insertion = ownLine ? `\n${/^[ \t]*/.exec(state.block.body.slice(lineStart))[0]}dark-blend: ${value};` : ` dark-blend: ${value};`;
  return `${css.slice(0, end)}${insertion}${css.slice(end)}`;
}

// The emitted dark identity mixes the authored light source toward white at
// the rounded percentage; the adaptive blend mirrors the documented fallback
// (0.5 + L/2 of source), so the integer search starts from the current state.
function darkBlendColor(light, blend) {
  return mixOklch(light, { l: 1, c: 0, h: null }, Number((100 - blend * DARK_BLEND_WHITE_RATIO).toFixed(4)) / 100);
}

function adaptiveDarkBlend(lightness) {
  const sourceRatio = Number((clamp(0.5 + lightness * 0.5, 0, 1) * 100).toFixed(4)) / 100;
  return ((1 - sourceRatio) / DARK_BLEND_WHITE_RATIO) * 100;
}

// Integer grid 0..100, nearest to the active blend first, mirroring the file's
// convention that dark-blend values are integers.
function nearestDarkBlend(current, accepts) {
  const candidates = Array.from({ length: 101 }, (_, index) => index)
    .sort((a, b) => Math.abs(a - current) - Math.abs(b - current) || a - b);
  for (const value of candidates) if (accepts(value)) return value;
  return null;
}

// Rewritten palette bytes are regenerated in a temporary root: the trial model
// and the browser verification consume the edited source itself, never a
// hand-modeled approximation of it.
async function inspectPaletteCss(analysis, css) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-proposal-"));
  try {
    await writeFile(path.join(root, "palette.css"), css);
    return await analyzeColorTokens({ root, suggest: false, config: {
      ...analysis.config, palette: "palette.css", output: "colors.css",
      motion: { ...analysis.config.motion, output: "colors-motion.css" },
    } });
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function inspectSourceTrial(analysis, paletteCss, proposal) {
  const token = analysis.config.roles.identities[proposal.identity].token;
  const css = replacePaletteSource(paletteCss, token, sourceColorValue(proposal.changes[0].after));
  return css === null ? null : inspectPaletteCss(analysis, css);
}

function noNewModelFailures(analysis, trial) {
  if (!trial || trial.errors.length) return false;
  const previous = new Map(analysis.diagnostics.map((pair) => [pair.label, pair]));
  return trial.diagnostics.every((pair) => {
    const before = previous.get(pair.label);
    return before && !(before.status === "pass" && pair.status !== "pass")
      && !(before.status !== "below-minimum" && pair.status === "below-minimum");
  });
}

export async function reportCandidates(root, analysis, tuningCss, states, rejected = []) {
  const candidates = [];
  // Attempted-but-discarded candidates are recorded, never silently dropped: an
  // absent palette.css proposal must come with its reason.
  const reject = (entry) => { if (Array.isArray(rejected)) rejected.push(entry); };
  const allRows = states.flatMap((state) => state.tuned);
  const failures = allRows.filter((pair) => pair.status !== "pass");
  if (!failures.length || analysis.errors.length) return candidates;
  const paletteCss = analysis.inputs.paletteCss;

  // Keep the palette intact: offer a source-preserving foreground change first
  // where the existing configuration has a dedicated on-solid override.
  for (const identity of Object.keys(analysis.config.roles.identities)) {
    for (const scheme of ["light", "dark"]) {
      const foreground = `--color-${identity}-solid-text`;
      const affected = allRows.filter((pair) => pair.foreground === foreground && pair.label.startsWith(`${scheme} `));
      if (!affected.some((pair) => pair.status !== "pass")) continue;
      const color = nearestLightness(affected[0].foregroundColor, (candidate) => affected.every((pair) =>
        contrast(resolvedColor(candidate), pair.backgroundColor) >= Math.min(21, Math.max(pair.target, pair.minimum) + 0.02)));
      if (!color) continue;
      const config = { ...analysis.config, onSolid: {
        ...analysis.config.onSolid, [identity]: { ...analysis.config.onSolid?.[identity], [scheme]: oklch(color) },
      } };
      const trial = await analyzeColorTokens({ root, config, suggest: false }, analysis.inputs.paletteCss);
      if (!noNewModelFailures(analysis, trial)) continue;
      candidates.push({
        id: `browser-foreground:${identity}:${scheme}`, title: `Preserva il riempimento ${identity}: correggi il testo (${scheme})`, kind: "foreground",
        destination: { file: REPORT_FILES.config, path: `onSolid.${identity}.${scheme}`, snippet: `onSolid: { ${JSON.stringify(identity)}: { ${scheme}: ${JSON.stringify(oklch(color))} } }` },
        impact: "Cambia solo il companion on-solid nel tema indicato; mantiene palette, riempimenti e foreground diretto. Unire allo stesso oggetto onSolid esistente.",
        search: "Lightness più vicina sulla griglia a 4 decimali, C/H effettive fisse, sRGB/serializzazione verificati; non un ottimo percettivo globale.",
        changes: [{ label: foreground, before: affected[0].foregroundColor, after: resolvedColor(color) }],
        issueLabels: [...new Set(affected.filter((pair) => pair.status !== "pass").map((pair) => pair.label))],
        css: trial.css, tuningCss,
      });
    }
  }

  // Palette source first: the canvas is the designer-facing origin of both
  // light neutrals and their dark derivations. Surface pairs are modelled with
  // the lightness shift they already carry (the emitted light surface is the
  // canvas plus that shift); every other derived token is left to full
  // regeneration and the browser verification.
  const neutralFailures = failures.filter((pair) => pair.label.startsWith("light ") && NEUTRAL_BACKGROUNDS.has(pair.background));
  if (neutralFailures.length) {
    const canvasToken = analysis.config.roles.canvas;
    const authored = canvasToken ? analysis.authoredTokens[tokenKey(canvasToken)] : null;
    const light = states.find((state) => state.scheme === "light");
    const canvas = light?.computed?.tokens?.get("--color-bg");
    const surface = light?.computed?.tokens?.get("--color-surface");
    if (!authored || !canvas || !surface) reject({ id: "palette-bg-lightness", file: REPORT_FILES.palette, reason: "canvas di palette.css o misure del browser non disponibili" });
    if (authored && canvas && surface) {
      const constraints = allRows.filter((pair) => pair.label.startsWith("light ") && NEUTRAL_BACKGROUNDS.has(pair.background));
      const shift = surface.l - canvas.l;
      const candidateColor = nearestLightness(authored, (color) => {
        const background = { l: color.l, c: canvas.c, h: canvas.h };
        const shiftedSurface = { l: clamp(color.l + shift, 0, 1), c: surface.c, h: surface.h };
        return constraints.every((pair) =>
          contrast(pair.foregroundColor, pair.background === "--color-bg" ? background : shiftedSurface) >= directMargin(pair));
      });
      const value = candidateColor === null ? null : oklch(candidateColor);
      const rewritten = value === null ? null : replacePaletteSource(paletteCss, canvasToken, value);
      const trial = rewritten === null ? null : await inspectPaletteCss(analysis, rewritten);
      const sound = noNewModelFailures(analysis, trial);
      const overrideNote = paletteOverrideNote(analysis, tuningCss);
      if (candidateColor === null) reject({ id: "palette-bg-lightness", file: REPORT_FILES.palette, reason: `nessuna luminosità del canvas soddisfa tutte le coppie neutre con il margine richiesto${overrideNote}` });
      else if (rewritten === null) reject({ id: "palette-bg-lightness", file: REPORT_FILES.palette, reason: `la riscrittura del blocco @property del canvas non è disponibile${overrideNote}` });
      else if (!sound) reject({ id: "palette-bg-lightness", file: REPORT_FILES.palette, reason: `la rigenerazione dalla palette introdurrebbe nuovi fallimenti di modello${overrideNote}` });
      if (sound) candidates.push({
        id: "palette-bg-lightness", title: "Sorgente: raffina la luminosità del canvas (light)", kind: "palette-source",
        destination: { file: REPORT_FILES.palette, path: canvasToken, snippet: `initial-value: ${value};` },
        impact: `Cambia il canvas di palette.css (${canvasToken}) e con esso --color-bg, --color-surface e le derivazioni del tema chiaro, incluse le tinte dark che ripartono da questo valore; colors-tuning.css resta intatto. Sostituisci la riga initial-value: esistente nel blocco @property, non aggiungere un override altrove.`,
        search: "Ricerca L a 4 decimali sul canvas con C/H di sorgente fisse, superficie light modellata con lo shift misurato e margine 0.02 su tutte le coppie misurate sugli sfondi neutri, comprese le derivate (es. testo muted su surface); poi rigenerazione completa del modello dalla palette riscritta e verifica browser, senza promessa di ottimo globale.",
        changes: [{ label: canvasToken, before: { ...authored }, after: { ...candidateColor } }],
        issueLabels: [...new Set(neutralFailures.map((pair) => pair.label))],
        css: trial.css, tuningCss,
      });
    }
  }

  // Light neutral surface: the smallest runtime change and its structural twin.
  // The shift is emitted from derivation.surface.lightShift, so the generator
  // derives --color-text-muted and the identity *-text variants from the
  // configured value; an override moves the surface without recomputing them.
  const surfaceFailures = failures.filter((pair) => pair.label.startsWith("light ") && pair.background === "--color-surface");
  const surfaceKnob = "--color-tune-surface-lightness-shift";
  if (analysis.config.derivation.dark.mode === "relative" && surfaceFailures.length) {
    const light = states.find((state) => state.scheme === "light");
    // The search needs the browser-resolved neutrals. A partial or model-only
    // state stays silent instead of dereferencing a missing measurement.
    const surface = light?.computed?.tokens?.get("--color-surface");
    const canvas = light?.computed?.tokens?.get("--color-bg");
    const constraints = allRows.filter((pair) => pair.label.startsWith("light ") && pair.background === "--color-surface");
    const issueLabels = [...new Set(surfaceFailures.map((pair) => pair.label))];
    if (!surface || !canvas) reject({ id: "browser-neutral-surface", file: REPORT_FILES.tuning, reason: "misure del browser per canvas e superficie non disponibili" });
    const candidate = surface && canvas ? nearestLightness(surface, (color) => constraints.every((pair) =>
      contrast(pair.foregroundColor, color) >= Math.min(21, Math.max(pair.minimum, pair.target) + 0.02))) : null;
    const shift = candidate && canvas ? Number((candidate.l - canvas.l).toFixed(4)) : null;
    if (candidate) {
      const tuning = replaceTuningDeclaration(tuningCss, surfaceKnob, String(shift));
      if (tuning !== null) candidates.push({
        id: "browser-neutral-surface", title: "Preserva la palette: raffina la superficie light", kind: "tuning",
        destination: { file: REPORT_FILES.tuning, path: surfaceKnob, snippet: `${surfaceKnob}: ${shift};` },
        impact: "Cambia la superficie neutra light e le derivazioni che ne dipendono; non modifica la palette né la superficie dark. Sostituire la dichiarazione esistente, non aggiungere un override altrove.",
        search: "Ricerca L a 4 decimali sulla superficie effettiva con C/H fisse e margine 0.02 sulle coppie dirette; poi verifica browser completa, senza promessa di ottimo globale fra tutti i parametri.",
        changes: [{ label: "--color-surface (light)", before: surface, after: candidate }],
        issueLabels, css: analysis.css, tuningCss: tuning,
        ...tuningConfigFields(surfaceKnob, analysis.config, shift),
      });
    }
    // Structural alternatives: the same intent defined where the generator reads it.
    const surfaceConfigKey = TUNING_CONFIG_KEYS.get(surfaceKnob) ?? null;
    const surfaceConfigValue = surfaceConfigKey === null ? null : readConfigValue(analysis.config, surfaceConfigKey);
    const activeShift = tuningShift(tuningCss, surfaceKnob);
    if (surfaceConfigKey !== null && activeShift !== null && activeShift !== surfaceConfigValue) {
      const promotion = await structuralSibling(analysis, tuningCss, {
        id: "config-promote-surface-lightness-shift", knob: surfaceKnob, configKey: surfaceConfigKey, configValue: surfaceConfigValue,
        value: activeShift, issueLabels, record: reject, title: "Strutturale: promuovi la superficie light in configurazione",
        note: `Promuove il valore attivo ${activeShift} dell'override in smart-colors.config.mjs (${surfaceConfigKey}) senza cambiare la superficie scelta: la build rigenera --color-text-muted e le varianti testo derivate su quella superficie, mentre l'override a runtime le lascia ai valori calcolati per ${surfaceConfigValue}.`,
      });
      if (promotion) candidates.push(promotion);
    }
    if (surfaceConfigKey !== null && shift !== null && shift !== surfaceConfigValue) {
      const twin = await structuralSibling(analysis, tuningCss, {
        id: "config-default-surface-lightness-shift", knob: surfaceKnob, configKey: surfaceConfigKey, configValue: surfaceConfigValue,
        value: shift, issueLabels, record: reject, title: "Strutturale: definisci la superficie light in configurazione",
        note: `Definisce in smart-colors.config.mjs (${surfaceConfigKey}) il valore ${shift} trovato sulla superficie, così la build ricalcola i token testo derivati invece di lasciarli al valore configurato ${surfaceConfigValue}.`,
      });
      if (twin) candidates.push(twin);
    }
  }

  // Project-owned dark tuning: a dark neutral failure can come from the knobs in
  // colors-tuning.css rather than from the palette. Search the emitted
  // percentage grid around the active value; only a relative dark derivation
  // consumes these knobs, so other modes are not measurable here.
  if (analysis.config.derivation.dark.mode === "relative") {
    // --_color-text-muted-dark mixes the resolved dark text into --_color-bg-dark,
    // so the bg-depth knob moves the muted token too. Only that knob scales the
    // muted mix source; the surface knob leaves the muted token fixed.
    const darkState = states.find((state) => state.scheme === "dark");
    const mutedText = darkState?.computed?.tokens.get("--color-text");
    for (const [knob, background, id, label, title] of [
      ["--color-tune-dark-bg-mix", "--color-bg", "browser-neutral-bg-dark", "--color-bg (dark)", "Preserva la palette: raffina il canvas dark"],
      ["--color-tune-dark-surface-mix", "--color-surface", "browser-neutral-surface-dark", "--color-surface (dark)", "Preserva la palette: raffina la superficie dark"],
    ]) {
      const affected = failures.filter((pair) => pair.label.startsWith("dark ") && pair.background === background);
      if (!affected.length) continue;
      const current = tuningPercentage(tuningCss, knob) ?? tuningPercentage(analysis.css, knob);
      if (current === null || current <= 0) continue;
      const constraints = allRows.filter((pair) => pair.label.startsWith("dark ") && pair.background === background);
      const reModelsMuted = background === "--color-bg";
      const mutedDepth = reModelsMuted
        ? tuningPercentage(tuningCss, "--color-tune-dark-muted-mix") ?? tuningPercentage(analysis.css, "--color-tune-dark-muted-mix")
        : null;
      // Without the resolved dark text and the active muted depth the interaction
      // is not measurable: skip this candidate instead of modelling it with a
      // constant foreground that the generated CSS disproves.
      if (reModelsMuted && constraints.some((pair) => pair.foreground === "--color-text-muted") && (!mutedText || mutedDepth === null)) continue;
      const base = affected[0].backgroundColor;
      const depth = nearestTuningPercentage(current, (candidate) => {
        const scaled = { l: base.l * (candidate / current), c: base.c * (candidate / current), h: base.h };
        return constraints.every((pair) => {
          const foreground = reModelsMuted && pair.foreground === "--color-text-muted"
            ? mixOklch(mutedText, scaled, mutedDepth / 100) : pair.foregroundColor;
          return contrast(foreground, scaled) >= directMargin(pair);
        });
      });
      if (depth === null) continue;
      const value = percentageValue(depth);
      const tuning = replaceTuningDeclaration(tuningCss, knob, value);
      if (tuning === null) continue;
      candidates.push({
        id, title, kind: "tuning",
        destination: { file: REPORT_FILES.tuning, path: knob, snippet: `${knob}: ${value};` },
        impact: `Cambia ${background} del tema scuro e le derivazioni che lo consumano; non tocca palette, l'altro neutro dark né l'output generato. Sostituisci la dichiarazione esistente in colors-tuning.css, non aggiungere un override altrove.`,
        search: "Ricerca a 2 decimali sul knob percentuale con C/H del neutro risolto dal browser e margine 0.02 sulle coppie misurate su questo sfondo; poi verifica browser completa, senza promessa di ottimo globale fra tutti i parametri.",
        changes: [{ label, before: base, after: { l: base.l * (depth / current), c: base.c * (depth / current), h: base.h } }],
        issueLabels: [...new Set(affected.map((pair) => pair.label))], css: analysis.css, tuningCss: tuning,
        ...tuningConfigFields(knob, analysis.config, depth),
      });
      const knobConfigKey = TUNING_CONFIG_KEYS.get(knob) ?? null;
      const knobConfigValue = knobConfigKey === null ? null : readConfigValue(analysis.config, knobConfigKey);
      const activeDepth = tuningPercentage(tuningCss, knob);
      if (knobConfigKey !== null && activeDepth !== null && activeDepth !== knobConfigValue) {
        const promotion = await structuralSibling(analysis, tuningCss, {
          id: `config-promote-${knob}`, knob, configKey: knobConfigKey, configValue: knobConfigValue,
          value: activeDepth, issueLabels: [...new Set(affected.map((pair) => pair.label))], record: reject,
          title: `Strutturale: promuovi ${label} in configurazione`,
          note: `Promuove il valore attivo ${activeDepth}% dell'override in smart-colors.config.mjs (${knobConfigKey}): la build rigenera i neutri scuri da quel valore invece di lasciarli a ${knobConfigValue}%.`,
        });
        if (promotion) candidates.push(promotion);
      }
    }

    const mutedFailures = failures.filter((pair) => pair.label.startsWith("dark ") && pair.foreground === "--color-text-muted");
    const mutedCurrent = tuningPercentage(tuningCss, "--color-tune-dark-muted-mix") ?? tuningPercentage(analysis.css, "--color-tune-dark-muted-mix");
    const mutedCanvas = darkState?.computed?.tokens.get("--color-bg");
    // An active --color-text override reshapes the muted mix source, which is not
    // observable through the public tokens; leave that knob to a human decision.
    if (mutedFailures.length && mutedCurrent !== null && mutedText && mutedCanvas && readTuningDeclaration(tuningCss, "--color-text") === null) {
      const constraints = allRows.filter((pair) => pair.label.startsWith("dark ") && pair.foreground === "--color-text-muted");
      const depth = nearestTuningPercentage(mutedCurrent, (candidate) =>
        constraints.every((pair) => contrast(mixOklch(mutedText, mutedCanvas, candidate / 100), pair.backgroundColor) >= directMargin(pair)));
      if (depth !== null) {
        const value = percentageValue(depth);
        const tuning = replaceTuningDeclaration(tuningCss, "--color-tune-dark-muted-mix", value);
        if (tuning !== null) candidates.push({
          id: "browser-neutral-muted-dark", title: "Preserva la palette: raffina il testo secondario dark", kind: "tuning",
          destination: { file: REPORT_FILES.tuning, path: "--color-tune-dark-muted-mix", snippet: `--color-tune-dark-muted-mix: ${value};` },
          impact: "Cambia solo il testo muted del tema scuro; non tocca palette, canvas o superficie. Sostituisci la dichiarazione esistente in colors-tuning.css, non aggiungere un override altrove.",
          search: "Ricerca a 2 decimali sul rapporto di miscela tra testo e canvas risolti dal browser, con margine 0.02 sulle coppie misurate che usano il testo muted; poi verifica browser completa, senza promessa di ottimo globale.",
          changes: [{ label: "--color-text-muted (dark)", before: mutedFailures[0].foregroundColor, after: mixOklch(mutedText, mutedCanvas, depth / 100) }],
          issueLabels: [...new Set(mutedFailures.map((pair) => pair.label))], css: analysis.css, tuningCss: tuning,
        });
      }
    }
  }

  // Palette source before the tuning escape hatch: dark-blend is the stable
  // lever palette.css documents for ui/feedback identities, so the designer
  // sees the source edit first; --color-tune-<id>-dark in colors-tuning.css
  // stays the runtime alternative. The rewrite is descriptor-level and bails
  // out on absent, duplicated or malformed blocks instead of editing blind.
  for (const [identity, definition] of Object.entries(analysis.config.roles.identities)) {
    if (definition?.role !== "ui" && definition?.role !== "feedback") continue;
    const fills = [`--color-${identity}`, `--color-${identity}-solid`];
    const affected = failures.filter((pair) => pair.label.startsWith("dark ") && fills.includes(pair.background));
    if (!affected.length) continue;
    const authored = analysis.authoredTokens[tokenKey(definition.token)];
    const state = authored ? readPaletteDarkBlend(paletteCss, definition.token) : null;
    if (!state) continue;
    const light = serializedColor(fitToSrgb(authored));
    const constraints = allRows.filter((pair) => pair.label.startsWith("dark ") && fills.includes(pair.background));
    const blend = nearestDarkBlend(state.value ?? adaptiveDarkBlend(light.l), (candidate) =>
      constraints.every((pair) => contrast(pair.foregroundColor, darkBlendColor(light, candidate)) >= directMargin(pair)));
    const rewritten = blend === null ? null : replacePaletteDarkBlend(paletteCss, definition.token, blend);
    const trial = rewritten === null ? null : await inspectPaletteCss(analysis, rewritten);
    if (!noNewModelFailures(analysis, trial)) continue;
    candidates.push({
      id: `palette-dark-blend:${identity}`, title: `Sorgente: imposta dark-blend su ${identity} (dark)`, kind: "palette-source",
      destination: { file: REPORT_FILES.palette, path: "dark-blend", snippet: `dark-blend: ${blend};` },
      impact: `Scrive il descrittore dark-blend sulla sorgente ${definition.token} in palette.css: è la leva stabile prevista dalla palette (0–100, fino al 28% di bianco) e cambia solo la variante dark di ${identity}, bordo e companion rigenerati inclusi. L'escape hatch runtime --color-tune-${identity}-dark in colors-tuning.css resta l'alternativa e non viene toccata.`,
      search: "Ricerca su tutti gli interi 0–100 partendo dal valore efficace attuale, C/H della sorgente fisse e margine 0.02 sulle coppie misurate sul riempimento dark; poi rigenerazione completa del modello dalla palette riscritta e verifica browser, senza promessa di ottimo globale.",
      changes: [{ label: `--color-${identity} (dark)`, before: { ...affected[0].backgroundColor }, after: darkBlendColor(light, blend) }],
      issueLabels: [...new Set(affected.map((pair) => pair.label))], css: trial.css, tuningCss,
    });
  }

  // The per-color tune hatch is the palette-preserving way to rebalance a dark
  // identity fill: light fills, literal solid-hover and on-solid/on-color stay.
  for (const identity of Object.keys(analysis.config.roles.identities)) {
    const fills = [`--color-${identity}`, `--color-${identity}-solid`];
    const affected = failures.filter((pair) => pair.label.startsWith("dark ") && fills.includes(pair.background));
    if (!affected.length) continue;
    const constraints = allRows.filter((pair) => pair.label.startsWith("dark ") && fills.includes(pair.background));
    const fill = affected[0].backgroundColor;
    // The candidate becomes the background, so the measured requirement is the text
    // on the new fill, never the new fill against the previous one.
    const balanced = nearestLightness(fill, (color) => constraints.every((pair) =>
      contrast(pair.foregroundColor, resolvedColor(color)) >= directMargin(pair)));
    if (!balanced) continue;
    const value = oklch(balanced);
    const tuning = replaceTuningDeclaration(tuningCss, `--color-tune-${identity}-dark`, value);
    if (tuning === null) continue;
    const focusControls = identity === analysis.config.roles.focus
      ? ` Inoltre --_color-${identity}-dark alimenta anche --color-control-bg-active, --color-control-border-active e --color-control-focus-bg nel tema scuro, che seguono quindi la stessa modifica.`
      : "";
    candidates.push({
      id: `browser-dark-fill:${identity}`, title: `Escape hatch: riequilibra il riempimento ${identity} in dark`, kind: "tuning",
      destination: { file: REPORT_FILES.tuning, path: `--color-tune-${identity}-dark`, snippet: `--color-tune-${identity}-dark: ${value};` },
      impact: `Fissa il riempimento dark di ${identity} (condiviso dal bordo) senza toccare la palette; riempimento chiaro, solid-hover e companion restano letterali. Escape hatch non validato dal generatore: per scelte stabili usa dark-blend in palette.css. Decommenta o sostituisci la riga di esempio nel pannello 2 di colors-tuning.css.${focusControls}`,
      search: "Lightness più vicina sulla griglia a 4 decimali con C/H del riempimento dark risolto dal browser e margine 0.02 sulle coppie misurate sul riempimento; poi verifica browser completa, senza promessa di ottimo globale.",
      changes: [{ label: `--color-${identity} (dark)`, before: fill, after: resolvedColor(balanced) }],
      issueLabels: [...new Set(affected.map((pair) => pair.label))], css: analysis.css, tuningCss: tuning,
    });
  }

  for (const proposal of analysis.proposals.filter((item) => item.kind === "palette-source")) {
    // Keep the direct ink companion in the same verification: the source
    // edit must hold for --color-<id>-solid-text and for --color-<id>-ink on its
    // own fill, so both labels are named instead of only the solid-text pair.
    const issueLabels = failures.filter((pair) => pair.label.startsWith(`${proposal.scheme} `)
      && (pair.foreground === `--color-${proposal.identity}-solid-text`
        || (pair.foreground === `--color-${proposal.identity}-ink` && pair.background === `--color-${proposal.identity}`)))
      .map((pair) => pair.label);
    if (!issueLabels.length) continue;
    const trial = await inspectSourceTrial(analysis, paletteCss, proposal);
    if (!noNewModelFailures(analysis, trial)) continue;
    candidates.push({ ...proposal, title: `Alternativa: modifica la sorgente ${proposal.identity} (${proposal.scheme})`,
      issueLabels: [...new Set(issueLabels)], css: trial.css, tuningCss });
  }
  return candidates;
}
