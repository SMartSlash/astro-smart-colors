import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defaultSmartColorsConfig } from "./defaults.mjs";

export const DEFAULT_CONFIG_FILE = "smart-colors.config.mjs";

// Typed markers for the two "absent input" cases the CLI must diagnose clearly. They travel on
// `smartColorsCode`; `code` keeps the underlying filesystem code (`ENOENT`) so existing callers that
// branch on `error.code` — including the Astro integration — stay unchanged. Other I/O failures
// (EISDIR, EACCES, evaluation errors, missing module deps) are left untouched.
export const SMART_COLORS_CONFIG_NOT_FOUND = "SMART_COLORS_CONFIG_NOT_FOUND";
export const SMART_COLORS_PALETTE_NOT_FOUND = "SMART_COLORS_PALETTE_NOT_FOUND";

/**
 * Build the typed "config not found" error for an explicitly selected config file.
 *
 * `code` stays `ENOENT` (compatibility), `smartColorsCode` carries the typed marker, the original
 * ENOENT is preserved as `cause`, the resolved file path as `path`, and the effective
 * `configFile`/`root` travel as metadata so a CLI can format its own localized message.
 */
export function configNotFoundError({ configFile, root, resolvedPath, cause }) {
  const filePath = cause?.path ?? resolvedPath ?? (configFile == null ? DEFAULT_CONFIG_FILE : configFile);
  const error = new Error(`Smart Colors config not found: ${filePath} (ENOENT). Provide an existing --config file or remove the option; nothing was written.`);
  error.code = cause?.code ?? "ENOENT";
  error.smartColorsCode = SMART_COLORS_CONFIG_NOT_FOUND;
  error.configFile = configFile;
  error.root = root;
  error.path = filePath;
  if (cause) error.cause = cause;
  return error;
}

/**
 * Build the typed "palette not found" error with the effective palette path, root and config file.
 *
 * Palette absence is the one case where an empty read would otherwise degrade into misleading
 * contract errors ("roles.canvas must be a custom property", …). Naming the path and the bootstrap
 * step keeps build, report and check coherent. `code` stays `ENOENT` and the marker is
 * `smartColorsCode`; the original ENOENT, when available, is the cause.
 */
export function paletteNotFoundError({ palettePath, root, configFile, resolvedPath, cause }) {
  const effectiveConfig = configFile ?? DEFAULT_CONFIG_FILE;
  const resolvedRoot = root ?? process.cwd();
  const error = new Error(`Smart Colors palette not found: ${palettePath} (ENOENT). Looked up under ${resolvedRoot} with config ${effectiveConfig}; create the palette first, for example by running "smart-colors init", then rerun.`);
  error.code = cause?.code ?? "ENOENT";
  error.smartColorsCode = SMART_COLORS_PALETTE_NOT_FOUND;
  error.palettePath = palettePath;
  error.configFile = effectiveConfig;
  error.root = resolvedRoot;
  error.path = resolvedPath ?? cause?.path ?? fileURLToPath(resolveProjectUrl(resolvedRoot, palettePath));
  if (cause) error.cause = cause;
  return error;
}

export async function loadSmartColorsConfig({ root, configFile, inlineConfig = {} } = {}) {
  const resolvedRoot = root ?? process.cwd();
  const optional = configFile === undefined;
  const configUrl = resolveProjectUrl(resolvedRoot, configFile ?? DEFAULT_CONFIG_FILE);
  const fileConfig = await importConfigIfPresent(configUrl, optional, { root: resolvedRoot, configFile });
  return normalizeConfig(mergeConfig(defaultSmartColorsConfig, fileConfig, inlineConfig));
}

/**
 * Resolve a project-relative input path to a file URL.
 *
 * Built from the filesystem path (`path.resolve` + `pathToFileURL`), not `new URL(value, root)`, so a
 * `#` or `%` in a file name is taken literally instead of being parsed as a fragment/escape. An
 * already-absolute value with a real scheme (for example a remote URL) is preserved as-is, matching
 * the previous behaviour. Backslashes are normalized to `/` as before.
 */
export function resolveProjectUrl(root, projectPath) {
  const value = String(projectPath);
  if (ABSOLUTE_URL_SCHEME.test(value)) return new URL(value);
  return pathToFileURL(path.resolve(rootToPath(root), value.replaceAll("\\", "/")));
}

// A scheme needs at least two characters before ':' so a Windows drive letter (`c:`) is not treated
// as an absolute URL here.
const ABSOLUTE_URL_SCHEME = /^[a-z][a-z0-9+.-]+:/i;

function rootToPath(root) {
  if (root instanceof URL) return fileURLToPath(root.href.endsWith("/") ? root : new URL("./", root));
  return path.resolve(root == null ? process.cwd() : String(root));
}

async function importConfigIfPresent(configUrl, optional, { root, configFile } = {}) {
  try {
    await access(configUrl);
  } catch (error) {
    if (optional && error.code === "ENOENT") return {};
    if (!optional && error.code === "ENOENT") throw configNotFoundError({ configFile, root, resolvedPath: fileURLToPath(configUrl), cause: error });
    throw error;
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
    if (key === "aliases" && isPlainObject(value)) {
      output[key] = { ...value };
    } else if (isPlainObject(value) && isPlainObject(output[key])) {
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
      hueVariants: {
        enabled: Boolean(config.scales?.hueVariants?.enabled),
        shifts: config.scales?.hueVariants?.shifts ?? [30, -30],
        applyTo: config.scales?.hueVariants?.applyTo ?? [],
      },
    },
    derivation: {
      surface: { ...{ lightShift: -0.018, darkFactor: 1.6 }, ...(config.derivation?.surface ?? {}) },
      muted: { ...{ chromaFactor: 0.65 }, ...(config.derivation?.muted ?? {}) },
      dark: { ...{ bgLightnessFactor: 0.17, textLightnessFactor: 3.3, mode: "relative", bgMixRatio: 14, surfaceMixRatio: 18, textMixRatio: 88 }, ...(config.derivation?.dark ?? {}) },
    },
    motion: {
      enabled: Boolean(config.motion?.enabled),
      output: config.motion?.output ?? "src/styles/colors-motion.css",
    },
    logo: {
      enabled: Boolean(config.logo?.enabled),
      sources: config.logo?.sources ?? {},
    },
  };
}

function normalizeIdentityDefs(identities, defaultRole = "ui") {
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
