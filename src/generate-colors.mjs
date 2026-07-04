import { readFile, writeFile } from "node:fs/promises";
import { contrast, clamp, fitToSrgb, oklch } from "./color-math.mjs";
import { formatColorsCss } from "./format-css.mjs";
import { loadSmartColorsConfig, resolveProjectUrl } from "./load-config.mjs";
import { parsePalette, parsePaletteWithDiagnostics, tokenKey } from "./parse-palette.mjs";
import { validateSmartColorsInput } from "./validate-config.mjs";
import { ROLE_PRESETS } from "./defaults.mjs";

export async function generateColorTokens(options = {}) {
  const root = options.root ?? process.cwd();
  const config = options.config ?? await loadSmartColorsConfig({
    root,
    configFile: options.configFile,
    inlineConfig: options.inlineConfig,
  });

  const paletteUrl = resolveProjectUrl(root, config.palette);
  const outputUrl = resolveProjectUrl(root, config.output);
  const paletteCss = await readFile(paletteUrl, "utf8");
  const parsedPalette = parsePaletteWithDiagnostics(paletteCss);
  const palette = parsedPalette.tokens;
  const inputValidation = validateSmartColorsInput({ config, palette, paletteErrors: parsedPalette.errors });

  if (inputValidation.errors.length) {
    throw new Error(`Smart Colors validation failed:\n${inputValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const model = buildColorModel(palette, config);
  const warnings = [...inputValidation.warnings, ...model.warnings];
  const css = formatColorsCss(model, config);
  const current = await readFile(outputUrl, "utf8").catch(() => "");
  const changed = current !== css;

  if (options.check) {
    return {
      changed,
      css,
      config,
      warnings,
      errors: changed ? [`Generated ${config.output} is out of date. Run smart-colors build.`] : [],
    };
  }

  if (changed) {
    await writeFile(outputUrl, css, "utf8");
  }

  return {
    changed,
    css,
    config,
    warnings,
    errors: [],
  };
}



function buildColorModel(palette, config) {
  const warnings = [];
  const minTextContrast = config.contrast.text;
  const minUiContrast = config.contrast.ui;
  const maxIdentityContrast = config.contrast.maxIdentity;
  const minFocusContrast = config.contrast.ui;
  const darkRichness = config.contrast.darkRichness ?? 1;
  const lightContrast = {
    text: minTextContrast,
    ui: minUiContrast,
    maxIdentity: maxIdentityContrast,
  };
  const darkContrast = {
    text: Math.min(maxIdentityContrast, minTextContrast * darkRichness),
    ui: Math.min(maxIdentityContrast, minUiContrast * darkRichness),
    maxIdentity: maxIdentityContrast,
  };
  const { derivation: deriv } = config;

  const bgLight = fitToSrgb(palette[tokenKey(config.roles.bg)]);
  const textLight = fitToSrgb(palette[tokenKey(config.roles.ink)]);
  const bgDark = fitToSrgb({
    l: clamp(bgLight.l * deriv.dark.bgLightnessFactor, 0.08, 0.22),
    c: clamp(bgLight.c * 1.7, 0, 0.05),
    h: bgLight.h,
  });
  const textDark = fitToSrgb({
    l: clamp(textLight.l * deriv.dark.textLightnessFactor, 0.86, 0.96),
    c: clamp(textLight.c * 0.1, 0, 0.02),
    h: textLight.h,
  });

  const surfaceLight = fitToSrgb({
    l: clamp(bgLight.l + deriv.surface.lightShift, 0.9, 0.99),
    c: bgLight.c,
    h: bgLight.h,
  });
  const surfaceDark = fitToSrgb({
    l: clamp(bgDark.l * deriv.surface.darkFactor, bgDark.l + 0.055, 0.36),
    c: clamp(bgDark.c * 1.15, 0, 0.06),
    h: bgDark.h,
  });

  const textMutedLight = deriveMutedText(textLight, bgLight, minTextContrast, deriv.muted.chromaFactor);
  const textMutedDark = deriveMutedText(textDark, bgDark, minTextContrast, deriv.muted.chromaFactor);

  const identities = {};
  const onColors = {};
  const scales = {};

  for (const [name, identityDef] of Object.entries(config.roles.identities)) {
    const paletteKey = tokenKey(identityDef.token);
    const source = palette[paletteKey];

    if (!source) continue;

    const rolePreset = ROLE_PRESETS[identityDef.role] ?? ROLE_PRESETS["accent-text"];
    const light = processIdentityColor(source, bgLight, identityDef.role, lightContrast);
    const dark = processIdentityColor(source, bgDark, identityDef.role, darkContrast);

    if (rolePreset.adjustColor) {
      const lightContrastTarget = getIdentityContrastTarget(identityDef.role, lightContrast);
      const darkContrastTarget = getIdentityContrastTarget(identityDef.role, darkContrast);
      maybeWarnShift(warnings, identityDef.token, name, "light", source, light, bgLight, lightContrastTarget);
      maybeWarnShift(warnings, identityDef.token, name, "dark", source, dark, bgDark, darkContrastTarget);
    }

    identities[name] = { source, light, dark, role: identityDef.role };

    if (rolePreset.adjustColor && config.derivation.dark.mode !== "static") {
      const darkTarget = getIdentityContrastTarget(identityDef.role, darkContrast);
      if (darkTarget) {
        identities[name].mixRatio = findDarkMixRatio(source, bgDark, darkTarget);
      }
    }

    if (rolePreset.generateOnColor) {
      onColors[name] = {
        light: selectOnColor(light, minTextContrast, [
          { ref: "var(--_color-bg-light)", value: bgLight },
          { ref: "var(--_color-text-light)", value: textLight },
        ]),
        dark: selectOnColor(dark, minTextContrast, [
          { ref: "var(--_color-bg-dark)", value: bgDark },
          { ref: "var(--_color-text-dark)", value: textDark },
        ]),
      };
    } else {
      onColors[name] = null;
    }

    if (config.scales.enabled && (config.scales.applyTo.includes(name) || config.scales.applyTo.length === 0)) {
      scales[name] = buildScale(light, dark, config.scales);
    }
  }

  const decoratives = {};

  for (const [name, decorativeDef] of Object.entries(config.roles.decoratives ?? {})) {
    const paletteKey = tokenKey(decorativeDef.token);
    const source = palette[paletteKey];

    if (!source) continue;

    const light = fitToSrgb(source);
    const dark = fitToSrgb({
      l: clamp(light.l * 0.72, 0.35, 0.65),
      c: clamp(light.c * 0.95, 0.02, light.c),
      h: light.h,
    });

    decoratives[name] = { source, light, dark, role: "decorative" };
  }

  const logoTokens = {};

  if (config.logo.enabled && Object.keys(config.logo.sources ?? {}).length) {
    for (const [name, value] of Object.entries(config.logo.sources)) {
      const parsed = parsePalette(`:root { --l: ${value}; }`);
      const source = parsed["l"];
      if (!source) continue;

      const light = fitToSrgb(source);
      const dark = fitToSrgb({ l: clamp(light.l * 1.5, 0.48, 0.82), c: light.c, h: light.h });
      logoTokens[name] = { light, dark };
    }
  }

  const focusRole = config.roles.focus;
  if (!identities[focusRole]) {
    throw new Error(`Configured focus role "${focusRole}" does not exist in roles.identities.`);
  }

  const focusLight = ensureContrast(identities[focusRole].light, [bgLight, surfaceLight], minFocusContrast);
  const focusDark = ensureContrast(identities[focusRole].dark, [bgDark, surfaceDark], minFocusContrast);

  return {
    warnings,
    neutrals: {
      bgLight,
      bgDark,
      textLight,
      textDark,
      textMutedLight,
      textMutedDark,
      surfaceLight,
      surfaceDark,
    },
    identities,
    decoratives,
    logoTokens,
    onColors,
    scales,
    focus: {
      light: focusLight,
      dark: focusDark,
    },
  };
}

function processIdentityColor(source, background, role, contrastConfig) {
  const rolePreset = ROLE_PRESETS[role] ?? ROLE_PRESETS["accent-text"];

  if (!rolePreset.adjustColor) {
    if (background.l < 0.5) {
      return fitToSrgb({ l: clamp(source.l * 1.5, 0.48, 0.82), c: source.c, h: source.h });
    }
    return fitToSrgb(source);
  }

  const target = getIdentityContrastTarget(role, contrastConfig);
  return fitContrastBand(source, background, { min: target, max: contrastConfig.maxIdentity });
}

function getIdentityContrastTarget(role, contrastConfig) {
  const rolePreset = ROLE_PRESETS[role] ?? ROLE_PRESETS["accent-text"];
  if (!rolePreset.minContrastKey) return null;
  return contrastConfig[rolePreset.minContrastKey];
}

function findDarkMixRatio(source, bgDark, target) {
  let pass = 0.3;
  let fail = 1.0;

  for (let i = 0; i < 32; i += 1) {
    const mid = (pass + fail) / 2;
    const mixed = fitToSrgb({
      l: source.l * mid + 1 * (1 - mid),
      c: source.c * mid,
      h: source.h,
    });

    if (contrast(mixed, bgDark) >= target) {
      pass = mid;
    } else {
      fail = mid;
    }
  }

  return Math.round(pass * 100);
}



function buildScale(lightColor, darkColor, scaleConfig) {
  const scale = { light: {}, dark: {} };
  const { steps, base } = scaleConfig;
  const baseLightness = lightColor.l;

  for (const step of steps) {
    const ratio = step / base;
    scale.light[step] = fitToSrgb({
      l: clamp(baseLightness * (2 - ratio), lightColor.l * 0.15, 0.98),
      c: clamp(lightColor.c * ratio, 0.01, lightColor.c),
      h: lightColor.h,
    });
    scale.dark[step] = buildDarkScaleStep(darkColor, step, steps, base);
  }

  return scale;
}

function buildDarkScaleStep(color, step, steps, base) {
  const minStep = Math.min(...steps);
  const maxStep = Math.max(...steps);
  const baseStep = clamp(base, minStep, maxStep);
  const low = {
    l: clamp(color.l * 0.18, 0.08, 0.24),
    c: clamp(color.c * 0.18, 0.01, color.c),
  };
  const high = {
    l: clamp(color.l + (1 - color.l) * 0.74, color.l + 0.12, 0.94),
    c: clamp(color.c * 0.35, 0.01, color.c),
  };

  if (step <= baseStep) {
    const t = normalizeRange(step, minStep, baseStep);
    return fitToSrgb({
      l: lerp(low.l, color.l, t),
      c: lerp(low.c, color.c, t),
      h: color.h,
    });
  }

  const t = normalizeRange(step, baseStep, maxStep);
  return fitToSrgb({
    l: lerp(color.l, high.l, t),
    c: lerp(color.c, high.c, t),
    h: color.h,
  });
}

function normalizeRange(value, min, max) {
  if (max === min) return 1;
  return clamp((value - min) / (max - min), 0, 1);
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function maybeWarnShift(warnings, token, name, mode, source, generated, background, contrastTarget) {
  if (!contrastTarget) return;

  const deltaL = Math.abs(generated.l - source.l);
  const sourceContrast = contrast(source, background);
  const generatedContrast = contrast(generated, background);

  if (deltaL >= 0.04 || sourceContrast < contrastTarget) {
    warnings.push(
      `${token} (${name}) ${mode} adjusted: contrast ${sourceContrast.toFixed(2)} → ${generatedContrast.toFixed(2)}, ΔL ${deltaL.toFixed(3)}.`,
    );
  }
}

function selectOnColor(background, minTextContrast, candidates) {
  const ranked = candidates
    .map((candidate) => ({ ...candidate, contrast: contrast(candidate.value, background) }))
    .sort((a, b) => b.contrast - a.contrast);

  const passing = ranked.find((candidate) => candidate.contrast >= minTextContrast);
  if (passing) return passing.ref;

  const black = { l: 0.02, c: 0, h: 0 };
  const white = { l: 0.99, c: 0, h: 0 };
  return contrast(black, background) > contrast(white, background) ? oklch(black) : oklch(white);
}

function deriveMutedText(text, background, minTextContrast, chromaFactor) {
  if (contrast(text, background) < minTextContrast) {
    return adjustContrast(text, background, minTextContrast);
  }

  let pass = text.l;
  let fail = background.l;
  const chroma = text.c * chromaFactor;

  for (let i = 0; i < 40; i += 1) {
    const mid = (pass + fail) / 2;
    const candidate = fitToSrgb({ l: mid, c: chroma, h: text.h });

    if (contrast(candidate, background) >= minTextContrast) {
      pass = mid;
    } else {
      fail = mid;
    }
  }

  return fitToSrgb({ l: pass, c: chroma, h: text.h });
}

function fitContrastBand(color, background, { min, max }) {
  let candidate = fitToSrgb(color);
  let current = contrast(candidate, background);

  if (current < min) {
    candidate = adjustContrast(candidate, background, min);
    current = contrast(candidate, background);
  }

  if (max && current > max) {
    candidate = reduceContrast(candidate, background, max, min);
  }

  return fitToSrgb(candidate);
}

function ensureContrast(color, backgrounds, target) {
  return backgrounds.reduce((candidate, background) => {
    return contrast(candidate, background) >= target ? candidate : adjustContrast(candidate, background, target);
  }, color);
}

function adjustContrast(color, background, target) {
  const darken = background.l > color.l;

  let pass = darken ? 0.02 : 0.99;
  let fail = color.l;

  for (let i = 0; i < 44; i += 1) {
    const mid = (pass + fail) / 2;
    const candidate = fitToSrgb({ l: mid, c: color.c, h: color.h });

    if (contrast(candidate, background) >= target) {
      pass = mid;
    } else {
      fail = mid;
    }
  }

  const lightnessOnly = fitToSrgb({ l: pass, c: color.c, h: color.h });
  const deltaL = Math.abs(lightnessOnly.l - color.l);

  if (deltaL <= 0.12) return lightnessOnly;

  const cappedL = darken ? color.l - 0.12 : color.l + 0.12;
  let passChroma = 0;
  let failChroma = color.c;

  for (let i = 0; i < 44; i += 1) {
    const mid = (passChroma + failChroma) / 2;
    const candidate = fitToSrgb({ l: cappedL, c: mid, h: color.h });

    if (contrast(candidate, background) >= target) {
      passChroma = mid;
    } else {
      failChroma = mid;
    }
  }

  return fitToSrgb({ l: cappedL, c: passChroma, h: color.h });
}

function reduceContrast(color, background, target, floor) {
  let pass = color.l;
  let fail = background.l;

  for (let i = 0; i < 44; i += 1) {
    const mid = (pass + fail) / 2;
    const candidate = fitToSrgb({ l: mid, c: color.c, h: color.h });
    const ratio = contrast(candidate, background);

    if (ratio >= target || ratio >= floor) {
      pass = mid;
    } else {
      fail = mid;
    }
  }

  return fitToSrgb({ l: pass, c: color.c, h: color.h });
}
