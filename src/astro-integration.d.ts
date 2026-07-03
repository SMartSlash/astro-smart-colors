import type { AstroIntegration } from "astro";
import type { SmartColorsConfig } from "./defaults.d.ts";

export type SmartColorsOptions = Partial<SmartColorsConfig> & {
  configFile?: string;
};

export default function smartColors(options?: SmartColorsOptions): AstroIntegration;
