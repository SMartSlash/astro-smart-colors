import { styleText } from "node:util";

// ANSI is a terminal affordance, never part of the data: a piped or redirected run keeps the same
// plain text, and NO_COLOR always wins. The CLI's own guard is required because styleText does not
// disable itself on a non-TTY stream.
const COLOR = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);

export function paint(text, ...formats) {
  return COLOR && formats.length ? styleText(formats, text) : text;
}

export const badge = () => paint("[smart-colors]", "bold", "cyan");
export const title = (text) => `${paint("●", "cyan")} ${paint(text, "bold")}`;
export const check = () => paint("✔", "green");
export const warn = () => paint("!", "yellow");
export const arrow = () => paint("→", "cyan");
export const file = (text) => paint(text, "underline");
export const note = (text) => paint(text, "dim");

// ---------------------------------------------------------------------------
// Pure verdict helpers (no I/O, no painting) so the CLI's outcome line can be
// unit-tested directly and can never show a positive verdict without a real
// measurement. Generation success and verification success stay separate facts.
// ---------------------------------------------------------------------------

/**
 * Presentation-complete means strict, full, non-partial and actually measured: it is never true for
 * a partial or empty run, so a positive verdict is only ever shown for a real measurement.
 */
export function verificationComplete(result) {
  const coverage = result?.coverage ?? {};
  return coverage.status === "complete"
    && Boolean(coverage.complete)
    && !coverage.partial
    && (coverage.measuredPairs ?? 0) > 0;
}

/**
 * Data availability is distinct from completeness: a partial run still produced real browser
 * measurements, so its facts are measured, not a model estimate. Only `measurementAvailable`
 * decides provenance; `verificationComplete` decides whether a positive verdict may be shown.
 */
export function measurementAvailable(result) {
  return ((result?.coverage ?? {}).measuredPairs ?? 0) > 0;
}

/**
 * Where the facts come from: a browser measurement (even a partial one) or the model estimate.
 * Explicit so a measured shortfall is never hidden as a "model advisory", and vice versa.
 */
export function provenance(result) {
  return measurementAvailable(result) ? "MEASURED" : "MODEL ESTIMATE";
}

/**
 * One honest verdict, aligned with the exit policy and never positive without a full measurement.
 * Any measured problem (below-minimum OR below-target) is `NEEDS REVIEW`; a measured-but-incomplete
 * run is never `OK`; a strict-invalid model is always `ERROR`.
 *
 * The detail states the consequence, not the cause: the verification line above already names the
 * mode, the engines and the coverage, so repeating them here would only add noise.
 * Returns `{ code, label, detail }` where `code` is one of `ok`, `review`, `unverified`, `error`.
 */
export function verdict(result) {
  const coverage = result?.coverage ?? {};

  if (result?.strictInvalid) {
    const count = result?.analysis?.errors?.length ?? 0;
    return {
      code: "error",
      label: "ERROR",
      detail: `contrast contract invalid, ${count} ${count === 1 ? "error" : "errors"} in the model.`,
    };
  }

  // An empty measured output can never verify green, whatever the coverage says.
  if (cssState(result).shape === "empty") {
    return { code: "unverified", label: "UNVERIFIED", detail: "empty CSS output: no positive verification possible." };
  }

  if (measurementAvailable(result)) {
    const problems = result?.problems ?? [];
    if (problems.length) {
      return {
        code: "review",
        label: "NEEDS REVIEW",
        detail: `${problems.length} measured ${problems.length === 1 ? "pair" : "pairs"} below threshold.`,
      };
    }
    if (verificationComplete(result)) {
      return { code: "ok", label: "OK", detail: "all measured pairs meet the thresholds." };
    }
    // Measured and clean, but the coverage is partial: never promoted to OK.
    return { code: "unverified", label: "UNVERIFIED", detail: "incomplete coverage: no positive outcome." };
  }

  if (coverage.mode === "off" || coverage.status === "disabled" || (coverage.launched ?? 0) === 0) {
    return { code: "unverified", label: "UNVERIFIED", detail: "no browser measurement, so no positive outcome." };
  }
  return { code: "unverified", label: "UNVERIFIED", detail: "incomplete coverage: no positive outcome." };
}

// ---------------------------------------------------------------------------
// Generated-vs-actual CSS state: prefer the pipeline metadata, fall back to the
// pre-metadata handoff so the CLI keeps working while the change lands.
// ---------------------------------------------------------------------------

const CSS_STATUSES = new Set(["current", "stale", "absent", "empty"]);
const CSS_SOURCES = new Set(["output", "generated-candidate"]);

/**
 * Normalize the generated-vs-actual CSS state.
 *
 * Prefers `result.session.css` (`{ generated, baseline, source, status, production, digest }`) where
 * `baseline` is the actual captured output (present, even when empty) and `generated` is the model
 * expectation. Falls back to the pre-metadata handoff (`writeOutcome` for build, `production` for
 * report). Never throws for unknown input; returns `shape: "unknown"` when nothing can be derived.
 * `baseline`/`generated` are the raw strings (truthiness is not a signal: an empty string is empty).
 */
export function cssState(result) {
  const outputPath = result?.analysis?.config?.output
    ?? result?.captured?.files?.output
    ?? "src/styles/tokens/colors.css";

  const css = result?.session?.css;
  if (css && typeof css === "object" && CSS_STATUSES.has(css.status)) {
    const status = css.status;
    return {
      shape: status,
      source: CSS_SOURCES.has(css.source) ? css.source : (status === "absent" ? "generated-candidate" : "output"),
      production: typeof css.production === "boolean" ? css.production : status === "current",
      path: outputPath,
      generated: typeof css.generated === "string" ? css.generated : null,
      baseline: typeof css.baseline === "string" ? css.baseline : null,
      digest: css.digest && typeof css.digest === "object" ? css.digest : null,
      metadata: true,
    };
  }

  return legacyCssState(result, outputPath);
}

function legacyCssState(result, outputPath) {
  const base = { path: outputPath, generated: null, baseline: null, digest: null, metadata: false };
  if (result?.strictInvalid) return { ...base, shape: "absent", source: "generated-candidate", production: false };
  if (result?.command === "report") {
    const production = result?.production;
    if (production && typeof production === "object" && Array.isArray(production.candidates)) {
      if (production.accepted === true) return { ...base, shape: "current", source: "output", production: true };
      const reasons = production.candidates.map((candidate) => candidate?.reason);
      const absentOnly = reasons.includes("absent") && !reasons.some((reason) => reason !== "absent");
      return absentOnly
        ? { ...base, shape: "absent", source: "generated-candidate", production: false }
        : { ...base, shape: "stale", source: "output", production: false };
    }
    return { ...base, shape: "unknown", source: null, production: null };
  }
  // build: once written, the on-disk output is the generated one.
  if (result?.writeOutcome) return { ...base, shape: "current", source: "output", production: true };
  return { ...base, shape: "unknown", source: null, production: null };
}
