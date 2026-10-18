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
// Pure heading/verdict helpers (no I/O, no painting) so they can be unit-tested
// directly and keep the CLI's exit wording honest on non-zero runs.
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

export function hasBelowMinimum(result) {
  return (result?.problems ?? []).some((problem) => problem.status === "below-minimum");
}

export function buildHeading(result) {
  if (result.strictInvalid) return "Build non completata";
  if (result.exitCode === 0) return "Build completata";
  if ((result.coverage?.launched ?? 0) === 0) return "Build completata · verifica richiesta non disponibile";
  if (!verificationComplete(result)) return "Build completata · verifica incompleta";
  if (hasBelowMinimum(result)) return "Build completata · problemi di contrasto";
  return "Build completata · verifica richiesta non eseguita";
}

export function reportHeading(result) {
  const base = "Report generati";
  if (result.exitCode === 0) return base;
  if (result.strictInvalid) return `${base} · contratto non valido`;
  if (!verificationComplete(result)) return `${base} · verifica incompleta`;
  return `${base} · problemi rilevati`;
}
