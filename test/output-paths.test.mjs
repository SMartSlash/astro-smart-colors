import assert from "node:assert/strict";
import test from "node:test";
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { defaultSmartColorsConfig } from "../src/defaults.mjs";
import { generateColorTokens } from "../src/generate-colors.mjs";
import { DEFAULT_CONFIG_FILE } from "../src/load-config.mjs";
import { validateOutputPaths } from "../src/output-paths.mjs";

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
`;

async function createProject(t) {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-paths-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "config"));
  await writeFile(path.join(root, "palette.css"), PALETTE);
  await writeFile(path.join(root, DEFAULT_CONFIG_FILE), "// Project config\nexport default {};\n");
  await writeFile(path.join(root, "config/custom.mjs"), "// Explicit config\nexport default {};\n");
  const config = {
    ...structuredClone(defaultSmartColorsConfig),
    palette: "palette.css",
    output: "generated/colors.css",
  };
  return { root, config };
}

async function sourceBytes(root) {
  return Promise.all(["palette.css", DEFAULT_CONFIG_FILE, "config/custom.mjs"].map(
    (file) => readFile(path.join(root, file)),
  ));
}

async function assertCollision(options, labels) {
  await assert.rejects(() => validateOutputPaths(options), (error) => {
    assert.match(error.message, /Smart Colors output path collision/);
    for (const label of labels) assert.ok(error.message.includes(label), error.message);
    assert.match(error.message, /both resolve to/);
    return true;
  });
}

async function createSymlink(t, target, link, type) {
  try {
    await symlink(target, link, type);
    return true;
  } catch (error) {
    if (!["EPERM", "EACCES", "ENOSYS", "ENOTSUP"].includes(error.code)) throw error;
    t.skip(`Symlinks unavailable: ${error.code}`);
    return false;
  }
}

const COLLISIONS = [
  { name: "colors overwrite palette", output: "palette.css", labels: ["config.output", "config.palette"] },
  { name: "colors overwrite normalized palette", output: "./nested/../palette.css", labels: ["config.output", "config.palette"] },
  { name: "inline config still protects default project config", output: DEFAULT_CONFIG_FILE, labels: ["config.output", "configFile"] },
  { name: "colors overwrite normalized default config", output: `./config/../${DEFAULT_CONFIG_FILE}`, labels: ["config.output", "configFile"] },
  { name: "colors overwrite explicit config", output: "config/custom.mjs", configFile: "./config/../config/custom.mjs", labels: ["config.output", "configFile"] },
  { name: "motion overwrites palette", motion: { enabled: true, output: "palette.css" }, labels: ["config.motion.output", "config.palette"] },
  { name: "motion overwrites default config", motion: { enabled: true, output: DEFAULT_CONFIG_FILE }, labels: ["config.motion.output", "configFile"] },
  { name: "motion overwrites explicit config", configFile: "config/custom.mjs", motion: { enabled: true, output: "./config/custom.mjs" }, labels: ["config.motion.output", "configFile"] },
  { name: "new outputs collide", motion: { enabled: true, output: "generated/colors.css" }, labels: ["config.motion.output", "config.output"] },
  { name: "normalized new outputs collide", output: "generated/theme/colors.css", motion: { enabled: true, output: "./generated/theme/../theme/colors.css" }, labels: ["config.motion.output", "config.output"] },
];

for (const fixture of COLLISIONS) {
  test(fixture.name, async (t) => {
    const { root, config } = await createProject(t);
    if (fixture.output) config.output = fixture.output;
    if (fixture.motion) config.motion = fixture.motion;
    const before = await sourceBytes(root);
    await assertCollision({ root, config, configFile: fixture.configFile }, fixture.labels);
    assert.deepEqual(await sourceBytes(root), before);
    await assert.rejects(access(path.join(root, "generated")), { code: "ENOENT" });
  });
}

test("distinct new outputs pass without creating directories", async (t) => {
  const { root, config } = await createProject(t);
  config.motion = { enabled: true, output: "generated/motion/colors.css" };
  const before = await sourceBytes(root);
  assert.equal(await validateOutputPaths({ root, config }), undefined);
  assert.deepEqual(await sourceBytes(root), before);
  await assert.rejects(access(path.join(root, "generated")), { code: "ENOENT" });
});

test("distinct existing outputs pass without changing their bytes", async (t) => {
  const { root, config } = await createProject(t);
  config.output = "colors.css";
  config.motion = { enabled: true, output: "motion.css" };
  await writeFile(path.join(root, config.output), "colors sentinel\n");
  await writeFile(path.join(root, config.motion.output), "motion sentinel\n");
  const files = [config.output, config.motion.output];
  const before = await Promise.all(files.map((file) => readFile(path.join(root, file))));
  await validateOutputPaths({ root, config });
  assert.deepEqual(await Promise.all(files.map((file) => readFile(path.join(root, file)))), before);
});

test("disabled motion ignores collisions and invalid motion paths", async (t) => {
  const { root, config } = await createProject(t);
  for (const output of [config.palette, DEFAULT_CONFIG_FILE, config.output, "https://example.invalid/motion.css", undefined]) {
    config.motion = { enabled: false, output };
    await validateOutputPaths({ root, config });
  }
  delete config.motion;
  await validateOutputPaths({ root, config });
});

test("missing default project config is still protected", async (t) => {
  const { root, config } = await createProject(t);
  await rm(path.join(root, DEFAULT_CONFIG_FILE));
  config.output = DEFAULT_CONFIG_FILE;
  await assertCollision({ root, config }, ["config.output", "configFile"]);
  await assert.rejects(access(path.join(root, DEFAULT_CONFIG_FILE)), { code: "ENOENT" });
});

test("missing explicit config with missing parents is still protected", async (t) => {
  const { root, config } = await createProject(t);
  config.output = "new/config/custom.mjs";
  await assertCollision({ root, config, configFile: "./new/config/custom.mjs" }, ["config.output", "configFile"]);
  await assert.rejects(access(path.join(root, "new")), { code: "ENOENT" });
});

test("file URL paths and URL roots preserve the resolver contract", async (t) => {
  const { root, config } = await createProject(t);
  const rootUrl = pathToFileURL(`${root}${path.sep}`);
  config.output = pathToFileURL(path.join(root, config.palette));
  await assertCollision({ root: rootUrl, config }, ["config.output", "config.palette"]);
  config.output = "generated/colors.css";
  config.motion = { enabled: true, output: pathToFileURL(path.join(root, config.output)).href };
  await assertCollision({ root: rootUrl, config }, ["config.motion.output", "config.output"]);
  config.motion.enabled = false;
  config.output = pathToFileURL(path.join(root, "config/custom.mjs")).href;
  await assertCollision({ root: rootUrl, config, configFile: pathToFileURL(path.join(root, "config/custom.mjs")) }, ["config.output", "configFile"]);
});

test("paths outside project root remain allowed and checked", async (t) => {
  const { root, config } = await createProject(t);
  const projectRoot = path.join(root, "project");
  await mkdir(projectRoot);
  config.palette = "../palette.css";
  config.output = "../generated/colors.css";
  config.motion = { enabled: true, output: "../generated/motion.css" };
  await validateOutputPaths({ root: projectRoot, config, configFile: `../${DEFAULT_CONFIG_FILE}` });
  config.output = "../palette.css";
  await assertCollision({ root: projectRoot, config }, ["config.output", "config.palette"]);
});

test("symlink directories expose collisions with protected sources", async (t) => {
  const { root, config } = await createProject(t);
  const alias = path.join(root, "alias");
  if (!await createSymlink(t, root, alias, process.platform === "win32" ? "junction" : "dir")) return;
  const before = await sourceBytes(root);
  for (const output of ["alias/palette.css", `alias/${DEFAULT_CONFIG_FILE}`, "alias/config/custom.mjs"]) {
    config.output = output;
    await assertCollision({ root, config, configFile: "config/custom.mjs" === output.slice(6) ? "config/custom.mjs" : undefined }, ["config.output"]);
  }
  config.output = "generated/colors.css";
  config.palette = "alias/palette.css";
  config.motion = { enabled: true, output: "palette.css" };
  await assertCollision({ root, config }, ["config.motion.output", "config.palette"]);
  assert.deepEqual(await sourceBytes(root), before);
});

test("symlink parent canonicalization detects identical new outputs", async (t) => {
  const { root, config } = await createProject(t);
  await mkdir(path.join(root, "real"));
  if (!await createSymlink(t, path.join(root, "real"), path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir")) return;
  config.output = "real/new/theme/colors.css";
  config.motion = { enabled: true, output: "alias/new/theme/colors.css" };
  await assertCollision({ root, config }, ["config.motion.output", "config.output"]);
  config.motion.output = "alias/new/theme/motion.css";
  await validateOutputPaths({ root, config });
  assert.deepEqual(await readdir(path.join(root, "real")), []);
});

test("existing file symlinks are checked on output and source sides", async (t) => {
  const { root, config } = await createProject(t);
  if (!await createSymlink(t, "palette.css", path.join(root, "palette-link.css"), "file")) return;
  if (!await createSymlink(t, DEFAULT_CONFIG_FILE, path.join(root, "config-link.mjs"), "file")) return;
  const before = await sourceBytes(root);
  config.output = "palette-link.css";
  await assertCollision({ root, config }, ["config.output", "config.palette"]);
  config.output = "palette.css";
  config.palette = "palette-link.css";
  await assertCollision({ root, config }, ["config.output", "config.palette"]);
  config.output = "config-link.mjs";
  await assertCollision({ root, config }, ["config.output", "configFile"]);
  config.output = DEFAULT_CONFIG_FILE;
  await assertCollision({ root, config, configFile: "config-link.mjs" }, ["config.output", "configFile"]);
  assert.deepEqual(await sourceBytes(root), before);
});

test("existing output files aliased by symlink collide", async (t) => {
  const { root, config } = await createProject(t);
  config.output = "colors.css";
  await writeFile(path.join(root, config.output), "existing output\n");
  if (!await createSymlink(t, "colors.css", path.join(root, "motion.css"), "file")) return;
  config.motion = { enabled: true, output: "motion.css" };
  const before = await readFile(path.join(root, config.output));
  await assertCollision({ root, config }, ["config.motion.output", "config.output"]);
  assert.deepEqual(await readFile(path.join(root, config.output)), before);
});

test("dangling file symlinks alias new output paths", async (t) => {
  const { root, config } = await createProject(t);
  if (!await createSymlink(t, "generated/colors.css", path.join(root, "motion.css"), "file")) return;
  config.motion = { enabled: true, output: "motion.css" };
  await assertCollision({ root, config }, ["config.motion.output", "config.output"]);
  config.output = "generated/distinct.css";
  await validateOutputPaths({ root, config });
  await assert.rejects(access(path.join(root, "generated")), { code: "ENOENT" });
});

test("dangling directory symlinks alias new output parents", async (t) => {
  const { root, config } = await createProject(t);
  if (!await createSymlink(t, path.join(root, "generated"), path.join(root, "alias"), "dir")) return;
  config.motion = { enabled: true, output: "alias/colors.css" };
  await assertCollision({ root, config }, ["config.motion.output", "config.output"]);
});

test("unresolvable filesystem paths fail descriptively without writes", async (t) => {
  const { root, config } = await createProject(t);
  const before = await sourceBytes(root);
  config.output = "palette.css/child.css";
  await assert.rejects(() => validateOutputPaths({ root, config }), (error) => {
    assert.match(error.message, /cannot resolve config\.output/);
    assert.equal(error.cause.code, "ENOTDIR");
    return true;
  });
  config.output = "https://example.invalid/colors.css";
  await assert.rejects(() => validateOutputPaths({ root, config }), /cannot resolve config\.output/);
  assert.deepEqual(await sourceBytes(root), before);
});

test("cyclic symlinks reject instead of silently falling back to lexical paths", async (t) => {
  const { root, config } = await createProject(t);
  if (!await createSymlink(t, "cycle.css", path.join(root, "cycle.css"), "file")) return;
  config.output = "cycle.css";
  await assert.rejects(() => validateOutputPaths({ root, config }), /cannot resolve config\.output/);
});

async function fixtureIsCaseSensitive(root) {
  // The fixture has palette.css but never creates PALETTE.css: no platform guess.
  try {
    await lstat(path.join(root, "PALETTE.css"));
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return true;
  }
}

async function projectSnapshot(root) {
  const entries = (await readdir(root, { recursive: true })).sort();
  return Promise.all(entries.map(async (entry) => {
    const filePath = path.join(root, entry);
    const info = await lstat(filePath);
    if (info.isSymbolicLink()) return [entry, { symlink: await readlink(filePath) }];
    if (info.isFile()) return [entry, { bytes: await readFile(filePath) }];
    return [entry, { directory: true }];
  }));
}

async function assertCaseCollisionWithoutWrites(root, config, reason) {
  const before = await projectSnapshot(root);
  await assert.rejects(() => validateOutputPaths({ root, config }), reason);
  assert.deepEqual(await projectSnapshot(root), before);
  for (const check of [false, true]) {
    await assert.rejects(() => generateColorTokens({ root, config, check }), reason);
    assert.deepEqual(await projectSnapshot(root), before);
  }
}

test("case-insensitive filesystem rejects future outputs differing only by case without writes", async (t) => {
  const { root, config } = await createProject(t);
  if (await fixtureIsCaseSensitive(root)) {
    t.skip("Fixture filesystem is case-sensitive");
    return;
  }
  for (const [output, motionOutput] of [
    ["READONLY-PROBE-COLORS.css", "readonly-probe-colors.css"],
    ["Generated/Theme/READONLY-PROBE-COLORS.css", "generated/theme/readonly-probe-colors.css"],
  ]) {
    config.output = output;
    config.motion = { enabled: true, output: motionOutput };
    await assertCaseCollisionWithoutWrites(root, config, /Smart Colors output path collision:.*case-insensitive/);
  }
});

test("proven case-sensitive filesystem allows distinct future case variants without writes", async (t) => {
  const { root, config } = await createProject(t);
  if (!await fixtureIsCaseSensitive(root)) {
    t.skip("Fixture filesystem is case-insensitive");
    return;
  }
  for (const [output, motionOutput] of [
    ["READONLY-PROBE-COLORS.css", "readonly-probe-colors.css"],
    ["Generated/Theme/READONLY-PROBE-COLORS.css", "generated/theme/readonly-probe-colors.css"],
  ]) {
    config.output = output;
    config.motion = { enabled: true, output: motionOutput };
    const before = await projectSnapshot(root);
    await validateOutputPaths({ root, config });
    assert.deepEqual(await projectSnapshot(root), before);
    const report = await generateColorTokens({ root, config, check: true });
    assert.equal(report.outputs.length, 2);
    assert.deepEqual(report.outputs.map((entry) => entry.path), [output, motionOutput]);
    assert.deepEqual(await projectSnapshot(root), before);
  }
});

test("empty output ancestor conservatively rejects potential case-folded collisions without writes", async (t) => {
  const { root, config } = await createProject(t);
  await mkdir(path.join(root, "empty"));
  config.output = "empty/READONLY-PROBE-COLORS.css";
  config.motion = { enabled: true, output: "empty/readonly-probe-colors.css" };
  await assertCaseCollisionWithoutWrites(root, config, /Smart Colors output path collision:.*case sensitivity could not be proven/);
  config.motion.output = "empty/distinct-motion.css";
  await validateOutputPaths({ root, config });
  assert.deepEqual(await readdir(path.join(root, "empty")), []);
});

test("ancestor with no case-flippable entry uses conservative policy without writes", async (t) => {
  const { root, config } = await createProject(t);
  await mkdir(path.join(root, "numeric"));
  await writeFile(path.join(root, "numeric/123"), "fixture sentinel\n");
  config.output = "numeric/COLORS.css";
  config.motion = { enabled: true, output: "numeric/colors.css" };
  await assertCaseCollisionWithoutWrites(root, config, /case sensitivity could not be proven/);
  assert.equal(await readFile(path.join(root, "numeric/123"), "utf8"), "fixture sentinel\n");
});

test("case-folded future outputs through symlink directories are checked on the target filesystem", async (t) => {
  const { root, config } = await createProject(t);
  if (!await createSymlink(t, root, path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir")) return;
  config.output = "READONLY-PROBE-COLORS.css";
  config.motion = { enabled: true, output: "alias/readonly-probe-colors.css" };
  if (await fixtureIsCaseSensitive(root)) {
    const before = await projectSnapshot(root);
    await validateOutputPaths({ root, config });
    await generateColorTokens({ root, config, check: true });
    assert.deepEqual(await projectSnapshot(root), before);
  } else {
    await assertCaseCollisionWithoutWrites(root, config, /Smart Colors output path collision:.*case-insensitive/);
  }
});

async function assertUnicodeCollisionWithoutWrites(options, labels, reason = /Unicode NFC normalization.*conservatively rejecting a potential collision/) {
  const before = await projectSnapshot(options.root);
  const operations = [
    () => validateOutputPaths(options),
    ...[false, true].map((check) => () => generateColorTokens({ ...options, check })),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, (error) => {
      assert.match(error.message, /Smart Colors output path collision/);
      for (const label of labels) assert.ok(error.message.includes(label), error.message);
      assert.match(error.message, reason);
      return true;
    });
    assert.deepEqual(await projectSnapshot(options.root), before);
  }
}

test("Unicode future outputs conservatively reject canonical equivalents without writes", async (t) => {
  for (const [name, output, motionOutput] of [
    ["NFC and NFD filenames", "colors-\u00e9.css", "colors-e\u0301.css"],
    ["NFD and NFC filenames", "colors-e\u0301.css", "colors-\u00e9.css"],
    ["missing Unicode parents", "generated/th\u00e8me/colors.css", "generated/the\u0300me/colors.css"],
    ["combining mark order", "generated/colors-e\u0323\u0301.css", "generated/colors-e\u0301\u0323.css"],
    ["Hangul composition", "generated/colors-\uac00.css", "generated/colors-\u1100\u1161.css"],
    ["file URL spellings", "colors-\u00e9.css", "colors-e\u0301.css"],
  ]) {
    await t.test(name, async (t) => {
      const { root, config } = await createProject(t);
      for (const file of [output, motionOutput]) await assert.rejects(lstat(path.join(root, file)), { code: "ENOENT" });
      config.output = name === "file URL spellings" ? pathToFileURL(path.join(root, output)) : output;
      config.motion = { enabled: true, output: name === "file URL spellings" ? pathToFileURL(path.join(root, motionOutput)).href : motionOutput };
      await assertUnicodeCollisionWithoutWrites({ root, config }, ["config.output", "config.motion.output"]);
    });
  }
});

test("Unicode-equivalent outputs protect existing and future sources without writes", async (t) => {
  for (const fixture of [
    { name: "palette", label: "config.palette", source: "pal\u00e9tte.css", bytes: PALETTE },
    { name: "explicit config", label: "configFile", source: "c\u00f3nfig.mjs", bytes: "// Config sentinel\nexport default {};\n" },
    { name: "future palette", label: "config.palette", source: "new/pal\u00e9tte.css" },
    { name: "future config and parents", label: "configFile", source: "new/c\u00f3nfig/settings.mjs" },
  ]) {
    for (const motion of [false, true]) {
      await t.test(`${fixture.name} (${motion ? "motion" : "colors"})`, async (t) => {
        const { root, config } = await createProject(t);
        if (fixture.bytes) await writeFile(path.join(root, fixture.source), fixture.bytes);
        if (fixture.label === "config.palette") config.palette = fixture.source;
        const configFile = fixture.label === "configFile" ? fixture.source : undefined;
        if (motion) config.motion = { enabled: true, output: fixture.source.normalize("NFD") };
        else config.output = fixture.source.normalize("NFD");
        await assertUnicodeCollisionWithoutWrites(
          { root, config, configFile },
          [motion ? "config.motion.output" : "config.output", fixture.label],
          /both resolve to|Unicode NFC normalization.*conservatively rejecting a potential collision/,
        );
      });
    }
  }
});

for (const aliases of [true, false]) {
  test(`existing Unicode outputs preserve bytes (${aliases ? "same entry" : "distinct entries, conservative policy"})`, async (t) => {
    const { root, config } = await createProject(t);
    config.output = "colors-\u00e9.css";
    config.motion = { enabled: true, output: "colors-e\u0301.css" };
    await writeFile(path.join(root, config.output), Buffer.from([0, 255, 13, 10, 65]));
    let fixtureAliases;
    try {
      await lstat(path.join(root, config.motion.output));
      fixtureAliases = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      fixtureAliases = false;
    }
    if (fixtureAliases !== aliases) {
      t.skip(`Fixture filesystem ${fixtureAliases ? "aliases" : "distinguishes"} these Unicode spellings`);
      return;
    }
    if (!aliases) await writeFile(path.join(root, config.motion.output), Buffer.from([254, 0, 10, 66]), { flag: "wx" });
    await assertUnicodeCollisionWithoutWrites(
      { root, config }, ["config.output", "config.motion.output"],
      aliases ? /both resolve to|Unicode NFC normalization/ : /Unicode NFC normalization.*conservatively rejecting a potential collision/,
    );
  });
}

test("Unicode equivalence is checked after existing and dangling symlink resolution", async (t) => {
  for (const fixture of [
    { name: "existing directory", target: "real", type: "dir", output: "real/colors-\u00e9.css", motion: "alias/colors-e\u0301.css" },
    { name: "dangling file", target: "generated/colors-e\u0301.css", type: "file", output: "generated/colors-\u00e9.css", motion: "alias" },
    { name: "dangling directory", target: "future-\u00e9", type: "dir", output: "future-e\u0301/colors.css", motion: "alias/colors.css" },
  ]) {
    await t.test(fixture.name, async (t) => {
      const { root, config } = await createProject(t);
      await mkdir(path.join(root, "real"));
      const target = fixture.type === "dir" ? path.join(root, fixture.target) : fixture.target;
      const type = process.platform === "win32" && fixture.target === "real" ? "junction" : fixture.type;
      if (!await createSymlink(t, target, path.join(root, "alias"), type)) return;
      config.output = fixture.output;
      config.motion = { enabled: true, output: fixture.motion };
      await assertUnicodeCollisionWithoutWrites({ root, config }, ["config.output", "config.motion.output"]);
    });
  }
});

test("Unicode normalization composes with the existing case-sensitivity policy", async (t) => {
  const { root, config } = await createProject(t);
  config.output = "generated/COLORS-\u00c9.css";
  config.motion = { enabled: true, output: "generated/colors-e\u0301.css" };
  if (await fixtureIsCaseSensitive(root)) {
    const before = await projectSnapshot(root);
    await validateOutputPaths({ root, config });
    const report = await generateColorTokens({ root, config, check: true });
    assert.equal(report.outputs.length, 2);
    assert.deepEqual(await projectSnapshot(root), before);
  } else {
    await assertUnicodeCollisionWithoutWrites({ root, config }, ["config.output", "config.motion.output"], /case folding and Unicode NFC normalization.*case-insensitive/);
  }
});

test("unknown case sensitivity rejects mixed case and Unicode ambiguity without writes", async (t) => {
  const { root, config } = await createProject(t);
  await mkdir(path.join(root, "empty"));
  config.output = "empty/COLORS-\u00e9.css";
  config.motion = { enabled: true, output: "empty/colors-e\u0301.css" };
  await assertUnicodeCollisionWithoutWrites({ root, config }, ["config.output", "config.motion.output"], /case folding and Unicode NFC normalization.*case sensitivity could not be proven/);
});

test("genuinely distinct Unicode names remain valid and generate separate outputs", async (t) => {
  for (const [output, motionOutput] of [
    ["colors-\u00e9.css", "colors-e.css"],
    ["generated-\u00e9/colors.css", "generated-\u00e8/colors.css"],
    ["colors-\u2460.css", "colors-1.css"],
    ["g\u00e9n/colors.css", "ge\u0301n/motion.css"],
  ]) {
    await t.test(`${output} / ${motionOutput}`, async (t) => {
      const { root, config } = await createProject(t);
      config.output = output;
      config.motion = { enabled: true, output: motionOutput };
      const before = await projectSnapshot(root);
      const sources = await sourceBytes(root);
      assert.equal(await validateOutputPaths({ root, config }), undefined);
      const check = await generateColorTokens({ root, config, check: true });
      assert.deepEqual(check.outputs.map((entry) => entry.path), [output, motionOutput]);
      assert.deepEqual(await projectSnapshot(root), before);
      const report = await generateColorTokens({ root, config });
      assert.notEqual(report.css, report.motionCss);
      assert.equal(await readFile(path.join(root, output), "utf8"), report.css);
      assert.equal(await readFile(path.join(root, motionOutput), "utf8"), report.motionCss);
      assert.deepEqual(await sourceBytes(root), sources);
      const generated = await projectSnapshot(root);
      await validateOutputPaths({ root, config });
      assert.deepEqual((await generateColorTokens({ root, config, check: true })).errors, []);
      assert.deepEqual(await projectSnapshot(root), generated);
    });
  }
});

test("disabled motion ignores Unicode-equivalent paths without writes", async (t) => {
  const { root, config } = await createProject(t);
  config.output = "colors-\u00e9.css";
  config.motion = { enabled: false, output: "colors-e\u0301.css" };
  const before = await projectSnapshot(root);
  await validateOutputPaths({ root, config });
  assert.equal((await generateColorTokens({ root, config, check: true })).outputs.length, 1);
  assert.deepEqual(await projectSnapshot(root), before);
});

test("native Windows roots and absolute drive file URLs", { skip: process.platform !== "win32" }, async (t) => {
  const { root, config } = await createProject(t);
  config.output = pathToFileURL(path.join(root, config.palette)).href;
  await assertCollision({ root, config }, ["config.output", "config.palette"]);
  config.output = "generated/colors.css";
  config.motion = { enabled: true, output: pathToFileURL(path.join(root, "generated/colors.css")).href };
  await assertCollision({ root, config }, ["config.motion.output", "config.output"]);
});


for (const check of [false, true]) {
  test(`generator rejects collisions before writes (check: ${check})`, async (t) => {
    for (const fixture of COLLISIONS) {
      await t.test(fixture.name, async (t) => {
        const { root, config } = await createProject(t);
        if (fixture.output) config.output = fixture.output;
        if (fixture.motion) config.motion = fixture.motion;
        const before = await sourceBytes(root);
        await assert.rejects(() => generateColorTokens({ root, config, configFile: fixture.configFile, check }), /Smart Colors output path collision/);
        assert.deepEqual(await sourceBytes(root), before);
        await assert.rejects(access(path.join(root, "generated")), { code: "ENOENT" });
      });
    }
  });
}
