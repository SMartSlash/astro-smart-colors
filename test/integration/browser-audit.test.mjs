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
import { auditPairs, projectAudit, terminalSummary } from "../../src/diagnostics/browser/browser-audit.mjs";
import { generateColorTokens } from "../../src/colors/generate-colors.mjs";
import { reportScenario } from "../../src/diagnostics/report-data.mjs";
import { MARKER } from "../../src/diagnostics/report/format-report-html.mjs";
import { REPORT_DOCUMENTS } from "../../src/diagnostics/report-paths.mjs";

const PAIR = {
  label: "light neutral text / canvas",
  foregroundColor: { l: 0, c: 0, h: 0 },
  backgroundColor: { l: 1, c: 0, h: 0 },
};
const REPORT_PATH = REPORT_DOCUMENTS.report;
const PREVIEW_PATH = REPORT_DOCUMENTS.preview;

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

const SUMMARY_COLOR = { l: 0.5, c: 0.02, h: 32 };
const summaryRow = (label, status = "pass", ratio = 7.2) => ({
  label, status, ratio, foreground: "--color-text", background: "--color-bg",
  foregroundColor: SUMMARY_COLOR, backgroundColor: { l: 0.95, c: 0.01, h: 88 }, target: 7, minimum: 4.5, kind: "text",
});
function summarySnapshot(rows) {
  return {
    generatedAt: "2026-10-17T12:00:00.000Z", inputDigest: "a".repeat(64),
    files: { palette: "palette.css", config: "smart-colors.config.mjs", tuning: "colors-tuning.css", output: "colors.css" },
    scenarios: [reportScenario("chromium", "light", "light", rows)],
    palette: [], notes: [], proposals: [], generationErrors: [], auditErrors: [],
  };
}

test("terminalSummary keeps minimum and target shortfalls distinct in English", () => {
  const lines = terminalSummary(summarySnapshot([
    summaryRow("minimum", "below-minimum", 4.4), summaryRow("target", "below-target", 6.8),
  ]));
  assert.equal(lines[0], "2 distinct issues: 1 below minimum, 1 below target.");
  assert.equal(lines[1], "2 measurements across 1 scenario; 0 verified fixes.");
  assert.ok(lines.includes("BELOW MINIMUM: light --color-text on --color-bg: 4.4:1 (minimum 4.5:1, target 7:1)."));
  assert.ok(lines.includes("BELOW TARGET: light --color-text on --color-bg: 6.8:1 (minimum 4.5:1, target 7:1)."));
  assert.ok(lines.includes("No verified candidate: no unconfirmed change is proposed."));
  assert.doesNotMatch(lines.join("\n"), /sotto|problemi|distinti|correzione|Nessun problema|certificazione/);
});

test("terminalSummary never claims all clear without a verified measurement", () => {
  const empty = { ...summarySnapshot([summaryRow("text")]), scenarios: [] };
  for (const input of [null, {}, empty]) {
    const lines = terminalSummary(input);
    assert.match(lines[0], /^Not verified or incomplete/);
    assert.doesNotMatch(lines.join("\n"), /No issue|not a certification|verified fix|BELOW/);
  }
  const failed = { ...summarySnapshot([summaryRow("text")]), auditErrors: ["browser unavailable"] };
  assert.equal(terminalSummary(failed)[0], "Not verified or incomplete (1 error). No fix is recommended; review the errors in the preview and regenerate the report after resolving them.");
});

test("terminalSummary states an empty measurement instead of a positive outcome", () => {
  assert.deepEqual(terminalSummary({ ...summarySnapshot([]) }), ["Not verified or incomplete. No fix is recommended; review the errors in the preview and regenerate the report after resolving them."]);
});

test("the audit guidance resolves a configured reports.directory without launching a browser", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-audit-guidance-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  await mkdir(path.join(root, "theme"), { recursive: true });
  await mkdir(path.join(root, "config"), { recursive: true });
  await writeFile(path.join(root, "theme/palette.css"), `@property --palette-canvas { syntax: "<color>"; inherits: true; initial-value: oklch(0.96 0.01 90); role: canvas; }
@property --palette-ink { syntax: "<color>"; inherits: true; initial-value: oklch(0.28 0.007 3.68); role: ink; }
@property --palette-primary { syntax: "<color>"; inherits: true; initial-value: oklch(0.62 0.16 32); role: ui; }`, "utf8");
  await writeFile(path.join(root, "src/styles/tokens/colors-tuning.css"), "", "utf8");
  const configFile = "config/colors.mjs";
  await writeFile(path.join(root, configFile), 'export default { palette: "theme/palette.css", output: "theme/colors.css", reports: { directory: "custom/reports" } };\n', "utf8");
  // Generate the exact output first: the audit compares the disk bytes and never writes.
  await generateColorTokens({ root, configFile });

  // An empty engine list skips launch but keeps the whole read-only path, so this exercises the
  // closing guidance without a browser. The configured reports.directory must drive the hint.
  const logs = [];
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await projectAudit([], { root, configFile });
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }

  const output = logs.join("\n");
  assert.match(output, /^  Action\s+For pairings and proposals:$/m);
  assert.match(output, /pnpm exec smart-colors report --root .*--config config\/colors\.mjs/);
  assert.ok(output.includes(path.join(root, "custom/reports/index.html")), "the configured reports.directory must drive the preview hint");
  assert.doesNotMatch(output, /smart-colors-reports\/index\.html/);
});

test("projectAudit protects the captured custom tuning path when analysis fails before launch", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "smart-colors-audit-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "theme"), { recursive: true });
  await mkdir(path.dirname(path.join(root, REPORT_PATH)), { recursive: true });
  await mkdir(path.join(root, "src/styles/tokens"), { recursive: true });
  // The custom palette is invalid, so analysis throws before any Playwright launch.
  await writeFile(path.join(root, "theme/palette.css"), "@property --palette-bg { initial-value: oklch(0.97 0 0); role: canvas; }\n");
  await writeFile(path.join(root, "smart-colors.config.mjs"), 'export default { palette: "theme/palette.css", output: "theme/colors.css" };\n');
  const owned = `${MARKER}\n<!doctype html><html><body>owned report</body></html>\n`;
  await writeFile(path.join(root, REPORT_PATH), owned);
  // No default tuning: the moved tuning file wins, and it aliases the owned report artifact.
  await symlink(path.join(root, REPORT_PATH), path.join(root, "theme/colors-tuning.css"));
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
  assert.equal(await readFile(path.join(root, REPORT_PATH), "utf8"), owned, "the owned report must not be overwritten");
  await assert.rejects(access(path.join(root, PREVIEW_PATH)), { code: "ENOENT" });
  assert.ok(logs.some((line) => /Audit incomplete/.test(line)), "the analysis failure is logged");
});
