import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { analyzeColorTokens, generateColorTokens } from "../src/generate-colors.mjs";

const PALETTE = `@property --palette-canvas {
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
}

@property --palette-status {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.62 0.14 160);
  role: feedback;
}`;

async function createProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-io-"));
  const paletteDirectory = path.join(root, "src/styles/tokens");
  await mkdir(paletteDirectory, { recursive: true });
  await writeFile(path.join(paletteDirectory, "palette.css"), PALETTE, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("generator creates missing output directories and leaves no temporary files", async (t) => {
  const root = await createProject(t);
  const output = "generated/theme/colors.css";
  const report = await generateColorTokens({ root, inlineConfig: { output } });
  const outputPath = path.join(root, output);

  assert.equal(report.changed, true);
  assert.equal(await readFile(outputPath, "utf8"), report.css);
  assert.deepEqual(await readdir(path.dirname(outputPath)), ["colors.css"]);
});

test("concurrent generations use distinct temporary files", async (t) => {
  const root = await createProject(t);
  const output = "generated/theme/colors.css";
  const originalNow = Date.now;
  Date.now = () => 1_700_000_000_000;
  t.after(() => { Date.now = originalNow; });

  const reports = await Promise.all(Array.from(
    { length: 12 },
    () => generateColorTokens({ root, inlineConfig: { output } }),
  ));
  const outputPath = path.join(root, output);

  assert.ok(reports.every((report) => report.changed));
  assert.equal(await readFile(outputPath, "utf8"), reports[0].css);
  assert.deepEqual(await readdir(path.dirname(outputPath)), ["colors.css"]);
});

test("optional motion output is separate and follows configured identities", async (t) => {
  const root = await createProject(t);
  const motionOutput = "generated/theme/colors-motion.css";
  const report = await generateColorTokens({
    root,
    inlineConfig: {
      roles: {
        identities: {
          status: { token: "--palette-status", role: "feedback" },
        },
      },
      motion: {
        enabled: true,
        output: motionOutput,
      },
    },
  });

  assert.equal(report.outputs.length, 2);
  assert.equal(report.motionCss, await readFile(path.join(root, motionOutput), "utf8"));
  assert.doesNotMatch(report.css, /@property/);
  assert.match(report.motionCss, /@property --color-status /);
  assert.match(report.motionCss, /@property --color-status-ink /);
  assert.match(report.motionCss, /--color-status,/);
  assert.match(report.motionCss, /--color-status-ink,/);
  assert.match(report.motionCss, /@property --color-status-solid-text /);
  assert.match(report.motionCss, /--color-status-text-strong;/);

  const transitionSection = report.motionCss.slice(report.motionCss.indexOf(":root"));
  assert.doesNotMatch(transitionSection, /--color-bg[,;]/);

  await writeFile(path.join(root, motionOutput), ":root {}\n", "utf8");
  const staleReport = await generateColorTokens({
    root,
    check: true,
    inlineConfig: {
      roles: {
        identities: {
          status: { token: "--palette-status", role: "feedback" },
        },
      },
      motion: {
        enabled: true,
        output: motionOutput,
      },
    },
  });

  assert.equal(staleReport.changed, true);
  assert.deepEqual(staleReport.errors, [`Generated ${motionOutput} is out of date. Run smart-colors build.`]);
});

test("quick reference lists resolved light and dark foundation values", async (t) => {
  const root = await createProject(t);
  const report = await generateColorTokens({ root });

  assert.match(report.css, /--color-bg\s+0\.962 0\.015 88\s+0\.135 0\.002 88/);
  assert.match(report.css, /--color-surface\s+0\.944 0\.015 88\s+0\.173 0\.003 88/);
  assert.match(report.css, /--color-text\s+0\.280 0\.007 4\s+0\.965 0\.013 88/);
  assert.match(report.css, /--color-text-muted\s+\d\.\d{3} \d\.\d{3} \d+\s+\d\.\d{3} \d\.\d{3} \d+/);
});

// SC-08 seam: the workflow writes through the internal capability attached to the session
// analysis, which re-validates paths and the strict contract before writing. The public
// `generateColorTokens` ignores a caller-provided analysis, so a forged object cannot bypass
// validation or overwrite another path.
test("the internal analysis capability re-validates and the public generator ignores a forged analysis", async (t) => {
  const root = await createProject(t);
  const analysis = await analyzeColorTokens({ root });

  // The capability is non-enumerable: it never leaks into the serialized payload.
  assert.equal(Object.prototype.propertyIsEnumerable.call(analysis, "applyValidatedOutput"), false);
  assert.equal(JSON.parse(JSON.stringify(analysis)).applyValidatedOutput, undefined);
  assert.equal(typeof analysis.applyValidatedOutput, "function");

  const written = await analysis.applyValidatedOutput();
  assert.equal(written.changed, true);
  assert.equal(written.css, analysis.css);
  assert.deepEqual(written.outputs, [{ path: "src/styles/tokens/colors.css", changed: true }]);
  assert.equal(await readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8"), analysis.css);

  const upToDate = await analysis.applyValidatedOutput();
  assert.equal(upToDate.changed, false);

  // A forged analysis pointed at the palette is ignored by the public entry point: the palette must
  // stay byte-identical and the real configured output is what gets written.
  const forged = { config: { ...analysis.config, output: "src/styles/tokens/palette.css" }, css: "forged", motionCss: null, errors: [] };
  await rm(path.join(root, "src/styles/tokens/colors.css"));
  const regenerated = await generateColorTokens({ root, analysis: forged });
  assert.equal(await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), PALETTE);
  assert.equal(await readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8"), regenerated.css);
});

test("path collisions and an invalid contrast contract are rejected before any write", async (t) => {
  const root = await createProject(t);

  // palette against output: the resolved configuration collides and must be rejected.
  await assert.rejects(
    generateColorTokens({ root, inlineConfig: { output: "src/styles/tokens/palette.css" } }),
    /output path collision/i,
  );
  assert.equal(await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), PALETTE);

  // motion output against the generated output.
  await assert.rejects(
    generateColorTokens({ root, inlineConfig: { motion: { enabled: true, output: "src/styles/tokens/colors.css" } } }),
    /output path collision/i,
  );

  // The internal capability re-runs the guard at write time against the real filesystem: a symlink
  // created after the analysis redirects the output onto the palette and must be rejected.
  const captured = await analyzeColorTokens({ root });
  await symlink("palette.css", path.join(root, "src/styles/tokens/colors.css"));
  await assert.rejects(captured.applyValidatedOutput(), /output path collision/i);
  await rm(path.join(root, "src/styles/tokens/colors.css"));
  assert.equal(await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), PALETTE);
});

test("the internal capability ignores later mutation of the analysis and of the options object", async (t) => {
  const root = await createProject(t);

  // The `options` object is consumed once: mutating it after the analysis cannot redirect the write.
  const options = { root, configFile: undefined };
  const analysis = await analyzeColorTokens(options);
  const evil = path.join(tmpdir(), `smart-colors-evil-${process.pid}`);
  options.configFile = "evil/config.mjs";
  options.root = evil;
  const written = await analysis.applyValidatedOutput();
  assert.equal(written.css, analysis.css);
  assert.equal(await readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8"), analysis.css);
  await assert.rejects(readFile(path.join(evil, "src/styles/tokens/colors.css"), "utf8"), { code: "ENOENT" });

  // Mutating the exposed analysis is refused instead of being trusted: no write at all.
  const tampered = await analyzeColorTokens({ root });
  tampered.errors = [];
  tampered.css = "forged bytes";
  tampered.config.output = "src/styles/tokens/palette.css";
  await assert.rejects(tampered.applyValidatedOutput(), /changed after it was validated/);
  assert.equal(await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), PALETTE);
});

test("clearing analysis.errors never bypasses the strict contract", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-strict-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  const unreachable = `@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.52 0 0); role: canvas; }
@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0 0); role: ink; }
@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.16 32); role: ui; }`;
  await writeFile(path.join(root, "src/styles/tokens/palette.css"), unreachable);
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { contrast: { text: 7 } };\n");

  const analysis = await analyzeColorTokens({ root });
  assert.ok(analysis.errors.length > 0, "fixture must produce model errors");
  // Even without touching the object, the strict contract still blocks the write.
  await assert.rejects(analysis.applyValidatedOutput(), /invalid contrast contract/);
  // Clearing the exposed errors is detected as tampering and still writes nothing.
  analysis.errors = [];
  await assert.rejects(analysis.applyValidatedOutput());
  await assert.rejects(readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8"), { code: "ENOENT" });
});

test("a palette path with # and % is read and written as a literal path", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-io-hash-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "brand #50%"), { recursive: true });
  await writeFile(path.join(root, "brand #50%/palette.css"), PALETTE, "utf8");

  const report = await generateColorTokens({
    root,
    inlineConfig: { palette: "brand #50%/palette.css", output: "out #1%/colors.css" },
  });
  assert.ok(report.css.length > 0);
  assert.equal(await readFile(path.join(root, "out #1%/colors.css"), "utf8"), report.css);
});

test("a missing palette raises a typed not-found error and writes nothing", async (t) => {
  const root = await createProject(t);
  await rm(path.join(root, "src/styles/tokens/palette.css"));

  for (const check of [false, true]) {
    await assert.rejects(generateColorTokens({ root, check, suggest: false }), (error) => {
      assert.equal(error.code, "ENOENT");
      assert.equal(error.smartColorsCode, "SMART_COLORS_PALETTE_NOT_FOUND");
      assert.equal(error.palettePath, "src/styles/tokens/palette.css");
      assert.equal(error.root, root);
      assert.equal(error.configFile, "smart-colors.config.mjs");
      assert.equal(error.cause.code, "ENOENT");
      return true;
    });
  }

  // A missing palette is never mistaken for an empty one, so no output is produced.
  assert.deepEqual(await readdir(path.join(root, "src/styles/tokens")), []);
});

test("a palette path that is a directory stays an unambiguous read error, not a not-found", async (t) => {
  const root = await createProject(t);
  await rm(path.join(root, "src/styles/tokens/palette.css"));
  await mkdir(path.join(root, "src/styles/tokens/palette.css"));

  await assert.rejects(generateColorTokens({ root, suggest: false }), (error) => {
    assert.equal(error.code, "EISDIR");
    assert.notEqual(error.smartColorsCode, "SMART_COLORS_PALETTE_NOT_FOUND");
    return true;
  });
});
