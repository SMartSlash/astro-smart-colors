import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs, { access, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { MARKER, formatContrastReportBundle } from "../src/format-report-html.mjs";
import { formatContrastPreviewBundle } from "../src/format-report-preview.mjs";
import { DEFAULT_CONFIG_FILE } from "../src/load-config.mjs";
import * as artifact from "../src/report-artifact.mjs";
import { REPORT_ASSETS, REPORT_ASSET_MARKER, REPORT_DIRECTORY, REPORT_DOCUMENTS } from "../src/report-paths.mjs";

const { writeContrastReport } = artifact;
const REPORT_PATH = REPORT_DOCUMENTS.report;
const PREVIEW_PATH = REPORT_DOCUMENTS.preview;
const REPORT_STYLE_PATH = path.join(REPORT_DIRECTORY, REPORT_ASSETS.reportStyle);
const PREVIEW_STYLE_PATH = path.join(REPORT_DIRECTORY, REPORT_ASSETS.previewStyle);
const PREVIEW_SCRIPT_PATH = path.join(REPORT_DIRECTORY, REPORT_ASSETS.previewScript);
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const DEFAULT_PATHS = [
  defaultSmartColorsConfig.palette, DEFAULT_CONFIG_FILE, defaultSmartColorsConfig.output,
  defaultSmartColorsConfig.motion.output, TUNING_PATH,
];
const CONTRACT_PATHS = [REPORT_PATH, PREVIEW_PATH, REPORT_STYLE_PATH, PREVIEW_STYLE_PATH, PREVIEW_SCRIPT_PATH];

const reportHtml = (report) => formatContrastReportBundle(report).html;
const previewHtml = (report) => formatContrastPreviewBundle(report).html;

function assetContent(bundle, relativePath) {
  const asset = bundle.assets.find((entry) => entry.relativePath === relativePath);
  assert.ok(asset, `renderer must emit ${relativePath}`);
  return asset.content;
}

function reportFixture(overrides = {}) {
  return {
    generatedAt: "2026-10-16T12:00:00.000Z",
    inputDigest: "a".repeat(64),
    files: { palette: DEFAULT_PATHS[0], config: DEFAULT_CONFIG_FILE, output: DEFAULT_PATHS[2], tuning: TUNING_PATH },
    palette: [],
    scenarios: [{
      browser: "chromium", scheme: "light", preference: "no-preference", provenance: "fixture snapshot",
      diagnostics: [{
        label: "primary / canvas", scheme: "light", kind: "text", provenance: "fixture measurement",
        foregroundToken: "--color-primary", backgroundToken: "--color-bg",
        foreground: { l: 0.4, c: 0.1, h: 32 }, background: { l: 1, c: 0, h: 0 },
        ratio: 5, minimum: 4.5, target: 4.6, status: "pass",
      }],
    }],
    proposals: [], generationErrors: [], auditErrors: [], notes: [],
    ...overrides,
  };
}

// The diagnostic preview variant is the only one that publishes a script asset.
function diagnosticFixture(overrides = {}) {
  return {
    ...reportFixture(),
    schemaVersion: 1,
    css: { baseline: ":root {}", generated: ":root {}" },
    model: { roles: {} },
    samples: [],
    ...overrides,
  };
}

async function createProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors report-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of [...DEFAULT_PATHS, "keep.txt"]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), Buffer.concat([Buffer.from(`sentinel ${file}\n`), Buffer.from([0, 255, 13, 10])]));
  }
  return { root, config: structuredClone(defaultSmartColorsConfig) };
}

async function snapshot(root) {
  const entries = (await readdir(root, { recursive: true })).sort();
  return Promise.all(entries.map(async (entry) => {
    const filePath = path.join(root, entry);
    const info = await lstat(filePath);
    if (info.isSymbolicLink()) return [entry, { symlink: await readlink(filePath) }];
    if (info.isFile()) return [entry, { bytes: await readFile(filePath) }];
    return [entry, { directory: true }];
  }));
}

const REPORT_PREFIX = `${path.normalize(REPORT_DIRECTORY)}${path.sep}`;
function withoutReport(entries) {
  return entries.filter(([file]) => file !== path.normalize(REPORT_DIRECTORY) && !file.startsWith(REPORT_PREFIX));
}

async function assertRefusal(options, reason) {
  const before = await snapshot(options.root);
  await assert.rejects(() => writeContrastReport(options), reason);
  assert.deepEqual(await snapshot(options.root), before);
}

async function createSymlink(t, target, destination, type = "file") {
  try {
    await symlink(target, destination, type);
    return true;
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) throw error;
    t.skip(`Symlinks unavailable: ${error.code}`);
    return false;
  }
}

function mockBuiltin(t, module, name, implementation) {
  const method = t.mock.method(module, name, implementation);
  syncBuiltinESMExports();
  t.after(() => {
    method.mock.restore();
    syncBuiltinESMExports();
  });
  return method;
}

test("exports only the internal report writer", () => {
  assert.deepEqual(Object.keys(artifact), ["writeContrastReport"]);
});

test("creates the fixed marked report and its stylesheet, returning an absolute string path", async (t) => {
  const { root, config } = await createProject(t);
  const before = await snapshot(root);
  const originalConfig = structuredClone(config);
  const report = reportFixture();
  const bundle = formatContrastReportBundle(report);
  const result = await writeContrastReport({ root, config, report, output: "elsewhere.html" });
  assert.equal(typeof result, "string");
  assert.equal(result, path.join(root, REPORT_PATH));
  assert.ok(path.isAbsolute(result));
  assert.equal(await readFile(result, "utf8"), bundle.html);
  assert.ok((await readFile(result, "utf8")).startsWith(`${MARKER}\n`));
  const style = await readFile(path.join(root, REPORT_STYLE_PATH), "utf8");
  assert.equal(style, assetContent(bundle, REPORT_ASSETS.reportStyle));
  assert.ok(style.startsWith(`${REPORT_ASSET_MARKER}\n`));
  assert.deepEqual((await readdir(path.join(root, REPORT_DIRECTORY))).sort(), ["report.html", "styles"]);
  assert.deepEqual(await readdir(path.join(root, REPORT_DIRECTORY, "styles")), ["report.css"]);
  assert.deepEqual(withoutReport(await snapshot(root)), before);
  assert.deepEqual(config, originalConfig);
});

test("preview:true publishes the pair with assets and relative links inside the report folder", async (t) => {
  const { root, config } = await createProject(t);
  const report = reportFixture();
  const result = await writeContrastReport({ root, config, report, preview: true });
  assert.deepEqual(Object.keys(result).sort(), ["previewPath", "reportPath"]);
  assert.equal(result.reportPath, path.join(root, REPORT_PATH));
  assert.equal(result.previewPath, path.join(root, PREVIEW_PATH));
  assert.equal(await readFile(result.reportPath, "utf8"), reportHtml(report));
  assert.equal(await readFile(result.previewPath, "utf8"), previewHtml(report));
  assert.match(await readFile(result.reportPath, "utf8"), /href="styles\/report\.css"/);
  assert.match(await readFile(result.previewPath, "utf8"), /href="styles\/preview\.css"/);
  assert.deepEqual((await readdir(path.join(root, REPORT_DIRECTORY))).sort(), ["index.html", "report.html", "styles"]);
  assert.deepEqual((await readdir(path.join(root, REPORT_DIRECTORY, "styles"))).sort(), ["preview.css", "report.css"]);
  // A legacy snapshot has no diagnostic runtime, so no script asset is published.
  await assert.rejects(access(path.join(root, PREVIEW_SCRIPT_PATH)), { code: "ENOENT" });
});

test("publishes the preview stylesheet and script for a diagnostic session", async (t) => {
  const { root, config } = await createProject(t);
  const report = diagnosticFixture();
  const bundle = formatContrastPreviewBundle(report);
  const result = await writeContrastReport({ root, config, report, preview: true });
  assert.equal(await readFile(result.previewPath, "utf8"), bundle.html);
  assert.equal(await readFile(path.join(root, PREVIEW_STYLE_PATH), "utf8"), assetContent(bundle, REPORT_ASSETS.previewStyle));
  const script = await readFile(path.join(root, PREVIEW_SCRIPT_PATH), "utf8");
  assert.equal(script, assetContent(bundle, REPORT_ASSETS.previewScript));
  assert.ok(script.startsWith(REPORT_ASSET_MARKER));
  assert.match(bundle.html, /src="scripts\/preview\.js"/);
});

test("URL roots and declared report file paths do not redirect the fixed artifact", async (t) => {
  const { root, config } = await createProject(t);
  const report = reportFixture({ files: { palette: "metadata-only.css", config: null, tuning: null, output: "../not-an-output.html" } });
  const before = await snapshot(root);
  const result = await writeContrastReport({ root: pathToFileURL(`${root}${path.sep}`), config, report });
  assert.equal(result, path.join(root, REPORT_PATH));
  assert.equal(await readFile(result, "utf8"), reportHtml(report));
  assert.deepEqual(withoutReport(await snapshot(root)), before);
});

test("updates owned artifacts on repeat runs and preserves sibling files and legacy reports/", async (t) => {
  for (const [name, next, outcome] of [
    ["pass", reportFixture({ inputDigest: "b".repeat(64), notes: ["CURRENT_PASS"] }), /Esito positivo dello snapshot: 0 issue/],
    ["incomplete", reportFixture({ scenarios: [], generationErrors: ["CURRENT_INPUT_INVALID"] }), /Esito non verificato o incompleto/],
    ["missing snapshot", undefined, /Esito non verificato o incompleto/],
  ]) {
    await t.test(name, async (t) => {
      const { root, config } = await createProject(t);
      await writeContrastReport({ root, config, report: reportFixture({ generationErrors: ["STALE_FAILURE_ONLY"] }) });
      await writeFile(path.join(root, REPORT_DIRECTORY, "keep.txt"), "report sibling sentinel\n");
      await writeFile(path.join(root, REPORT_DIRECTORY, ".unrelated.tmp"), "unrelated temporary file\n");
      await mkdir(path.join(root, "reports"));
      await writeFile(path.join(root, "reports/smart-colors.html"), "legacy report sentinel\n");
      await writeFile(path.join(root, "reports/keep.txt"), "legacy sibling sentinel\n");
      const legacy = await snapshot(path.join(root, "reports"));
      const result = await writeContrastReport({ root, report: next });
      const html = await readFile(result, "utf8");
      assert.equal(html, reportHtml(next));
      assert.match(html, outcome);
      assert.doesNotMatch(html, /STALE_FAILURE_ONLY/);
      assert.equal(await readFile(path.join(root, REPORT_DIRECTORY, "keep.txt"), "utf8"), "report sibling sentinel\n");
      assert.equal(await readFile(path.join(root, REPORT_DIRECTORY, ".unrelated.tmp"), "utf8"), "unrelated temporary file\n");
      assert.deepEqual((await readdir(path.join(root, REPORT_DIRECTORY))).sort(), [".unrelated.tmp", "keep.txt", "report.html", "styles"]);
      // Legacy artifacts are never deleted or rewritten by the new folder-based publication.
      assert.deepEqual(await snapshot(path.join(root, "reports")), legacy);
    });
  }
});

test("preserves unrelated stylesheets and scripts already inside the report folder", async (t) => {
  const { root, config } = await createProject(t);
  await mkdir(path.join(root, REPORT_DIRECTORY, "styles"), { recursive: true });
  await mkdir(path.join(root, REPORT_DIRECTORY, "scripts"), { recursive: true });
  await writeFile(path.join(root, REPORT_DIRECTORY, "styles/custom.css"), "custom stylesheet\n");
  await writeFile(path.join(root, REPORT_DIRECTORY, "scripts/app.js"), "custom script\n");
  await writeContrastReport({ root, config, report: reportFixture(), preview: true });
  assert.equal(await readFile(path.join(root, REPORT_DIRECTORY, "styles/custom.css"), "utf8"), "custom stylesheet\n");
  assert.equal(await readFile(path.join(root, REPORT_DIRECTORY, "scripts/app.js"), "utf8"), "custom script\n");
  assert.deepEqual((await readdir(path.join(root, REPORT_DIRECTORY, "styles"))).sort(), ["custom.css", "preview.css", "report.css"]);
  assert.deepEqual(await readdir(path.join(root, REPORT_DIRECTORY, "scripts")), ["app.js"]);
});

test("invalid source-to-source collisions still permit a safe incomplete report", async (t) => {
  const { root, config } = await createProject(t);
  config.output = config.palette;
  config.motion = { enabled: true, output: config.palette };
  const report = reportFixture({ scenarios: [], generationErrors: ["Input paths collide"] });
  const before = await snapshot(root);
  const result = await writeContrastReport({ root, config, tuningPath: config.palette, report });
  assert.equal(await readFile(result, "utf8"), reportHtml(report));
  assert.deepEqual(withoutReport(await snapshot(root)), before);
});

const PROTECTED_SETTINGS = [
  ["palette", (options, value) => { options.config.palette = value; }],
  ["configFile", (options, value) => { options.configFile = value; }],
  ["colors", (options, value) => { options.config.output = value; }],
  ["motion enabled", (options, value) => { options.config.motion = { enabled: true, output: value }; }],
  ["motion disabled", (options, value) => { options.config.motion = { enabled: false, output: value }; }],
  ["tuning", (options, value) => { options.tuningPath = value; }],
];

// Every document and asset path is protected even when the current call does not request it.
for (const existing of [false, true]) {
  test(`configured inputs cannot alias a document or asset path (${existing ? "existing owned files" : "future files"})`, async (t) => {
    for (const relativePath of CONTRACT_PATHS) {
      await t.test(relativePath, async (t) => {
        for (const [name, configure] of PROTECTED_SETTINGS) {
          await t.test(name, async (t) => {
            const { root, config } = await createProject(t);
            if (existing) await writeContrastReport({ root, config, report: reportFixture(), preview: true });
            const options = { root, config, report: reportFixture() };
            configure(options, relativePath);
            await assertRefusal(options, /Smart Colors report path validation failed.*output path collision/);
            if (!existing) await assert.rejects(access(path.join(root, REPORT_DIRECTORY)), { code: "ENOENT" });
          });
        }
      });
    }
  });

  test(`input symlinks cannot alias a document or asset path (${existing ? "existing target" : "dangling target"})`, async (t) => {
    for (const relativePath of CONTRACT_PATHS) {
      await t.test(relativePath, async (t) => {
        for (const [name, configure] of PROTECTED_SETTINGS) {
          await t.test(name, async (t) => {
            const { root, config } = await createProject(t);
            if (existing) await writeContrastReport({ root, config, report: reportFixture(), preview: true });
            if (!await createSymlink(t, relativePath, path.join(root, "input-alias"))) return;
            const options = { root, config, report: reportFixture() };
            configure(options, "input-alias");
            await assertRefusal(options, /Smart Colors report path validation failed.*output path collision/);
            if (!existing) await assert.rejects(access(path.join(root, REPORT_DIRECTORY)), { code: "ENOENT" });
          });
        }
      });
    }
  });
}

test("missing config protects all known default input and output paths", async (t) => {
  for (const file of DEFAULT_PATHS) {
    await t.test(file, async (t) => {
      const { root } = await createProject(t);
      await rm(path.join(root, file));
      if (!await createSymlink(t, path.join(root, REPORT_PATH), path.join(root, file))) return;
      await assertRefusal({ root, report: reportFixture({ generationErrors: ["Config unavailable"] }) }, /Smart Colors report path validation failed.*output path collision/);
      await assert.rejects(access(path.join(root, REPORT_DIRECTORY)), { code: "ENOENT" });
    });
  }
});

test("guard resolves file URLs and normalized input paths before creating reports", async (t) => {
  for (const value of ["smart-colors-reports/nested/../report.html", "file URL"]) {
    await t.test(value, async (t) => {
      const { root, config } = await createProject(t);
      config.palette = value === "file URL" ? pathToFileURL(path.join(root, REPORT_PATH)) : value;
      await assertRefusal({ root, config, report: reportFixture() }, /output path collision/);
      await assert.rejects(access(path.join(root, REPORT_DIRECTORY)), { code: "ENOENT" });
    });
  }
});

test("unresolvable protected paths fail before creating directories or altering owned reports", async (t) => {
  for (const existing of [false, true]) {
    await t.test(`existing: ${existing}`, async (t) => {
      const { root, config } = await createProject(t);
      if (existing) await writeContrastReport({ root, config, report: reportFixture() });
      config.palette = "https://example.invalid/palette.css";
      await assertRefusal({ root, config, report: reportFixture() }, /report path validation failed.*cannot resolve/);
      if (!existing) await assert.rejects(access(path.join(root, REPORT_DIRECTORY)), { code: "ENOENT" });
    });
  }
});

test("refuses unowned documents and assets, including misplaced and wrong-version markers", async (t) => {
  const cases = [
    { relativePath: REPORT_PATH, marker: MARKER },
    { relativePath: PREVIEW_PATH, marker: MARKER },
    { relativePath: REPORT_STYLE_PATH, marker: REPORT_ASSET_MARKER },
    { relativePath: PREVIEW_STYLE_PATH, marker: REPORT_ASSET_MARKER },
    { relativePath: PREVIEW_SCRIPT_PATH, marker: REPORT_ASSET_MARKER },
  ];
  for (const { relativePath, marker } of cases) {
    const variants = marker === MARKER
      ? ["", "manual report\n", `\n${MARKER}`, `\ufeff${MARKER}`, `prefix\n${MARKER}`, "<!-- smart-colors-report:v2 -->", MARKER.slice(0, -1)]
      : ["", "body {}\n", `\n${REPORT_ASSET_MARKER}`, REPORT_ASSET_MARKER.slice(0, -1), "/* smart-colors-report:v2 */"];
    for (const bytes of variants) {
      await t.test(`${relativePath}: ${JSON.stringify(bytes)}`, async (t) => {
        const { root, config } = await createProject(t);
        const target = path.join(root, relativePath);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
        // A diagnostic session is required so the preview script is actually a requested target.
        await assertRefusal({ root, config, report: diagnosticFixture(), preview: true }, /refuses to overwrite an unowned file/);
      });
    }
  }
});

test("refuses existing and dangling symlinks at the report file", async (t) => {
  for (const target of ["palette", "owned file", "missing file"]) {
    await t.test(target, async (t) => {
      const { root, config } = await createProject(t);
      await mkdir(path.join(root, REPORT_DIRECTORY));
      let destination = path.join(root, config.palette);
      if (target !== "palette") {
        destination = path.join(root, `${target}.html`);
        if (target === "owned file") await writeFile(destination, reportHtml(reportFixture()));
      }
      if (!await createSymlink(t, destination, path.join(root, REPORT_PATH))) return;
      await assertRefusal({ root, config, report: reportFixture() }, /refuses a symbolic link at report file/);
    });
  }
});

test("refuses a symlink at the report folder and in any nested ancestor directory", async (t) => {
  await t.test("report folder", async (t) => {
    for (const existing of [false, true]) {
      await t.test(`existing target: ${existing}`, async (t) => {
        const { root, config } = await createProject(t);
        const target = path.join(root, "elsewhere");
        if (existing) {
          await mkdir(path.join(target, "styles"), { recursive: true });
          await writeFile(path.join(target, "report.html"), reportHtml(reportFixture()));
        }
        const type = existing && process.platform === "win32" ? "junction" : "dir";
        if (!await createSymlink(t, target, path.join(root, REPORT_DIRECTORY), type)) return;
        await assertRefusal({ root, config, report: reportFixture() }, /refuses a symbolic link at report directory/);
        if (!existing) await assert.rejects(access(target), { code: "ENOENT" });
      });
    }
  });

  for (const nested of [path.join("styles"), path.join("scripts")]) {
    await t.test(nested, async (t) => {
      const { root, config } = await createProject(t);
      const target = path.join(root, "elsewhere");
      await mkdir(target);
      await writeFile(path.join(target, "keep.txt"), "nested target sentinel\n");
      await mkdir(path.join(root, REPORT_DIRECTORY));
      const type = process.platform === "win32" ? "junction" : "dir";
      if (!await createSymlink(t, target, path.join(root, REPORT_DIRECTORY, nested), type)) return;
      // Even a report-only call must refuse a redirected styles/ or scripts/ directory.
      await assertRefusal({ root, config, report: reportFixture() }, /refuses a symbolic link at report directory/);
      assert.deepEqual(await readdir(target), ["keep.txt"]);
      assert.equal(await readFile(path.join(target, "keep.txt"), "utf8"), "nested target sentinel\n");
    });
  }
});

test("refuses hard-linked documents and assets even with the ownership marker", async (t) => {
  const cases = [
    { relativePath: REPORT_PATH, marker: MARKER, content: reportHtml(reportFixture()) },
    { relativePath: REPORT_STYLE_PATH, marker: REPORT_ASSET_MARKER, content: `${REPORT_ASSET_MARKER}\nbody {}` },
  ];
  for (const { relativePath, content } of cases) {
    for (const owned of [false, true]) {
      await t.test(`${relativePath} marked: ${owned}`, async (t) => {
        const { root, config } = await createProject(t);
        await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
        const source = owned ? path.join(root, "owned.txt") : path.join(root, config.palette);
        if (owned) await writeFile(source, content);
        try {
          await link(source, path.join(root, relativePath));
        } catch (error) {
          if (!["EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EXDEV"].includes(error.code)) throw error;
          t.skip(`Hard links unavailable: ${error.code}`);
          return;
        }
        const links = (await lstat(source)).nlink;
        await assertRefusal({ root, config, report: reportFixture() }, /refuses a hard-linked report file/);
        assert.equal((await lstat(source)).nlink, links);
      });
    }
  }
});

test("refuses a file in place of the report folder and a directory in place of a document", async (t) => {
  for (const directory of [false, true]) {
    await t.test(`document is directory: ${directory}`, async (t) => {
      const { root, config } = await createProject(t);
      if (directory) {
        await mkdir(path.join(root, REPORT_PATH), { recursive: true });
        await writeFile(path.join(root, REPORT_PATH, "keep.txt"), "directory child sentinel\n");
      } else {
        await writeFile(path.join(root, REPORT_DIRECTORY), "parent file sentinel\n");
      }
      await assertRefusal({ root, config, report: reportFixture() }, directory ? /non-regular report file/ : /report directory is not a directory/);
    });
  }
});

test("render failures never create artifact directories or alter existing owned artifacts", async (t) => {
  for (const existing of [false, true]) {
    await t.test(`existing: ${existing}`, async (t) => {
      const { root, config } = await createProject(t);
      if (existing) await writeContrastReport({ root, config, report: reportFixture() });
      const report = reportFixture();
      Object.defineProperty(report, "scenarios", { get() { throw new Error("fixture render failure"); } });
      await assertRefusal({ root, config, report }, /fixture render failure/);
      if (!existing) await assert.rejects(access(path.join(root, REPORT_DIRECTORY)), { code: "ENOENT" });
    });
  }
});

test("validation errors never leave a partial set of documents or assets", async (t) => {
  const { root, config } = await createProject(t);
  // A collision on the last contract path is detected before staging, so nothing is created.
  config.output = PREVIEW_SCRIPT_PATH;
  await assertRefusal({ root, config, report: diagnosticFixture(), preview: true }, /output path collision/);
  await assert.rejects(access(path.join(root, REPORT_DIRECTORY)), { code: "ENOENT" });

  // An unowned asset blocks the whole call after owned documents already exist.
  const { root: second, config: secondConfig } = await createProject(t);
  await writeContrastReport({ root: second, config: secondConfig, report: reportFixture(), preview: true });
  const before = await snapshot(second);
  await mkdir(path.join(second, REPORT_DIRECTORY, "scripts"), { recursive: true });
  await writeFile(path.join(second, PREVIEW_SCRIPT_PATH), "manual script\n");
  await assert.rejects(
    () => writeContrastReport({ root: second, config: secondConfig, report: diagnosticFixture(), preview: true }),
    /refuses to overwrite an unowned file/,
  );
  const after = new Map(await snapshot(second));
  for (const [file, value] of before) assert.deepEqual(after.get(file), value);
  assert.equal(after.get(path.normalize(PREVIEW_SCRIPT_PATH)).bytes.toString("utf8"), "manual script\n");
});

test("exclusive temporary-file collisions preserve all pre-existing files", async (t) => {
  const { root, config } = await createProject(t);
  await writeContrastReport({ root, config, report: reportFixture() });
  const uuid = "00000000-0000-4000-8000-000000000000";
  const temporaryPath = path.join(root, REPORT_DIRECTORY, `.smart-colors-report-${uuid}.tmp`);
  await writeFile(temporaryPath, "pre-existing temporary sentinel\n");
  mockBuiltin(t, crypto, "randomUUID", () => uuid);
  await assertRefusal({ root, config, report: reportFixture({ notes: ["new snapshot"] }) }, { code: "EEXIST" });
  assert.equal(await readFile(temporaryPath, "utf8"), "pre-existing temporary sentinel\n");
});

test("failed temporary writes close and clean up only the newly created temporary files", async (t) => {
  const { root, config } = await createProject(t);
  await writeContrastReport({ root, config, report: reportFixture() });
  await writeFile(path.join(root, REPORT_DIRECTORY, ".keep.tmp"), "unrelated temporary sentinel\n");
  const originalOpen = fs.open;
  const handles = [];
  mockBuiltin(t, fs, "open", async (...args) => {
    const handle = await originalOpen(...args);
    if (args[1] === "wx") {
      handles.push(handle);
      t.mock.method(handle, "writeFile", async () => { throw new Error("fixture temporary write failure"); });
    }
    return handle;
  });
  await assertRefusal({ root, config, report: reportFixture() }, /fixture temporary write failure/);
  assert.ok(handles.length > 0);
  for (const handle of handles) assert.equal(handle.fd, -1);
  assert.equal(await readFile(path.join(root, REPORT_DIRECTORY, ".keep.tmp"), "utf8"), "unrelated temporary sentinel\n");
});

test("failed rename preserves the previous document and cleans up its temporary file", async (t) => {
  const { root, config } = await createProject(t);
  const oldReport = reportFixture({ generationErrors: ["old error"] });
  const next = reportFixture({ notes: ["new snapshot"] });
  await writeContrastReport({ root, config, report: oldReport });
  await writeFile(path.join(root, REPORT_DIRECTORY, ".keep.tmp"), "unrelated temporary sentinel\n");
  const originalRename = fs.rename;
  let failures = 0;
  const rename = mockBuiltin(t, fs, "rename", async (source, destination) => {
    if (destination === path.join(root, REPORT_PATH)) {
      failures += 1;
      assert.equal(await readFile(destination, "utf8"), reportHtml(oldReport));
      assert.equal(await readFile(source, "utf8"), reportHtml(next));
      throw new Error("fixture rename failure");
    }
    return originalRename(source, destination);
  });
  await assert.rejects(() => writeContrastReport({ root, config, report: next }), /fixture rename failure/);
  assert.equal(failures, 1);
  assert.equal(rename.mock.callCount(), 2);
  // The stylesheet was already published; the document still shows the previous snapshot.
  assert.equal(await readFile(path.join(root, REPORT_PATH), "utf8"), reportHtml(oldReport));
  assert.equal(await readFile(path.join(root, REPORT_STYLE_PATH), "utf8"), assetContent(formatContrastReportBundle(next), REPORT_ASSETS.reportStyle));
  assert.equal(await readFile(path.join(root, REPORT_DIRECTORY, ".keep.tmp"), "utf8"), "unrelated temporary sentinel\n");
});

test("publishes every asset before the documents that link to it", async (t) => {
  const { root, config } = await createProject(t);
  const originalRename = fs.rename;
  const order = [];
  mockBuiltin(t, fs, "rename", async (source, destination) => {
    order.push(path.relative(root, destination));
    return originalRename(source, destination);
  });
  await writeContrastReport({ root, config, report: reportFixture(), preview: true });
  assert.deepEqual(order, [REPORT_STYLE_PATH, PREVIEW_STYLE_PATH, REPORT_PATH, PREVIEW_PATH]);
});

test("publishes file-by-file: a failed document rename keeps the newer assets and the old document", async (t) => {
  const { root, config } = await createProject(t);
  const first = reportFixture({ notes: ["first"] });
  const next = reportFixture({ notes: ["next"] });
  await writeContrastReport({ root, config, report: first, preview: true });
  const originalRename = fs.rename;
  let calls = 0;
  const rename = mockBuiltin(t, fs, "rename", async (source, destination) => {
    calls += 1;
    // style order: report.css, preview.css, then report.html, index.html
    if (calls === 3) throw new Error("fixture document rename failure");
    return originalRename(source, destination);
  });
  await assert.rejects(() => writeContrastReport({ root, config, report: next, preview: true }), /fixture document rename failure/);
  assert.equal(rename.mock.callCount(), 3);
  // Assets are current, the failed document still shows its previous snapshot, the dependent preview stays old.
  assert.equal(await readFile(path.join(root, REPORT_STYLE_PATH), "utf8"), assetContent(formatContrastReportBundle(next), REPORT_ASSETS.reportStyle));
  assert.equal(await readFile(path.join(root, REPORT_PATH), "utf8"), reportHtml(first));
  assert.equal(await readFile(path.join(root, PREVIEW_PATH), "utf8"), previewHtml(first));
  assert.deepEqual((await readdir(path.join(root, REPORT_DIRECTORY))).sort(), ["index.html", "report.html", "styles"]);
  for (const directory of [REPORT_DIRECTORY, path.join(REPORT_DIRECTORY, "styles")]) {
    assert.ok(!(await readdir(path.join(root, directory))).some((name) => name.endsWith(".tmp")));
  }
});

test("fresh and repeated generation keep one stable artifact set", async (t) => {
  const { root, config } = await createProject(t);
  const first = reportFixture({ notes: ["first"] });
  const second = reportFixture({ notes: ["second"] });
  await writeContrastReport({ root, config, report: first, preview: true });
  const afterFirst = await snapshot(root);
  await writeContrastReport({ root, config, report: second, preview: true });
  const afterSecond = await snapshot(root);
  assert.deepEqual(afterSecond.map(([file]) => file), afterFirst.map(([file]) => file));
  assert.equal(await readFile(path.join(root, REPORT_PATH), "utf8"), reportHtml(second));
  assert.equal(await readFile(path.join(root, PREVIEW_PATH), "utf8"), previewHtml(second));
  assert.equal(await readFile(path.join(root, REPORT_STYLE_PATH), "utf8"), assetContent(formatContrastReportBundle(second), REPORT_ASSETS.reportStyle));
  assert.ok(!afterSecond.some(([file]) => file.endsWith(".tmp")));
});

test("refuses a report path colliding with the motion output even when motion is disabled", async (t) => {
  const { root } = await createProject(t);
  const config = { ...structuredClone(defaultSmartColorsConfig), motion: { enabled: false, output: REPORT_PATH } };
  await assertRefusal({ root, config, report: reportFixture() }, /config\.motion\.output/);
});
