export type SmartColorRole = "accent-text" | "accent-ui" | "soft-surface" | "decorative";

export interface IdentityInputDef {
  token: string;
  role?: SmartColorRole;
}

export interface ResolvedIdentityDef {
  token: string;
  role: SmartColorRole;
}

export type IdentityConfig = IdentityInputDef | string;

export interface SmartColorsConfig {
  palette: string;
  output: string;
  contrast: {
    text: number;
    ui: number;
    maxIdentity: number;
  };
  roles: {
    bg: string;
    ink: string;
    identities: Record<string, ResolvedIdentityDef>;
    decoratives: Record<string, ResolvedIdentityDef>;
    focus: string;
  };
  aliases: Record<string, string>;
  scales: {
    enabled: boolean;
    steps: number[];
    base: number;
    applyTo: string[];
  };
  derivation: {
    surface: { lightShift: number; darkFactor: number };
    muted: { chromaFactor: number };
    dark: { bgLightnessFactor: number; textLightnessFactor: number };
  };
  logo: {
    enabled: boolean;
    sources: Record<string, string>;
  };
}

export interface SmartColorsUserConfig {
  palette?: string;
  output?: string;
  contrast?: Partial<SmartColorsConfig["contrast"]>;
  roles?: {
    bg?: string;
    ink?: string;
    identities?: Record<string, IdentityConfig>;
    decoratives?: Record<string, IdentityConfig>;
    focus?: string;
  };
  aliases?: Record<string, string>;
  scales?: Partial<SmartColorsConfig["scales"]>;
  derivation?: {
    surface?: Partial<SmartColorsConfig["derivation"]["surface"]>;
    muted?: Partial<SmartColorsConfig["derivation"]["muted"]>;
    dark?: Partial<SmartColorsConfig["derivation"]["dark"]>;
  };
  logo?: {
    enabled?: boolean;
    sources?: Record<string, string>;
  };
}

export declare const defaultSmartColorsConfig: SmartColorsConfig;
export declare function defineSmartColorsConfig(config: SmartColorsUserConfig): SmartColorsUserConfig;
