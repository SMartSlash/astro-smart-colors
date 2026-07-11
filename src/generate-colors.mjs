import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, clamp, fitToSrgb, oklch } from "./color-math.mjs";
import { formatColorsCss, formatColorsMotionCss } from "./format-css.mjs";
import { loadSmartColorsConfig, resolveProjectUrl } from "./load-config.mjs";
import { parseOklch, parsePalette, parsePaletteWithDiagnostics, tokenKey } from "./parse-palette.mjs";
import { validateSmartColorsInput } from "./validate-config.mjs";

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
  const css = formatColorsCss(model, mergedConfig);
  const motionCss = mergedConfig.motion.enabled ? formatColorsMotionCss(model) : null;
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

  // Auto-detect the foundation from palette annotations (explicit config wins).
  if (!merged.roles.canvas) {
    for (const [tokenKey, role] of Object.entries(annotatedRoles)) {
      if (role === "canvas") {
        merged.roles.canvas = `--${tokenKey}`;
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

  // Prefer the first UI identity for focus; feedback is a safe fallback.
  if (!merged.roles.focus) {
    for (const preferredRole of ["ui", "feedback"]) {
      const match = Object.entries(annotatedRoles).find(([, role]) => role === preferredRole);
      if (match) {
        merged.roles.focus = palettePublicName(match[0]);
        break;
      }
    }
  }

  // Build auto-detected identities/decoratives from annotations
  const detectedIdentities = {};
  const detectedDecoratives = {};

  for (const [tokenKey, role] of Object.entries(annotatedRoles)) {
    if (role === "canvas" || role === "ink") continue;
    if (!palette[tokenKey]) continue;

    const publicName = palettePublicName(tokenKey);
    const customProp = `--${tokenKey}`;

    if (role === "decorative") {
      detectedDecoratives[publicName] = { token: customProp, role: "decorative" };
    } else {
      detectedIdentities[publicName] = { token: customProp, role };
    }
  }

  // Explicit config overrides annotations, but missing entries remain available
  // to input validation instead of being silently removed.
  merged.roles.identities = { ...detectedIdentities, ...(merged.roles.identities ?? {}) };
  merged.roles.decoratives = { ...detectedDecoratives, ...(merged.roles.decoratives ?? {}) };

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
  const darkRichness = config.contrast.darkRichness ?? 1;
  const lightContrast = { text: minTextContrast, ui: minUiContrast, maxIdentity: maxIdentityContrast };
  const darkContrast = {
    text: Math.min(maxIdentityContrast, minTextContrast * darkRichness),
    ui: Math.min(maxIdentityContrast, minUiContrast * darkRichness),
    maxIdentity: maxIdentityContrast,
  };
  const { derivation: deriv } = config;

  const bgLight = fitToSrgb(palette[tokenKey(config.roles.canvas)]);
  const inkSource = fitToSrgb(palette[tokenKey(config.roles.ink)]);
  const relativeDark = deriv.dark.mode === "relative";
  const bgDark = relativeDark
    ? mixOklch(bgLight, { l: 0, c: 0, h: bgLight.h }, deriv.dark.bgMixRatio / 100)
    : fitToSrgb({
      l: clamp(bgLight.l * deriv.dark.bgLightnessFactor, 0.08, 0.22),
      c: clamp(bgLight.c * 1.7, 0, 0.05),
      h: bgLight.h,
    });

  const surfaceLight = fitToSrgb({
    l: clamp(bgLight.l + deriv.surface.lightShift, 0, 1),
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

  const textLight = ensureContrast(inkSource, [bgLight, surfaceLight], minTextContrast + 0.02);
  const white = { l: 0.99, c: 0, h: bgLight.h };
  const textDarkMixRatio = relativeDark
    ? findAccessibleMixRatio(bgLight, white, [bgDark, surfaceDark], darkContrast.text + 0.02, deriv.dark.textMixRatio / 100, "toward-second")
    : null;
  const textDarkSource = relativeDark
    ? mixOklch(bgLight, white, textDarkMixRatio)
    : fitToSrgb({
      l: clamp(inkSource.l * deriv.dark.textLightnessFactor, 0.86, 0.96),
      c: clamp(inkSource.c * 0.1, 0, 0.02),
      h: inkSource.h,
    });
  const textDark = ensureContrast(textDarkSource, [bgDark, surfaceDark], darkContrast.text + 0.02);
  const textMutedLight = ensureContrast(
    deriveMutedText(textLight, bgLight, minTextContrast + 0.02, deriv.muted.chromaFactor),
    [bgLight, surfaceLight],
    minTextContrast + 0.02,
  );
  const textMutedDarkMixRatio = relativeDark
    ? findAccessibleMixRatio(textDark, bgDark, [bgDark, surfaceDark], darkContrast.text + 0.02, 0.72, "toward-first")
    : null;
  const textMutedDark = relativeDark
    ? mixOklch(textDark, bgDark, textMutedDarkMixRatio)
    : ensureContrast(
      deriveMutedText(textDark, bgDark, darkContrast.text + 0.02, deriv.muted.chromaFactor),
      [bgDark, surfaceDark],
      darkContrast.text + 0.02,
    );

  const identities = {};
  const decoratives = {};
  const onColors = {};
  const scales = {};

  for (const [name, identityDef] of Object.entries(config.roles.identities)) {
    const source = palette[tokenKey(identityDef.token)];
    if (!source) continue;

    const family = {
      light: buildFunctionalFamily(source, bgLight, surfaceLight, textLight, lightContrast, "light"),
      dark: buildFunctionalFamily(source, bgDark, surfaceDark, textDark, darkContrast, "dark"),
    };
    const light = family.light.solid;
    const dark = family.dark.solid;

    maybeWarnShift(warnings, identityDef.token, name, "light solid", source, light, bgLight, lightContrast.ui);
    maybeWarnShift(warnings, identityDef.token, name, "dark solid", source, dark, bgDark, darkContrast.ui);

    identities[name] = { source, light, dark, role: identityDef.role, family };
    onColors[name] = {
      light: oklch(family.light.onSolid),
      dark: oklch(family.dark.onSolid),
    };

    if (config.scales.enabled && (config.scales.applyTo.includes(name) || config.scales.applyTo.length === 0)) {
      scales[name] = buildScale(light, dark, config.scales);
    }
  }

  for (const [name, decorativeDef] of Object.entries(config.roles.decoratives ?? {})) {
    const source = palette[tokenKey(decorativeDef.token)];
    if (!source) continue;

    const lightPair = buildReadablePair(fitToSrgb(source), [bgLight, textLight], minTextContrast);
    const darkSource = fitToSrgb({
      l: clamp(lightPair.background.l * 0.72, 0.35, 0.65),
      c: clamp(lightPair.background.c * 0.95, 0.02, lightPair.background.c),
      h: lightPair.background.h,
    });
    const darkPair = buildReadablePair(darkSource, [bgDark, textDark], darkContrast.text);

    decoratives[name] = {
      source,
      light: lightPair.background,
      dark: darkPair.background,
      role: "decorative",
    };
    onColors[name] = {
      light: oklch(lightPair.foreground),
      dark: oklch(darkPair.foreground),
    };
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

  const focusLight = ensureContrast(identities[focusRole].family.light.borderStrong, [bgLight, surfaceLight], minUiContrast + 0.02);
  const focusDark = ensureContrast(identities[focusRole].family.dark.borderStrong, [bgDark, surfaceDark], minUiContrast + 0.02);
  const model = {
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
      textDarkMixRatio: textDarkMixRatio == null ? null : textDarkMixRatio * 100,
      textMutedDarkMixRatio: textMutedDarkMixRatio == null ? null : textMutedDarkMixRatio * 100,
    },
    identities,
    decoratives,
    logoTokens,
    onColors,
    scales,
    focus: { light: focusLight, dark: focusDark },
  };

  const contrastErrors = validateGeneratedContrast(model, config);
  if (contrastErrors.length) {
    throw new Error(`Smart Colors generated an invalid contrast contract:\n${contrastErrors.map((error) => `- ${error}`).join("\n")}`);
  }

  return model;
}

function buildFunctionalFamily(source, background, neutralSurface, ink, contrastConfig, scheme) {
  const textTarget = Math.min(contrastConfig.maxIdentity, contrastConfig.text + 0.02);
  const uiTarget = Math.min(contrastConfig.maxIdentity, contrastConfig.ui + 0.02);
  const surface = mixOklch(source, background, scheme === "light" ? 0.1 : 0.18);
  const surfaceStrong = mixOklch(source, background, scheme === "light" ? 0.18 : 0.28);

  const text = ensureContrast(
    fitContrastBand(source, background, { min: textTarget, max: contrastConfig.maxIdentity }),
    [background, neutralSurface, surface, surfaceStrong],
    textTarget,
  );
  const textStrongTarget = Math.min(contrastConfig.maxIdentity, textTarget + 1);
  const textStrong = ensureContrast(text, [background, neutralSurface, surface, surfaceStrong], textStrongTarget);
  const border = ensureContrast(source, [background, neutralSurface, surface], uiTarget);
  const borderStrongTarget = Math.min(contrastConfig.maxIdentity, uiTarget + 1);
  const borderStrong = ensureContrast(border, [background, neutralSurface, surfaceStrong], borderStrongTarget);
  const solidPair = buildSolidPair(source, background, neutralSurface, ink, uiTarget, textTarget);

  return {
    surface,
    surfaceStrong,
    border,
    borderStrong,
    solid: solidPair.solid,
    solidHover: solidPair.solidHover,
    onSolid: solidPair.onSolid,
    text,
    textStrong,
  };
}

function buildSolidPair(source, background, neutralSurface, ink, uiTarget, textTarget) {
  let solid = ensureContrast(source, [background, neutralSurface], uiTarget);
  const direction = background.l > solid.l ? -1 : 1;
  let solidHover = fitToSrgb({
    l: clamp(solid.l + direction * 0.055, 0.02, 0.98),
    c: solid.c,
    h: solid.h,
  });
  solidHover = ensureContrast(solidHover, [background, neutralSurface], uiTarget);

  const candidates = [background, ink, { l: 0.99, c: 0, h: 0 }, { l: 0.02, c: 0, h: 0 }];
  let onSolid = chooseForeground([solid, solidHover], candidates, textTarget);

  if (Math.min(contrast(onSolid, solid), contrast(onSolid, solidHover)) < textTarget) {
    solid = adjustContrast(solid, onSolid, textTarget);
    solidHover = adjustContrast(solidHover, onSolid, textTarget);
    solid = ensureContrast(solid, [background, neutralSurface], uiTarget);
    solidHover = ensureContrast(solidHover, [background, neutralSurface], uiTarget);
    onSolid = chooseForeground([solid, solidHover], candidates, textTarget);
  }

  return { solid, solidHover, onSolid };
}

function buildReadablePair(background, preferredForegrounds, textTarget) {
  const candidates = [...preferredForegrounds, { l: 0.99, c: 0, h: 0 }, { l: 0.02, c: 0, h: 0 }];
  let adjustedBackground = fitToSrgb(background);
  let foreground = chooseForeground([adjustedBackground], candidates, textTarget + 0.02);

  if (contrast(foreground, adjustedBackground) < textTarget + 0.02) {
    adjustedBackground = adjustContrast(adjustedBackground, foreground, textTarget + 0.02);
    foreground = chooseForeground([adjustedBackground], candidates, textTarget + 0.02);
  }

  return { background: adjustedBackground, foreground };
}

function chooseForeground(backgrounds, candidates, target) {
  const ranked = candidates
    .map((candidate) => ({
      candidate: fitToSrgb(candidate),
      score: Math.min(...backgrounds.map((background) => contrast(candidate, background))),
    }))
    .sort((a, b) => b.score - a.score);

  return (ranked.find(({ score }) => score >= target) ?? ranked[0]).candidate;
}

function validateGeneratedContrast(model, config) {
  const errors = [];
  const tolerance = 0.005;
  const check = (label, foreground, background, target) => {
    const ratio = contrast(foreground, background);
    if (ratio + tolerance < target) {
      errors.push(`${label} is ${ratio.toFixed(2)}:1; expected at least ${target.toFixed(2)}:1.`);
    }
  };

  for (const scheme of ["light", "dark"]) {
    const isLight = scheme === "light";
    const background = isLight ? model.neutrals.bgLight : model.neutrals.bgDark;
    const surface = isLight ? model.neutrals.surfaceLight : model.neutrals.surfaceDark;
    const text = isLight ? model.neutrals.textLight : model.neutrals.textDark;
    const muted = isLight ? model.neutrals.textMutedLight : model.neutrals.textMutedDark;
    const textTarget = isLight
      ? config.contrast.text
      : Math.min(config.contrast.maxIdentity, config.contrast.text * (config.contrast.darkRichness ?? 1));
    const uiTarget = isLight
      ? config.contrast.ui
      : Math.min(config.contrast.maxIdentity, config.contrast.ui * (config.contrast.darkRichness ?? 1));

    check(`${scheme} neutral text / canvas`, text, background, textTarget);
    check(`${scheme} neutral text / surface`, text, surface, textTarget);
    check(`${scheme} muted text / canvas`, muted, background, textTarget);
    check(`${scheme} muted text / surface`, muted, surface, textTarget);
    check(`${scheme} focus / canvas`, model.focus[scheme], background, config.contrast.ui);
    check(`${scheme} focus / surface`, model.focus[scheme], surface, config.contrast.ui);

    for (const [name, identity] of Object.entries(model.identities)) {
      const family = identity.family[scheme];
      check(`${scheme} ${name}-text / canvas`, family.text, background, textTarget);
      check(`${scheme} ${name}-text / neutral surface`, family.text, surface, textTarget);
      check(`${scheme} ${name}-text / family surface`, family.text, family.surface, textTarget);
      check(`${scheme} ${name}-text / family surface strong`, family.text, family.surfaceStrong, textTarget);
      check(`${scheme} ${name}-text-strong / canvas`, family.textStrong, background, textTarget);
      check(`${scheme} ${name}-text-strong / family surface strong`, family.textStrong, family.surfaceStrong, textTarget);
      check(`${scheme} ${name}-border / canvas`, family.border, background, uiTarget);
      check(`${scheme} ${name}-border / family surface`, family.border, family.surface, uiTarget);
      check(`${scheme} ${name}-solid / canvas`, family.solid, background, uiTarget);
      check(`${scheme} ${name}-solid / surface`, family.solid, surface, uiTarget);
      check(`${scheme} ${name}-on-solid / solid`, family.onSolid, family.solid, textTarget);
      check(`${scheme} ${name}-on-solid / solid-hover`, family.onSolid, family.solidHover, textTarget);
    }

    for (const [name, decorative] of Object.entries(model.decoratives)) {
      const decorativeColor = decorative[scheme];
      const onColor = parseOklch(model.onColors[name][scheme]).color;
      check(`${scheme} on-${name} / ${name}`, onColor, decorativeColor, textTarget);
    }
  }

  return errors;
}

function findAccessibleMixRatio(first, second, backgrounds, target, preferredRatio, direction) {
  const preferred = clamp(preferredRatio, 0, 1);
  const meetsTarget = (ratio) => {
    const candidate = mixOklch(first, second, ratio);
    return backgrounds.every((background) => contrast(candidate, background) >= target);
  };

  if (meetsTarget(preferred)) return preferred;

  let pass = direction === "toward-second" ? 0 : 1;
  let fail = preferred;
  if (!meetsTarget(pass)) return preferred;

  for (let index = 0; index < 44; index += 1) {
    const middle = (pass + fail) / 2;
    if (meetsTarget(middle)) {
      pass = middle;
    } else {
      fail = middle;
    }
  }

  return pass;
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
