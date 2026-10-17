import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { contrast } from "./color-math.mjs";
import { analyzeColorTokens, generateColorTokens } from "./generate-colors.mjs";
import { loadSmartColorsConfig } from "./load-config.mjs";
import { parseOklch } from "./parse-palette.mjs";
import { writeContrastReport } from "./report-artifact.mjs";
import { assertReportInputsUnchanged, captureReportInputs, darkFillTuningIdentity, formatReportSummary, mergeSideEffect, paletteOverrideNote, proposalImproves, publishedProposal, reportCandidates, reportOverlapScenario, reportScenario, reportSideEffect, reportSnapshot, structuralChanges, REPORT_FILES } from "./report-data.mjs";

export const SUPPORTED_BROWSERS = ["chromium", "firefox", "webkit"];

const TOLERANCE = 0.0001;
const DEFAULT_IDENTITIES = ["primary", "secondary", "info"];
const FAMILY = ["surface", "surface-strong", "border", "border-strong", "solid", "solid-hover", "on-solid", "text", "text-strong"];
// Only opaque control consumers are in scope; translucent borders/icons are not.
const CONTROLS = ["bg", "bg-active", "border-active", "active-text", "focus-bg"];

export function hue(value) { return ((value % 360) + 360) % 360; }

export function close(actual, expected, label, tolerance = TOLERANCE) {
  for (const channel of ["l", "c", "h"]) {
    assert.ok(Number.isFinite(actual[channel]), `${label}: non-finite ${channel}`);
    const difference = channel === "h"
      ? Math.min(Math.abs(hue(actual.h) - hue(expected.h)), 360 - Math.abs(hue(actual.h) - hue(expected.h)))
      : Math.abs(actual[channel] - expected[channel]);
    assert.ok(difference <= tolerance, `${label}: ${channel}=${actual[channel]}, expected ${expected[channel]} (delta ${difference}, max ${tolerance})`);
  }
}

export function source(value, label) {
  assert.ok(!value.includes("/"), `${label}: alpha colors are outside this fixture's scope`);
  const parsed = parseOklch(value);
  assert.deepEqual(parsed.errors, [], `${label}: invalid computed/emitted OKLCH ${value}`);
  assert.ok(parsed.source, `${label}: no source coordinates`);
  // .color gamut-maps; .source preserves native CSS interpolation coordinates.
  return parsed.source;
}

export function pairsFor(scheme, identities = DEFAULT_IDENTITIES, decoratives = []) {
  const pairs = [];
  const add = (label, foreground, background, kind, property = "color", warning = false) => pairs.push({ label: `${scheme} ${label}`, foreground, background, kind, property, warning });
  for (const [name, token] of [["neutral text", "text"], ["muted text", "text-muted"], ["focus", "focus-ring"]]) {
    const focus = name === "focus";
    add(`${name} / canvas`, `--color-${token}`, "--color-bg", focus ? "ui" : "text", focus ? "outlineColor" : "color");
    add(`${name} / surface`, `--color-${token}`, "--color-surface", focus ? "ui" : "text", focus ? "outlineColor" : "color");
  }
  for (const name of identities) {
    for (const [label, background] of [["canvas", "--color-bg"], ["neutral surface", "--color-surface"], ["family surface", `--color-${name}-surface`], ["family surface strong", `--color-${name}-surface-strong`]]) {
      for (const suffix of ["text", "text-strong", "border-strong"]) {
        const border = suffix === "border-strong";
        add(`${name}-${suffix} / ${label}`, `--color-${name}-${suffix}`, background, border ? "family-ui" : "text", border ? "borderColor" : "color");
      }
    }
    add(`on-${name} / ${name}`, `--color-on-${name}`, `--color-${name}`, "on-color", "color", true);
    for (const state of ["solid", "solid-hover"]) {
      add(`${name}-on-solid / ${state}`, `--color-${name}-on-solid`, `--color-${name}-${state}`, "on-color", "color", true);
    }
  }
  for (const name of decoratives) {
    add(`on-${name} / ${name}`, `--color-on-${name}`, `--color-${name}`, "on-color", "color", true);
  }
  add("control active text / active background", "--color-control-active-text", "--color-control-bg-active", "text", "color", true);
  add("control text / focus background", "--color-text", "--color-control-focus-bg", "text", "color", true);
  add("control active border / canvas", "--color-control-border-active", "--color-bg", "ui", "borderColor", true);
  add("control active border / active background", "--color-control-border-active", "--color-control-bg-active", "ui", "borderColor", true);
  assert.equal(new Set(pairs.map(({ label }) => label)).size, pairs.length, "Consumer pair labels must be unique");
  return pairs;
}

export function pairTarget(config, scheme, kind) {
  if (kind === "on-color") return config.contrast.onColor;
  if (kind === "ui") return config.contrast.ui;
  const base = kind === "family-ui" ? config.contrast.ui : config.contrast.text;
  return scheme === "light" ? base : Math.min(config.contrast.maxIdentity, base * config.contrast.darkRichness);
}

export function warningStatus(ratio, target, minimum) {
  return ratio < minimum ? "below-minimum" : ratio < target ? "below-target" : "pass";
}

export async function computedTheme(page, report, scheme, withScales, options = {}) {
  const { identities = DEFAULT_IDENTITIES, decoratives = [], tuningCss = "", colorParser = source } = options;
  assert.ok(!/@import\b/i.test(tuningCss.replace(/\/\*[\s\S]*?\*\//g, "")), "Tuning @import is unsupported by this inline offline audit; imported overrides must not be silently omitted.");
  const tokens = ["--color-bg", "--color-surface", "--color-text", "--color-text-muted", "--color-focus-ring",
    ...CONTROLS.map((suffix) => `--color-control-${suffix}`),
    ...identities.flatMap((name) => [`--color-${name}`, `--color-on-${name}`, ...FAMILY.map((suffix) => `--color-${name}-${suffix}`), ...(withScales ? [`--color-${name}-500`] : [])]),
    ...decoratives.flatMap((name) => [`--color-${name}`, `--color-on-${name}`])];
  const pairs = pairsFor(scheme, identities, decoratives);
  await page.emulateMedia({ colorScheme: options.preference ?? scheme });
  await page.setContent('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Smart Colors regression fixture</title></head><body><main></main></body></html>', { timeout: 15000 });
  // Same layer and source order as global.css: generated first, tuning second.
  await page.addStyleTag({ content: `@layer tokens {\n${report.css}\n}\n@layer tokens {\n${tuningCss}\n}` });
  const result = await page.evaluate(({ scheme, tokens, pairs, themeAttribute }) => {
    document.documentElement.style.colorScheme = scheme;
    if (themeAttribute) document.documentElement.dataset.theme = scheme;
    const main = document.querySelector("main");
    const rootStyle = getComputedStyle(document.documentElement);
    for (const token of tokens) {
      const resolved = rootStyle.getPropertyValue(token).trim();
      if (!resolved || !CSS.supports("color", resolved)) {
        throw new Error(`${scheme} ${token}: missing or invalid resolved color (${resolved}); inherited/default colors cannot count as a pass.`);
      }
    }
    const read = (foreground, background, text, property = "color") => {
      const element = document.createElement(text.includes("control ") ? "button" : "div");
      if (element instanceof HTMLButtonElement) element.type = "button";
      element.textContent = text;
      element.style[property] = `var(${foreground})`;
      element.style.backgroundColor = `var(${background})`;
      if (property === "borderColor") element.style.borderStyle = "solid";
      if (property === "outlineColor") element.style.outlineStyle = "solid";
      main.append(element);
      const computed = getComputedStyle(element);
      return { foreground: computed[property], background: computed.backgroundColor };
    };
    return {
      scheme: getComputedStyle(document.documentElement).colorScheme,
      tokens: Object.fromEntries(tokens.map((token) => [token, read(token, token, token)])),
      pairs: pairs.map((pair) => ({ ...pair, computed: read(pair.foreground, pair.background, pair.label, pair.property) })),
    };
  }, { scheme, tokens, pairs, themeAttribute: options.themeAttribute ?? false });
  assert.equal(result.scheme, scheme);
  return {
    tokens: new Map(Object.entries(result.tokens).map(([token, value]) => {
      const foreground = colorParser(value.foreground, `${scheme} ${token} foreground`);
      close(colorParser(value.background, `${scheme} ${token} background`), foreground, `${scheme} ${token} both properties`);
      return [token, foreground];
    })),
    pairs: result.pairs.map((pair) => ({ ...pair, foregroundColor: colorParser(pair.computed.foreground, pair.label), backgroundColor: colorParser(pair.computed.background, pair.label) })),
  };
}

function hasAlphaChannel(value) {
  if (value.includes("/")) return true;
  const rgba = /^rgba\(([^)]*)\)$/i.exec(value);
  if (!rgba) return false;
  const alpha = rgba[1].split(/[\s,]+/).filter(Boolean)[3];
  if (alpha == null) return false;
  const number = alpha.endsWith("%") ? Number(alpha.slice(0, -1)) / 100 : Number(alpha);
  return Number.isFinite(number) && number < 1;
}

function srgbChannels(value, label) {
  const srgb = value.startsWith("color(srgb ");
  const body = value.slice(value.indexOf("(") + 1, -1).trim().replace(/^srgb\s+/i, "");
  const parts = body.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  assert.equal(parts.length, 3, `${label}: invalid computed color ${value}`);
  return parts.map((part) => {
    const number = Number(part.endsWith("%") ? part.slice(0, -1) / 100 : part);
    assert.ok(Number.isFinite(number), `${label}: invalid computed color ${value}`);
    return srgb ? number : number / 255;
  });
}

function srgbToLinear(channels) {
  return channels.map((u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
}

// The browser resolves CSS; this parses its serialization without Color.js.
// Ratios use the same clipped-sRGB WCAG reference as the generator.
export function auditColor(value, label) {
  const serialized = String(value);
  assert.ok(!hasAlphaChannel(serialized), `${label}: translucent colors are outside this audit's scope`);

  if (serialized.startsWith("oklch(")) {
    const parsed = parseOklch(serialized);
    assert.deepEqual(parsed.errors, [], `${label}: invalid computed color ${serialized}`);
    assert.ok(parsed.source, `${label}: no source coordinates`);
    return { l: parsed.source.l, c: parsed.source.c, h: Number.isFinite(parsed.source.h) ? parsed.source.h : 0 };
  }

  if (serialized.startsWith("rgb(") || serialized.startsWith("rgba(") || serialized.startsWith("color(srgb ")) {
    const [r, g, b] = srgbToLinear(srgbChannels(serialized, label));
    const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const l = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    const c = Math.hypot(a, b_);
    const rawHue = c <= 1e-10 ? 0 : (Math.atan2(b_, a) * 180) / Math.PI;
    const hueAngle = rawHue < 0 ? rawHue + 360 : (rawHue === 0 ? 0 : rawHue);
    assert.ok(Number.isFinite(l) && Number.isFinite(c), `${label}: invalid computed color ${serialized}`);
    return { l: Math.min(1, Math.max(0, l)), c, h: hueAngle };
  }

  throw new assert.AssertionError({ message: `${label}: unsupported computed color ${serialized}` });
}

export function auditPairs(report, computed, scheme) {
  return computed.pairs.map((pair) => {
    const ratio = contrast(pair.foregroundColor, pair.backgroundColor);
    const target = pairTarget(report.config, scheme, pair.kind);
    const minimum = ["ui", "family-ui"].includes(pair.kind) ? 3 : 4.5;
    assert.ok(Number.isFinite(ratio), `${pair.label}: non-finite contrast`);
    return { ...pair, ratio, target, minimum, status: warningStatus(ratio, target, minimum) };
  });
}

export function canonicalRoot(css) {
  // Accept presentation-only drift, not different selectors, duplicate
  // declarations, priorities or rules that might change the cascade.
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const match = /^:root\s*\{([^{}]*)\}\s*$/.exec(uncommented);
  assert.ok(match, "Expected exactly one generated :root rule; other rule structures require regeneration");
  const entries = match[1].split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf(":");
    assert.ok(separator > 0, `Invalid generated declaration ${part}`);
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  });
  assert.equal(new Set(entries.map(([name]) => name)).size, entries.length, "Duplicate generated declarations require regeneration");
  return entries.sort(([a], [b]) => a.localeCompare(b));
}

// The same discard is observed by every requested browser: publish each reason once.
export function uniqueRejections(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.id}\u0000${entry.file}\u0000${entry.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadPlaywright(name, root) {
  const bases = [
    () => createRequire(path.resolve(root, "package.json")),
    () => createRequire(import.meta.url),
  ];

  for (const base of bases) {
    for (const request of ["playwright", "@playwright/test"]) {
      try {
        const imported = await import(pathToFileURL(base().resolve(request)).href);
        // CJS packages may expose the browser types only through module.exports.
        return imported.chromium ? imported : (imported.default ?? imported);
      } catch {
        // Try the next package/base; a standalone clone may have neither installed.
      }
    }
  }

  throw new Error(`Playwright non trovato per avviare ${name}. Installa playwright o @playwright/test nel progetto ed esegui: pnpm exec playwright install ${name}`);
}

export async function launch(name, root = process.cwd()) {
  assert.ok(SUPPORTED_BROWSERS.includes(name), `Unknown browser ${name}. Supported browsers: ${SUPPORTED_BROWSERS.join(", ")}.`);
  const playwright = await loadPlaywright(name, root);
  const browserType = playwright[name];
  assert.ok(browserType, `Unknown browser ${name}. Supported browsers: ${SUPPORTED_BROWSERS.join(", ")}.`);
  const executable = browserType.executablePath();
  try {
    await access(executable);
  } catch (cause) {
    throw new Error(`${name}: browser binary unavailable at ${executable}. Install it explicitly with pnpm exec playwright install ${name}, then rerun this script. No automatic download is performed.`, { cause });
  }
  try {
    const browser = await browserType.launch({ headless: true, timeout: 15000 });
    console.log(`${name}: launched ${browser.version()} (${executable})`);
    return browser;
  } catch (cause) {
    throw new Error(`${name}: binary exists but launch failed at ${executable}. Inspect the cause below for sandbox permissions, system dependencies or a launch timeout; rerun in an environment that permits this browser. No automatic download is performed.`, { cause });
  }
}

export async function projectAudit(names = ["chromium"], { root = process.cwd(), configFile, emitReport = false } = {}) {
  const tuningPath = "src/styles/tokens/colors-tuning.css";
  let analysis;
  let loadedConfig;
  let capturedInputs;
  let snapshot;
  try {
    // Keep configured input paths even if subsequent palette validation fails.
    // An owned report may have become an input since its previous generation.
    if (emitReport) {
      loadedConfig = await loadSmartColorsConfig({ root, configFile });
      capturedInputs = await captureReportInputs(root, loadedConfig);
    }
    const report = emitReport
      ? (analysis = await analyzeColorTokens({ root, config: loadedConfig }, capturedInputs.inputs.find(([name]) => name === "palette")[2]))
      : await generateColorTokens({ root, configFile, check: true, suggest: false });
    if (emitReport) snapshot = await reportSnapshot(root, analysis, capturedInputs);
    let diskCss = null;
    if (emitReport) {
      const outputInput = capturedInputs.inputs.find(([name]) => name === "output");
      diskCss = outputInput[3] ? outputInput[2] : null;
    } else {
      diskCss = await readFile(path.join(root, report.config.output), "utf8");
    }
    let equivalent = false;
    try { equivalent = diskCss !== null && JSON.stringify(canonicalRoot(diskCss)) === JSON.stringify(canonicalRoot(report.css)); }
    catch (error) { if (!emitReport) throw error; }
    if (!emitReport) assert.ok(equivalent, "Generated token declarations differ from current config/palette. Run pnpm colors:build before auditing; nothing was written.");
    if (equivalent && diskCss !== report.css) console.log("NOTICE: generated file differs only in comments/order/formatting; auditing the unchanged CSS on disk. colors:check still requires exact output.");
    const auditReport = { ...report, css: equivalent ? diskCss : report.css };
    if (emitReport) {
      snapshot.notes.push(equivalent
        ? "Misurato il CSS generato realmente presente su disco; nessun output colore sovrascritto."
        : "Output su disco assente o diverso dagli input attuali: misurato CSS diagnostico generato in memoria, non salvato né approvato come output di produzione.");
      if (!equivalent) console.warn("[smart-colors] Output colore assente o diverso: le misure riguardano CSS diagnostico in memoria, non il file di produzione. Rigenera con pnpm colors:build dopo aver valutato gli esiti.");
      snapshot.notes.push("Riferimento WCAG clipped-sRGB su stili opachi risolti dal browser; non misura i pixel di screenshot o certifica l'accessibilità complessiva. Alias, scale/hue, alpha, forced-colors e stili locali dei componenti sono esclusi.");
    }
    const tuningInput = capturedInputs?.inputs.find(([name]) => name === "tuning");
    if (emitReport && !tuningInput[3]) throw new Error(`Missing tuning file ${tuningPath}; no browser audit was completed.`);
    const tuningCss = emitReport ? tuningInput[2] : await readFile(path.join(root, tuningPath), "utf8");
    const options = {
      identities: Object.keys(report.config.roles.identities), decoratives: Object.keys(report.config.roles.decoratives),
      colorParser: auditColor, themeAttribute: true,
    };
    let belowMinimum = 0;
    let candidates;
    const verified = new Map();
    // Attempted-but-discarded candidates: the file and the reason are published
    // with the snapshot so "no palette.css proposal" is never silent.
    const rejectedSources = [];
    for (const name of names) {
      const browser = await launch(name, root);
      try {
        const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
        await context.route("**/*", (route) => route.abort());
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const states = [];
        let pairCount = 0;
        let shortfalls = 0;
        console.log(`AUDIT ${name}: ${report.config.output} → ${tuningPath}; clipped-sRGB WCAG reference from opaque computed styles, not a full accessibility audit.`);
        for (const [scheme, preference] of [["light", "light"], ["light", "dark"], ["dark", "light"], ["dark", "dark"]]) {
          const scenario = { ...options, preference };
          const baseline = auditPairs(auditReport, await computedTheme(page, auditReport, scheme, false, scenario), scheme);
          const computed = await computedTheme(page, auditReport, scheme, false, { ...scenario, tuningCss });
          const tuned = auditPairs(auditReport, computed, scheme);
          states.push({ scheme, preference, baseline, tuned, computed });
          if (emitReport) {
            snapshot.scenarios.push(reportScenario(name, scheme, preference, tuned, baseline));
            snapshot.overlaps.push(reportOverlapScenario(name, scheme, preference, computed.tokens, [...new Set([...options.identities, ...options.decoratives])]));
          }
          assert.deepEqual(tuned.map((pair) => pair.label), baseline.map((pair) => pair.label));
          const failures = tuned.filter((pair) => pair.status !== "pass");
          const minimumFailures = failures.filter((pair) => pair.status === "below-minimum");
          const newFailures = failures.filter((pair) => baseline.find((before) => before.label === pair.label).status === "pass");
          console.log(`  theme=${scheme}, preference=${preference}: ${tuned.length} pairs; baseline ${baseline.filter((pair) => pair.status !== "pass").length} shortfalls → tuned ${failures.length} (${newFailures.length} new, ${minimumFailures.length} below-minimum).`);
          for (const pair of emitReport ? [] : failures) {
            const before = baseline.find((entry) => entry.label === pair.label);
            console.log(`  ${pair.status}: ${pair.label}; ${pair.foreground} on ${pair.background}; ${pair.ratio}:1, target ${pair.target}:1, minimum ${pair.minimum}:1; baseline ${before.ratio}:1 (${before.status}).`);
            console.log(`    Computed foreground ${pair.computed.foreground}; background ${pair.computed.background}`);
          }
          pairCount += tuned.length;
          shortfalls += failures.length;
          belowMinimum += minimumFailures.length;
        }
        if (emitReport) {
          candidates ??= await reportCandidates(root, analysis, tuningCss, states, rejectedSources);
          for (const candidate of candidates) {
            const result = verified.get(candidate.id) ?? { valid: true, browsers: 0, checks: [], sideEffects: [], changes: [] };
            try {
              const before = [], after = [];
              // Dark-fill escape hatches share `--_color-<id>-dark` with the family
              // border alias, so they also move the unmeasured border pairs on both
              // neutral surfaces. In dark the surface is lighter than the canvas, so
              // each background keeps its own before/after comparison and the worst
              // case is aggregated per (identity, background). Both borders are read
              // from resolved themes — the audited current state (`state.computed`,
              // current tuning) and the candidate theme (candidate tuning) — and stay
              // information only: they never enter checks, validity, counts, filters
              // or the exit code.
              const identity = darkFillTuningIdentity(candidate.destination);
              for (const state of states) {
                const computed = await computedTheme(page, { ...auditReport, css: candidate.css }, state.scheme, false, { ...options, preference: state.preference, tuningCss: candidate.tuningCss });
                const rows = auditPairs(auditReport, computed, state.scheme);
                // Structural proposals change tokens the generator recomputes, so
                // their before/after colors are read from this measurement, with the
                // foregrounds of the fixed pairs leading the list.
                if (candidate.kind === "config") {
                  for (const change of structuralChanges(state.tuned, rows, candidate.issueLabels, 4 - result.changes.length)) {
                    if (!result.changes.some((entry) => entry.label === change.label)) result.changes.push(change);
                  }
                }
                before.push(...state.tuned);
                after.push(...rows);
                result.checks.push(...reportScenario(name, state.scheme, state.preference, rows, state.tuned, "browser-proposal").diagnostics);
                if (identity && state.scheme === "dark") {
                  const border = `--color-${identity}-border`;
                  for (const background of ["--color-bg", "--color-surface"]) {
                    const entry = reportSideEffect(identity,
                      { color: state.computed.tokens.get(border), background: state.computed.tokens.get(background) },
                      { color: computed.tokens.get(border), background: computed.tokens.get(background) },
                      background);
                    if (entry) result.sideEffects = mergeSideEffect(result.sideEffects, entry);
                  }
                }
              }
              result.valid &&= proposalImproves(before, after, candidate.issueLabels);
              result.browsers += 1;
            } catch (error) {
              result.valid = false;
              snapshot.notes.push(`Proposta ${candidate.id} non pubblicata: verifica incompleta (${error.message}).`);
            }
            verified.set(candidate.id, result);
            if (!result.valid) {
              // A palette.css alternative that clears the model can still fail in the
              // browser: keep the reason, plus the runtime override that keeps
              // re-applying the loss to the text tokens the build computed.
              const note = candidate.destination.file === REPORT_FILES.palette ? paletteOverrideNote(analysis, tuningCss) : "";
              rejectedSources.push({ id: candidate.id, file: candidate.destination.file, reason: `verifica browser nei quattro scenari tema/preferenza senza miglioramento completo o con regressioni${note}` });
            }
          }
          snapshot.notes.push(`${name} ${browser.version()}: verificati quattro scenari tema/preferenza.`);
        }
        console.log(`AUDIT ${name}: ${pairCount} tuned pair measurements across 4 theme/preference scenarios, ${shortfalls} shortfalls. Compare baseline/tuning before changing palette or ${tuningPath}; no fixes applied.`);
      } finally { await browser.close(); }
    }
    if (emitReport) {
      snapshot.rejectedSources = uniqueRejections(rejectedSources);
      snapshot.proposals = candidates.filter((candidate) => {
        const result = verified.get(candidate.id);
        return result?.valid && result.browsers === names.length;
      }).map((candidate) => publishedProposal(candidate, verified.get(candidate.id)));
    }
    if (diskCss !== null) assert.equal(await readFile(path.join(root, report.config.output), "utf8"), diskCss);
    assert.equal(await readFile(path.join(root, tuningPath), "utf8"), tuningCss);
    if (belowMinimum || analysis?.errors.length) process.exitCode = 1;
    console.log("Scope: neutral/family/direct/decorative and opaque control pairs in light/dark. Excludes alpha, aliases, scales/hue choices, forced colors and component/local overrides. Below-target is advisory; below-minimum exits 1. Generated checks/build behavior is unchanged.");
  } catch (error) {
    if (!emitReport || !loadedConfig || error.code === "SMART_COLORS_INPUTS_CHANGED") throw error;
    snapshot ??= await reportSnapshot(root, analysis ?? { config: loadedConfig, errors: [] }, capturedInputs);
    snapshot.auditErrors.push(error.message);
    snapshot.proposals = [];
    process.exitCode = 1;
    console.error(`[smart-colors] Audit incompleto: ${error.message}`);
  }
  if (emitReport) {
    await assertReportInputsUnchanged(root, capturedInputs);
    // One snapshot, one write pass: the compact preview is published with the full report.
    const output = await writeContrastReport({ root, report: snapshot, config: analysis?.config ?? loadedConfig, preview: true });
    console.log(`[smart-colors] HTML report: ${output.reportPath}`);
    console.log(`[smart-colors] HTML preview: ${output.previewPath}`);
    for (const line of formatReportSummary(snapshot).split("\n")) console.log(`[smart-colors] ${line}`);
    console.log(`[smart-colors] Apri l’anteprima appena generata per vedere campioni e modifiche proposte: ${pathToFileURL(output.previewPath).href}`);
    console.log("[smart-colors] Snapshot statico: dopo ogni modifica rigenera con pnpm colors:report. Palette, config, tuning e token generati non modificati.");
  } else {
    console.log("[smart-colors] Per vedere gli abbinamenti e le proposte: esegui pnpm colors:report, poi apri reports/smart-colors-preview.html. Un report precedente potrebbe essere obsoleto.");
  }
}
