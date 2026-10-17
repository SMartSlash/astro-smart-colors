import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { contrast, fitToSrgb, mixOklch as nativeMixOklch } from "../src/color-math.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { parseOklch } from "../src/parse-palette.mjs";

const DEFAULT_PALETTE = `@property --palette-canvas {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.962 0.015 88);
  role: canvas;
}

@property --palette-ink {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.28 0.007 3.68);
  role: ink;
}

@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.16 32);
  role: ui;
}

@property --palette-secondary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.54 0.108 198);
  role: feedback;
}

@property --palette-tertiary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.88 0.12 85);
  role: decorative;
}`;

const SEMANTIC_SUFFIXES = [
  "surface",
  "surface-strong",
  "border",
  "border-strong",
  "solid",
  "solid-hover",
  "solid-text",
  "text",
  "text-strong",
];

async function createProject(t, paletteCss = DEFAULT_PALETTE) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-"));
  const tokenDir = path.join(root, "src/styles/tokens");
  await mkdir(tokenDir, { recursive: true });
  await writeFile(path.join(tokenDir, "palette.css"), paletteCss, "utf8");
  await writeFile(path.join(tokenDir, "colors.css"), "", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function getDeclarations(css) {
  const declarations = new Map();
  const pattern = /(?:^|\n)\s*(--[a-z0-9_-]+)\s*:\s*([^;]+);/gi;

  for (const match of css.matchAll(pattern)) {
    declarations.set(match[1], match[2].trim());
  }

  return declarations;
}

function getDeclaration(css, tokenName) {
  const value = getDeclarations(css).get(tokenName);
  assert.ok(value, `Expected generated token ${tokenName}.`);
  return value;
}

function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;

    if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(value.slice(start).trim());
  return parts;
}

function unwrapFunction(value, functionName) {
  const prefix = `${functionName}(`;
  if (!value.startsWith(prefix) || !value.endsWith(")")) return null;
  return value.slice(prefix.length, -1).trim();
}

function resolveThemeColor(declarations, tokenName, scheme, stack = []) {
  assert.ok(!stack.includes(tokenName), `Circular custom-property reference: ${[...stack, tokenName].join(" -> ")}`);
  const value = declarations.get(tokenName);
  assert.ok(value, `Expected generated token ${tokenName}.`);
  return resolveColorExpression(declarations, value, scheme, [...stack, tokenName]);
}

function resolveColorExpression(declarations, expression, scheme, stack) {
  const value = expression.trim();
  const lightDarkBody = unwrapFunction(value, "light-dark");

  if (lightDarkBody != null) {
    const choices = splitTopLevel(lightDarkBody);
    assert.equal(choices.length, 2, `Expected two light-dark() colors in ${value}.`);
    return resolveColorExpression(declarations, choices[scheme === "light" ? 0 : 1], scheme, stack);
  }

  const varBody = unwrapFunction(value, "var");
  if (varBody != null) {
    const [reference, fallback] = splitTopLevel(varBody);
    if (declarations.has(reference)) return resolveThemeColor(declarations, reference, scheme, stack);
    assert.ok(fallback, `Expected ${reference} or a fallback in ${value}.`);
    return resolveColorExpression(declarations, fallback, scheme, stack);
  }

  const mixBody = unwrapFunction(value, "color-mix");
  if (mixBody != null) {
    const [space, weighted, second] = splitTopLevel(mixBody);
    assert.equal(space, "in oklch");
    const match = /^(.*)\s+(?:var\((--[a-z0-9_-]+),\s*(\d+(?:\.\d+)?)%\)|(\d+(?:\.\d+)?)%)$/.exec(weighted);
    assert.ok(match, `Expected a weighted mix in ${value}.`);
    const firstColor = resolveColorExpression(declarations, match[1], scheme, stack);
    const secondColor = resolveColorExpression(declarations, second, scheme, stack);
    const rawPct = match[2] && declarations.has(match[2])
      ? declarations.get(match[2]).replace(/%$/, "")
      : (match[3] ?? match[4]);
    const ratio = Number(rawPct) / 100;
    let delta = secondColor.h - firstColor.h;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return {
      l: firstColor.l * ratio + secondColor.l * (1 - ratio),
      c: firstColor.c * ratio + secondColor.c * (1 - ratio),
      h: (firstColor.h + delta * (1 - ratio) + 360) % 360,
    };
  }

  const parsed = parseOklch(value);
  assert.deepEqual(parsed.errors, [], `Expected a resolvable OKLCH color, received ${value}.`);
  return parsed.source;
}

function getLightnessSteps(css, name) {
  return [...css.matchAll(new RegExp(`--color-${name}-(\\d+): light-dark\\(oklch\\(([^\\s]+)`, "g"))]
    .map((match) => ({ step: Number(match[1]), lightness: Number(match[2]) }))
    .sort((a, b) => a.step - b.step);
}



function getDarkScaleColor(css, name, step) {
  const value = getDeclaration(css, `--color-${name}-${step}`);
  const lightDarkBody = unwrapFunction(value, "light-dark");
  assert.ok(lightDarkBody, `Expected light-dark() in --color-${name}-${step}.`);
  const choices = splitTopLevel(lightDarkBody);
  const parsed = parseOklch(choices[1]);
  assert.deepEqual(parsed.errors, []);
  return parsed.source;
}



function assertColorClose(actual, expected, label) {
  assert.ok(Math.abs(actual.l - expected.l) <= 0.001, `${label} lightness ${actual.l} should be close to ${expected.l}.`);
  assert.ok(Math.abs(actual.c - expected.c) <= 0.001, `${label} chroma ${actual.c} should be close to ${expected.c}.`);
  assert.ok(Math.abs(actual.h - expected.h) <= 0.001, `${label} hue ${actual.h} should be close to ${expected.h}.`);
}

function mixOklch(first, second, firstRatio) {
  return fitToSrgb({
    l: first.l * firstRatio + second.l * (1 - firstRatio),
    c: first.c * firstRatio + second.c * (1 - firstRatio),
    h: first.h,
  });
}

function getPercentageDeclaration(css, tokenName) {
  const value = getDeclaration(css, tokenName);
  assert.match(value, /^\d+(?:\.\d+)?%$/);
  return Number.parseFloat(value) / 100;
}

function assertMinContrast(foreground, background, target, label) {
  const ratio = contrast(foreground, background);
  assert.ok(
    ratio >= target,
    `${label} contrast ${ratio} should be at least ${target}.`,
  );
}

test("designer-facing roles map to canvas, ui, feedback and decorative output", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({ root });
  const declarations = getDeclarations(report.css);

  assert.equal(report.config.roles.canvas, "--palette-canvas");
  assert.equal(Object.hasOwn(report.config.roles, "bg"), false);
  assert.equal(report.config.roles.identities.primary.role, "ui");
  assert.equal(report.config.roles.identities.secondary.role, "feedback");
  assert.equal(report.config.roles.decoratives.tertiary.role, "decorative");

  for (const name of ["primary", "secondary"]) {
    for (const suffix of SEMANTIC_SUFFIXES) {
      assert.ok(declarations.has(`--color-${name}-${suffix}`), `Expected --color-${name}-${suffix} without numeric scales.`);
    }
  }

  assert.doesNotMatch(report.css, /--color-(?:primary|secondary)-\d+:/);
  assert.match(getDeclaration(report.css, "--color-tertiary"), /^light-dark\(/);
  assert.match(getDeclaration(report.css, "--color-tertiary-ink"), /^light-dark\(/);

  for (const scheme of ["light", "dark"]) {
    assert.ok(declarations.has(`--_color-tertiary-${scheme}`));
    assert.ok(declarations.has(`--_color-on-tertiary-${scheme}`));
  }
});

test("numeric scales are optional and never source semantic role families", async (t) => {
  const root = await createProject(t);
  const withoutScales = await generateColorTokens({ root });
  const withScales = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary", "secondary"],
      },
    },
  });

  assert.match(withScales.css, /--color-primary-500: light-dark\(/);
  assert.match(withScales.css, /--color-secondary-500: light-dark\(/);

  for (const name of ["primary", "secondary"]) {
    for (const suffix of SEMANTIC_SUFFIXES) {
      const tokenName = `--color-${name}-${suffix}`;
      const withoutScaleValue = getDeclaration(withoutScales.css, tokenName);
      const withScaleValue = getDeclaration(withScales.css, tokenName);

      assert.equal(withScaleValue, withoutScaleValue, `${tokenName} must not change when numeric scales are enabled.`);
      assert.doesNotMatch(withScaleValue, new RegExp(`var\\(--color-${name}-\\d+\\)`));
    }
  }
});

test("semantic families validate adapted text and report source-preserving on-solid shortfalls", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      derivation: {
        dark: { mode: "static" },
      },
    },
  });
  const declarations = getDeclarations(report.css);

  for (const scheme of ["light", "dark"]) {
    const neutralBackgrounds = [
      ["bg", resolveThemeColor(declarations, "--color-bg", scheme)],
      ["surface", resolveThemeColor(declarations, "--color-surface", scheme)],
    ];

    for (const name of ["primary", "secondary"]) {
      const familyBackgrounds = [
        ...neutralBackgrounds,
        ["family surface", resolveThemeColor(declarations, `--color-${name}-surface`, scheme)],
        ["family surface-strong", resolveThemeColor(declarations, `--color-${name}-surface-strong`, scheme)],
      ];

      for (const textToken of ["text", "text-strong"]) {
        const text = resolveThemeColor(declarations, `--color-${name}-${textToken}`, scheme);
        for (const [backgroundName, background] of familyBackgrounds) {
          assertMinContrast(text, background, 4.6, `${scheme} ${name}-${textToken} vs ${backgroundName}`);
        }
      }

      const identity = resolveThemeColor(declarations, `--color-${name}`, scheme);
      for (const suffix of ["border", "solid"]) {
        const color = resolveThemeColor(declarations, `--color-${name}-${suffix}`, scheme);
        assertColorClose(color, identity, `${scheme} ${name}-${suffix} preserves the identity`);
      }

      const borderStrong = resolveThemeColor(declarations, `--color-${name}-border-strong`, scheme);
      for (const [backgroundName, background] of neutralBackgrounds) {
        assertMinContrast(borderStrong, background, 3, `${scheme} ${name}-border-strong vs ${backgroundName}`);
      }

      const onSolid = resolveThemeColor(declarations, `--color-${name}-solid-text`, scheme);
      for (const solidToken of ["solid", "solid-hover"]) {
        const solid = resolveThemeColor(declarations, `--color-${name}-${solidToken}`, scheme);
        const label = `${scheme} ${name}-on-solid / ${solidToken}`;
        const ratio = contrast(onSolid, solid);
        const warning = report.warnings.find((message) => message.startsWith(`${label} is `));
        // Only this known fixture pair misses the target; other pairs must not regress into warnings.
        if (scheme === "light" && name === "primary" && solidToken === "solid-hover") {
          assert.ok(ratio < report.config.contrast.onColor);
          assert.ok(warning, `Expected a warning for ${label}, not a source-color correction.`);
          assert.ok(warning.includes(`${ratio.toFixed(2)}:1`));
          assert.ok(warning.includes("the selected foreground does not meet the target on this background."));
        } else {
          assert.equal(warning, undefined, `Unexpected warning for ${label}.`);
          assertMinContrast(onSolid, solid, report.config.contrast.onColor, label);
        }
      }
    }

    const decorative = resolveThemeColor(declarations, "--color-tertiary", scheme);
    const onDecorative = resolveThemeColor(declarations, "--color-tertiary-ink", scheme);
    assertMinContrast(onDecorative, decorative, 4.6, `${scheme} on-tertiary vs tertiary`);
  }
});

test("an unattainable common on-solid target warns without rewriting the source or hover", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: { derivation: { dark: { mode: "static" } } },
  });
  const declarations = getDeclarations(report.css);
  const solid = resolveThemeColor(declarations, "--color-primary-solid", "light");
  const hover = resolveThemeColor(declarations, "--color-primary-solid-hover", "light");
  const onSolid = resolveThemeColor(declarations, "--color-primary-solid-text", "light");

  assertColorClose(solid, { l: 0.62, c: 0.16, h: 32 }, "authored primary solid");
  assertColorClose(hover, fitToSrgb({ ...solid, l: 0.58 }), "source-derived hover");
  // Even black on hover and white on solid miss the target: no common foreground can pass both.
  assert.ok(contrast({ l: 0, c: 0, h: 0 }, hover) < report.config.contrast.onColor);
  assert.ok(contrast({ l: 1, c: 0, h: 0 }, solid) < report.config.contrast.onColor);
  assert.ok(contrast(onSolid, hover) < report.config.contrast.onColor - 0.005);
  assertMinContrast(onSolid, solid, 4.5, "fixture on-solid vs solid WCAG AA");
  assertMinContrast(onSolid, hover, 4.5, "fixture on-solid vs hover WCAG AA");
  assert.ok(report.warnings.some((warning) => warning.startsWith("light primary-on-solid / solid-hover is ")));
  assert.deepEqual(report.errors, []);
});

test("custom UI and feedback colors survive low canvas contrast while text variants remain accessible", async (t) => {
  const palette = DEFAULT_PALETTE
    .replace("oklch(0.62 0.16 32)", "oklch(0.8254 0.161821 89.164188)")
    .replace("oklch(0.54 0.108 198)", "oklch(0.56 0.12 260)")
    .replaceAll("role: ui;", "role: ui;\n  dark-blend: 0;")
    .replaceAll("role: feedback;", "role: feedback;\n  dark-blend: 0;");
  const root = await createProject(t, palette);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      contrast: { text: 7, darkRichness: 1 },
      derivation: { dark: { mode: "static" } },
    },
  });
  const declarations = getDeclarations(report.css);
  const authored = {
    primary: fitToSrgb({ l: 0.8254, c: 0.161821, h: 89.164188 }),
    secondary: fitToSrgb({ l: 0.56, c: 0.12, h: 260 }),
  };

  for (const scheme of ["light", "dark"]) {
    for (const [name, source] of Object.entries(authored)) {
      for (const suffix of ["", "-border", "-solid"]) {
        assertColorClose(resolveThemeColor(declarations, `--color-${name}${suffix}`, scheme), source, `${scheme} ${name}${suffix}`);
      }
      const backgrounds = ["--color-bg", "--color-surface", `--color-${name}-surface`, `--color-${name}-surface-strong`];
      for (const suffix of ["text", "text-strong"]) {
        const text = resolveThemeColor(declarations, `--color-${name}-${suffix}`, scheme);
        for (const token of backgrounds) {
          assertMinContrast(text, resolveThemeColor(declarations, token, scheme), 7, `${scheme} ${name}-${suffix} vs ${token}`);
        }
      }
    }
  }

  const primary = resolveThemeColor(declarations, "--color-primary-solid", "light");
  const canvas = resolveThemeColor(declarations, "--color-bg", "light");
  assert.ok(contrast(primary, canvas) < report.config.contrast.ui);
  assertMinContrast(resolveThemeColor(declarations, "--color-secondary-solid-text", "light"), resolveThemeColor(declarations, "--color-secondary-solid", "light"), report.config.contrast.onColor, "improved secondary foreground vs unchanged solid");
    assert.ok(!report.warnings.some((warning) => warning.startsWith("light secondary-on-solid / solid is ")));
  assert.deepEqual(report.errors, []);
});

test("text tokens can enforce WCAG AAA without raising on-color contrast", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      contrast: {
        text: 7,
        onColor: 4.6,
        darkRichness: 1,
      },
      derivation: {
        dark: { mode: "static" },
      },
    },
  });
  const declarations = getDeclarations(report.css);

  for (const scheme of ["light", "dark"]) {
    const neutralBackgrounds = [
      ["canvas", resolveThemeColor(declarations, "--color-bg", scheme)],
      ["surface", resolveThemeColor(declarations, "--color-surface", scheme)],
    ];

    for (const tokenName of ["--color-text", "--color-text-muted"]) {
      const text = resolveThemeColor(declarations, tokenName, scheme);
      for (const [backgroundName, background] of neutralBackgrounds) {
        assertMinContrast(text, background, 7, `${scheme} ${tokenName} vs ${backgroundName}`);
      }
    }

    for (const name of ["primary", "secondary"]) {
      const familyBackgrounds = [
        ...neutralBackgrounds,
        ["family surface", resolveThemeColor(declarations, `--color-${name}-surface`, scheme)],
        ["family surface strong", resolveThemeColor(declarations, `--color-${name}-surface-strong`, scheme)],
      ];

      for (const suffix of ["text", "text-strong"]) {
        const text = resolveThemeColor(declarations, `--color-${name}-${suffix}`, scheme);
        for (const [backgroundName, background] of familyBackgrounds) {
          assertMinContrast(text, background, 7, `${scheme} ${name}-${suffix} vs ${backgroundName}`);
        }
      }
    }
  }

  const onColorWarnings = report.warnings.filter((warning) => warning.includes("on-solid"));
  assert.ok(onColorWarnings.length > 0);
  assert.ok(onColorWarnings.every((warning) => warning.includes("target 4.60:1")));
});

test("capped dark text targets retain serialization headroom at 7.5:1", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      contrast: { text: 7, maxIdentity: 7.5, darkRichness: 1.25 },
      derivation: { dark: { mode: "static" } },
    },
  });
  const declarations = getDeclarations(report.css);
  const neutralBackgrounds = ["--color-bg", "--color-surface"];
  for (const token of ["--color-text", "--color-text-muted"]) {
    for (const background of neutralBackgrounds) {
      assertMinContrast(resolveThemeColor(declarations, token, "dark"), resolveThemeColor(declarations, background, "dark"), 7.5, `${token} vs ${background}`);
    }
  }
  for (const name of ["primary", "secondary"]) {
    for (const suffix of ["text", "text-strong"]) {
      for (const background of [...neutralBackgrounds, `--color-${name}-surface`, `--color-${name}-surface-strong`]) {
        assertMinContrast(resolveThemeColor(declarations, `--color-${name}-${suffix}`, "dark"), resolveThemeColor(declarations, background, "dark"), 7.5, `${name}-${suffix} vs ${background}`);
      }
    }
  }
  assert.deepEqual(report.errors, []);
});

test("direct companion improvements preserve the existing decorative dark-richness policy", async (t) => {
  const root = await createProject(t, DEFAULT_PALETTE.replace("oklch(0.88 0.12 85)", "oklch(0.72 0.18 280)"));
  const report = await generateColorTokens({ root, suggest: false, inlineConfig: { contrast: { text: 7, onColor: 4.6, darkRichness: 1.25 } } });
  const declarations = getDeclarations(report.css);
  const foreground = resolveThemeColor(declarations, "--color-tertiary-ink", "dark");
  const background = resolveThemeColor(declarations, "--color-tertiary", "dark");
  assertMinContrast(foreground, background, Math.min(report.config.contrast.maxIdentity, report.config.contrast.onColor * report.config.contrast.darkRichness), "decorative generation retains its existing richness target");
});

test("a permissive project target does not hide a below-minimum text result", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    suggest: false,
    inlineConfig: { contrast: { text: 3, onColor: 3, darkRichness: 1 }, derivation: { dark: { mode: "static" } } },
  });
  const declarations = getDeclarations(report.css);
  const ratio = contrast(resolveThemeColor(declarations, "--color-text-muted", "light"), resolveThemeColor(declarations, "--color-bg", "light"));
  assert.ok(ratio >= 3 && ratio < 4.5);
  const warning = report.warnings.find((entry) => entry.startsWith("light muted text / canvas is "));
  assert.ok(warning?.includes("Status: below-minimum;"));
  assert.ok(warning.includes("below the stated minimum"));
  assert.deepEqual(report.errors, [], "Warning-only minimum classification must not introduce a stricter exit policy.");
});

test("direct companions and opaque control pairs are checked on their emitted values", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    suggest: false,
    inlineConfig: { contrast: { onColor: 7 }, derivation: { dark: { mode: "static" } } },
  });
  const declarations = getDeclarations(report.css);
  const verifyWarning = (label, foreground, background, target, minimum) => {
    const ratio = contrast(foreground, background);
    const warning = report.warnings.find((entry) => entry.startsWith(`${label} is `));
    assert.equal(Boolean(warning), ratio < target || ratio < minimum, `${label}: exact emitted classification`);
    if (warning) {
      assert.ok(warning.includes(`Status: ${ratio < minimum ? "below-minimum" : "below-target"}`));
    }
  };
  for (const scheme of ["light", "dark"]) {
    for (const name of ["primary", "secondary"]) {
      verifyWarning(`${scheme} on-${name} / ${name}`, resolveThemeColor(declarations, `--color-${name}-ink`, scheme), resolveThemeColor(declarations, `--color-${name}`, scheme), 7, 4.5);
      for (const token of ["bg", "surface", `${name}-surface`, `${name}-surface-strong`]) {
        const background = resolveThemeColor(declarations, `--color-${token}`, scheme);
        assertMinContrast(resolveThemeColor(declarations, `--color-${name}-text-strong`, scheme), background, scheme === "light" ? 4.6 : 4.6 * 1.15, `${scheme} text-strong / ${token}`);
        assertMinContrast(resolveThemeColor(declarations, `--color-${name}-border-strong`, scheme), background, scheme === "light" ? 3 : 3 * 1.15, `${scheme} border-strong / ${token}`);
      }
    }
    const text = resolveThemeColor(declarations, "--color-text", scheme);
    const target = scheme === "light" ? report.config.contrast.text : report.config.contrast.text * report.config.contrast.darkRichness;
    for (const [label, token] of [["control active text / active background", "--color-control-bg-active"], ["control text / focus background", "--color-control-focus-bg"]]) {
      verifyWarning(`${scheme} ${label}`, text, resolveThemeColor(declarations, token, scheme), target, 4.5);
    }
    const border = resolveThemeColor(declarations, "--color-control-border-active", scheme);
    for (const [label, token] of [["canvas", "--color-bg"], ["active background", "--color-control-bg-active"]]) {
      verifyWarning(`${scheme} control active border / ${label}`, border, resolveThemeColor(declarations, token, scheme), 3, 3);
    }
  }
  assert.ok(report.warnings.some((entry) => entry.startsWith("light on-primary / primary is ")), "Fixture must exercise direct pair shortfalls separately from functional warnings.");
});

test("relative dark tuning defaults preserve the validated muted-text contract", async (t) => {
  const palette = DEFAULT_PALETTE.replace("oklch(0.962 0.015 88)", "oklch(0.7 0 88)");
  const root = await createProject(t, palette);
  const report = await generateColorTokens({ root });
  const source = { l: 0.7, c: 0, h: 88 };
  const black = { l: 0, c: 0, h: 88 };
  const white = { l: 0.99, c: 0, h: 88 };
  const bgDark = mixOklch(source, black, 0.14);
  const surfaceDark = mixOklch(source, black, 0.18);
  const textDark = mixOklch(source, white, getPercentageDeclaration(report.css, "--color-tune-dark-text-mix"));
  const mutedDark = mixOklch(textDark, bgDark, getPercentageDeclaration(report.css, "--color-tune-dark-muted-mix"));
  const target = 4.6 * 1.15;

  assertMinContrast(mutedDark, bgDark, target, "relative dark muted text vs canvas");
  assertMinContrast(mutedDark, surfaceDark, target, "relative dark muted text vs surface");
});

test("relative muted text survives rounding the searched text percentage at the safety boundary", async (t) => {
  const palette = DEFAULT_PALETTE.replace("oklch(0.962 0.015 88)", "oklch(0.5 0 88)");
  const root = await createProject(t, palette);
  const report = await generateColorTokens({ root, suggest: false });
  const canvas = { l: 0.5, c: 0, h: 88 };
  const bg = nativeMixOklch(canvas, { l: 0, c: 0, h: null }, 0.14);
  const surface = nativeMixOklch(canvas, { l: 0, c: 0, h: null }, 0.18);
  const textRatio = getPercentageDeclaration(report.css, "--color-tune-dark-text-mix");
  const mutedRatio = getPercentageDeclaration(report.css, "--color-tune-dark-muted-mix");
  assert.equal(textRatio, 0.7895, "The emitted 78.96% missed the safety endpoint needed by muted text.");
  const text = nativeMixOklch(canvas, { l: 0.99, c: 0, h: null }, textRatio);
  const muted = nativeMixOklch(text, bg, mutedRatio);
  for (const background of [bg, surface]) {
    assertMinContrast(text, background, 4.6 * 1.15 + 0.02, "emitted dark text");
    assertMinContrast(muted, background, 4.6 * 1.15, "emitted dark muted text");
  }
  assert.deepEqual(report.errors, []);
});

test("body and family text can use exact endpoints beyond the legacy .02/.99 search", async (t) => {
  const palette = DEFAULT_PALETTE
    .replace("oklch(0.962 0.015 88)", "oklch(0.56 0 88)")
    .replace("oklch(0.62 0.16 32)", "oklch(0.2 0 0)")
    .replace("oklch(0.54 0.108 198)", "oklch(0.3 0 0)");
  const root = await createProject(t, palette);
  const report = await generateColorTokens({ root, suggest: false, inlineConfig: { derivation: { dark: { mode: "static" } } } });
  const declarations = getDeclarations(report.css);
  const canvas = resolveThemeColor(declarations, "--color-bg", "light");
  assert.ok(contrast({ l: 0.99, c: 0, h: 0 }, canvas) < 4.6);
  for (const token of ["--color-text", "--color-text-muted"]) {
    for (const background of ["--color-bg", "--color-surface"]) {
      assertMinContrast(resolveThemeColor(declarations, token, "light"), resolveThemeColor(declarations, background, "light"), 4.6, token);
    }
  }
  for (const name of ["primary", "secondary"]) {
    for (const suffix of ["text", "text-strong"]) {
      for (const background of ["--color-bg", "--color-surface", `--color-${name}-surface`, `--color-${name}-surface-strong`]) {
        assertMinContrast(resolveThemeColor(declarations, `--color-${name}-${suffix}`, "light"), resolveThemeColor(declarations, background, "light"), 4.6, `${name}-${suffix}`);
      }
    }
  }
  assert.deepEqual(report.errors, []);
});

test("adaptive dark fallback feeds the numeric scale base", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary"],
      },
    },
  });

  assert.match(report.css, /--_color-primary-source: oklch\(0\.62 0\.16 32\);/);
  assert.match(report.css, /--_color-primary-dark-generated: color-mix\(in oklch, var\(--_color-primary-source\) var\(--color-tune-primary-dark-mix, 81%\), oklch\(1 0 none\)\);/);

  const expectedDark = mixOklch(
    { l: 0.62, c: 0.16, h: 32 },
    { l: 1, c: 0, h: 32 },
    0.81,
  );
  const primaryScaleBaseDark = getDarkScaleColor(report.css, "primary", 500);

  assertColorClose(primaryScaleBaseDark, expectedDark, "adaptive primary dark scale base");
});

test("dark-blend maps 0–100 to a bounded 0–28% white wash", async (t) => {
  for (const { darkBlend, sourceRatio } of [
    { darkBlend: 0, sourceRatio: 1 },
    { darkBlend: 50, sourceRatio: 0.86 },
    { darkBlend: 100, sourceRatio: 0.72 },
  ]) {
    const palette = DEFAULT_PALETTE.replace(
      "  role: ui;",
      `  role: ui;\n  dark-blend: ${darkBlend};`,
    );
    const root = await createProject(t, palette);
    const report = await generateColorTokens({
      root,
      inlineConfig: {
        scales: {
          enabled: true,
          applyTo: ["primary"],
        },
      },
    });
    const sourcePercentage = sourceRatio * 100;

    assert.match(
      report.css,
      new RegExp(`--_color-primary-dark-generated: color-mix\\(in oklch, var\\(--_color-primary-source\\) var\\(--color-tune-primary-dark-mix, ${sourcePercentage}%\\), oklch\\(1 0 none\\)\\);`),
    );

    const expectedDark = mixOklch(
      { l: 0.62, c: 0.16, h: 32 },
      { l: 1, c: 0, h: 32 },
      sourceRatio,
    );
    const primaryScaleBaseDark = getDarkScaleColor(report.css, "primary", 500);

    assertColorClose(primaryScaleBaseDark, expectedDark, `dark-blend ${darkBlend} primary dark scale base`);
  }
});

test("static mode materializes the dark-blend result as OKLCH", async (t) => {
  const palette = DEFAULT_PALETTE.replace(
    "  role: ui;",
    "  role: ui;\n  dark-blend: 100;",
  );
  const root = await createProject(t, palette);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      derivation: {
        dark: { mode: "static" },
      },
      scales: {
        enabled: true,
        applyTo: ["primary"],
      },
    },
  });
  const expectedDark = mixOklch(
    { l: 0.62, c: 0.16, h: 32 },
    { l: 1, c: 0, h: 32 },
    0.72,
  );
  const generatedDark = parseOklch(getDeclaration(report.css, "--_color-primary-dark-generated"));
  const primaryScaleBaseDark = getDarkScaleColor(report.css, "primary", 500);

  assert.deepEqual(generatedDark.errors, []);
  assertColorClose(generatedDark.color, expectedDark, "static primary dark identity");
  assertColorClose(primaryScaleBaseDark, expectedDark, "static primary dark scale base");
});

test("generated numeric scales avoid clipped duplicate tints", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary"],
      },
    },
  });

  const softTintSteps = getLightnessSteps(report.css, "primary").filter(({ step }) => step <= 400);
  assert.equal(softTintSteps.length, 5);
  assert.equal(new Set(softTintSteps.map(({ lightness }) => lightness.toFixed(4))).size, 5);

  for (let index = 1; index < softTintSteps.length; index += 1) {
    assert.ok(
      softTintSteps[index - 1].lightness > softTintSteps[index].lightness,
      "light-mode tints should progress toward the identity color without repeated clipped values",
    );
  }
});

test("generated output exposes a global surface substrate", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({ root });

  assert.doesNotMatch(report.css, /@property/);
  assert.doesNotMatch(report.css, /transition-property:/);
  assert.match(report.css, /--color-tune-light-warmth: 100%;/);
  assert.match(report.css, /--color-tune-dark-bg-mix: 14%;/);
  assert.match(report.css, /--color-tune-elevation-1-shadow-alpha: 10%;/);
  assert.match(report.css, /--surface-color: var\(--color-bg\);/);
  assert.match(report.css, /--surface-contrast: contrast-color\(var\(--surface-color\)\);/);
  assert.match(report.css, /--surface-text: var\(--color-text\);/);
  assert.match(report.css, /--surface-text-muted: var\(--color-text-muted\);/);
  assert.match(report.css, /--surface-border: var\(--color-border-subtle\);/);
  assert.match(report.css, /--elevation-1:/);
  assert.match(report.css, /--elevation-2:/);
  assert.match(report.css, /--elevation-filter-1:/);
  assert.match(report.css, /--elevation-filter-2:/);
  assert.match(report.css, /drop-shadow\(0 8px 12px/);
  assert.match(report.css, /drop-shadow\(0 18px 24px/);
  assert.match(report.css, /--_color-primary-dark-generated:/);
  assert.match(report.css, /--_color-primary-dark: var\(--color-tune-primary-dark, var\(--_color-primary-dark-generated\)\);/);
  assert.match(report.css, /oklch\(from var\(--surface-color\)/);
});

test("paired hue variants use designer-facing warm/cool token names", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      scales: {
        enabled: true,
        applyTo: ["primary"],
        hueVariants: {
          enabled: true,
          shifts: [30, -30],
          applyTo: ["primary"],
        },
      },
    },
  });

  assert.match(report.css, /--color-primary-warm:/);
  assert.match(report.css, /--color-primary-cool:/);
  assert.doesNotMatch(report.css, /--color-primary-hue-plus-30:/);
  assert.doesNotMatch(report.css, /--color-primary-hue-minus-30:/);
  assert.doesNotMatch(report.css, /--color-primary-h30:/);
  assert.doesNotMatch(report.css, /--color-primary-h-30:/);
});

test("check mode reports stale generated output", async (t) => {
  const root = await createProject(t);
  await generateColorTokens({ root });

  const cleanReport = await generateColorTokens({ root, check: true });
  assert.equal(cleanReport.changed, false);
  assert.deepEqual(cleanReport.errors, []);

  await writeFile(path.join(root, "src/styles/tokens/colors.css"), ":root {}\n", "utf8");
  const staleReport = await generateColorTokens({ root, check: true });

  assert.equal(staleReport.changed, true);
  assert.ok(staleReport.errors.some((error) => error.includes("out of date")));
});
