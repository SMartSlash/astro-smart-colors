export interface IdentityDef {
  token: string;
  role: "accent-text" | "accent-ui" | "soft-surface" | "decorative";
}

export type IdentityConfig = IdentityDef | string;

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
    identities: Record<string, IdentityConfig>;
    decoratives: Record<string, IdentityConfig>;
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

export declare const defaultSmartColorsConfig: SmartColorsConfig;
export declare function defineSmartColorsConfig<T extends Partial<SmartColorsConfig>>(
  config: T,
): T;
