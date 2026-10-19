import { styleText } from "node:util";

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
  return measurementAvailable(result) ? "MISURATO" : "STIMA DEL MODELLO";
}

/**
 * One honest verdict, aligned with the exit policy and never positive without a full measurement.
 * Any measured problem (below-minimum OR below-target) is `DA RIVEDERE`; a measured-but-incomplete
 * run is never `OK`; a strict-invalid model is always `ERRORE`.
 * Returns `{ code, label, detail }` where `code` is one of `ok`, `review`, `unverified`, `error`.
 */
export function verdict(result) {
  const coverage = result?.coverage ?? {};
  const mode = result?.mode ?? "auto";

  if (result?.strictInvalid) {
    const count = result?.analysis?.errors?.length ?? 0;
    return {
      code: "error",
      label: "ERRORE",
      detail: `Contratto di contrasto non valido: ${count} ${count === 1 ? "errore" : "errori"} nel modello.`,
    };
  }

  // An empty measured output can never verify green, whatever the coverage says.
  if (cssState(result).shape === "empty") {
    return { code: "unverified", label: "NON VERIFICATO", detail: "output vuoto: nessuna verifica positiva possibile." };
  }

  if (measurementAvailable(result)) {
    const problems = result?.problems ?? [];
    if (problems.length) {
      return {
        code: "review",
        label: "DA RIVEDERE",
        detail: `${problems.length} ${problems.length === 1 ? "coppia misurata" : "coppie misurate"} sotto soglia.`,
      };
    }
    if (verificationComplete(result)) {
      return { code: "ok", label: "OK", detail: "nessuna coppia misurata sotto soglia." };
    }
    // Measured and clean, but the coverage is partial: never promoted to OK.
    return { code: "unverified", label: "NON VERIFICATO", detail: "verifica incompleta: copertura parziale, nessun esito positivo confermato." };
  }

  if (coverage.mode === "off" || coverage.status === "disabled") {
    return { code: "unverified", label: "NON VERIFICATO", detail: "automazione disattivata: nessuna coppia misurata nel browser." };
  }
  if ((coverage.launched ?? 0) === 0) {
    return {
      code: "unverified",
      label: "NON VERIFICATO",
      detail: mode === "required"
        ? "verifica richiesta non disponibile: nessun motore avviato."
        : "nessun motore avviato: nessuna coppia misurata nel browser.",
    };
  }
  return { code: "unverified", label: "NON VERIFICATO", detail: "verifica incompleta: copertura parziale, nessun esito positivo confermato." };
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

/**
 * One line naming what a read-only report actually measured, or null when nothing needs saying.
 * `stale` names the real file it read (never a "candidate"); `absent` states the diagnostic
 * candidate explicitly; `empty` refuses any green. The path is raw — the caller owns escaping.
 */
export function cssNotice(state) {
  if (!state || typeof state !== "object") return null;
  switch (state.shape) {
    case "stale": return `Misurato su ${state.path}: i byte letti divergono dai token generati dal modello.`;
    case "absent": return "Output assente: i risultati si riferiscono a un candidato diagnostico, non alla produzione.";
    case "empty": return `L'output ${state.path} è vuoto: nessuna verifica positiva possibile.`;
    default: return null;
  }
}
