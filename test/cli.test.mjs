import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
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

async function createProject(t, paletteCss = PALETTE) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-cli-"));
  const tokenDirectory = path.join(root, "src/styles/tokens");
  await mkdir(tokenDirectory, { recursive: true });
  await writeFile(path.join(tokenDirectory, "palette.css"), paletteCss, "utf8");
  await writeFile(path.join(tokenDirectory, "colors.css"), ":root {}\n", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
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
      snapshot[relativePath] = {
        contents: await readFile(absolutePath, "utf8"),
        mtimeMs: (await stat(absolutePath)).mtimeMs,
      };
    }
  }
  return snapshot;
}

function runCli(root, ...args) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args, "--root", root], { timeout: 30_000 });
}

function assertDesignerScope(stdout) {
  assert.match(stdout, /config\.palette \(src\/styles\/tokens\/palette\.css\) è la sorgente del designer/);
  assert.match(stdout, /build\/check verificano solo i default generati, NON il tuning nel browser né i componenti reali/);
}

function assertReportHint(stdout) {
  assert.match(stdout, /esegui pnpm colors:report, poi apri reports\/smart-colors-preview\.html/);
  assert.match(stdout, /esempi realmente misurati e proposte manuali/);
  assert.match(stdout, /Un'anteprima già presente potrebbe essere obsoleta/);
}

const REPORT_PACKAGE = JSON.stringify({ scripts: { "colors:report": "node report.mjs" } });

test("scripted project gets designer guidance even on a warning-free current check", async (t) => {
  const root = await createProject(t, PALETTE.replace("0.62 0.16 32", "0.6238 0.16 32") + INFO_PROPERTY);
  await writeFile(path.join(root, "package.json"), REPORT_PACKAGE, "utf8");
  const before = await snapshotProject(root);
  const built = await runCli(root, "build");
  assertDesignerScope(built.stdout);
  assertReportHint(built.stdout);
  assert.equal(built.stderr, "");
  const afterBuild = await snapshotProject(root);
  assert.deepEqual(Object.keys(afterBuild), Object.keys(before));
  for (const relativePath of Object.keys(before)) {
    if (relativePath !== "src/styles/tokens/colors.css") assert.deepEqual(afterBuild[relativePath], before[relativePath]);
  }

  const checked = await runCli(root, "check");
  assert.match(checked.stdout, /is up to date/);
  assertDesignerScope(checked.stdout);
  assertReportHint(checked.stdout);
  assert.equal(checked.stderr, built.stderr);
  assert.deepEqual(await snapshotProject(root), afterBuild);
});

test("stale check includes designer guidance without writing or claiming success", async (t) => {
  const root = await createProject(t);
  await writeFile(path.join(root, "package.json"), REPORT_PACKAGE, "utf8");
  await mkdir(path.join(root, "reports"));
  await writeFile(path.join(root, "reports/smart-colors-preview.html"), "old preview", "utf8");
  const before = await snapshotProject(root);
  await assert.rejects(runCli(root, "check"), (error) => {
    assert.equal(error.code, 1);
    assertDesignerScope(error.stdout);
    assertReportHint(error.stdout);
    assert.doesNotMatch(error.stdout, /generated\.|up to date/);
    assert.match(error.stderr, /out of date/);
    return true;
  });
  assert.deepEqual(await snapshotProject(root), before);
});

test("portable projects without a usable report script get scope guidance only", async (t) => {
  for (const [name, packageText] of [
    ["absent package", undefined],
    ["missing script", '{"scripts":{}}'],
    ["empty script", '{"scripts":{"colors:report":""}}'],
    ["whitespace script", '{"scripts":{"colors:report":"  "}}'],
    ["non-string script", '{"scripts":{"colors:report":true}}'],
    ["malformed package", '{"scripts":'],
    ["null package", 'null'],
  ]) {
    await t.test(name, async (t) => {
      const root = await createProject(t);
      if (packageText !== undefined) await writeFile(path.join(root, "package.json"), packageText, "utf8");
      const built = await runCli(root, "build");
      const afterBuild = await snapshotProject(root);
      const checked = await runCli(root, "check");
      for (const result of [built, checked]) {
        assertDesignerScope(result.stdout);
        assert.doesNotMatch(result.stdout + result.stderr, /pnpm colors:report|reports\/smart-colors-preview\.html/);
      }
      assert.equal(checked.stderr, built.stderr);
      assert.deepEqual(await snapshotProject(root), afterBuild);
    });
  }
});

test("validation failure stays focused on the main error even with optional report metadata", async (t) => {
  for (const packageText of [REPORT_PACKAGE, '{"scripts":']) {
    const root = await createProject(t);
    await writeFile(path.join(root, "package.json"), packageText, "utf8");
    await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { onSolid: { missing: { light: 'oklch(0.99 0 0)' } } };\n", "utf8");
    const before = await snapshotProject(root);
    for (const command of ["build", "check"]) {
      await assert.rejects(runCli(root, command), (error) => {
        assert.equal(error.code, 1);
        assert.equal(error.stdout, "");
        assert.match(error.stderr, /Smart Colors validation failed/);
        assert.doesNotMatch(error.stderr, /pnpm colors:report|generated|up to date/);
        return true;
      });
    }
    assert.deepEqual(await snapshotProject(root), before);
  }
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

test("help documents build/check and the default config path without writing project files", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  const before = await snapshotProject(root);

  for (const flag of ["--help", "-h"]) {
    const { stdout, stderr } = await runCli(root, flag);
    assert.match(stdout, /Usage: smart-colors \[build\|check\]/);
    assert.match(stdout, /build\s+Generate semantic color tokens/);
    assert.match(stdout, /check\s+Verify generated color tokens are up to date/);
    assert.match(stdout, /--config <file>.*relative to --root.*default: smart-colors\.config\.mjs/);
    assert.equal(stderr, "");
  }

  assert.deepEqual(await snapshotProject(root), before);
});

test("build prints manual foreground/source advice but only check is entirely read-only", async (t) => {
  const paletteCss = PALETTE + INFO_PROPERTY;
  const root = await createProject(t, paletteCss);
  const configText = "export default { onSolid: { info: { light: 'oklch(0.99 0 0)', dark: 'oklch(0.02 0 0)' } } };\n";
  await writeFile(path.join(root, "smart-colors.config.mjs"), configText, "utf8");
  const before = await snapshotProject(root);
  const built = await runCli(root, "build");

  assert.match(built.stdout, /src\/styles\/tokens\/colors\.css generated/);
  assert.match(built.stderr, /\[smart-colors\] light info-on-solid \/ solid is/);
  assert.match(built.stderr, /\[smart-colors\] Suggestion: info \(light\): preserve the palette/);
  assert.match(built.stderr, /In smart-colors\.config\.mjs, set onSolid\.info\.light/);
  assert.match(built.stderr, /onSolid: \{ "info": \{ light: "oklch\(0\.9944 0 0\)" \} \}/);
  assert.match(built.stderr, /Changes only --color-info-on-solid \(light\), shared by solid\/hover; not --color-on-info or either fill/);
  assert.match(built.stderr, /Search: nearest L on a 4-decimal grid with C\/H fixed, checked after gamut mapping and serialization; not a global perceptual nearest-color claim/);
  assert.match(built.stderr, /Merge into existing onSolid settings; no changes applied/);
  assert.match(built.stderr, /\[smart-colors\] Suggestion: primary \(light\): no text-only suggestion/);
  assert.match(built.stderr, /Optional source adjustment in src\/styles\/tokens\/palette\.css, @property --palette-primary, initial-value/);
  assert.match(built.stderr, /oklch\(0\.62 0\.16 32\) -> oklch\(0\.6238 0\.16 32\)/);
  assert.match(built.stderr, /No changes applied/);

  const afterBuild = await snapshotProject(root);
  assert.deepEqual(Object.keys(afterBuild), Object.keys(before));
  for (const relativePath of Object.keys(before)) {
    if (relativePath !== "src/styles/tokens/colors.css") assert.deepEqual(afterBuild[relativePath], before[relativePath]);
  }
  assert.notEqual(afterBuild["src/styles/tokens/colors.css"].contents, before["src/styles/tokens/colors.css"].contents);
  const checked = await runCli(root, "check");
  assert.match(checked.stdout, /src\/styles\/tokens\/colors\.css is up to date/);
  assert.doesNotMatch(checked.stdout, /generated\./);
  assert.equal(checked.stderr, built.stderr);
  assert.deepEqual(await snapshotProject(root), afterBuild);
});

test("default-path advice does not create a config or apply suggestions during build/check", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  const before = await snapshotProject(root);
  const built = await runCli(root, "build");
  assert.match(built.stderr, /\[smart-colors\] light primary-on-solid \/ solid-hover is/);
  assert.match(built.stderr, /\[smart-colors\] Suggestion: primary \(light\): no text-only suggestion/);
  assert.match(built.stderr, /Optional source adjustment in src\/styles\/tokens\/palette\.css, @property --palette-primary, initial-value/);
  assert.match(built.stderr, /oklch\(0\.62 0\.16 32\) -> oklch\(0\.6238 0\.16 32\)/);
  assert.match(built.stderr, /No changes applied/);
  assert.doesNotMatch(built.stderr, /info-on-solid|Suggestion: info/);
  await assert.rejects(readFile(path.join(root, "smart-colors.config.mjs")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), PALETTE + INFO_PROPERTY);

  const afterBuild = await snapshotProject(root);
  assert.deepEqual(Object.keys(afterBuild), Object.keys(before));
  for (const relativePath of Object.keys(before)) {
    if (relativePath !== "src/styles/tokens/colors.css") assert.deepEqual(afterBuild[relativePath], before[relativePath]);
  }
  assert.notEqual(afterBuild["src/styles/tokens/colors.css"].contents, before["src/styles/tokens/colors.css"].contents);
  const checked = await runCli(root, "check");
  assert.match(checked.stdout, /is up to date/);
  assert.equal(checked.stderr, built.stderr);
  assert.deepEqual(await snapshotProject(root), afterBuild);
});

test("explicit missing --config fails before build/check can write project files", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { output: 'src/styles/tokens/should-not-exist.css', motion: { enabled: true } };\n", "utf8");
  const before = await snapshotProject(root);
  for (const command of ["build", "check"]) {
    await assert.rejects(runCli(root, command, "--config", "missing-colors.mjs"), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /\[smart-colors\].*ENOENT/);
      assert.ok(error.stderr.includes(path.join(root, "missing-colors.mjs")));
      assert.doesNotMatch(error.stderr, /Suggestion:|out of date|generated\.|up to date/);
      return true;
    });
    assert.deepEqual(await snapshotProject(root), before);
  }
});

test("CLI warnings classify below-target and below-minimum without turning them into errors", async (t) => {
  for (const [lightness, ratioText, status, minimum] of [
    [0.99, "4.56", "below-target", "4.50"],
    [0.9852, "4.499", "below-minimum", "4.500000"],
  ]) {
    await t.test(status, async (t) => {
      const root = await createProject(t, PALETTE + INFO_PROPERTY);
      const configText = `export default { onSolid: { info: { light: 'oklch(${lightness} 0 0)' } } };\n`;
      await writeFile(path.join(root, "smart-colors.config.mjs"), configText, "utf8");
      const built = await runCli(root, "build");
      const warning = built.stderr.split("\n").find((entry) => entry.startsWith("[smart-colors] light info-on-solid / solid is "));
      assert.ok(warning);
      assert.ok(warning.startsWith(`[smart-colors] light info-on-solid / solid is ${ratioText}`));
      assert.ok(warning.includes(`Status: ${status}; WCAG AA normal-text reference minimum ${minimum}:1.`));
      assert.ok(warning.endsWith("Ratios use generated defaults, before CSS overrides."));
      assert.match(built.stdout, /colors\.css generated/);
      assert.equal(await readFile(path.join(root, "smart-colors.config.mjs"), "utf8"), configText);
      assert.equal(await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), PALETTE + INFO_PROPERTY);
      const afterBuild = await snapshotProject(root);
      const checked = await runCli(root, "check");
      assert.match(checked.stdout, /is up to date/);
      assert.equal(checked.stderr, built.stderr);
      assert.deepEqual(await snapshotProject(root), afterBuild);
    });
  }
});

test("custom --config is loaded and its actual path appears in manual onSolid advice", async (t) => {
  const root = await createProject(t, PALETTE + INFO_PROPERTY);
  const configFile = "config/personal-colors.mjs";
  const configText = "export default { output: 'src/styles/tokens/personal-colors.css', onSolid: { info: { light: 'oklch(0.99 0 0)', dark: 'oklch(0.02 0 0)' } } };\n";
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, configFile), configText, "utf8");
  // If --config is ignored, this default config must fail instead of silently passing.
  await writeFile(path.join(root, "smart-colors.config.mjs"), "export default { onSolid: { missing: { light: 'oklch(0.99 0 0)' } } };\n", "utf8");
  await writeFile(path.join(root, "package.json"), REPORT_PACKAGE, "utf8");
  const before = await snapshotProject(root);
  const built = await runCli(root, "build", "--config", configFile);
  assertDesignerScope(built.stdout);
  assert.doesNotMatch(built.stdout + built.stderr, /pnpm colors:report|reports\/smart-colors-preview\.html/);

  assert.match(built.stdout, /src\/styles\/tokens\/personal-colors\.css generated/);
  assert.match(built.stderr, /In config\/personal-colors\.mjs, set onSolid\.info\.light/);
  assert.doesNotMatch(built.stderr, /In smart-colors\.config\.mjs/);
  const output = await readFile(path.join(root, "src/styles/tokens/personal-colors.css"), "utf8");
  assert.match(output, /--color-info-on-solid: light-dark\(oklch\(0\.99 0 0\), oklch\(0\.02 0 0\)\)/);
  const afterBuild = await snapshotProject(root);
  for (const relativePath of Object.keys(before)) assert.deepEqual(afterBuild[relativePath], before[relativePath]);
  assert.deepEqual(Object.keys(afterBuild).filter((relativePath) => !Object.hasOwn(before, relativePath)), ["src/styles/tokens/personal-colors.css"]);

  for (const args of [["--config", configFile], [`--config=${configFile}`], ["-c", configFile]]) {
    const checked = await runCli(root, "check", ...args);
    assert.match(checked.stdout, /src\/styles\/tokens\/personal-colors\.css is up to date/);
    assertDesignerScope(checked.stdout);
    assert.doesNotMatch(checked.stdout + checked.stderr, /pnpm colors:report|reports\/smart-colors-preview\.html/);
    assert.equal(checked.stderr, built.stderr);
    assert.deepEqual(await snapshotProject(root), afterBuild);
  }
});
