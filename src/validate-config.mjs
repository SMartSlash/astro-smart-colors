import { ROLE_PRESETS } from "./defaults.mjs";
import { parseOklch, tokenKey } from "./parse-palette.mjs";

const PUBLIC_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const CUSTOM_PROPERTY_PATTERN = /^--[a-z0-9-]+$/;

export function validateSmartColorsInput({ config, palette, paletteErrors = [] }) {
  const errors = [];
  const warnings = [];

  for (const error of paletteErrors) {
    errors.push(`palette: ${error}`);
  }

  validateConfigShape(config, errors);
  validatePaletteTokens(palette, config, errors, warnings);

  return { errors, warnings };
}

function validateConfigShape(config, errors) {
  validateCustomProperty(config.roles?.bg, "roles.bg", errors);
  validateCustomProperty(config.roles?.ink, "roles.ink", errors);

  const identityEntries = Object.entries(config.roles?.identities ?? {});
  const decorativeEntries = Object.entries(config.roles?.decoratives ?? {});
  const identityNames = new Set(identityEntries.map(([name]) => name));
  const publicColorNames = new Set([
    ...identityEntries.map(([name]) => name),
    ...decorativeEntries.map(([name]) => name),
  ]);

  for (const [name, identityDef] of identityEntries) {
    validatePublicName(name, `roles.identities.${name}`, errors);
    validateCustomProperty(identityDef.token, `roles.identities.${name}.token`, errors);

    if (!ROLE_PRESETS[identityDef.role]) {
      errors.push(`roles.identities.${name}.role must be one of: ${Object.keys(ROLE_PRESETS).join(", ")}.`);
    }
  }

  for (const [name, decorativeDef] of decorativeEntries) {
    validatePublicName(name, `roles.decoratives.${name}`, errors);
    validateCustomProperty(decorativeDef.token, `roles.decoratives.${name}.token`, errors);

    if (decorativeDef.role !== "decorative") {
      errors.push(`roles.decoratives.${name}.role must be "decorative".`);
    }
  }

  if (!config.roles?.focus || !identityNames.has(config.roles.focus)) {
    errors.push(`roles.focus must reference an existing identity (${[...identityNames].join(", ") || "none configured"}).`);
  }

  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    validatePublicName(alias, `aliases.${alias}`, errors);

    if (!publicColorNames.has(target)) {
      errors.push(`aliases.${alias} must reference an existing public color (${[...publicColorNames].join(", ") || "none configured"}).`);
    }
  }

  validatePositiveNumber(config.contrast?.text, "contrast.text", errors);
  validatePositiveNumber(config.contrast?.ui, "contrast.ui", errors);
  validatePositiveNumber(config.contrast?.maxIdentity, "contrast.maxIdentity", errors);
  validatePositiveNumber(config.contrast?.darkRichness, "contrast.darkRichness", errors);

  if (Number.isFinite(config.contrast?.maxIdentity) && Number.isFinite(config.contrast?.text) && config.contrast.maxIdentity < config.contrast.text) {
    errors.push("contrast.maxIdentity must be greater than or equal to contrast.text.");
  }

  validateNumber(config.derivation?.surface?.lightShift, "derivation.surface.lightShift", errors);
  validatePositiveNumber(config.derivation?.surface?.darkFactor, "derivation.surface.darkFactor", errors);
  validatePositiveNumber(config.derivation?.muted?.chromaFactor, "derivation.muted.chromaFactor", errors, { allowZero: true });
  validatePositiveNumber(config.derivation?.dark?.bgLightnessFactor, "derivation.dark.bgLightnessFactor", errors);
  validatePositiveNumber(config.derivation?.dark?.textLightnessFactor, "derivation.dark.textLightnessFactor", errors);
  validateMixRatio(config.derivation?.dark?.bgMixRatio, "derivation.dark.bgMixRatio", errors);
  validateMixRatio(config.derivation?.dark?.surfaceMixRatio, "derivation.dark.surfaceMixRatio", errors);
  validateMixRatio(config.derivation?.dark?.textMixRatio, "derivation.dark.textMixRatio", errors);

  validateScales(config.scales, identityNames, errors);
  validateLogoSources(config.logo, errors);
}

function validateScales(scales, identityNames, errors) {
  if (!scales) return;

  if (scales.enabled) {
    validateNumberArray(scales.steps, "scales.steps", errors, { positive: true, nonEmpty: true });
    validatePositiveNumber(scales.base, "scales.base", errors);
  }

  for (const name of scales.applyTo ?? []) {
    if (!identityNames.has(name)) {
      errors.push(`scales.applyTo contains unknown identity "${name}".`);
    }
  }

  const hueVariants = scales.hueVariants;
  if (!hueVariants) return;

  if (hueVariants.enabled) {
    validateNumberArray(hueVariants.shifts, "scales.hueVariants.shifts", errors, { nonEmpty: true });

    if (!hueVariants.applyTo?.length) {
      errors.push("scales.hueVariants.applyTo must list at least one identity when hue variants are enabled.");
    }
  }

  for (const name of hueVariants.applyTo ?? []) {
    if (!identityNames.has(name)) {
      errors.push(`scales.hueVariants.applyTo contains unknown identity "${name}".`);
    }
  }
}

function validateLogoSources(logo, errors) {
  if (!logo?.enabled) return;

  for (const [name, value] of Object.entries(logo.sources ?? {})) {
    validatePublicName(name, `logo.sources.${name}`, errors);

    const parsed = parseOklch(value);
    for (const error of parsed.errors) {
      errors.push(`logo.sources.${name}: ${error}`);
    }
  }
}

function validatePaletteTokens(palette, config, errors, warnings) {
  const required = [
    { token: config.roles.bg, path: "roles.bg" },
    { token: config.roles.ink, path: "roles.ink" },
    ...Object.entries(config.roles.identities ?? {}).map(([name, identityDef]) => ({
      token: getPaletteToken(identityDef),
      path: `roles.identities.${name}`,
    })),
  ];
  const optionalDecoratives = Object.entries(config.roles.decoratives ?? {}).map(([name, decorativeDef]) => ({
    token: getPaletteToken(decorativeDef),
    path: `roles.decoratives.${name}`,
  }));

  const missingRequired = collectMissingPaletteEntries(required, palette);
  const missingDecoratives = collectMissingPaletteEntries(optionalDecoratives, palette);

  for (const entry of missingRequired) {
    errors.push(`Missing required palette token ${formatMissingPaletteEntry(entry)}.`);
  }

  if (missingDecoratives.length) {
    warnings.push(`Missing decorative palette tokens skipped: ${missingDecoratives.map(formatMissingPaletteEntry).join(", ")}.`);
  }
}

function getPaletteToken(definition) {
  return typeof definition === "string" ? definition : definition?.token;
}

function collectMissingPaletteEntries(entries, palette) {
  const missing = new Map();

  for (const entry of entries) {
    if (!entry.token || !CUSTOM_PROPERTY_PATTERN.test(entry.token)) continue;

    const key = tokenKey(entry.token);
    if (palette[key]) continue;

    if (!missing.has(key)) {
      missing.set(key, { token: `--${key}`, paths: [] });
    }

    missing.get(key).paths.push(entry.path);
  }

  return [...missing.values()];
}

function formatMissingPaletteEntry(entry) {
  return `${entry.token} (${entry.paths.join(", ")})`;
}

function validatePublicName(value, path, errors) {
  if (!PUBLIC_NAME_PATTERN.test(value ?? "")) {
    errors.push(`${path} must use kebab-case public names matching ${PUBLIC_NAME_PATTERN}.`);
  }
}

function validateCustomProperty(value, path, errors) {
  if (!CUSTOM_PROPERTY_PATTERN.test(value ?? "")) {
    errors.push(`${path} must be a custom property matching ${CUSTOM_PROPERTY_PATTERN}.`);
  }
}

function validateNumber(value, path, errors) {
  if (!Number.isFinite(value)) {
    errors.push(`${path} must be a finite number.`);
  }
}

function validatePositiveNumber(value, path, errors, { allowZero = false } = {}) {
  validateNumber(value, path, errors);

  if (!Number.isFinite(value)) return;

  if (allowZero ? value < 0 : value <= 0) {
    errors.push(`${path} must be ${allowZero ? "greater than or equal to" : "greater than"} 0.`);
  }
}

function validateMixRatio(value, path, errors) {
  validateNumber(value, path, errors);

  if (!Number.isFinite(value)) return;

  if (value < 0 || value > 100) {
    errors.push(`${path} must be between 0 and 100.`);
  }
}

function validateNumberArray(values, path, errors, { positive = false, nonEmpty = false } = {}) {
  if (!Array.isArray(values)) {
    errors.push(`${path} must be an array of numbers.`);
    return;
  }

  if (nonEmpty && values.length === 0) {
    errors.push(`${path} must contain at least one value.`);
  }

  values.forEach((value, index) => {
    const itemPath = `${path}[${index}]`;
    if (positive) {
      validatePositiveNumber(value, itemPath, errors);
    } else {
      validateNumber(value, itemPath, errors);
    }
  });
}
