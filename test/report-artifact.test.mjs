import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs, { access, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { formatContrastReportHtml } from "../src/format-report-html.mjs";
import { formatContrastPreviewHtml } from "../src/format-report-preview.mjs";
import { DEFAULT_CONFIG_FILE } from "../src/load-config.mjs";
import * as artifact from "../src/report-artifact.mjs";

const { writeContrastReport } = artifact;
const REPORT_PATH = "reports/smart-colors.html";
const MARKER = "<!-- smart-colors-report:v1 -->";
const TUNING_PATH = "src/styles/tokens/colors-tuning.css";
const DEFAULT_PATHS = [
  defaultSmartColorsConfig.palette, DEFAULT_CONFIG_FILE, defaultSmartColorsConfig.output,
  defaultSmartColorsConfig.motion.output, TUNING_PATH,
];

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

function withoutReport(entries) {
  return entries.filter(([file]) => file !== "reports" && file !== path.normalize(REPORT_PATH));
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

test("creates only the fixed marked report and returns an absolute string path", async (t) => {
  const { root, config } = await createProject(t);
  const before = await snapshot(root);
  const originalConfig = structuredClone(config);
  const report = reportFixture();
  const result = await writeContrastReport({ root, config, report, output: "elsewhere.html" });
  assert.equal(typeof result, "string");
  assert.equal(result, path.join(root, REPORT_PATH));
  assert.ok(path.isAbsolute(result));
  assert.equal(await readFile(result, "utf8"), formatContrastReportHtml(report));
  assert.ok((await readFile(result, "utf8")).startsWith(`${MARKER}\n`));
  assert.deepEqual(await readdir(path.join(root, "reports")), ["smart-colors.html"]);
  assert.deepEqual(withoutReport(await snapshot(root)), before);
  assert.deepEqual(config, originalConfig);
});

test("URL roots and declared report file paths do not redirect the fixed artifact", async (t) => {
  const { root, config } = await createProject(t);
  const report = reportFixture({ files: { palette: "metadata-only.css", config: null, tuning: null, output: "../not-an-output.html" } });
  const before = await snapshot(root);
  const result = await writeContrastReport({ root: pathToFileURL(`${root}${path.sep}`), config, report });
  assert.equal(result, path.join(root, REPORT_PATH));
  assert.equal(await readFile(result, "utf8"), formatContrastReportHtml(report));
  assert.deepEqual(withoutReport(await snapshot(root)), before);
});

test("updates owned failure reports for pass and incomplete results without deleting siblings", async (t) => {
  for (const [name, next, outcome] of [
    ["pass", reportFixture({ inputDigest: "b".repeat(64), notes: ["CURRENT_PASS"] }), /Esito positivo dello snapshot: 0 issue/],
    ["incomplete", reportFixture({ scenarios: [], generationErrors: ["CURRENT_INPUT_INVALID"] }), /Esito non verificato o incompleto/],
    ["missing snapshot", undefined, /Esito non verificato o incompleto/],
  ]) {
    await t.test(name, async (t) => {
      const { root, config } = await createProject(t);
      await writeContrastReport({ root, config, report: reportFixture({ generationErrors: ["STALE_FAILURE_ONLY"] }) });
      await writeFile(path.join(root, "reports/keep.txt"), "report sibling sentinel\n");
      await writeFile(path.join(root, "reports/.unrelated.tmp"), "unrelated temporary file\n");
      const before = await snapshot(root);
      const result = await writeContrastReport({ root, report: next });
      const html = await readFile(result, "utf8");
      assert.equal(html, formatContrastReportHtml(next));
      assert.match(html, outcome);
      assert.doesNotMatch(html, /STALE_FAILURE_ONLY/);
      assert.deepEqual(withoutReport(await snapshot(root)), withoutReport(before));
      assert.deepEqual((await readdir(path.join(root, "reports"))).sort(), [".unrelated.tmp", "keep.txt", "smart-colors.html"]);
    });
  }
});

test("invalid source-to-source collisions still permit a safe incomplete report", async (t) => {
  const { root, config } = await createProject(t);
  config.output = config.palette;
  config.motion = { enabled: true, output: config.palette };
  const report = reportFixture({ scenarios: [], generationErrors: ["Input paths collide"] });
  const before = await snapshot(root);
  const result = await writeContrastReport({ root, config, tuningPath: config.palette, report });
  assert.equal(await readFile(result, "utf8"), formatContrastReportHtml(report));
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

for (const existing of [false, true]) {
  test(`configured inputs cannot be the report path (${existing ? "existing owned file" : "future file"})`, async (t) => {
    for (const [name, configure] of PROTECTED_SETTINGS) {
      await t.test(name, async (t) => {
        const { root, config } = await createProject(t);
        if (existing) {
          await mkdir(path.join(root, "reports"));
          await writeFile(path.join(root, REPORT_PATH), formatContrastReportHtml(reportFixture()));
        }
        const options = { root, config, report: reportFixture() };
        configure(options, REPORT_PATH);
        await assertRefusal(options, /Smart Colors report path validation failed.*output path collision/);
        if (!existing) await assert.rejects(access(path.join(root, "reports")), { code: "ENOENT" });
      });
    }
  });

  test(`input symlinks cannot alias the report (${existing ? "existing target" : "dangling target"})`, async (t) => {
    for (const [name, configure] of PROTECTED_SETTINGS) {
      await t.test(name, async (t) => {
        const { root, config } = await createProject(t);
        if (existing) {
          await mkdir(path.join(root, "reports"));
          await writeFile(path.join(root, REPORT_PATH), formatContrastReportHtml(reportFixture()));
        }
        if (!await createSymlink(t, REPORT_PATH, path.join(root, "input-alias"))) return;
        const options = { root, config, report: reportFixture() };
        configure(options, "input-alias");
        await assertRefusal(options, /Smart Colors report path validation failed.*output path collision/);
        if (!existing) await assert.rejects(access(path.join(root, "reports")), { code: "ENOENT" });
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
      await assert.rejects(access(path.join(root, "reports")), { code: "ENOENT" });
    });
  }
});

test("guard resolves file URLs and normalized input paths before creating reports", async (t) => {
  for (const value of ["reports/nested/../smart-colors.html", "file URL"]) {
    await t.test(value, async (t) => {
      const { root, config } = await createProject(t);
      config.palette = value === "file URL" ? pathToFileURL(path.join(root, REPORT_PATH)) : value;
      await assertRefusal({ root, config, report: reportFixture() }, /output path collision/);
      await assert.rejects(access(path.join(root, "reports")), { code: "ENOENT" });
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
      if (!existing) await assert.rejects(access(path.join(root, "reports")), { code: "ENOENT" });
    });
  }
});

test("refuses unowned files including misplaced, incomplete and wrong-version markers", async (t) => {
  for (const bytes of ["", "manual report\n", `\n${MARKER}`, `\ufeff${MARKER}`, `prefix\n${MARKER}`, "<!-- smart-colors-report:v2 -->", MARKER.slice(0, -1)]) {
    await t.test(JSON.stringify(bytes), async (t) => {
      const { root, config } = await createProject(t);
      await mkdir(path.join(root, "reports"));
      await writeFile(path.join(root, REPORT_PATH), bytes);
      await assertRefusal({ root, config, report: reportFixture() }, /refuses to overwrite an unowned file/);
    });
  }
});

test("refuses existing and dangling symlinks at the report file", async (t) => {
  for (const target of ["palette", "owned file", "missing file"]) {
    await t.test(target, async (t) => {
      const { root, config } = await createProject(t);
      await mkdir(path.join(root, "reports"));
      let destination = path.join(root, config.palette);
      if (target !== "palette") {
        destination = path.join(root, `${target}.html`);
        if (target === "owned file") await writeFile(destination, formatContrastReportHtml(reportFixture()));
      }
      if (!await createSymlink(t, destination, path.join(root, REPORT_PATH))) return;
      await assertRefusal({ root, config, report: reportFixture() }, /refuses a symbolic link at report file/);
    });
  }
});

test("refuses existing and dangling symlinks at the reports parent", async (t) => {
  for (const existing of [false, true]) {
    await t.test(`existing target: ${existing}`, async (t) => {
      const { root, config } = await createProject(t);
      const target = path.join(root, "elsewhere");
      if (existing) {
        await mkdir(target);
        await writeFile(path.join(target, "smart-colors.html"), formatContrastReportHtml(reportFixture()));
        await writeFile(path.join(target, "keep.txt"), "parent target sentinel\n");
      }
      const type = existing && process.platform === "win32" ? "junction" : "dir";
      if (!await createSymlink(t, target, path.join(root, "reports"), type)) return;
      await assertRefusal({ root, config, report: reportFixture() }, /refuses a symbolic link at reports directory/);
      if (!existing) await assert.rejects(access(target), { code: "ENOENT" });
    });
  }
});

test("refuses hard-linked report files even with the ownership marker", async (t) => {
  for (const owned of [false, true]) {
    await t.test(`marked: ${owned}`, async (t) => {
      const { root, config } = await createProject(t);
      await mkdir(path.join(root, "reports"));
      const source = owned ? path.join(root, "owned.html") : path.join(root, config.palette);
      if (owned) await writeFile(source, formatContrastReportHtml(reportFixture()));
      try {
        await link(source, path.join(root, REPORT_PATH));
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
});

test("refuses a file in place of reports and a directory in place of the report", async (t) => {
  for (const directory of [false, true]) {
    await t.test(`report is directory: ${directory}`, async (t) => {
      const { root, config } = await createProject(t);
      if (directory) {
        await mkdir(path.join(root, REPORT_PATH), { recursive: true });
        await writeFile(path.join(root, REPORT_PATH, "keep.txt"), "directory child sentinel\n");
      } else {
        await writeFile(path.join(root, "reports"), "parent file sentinel\n");
      }
      await assertRefusal({ root, config, report: reportFixture() }, directory ? /non-regular report file/ : /report directory is not a directory/);
    });
  }
});

test("render failures never create artifact directories or alter existing owned reports", async (t) => {
  for (const existing of [false, true]) {
    await t.test(`existing: ${existing}`, async (t) => {
      const { root, config } = await createProject(t);
      if (existing) await writeContrastReport({ root, config, report: reportFixture() });
      const report = reportFixture();
      Object.defineProperty(report, "scenarios", { get() { throw new Error("fixture render failure"); } });
      await assertRefusal({ root, config, report }, /fixture render failure/);
      if (!existing) await assert.rejects(access(path.join(root, "reports")), { code: "ENOENT" });
    });
  }
});

test("exclusive temporary-file collisions preserve all pre-existing files", async (t) => {
  const { root, config } = await createProject(t);
  await writeContrastReport({ root, config, report: reportFixture() });
  const uuid = "00000000-0000-4000-8000-000000000000";
  const temporaryPath = path.join(root, "reports", `.smart-colors-report-${uuid}.tmp`);
  await writeFile(temporaryPath, "pre-existing temporary sentinel\n");
  mockBuiltin(t, crypto, "randomUUID", () => uuid);
  await assertRefusal({ root, config, report: reportFixture({ notes: ["new snapshot"] }) }, { code: "EEXIST" });
});

test("failed temporary writes close and clean up only the newly created temporary file", async (t) => {
  const { root, config } = await createProject(t);
  await writeContrastReport({ root, config, report: reportFixture() });
  await writeFile(path.join(root, "reports/.keep.tmp"), "unrelated temporary sentinel\n");
  const originalOpen = fs.open;
  let temporaryHandle;
  mockBuiltin(t, fs, "open", async (...args) => {
    const handle = await originalOpen(...args);
    if (args[1] === "wx") {
      temporaryHandle = handle;
      t.mock.method(handle, "writeFile", async () => { throw new Error("fixture temporary write failure"); });
    }
    return handle;
  });
  await assertRefusal({ root, config, report: reportFixture() }, /fixture temporary write failure/);
  assert.ok(temporaryHandle);
  assert.equal(temporaryHandle.fd, -1);
});

test("failed atomic rename preserves the old report and cleans up its complete temporary file", async (t) => {
  const { root, config } = await createProject(t);
  const oldReport = reportFixture({ generationErrors: ["old error"] });
  const next = reportFixture({ notes: ["new snapshot"] });
  await writeContrastReport({ root, config, report: oldReport });
  await writeFile(path.join(root, "reports/.keep.tmp"), "unrelated temporary sentinel\n");
  const rename = mockBuiltin(t, fs, "rename", async (source, destination) => {
    assert.equal(destination, path.join(root, REPORT_PATH));
    assert.equal(await readFile(destination, "utf8"), formatContrastReportHtml(oldReport));
    assert.equal(await readFile(source, "utf8"), formatContrastReportHtml(next));
    throw new Error("fixture rename failure");
  });
  await assertRefusal({ root, config, report: next }, /fixture rename failure/);
  assert.equal(rename.mock.callCount(), 1);
});

test("publishes the pair file-by-file: a failed second rename keeps the first artifact and leaves no temporaries", async (t) => {
  const { root, config } = await createProject(t);
  const first = reportFixture({ notes: ["first"] });
  const next = reportFixture({ notes: ["next"] });
  await writeContrastReport({ root, config, report: first, preview: true });
  const originalRename = fs.rename;
  let calls = 0;
  const rename = mockBuiltin(t, fs, "rename", async (source, destination) => {
    calls += 1;
    if (calls === 2) throw new Error("fixture second rename failure");
    return originalRename(source, destination);
  });
  await assert.rejects(() => writeContrastReport({ root, config, report: next, preview: true }), /fixture second rename failure/);
  assert.equal(rename.mock.callCount(), 2);
  // Atomic per file, never a transaction over the pair: the report is updated, the preview is not.
  assert.equal(await readFile(path.join(root, REPORT_PATH), "utf8"), formatContrastReportHtml(next));
  assert.equal(await readFile(path.join(root, "reports/smart-colors-preview.html"), "utf8"), formatContrastPreviewHtml(first));
  assert.deepEqual((await readdir(path.join(root, "reports"))).sort(), ["smart-colors-preview.html", "smart-colors.html"]);
  for (const filePath of [path.join(root, REPORT_PATH), path.join(root, "reports/smart-colors-preview.html")]) {
    assert.equal((await readFile(filePath)).subarray(0, Buffer.byteLength(MARKER)).toString("utf8"), MARKER);
  }
});

test("refuses a report path colliding with the motion output even when motion is disabled", async (t) => {
  const { root } = await createProject(t);
  const config = { ...structuredClone(defaultSmartColorsConfig), motion: { enabled: false, output: REPORT_PATH } };
  await assertRefusal({ root, config, report: reportFixture() }, /config\.motion\.output/);
});
