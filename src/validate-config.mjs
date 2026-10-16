import { ROLE_PRESETS } from "./defaults.mjs";
import { parseOklch, tokenKey } from "./parse-palette.mjs";

const PUBLIC_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;
const CUSTOM_PROPERTY_PATTERN = /^--[a-z0-9-]+$/;
const CORE_PUBLIC_COLOR_NAMES = [
  "bg",
  "surface",
  "text",
  "text-muted",
  "border-subtle",
  "border-strong",
  "focus-ring",
  "control-bg",
  "control-border",
  "control-bg-active",
  "control-border-active",
  "control-active-text",
  "control-focus-bg",
  "control-focus-border",
  "control-icon-muted",
];
const SCALE_SEMANTIC_SUFFIXES = [
  "surface",
  "surface-strong",
  "border",
  "border-strong",
  "solid",
  "solid-hover",
  "on-solid",
  "text",
  "text-strong",
];

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
  validateCustomProperty(config.roles?.canvas, "roles.canvas", errors);
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

    if (!new Set(["ui", "feedback"]).has(identityDef.role)) {
      errors.push(`roles.identities.${name}.role must be either "ui" or "feedback".`);
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

  validateOnSolid(config.onSolid, identityNames, errors);

  validateContrastRatio(config.contrast?.text, "contrast.text", errors);
  validateContrastRatio(config.contrast?.onColor, "contrast.onColor", errors);
  validateContrastRatio(config.contrast?.ui, "contrast.ui", errors);
  validateContrastRatio(config.contrast?.maxIdentity, "contrast.maxIdentity", errors);
  validatePositiveNumber(config.contrast?.darkRichness, "contrast.darkRichness", errors);

  if (
    Number.isFinite(config.contrast?.maxIdentity)
    && Number.isFinite(config.contrast?.text)
    && Number.isFinite(config.contrast?.onColor)
    && Number.isFinite(config.contrast?.ui)
    && config.contrast.maxIdentity < Math.max(config.contrast.text, config.contrast.onColor, config.contrast.ui)
  ) {
    errors.push("contrast.maxIdentity must be greater than or equal to contrast.text, contrast.onColor and contrast.ui.");
  }

  validateNumber(config.derivation?.surface?.lightShift, "derivation.surface.lightShift", errors);
  validatePositiveNumber(config.derivation?.surface?.darkFactor, "derivation.surface.darkFactor", errors);
  validatePositiveNumber(config.derivation?.muted?.chromaFactor, "derivation.muted.chromaFactor", errors, { allowZero: true });
  validatePositiveNumber(config.derivation?.dark?.bgLightnessFactor, "derivation.dark.bgLightnessFactor", errors);
  validatePositiveNumber(config.derivation?.dark?.textLightnessFactor, "derivation.dark.textLightnessFactor", errors);

  if (!new Set(["static", "relative"]).has(config.derivation?.dark?.mode)) {
    errors.push('derivation.dark.mode must be either "static" or "relative".');
  }

  validateMixRatio(config.derivation?.dark?.bgMixRatio, "derivation.dark.bgMixRatio", errors);
  validateMixRatio(config.derivation?.dark?.surfaceMixRatio, "derivation.dark.surfaceMixRatio", errors);
  validateMixRatio(config.derivation?.dark?.textMixRatio, "derivation.dark.textMixRatio", errors);

  validateScales(config.scales, identityNames, errors);
  validateMotion(config.motion, config.output, errors);
  validatePublicTokenCollisions(config, errors);
  validateLogoSources(config.logo, errors);
}

function validateOnSolid(onSolid, identityNames, errors) {
  if (onSolid === undefined) return;
  if (!onSolid || typeof onSolid !== "object" || Array.isArray(onSolid)) {
    errors.push("onSolid must be an object keyed by identity name.");
    return;
  }
  for (const [name, themes] of Object.entries(onSolid)) {
    if (!identityNames.has(name)) errors.push(`onSolid.${name} must reference an existing UI/feedback identity.`);
    if (!themes || typeof themes !== "object" || Array.isArray(themes)) {
      errors.push(`onSolid.${name} must be an object with light and/or dark colors.`);
      continue;
    }
    for (const [scheme, value] of Object.entries(themes)) {
      const label = `onSolid.${name}.${scheme}`;
      if (scheme !== "light" && scheme !== "dark") errors.push(`${label}: only light and dark are supported.`);
      if (typeof value !== "string") {
        errors.push(`${label} must be a concrete opaque OKLCH color.`);
        continue;
      }
      const parsed = parseOklch(value);
      for (const error of parsed.errors) errors.push(`${label}: ${error}`);
    }
  }
}

function validateScales(scales, identityNames, errors) {
  if (!scales) return;

  if (scales.enabled) {
    validateNumberArray(scales.steps, "scales.steps", errors, { positive: true, nonEmpty: true, integer: true, unique: true });
    validatePositiveNumber(scales.base, "scales.base", errors);

    if (Number.isFinite(scales.base) && !Number.isInteger(scales.base)) {
      errors.push("scales.base must be an integer.");
    }

    if (Array.isArray(scales.steps) && Number.isFinite(scales.base) && !scales.steps.includes(scales.base)) {
      errors.push("scales.base must be included in scales.steps.");
    }
  }

  for (const name of scales.applyTo ?? []) {
    if (!identityNames.has(name)) {
      errors.push(`scales.applyTo contains unknown identity "${name}".`);
    }
  }

  const hueVariants = scales.hueVariants;
  if (!hueVariants) return;

  if (hueVariants.enabled) {
    validateNumberArray(hueVariants.shifts, "scales.hueVariants.shifts", errors, { nonEmpty: true, unique: true });

    if (hueVariants.shifts?.length !== 2) {
      hueVariants.shifts?.forEach((shift, index) => {
        if (Number.isFinite(shift) && !Number.isInteger(shift)) {
          errors.push(`scales.hueVariants.shifts[${index}] must be an integer when more than two technical hue token names are generated.`);
        }
      });
    }

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

function validateMotion(motion, colorOutput, errors) {
  if (!motion?.enabled) return;

  if (typeof motion.output !== "string" || motion.output.trim() === "") {
    errors.push("motion.output must be a non-empty project-relative path when motion is enabled.");
    return;
  }

  if (motion.output === colorOutput) {
    errors.push("motion.output must be different from output.");
  }
}

function validatePublicTokenCollisions(config, errors) {
  const registry = new Map();
  const register = (name, owner) => {
    if (!PUBLIC_NAME_PATTERN.test(name)) return;

    if (name.startsWith("tune-")) {
      errors.push(`Public token --color-${name} from ${owner} uses the reserved "tune-" namespace for tuning tokens and identity dark escape hatches.`);
      return;
    }

    const existingOwner = registry.get(name);
    if (existingOwner) {
      errors.push(`Public token --color-${name} would be generated by both ${existingOwner} and ${owner}.`);
      return;
    }

    registry.set(name, owner);
  };

  for (const name of CORE_PUBLIC_COLOR_NAMES) {
    register(name, "the core semantic API");
  }

  for (const [name, identityDef] of Object.entries(config.roles?.identities ?? {})) {
    const owner = `roles.identities.${name}`;
    register(name, owner);

    if (Object.hasOwn(ROLE_PRESETS, identityDef.role) && ROLE_PRESETS[identityDef.role].generateOnColor) {
      register(`on-${name}`, owner);
    }

    for (const suffix of SCALE_SEMANTIC_SUFFIXES) {
      register(`${name}-${suffix}`, `${owner} functional family`);
    }

    const scaleApplies = config.scales?.enabled
      && (config.scales.applyTo?.length === 0 || config.scales.applyTo?.includes(name));

    if (scaleApplies) {
      for (const step of config.scales.steps ?? []) {
        register(`${name}-${step}`, `${owner} scale`);
      }
    }

    const hueVariants = config.scales?.hueVariants;
    if (hueVariants?.enabled && hueVariants.applyTo?.includes(name)) {
      if (hueVariants.shifts?.length === 2) {
        register(`${name}-warm`, `${owner} hue variants`);
        register(`${name}-cool`, `${owner} hue variants`);
      } else {
        for (const shift of hueVariants.shifts ?? []) {
          const direction = shift >= 0 ? "plus" : "minus";
          register(`${name}-hue-${direction}-${Math.abs(shift)}`, `${owner} hue variants`);
        }
      }
    }
  }

  for (const name of Object.keys(config.roles?.decoratives ?? {})) {
    register(name, `roles.decoratives.${name}`);
    register(`on-${name}`, `roles.decoratives.${name}`);
  }

  for (const [alias, target] of Object.entries(config.aliases ?? {})) {
    register(alias, `aliases.${alias}`);
    register(`on-${alias}`, `aliases.${alias}`);

    if (Object.hasOwn(config.roles?.identities ?? {}, target)) {
      for (const suffix of SCALE_SEMANTIC_SUFFIXES) {
        register(`${alias}-${suffix}`, `aliases.${alias} functional family`);
      }
    }
  }
}

function validateLogoSources(logo, errors) {
  if (!logo?.enabled) return;

  const sources = Object.entries(logo.sources ?? {});
  const registry = new Map();
  const register = (name, owner) => {
    const existingOwner = registry.get(name);
    if (existingOwner) {
      errors.push(`Public token --logo-${name} would be generated by both ${existingOwner} and ${owner}.`);
      return;
    }
    registry.set(name, owner);
  };

  for (const [name, value] of sources) {
    validatePublicName(name, `logo.sources.${name}`, errors);
    register(name, `logo.sources.${name}`);

    const parsed = parseOklch(value);
    for (const error of parsed.errors) {
      errors.push(`logo.sources.${name}: ${error}`);
    }
  }

  // Match formatLogoSection: no sources means no logo tokens are emitted.
  if (!sources.length) return;
  register("stroke", "the logo semantic API");
  register("bg-fill", "the logo semantic API");
  if (registry.has("accent")) {
    register("accent-alpha", "the logo.sources.accent alpha companion");
  }
}

function validatePaletteTokens(palette, config, errors, warnings) {
  const required = [
    { token: config.roles.canvas, path: "roles.canvas" },
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
    if (Object.hasOwn(palette, key) && palette[key]) continue;

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

function validateContrastRatio(value, path, errors) {
  validateNumber(value, path, errors);

  if (!Number.isFinite(value)) return;

  if (value < 1 || value > 21) {
    errors.push(`${path} must be between 1 and 21.`);
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

function validateNumberArray(values, path, errors, {
  positive = false,
  nonEmpty = false,
  integer = false,
  unique = false,
} = {}) {
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

    if (integer && Number.isFinite(value) && !Number.isInteger(value)) {
      errors.push(`${itemPath} must be an integer.`);
    }
  });

  if (unique && new Set(values).size !== values.length) {
    errors.push(`${path} must not contain duplicate values.`);
  }
}
