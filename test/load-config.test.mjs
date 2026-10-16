import assert from "node:assert/strict";
import test from "node:test";
import fsPromises, { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { DEFAULT_CONFIG_FILE, loadSmartColorsConfig } from "../src/load-config.mjs";

async function createProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("missing implicit default config is optional, including configFile undefined from callers", async (t) => {
  const root = await createProject(t);
  for (const options of [{ root }, { root, configFile: undefined }]) {
    const config = await loadSmartColorsConfig({ ...options, inlineConfig: { contrast: { text: 5 } } });
    assert.equal(config.output, defaultSmartColorsConfig.output);
    assert.equal(config.contrast.text, 5);
    assert.equal(config.contrast.ui, defaultSmartColorsConfig.contrast.ui);
  }
});

test("an explicitly selected missing config rejects, even when it names the default path", async (t) => {
  const root = await createProject(t);
  for (const configFile of ["missing.config.mjs", DEFAULT_CONFIG_FILE]) {
    await assert.rejects(loadSmartColorsConfig({ root, configFile }), (error) => {
      assert.equal(error.code, "ENOENT");
      assert.equal(error.path, path.join(root, configFile));
      return true;
    });
  }
});

test("existing implicit and explicit configs merge defaults, file settings and inline settings", async (t) => {
  const root = await createProject(t);
  await writeFile(path.join(root, DEFAULT_CONFIG_FILE), `export default {
    output: "generated/colors.css",
    contrast: { text: 5 },
    roles: { identities: { primary: "--palette-primary" } },
    aliases: { old: "primary" }
  };`, "utf8");

  for (const options of [{ root }, { root, configFile: DEFAULT_CONFIG_FILE }]) {
    const config = await loadSmartColorsConfig({
      ...options,
      inlineConfig: { contrast: { text: 6 }, aliases: { brand: "primary" } },
    });
    assert.equal(config.output, "generated/colors.css");
    assert.equal(config.contrast.text, 6);
    assert.equal(config.contrast.ui, defaultSmartColorsConfig.contrast.ui);
    assert.deepEqual(config.roles.identities.primary, { role: "ui", token: "--palette-primary" });
    assert.deepEqual(config.aliases, { brand: "primary" });
  }
});

test("named config exports remain supported", async (t) => {
  const root = await createProject(t);
  await writeFile(path.join(root, "named.config.mjs"), 'export const config = { output: "named/colors.css" };', "utf8");
  const config = await loadSmartColorsConfig({ root, configFile: "named.config.mjs" });
  assert.equal(config.output, "named/colors.css");
});

test("config evaluation errors and missing module dependencies are not treated as optional files", async (t) => {
  const root = await createProject(t);
  await writeFile(path.join(root, DEFAULT_CONFIG_FILE), 'throw new Error("config evaluation failed");', "utf8");
  await assert.rejects(loadSmartColorsConfig({ root }), /config evaluation failed/);
  await writeFile(path.join(root, "dependency.config.mjs"), 'import "./missing-dependency.mjs";', "utf8");
  await assert.rejects(loadSmartColorsConfig({ root, configFile: "dependency.config.mjs" }), { code: "ERR_MODULE_NOT_FOUND" });
});

test("an existing config directory propagates its import error", async (t) => {
  const root = await createProject(t);
  await mkdir(path.join(root, DEFAULT_CONFIG_FILE));
  await assert.rejects(loadSmartColorsConfig({ root }), { code: "ERR_UNSUPPORTED_DIR_IMPORT" });
});

test("permission and other I/O access errors propagate unchanged for implicit and explicit configs", async (t) => {
  const root = await createProject(t);
  const accessMock = t.mock.method(fsPromises, "access");
  syncBuiltinESMExports();
  t.after(() => {
    accessMock.mock.restore();
    syncBuiltinESMExports();
  });

  // Mock access rather than chmod: root users can bypass filesystem permissions.
  for (const code of ["EACCES", "EPERM", "EIO", "ENOTDIR"]) {
    const failure = Object.assign(new Error(`${code}: config access failed`), { code });
    accessMock.mock.mockImplementation(async () => { throw failure; });
    for (const options of [{ root }, { root, configFile: "explicit.config.mjs" }]) {
      await assert.rejects(loadSmartColorsConfig(options), (error) => error === failure);
    }
  }
  assert.equal(accessMock.mock.callCount(), 8);
});
