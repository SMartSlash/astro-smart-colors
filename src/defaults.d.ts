export type SmartColorRole = "content" | "action" | "fill" | "decorative";

export interface IdentityInputDef {
  token: string;
  role?: SmartColorRole;
}

export interface ResolvedIdentityDef {
  token: string;
  role: SmartColorRole;
}

export type IdentityConfig = IdentityInputDef | string;

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

export interface SmartColorsConfig {
  palette: string;
  output: string;
  contrast: SmartColorsContrastConfig;
  roles: {
    bg: string;
    ink: string;
    identities: Record<string, ResolvedIdentityDef>;
    decoratives: Record<string, ResolvedIdentityDef>;
    focus: string;
  };
  aliases: Record<string, string>;
  scales: SmartColorScalesConfig;
  derivation: SmartColorsDerivationConfig;
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
    bg?: string;
    ink?: string;
    identities?: Record<string, IdentityConfig>;
    decoratives?: Record<string, IdentityConfig>;
    focus?: string;
  };
  aliases?: Record<string, string>;
  scales?: SmartColorScalesUserConfig;
  derivation?: {
    surface?: Partial<SmartColorsDerivationConfig["surface"]>;
    muted?: Partial<SmartColorsDerivationConfig["muted"]>;
    dark?: Partial<SmartColorsDerivationConfig["dark"]>;
  };
  logo?: {
    enabled?: boolean;
    sources?: Record<string, string>;
  };
}

export declare const defaultSmartColorsConfig: SmartColorsConfig;
export declare function defineSmartColorsConfig(config: SmartColorsUserConfig): SmartColorsUserConfig;
