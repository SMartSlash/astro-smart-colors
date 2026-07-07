/**
 * Role presets — how the generator treats each identity color.
 *
 * Pipeline: palette input → [adjustColor?] → [generateOnColor?] → output
 *
 *   adjustColor
 *     If true, shifts lightness/chroma to meet the contrast threshold
 *     defined by minContrastKey. The original hue is preserved.
 *   generateOnColor
 *     If true, creates --color-on-* (WCAG-safe) and --ink-*
 *     (contrast-color based) companion tokens.
 *   minContrastKey
 *     Picks the threshold from config.contrast: "text" (default 4.6)
 *     or "ui" (default 3). Only consulted when adjustColor is true.
 *
 * ─── Role reference ─────────────────────────────────────────────────────
 *
 *   content     Colors meant to be read (text, icons, headings).
 *               Adjusted to WCAG AA text contrast. Generates on-color + ink.
 *
 *   action      Colors for interactive elements (buttons, chips, controls).
 *               Adjusted to WCAG AA UI contrast. Generates on-color + ink.
 *
 *   fill        Colors for tinted surfaces and background fills.
 *               Kept as-is from the palette. Generates on-color + ink.
 *
 *   decorative  Colors for ornaments, gradients, visual detail.
 *               No contrast correction. No companion tokens generated.
 */
export const ROLE_PRESETS = {
  content:     { minContrastKey: "text", generateOnColor: true,  adjustColor: true },
  action:      { minContrastKey: "ui",   generateOnColor: true,  adjustColor: true },
  fill:        { minContrastKey: null,   generateOnColor: true,  adjustColor: false },
  decorative:  { minContrastKey: null,   generateOnColor: false, adjustColor: false },
};

export const defaultSmartColorsConfig = {
  palette: "src/styles/tokens/palette.css",
  output: "src/styles/tokens/colors.css",
  contrast: {
    text: 4.6,
    ui: 3,
    maxIdentity: 7.5,
    darkRichness: 1.15,
  },
  roles: {
    bg: "--palette-bg",
    ink: "--palette-ink",
    identities: {
      primary: { token: "--palette-primary", role: "content" },
      secondary: { token: "--palette-secondary", role: "action" },
      tertiary: { token: "--palette-tertiary", role: "fill" },
    },
    decoratives: {},
    focus: "primary",
  },
  aliases: {
    accent: "secondary",
  },
  scales: {
    enabled: false,
    steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
    base: 500,
    applyTo: [],
    hueVariants: {
      enabled: false,
      shifts: [30, -30],
      applyTo: [],
    },
  },
  derivation: {
    surface: { lightShift: -0.018, darkFactor: 1.6 },
    muted: { chromaFactor: 0.65 },
    dark: { bgLightnessFactor: 0.17, textLightnessFactor: 3.3, mode: "relative", bgMixRatio: 14, surfaceMixRatio: 18, textMixRatio: 88 },
  },
  logo: {
    enabled: false,
    sources: {},
  },
};

export function defineSmartColorsConfig(config) {
  return normalizeIdentities(config);
}

function normalizeIdentities(config) {
  if (!config?.roles?.identities && !config?.roles?.decoratives) return config;

  const identities = {};
  const decoratives = {};

  for (const [name, def] of Object.entries(config.roles?.identities ?? {})) {
    if (typeof def === "string") {
      identities[name] = { token: def, role: "content" };
    } else {
      identities[name] = { role: "content", ...def };
    }
  }

  for (const [name, def] of Object.entries(config.roles?.decoratives ?? {})) {
    if (typeof def === "string") {
      decoratives[name] = { token: def, role: "decorative" };
    } else {
      decoratives[name] = { ...def, role: "decorative" };
    }
  }

  return {
    ...config,
    roles: {
      ...config.roles,
      identities,
      decoratives,
    },
  };
}
