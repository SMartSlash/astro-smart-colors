export const ROLE_PRESETS = {
  "accent-text": { minContrastKey: "text", generateOnColor: true, adjustColor: true },
  "accent-ui": { minContrastKey: "ui", generateOnColor: true, adjustColor: true },
  "soft-surface": { minContrastKey: "text", generateOnColor: true, adjustColor: false, onColorTarget: "text" },
  decorative: { minContrastKey: null, generateOnColor: false, adjustColor: false },
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
      primary: { token: "--palette-primary", role: "accent-text" },
      secondary: { token: "--palette-secondary", role: "accent-ui" },
      tertiary: { token: "--palette-tertiary", role: "soft-surface" },
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
      identities[name] = { token: def, role: "accent-text" };
    } else {
      identities[name] = { role: "accent-text", ...def };
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
