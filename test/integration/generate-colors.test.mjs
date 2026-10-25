import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { contrast, fitToSrgb, mixOklch as nativeMixOklch } from "../../src/colors/color-math.mjs";
import { analyzeColorTokens, generateColorTokens } from "../../src/colors/generate-colors.mjs";
import { parseOklch } from "../../src/colors/parse-palette.mjs";
import { getDeclarations, resolveThemeColor, splitTopLevel, unwrapFunction } from "../helpers/css-resolver.mjs";

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

function getDeclaration(css, tokenName) {
  const value = getDeclarations(css).get(tokenName);
  assert.ok(value, `Expected generated token ${tokenName}.`);
  return value;
}

function getLightnessSteps(css, name) {
  // Scale tokens now read `light-dark(var(--color-tune-<name>-<step>-light, oklch(<l> ...)), ...)`.
  return [...css.matchAll(new RegExp(`--color-${name}-(\\d+): light-dark\\(var\\(--color-tune-${name}-\\d+-light, oklch\\(([^\\s]+)`, "g"))]
    .map((match) => ({ step: Number(match[1]), lightness: Number(match[2]) }))
    .sort((a, b) => a.step - b.step);
}

function getDarkScaleColor(css, name, step) {
  return resolveThemeColor(getDeclarations(css), `--color-${name}-${step}`, "dark");
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

test("explicit config overrides annotated roles across identity and decorative categories", async (t) => {
  for (const [name, category, role, focus] of [
    ["primary", "decoratives", "decorative", "secondary"],
    ["secondary", "decoratives", "decorative", "primary"],
    ["tertiary", "identities", "ui", "primary"],
    ["tertiary", "identities", "feedback", "primary"],
  ]) {
    await t.test(`${name} becomes ${role}`, async (t) => {
      const root = await createProject(t);
      const report = await generateColorTokens({
        root,
        suggest: false,
        inlineConfig: {
          roles: { [category]: { [name]: { token: `--palette-${name}`, role } } },
          motion: { enabled: true },
        },
      });
      const otherCategory = category === "identities" ? "decoratives" : "identities";
      assert.deepEqual(report.config.roles[category][name], { token: `--palette-${name}`, role });
      assert.equal(Object.hasOwn(report.config.roles[otherCategory], name), false);
      assert.equal(report.config.roles.focus, focus, "automatic focus must use an effective functional identity");
      const declarations = getDeclarations(report.css);
      assert.ok(declarations.has(`--color-${name}`));
      assert.ok(declarations.has(`--color-${name}-ink`));
      for (const suffix of SEMANTIC_SUFFIXES) {
        assert.equal(declarations.has(`--color-${name}-${suffix}`), category === "identities");
        assert.equal(report.motionCss.includes(`@property --color-${name}-${suffix} `), category === "identities");
      }
      assert.equal(await readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8"), report.css);
      assert.equal((await generateColorTokens({
        root,
        check: true,
        suggest: false,
        inlineConfig: {
          roles: { [category]: { [name]: { token: `--palette-${name}`, role } } },
          motion: { enabled: true },
        },
      })).changed, false);
    });
  }
});

test("explicit cross-category overrides preserve explicit focus and reject conflicting explicit definitions", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    suggest: false,
    inlineConfig: {
      roles: {
        identities: { tertiary: "--palette-tertiary" },
        decoratives: { primary: "--palette-primary" },
        focus: "tertiary",
      },
    },
  });
  assert.equal(report.config.roles.focus, "tertiary");
  assert.equal(report.config.roles.identities.tertiary.role, "ui");
  assert.equal(report.config.roles.decoratives.primary.role, "decorative");
  const before = await readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8");
  await assert.rejects(generateColorTokens({
    root,
    suggest: false,
    inlineConfig: {
      roles: {
        identities: { primary: "--palette-primary" },
        decoratives: { primary: "--palette-primary" },
      },
    },
  }), /Public token --color-primary would be generated by both/);
  assert.equal(await readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8"), before);
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

function assertColorWithin(actual, expected, tolerance, label) {
  for (const channel of ["l", "c", "h"]) {
    assert.ok(
      Math.abs(actual[channel] - expected[channel]) <= tolerance,
      `${label} ${channel} ${actual[channel]} should be within ${tolerance} of ${expected[channel]}.`,
    );
  }
}

test("default output parity: every public colour resolves to the generated value in both themes", async (t) => {
  const root = await createProject(t);
  // Relative (runtime) mode: the resolver evaluates the emitted light-dark/var/
  // color-mix chain exactly as the browser would, so parity is measured on the
  // real bytes rather than a materialized literal.
  const analysis = await analyzeColorTokens({ root });
  const declarations = getDeclarations(analysis.css);
  const { neutrals } = analysis.model;
  const expected = [
    ["--color-bg", { light: neutrals.bgLight, dark: neutrals.bgDark }],
    ["--color-surface", { light: neutrals.surfaceLight, dark: neutrals.surfaceDark }],
    ["--color-text", { light: neutrals.textLight, dark: neutrals.textDark }],
    ["--color-text-muted", { light: neutrals.textMutedLight, dark: neutrals.textMutedDark }],
  ];
  const variants = [
    ["surface", "surface"], ["surface-strong", "surfaceStrong"], ["text", "text"], ["text-strong", "textStrong"],
    ["border", "border"], ["border-strong", "borderStrong"], ["solid", "solid"], ["solid-hover", "solidHover"], ["solid-text", "onSolid"],
  ];
  for (const [name, identity] of Object.entries(analysis.model.identities)) {
    expected.push([`--color-${name}`, { light: identity.light, dark: identity.dark }]);
    expected.push([`--color-${name}-ink`, { light: parseOklch(analysis.model.onColors[name].light).source, dark: parseOklch(analysis.model.onColors[name].dark).source }]);
    for (const [suffix, key] of variants) expected.push([`--color-${name}-${suffix}`, { light: identity.family.light[key], dark: identity.family.dark[key] }]);
  }
  for (const [name, decorative] of Object.entries(analysis.model.decoratives)) {
    expected.push([`--color-${name}`, { light: decorative.light, dark: decorative.dark }]);
    expected.push([`--color-${name}-ink`, { light: parseOklch(analysis.model.onColors[name].light).source, dark: parseOklch(analysis.model.onColors[name].dark).source }]);
  }
  for (const [token, themes] of expected) {
    for (const scheme of ["light", "dark"]) {
      assertColorWithin(resolveThemeColor(declarations, token, scheme), themes[scheme], 0.002, `${token} ${scheme}`);
    }
  }
});

// The starter workspace's real config+palette, resolved from the actual CSS in
// both themes: the declared contrast contract must hold on the emitted bytes.
test("the starter output meets its declared contrast contract on the emitted CSS in both themes", async (t) => {
  const root = await createProject(t);
  const analysis = await analyzeColorTokens({ root, suggest: false });
  const declarations = getDeclarations(analysis.css);
  const { contrast: limits } = analysis.config;
  const darkTarget = (base) => Math.min(limits.maxIdentity, base * limits.darkRichness);
  const forTheme = {
    light: { text: limits.text, ui: limits.ui },
    dark: { text: darkTarget(limits.text), ui: darkTarget(limits.ui) },
  };
  const measured = (token, background, scheme) => contrast(
    resolveThemeColor(declarations, token, scheme),
    resolveThemeColor(declarations, background, scheme),
  );
  for (const scheme of ["light", "dark"]) {
    const target = forTheme[scheme];
    for (const background of ["--color-bg", "--color-surface"]) {
      for (const token of ["--color-text", "--color-text-muted"]) {
        assert.ok(measured(token, background, scheme) >= target.text, `${scheme} ${token} / ${background} = ${measured(token, background, scheme)} < ${target.text}`);
      }
    }
    for (const name of Object.keys(analysis.config.roles.identities)) {
      const backgrounds = ["--color-bg", "--color-surface", `--color-${name}-surface`, `--color-${name}-surface-strong`];
      for (const suffix of ["text", "text-strong"]) {
        for (const background of backgrounds) {
          assert.ok(measured(`--color-${name}-${suffix}`, background, scheme) >= target.text, `${scheme} ${name}-${suffix} / ${background} = ${measured(`--color-${name}-${suffix}`, background, scheme)} < ${target.text}`);
        }
      }
      for (const background of backgrounds) {
        assert.ok(measured(`--color-${name}-border-strong`, background, scheme) >= target.ui, `${scheme} ${name}-border-strong / ${background} = ${measured(`--color-${name}-border-strong`, background, scheme)} < ${target.ui}`);
      }
    }
  }
  // On-colour pairs are reported, not silently corrected: the solid companions
  // must appear as measured diagnostics instead of a hidden guarantee.
  for (const name of Object.keys(analysis.config.roles.identities)) {
    for (const scheme of ["light", "dark"]) {
      assert.ok(
        analysis.diagnostics.some((diagnostic) => diagnostic.foregroundToken === `--color-${name}-solid-text` && diagnostic.scheme === scheme),
        `${scheme} ${name}-solid-text must be a measured diagnostic`,
      );
    }
  }
});

test("family surfaces are live mixes with the shared source quota and a runtime override", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({ root });
  const declarations = getDeclarations(report.css);

  assert.equal(getDeclaration(report.css, "--color-primary-surface"),
    "light-dark(var(--color-tune-primary-surface-light, color-mix(in oklch, var(--_color-primary-light) var(--color-tune-primary-surface-light-mix, 10%), var(--_color-bg-light))), var(--color-tune-primary-surface-dark, color-mix(in oklch, var(--_color-primary-dark) var(--color-tune-primary-surface-dark-mix, 18%), var(--_color-bg-dark))))");
  assert.equal(getDeclaration(report.css, "--color-primary-surface-strong"),
    "light-dark(var(--color-tune-primary-surface-strong-light, color-mix(in oklch, var(--_color-primary-light) var(--color-tune-primary-surface-strong-light-mix, 18%), var(--_color-bg-light))), var(--color-tune-primary-surface-strong-dark, color-mix(in oklch, var(--_color-primary-dark) var(--color-tune-primary-surface-strong-dark-mix, 28%), var(--_color-bg-dark))))");

  // A source-quota knob changes only that family surface, and matches the registry ratio.
  const tuned = getDeclarations(report.css);
  tuned.set("--color-tune-primary-surface-strong-light-mix", "50%");
  const source = resolveThemeColor(tuned, "--color-primary", "light");
  const background = resolveThemeColor(tuned, "--color-bg", "light");
  assertColorWithin(resolveThemeColor(tuned, "--color-primary-surface-strong", "light"), nativeMixOklch(source, background, 0.5), 0.001, "tuned surface-strong");
  assertColorWithin(resolveThemeColor(tuned, "--color-primary-surface", "light"), nativeMixOklch(source, background, 0.1), 0.001, "untouched surface");

  // A full per-theme override wins over the recipe and does not touch the other theme.
  const overridden = getDeclarations(report.css);
  overridden.set("--color-tune-primary-surface-light", "oklch(0.2 0.05 300)");
  assertColorWithin(resolveThemeColor(overridden, "--color-primary-surface", "light"), { l: 0.2, c: 0.05, h: 300 }, 0.001, "surface light override");
});

test("every public colour exposes a working per-theme override, more specific than the legacy knob", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      aliases: { action: "primary" },
      scales: { enabled: true, applyTo: ["primary"], hueVariants: { enabled: true, shifts: [30, -30], applyTo: ["primary"] } },
    },
  });
  const declarations = getDeclarations(report.css);

  // A default dark=light overridePair must never leak the string `undefined`.
  assert.doesNotMatch(report.css, /undefined/);
  if (typeof report.motionCss === "string") assert.doesNotMatch(report.motionCss, /undefined/);

  // Every emitted colour token reads its own `--color-tune-<name>-<theme>` pair,
  // and that documented override resolves in its theme (no leak into the other).
  const colorTokens = [...declarations.keys()].filter((name) => /^--color-(?!tune-)/.test(name));
  assert.ok(colorTokens.length > 0, "expected emitted colour tokens");
  for (const token of colorTokens) {
    const name = token.slice("--color-".length);
    const value = declarations.get(token);
    assert.match(value, new RegExp(`var\\(--color-tune-${name}-light, `), `${token} must read its light override`);
    assert.match(value, new RegExp(`var\\(--color-tune-${name}-dark, `), `${token} must read its dark override`);
    for (const scheme of ["light", "dark"]) {
      const map = new Map(declarations);
      map.set(`--color-tune-${name}-${scheme}`, "oklch(0.44 0.07 84)");
      assertColorWithin(resolveThemeColor(map, token, scheme), { l: 0.44, c: 0.07, h: 84 }, 0.001, `${token} ${scheme} documented override`);
      const other = scheme === "light" ? "dark" : "light";
      const otherColor = resolveThemeColor(map, token, other);
      assert.notDeepEqual(otherColor, { l: 0.44, c: 0.07, h: 84 }, `${token} ${scheme} override must not leak into ${other}`);
    }
  }

  // A more specific override beats the legacy per-identity fill knob.
  const precedence = getDeclarations(report.css);
  precedence.set("--color-tune-primary-dark", "oklch(0.5 0.1 32)");
  precedence.set("--color-tune-primary-solid-dark", "oklch(0.2 0.05 32)");
  assertColorWithin(resolveThemeColor(precedence, "--color-primary-solid", "dark"), { l: 0.2, c: 0.05, h: 32 }, 0.001, "solid specific beats legacy");
  assertColorWithin(resolveThemeColor(precedence, "--color-primary", "dark"), { l: 0.5, c: 0.1, h: 32 }, 0.001, "legacy drives the fill");
});

test("explicit dark-blend uses the shared rule for canvas, ink and decorative; omitting keeps the role default", async (t) => {
  const blended = DEFAULT_PALETTE
    .replace("  role: canvas;", "  role: canvas;\n  dark-blend: 60;")
    .replace("  role: ink;", "  role: ink;\n  dark-blend: 0;")
    .replace("  role: decorative;", "  role: decorative;\n  dark-blend: 50;");
  const blendedRoot = await createProject(t, blended);
  const report = await generateColorTokens({ root: blendedRoot, suggest: false });
  assert.deepEqual(report.errors, []);

  // 60 -> 16.8% white (83.2% source kept); the neutral surface follows the chosen canvas.
  assert.equal(getDeclaration(report.css, "--_color-bg-dark"),
    "color-mix(in oklch, var(--_color-bg-source) 83.2%, oklch(1 0 none))");
  assert.equal(getDeclaration(report.css, "--_color-surface-dark"),
    "color-mix(in oklch, var(--_color-surface-light) 83.2%, oklch(1 0 none))");
  // No ghost runtime knob: the quota is a build-time constant.
  assert.doesNotMatch(report.css, /color-tune-canvas-dark-blend/);
  // Ink 0 keeps the authored ink as the dark text, verified through the normal pipeline.
  const textDark = parseOklch(getDeclaration(report.css, "--_color-text-dark"));
  assert.deepEqual(textDark.errors, []);
  assertColorWithin(textDark.source, fitToSrgb({ l: 0.28, c: 0.007, h: 3.68 }), 0.01, "ink dark-blend 0");
  // An explicit decorative dark-blend feeds its companions; omitting it leaves the pair untouched.
  assert.match(getDeclaration(report.css, "--_color-tertiary-dark"), /^oklch\(/);

  // Omitting every descriptor keeps the role defaults byte-for-byte.
  const defaultRoot = await createProject(t);
  const base = await generateColorTokens({ root: defaultRoot, suggest: false });
  assert.notEqual(getDeclaration(report.css, "--_color-tertiary-dark"), getDeclaration(base.css, "--_color-tertiary-dark"));
  assert.equal(getDeclaration(base.css, "--_color-bg-dark"),
    "color-mix(in oklch, var(--_color-bg-warm) var(--color-tune-dark-bg-mix), oklch(0 0 none))");
  assert.equal(getDeclaration(base.css, "--_color-surface-dark"),
    "color-mix(in oklch, var(--_color-bg-warm) var(--color-tune-dark-surface-mix), oklch(0 0 none))");
  assert.match(getDeclaration(base.css, "--_color-text-dark"), /^color-mix\(in oklch, var\(--_color-bg-source\) var\(--color-tune-dark-text-mix\), oklch\(0\.99 0 none\)\)$/);
});

test("analysis.design exposes a complete, serializable binding for every public colour", async (t) => {
  const root = await createProject(t);
  const analysis = await analyzeColorTokens({
    root,
    inlineConfig: {
      aliases: { action: "primary" },
      scales: { enabled: true, applyTo: ["primary"], hueVariants: { enabled: true, shifts: [30, -30], applyTo: ["primary"] } },
    },
  });
  const design = JSON.parse(JSON.stringify(analysis.design));

  assert.equal(design.version, 1);
  const canvas = design.sources.find((source) => source.name === "canvas");
  assert.equal(canvas.token, "--palette-canvas");
  assert.equal(canvas.role, "canvas");
  assert.equal(canvas.darkBlend, null);
  assert.deepEqual(canvas.darkMix, { mode: "automatic", sourcePercent: null, whitePercent: null });
  const primary = design.sources.find((source) => source.name === "primary");
  assert.equal(primary.role, "ui");
  assert.deepEqual(primary.darkMix, { mode: "automatic", sourcePercent: 81, whitePercent: 19 });

  // The registry is referenced once and never copied into a token binding.
  assert.equal(design.recipes.surface.mix.light, 0.1);
  assert.equal(design.recipes["surface-strong"].mix.dark, 0.28);
  const surface = design.tokens["--color-primary-surface"];
  assert.deepEqual(surface.sources, ["--palette-primary"]);
  assert.equal(surface.recipe, "surface");
  assert.equal(surface.controls.light.mix, "--color-tune-primary-surface-light-mix");
  assert.equal(surface.controls.light.defaultMix, 0.1);
  assert.equal(design.tokens["--color-action"].recipe, "alias");
  assert.equal(design.tokens["--color-action"].mappedTo, "--color-primary");
  assert.equal(design.tokens["--color-action-ink"].mappedTo, "--color-primary-ink");
  assert.equal(design.tokens["--color-action-surface"].mappedTo, "--color-primary-surface");
  assert.deepEqual(design.tokens["--color-action"].sources, ["--palette-primary"]);

  // Every emitted public colour has a binding whose declared override names are
  // exactly the `--color-tune-<token>-<theme>` knobs the CSS actually reads.
  const emitted = [...getDeclarations(analysis.css).keys()].filter((name) => /^--color-(?!tune-)/.test(name));
  assert.deepEqual([...Object.keys(design.tokens)].sort(), [...emitted].sort());
  for (const [token, binding] of Object.entries(design.tokens)) {
    const name = token.slice("--color-".length);
    for (const theme of ["light", "dark"]) {
      assert.equal(binding.controls[theme].override, `--color-tune-${name}-${theme}`, `${token} ${theme} override name`);
    }
  }
});

function blendPalette(role, value) {
  return DEFAULT_PALETTE.replace(`  role: ${role};`, `  role: ${role};\n  dark-blend: ${value};`);
}

test("a fractional dark-blend keeps four-decimal precision in the emitted knob", async (t) => {
  const root = await createProject(t, blendPalette("ui", 50.1234));
  const report = await generateColorTokens({ root });
  // 50.1234 -> 14.0346% white, 85.9654% source kept (four decimals, no 2-decimal loss).
  assert.match(report.css, /--_color-primary-dark-generated: color-mix\(in oklch, var\(--_color-primary-source\) var\(--color-tune-primary-dark-mix, 85\.9654%\), oklch\(1 0 none\)\);/);
});

// Contract A is unchanged (0 = SOURCE), so an explicit canvas/ink can put a light
// foundation under the dark theme. The derived foregrounds must adapt through the
// normal solver and stay measurable instead of surfacing hidden neutral errors.
test("explicit canvas/ink dark-blend resolves neutral and family text on the emitted CSS", async (t) => {
  const darkTargetFor = (config) => Math.min(config.contrast.maxIdentity, config.contrast.text * config.contrast.darkRichness);
  const measure = (declarations, token, background, scheme) => contrast(
    resolveThemeColor(declarations, token, scheme),
    resolveThemeColor(declarations, background, scheme),
  );
  for (const [role, value, label] of [
    ["canvas", 0, "canvas0"], ["canvas", 50, "canvas50"], ["canvas", 100, "canvas100"],
    ["ink", 0, "ink0"], ["ink", 50, "ink50"], ["ink", 100, "ink100"],
  ]) {
    const root = await createProject(t, blendPalette(role, value));
    const analysis = await analyzeColorTokens({ root, suggest: false });
    assert.deepEqual(analysis.errors, [], `${label} must not hide a contrast error`);
    const declarations = getDeclarations(analysis.css);
    const target = darkTargetFor(analysis.config);
    for (const token of ["--color-text", "--color-text-muted"]) {
      for (const background of ["--color-bg", "--color-surface"]) {
        const ratio = measure(declarations, token, background, "dark");
        assert.ok(ratio >= target, `${label} ${token} / ${background} = ${ratio} < ${target}`);
      }
    }
    // The figurative roles (ui/feedback) and the decorative stay valid too.
    for (const name of Object.keys(analysis.config.roles.identities)) {
      for (const suffix of ["text", "text-strong"]) {
        for (const background of ["--color-bg", "--color-surface", `--color-${name}-surface`, `--color-${name}-surface-strong`]) {
          const ratio = measure(declarations, `--color-${name}-${suffix}`, background, "dark");
          assert.ok(ratio >= target, `${label} ${name}-${suffix} / ${background} = ${ratio} < ${target}`);
        }
      }
    }
  }

  // 0 = SOURCE: the chosen dark canvas is the authored source (contract A).
  const zeroRoot = await createProject(t, blendPalette("canvas", 0));
  const zero = await analyzeColorTokens({ root: zeroRoot, suggest: false });
  const zeroDeclarations = getDeclarations(zero.css);
  assertColorWithin(resolveThemeColor(zeroDeclarations, "--color-bg", "dark"), fitToSrgb({ l: 0.962, c: 0.015, h: 88 }), 0.01, "canvas 0 keeps the source");
  assertColorWithin(resolveThemeColor(zeroDeclarations, "--color-surface", "dark"), resolveThemeColor(zeroDeclarations, "--color-surface", "light"), 0.01, "canvas 0 keeps the light surface");

  // Combined explicit canvas + ink behaves the same.
  const comboRoot = await createProject(t, blendPalette(blendPalette("canvas", 0), "ink", 100));
  const combo = await analyzeColorTokens({ root: comboRoot, suggest: false });
  assert.deepEqual(combo.errors, []);
  const comboDeclarations = getDeclarations(combo.css);
  const comboTarget = darkTargetFor(combo.config);
  for (const background of ["--color-bg", "--color-surface"]) {
    assert.ok(measure(comboDeclarations, "--color-text", background, "dark") >= comboTarget, `combo --color-text / ${background}`);
  }
});

// Use the shipped example in an isolated consumer: package tests must not depend
// on the reference site's files or on the checkout's parent directories.
test("the minimal example analyzes without issues and preserves existing output", async (t) => {
  const palette = await readFile(new URL("../../examples/minimal/src/styles/tokens/palette.css", import.meta.url), "utf8");
  const root = await createProject(t, palette);
  await generateColorTokens({ root });
  const output = path.join(root, "src/styles/tokens/colors.css");
  const before = await readFile(output, "utf8");
  assert.ok(before.length > 0, "the consumer fixture has generated output");
  const analysis = await analyzeColorTokens({ root });
  assert.deepEqual(analysis.errors, []);
  assert.equal(await readFile(output, "utf8"), before, "analysis must not write the consumer output");
});
