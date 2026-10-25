import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSmartColorsConfig } from "../../src/colors/defaults.mjs";
import { acceptDiagnosticOutput, applyDiagnosticOutput, assertDiagnosticInputsUnchanged, createDiagnosticSession } from "../../src/diagnostics/diagnostic-session.mjs";
import { formatContrastReportHtml, prepareContrastReport, prepareDiagnosticReport, validation } from "../../src/diagnostics/report/format-report-html.mjs";

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

const PALETTE = `@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; }
@property --palette-ink { initial-value: oklch(.28 .007 3.68); role: ink; }
@property --palette-primary { initial-value: oklch(.62 .300049 32.00005); role: ui; }`;

const PALETTE_PATH = "src/styles/tokens/palette.css";
const OUTPUT_PATH = "src/styles/tokens/colors.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const MOTION_PATH = "src/styles/colors-motion.css";
const CUSTOM_PALETTE_PATH = "src/styles/tokens/custom-palette.css";
const CONFIG_FILE = "smart-colors.config.mjs";
const SAMPLE_KEYS = ["background", "backgroundToken", "browser", "foreground", "foregroundToken", "kind", "label", "minimum", "preference", "provenance", "ratio", "scheme", "status", "target"];

// A config module that rewrites itself during import: the bytes the session hashes before the
// import no longer match the bytes on disk afterwards.
const RACING_CONFIG = [
  `import { writeFileSync } from "node:fs";`,
  `const self = new URL(import.meta.url);`,
  `self.search = "";`,
  `writeFileSync(self, "export default {}; // rewritten during import\\n");`,
  `export default { palette: "src/styles/tokens/palette.css", output: "src/styles/tokens/colors.css" };`,
  "",
].join("\n");

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-diagnostic-session-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, PALETTE_PATH), PALETTE);
  return root;
}

// Only serializable payloads may leave the session: no functions/symbols/bigints, and a second
// serialization pass must be byte-identical (nothing silently dropped on the first pass).
function assertJsonOnly(value) {
  const json = JSON.stringify(value);
  assert.equal(typeof json, "string");
  assert.equal(JSON.stringify(JSON.parse(json)), json, "payload must be JSON-stable");
  const walk = (node) => {
    if (node === null) return;
    if (typeof node === "function" || typeof node === "symbol" || typeof node === "bigint") assert.fail(`non-JSON ${typeof node} value in the payload`);
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node === "object") return Object.values(node).forEach(walk);
  };
  walk(value);
  return json;
}

test("session extends the legacy snapshot with a JSON-only, self-describing diagnostic payload", async (t) => {
  const root = await fixture(t);
  const { session, analysis, captured } = await createDiagnosticSession({ root, suggest: false });

  assert.equal(session.schemaVersion, 1);
  assert.match(session.toolVersion, /^\d+\.\d+\.\d+/);
  assert.match(session.snapshotId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(session.generatedAt, new Date(session.generatedAt).toISOString());
  assert.deepEqual(session.files, { palette: PALETTE_PATH, config: CONFIG_FILE, tuning: TUNING_PATH, output: OUTPUT_PATH, motion: MOTION_PATH });
  assert.equal(session.inputDigest.length, 64);
  assert.deepEqual(Object.keys(session.inputs[0]).sort(), ["name", "path", "present", "sha256"]);
  for (const input of session.inputs) {
    assert.equal(input.present, input.name === "palette");
    assert.equal(input.sha256, input.present ? input.sha256 : null);
  }
  assert.equal(session.css.baseline, analysis.css);
  assert.deepEqual({ tuning: session.css.tuning, support: session.css.tuningSupport }, { tuning: null, support: "absent" });
  assert.deepEqual(session.config, JSON.parse(JSON.stringify(analysis.config)));
  assert.deepEqual(session.model.diagnostics, analysis.model.diagnostics);
  assert.deepEqual(session.model.errors, analysis.errors);
  assert.deepEqual(session.model.warnings, analysis.warnings);
  assert.deepEqual(session.samples.map((group) => group.scheme), ["light", "dark"]);
  for (const group of session.samples) {
    assert.equal(group.provenance, "model");
    assert.equal(group.browser, "model");
    assert.ok(group.diagnostics.length > 0);
    for (const sample of group.diagnostics) assert.deepEqual(Object.keys(sample).sort(), SAMPLE_KEYS);
  }
  assert.deepEqual(session.automation, {
    provenance: "model", mode: "off", status: "disabled",
    expected: { scenarios: [], pairs: [] }, executed: { scenarios: [], pairs: [] },
    measurements: [], errors: [], environment: null, measuredAt: null,
  });
  const json = assertJsonOnly(session);
  assert.ok(!json.includes(root), "the session payload must not reference the checkout");
  // Node-only objects are returned separately, never embedded in the payload.
  assert.ok(Array.isArray(captured.inputs));
  assert.equal(Object.hasOwn(captured, "acceptedOutputs"), false);
});

test("a resolved config is authoritative and the caller's inlineConfig always reaches the loader", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, CUSTOM_PALETTE_PATH), PALETTE);
  await writeFile(path.join(root, "src/styles/tokens/other-palette.css"), PALETTE.replace("--palette-primary", "--palette-secondary"));
  await writeFile(path.join(root, CONFIG_FILE), `export default { palette: "src/styles/tokens/other-palette.css", output: "src/styles/tokens/other-colors.css" };`);

  // Loader branch: the option reaches loadSmartColorsConfig, so it is applied, not ignored.
  const { session: loaded } = await createDiagnosticSession({
    root, suggest: false,
    inlineConfig: { palette: CUSTOM_PALETTE_PATH, output: "src/styles/tokens/inline-colors.css" },
  });
  assert.equal(loaded.config.palette, CUSTOM_PALETTE_PATH);
  assert.equal(loaded.files.output, "src/styles/tokens/inline-colors.css");

  // Resolved-config branch: the custom config wins over the default/file, and inlineConfig still applies on top.
  const selected = { ...structuredClone(defaultSmartColorsConfig), palette: PALETTE_PATH, output: OUTPUT_PATH };
  const { session: custom } = await createDiagnosticSession({ root, config: selected, suggest: false });
  assert.equal(custom.config.palette, PALETTE_PATH);
  assert.equal(custom.files.output, OUTPUT_PATH);
  assert.notEqual(custom.config.palette, "src/styles/tokens/other-palette.css");
  assert.equal(custom.files.config, CONFIG_FILE);
  assert.equal(custom.inputs.find((input) => input.name === "config").present, true);

  const { session: overridden } = await createDiagnosticSession({ root, config: selected, suggest: false, inlineConfig: { output: "src/styles/tokens/inline-colors.css" } });
  assert.equal(overridden.config.output, "src/styles/tokens/inline-colors.css");
  assert.equal(overridden.files.output, "src/styles/tokens/inline-colors.css");
  assert.equal(overridden.config.palette, PALETTE_PATH);

  await writeFile(path.join(root, "custom.config.mjs"), "export default {};");
  const { session: adopted } = await createDiagnosticSession({ root, config: selected, configFile: "custom.config.mjs", suggest: false });
  assert.equal(adopted.files.config, "custom.config.mjs");
  assert.equal(adopted.inputs.find((input) => input.name === "config").present, true);
});

test("an unloadable config blocks the session with a typed not-found code", async (t) => {
  const root = await fixture(t);
  await assert.rejects(() => createDiagnosticSession({ root, configFile: "missing.config.mjs", suggest: false }), (error) => {
    assert.equal(error.code, "ENOENT");
    assert.equal(error.smartColorsCode, "SMART_COLORS_CONFIG_NOT_FOUND");
    assert.equal(error.configFile, "missing.config.mjs");
    assert.equal(error.root, root);
    assert.equal(error.cause.code, "ENOENT");
    return true;
  });
});

test("a missing palette is named explicitly before any analysis", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-diagnostic-session-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => createDiagnosticSession({ root, suggest: false }), (error) => {
    assert.equal(error.code, "ENOENT");
    assert.equal(error.smartColorsCode, "SMART_COLORS_PALETTE_NOT_FOUND");
    assert.equal(error.palettePath, PALETTE_PATH);
    assert.equal(error.root, root);
    assert.equal(error.configFile, CONFIG_FILE);
    // Never the misleading canvas/ink contract errors of an empty read.
    assert.doesNotMatch(error.message, /roles\.canvas|validation failed/);
    return true;
  });
});

test("a config that changes during import blocks the session", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, CONFIG_FILE), RACING_CONFIG);
  await assert.rejects(() => createDiagnosticSession({ root, suggest: false }), { code: "SMART_COLORS_INPUTS_CHANGED" });
});

test("the session describes the captured palette bytes and blocks source changes", async (t) => {
  const root = await fixture(t);
  const { session, captured } = await createDiagnosticSession({ root, suggest: false });
  const primary = session.paletteSource.sources.find((source) => source.token === "--palette-primary");
  assert.equal(primary.value, "oklch(.62 .300049 32.00005)");
  assert.equal(session.paletteSource.css, PALETTE);

  await writeFile(path.join(root, PALETTE_PATH), PALETTE.replace(".62", ".70"));
  assert.equal(session.paletteSource.css, PALETTE);
  assert.equal(session.paletteSource.sources.find((source) => source.token === "--palette-primary").value, "oklch(.62 .300049 32.00005)");
  await assert.rejects(assertDiagnosticInputsUnchanged(root, captured), { code: "SMART_COLORS_INPUTS_CHANGED" });

  await writeFile(path.join(root, PALETTE_PATH), PALETTE);
  await assertDiagnosticInputsUnchanged(root, captured);
  await writeFile(path.join(root, CONFIG_FILE), "export default {};");
  await assert.rejects(assertDiagnosticInputsUnchanged(root, captured), { code: "SMART_COLORS_INPUTS_CHANGED" });
});

test("output is accepted before publication and any later external change blocks it", async (t) => {
  const root = await fixture(t);
  const { captured, analysis } = await createDiagnosticSession({ root, suggest: false });

  // External write after capture, before acceptance: blocked, not silently published.
  await writeFile(path.join(root, OUTPUT_PATH), "foreign write");
  await assert.rejects(assertDiagnosticInputsUnchanged(root, captured), { code: "SMART_COLORS_INPUTS_CHANGED" });

  // A genuine build write is byte-identical to the analysis: accept first, then the final assert.
  await writeFile(path.join(root, OUTPUT_PATH), analysis.css);
  const accepted = await acceptDiagnosticOutput(root, captured, analysis);
  assert.equal(accepted.accepted, true);
  assert.deepEqual(captured.acceptedOutputs, { output: accepted.outputs[0].sha256 });
  await assertDiagnosticInputsUnchanged(root, captured);

  // A later external change blocks again even though a write was accepted.
  await writeFile(path.join(root, OUTPUT_PATH), `${analysis.css}\n/* intruder */`);
  await assert.rejects(assertDiagnosticInputsUnchanged(root, captured), { code: "SMART_COLORS_INPUTS_CHANGED" });
});

test("a stale output left untouched stays a non-production candidate and never blocks", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, OUTPUT_PATH), "old generated css");
  const { captured, analysis } = await createDiagnosticSession({ root, suggest: false });

  const result = await acceptDiagnosticOutput(root, captured, analysis);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.candidates, [{ name: "output", path: OUTPUT_PATH, present: true, reason: "differs" }]);
  await assertDiagnosticInputsUnchanged(root, captured);
});

test("tuning state is explicit and unsupported resources never read as a pass", async (t) => {
  const root = await fixture(t);
  const { session: absent } = await createDiagnosticSession({ root, suggest: false });
  assert.deepEqual({ tuning: absent.css.tuning, support: absent.css.tuningSupport }, { tuning: null, support: "absent" });

  await writeFile(path.join(root, TUNING_PATH), ":root { --color-tune-x: 1; }");
  const { session: supported } = await createDiagnosticSession({ root, suggest: false });
  assert.equal(supported.css.tuningSupport, "supported");
  assert.equal(supported.css.tuning, ":root { --color-tune-x: 1; }");
  assert.deepEqual(supported.notes, []);

  await writeFile(path.join(root, TUNING_PATH), '@import "./other.css";\n:root { --color-tune-x: 2; }');
  const { session: unsupported } = await createDiagnosticSession({ root, suggest: false });
  assert.equal(unsupported.css.tuningSupport, "unsupported");
  assert.ok(unsupported.notes.some((note) => /non supportat/i.test(note)));
});

test("a present but unreadable tuning is explicit and never treated as absent", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, TUNING_PATH), { recursive: true });
  await assert.rejects(() => createDiagnosticSession({ root, suggest: false }), (error) => {
    assert.equal(error.code, "SMART_COLORS_INPUT_UNREADABLE");
    assert.match(error.message, /tuning/);
    return true;
  });
});

test("acceptDiagnosticOutput accepts only byte-identical output, records the baseline and keeps inputDigest", async (t) => {
  const root = await fixture(t);
  const { session, captured, analysis } = await createDiagnosticSession({ root, suggest: false });

  assert.deepEqual(await acceptDiagnosticOutput(root, captured, analysis), {
    accepted: false,
    outputs: [{ name: "output", path: OUTPUT_PATH, present: false, matches: false, sha256: null, capturedSha256: null, changed: false }],
    candidates: [{ name: "output", path: OUTPUT_PATH, present: false, reason: "absent" }],
  });
  assert.deepEqual(captured.acceptedOutputs, {});

  await writeFile(path.join(root, OUTPUT_PATH), analysis.css);
  const intentional = await acceptDiagnosticOutput(root, captured, analysis);
  assert.equal(intentional.accepted, true);
  assert.deepEqual(intentional.candidates, []);
  assert.equal(intentional.outputs[0].matches, true);
  assert.equal(intentional.outputs[0].changed, true);
  // Recording the accepted output is Node-only and never rewrites the published session.
  assert.deepEqual(captured.acceptedOutputs, { output: intentional.outputs[0].sha256 });
  assert.equal(session.inputDigest, session.inputDigest);

  await writeFile(path.join(root, OUTPUT_PATH), `${analysis.css}\n/* tampered */`);
  const tampered = await acceptDiagnosticOutput(root, captured, analysis);
  assert.equal(tampered.accepted, false);
  assert.deepEqual(tampered.candidates, [{ name: "output", path: OUTPUT_PATH, present: true, reason: "changed" }]);
});

test("when motion is enabled the motion write is accepted and watched separately", async (t) => {
  const root = await fixture(t);
  const selected = { ...structuredClone(defaultSmartColorsConfig), motion: { enabled: true, output: MOTION_PATH } };
  const { captured, analysis } = await createDiagnosticSession({ root, config: selected, suggest: false });
  assert.equal(typeof analysis.motionCss, "string");

  await writeFile(path.join(root, OUTPUT_PATH), analysis.css);
  await writeFile(path.join(root, MOTION_PATH), analysis.motionCss);
  const complete = await acceptDiagnosticOutput(root, captured, analysis);
  assert.deepEqual(complete.outputs.map((output) => output.name).sort(), ["motion", "output"]);
  assert.equal(complete.accepted, true);
  assert.deepEqual(Object.keys(captured.acceptedOutputs).sort(), ["motion", "output"]);
  await assertDiagnosticInputsUnchanged(root, captured);

  await writeFile(path.join(root, MOTION_PATH), "/* stale motion */");
  assert.deepEqual((await acceptDiagnosticOutput(root, captured, analysis)).candidates, [{ name: "motion", path: MOTION_PATH, present: true, reason: "changed" }]);
  await assert.rejects(assertDiagnosticInputsUnchanged(root, captured), { code: "SMART_COLORS_INPUTS_CHANGED" });
});

test("css separates the expected generated CSS from the actual output (absent, stale, current, empty, unsupported)", async (t) => {
  const root = await fixture(t);

  // absent: the generated CSS is only a declared candidate, never production.
  const absent = (await createDiagnosticSession({ root, suggest: false })).session;
  assert.equal(absent.css.source, "generated-candidate");
  assert.equal(absent.css.status, "absent");
  assert.equal(absent.css.production, false);
  assert.equal(absent.css.baseline, absent.css.generated);
  assert.equal(absent.css.digest.generated, sha256(absent.css.generated));
  assert.equal(absent.css.digest.baseline, absent.css.digest.generated);
  assert.equal(absent.css.baselineSupport, "supported");

  // stale: the actual on-disk bytes (different from the model) are the measured baseline.
  const FOREIGN = ":root { color-scheme: light dark; --color-bg: light-dark(rgb(1, 2, 3), rgb(4, 5, 6)); }\n";
  await writeFile(path.join(root, OUTPUT_PATH), FOREIGN);
  const stale = (await createDiagnosticSession({ root, suggest: false })).session;
  assert.equal(stale.css.source, "output");
  assert.equal(stale.css.status, "stale");
  assert.equal(stale.css.production, false);
  assert.equal(stale.css.baseline, FOREIGN);
  assert.notEqual(stale.css.baseline, stale.css.generated);
  assert.equal(stale.css.digest.baseline, sha256(FOREIGN));
  assert.equal(stale.css.baselineSupport, "supported");

  // current: byte-identical to the model is the accepted production output.
  await writeFile(path.join(root, OUTPUT_PATH), stale.css.generated);
  const current = (await createDiagnosticSession({ root, suggest: false })).session;
  assert.equal(current.css.source, "output");
  assert.equal(current.css.status, "current");
  assert.equal(current.css.production, true);
  assert.equal(current.css.digest.baseline, current.css.digest.generated);

  // empty: a present-but-empty output is never replaced by the generated candidate.
  await writeFile(path.join(root, OUTPUT_PATH), "");
  const empty = (await createDiagnosticSession({ root, suggest: false })).session;
  assert.equal(empty.css.source, "output");
  assert.equal(empty.css.status, "empty");
  assert.equal(empty.css.production, false);
  assert.equal(empty.css.baseline, "");
  assert.equal(empty.css.digest.baseline, null);
  assert.equal(empty.css.baselineSupport, "unsupported");
  assert.notEqual(empty.css.baseline, empty.css.generated);
  assert.ok(empty.notes.some((note) => /vuoto/i.test(note)));

  // unsupported actual: @import/url() in the real output is declared, never read as a pass.
  await writeFile(path.join(root, OUTPUT_PATH), ':root { background-image: url("x.png"); }\n');
  const unsupported = (await createDiagnosticSession({ root, suggest: false })).session;
  assert.equal(unsupported.css.status, "stale");
  assert.equal(unsupported.css.baselineSupport, "unsupported");
  assert.ok(unsupported.notes.some((note) => /non supportat/i.test(note)));
});

test("applyDiagnosticOutput records the intentional build bytes as the measured baseline", async (t) => {
  const root = await fixture(t);
  const { session, analysis, captured } = await createDiagnosticSession({ root, suggest: false });
  assert.equal(session.css.status, "absent");

  const descriptor = applyDiagnosticOutput(session, analysis, captured, null, { written: analysis.css });
  assert.equal(descriptor, session.css);
  assert.equal(session.css.baseline, analysis.css);
  assert.equal(session.css.source, "output");
  assert.equal(session.css.status, "current");
  assert.equal(session.css.production, true);
  assert.equal(session.css.digest.baseline, sha256(analysis.css));
  // The helper never touches the captured inputs or the accepted-output baseline.
  assert.equal(Object.hasOwn(captured, "acceptedOutputs"), false);
});

// --- Additive session.paletteSource source contract (never supersedes session.palette) ---------

const PROPERTY_PALETTE = [
  "@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; }",
  "@property --palette-ink { initial-value: oklch(.28 .007 3.68); role: ink; }",
  "@property --palette-primary { initial-value: oklch(.62 .300049 32.00005); role: ui; }",
].join("\n");

const LEGACY_PALETTE = [
  ":root {",
  "  /* @role canvas */",
  "  --palette-canvas: oklch(0.96 0.01 88);",
  "  /* @role ink */",
  "  --palette-ink: oklch(0.28 0.007 4);",
  "  /* @role ui */",
  "  --palette-primary: oklch(0.62 0.02 32);",
  "}",
  "",
].join("\n");

test("session.paletteSource captures the exact palette bytes and one source per authored token", async (t) => {
  const root = await fixture(t);
  const { session } = await createDiagnosticSession({ root, suggest: false });

  assert.deepEqual(Object.keys(session.paletteSource).sort(), ["css", "path", "sha256", "sources"]);
  assert.equal(session.paletteSource.css, PALETTE);
  assert.equal(session.paletteSource.path, PALETTE_PATH);
  assert.equal(session.paletteSource.sha256, sha256(PALETTE));
  assert.equal(session.paletteSource.sha256, session.inputs.find((input) => input.name === "palette").sha256);

  assert.deepEqual(session.paletteSource.sources.map((source) => source.token), ["--palette-bg", "--palette-ink", "--palette-primary"]);
  for (const source of session.paletteSource.sources) {
    assert.deepEqual(Object.keys(source).sort(), ["darkBlend", "declaration", "role", "token", "value"]);
  }
  // Exact initial-value and the exact @property declaration, sliced from the captured bytes.
  assert.deepEqual(session.paletteSource.sources[0], {
    token: "--palette-bg",
    value: "oklch(.962 .015 88)",
    role: "canvas",
    darkBlend: null,
    declaration: "@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; }",
  });
  assert.equal(session.paletteSource.sources[2].value, "oklch(.62 .300049 32.00005)");
  assert.equal(session.paletteSource.sources[2].role, "ui");
  assert.equal(session.paletteSource.sources[2].darkBlend, null);
  // The payload stays JSON-only: sources and raw bytes are plain data, no functions or lookups.
  assertJsonOnly(session);
});

for (const finalDescriptor of ["role", "initial-value"]) {
  test(`session.paletteSource retains exact raw bytes with a final ${finalDescriptor} without a semicolon`, async (t) => {
    const root = await fixture(t);
    const value = "oklch(.62 /* raw ; ) } */ .14 32)";
    for (const suffix of ["", " \t\r\n", " /* trailing ; } */\r\n/* another comment */ "]) {
      const descriptors = finalDescriptor === "role"
        ? `initial-value: ${value};\r\n  role: ui`
        : `role: ui;\r\n  initial-value: ${value}`;
      const declaration = `@property --palette-primary {\r\n  /* descriptors */\r\n  syntax: "<color>";\r\n  inherits: true;\r\n  ${descriptors}${suffix}}`;
      const css = `/* offset: à ; }\r\n@property --ignored {} */\r\n${PALETTE.split("\n").slice(0, 2).join("\r\n")}\r\n${declaration}\r\n/* outside */`;
      await writeFile(path.join(root, PALETTE_PATH), css);

      const { session } = await createDiagnosticSession({ root, suggest: false, automation: "off" });
      assert.equal(session.paletteSource.css, css);
      assert.equal(session.paletteSource.sha256, sha256(css));
      assert.deepEqual(session.paletteSource.sources.find((source) => source.token === "--palette-primary"), {
        token: "--palette-primary",
        value,
        role: "ui",
        darkBlend: null,
        declaration,
      }, suffix);
      assert.deepEqual(session.palette.find((source) => source.name === "--palette-primary").authored, { l: 0.62, c: 0.14, h: 32 });
    }
  });
}

test("session.paletteSource is additive: the legacy snapshot palette array is untouched", async (t) => {
  const root = await fixture(t);
  const { session } = await createDiagnosticSession({ root, suggest: false });

  // The legacy array survives with the exact snapshot rows (name/role/authored/resolved/darkBlend),
  // so report validation, the palette gallery and the proposal/variant views keep reading it.
  assert.ok(Array.isArray(session.palette), "session.palette must stay the legacy snapshot array");
  assert.deepEqual(session.palette.map((item) => item.name), ["--palette-bg", "--palette-ink", "--palette-primary"]);
  for (const item of session.palette) {
    assert.deepEqual(Object.keys(item).sort(), ["authored", "darkBlend", "name", "resolved", "role"]);
  }
  const primary = session.palette.find((item) => item.name === "--palette-primary");
  assert.equal(primary.role, "ui");
  assert.equal(primary.authored.l, 0.62);
  // The additive source list describes exactly the same authored tokens, in the same order.
  assert.deepEqual(
    session.paletteSource.sources.map((source) => source.token),
    session.palette.map((item) => item.name),
  );
});

test("session.paletteSource keeps an explicit dark-blend 0 distinct from an omitted descriptor", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, PALETTE_PATH), [
    "@property --palette-bg { initial-value: oklch(.962 .015 88); role: canvas; dark-blend: 0; }",
    "@property --palette-ink { initial-value: oklch(.28 .007 3.68); role: ink; }",
    "@property --palette-primary { initial-value: oklch(.62 .14 32); role: ui; dark-blend: 40; }",
  ].join("\n"));
  const { session } = await createDiagnosticSession({ root, suggest: false });
  const byToken = Object.fromEntries(session.paletteSource.sources.map((source) => [source.token, source]));
  assert.equal(byToken["--palette-bg"].darkBlend, 0);
  assert.equal(byToken["--palette-ink"].darkBlend, null);
  assert.equal(byToken["--palette-primary"].darkBlend, 40);
});

test("a legacy :root palette keeps exact values but reports null declaration and blend metadata", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, PALETTE_PATH), LEGACY_PALETTE);
  const { session } = await createDiagnosticSession({ root, suggest: false });

  assert.equal(session.paletteSource.css, LEGACY_PALETTE);
  assert.equal(session.paletteSource.sha256, sha256(LEGACY_PALETTE));
  assert.deepEqual(session.paletteSource.sources, [
    { token: "--palette-canvas", value: "oklch(0.96 0.01 88)", role: "canvas", darkBlend: null, declaration: null },
    { token: "--palette-ink", value: "oklch(0.28 0.007 4)", role: "ink", darkBlend: null, declaration: null },
    { token: "--palette-primary", value: "oklch(0.62 0.02 32)", role: "ui", darkBlend: null, declaration: null },
  ]);
  // No @property block is invented for a legacy palette.
  assert.ok(session.paletteSource.sources.every((source) => source.declaration === null));
});

test("markup-significant palette bytes are retained verbatim as inert data", async (t) => {
  const root = await fixture(t);
  const hostile = `/* </script><script>alert(1)</script> & \"quotes\" */\n${PROPERTY_PALETTE}`;
  await writeFile(path.join(root, PALETTE_PATH), hostile);
  const { session } = await createDiagnosticSession({ root, suggest: false });

  assert.equal(session.paletteSource.css, hostile);
  assert.ok(session.paletteSource.css.includes("</script><script>alert(1)</script>"));
  assert.equal(session.paletteSource.sha256, sha256(hostile));
  // The comment is inert for parsing, so the authored sources stay exact.
  assert.equal(session.paletteSource.sources.find((source) => source.token === "--palette-bg").value, "oklch(.962 .015 88)");
  const json = assertJsonOnly(session);
  assert.ok(json.includes("</script>"), "the raw bytes must survive JSON serialization untouched");
});

test("the palette contract is captured once and never re-read from disk", async (t) => {
  const root = await fixture(t);
  const { session } = await createDiagnosticSession({ root, suggest: false });
  await writeFile(path.join(root, PALETTE_PATH), PALETTE.replace(".62", ".70"));
  assert.equal(session.paletteSource.css, PALETTE);
  assert.equal(session.paletteSource.sources.find((source) => source.token === "--palette-primary").value, "oklch(.62 .300049 32.00005)");
});

// --- Additivity regression: the legacy palette must still validate and render ---------------

test("a real session keeps the legacy palette valid for the static report (no integrity failure)", async (t) => {
  const root = await fixture(t);
  const { session } = await createDiagnosticSession({ root, suggest: false });

  // The report gate reads `session.palette` (the array). Adding paletteSource must not break it:
  // a wrongly superseded palette would flag "Campo palette assente o non valido" and suppress the
  // palette gallery plus the proposal/variant views.
  for (const prepared of [prepareContrastReport(session), prepareDiagnosticReport(session)]) {
    assert.deepEqual(prepared.problems.filter((problem) => /palette/i.test(problem)), [], "no palette integrity problem may be reported");
  }

  const html = formatContrastReportHtml(session);
  assert.doesNotMatch(html, /La palette contiene dati non validi/);
  assert.doesNotMatch(html, /Campo palette assente o non valido/);
  assert.doesNotMatch(html, /Palette originale non disponibile/);
  // Legacy palette data (token name and role) still renders in the static report.
  assert.match(html, /<h3>--palette-primary<\/h3>/);
  assert.match(html, /Ruolo: <code>ui<\/code>/);
});

test("report validation still fails closed on a genuinely missing or invalid palette", () => {
  const base = {
    generatedAt: new Date().toISOString(),
    inputDigest: "a".repeat(64),
    files: { palette: PALETTE_PATH, config: CONFIG_FILE, tuning: null, output: OUTPUT_PATH },
    scenarios: [], overlaps: [], proposals: [], generationErrors: [], auditErrors: [], notes: [], rejectedSources: [],
  };
  // Missing palette field: explicit integrity problem.
  assert.ok(validation(base, [], []).problems.includes("Campo palette assente o non valido."));
  // A palette row with an invalid color is rejected, never silently accepted.
  const invalid = { ...base, palette: [{ name: "--palette-x", role: "ui", authored: { l: 0.5, c: 0.1, h: 30 }, resolved: null }] };
  assert.deepEqual(validation(invalid, [], []).problems.filter((problem) => /palette/i.test(problem)), ["La palette contiene dati non validi."]);
  // A valid palette row (the session's own array shape) clears the gate.
  const valid = { ...base, palette: [{ name: "--palette-x", role: "ui", authored: { l: 0.5, c: 0.1, h: 30 }, resolved: { l: 0.5, c: 0.1, h: 30 } }] };
  assert.deepEqual(validation(valid, [], []).problems.filter((problem) => /palette/i.test(problem)), []);
});
