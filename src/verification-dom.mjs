/**
 * Isolated DOM collector for the Smart Colors verification contract (plan §5.1.1, §6.1).
 *
 * `createDomVerifier(core)` returns the collector factory. Every helper it needs is declared
 * inside it and it only references its `core` parameter and browser globals, so
 * `createDiagnosticRuntimeSource()` can embed this factory verbatim into a classic script with
 * no imports, no `eval`, no Playwright and no reference to the checkout.
 *
 * `measureDocument(document, scenario, contract)` measures the contract's declared pairs on the
 * *applied* `color`/`border-color`/`outline-color` and `background-color` of real probe elements
 * inside an isolated document. It never substitutes a raw custom property for the applied value,
 * and it fails closed: a missing, invalid, translucent or unsupported value, an unapplied theme,
 * a preference that does not match the scenario or an ambiguous registered `@property` initial
 * value all yield `unmeasured` with a reason, never a default pass.
 *
 * Registration sentinel (concrete, not a cascade parser): the measurement skin registers a
 * control custom property with a known initial value. When the engine applies `@property`,
 * setting `<token>: initial` on a scratch element resolves an unregistered token to the
 * guaranteed-invalid value (empty) and a registered one to its initial value. A token that
 * resolves to its own registered initial is indistinguishable from an unauthored one, so it is
 * reported as `unmeasured` instead of being counted as a pass.
 */
export const DOM_PROBE_ATTRIBUTE = "data-smart-colors-pair";
export const DOM_PROBE_HOST_ATTRIBUTE = "data-smart-colors-probes";
export const DOM_MEASUREMENT_STYLE_ATTRIBUTE = "data-smart-colors-measurement";
export const DOM_REGISTRATION_PROBE = "--smart-colors-registration-probe";
export const DOM_REGISTRATION_PROBE_INITIAL = "rgb(1, 2, 3)";
export const DOM_THEME_PROBE_CLASS = "smart-colors-theme-probe";
// Optional visible-node contract: a caller that already renders a real specimen can mark the
// element that consumes a pair's tokens. `measureDocument(..., { elements: Map })` measures that
// element instead of the synthetic probe, and fails closed when the element is missing, hidden,
// not painted, or does not resolve the same tokens as the reference probe.
export const DOM_VISIBLE_FOREGROUND_ATTRIBUTE = "data-smart-colors-foreground";
export const DOM_VISIBLE_BACKGROUND_ATTRIBUTE = "data-smart-colors-background";
export const DOM_VISIBLE_PROPERTY_ATTRIBUTE = "data-smart-colors-property";
export const DOM_VISIBLE_SPECIMEN_ATTRIBUTE = "data-smart-colors-specimen";

export function createDomVerifier(core) {
  const PROBE_ATTRIBUTE = "data-smart-colors-pair";
  const PROBE_HOST_ATTRIBUTE = "data-smart-colors-probes";
  const MEASUREMENT_STYLE_ATTRIBUTE = "data-smart-colors-measurement";
  const MEASUREMENT_LAYER = "smart-colors-measurement";
  const REGISTRATION_PROBE = "--smart-colors-registration-probe";
  const REGISTRATION_PROBE_INITIAL = "rgb(1, 2, 3)";
  const THEME_PROBE_CLASS = "smart-colors-theme-probe";
  const VISIBLE_FOREGROUND_ATTRIBUTE = "data-smart-colors-foreground";
  const VISIBLE_BACKGROUND_ATTRIBUTE = "data-smart-colors-background";
  const VISIBLE_PROPERTY_ATTRIBUTE = "data-smart-colors-property";
  const PROBE_CLASS = "smart-colors-probe";
  const PROBE_HOST_TAG = "div";
  const PROBE_TAG = "div";

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function parseOrNull(value) {
    try {
      return core.parseComputedColor(value, "verification value");
    } catch {
      return null;
    }
  }

  function trim(value) {
    return String(value == null ? "" : value).trim();
  }

  // The active preference comes from the media query only, never from `color-scheme`, so setting
  // an explicit theme cannot be reported as a preference change (plan §8.1 assertion 4).
  function observePreference(view) {
    const dark = view.matchMedia("(prefers-color-scheme: dark)").matches;
    return {
      active: dark ? "dark" : "light",
      unmeasured: [dark ? "light" : "dark"],
      source: "(prefers-color-scheme)",
    };
  }

  function forcedColorsActive(view) {
    return view.matchMedia("(forced-colors: active)").matches;
  }

  // `null` means the engine could not answer, which is treated as "not provably valid".
  function supportsColor(view, value) {
    const css = view.CSS;
    if (!css || typeof css.supports !== "function") return null;
    return css.supports("color", String(value));
  }

  // Registered tokens inherit, so an explicit `initial` on a scratch element reads the registered
  // initial value when registration applied and the guaranteed-invalid value (empty) otherwise.
  function readInitialValue(document, view, token) {
    const host = document.body || document.documentElement;
    if (!host) return "";
    const scratch = document.createElement("span");
    scratch.setAttribute("data-smart-colors-scratch", "");
    scratch.style.setProperty(token, "initial");
    host.appendChild(scratch);
    const value = trim(view.getComputedStyle(scratch).getPropertyValue(token));
    scratch.remove();
    return value;
  }

  // Browser-resolved comparison of the cascade value and the registered initial: both are read
  // through the same `color: var(--token)` pipeline, so the engine normalizes them and a
  // translucent registered initial (e.g. `transparent`) is compared without a hand-written parser.
  function resolveToken(document, view, token, withInitial) {
    const host = document.body || document.documentElement;
    if (!host) return "";
    const probe = document.createElement("span");
    probe.setAttribute("data-smart-colors-resolve", withInitial ? "initial" : "cascade");
    if (withInitial) probe.style.setProperty(token, "initial");
    probe.style.color = "var(" + token + ")";
    host.appendChild(probe);
    const value = trim(view.getComputedStyle(probe).color);
    probe.remove();
    return value;
  }

  function sameColor(first, second) {
    const left = parseOrNull(first);
    const right = parseOrNull(second);
    if (left === null || right === null) return null;
    if (Math.abs(left.l - right.l) > 1e-6) return false;
    if (Math.abs(left.c - right.c) > 1e-6) return false;
    const hue = Math.abs(left.h - right.h);
    return Math.min(hue, 360 - hue) <= 1e-6;
  }

  // Measurement-only stylesheet: the registration control property, the theme sentinel and the
  // endpoint motion freeze. It declares its own layer and is inserted as the FIRST style in the
  // head, before the payload's `tokens` layer. For `!important` declarations an earlier layer wins
  // and layered important beats unlayered important, so this is the only placement that outranks a
  // tuning `animation: … !important` (including on `:root` custom properties). For normal
  // declarations the payload's later layer still wins, so the audit's tokens are never rewritten.
  function ensureMeasurementSkin(document) {
    const existing = document.querySelector("style[" + MEASUREMENT_STYLE_ATTRIBUTE + "]");
    if (existing) return existing;
    const style = document.createElement("style");
    style.setAttribute(MEASUREMENT_STYLE_ATTRIBUTE, "");
    style.textContent = [
      "@property " + REGISTRATION_PROBE + ' { syntax: "<color>"; inherits: true; initial-value: ' + REGISTRATION_PROBE_INITIAL + "; }",
      "@layer " + MEASUREMENT_LAYER + " {",
      "  :root, *, *::before, *::after { animation: none !important; transition: none !important; }",
      "  ." + THEME_PROBE_CLASS + " { color: light-dark(rgb(255, 255, 255), rgb(0, 0, 0)) !important; }",
      "  ." + PROBE_CLASS + " { display: block; margin: 0; border: 0; }",
      "}",
      "",
    ].join("\n");
    const parent = document.head || document.documentElement;
    if (typeof parent.insertBefore === "function") parent.insertBefore(style, parent.firstChild || null);
    else parent.appendChild(style);
    return style;
  }

  function removeProbes(document) {
    const previous = document.querySelector("[" + PROBE_HOST_ATTRIBUTE + "]");
    if (previous && previous.parentNode) previous.parentNode.removeChild(previous);
  }

  // One probe per declared pair, on a real element that carries the applied property, plus the
  // theme sentinel. Text content keeps `color` meaningful; border/outline pairs get a solid edge.
  function buildProbes(document, pairs) {
    removeProbes(document);
    const host = document.createElement(PROBE_HOST_TAG);
    host.setAttribute(PROBE_HOST_ATTRIBUTE, "");
    const byId = new Map();
    for (const pair of pairs) {
      const probe = document.createElement(PROBE_TAG);
      probe.setAttribute(PROBE_ATTRIBUTE, pair.id);
      probe.className = PROBE_CLASS;
      probe.textContent = pair.label;
      probe.style[pair.property] = "var(" + pair.foreground + ")";
      probe.style.backgroundColor = "var(" + pair.background + ")";
      if (pair.property === "borderColor") {
        probe.style.borderStyle = "solid";
        probe.style.borderWidth = "1px";
      }
      if (pair.property === "outlineColor") {
        probe.style.outlineStyle = "solid";
        probe.style.outlineWidth = "1px";
      }
      host.appendChild(probe);
      byId.set(pair.id, probe);
    }
    const themeProbe = document.createElement("span");
    themeProbe.className = THEME_PROBE_CLASS;
    themeProbe.textContent = "T";
    host.appendChild(themeProbe);
    (document.body || document.documentElement).appendChild(host);
    return { host, byId, themeProbe };
  }

  // Registration support is proven by the control property: an engine that ignores `@property`
  // cannot produce a registered initial, so registration cannot mask a missing token there.
  function registrationSupport(document, view) {
    const value = trim(view.getComputedStyle(document.documentElement).getPropertyValue(REGISTRATION_PROBE));
    if (value === "") return { state: "unsupported", value: "" };
    return { state: sameColor(value, REGISTRATION_PROBE_INITIAL) === true ? "supported" : "indeterminate", value };
  }

  // The theme must be proven, never inferred: `color-scheme` has to be exactly the scenario theme
  // (a `light dark` list leaves the theme unpinned, so `light-dark()` would follow the preference)
  // and the `light-dark()` sentinel has to resolve to the branch of that theme. A sentinel that
  // cannot be resolved is reported as unsupported, never treated as a pass by omission.
  function themeEffect(document, view, theme, themeProbe) {
    const colorScheme = trim(view.getComputedStyle(document.documentElement).colorScheme);
    const tokens = colorScheme === "" ? [] : colorScheme.split(/\s+/);
    if (tokens.length !== 1 || tokens[0] !== theme) {
      return {
        applied: false,
        cause: "theme-not-applied",
        colorScheme,
        message: "the isolated root reports color-scheme '" + (colorScheme || "none") + "' instead of exactly '" + String(theme) + "'; a missing or multi-value color-scheme leaves the theme unpinned and cannot be measured",
      };
    }
    const sentinel = themeProbe ? trim(view.getComputedStyle(themeProbe).color) : "";
    const parsed = parseOrNull(sentinel);
    if (!parsed || Math.abs(parsed.c) > 1e-3) {
      return {
        applied: false,
        cause: "theme-unsupported",
        colorScheme,
        message: "the light-dark() theme sentinel did not resolve to a verifiable colour (" + (sentinel || "empty") + "); light-dark support cannot be proven and is reported unsupported",
      };
    }
    const white = parsed.l > 0.99;
    const black = parsed.l < 0.01;
    if ((theme === "light" && !white) || (theme === "dark" && !black)) {
      return {
        applied: false,
        cause: "theme-not-applied",
        colorScheme,
        message: "the light-dark() sentinel resolved to the opposite branch (" + (sentinel || "empty") + "); the " + String(theme) + " theme is not applied",
      };
    }
    return { applied: true, cause: null, colorScheme, message: null };
  }

  function tokenGuard(document, view, rootStyle, token, registration) {
    const declared = trim(rootStyle.getPropertyValue(token));
    if (declared === "") {
      return { ok: false, cause: "token-missing", message: token + " is not declared (guaranteed-invalid); an inherited or initial colour is not a measurement" };
    }
    if (supportsColor(view, declared) !== true) {
      return { ok: false, cause: "token-invalid", message: token + " is not a usable colour: " + declared };
    }
    if (registration.state === "supported") {
      const initial = readInitialValue(document, view, token);
      if (initial !== "") {
        // The token is registered with an initial value, which is what a `var()` falls back to
        // when nothing declares it. Compare the cascade value and the registered initial through
        // the browser so an unauthored token is never counted as a pass; when the two cannot be
        // distinguished, fail closed instead of pretending a measurement.
        const cascade = resolveToken(document, view, token, false);
        const registered = resolveToken(document, view, token, true);
        const masked = cascade !== "" && cascade === registered;
        const equal = masked ? true : sameColor(cascade, registered);
        if (equal === true) {
          return { ok: false, cause: "token-registered-initial", message: token + " resolves to the applied value of its registered initial-value " + registered + "; an unauthored token cannot be distinguished from it" };
        }
      }
    }
    return { ok: true };
  }

  function pairGuard(document, view, rootStyle, pair, registration) {
    const foreground = tokenGuard(document, view, rootStyle, pair.foreground, registration);
    if (!foreground.ok) return foreground;
    return tokenGuard(document, view, rootStyle, pair.background, registration);
  }

  // Read the applied values once and keep the style object, so the opaque-scope guards do not
  // force a second style resolution.
  function readNode(view, node, pair) {
    const style = view.getComputedStyle(node);
    return { style, foreground: trim(style[pair.property]), background: trim(style.backgroundColor) };
  }

  // A provided visible element is only usable when it is a connected element of the measured
  // document, visible, actually paints the declared property, and declares the pair's tokens when
  // the caller opted into the attributes. Anything else fails closed: a fallback probe would hide
  // the fact that the visible specimen is not the thing that was rendered.
  function visibleNodeGuard(document, view, node, pair) {
    if (!node || node.nodeType !== 1) {
      return { ok: false, cause: "visible-node-invalid", message: "the visible element for pair " + pair.id + " is not a DOM element" };
    }
    if (node.ownerDocument && node.ownerDocument !== document) {
      return { ok: false, cause: "visible-node-invalid", message: "the visible element for pair " + pair.id + " belongs to another document" };
    }
    if (node.isConnected === false) {
      return { ok: false, cause: "visible-node-missing", message: "the visible element for pair " + pair.id + " is not connected to the measured document" };
    }
    if (node.isConnected === undefined && document.documentElement && typeof document.documentElement.contains === "function" && !document.documentElement.contains(node)) {
      return { ok: false, cause: "visible-node-missing", message: "the visible element for pair " + pair.id + " is detached from the measured document" };
    }
    if (typeof node.getAttribute === "function") {
      const declaredForeground = node.getAttribute(VISIBLE_FOREGROUND_ATTRIBUTE);
      if (declaredForeground != null && declaredForeground !== pair.foreground) {
        return { ok: false, cause: "visible-node-mismatch", message: "the visible element for pair " + pair.id + " declares foreground " + declaredForeground + " instead of " + pair.foreground };
      }
      const declaredBackground = node.getAttribute(VISIBLE_BACKGROUND_ATTRIBUTE);
      if (declaredBackground != null && declaredBackground !== pair.background) {
        return { ok: false, cause: "visible-node-mismatch", message: "the visible element for pair " + pair.id + " declares background " + declaredBackground + " instead of " + pair.background };
      }
      const declaredProperty = node.getAttribute(VISIBLE_PROPERTY_ATTRIBUTE);
      if (declaredProperty != null && declaredProperty !== pair.property) {
        return { ok: false, cause: "visible-node-mismatch", message: "the visible element for pair " + pair.id + " declares property " + declaredProperty + " instead of " + pair.property };
      }
    }
    const style = view.getComputedStyle(node);
    const display = trim(style.display);
    if (display === "none") {
      return { ok: false, cause: "visible-node-hidden", message: "the visible element for pair " + pair.id + " is display:none, so its applied colours are not rendered" };
    }
    const visibility = trim(style.visibility);
    if (visibility === "hidden" || visibility === "collapse") {
      return { ok: false, cause: "visible-node-hidden", message: "the visible element for pair " + pair.id + " is visibility:" + visibility };
    }
    if (pair.property === "borderColor") {
      const borderStyle = trim(style.borderStyle);
      if (borderStyle === "none" || borderStyle === "hidden") {
        return { ok: false, cause: "visible-node-invalid", message: "the visible element for pair " + pair.id + " has no painted border" };
      }
      const borderWidth = trim(style.borderWidth);
      if (borderWidth !== "" && !(Number.parseFloat(borderWidth) > 0)) {
        return { ok: false, cause: "visible-node-invalid", message: "the visible element for pair " + pair.id + " has a zero-width border" };
      }
    }
    if (pair.property === "outlineColor") {
      const outlineStyle = trim(style.outlineStyle);
      if (outlineStyle === "none") {
        return { ok: false, cause: "visible-node-invalid", message: "the visible element for pair " + pair.id + " has no painted outline" };
      }
      const outlineWidth = trim(style.outlineWidth);
      if (outlineWidth !== "" && !(Number.parseFloat(outlineWidth) > 0)) {
        return { ok: false, cause: "visible-node-invalid", message: "the visible element for pair " + pair.id + " has a zero-width outline" };
      }
    }
    return { ok: true };
  }

  // Alpha is already rejected by `parseComputedColor`; this guard covers the compositing that a
  // computed `background-color` alone cannot describe. Unknown compositing is unmeasured, never a
  // pass. Missing computed fields (a minimal stub) are tolerated; present ones are enforced.
  function compositedStyle(style, where) {
    const image = trim(style.backgroundImage);
    if (image !== "" && image !== "none") {
      return { ok: false, cause: "composited-background", message: "the applied background-image for " + where + " is " + image + "; gradients and images are outside the opaque scope" };
    }
    const filter = trim(style.filter);
    if (filter !== "" && filter !== "none") {
      return { ok: false, cause: "composited-background", message: "the applied filter for " + where + " is " + filter + "; filtered colours are outside the opaque scope" };
    }
    const backdrop = trim(style.backdropFilter != null ? style.backdropFilter : style.webkitBackdropFilter);
    if (backdrop !== "" && backdrop !== "none") {
      return { ok: false, cause: "composited-background", message: "the applied backdrop-filter for " + where + " is " + backdrop + "; backdrop compositing is outside the opaque scope" };
    }
    const opacity = trim(style.opacity);
    if (opacity !== "" && Number(opacity) < 1) {
      return { ok: false, cause: "translucent-element", message: "the applied opacity for " + where + " is " + opacity + "; a translucent element changes the effective colours" };
    }
    const blend = trim(style.mixBlendMode);
    if (blend !== "" && blend !== "normal") {
      return { ok: false, cause: "composited-background", message: "the applied mix-blend-mode for " + where + " is " + blend + "; blended colours are outside the opaque scope" };
    }
    return { ok: true };
  }

  function normalizeElements(options) {
    const value = options && isRecord(options) ? options.elements : null;
    if (value == null) return { ok: true, map: null };
    if (typeof value.get !== "function" || typeof value.has !== "function" || typeof value.keys !== "function") return { ok: false, map: null };
    return { ok: true, map: value };
  }

  // A computed colour is not the rendered colour when an ancestor applies opacity, a filter, a
  // backdrop filter or a blend mode. The walk is bounded by the ancestor chain and only inspects
  // the compositing properties that can change the pair; an opaque background-image on an ancestor
  // is irrelevant once the measured node paints its own background.
  function ancestorCompositingGuard(document, view, node) {
    let current = node.parentElement;
    while (current) {
      const style = view.getComputedStyle(current);
      const opacity = trim(style.opacity);
      if (opacity !== "" && Number(opacity) < 1) {
        return { ok: false, cause: "translucent-ancestor", message: "an ancestor of the measured pair applies opacity: " + opacity + "; the rendered colours are not the computed colours" };
      }
      const filter = trim(style.filter);
      if (filter !== "" && filter !== "none") {
        return { ok: false, cause: "composited-ancestor", message: "an ancestor of the measured pair applies filter: " + filter + "; filtered colours are outside the opaque scope" };
      }
      const backdrop = trim(style.backdropFilter != null ? style.backdropFilter : style.webkitBackdropFilter);
      if (backdrop !== "" && backdrop !== "none") {
        return { ok: false, cause: "composited-ancestor", message: "an ancestor of the measured pair applies backdrop-filter: " + backdrop + "; backdrop compositing is outside the opaque scope" };
      }
      const blend = trim(style.mixBlendMode);
      if (blend !== "" && blend !== "normal") {
        return { ok: false, cause: "composited-ancestor", message: "an ancestor of the measured pair applies mix-blend-mode: " + blend + "; blended colours are outside the opaque scope" };
      }
      if (current === document.documentElement) break;
      current = current.parentElement;
    }
    return { ok: true };
  }

  function pushUnmeasured(result, pair, phase, cause, message) {
    result.measurements.push(core.measurePair(pair, { id: result.scenarioId }, { error: message }));
    result.errors.push({ phase, cause, scenarioId: result.scenarioId, pairId: pair.id, message });
  }

  // An unsupported document (no theme proof, forced colours, indeterminate registration) produces
  // no measurement at all: `support: "unsupported"` and one explicit reason per declared pair.
  function fail(result, pairs, phase, cause, message) {
    result.support = "unsupported";
    result.error = message;
    for (const pair of pairs) pushUnmeasured(result, pair, phase, cause, message);
    return result;
  }

  function failDocument(result, phase, cause, message) {
    result.support = "unsupported";
    result.error = message;
    result.errors.push({ phase, cause, scenarioId: result.scenarioId, pairId: null, message });
    return result;
  }

  function measureDocument(document, scenario, contract, options = {}) {
    const result = {
      scenarioId: scenario ? scenario.id : null,
      theme: scenario ? scenario.theme : null,
      variant: scenario ? scenario.variant : null,
      preference: scenario ? scenario.preference : null,
      observedPreference: null,
      colorScheme: null,
      forcedColors: false,
      support: "unsupported",
      error: null,
      measurements: [],
      errors: [],
      probes: { total: 0, missing: [] },
      visible: { provided: 0, measured: 0, missing: [], unexpected: [] },
      measuredAt: nowIso(),
    };
    const view = document ? document.defaultView : null;
    if (!document || !view || !document.documentElement) {
      return failDocument(result, "dom", "document-unavailable", "The isolated document is not available for measurement");
    }
    const theme = scenario ? scenario.theme : null;
    const pairs = contract && isRecord(contract.pairs) ? contract.pairs[theme] : null;
    if (!Array.isArray(pairs)) {
      return failDocument(result, "contract", "theme-missing", "The contract declares no pairs for theme " + String(theme));
    }
    const providedElements = normalizeElements(options);
    if (!providedElements.ok) {
      return fail(result, pairs, "setup", "elements-invalid", "options.elements must be a Map keyed by pair id; a plain object cannot guarantee that a visible node belongs to each pair");
    }
    if (providedElements.map) {
      result.visible.provided = typeof providedElements.map.size === "number" ? providedElements.map.size : 0;
      const declared = new Set(pairs.map((pair) => pair.id));
      for (const id of providedElements.map.keys()) {
        if (!declared.has(id)) result.visible.unexpected.push(id);
      }
    }

    result.forcedColors = forcedColorsActive(view);
    if (result.forcedColors) {
      return fail(result, pairs, "measure", "forced-colors-active", "forced-colors is active: forced system colours cannot confirm the authored palette");
    }

    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    ensureMeasurementSkin(document);
    const probes = buildProbes(document, pairs);
    result.probes.total = probes.byId.size;

    const effect = themeEffect(document, view, theme, probes.themeProbe);
    result.colorScheme = effect.colorScheme;
    const preference = observePreference(view);
    result.observedPreference = preference.active;
    const registration = registrationSupport(document, view);

    if (!effect.applied) {
      return fail(result, pairs, "setup", effect.cause, effect.message);
    }
    if (scenario && scenario.preference && preference.active !== scenario.preference) {
      return fail(result, pairs, "setup", "preference-mismatch", "the document reports " + preference.active + " while the scenario requires " + scenario.preference + "; the media query is never rewritten to fake the other preference");
    }
    if (registration.state === "indeterminate") {
      return fail(result, pairs, "setup", "registration-probe-indeterminate", "a registered custom property was observed but its initial value could not be compared, so registered initial values cannot be ruled out");
    }

    const rootStyle = view.getComputedStyle(document.documentElement);
    for (const pair of pairs) {
      const probe = probes.byId.get(pair.id);
      const hasVisible = Boolean(providedElements.map && providedElements.map.has(pair.id));
      const mapped = hasVisible ? providedElements.map.get(pair.id) : null;
      const visible = hasVisible;
      const node = visible ? mapped : probe;
      if (visible) {
        const visibleGuard = visibleNodeGuard(document, view, node, pair);
        if (!visibleGuard.ok) {
          result.visible.missing.push(pair.id);
          pushUnmeasured(result, pair, "measure", visibleGuard.cause, visibleGuard.message);
          continue;
        }
      }
      if (!node) {
        result.probes.missing.push(pair.id);
        pushUnmeasured(result, pair, "measure", "probe-missing", "no probe element was found for pair " + pair.id);
        continue;
      }
      const guard = pairGuard(document, view, rootStyle, pair, registration);
      if (!guard.ok) {
        pushUnmeasured(result, pair, "measure", guard.cause, guard.message);
        continue;
      }
      const computed = readNode(view, node, pair);
      if (computed.foreground === "" || computed.background === "") {
        pushUnmeasured(result, pair, "measure", "computed-empty", "the applied " + pair.property + "/background-color serialized empty");
        continue;
      }
      const composite = compositedStyle(computed.style, pair.label || pair.id);
      if (!composite.ok) {
        pushUnmeasured(result, pair, "measure", composite.cause, composite.message);
        continue;
      }
      if (pair.property === "color") {
        // Gradient text paints from `-webkit-text-fill-color`, not `color`: a differing fill is an
        // unmeasured foreground, never a pass.
        const fill = trim(computed.style.webkitTextFillColor);
        if (fill !== "" && fill !== "currentcolor" && sameColor(computed.style.color, fill) !== true) {
          pushUnmeasured(result, pair, "measure", "text-fill-color", "the applied -webkit-text-fill-color for " + (pair.label || pair.id) + " is " + fill + " instead of the applied color " + computed.style.color);
          continue;
        }
      }
      const ancestors = ancestorCompositingGuard(document, view, node);
      if (!ancestors.ok) {
        pushUnmeasured(result, pair, "measure", ancestors.cause, ancestors.message);
        continue;
      }
      if (visible) {
        if (!probe) {
          pushUnmeasured(result, pair, "measure", "visible-node-unverified", "the visible element for pair " + pair.id + " has no reference probe, so its token use cannot be verified");
          continue;
        }
        const reference = readNode(view, probe, pair);
        if (sameColor(computed.foreground, reference.foreground) !== true || sameColor(computed.background, reference.background) !== true) {
          pushUnmeasured(result, pair, "measure", "visible-node-mismatch", "the visible element for pair " + pair.id + " does not resolve the declared pair tokens identically to the reference probe");
          continue;
        }
      }
      const measurement = core.measurePair(pair, { id: result.scenarioId }, {
        foreground: computed.foreground,
        background: computed.background,
      });
      result.measurements.push(measurement);
      if (visible && measurement.status !== "unmeasured") result.visible.measured += 1;
    }
    result.support = "supported";
    return result;
  }

  return {
    // Constants are re-declared inside the factory so its serialized source stays self-contained;
    // the entry-point constants are asserted equal by the runtime test to prevent drift.
    probeAttribute: PROBE_ATTRIBUTE,
    probeHostAttribute: PROBE_HOST_ATTRIBUTE,
    measurementStyleAttribute: MEASUREMENT_STYLE_ATTRIBUTE,
    registrationProbe: REGISTRATION_PROBE,
    registrationProbeInitial: REGISTRATION_PROBE_INITIAL,
    themeProbeClass: THEME_PROBE_CLASS,
    visibleForegroundAttribute: VISIBLE_FOREGROUND_ATTRIBUTE,
    visibleBackgroundAttribute: VISIBLE_BACKGROUND_ATTRIBUTE,
    visiblePropertyAttribute: VISIBLE_PROPERTY_ATTRIBUTE,
    observePreference,
    forcedColorsActive,
    measureDocument,
  };
}
