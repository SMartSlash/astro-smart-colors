/**
 * Pure verification core and shared numeric contract (plan §5.1.1).
 *
 * `createVerificationCore()` is a self-contained factory: every helper it uses
 * is declared inside it, so `createVerificationCore.toString()` can be embedded
 * and re-created in an isolated realm with no imports, no `node:*` and no
 * Playwright reference. Only JavaScript built-ins are used.
 *
 * The same factory is also the single origin of the color math: `./color-math.mjs`
 * re-exports these functions, so the generator and the verifier share one
 * implementation and cannot drift apart. The formulas, precision and the exact
 * threshold classification are unchanged from the generator/legacy audit.
 *
 * The returned members are deliberately plain and serializable (no functions in
 * the data produced by `createContract`/`measurePair`/`coverage`).
 */
export function createVerificationCore() {
  // ---------------------------------------------------------------------------
  // Shared numeric contract.
  // Moved verbatim from ./color-math.mjs: same signatures, same formulas, same
  // rounding-free output. The file re-exports these names.
  // ---------------------------------------------------------------------------

  // Adding 360 to an already positive hue moves the value into a higher binary
  // exponent and loses low mantissa bits (86.83 became 86.82999999999998).
  // Keep the identity exact for in-range hues; only negative remainders shift.
  function normalizeHue(hue) {
    const remainder = hue % 360;
    if (remainder < 0) return remainder + 360;
    return remainder === 0 ? 0 : remainder;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    return Number(value.toFixed(4)).toString();
  }

  function oklchToLinearSrgbRaw({ l, c, h }) {
    const hue = (h * Math.PI) / 180;
    const a = c * Math.cos(hue);
    const b = c * Math.sin(hue);

    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.291485548 * b;

    const L = l_ ** 3;
    const M = m_ ** 3;
    const S = s_ ** 3;

    return [
      4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
      -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
      -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
    ];
  }

  function oklchToLinearSrgb(color) {
    return oklchToLinearSrgbRaw(color).map((channel) => clamp(channel, 0, 1));
  }

  function isInSrgbGamut(color) {
    const [r, g, b] = oklchToLinearSrgbRaw(color);
    return r >= 0 && r <= 1 && g >= 0 && g <= 1 && b >= 0 && b <= 1;
  }

  function fitToSrgb(color) {
    const normalized = {
      l: clamp(color.l, 0, 1),
      c: Math.max(0, color.c),
      h: normalizeHue(color.h),
    };

    if (isInSrgbGamut(normalized)) return normalized;

    let low = 0;
    let high = normalized.c;

    for (let i = 0; i < 32; i += 1) {
      const mid = (low + high) / 2;
      const candidate = { ...normalized, c: mid };

      if (isInSrgbGamut(candidate)) {
        low = mid;
      } else {
        high = mid;
      }
    }

    return { ...normalized, c: low };
  }

  function relativeLuminance(color) {
    const [r, g, b] = oklchToLinearSrgb(color);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrast(a, b) {
    const aLum = relativeLuminance(a);
    const bLum = relativeLuminance(b);
    const light = Math.max(aLum, bLum);
    const dark = Math.min(aLum, bLum);
    return (light + 0.05) / (dark + 0.05);
  }

  function oklch(color) {
    return `oklch(${formatNumber(color.l)} ${formatNumber(color.c)} ${formatNumber(color.h)})`;
  }

  function serializedColor(color) {
    return Object.fromEntries(["l", "c", "h"].map((channel) => [channel, Number(formatNumber(color[channel]))]));
  }

  // Opaque CSS interpolation in OKLCH with the default shorter-hue path.
  // Missing hue is explicit (null); an authored achromatic hue still participates.
  // Gamut mapping belongs to materialized colors, not intermediate CSS mixes.
  function mixOklch(first, second, firstRatio) {
    const ratio = clamp(firstRatio, 0, 1);
    let firstHue = first.h ?? second.h ?? 0;
    let secondHue = second.h ?? first.h ?? 0;
    firstHue = normalizeHue(firstHue);
    secondHue = normalizeHue(secondHue);
    if (secondHue - firstHue > 180) firstHue += 360;
    else if (secondHue - firstHue < -180) secondHue += 360;

    return {
      l: first.l * ratio + second.l * (1 - ratio),
      c: first.c * ratio + second.c * (1 - ratio),
      h: normalizeHue(firstHue * ratio + secondHue * (1 - ratio)),
    };
  }

  // ---------------------------------------------------------------------------
  // Computed-serialization parsing.
  // The browser resolves CSS; this only parses its serialization, with no Color.js.
  // Same reference math as the legacy `auditColor`, moved here so SC-05 can adapt
  // the legacy duplicate to this single origin. Fail-closed: unsupported or
  // ambiguous values throw instead of being inherited as a pass.
  // ---------------------------------------------------------------------------

  const COMPUTED_OKLCH_PATTERN = /^oklch\(\s*([^\s()/]+)\s+([^\s()/]+)\s+([^\s()/]+)\s*\)$/i;
  const NUMBER_WITH_UNIT_PATTERN = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i;

  function srgbToLinear(channels) {
    return channels.map((u) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4));
  }

  function srgbToOklch(channels) {
    const [r, g, b] = srgbToLinear(channels);
    const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const l = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
    const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
    const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
    const c = Math.hypot(a, b_);
    const rawHue = c <= 1e-10 ? 0 : (Math.atan2(b_, a) * 180) / Math.PI;
    const hue = rawHue < 0 ? rawHue + 360 : (rawHue === 0 ? 0 : rawHue);
    return { l: Math.min(1, Math.max(0, l)), c, h: hue };
  }

  // The whole function shape is validated before any channel is read: a single
  // trailing `)`, no inner parentheses and no leftover characters. Extra or
  // missing components, a missing closing parenthesis, non-finite channels and
  // any alpha that is not exactly opaque are failures, never an inherited pass.
  function functionBody(serialized, where) {
    const open = serialized.indexOf("(");
    const close = serialized.lastIndexOf(")");
    if (open < 0 || close !== serialized.length - 1 || close <= open) {
      throw new Error(`${where}: invalid computed color ${serialized}`);
    }
    const body = serialized.slice(open + 1, close).trim();
    if (body === "" || body.includes("(") || body.includes(")")) {
      throw new Error(`${where}: invalid computed color ${serialized}`);
    }
    return body;
  }

  function finiteChannel(part, where, serialized) {
    const percent = part.endsWith("%");
    const number = Number(percent ? part.slice(0, -1) : part);
    if (!Number.isFinite(number)) throw new Error(`${where}: invalid computed color ${serialized}`);
    return { number, percent };
  }

  function assertOpaqueAlpha(part, where, serialized) {
    const { number, percent } = finiteChannel(part, where, serialized);
    const alpha = percent ? number / 100 : number;
    if (alpha < 1) throw new Error(`${where}: translucent colors are outside this verification's scope (${serialized})`);
    if (alpha !== 1) throw new Error(`${where}: invalid alpha channel in computed color ${serialized}`);
  }

  function rgbChannels(serialized, where) {
    const parts = functionBody(serialized, where).split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 3 && parts.length !== 4) throw new Error(`${where}: invalid computed color ${serialized}`);
    if (parts.length === 4) assertOpaqueAlpha(parts[3], where, serialized);
    return parts.slice(0, 3).map((part) => {
      const { number, percent } = finiteChannel(part, where, serialized);
      // Percentage is a fraction of the channel maximum, so `rgb(100% 0% 0%)`
      // and `rgb(255 0 0)` describe the same sRGB channel.
      return percent ? number / 100 : number / 255;
    });
  }

  function colorSrgbChannels(serialized, where) {
    const body = functionBody(serialized, where).replace(/^srgb\s+/i, "");
    const parts = body.split(/[\s]+/).filter(Boolean);
    if (parts.length !== 3) throw new Error(`${where}: invalid computed color ${serialized}`);
    return parts.map((part) => {
      const { number, percent } = finiteChannel(part, where, serialized);
      return percent ? number / 100 : number;
    });
  }

  function oklchChannel(value, conversions, serialized, where) {
    const match = NUMBER_WITH_UNIT_PATTERN.exec(value.trim().toLowerCase());
    if (!match) throw new Error(`${where}: invalid computed color ${serialized}`);
    const number = Number(match[1]);
    const convert = conversions[match[2]];
    if (!Number.isFinite(number) || typeof convert !== "function") {
      throw new Error(`${where}: invalid computed color ${serialized}`);
    }
    return convert(number);
  }

  function parseComputedOklch(serialized, where) {
    const match = COMPUTED_OKLCH_PATTERN.exec(serialized);
    if (!match) throw new Error(`${where}: invalid computed color ${serialized}`);
    const l = oklchChannel(match[1], { "": (n) => n, "%": (n) => n / 100 }, serialized, where);
    const c = oklchChannel(match[2], { "": (n) => n, "%": (n) => n * 0.004 }, serialized, where);
    const h = oklchChannel(match[3], {
      "": (n) => n,
      deg: (n) => n,
      grad: (n) => n * 0.9,
      rad: (n) => n * (180 / Math.PI),
      turn: (n) => n * 360,
    }, serialized, where);
    if (l < 0 || l > 1 || c < 0) throw new Error(`${where}: invalid computed color ${serialized}`);
    return { l, c, h };
  }

  /**
   * Parse a browser-serialized computed color into OKLCH coordinates.
   * Accepts `rgb()`/`rgba()` (opaque only), `color(srgb ...)` and `oklch(...)`.
   * Returns `{ l, c, h }` or throws: missing, invalid, translucent or unsupported
   * serializations are never inherited as a pass.
   */
  function parseComputedColor(value, label) {
    const where = label == null ? "computed color" : String(label);
    const serialized = String(value).trim();
    if (serialized === "") throw new Error(`${where}: empty computed color`);
    if (!serialized.endsWith(")")) throw new Error(`${where}: invalid computed color ${serialized}`);
    if (serialized.includes("/")) throw new Error(`${where}: translucent colors are outside this verification's scope (${serialized})`);
    if (serialized.startsWith("oklch(")) return parseComputedOklch(serialized, where);
    if (serialized.startsWith("color(srgb ")) return srgbToOklch(colorSrgbChannels(serialized, where));
    if (serialized.startsWith("rgb(") || serialized.startsWith("rgba(")) return srgbToOklch(rgbChannels(serialized, where));
    throw new Error(`${where}: unsupported computed color ${serialized}`);
  }

  // ---------------------------------------------------------------------------
  // Pair catalog, thresholds and classification.
  // The catalog is the legacy audit catalog, parameterized by the identities and
  // decoratives actually present. IDs come from theme + property + tokens, never
  // from the label or the array index.
  // ---------------------------------------------------------------------------

  const DEFAULT_IDENTITIES = ["primary", "secondary", "info"];
  const UI_KINDS = ["ui", "family-ui"];
  const UI_MINIMUM = 3;
  const TEXT_MINIMUM = 4.5;
  const STATUS_PASS = "pass";
  const STATUS_BELOW_TARGET = "below-target";
  const STATUS_BELOW_MINIMUM = "below-minimum";
  const STATUS_UNMEASURED = "unmeasured";
  const MEASURED = [STATUS_PASS, STATUS_BELOW_TARGET, STATUS_BELOW_MINIMUM];

  // Exploration catalog: a separate, bounded, advisory set of opaque cross-color pairs on the
  // guaranteed base tokens. It never enters the primary catalog, coverage or exit policy. It uses
  // TEXT/on-color semantics (kind "on-color", DOM property "color"), reusing the existing on-color
  // target and the 4.5 text minimum: no new WCAG threshold is invented and 3:1 is never a body pass.
  const EXPLORATION_NAMESPACE = "exploration"; // id segment: a distinct namespace, never the DOM property
  const EXPLORATION_KIND = "on-color";
  const EXPLORATION_PROPERTY = "color";
  const MAX_EXPLORATION_FAMILIES = 24;

  function pairId(theme, property, foreground, background) {
    return `${theme}|${property}|${foreground}|${background}`;
  }

  function pairsFor(scheme, identities = DEFAULT_IDENTITIES, decoratives = []) {
    const pairs = [];
    const add = (label, foreground, background, kind, property = "color", warning = false) => {
      pairs.push({ id: pairId(scheme, property, foreground, background), label: `${scheme} ${label}`, foreground, background, kind, property, theme: scheme, warning });
    };
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
      add(`on-${name} / ${name}`, `--color-${name}-ink`, `--color-${name}`, "on-color", "color", true);
      for (const state of ["solid", "solid-hover"]) {
        add(`${name}-on-solid / ${state}`, `--color-${name}-solid-text`, `--color-${name}-${state}`, "on-color", "color", true);
      }
    }
    for (const name of decoratives) {
      add(`on-${name} / ${name}`, `--color-${name}-ink`, `--color-${name}`, "on-color", "color", true);
    }
    add("control active text / active background", "--color-control-active-text", "--color-control-bg-active", "text", "color", true);
    add("control text / focus background", "--color-text", "--color-control-focus-bg", "text", "color", true);
    add("control active border / canvas", "--color-control-border-active", "--color-bg", "ui", "borderColor", true);
    add("control active border / active background", "--color-control-border-active", "--color-control-bg-active", "ui", "borderColor", true);
    if (new Set(pairs.map(({ id }) => id)).size !== pairs.length) {
      throw new Error("Consumer pair ids must be unique; a duplicate means the catalog maps two pairs to the same theme/property/tokens");
    }
    return pairs;
  }

  // One guaranteed opaque base color per family, the only colors the exploration catalog reads:
  // each identity's base fill and each decorative's base fill. The neutral canvas/surface are added
  // by the caller; never an arbitrary consumer pair, never a token the generator does not guarantee.
  function explorationBaseTokens(identities = DEFAULT_IDENTITIES, decoratives = []) {
    const families = [];
    for (const name of identities) families.push({ family: name, token: `--color-${name}` });
    for (const name of decoratives) families.push({ family: `decorative:${name}`, token: `--color-${name}` });
    return families;
  }

  /**
   * Bounded, deterministic exploration catalog for one scheme: every supported (non-self) pair over
   * `canvas`, `surface` and the base color of each of the first `MAX_EXPLORATION_FAMILIES` families.
   * There is no arbitrary pair cap: all supported pairs are compared (<= 26 colors -> <= 26*25). The
   * families beyond the family cap are declared in `omittedFamilies`. Ids reuse the same
   * theme/property/fg/bg schema under a distinct `exploration` namespace, so they can never collide
   * with a primary pair id. `kind`/`property` give text/on-color semantics; the caller owns the
   * thresholds (on-color target, 4.5 text minimum) and treats the result as advisory data only.
   */
  function explorationPairsFor(scheme, identities = DEFAULT_IDENTITIES, decoratives = []) {
    const families = explorationBaseTokens(identities, decoratives);
    const included = families.slice(0, MAX_EXPLORATION_FAMILIES);
    const omittedFamilies = families.slice(MAX_EXPLORATION_FAMILIES).map((entry) => entry.family);
    // canvas + surface are always compared, alongside each included family's base color.
    const colors = [{ token: "--color-bg" }, { token: "--color-surface" }];
    for (const entry of included) colors.push({ token: entry.token });

    const pairs = [];
    for (const foreground of colors) {
      for (const background of colors) {
        if (foreground.token === background.token) continue; // no self pair
        pairs.push({
          id: pairId(scheme, EXPLORATION_NAMESPACE, foreground.token, background.token),
          label: `${scheme} ${EXPLORATION_NAMESPACE} ${foreground.token} on ${background.token}`,
          foreground: foreground.token,
          background: background.token,
          kind: EXPLORATION_KIND,
          property: EXPLORATION_PROPERTY,
          theme: scheme,
          warning: true,
          exploration: true,
        });
      }
    }
    return { pairs, omittedFamilies };
  }

  function pairTarget(config, scheme, kind) {
    if (kind === "on-color") return config.contrast.onColor;
    if (kind === "ui") return config.contrast.ui;
    const base = kind === "family-ui" ? config.contrast.ui : config.contrast.text;
    return scheme === "light" ? base : Math.min(config.contrast.maxIdentity, base * config.contrast.darkRichness);
  }

  function minimumForKind(kind) {
    return UI_KINDS.includes(kind) ? UI_MINIMUM : TEXT_MINIMUM;
  }

  function warningStatus(ratio, target, minimum) {
    return ratio < minimum ? STATUS_BELOW_MINIMUM : ratio < target ? STATUS_BELOW_TARGET : STATUS_PASS;
  }

  /**
   * Build the frozen verification contract from a resolved config.
   * Returns `{ config: { contrast }, identities, decoratives, pairs: { light, dark } }`.
   * Every pair carries a stable `id`, the legacy `label`, its tokens, `kind`,
   * `property`, `theme`, `target` and `minimum`.
   */
  function createContract(config) {
    const contrast = { ...(config?.contrast ?? {}) };
    const roles = config?.roles ?? {};
    const identities = isRecord(roles.identities) ? Object.keys(roles.identities) : DEFAULT_IDENTITIES;
    const decoratives = isRecord(roles.decoratives) ? Object.keys(roles.decoratives) : [];
    const scope = { contrast };
    const decorate = (scheme, pairs) => pairs.map((pair) => ({
      ...pair,
      target: pairTarget(scope, scheme, pair.kind),
      minimum: minimumForKind(pair.kind),
    }));
    const build = (scheme) => decorate(scheme, pairsFor(scheme, identities, decoratives));
    const buildExploration = (scheme) => {
      const { pairs, omittedFamilies } = explorationPairsFor(scheme, identities, decoratives);
      return { pairs: decorate(scheme, pairs), omittedFamilies };
    };
    const lightExploration = buildExploration("light");
    const darkExploration = buildExploration("dark");
    return {
      config: { contrast },
      identities,
      decoratives,
      pairs: { light: build("light"), dark: build("dark") },
      // Optional, additive exploration surface: bounded data for the report formatter. It never
      // changes the primary `pairs`, coverage or exit policy and is explicitly advisory. The id
      // namespace is distinct from every primary pair; the kind/property are text/on-color semantics.
      explorationPairs: { light: lightExploration.pairs, dark: darkExploration.pairs },
      explorationScope: {
        namespace: EXPLORATION_NAMESPACE,
        kind: EXPLORATION_KIND,
        property: EXPLORATION_PROPERTY,
        maxFamilies: MAX_EXPLORATION_FAMILIES,
        minimum: minimumForKind(EXPLORATION_KIND),
        advisory: true,
        omittedFamilies: { light: lightExploration.omittedFamilies, dark: darkExploration.omittedFamilies },
        note: "tutte le coppie non-self su canvas, surface e il colore base delle prime famiglie: semantiche testo/on-color (minimo 4.5), esplorative e non certificative, mai parte della copertura primary",
      },
    };
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  /**
   * Measure one contract pair in one scenario.
   * `computed` is `{ foreground, background, error? }` with the original computed
   * serializations. A missing/invalid/unsupported color, an explicit `error`, or a
   * pair without finite positive thresholds (`minimum <= target`) yields
   * `status: "unmeasured"` with a reason and `ratio: null` — never a default pass
   * or a zero ratio.
   */
  function measurePair(pair, scenario, computed = {}) {
    const target = pair?.target;
    const minimum = pair?.minimum;
    const measurement = {
      pairId: pair?.id,
      scenarioId: scenario?.id,
      foreground: computed.foreground ?? null,
      background: computed.background ?? null,
      target,
      minimum,
      ratio: null,
      status: STATUS_UNMEASURED,
      error: null,
    };
    if (computed.error != null) {
      measurement.error = String(computed.error);
      return measurement;
    }
    if (!Number.isFinite(target) || !Number.isFinite(minimum) || target <= 0 || minimum <= 0 || minimum > target) {
      measurement.error = "pair requires finite positive thresholds with minimum <= target";
      return measurement;
    }
    let foreground;
    let background;
    try {
      const where = pair?.label ?? pair?.id ?? "pair";
      foreground = parseComputedColor(computed.foreground, `${where} foreground`);
      background = parseComputedColor(computed.background, `${where} background`);
    } catch (error) {
      measurement.error = error.message;
      return measurement;
    }
    const ratio = contrast(foreground, background);
    if (!Number.isFinite(ratio)) {
      measurement.error = "non-finite contrast ratio";
      return measurement;
    }
    measurement.ratio = ratio;
    measurement.status = warningStatus(ratio, target, minimum);
    return measurement;
  }

  /**
   * Verify coverage by identity, not by count.
   * `expectedScenarios` is `[{ id, pairIds }]`; `measurements` are the records from
   * `measurePair`. Missing pairs, unexpected pairs, duplicate measurements,
   * unmeasured pairs, duplicate scenario ids, duplicate pair declarations, empty
   * scenarios and an empty matrix are all reported explicitly and prevent a
   * positive verdict — nothing is silently deduplicated.
   */
  function coverage(expectedScenarios = [], measurements = []) {
    const declarations = new Map();
    const duplicateScenarios = [];
    for (const scenario of expectedScenarios) {
      const id = scenario.id;
      if (declarations.has(id)) {
        if (!duplicateScenarios.includes(id)) duplicateScenarios.push(id);
        continue;
      }
      declarations.set(id, Array.isArray(scenario.pairIds) ? scenario.pairIds : []);
    }

    const measuredByScenario = new Map();
    const duplicates = [];
    for (const measurement of measurements) {
      const scenarioId = measurement.scenarioId;
      if (!measuredByScenario.has(scenarioId)) measuredByScenario.set(scenarioId, []);
      const list = measuredByScenario.get(scenarioId);
      if (list.includes(measurement.pairId)) duplicates.push({ scenarioId, pairId: measurement.pairId });
      else list.push(measurement.pairId);
    }

    const scenarios = [...declarations.entries()].map(([id, declaredIds]) => {
      const declared = new Set();
      const duplicateExpected = [];
      for (const pairId of declaredIds) {
        if (declared.has(pairId)) {
          if (!duplicateExpected.includes(pairId)) duplicateExpected.push(pairId);
        } else {
          declared.add(pairId);
        }
      }
      const measured = measuredByScenario.get(id) ?? [];
      const missing = [...declared].filter((pairId) => !measured.includes(pairId));
      const unexpected = measured.filter((pairId) => !declared.has(pairId));
      const duplicate = duplicates.filter((entry) => entry.scenarioId === id).map((entry) => entry.pairId);
      const unmeasured = measurements
        .filter((measurement) => measurement.scenarioId === id && !MEASURED.includes(measurement.status))
        .map((measurement) => measurement.pairId);
      return {
        id,
        expected: declaredIds,
        measured,
        missing,
        unexpected,
        duplicate,
        duplicateExpected,
        unmeasured,
        complete: declaredIds.length > 0
          && missing.length === 0
          && unexpected.length === 0
          && duplicate.length === 0
          && duplicateExpected.length === 0
          && unmeasured.length === 0,
      };
    });

    const expectedIds = new Set(declarations.keys());
    const unexpectedScenarios = [...measuredByScenario.keys()].filter((id) => !expectedIds.has(id));
    return {
      complete: expectedScenarios.length > 0
        && duplicateScenarios.length === 0
        && unexpectedScenarios.length === 0
        && scenarios.every((scenario) => scenario.complete),
      expectedCount: scenarios.reduce((total, scenario) => total + scenario.expected.length, 0),
      measuredCount: measurements.filter((measurement) => MEASURED.includes(measurement.status)).length,
      scenarios,
      duplicateScenarios,
      missingScenarios: scenarios.filter((scenario) => scenario.measured.length === 0).map((scenario) => scenario.id),
      unexpectedScenarios,
      duplicates,
      unmeasured: measurements
        .filter((measurement) => !MEASURED.includes(measurement.status))
        .map((measurement) => ({ scenarioId: measurement.scenarioId, pairId: measurement.pairId })),
    };
  }

  return {
    // Verification contract (plan §5.1.1).
    pairsFor,
    explorationPairsFor,
    pairTarget,
    warningStatus,
    parseComputedColor,
    contrast,
    createContract,
    measurePair,
    coverage,
    // Shared numeric contract, re-exported by ./color-math.mjs so the generator
    // and the verifier keep one single implementation.
    fitToSrgb,
    mixOklch,
    oklch,
    serializedColor,
    clamp,
  };
}
