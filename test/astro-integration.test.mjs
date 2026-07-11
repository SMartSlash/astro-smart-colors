import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import smartColors from "../src/astro-integration.mjs";

const PALETTE = `:root {
  --palette-bg: oklch(0.962 0.015 88);
  --palette-ink: oklch(0.28 0.007 3.68);
  --palette-primary: oklch(0.62 0.16 32);
  --palette-secondary: oklch(0.54 0.108 198);
  --palette-tertiary: oklch(0.88 0.12 85);
}`;

async function createProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-astro-"));
  const tokenDirectory = path.join(root, "src/styles/tokens");
  await mkdir(tokenDirectory, { recursive: true });
  await writeFile(path.join(tokenDirectory, "palette.css"), PALETTE, "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("Astro watcher debounces add, change and unlink events", async (t) => {
  const root = await createProject(t);
  const rootUrl = pathToFileURL(`${root}${path.sep}`);
  const watchedByAstro = [];
  const logs = { info: [], warn: [], error: [] };
  let vitePlugin;

  const integration = smartColors();
  await integration.hooks["astro:config:setup"]({
    config: { root: rootUrl },
    command: "dev",
    addWatchFile(file) {
      watchedByAstro.push(file);
    },
    updateConfig(config) {
      [vitePlugin] = config.vite.plugins;
    },
    logger: {
      info(message) { logs.info.push(message); },
      warn(message) { logs.warn.push(message); },
      error(message) { logs.error.push(message); },
    },
  });

  assert.equal(watchedByAstro.length, 2);
  assert.ok(vitePlugin);

  const handlers = new Map();
  const websocketMessages = [];
  const server = {
    watcher: {
      add() {},
      on(event, handler) { handlers.set(event, handler); },
    },
    ws: {
      send(message) { websocketMessages.push(message); },
    },
  };
  const cleanup = await vitePlugin.configureServer(server);

  assert.deepEqual([...handlers.keys()], ["add", "change", "unlink"]);

  const palettePath = path.join(root, "src/styles/tokens/palette.css");
  await writeFile(palettePath, PALETTE.replace("0.62 0.16 32", "0.58 0.15 32"), "utf8");

  handlers.get("add")(palettePath);
  handlers.get("change")(palettePath);
  handlers.get("unlink")(palettePath);
  await new Promise((resolve) => setTimeout(resolve, 180));

  const output = await readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8");
  assert.match(output, /--_color-primary-source: oklch\(0\.58 0\.15 32\);/);
  assert.deepEqual(websocketMessages, [{ type: "full-reload" }]);
  assert.equal(logs.error.length, 0);

  cleanup?.();
});
