import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { initSmartColors } from "../src/init.mjs";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const PALETTE_TEMPLATE = await readFile(new URL("../src/templates/palette.css", import.meta.url), "utf8");
const TUNING_TEMPLATE = await readFile(new URL("../src/templates/colors-tuning.css", import.meta.url), "utf8");
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
const PREVIEW_PATH = "reports/smart-colors-preview.html";
const REPORT_PATH = "reports/smart-colors.html";
const REPORT_PACKAGE = JSON.stringify({ scripts: { "colors:report": "node report.mjs" } });

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
  assert.match(stdout, /config\.palette \(src\/styles\/tokens\/palette\.css\) è la sorgente del designer/);
  assert.match(stdout, /check è in sola lettura/);
}

function assertNewBuildSections(stdout) {
  for (const section of ["Esito", "Problemi", "Copertura", "Modello", "Link", "Prossimo passo"]) {
    assert.match(stdout, new RegExp(`● ${section}`), `build output must include the ${section} section`);
  }
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
    assert.match(stdout, /build\s+Generate semantic color tokens and the two HTML artifacts/);
    assert.match(stdout, /check\s+Verify generated color tokens are up to date/);
    assert.match(stdout, /init\s+Create a starter palette and colors-tuning\.css/);
    assert.match(stdout, /audit\s+Audit generated tokens and colors-tuning\.css in a browser/);
    assert.match(stdout, /report\s+Generate reports\/smart-colors\.html and reports\/smart-colors-preview\.html/);
    assert.match(stdout, /--config <file>.*relative to --root.*default: smart-colors\.config\.mjs/);
    assert.match(stdout, /--automation <mode>.*auto\|off\|required/);
    assert.match(stdout, /--palette <file>.*default: config\.palette/);
    assert.match(stdout, /-y, --yes\s+Skip the init confirmation prompt/);
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
      assert.match(error.stderr, /Option --automation is only supported by build and report\./);
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
    assert.match(error.stderr, /Unexpected arguments: chromium\./);
    return true;
  });

  for (const command of ["report", "audit"]) {
    await assert.rejects(runCli(root, command, "browser-inesistente"), (error) => {
      assert.equal(error.code, 1);
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /Unknown browser browser-inesistente\. Supported browsers: chromium, firefox, webkit\./);
      assert.doesNotMatch(error.stderr, /launched|AUDIT |HTML report/);
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

  assert.match(built.stdout, /Build completata/);
  assertNewBuildSections(built.stdout);
  assert.match(built.stdout, /Playwright non disponibile/);
  assert.ok(built.stdout.endsWith("\n\n"));

  const after = await snapshotProject(root);
  const added = Object.keys(after).filter((relativePath) => !Object.hasOwn(before, relativePath)).sort();
  assert.deepEqual(added, [PREVIEW_PATH, REPORT_PATH].sort());
  assert.notEqual(after[OUTPUT_PATH].contents, before[OUTPUT_PATH].contents);
  assert.match(await readFile(path.join(root, PREVIEW_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.match(await readFile(path.join(root, REPORT_PATH), "utf8"), /^<!-- smart-colors-report:v1 -->/);
  assert.deepEqual(after[PALETTE_PATH], before[PALETTE_PATH]);
});

test("build auto publishes HTML with an actionable link even when the environment is unavailable", async (t) => {
  const root = await createProject(t);
  const built = await runCli(root, "build", "--automation=auto");

  assert.match(built.stdout, /file:\/\//);
  assert.ok(built.stdout.includes("smart-colors-preview.html"));
  assert.ok(built.stdout.includes("smart-colors.html"));
  assert.ok(built.stdout.includes(path.join(root, PREVIEW_PATH)));
  assert.match(built.stdout, /pnpm exec smart-colors report --root/);
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
  assert.match(built.stdout, /Automazione disattivata/);
  assert.doesNotMatch(built.stdout, /Playwright non disponibile/);
});

test("build reports the contrast baseline (model) and the runtime tuning state in check", async (t) => {
  const clean = await createProject(t, PALETTE.replace("0.62 0.16 32", "0.6238 0.16 32"));
  const cleanBuilt = await runCli(clean, "build");
  assert.match(cleanBuilt.stdout, /✔ Contrasto baseline: 0 errori, 0 avvisi, 0 suggerimenti\./);
  const cleanChecked = await runCli(clean, "check");
  assert.match(cleanChecked.stdout, /✔ Contrasto baseline: 0 errori, 0 avvisi, 0 suggerimenti\./);
  assert.match(cleanChecked.stdout, /✔ Tuning runtime: nessun file src\/styles\/tokens\/colors-tuning\.css attivo\./);

  const advised = await createProject(t, PALETTE + INFO_PROPERTY);
  const advisedBuilt = await runCli(advised, "build", "--automation=off");
  assert.match(advisedBuilt.stdout, /! Contrasto baseline: 0 errori, 1 avviso, 1 suggerimento \(vedi dettagli su stderr\)\./);
  const advisedChecked = await runCli(advised, "check");
  assert.match(advisedChecked.stdout, /! Contrasto baseline: 0 errori, 1 avviso, 1 suggerimento \(vedi dettagli su stderr\)\./);
});

test("build prints manual foreground/source advice but only check is entirely read-only", async (t) => {
  const paletteCss = PALETTE + INFO_PROPERTY;
  const root = await createProject(t, paletteCss);
  const configText = "export default { onSolid: { info: { light: 'oklch(0.99 0 0)', dark: 'oklch(0.02 0 0)' } } };\n";
  await writeFile(path.join(root, "smart-colors.config.mjs"), configText, "utf8");
  const before = await snapshotProject(root);
  const built = await runCli(root, "build", "--automation=off");

  assert.match(built.stdout, /src\/styles\/tokens\/colors\.css generated\./);
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
  assert.match(checked.stdout, /src\/styles\/tokens\/colors\.css is up to date/);
  assert.doesNotMatch(checked.stdout, /generated\./);
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
  assert.match(checked.stdout, /is up to date/);
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
      assert.match(built.stdout, /colors\.css generated/);
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
  const line = reported.stdout.split("\n").find((entry) => entry.includes("--color-info-solid-text"));
  assert.ok(line, "expected the info-on-solid advisory in stdout");
  assert.match(line, /< 4,5:1/);
  assert.doesNotMatch(line, /4,50:1 ·|: 4,50:1/);
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
  assert.match(built.stdout, new RegExp(`--config ${configFile.replace("/", "\\/")}`));
  assert.match(built.stdout, /src\/styles\/tokens\/personal-colors\.css generated\./);
  assert.match(built.stderr, /In config\/personal-colors\.mjs, set onSolid\.info\.light/);
  assert.doesNotMatch(built.stderr, /In smart-colors\.config\.mjs/);
  assert.ok((await readFile(path.join(root, output), "utf8")).length > 0);
  await assert.rejects(readFile(path.join(root, OUTPUT_PATH), "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, configFile), "utf8"), configText);

  for (const args of [["--config", configFile], [`--config=${configFile}`], ["-c", configFile]]) {
    const checked = await runCli(root, "check", ...args);
    assert.match(checked.stdout, /src\/styles\/tokens\/personal-colors\.css is up to date/);
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
        assert.equal(error.stdout, "");
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
      assert.equal(error.stdout, "");
      assert.match(error.stderr, /\[smart-colors\].*ENOENT/);
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
    assert.match(error.stdout, /Contratto di contrasto non valido/);
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
    assert.match(error.stdout, /Automazione non eseguita: contratto di contrasto del modello non valido/);
    assert.match(error.stdout, /Nessun file CSS, palette, config o tuning è stato modificato\./);
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
  assert.match(built.stdout, /file:\/\/.*smart-colors-preview\.html/);
  assert.match(built.stdout, /file:\/\/.*smart-colors\.html/);
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

  assert.match(reported.stdout, /Report contrasto generato/);
  assert.match(reported.stdout, /Nessun file CSS, palette, config o tuning è stato modificato\./);
  assert.match(reported.stdout, /Automazione disattivata/);
  const after = await snapshotProject(root);
  assert.deepEqual(Object.keys(after).filter((relativePath) => !Object.hasOwn(before, relativePath)).sort(), [PREVIEW_PATH, REPORT_PATH].sort());
  for (const relativePath of Object.keys(before)) assert.deepEqual(after[relativePath], before[relativePath]);
});

test("report auto with no Playwright exits 0, while an explicit browser list implies required", async (t) => {
  const auto = await createProject(t);
  const reported = await runCli(auto, "report", "--automation=auto");
  assert.match(reported.stdout, /Playwright non disponibile/);

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
  assert.match(reported.stdout, /Nessuna coppia misurata nel browser: avvisi del modello/);
  assert.doesNotMatch(reported.stdout, /Nessun problema nelle coppie misurate/);
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
  assert.match(stdout, /\[smart-colors\] Inizializzazione completata/);
  assert.match(stdout, /● File creati/);
  assert.match(stdout, /✔ colors\/personal\.css\s+\(sorgente creativa del designer\)/);
  assert.match(stdout, /✔ colors\/tuning\/custom\.css\s+\(override opzionali di progetto\)/);
  assert.match(stdout, /● Prossimi passi/);
  assert.match(stdout, /Modifica la palette in colors\/personal\.css/);
  assert.match(stdout, /pnpm exec smart-colors build/);
  assert.equal((stdout.match(/\[smart-colors\]/g) ?? []).length, 1);
  assert.equal(await readFile(path.join(root, palettePath), "utf8"), PALETTE_TEMPLATE);
  assert.equal(await readFile(path.join(root, tuningPath), "utf8"), TUNING_TEMPLATE);
});

test("init without a TTY uses the default paths and never prompts", async (t) => {
  const root = await createEmptyProject(t);
  const { stdout, stderr } = await runCli(root, "init");
  assert.equal(stderr, "");
  assert.doesNotMatch(stdout, /Creare questi file\?/);
  assert.match(stdout, /✔ src\/styles\/tokens\/palette\.css/);
  assert.equal((stdout.match(/\[smart-colors\]/g) ?? []).length, 1);
  assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE_TEMPLATE);
  assert.equal(await readFile(path.join(root, TUNING_PATH), "utf8"), TUNING_TEMPLATE);
});

test("the init template builds without warnings and publishes both HTML", async (t) => {
  const root = await createEmptyProject(t);
  await runCli(root, "init");
  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stdout, /Build completata/);
  assert.match(built.stdout, /src\/styles\/tokens\/colors\.css generated\./);
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
  assert.match(stdout, /✔ colors\/personal\.css/);
  assert.match(stdout, /✔ colors\/colors-tuning\.css/);
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
    assert.match(result.stdout, /tuning\s+src\/styles\/tokens\/colors-tuning\.css — non presente \(opzionale\)\./);
    assert.match(result.stdout, /✔ Tuning runtime: nessun file src\/styles\/tokens\/colors-tuning\.css attivo\./);
  }

  await writeFile(tuningPath, TUNING_TEMPLATE, "utf8");
  {
    const result = await runCli(root, "check");
    assert.match(result.stdout, /tuning\s+src\/styles\/tokens\/colors-tuning\.css — presente, nessun override attivo \(verificato da audit\/report\)\./);
    assert.match(result.stdout, /✔ Tuning runtime: nessun override attivo in src\/styles\/tokens\/colors-tuning\.css\./);
  }

  await writeFile(tuningPath, ":root {\n  --color-tune-dark-warmth: 75%;\n  --color-tune-dark-bg-mix: 12%;\n}\n", "utf8");
  {
    const result = await runCli(root, "check");
    assert.match(result.stdout, /presente, 2 override attivi \(verificati da audit\/report\)\./);
    assert.match(result.stdout, /! Tuning runtime: 2 override attivi in src\/styles\/tokens\/colors-tuning\.css \(da verificare con audit\/report\)\./);
  }

  await writeFile(tuningPath, ":root {\n  --color-tune-dark-warmth: 75%;\n}\n", "utf8");
  {
    const result = await runCli(root, "check");
    assert.match(result.stdout, /! Tuning runtime: 1 override attivo in src\/styles\/tokens\/colors-tuning\.css \(da verificare con audit\/report\)\./);
  }
});

test("check is read-only, reports stale output and never presents an old HTML as current", async (t) => {
  const root = await createProject(t);
  await writeFile(path.join(root, "package.json"), REPORT_PACKAGE, "utf8");
  await mkdir(path.join(root, "reports"));
  await writeFile(path.join(root, PREVIEW_PATH), "old preview", "utf8");
  const before = await snapshotProject(root);

  await assert.rejects(runCli(root, "check"), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /Controllo token/);
    assertReadOnlyCheck(error.stdout);
    assert.doesNotMatch(error.stdout, /generated\.|up to date/);
    assert.doesNotMatch(error.stdout, /reports\//);
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
      assert.match(streams.output(), /In quale cartella vuoi inserire i file dei token\?/);
      assert.match(streams.output(), /Cartella \[src\/styles\/tokens\]:/);
      if (expected) {
        assert.match(streams.output(), /Creare questi file\? \[Y\/n\]/);
        assert.equal(await readFile(path.join(root, PALETTE_PATH), "utf8"), PALETTE_TEMPLATE);
        assert.equal(await readFile(path.join(root, TUNING_PATH), "utf8"), TUNING_TEMPLATE);
      } else {
        assert.doesNotMatch(streams.output(), /Creare questi file\?/);
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
  assert.match(output, /File da creare:[\s\S]*• palette  src\/tokens\/palette\.css/);
  assert.match(output, /• tuning   src\/tokens\/colors-tuning\.css/);
  assert.match(output, /• config   smart-colors\.config\.mjs/);
  assert.equal(await readFile(path.join(root, "src/tokens/palette.css"), "utf8"), PALETTE_TEMPLATE);
  assert.equal(await readFile(path.join(root, "smart-colors.config.mjs"), "utf8"), [
    'import { defineSmartColorsConfig } from "@smartslash/astro-smart-colors/config";',
    "",
    "export default defineSmartColorsConfig({",
    '  palette: "src/tokens/palette.css",',
    '  output: "src/tokens/colors.css",',
    "});",
    "",
  ].join("\n"));
});

test("init --dir writes a custom token directory, its config and generates colors", async (t) => {
  const root = await createEmptyProject(t);
  await mkdir(path.join(root, "node_modules/@smartslash"), { recursive: true });
  await symlink(PACKAGE_ROOT, path.join(root, "node_modules/@smartslash/astro-smart-colors"), "dir");

  const { stdout, stderr } = await runCli(root, "init", "--dir", "custom/tokens");
  assert.equal(stderr, "");
  assert.match(stdout, /✔ custom\/tokens\/palette\.css/);
  assert.match(stdout, /✔ smart-colors\.config\.mjs\s+\(configurazione percorsi token\)/);
  assert.equal(await readFile(path.join(root, "custom/tokens/palette.css"), "utf8"), PALETTE_TEMPLATE);

  const built = await runCli(root, "build", "--automation=off");
  assert.match(built.stdout, /custom\/tokens\/colors\.css generated\./);
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
    assert.match(stdout, /✔ colors\/personal\.css/);
    assert.match(stdout, /✔ colors\/colors-tuning\.css/);
    assert.equal(await readFile(path.join(root, "colors/personal.css"), "utf8"), PALETTE_TEMPLATE);
    assert.equal(await readFile(path.join(root, "colors/colors-tuning.css"), "utf8"), TUNING_TEMPLATE);
  });

  await t.test("explicit tuning is normalized too", async (t) => {
    const root = await createEmptyProject(t);
    const { stdout, stderr } = await runCli(root, "init", "--palette", "colors\\personal.css", "--tuning", "panels\\colors\\custom.css");
    assert.equal(stderr, "");
    assert.match(stdout, /✔ panels\/colors\/custom\.css/);
    assert.equal(await readFile(path.join(root, "panels/colors/custom.css"), "utf8"), TUNING_TEMPLATE);
  });
});

test("init refuses targets that collide with generated outputs", async (t) => {
  await t.test("palette against config.output", async (t) => {
    const root = await createEmptyProject(t);
    await assert.rejects(runCli(root, "init", "--palette", "src/styles/tokens/colors.css"), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Refusing to write palette src\/styles\/tokens\/colors\.css/);
      assert.match(error.stderr, /collides with the generated config\.output/);
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
      assert.match(error.stderr, /Refusing to write tuning src\/styles\/tokens\/colors-tuning\.css/);
      assert.match(error.stderr, /collides with the generated config\.output/);
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
      assert.match(error.stderr, /collides with the generated config\.motion\.output/);
      return true;
    });
    assert.deepEqual(await readdir(root), ["smart-colors.config.mjs"]);
  });
});
