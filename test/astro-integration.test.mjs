import assert from "node:assert/strict";
import test from "node:test";
import fs, { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { EventEmitter, once } from "node:events";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setImmediate as nextTurn } from "node:timers/promises";
import smartColors from "../src/astro-integration.mjs";

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

async function createProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-astro-"));
  const tokenDirectory = path.join(root, "src/styles/tokens");
  await mkdir(tokenDirectory, { recursive: true });
  await writeFile(path.join(tokenDirectory, "palette.css"), PALETTE, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("package metadata keeps Astro as an optional peer with no runtime dependencies", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.deepEqual(packageJson.peerDependencies, { astro: ">=5" });
  assert.equal(packageJson.peerDependenciesMeta?.astro?.optional, true);
  assert.equal(packageJson.peerDependenciesMeta?.playwright, undefined);
  assert.equal(packageJson.peerDependenciesMeta?.["@playwright/test"], undefined);
  assert.ok(packageJson.files.includes("src"));
});

test("Astro rejects an explicitly selected missing config before writing outputs", async (t) => {
  const root = await createProject(t);
  const integration = smartColors({ configFile: "smart-colors.config.mjs" });
  await assert.rejects(integration.hooks["astro:config:setup"]({
    config: { root: pathToFileURL(`${root}${path.sep}`) },
    command: "build",
    addWatchFile() { assert.fail("Invalid config must fail before registering watchers."); },
    updateConfig() { assert.fail("Invalid config must fail before updating Vite."); },
    logger: { info() {}, warn() {}, error() {} },
  }), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(root, "src/styles/tokens/colors.css")), { code: "ENOENT" });
  assert.equal(await readFile(path.join(root, "src/styles/tokens/palette.css"), "utf8"), PALETTE);
});

const WATCH_EVENTS = ["add", "change", "unlink"];

async function createIntegration(t, { root, options = {}, configure = true } = {}) {
  root ??= await createProject(t);
  const watchedByAstro = [];
  const watchedByVite = [];
  const logs = { info: [], warn: [], error: [] };
  const signals = new EventEmitter();
  const websocketMessages = [];
  const releases = [];
  let vitePlugin;

  await smartColors(options).hooks["astro:config:setup"]({
    config: { root: pathToFileURL(`${root}${path.sep}`) },
    command: "dev",
    addWatchFile(file) { watchedByAstro.push(file); },
    updateConfig(config) { [vitePlugin] = config.vite.plugins; },
    logger: Object.fromEntries(Object.keys(logs).map((level) => [level, (message) => {
      logs[level].push(message);
      signals.emit(`logged-${level}`, message);
    }])),
  });

  assert.equal(watchedByAstro.length, 2);
  assert.ok(vitePlugin);

  const watcher = new EventEmitter();
  watcher.add = (files) => { watchedByVite.push(files); return watcher; };
  const server = {
    watcher,
    ws: {
      send(message) {
        websocketMessages.push(message);
        signals.emit("reload", message);
      },
    },
  };
  const close = () => {
    assert.equal(typeof vitePlugin.closeBundle, "function", "Teardown must use an awaited Vite lifecycle hook.");
    return vitePlugin.closeBundle();
  };
  t.after(async () => {
    for (const release of releases) release();
    await vitePlugin.closeBundle?.();
  });

  if (configure) {
    // Vite invokes this return value after installing middleware, not on close.
    const postConfigure = await vitePlugin.configureServer(server);
    postConfigure?.();
  }

  return {
    root, vitePlugin, server, close, logs, signals, websocketMessages, watchedByVite, releases,
    palettePath: path.join(root, "src/styles/tokens/palette.css"),
    outputPath: path.join(root, "src/styles/tokens/colors.css"),
    configPath: path.join(root, options.configFile ?? "smart-colors.config.mjs"),
  };
}

function mockFsMethod(t, name, implementation) {
  const original = fs[name];
  const mocked = t.mock.method(fs, name, (...args) => implementation(original, ...args));
  syncBuiltinESMExports();
  t.after(() => {
    mocked.mock.restore();
    syncBuiltinESMExports();
  });
}

function filePath(file) {
  return file instanceof URL ? fileURLToPath(file) : path.resolve(file);
}

function countConfigLoads(t, fixture) {
  let loads = 0;
  mockFsMethod(t, "access", (original, file, ...args) => {
    if (filePath(file) === fixture.configPath) loads++;
    return original(file, ...args);
  });
  return () => loads;
}

function captureHandlers(watcher) {
  return WATCH_EVENTS.map((event) => {
    const [handler] = watcher.listeners(event);
    assert.equal(typeof handler, "function");
    return handler;
  });
}

function resolveVite(t) {
  const require = createRequire(import.meta.url);
  const attempts = [
    () => require.resolve("vite"),
    () => createRequire(require.resolve("astro")).resolve("vite"),
  ];

  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      // A standalone clone may have neither Vite nor Astro installed.
    }
  }

  t.skip("Vite is not installed in this standalone environment");
  return null;
}

function emitLateEvents(fixture, handlers) {
  for (const event of WATCH_EVENTS) fixture.server.watcher.emit(event, fixture.palettePath);
  for (const handler of handlers) handler(fixture.palettePath);
}

test("installed Vite runs configureServer post hooks on setup and awaits closeBundle on close", { timeout: 10000 }, async (t) => {
  const vitePath = resolveVite(t);
  if (!vitePath) return;

  const fixture = await createIntegration(t, { configure: false });
  const { root, vitePlugin, palettePath, outputPath, websocketMessages, signals, logs } = fixture;
  await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.58 0.15 32"), "utf8");
  const reloaded = once(signals, "reload");
  const { createServer } = await import(pathToFileURL(vitePath).href);
  let postHookRan = false;
  let server;
  t.after(() => server?.close());

  server = await createServer({
    root,
    configFile: false,
    envFile: false,
    cacheDir: path.join(root, ".vite"),
    logLevel: "silent",
    appType: "custom",
    server: { middlewareMode: true, watch: null, ws: false, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [vitePlugin, {
      name: "smart-colors-lifecycle-probe",
      configureServer(viteServer) {
        assert.equal(viteServer.httpServer, null);
        viteServer.ws.send = fixture.server.ws.send;
        viteServer.watcher.emit("change", palettePath);
        return () => { postHookRan = true; };
      },
    }],
  });

  assert.equal(postHookRan, true);
  await reloaded;
  assert.match(await readFile(outputPath, "utf8"), /--_color-primary-source: oklch\(0\.58 0\.15 32\);/);
  assert.deepEqual(websocketMessages, [{ type: "full-reload" }]);
  assert.equal(logs.info.at(-1), "Regenerated Smart Colors outputs.");
  assert.equal(logs.error.length, 0);

  // With no HTTP server, only Vite's plugin lifecycle can perform teardown.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const loads = countConfigLoads(t, fixture);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  fixture.releases.push(release.resolve);
  mockFsMethod(t, "rename", async (original, from, to) => {
    if (filePath(to) === outputPath) {
      started.resolve();
      await release.promise;
    }
    return original(from, to);
  });
  await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.56 0.14 32"), "utf8");
  server.watcher.emit("change", palettePath);
  t.mock.timers.tick(50);
  await started.promise;
  let closed = false;
  const closing = server.close().then(() => { closed = true; });
  await nextTurn();
  assert.equal(closed, false, "Vite server.close() must await the pending generator.");
  release.resolve();
  await closing;
  const output = await readFile(outputPath, "utf8");
  assert.match(output, /--_color-primary-source: oklch\(0\.56 0\.14 32\);/);
  server.watcher.emit("change", palettePath);
  t.mock.timers.tick(200);
  await nextTurn();
  assert.equal(loads(), 1);
  assert.equal(await readFile(outputPath, "utf8"), output);
  assert.equal(websocketMessages.length, 1);
});

test("Astro watcher debounces nearby add, change and unlink events and ignores outputs", { timeout: 5000 }, async (t) => {
  const fixture = await createIntegration(t);
  const { server, palettePath, outputPath, signals, websocketMessages, logs } = fixture;
  assert.deepEqual(server.watcher.eventNames(), WATCH_EVENTS);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const loads = countConfigLoads(t, fixture);

  await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.58 0.15 32"), "utf8");
  server.watcher.emit("add", palettePath);
  t.mock.timers.tick(20);
  server.watcher.emit("change", palettePath);
  t.mock.timers.tick(20);
  await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.56 0.14 32"), "utf8");
  server.watcher.emit("unlink", palettePath);
  t.mock.timers.tick(49);
  assert.equal(loads(), 0);

  const reloaded = once(signals, "reload");
  t.mock.timers.tick(1);
  await reloaded;
  assert.match(await readFile(outputPath, "utf8"), /--_color-primary-source: oklch\(0\.56 0\.14 32\);/);
  assert.deepEqual(websocketMessages, [{ type: "full-reload" }]);
  assert.equal(logs.error.length, 0);
  assert.equal(loads(), 1);

  for (const event of WATCH_EVENTS) server.watcher.emit(event, outputPath);
  t.mock.timers.tick(200);
  await nextTurn();
  assert.equal(loads(), 1);
  assert.equal(websocketMessages.length, 1);
});

test("close before 50 ms cancels debounce, removes only owned listeners and ignores late callbacks", { timeout: 5000 }, async (t) => {
  const fixture = await createIntegration(t);
  const { server, palettePath, outputPath, websocketMessages } = fixture;
  const handlers = captureHandlers(server.watcher);
  const unrelatedHandler = () => {};
  for (const event of WATCH_EVENTS) server.watcher.on(event, unrelatedHandler);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const loads = countConfigLoads(t, fixture);
  const output = await readFile(outputPath, "utf8");
  await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.58 0.15 32"), "utf8");
  server.watcher.emit("change", palettePath);
  t.mock.timers.tick(49);
  await fixture.close();

  for (const event of WATCH_EVENTS) assert.deepEqual(server.watcher.listeners(event), [unrelatedHandler]);
  emitLateEvents(fixture, handlers);
  t.mock.timers.tick(200);
  await nextTurn();
  await fixture.close();
  assert.equal(loads(), 0);
  assert.equal(await readFile(outputPath, "utf8"), output);
  assert.deepEqual(websocketMessages, []);
});

for (const rejects of [false, true]) {
  test(`close drains a ${rejects ? "rejected" : "pending"} config load and skips queued regenerations`, { timeout: 5000 }, async (t) => {
    const fixture = await createIntegration(t);
    const { server, palettePath, configPath, outputPath, websocketMessages, logs } = fixture;
    const handlers = captureHandlers(server.watcher);
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    fixture.releases.push(release.resolve);
    let loads = 0;
    mockFsMethod(t, "access", async (original, file, ...args) => {
      if (filePath(file) === configPath) {
        loads++;
        started.resolve();
        await release.promise;
        if (rejects) throw new Error("Config load rejected during close.");
      }
      return original(file, ...args);
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const output = await readFile(outputPath, "utf8");
    await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.58 0.15 32"), "utf8");
    server.watcher.emit("change", palettePath);
    t.mock.timers.tick(50);
    await started.promise;
    server.watcher.emit("add", palettePath);
    t.mock.timers.tick(50);
    server.watcher.emit("unlink", palettePath);
    t.mock.timers.tick(49);

    let closed = false;
    const closing = fixture.close().then(() => { closed = true; });
    await nextTurn();
    assert.equal(closed, false, "Close must await the in-flight config load.");
    for (const event of WATCH_EVENTS) assert.equal(server.watcher.listenerCount(event), 0);
    emitLateEvents(fixture, handlers);
    t.mock.timers.tick(200);
    release.resolve();
    await closing;
    emitLateEvents(fixture, handlers);
    t.mock.timers.tick(200);
    await nextTurn();

    assert.equal(loads, 1);
    assert.equal(fixture.watchedByVite.length, 1, "Disposed config loads must not re-register watches.");
    assert.equal(await readFile(outputPath, "utf8"), output);
    assert.deepEqual(websocketMessages, []);
    assert.deepEqual(logs.error, []);
  });
}

test("close awaits in-flight output writes, skips the queue and suppresses reloads", { timeout: 5000 }, async (t) => {
  const fixture = await createIntegration(t, { options: { motion: { enabled: true } } });
  const { server, root, palettePath, outputPath, websocketMessages } = fixture;
  const outputPaths = [outputPath, path.join(root, "src/styles/colors-motion.css")];
  await writeFile(outputPaths[1], "/* stale motion output */", "utf8");
  const handlers = captureHandlers(server.watcher);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  fixture.releases.push(release.resolve);
  const commits = [];
  mockFsMethod(t, "rename", async (original, from, to) => {
    if (!outputPaths.includes(filePath(to))) return original(from, to);
    started.resolve();
    await release.promise;
    await original(from, to);
    commits.push(filePath(to));
  });
  const loads = countConfigLoads(t, fixture);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.58 0.15 32"), "utf8");
  server.watcher.emit("change", palettePath);
  t.mock.timers.tick(50);
  await started.promise;
  server.watcher.emit("change", palettePath);
  t.mock.timers.tick(50);
  server.watcher.emit("add", palettePath);

  let closed = false;
  const closing = fixture.close().then(() => { closed = true; });
  await nextTurn();
  assert.equal(closed, false, "Close must await all generator output writes.");
  assert.deepEqual(commits, []);
  emitLateEvents(fixture, handlers);
  t.mock.timers.tick(200);
  release.resolve();
  await closing;
  assert.deepEqual([...commits].sort(), [...outputPaths].sort());
  assert.equal(loads(), 1);
  assert.deepEqual(websocketMessages, []);

  const outputs = await Promise.all(outputPaths.map((file) => readFile(file, "utf8")));
  assert.match(outputs[0], /--_color-primary-source: oklch\(0\.58 0\.15 32\);/);
  emitLateEvents(fixture, handlers);
  t.mock.timers.tick(200);
  await nextTurn();
  assert.equal(commits.length, 2);
  assert.equal(loads(), 1);
  assert.deepEqual(await Promise.all(outputPaths.map((file) => readFile(file, "utf8"))), outputs);
  assert.deepEqual(websocketMessages, []);
});

test("configureServer preserves explicit missing-config rejection without registering listeners", { timeout: 5000 }, async (t) => {
  const root = await createProject(t);
  const configPath = path.join(root, "smart-colors.config.mjs");
  await writeFile(configPath, "export default {};", "utf8");
  const fixture = await createIntegration(t, { root, options: { configFile: "smart-colors.config.mjs" }, configure: false });
  const output = await readFile(fixture.outputPath, "utf8");
  await rm(configPath);
  await assert.rejects(fixture.vitePlugin.configureServer(fixture.server), { code: "ENOENT" });
  assert.deepEqual(fixture.server.watcher.eventNames(), []);
  assert.deepEqual(fixture.watchedByVite, []);
  await fixture.close();
  assert.equal(await readFile(fixture.outputPath, "utf8"), output);
});

for (const failure of ["missing", "evaluation"]) {
  test(`watcher logs ${failure} config rejection once and recovers on the next event`, { timeout: 5000 }, async (t) => {
    const root = await createProject(t);
    const configPath = path.join(root, "smart-colors.config.mjs");
    await writeFile(configPath, "export default {};", "utf8");
    const fixture = await createIntegration(t, { root, options: { configFile: "smart-colors.config.mjs" } });
    const { server, palettePath, outputPath, signals, logs, websocketMessages } = fixture;
    // Keep edited config imports distinct from setup, even within the same millisecond.
    let importTimestamp = Date.now();
    t.mock.method(Date, "now", () => ++importTimestamp);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const output = await readFile(outputPath, "utf8");
    await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.58 0.15 32"), "utf8");
    if (failure === "missing") await rm(configPath);
    else await writeFile(configPath, 'throw new Error("Config evaluation rejected.");', "utf8");
    const failed = once(signals, "logged-error");
    server.watcher.emit("unlink", configPath);
    t.mock.timers.tick(50);
    await failed;
    assert.equal(logs.error.length, 1);
    assert.match(logs.error[0], failure === "missing" ? /ENOENT/ : /Config evaluation rejected\./);
    assert.equal(await readFile(outputPath, "utf8"), output);
    assert.deepEqual(websocketMessages, []);

    await writeFile(configPath, "export default {}; // recovered", "utf8");
    const reloaded = once(signals, "reload");
    server.watcher.emit("add", configPath);
    t.mock.timers.tick(50);
    await reloaded;
    assert.match(await readFile(outputPath, "utf8"), /--_color-primary-source: oklch\(0\.58 0\.15 32\);/);
    assert.equal(logs.error.length, 1);
    assert.deepEqual(websocketMessages, [{ type: "full-reload" }]);
    await fixture.close();
  });
}

test("Astro setup preserves thrown callback errors", { timeout: 5000 }, async (t) => {
  for (const callback of ["addWatchFile", "updateConfig"]) {
    const root = await createProject(t);
    const failure = new Error(`${callback} failed`);
    await assert.rejects(smartColors().hooks["astro:config:setup"]({
      config: { root: pathToFileURL(`${root}${path.sep}`) },
      command: "dev",
      addWatchFile() {},
      updateConfig() {},
      logger: { info() {}, warn() {}, error() {} },
      [callback]() { throw failure; },
    }), (error) => error === failure);
  }
});
