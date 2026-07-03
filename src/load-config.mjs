import { access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { defaultSmartColorsConfig } from "./defaults.mjs";

export const DEFAULT_CONFIG_FILE = "smart-colors.config.mjs";

export async function loadSmartColorsConfig({ root, configFile = DEFAULT_CONFIG_FILE, inlineConfig = {} } = {}) {
  const rootUrl = toUrl(root ?? process.cwd());
  const configUrl = new URL(configFile, rootUrl);
  const fileConfig = await importConfigIfPresent(configUrl);
  return normalizeConfig(mergeConfig(defaultSmartColorsConfig, fileConfig, inlineConfig));
}

export function resolveProjectUrl(root, path) {
  return new URL(path, toUrl(root));
}

async function importConfigIfPresent(configUrl) {
  try {
    await access(configUrl);
  } catch {
    return {};
  }

  const imported = await import(`${configUrl.href}?smart-colors=${Date.now()}`);
  return imported.default ?? imported.config ?? {};
}

function mergeConfig(...configs) {
  return configs.reduce((merged, current) => deepMerge(merged, current ?? {}), {});
}

function deepMerge(target, source) {
  const output = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], value);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function normalizeConfig(config) {
  return {
    ...config,
    roles: {
      ...config.roles,
      identities: normalizeIdentityDefs(config.roles?.identities ?? {}),
      decoratives: normalizeIdentityDefs(config.roles?.decoratives ?? {}, "decorative"),
    },
    aliases: { ...(config.aliases ?? {}) },
    scales: {
      enabled: Boolean(config.scales?.enabled),
      steps: config.scales?.steps ?? [50, 100, 200, 300, 400, 500, 600, 700, 800, 900],
      base: config.scales?.base ?? 500,
      applyTo: config.scales?.applyTo ?? [],
    },
    derivation: {
      surface: { ...{ lightShift: -0.018, darkFactor: 1.6 }, ...(config.derivation?.surface ?? {}) },
      muted: { ...{ chromaFactor: 0.65 }, ...(config.derivation?.muted ?? {}) },
      dark: { ...{ bgLightnessFactor: 0.17, textLightnessFactor: 3.3 }, ...(config.derivation?.dark ?? {}) },
    },
    logo: {
      enabled: Boolean(config.logo?.enabled),
      sources: config.logo?.sources ?? {},
    },
  };
}

function normalizeIdentityDefs(identities, defaultRole = "accent-text") {
  const normalized = {};
  for (const [name, def] of Object.entries(identities)) {
    if (typeof def === "string") {
      normalized[name] = { token: def, role: defaultRole };
    } else {
      normalized[name] = { role: defaultRole, ...def };
    }
  }
  return normalized;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toUrl(value) {
  if (value instanceof URL) return value.href.endsWith("/") ? value : new URL("./", value);
  return pathToFileURL(value.endsWith("/") ? value : `${value}/`);
}
