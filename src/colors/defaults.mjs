/**
 * Designer-facing role presets.
 *
 * Roles classify intent; they do not select a single contrast threshold.
 * Functional variants (`surface`, `border`, `solid`, `on-solid`, `text`) own
 * their accessibility guarantees and are generated for every UI/feedback
 * color. Decorative colors retain more of the authored appearance but still
 * receive a deterministic readable companion.
 */
export const ROLE_PRESETS = {
  ui:          { generateFamily: true,  generateOnColor: true },
  feedback:    { generateFamily: true,  generateOnColor: true },
  decorative:  { generateFamily: false, generateOnColor: true },
};

export const DEFAULT_REPORT_DIRECTORY = "smart-colors-reports";

export const defaultSmartColorsConfig = {
  palette: "src/styles/tokens/palette.css",
  output: "src/styles/tokens/colors.css",
  contrast: {
    text: 4.6,
    onColor: 4.6,
    ui: 3,
    maxIdentity: 7.5,
    darkRichness: 1.15,
  },
  roles: {
    canvas: null,
    ink: null,
    identities: {},
    decoratives: {},
    focus: null,
  },
  aliases: {},
  onSolid: {},
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
  motion: {
    enabled: false,
    output: "src/styles/colors-motion.css",
  },
  logo: {
    enabled: false,
    sources: {},
  },
  reports: {
    directory: DEFAULT_REPORT_DIRECTORY,
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
      identities[name] = { token: def, role: "ui" };
    } else {
      identities[name] = { role: "ui", ...def };
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
