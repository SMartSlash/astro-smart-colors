#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { badge, cssState, file, measurementAvailable, note, paint, verdict, verificationComplete } from "./cli-style.mjs";
import { compactRatio } from "./diagnostics/report/format-report-html.mjs";
import { runDiagnosticWorkflow } from "./diagnostics/diagnostic-workflow.mjs";
import { initSmartColors } from "./init.mjs";
import { DEFAULT_CONFIG_FILE } from "./colors/load-config.mjs";
import { inspectTuningStatus } from "./diagnostics/report-data.mjs";

// Human usage names are CLI-local English. The shared designer language still serves the HTML
// artifacts and keeps its own contract; the CLI does not translate that source or depend on it.

const VALID_COMMANDS = new Set(["build", "check", "init", "audit", "report"]);
const BROWSERS = new Set(["chromium", "firefox", "webkit"]);
const AUTOMATION_MODES = new Set(["auto", "off", "required"]);
// Console stdout is the human channel: cap dynamic prose text and escape terminal control
// characters so a hostile palette, path or error string cannot inject ANSI/newlines. Clickable
// file URLs and command lines are escaped but never truncated.
const MAX_CONSOLE_TEXT = 160;
const MAX_SHOWN_PROBLEMS = 5;
const MAX_DIAGNOSTIC_LINES = 40;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

// Terminal layout: one labelled line per fact, so the output accompanies the work instead of
// walling it. `CONT` is the continuation indent, aligned under the labelled value. Labels are short
// nouns so the same block works for build, report, check and init.
const LABEL_WIDTH = 12;
const CONT = " ".repeat(LABEL_WIDTH + 3);
// Stable order for the source/role breakdown in the subject line.
const ROLE_ORDER = ["canvas", "ink", "ui", "feedback", "decorative"];
// Stable, plain progress phases (no spinner, no invented percentages). The automation label must
// not promise a browser run before discovery: `auto` only announces that the optional automation
// is being checked.
const STATUS_LABELS = {
  analysis: "palette analysis",
  generation: "token generation",
  automation: "checking optional automation",
  publication: "preview and report",
};
const AUTOMATION_REQUIRED_LABEL = "automated verification required";
const USAGE = `Usage: smart-colors [build|check|init|audit|report] [options]

Commands:
  build   Generate the CSS tokens and publish the preview and HTML report (default)
  check   Verify that the generated CSS tokens are up to date
  init    Create a starter palette and colors-tuning.css
  audit   Analyze the generated tokens and colors-tuning.css in a browser
  report  Generate the preview and HTML report

Options:
  -c, --config <file>        Configuration file relative to --root (default: ${DEFAULT_CONFIG_FILE})
  -r, --root <dir>           Project root (default: current directory)
      --automation <mode>    Playwright automation for build/report: auto|off|required (default: auto;
                             auto skips verification when Playwright is not installed)
      --palette <file>       Palette path for init (default: config.palette)
      --tuning <file>        Tuning path for init (default: <palette directory>/colors-tuning.css)
  -d, --dir <dir>            Token directory for init (default: src/styles/tokens)
  -y, --yes                  Skip the interactive init confirmation
  -h, --help                 Show this message`;

// CLI-only English usage names. The shared designer language keeps serving the HTML artifacts; these
// helpers mirror the same catalog only for terminal prose and fall back to the exact tokens. They are
// declared before the top-level run so no helper map is still in the temporal dead zone.
const TOKEN_NAME = /^--color-(.+)$/;
const CONTROL_TOKEN = /^--color-control-/;
const FAMILY_TOKEN = /^--color-(.+?)-(surface-strong|surface|border-strong|border|solid-hover|solid-text|solid|text-strong|text)$/;
const INK_TOKEN = /^--color-(.+)-ink$/;
const NON_BASE_TOKEN = /-(surface-strong|surface|border-strong|border|solid-hover|solid-text|solid|text-strong|text|text-muted|border-subtle|ink|warm|cool|\d+)$/;
const RESERVED_TOKENS = new Set([
  "--color-bg", "--color-surface", "--color-text", "--color-text-muted",
  "--color-border-subtle", "--color-border-strong", "--color-focus-ring",
]);
const BACKGROUND_PLACES = new Map([
  ["--color-bg", "on the page"],
  ["--color-surface", "on the card"],
]);
const FIXED_PAIR_TITLES = new Map([
  ["--color-control-active-text|--color-control-bg-active", "Active control text"],
  ["--color-text|--color-control-focus-bg", "Text on the focused control"],
  ["--color-control-border-active|--color-bg", "Active control border on the page"],
  ["--color-control-border-active|--color-control-bg-active", "Active control border"],
]);

const parsed = parseArgs(process.argv.slice(2));

// Help wins over any parsing problem; that is the conventional precedence and is kept.
if (parsed.help) {
  console.log(USAGE);
  process.exit(0);
}

if (parsed.errors.length) {
  for (const error of parsed.errors) {
    console.error(`[smart-colors] ${error}`);
  }
  console.error(USAGE);
  process.exit(1);
}

try {
  if (parsed.command === "init") {
    await runInit(parsed);
  } else if (parsed.command === "audit") {
    await runAudit(parsed);
  } else if (parsed.command === "check") {
    await runCheck(parsed);
  } else {
    await runWorkflow(parsed);
  }
} catch (error) {
  // Raw core/technical errors stay on stderr; only the two typed "absent input" cases get a
  // localized, actionable English message. English core messages are otherwise preserved verbatim.
  console.error(`[smart-colors] ${formatCliError(error)}`);
  process.exitCode = 1;
}

function formatCliError(error) {
  const code = error?.smartColorsCode ?? error?.code;
  const raw = error instanceof Error ? error.message : String(error);

  if (code === "SMART_COLORS_CONFIG_NOT_FOUND") {
    const selected = error.path ?? error.configFile ?? DEFAULT_CONFIG_FILE;
    const root = error.root ?? process.cwd();
    return `Configuration not found: "${safeText(selected)}" in ${safeText(root)}. Create the file or omit --config to use "${DEFAULT_CONFIG_FILE}"; init does not create the file named by --config.`;
  }

  if (code === "SMART_COLORS_PALETTE_NOT_FOUND") {
    const palette = error.path ?? error.palettePath;
    const root = error.root ?? process.cwd();
    const configFile = error.configFile ?? DEFAULT_CONFIG_FILE;
    const configArg = configFile !== DEFAULT_CONFIG_FILE ? ` --config ${shellQuote(commandText(configFile))}` : "";
    const found = palette ? `Palette not found: "${safeText(palette)}".` : "Palette not found.";
    return `${found} Create the palette with: pnpm exec smart-colors init --root ${shellQuote(commandText(root))}${configArg}`;
  }

  if (error instanceof Error && error.name && error.name !== "Error" && !raw.startsWith(error.name)) {
    return `${error.name}: ${raw}`;
  }
  return raw;
}

// Legacy strict/read-only audit: a separate writer path, never the new pipeline (§4.1).
async function runAudit({ browsers, root, configFile }) {
  const { projectAudit } = await import("./diagnostics/browser/browser-audit.mjs");
  await projectAudit(browsers, { root, configFile, emitReport: false });
}

async function runInit({ root, configFile, dir, palette, tuning, yes }) {
  const result = await initSmartColors({ root, configFile, dir, palette, tuning, yes });

  if (!result.written) {
    console.log(`${badge()} init\n\n  Operation cancelled: no files written.\n`);
    return;
  }

  // "Created" lists exactly what init wrote (`result.files`), each with the role it plays. The
  // effective config path in `result.generation` may be the default name that was never created, so
  // it is used only for the next-step command, never presented as a created file.
  const created = result.files ?? [];
  const generation = result.generation ?? {};
  const roles = ["palette", "tuning", "config"];
  const hints = {
    palette: "colors and roles, edit by hand",
    tuning: "optional overrides applied at runtime",
    config: "token paths",
  };
  const rows = created.map((createdPath, index) => [createdPath, roles[index] ?? "file"]);
  const roleWidth = rows.length ? Math.max(...rows.map(([, role]) => role.length)) : 0;
  const pathWidth = rows.length ? Math.max(...rows.map(([createdPath]) => safeText(createdPath).length)) : 0;
  const row = ([createdPath, role]) => `${note(role.padEnd(roleWidth))}  ${file(safeText(createdPath).padEnd(pathWidth))}  ${note(hints[role] ?? "")}`;

  // The next command preserves the effective root and config so it also works when init was
  // invoked from another working directory with an explicit --root.
  const buildCommand = ["pnpm", "exec", "smart-colors", "build", "--root", shellQuote(commandText(root))];
  if (generation.configFile && generation.configFile !== DEFAULT_CONFIG_FILE) {
    buildCommand.push("--config", shellQuote(commandText(generation.configFile)));
  }

  const lines = [
    `${badge()} init`,
    "",
    ...(rows.length ? [block("Created", row(rows[0])), ...rows.slice(1).map((entry) => `${CONT}${row(entry)}`)] : []),
    // The generated output is the one role init does not write here: stated once, with the rule that
    // matters (build owns it, the project imports it) and no repeated palette/tuning path.
    block("Output", `${file(safeText(generation.outputPath ?? "src/styles/tokens/colors.css"))}: build produces it; import it from your CSS without editing it`),
  ];

  // Guidance the init owner provides (for example a tuning file build would never read). Printed
  // verbatim instead of a false "all good" success line; it is the only reason to add a block.
  if (result.warnings?.length) {
    const [first, ...rest] = result.warnings.map((warning) => safeText(warning));
    lines.push("");
    lines.push(block("Warnings", first));
    for (const warning of rest) lines.push(`${CONT}${warning}`);
  }

  lines.push(
    "",
    block("Action", "Edit the palette, then generate the CSS:"),
    `${CONT}${buildCommand.join(" ")}`,
    "",
  );

  console.log(lines.join("\n"));
}

// Legacy read-only check: it never writes, never audits and never presents a previous HTML as current.
async function runCheck({ root, configFile }) {
  const { generateColorTokens } = await import("./colors/generate-colors.mjs");
  const report = await generateColorTokens({ root, configFile, check: true });

  const outputs = report.outputs.map((output) => file(safeText(output.path)));
  const tuning = await inspectTuningStatus(root, report.config);
  const lines = [`${badge()} check`, ""];

  // The file state comes first: a byte comparison really happened, so this is a fact and not a
  // verdict. The regeneration command keeps the effective root/config.
  const listed = outputs.length ? outputs.join(", ") : file(safeText(report.config.output));
  lines.push(block("CSS", `${listed}: ${report.changed ? "stale" : "up to date"}`));
  if (report.changed) lines.push(`${CONT}regenerate with ${note(buildCommandFor(root, configFile))}`);

  // Contrasts are a model estimate, never a measured pass: no checkmark, no positive verdict. The
  // pointer to stderr appears only when there is something to read there.
  const contrastDetail = report.warnings.length || report.suggestions.length ? ", details on stderr" : "";
  lines.push(block("Contrast", `model estimate: ${report.warnings.length} ${agree(report.warnings.length, "warning", "warnings")}, ${report.suggestions.length} ${agree(report.suggestions.length, "suggestion", "suggestions")}${contrastDetail}`));
  lines.push(block("Tuning", tuningLine(tuning)));
  lines.push("", block("Read-only", "does not modify files: it does not regenerate CSS, publish HTML or run a browser audit."));

  // Summary first, raw technical channel last.
  console.log(`${lines.join("\n")}\n`);

  for (const warning of report.warnings) console.warn(`[smart-colors] ${warning}`);
  for (const suggestion of report.suggestions) console.warn(`[smart-colors] Suggestion: ${suggestion}`);
  if (report.errors.length) {
    for (const error of report.errors) console.error(`[smart-colors] ${error}`);
    process.exitCode = 1;
  }
}

// Tuning is inspected, not verified: the summary distinguishes absent, present-read, and unreadable
// so a broken file is never flattened into "optional and missing".
function tuningLine(tuning) {
  const path = file(safeText(tuning.path));
  if (!tuning.exists) {
    const unreadable = /non leggibile|unreadable/i.test(tuning.summary ?? "");
    return `${path}: ${unreadable ? "unreadable (status not verified)" : "absent (optional)"}`;
  }
  if (tuning.activeCount === 0) return `${path}: present, no active overrides`;
  return `${path}: ${tuning.activeCount} ${agree(tuning.activeCount, "active override", "active overrides")}, verify with audit or report`;
}

function buildCommandFor(root, configFile) {
  const parts = ["pnpm", "exec", "smart-colors", "build", "--root", shellQuote(commandText(root))];
  if (configFile && configFile !== DEFAULT_CONFIG_FILE) parts.push("--config", shellQuote(commandText(configFile)));
  return escapeControl(parts.join(" "));
}

// Build and report share one pipeline; the exit policy and the verdict come from the workflow.
// Progress lines are plain and streamed live as each real phase starts, so the terminal accompanies
// the work without a spinner, a TUI or invented percentages. Only started phases ever reach stdout;
// usage errors are resolved before the workflow and keep stdout empty.
async function runWorkflow({ command, root, configFile, automation, browsers }) {
  const mode = automation ?? (command === "report" && browsers ? "required" : "auto");
  const result = await runDiagnosticWorkflow({
    root,
    configFile,
    command,
    automation: mode,
    browsers: browsers && browsers.length ? browsers : undefined,
    onProgress: (phase) => console.log(`smart-colors: ${progressLabel(phase, mode)}`),
  });

  const heading = result.command === "build" ? `${badge()} build` : `${badge()} report`;
  const lines = [heading, "", ...outcomeLines(result)];
  console.log(`${lines.join("\n")}\n`);

  // stderr is the raw technical channel, shown once each: the blocking model errors (previously
  // dropped here), the model warning/suggestion strings verbatim, then the deduplicated engine/run
  // detail. Errors and warnings are disjoint, so nothing is duplicated across the two loops.
  for (const error of boundedLines(result.analysis?.errors, MAX_DIAGNOSTIC_LINES, "errors")) {
    console.error(`[smart-colors] ${error}`);
  }
  for (const warning of result.warnings) console.warn(`[smart-colors] ${warning}`);
  for (const suggestion of result.suggestions) console.warn(`[smart-colors] Suggestion: ${suggestion}`);
  for (const detail of coverageDiagnostics(result)) console.warn(`[smart-colors] ${detail}`);

  process.exitCode = result.exitCode;
}

// Source -> CSS state -> verification -> verdict -> problems, then paths and the next action. The
// blocks are separated by one blank line so the outcome, the artifacts and the next step stay
// distinct; a fact is stated once and never repeated as a decorative summary.
function outcomeLines(result) {
  return [
    ...subjectLines(result),
    ...cssLines(result),
    ...verificationLines(result),
    esitoLine(result),
    ...problemLines(result),
    ...explorationLines(result),
    "",
    ...linkLines(result),
    ...actionLines(result),
  ];
}

// A stable, plain label per started phase. `auto` announces the optional automation check rather
// than promising a browser verification that discovery may not deliver.
function progressLabel(phase, mode) {
  if (phase === "automation") return mode === "required" ? AUTOMATION_REQUIRED_LABEL : STATUS_LABELS.automation;
  return STATUS_LABELS[phase] ?? phase;
}

// One labelled line per fact; the label is dimmed and padded so the values stay aligned.
function block(label, text) {
  return `  ${note(label.padEnd(LABEL_WIDTH))} ${text}`;
}

// The effective config's roles, counted for the subject line. `focus` references an existing
// identity rather than a separate authored colour, so it is not counted.
function countRoles(roles = {}) {
  const counts = new Map();
  const bump = (role) => counts.set(role, (counts.get(role) ?? 0) + 1);
  if (roles.canvas) bump("canvas");
  if (roles.ink) bump("ink");
  for (const def of Object.values(roles.identities ?? {})) bump(def?.role === "feedback" ? "feedback" : "ui");
  const decoratives = Object.keys(roles.decoratives ?? {}).length;
  if (decoratives > 0) counts.set("decorative", decoratives);
  return counts;
}

// Authoring subject only: where the colors come from and how many were declared. The generated
// path is part of the CSS state line, so it is not repeated here.
function subjectLines(result) {
  const config = result.analysis?.config ?? {};
  const counts = countRoles(config.roles);
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const breakdown = ROLE_ORDER
    .filter((role) => counts.has(role))
    .map((role) => `${roleLabel(role)}: ${counts.get(role)}`)
    .join(", ");
  const sources = `${total} ${total === 1 ? "color" : "colors"}${breakdown ? ` (${breakdown})` : ""}`;
  return [block("Palette", `${file(safeText(config.palette ?? "src/styles/tokens/palette.css"))}: ${sources}`)];
}

function roleLabel(role) {
  switch (String(role ?? "").trim().toLowerCase()) {
    case "canvas": return "page background";
    case "ink": return "base text";
    case "ui": return "interface";
    case "feedback": return "feedback";
    case "decorative": return "decorative";
    default: return String(role ?? "").trim() || "role not specified";
  }
}

function themeLabel(theme) {
  switch (String(theme ?? "").trim().toLowerCase()) {
    case "light": return "light";
    case "dark": return "dark";
    default: return String(theme ?? "").trim() || "theme not specified";
  }
}

function pairTitle(foregroundToken, backgroundToken, property = "color") {
  const foreground = String(foregroundToken ?? "").trim();
  const background = String(backgroundToken ?? "").trim();
  const propertyName = String(property ?? "").trim().toLowerCase();
  const fallback = foreground && background
    ? `${foreground} on ${background}`
    : foreground || background || "pair not specified";
  if (!foreground || !background) return fallback;

  const fixed = FIXED_PAIR_TITLES.get(`${foreground}|${background}`);
  if (fixed) return fixed;

  const place = backgroundPlace(background);
  const role = foregroundRole(foreground, propertyName);
  if (!place || !role) return fallback;

  if (role.kind === "button-text" && (place.kind === "button" || place.kind === "button-hover")) {
    const button = role.family ? `Button text (${role.family})` : "Button text";
    return place.kind === "button-hover" ? `${button} on hover` : button;
  }

  const noun = role.family && place.family !== role.family
    ? `${role.noun} (${role.family})`
    : role.noun;
  return `${noun} ${place.phrase}`;
}

function backgroundPlace(token) {
  if (CONTROL_TOKEN.test(token)) return null;
  const fixed = BACKGROUND_PLACES.get(token);
  if (fixed) return { phrase: fixed, family: "", kind: "neutral" };

  const family = FAMILY_TOKEN.exec(token);
  if (family) {
    const name = family[1];
    if (family[2] === "surface") return { phrase: `on the ${name} callout`, family: name, kind: "callout" };
    if (family[2] === "surface-strong") return { phrase: `on the ${name} callout (strong)`, family: name, kind: "callout" };
    if (family[2] === "solid") return { phrase: `on the ${name} button`, family: name, kind: "button" };
    if (family[2] === "solid-hover") return { phrase: `on the ${name} button on hover`, family: name, kind: "button-hover" };
    return null;
  }

  if (isBaseFill(token)) {
    const name = TOKEN_NAME.exec(token)[1];
    return { phrase: `on the ${name} fill`, family: name, kind: "fill" };
  }
  return null;
}

function foregroundRole(token, property) {
  if (CONTROL_TOKEN.test(token)) return null;
  if (token === "--color-text") return { noun: "Text", family: "", kind: "text" };
  if (token === "--color-text-muted") return { noun: "Secondary text", family: "", kind: "text" };
  if (token === "--color-focus-ring") return { noun: "Focus", family: "", kind: "focus" };
  if (token === "--color-border-subtle") return { noun: "Subtle border", family: "", kind: "border" };
  if (token === "--color-border-strong") return { noun: "Strong border", family: "", kind: "border" };

  const ink = INK_TOKEN.exec(token);
  if (ink) return { noun: "Text", family: ink[1], kind: "ink" };

  const family = FAMILY_TOKEN.exec(token);
  if (family) {
    const name = family[1];
    if (family[2] === "text") return { noun: "Text", family: name, kind: "text" };
    if (family[2] === "text-strong") return { noun: "Emphasized text", family: name, kind: "text" };
    if (family[2] === "border" || family[2] === "border-strong") return { noun: "Border", family: name, kind: "border" };
    if (family[2] === "solid-text") return { noun: "Button text", family: name, kind: "button-text" };
    if (family[2] === "solid" || family[2] === "solid-hover") return { noun: "Fill", family: name, kind: "fill" };
    return { noun: "Surface", family: name, kind: "surface" };
  }

  if (isBaseFill(token)) {
    const name = TOKEN_NAME.exec(token)[1];
    if (/outline/.test(property)) return { noun: "Focus", family: name, kind: "focus" };
    if (/border/.test(property)) return { noun: "Border", family: name, kind: "border" };
    return null;
  }
  return null;
}

function isBaseFill(token) {
  return TOKEN_NAME.test(token) && !RESERVED_TOKENS.has(token) && !CONTROL_TOKEN.test(token) && !NON_BASE_TOKEN.test(token);
}

// Exploratory overlaps never count toward the pass criteria or the exit code: they are only pointed
// at (without a count) when the run exposes them, and never claimed when unavailable.
function explorationLines(result) {
  const explorations = result.run?.explorations;
  const available = Array.isArray(explorations)
    ? explorations.length > 0
    : Boolean(explorations && typeof explorations === "object" && Object.keys(explorations).length > 0);
  if (!available) return [];
  return [block("Extra", "Exploratory pairings available in the preview (outside the outcome criteria).")];
}

// The CSS state is a fact about bytes, separate from generation success and from the verification.
// build reports what it wrote; report names the file it actually measured, using "candidate" only
// for an absent output so a stale file is never disguised as a proposal.
function cssLines(result) {
  if (result.command !== "report") return [buildCssLine(result)];
  const state = cssState(result);
  const path = file(safeText(state.path));
  switch (state.shape) {
    case "current":
      return [block("CSS", `${path}: up to date`)];
    case "stale":
      return [block("CSS", `${path}: out of date, bytes on disk diverge from the generated tokens; the report measures that file`)];
    case "absent":
      return [block("CSS", `${path}: absent, the measurements cover the generated candidate CSS, not production`)];
    case "empty":
      return [block("CSS", `${path}: empty, no positive verification possible`)];
    default:
      return [block("CSS", `${path}: state not determined`)];
  }
}

function buildCssLine(result) {
  if (result.strictInvalid) {
    return block("CSS", `${file(safeText(cssState(result).path))}: not written, contrast contract invalid`);
  }
  const outputs = result.writeOutcome?.outputs ?? [];
  const changed = outputs.filter((output) => output.changed);
  const shown = changed.length ? changed : outputs;
  const listed = shown.length
    ? shown.map((output) => file(safeText(output.path))).join(", ")
    : file(safeText(cssState(result).path));
  const state = changed.length ? "regenerated" : "already up to date";
  return block("CSS", `${listed}: ${state}`);
}

// What was actually verified, with the provenance made explicit exactly once. Zero engines launched
// keeps its honest per-engine reasons; a partial run is never reported as an executed verification.
function verificationLines(result) {
  if (result.strictInvalid) {
    return [block("Verification", "MODEL ESTIMATE: automation not run, contrast contract invalid")];
  }
  // A partial run still has real measurements: it stays MEASURED and declares its incomplete coverage.
  if (measurementAvailable(result)) {
    if (verificationComplete(result)) {
      return [block("Verification", `MEASURED: ${gridSummary(result.coverage)}`)];
    }
    const coverage = result.coverage;
    const missing = Number.isFinite(coverage.missingPairs) ? coverage.missingPairs : coverage.unmeasured;
    return [block("Verification", `MEASURED: partial coverage, ${coverage.measuredPairs} pairs measured and ${missing} missing`)];
  }
  const coverage = result.coverage;
  if (coverage.status === "disabled" || coverage.mode === "off") {
    return [block("Verification", "MODEL ESTIMATE: automation disabled")];
  }
  if ((coverage.launched ?? 0) === 0) {
    return zeroLaunchLines(result);
  }
  const missing = Number.isFinite(coverage.missingPairs) ? coverage.missingPairs : coverage.unmeasured;
  return [block("Verification", `MODEL ESTIMATE: partial coverage, ${missing} pairs missing`)];
}

// The verdict is the only positive/negative claim: the label is coloured on a TTY, the detail states
// the consequence already implied by the rules above it.
function esitoLine(result) {
  const outcome = verdict(result);
  const color = outcome.code === "ok" ? "green" : outcome.code === "review" ? "yellow" : outcome.code === "error" ? "red" : null;
  const label = paint(outcome.label, "bold", ...(color ? [color] : []));
  return block("Verdict", `${label}: ${outcome.detail}`);
}

// Short list: at most a few problems, always with human usage labels (token names and raw ratios
// stay in the stderr/report detail) and a pointer to the full set. The count lives in the verdict,
// so the list never repeats it.
function problemLines(result) {
  // A strict-invalid model is described by the verdict and its blocking errors on stderr.
  if (result.strictInvalid) return [];
  // Availability (measuredPairs > 0) selects the measured facts; completeness only decides whether a
  // clean result may be presented positively. A partial measured run keeps its measured problems, so
  // a measured shortfall is never dropped in favour of an empty model list.
  const available = measurementAvailable(result);
  const problems = (available ? result.problems : result.modelProblems) ?? [];
  if (!problems.length) return [];
  const shown = problems.slice(0, MAX_SHOWN_PROBLEMS);
  const lines = [block("Problems", problemText(shown[0]))];
  for (const problem of shown.slice(1)) lines.push(`${CONT}${problemText(problem)}`);
  const rest = problems.length - shown.length;
  if (rest > 0) lines.push(`${CONT}${rest === 1 ? "One more pair in the report." : `${rest} more pairs in the report.`}`);
  return lines;
}

// Human pair label + theme, the threshold-aware measured ratio, and the shortfall against the
// distinct project target or reference minimum. Equal thresholds are shown once, never twice.
function problemText(problem) {
  const pair = pairTitle(problem.foregroundToken, problem.backgroundToken);
  const theme = themeLabel(problem.scheme);
  const measured = ratio(problem.ratio, [problem.minimum, problem.target]);
  const threshold = problem.minimum === problem.target
    ? `threshold of ${ratio(problem.minimum)}`
    : problem.status === "below-minimum"
      ? `minimum of ${ratio(problem.minimum)}`
      : `project target of ${ratio(problem.target)}`;
  return `${pair}, ${theme}: ${measured}, below the ${threshold}.`;
}

// Zero engines launched: name every selected engine with a brief reason. The install is the
// project's responsibility, so no installer command is invented and no nag is shown in `auto`.
function zeroLaunchLines(result) {
  const engines = (result.run.engines ?? []).filter((engine) => engine.launched !== true);
  const expected = expectedAbsenceReasons(result);
  const allExpected = engines.length > 0 && engines.every((engine) => expected.has(engine.reason));

  // Expected optional absence (Playwright simply not installed): one brief fact, no per-engine wall
  // and no install nag. The native verification is named once, in the action line below.
  if (result.mode !== "required" && allExpected) {
    return [block("Verification", "MODEL ESTIMATE: optional automation not run, Playwright not installed")];
  }

  const causes = causeByReason(result.run);
  const selected = engines.length
    ? engines.map((engine) => ({ name: engine.name, phase: engine.phase, cause: causes.get(engine.reason) ?? null }))
    : (result.coverage.requestedEngines ?? []).map((name) => ({ name, phase: null, cause: null }));

  const lines = [block("Verification", "MODEL ESTIMATE: no engine launched")];
  const groups = new Map();
  for (const engine of selected) {
    const brief = briefEngineReason(engine);
    const names = groups.get(brief) ?? [];
    names.push(safeText(engine.name));
    groups.set(brief, names);
  }
  for (const [brief, names] of groups) lines.push(`${CONT}${names.join(", ")}: ${brief}`);

  if (result.mode === "required") {
    lines.push(`${CONT}Playwright and the engine binaries are the project's responsibility: verify them, then run the verification again.`);
  }
  return lines;
}

// Package vs binary are distinct causes: never claim a missing binary when only the module/API is
// incompatible, and never claim the module is absent when only that engine's binary is missing.
function briefEngineReason(engine) {
  switch (engine.cause) {
    case "playwright-not-found": return "Playwright is not installed in the project";
    case "import-failed": return "the Playwright package cannot be imported in the project";
    case "import-incompatible": return "the Playwright API is not compatible in the project";
    case "engine-unknown": return "the Playwright module does not expose this engine";
    case "executable-path-failed": return "cannot determine the engine binary path";
    case "binary-missing":
    case "engine-unavailable": return "the engine binary is not available in the project";
    default: break;
  }
  switch (engine.phase) {
    case "discovery":
    case "import":
      return "the Playwright package could not be resolved or its API is incompatible in the project";
    case "availability":
      return "the engine binary is not available in the project";
    case "launch":
      return "the engine failed to launch";
    default:
      return "not launched";
  }
}

// The structured "expected optional absence": discovery failed only because Playwright is not
// installed in the consumer. In `auto` this is an expected condition, not a technical failure.
function expectedAbsenceReasons(result) {
  const reasons = new Set();
  if (result.mode === "required") return reasons;
  for (const error of result.run.errors ?? []) {
    if (error.phase === "discovery" && error.cause === "playwright-not-found" && error.message) reasons.add(error.message);
  }
  return reasons;
}

function causeByReason(run) {
  const map = new Map();
  for (const error of run.errors ?? []) {
    if (error.message && !map.has(error.message)) map.set(error.message, error.cause);
  }
  return map;
}

function gridSummary(coverage) {
  const launched = (coverage.engines ?? []).filter((engine) => engine.launched).length;
  const expected = (coverage.requestedEngines ?? coverage.engines ?? []).length;
  return `${launched} of ${expected} engines run`;
}

// Raw, deduplicated engine/run detail. Technical cause preserved; the install hint is only
// kept when automation was explicitly required, never as a default nag.
function coverageDiagnostics(result) {
  const coverage = result.coverage;
  if (result.strictInvalid) return [];
  if (coverage.status === "disabled" || coverage.mode === "off") return [];
  const keepInstallHint = result.mode === "required";
  const clean = (line) => (keepInstallHint ? line : stripInstallHint(line));
  // In auto, a discovery-only "Playwright not installed" is expected optional absence: suppress
  // exactly that shared cause/reason, never the whole run. Real failures stay detailed.
  const expectedAbsence = expectedAbsenceReasons(result);

  // Group engines that share the same status/reason/phase so three skipped engines with one
  // cause become one line instead of a wall.
  const groups = new Map();
  for (const engine of result.run.engines ?? []) {
    if (engine.launched === true && engine.status === "complete") continue;
    if (expectedAbsence.has(engine.reason)) continue;
    const key = `${engine.status}\u0000${engine.reason ?? ""}\u0000${engine.phase ?? ""}`;
    const group = groups.get(key) ?? { names: [], status: engine.status, reason: engine.reason, phase: engine.phase };
    group.names.push(engine.name);
    groups.set(key, group);
  }

  const lines = [];
  const reasons = new Set();
  for (const group of groups.values()) {
    if (group.reason) reasons.add(group.reason);
    const reason = group.reason ? `: ${clean(group.reason)}` : "";
    lines.push(`coverage ${group.names.join(", ")}: ${group.status}${reason}${group.phase ? ` (phase ${group.phase})` : ""}`);
  }
  // A run error that only echoes an engine reason already shown, or that is the expected absence,
  // adds nothing.
  for (const error of result.run.errors ?? []) {
    if (!error.message || reasons.has(error.message) || expectedAbsence.has(error.message)) continue;
    lines.push(`error ${error.phase ?? "n/a"} (${error.engine ?? "environment"}): ${clean(error.message)}`);
  }

  if (lines.length > MAX_DIAGNOSTIC_LINES) {
    const extra = lines.length - MAX_DIAGNOSTIC_LINES;
    return [...lines.slice(0, MAX_DIAGNOSTIC_LINES), `...and ${extra} more technical messages (deduplicated).`];
  }
  return lines;
}

// Drop an explanatory install sentence while preserving the diagnostic cause.
function stripInstallHint(text) {
  if (!/playwright install|Installa playwright/i.test(text)) return text;
  const kept = text
    .split(/(?<=\.)\s+/)
    .filter((part) => !/playwright install|Installa playwright/i.test(part))
    .join(" ")
    .trim();
  return kept || text;
}

// The published folder comes from the workflow, never from a constant: the pair is the primary
// outcome of the run. The preview is first because it is what the reader opens.
function linkLines(result) {
  const previewUrl = pathToFileURL(result.publication.previewPath).href;
  const reportUrl = pathToFileURL(result.publication.reportPath).href;
  return [
    block("Preview", file(escapeControl(previewUrl))),
    block("Report", file(escapeControl(reportUrl))),
  ];
}

// Exactly one next action. The preview is always the primary step; regeneration or correction is a
// conditional secondary step, never a report->report tautology. `report` publishes the HTML folder
// but modifies no CSS, palette, config or tuning; it says so once here instead of repeating the
// read-only rule in every block.
function actionLines(result) {
  const lines = [block("Action", "Open the preview: samples and native verification in the browser.")];
  if (result.strictInvalid) {
    lines.push(`${CONT}Fix the palette or the contrast contract, then retry ${result.command}.`);
  } else if (cssNeedsBuild(result)) {
    lines.push(`${CONT}Align the CSS with: ${buildCommandFor(result.root, result.configFile)}`);
  }
  if (result.command === "report") {
    lines.push(`${CONT}The report does not modify CSS, palette, config or tuning.`);
  }
  return lines;
}

function cssNeedsBuild(result) {
  if (result.command !== "report") return false;
  const shape = cssState(result).shape;
  return shape === "stale" || shape === "absent" || shape === "empty";
}

function shellQuote(value) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

// Threshold-aware: a value that only rounds up to a threshold must never be shown as if it met it.
// The approximate marker is plain ASCII so a piped run stays readable in any terminal or log.
function ratio(value, thresholds = []) {
  if (!Number.isFinite(value)) return "not available";
  return compactRatio(value, thresholds).replace("&lt;", "<").replace("≈ ", "~ ").replace(",", ".");
}

function agree(count, one, many) {
  return count === 1 ? one : many;
}

function escapeControl(value) {
  return String(value).replace(CONTROL_CHARS, (char) => `\\x${char.codePointAt(0).toString(16).padStart(2, "0")}`);
}

function safeText(value, max = MAX_CONSOLE_TEXT) {
  const escaped = escapeControl(value);
  return escaped.length > max ? `${escaped.slice(0, Math.max(0, max - 3))}...` : escaped;
}

// Bound a technical line list on stderr while preserving the first lines verbatim and naming the
// remainder, so a hostile or huge error set can never become an unbounded wall.
function boundedLines(lines, max, noun) {
  const list = lines ?? [];
  if (list.length <= max) return list;
  return [...list.slice(0, max), `...and ${list.length - max} more ${noun} (full details in the report).`];
}

// Command operands keep their visible characters (quoted by shellQuote) but lose control chars.
function commandText(value) {
  return escapeControl(value);
}

function parseArgs(args) {
  const parsedArgs = {
    command: "build",
    configFile: undefined,
    root: process.cwd(),
    palette: undefined,
    tuning: undefined,
    dir: undefined,
    automation: undefined,
    browsers: undefined,
    yes: false,
    help: false,
    errors: [],
  };
  const positionals = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsedArgs.help = true;
      continue;
    }

    if (arg === "--config" || arg === "-c") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.configFile = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) {
        parsedArgs.errors.push('Missing value for "--config".');
      } else {
        parsedArgs.configFile = value;
      }
      continue;
    }

    if (arg === "--automation") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.automation = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--automation=")) {
      const value = arg.slice("--automation=".length);
      if (!value) {
        parsedArgs.errors.push('Missing value for "--automation".');
      } else {
        parsedArgs.automation = value;
      }
      continue;
    }

    if (arg === "--palette") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.palette = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--palette=")) {
      const value = arg.slice("--palette=".length);
      if (!value) {
        parsedArgs.errors.push('Missing value for "--palette".');
      } else {
        parsedArgs.palette = value;
      }
      continue;
    }

    if (arg === "--tuning") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.tuning = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--tuning=")) {
      const value = arg.slice("--tuning=".length);
      if (!value) {
        parsedArgs.errors.push('Missing value for "--tuning".');
      } else {
        parsedArgs.tuning = value;
      }
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      parsedArgs.yes = true;
      continue;
    }

    if (arg === "--dir" || arg === "-d") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.dir = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--dir=")) {
      const value = arg.slice("--dir=".length);
      if (!value) {
        parsedArgs.errors.push('Missing value for "--dir".');
      } else {
        parsedArgs.dir = value;
      }
      continue;
    }

    if (arg === "--root" || arg === "-r") {
      const value = args[index + 1];
      if (isMissingOptionValue(value)) {
        parsedArgs.errors.push(`Missing value for ${JSON.stringify(arg)}.`);
      } else {
        parsedArgs.root = value;
        index += 1;
      }
      continue;
    }

    if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length);
      if (!value) {
        parsedArgs.errors.push('Missing value for "--root".');
      } else {
        parsedArgs.root = value;
      }
      continue;
    }

    if (arg.startsWith("-")) {
      parsedArgs.errors.push(`Unknown option: ${JSON.stringify(arg)}.`);
      continue;
    }

    // An empty positional is never a valid command or browser; it must not fall back
    // to the default `build` command. Reject it explicitly, in any position.
    if (arg === "") {
      parsedArgs.errors.push(`Empty argument not allowed: ${JSON.stringify(arg)}.`);
      continue;
    }

    positionals.push(arg);
  }

  const [command, ...extraPositionals] = positionals;

  if (command) {
    if (VALID_COMMANDS.has(command)) {
      parsedArgs.command = command;
    } else {
      parsedArgs.errors.push(`Unknown command: ${JSON.stringify(command)}.`);
    }
  }

  // §4.2: only report and audit accept a browser list; build must not introduce one.
  if (extraPositionals.length) {
    if (parsedArgs.command === "audit" || parsedArgs.command === "report") {
      parsedArgs.browsers = [...new Set(extraPositionals)];
      for (const name of parsedArgs.browsers) {
        if (!BROWSERS.has(name)) parsedArgs.errors.push(`Unknown browser ${JSON.stringify(name)}. Supported browsers: chromium, firefox, webkit.`);
      }
    } else {
      parsedArgs.errors.push(`Unexpected arguments: ${extraPositionals.map((value) => JSON.stringify(value)).join(", ")}.`);
    }
  } else if (parsedArgs.command === "audit") {
    parsedArgs.browsers = ["chromium"];
  }

  if (parsedArgs.automation !== undefined) {
    if (!AUTOMATION_MODES.has(parsedArgs.automation)) {
      parsedArgs.errors.push(`Unknown automation mode ${JSON.stringify(parsedArgs.automation)}. Allowed values: auto, off, required.`);
    } else if (parsedArgs.command !== "build" && parsedArgs.command !== "report") {
      parsedArgs.errors.push("The --automation option is supported only by build and report.");
    }
  }

  if (parsedArgs.browsers && (parsedArgs.command === "report")) {
    if (parsedArgs.automation === "off") {
      parsedArgs.errors.push("An explicit browser list cannot be combined with automation mode off.");
    } else if (parsedArgs.automation === "auto") {
      parsedArgs.errors.push("An explicit browser list cannot be combined with automation mode auto; use required.");
    } else if (parsedArgs.automation === undefined) {
      // An explicit report browser list implies a deterministic, strict request.
      parsedArgs.automation = "required";
    }
  }

  if (parsedArgs.command !== "init") {
    for (const [flag, value] of [["--palette", parsedArgs.palette], ["--tuning", parsedArgs.tuning], ["--dir", parsedArgs.dir]]) {
      if (value !== undefined) parsedArgs.errors.push(`The ${flag} option is supported only by init.`);
    }
    if (parsedArgs.yes) parsedArgs.errors.push("The --yes option is supported only by init.");
  }

  return parsedArgs;
}

function isMissingOptionValue(value) {
  return value == null || value === "" || value.startsWith("-");
}
