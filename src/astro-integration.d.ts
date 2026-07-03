import type { AstroIntegration } from "astro";
import type { SmartColorsUserConfig } from "./defaults.d.ts";

export type SmartColorsOptions = SmartColorsUserConfig & {
  configFile?: string;
};

export default function smartColors(options?: SmartColorsOptions): AstroIntegration;
