import { contrast, fitToSrgb, oklch, serializedColor } from "./color-math.mjs";

/**
 * Self-contained factory for the lightness advice shared by the generator, the reports and the
 * browser workbench runtime.
 *
 * `createContrastAdvice(core)` references only its `core` argument and JavaScript built-ins, so
 * `createContrastAdvice.toString()` can be embedded whole and re-invoked in an isolated realm
 * (Node or browser) with no module loader, no Node built-ins and no checkout reference. `core` is
 * the shared numeric contract (`contrast`, `fitToSrgb`, `serializedColor`, `oklch`) — normally
 * `createVerificationCore()` or the re-exports of `./color-math.mjs`. The same factory is invoked
 * the same way in both realms, so the grid search and the serialized output cannot drift apart.
 *
 * The returned `nearestLightness` and `suggestLightness` are pure: they never touch the disk,
 * never mutate their input and never emit CSS beyond the serialized candidate they return.
 */
export function createContrastAdvice(core) {
  const { contrast, fitToSrgb, serializedColor, oklch } = core;

  // The editable lightness grid: 0..1 in 0.0001 steps, i.e. 10001 finite candidates. Both helpers
  // below stay inside this bounded set, so the cost is fixed and independent of the input.
  const LIGHTNESS_STEPS = 10000;
  // WCAG 2.x cannot exceed 21:1 (black on white); the searched target is clamped to this ceiling.
  const MAX_RATIO = 21;

  // Search the editable 4-decimal lightness grid, not the entire OKLCH space.
  // Chroma and hue remain authored; every candidate is checked after CSS serialization.
  function nearestLightness(color, accepts) {
    const candidates = Array.from({ length: LIGHTNESS_STEPS + 1 }, (_, index) => index / LIGHTNESS_STEPS)
      .sort((a, b) => Math.abs(a - color.l) - Math.abs(b - color.l) || a - b);
    for (const l of candidates) {
      const candidate = { ...color, l };
      if (accepts(candidate)) return candidate;
    }
    return null;
  }

  function isFiniteColor(value) {
    return Boolean(value) && typeof value === "object"
      && Number.isFinite(value.l) && Number.isFinite(value.c) && Number.isFinite(value.h);
  }

  function invalid(reason) {
    return { status: "invalid", color: null, value: null, authored: null, deltaL: null, gamutAdjusted: false, reason };
  }

  function unresolved(reason, authored) {
    return { status: "none", color: null, value: null, authored, deltaL: null, gamutAdjusted: false, reason };
  }

  /**
   * Suggest the nearest lightness on the 0..1 grid that clears every declared threshold.
   *
   * `{ color, constraints: [{ other: { l, c, h }, minimum: number }], margin?: number }`
   *
   * - `color` is the token's authored source; chroma and hue are preserved and only `l` is searched.
   * - every `other` is an already-resolved comparison color (`{ l, c, h }`), `minimum` is a WCAG
   *   ratio of at least 1, and the searched target is the minimum plus the margin clamped so it
   *   never rises above 21 (the WCAG ceiling).
   *
   * Returns `{ status, color, value, authored, deltaL, gamutAdjusted, reason }`:
   * - `status` is `"candidate"`, `"none"` or `"invalid"`.
   * - `color` is the resolved emitted candidate `{ l, c, h }` (gamut-fitted and serialized) that a
   *   consumer copies, or `null`.
   * - `value` is the matching `oklch(...)` CSS string, or `null`.
   * - `authored` is the input source color `{ l, c, h }` when the input was valid, else `null`.
   * - `deltaL` is `color.l - authored.l` (the applied lightness shift) or `null`.
   * - `gamutAdjusted` is true when serializing the candidate had to fit its chroma/hue/lightness
   *   into sRGB (the emitted color differs from the candidate's serialized authored form).
   * - `reason` is a short explanation for `"none"`/`"invalid"`, else `null`.
   *
   * This is the nearest lightness that satisfies the thresholds, not a global perceptual nearest
   * match: chroma and hue are never searched, and no ∆E distance is minimized.
   */
  function suggestLightness(input) {
    const source = input && typeof input === "object" ? input : {};
    const color = source.color;
    const constraints = source.constraints;
    const margin = source.margin === undefined ? 0 : source.margin;

    if (!isFiniteColor(color)) return invalid("color must provide finite l, c and h numbers.");
    if (!Number.isFinite(margin) || margin < 0) return invalid("margin must be a finite number greater than or equal to 0.");
    if (!Array.isArray(constraints) || constraints.length === 0) return invalid("constraints must be a non-empty array of { other, minimum }.");
    for (const constraint of constraints) {
      if (!constraint || typeof constraint !== "object" || !isFiniteColor(constraint.other)) {
        return invalid("every constraint must provide other with finite l, c and h numbers.");
      }
      if (!Number.isFinite(constraint.minimum) || constraint.minimum < 1) {
        return invalid("every constraint minimum must be a finite number greater than or equal to 1.");
      }
    }

    const authored = { l: color.l, c: color.c, h: color.h };
    // The margin is clamped so it never raises the target above the WCAG ceiling, and never lowers
    // it below the declared minimum — a minimum already above 21 stays unreachable and returns none.
    const targets = constraints.map((constraint) => ({
      other: { l: constraint.other.l, c: constraint.other.c, h: constraint.other.h },
      target: constraint.minimum + Math.min(margin, Math.max(0, MAX_RATIO - constraint.minimum)),
    }));

    // Acceptance always runs on the serialized gamut-fitted candidate: the emitted value is what a
    // consumer copies, so the check must describe the bytes, never the pre-fit numbers.
    const accepts = (l) => {
      const emitted = serializedColor(fitToSrgb({ l, c: color.c, h: color.h }));
      return targets.every(({ other, target }) => contrast(emitted, other) >= target);
    };

    const candidates = Array.from({ length: LIGHTNESS_STEPS + 1 }, (_, index) => index / LIGHTNESS_STEPS)
      .sort((a, b) => Math.abs(a - color.l) - Math.abs(b - color.l) || a - b);

    let found = null;
    for (const l of candidates) {
      if (accepts(l)) {
        found = l;
        break;
      }
    }
    if (found === null) {
      return unresolved("No lightness on the 0..1 grid (step 0.0001) satisfies every constraint after serialization; the search returns the nearest authored lightness that clears the thresholds, not a global perceptual match.", authored);
    }

    const candidate = { l: found, c: color.c, h: color.h };
    const emitted = serializedColor(fitToSrgb(candidate));
    // Post-serialize recheck: re-express the found candidate exactly as it will be emitted and
    // confirm every constraint still holds on those bytes before reporting a candidate.
    if (!targets.every(({ other, target }) => contrast(emitted, other) >= target)) {
      return unresolved("The nearest authored lightness did not satisfy every constraint after serialization; no candidate is emitted.", authored);
    }

    const serializedCandidate = serializedColor(candidate);
    const gamutAdjusted = emitted.l !== serializedCandidate.l || emitted.c !== serializedCandidate.c || emitted.h !== serializedCandidate.h;
    return {
      status: "candidate",
      color: emitted,
      value: oklch(emitted),
      authored,
      deltaL: Number((emitted.l - authored.l).toFixed(4)),
      gamutAdjusted,
      reason: null,
    };
  }

  return { nearestLightness, suggestLightness };
}

// Node instance of the factory, backed by the shared numeric contract. The module keeps exporting
// the same names the generator, the reports and the tests already consume.
const advice = createContrastAdvice({ contrast, fitToSrgb, serializedColor, oklch });

export const nearestLightness = advice.nearestLightness;
export const suggestLightness = advice.suggestLightness;

export function resolvedColor(color) {
  return serializedColor(fitToSrgb(color));
}

export function solidContrasts(foreground, family) {
  return {
    // Inputs are emitted literals or resolved native mixes, never map them again.
    solid: contrast(foreground, family.solid),
    hover: contrast(foreground, family.solidHover),
  };
}

export function meetsSolidTarget(foreground, family, target) {
  const ratios = solidContrasts(foreground, family);
  return ratios.solid >= target && ratios.hover >= target;
}

export function sourceColorValue(color) {
  return `oklch(${color.l} ${color.c} ${color.h})`;
}

export function contrastSummary(ratios) {
  return `solid ${ratios.solid.toFixed(2)}:1; hover ${ratios.hover.toFixed(2)}:1`;
}
