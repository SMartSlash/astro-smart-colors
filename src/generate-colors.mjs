import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, clamp, fitToSrgb, mixOklch, oklch, serializedColor } from "./color-math.mjs";
import { formatColorsCss, formatColorsMotionCss } from "./format-css.mjs";
import { DEFAULT_CONFIG_FILE, loadSmartColorsConfig, paletteNotFoundError, resolveProjectUrl } from "./load-config.mjs";
import { contrastSummary, meetsSolidTarget, nearestLightness, resolvedColor, solidContrasts, sourceColorValue } from "./contrast-advice.mjs";
import { parseOklch, parsePalette, parsePaletteWithDiagnostics, tokenKey } from "./parse-palette.mjs";
import { validateSmartColorsInput } from "./validate-config.mjs";
import { validateOutputPaths } from "./output-paths.mjs";
import { bestOnSolid, chooseForeground } from "./foreground-solver.mjs";
import { contrastDiagnostic, diagnosticsRegress } from "./contrast-diagnostics.mjs";

const MAX_DARK_BLEND_WHITE_RATIO = 0.28;

// Internal inspection entry point, deliberately not a separate package export.
// Input/I/O errors throw; contrast errors remain inspectable and never write CSS.
export async function analyzeColorTokens(options = {}, paletteSnapshot) {
  return inspectColorTokens(options, false, paletteSnapshot);
}

async function inspectColorTokens(options, strict, paletteSnapshot) {
  const root = options.root ?? process.cwd();
  const config = options.config ?? await loadSmartColorsConfig({
    root,
    configFile: options.configFile,
    inlineConfig: options.inlineConfig,
  });

  await validateOutputPaths({ root, config, configFile: options.configFile });

  const paletteUrl = resolveProjectUrl(root, config.palette);
  if (paletteSnapshot !== undefined && typeof paletteSnapshot !== "string") throw new TypeError("Palette snapshot must be a CSS string.");
  let paletteCss = paletteSnapshot;
  if (paletteCss === undefined) {
    try {
      paletteCss = await readFile(paletteUrl, "utf8");
    } catch (error) {
      // Only an absent palette is re-typed: EISDIR/EACCES/… stay exactly as they were.
      if (error?.code === "ENOENT") throw paletteNotFoundError({ palettePath: config.palette, root, configFile: options.configFile, cause: error });
      throw error;
    }
  }
  const parsedPalette = parsePaletteWithDiagnostics(paletteCss);
  const palette = parsedPalette.tokens;
  const annotatedRoles = parsedPalette.annotatedRoles ?? {};
  const annotatedDarkBlends = parsedPalette.annotatedDarkBlends ?? {};
  const mergedConfig = mergeAnnotatedRoles(config, annotatedRoles, palette);
  const inputValidation = validateSmartColorsInput({ config: mergedConfig, palette, paletteErrors: parsedPalette.errors });

  if (inputValidation.errors.length) {
    throw new Error(`Smart Colors validation failed:\n${inputValidation.errors.map((error) => `- ${error}`).join("\n")}`);
  }

  const model = buildColorModel(palette, mergedConfig, annotatedDarkBlends);
  if (strict && model.errors.length) {
    throw new Error(`Smart Colors generated an invalid contrast contract:\n${model.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  const warnings = [...inputValidation.warnings, ...model.warnings];
  const advice = options.suggest === false || model.errors.length
    ? { suggestions: [], proposals: [] }
    : buildContrastSuggestions(model, palette, parsedPalette.authoredTokens, mergedConfig, annotatedDarkBlends, options.configFile ?? DEFAULT_CONFIG_FILE, paletteCss);
  const analysis = {
    inputs: { paletteCss },
    model,
    config: mergedConfig,
    palette,
    authoredTokens: parsedPalette.authoredTokens,
    css: formatColorsCss(model, mergedConfig),
    motionCss: mergedConfig.motion.enabled ? formatColorsMotionCss(model) : null,
    diagnostics: model.diagnostics,
    proposals: advice.proposals,
    suggestions: advice.suggestions,
    errors: model.errors,
    warnings,
  };
  // Private snapshot taken before the analysis is exposed: the literal `root`/`configFile` of this
  // call plus clones of the exact config, CSS bytes, motion bytes and diagnostics. The write
  // capability reads only this snapshot, so mutating the exposed analysis object (clearing
  // `analysis.errors`, redirecting `analysis.config.output`, replacing `analysis.css`) or the
  // `options` object afterwards can neither change what is written nor relax the strict contract.
  const snapshot = {
    root,
    configFile: options.configFile,
    config: structuredClone(mergedConfig),
    css: analysis.css,
    motionCss: analysis.motionCss,
    errors: [...model.errors],
    warnings: [...warnings],
    suggestions: [...advice.suggestions],
  };
  // Internal write capability (SC-08, plan §5.1.1). It is a non-enumerable closure, not a package
  // export and not JSON-visible: a forged plain object cannot carry it. It first refuses a tampered
  // analysis, then re-runs `validateOutputPaths` (path collisions and canonical aliases resolved from
  // the filesystem) against the captured bytes, and only then writes the snapshot through an atomic
  // rename. So a stale or tampered analysis can never reach the disk, and `generateColorTokens` never
  // reads a caller-provided analysis.
  Object.defineProperty(analysis, "applyValidatedOutput", {
    value: () => applyValidatedOutput(analysis, snapshot),
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return analysis;
}

// Refuse a mutated analysis instead of trusting the live object it shares with its caller.
function assertAnalysisUnmodified(analysis, snapshot) {
  const changed = analysis.css !== snapshot.css
    || analysis.motionCss !== snapshot.motionCss
    || JSON.stringify(analysis.config) !== JSON.stringify(snapshot.config)
    || JSON.stringify(analysis.errors) !== JSON.stringify(snapshot.errors);
  if (changed) {
    throw new Error("Smart Colors analysis changed after it was validated; no CSS was written.");
  }
}

async function applyValidatedOutput(analysis, snapshot) {
  assertAnalysisUnmodified(analysis, snapshot);
  await validateOutputPaths({ root: snapshot.root, config: snapshot.config, configFile: snapshot.configFile });
  if (snapshot.errors.length) {
    throw new Error(`Smart Colors generated an invalid contrast contract:\n${snapshot.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return writeGeneratedCss({ root: snapshot.root, analysis: snapshot, check: false });
}

export async function generateColorTokens(options = {}) {
  const root = options.root ?? process.cwd();
  // Public entry point: it always performs a full strict analysis and re-validates inputs and
  // output paths. A caller-provided `options.analysis` is ignored on purpose, so the public
  // `./generate` export cannot be used to bypass validation or to overwrite another path.
  const analysis = await inspectColorTokens(options, true);
  return writeGeneratedCss({ root, analysis, check: Boolean(options.check) });
}

// Apply an already-validated analysis to the configured outputs without re-analyzing the palette.
// Reached only through `generateColorTokens` or the internal `applyValidatedOutput` capability.
async function writeGeneratedCss({ root, analysis, check }) {
  const config = analysis.config;
  const css = analysis.css;
  const motionCss = analysis.motionCss;
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
  const errors = check
    ? outputStates
      .filter((output) => output.changed)
      .map((output) => `Generated ${output.path} is out of date. Run smart-colors build.`)
    : [];

  if (!check) {
    await Promise.all(outputStates
      .filter((output) => output.changed)
      .map((output) => writeOutputAtomically(output.outputUrl, output.css)));
  }

  return {
    changed,
    css,
    motionCss,
    outputs: outputStates.map((output) => ({ path: output.path, changed: output.changed })),
    config,
    warnings: analysis.warnings ?? [],
    suggestions: analysis.suggestions ?? [],
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
    if (!Object.hasOwn(palette, tokenKey)) continue;

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

function buildColorModel(palette, config, annotatedDarkBlends = {}) {
  const warnings = [];
  const minTextContrast = config.contrast.text;
  const minOnColorContrast = config.contrast.onColor;
  const minUiContrast = config.contrast.ui;
  const maxIdentityContrast = config.contrast.maxIdentity;
  const darkRichness = config.contrast.darkRichness ?? 1;
  const lightContrast = { baseText: minOnColorContrast, text: minTextContrast, ui: minUiContrast, maxIdentity: maxIdentityContrast };
  const darkContrast = {
    baseText: minOnColorContrast,
    text: Math.min(maxIdentityContrast, minTextContrast * darkRichness),
    ui: Math.min(maxIdentityContrast, minUiContrast * darkRichness),
    maxIdentity: maxIdentityContrast,
  };
  const darkOnColorContrast = Math.min(maxIdentityContrast, minOnColorContrast * darkRichness);
  const { derivation: deriv } = config;

  const bgLight = serializedColor(fitToSrgb(palette[tokenKey(config.roles.canvas)]));
  const inkSource = fitToSrgb(palette[tokenKey(config.roles.ink)]);
  const relativeDark = deriv.dark.mode === "relative";
  const bgDark = relativeDark
    ? mixOklch(bgLight, { l: 0, c: 0, h: null }, deriv.dark.bgMixRatio / 100)
    : serializedColor(fitToSrgb({
      l: clamp(bgLight.l * deriv.dark.bgLightnessFactor, 0.08, 0.22),
      c: clamp(bgLight.c * 1.7, 0, 0.05),
      h: bgLight.h,
    }));

  const surfaceLightSource = {
    l: clamp(bgLight.l + Number(deriv.surface.lightShift.toFixed(4)), 0, 1),
    c: bgLight.c,
    h: bgLight.h,
  };
  const surfaceLight = relativeDark ? surfaceLightSource : serializedColor(fitToSrgb(surfaceLightSource));
  const surfaceDark = relativeDark
    ? mixOklch(bgLight, { l: 0, c: 0, h: null }, deriv.dark.surfaceMixRatio / 100)
    : serializedColor(fitToSrgb({
      l: clamp(bgDark.l * deriv.surface.darkFactor, bgDark.l + 0.055, 0.36),
      c: clamp(bgDark.c * 1.15, 0, 0.06),
      h: bgDark.h,
    }));

  const textLight = serializedColor(ensureContrast(inkSource, [bgLight, surfaceLight], minTextContrast + 0.02, minTextContrast));
  const white = { l: 0.99, c: 0, h: null };
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
  const textDark = relativeDark ? textDarkSource : serializedColor(ensureContrast(textDarkSource, [bgDark, surfaceDark], darkContrast.text + 0.02, darkContrast.text));
  const textMutedLight = serializedColor(ensureContrast(
    deriveMutedText(textLight, bgLight, minTextContrast + 0.02, deriv.muted.chromaFactor),
    [bgLight, surfaceLight],
    minTextContrast + 0.02,
    minTextContrast,
  ));
  const textMutedDarkMixRatio = relativeDark
    ? findAccessibleMixRatio(textDark, bgDark, [bgDark, surfaceDark], darkContrast.text + 0.02, 0.72, "toward-first", darkContrast.text)
    : null;
  const textMutedDark = relativeDark
    ? mixOklch(textDark, bgDark, textMutedDarkMixRatio)
    : serializedColor(ensureContrast(
      deriveMutedText(textDark, bgDark, darkContrast.text + 0.02, deriv.muted.chromaFactor),
      [bgDark, surfaceDark],
      darkContrast.text + 0.02,
      darkContrast.text,
    ));

  const identities = {};
  const decoratives = {};
  const onColors = {};
  const scales = {};

  for (const [name, identityDef] of Object.entries(config.roles.identities)) {
    const paletteKey = tokenKey(identityDef.token);
    const source = palette[paletteKey];
    if (!source) continue;

    const darkBlend = Object.hasOwn(annotatedDarkBlends, paletteKey) ? annotatedDarkBlends[paletteKey] : undefined;
    const { light, dark, mixRatio } = identityColors(source, darkBlend, relativeDark);
    const family = {
      light: buildFunctionalFamily(light, bgLight, surfaceLight, textLight, lightContrast, "light"),
      dark: buildFunctionalFamily(dark, bgDark, surfaceDark, textDark, darkContrast, "dark"),
    };

    if (relativeDark) {
      // These tokens reference the native mix, not a separately gamut-mapped literal.
      family.dark.solid = dark;
      family.dark.border = dark;
    }

    for (const scheme of ["light", "dark"]) {
      const authoredForeground = config.onSolid?.[name]?.[scheme];
      if (authoredForeground !== undefined) {
        family[scheme].onSolid = serializedColor(parseOklch(authoredForeground).color);
      }
    }

    identities[name] = {
      source: light,
      light,
      dark,
      darkBlend: darkBlend ?? null,
      role: identityDef.role,
      family,
      mixRatio,
    };

    // On-colour is computed directly against the identity (source), not the solid.
    onColors[name] = {
      light: oklch(bestOnSolid([light], textLight, minOnColorContrast + 0.02)),
      dark: oklch(bestOnSolid([dark], textDark, minOnColorContrast + 0.02)),
    };

    if (config.scales.enabled && (config.scales.applyTo.includes(name) || config.scales.applyTo.length === 0)) {
      scales[name] = buildScale(family.light.solid, family.dark.solid, config.scales);
    }
  }

  for (const [name, decorativeDef] of Object.entries(config.roles.decoratives ?? {})) {
    const key = tokenKey(decorativeDef.token);
    if (!Object.hasOwn(palette, key)) continue;
    const source = palette[key];

    const lightPair = buildReadablePair(fitToSrgb(source), [bgLight, textLight], minOnColorContrast);
    const darkSource = fitToSrgb({
      l: clamp(lightPair.background.l * 0.72, 0.35, 0.65),
      c: clamp(lightPair.background.c * 0.95, 0.02, lightPair.background.c),
      h: lightPair.background.h,
    });
    const darkPair = buildReadablePair(darkSource, [bgDark, textDark], darkOnColorContrast);

    decoratives[name] = {
      source,
      light: serializedColor(lightPair.background),
      dark: serializedColor(darkPair.background),
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
  if (!Object.hasOwn(identities, focusRole)) {
    throw new Error(`Configured focus role "${focusRole}" does not exist in roles.identities.`);
  }

  const focusLight = ensureContrast(identities[focusRole].family.light.borderStrong, [bgLight, surfaceLight], minUiContrast + 0.02, minUiContrast);
  const focusDark = ensureContrast(identities[focusRole].family.dark.borderStrong, [bgDark, surfaceDark], minUiContrast + 0.02, minUiContrast);
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
    focus: { light: serializedColor(focusLight), dark: serializedColor(focusDark) },
  };

  const contrastResult = validateGeneratedContrast(model, config);
  model.errors = contrastResult.errors;
  model.diagnostics = contrastResult.diagnostics;
  model.warnings.push(...contrastResult.warnings);

  return model;
}

function buildContrastSuggestions(model, palette, authoredTokens, config, darkBlends, configFile, paletteCss) {
  const suggestions = [];
  const proposals = [];
  const target = config.contrast.onColor;
  const safeTarget = Math.min(21, target + 0.02);
  // Match the parser's active syntax selection; disabled examples must not turn
  // a legacy declaration edit into an @property descriptor edit.
  const activeCss = paletteCss.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\r\n]/g, " "));
  const propertySources = /@property\s+--/i.test(activeCss);

  for (const [name, identity] of Object.entries(model.identities)) {
    for (const scheme of ["light", "dark"]) {
      const family = identity.family[scheme];
      const ratios = solidContrasts(family.onSolid, family);
      if (Math.min(ratios.solid, ratios.hover) >= target) continue;

      const token = config.roles.identities[name].token;
      const paletteKey = tokenKey(token);
      const source = authoredTokens[paletteKey];
      const sourceLocation = propertySources ? `@property ${token}` : `:root, ${token}`;
      const foreground = nearestLightness(family.onSolid, (candidate) => meetsSolidTarget(resolvedColor(candidate), family, safeTarget));
      if (foreground) {
        const value = oklch(foreground);
        const trialConfig = {
          ...config,
          onSolid: { ...config.onSolid, [name]: { ...config.onSolid?.[name], [scheme]: value } },
        };
        const trial = buildColorModel(palette, trialConfig, darkBlends);
        const snippet = `onSolid: { ${JSON.stringify(name)}: { ${scheme}: ${JSON.stringify(value)} } }`;
        const impact = `Changes only --color-${name}-solid-text (${scheme}), shared by solid/hover; not --color-${name}-ink or either fill.`;
        const search = "nearest L on a 4-decimal grid with C/H fixed, checked after gamut mapping and serialization; not a global perceptual nearest-color claim";
        proposals.push({
          id: `on-solid:${name}:${scheme}:foreground`, identity: name, scheme, kind: "foreground",
          destination: { file: configFile, path: `onSolid.${name}.${scheme}`, snippet },
          impact, search,
          changes: [{ label: `--color-${name}-solid-text (${scheme})`, before: { ...family.onSolid }, after: { ...trial.identities[name].family[scheme].onSolid } }],
          checks: trial.diagnostics,
        });
        suggestions.push(`${name} (${scheme}): preserve the palette. In ${configFile}, set onSolid.${name}.${scheme}:\n  ${snippet}\n  Verified ${contrastSummary(solidContrasts(trial.identities[name].family[scheme].onSolid, family))}. Fill source: ${config.palette}, ${sourceLocation}, authored ${sourceColorValue(source)}; resolved ${oklch(identity.source)}. ${impact} Search: ${search}. Merge into existing onSolid settings; no changes applied.`);
        continue;
      }

      let verifiedModel;
      const changesFoundation = [config.roles.canvas, config.roles.ink].some((foundation) => tokenKey(foundation) === paletteKey);
      const candidateSource = nearestLightness(source, (candidate) => {
        const materialized = fitToSrgb(candidate);
        if (!changesFoundation) {
          const colors = identityColors(materialized, darkBlends[paletteKey], config.derivation.dark.mode === "relative");
          const background = scheme === "light" ? model.neutrals.bgLight : model.neutrals.bgDark;
          const ink = scheme === "light" ? model.neutrals.textLight : model.neutrals.textDark;
          // Re-select the foreground exactly as regeneration does. The old
          // foreground is a constraint only when it was explicitly authored.
          const pair = buildSolidPair(colors[scheme], background, ink, Math.min(config.contrast.maxIdentity, target + 0.02));
          const authored = config.onSolid?.[name]?.[scheme];
          if (authored !== undefined) pair.onSolid = serializedColor(parseOklch(authored).color);
          if (!meetsSolidTarget(pair.onSolid, pair, safeTarget)) return false;
        }
        const trial = buildColorModel({ ...palette, [paletteKey]: materialized }, config, darkBlends);
        if (trial.errors.length) return false;
        const trialFamily = trial.identities[name].family[scheme];
        if (!meetsSolidTarget(trialFamily.onSolid, trialFamily, safeTarget)) return false;
        if (diagnosticsRegress(model.diagnostics, trial.diagnostics)) return false;
        verifiedModel = trial;
        return true;
      });
      if (candidateSource && verifiedModel) {
        const trial = verifiedModel.identities[name];
        const impact = "Source edits affect the identity, both themes and derived families/scales; logo sources remain separate.";
        const search = "nearest authored L on a 4-decimal grid, C/H fixed, full regeneration verified";
        const destination = {
          file: config.palette,
          path: propertySources ? `@property ${token} / initial-value` : `:root / ${token}`,
          snippet: `${propertySources ? "initial-value" : token}: ${sourceColorValue(candidateSource)};`,
        };
        const sourceEdit = propertySources ? `${sourceLocation}, initial-value` : sourceLocation;
        const declarationAdvice = propertySources ? "" : `\n  ${destination.snippet}`;
        proposals.push({
          id: `on-solid:${name}:${scheme}:palette-source`, identity: name, scheme, kind: "palette-source",
          destination,
          impact, search,
          changes: [{ label: token, before: { ...source }, after: { ...candidateSource } }],
          checks: verifiedModel.diagnostics,
        });
        suggestions.push(`${name} (${scheme}): no text-only suggestion was found on the 4-decimal lightness grid. Optional source adjustment in ${config.palette}, ${sourceEdit}:\n  ${sourceColorValue(source)} -> ${sourceColorValue(candidateSource)}${declarationAdvice}\n  Authored chroma and hue unchanged. Verified light ${contrastSummary(solidContrasts(trial.family.light.onSolid, trial.family.light))}; dark ${contrastSummary(solidContrasts(trial.family.dark.onSolid, trial.family.dark))}. Generation rechecked in both themes with no new contrast warnings. ${impact} Search: ${search}. No changes applied.`);
      } else {
        suggestions.push(`${name} (${scheme}): no verified foreground or source suggestion was found on the 4-decimal lightness grid with chroma and hue fixed. Review the solid/hover pair or onSolid.${name}.${scheme} in ${configFile}; do not edit generated ${config.output}. No changes applied.`);
      }
    }
  }
  return { suggestions, proposals };
}

function identityColors(source, darkBlend, relativeDark) {
  const light = serializedColor(fitToSrgb(source));
  const darkMixRatio = roundPercentage(resolveDarkMixRatio(light, darkBlend) * 100) / 100;
  const mixed = mixOklch(light, { l: 1, c: 0, h: null }, darkMixRatio);
  return {
    light,
    dark: relativeDark ? mixed : serializedColor(fitToSrgb(mixed)),
    mixRatio: roundPercentage(darkMixRatio * 100),
  };
}

function resolveDarkMixRatio(source, darkBlend) {
  if (darkBlend == null) {
    return clamp(0.5 + source.l * 0.5, 0, 1);
  }

  const whiteRatio = (darkBlend / 100) * MAX_DARK_BLEND_WHITE_RATIO;
  return 1 - whiteRatio;
}

function roundPercentage(value) {
  return Number(value.toFixed(4));
}

// The neutral tuning contract emits percentages to two decimal places.
function emittedMixRatio(ratio) {
  return Number((ratio * 100).toFixed(2)) / 100;
}

function buildFunctionalFamily(source, background, neutralSurface, ink, contrastConfig, scheme) {
  // Keep the serialization margin even when the configured target is capped.
  const textTarget = Math.min(contrastConfig.maxIdentity, contrastConfig.text) + 0.02;
  const uiTarget = Math.min(contrastConfig.maxIdentity, contrastConfig.ui + 0.02);
  // On-solid readability uses the base (un-amplified) text target;
  // darkRichness applies to body text only, not to text-on-colour.
  const onSolidTextTarget = Math.min(contrastConfig.maxIdentity, (contrastConfig.baseText ?? contrastConfig.text) + 0.02);
  const surface = serializedColor(fitToSrgb(mixOklch(source, background, scheme === "light" ? 0.1 : 0.18)));
  const surfaceStrong = serializedColor(fitToSrgb(mixOklch(source, background, scheme === "light" ? 0.18 : 0.28)));

  const text = ensureContrast(
    fitContrastBand(source, background, { min: textTarget, max: contrastConfig.maxIdentity }),
    [background, neutralSurface, surface, surfaceStrong],
    textTarget,
    contrastConfig.text,
  );
  const textStrongTarget = Math.min(contrastConfig.maxIdentity, textTarget + 1) + 0.02;
  const textStrong = ensureContrast(text, [background, neutralSurface, surface, surfaceStrong], textStrongTarget, contrastConfig.text);
  // Border and solid preserve the designer's source colour.
  // Contrast against the canvas is the designer's responsibility.
  const border = fitToSrgb(source);
  const borderStrongTarget = Math.min(contrastConfig.maxIdentity, uiTarget + 1);
  const borderStrong = ensureContrast(border, [background, neutralSurface, surface, surfaceStrong], borderStrongTarget, contrastConfig.ui);
  const solidPair = buildSolidPair(source, background, ink, onSolidTextTarget);

  return Object.fromEntries(Object.entries({
    surface,
    surfaceStrong,
    border,
    borderStrong,
    solid: solidPair.solid,
    solidHover: solidPair.solidHover,
    onSolid: solidPair.onSolid,
    text,
    textStrong,
  }).map(([name, color]) => [name, serializedColor(color)]));
}

function deriveSolidStates(source, background) {
  const solid = fitToSrgb(source);
  const direction = background.l > solid.l ? -1 : 1;
  const solidHover = fitToSrgb({
    l: clamp(solid.l + direction * 0.04, 0.02, 0.98),
    c: solid.c,
    h: solid.h,
  });

  return { solid, solidHover };
}

function buildSolidPair(source, background, ink, textTarget) {
  // Rank against the same literals/native mix that the formatter will emit.
  const states = deriveSolidStates(source, background);
  const solid = source;
  const solidHover = serializedColor(states.solidHover);
  const onSolid = bestOnSolid([solid, solidHover], ink, textTarget);

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


function formatContrastShortfall(ratio, target) {
  // Reveal small shortfalls instead of displaying identical rounded values.
  for (const precision of [2, 6]) {
    const measured = ratio.toFixed(precision);
    const required = target.toFixed(precision);
    if (Number(measured) < Number(required)) return [measured, required];
  }
  return [String(ratio), String(target)];
}

function validateGeneratedContrast(model, config) {
  const errors = [];
  const warnings = [];
  const diagnostics = [];
  const record = (scheme, label, foregroundToken, foreground, backgroundToken, background, target, policy, minimum = 4.5, usage = "WCAG AA normal-text reference") => {
    const ratio = contrast(foreground, background);
    const status = ratio < minimum ? "below-minimum" : ratio < target ? "below-target" : "pass";
    // Passing facts retain the check's policy; a minimum-only shortfall is a
    // warning even on strict pairs. Consumers must inspect status, not severity alone.
    const severity = ratio >= target && ratio < minimum ? "warning" : policy;
    const diagnostic = {
      label, scheme, foregroundToken, backgroundToken,
      foreground: { ...foreground }, background: { ...background },
      ratio, target, minimum, kind: minimum === 3 ? "non-text" : "text",
      status, severity, provenance: "generated",
    };
    diagnostics.push(diagnostic);
    if (policy === "error" && ratio < target) {
      const [measured, required] = formatContrastShortfall(ratio, target);
      errors.push(`${label} is ${measured}:1; expected at least ${required}:1. Status: ${status}; ${usage} minimum ${minimum.toFixed(2)}:1. Ratios use generated defaults, before CSS overrides.`);
    } else if (status !== "pass") {
      warnings.push(contrastDiagnostic(label, ratio, target, minimum, usage));
    }
  };

  for (const scheme of ["light", "dark"]) {
    const fail = (label, foregroundToken, foreground, backgroundToken, background, target, minimum, usage) => record(scheme, label, foregroundToken, foreground, backgroundToken, background, target, "error", minimum, usage);
    const warn = (label, foregroundToken, foreground, backgroundToken, background, target, minimum, usage) => record(scheme, label, foregroundToken, foreground, backgroundToken, background, target, "warning", minimum, usage);
    const isLight = scheme === "light";
    const background = isLight ? model.neutrals.bgLight : model.neutrals.bgDark;
    const surface = isLight ? model.neutrals.surfaceLight : model.neutrals.surfaceDark;
    const text = isLight ? model.neutrals.textLight : model.neutrals.textDark;
    const muted = isLight ? model.neutrals.textMutedLight : model.neutrals.textMutedDark;
    const textTarget = isLight
      ? config.contrast.text
      : Math.min(config.contrast.maxIdentity, config.contrast.text * (config.contrast.darkRichness ?? 1));
    const onSolidTextTarget = config.contrast.onColor;
    const uiTarget = isLight
      ? config.contrast.ui
      : Math.min(config.contrast.maxIdentity, config.contrast.ui * (config.contrast.darkRichness ?? 1));

    fail(`${scheme} neutral text / canvas`, "--color-text", text, "--color-bg", background, textTarget);
    fail(`${scheme} neutral text / surface`, "--color-text", text, "--color-surface", surface, textTarget);
    fail(`${scheme} muted text / canvas`, "--color-text-muted", muted, "--color-bg", background, textTarget);
    fail(`${scheme} muted text / surface`, "--color-text-muted", muted, "--color-surface", surface, textTarget);
    fail(`${scheme} focus / canvas`, "--color-focus-ring", model.focus[scheme], "--color-bg", background, config.contrast.ui, 3, "WCAG non-text reference for a necessary indicator");
    fail(`${scheme} focus / surface`, "--color-focus-ring", model.focus[scheme], "--color-surface", surface, config.contrast.ui, 3, "WCAG non-text reference for a necessary indicator");

    for (const [name, identity] of Object.entries(model.identities)) {
      const family = identity.family[scheme];
      const familyBackgrounds = [
        ["canvas", "--color-bg", background],
        ["neutral surface", "--color-surface", surface],
        ["family surface", `--color-${name}-surface`, family.surface],
        ["family surface strong", `--color-${name}-surface-strong`, family.surfaceStrong],
      ];
      for (const [suffix, foreground] of [["text", family.text], ["text-strong", family.textStrong]]) {
        for (const [label, token, color] of familyBackgrounds) {
          fail(`${scheme} ${name}-${suffix} / ${label}`, `--color-${name}-${suffix}`, foreground, token, color, textTarget);
        }
      }
      for (const [label, token, color] of familyBackgrounds) {
        fail(`${scheme} ${name}-border-strong / ${label}`, `--color-${name}-border-strong`, family.borderStrong, token, color, uiTarget, 3, "WCAG non-text reference for a necessary boundary");
      }
      const direct = isLight ? identity.light : identity.dark;
      warn(`${scheme} on-${name} / ${name}`, `--color-${name}-ink`, parseOklch(model.onColors[name][scheme]).source, `--color-${name}`, direct, onSolidTextTarget);
      // Solid and border preserve the designer's source; contrast against canvas is opt-in.
      // On-colour failures are warnings, not errors — the designer owns the trade-off.
      warn(`${scheme} ${name}-on-solid / solid`, `--color-${name}-solid-text`, family.onSolid, `--color-${name}-solid`, family.solid, onSolidTextTarget);
      warn(`${scheme} ${name}-on-solid / solid-hover`, `--color-${name}-solid-text`, family.onSolid, `--color-${name}-solid-hover`, family.solidHover, onSolidTextTarget);
    }

    // Controls are source-derived states, not independently corrected fills.
    // Report their explicit opaque pairs without changing their existing policy.
    const focusIdentity = model.identities[config.roles.focus];
    const focusColor = isLight ? focusIdentity.light : focusIdentity.dark;
    const controlActive = mixOklch(surface, focusColor, isLight ? 0.86 : 0.76);
    const controlFocus = mixOklch(focusColor, background, isLight ? 0.12 : 0.18);
    const controlActiveBorder = mixOklch(focusColor, text, 0.46);
    warn(`${scheme} control active text / active background`, "--color-control-active-text", text, "--color-control-bg-active", controlActive, textTarget);
    warn(`${scheme} control text / focus background`, "--color-text", text, "--color-control-focus-bg", controlFocus, textTarget);
    for (const [label, token, color] of [["canvas", "--color-bg", background], ["active background", "--color-control-bg-active", controlActive]]) {
      warn(`${scheme} control active border / ${label}`, "--color-control-border-active", controlActiveBorder, token, color, config.contrast.ui, 3, "WCAG non-text reference for a necessary boundary");
    }

    for (const [name, decorative] of Object.entries(model.decoratives)) {
      const decorativeColor = decorative[scheme];
      const onColor = parseOklch(model.onColors[name][scheme]).source;
      warn(`${scheme} on-${name} / ${name}`, `--color-${name}-ink`, onColor, `--color-${name}`, decorativeColor, onSolidTextTarget);
    }
  }

  return { errors, warnings, diagnostics };
}

function findAccessibleMixRatio(first, second, backgrounds, target, preferredRatio, direction, minimum = target) {
  const preferred = emittedMixRatio(clamp(preferredRatio, 0, 1));
  const meetsTarget = (ratio, required = target) => {
    const candidate = mixOklch(first, second, ratio);
    return backgrounds.every((background) => contrast(candidate, background) >= required);
  };

  if (meetsTarget(preferred)) return preferred;

  let pass = direction === "toward-second" ? 0 : 1;
  let fail = preferred;
  if (!meetsTarget(pass)) return meetsTarget(pass, minimum) ? pass : preferred;

  for (let index = 0; index < 44; index += 1) {
    const middle = (pass + fail) / 2;
    if (meetsTarget(middle)) pass = middle;
    else fail = middle;
  }

  const emitted = emittedMixRatio(pass);
  // Keep existing emitted defaults when they meet the final contract. A margin
  // is a search aid, not a reason to change an already valid muted-text token.
  if (meetsTarget(emitted, minimum)) return emitted;

  // Search the actual two-decimal percentage grid, rounding toward the passing
  // endpoint rather than returning a continuous solution that CSS cannot emit.
  let passingIndex = direction === "toward-second" ? 0 : 10000;
  let failingIndex = Math.round(emitted * 10000);
  while (Math.abs(passingIndex - failingIndex) > 1) {
    const middle = Math.floor((passingIndex + failingIndex) / 2);
    if (meetsTarget(middle / 10000, minimum)) passingIndex = middle;
    else failingIndex = middle;
  }
  return passingIndex / 10000;
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

function ensureContrast(color, backgrounds, target, minimum = target) {
  const candidate = backgrounds.reduce((current, background) => {
    return contrast(current, background) >= target ? current : adjustContrast(current, background, target);
  }, color);
  const emitted = serializedColor(candidate);
  if (backgrounds.every((background) => contrast(emitted, background) >= minimum)) return candidate;

  // Preserve the established result when it works. Otherwise solve all unchanged
  // backgrounds together, including exact black/white and serialized candidates.
  const fallback = bestOnSolid(backgrounds, color, target);
  const score = (foreground) => Math.min(...backgrounds.map((background) => contrast(foreground, background)));
  return score(fallback) > score(emitted) ? fallback : candidate;
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
  if (contrast(chromaAdjusted, background) >= target) return chromaAdjusted;

  // If all attempts failed (e.g. foreground at extreme can't go further),
  // try the opposite lightness direction.
  const oppositePass = darken ? 0.99 : 0.02;
  const opposite = fitToSrgb({ l: oppositePass, c: 0, h: color.h });
  return contrast(opposite, background) >= contrast(lightnessOnly, background) ? opposite : lightnessOnly;
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
    `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`,
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
