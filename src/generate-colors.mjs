import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, clamp, fitToSrgb, oklch } from "./color-math.mjs";
import { formatColorsCss, formatColorsMotionCss } from "./format-css.mjs";
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
  const paletteCss = await readFile(paletteUrl, "utf8");
  const parsedPalette = parsePaletteWithDiagnostics(paletteCss);
  const palette = parsedPalette.tokens;
  const annotatedRoles = parsedPalette.annotatedRoles ?? {};
  const mergedConfig = mergeAnnotatedRoles(config, annotatedRoles, palette);
  const inputValidation = validateSmartColorsInput({ config: mergedConfig, palette, paletteErrors: parsedPalette.errors });

  if (inputValidation.errors.length) {
    throw new Error(`Smart Colors validation failed:\n${inputValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const model = buildColorModel(palette, mergedConfig);
  const warnings = [...inputValidation.warnings, ...model.warnings];
  const css = formatColorsCss(model, config);
  const motionCss = config.motion.enabled ? formatColorsMotionCss(model) : null;
  const outputSpecs = [
    { path: config.output, css },
    ...(motionCss == null ? [] : [{ path: config.motion.output, css: motionCss }]),
  ];
  const outputStates = await Promise.all(outputSpecs.map(async (output) => {
    const outputUrl = resolveProjectUrl(root, output.path);
    const current = await readCurrentOutput(outputUrl);
    return { ...output, outputUrl, changed: current !== output.css };
  }));
  const changed = outputStates.some((output) => output.changed);
  const errors = options.check
    ? outputStates
      .filter((output) => output.changed)
      .map((output) => `Generated ${output.path} is out of date. Run smart-colors build.`)
    : [];

  if (!options.check) {
    await Promise.all(outputStates
      .filter((output) => output.changed)
      .map((output) => writeOutputAtomically(output.outputUrl, output.css)));
  }

  return {
    changed,
    css,
    motionCss,
    outputs: outputStates.map((output) => ({ path: output.path, changed: output.changed })),
    config: mergedConfig,
    warnings,
    errors,
  };
}



function mergeAnnotatedRoles(config, annotatedRoles, palette) {
  if (!annotatedRoles || Object.keys(annotatedRoles).length === 0) return config;

  const merged = structuredClone(config);

  // Auto-detect bg and ink from annotated roles (config takes precedence)
  if (!merged.roles.bg) {
    for (const [tokenKey, role] of Object.entries(annotatedRoles)) {
      if (role === "bg") {
        merged.roles.bg = `--${tokenKey}`;
        break;
      }
    }
  }

  if (!merged.roles.ink) {
    for (const [tokenKey, role] of Object.entries(annotatedRoles)) {
      if (role === "ink") {
        merged.roles.ink = `--${tokenKey}`;
        break;
      }
    }
  }

  // Auto-detect focus from annotated roles (first identity, config takes precedence)
  if (!merged.roles.focus) {
    for (const [tokenKey, role] of Object.entries(annotatedRoles)) {
      if (role === "content" || role === "action" || role === "fill") {
        merged.roles.focus = palettePublicName(tokenKey);
        break;
      }
    }
  }

  // Build auto-detected identities/decoratives from annotations
  const detectedIdentities = {};
  const detectedDecoratives = {};

  for (const [tokenKey, role] of Object.entries(annotatedRoles)) {
    if (role === "bg" || role === "ink") continue;
    if (!palette[tokenKey]) continue;

    const publicName = palettePublicName(tokenKey);
    const customProp = `--${tokenKey}`;

    if (role === "decorative") {
      detectedDecoratives[publicName] = { token: customProp, role: "decorative" };
    } else {
      detectedIdentities[publicName] = { token: customProp, role };
    }
  }

  // Merge: config-registered identities/decoratives take precedence over auto-detected.
  // Only keep config entries whose palette tokens actually exist.
  const configIdentities = {};
  for (const [name, def] of Object.entries(merged.roles.identities ?? {})) {
    const key = tokenKey(def.token);
    if (palette[key]) configIdentities[name] = def;
  }
  const configDecoratives = {};
  for (const [name, def] of Object.entries(merged.roles.decoratives ?? {})) {
    const key = tokenKey(def.token);
    if (palette[key]) configDecoratives[name] = def;
  }

  merged.roles.identities = { ...detectedIdentities, ...configIdentities };
  merged.roles.decoratives = { ...detectedDecoratives, ...configDecoratives };

  return merged;
}

function palettePublicName(tokenKey) {
  return tokenKey.startsWith("palette-") ? tokenKey.slice("palette-".length) : tokenKey;
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
  const relativeDark = deriv.dark.mode === "relative";
  const bgDark = relativeDark
    ? mixOklch(bgLight, { l: 0, c: 0, h: bgLight.h }, deriv.dark.bgMixRatio / 100)
    : fitToSrgb({
      l: clamp(bgLight.l * deriv.dark.bgLightnessFactor, 0.08, 0.22),
      c: clamp(bgLight.c * 1.7, 0, 0.05),
      h: bgLight.h,
    });
  const textDark = relativeDark
    ? mixOklch(bgLight, { l: 0.99, c: 0, h: bgLight.h }, deriv.dark.textMixRatio / 100)
    : fitToSrgb({
      l: clamp(textLight.l * deriv.dark.textLightnessFactor, 0.86, 0.96),
      c: clamp(textLight.c * 0.1, 0, 0.02),
      h: textLight.h,
    });

  const surfaceLight = fitToSrgb({
    l: clamp(bgLight.l + deriv.surface.lightShift, 0.9, 0.99),
    c: bgLight.c,
    h: bgLight.h,
  });
  const surfaceDark = relativeDark
    ? mixOklch(bgLight, { l: 0, c: 0, h: bgLight.h }, deriv.dark.surfaceMixRatio / 100)
    : fitToSrgb({
      l: clamp(bgDark.l * deriv.surface.darkFactor, bgDark.l + 0.055, 0.36),
      c: clamp(bgDark.c * 1.15, 0, 0.06),
      h: bgDark.h,
    });

  const textMutedLight = deriveMutedText(textLight, bgLight, minTextContrast, deriv.muted.chromaFactor);
  const textMutedDark = relativeDark
    ? mixOklch(textDark, bgDark, 0.72)
    : deriveMutedText(textDark, bgDark, minTextContrast, deriv.muted.chromaFactor);

  const identities = {};
  const onColors = {};
  const scales = {};

  for (const [name, identityDef] of Object.entries(config.roles.identities)) {
    const paletteKey = tokenKey(identityDef.token);
    const source = palette[paletteKey];

    if (!source) continue;

    const rolePreset = ROLE_PRESETS[identityDef.role] ?? ROLE_PRESETS["content"];
    const light = processIdentityColor(source, bgLight, identityDef.role, lightContrast);
    let dark = processIdentityColor(source, bgDark, identityDef.role, darkContrast);
    let mixRatio = null;

    if (rolePreset.adjustColor && config.derivation.dark.mode !== "static") {
      const darkTarget = getIdentityContrastTarget(identityDef.role, darkContrast);
      if (darkTarget) {
        mixRatio = findDarkMixRatio(source, bgDark, darkTarget);
        dark = mixWithWhite(source, mixRatio / 100);
      }
    }

    if (rolePreset.adjustColor) {
      const lightContrastTarget = getIdentityContrastTarget(identityDef.role, lightContrast);
      const darkContrastTarget = getIdentityContrastTarget(identityDef.role, darkContrast);
      maybeWarnShift(warnings, identityDef.token, name, "light", source, light, bgLight, lightContrastTarget);
      maybeWarnShift(warnings, identityDef.token, name, "dark", source, dark, bgDark, darkContrastTarget);
    }

    identities[name] = { source, light, dark, role: identityDef.role };

    if (mixRatio != null) {
      identities[name].mixRatio = mixRatio;
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
  const rolePreset = ROLE_PRESETS[role] ?? ROLE_PRESETS["content"];

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
  const rolePreset = ROLE_PRESETS[role] ?? ROLE_PRESETS["content"];
  if (!rolePreset.minContrastKey) return null;
  return contrastConfig[rolePreset.minContrastKey];
}

function findDarkMixRatio(source, bgDark, target) {
  let pass = 0.3;
  let fail = 1.0;

  for (let i = 0; i < 32; i += 1) {
    const mid = (pass + fail) / 2;
    const mixed = mixWithWhite(source, mid);

    if (contrast(mixed, bgDark) >= target) {
      pass = mid;
    } else {
      fail = mid;
    }
  }

  return Math.round(pass * 100);
}

function mixWithWhite(color, ratio) {
  return mixOklch(color, { l: 1, c: 0, h: color.h }, ratio);
}

function mixOklch(first, second, firstRatio) {
  const ratio = clamp(firstRatio, 0, 1);
  return fitToSrgb({
    l: first.l * ratio + second.l * (1 - ratio),
    c: first.c * ratio + second.c * (1 - ratio),
    h: first.c === 0 && second.c > 0 ? second.h : first.h,
  });
}



function buildScale(lightColor, darkColor, scaleConfig) {
  const scale = { light: {}, dark: {} };
  const { steps, base } = scaleConfig;

  for (const step of steps) {
    scale.light[step] = buildThemeScaleStep(lightColor, step, steps, base, "light");
    scale.dark[step] = buildThemeScaleStep(darkColor, step, steps, base, "dark");
  }

  return scale;
}

function buildThemeScaleStep(color, step, steps, base, scheme) {
  const minStep = Math.min(...steps);
  const maxStep = Math.max(...steps);
  const baseStep = clamp(base, minStep, maxStep);
  const anchors = scheme === "dark" ? getDarkScaleAnchors(color) : getLightScaleAnchors(color);

  if (step <= baseStep) {
    const t = smoothstep(normalizeRange(step, minStep, baseStep));
    return interpolateColor(anchors.low, color, t);
  }

  const t = smoothstep(normalizeRange(step, baseStep, maxStep));
  return interpolateColor(color, anchors.high, t);
}

function getLightScaleAnchors(color) {
  return {
    low: {
      l: clamp(color.l + (1 - color.l) * 0.94, color.l + 0.08, 0.985),
      c: scaledChroma(color, 0.12, 0.006),
      h: color.h,
    },
    high: {
      l: clamp(color.l * 0.22, 0.08, Math.min(0.34, Math.max(color.l - 0.18, 0.08))),
      c: scaledChroma(color, 0.42, 0.008),
      h: color.h,
    },
  };
}

function getDarkScaleAnchors(color) {
  return {
    low: {
      l: clamp(color.l * 0.18, 0.08, Math.min(0.28, Math.max(color.l - 0.2, 0.08))),
      c: scaledChroma(color, 0.18, 0.006),
      h: color.h,
    },
    high: {
      l: clamp(color.l + (1 - color.l) * 0.74, color.l + 0.12, 0.94),
      c: scaledChroma(color, 0.35, 0.008),
      h: color.h,
    },
  };
}

function interpolateColor(from, to, progress) {
  return fitToSrgb({
    l: lerp(from.l, to.l, progress),
    c: lerp(from.c, to.c, progress),
    h: to.h,
  });
}

function scaledChroma(color, factor, floor) {
  if (color.c === 0) return 0;
  return clamp(color.c * factor, Math.min(floor, color.c), color.c);
}

function normalizeRange(value, min, max) {
  if (max === min) return 1;
  return clamp((value - min) / (max - min), 0, 1);
}

function smoothstep(progress) {
  return progress * progress * (3 - 2 * progress);
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

  const chromaAdjusted = fitToSrgb({ l: cappedL, c: passChroma, h: color.h });
  return contrast(chromaAdjusted, background) >= target ? chromaAdjusted : lightnessOnly;
}

function reduceContrast(color, background, target, floor) {
  let pass = color.l;
  let fail = background.l;

  for (let i = 0; i < 44; i += 1) {
    const mid = (pass + fail) / 2;
    const candidate = fitToSrgb({ l: mid, c: color.c, h: color.h });
    const ratio = contrast(candidate, background);

    if (ratio >= target) {
      pass = mid;
    } else {
      fail = mid;
    }
  }

  const reduced = fitToSrgb({ l: pass, c: color.c, h: color.h });
  return contrast(reduced, background) >= floor ? reduced : color;
}

async function readCurrentOutput(outputUrl) {
  try {
    return await readFile(outputUrl, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function writeOutputAtomically(outputUrl, css) {
  const outputPath = fileURLToPath(outputUrl);
  const outputDirectory = path.dirname(outputPath);
  const temporaryPath = path.join(
    outputDirectory,
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.tmp`,
  );

  await mkdir(outputDirectory, { recursive: true });

  try {
    await writeFile(temporaryPath, css, "utf8");
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}
