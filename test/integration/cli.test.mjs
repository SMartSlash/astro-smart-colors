import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { initSmartColors } from "../../src/init.mjs";
import { REPORT_ASSETS, REPORT_DIRECTORY, REPORT_DOCUMENTS } from "../../src/diagnostics/report-paths.mjs";
import { cssState, measurementAvailable, provenance, verdict, verificationComplete } from "../../src/cli-style.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../../src/cli.mjs", import.meta.url));
const CLI_STYLE_URL = pathToFileURL(fileURLToPath(new URL("../../src/cli-style.mjs", import.meta.url))).href;
const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PALETTE_TEMPLATE = await readFile(new URL("../../src/templates/palette.css", import.meta.url), "utf8");
const TUNING_TEMPLATE = await readFile(new URL("../../src/templates/colors-tuning.css", import.meta.url), "utf8");
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
}`;

const INFO_PROPERTY = `\n\n@property --palette-info {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.56 0.12 260);
  role: feedback;
}`;

const OUTPUT_PATH = "src/styles/tokens/colors.css";
const PALETTE_PATH = "src/styles/tokens/palette.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const PREVIEW_PATH = REPORT_DOCUMENTS.preview;
const REPORT_PATH = REPORT_DOCUMENTS.report;
const PUBLISHED_ARTIFACTS = [
  PREVIEW_PATH, REPORT_PATH,
  path.join(REPORT_DIRECTORY, REPORT_ASSETS.reportStyle),
  path.join(REPORT_DIRECTORY, REPORT_ASSETS.previewStyle),
  path.join(REPORT_DIRECTORY, REPORT_ASSETS.previewScript),
].sort();
const REPORT_PACKAGE = JSON.stringify({ scripts: { "colors:report": "node report.mjs" } });

const PROGRESS_LINE = /^smart-colors: (palette analysis|token generation|checking optional automation|automated verification required|preview and report)$/;

// A workflow failure may only ever leave the started phases on stdout: never a success, a link or a
// generated artifact. Usage errors (resolved before the workflow) must keep stdout strictly empty.
function assertNoSuccessStdout(stdout) {
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    assert.match(line, PROGRESS_LINE, `only started-phase progress may appear on stdout, got: ${JSON.stringify(line)}`);
  }
}

async function createProject(t, paletteCss = PALETTE, { colorsCss = ":root {}\n" } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-cli-"));
  const tokenDirectory = path.join(root, "src/styles/tokens");
  await mkdir(tokenDirectory, { recursive: true });
  await writeFile(path.join(tokenDirectory, "palette.css"), paletteCss, "utf8");
  if (colorsCss !== null) await writeFile(path.join(tokenDirectory, "colors.css"), colorsCss, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function createEmptyProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-init-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function interactiveStreams() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.isTTY = true;
  stdout.isTTY = true;
  let output = "";
  stdout.on("data", (chunk) => { output += chunk; });
  return { stdin, stdout, output: () => output };
}

async function snapshotProject(root, directory = "") {
  const snapshot = {};
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(snapshot, await snapshotProject(root, relativePath));
    } else {
      const absolutePath = path.join(root, relativePath);
      snapshot[relativePath] = { contents: await readFile(absolutePath, "utf8"), mtimeMs: (await stat(absolutePath)).mtimeMs };
    }
  }
  return snapshot;
}

function runCli(root, ...args) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args, "--root", root], { timeout: 60_000 });
}

function assertReadOnlyCheck(stdout) {
  assert.match(stdout, /^  Read-only\s+does not modify files: it does not regenerate CSS, publish HTML or run a browser audit\.$/m);
  // Contrasts are a model estimate, never a measured pass: no checkmark and no "OK" here.
  assert.match(stdout, /^  Contrast\s+model estimate:/m);
  assert.doesNotMatch(stdout, /[\u2714\u2713]|\bOK\b/);
}

function assertOutcomeBlocks(stdout) {
  for (const label of ["Palette", "CSS", "Verification", "Verdict", "Preview", "Report", "Action"]) {
    assert.match(stdout, new RegExp(`^  ${label}\\s`, "m"), `output must include the ${label} line`);
  }
  assert.match(stdout, /MODEL ESTIMATE|MEASURED/, "the provenance must be explicit");
}

// ---------------------------------------------------------------------------
// Usage, help and command boundaries (§4.1/§4.2).
// ---------------------------------------------------------------------------

test("help documents the commands, the automation flag and the init options without writing", async (t) => {
  const root = await createProject(t);
  const before = await snapshotProject(root);

  for (const flag of ["--help", "-h"]) {
    const { stdout, stderr } = await runCli(root, flag);
    assert.match(stdout, /Usage: smart-colors \[build\|check\|init\|audit\|report\]/);
    assert.match(stdout, /build\s+Generate the CSS tokens and publish the preview and HTML report \(default\)/);
    assert.match(stdout, /check\s+Verify that the generated CSS tokens are up to date/);
    assert.match(stdout, /init\s+Create a starter palette and colors-tuning\.css/);
    assert.match(stdout, /audit\s+Analyze the generated tokens and colors-tuning\.css in a browser/);
    assert.match(stdout, /^  report\s+Generate the preview and HTML report$/m);
    // The report directory is a workflow result, not a constant the help may promise.
    assert.doesNotMatch(stdout, /smart-colors-reports/);
    assert.match(stdout, /--config <file>.*relative to --root.*default: smart-colors\.config\.mjs/);
    assert.match(stdout, /--automation <mode>.*Playwright automation for build\/report: auto\|off\|required/);
    assert.match(stdout, /--palette <file>.*default: config\.palette/);
    assert.match(stdout, /-y, --yes\s+Skip the interactive init confirmation/);
    assert.match(stdout, /-d, --dir <dir>\s+Token directory for init/);
    assert.equal(stderr, "");
  }

  assert.deepEqual(await snapshotProject(root), before);
});

test("audit, check and init reject the automation flag as a usage error", async (t) => {
  const root = await createProject(t);
  const before = await snapshotProject(root);

  for (const command of ["audit", "check", "init"]) {
    await assert.rejects(runCli(root, command, "--automation=off"), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /The --automation option is supported only by build and report\./);
      assert.match(error.stderr, /Usage: smart-colors/);
      return true;
    });
  }
  assert.deepEqual(await snapshotProject(root), before);
});

test("build does not accept a browser list and report rejects an unknown browser", async (t) => {
  const root = await createProject(t);
  const before = await snapshotProject(root);

  await assert.rejects(runCli(root, "build", "chromium"), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.match(error.stderr, /Unexpected arguments: "chromium"\./);
    return true;
  });

  for (const command of ["report", "audit"]) {
    await assert.rejects(runCli(root, command, "browser-inesistente"), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /Unknown browser "browser-inesistente"\. Supported browsers: chromium, firefox, webkit\./);
      assert.doesNotMatch(error.stderr, /engine launched|^  Browser\s/m);
      return true;
    });
  }

  for (const mode of ["auto", "off"]) {
    await assert.rejects(runCli(root, "report", "chromium", `--automation=${mode}`), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /An explicit browser list cannot be combined with automation mode/);
      return true;
    });
  }
  assert.deepEqual(await snapshotProject(root), before);
});

test("an unknown command and unknown option remain usage errors", async (t) => {
  const root = await createProject(t);
  const before = await snapshotProject(root);
  for (const args of [["frobnicate"], ["build", "--nope"]]) {
    await assert.rejects(runCli(root, ...args), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Usage: smart-colors/);
      return true;
    });
  }
  assert.deepEqual(await snapshotProject(root), before);
});

// ---------------------------------------------------------------------------
// build (new HTML pipeline) and check (legacy read-only).
// ---------------------------------------------------------------------------

test("build without Playwright still publishes both HTML artifacts and exits 0", async (t) => {
  const root = await createProject(t);
  const before = await snapshotProject(root);

  const built = await runCli(root, "build");

  assert.match(built.stdout, /\[smart-colors\] build/);
  assertOutcomeBlocks(built.stdout);
  assert.match(built.stdout, /optional automation not run, Playwright not installed/);
  assert.match(built.stdout, /Action\s+Open the preview: samples and native verification in the browser\./);
  assert.ok(built.stdout.endsWith("\n\n"));
  // Plain, non-repeating terminal layout: one provenance statement and no ANSI on a pipe.
  assert.equal((built.stdout.match(/MODEL ESTIMATE/g) ?? []).length, 1);
  assert.doesNotMatch(built.stdout, /\u001b\[/);

  const after = await snapshotProject(root);
  const added = Object.keys(after).filter((relativePath) => !Object.hasOwn(before, relativePath)).sort();
  assert.deepEqual(added, PUBLISHED_ARTIFACTS);
  assert.notEqual(after[OUTPUT_PATH].contents, before[OUTPUT_PATH].contents);
  assert.match(await readFile(path.join(root, PREVIEW_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(path.join(root, REPORT_DIRECTORY, REPORT_ASSETS.previewScript), "utf8"), /^\/\* smart-colors-report:v1 \*\//);
  assert.deepEqual(after[PALETTE_PATH], before[PALETTE_PATH]);
});

test("the palette subject line counts each declared role once", async (t) => {
  const root = await createProject(t);
  const built = await runCli(root, "build", "--automation=off");

  assert.match(built.stdout, /^  Palette\s+src\/styles\/tokens\/palette\.css: 5 colors \(page background: 1, base text: 1, interface: 1, feedback: 1, decorative: 1\)$/m);
});

test("build auto publishes HTML with an actionable link even when the environment is unavailable", async (t) => {
  const root = await createProject(t);
  const built = await runCli(root, "build", "--automation=auto");

  assert.match(built.stdout, /file:\/\//);
  assert.ok(built.stdout.includes("smart-colors-reports/index.html"));
  assert.ok(built.stdout.includes("smart-colors-reports/report.html"));
  assert.ok(built.stdout.includes(path.join(root, PREVIEW_PATH)));
  assert.match(built.stdout, /Action\s+Open the preview/);
});

test("build and report with automation=required exit non-zero when Playwright is absent", async (t) => {
  for (const command of ["build", "report"]) {
    await t.test(command, async (t) => {
      const root = await createProject(t);
      await assert.rejects(runCli(root, command, "--automation=required"), (error) => {
        assert.equal(error.code, 1);
        return true;
      });
      assert.match(await readFile(path.join(root, PREVIEW_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
      assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
    });
  }
});

test("automation off never touches Playwright and keeps build exit 0", async (t) => {
  const root = await createProject(t);
  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stdout, /automation disabled/);
  assert.doesNotMatch(built.stdout + built.stderr, /Playwright|browser binary|launch failed/i);
});

test("build shows the model advisory as a provenance-labelled problem, check labels contrasts as unmeasured", async (t) => {
  const clean = await createProject(t, PALETTE.replace("0.62 0.16 32", "0.6238 0.16 32"));
  const cleanBuilt = await runCli(clean, "build");
  // A clean model advisory list is omitted, never printed as a redundant all-clear line.
  assert.doesNotMatch(cleanBuilt.stdout, /^  Problems\s/m);
  assert.match(cleanBuilt.stdout, /MODEL ESTIMATE/);
  assert.match(cleanBuilt.stdout, /Verdict\s+UNVERIFIED/);
  const cleanChecked = await runCli(clean, "check");
  assert.match(cleanChecked.stdout, /Contrast\s+model estimate: 0 warnings, 0 suggestions$/m);
  assert.match(cleanChecked.stdout, /Tuning\s+src\/styles\/tokens\/colors-tuning\.css: absent \(optional\)$/m);

  const advised = await createProject(t, PALETTE + INFO_PROPERTY);
  const advisedBuilt = await runCli(advised, "build", "--automation=off");
  assert.match(advisedBuilt.stdout, /Problems\s+Button text \(primary\) on hover, light: .*below the project target/);
  assert.match(advisedBuilt.stdout, /MODEL ESTIMATE/);
  const advisedChecked = await runCli(advised, "check");
  assert.match(advisedChecked.stdout, /Contrast\s+model estimate: 1 warning, 1 suggestion, details on stderr$/m);
});

test("build prints manual foreground/source advice but only check is entirely read-only", async (t) => {
  const paletteCss = PALETTE + INFO_PROPERTY;
  const root = await createProject(t, paletteCss);
  const configText = "export default { onSolid: { info: { light: 'oklch(0.99 0 0)', dark: 'oklch(0.02 0 0)' } } };\n";
  await writeFile(path.join(root, "smart-colors.config.mjs"), configText, "utf8");
  const before = await snapshotProject(root);
  const built = await runCli(root, "build", "--automation=off");

  assert.match(built.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: regenerated/);
  assert.match(built.stderr, /\[smart-colors\] light info-on-solid \/ solid is/);
  assert.match(built.stderr, /\[smart-colors\] Suggestion: info \(light\): preserve the palette/);
  assert.match(built.stderr, /In smart-colors\.config\.mjs, set onSolid\.info\.light/);
  assert.match(built.stderr, /onSolid: \{ "info": \{ light: "oklch\(0\.9944 0 0\)" \} \}/);
  assert.match(built.stderr, /Changes only --color-info-solid-text \(light\), shared by solid\/hover; not --color-info-ink or either fill/);
  assert.match(built.stderr, /Merge into existing onSolid settings; no changes applied/);
  assert.match(built.stderr, /\[smart-colors\] Suggestion: primary \(light\): no text-only suggestion/);
  assert.match(built.stderr, /Optional source adjustment in src\/styles\/tokens\/palette\.css, @property --palette-primary, initial-value/);
  assert.match(built.stderr, /oklch\(0\.62 0\.16 32\) -> oklch\(0\.6238 0\.16 32\)/);

  const afterBuild = await snapshotProject(root);
  // build writes the CSS and the two HTML artifacts, and never the palette or config.
  assert.deepEqual(afterBuild[PALETTE_PATH], before[PALETTE_PATH]);
  assert.equal(afterBuild["smart-colors.config.mjs"].contents, configText);
  assert.notEqual(afterBuild[OUTPUT_PATH].contents, before[OUTPUT_PATH].contents);
  assert.ok(Object.hasOwn(afterBuild, PREVIEW_PATH));
  assert.ok(Object.hasOwn(afterBuild, REPORT_PATH));

  const checked = await runCli(root, "check");
  assert.match(checked.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: up to date/);
  assert.doesNotMatch(checked.stdout, /regenerated/);
  assert.equal(checked.stderr, built.stderr);
  assert.deepEqual(await snapshotProject(root), afterBuild);
});

test("build/check stay independent of any colors:* script and never require one", async (t) => {
  for (const [name, packageText] of [
    ["scripted", REPORT_PACKAGE],
    ["absent package", undefined],
    ["missing script", '{"scripts":{}}'],
    ["malformed package", '{"scripts":'],
    ["null package", "null"],
  ]) {
    await t.test(name, async (t) => {
      const root = await createProject(t);
      if (packageText !== undefined) await writeFile(path.join(root, "package.json"), packageText, "utf8");
      const built = await runCli(root, "build", "--automation=off");
      assert.doesNotMatch(built.stdout + built.stderr, /colors:report/);
      const checked = await runCli(root, "check");
      assert.doesNotMatch(checked.stdout + checked.stderr, /colors:report|reports\//);
    });
  }
});

test("default-path advice does not create a config or apply suggestions during build", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  const before = await snapshotProject(root);
  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stderr, /\[smart-colors\] light primary-on-solid \/ solid-hover is/);
  assert.match(built.stderr, /\[smart-colors\] Suggestion: primary \(light\): no text-only suggestion/);
  assert.match(built.stderr, /Optional source adjustment in src\/styles\/tokens\/palette\.css, @property --palette-primary, initial-value/);
  assert.match(built.stderr, /oklch\(0\.62 0\.16 32\) -> oklch\(0\.6238 0\.16 32\)/);
  assert.match(built.stderr, /No changes applied/);
  assert.doesNotMatch(built.stderr, /info-on-solid|Suggestion: info/);
  await assert.rejects(readFile(path.join(root, "smart-colors.config.mjs")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE + INFO_PROPERTY);

  const afterBuild = await snapshotProject(root);
  assert.deepEqual(afterBuild[PALETTE_PATH], before[PALETTE_PATH]);
  assert.notEqual(afterBuild[OUTPUT_PATH].contents, before[OUTPUT_PATH].contents);
  const checked = await runCli(root, "check");
  assert.match(checked.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: up to date$/m);
  assert.deepEqual(await snapshotProject(root), afterBuild);
});

test("build keeps the model warning strings on stderr and treats target/minimum shortfalls as advisory", async (t) => {
  for (const [lightness, ratioText, status, minimum] of [
    [0.99, "4.56", "below-target", "4.50"],
    [0.9852, "4.499", "below-minimum", "4.500000"],
  ]) {
    await t.test(status, async (t) => {
      const root = await createProject(t, PALETTE + INFO_PROPERTY);
      const configText = `export default { onSolid: { info: { light: 'oklch(${lightness} 0 0)' } } };\n`;
      await writeFile(path.join(root, "smart-colors.config.mjs"), configText, "utf8");
      const built = await runCli(root, "build", "--automation=off");
      const warning = built.stderr.split("\n").find((entry) => entry.startsWith("[smart-colors] light info-on-solid / solid is "));
      assert.ok(warning);
      assert.ok(warning.startsWith(`[smart-colors] light info-on-solid / solid is ${ratioText}`));
      assert.ok(warning.includes(`Status: ${status}; WCAG AA normal-text reference minimum ${minimum}:1.`));
      assert.ok(warning.endsWith("Ratios use generated defaults, before CSS overrides."));
      assert.match(built.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: regenerated/);
      assert.equal(await readFile(path.join(root, "smart-colors.config.mjs"), "utf8"), configText);
      assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE + INFO_PROPERTY);
      // A below-minimum model shortfall stays a warning, never a fatal generation error.
      assert.equal(built.code ?? 0, 0);
    });
  }
});

test("the ratio shown for a below-minimum pair never rounds up to the threshold", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { onSolid: { info: { light: 'oklch(0.9852 0 0)' } } };\n", "utf8");
  const reported = await runCli(root, "report", "--automation=off");
  const line = reported.stdout.split("\n").find((entry) => entry.includes("< 4.5:1"));
  assert.ok(line, "expected the below-minimum advisory in stdout");
  assert.match(line, /below the minimum of 4\.50:1/);
  assert.doesNotMatch(line, /project target/);
  assert.doesNotMatch(line, /4\.50:1 ·|: 4\.50:1/);
});

test("custom --config is loaded and appears in the next-step command and manual advice", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY, { colorsCss: null });
  const configFile = "config/personal-colors.mjs";
  const output = "src/styles/tokens/personal-colors.css";
  const configText = `export default { output: "${output}", onSolid: { info: { light: 'oklch(0.99 0 0)', dark: 'oklch(0.02 0 0)' } } };\n`;
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, configFile), configText, "utf8");
  // If --config were ignored, this default config would fail instead of silently passing.
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { onSolid: { missing: { light: 'oklch(0.99 0 0)' } } };\n", "utf8");

  const built = await runCli(root, "build", "--config", configFile, "--automation=off");
  assert.match(built.stdout, /CSS\s+src\/styles\/tokens\/personal-colors\.css: regenerated/);
  assert.match(built.stderr, /In config\/personal-colors\.mjs, set onSolid\.info\.light/);
  assert.doesNotMatch(built.stderr, /In smart-colors\.config\.mjs/);
  assert.ok((await readFile(path.join(root, output), "utf8")).length > 0);
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, configFile), "utf8"), configText);

  for (const args of [["--config", configFile], [`--config=${configFile}`], ["-c", configFile]]) {
    const checked = await runCli(root, "check", ...args);
    assert.match(checked.stdout, /CSS\s+src\/styles\/tokens\/personal-colors\.css: up to date/);
    assertReadOnlyCheck(checked.stdout);
  }
});

test("validation failure stays focused on the main error even with optional report metadata", async (t) => {
  for (const packageText of [REPORT_PACKAGE, '{"scripts":']) {
    const root = await createProject(t, PALETTE + INFO_PROPERTY);
    await writeFile(path.join(root, "package.json"), packageText, "utf8");
    await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { onSolid: { missing: { light: 'oklch(0.99 0 0)' } } };\n", "utf8");
    const before = await snapshotProject(root);
    for (const command of ["build", "check"]) {
      await assert.rejects(runCli(root, command), (error) => {
        assert.equal(error.code, 1);
        assertNoSuccessStdout(error.stdout);
        assert.match(error.stderr, /Smart Colors validation failed/);
        assert.doesNotMatch(error.stderr, /colors:report|generated|up to date/);
        return true;
      });
    }
    assert.deepEqual(await snapshotProject(root), before);
  }
});

test("explicit missing --config fails before build/check can write project files", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { output: 'src/styles/tokens/should-not-exist.css', motion: { enabled: true } };\n", "utf8");
  const before = await snapshotProject(root);
  for (const command of ["build", "check"]) {
    await assert.rejects(runCli(root, command, "--config", "missing-colors.mjs"), (error) => {
      assert.equal(error.code, 1);
      assertNoSuccessStdout(error.stdout);
      assert.match(error.stderr, /Configuration not found/);
      assert.ok(error.stderr.includes(path.join(root, "missing-colors.mjs")));
      assert.doesNotMatch(error.stderr, /Suggestion:|out of date|generated\.|up to date/);
      return true;
    });
    assert.deepEqual(await snapshotProject(root), before);
  }
});

test("a strict contrast error writes no CSS but still publishes the HTML artifacts", async (t) => {
  const unreachable = `@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.52 0 0); role: canvas; }
@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0 0); role: ink; }
@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.16 32); role: ui; }`;
  const root = await createProject(t, unreachable, { colorsCss: null });
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { contrast: { text: 7 } };\n", "utf8");

  await assert.rejects(runCli(root, "build", "--automation=off"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /Verdict\s+ERROR: contrast contract invalid/);
    return true;
  });
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
  assert.match(await readFile(path.join(root, PREVIEW_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
});

test("report chromium with a strict-invalid model disables automation without a usage error and still writes fresh HTML", async (t) => {
  const unreachable = `@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.52 0 0); role: canvas; }
@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0 0); role: ink; }
@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.16 32); role: ui; }`;
  const root = await createProject(t, unreachable, { colorsCss: null });
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { contrast: { text: 21, maxIdentity: 21 } };\n", "utf8");
  await assert.rejects(readFile(path.join(root, PREVIEW_PATH), "utf8"), { code: "ENOENT" });

  await assert.rejects(runCli(root, "report", "chromium"), (error) => {
    assert.equal(error.code, 1);
    assert.doesNotMatch(`${error.stdout}${error.stderr}`, /cannot be combined|Usage: smart-colors/);
    assert.match(error.stdout, /Verification\s+MODEL ESTIMATE: automation not run, contrast contract invalid/);
    assert.match(error.stdout, /The report does not modify CSS, palette, config or tuning\./);
    return true;
  });
  assert.match(await readFile(path.join(root, PREVIEW_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), unreachable);
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
});

test("special characters in the root produce valid file URLs without opening a browser", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart colors #100% "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, PALETTE_PATH), PALETTE, "utf8");

  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stdout, /file:\/\/.*smart-colors-reports\/index\.html/);
  assert.match(built.stdout, /file:\/\/.*smart-colors-reports\/report\.html/);
  assert.match(built.stdout, /#100%25|%23|%20/);
});

// ---------------------------------------------------------------------------
// report (new pipeline) and audit boundary.
// ---------------------------------------------------------------------------

test("report is read-only on palette, config, tuning and CSS and publishes both HTML", async (t) => {
  const root = await createProject(t, PALETTE, { colorsCss: null });
  await writeFile(path.join(root, TUNING_PATH), ":root { --color-tune-dark-warmth: 75%; }", "utf8");
  const before = await snapshotProject(root);

  const reported = await runCli(root, "report", "--automation=off");

  assert.match(reported.stdout, /\[smart-colors\] report/);
  assert.match(reported.stdout, /The report does not modify CSS, palette, config or tuning\./);
  assert.match(reported.stdout, /automation disabled/);
  const after = await snapshotProject(root);
  assert.deepEqual(Object.keys(after).filter((relativePath) => !Object.hasOwn(before, relativePath)).sort(), PUBLISHED_ARTIFACTS);
  for (const relativePath of Object.keys(before)) assert.deepEqual(after[relativePath], before[relativePath]);
});

test("report auto with no Playwright exits 0, while an explicit browser list implies required", async (t) => {
  const auto = await createProject(t);
  const reported = await runCli(auto, "report", "--automation=auto");
  assert.match(reported.stdout, /optional automation not run, Playwright not installed/);

  const listed = await createProject(t);
  await assert.rejects(runCli(listed, "report", "chromium"), (error) => {
    assert.equal(error.code, 1);
    return true;
  });
  assert.match(await readFile(path.join(listed, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
});

test("report off shows the model advisory instead of a measured all clear", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  const reported = await runCli(root, "report", "--automation=off");
  assert.match(reported.stdout, /^  Problems\s+.*, (?:light|dark): .*, below the (?:minimum|project target)/m);
  assert.doesNotMatch(reported.stdout, /Verdict\s+OK/);
  assert.doesNotMatch(reported.stdout, /no problems in the measured pairs/);
});

// ---------------------------------------------------------------------------
// init (unchanged behavior aside from the pnpm exec next step).
// ---------------------------------------------------------------------------

test("init writes both templates byte-for-byte and points at pnpm exec", async (t) => {
  const root = await createEmptyProject(t);
  const palettePath = "colors/personal.css";
  const tuningPath = "colors/tuning/custom.css";

  const { stdout, stderr } = await runCli(root, "init", "--palette", palettePath, "--tuning", tuningPath);

  assert.equal(stderr, "");
  assert.match(stdout, /\[smart-colors\] init/);
  assert.match(stdout, /Created\s+palette\s+colors\/personal\.css\s+colors and roles, edit by hand/);
  assert.match(stdout, /^\s+tuning\s+colors\/tuning\/custom\.css\s+optional overrides applied at runtime$/m);
  assert.match(stdout, /Output\s+colors\/colors\.css: build produces it; import it from your CSS without editing it/);
  assert.match(stdout, /Action\s+Edit the palette, then generate the CSS:/);
  assert.match(stdout, /pnpm exec smart-colors build/);
  assert.doesNotMatch(stdout, /creative designer source/);
  assert.equal((stdout.match(/\[smart-colors\]/g) ?? []).length, 1);
  assert.equal(await readFile(path.join(root, palettePath), "utf8"), PALETTE_TEMPLATE);
  assert.equal(await readFile(path.join(root, tuningPath), "utf8"), TUNING_TEMPLATE);
});

test("init without a TTY uses the default paths and never prompts", async (t) => {
  const root = await createEmptyProject(t);
  const { stdout, stderr } = await runCli(root, "init");
  assert.equal(stderr, "");
  assert.doesNotMatch(stdout, /Creare questi file\?|Create these files\?/);
  assert.match(stdout, /Created\s+palette\s+src\/styles\/tokens\/palette\.css/);
  assert.equal((stdout.match(/\[smart-colors\]/g) ?? []).length, 1);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE_TEMPLATE);
  assert.equal(await readFile(path.join(root, TUNING_PATH), "utf8"), TUNING_TEMPLATE);
});

test("the init template builds without warnings and publishes both HTML", async (t) => {
  const root = await createEmptyProject(t);
  await runCli(root, "init");
  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stdout, /\[smart-colors\] build/);
  assert.match(built.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: regenerated/);
  assert.equal((built.stdout.match(/\[smart-colors\]/g) ?? []).length, 1);
  assert.equal(built.stderr, "");
  assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
});

test("the tuning template ships no active declarations and no nested comments", () => {
  assert.equal(TUNING_TEMPLATE.replace(/\/\*[\s\S]*?\*\//g, "").trim(), "");
});

test("init derives palette and tuning paths from a custom config", async (t) => {
  const root = await createEmptyProject(t);
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "config/colors.mjs"), "export default { palette: 'colors/personal.css' };\n", "utf8");

  const { stdout, stderr } = await runCli(root, "init", "--config", "config/colors.mjs");
  assert.equal(stderr, "");
  assert.match(stdout, /Created\s+palette\s+colors\/personal\.css/);
  assert.match(stdout, /^\s+tuning\s+colors\/colors-tuning\.css\s+optional overrides applied at runtime$/m);
  assert.doesNotMatch(stdout, /smart-colors\.config\.mjs/);
  assert.equal((stdout.match(/\[smart-colors\]/g) ?? []).length, 1);
  assert.equal(await readFile(path.join(root, "colors/personal.css"), "utf8"), PALETTE_TEMPLATE);
  assert.equal(await readFile(path.join(root, "colors/colors-tuning.css"), "utf8"), TUNING_TEMPLATE);
  await assert.rejects(readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), { code: "ENOENT" });
});

test("init refuses an existing target without writing either file", async (t) => {
  for (const existing of ["palette", "tuning"]) {
    await t.test(existing, async (t) => {
      const root = await createEmptyProject(t);
      const palettePath = path.join(root, PALETTE_PATH);
      const tuningPath = path.join(root, TUNING_PATH);
      const target = existing === "palette" ? palettePath : tuningPath;
      const other = existing === "palette" ? tuningPath : palettePath;
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "keep me\n", "utf8");

      await assert.rejects(runCli(root, "init"), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.ok(error.stderr.includes(`Refusing to overwrite existing file: ${path.relative(root, target).split(path.sep).join("/")}.`));
        assert.match(error.stderr, /Nothing was written\./);
        return true;
      });
      assert.equal(await readFile(target, "utf8"), "keep me\n");
      await assert.rejects(readFile(other, "utf8"), { code: "ENOENT" });
    });
  }
});

test("build and check never create a palette or tuning file", async (t) => {
  const root = await createEmptyProject(t);
  for (const command of ["build", "check"]) {
    await assert.rejects(runCli(root, command), (error) => {
      assert.equal(error.code, 1);
      return true;
    });
    assert.deepEqual(await readdir(root), []);
  }
});

test("check reports the colors-tuning.css status across its states", async (t) => {
  const root = await createProject(t);
  const tuningPath = path.join(root, TUNING_PATH);
  await runCli(root, "build", "--automation=off");

  for (const result of [await runCli(root, "check")]) {
    assert.match(result.stdout, /Tuning\s+src\/styles\/tokens\/colors-tuning\.css: absent \(optional\)$/m);
  }

  await writeFile(tuningPath, TUNING_TEMPLATE, "utf8");
  {
    const result = await runCli(root, "check");
    assert.match(result.stdout, /Tuning\s+src\/styles\/tokens\/colors-tuning\.css: present, no active overrides$/m);
  }

  await writeFile(tuningPath, ":root {\n  --color-tune-dark-warmth: 75%;\n  --color-tune-dark-bg-mix: 12%;\n}\n", "utf8");
  {
    const result = await runCli(root, "check");
    assert.match(result.stdout, /Tuning\s+src\/styles\/tokens\/colors-tuning\.css: 2 active overrides, verify with audit or report$/m);
  }

  await writeFile(tuningPath, ":root {\n  --color-tune-dark-warmth: 75%;\n}\n", "utf8");
  {
    const result = await runCli(root, "check");
    assert.match(result.stdout, /Tuning\s+src\/styles\/tokens\/colors-tuning\.css: 1 active override, verify with audit or report$/m);
  }

  // An unreadable tuning file is never flattened into "absent".
  await rm(tuningPath, { force: true });
  await mkdir(tuningPath);
  {
    const result = await runCli(root, "check");
    assert.match(result.stdout, /Tuning\s+src\/styles\/tokens\/colors-tuning\.css: unreadable \(status not verified\)/m);
  }
});

test("check is read-only, reports stale output and never presents an old HTML as current", async (t) => {
  const root = await createProject(t);
  await writeFile(path.join(root, "package.json"), REPORT_PACKAGE, "utf8");
  await mkdir(path.join(root, REPORT_DIRECTORY));
  await writeFile(path.join(root, PREVIEW_PATH), "old preview", "utf8");
  const before = await snapshotProject(root);

  await assert.rejects(runCli(root, "check"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /\[smart-colors\] check/);
    assert.match(error.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: stale/);
    assertReadOnlyCheck(error.stdout);
    assert.doesNotMatch(error.stdout, /generated\.|up to date/);
    assert.doesNotMatch(error.stdout, /smart-colors-reports\//);
    assert.match(error.stderr, /out of date/);
    return true;
  });
  assert.deepEqual(await snapshotProject(root), before);
});

test("check command reports stale output once with an actionable message", async (t) => {
  const root = await createProject(t);
  await assert.rejects(
    execFileAsync(process.execPath, [CLI_PATH, "check", "--root", root]),
    (error) => {
      const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
      assert.equal((output.match(/out of date/g) ?? []).length, 1);
      assert.match(output, /Run smart-colors build/);
      return true;
    },
  );
});

test("init, build and check end stdout with a blank line", async (t) => {
  const root = await createEmptyProject(t);
  const init = await runCli(root, "init");
  const built = await runCli(root, "build", "--automation=off");
  const checked = await runCli(root, "check");
  for (const result of [init, built, checked]) {
    assert.ok(result.stdout.endsWith("\n\n"), `stdout must end with a blank line: ${JSON.stringify(result.stdout.slice(-40))}`);
  }
});

test("interactive init accepts only empty, y or yes and declines without writing", async (t) => {
  for (const [answer, expected] of [["n\n", false], ["no\n", false], ["cancel\n", false], ["quit\n", false], ["0\n", false], ["y\n", true], ["YES\n", true], ["\n", true]]) {
    await t.test(JSON.stringify(answer), async (t) => {
      const root = await createEmptyProject(t);
      const streams = interactiveStreams();
      const pending = initSmartColors({ root, stdin: streams.stdin, stdout: streams.stdout });
      streams.stdin.end(answer);
      const result = await pending;

      assert.equal(result.written, expected);
      assert.match(streams.output(), /Which folder should contain the token files\?/);
      assert.match(streams.output(), /Folder \[src\/styles\/tokens\]:/);
      if (expected) {
        assert.match(streams.output(), /Create these files\? \[Y\/n\]/);
        assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE_TEMPLATE);
        assert.equal(await readFile(path.join(root, TUNING_PATH), "utf8"), TUNING_TEMPLATE);
      } else {
        assert.doesNotMatch(streams.output(), /Create these files\?/);
        assert.deepEqual(await readdir(root), []);
      }
    });
  }
});

test("interactive init accepts a custom token directory and writes the config", async (t) => {
  const root = await createEmptyProject(t);
  const streams = interactiveStreams();
  const pending = initSmartColors({ root, stdin: streams.stdin, stdout: streams.stdout });
  streams.stdin.end("src/tokens\ny\n");
  const result = await pending;

  assert.equal(result.written, true);
  assert.deepEqual(result.files, ["src/tokens/palette.css", "src/tokens/colors-tuning.css", "smart-colors.config.mjs"]);
  const output = streams.output();
  assert.match(output, /Files to create:[\s\S]*• palette  src\/tokens\/palette\.css/);
  assert.match(output, /• tuning   src\/tokens\/colors-tuning\.css/);
  assert.match(output, /• config   smart-colors\.config\.mjs/);
  assert.equal(await readFile(path.join(root, "src/tokens/palette.css"), "utf8"), PALETTE_TEMPLATE);
  assert.equal(await readFile(path.join(root, "smart-colors.config.mjs"), "utf8"), [
    "export default {",
    '  palette: "src/tokens/palette.css",',
    '  output: "src/tokens/colors.css",',
    "};",
    "",
  ].join("\n"));
});

test("init --dir writes a custom token directory, its config and generates colors", async (t) => {
  const root = await createEmptyProject(t);
  await mkdir(path.join(root, "node_modules/@smartslash"), { recursive: true });
  await symlink(PACKAGE_ROOT, path.join(root, "node_modules/@smartslash/astro-smart-colors"), "dir");

  const { stdout, stderr } = await runCli(root, "init", "--dir", "custom/tokens");
  assert.equal(stderr, "");
  assert.match(stdout, /Created\s+palette\s+custom\/tokens\/palette\.css/);
  assert.match(stdout, /^\s+config\s+smart-colors\.config\.mjs\s+token paths$/m);
  assert.equal(await readFile(path.join(root, "custom/tokens/palette.css"), "utf8"), PALETTE_TEMPLATE);

  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stdout, /CSS\s+custom\/tokens\/colors\.css: regenerated/);
  assert.equal(built.stderr, "");
  assert.ok((await readFile(path.join(root, "custom/tokens/colors.css"), "utf8")).length > 0);
});

test("init rejects --dir combined with --palette without writing", async (t) => {
  const root = await createEmptyProject(t);
  await assert.rejects(runCli(root, "init", "--dir", "custom/tokens", "--palette", "altra.css"), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.match(error.stderr, /Cannot combine --dir with --palette\. Use --dir to choose a folder, or --palette for an explicit file path\./);
    return true;
  });
  assert.deepEqual(await readdir(root), []);
});

test("init normalizes Windows separators in explicit paths", async (t) => {
  await t.test("derived tuning follows a backslash palette directory", async (t) => {
    const root = await createEmptyProject(t);
    const { stdout, stderr } = await runCli(root, "init", "--palette", "colors\\personal.css");
    assert.equal(stderr, "");
    assert.match(stdout, /Created\s+palette\s+colors\/personal\.css/);
    assert.match(stdout, /^\s+tuning\s+colors\/colors-tuning\.css/m);
    assert.equal(await readFile(path.join(root, "colors/personal.css"), "utf8"), PALETTE_TEMPLATE);
    assert.equal(await readFile(path.join(root, "colors/colors-tuning.css"), "utf8"), TUNING_TEMPLATE);
  });

  await t.test("explicit tuning is normalized too", async (t) => {
    const root = await createEmptyProject(t);
    const { stdout, stderr } = await runCli(root, "init", "--palette", "colors\\personal.css", "--tuning", "panels\\colors\\custom.css");
    assert.equal(stderr, "");
    assert.match(stdout, /^\s+tuning\s+panels\/colors\/custom\.css/m);
    assert.equal(await readFile(path.join(root, "panels/colors/custom.css"), "utf8"), TUNING_TEMPLATE);
  });
});

test("init refuses targets that collide with generated outputs", async (t) => {
  await t.test("palette against config.output", async (t) => {
    const root = await createEmptyProject(t);
    await assert.rejects(runCli(root, "init", "--palette", "src/styles/tokens/colors.css"), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Refusing to write palette src\/styles\/tokens\/colors\.css: Smart Colors output path collision/);
      assert.match(error.stderr, /both resolve to .*src\/styles\/tokens\/colors\.css/);
      return true;
    });
    assert.deepEqual(await readdir(root), []);
  });

  await t.test("tuning against config.output", async (t) => {
    const root = await createEmptyProject(t);
    const configText = "export default { output: 'src/styles/tokens/colors-tuning.css' };\n";
    await writeFile(path.join(root, "smart-colors.config.mjs"), configText, "utf8");
    await assert.rejects(runCli(root, "init"), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Refusing to write tuning src\/styles\/tokens\/colors-tuning\.css: Smart Colors output path collision/);
      assert.match(error.stderr, /both resolve to .*src\/styles\/tokens\/colors-tuning\.css/);
      return true;
    });
    assert.deepEqual(await readdir(root), ["smart-colors.config.mjs"]);
    assert.equal(await readFile(path.join(root, "smart-colors.config.mjs"), "utf8"), configText);
  });

  await t.test("target against config.motion.output", async (t) => {
    const root = await createEmptyProject(t);
    await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { motion: { enabled: true, output: 'colors/motion.css' } };\n", "utf8");
    await assert.rejects(runCli(root, "init", "--tuning", "colors/motion.css"), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Refusing to write tuning colors\/motion\.css: Smart Colors output path collision/);
      assert.match(error.stderr, /both resolve to .*colors\/motion\.css/);
      return true;
    });
    assert.deepEqual(await readdir(root), ["smart-colors.config.mjs"]);
  });
});

// ---------------------------------------------------------------------------
// CLI output coherence: empty arguments, headings, next steps, optional automation.
// ---------------------------------------------------------------------------

const UNREACHABLE_PALETTE = `@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.52 0 0); role: canvas; }
@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.55 0 0); role: ink; }
@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.16 32); role: ui; }`;

test("an empty argument is a usage error in any position and writes nothing", async (t) => {
  const root = await createProject(t);
  const before = await snapshotProject(root);
  for (const args of [[""], ["build", ""], ["", "build"]]) {
    await assert.rejects(runCli(root, ...args), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /Empty argument not allowed: ""\./);
      assert.match(error.stderr, /Usage: smart-colors/);
      return true;
    });
  }
  assert.deepEqual(await snapshotProject(root), before);
});

test("--help keeps precedence over an unknown argument", async (t) => {
  const root = await createProject(t);
  const { stdout } = await runCli(root, "--help", "--nope");
  assert.match(stdout, /Usage: smart-colors/);
});

test("a strict-invalid build reports its own heading, the model error count and the published HTML", async (t) => {
  const root = await createProject(t, UNREACHABLE_PALETTE, { colorsCss: null });
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { contrast: { text: 7 } };\n", "utf8");
  await assert.rejects(runCli(root, "build", "--automation=off"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /\[smart-colors\] build/);
    assert.match(error.stdout, /Verdict\s+ERROR: contrast contract invalid, \d+ errors? in the model\./);
    assert.match(error.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: not written, contrast contract invalid/);
    assert.match(error.stdout, /Verification\s+MODEL ESTIMATE: automation not run, contrast contract invalid/);
    assert.doesNotMatch(error.stdout, /Verdict\s+OK/);
    // The published pair is proven by the real links, not by a sentence claiming publication.
    assert.match(error.stdout, /Preview\s+file:\/\//);
    assert.match(error.stdout, /Report\s+file:\/\//);
    // Regression: the blocking model errors are printed on stderr (previously dropped here).
    assert.match(error.stderr, /expected at least/);
    return true;
  });
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
  assert.match(await readFile(path.join(root, PREVIEW_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
});

test("check shows a visible stale verdict first, without a success line or a duplicated error list", async (t) => {
  const root = await createProject(t);
  await assert.rejects(runCli(root, "check"), (error) => {
    assert.equal(error.code, 1);
    const lines = error.stdout.split("\n");
    const css = lines.findIndex((line) => /^  CSS\s/.test(line));
    assert.ok(css >= 0, "the CSS state must be visible first");
    assert.match(lines[css], /: stale$/);
    // The actionable hint continues the same block instead of restating the verdict.
    assert.match(lines[css + 1] ?? "", /^\s+regenerate with /);
    assert.doesNotMatch(error.stdout, /: up to date$/m);
    assert.equal((`${error.stdout}${error.stderr}`.match(/out of date/g) ?? []).length, 1);
    return true;
  });
});

test("report names the real stale output it measured, and reserves 'candidate' for an absent output", async (t) => {
  // A present but out-of-date output is the real file the report measured: never a "candidate".
  const stale = await createProject(t);
  const reported = await runCli(stale, "report", "--automation=off");
  assert.match(reported.stdout, /The report does not modify CSS, palette, config or tuning\./);
  assert.match(reported.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: out of date, bytes on disk diverge from the generated tokens; the report measures that file/);
  assert.doesNotMatch(reported.stdout, /candidate/);

  // An absent output is an explicit generated candidate.
  const absent = await createProject(t, PALETTE, { colorsCss: null });
  const missing = await runCli(absent, "report", "--automation=off");
  assert.match(missing.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: absent, the measurements cover the generated candidate CSS, not production/);

  // A current output is stated as current and needs no notice and no regeneration step.
  const fresh = await createProject(t, PALETTE, { colorsCss: null });
  await runCli(fresh, "build", "--automation=off");
  const clean = await runCli(fresh, "report", "--automation=off");
  assert.match(clean.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: up to date$/m);
  assert.doesNotMatch(clean.stdout, /candidate/);
  assert.doesNotMatch(clean.stdout, /out of date/);
  assert.doesNotMatch(clean.stdout, /pnpm exec smart-colors build --root/);

  // An empty output is its own state and refuses any positive verdict.
  const empty = await createProject(t, PALETTE, { colorsCss: "  \n" });
  const emptied = await runCli(empty, "report", "--automation=off");
  assert.match(emptied.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: empty, no positive verification possible/);
  assert.match(emptied.stdout, /Verdict\s+UNVERIFIED: empty CSS output: no positive verification possible\./);
});

test("report reads the actual stale output read-only and never rewrites palette or tuning", async (t) => {
  const root = await createProject(t);
  await writeFile(path.join(root, TUNING_PATH), ":root { --color-tune-dark-warmth: 75%; }\n", "utf8");
  const paletteBefore = await readFile(path.join(root, PALETTE_PATH), "utf8");
  const tuningBefore = await readFile(path.join(root, TUNING_PATH), "utf8");

  const reported = await runCli(root, "report", "--automation=off");
  assert.match(reported.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: out of date, bytes on disk diverge from the generated tokens/);
  assert.doesNotMatch(reported.stdout, /candidate/);
  assert.match(reported.stdout, /Action\s+Open the preview/);
  // A stale actual output offers the build command as the secondary step (effective root/config).
  assert.match(reported.stdout, /pnpm exec smart-colors build --root/);

  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), paletteBefore);
  assert.equal(await readFile(path.join(root, TUNING_PATH), "utf8"), tuningBefore);
});

test("the next action opens the preview first; regeneration is a build, never a report tautology", async (t) => {
  const root = await createProject(t);
  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stdout, /Action\s+Open the preview/);
  assert.doesNotMatch(built.stdout, /pnpm exec smart-colors report/);
  assert.equal((built.stdout.match(/^  Action\s/gm) ?? []).length, 1, "exactly one primary next action");

  // A report on an absent CSS names the build command as the secondary step, with the effective
  // root/config (never a report->report tautology).
  const stale = await createProject(t, PALETTE, { colorsCss: null });
  const configFile = "config/c.mjs";
  await mkdir(path.join(stale, "config"));
  await writeFile(path.join(stale, configFile), "export default { output: 'src/styles/tokens/colors.css' };\n", "utf8");
  const reported = await runCli(stale, "report", "--config", configFile, "--automation=off");
  assert.match(reported.stdout, /Action\s+Open the preview/);
  assert.match(reported.stdout, /pnpm exec smart-colors build --root/);
  assert.match(reported.stdout, /--config config\/c\.mjs/);
  assert.doesNotMatch(reported.stdout, /pnpm exec smart-colors report/);
});

test("optional automation failure is a brief stdout note with no install nag and no ANSI when piped", async (t) => {
  const root = await createProject(t);
  const built = await runCli(root, "build");
  assert.match(built.stdout, /optional automation not run, Playwright not installed/);
  assert.doesNotMatch(`${built.stdout}${built.stderr}`, /pnpm exec playwright install/);
  assert.doesNotMatch(built.stdout, /\u001b\[/);
  assert.doesNotMatch(built.stderr, /\u001b\[/);
  assert.ok(built.stdout.split("\n").every((line) => line.length <= 200), "stdout lines stay bounded");
  assert.ok(built.stderr.split("\n").length <= 40, "raw stderr detail stays bounded (no error wall)");
});

test("a root with shell-special characters is quoted in the regeneration command", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart colors; $(boom) "));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await writeFile(path.join(root, PALETTE_PATH), PALETTE, "utf8");

  // An absent CSS makes the build command the reported secondary step, so the quoted root is visible.
  const reported = await runCli(root, "report", "--automation=off");
  assert.match(reported.stdout, /--root '/);
  assert.match(reported.stdout, /file:\/\/.*smart-colors-reports\/index\.html/);
});

// ---------------------------------------------------------------------------
// Corrective pass: honest headings, localized absent-input errors, init metadata.
// ---------------------------------------------------------------------------

async function writeStubPlaywright(root, engines = ["chromium", "firefox", "webkit"]) {
  const directory = path.join(root, "node_modules/playwright");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "playwright", version: "0.0.0", type: "module", main: "index.js" }), "utf8");
  const body = engines.map((name) => `export const ${name} = { executablePath: () => ${JSON.stringify(`/nonexistent/${name}-bin`)}, launch: async () => { throw new Error("stub launch"); } };`).join("\n");
  await writeFile(path.join(directory, "index.js"), `${body}\n`, "utf8");
}

test("the verdict is aligned with the exit policy and never a false success without a measurement", () => {
  const measured = { strictInvalid: false, mode: "required", exitCode: 0, coverage: { status: "complete", complete: true, partial: false, measuredPairs: 5, launched: 1 }, problems: [] };
  assert.equal(verdict(measured).label, "OK");
  assert.match(verdict(measured).detail, /all measured pairs/);
  assert.equal(verdict({ ...measured, problems: [{ status: "below-minimum" }] }).label, "NEEDS REVIEW");

  // Not measured is never OK, whatever the mode.
  const disabled = { strictInvalid: false, mode: "off", coverage: { status: "disabled", launched: 0 } };
  assert.equal(verdict(disabled).label, "UNVERIFIED");
  assert.match(verdict(disabled).detail, /no browser measurement/);
  assert.equal(verdict({ strictInvalid: false, mode: "auto", coverage: { status: "unavailable", launched: 0 } }).label, "UNVERIFIED");
  assert.equal(verdict({ strictInvalid: false, mode: "required", coverage: { status: "unavailable", launched: 0 } }).label, "UNVERIFIED");
  // A partial run is never OK either.
  assert.equal(verdict({ strictInvalid: false, mode: "required", coverage: { status: "incomplete", launched: 1, measuredPairs: 3, partial: true } }).label, "UNVERIFIED");

  // A strict-invalid model is always the error class, with the model error count.
  const invalid = verdict({ strictInvalid: true, analysis: { errors: ["a", "b"] }, coverage: {} });
  assert.equal(invalid.label, "ERROR");
  assert.match(invalid.detail, /2 errors/);

  assert.equal(provenance(measured), "MEASURED");
  assert.equal(provenance(disabled), "MODEL ESTIMATE");
  assert.equal(verificationComplete(measured), true);
  assert.equal(verificationComplete(disabled), false);
});

test("partial measured runs keep their measured facts and are never promoted to OK", () => {
  const partialMeasured = {
    strictInvalid: false, mode: "required",
    coverage: { status: "incomplete", complete: false, partial: true, measuredPairs: 6, missingPairs: 4, launched: 1 },
    problems: [{ scheme: "light", status: "below-minimum", foregroundToken: "--color-text", backgroundToken: "--color-bg", ratio: 3.2, target: 4.6, minimum: 4.5 }],
  };
  assert.equal(measurementAvailable(partialMeasured), true);
  assert.equal(provenance(partialMeasured), "MEASURED");
  assert.equal(verificationComplete(partialMeasured), false);
  assert.equal(verdict(partialMeasured).label, "NEEDS REVIEW");

  // A partial run that measured clean is still not OK.
  const partialClean = { ...partialMeasured, problems: [] };
  assert.equal(provenance(partialClean), "MEASURED");
  assert.equal(verdict(partialClean).label, "UNVERIFIED");
  assert.match(verdict(partialClean).detail, /incomplete coverage/);

  // A target-only measured shortfall is a problem, not a clean pass.
  const targetOnly = {
    strictInvalid: false, mode: "required",
    coverage: { status: "complete", complete: true, partial: false, measuredPairs: 8, missingPairs: 0, launched: 1 },
    problems: [{ scheme: "dark", status: "below-target", foregroundToken: "--color-text", backgroundToken: "--color-bg", ratio: 4.8, target: 5.3, minimum: 4.5 }],
  };
  assert.equal(verificationComplete(targetOnly), true);
  assert.equal(verdict(targetOnly).label, "NEEDS REVIEW");

  // Errors plus missing pairs stay the error class, counted from the model.
  const errorsAndMissing = { strictInvalid: true, analysis: { errors: ["a", "b", "c"] }, mode: "off", coverage: { status: "disabled", measuredPairs: 0, missingPairs: 7, launched: 0 } };
  assert.equal(verdict(errorsAndMissing).label, "ERROR");
  assert.match(verdict(errorsAndMissing).detail, /3 errors/);
  assert.equal(provenance(errorsAndMissing), "MODEL ESTIMATE");
});

test("cssState prefers the pipeline metadata and falls back to the legacy handoff", () => {
  const withCss = (css) => ({ command: "report", analysis: { config: { output: "out/colors.css" } }, session: { css } });

  const current = cssState(withCss({ status: "current", source: "output", production: true, generated: "a", baseline: "a" }));
  assert.equal(current.shape, "current");
  assert.equal(current.source, "output");
  assert.equal(current.production, true);
  assert.equal(current.path, "out/colors.css");
  assert.equal(current.generated, "a");
  assert.equal(current.baseline, "a");

  const stale = cssState(withCss({ status: "stale", source: "output", production: false, generated: "a", baseline: "b" }));
  assert.equal(stale.shape, "stale");
  assert.equal(stale.source, "output");
  assert.equal(stale.generated, "a");
  assert.equal(stale.baseline, "b");

  const absent = cssState(withCss({ status: "absent", source: "generated-candidate", production: false }));
  assert.equal(absent.shape, "absent");
  assert.equal(absent.source, "generated-candidate");
  assert.equal(absent.baseline, null);

  const empty = cssState(withCss({ status: "empty", source: "output", production: false, baseline: "" }));
  assert.equal(empty.shape, "empty");
  // An empty string is the signal: it is not coerced away into `null`.
  assert.equal(empty.baseline, "");

  // A partial metadata record falls back to a status-consistent default rather than throwing.
  const bare = cssState(withCss({ status: "stale" }));
  assert.equal(bare.source, "output");
  assert.equal(bare.production, false);

  // Legacy fallback: derive from writeOutcome (build) and production (report).
  assert.equal(cssState({ command: "build", writeOutcome: { changed: true, outputs: [] } }).shape, "current");
  assert.equal(cssState({ command: "report", production: { accepted: true, candidates: [] } }).shape, "current");
  assert.equal(cssState({ command: "report", production: { accepted: false, candidates: [{ reason: "changed" }] } }).shape, "stale");
  assert.equal(cssState({ command: "report", production: { accepted: false, candidates: [{ reason: "absent" }] } }).shape, "absent");
  assert.equal(cssState({ command: "report", production: { accepted: false, candidates: [{ reason: "changed" }, { reason: "absent" }] } }).shape, "stale");
  assert.equal(cssState({ command: "report" }).shape, "unknown");
});

test("an empty measured output can never verify green", () => {
  const empty = {
    strictInvalid: false, mode: "required",
    coverage: { status: "complete", complete: true, partial: false, measuredPairs: 5, launched: 1 },
    problems: [],
    session: { css: { status: "empty", source: "output", production: false, baseline: "" } },
  };
  assert.equal(verdict(empty).label, "UNVERIFIED");
  assert.match(verdict(empty).detail, /empty/);
});

test("progress streams live: the first phase line is observed before the summary and before the exit", async (t) => {
  const root = await createProject(t);
  const slowConfig = "slow.config.mjs";
  await writeFile(path.join(root, slowConfig), "await new Promise((resolve) => setTimeout(resolve, 600));\nexport default { palette: \"src/styles/tokens/palette.css\" };\n", "utf8");

  const child = spawn(process.execPath, [CLI_PATH, "build", "--root", root, "--config", slowConfig, "--automation=off"], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } });

  let buffer = "";
  let analysisAt = null;
  let summaryAt = null;
  let analysisBeforeExit = false;
  let exited = false;
  child.stdout.setEncoding("utf8");
  const finished = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      if (analysisAt === null && chunk.includes("palette analysis")) { analysisAt = Date.now(); analysisBeforeExit = !exited; }
      if (summaryAt === null && chunk.includes("[smart-colors] build")) summaryAt = Date.now();
    });
    child.on("exit", (code) => { exited = true; resolve(code); });
    child.on("error", reject);
  });

  const code = await finished;
  assert.equal(code, 0);
  const lines = buffer.split("\n").filter((line) => line !== "");
  const headerIndex = lines.indexOf("[smart-colors] build");
  assert.ok(headerIndex > 0, "the summary header must be preceded by started-phase lines");
  for (const line of lines.slice(0, headerIndex)) assert.match(line, PROGRESS_LINE);
  assert.equal(lines[0], "smart-colors: palette analysis");
  assert.equal(analysisBeforeExit, true, "the first phase line must arrive while the process is still running");
  assert.ok(analysisAt !== null && summaryAt !== null);
  // A live stream reaches stdout well before the summary; a buffered one would land at the same instant.
  assert.ok(summaryAt - analysisAt >= 150, `expected a live gap between the first phase line and the summary, got ${summaryAt - analysisAt}ms`);
});

test("typed absent-input errors are localized and write nothing", async (t) => {
  const missingPalette = await createEmptyProject(t);
  for (const command of ["build", "check", "report"]) {
    await assert.rejects(runCli(missingPalette, command), (error) => {
      assert.equal(error.code, 1);
      assertNoSuccessStdout(error.stdout);
      assert.match(error.stderr, /Palette not found/);
      assert.match(error.stderr, /pnpm exec smart-colors init --root/);
      return true;
    });
    assert.deepEqual(await readdir(missingPalette), []);
  }

  const missingConfig = await createEmptyProject(t);
  await assert.rejects(runCli(missingConfig, "build", "--config", "missing-colors.mjs"), (error) => {
    assert.equal(error.code, 1);
    assertNoSuccessStdout(error.stdout);
    assert.match(error.stderr, /Configuration not found/);
    assert.match(error.stderr, /init does not create the file named by --config/);
    return true;
  });
  assert.deepEqual(await readdir(missingConfig), []);
});

// A curated detector for the Italian words the CLI used to print. It is deliberately scoped to
// CLI-owned stdout and typed errors: raw technical stderr from shared modules stays verbatim by
// contract and is not translated here.
const RESIDUAL_ITALIAN = /\b(?:analisi|generazione|automazione|anteprima|verifica|esito|problemi|soglia|minimo|progetto|sotto|colori?|avvisi?|suggerimenti?|trovat[ao]|opzione|sconosciut[oa]|argomento|vuoto|consentito|rigenera|aggiornat[oi]|assente|presente|lettura|creati|sfondo|testo|interfaccia|decorativo|chiar[oi]|scur[oi]|coppi[ae]|motor[ei]|error[ei]|disattivata|richiesta|nessun[ao]?|senza|sulla|sul|nella|nel|della|dei|delle|degli|non)\b/i;

test("CLI human output is English while commands, paths and the raw technical channel stay intact", async (t) => {
  // The detector must catch a known Italian sentence, so a silent false negative cannot pass.
  assert.match("Configurazione non trovata: analisi palette", RESIDUAL_ITALIAN);

  const root = await createProject(t);
  const help = await runCli(root, "--help");
  const built = await runCli(root, "build");
  const checked = await runCli(root, "check");
  const reported = await runCli(root, "report", "--automation=off");

  const initRoot = await createEmptyProject(t);
  const initialized = await runCli(initRoot, "init", "--palette", "colors/p.css", "--tuning", "panels/custom.css");

  for (const [name, output] of [
    ["help", help.stdout], ["build", built.stdout], ["check", checked.stdout],
    ["report", reported.stdout], ["init", initialized.stdout],
  ]) {
    assert.doesNotMatch(output, RESIDUAL_ITALIAN, `${name} stdout must not contain residual Italian`);
  }

  // Translation must not rename real commands, flags or paths.
  assert.match(help.stdout, /Usage: smart-colors \[build\|check\|init\|audit\|report\]/);
  assert.match(help.stdout, /--config <file>.*default: smart-colors\.config\.mjs/);
  assert.match(help.stdout, /--dir <dir>.*default: src\/styles\/tokens/);
  assert.match(built.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: regenerated/);
  assert.match(checked.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: up to date/);
  assert.match(reported.stdout, /file:\/\/.*smart-colors-reports\/index\.html/);
  assert.match(initialized.stdout, /pnpm exec smart-colors build --root/);
  assert.match(initialized.stdout, /Warnings\s+Tuning panels\/custom\.css will not be read by build/);

  // Typed CLI errors are English too; raw stderr from shared modules is intentionally not scanned.
  const missingConfig = await createEmptyProject(t);
  await assert.rejects(runCli(missingConfig, "build", "--config", "missing-colors.mjs"), (error) => {
    assert.match(error.stderr, /Configuration not found/);
    assert.doesNotMatch(error.stderr, RESIDUAL_ITALIAN);
    return true;
  });
  const missingPalette = await createEmptyProject(t);
  await assert.rejects(runCli(missingPalette, "check"), (error) => {
    assert.match(error.stderr, /Palette not found/);
    assert.doesNotMatch(error.stderr, RESIDUAL_ITALIAN);
    return true;
  });
});

test("control characters in typed CLI errors are escaped, never injected into the terminal", async (t) => {
  const root = await createProject(t);
  for (const [label, value, escaped] of [
    ["escape", "missing\u001b[31m.mjs", "missing\\x1b[31m.mjs"],
    ["newline", "missing\ncolors.mjs", "missing\\x0acolors.mjs"],
  ]) {
    await t.test(label, async (t) => {
      await assert.rejects(runCli(root, "build", "--config", value), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /Configuration not found/);
        assert.ok(error.stderr.includes(`${escaped}"`), `expected the escaped path in ${JSON.stringify(error.stderr)}`);
        assert.doesNotMatch(error.stderr, /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/);
        return true;
      });
    });
  }
});

test("init with the default layout never presents a config as created", async (t) => {
  const root = await createEmptyProject(t);
  const { stdout } = await runCli(root, "init", "--yes");
  assert.match(stdout, /Created\s+palette\s+src\/styles\/tokens\/palette\.css/);
  assert.doesNotMatch(stdout, /token paths/);
  await assert.rejects(readFile(path.join(root, "smart-colors.config.mjs"), "utf8"), { code: "ENOENT" });
});

test("init surfaces the custom tuning guidance instead of a false success", async (t) => {
  const root = await createEmptyProject(t);
  const { stdout } = await runCli(root, "init", "--palette", "colors/p.css", "--tuning", "panels/custom.css");
  assert.match(stdout, /Warnings\s+Tuning panels\/custom\.css will not be read by build/);
  assert.match(stdout, /will not be read by build/);
});

test("a required run with an unavailable engine names that engine, never chromium", async (t) => {
  const root = await createProject(t);
  await writeStubPlaywright(root, ["webkit"]);
  await assert.rejects(runCli(root, "report", "webkit"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /^\s+webkit: the engine binary is not available in the project$/m);
    assert.match(error.stdout, /Playwright and the engine binaries are the project's responsibility/);
    assert.doesNotMatch(error.stdout, /chromium/);
    assert.doesNotMatch(error.stdout, /playwright install chromium/);
    return true;
  });
});

test("check suggests regeneration with the effective --root and --config, summary before raw stderr", async (t) => {
  const root = await createProject(t, PALETTE, { colorsCss: null });
  const configFile = "config/colors.mjs";
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, configFile), "export default { output: 'src/styles/tokens/colors.css' };\n", "utf8");
  await runCli(root, "build", "--config", configFile, "--automation=off");
  await writeFile(path.join(root, OUTPUT_PATH), ":root {}\n", "utf8");

  await assert.rejects(runCli(root, "check", "--config", configFile), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /CSS\s+src\/styles\/tokens\/colors\.css: stale/);
    assert.match(error.stdout, /regenerate with pnpm exec smart-colors build --root/);
    assert.match(error.stdout, /--config config\/colors\.mjs/);
    assert.match(error.stderr, /out of date/);
    return true;
  });
});

test("auto with no Playwright and a clean model keeps stderr empty and points to the preview", async (t) => {
  const root = await createProject(t, PALETTE.replace("0.62 0.16 32", "0.6238 0.16 32"));
  const built = await runCli(root, "build");
  assert.equal(built.stderr, "");
  assert.match(built.stdout, /optional automation not run, Playwright not installed/);
  // The model-advisory section is omitted when it is empty: no all-clear noise, no false green.
  assert.doesNotMatch(built.stdout, /^  Problems\s/m);
  assert.match(built.stdout, /MODEL ESTIMATE/);
  assert.match(built.stdout, /Verdict\s+UNVERIFIED/);
  assert.match(built.stdout, /file:\/\/.*smart-colors-reports\/index\.html/);
  assert.match(built.stdout, /file:\/\/.*smart-colors-reports\/report\.html/);
  assert.match(await readFile(path.join(root, PREVIEW_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
});

test("auto keeps model warnings and suggestions on stderr while suppressing only the expected absence", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  const built = await runCli(root, "build");
  assert.match(built.stderr, /\[smart-colors\] light primary-on-solid \/ solid-hover is/);
  assert.match(built.stderr, /\[smart-colors\] Suggestion: primary \(light\)/);
  assert.doesNotMatch(built.stderr, /Playwright not found in consumer/);
  assert.doesNotMatch(built.stderr, /^\[smart-colors\] coverage /m);
  assert.match(built.stdout, /optional automation not run, Playwright not installed/);
});

test("required with no Playwright keeps the technical stderr detail", async (t) => {
  const root = await createProject(t, PALETTE.replace("0.62 0.16 32", "0.6238 0.16 32"));
  await assert.rejects(runCli(root, "build", "--automation=required"), (error) => {
    assert.equal(error.code, 1);
    assert.notEqual(error.stderr.trim(), "");
    // The raw shared detail is preserved verbatim by contract; only the CLI summary is English.
    assert.match(error.stderr, /Playwright not found in consumer/);
    assert.match(error.stdout, /no engine launched/);
    assert.match(error.stdout, /(?:chromium|firefox|webkit)[^:]*: Playwright is not installed in the project$/m);
    return true;
  });
});

// ---------------------------------------------------------------------------
// Presentation contracts: the terminal layout must stay plain when piped, colour
// must be opt-in for a TTY, and one fact must be stated once per run.
// ---------------------------------------------------------------------------

function withoutNoColor() {
  const env = { ...process.env };
  delete env.NO_COLOR;
  return env;
}

test("piped stdout stays plain text without ANSI and NO_COLOR wins over a TTY", async (t) => {
  const root = await createProject(t);
  const initRoot = await createEmptyProject(t);
  const built = await runCli(root, "build", "--automation=off");
  const checked = await runCli(root, "check");
  const initialized = await runCli(initRoot, "init");

  const asciiRoots = [root, initRoot].every((value) => /^[\x20-\x7e]*$/.test(value));
  for (const [name, stdout] of [["build", built.stdout], ["check", checked.stdout], ["init", initialized.stdout]]) {
    assert.doesNotMatch(stdout, /\u001b\[/, `${name} must not print ANSI when piped`);
    // No decorative glyphs in the structural output: the labels and separators are plain text.
    assert.doesNotMatch(stdout, /[\u2714\u2713\u25cf\u2192\u00b7\u2014\u2026\u2248]/, `${name} must not use decorative glyphs`);
    if (asciiRoots) assert.match(stdout, /^[\x20-\x7e\n]*$/, `${name} stdout must stay plain text when paths are ASCII`);
  }

  // The style module itself: a TTY may colour, but NO_COLOR always wins.
  const script = `process.stdout.isTTY = true;\nconst { paint } = await import(${JSON.stringify(CLI_STYLE_URL)});\nprocess.stdout.write(paint("x", "green"));`;
  const colored = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { env: withoutNoColor(), encoding: "utf8" });
  assert.match(colored.stdout, /\u001b\[32m/, "a TTY must be able to use colour");
  const plain = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, NO_COLOR: "1" }, encoding: "utf8" });
  assert.equal(plain.stdout, "x", "NO_COLOR must disable colour even on a TTY");
});

test("a run states provenance, CSS state and the missing measurement once", async (t) => {
  const root = await createProject(t);
  const built = await runCli(root, "build");

  // One provenance statement, one reason, one consequence: the layout must not repeat the same
  // fact in the verification, the verdict and an all-clear line.
  assert.equal((built.stdout.match(/MODEL ESTIMATE/g) ?? []).length, 1);
  assert.equal((built.stdout.match(/optional automation not run/g) ?? []).length, 1);
  assert.equal((built.stdout.match(/Playwright not installed/g) ?? []).length, 1);
  assert.equal((built.stdout.match(/no browser measurement/g) ?? []).length, 1);
  assert.doesNotMatch(built.stdout, /no measured pair/i);
  assert.doesNotMatch(built.stdout, /Do it now/);
  assert.doesNotMatch(built.stdout, /unmeasured contrasts/i);
  assert.doesNotMatch(built.stderr, /pnpm exec playwright install/);
});
