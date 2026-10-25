import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createDesignTools } from "../../src/colors/design-recipes.mjs";

test("surfaceRatio reads the shared registry source quotas", () => {
  const tools = createDesignTools();
  assert.equal(tools.surfaceRatio("surface", "light"), 0.1);
  assert.equal(tools.surfaceRatio("surface", "dark"), 0.18);
  assert.equal(tools.surfaceRatio("surface-strong", "light"), 0.18);
  assert.equal(tools.surfaceRatio("surface-strong", "dark"), 0.28);
  assert.deepEqual(tools.recipes.surface.mix, { light: 0.1, dark: 0.18 });
  assert.deepEqual(tools.recipes["surface-strong"].mix, { light: 0.18, dark: 0.28 });
});

test("darkBlendMix maps 0..100 to a bounded 0..28% white wash and stays non-negative", () => {
  const tools = createDesignTools();
  assert.equal(tools.darkBlendMix(null), null);
  assert.equal(tools.darkBlendMix(undefined), null);
  assert.equal(tools.darkBlendMix("auto"), null);
  assert.deepEqual(tools.darkBlendMix(0), { sourcePercent: 100, whitePercent: 0 });
  assert.deepEqual(tools.darkBlendMix(50), { sourcePercent: 86, whitePercent: 14 });
  assert.deepEqual(tools.darkBlendMix(60), { sourcePercent: 83.2, whitePercent: 16.8 });
  assert.deepEqual(tools.darkBlendMix(100), { sourcePercent: 72, whitePercent: 28 });
  // Out-of-range inputs clamp; the cap has a single origin and never turns negative.
  assert.deepEqual(tools.darkBlendMix(-10), { sourcePercent: 100, whitePercent: 0 });
  assert.deepEqual(tools.darkBlendMix(1000), { sourcePercent: 72, whitePercent: 28 });
  // Four-decimal precision: a fractional author value is not truncated to 2 decimals.
  assert.deepEqual(tools.darkBlendMix(50.1234), { sourcePercent: 85.9654, whitePercent: 14.0346 });
});

test("describeToken returns the binding merged with its shared recipe, or null for unknowns", () => {
  const tools = createDesignTools();
  const design = {
    version: 1,
    recipes: tools.recipes,
    tokens: {
      "--color-primary-surface": {
        sources: ["--palette-primary"],
        recipe: "surface",
        usage: null,
        controls: {
          light: { override: "--color-tune-primary-surface-light", mix: "--color-tune-primary-surface-light-mix", defaultMix: 0.1 },
          dark: { override: "--color-tune-primary-surface-dark", mix: "--color-tune-primary-surface-dark-mix", defaultMix: 0.18 },
        },
      },
    },
  };

  const light = tools.describeToken(design, "--color-primary-surface", "light");
  assert.equal(light.token, "--color-primary-surface");
  assert.deepEqual(light.sources, ["--palette-primary"]);
  assert.equal(light.recipe, "surface");
  assert.equal(light.control.mix, "--color-tune-primary-surface-light-mix");
  assert.equal(light.recipeDefault.usage, "soft tinted family background (non-WCAG)");

  const dark = tools.describeToken(design, "--color-primary-surface", "dark");
  assert.equal(dark.control.defaultMix, 0.18);

  assert.equal(tools.describeToken(design, "--color-mystery", "light"), null);
  assert.equal(tools.describeToken(null, "--color-bg", "dark"), null);
  assert.equal(tools.describeToken(design, "constructor", "light"), null, "prototype keys must not leak");
});

test("the factory is self-contained: serialized with toString() it runs in a bare realm with identical output", () => {
  const source = `(${createDesignTools.toString()})()`;
  assert.doesNotMatch(source, /\brequire\s*\(/, "No CommonJS reference may leak into the serialized factory");
  assert.doesNotMatch(source, /\.\.\//, "No relative module path may leak into the serialized factory");
  assert.doesNotMatch(source, /\bimport\b/, "No import may leak into the serialized factory");

  const foreign = vm.runInContext(source, vm.createContext({}));
  assert.deepEqual(Object.keys(foreign).sort(), ["darkBlendMix", "describeToken", "recipes", "surfaceRatio"]);
  assert.equal(foreign.surfaceRatio("surface-strong", "dark"), 0.28);
  // Cross-realm objects keep a different prototype, so compare fields directly.
  const capped = foreign.darkBlendMix(100);
  assert.equal(capped.sourcePercent, 72);
  assert.equal(capped.whitePercent, 28);
  const mid = foreign.darkBlendMix(60);
  assert.equal(mid.sourcePercent, 83.2);
  assert.equal(mid.whitePercent, 16.8);
  const fractional = foreign.darkBlendMix(50.1234);
  assert.equal(fractional.sourcePercent, 85.9654);
  assert.equal(fractional.whitePercent, 14.0346);
  assert.equal(foreign.describeToken({ recipes: foreign.recipes, tokens: {} }, "--x", "light"), null);
});
