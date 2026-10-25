#!/usr/bin/env node
/**
 * Recursive test runner for the package.
 *
 * Groups are directories: `unit`, `integration`, `browser` and `site`. The default run is
 * unit + integration + browser: a flat clone needs no site checkout and no browser, while the
 * Node-only portions of the hybrid browser files always run. Native proofs stay behind
 * `--native`; the site group is explicit and preflights the reference checkout.
 *
 * No dependencies: discovery uses node:fs, and the selected files are handed to `node --test`.
 */
import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_ROOT, assertSiteRoot } from "../test/helpers/roots.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(SCRIPT_DIR, "..");

const GROUPS = Object.freeze({
  unit: "test/unit",
  integration: "test/integration",
  browser: "test/browser",
  site: "test/site",
});
const DEFAULT_GROUPS = Object.freeze(["unit", "integration", "browser"]);
// The product and the helper keep Firefox support; this runner only exposes engines with an
// implemented native proof in the package. A Firefox selection is rejected instead of silently
// producing a run where every native proof is skipped.
const PARSED_BROWSERS = Object.freeze(["chromium", "firefox", "webkit"]);
const RUNNER_BROWSERS = Object.freeze(["chromium", "webkit"]);
const LEGACY_DEFAULT_BROWSERS = Object.freeze(["chromium", "webkit"]);

const USAGE = `Usage: node scripts/run-tests.mjs [group ...] [options]

Groups:
  unit          pure Node tests, no filesystem fixtures
  integration   Node tests with temporary projects, filesystem or CLI
  browser       hybrid files: Node assertions always run, native proofs are opt-in
  site          reference-site root proofs (requires SMART_COLORS_SITE_ROOT or the monorepo sibling)
  all           unit + integration + browser; site is never implied

Options:
  --native                 enable SMART_COLORS_NATIVE_PROOF=1
  --browser=<list>         required with --native or site; comma-separated chromium|webkit
                           (Firefox support in the product is unchanged, but has no package proof)
  --list                   print the selected files and counts without running them
  --help                   show this help

Default: unit + integration + browser with native proofs off.
`;

function fail(message) {
  console.error(`Smart Colors tests: ${message}`);
  process.exitCode = 2;
}

function parseArgs(argv) {
  const groups = [];
  let native = false;
  let list = false;
  let help = false;
  let browsers = [];
  let browserProvided = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument === "--list") {
      list = true;
    } else if (argument === "--native") {
      native = true;
    } else if (argument.startsWith("--browser=")) {
      browsers = argument.slice("--browser=".length).split(",");
      browserProvided = true;
    } else if (argument === "--browser") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error("--browser requires a comma-separated list.");
      browsers = value.split(",");
      browserProvided = true;
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option ${argument}`);
    } else {
      groups.push(argument);
    }
  }

  return { groups, native, list, help, browsers, browserProvided };
}

function normalizeBrowsers(values, provided) {
  if (!provided) return [];
  const requested = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (!requested.length) {
    throw new Error("--browser was provided with an empty selection; name at least one engine explicitly.");
  }
  for (const name of requested) {
    if (!PARSED_BROWSERS.includes(name)) {
      throw new Error(`unknown browser ${name}; supported: ${PARSED_BROWSERS.join(", ")}`);
    }
  }
  return PARSED_BROWSERS.filter((name) => requested.includes(name));
}

function expandGroups(names) {
  const requested = names.length ? names : [...DEFAULT_GROUPS];
  const groups = new Set();
  for (const name of requested) {
    if (name === "all") {
      for (const group of DEFAULT_GROUPS) groups.add(group);
    } else if (Object.hasOwn(GROUPS, name)) {
      groups.add(name);
    } else {
      throw new Error(`unknown group ${name}; expected ${Object.keys(GROUPS).join(", ")} or all`);
    }
  }
  return Object.keys(GROUPS).filter((name) => groups.has(name));
}

async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collect(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".test.mjs")) {
      files.push(absolute);
    }
  }
  return files;
}

async function discover(groups) {
  const files = [];
  for (const group of groups) {
    const absolute = path.join(PACKAGE_ROOT, GROUPS[group]);
    let found;
    try {
      found = await collect(absolute);
    } catch (error) {
      throw new Error(`cannot discover group ${group} at ${absolute}: ${error.message}`);
    }
    if (!found.length) throw new Error(`group ${group} contains no .test.mjs files at ${absolute}`);
    files.push(...found);
  }
  return [...new Set(files)].sort((left, right) => left.localeCompare(right));
}

function signalExitCode(signal) {
  const number = os.constants.signals[signal];
  return typeof number === "number" ? 128 + number : 1;
}

async function runTests(files, env, serial) {
  return new Promise((resolve, reject) => {
    const args = ["--test"];
    if (serial) args.push("--test-concurrency=1");
    args.push(...files);
    const child = spawn(process.execPath, args, {
      cwd: PACKAGE_ROOT,
      env,
      stdio: "inherit",
    });
    const forward = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    process.on("SIGINT", forward);
    process.on("SIGTERM", forward);
    child.on("error", (error) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      reject(error);
    });
    child.on("close", (code, signal) => {
      process.off("SIGINT", forward);
      process.off("SIGTERM", forward);
      resolve(signal ? signalExitCode(signal) : (code ?? 1));
    });
  });
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error.message);
    console.error(USAGE);
    return;
  }

  if (parsed.help) {
    console.log(USAGE);
    return;
  }

  let groups;
  let browsers;
  try {
    groups = expandGroups(parsed.groups);
    browsers = normalizeBrowsers(parsed.browsers, parsed.browserProvided);
  } catch (error) {
    fail(error.message);
    console.error(USAGE);
    return;
  }

  let files;
  try {
    files = await discover(groups);
  } catch (error) {
    fail(error.message);
    return;
  }

  // The legacy environment already opted into native proofs. Keep it working, but make the browser
  // defaults explicit instead of inheriting an implicit workspace fallback.
  const environmentOptIn = process.env.SMART_COLORS_NATIVE_PROOF === "1";
  let native = parsed.native || environmentOptIn || groups.includes("site");
  let legacyDefault = false;

  if (native && !browsers.length) {
    if (environmentOptIn) {
      browsers = [...LEGACY_DEFAULT_BROWSERS];
      legacyDefault = true;
    } else if (!(parsed.list && groups.includes("site"))) {
      fail("--native requires an explicit --browser=<list> (for example chromium,webkit).");
      console.error(USAGE);
      return;
    }
  }

  if (!native && browsers.length) {
    fail("--browser is only meaningful with --native or the site group.");
    console.error(USAGE);
    return;
  }

  if (parsed.native && !groups.some((group) => group === "browser" || group === "site")) {
    fail("--native requires the browser or site group; no native proof exists in the selected groups.");
    console.error(USAGE);
    return;
  }

  const unimplemented = browsers.filter((name) => !RUNNER_BROWSERS.includes(name));
  if (unimplemented.length) {
    fail(
      `browser ${unimplemented.join(", ")} has no implemented native proof in this package; ` +
      `the runner supports ${RUNNER_BROWSERS.join(", ")}. Firefox support in the product is unchanged.`,
    );
    return;
  }

  if (groups.includes("site")) {
    native = true;
    if (browsers.length && !browsers.includes("chromium")) {
      fail("the site proofs require chromium; select it explicitly with --browser=chromium.");
      return;
    }
    if (!parsed.list) {
      try {
        await assertSiteRoot(SITE_ROOT);
      } catch (error) {
        fail(error.message);
        return;
      }
    }
  }

  if (parsed.list) {
    console.log(`Smart Colors tests: ${files.length} file(s) in ${groups.join(" + ")}.`);
    console.log("List only; no tests executed; no site filesystem preflight.");
    if (legacyDefault) {
      console.log("Legacy SMART_COLORS_NATIVE_PROOF=1: browser selection defaults to chromium,webkit.");
    }
    for (const file of files) console.log(`  ${path.relative(PACKAGE_ROOT, file)}`);
    return;
  }

  console.log(`Smart Colors tests: ${files.length} file(s) in ${groups.join(" + ")}.`);
  console.log(`Native proofs: ${native ? "on" : "off"}; browsers: ${native ? browsers.join(", ") : "not used"}.`);
  if (native) console.log("Execution: serial native proofs (--test-concurrency=1).");
  if (legacyDefault) {
    console.log("Legacy SMART_COLORS_NATIVE_PROOF=1: browser selection defaults to chromium,webkit.");
  }

  const env = { ...process.env };
  // A fresh `node --test` invocation must not inherit an outer test-runner context; otherwise Node
  // treats it as a recursive run and skips every selected file.
  delete env.NODE_TEST_CONTEXT;
  if (native) {
    env.SMART_COLORS_NATIVE_PROOF = "1";
    env.SMART_COLORS_BROWSERS = browsers.join(",");
  } else {
    env.SMART_COLORS_NATIVE_PROOF = "0";
    delete env.SMART_COLORS_BROWSERS;
  }

  process.exitCode = await runTests(files, env, native);
}

main().catch((error) => {
  console.error(`Smart Colors tests: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
