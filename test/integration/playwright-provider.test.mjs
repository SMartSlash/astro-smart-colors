/**
 * SC-05 tests: the Playwright provider.
 *
 * These tests never require Playwright: `resolve`, `importModule`, `access` and `launch` are all
 * injected, so discovery, import, ESM/CJS normalization, availability and launch are exercised with
 * deterministic fakes. The anchoring tests build a temporary consumer with a fake module inside its
 * own `node_modules`: resolution succeeds there and fails from an unrelated, empty root, which proves
 * the default resolver is rooted in the consumer and never in this package's checkout or a global
 * install. No package is installed and no browser is launched.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PLAYWRIGHT_ENGINES, PLAYWRIGHT_REQUESTS, PROVIDER_PHASES, createPlaywrightProvider, createRootResolver } from "../../src/diagnostics/browser/playwright-provider.mjs";

const FIXTURE_REQUEST = "smart-colors-fixture";
// Injected resolvers never touch this path: it only proves the provider reports the consumer root
// it was given instead of an implicit package or workspace checkout.
const FAKE_ROOT = path.join(path.sep, "fake", "consumer");

// A resolvable CJS package placed only inside `root/node_modules`. It stands in for Playwright so
// the positive resolution path is exercised without installing or importing anything real.
async function installFakeModule(root, request = FIXTURE_REQUEST) {
  const directory = path.join(root, "node_modules", request);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: request, version: "0.0.0", main: "index.js" }));
  await writeFile(path.join(directory, "index.js"), "module.exports = { chromium: {} };\n");
  return path.join(await realpath(directory), "index.js");
}

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
  const otherRoot = await mkdtemp(path.join(tmpdir(), "smart-colors-provider-other-"));
  try {
    // The package checkout may or may not resolve Playwright; this temporary consumer does not. A
    // discovery failure here proves the provider did not fall back to the checkout or a global install.
    const provider = createPlaywrightProvider({ root });
    const opened = await provider.open();
    assert.equal(opened.ok, false);
    assert.equal(opened.phase, "discovery");
    assert.equal(opened.cause, "playwright-not-found");
    assert.ok(opened.message.includes(root), "the reason must name the effective consumer root");
    assert.match(opened.message, /^Playwright not found in consumer /, "the discovery reason is English");
    assert.doesNotMatch(opened.message, /non-blocking/, "the provider must not promise a non-blocking outcome when automation can be required");
    assert.equal(typeof opened.detail, "string", "the original resolution error stays verbatim");
    assert.match(opened.detail, /Cannot find module/);

    const resolve = createRootResolver(root);
    assert.throws(() => resolve("playwright"), (error) => error.code === "MODULE_NOT_FOUND" || /Cannot find/.test(error.message));

    // Positive case, without Playwright: a fixture that exists only inside this consumer resolves,
    // and the resolver returns that absolute path (it is a resolver, not a curried function).
    const expected = await installFakeModule(root);
    const resolved = resolve(FIXTURE_REQUEST);
    assert.equal(typeof resolved, "string", "a root resolver returns a module path");
    assert.equal(resolved, expected);
    assert.ok(path.isAbsolute(resolved));
    assert.ok(resolved.startsWith(`${await realpath(root)}${path.sep}`), "the module must come from the consumer root");

    // Rooted isolation: an unrelated, empty consumer root cannot see the fixture, so no fallback
    // to the first root, to this checkout or to a global installation can be involved.
    assert.throws(
      () => createRootResolver(otherRoot)(FIXTURE_REQUEST),
      (error) => error.code === "MODULE_NOT_FOUND" || /Cannot find/.test(error.message),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  }
});

test("discovery keeps the rooted resolver when the module exists only in the consumer root", async () => {
  const consumer = await mkdtemp(path.join(tmpdir(), "smart-colors-provider-consumer-"));
  const empty = await mkdtemp(path.join(tmpdir(), "smart-colors-provider-empty-"));
  try {
    const expected = await installFakeModule(consumer);
    const imported = [];
    const provider = createPlaywrightProvider({
      root: consumer,
      requests: [FIXTURE_REQUEST],
      importModule: async (url) => {
        imported.push(url);
        return { chromium: fakeBrowserType() };
      },
    });

    const opened = await provider.open();
    assert.equal(opened.ok, true);
    assert.equal(opened.request, FIXTURE_REQUEST);
    assert.equal(opened.resolved, expected);
    assert.equal(imported.length, 1);
    assert.match(imported[0], /^file:\/\//);

    // The same request from an empty root stays a discovery failure: the provider has no fallback.
    const isolated = createPlaywrightProvider({ root: empty, requests: [FIXTURE_REQUEST], importModule: async () => ({ chromium: fakeBrowserType() }) });
    const missing = await isolated.open();
    assert.equal(missing.ok, false);
    assert.equal(missing.phase, "discovery");
    assert.equal(missing.cause, "playwright-not-found");
    assert.ok(missing.message.includes(empty), "the reason names the effective consumer root");
    assert.match(missing.message, /^Playwright not found in consumer /, "the discovery reason is English");
  } finally {
    await rm(consumer, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
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
    root: FAKE_ROOT,
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
    root: FAKE_ROOT,
    resolve: () => "/fake/esm.mjs",
    importModule: async () => ({ chromium: fakeBrowserType(), webkit: fakeBrowserType(), default: {} }),
  });
  const esmOpened = await esm.open();
  assert.equal(esmOpened.ok, true);
  assert.equal(typeof esmOpened.browsers.chromium, "object");

  const cjs = createPlaywrightProvider({
    root: FAKE_ROOT,
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
    root: FAKE_ROOT,
    resolve: () => "/fake/empty.mjs",
    importModule: async () => ({ somethingElse: true }),
  });
  const opened = await provider.open();
  assert.equal(opened.ok, false);
  assert.equal(opened.phase, "import");
  assert.equal(opened.cause, "import-incompatible");
  assert.equal(opened.message, "The resolved Playwright module (playwright) exposes no compatible engine (chromium, firefox, webkit).");
});

test("a throwing import is reported as an import failure, not as not found", async () => {
  const provider = createPlaywrightProvider({
    root: FAKE_ROOT,
    resolve: () => "/fake/broken.mjs",
    importModule: async () => { throw new Error("boom"); },
  });
  const opened = await provider.open();
  assert.equal(opened.ok, false);
  assert.equal(opened.phase, "import");
  assert.equal(opened.cause, "import-failed");
  assert.ok(opened.message.includes("boom"));
  assert.match(opened.message, /^Playwright resolved \(playwright\) but cannot be imported from \/fake\/broken\.mjs: /);
});

test("availability distinguishes a missing binary without downloading anything", async () => {
  const provider = createPlaywrightProvider({
    root: FAKE_ROOT,
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
    root: FAKE_ROOT,
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
    root: FAKE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ chromium: fakeBrowserType() }),
  });
  const available = await provider.availability("webkit");
  assert.equal(available.available, false);
  assert.equal(available.phase, "availability");
  assert.equal(available.cause, "engine-unknown");
  assert.equal(available.message, "webkit: the resolved Playwright module (playwright) does not expose this engine.");
});

test("availability keeps the executable-path cause verbatim in an English message", async () => {
  const provider = createPlaywrightProvider({
    root: FAKE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ chromium: { executablePath: () => { throw new Error("path exploded"); }, launch: async () => ({}) } }),
  });
  const available = await provider.availability("chromium");
  assert.equal(available.available, false);
  assert.equal(available.phase, "availability");
  assert.equal(available.cause, "executable-path-failed");
  assert.equal(available.message, "chromium: cannot determine the binary path (path exploded).");
});

test("launch failures are structured and keep the no-download guarantee", async () => {
  const provider = createPlaywrightProvider({
    root: FAKE_ROOT,
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

test("launch reports an engine missing from the module in English with its phase", async () => {
  const provider = createPlaywrightProvider({
    root: FAKE_ROOT,
    resolve: () => "/fake/pw.mjs",
    importModule: async () => ({ chromium: fakeBrowserType() }),
  });
  await assert.rejects(provider.launch("webkit"), (error) => {
    assert.equal(error.phase, "launch");
    assert.equal(error.message, "webkit: the resolved Playwright module (playwright) does not expose this engine.");
    return true;
  });
});

test("launch returns the browser and forwards the injected timeout", async () => {
  const seen = [];
  const fake = { version: () => "9.9.9", close: async () => {} };
  const provider = createPlaywrightProvider({
    root: FAKE_ROOT,
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
  createPlaywrightProvider({ root: FAKE_ROOT, resolve, importModule: async () => ({}) });
  assert.deepEqual(resolve.calls, []);
});

test("the not-found reason is brief and non-imperative, with no install nag", async () => {
  const provider = createPlaywrightProvider({ root: FAKE_ROOT, resolve: throwingResolve(), importModule: async () => ({}) });
  const opened = await provider.open();
  assert.equal(opened.ok, false);
  assert.equal(opened.phase, "discovery");
  assert.equal(opened.cause, "playwright-not-found");
  assert.ok(opened.message.includes(FAKE_ROOT), "the reason names the effective consumer root");
  assert.doesNotMatch(opened.message, /pnpm exec playwright install/);
});
