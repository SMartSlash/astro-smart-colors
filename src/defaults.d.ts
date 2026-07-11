export type SmartPaletteRole = "canvas" | "ink" | "ui" | "feedback" | "decorative";
export type SmartFunctionalColorRole = "ui" | "feedback";
export type SmartColorRole = SmartFunctionalColorRole | "decorative";

export interface SmartColorRolePreset {
  generateFamily: boolean;
  generateOnColor: boolean;
}

export declare const ROLE_PRESETS: Record<SmartColorRole, SmartColorRolePreset>;

export interface IdentityInputDef {
  token: string;
  role?: SmartFunctionalColorRole;
}

export interface ResolvedIdentityDef {
  token: string;
  role: SmartFunctionalColorRole;
}

export interface DecorativeInputDef {
  token: string;
  role?: "decorative";
}

export interface ResolvedDecorativeDef {
  token: string;
  role: "decorative";
}

export type IdentityConfig = IdentityInputDef | string;
export type DecorativeConfig = DecorativeInputDef | string;

export interface SmartColorsContrastConfig {
  text: number;
  ui: number;
  maxIdentity: number;
  darkRichness: number;
}

export interface SmartColorHueVariantsConfig {
  enabled: boolean;
  shifts: number[];
  applyTo: string[];
}

export interface SmartColorScalesConfig {
  enabled: boolean;
  steps: number[];
  base: number;
  applyTo: string[];
  hueVariants: SmartColorHueVariantsConfig;
}

export interface SmartColorsDerivationConfig {
  surface: {
    lightShift: number;
    darkFactor: number;
  };
  muted: {
    chromaFactor: number;
  };
  dark: {
    bgLightnessFactor: number;
    textLightnessFactor: number;
    mode: "static" | "relative";
    bgMixRatio: number;
    surfaceMixRatio: number;
    textMixRatio: number;
  };
}

export interface SmartColorsMotionConfig {
  enabled: boolean;
  output: string;
}

export interface SmartColorsConfig {
  palette: string;
  output: string;
  contrast: SmartColorsContrastConfig;
  roles: {
    canvas: string | null;
    ink: string | null;
    identities: Record<string, ResolvedIdentityDef>;
    decoratives: Record<string, ResolvedDecorativeDef>;
    focus: string | null;
  };
  aliases: Record<string, string>;
  scales: SmartColorScalesConfig;
  derivation: SmartColorsDerivationConfig;
  motion: SmartColorsMotionConfig;
  logo: {
    enabled: boolean;
    sources: Record<string, string>;
  };
}

export type SmartColorHueVariantsUserConfig = Partial<SmartColorHueVariantsConfig>;

export type SmartColorScalesUserConfig = Partial<Omit<SmartColorScalesConfig, "hueVariants">> & {
  hueVariants?: SmartColorHueVariantsUserConfig;
};

export interface SmartColorsUserConfig {
  palette?: string;
  output?: string;
  contrast?: Partial<SmartColorsContrastConfig>;
  roles?: {
    canvas?: string | null;
    ink?: string | null;
    identities?: Record<string, IdentityConfig>;
    decoratives?: Record<string, DecorativeConfig>;
    focus?: string | null;
  };
  aliases?: Record<string, string>;
  scales?: SmartColorScalesUserConfig;
  derivation?: {
    surface?: Partial<SmartColorsDerivationConfig["surface"]>;
    muted?: Partial<SmartColorsDerivationConfig["muted"]>;
    dark?: Partial<SmartColorsDerivationConfig["dark"]>;
  };
  motion?: Partial<SmartColorsMotionConfig>;
  logo?: {
    enabled?: boolean;
    sources?: Record<string, string>;
  };
}

export declare const defaultSmartColorsConfig: SmartColorsConfig;
export declare function defineSmartColorsConfig(config: SmartColorsUserConfig): SmartColorsUserConfig;
