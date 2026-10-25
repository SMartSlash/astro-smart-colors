/**
 * Shared Playwright discovery and engine selection for the opt-in browser proofs.
 *
 * Resolution is package-local by default and may use an explicitly configured consumer root. There
 * is no implicit fallback to `../../..`: a flat package clone works, and a missing module or engine
 * is a BLOCKED failure, never a silent skip and never an install or download.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { PACKAGE_ROOT } from "./roots.mjs";

export const SUPPORTED_ENGINES = Object.freeze(["chromium", "firefox", "webkit"]);

function requestedEngines() {
  const raw = process.env.SMART_COLORS_BROWSERS;
  if (!raw || !raw.trim()) return null;
  const requested = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
  for (const name of requested) {
    if (!SUPPORTED_ENGINES.includes(name)) {
      throw new Error(`Unknown browser "${name}" in SMART_COLORS_BROWSERS. Supported: ${SUPPORTED_ENGINES.join(", ")}.`);
    }
  }
  return requested;
}

/**
 * Intersect the engines a proof requires with the explicit selection. When no selection is present,
 * the proof keeps its own required engines. An empty intersection is an explicit, visible skip.
 */
export function browserSelection(required) {
  const normalized = [...new Set(required)];
  for (const name of normalized) {
    if (!SUPPORTED_ENGINES.includes(name)) throw new Error(`Unsupported required browser "${name}".`);
  }
  const requested = requestedEngines();
  if (requested === null) {
    return { engines: normalized, explicit: false, requested: null, skip: false };
  }
  const engines = normalized.filter((name) => requested.includes(name));
  return {
    engines,
    explicit: true,
    requested,
    skip: engines.length
      ? false
      : `not selected: requires ${normalized.join(", ")}; selected ${requested.join(", ")}`,
  };
}

/** Declare a filtered run in the TAP diagnostics, so a subset is never read as full coverage. */
export function declareSelection(t, selection) {
  if (!selection.explicit) return;
  const selected = selection.engines.length ? selection.engines.join(", ") : "none";
  t.diagnostic(`browser selection: ${selected}; requested ${selection.requested.join(", ")}`);
}

function candidateRoots() {
  const roots = [];
  if (process.env.SMART_COLORS_PLAYWRIGHT_ROOT) roots.push(path.resolve(process.env.SMART_COLORS_PLAYWRIGHT_ROOT));
  roots.push(PACKAGE_ROOT);
  if (process.env.SMART_COLORS_SITE_ROOT) roots.push(path.resolve(process.env.SMART_COLORS_SITE_ROOT));
  return [...new Set(roots)];
}

/** The consumer root used when a proof asks the product to discover Playwright itself. */
export function discoveryRoot() {
  return process.env.SMART_COLORS_PLAYWRIGHT_ROOT
    ? path.resolve(process.env.SMART_COLORS_PLAYWRIGHT_ROOT)
    : PACKAGE_ROOT;
}

/**
 * Resolve an already installed Playwright that provides every selected engine.
 * Returns the browser types plus the discovery evidence; nothing is installed or downloaded.
 */
export function loadPlaywright(required = ["chromium"]) {
  const selection = browserSelection(required);
  if (!selection.engines.length) {
    throw new Error(`BLOCKED: the browser selection excludes ${required.join(", ")} (selected ${selection.requested.join(", ")}).`);
  }

  const roots = candidateRoots();
  const failures = [];
  for (const root of roots) {
    let require;
    try {
      require = createRequire(path.join(root, "package.json"));
    } catch (error) {
      failures.push(`${root}: ${error.message}`);
      continue;
    }
    for (const request of ["@playwright/test", "playwright"]) {
      try {
        const api = require(request);
        const browsers = api && api.chromium ? api : api && api.default && api.default.chromium ? api.default : null;
        if (!browsers) {
          failures.push(`${request} at ${root}: no supported engine export`);
          continue;
        }
        const missing = selection.engines.filter((name) => !browsers[name]);
        if (missing.length) {
          failures.push(`${request} at ${root}: missing ${missing.join(", ")}`);
          continue;
        }
        let resolved = root;
        try {
          resolved = require.resolve(request);
        } catch {
          // A consumer can expose Playwright through a loader; the root remains the evidence.
        }
        return { request, resolved, browsers, engines: selection.engines, selection };
      } catch (error) {
        failures.push(`${request} at ${root}: ${error.message}`);
      }
    }
  }

  throw new Error(
    `BLOCKED: no installed Playwright provides ${selection.engines.join(", ")}. ` +
    `Tried ${roots.join(", ")}. Set SMART_COLORS_PLAYWRIGHT_ROOT to an explicit consumer root; ` +
    `nothing is installed or downloaded. ${failures.slice(0, 4).join(" | ")}`,
  );
}

/** Browser types only, for proofs that do not need the discovery evidence. */
export function resolvePlaywright(required = ["chromium"]) {
  return loadPlaywright(required).browsers;
}
