import type { SmartColorsConfig, SmartColorsUserConfig } from "./defaults.d.ts";

export interface GenerateColorTokensOptions {
  root?: string | URL;
  configFile?: string;
  inlineConfig?: SmartColorsUserConfig;
  config?: SmartColorsConfig;
  check?: boolean;
}

export interface GeneratedSmartColorsOutput {
  path: string;
  changed: boolean;
}

export interface GenerateColorTokensReport {
  changed: boolean;
  css: string;
  motionCss: string | null;
  outputs: GeneratedSmartColorsOutput[];
  config: SmartColorsConfig;
  warnings: string[];
  errors: string[];
}

export declare function generateColorTokens(options?: GenerateColorTokensOptions): Promise<GenerateColorTokensReport>;
