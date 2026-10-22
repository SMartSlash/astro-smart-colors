/**
 * Focused audit contract tests that do not need a browser.
 *
 * `auditPairs` is the legacy audit classification path. It must apply the same
 * fail-closed threshold contract as `measurePair`: a contract without a usable
 * target can never produce a `pass`.
 */
import assert from "node:assert/strict";
import { access, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { auditPairs, projectAudit } from "../src/browser-audit.mjs";
import { MARKER } from "../src/format-report-html.mjs";

const PAIR = {
  label: "light neutral text / canvas",
  foregroundColor: { l: 0, c: 0, h: 0 },
  backgroundColor: { l: 1, c: 0, h: 0 },
};

test("auditPairs fails closed when a contract pair has no usable target", () => {
  for (const contrast of [{}, { text: Number.NaN }, { text: Infinity }, { text: 0 }]) {
    assert.throws(
      () => auditPairs({ config: { contrast } }, { pairs: [PAIR] }, "light"),
      /finite positive thresholds with minimum <= target/,
      JSON.stringify(contrast),
    );
  }
});

test("auditPairs keeps the contract thresholds and classification for a valid config", () => {
  const config = { contrast: { text: 4.6, onColor: 4.6, ui: 3, maxIdentity: 7.5, darkRichness: 1.15 } };
  const [result] = auditPairs({ config }, { pairs: [PAIR] }, "light");
  assert.equal(result.target, 4.6);
  assert.equal(result.minimum, 4.5);
  assert.equal(result.ratio, 21);
  assert.equal(result.status, "pass");
});

test("projectAudit protects the captured custom tuning path when analysis fails before launch", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-audit-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "theme"), { recursive: true });
  await mkdir(path.join(root, "reports"), { recursive: true });
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  // The custom palette is invalid, so analysis throws before any Playwright launch.
  await writeFile(path.join(root, "theme/palette.css"), "@property --palette-bg { initial-value: oklch(0.97 0 0); role: canvas; }\n");
  await writeFile(path.join(root, "smart-colors.config.mjs"), 'export default { palette: "theme/palette.css", output: "theme/colors.css" };\n');
  const owned = `${MARKER}\n<!doctype html><html><body>owned report</body></html>\n`;
  await writeFile(path.join(root, "reports/smart-colors.html"), owned);
  // No default tuning: the moved tuning file wins, and it aliases the owned report artifact.
  await symlink(path.join(root, "reports/smart-colors.html"), path.join(root, "theme/colors-tuning.css"));
  assert.equal((await lstat(path.join(root, "theme/colors-tuning.css"))).isSymbolicLink(), true);
  await assert.rejects(access(path.join(root, "src/styles/tokens/colors-tuning.css")), { code: "ENOENT" });

  const originalExitCode = process.exitCode;
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(" "));
  let failure;
  try {
    await assert.rejects(
      projectAudit(["chromium"], { root, emitReport: true }),
      (error) => { failure = error; return true; },
    );
  } finally {
    console.error = originalError;
    process.exitCode = originalExitCode;
  }

  assert.match(failure.message, /report path validation failed against tuningPath/);
  assert.match(failure.message, /theme\/colors-tuning\.css/);
  assert.equal(process.exitCode, originalExitCode, "the test restores the process exit code");
  assert.equal(console.error, originalError, "the test restores console.error");
  assert.equal(await readFile(path.join(root, "reports/smart-colors.html"), "utf8"), owned, "the owned report must not be overwritten");
  await assert.rejects(access(path.join(root, "reports/smart-colors-preview.html")), { code: "ENOENT" });
  assert.ok(logs.some((line) => /Audit incompleto/.test(line)), "the analysis failure is logged");
});
