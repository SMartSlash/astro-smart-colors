import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import * as languageModule from "../src/designer-language.mjs";

const { createDesignerLanguage } = languageModule;
const language = createDesignerLanguage();

// The frozen contract is what other agents serialize and consume. A label is never
// escaped here: escaping stays the caller's job.
test("the module exposes only the factory and the factory exposes exactly the four frozen labels", () => {
  assert.deepEqual(Object.keys(languageModule).sort(), ["createDesignerLanguage"]);
  assert.equal(typeof createDesignerLanguage, "function");
  assert.equal(createDesignerLanguage.length, 0, "The factory takes no argument");
  assert.deepEqual(Object.keys(language).sort(), ["pairTitle", "roleLabel", "themeLabel", "variantLabel"]);
  for (const name of Object.keys(language)) assert.equal(typeof language[name], "function", name);
  assert.equal(language.pairTitle.length, 2, "pairTitle documents two positional tokens; property keeps its default");
});

test("pairTitle names the known neutral, family and control usages instead of repeating tokens", () => {
  const cases = [
    ["--color-text", "--color-bg", "Testo sulla pagina"],
    ["--color-text", "--color-surface", "Testo sulla card"],
    ["--color-text-muted", "--color-bg", "Testo secondario sulla pagina"],
    ["--color-text-muted", "--color-surface", "Testo secondario sulla card"],
    ["--color-focus-ring", "--color-bg", "Focus sulla pagina"],
    ["--color-focus-ring", "--color-surface", "Focus sulla card"],
    ["--color-border-subtle", "--color-surface", "Bordo tenue sulla card"],
    ["--color-border-strong", "--color-bg", "Bordo marcato sulla pagina"],
    ["--color-primary-text", "--color-primary-surface", "Testo sul callout primary"],
    ["--color-primary-text", "--color-primary-surface-strong", "Testo sul callout primary (forte)"],
    ["--color-primary-text", "--color-bg", "Testo primary sulla pagina"],
    ["--color-primary-text", "--color-surface", "Testo primary sulla card"],
    ["--color-primary-text-strong", "--color-primary-surface", "Testo in risalto sul callout primary"],
    ["--color-primary-border-strong", "--color-primary-surface", "Bordo sul callout primary"],
    ["--color-primary-border-strong", "--color-bg", "Bordo primary sulla pagina"],
    ["--color-primary-solid-text", "--color-primary-solid", "Testo del pulsante primary"],
    ["--color-primary-solid-text", "--color-primary-solid-hover", "Testo del pulsante primary al passaggio"],
    ["--color-primary-ink", "--color-primary", "Testo sul riempimento primary"],
    ["--color-spark-ink", "--color-spark", "Testo sul riempimento spark"],
    ["--color-tertiary-text", "--color-surface", "Testo tertiary sulla card"],
    ["--color-control-active-text", "--color-control-bg-active", "Testo del controllo attivo"],
    ["--color-control-border-active", "--color-control-bg-active", "Bordo del controllo attivo"],
    ["--color-control-border-active", "--color-bg", "Bordo del controllo attivo sulla pagina"],
    ["--color-text", "--color-control-focus-bg", "Testo sul controllo a fuoco"],
  ];
  for (const [foreground, background, expected] of cases) {
    assert.equal(language.pairTitle(foreground, background), expected, `${foreground} su ${background}`);
  }
});

test("pairTitle never calls a border a text and never calls a text a border", () => {
  for (const [foreground, background] of [
    ["--color-primary-border-strong", "--color-primary-surface"],
    ["--color-primary-border-strong", "--color-primary-surface-strong"],
    ["--color-primary-border-strong", "--color-bg"],
    ["--color-primary-border-strong", "--color-surface"],
    ["--color-border-strong", "--color-bg"],
    ["--color-border-subtle", "--color-surface"],
    ["--color-primary-border", "--color-primary"],
  ]) {
    const title = language.pairTitle(foreground, background);
    assert.match(title, /^Bordo/, `${foreground} su ${background}`);
    assert.doesNotMatch(title, /Testo/, `${foreground} su ${background}`);
  }
  for (const [foreground, background] of [
    ["--color-text", "--color-bg"],
    ["--color-text-muted", "--color-surface"],
    ["--color-primary-text", "--color-primary-surface"],
    ["--color-primary-solid-text", "--color-primary-solid"],
    ["--color-primary-ink", "--color-primary"],
  ]) {
    const title = language.pairTitle(foreground, background);
    assert.match(title, /^(?:Testo|Focus)/, `${foreground} su ${background}`);
    assert.doesNotMatch(title, /Bordo/, `${foreground} su ${background}`);
  }
});

test("pairTitle preserves the dynamic family name verbatim, including dashed families", () => {
  assert.equal(language.pairTitle("--color-brand-blue-text", "--color-bg"), "Testo brand-blue sulla pagina");
  assert.equal(language.pairTitle("--color-brand-blue-text", "--color-brand-blue-surface"), "Testo sul callout brand-blue");
  assert.equal(language.pairTitle("--color-accent2-border-strong", "--color-accent2-surface"), "Bordo sul callout accent2");
  // A mismatched family stays explicit instead of being silently dropped or swapped.
  assert.equal(language.pairTitle("--color-primary-text", "--color-secondary-surface"), "Testo primary sul callout secondary");
});

test("an unknown pair falls back to the faithful tokens and never infers a semantic", () => {
  assert.equal(language.pairTitle("--color-primary", "--color-bg"), "--color-primary su --color-bg");
  assert.equal(language.pairTitle("--color-text", "--color-border-strong"), "--color-text su --color-border-strong");
  assert.equal(language.pairTitle("--color-primary-text", "--color-text-muted"), "--color-primary-text su --color-text-muted");
  assert.equal(language.pairTitle("--color-primary-unknown", "--color-bg"), "--color-primary-unknown su --color-bg");
  assert.equal(language.pairTitle("--color-unknown", "--color-unknown"), "--color-unknown su --color-unknown");
});

test("the property parameter only decides the role a bare identity color plays", () => {
  assert.equal(language.pairTitle("--color-primary", "--color-bg", "color"), "--color-primary su --color-bg");
  assert.equal(language.pairTitle("--color-primary", "--color-bg", "borderColor"), "Bordo primary sulla pagina");
  assert.equal(language.pairTitle("--color-primary", "--color-surface", "outlineColor"), "Focus primary sulla card");
  // A border/outline property never overrides a token that already names its usage.
  assert.equal(language.pairTitle("--color-primary-text", "--color-primary-surface", "borderColor"), "Testo sul callout primary");
  assert.equal(language.pairTitle("--color-primary-border-strong", "--color-primary-surface", "color"), "Bordo sul callout primary");
  assert.equal(language.pairTitle("--color-primary-solid-text", "--color-primary-solid", "BORDERCOLOR"), "Testo del pulsante primary");
});

test("pairTitle is total and returns a plain, unescaped string for hostile or absent input", () => {
  assert.equal(language.pairTitle(undefined, "--color-bg"), "--color-bg");
  assert.equal(language.pairTitle("--color-text"), "--color-text");
  assert.equal(language.pairTitle(null, null), "coppia non indicata");
  assert.equal(language.pairTitle(42, 42), "coppia non indicata");
  assert.equal(language.pairTitle("", "   "), "coppia non indicata");
  assert.equal(language.pairTitle("  --color-text  ", "  --color-bg  "), "Testo sulla pagina");
  const hostile = '<img src=x onerror=alert(1)>&';
  assert.equal(language.pairTitle(hostile, "--color-bg"), `${hostile} su --color-bg`);
  assert.ok(language.pairTitle(hostile, hostile).includes("&"), "Escaping is the caller's responsibility");
});

test("roleLabel, themeLabel and variantLabel are lowercase Italian fragments with a faithful fallback", () => {
  assert.deepEqual(
    ["canvas", "ink", "ui", "feedback", "decorative"].map((role) => language.roleLabel(role)),
    ["sfondo della pagina", "testo di base", "interfaccia", "feedback", "decorativo"],
  );
  assert.equal(language.roleLabel("UI"), "interfaccia", "Role matching is case-insensitive");
  assert.equal(language.roleLabel("brand"), "brand");
  assert.equal(language.roleLabel(""), "ruolo non indicato");
  assert.equal(language.roleLabel(7), "ruolo non indicato");
  assert.equal(language.themeLabel("light"), "chiaro");
  assert.equal(language.themeLabel("dark"), "scuro");
  assert.equal(language.themeLabel("Light"), "chiaro");
  assert.equal(language.themeLabel("sepia"), "sepia");
  assert.equal(language.themeLabel(null), "tema non indicato");
  assert.equal(language.variantLabel("baseline"), "senza tuning");
  assert.equal(language.variantLabel("tuned"), "con tuning");
  assert.equal(language.variantLabel("TUNED"), "con tuning");
  assert.equal(language.variantLabel("custom"), "custom");
  assert.equal(language.variantLabel(undefined), "variante non indicata");
});

test("the factory is self-contained: serialized with toString() it runs in a bare runtime with identical output", () => {
  const source = `(${createDesignerLanguage.toString()})()`;
  assert.doesNotMatch(source, /\brequire\s*\(/, "No CommonJS reference may leak into the serialized factory");
  assert.doesNotMatch(source, /\.\.\//, "No relative module path may leak into the serialized factory");
  const foreign = vm.runInContext(source, vm.createContext({}));
  assert.deepEqual(Object.keys(foreign).sort(), ["pairTitle", "roleLabel", "themeLabel", "variantLabel"]);
  const foregrounds = ["--color-text", "--color-primary-text", "--color-primary-border-strong", "--color-primary-solid-text", "--color-primary-ink", "--color-primary", "--color-control-border-active", "--color-weird"];
  const backgrounds = ["--color-bg", "--color-surface", "--color-primary-surface", "--color-primary-solid", "--color-primary-solid-hover", "--color-primary", "--color-control-bg-active", "--color-weird"];
  for (const foreground of foregrounds) {
    for (const background of backgrounds) {
      for (const property of ["color", "borderColor", "outlineColor"]) {
        assert.equal(foreign.pairTitle(foreground, background, property), language.pairTitle(foreground, background, property), `${foreground} su ${background} (${property})`);
      }
    }
  }
  for (const fragment of ["canvas", "ink", "ui", "feedback", "decorative", "other"]) assert.equal(foreign.roleLabel(fragment), language.roleLabel(fragment));
  for (const theme of ["light", "dark", "sepia"]) assert.equal(foreign.themeLabel(theme), language.themeLabel(theme));
  for (const variant of ["baseline", "tuned", "custom"]) assert.equal(foreign.variantLabel(variant), language.variantLabel(variant));
});
