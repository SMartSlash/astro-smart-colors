/**
 * Shared designer lexicon for the Smart Colors designer-facing artifacts.
 *
 * `createDesignerLanguage()` is a self-contained factory: its body references no
 * import, no module constant and no outer closure, so another module can serialize
 * it with `.toString()` and evaluate it in an isolated runtime (for example the
 * preview's diagnostic runtime) without a bundler and without a manual copy.
 *
 * The factory only returns labels: it computes no contrast ratio, no number and no
 * verdict, and it never escapes its output — the caller owns escaping. Unknown input
 * never throws; it returns a faithful string instead of guessing a meaning.
 *
 * Frozen contract (2026-10-18):
 *
 * - `pairTitle(foregroundToken, backgroundToken, property = "color")` -> usage title
 *   for a token pair. Known `--color-*` patterns become a concrete usage name
 *   ("Testo sulla pagina", "Bordo sul callout primary", "Testo del pulsante al
 *   passaggio"). A border is never described as text, a dynamic family name is
 *   preserved verbatim, and any pair outside the known catalog falls back to the raw
 *   tokens instead of inventing a semantic.
 * - `roleLabel(role)` -> lowercase Italian fragment for `canvas`, `ink`, `ui`,
 *   `feedback`, `decorative`.
 * - `themeLabel(theme)` -> lowercase Italian fragment for `light`/`dark`, composable
 *   as `Tema ${themeLabel(theme)}`.
 * - `variantLabel(variant)` -> lowercase Italian fragment for `baseline`/`tuned`.
 */
export function createDesignerLanguage() {
  var TOKEN = /^--color-(.+)$/;
  var CONTROL = /^--color-control-/;
  // Non-greedy on purpose: `--color-primary-solid-text` names the family `primary`
  // and the suffix `solid-text`, never the family `primary-solid` and the suffix `text`.
  var FAMILY = /^--color-(.+?)-(surface-strong|surface|border-strong|border|solid-hover|solid-text|solid|text-strong|text)$/;
  var INK = /^--color-(.+)-ink$/;
  // A bare `--color-<name>` is a base fill; anything already carrying a functional
  // suffix (or a scale step / hue variant) is not.
  var NON_BASE = /-(surface-strong|surface|border-strong|border|solid-hover|solid-text|solid|text-strong|text|text-muted|border-subtle|ink|warm|cool|\d+)$/;
  var RESERVED = {
    "--color-bg": true,
    "--color-surface": true,
    "--color-text": true,
    "--color-text-muted": true,
    "--color-border-subtle": true,
    "--color-border-strong": true,
    "--color-focus-ring": true,
  };
  var PLACES = { "--color-bg": "sulla pagina", "--color-surface": "sulla card" };
  // Control pairs read as one fixed phrase; their tokens never compose cleanly.
  var FIXED_PAIRS = {
    "--color-control-active-text|--color-control-bg-active": "Testo del controllo attivo",
    "--color-text|--color-control-focus-bg": "Testo sul controllo a fuoco",
    "--color-control-border-active|--color-bg": "Bordo del controllo attivo sulla pagina",
    "--color-control-border-active|--color-control-bg-active": "Bordo del controllo attivo",
  };

  function stringOf(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function isBaseFill(token) {
    return TOKEN.test(token) && !RESERVED[token] && !CONTROL.test(token) && !NON_BASE.test(token);
  }

  function backgroundPlace(token) {
    if (CONTROL.test(token)) return null;
    if (PLACES[token]) return { phrase: PLACES[token], family: "", kind: "neutral" };
    var family = FAMILY.exec(token);
    if (family) {
      var name = family[1];
      if (family[2] === "surface") return { phrase: "sul callout " + name, family: name, kind: "callout" };
      if (family[2] === "surface-strong") return { phrase: "sul callout " + name + " (forte)", family: name, kind: "callout" };
      if (family[2] === "solid") return { phrase: "sul pulsante " + name, family: name, kind: "button" };
      if (family[2] === "solid-hover") return { phrase: "sul pulsante " + name + " al passaggio", family: name, kind: "button-hover" };
      return null;
    }
    if (isBaseFill(token)) return { phrase: "sul riempimento " + TOKEN.exec(token)[1], family: TOKEN.exec(token)[1], kind: "fill" };
    return null;
  }

  function foregroundRole(token, property) {
    if (CONTROL.test(token)) return null;
    if (token === "--color-text") return { noun: "Testo", family: "", kind: "text" };
    if (token === "--color-text-muted") return { noun: "Testo secondario", family: "", kind: "text" };
    if (token === "--color-focus-ring") return { noun: "Focus", family: "", kind: "focus" };
    if (token === "--color-border-subtle") return { noun: "Bordo tenue", family: "", kind: "border" };
    if (token === "--color-border-strong") return { noun: "Bordo marcato", family: "", kind: "border" };
    var ink = INK.exec(token);
    if (ink) return { noun: "Testo", family: ink[1], kind: "ink" };
    var family = FAMILY.exec(token);
    if (family) {
      var name = family[1];
      if (family[2] === "text") return { noun: "Testo", family: name, kind: "text" };
      if (family[2] === "text-strong") return { noun: "Testo in risalto", family: name, kind: "text" };
      if (family[2] === "border" || family[2] === "border-strong") return { noun: "Bordo", family: name, kind: "border" };
      if (family[2] === "solid-text") return { noun: "Testo del pulsante", family: name, kind: "button-text" };
      if (family[2] === "solid" || family[2] === "solid-hover") return { noun: "Riempimento", family: name, kind: "fill" };
      return { noun: "Superficie", family: name, kind: "surface" };
    }
    if (isBaseFill(token)) {
      // Only the caller's property can say a bare identity color is used as a border or
      // an outline; read as text it stays an unknown usage and keeps the token fallback.
      if (/outline/.test(property)) return { noun: "Focus", family: TOKEN.exec(token)[1], kind: "focus" };
      if (/border/.test(property)) return { noun: "Bordo", family: TOKEN.exec(token)[1], kind: "border" };
      return null;
    }
    return null;
  }

  function pairTitle(foregroundToken, backgroundToken, property = "color") {
    var foreground = stringOf(foregroundToken);
    var background = stringOf(backgroundToken);
    var propertyName = stringOf(property).toLowerCase();
    var fallback = foreground && background
      ? foreground + " su " + background
      : foreground || background || "coppia non indicata";
    if (!foreground || !background) return fallback;
    var fixed = FIXED_PAIRS[foreground + "|" + background];
    if (fixed) return fixed;
    var place = backgroundPlace(background);
    var role = foregroundRole(foreground, propertyName);
    if (!place || !role) return fallback;
    if (role.kind === "button-text" && (place.kind === "button" || place.kind === "button-hover")) {
      var button = "Testo del pulsante" + (role.family ? " " + role.family : "");
      return place.kind === "button-hover" ? button + " al passaggio" : button;
    }
    // The family name is dynamic: it stays literal text, and is skipped from the noun
    // when the place already names it (callout, button, fill).
    var noun = role.family && place.family !== role.family ? role.noun + " " + role.family : role.noun;
    return noun + " " + place.phrase;
  }

  function roleLabel(role) {
    var value = stringOf(role).toLowerCase();
    if (value === "canvas") return "sfondo della pagina";
    if (value === "ink") return "testo di base";
    if (value === "ui") return "interfaccia";
    if (value === "feedback") return "feedback";
    if (value === "decorative") return "decorativo";
    return stringOf(role) || "ruolo non indicato";
  }

  function themeLabel(theme) {
    var value = stringOf(theme).toLowerCase();
    if (value === "light") return "chiaro";
    if (value === "dark") return "scuro";
    return stringOf(theme) || "tema non indicato";
  }

  function variantLabel(variant) {
    var value = stringOf(variant).toLowerCase();
    if (value === "baseline") return "senza tuning";
    if (value === "tuned") return "con tuning";
    return stringOf(variant) || "variante non indicata";
  }

  return { pairTitle, roleLabel, themeLabel, variantLabel };
}
