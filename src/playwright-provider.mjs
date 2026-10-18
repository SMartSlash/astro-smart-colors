/**
 * Playwright provider for the Smart Colors verification adapter (plan §5.1.1, §7 SC-05).
 *
 * Discovery and import are anchored *only* to the consumer root: `createRequire` is built from
 * `<root>/package.json` and the two supported request names are resolved in order. There is no
 * global fallback and no fallback to this package's own checkout, so a consumer without Playwright
 * is reported as not found instead of silently inheriting the developer's installation.
 *
 * The four execution phases are kept distinct and structured so the caller can tell an environment
 * problem (discovery/import/availability/launch) from a measurement problem:
 *
 * - `discovery`  → the request cannot be resolved from the consumer root;
 * - `import`     → the package resolves but cannot be imported or exposes no compatible engine;
 * - `availability` → the engine binary is missing; no automatic download is ever attempted;
 * - `launch`     → the binary exists but the browser could not be started.
 *
 * `resolve`, `importModule`, `access` and `launch` are injectable so the adapter and its tests never
 * require Playwright to be installed. The module itself imports nothing browser-related, so
 * importing it (and `browser-audit.mjs` through `./audit`) never loads Playwright.
 */
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PLAYWRIGHT_REQUESTS = Object.freeze(["playwright", "@playwright/test"]);
export const PLAYWRIGHT_ENGINES = Object.freeze(["chromium", "firefox", "webkit"]);
export const PROVIDER_PHASES = Object.freeze({
  discovery: "discovery",
  import: "import",
  availability: "availability",
  launch: "launch",
});

/**
 * Resolver anchored at the consumer root only. `createRequire` derives its resolution base from the
 * file path (the file itself need not exist); resolution then walks the consumer's `node_modules`
 * upwards, never this package's own tree.
 */
export function createRootResolver(root) {
  const requireFromRoot = createRequire(path.join(path.resolve(root), "package.json"));
  return (request) => requireFromRoot.resolve(request);
}

// A CJS package may expose the browser types only through `module.exports`; an ESM one exposes them
// as named exports. Accept either, but only if at least one supported engine is really present.
function normalizeBrowsers(imported) {
  for (const candidate of [imported, imported && imported.default]) {
    if (candidate && PLAYWRIGHT_ENGINES.some((name) => candidate[name])) return candidate;
  }
  return null;
}

function safeExecutable(browserType) {
  try {
    return typeof browserType.executablePath === "function" ? browserType.executablePath() : null;
  } catch {
    return null;
  }
}

function failure(phase, cause, message, extra = {}) {
  return { ok: false, phase, cause, message, ...extra };
}

/**
 * Provider factory. Returns a small object whose methods are the only Playwright touch points:
 * `open()` performs discovery + import once and caches the result, `availability(name)` checks the
 * engine binary, `launch(name, options)` starts the browser without logging anything.
 */
export function createPlaywrightProvider(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const requests = Array.isArray(options.requests) && options.requests.length ? [...options.requests] : [...PLAYWRIGHT_REQUESTS];
  const resolvePackage = options.resolve ?? createRootResolver(root);
  const importModule = options.importModule ?? ((url) => import(url));
  const accessBinary = options.access ?? access;
  const launchBrowser = options.launch ?? ((name, browserType, launchOptions) => browserType.launch(launchOptions));
  let opened = null;

  async function discover() {
    let request = null;
    let resolved = null;
    let discoveryCause = null;
    for (const candidate of requests) {
      try {
        resolved = resolvePackage(candidate);
        request = candidate;
        break;
      } catch (cause) {
        discoveryCause = cause;
      }
    }
    if (request === null) {
      // Brief, structured, non-imperative: browser measurement is optional, so absence is a cause the
      // caller can report without nagging. The root stays in the message (the effective consumer).
      return failure(PROVIDER_PHASES.discovery, "playwright-not-found",
        `Playwright non trovato nel consumer ${root}: le misure browser restano opzionali e non bloccanti.`,
        { request: null, resolved: null, detail: discoveryCause ? discoveryCause.message : null });
    }
    let imported;
    try {
      imported = await importModule(pathToFileURL(resolved).href);
    } catch (cause) {
      return failure(PROVIDER_PHASES.import, "import-failed",
        `Playwright è risolto (${request}) ma non è importabile da ${resolved}: ${cause && cause.message ? cause.message : cause}`,
        { request, resolved, detail: cause && cause.message ? cause.message : String(cause) });
    }
    const browsers = normalizeBrowsers(imported);
    if (browsers === null) {
      return failure(PROVIDER_PHASES.import, "import-incompatible",
        `Il modulo Playwright risolto (${request}) non espone nessun motore compatibile (${PLAYWRIGHT_ENGINES.join(", ")}).`,
        { request, resolved });
    }
    return { ok: true, request, resolved, browsers };
  }

  async function open() {
    if (opened === null) opened = await discover();
    return opened;
  }

  async function availability(name) {
    const state = await open();
    if (!state.ok) {
      return { name, available: false, phase: state.phase, cause: state.cause, message: state.message, executable: null };
    }
    const browserType = state.browsers[name];
    if (!browserType || typeof browserType.executablePath !== "function") {
      return {
        name, available: false, phase: PROVIDER_PHASES.availability, cause: "engine-unknown", executable: null,
        message: `${name}: il modulo Playwright risolto (${state.request}) non espone questo motore.`,
      };
    }
    let executable;
    try {
      executable = browserType.executablePath();
    } catch (cause) {
      return {
        name, available: false, phase: PROVIDER_PHASES.availability, cause: "executable-path-failed", executable: null,
        message: `${name}: impossibile determinare il percorso del binario (${cause && cause.message ? cause.message : cause}).`,
      };
    }
    try {
      await accessBinary(executable);
    } catch (cause) {
      return {
        name, available: false, phase: PROVIDER_PHASES.availability, cause: "binary-missing", executable,
        message: `${name}: browser binary unavailable at ${executable}. Install it explicitly with pnpm exec playwright install ${name}, then rerun this script. No automatic download is performed.`,
        detail: cause && cause.message ? cause.message : String(cause),
      };
    }
    return { name, available: true, executable };
  }

  async function launch(name, launchOptions = {}) {
    const state = await open();
    if (!state.ok) {
      const error = new Error(state.message);
      error.phase = state.phase;
      error.cause = state;
      throw error;
    }
    const browserType = state.browsers[name];
    if (!browserType || typeof browserType.launch !== "function") {
      const error = new Error(`${name}: il modulo Playwright risolto (${state.request}) non espone questo motore.`);
      error.phase = PROVIDER_PHASES.launch;
      throw error;
    }
    const launchOptionsResolved = { headless: true, timeout: Number.isFinite(launchOptions.timeout) ? launchOptions.timeout : 15000 };
    if (Array.isArray(launchOptions.args)) launchOptionsResolved.args = launchOptions.args;
    try {
      return await launchBrowser(name, browserType, launchOptionsResolved);
    } catch (cause) {
      const executable = safeExecutable(browserType);
      const error = new Error(`${name}: binary exists but launch failed${executable ? ` at ${executable}` : ""}. Inspect the cause below for sandbox permissions, system dependencies or a launch timeout; rerun in an environment that permits this browser. No automatic download is performed.`);
      error.phase = PROVIDER_PHASES.launch;
      error.cause = cause;
      throw error;
    }
  }

  async function close() {
    opened = null;
  }

  return {
    root,
    requests,
    engines: [...PLAYWRIGHT_ENGINES],
    phases: PROVIDER_PHASES,
    open,
    availability,
    launch,
    close,
  };
}
