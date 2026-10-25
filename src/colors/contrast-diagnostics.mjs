// Internal presentation only: report arrays and CLI exit policy remain unchanged.
export function warningRegresses(previous, current) {
  const labels = new Map(previous.map((warning) => [warning.split(" is ")[0], warning]));
  return current.some((warning) => {
    const before = labels.get(warning.split(" is ")[0]);
    return !before || (warning.includes("Status: below-minimum;") && !before.includes("Status: below-minimum;"));
  });
}
// Match semantic facts, not presentation strings. Passes do not create warning
// labels; dropping below the reference minimum is the existing regression policy.
export function diagnosticsRegress(previous, current) {
  const warnings = (diagnostics) => diagnostics.filter((item) => item.status !== "pass" && item.severity === "warning");
  const labels = new Map(warnings(previous).map((item) => [item.label, item]));
  return warnings(current).some((item) => {
    const before = labels.get(item.label);
    return !before || (item.status === "below-minimum" && before.status !== "below-minimum");
  });
}

export function contrastDiagnostic(label, ratio, target, minimum, usage) {
  const status = ratio < minimum ? "below-minimum" : ratio < target ? "below-target" : "pass";
  const limit = ratio < minimum ? minimum : target;
  let precision = 2;
  if (ratio < limit && Number(ratio.toFixed(2)) >= Number(limit.toFixed(2))) precision = 6;
  const format = (value) => precision === 6 && ratio.toFixed(6) === limit.toFixed(6) ? String(value) : value.toFixed(precision);
  const detail = ratio < target
    ? "the selected foreground does not meet the target on this background."
    : ratio < minimum
      ? "the selected foreground is below the stated minimum on this background."
      : "the selected foreground meets the target and stated minimum on this background.";
  return `${label} is ${format(ratio)}:1 (target ${format(target)}:1) — ${detail} Status: ${status}; ${usage} minimum ${format(minimum)}:1. Ratios use generated defaults, before CSS overrides.`;
}
