/**
 * Shared design contract for Smart Colors derivation recipes.
 *
 * `createDesignTools()` is a self-contained factory: it captures no module-scope
 * binding and imports nothing, so it can be serialized whole with `.toString()`,
 * shipped to a browser or an offline runtime, and re-invoked to obtain the exact
 * same registry. The generator, the CSS formatter and the `analysis.design`
 * metadata all read this single origin, so a recipe or a shared knob cannot be
 * redefined in a second place.
 *
 * It deliberately holds no colour math and no ratio-per-scenario copies: it only
 * names the recipes and the shared mix knobs (the surface source quotas and the
 * bounded dark-blend white cap), plus token binding lookup for consumers that
 * only have a serialized `design` object (session.design / payload.design).
 */

export function createDesignTools() {
  // The bounded white wash of an explicit `dark-blend` (0…100 maps to 0…28% white).
  const DARK_BLEND_WHITE_CAP = 0.28;

  const recipes = {
    // Neutral foundation: canvas, neutral surface, text and focus are design
    // choices; the text pair is the only contrast-checked part.
    "neutral": { kind: "literal", basis: "design", usage: "neutral canvas or surface" },
    "neutral-text": { kind: "contrast", basis: "contrast", usage: "neutral text checked on canvas and surface" },
    "focus": { kind: "contrast", basis: "contrast", usage: "focus ring checked on canvas and surface" },
    // Functional family.
    "identity": { kind: "literal", basis: "design", usage: "direct identity fill (authored source, light) or generated dark" },
    "identity-dark": { kind: "mix", basis: "design", whiteCap: DARK_BLEND_WHITE_CAP, usage: "generated dark identity fill" },
    "ink": { kind: "contrast", basis: "contrast", usage: "companion on the direct identity fill" },
    "surface": { kind: "mix", basis: "design", mix: { light: 0.1, dark: 0.18 }, usage: "soft tinted family background (non-WCAG)" },
    "surface-strong": { kind: "mix", basis: "design", mix: { light: 0.18, dark: 0.28 }, usage: "stronger selected/active family background (non-WCAG)" },
    "text": { kind: "contrast", basis: "contrast", usage: "family text checked on declared surfaces" },
    "text-strong": { kind: "contrast", basis: "contrast", usage: "stronger family text checked on declared surfaces" },
    "border": { kind: "literal", basis: "design", usage: "chromatic border preserving the source" },
    "border-strong": { kind: "contrast", basis: "contrast", usage: "meaningful boundary checked on declared surfaces" },
    "solid": { kind: "literal", basis: "design", usage: "solid fill preserving the source" },
    "solid-hover": { kind: "literal", basis: "design", usage: "resolved hover fill" },
    "solid-text": { kind: "contrast", basis: "contrast", usage: "foreground shared by solid and hover" },
    // Decorative and advanced.
    "decorative": { kind: "design", basis: "design", usage: "theme-adapted ornamental fill (non-WCAG)" },
    "control": { kind: "mix", basis: "design", usage: "control state fill or border (non-WCAG)" },
    "scale": { kind: "literal", basis: "design", usage: "optional numeric tonal step" },
    "hue": { kind: "literal", basis: "design", usage: "optional hue variant" },
    "alias": { kind: "alias", basis: "alias", usage: "alternative name for an existing public color" },
  };

  /**
   * Source quota of a family surface mix. `surface` keeps 10% of the source on
   * the light canvas and 18% on the dark canvas; `surface-strong` keeps 18% / 28%.
   * Returns a fraction (0…1), the same unit the generator uses in `mixOklch`.
   */
  function surfaceRatio(variant, theme) {
    const key = variant === "surface-strong" ? "surface-strong" : "surface";
    const mix = recipes[key].mix;
    return theme === "dark" ? mix.dark : mix.light;
  }

  /**
   * Map an explicit `dark-blend` value (0…100) to the bounded white wash.
   * Returns `{ sourcePercent, whitePercent }` in percent; `whitePercent` never
   * exceeds `DARK_BLEND_WHITE_CAP * 100`. Omitting the descriptor returns `null`,
   * so the caller keeps its role default instead of a 0 that would mean "source".
   */
  function darkBlendMix(value) {
    if (value == null) return null;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const clamped = Math.min(100, Math.max(0, numeric));
    // Four-decimal percentages keep parity with the legacy source-percentage
    // rounding (a fractional `dark-blend`, e.g. 50.1234, stays exact); the UI is
    // responsible for a shorter display format.
    const whitePercent = Number((clamped * DARK_BLEND_WHITE_CAP).toFixed(4));
    return { sourcePercent: Number((100 - whitePercent).toFixed(4)), whitePercent };
  }

  /**
   * Look up the serialized binding of a public colour token in an `analysis.design`
   * payload, merged with its shared recipe. Returns `null` for an unknown token so
   * a report renderer can fall back to the faithful token name.
   */
  function describeToken(design, token, theme) {
    const tokens = design && typeof design === "object" ? design.tokens : null;
    if (!tokens || !Object.prototype.hasOwnProperty.call(tokens, token)) return null;
    const binding = tokens[token];
    const recipeKey = binding.recipe;
    const recipeDefault = (design.recipes && design.recipes[recipeKey]) || null;
    const controls = binding.controls || {};
    return {
      token,
      sources: binding.sources || [],
      recipe: recipeKey || null,
      usage: binding.usage || (recipeDefault && recipeDefault.usage) || null,
      control: controls[theme] || controls.light || null,
      recipeDefault,
    };
  }

  return { recipes, surfaceRatio, darkBlendMix, describeToken };
}
