/**
 * SC-05 tests: the Playwright provider.
 *
 * These tests never require Playwright: `resolve`, `importModule`, `access` and `launch` are all
 * injected, so discovery, import, ESM/CJS normalization, availability and launch are exercised with
 * deterministic fakes. One assertion uses a temporary root to prove the default resolver is anchored
 * to the consumer and never falls back to this package's checkout (which does have Playwright).
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PLAYWRIGHT_ENGINES, PLAYWRIGHT_REQUESTS, PROVIDER_PHASES, createPlaywrightProvider, createRootResolver } from "../src/playwright-provider.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, "../../..");

function fakeBrowserType(executable = "/fake/chromium") {
  return {
    executablePath: () => executable,
    launch: async () => ({ version: () => "0.0.0-fake", close: async () => {} }),
  };
}

function throwingResolve() {
  const calls = [];
  const resolve = (request) => {
    calls.push(request);
    throw Object.assign(new Error(`Cannot find module '${request}'`), { code: "MODULE_NOT_FOUND" });
  };
  resolve.calls = calls;
  return resolve;
}

test("exposes the supported requests and engines in a stable order", () => {
  assert.deepEqual([...PLAYWRIGHT_REQUESTS], ["playwright", "@playwright/test"]);
  assert.deepEqual([...PLAYWRIGHT_ENGINES], ["chromium", "firefox", "webkit"]);
  assert.deepEqual(PROVIDER_PHASES, { discovery: "discovery", import: "import", availability: "availability", launch: "launch" });
});

test("the default resolver is anchored to the consumer root and never to the checkout", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-provider-"));
  try {
    // The package checkout does resolve Playwright; this temporary consumer does not. A discovery
    // failure here proves the provider did not fall back to the checkout or to a global install.
    const provider = createPlaywrightProvider({ root });
    const opened = await provider.open();
    assert.equal(opened.ok, false);
    assert.equal(opened.phase, "discovery");
    assert.equal(opened.cause, "playwright-not-found");
    assert.ok(opened.message.includes(root), "the reason must name the effective consumer root");

    const resolve = createRootResolver(root);
    assert.throws(() => resolve("playwright"), (error) => error.code === "MODULE_NOT_FOUND" || /Cannot find/.test(error.message));

    // Guarded: only assert the positive case when the workspace really has Playwright installed.
    let workspaceResolves = true;
    try {
      resolve(WORKSPACE_ROOT)("playwright");
    } catch {
      workspaceResolves = false;
    }
    if (workspaceResolves) {
      assert.ok(path.isAbsolute(resolve(WORKSPACE_ROOT)("playwright")));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovery resolves the first available request and imports it once", async () => {
  const calls = [];
  const resolve = (request) => {
    calls.push(request);
    if (request === "playwright") throw Object.assign(new Error("missing"), { code: "MODULE_NOT_FOUND" });
    return "/fake/node_modules/@playwright/test/index.js";
  };
  const imported = [];
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve,
    importModule: async (url) => {
      imported.push(url);
      return { chromium: fakeBrowserType() };
    },
  });

  const opened = await provider.open();
  assert.equal(opened.ok, true);
  assert.equal(opened.request, "@playwright/test");
  assert.equal(opened.resolved, "/fake/node_modules/@playwright/test/index.js");
  assert.deepEqual(calls, ["playwright", "@playwright/test"]);
  assert.equal(imported.length, 1);
  assert.match(imported[0], /^file:\/\//);

  // The result is cached: a second open does not re-resolve or re-import.
  await provider.open();
  assert.deepEqual(calls, ["playwright", "@playwright/test"]);
  assert.equal(imported.length, 1);
});

test("imports both ESM named exports and CJS module.exports", async () => {
  const esm = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/esm.mjs",
    importModule: async () => ({ chromium: fakeBrowserType(), webkit: fakeBrowserType(), default: {} }),
  });
  const esmOpened = await esm.open();
  assert.equal(esmOpened.ok, true);
  assert.equal(typeof esmOpened.browsers.chromium, "object");

  const cjs = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/cjs.cjs",
    importModule: async () => ({ default: { chromium: fakeBrowserType(), firefox: fakeBrowserType() } }),
  });
  const cjsOpened = await cjs.open();
  assert.equal(cjsOpened.ok, true);
  assert.equal(typeof cjsOpened.browsers.chromium, "object");
  assert.equal(typeof cjsOpened.browsers.firefox, "object");
});

test("a module without any supported engine is an import failure", async () => {
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/empty.mjs",
    importModule: async () => ({ somethingElse: true }),
  });
  const opened = await provider.open();
  assert.equal(opened.ok, false);
  assert.equal(opened.phase, "import");
  assert.equal(opened.cause, "import-incompatible");
});

test("a throwing import is reported as an import failure, not as not found", async () => {
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/broken.mjs",
    importModule: async () => { throw new Error("boom"); },
  });
  const opened = await provider.open();
  assert.equal(opened.ok, false);
  assert.equal(opened.phase, "import");
  assert.equal(opened.cause, "import-failed");
  assert.ok(opened.message.includes("boom"));
});

test("availability distinguishes a missing binary without downloading anything", async () => {
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ chromium: fakeBrowserType("/fake/bin/chromium") }),
    access: async () => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); },
  });
  const available = await provider.availability("chromium");
  assert.equal(available.available, false);
  assert.equal(available.phase, "availability");
  assert.equal(available.cause, "binary-missing");
  assert.equal(available.executable, "/fake/bin/chromium");
  assert.ok(available.message.includes("browser binary unavailable"));
  assert.ok(available.message.includes("No automatic download"));
});

test("availability reports the executable when the binary exists", async () => {
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ webkit: fakeBrowserType("/fake/bin/webkit") }),
    access: async () => {},
  });
  const available = await provider.availability("webkit");
  assert.equal(available.available, true);
  assert.equal(available.executable, "/fake/bin/webkit");
});

test("an engine missing from the module is an availability failure", async () => {
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ chromium: fakeBrowserType() }),
  });
  const available = await provider.availability("webkit");
  assert.equal(available.available, false);
  assert.equal(available.phase, "availability");
  assert.equal(available.cause, "engine-unknown");
});

test("launch failures are structured and keep the no-download guarantee", async () => {
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ chromium: fakeBrowserType("/fake/bin/chromium") }),
    access: async () => {},
    launch: async () => { throw new Error("sandbox denied"); },
  });
  await assert.rejects(provider.launch("chromium"), (error) => {
    assert.equal(error.phase, "launch");
    assert.ok(error.message.includes("launch failed"));
    assert.ok(error.message.includes("No automatic download"));
    assert.equal(error.cause.message, "sandbox denied");
    return true;
  });
});

test("launch returns the browser and forwards the injected timeout", async () => {
  const seen = [];
  const fake = { version: () => "9.9.9", close: async () => {} };
  const provider = createPlaywrightProvider({
    root: WORKSPACE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ chromium: fakeBrowserType() }),
    access: async () => {},
    launch: async (name, browserType, options) => {
      seen.push({ name, options: { ...options } });
      return fake;
    },
  });
  const browser = await provider.launch("chromium", { timeout: 4242 });
  assert.equal(browser, fake);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].name, "chromium");
  assert.equal(seen[0].options.headless, true);
  assert.equal(seen[0].options.timeout, 4242);
});

test("discovery does not resolve anything until open is called", async () => {
  const resolve = throwingResolve();
  createPlaywrightProvider({ root: WORKSPACE_ROOT, resolve, importModule: async () => ({}) });
  assert.deepEqual(resolve.calls, []);
});
