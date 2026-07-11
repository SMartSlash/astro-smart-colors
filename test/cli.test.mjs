import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
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
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-cli-"));
  const tokenDirectory = path.join(root, "src/styles/tokens");
  await mkdir(tokenDirectory, { recursive: true });
  await writeFile(path.join(tokenDirectory, "palette.css"), PALETTE, "utf8");
  await writeFile(path.join(tokenDirectory, "colors.css"), ":root {}\n", "utf8");
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

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
