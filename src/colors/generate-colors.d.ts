import type { SmartColorsConfig, SmartColorsUserConfig } from "./defaults.d.ts";

export interface GenerateColorTokensOptions {
  root?: string | URL;
  configFile?: string;
  inlineConfig?: SmartColorsUserConfig;
  config?: SmartColorsConfig;
  check?: boolean;
  suggest?: boolean;
}

export interface GeneratedSmartColorsOutput {
  path: string;
  changed: boolean;
}

export interface SmartColorsDesignMix {
  mode: "automatic" | "explicit";
  sourcePercent: number | null;
  whitePercent: number | null;
}

export interface SmartColorsDesignSource {
  token: string;
  name: string;
  role: "canvas" | "ink" | "ui" | "feedback" | "decorative";
  darkBlend: number | null;
  darkMix: SmartColorsDesignMix;
}

export interface SmartColorsDesignRecipe {
  kind: string;
  basis: "design" | "contrast" | "alias";
  usage: string;
  mix?: { light: number; dark: number };
  whiteCap?: number;
}

export interface SmartColorsDesignControl {
  /** Full per-theme override token, when the public token reads one. */
  override?: string;
  /** Runtime source-quota knob for a family surface mix. */
  mix?: string;
  /** Generated default of the mix knob, as a fraction (0…1). */
  defaultMix?: number;
}

export interface SmartColorsDesignToken {
  sources: string[];
  recipe: string | null;
  usage: string | null;
  controls: { light: SmartColorsDesignControl; dark: SmartColorsDesignControl };
  /** Alias binding: the public token this one maps to. */
  mappedTo?: string;
  /** Provenance of a derived foreground: whether the readability pipeline adjusted it. */
  provenance?: { adjusted: boolean };
}

/**
 * Serializable design metadata (`analysis.design`). It carries palette intents,
 * the shared recipe registry and one binding per public colour token; it never
 * copies per-scenario colors or invents thresholds. Consumers that only hold this
 * payload resolve a token with `describeToken(design, token, theme)` from
 * `createDesignTools`.
 */
export interface SmartColorsDesignMetadata {
  version: 1;
  sources: SmartColorsDesignSource[];
  recipes: Record<string, SmartColorsDesignRecipe>;
  tokens: Record<string, SmartColorsDesignToken>;
}

export interface GenerateColorTokensReport {
  changed: boolean;
  css: string;
  motionCss: string | null;
  design?: SmartColorsDesignMetadata;
  outputs: GeneratedSmartColorsOutput[];
  config: SmartColorsConfig;
  warnings: string[];
  suggestions: string[];
  errors: string[];
}

export declare function generateColorTokens(options?: GenerateColorTokensOptions): Promise<GenerateColorTokensReport>;
