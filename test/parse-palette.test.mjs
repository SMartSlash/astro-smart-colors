import assert from "node:assert/strict";
import test from "node:test";
import { parseOklch, parsePaletteWithDiagnostics } from "../src/parse-palette.mjs";

const LEGACY_PALETTE = `:root {
  /* @role canvas */
  --palette-canvas: oklch(0.96 0.01 88);
  /* @role ink */
  --palette-ink: oklch(0.28 0.007 4);
  /* @role ui */
  --palette-primary: oklch(0.62 0.02 32);
}`;

function property(name, role, descriptors = "") {
  return `@property --${name} {
    syntax: "<color>";
    inherits: true;
    initial-value: oklch(0.62 0.02 32);
    role: ${role};
    ${descriptors}
  }`;
}

test("commented @property examples do not select the property parser for legacy palettes", () => {
  for (const comment of [
    "/* Use @property --palette-primary for typed colors. */",
    `/* ${property("palette-retired", "ui")} */`,
    `/*\n${property("palette-retired", "canvas")}\n*/`,
  ]) {
    const expected = parsePaletteWithDiagnostics(LEGACY_PALETTE);
    assert.deepEqual(expected.errors, []);
    assert.deepEqual(parsePaletteWithDiagnostics(`${comment}\n${LEGACY_PALETTE}`), expected);
  }
});

test("legacy parser excludes single-line and multiline commented declarations but retains role annotations", () => {
  const report = parsePaletteWithDiagnostics(`:root {
    /* --palette-retired: oklch(0.7 0.01 20); */
    /*
      --palette-old-canvas: oklch(0.9 0.01 80);
      --palette-invalid: oklch(2 0.1 20);
    */
    /* @role canvas */
    /* --palette-disabled: oklch(0.8 0.01 80); */
    --palette-canvas: oklch(0.96 0.01 88);
    /* @role ink */ --palette-ink: oklch(0.28 0.007 4);
    /* ordinary comment */ /* @role ui */ --palette-primary: oklch(0.62 0.02 32);
  }`);

  assert.deepEqual(report, parsePaletteWithDiagnostics(LEGACY_PALETTE));
});

test("comment removal preserves whitespace, line boundaries and multiline role annotations", () => {
  const report = parsePaletteWithDiagnostics(`:root {
    /*
      @role canvas
    */
    --palette-canvas: oklch(0.96/* lightness */ 0.01 88);
    /* @role ink */ --palette-ink: oklch(0.28 0.007 4);
  }`);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.annotatedRoles, { "palette-canvas": "canvas", "palette-ink": "ink" });
  assert.equal(report.authoredTokens["palette-canvas"].l, 0.96);
});

test("active @property parsing ignores commented blocks and descriptors", () => {
  const report = parsePaletteWithDiagnostics(`/* ${property("palette-retired", "ui", "dark-blend: 20;")} */
    ${property("palette-primary", "ui", "/* dark-blend: invalid; role: canvas; */ dark-blend: 75;")}`);

  assert.deepEqual(report.errors, []);
  assert.deepEqual(Object.keys(report.tokens), ["palette-primary"]);
  assert.deepEqual(Object.keys(report.authoredTokens), ["palette-primary"]);
  assert.deepEqual(report.annotatedRoles, { "palette-primary": "ui" });
  assert.deepEqual(report.annotatedDarkBlends, { "palette-primary": 75 });
});

test("duplicate properties fail explicitly and discard all ambiguous color and metadata entries", () => {
  for (const duplicate of [
    property("palette-primary", "ui"),
    property("palette-primary", "decorative"),
    property("palette-primary", "feedback", "dark-blend: 80;"),
    property("palette-primary", "ui", "dark-blend: invalid;"),
    "@property --palette-primary { role: ui; }",
  ]) {
    const report = parsePaletteWithDiagnostics([
      property("palette-primary", "ui", "dark-blend: 25;"),
      duplicate,
      property("palette-primary", "ui", "dark-blend: 50;"),
      property("palette-other", "feedback", "dark-blend: 0;"),
    ].join("\n"));

    assert.ok(report.errors.some((error) => /--palette-primary: duplicate @property/i.test(error)));
    for (const entries of [report.tokens, report.authoredTokens, report.annotatedRoles, report.annotatedDarkBlends]) {
      assert.equal(Object.hasOwn(entries, "palette-primary"), false);
      assert.equal(Object.hasOwn(entries, "palette-other"), true);
    }
    assert.equal(report.annotatedDarkBlends["palette-other"], 0);
  }
});

test("OKLCH rejects hue overflow after angle conversion before gamut mapping", () => {
  for (const hue of ["1e308turn", "-1e308turn", "1e308rad", "-1e308rad"]) {
    const parsed = parseOklch(`oklch(.62 .02 ${hue})`);
    assert.equal(parsed.color, null, hue);
    assert.equal(parsed.source, null, hue);
    assert.ok(parsed.errors.some((error) => /hue.*finite/i.test(error)), hue);
  }
});

test("finite angle conversions retain authored channels and normalize mapped hue", () => {
  for (const [hue, degrees] of [["1.5turn", 540], ["-200grad", -180], [`${Math.PI}rad`, 180], ["1e308deg", 1e308]]) {
    const parsed = parseOklch(`oklch(.62 .02 ${hue})`);
    assert.deepEqual(parsed.errors, [], hue);
    assert.deepEqual(parsed.source, { l: 0.62, c: 0.02, h: degrees });
    assert.ok(Object.values(parsed.color).every(Number.isFinite), hue);
    assert.ok(parsed.color.h >= 0 && parsed.color.h < 360, hue);
  }
});

test("both palette syntaxes discard colors whose converted channels overflow", () => {
  for (const css of [
    ":root { --palette-overflow: oklch(.62 .02 1e308turn); }",
    property("palette-overflow", "ui").replace("oklch(0.62 0.02 32)", "oklch(.62 .02 1e308turn)"),
  ]) {
    const report = parsePaletteWithDiagnostics(css);
    assert.ok(report.errors.some((error) => /--palette-overflow:.*finite/i.test(error)));
    for (const entries of [report.tokens, report.authoredTokens, report.annotatedRoles, report.annotatedDarkBlends]) {
      assert.equal(Object.hasOwn(entries, "palette-overflow"), false);
    }
  }
});

test("both palette syntaxes retain a declared constructor as an own token", () => {
  for (const css of [
    ":root { /* @role ui */ --constructor: oklch(0.62 0.02 32); }",
    property("constructor", "ui"),
  ]) {
    const report = parsePaletteWithDiagnostics(css);
    assert.deepEqual(report.errors, []);
    assert.equal(Object.hasOwn(report.tokens, "constructor"), true);
    assert.deepEqual(report.authoredTokens.constructor, { l: 0.62, c: 0.02, h: 32 });
    assert.equal(report.annotatedRoles.constructor, "ui");
  }
});

test("a duplicate property is rejected even when its first block was invalid", () => {
  const report = parsePaletteWithDiagnostics(`@property --palette-primary { role: ui; }
    ${property("palette-primary", "ui", "dark-blend: 50;")}`);

  assert.ok(report.errors.some((error) => /duplicate @property/i.test(error)));
  assert.deepEqual(report.tokens, {});
  assert.deepEqual(report.authoredTokens, {});
  assert.deepEqual(report.annotatedRoles, {});
  assert.deepEqual(report.annotatedDarkBlends, {});
});
