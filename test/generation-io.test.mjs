import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateColorTokens } from "../src/generate-colors.mjs";

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
