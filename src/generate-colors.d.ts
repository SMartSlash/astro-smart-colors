import type { SmartColorsConfig } from "./defaults.d.ts";

export interface GenerateColorTokensOptions {
  root?: string | URL;
  configFile?: string;
  inlineConfig?: Partial<SmartColorsConfig>;
  config?: SmartColorsConfig;
  check?: boolean;
}

export interface GenerateColorTokensReport {
  changed: boolean;
  css: string;
  config: SmartColorsConfig;
  warnings: string[];
  errors: string[];
}

export declare function generateColorTokens(options?: GenerateColorTokensOptions): Promise<GenerateColorTokensReport>;
