/**
 * Contract tests for scripts/run-tests.mjs.
 *
 * They spawn the runner with `--list` only: flag validation and site preflight policy are exercised
 * without executing the suite and without launching a browser. Every case asserts an explicit exit
 * code, so a rejected flag can never be mistaken for a green run with skipped proofs.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNNER = path.join(PACKAGE_ROOT, "scripts", "run-tests.mjs");
const ROOTS_HELPER = path.join(PACKAGE_ROOT, "test", "helpers", "roots.mjs");

function cleanEnv(overrides = {}) {
  const env = { ...process.env };
  for (const key of ["SMART_COLORS_NATIVE_PROOF", "SMART_COLORS_BROWSERS", "SMART_COLORS_PLAYWRIGHT_ROOT", "SMART_COLORS_SITE_ROOT", "NODE_TEST_CONTEXT"]) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

function run(args, overrides = {}) {
  return runIn(PACKAGE_ROOT, RUNNER, args, overrides);
}

function runIn(cwd, runner, args, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runner, ...args], {
      cwd,
      env: cleanEnv(overrides),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function emptySiteRoot(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-empty-site-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("the default list is the flat package groups and excludes site", async () => {
  const result = await run(["--list"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /unit \+ integration \+ browser/);
  assert.match(result.stdout, /test\/unit\//);
  assert.match(result.stdout, /test\/browser\//);
  assert.doesNotMatch(result.stdout, /test\/site\//);
});

test("--list validates --native without an explicit engine", async () => {
  const result = await run(["--list", "--native"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /--native requires an explicit --browser/);
  assert.doesNotMatch(result.stdout, /\.test\.mjs/);
});

test("--list rejects --native when the selected groups contain no native proof", async () => {
  const result = await run(["--list", "unit", "--native", "--browser=chromium"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /browser or site group/);
  assert.doesNotMatch(result.stdout, /\.test\.mjs/);
});

test("--list rejects --browser without --native or the site group", async () => {
  const result = await run(["--list", "unit", "--browser=chromium"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /only meaningful with --native or the site group/);
  assert.doesNotMatch(result.stdout, /\.test\.mjs/);
});

test("an explicit empty browser selection is rejected instead of falling back", async () => {
  for (const value of ["", ",,,", " , "]) {
    const result = await run(["--list", `--browser=${value}`]);
    assert.equal(result.code, 2, `--browser=${JSON.stringify(value)} must fail`);
    assert.match(result.stderr, /empty selection/);
    assert.doesNotMatch(result.stdout, /\.test\.mjs/);
  }
});

test("a Firefox-only native selection is rejected instead of a green skip-only run", async () => {
  const result = await run(["--list", "browser", "--native", "--browser=firefox"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /no implemented native proof/);
  assert.match(result.stderr, /Firefox support in the product is unchanged/);
  assert.doesNotMatch(result.stdout, /\.test\.mjs/);
});

test("the non-list Firefox command is rejected before spawning any suite", async () => {
  const result = await run(["browser", "--native", "--browser=firefox"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /no implemented native proof/);
  assert.doesNotMatch(result.stdout, /\.test\.mjs/);
});

test("--list site works without an explicit browser or a site root", async (t) => {
  const siteRoot = await emptySiteRoot(t);
  const result = await run(["--list", "site"], { SMART_COLORS_SITE_ROOT: siteRoot });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /test\/site\/contrast-workbench-root-inputs\.test\.mjs/);
  assert.match(result.stdout, /no site filesystem preflight/);
  assert.doesNotMatch(result.stderr, /site root unavailable/);
});

test("--list site with chromium also skips the site preflight", async (t) => {
  const siteRoot = await emptySiteRoot(t);
  const result = await run(["--list", "site", "--browser=chromium"], { SMART_COLORS_SITE_ROOT: siteRoot });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /test\/site\/contrast-workbench-root-inputs\.test\.mjs/);
});

test("--list site with Firefox is rejected before any coverage is invented", async (t) => {
  const siteRoot = await emptySiteRoot(t);
  const result = await run(["--list", "site", "--browser=firefox"], { SMART_COLORS_SITE_ROOT: siteRoot });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /no implemented native proof/);
  assert.doesNotMatch(result.stdout, /\.test\.mjs/);
});

test("--list site without chromium is rejected instead of listing unexecutable coverage", async (t) => {
  const siteRoot = await emptySiteRoot(t);
  const result = await run(["--list", "site", "--browser=webkit"], { SMART_COLORS_SITE_ROOT: siteRoot });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /site proofs require chromium/);
  assert.doesNotMatch(result.stdout, /\.test\.mjs/);
});

test("legacy SMART_COLORS_NATIVE_PROOF=1 remains a compatible list opt-in", async () => {
  const result = await run(["--list"], { SMART_COLORS_NATIVE_PROOF: "1" });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Legacy SMART_COLORS_NATIVE_PROOF=1: browser selection defaults to chromium,webkit/);
  assert.match(result.stdout, /test\/browser\//);
});

function serialSpec(label) {
  return `import assert from "node:assert/strict";
import { appendFile, open, unlink } from "node:fs/promises";
import test from "node:test";

test("${label} owns the shared lock", async () => {
  const lock = process.env.SMART_COLORS_TEST_LOCK;
  const log = process.env.SMART_COLORS_TEST_LOG;
  assert.ok(lock && log, "the fixture needs lock and log paths");
  let handle = null;
  try {
    handle = await open(lock, "wx");
    await appendFile(log, "${label}\\n");
    await new Promise((resolve) => setTimeout(resolve, 60));
  } finally {
    if (handle) {
      await handle.close();
      await unlink(lock).catch(() => {});
    }
  }
});
`;
}

test("native runs are serial even with two browser-group files", async (t) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "smart-colors-runner-serial-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(path.join(fixture, "scripts"), { recursive: true });
  await mkdir(path.join(fixture, "test", "helpers"), { recursive: true });
  await mkdir(path.join(fixture, "test", "browser"), { recursive: true });
  await cp(RUNNER, path.join(fixture, "scripts", "run-tests.mjs"));
  await cp(ROOTS_HELPER, path.join(fixture, "test", "helpers", "roots.mjs"));
  await writeFile(path.join(fixture, "test", "browser", "01-first.test.mjs"), serialSpec("01"), "utf8");
  await writeFile(path.join(fixture, "test", "browser", "02-second.test.mjs"), serialSpec("02"), "utf8");

  const lock = path.join(fixture, "serial.lock");
  const log = path.join(fixture, "serial.log");
  const result = await runIn(fixture, path.join(fixture, "scripts", "run-tests.mjs"), ["browser", "--native", "--browser=chromium"], {
    SMART_COLORS_TEST_LOCK: lock,
    SMART_COLORS_TEST_LOG: log,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /2 file\(s\) in browser/);
  assert.match(result.stdout, /Native proofs: on; browsers: chromium/);
  assert.match(result.stdout, /Execution: serial native proofs \(--test-concurrency=1\)/);
  assert.equal(await readFile(log, "utf8"), "01\n02\n", "the second file must not overlap the first");
});
