import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { createDiagnosticSession } from "../src/diagnostic-session.mjs";
import { initSmartColors } from "../src/init.mjs";

/**
 * INIT end-to-end flow: the CLI is driven against an external fixture with no Playwright and no
 * installed package, so the generated plain config must stand on its own. Assertions target
 * semantics (exit codes, created files, effective paths, error paths) rather than exact UI text,
 * because the CLI presentation is owned elsewhere.
 */
const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const CONFIG_PATH = "smart-colors.config.mjs";
const PALETTE_PATH = "src/styles/tokens/palette.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const OUTPUT_PATH = "src/styles/tokens/colors.css";
const REPORT_PATH = "reports/smart-colors.html";
const PREVIEW_PATH = "reports/smart-colors-preview.html";

async function emptyProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-init-flow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runCli(root, ...args) {
  return execFileAsync(process.execPath, [CLI_PATH, ...args, "--root", root], { timeout: 60_000 });
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
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

async function snapshot(root) {
  const out = {};
  async function walk(directory) {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else out[path.relative(root, absolute).split(path.sep).join("/")] = createHash("sha256").update(await readFile(absolute)).digest("hex");
    }
  }
  await walk(root);
  return out;
}

async function assertRoundtrip(root, outputPath, extraArgs = []) {
  await runCli(root, "build", "--automation=off", ...extraArgs);
  assert.ok((await readFile(path.join(root, outputPath), "utf8")).length > 0, "build must write the effective output");
  await runCli(root, "check", ...extraArgs);
  await runCli(root, "report", "--automation=off", ...extraArgs);
  assert.ok(await exists(path.join(root, REPORT_PATH)));
  assert.ok(await exists(path.join(root, PREVIEW_PATH)));
}

test("init default needs no config, then build/check/report roundtrip without Playwright", async (t) => {
  const root = await emptyProject(t);
  await runCli(root, "init");

  assert.deepEqual((await readdir(path.join(root, "src/styles/tokens"))).sort(), ["colors-tuning.css", "palette.css"]);
  assert.equal(await exists(path.join(root, CONFIG_PATH)), false, "the default layout needs no generated config");
  assert.equal(await exists(path.join(root, "node_modules")), false);

  await assertRoundtrip(root, OUTPUT_PATH);
});

test("init --dir writes a plain, import-free config that build actually reads", async (t) => {
  const root = await emptyProject(t);
  await runCli(root, "init", "--dir", "custom/tokens");

  const configText = await readFile(path.join(root, CONFIG_PATH), "utf8");
  assert.doesNotMatch(configText, /import\s|defineSmartColorsConfig|@smartslash/);
  assert.match(configText, /palette:\s*"custom\/tokens\/palette\.css"/);
  assert.match(configText, /output:\s*"custom\/tokens\/colors\.css"/);

  // The plain config loads on its own, with no package on disk.
  const loaded = await import(pathToFileURL(path.join(root, CONFIG_PATH)).href);
  assert.equal(loaded.default.palette, "custom/tokens/palette.css");
  assert.equal(await exists(path.join(root, "custom/tokens/palette.css")), true);

  await assertRoundtrip(root, "custom/tokens/colors.css");
});

test("init --palette outside the default dir generates a config connected to build and check", async (t) => {
  const root = await emptyProject(t);
  await runCli(root, "init", "--palette", "theme/brand.css");

  const configText = await readFile(path.join(root, CONFIG_PATH), "utf8");
  assert.match(configText, /palette:\s*"theme\/brand\.css"/);
  assert.match(configText, /output:\s*"theme\/colors\.css"/);
  // The derived tuning sits next to the palette, which is what resolveTuningFile will read.
  assert.equal(await exists(path.join(root, "theme/colors-tuning.css")), true);

  await assertRoundtrip(root, "theme/colors.css");
});

test("an existing selected config is never rewritten and its palette layout is preserved", async (t) => {
  const root = await emptyProject(t);
  await mkdir(path.join(root, "config"), { recursive: true });
  const configText = "export default { palette: 'colors/personal.css' };\n";
  await writeFile(path.join(root, "config/colors.mjs"), configText, "utf8");

  await runCli(root, "init", "--config", "config/colors.mjs");

  assert.equal(await readFile(path.join(root, "config/colors.mjs"), "utf8"), configText, "config must stay byte-identical");
  assert.equal(await exists(path.join(root, "colors/personal.css")), true);
  assert.equal(await exists(path.join(root, "colors/colors-tuning.css")), true);
  assert.equal(await exists(path.join(root, CONFIG_PATH)), false, "no second config is invented");

  // A second init refuses because the targets already exist, and still writes nothing.
  await assert.rejects(runCli(root, "init", "--config", "config/colors.mjs"));
  assert.equal(await readFile(path.join(root, "config/colors.mjs"), "utf8"), configText);
});

test("an override diverging from an existing config is refused before any write", async (t) => {
  const root = await emptyProject(t);
  await writeFile(path.join(root, CONFIG_PATH), "export default { palette: 'colors/personal.css' };\n", "utf8");
  const before = await snapshot(root);

  await assert.rejects(runCli(root, "init", "--palette", "other/palette.css"));
  assert.deepEqual(await snapshot(root), before, "a divergent override must not write anything");
});

test("missing config and missing palette fail with a typed cause and zero writes", async (t) => {
  const root = await emptyProject(t);
  const before = await snapshot(root);

  await assert.rejects(runCli(root, "build", "--automation=off", "--config", "missing-colors.mjs"), (error) => {
    assert.equal(error.code, 1);
    assert.ok(`${error.stdout}${error.stderr}`.includes("missing-colors.mjs"));
    return true;
  });
  assert.deepEqual(await snapshot(root), before);

  await assert.rejects(runCli(root, "build", "--automation=off"), (error) => {
    assert.equal(error.code, 1);
    assert.ok(`${error.stdout}${error.stderr}`.includes(PALETTE_PATH), "the missing palette path must be named");
    assert.doesNotMatch(`${error.stdout}${error.stderr}`, /roles\.canvas must be/, "not the misleading contract error");
    return true;
  });
  assert.deepEqual(await snapshot(root), before);

  // The typed marker rides on `smartColorsCode` while `code` keeps the filesystem code.
  await assert.rejects(generateColorTokens({ root, check: true }), (error) =>
    error.code === "ENOENT" && error.smartColorsCode === "SMART_COLORS_PALETTE_NOT_FOUND");
  await assert.rejects(createDiagnosticSession({ root, configFile: "missing-colors.mjs" }), (error) =>
    error.code === "ENOENT" && error.smartColorsCode === "SMART_COLORS_CONFIG_NOT_FOUND");
});

test("a root with spaces/#/% plus unicode and Windows-separated relative paths are handled", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart colors #100% "));
  t.after(() => rm(root, { recursive: true, force: true }));

  await runCli(root, "init", "--dir", "tokens ünïcode");
  assert.equal(await exists(path.join(root, "tokens ünïcode/palette.css")), true);
  await assertRoundtrip(root, "tokens ünïcode/colors.css");

  const windowsRoot = await emptyProject(t);
  await runCli(windowsRoot, "init", "--palette", "theme\\brand.css");
  assert.equal(await exists(path.join(windowsRoot, "theme/brand.css")), true, "backslash palette must normalize to a real path");
});

test("a tuning outside the palette directory never changes another file", async (t) => {
  const root = await emptyProject(t);
  await runCli(root, "init", "--palette", "theme/brand.css", "--tuning", "elsewhere/tune.css");

  // Only the three requested authored files appear: no auto-fix, no orphan tuning next to the palette.
  assert.deepEqual(Object.keys(await snapshot(root)).sort(), [
    CONFIG_PATH,
    "elsewhere/tune.css",
    "theme/brand.css",
  ].sort());
  assert.equal(await exists(path.join(root, "theme/colors-tuning.css")), false);
});

test("init --palette with the default directory but a different file name generates a config build reads", async (t) => {
  const root = await emptyProject(t);
  await runCli(root, "init", "--palette", "src/styles/tokens/brand #50%.css");

  const configText = await readFile(path.join(root, CONFIG_PATH), "utf8");
  assert.match(configText, /palette:\s*"src\/styles\/tokens\/brand #50%\.css"/);
  assert.match(configText, /output:\s*"src\/styles\/tokens\/colors\.css"/);
  assert.equal(await exists(path.join(root, "src/styles/tokens/brand #50%.css")), true);

  // The exact bug fixed: build must read brand #50%.css, not the default palette.css.
  await assertRoundtrip(root, OUTPUT_PATH);
});

test("init --dir with '#' and '%' roundtrips and the config stores them literally", async (t) => {
  const root = await emptyProject(t);
  await runCli(root, "init", "--dir", "design #50% colori");

  const configText = await readFile(path.join(root, CONFIG_PATH), "utf8");
  assert.match(configText, /palette:\s*"design #50% colori\/palette\.css"/);
  assert.equal(await exists(path.join(root, "design #50% colori/palette.css")), true);
  await assertRoundtrip(root, "design #50% colori/colors.css");
});

test("--config with '#' and '%' loads as a literal path and is byte-preserved", async (t) => {
  const root = await emptyProject(t);
  const configName = "settings #50%.mjs";
  const configText = "export default { palette: 'design #50%/brand.css' };\n";
  await writeFile(path.join(root, configName), configText, "utf8");

  await runCli(root, "init", "--config", configName);

  assert.equal(await readFile(path.join(root, configName), "utf8"), configText, "the selected config is never rewritten");
  assert.equal(await exists(path.join(root, "design #50%/brand.css")), true);
  await assertRoundtrip(root, OUTPUT_PATH, ["--config", configName]);
});

test("Windows-separated palette and tuning do not collide and keep the expected output", async (t) => {
  const root = await emptyProject(t);
  await runCli(root, "init", "--palette", "theme\\brand.css", "--tuning", "theme\\tuning.css");

  const configText = await readFile(path.join(root, CONFIG_PATH), "utf8");
  assert.match(configText, /palette:\s*"theme\/brand\.css"/);
  assert.match(configText, /output:\s*"theme\/colors\.css"/);
  assert.equal(await exists(path.join(root, "theme/brand.css")), true);
  assert.equal(await exists(path.join(root, "theme/tuning.css")), true, "the two files must not collide after normalization");
  await assertRoundtrip(root, "theme/colors.css");
});

test("interactive init refuses a directory that diverges from an existing config", async (t) => {
  const root = await emptyProject(t);
  const configText = "export default { palette: 'design/personal.css' };\n";
  await writeFile(path.join(root, CONFIG_PATH), configText, "utf8");
  const before = await snapshot(root);

  const { stdin, stdout } = interactiveStreams();
  const pending = initSmartColors({ root, stdin, stdout });
  stdin.end("other/tokens\ny\n");
  await assert.rejects(pending, /Refusing to write palette other\/tokens\/palette\.css/);
  assert.deepEqual(await snapshot(root), before, "a divergent interactive choice must write nothing");
});

test("interactive accept-default follows the config's palette path, and './design' never falsely diverges", async (t) => {
  const root = await emptyProject(t);
  const configText = "export default { palette: 'design/personal.css' };\n";
  await writeFile(path.join(root, CONFIG_PATH), configText, "utf8");

  const { stdin, stdout } = interactiveStreams();
  const pending = initSmartColors({ root, stdin, stdout });
  stdin.end("\ny\n");
  const result = await pending;
  assert.equal(result.written, true);
  assert.equal(await exists(path.join(root, "design/personal.css")), true);
  assert.equal(await exists(path.join(root, "design/colors-tuning.css")), true);
  assert.equal(await readFile(path.join(root, CONFIG_PATH), "utf8"), configText, "the config is never rewritten");

  // './design/personal.css' resolves to the same file as 'design/personal.css': no false divergence.
  const equivalent = await emptyProject(t);
  await writeFile(path.join(equivalent, CONFIG_PATH), configText, "utf8");
  const written = await initSmartColors({ root: equivalent, palette: "./design/personal.css", yes: true });
  assert.equal(written.written, true);
  assert.equal(await exists(path.join(equivalent, "design/personal.css")), true);
});
