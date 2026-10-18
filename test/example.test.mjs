import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parsePaletteWithDiagnostics } from "../src/parse-palette.mjs";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const EXAMPLE_ROOT = path.join(PACKAGE_ROOT, "examples/minimal");
const CLI_PATH = path.join(PACKAGE_ROOT, "src/cli.mjs");

const EXPECTED_ROLES = {
  "palette-canvas": "canvas",
  "palette-ink": "ink",
  "palette-brand": "ui",
  "palette-success": "feedback",
  "palette-highlight": "decorative",
};

const MACRO_TUNING_TOKENS = [
  "--color-tune-light-warmth",
  "--color-tune-surface-lightness-shift",
  "--color-tune-dark-warmth",
  "--color-tune-dark-bg-mix",
  "--color-tune-dark-surface-mix",
  "--color-tune-dark-text-mix",
  "--color-tune-dark-muted-mix",
];

function declaredValue(css, token) {
  return css.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();
}

test("minimal example palette matches the init starter and declares the five documented roles", async () => {
  const [css, template] = await Promise.all([
    readFile(path.join(EXAMPLE_ROOT, "src/styles/tokens/palette.css"), "utf8"),
    readFile(path.join(PACKAGE_ROOT, "src/templates/palette.css"), "utf8"),
  ]);
  const parsed = parsePaletteWithDiagnostics(css);

  assert.equal(css, template);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.annotatedRoles, EXPECTED_ROLES);
  assert.deepEqual(Object.keys(parsed.tokens).sort(), Object.keys(EXPECTED_ROLES).sort());
});

test("minimal example builds, checks and consumes only generated tokens", async (t) => {
  const parent = await mkdtemp(path.join(tmpdir(), "smart-colors-example-"));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, "minimal");
  await cp(EXAMPLE_ROOT, root, { recursive: true });

  const built = await execFileAsync(process.execPath, [CLI_PATH, "build"], { cwd: root, timeout: 30_000 });
  assert.match(built.stdout, /src\/styles\/tokens\/colors\.css rigenerato\./);
  assert.equal((built.stdout.match(/\[smart-colors\]/g) ?? []).length, 1);
  // Clean starter build in AUTO with no Playwright: the brief note stays on stdout, and the raw
  // technical coverage detail must not leak to stderr (only required/measure failures and model
  // warnings remain technical there).
  assert.equal(built.stderr, "");

  const checked = await execFileAsync(process.execPath, [CLI_PATH, "check"], { cwd: root, timeout: 30_000 });
  assert.match(checked.stdout, /src\/styles\/tokens\/colors\.css è aggiornato\./);

  const [html, css, tuningTemplate] = await Promise.all([
    readFile(path.join(root, "index.html"), "utf8"),
    readFile(path.join(root, "src/styles/tokens/colors.css"), "utf8"),
    readFile(path.join(PACKAGE_ROOT, "src/templates/colors-tuning.css"), "utf8"),
  ]);

  for (const token of MACRO_TUNING_TOKENS) {
    assert.equal(
      declaredValue(tuningTemplate, token),
      declaredValue(css, token),
      `${token} in the tuning template must match the generated default`,
    );
  }

  assert.match(html, /<link[^>]+href="src\/styles\/tokens\/colors\.css"/);
  assert.doesNotMatch(html, /<script|https?:\/\//i);

  const used = new Set([...html.matchAll(/var\((--[a-z0-9-]+)\)/g)].map((match) => match[1]));
  assert.ok(used.size >= 10);
  for (const token of used) {
    assert.ok(css.includes(`  ${token}:`), `${token} is consumed by index.html but not generated`);
  }
});
