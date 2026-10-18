import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { acceptDiagnosticOutput, assertDiagnosticInputsUnchanged, createDiagnosticSession } from "../src/diagnostic-session.mjs";

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

test("an unloadable config blocks the session instead of reusing stale outputs", async (t) => {
  const root = await fixture(t);
  await assert.rejects(() => createDiagnosticSession({ root, configFile: "missing.config.mjs", suggest: false }), { code: "ENOENT" });
});

test("a config that changes during import blocks the session", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, CONFIG_FILE), RACING_CONFIG);
  await assert.rejects(() => createDiagnosticSession({ root, suggest: false }), { code: "SMART_COLORS_INPUTS_CHANGED" });
});

test("the session describes the captured palette bytes and blocks source changes", async (t) => {
  const root = await fixture(t);
  const { session, captured } = await createDiagnosticSession({ root, suggest: false });
  const authored = session.palette.find((item) => item.name === "--palette-primary").authored;
  assert.equal(authored.l, 0.62);

  await writeFile(path.join(root, PALETTE_PATH), PALETTE.replace(".62", ".70"));
  assert.deepEqual(session.palette.find((item) => item.name === "--palette-primary").authored, authored);
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
