import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateColorTokens } from "../../src/colors/generate-colors.mjs";
import { createDiagnosticSession } from "../../src/diagnostics/diagnostic-session.mjs";
import { initSmartColors } from "../../src/init.mjs";
import { loadSmartColorsConfig } from "../../src/colors/load-config.mjs";
import { REPORT_ASSETS, REPORT_DIRECTORY, REPORT_DOCUMENTS } from "../../src/diagnostics/report-paths.mjs";
import { resolveTuningFile } from "../../src/diagnostics/report-data.mjs";

/**
 * INIT end-to-end flow: the CLI is driven against an external fixture with no Playwright and no
 * installed package, so the generated plain config must stand on its own. Assertions target
 * semantics (exit codes, created files, effective paths, error paths) rather than exact UI text,
 * because the CLI presentation is owned elsewhere.
 */
const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../../src/cli.mjs", import.meta.url));
const CONFIG_PATH = "smart-colors.config.mjs";
const PALETTE_PATH = "src/styles/tokens/palette.css";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const OUTPUT_PATH = "src/styles/tokens/colors.css";
const REPORT_PATH = REPORT_DOCUMENTS.report;
const PREVIEW_PATH = REPORT_DOCUMENTS.preview;

async function emptyProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-init-flow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

// Symlink creation may be unavailable (unprivileged Windows); those tests skip instead of failing.
async function createSymlink(target, link, type) {
  try {
    await symlink(target, link, type);
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) return false;
    throw error;
  }
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
  assert.ok(await exists(path.join(root, REPORT_PATH)), "report must write the static report");
  assert.ok(await exists(path.join(root, PREVIEW_PATH)), "report must write the interactive preview");
  for (const asset of Object.values(REPORT_ASSETS)) {
    assert.ok(await exists(path.join(root, REPORT_DIRECTORY, asset)), `report must write the local asset ${asset}`);
  }

  const previewHtml = await readFile(path.join(root, PREVIEW_PATH), "utf8");
  const reportHtml = await readFile(path.join(root, REPORT_PATH), "utf8");
  assert.ok(previewHtml.includes(`href="${REPORT_ASSETS.previewStyle}"`), "the preview links its same-folder stylesheet");
  assert.ok(previewHtml.includes(`src="${REPORT_ASSETS.previewScript}"`), "the preview loads its same-folder runtime");
  assert.match(previewHtml, /<script\b[^>]*\bdefer\b/, "the preview runtime is a classic deferred script");
  assert.match(previewHtml, /<script\b[^>]*type="application\/json"/, "the preview payload is inert JSON");
  assert.ok(reportHtml.includes(`href="${REPORT_ASSETS.reportStyle}"`), "the static report links its same-folder stylesheet");
  assert.doesNotMatch(reportHtml, /<script\b/, "the static report stays script-free");
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

test("init refuses targets that resolve to the config file it is about to create", async (t) => {
  for (const [name, options] of [
    ["palette", { palette: CONFIG_PATH }],
    ["tuning", { palette: "theme/brand.css", tuning: CONFIG_PATH }],
  ]) {
    await t.test(name, async (t) => {
      const root = await emptyProject(t);
      const before = await snapshot(root);

      await assert.rejects(initSmartColors({ root, ...options, yes: true }), /Refusing to write (palette|tuning) smart-colors\.config\.mjs: Smart Colors output path collision/);
      assert.deepEqual(await snapshot(root), before, "a colliding target must not write anything");
    });
  }

  // The CLI surface must report the same refusal as a failed run, not as a completed init.
  const root = await emptyProject(t);
  await assert.rejects(runCli(root, "init", "--palette", CONFIG_PATH), (error) => error.code === 1);
  assert.deepEqual(await snapshot(root), {});

  // Palette and tuning still cannot be the same file.
  const samePair = await emptyProject(t);
  await assert.rejects(initSmartColors({ root: samePair, palette: "theme/colors-tuning.css", yes: true }), /Refusing to write palette theme\/colors-tuning\.css: Smart Colors output path collision/);
  assert.deepEqual(await snapshot(samePair), {});
});

test("init refuses symlink-aliased targets that would overwrite each other", async (t) => {
  const root = await emptyProject(t);
  await mkdir(path.join(root, "real"));
  await writeFile(path.join(root, "real/keep.txt"), "fixture sentinel\n", "utf8");
  if (!await createSymlink("real", path.join(root, "alias"), "dir")) {
    t.skip("symlinks are unavailable in this environment");
    return;
  }

  // Neither target exists yet, so only canonical resolution can tell they are the same file.
  await assert.rejects(
    initSmartColors({ root, palette: "real/palette.css", tuning: "alias/palette.css", yes: true }),
    (error) => {
      assert.match(error.message, /Refusing to write palette real\/palette\.css: Smart Colors output path collision/);
      assert.match(error.message, /alias\/palette\.css/);
      assert.match(error.message, /both resolve to .*real\/palette\.css/);
      assert.match(error.message, /Nothing was written\./);
      return true;
    },
  );
  assert.deepEqual(await readdir(path.join(root, "real")), ["keep.txt"], "no target may be written through the alias");
  assert.equal(await readFile(path.join(root, "real/keep.txt"), "utf8"), "fixture sentinel\n");
  assert.deepEqual((await readdir(root)).sort(), ["alias", "real"]);
});

test("init refuses a target that aliases the generated config through a symlinked parent", async (t) => {
  const root = await emptyProject(t);
  if (!await createSymlink(".", path.join(root, "alias"), "dir")) {
    t.skip("symlinks are unavailable in this environment");
    return;
  }

  await assert.rejects(
    initSmartColors({ root, palette: "alias/smart-colors.config.mjs", yes: true }),
    (error) => {
      assert.match(error.message, /Refusing to write palette alias\/smart-colors\.config\.mjs: Smart Colors output path collision/);
      assert.match(error.message, /configFile \(smart-colors\.config\.mjs\)/);
      assert.match(error.message, /both resolve to .*smart-colors\.config\.mjs/);
      return true;
    },
  );
  assert.deepEqual(await readdir(root), ["alias"], "only the fixture symlink may remain");
});

test("init names a malformed config path instead of failing inside a helper", async (t) => {
  for (const [configText, expected] of [
    ["export default { palette: 123 };\n", /must declare palette as a non-empty string \(received number\)/],
    ["export default { output: null };\n", /must declare output as a non-empty string \(received null\)/],
  ]) {
    await t.test(expected.source, async (t) => {
      const root = await emptyProject(t);
      await writeFile(path.join(root, CONFIG_PATH), configText, "utf8");
      const before = await snapshot(root);

      await assert.rejects(initSmartColors({ root, yes: true }), expected);
      assert.deepEqual(await snapshot(root), before, "a malformed config must not write anything");
    });
  }
});

test("a directory URL root without a trailing slash writes inside that directory", async (t) => {
  const parent = await emptyProject(t);
  const root = path.join(parent, "project");
  await mkdir(root);

  const result = await initSmartColors({ root: pathToFileURL(root), yes: true });

  assert.equal(result.written, true);
  assert.deepEqual(await readdir(root), ["src"]);
  assert.deepEqual(await readdir(parent), ["project"], "nothing may be written beside the resolved project root");
});

test("the init tuning warning names the path build actually resolves", async (t) => {
  const sibling = await emptyProject(t);
  const siblingResult = await initSmartColors({ root: sibling, palette: "theme/brand.css", yes: true });
  assert.equal(siblingResult.generation.buildTuningPath, "theme/colors-tuning.css");
  assert.deepEqual(siblingResult.warnings, [], "a tuning next to the palette needs no warning");

  const root = await emptyProject(t);
  const result = await initSmartColors({ root, palette: "theme/brand.css", tuning: "elsewhere/tune.css", yes: true });
  const resolved = await resolveTuningFile(root, await loadSmartColorsConfig({ root }));

  assert.equal(result.warnings.length, 1);
  assert.equal(resolved, "src/styles/tokens/colors-tuning.css");
  assert.ok(result.warnings[0].includes(resolved), `the warning must name the path build resolves (${resolved})`);
  assert.ok(!result.warnings[0].includes("theme/colors-tuning.css"), "the palette-directory candidate is not read when it does not exist");
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
