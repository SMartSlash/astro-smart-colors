// Guided contrast workbench for the diagnostic preview.
//
// Build-time responsibilities:
// - `renderContrastWorkbench(session)` emits the guided workbench first: a compact horizontal
//   toolbar with the bounded source strip, a human current-use summary with a "Cambia uso" opener,
//   the comparison modes and the theme control, then the full-width comparison area with the visible
//   pair identity, the real CSS consumer specimens and their scoped results. The opener reveals a
//   native modal picker with search, a category filter and paginated real uses; a single contextual
//   correction/action strip follows the specimens. The native pairing select stays in the technical
//   disclosure as a fallback. The verbose source-palette archive (raw authored values, roles,
//   explicit/automatic dark blend, real `@property` declarations, full captured CSS and a manual
//   download) follows it inside a closed native detail. The legacy resolved-color gallery stays
//   elsewhere as a collapsed technical archive.
// - `CONTRAST_WORKBENCH_CSS` is the presentation-only stylesheet in
//   `report-styles/workbench.css`, read once at import. It reuses the preview
//   tokens and never paints an actual specimen; specimens are real CSS consumer
//   frames rendered by the browser runtime with `var(--token)`.
//
// Browser responsibility:
// - `createContrastWorkbenchViewSource()` serializes the self-contained view
//   factory. It binds only to the frozen controller API and uses
//   `createElement`/`textContent`, never untrusted markup.
//
// Contract notes: the source palette is read-only input (roles and dark blend are
// not editable). Overrides are temporary public CSS tuning, not a rebuilt
// generator. Suggestions only come from the runtime; this module never invents a
// ratio, a pair or a colour distance.
import { readFileSync } from "node:fs";
import { createDesignerLanguage } from "./designer-language.mjs";
import { createDesignTools } from "./design-recipes.mjs";
import { colorCss, escape, list, record } from "./format-report-html.mjs";

const WORKBENCH_STYLESHEET = new URL("./report-styles/workbench.css", import.meta.url);
const HOOK = "data-smart-colors-workbench";
const HOST_ID = "smart-colors-workbench";
// Primary use choices are paginated inside one native dialog. The category list is derived from the
// real diagnostic buckets, never invented, and the known labels are stable across the build and the
// browser view.
const USE_VISIBLE_LIMIT = 6;
const PICKER_CATEGORIES = Object.freeze([
  Object.freeze(["page", "Testo su pagina"]),
  Object.freeze(["callout", "Riquadri"]),
  Object.freeze(["button", "Pulsanti"]),
  Object.freeze(["border", "Bordi"]),
  Object.freeze(["focus", "Indicatore statico"]),
  Object.freeze(["other", "Altri usi"]),
]);

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const text = (value) => typeof value === "string" && value.trim() ? value.trim() : null;

// Presentation-only chrome, shared by every renderer. It reuses the preview tokens,
// adds no paint of its own to the specimens and keeps native control chrome readable
// in forced-colors mode. Loaded once at module import; the browser factory never needs it.
export const CONTRAST_WORKBENCH_CSS = readFileSync(WORKBENCH_STYLESHEET, "utf8");

// A source value may reach a scoped `--sample-color` custom property. Keep it to a
// colour-like literal: no semicolon, brace, quote, resource reference or function
// other than the colour functions the generator emits. The source swatch is
// explicitly labelled as the raw authored value, never as the live rendering.
function sourceColor(value) {
  const candidate = text(value);
  if (!candidate || candidate.length > 180) return null;
  if (!/^(#|oklch|oklab|rgb|rgba|hsl|hsla|hwb|lab|lch|color)\(?/i.test(candidate) && !/^#[0-9a-f]{3,8}$/i.test(candidate)) return null;
  if (/[;"'<>{}\\]|url\(|expression\(|@import/i.test(candidate)) return null;
  return candidate;
}

function sourceMix(design, entry, tools) {
  const sources = design && Array.isArray(design.sources) ? design.sources : [];
  const match = sources.find((source) => record(source) && source.token === entry.token) || null;
  if (match && record(match.darkMix)) return match.darkMix;
  if (finite(entry.darkBlend) && tools && typeof tools.darkBlendMix === "function") return tools.darkBlendMix(entry.darkBlend);
  return null;
}

function darkBlendLine(design, entry, tools) {
  const mix = sourceMix(design, entry, tools);
  const label = entry.darkBlend == null ? "dark-blend automatico" : `dark-blend ${entry.darkBlend}`;
  if (!mix || !finite(mix.sourcePercent) || !finite(mix.whitePercent)) return label;
  const explicit = entry.darkBlend == null ? "" : " · esplicito";
  return `${label} → source ${mix.sourcePercent}% / white ${mix.whitePercent}%${explicit}`;
}

// The exact source object lives in the additive `session.paletteSource`; `session.palette` stays the
// legacy array the static report validates. A legacy session with no `paletteSource` is served from
// the legacy array (parsed authored values only) — never with an invented `value`/`declaration`. The
// tolerant object check also accepts an early transitional `palette` object so a coordinated rollout
// cannot lose the captured bytes, but the canonical field name is `paletteSource`.
function paletteModel(session) {
  const value = record(session) ? session : {};
  const additive = record(value.paletteSource) ? value.paletteSource : null;
  const legacyPalette = value.palette;
  const object = additive || (record(legacyPalette) && Array.isArray(legacyPalette.sources) ? legacyPalette : null);
  const captured = object && Array.isArray(object.sources) ? object.sources : null;
  const css = object && typeof object.css === "string" ? object.css : null;
  const path = object && typeof object.path === "string" ? object.path : null;
  const sha256 = object && typeof object.sha256 === "string" ? object.sha256 : null;
  const legacy = Array.isArray(legacyPalette) ? legacyPalette : null;
  return { captured, css, path, sha256, legacy, object };
}

function designSource(design, token) {
  const sources = design && Array.isArray(design.sources) ? design.sources : [];
  return sources.find((source) => record(source) && source.token === token) || null;
}

// Effective role per token from the configured identities (`paletteName` keyed). This is NEVER used
// to overwrite the declared `@property` role: the publication keeps the declared role authoritative
// and shows the effective role as a separate, explicitly labelled fact when it differs.
function identityRoleByToken(session) {
  const roles = record(session) && record(session.roles) ? session.roles : null;
  const map = new Map();
  for (const identity of list(roles && roles.identities)) {
    if (!record(identity)) continue;
    const paletteName = text(identity.paletteName);
    const role = text(identity.role);
    if (paletteName && role) map.set(paletteName, role);
  }
  return map;
}

function sourceCatalogue(session, design, tools) {
  const model = paletteModel(session);
  const identityRole = identityRoleByToken(session);
  const entries = [];
  const seen = new Set();
  const add = (entry) => {
    const token = text(entry.token);
    if (!token || seen.has(token)) return;
    seen.add(token);
    const binding = designSource(design, token);
    // `declared` is what the source publication states (captured `@property` annotation, or the
    // legacy annotation when the palette arrived as an array). `effective` is the configured identity
    // role. They are kept separate so the UI can never present the config role as authored.
    const declaredRole = text(entry.role) || null;
    const effectiveRole = identityRole.get(token) || (binding && text(binding.role)) || null;
    entries.push({
      token,
      value: text(entry.value) || null,
      declaredRole,
      effectiveRole,
      name: binding && text(binding.name) ? binding.name : null,
      darkBlend: Number.isFinite(Number(entry.darkBlend)) && entry.darkBlend !== null && entry.darkBlend !== ""
        ? Number(entry.darkBlend)
        : (binding && Number.isFinite(Number(binding.darkBlend)) && binding.darkBlend !== null ? Number(binding.darkBlend) : null),
      declaration: text(entry.declaration) || null,
      // `captured` = exact bytes from `paletteSource`; `legacy` = a parsed authored triple from the
      // legacy array (real evidence, but not the exact source text); `missing` = no value at all.
      origin: entry.origin === "captured" ? "captured" : entry.origin === "legacy" ? "legacy" : "missing",
    });
  };
  if (model.captured) {
    for (const entry of model.captured) {
      if (!record(entry)) continue;
      add({ token: entry.token, value: entry.value, role: entry.role, darkBlend: entry.darkBlend, declaration: entry.declaration, origin: "captured" });
    }
  } else if (model.legacy) {
    for (const entry of model.legacy) {
      if (!record(entry)) continue;
      add({
        token: entry.name,
        value: colorCss(entry.authored),
        role: entry.role,
        darkBlend: entry.darkBlend,
        declaration: null,
        origin: "legacy",
      });
    }
  }
  // Design sources add names, roles and automatic mixes when the palette block did
  // not capture them. They never replace a captured value or declaration.
  if (design && Array.isArray(design.sources)) {
    for (const entry of design.sources) {
      if (!record(entry)) continue;
      add({ token: entry.token, value: null, role: entry.role, darkBlend: entry.darkBlend, declaration: null });
    }
  }
  return { ...model, entries, tools };
}

function darkBlendRolesHtml(design, tools) {
  if (!design || !Array.isArray(design.sources)) return "";
  const items = design.sources.map((source) => {
    if (!record(source)) return "";
    const mix = record(source.darkMix) ? source.darkMix : (tools && finite(source.darkBlend) ? tools.darkBlendMix(source.darkBlend) : null);
    if (!record(mix) || !finite(mix.sourcePercent) || !finite(mix.whitePercent)) return "";
    const blend = source.darkBlend == null ? "adattivo" : String(source.darkBlend);
    return `<li><code>${escape(source.token)}</code> · ${escape(source.role ?? "ruolo non indicato")} · dark-blend ${escape(blend)} → source ${escape(String(mix.sourcePercent))}% / white ${escape(String(mix.whitePercent))}%</li>`;
  }).filter(Boolean);
  if (!items.length) return "";
  // Compact role roll-up inside a detail: the per-source rows above already carry the
  // same blend, so this stays secondary instead of duplicating the main entry.
  return `<details class="is-detail"><summary>dark-blend per ruolo</summary>
<p class="margin-note">Regola di progetto 10/90 (source↔white), non una soglia WCAG.</p>
<ul class="dark-blend-list">${items.join("")}</ul></details>`;
}

function paletteProvenance(model, session) {
  if (model.path || model.sha256) {
    const path = model.path ? `<code>${escape(model.path)}</code>` : "percorso non indicato";
    const sha = model.sha256 ? `<code>${escape(model.sha256.slice(0, 12))}</code>` : "SHA-256 non indicato";
    return `<p class="margin-note">Palette catturata: ${path} · impronta ${sha}. Il contenuto è la copia esatta dei byte letti.</p>`;
  }
  const files = record(session.files) ? session.files : {};
  const inputs = Array.isArray(session.inputs) ? session.inputs : [];
  const palette = inputs.find((item) => record(item) && item.name === "palette") || null;
  if (text(files.palette) || (palette && text(palette.sha256))) {
    const path = text(files.palette) ? `<code>${escape(files.palette)}</code>` : "percorso non indicato";
    const sha = palette && text(palette.sha256) ? `<code>${escape(palette.sha256.slice(0, 12))}</code>` : "SHA-256 non indicato";
    return `<p class="margin-note">Palette dichiarata: ${path} · impronta ${sha}. In questa sessione non è incorporata la copia completa del sorgente.</p>`;
  }
  return `<p class="margin-note">Provenienza della palette non disponibile in questa sessione.</p>`;
}

function sourcePaletteHtml(session, design, tools, language) {
  const model = sourceCatalogue(session, design, tools);
  const items = model.entries.map((entry) => {
    const color = sourceColor(entry.value);
    const swatch = color
      ? `<span class="variant-swatch" aria-hidden="true" style="--sample-color:${escape(color)}"></span>`
      : "";
    // Exact captured bytes vs a parsed legacy triple vs no evidence at all: the label always says
    // which one it is, so a fallback is never presented as the authored source text.
    const value = entry.origin === "captured" && entry.value
      ? `<span class="wb-source-value">${swatch}Valore sorgente dichiarato: <code>${escape(entry.value)}</code> <span class="margin-note">(valore grezzo, non la resa live)</span></span>`
      : entry.origin === "legacy" && entry.value
        ? `<span class="wb-source-value">${swatch}Valore autore risolto dal parser: <code>${escape(entry.value)}</code> <span class="margin-note">(i byte esatti del sorgente non sono disponibili in questa sessione)</span></span>`
        : `<span class="wb-source-value">${swatch}Valore sorgente non disponibile in questa sessione.</span>`;
    // Declared role first (authoritative), effective config role second only when it differs.
    const declared = entry.declaredRole ? `ruolo dichiarato: ${language.roleLabel(entry.declaredRole)}` : "ruolo dichiarato: non indicato";
    const effective = entry.effectiveRole && entry.effectiveRole !== entry.declaredRole
      ? ` · ruolo effettivo (config): ${language.roleLabel(entry.effectiveRole)}`
      : "";
    const declaration = entry.declaration
      ? `<code class="wb-declaration">${escape(entry.declaration)}</code>`
      : `<span class="margin-note">Dichiarazione <code>@property</code> non disponibile in questa sessione; nessuna dichiarazione viene ricostruita.</span>`;
    return `<li class="wb-source-item">
<p class="wb-source-head"><code>${escape(entry.token)}</code> · ${escape(declared)}${escape(effective)}${entry.name && entry.name !== entry.token ? ` · <span class="margin-note">nome ${escape(entry.name)}</span>` : ""}</p>
${value}
<p class="margin-note">${escape(darkBlendLine(design, entry, tools))}</p>
${declaration}
</li>`;
  }).filter(Boolean);
  const listHtml = items.length
    ? `<ul class="wb-source-list">${items.join("")}</ul>`
    : `<p>Nessuna sorgente palette disponibile: il banco non inventa sorgenti.</p>`;
  const fullCss = model.css;
  const download = fullCss
    ? `<a class="wb-download" download="palette.css" href="data:text/css;charset=utf-8,${escape(encodeURIComponent(fullCss))}">Scarica palette.css (azione manuale)</a>`
    : "";
  const sourceCopy = fullCss
    ? `<details class="is-detail wb-source-copy"><summary>Copia completa del CSS sorgente (${fullCss.length} caratteri)</summary>
<label for="smart-colors-workbench-palette-source">Sorgente completo, selezionabile senza permessi clipboard</label>
<textarea id="smart-colors-workbench-palette-source" data-smart-colors-workbench="palette-source" readonly rows="10">${escape(fullCss)}</textarea>
<div class="wb-actions"><button type="button" id="smart-colors-workbench-copy-palette" data-smart-colors-workbench="copy-palette">Seleziona il sorgente</button>${download}</div>
<p class="margin-note">Il download è manuale: aprire l'anteprima non scrive file.</p></details>`
    : `<p class="margin-note">Copia completa non disponibile in questa sessione. Il download non viene simulato.</p>`;
  return `<section id="palette" aria-labelledby="palette-titolo"><h2 id="palette-titolo">Palette sorgente e ruoli</h2>
<p class="lede">Valori sorgente del file di palette, ruoli e dark-blend di sola lettura. La scelta avviene dalla barra dei colori; qui resta l'archivio esatto dei byte.</p>
<details class="is-detail wb-palette-details"><summary>Dettagli tecnici della palette sorgente</summary>
${paletteProvenance(model, session)}
${listHtml}
${darkBlendRolesHtml(design, tools)}
${sourceCopy}
</details></section>`;
}

function diagnosticPairs(session) {
  const values = [];
  const model = record(session.model) ? session.model : {};
  for (const item of list(model.diagnostics)) values.push(item);
  for (const sample of list(session.samples)) {
    if (!record(sample)) continue;
    for (const item of list(sample.diagnostics)) values.push(item);
  }
  return values.filter(record);
}

function pairProperty(item) {
  if (item.kind !== "non-text") return "color";
  if (/focus-ring/.test(String(item.foregroundToken))) return "outlineColor";
  if (/border/.test(String(item.foregroundToken))) return "borderColor";
  return "ui";
}

// Shared pure classifier: which semantic use a pair represents. It reads only the CSS property, the
// pair kind and the token names, never a ratio, so a failing pair is ranked like any other. The
// result is serialized per option (`data-use-bucket`/`data-use-rank`) so the browser view can rank and
// diversify the primary choices without duplicating these rules.
const USE_RANK = { page: 10, button: 20, callout: 30, border: 40, focus: 50, other: 60 };

function classifyUse(kind, property, foreground, background) {
  const fg = String(foreground || "");
  const bg = String(background || "");
  const prop = String(property || "color");
  if (prop === "outlineColor" || /focus-ring/.test(fg)) return "focus";
  if (prop === "borderColor" || /(^|-)border(-strong)?$/.test(fg)) return "border";
  if (/(^|-)solid(-hover|-text)?$/.test(fg) || /(^|-)solid(-hover)?$/.test(bg) || /--color-control-/.test(fg) || /--color-control-/.test(bg)) return "button";
  if (/(^|-)surface(-strong)?$/.test(bg) || /(^|-)ink$/.test(fg)) return "callout";
  if (kind === "non-text") return "other";
  return "page";
}

function statusRank(status) {
  if (status === "below-minimum") return 0;
  if (status === "below-target") return 1;
  if (status === "pass") return 2;
  return 3;
}

function worse(existing, next) {
  if (!existing) return next;
  const existingMeasured = finite(existing.ratio);
  const nextMeasured = finite(next.ratio);
  if (nextMeasured && (!existingMeasured || next.ratio < existing.ratio)) return next;
  return existing;
}

function pairCatalogue(session, design, language) {
  const pairs = new Map();
  for (const item of diagnosticPairs(session)) {
    const theme = item.scheme === "dark" ? "dark" : item.scheme === "light" ? "light" : null;
    const foreground = text(item.foregroundToken);
    const background = text(item.backgroundToken);
    if (!theme || !foreground || !background) continue;
    const property = pairProperty(item);
    const key = `${foreground}|${background}|${item.kind === "non-text" ? "non-text" : "text"}`;
    let pair = pairs.get(key);
    if (!pair) {
      const kind = item.kind === "non-text" ? "non-text" : "text";
      const useBucket = classifyUse(kind, property, foreground, background);
      pair = {
        key,
        foreground,
        background,
        kind,
        // The original catalogue kind (for example `on-color`) is preserved separately. `kind` stays
        // the coarse text/non-text identity used for the pair key; the UI never infers a WCAG use
        // from a numeric threshold, so the catalogue kind must survive to the option.
        catalogueKind: item.kind === "on-color" ? "on-color" : isOnColorPair(foreground, background) ? "on-color" : (text(item.kind) || kind),
        property,
        title: language.pairTitle(foreground, background, property),
        sources: pairSources(design, foreground, background),
        foregroundSources: tokenSources(design, foreground),
        backgroundSources: tokenSources(design, background),
        useBucket,
        useRank: USE_RANK[useBucket],
        themes: { light: null, dark: null },
      };
      pairs.set(key, pair);
    }
    const diagnostic = {
      id: `${theme}|${property}|${foreground}|${background}`,
      minimum: finite(item.minimum) ? item.minimum : null,
      target: finite(item.target) ? item.target : null,
      ratio: finite(item.ratio) ? item.ratio : null,
      status: text(item.status) || "unmeasured",
      label: text(item.label),
    };
    pair.themes[theme] = worse(pair.themes[theme], diagnostic);
  }
  return [...pairs.values()].sort((a, b) => {
    const aStatus = worstStatus(a);
    const bStatus = worstStatus(b);
    return statusRank(aStatus) - statusRank(bStatus) || a.title.localeCompare(b.title, "it");
  });
}

function worstStatus(pair) {
  const themes = [pair.themes.light, pair.themes.dark].filter(Boolean);
  if (!themes.length) return "unmeasured";
  return themes.reduce((worst, item) => statusRank(item.status) < statusRank(worst) ? item.status : worst, themes[0].status);
}

function pairSources(design, foreground, background) {
  const sources = [];
  for (const token of [foreground, background]) {
    for (const source of tokenSources(design, token)) if (!sources.includes(source)) sources.push(source);
  }
  return sources;
}

// Sources declared for ONE token binding (one side of a pair). Keeping the two sides separate lets
// the guided picker prefer foreground uses, so a shared background dependency (for example the
// canvas) cannot dump the whole catalogue into the "where do you use it" list.
function tokenSources(design, token) {
  const binding = design && record(design.tokens) ? design.tokens[token] : null;
  if (!record(binding) || !Array.isArray(binding.sources)) return [];
  const sources = [];
  for (const source of binding.sources) if (text(source) && !sources.includes(source)) sources.push(source);
  return sources;
}

function pairRecipe(design, token) {
  if (!design || !record(design.tokens)) return null;
  const binding = record(design.tokens[token]) ? design.tokens[token] : null;
  if (!binding) return null;
  const recipe = text(binding.recipe);
  if (!recipe) return null;
  const shared = record(design.recipes) && record(design.recipes[recipe]) ? design.recipes[recipe] : null;
  return { recipe, kind: shared && text(shared.kind) ? shared.kind : null, usage: shared && text(shared.usage) ? shared.usage : null };
}

function cssBytesText(session) {
  const css = record(session.css) ? session.css : {};
  if (css.status === "stale") return "output non aggiornato (stale)";
  if (css.source === "generated-candidate") return "candidato generato (diagnostico), non output";
  if (css.status === "absent") return "output assente: byte candidati";
  if (css.status === "empty") return "output vuoto: nessun byte utilizzabile";
  if (css.source === "output") return "output attuale del progetto";
  return "provenienza CSS non indicata";
}

function generatorNote(session) {
  const css = record(session.css) ? session.css : {};
  if (css.status === "stale") {
    return "Stato: output non aggiornato (stale). Le misure riguardano i byte catturati; la ricetta descritta è il rationale iniziale del generatore, non la formula attiva dei byte correnti.";
  }
  if (css.source === "generated-candidate") {
    return "Stato: candidato generato (diagnostico), non output; le misure riguardano un candidato generato, non un file di output.";
  }
  if (css.status === "absent" || css.status === "empty") {
    return "Stato: nessun output utilizzabile; le misure riguardano i byte catturati o il candidato.";
  }
  return "Le misure riguardano i byte CSS catturati.";
}

function minimoTarget(minimum, target) {
  if (finite(minimum) && finite(target) && minimum === target) return `Soglia ${formatNumber(minimum)}:1`;
  return `Minimo ${finite(minimum) ? `${formatNumber(minimum)}:1` : "non dichiarato"} · target ${finite(target) ? `${formatNumber(target)}:1` : "non dichiarato"}`;
}

function formatNumber(value) {
  if (!finite(value)) return "non misurato";
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

// The snippet uses the pair's real CSS property: `color` for text, `border`/`outline` (with the
// width the indicator needs) for a border or focus token, plus the background it is measured against.
// Border and outline samples need the padded surface wrapper: their outer edge / offset ring lives
// outside the specimen box, so the wrapper paints the measured background around the whole geometry.
// This mirrors the runtime specimen (`padding: 12px`, same background on wrapper and specimen).
function pairSnippet(foreground, background, property) {
  const fg = `var(${foreground})`;
  const bg = `var(${background})`;
  if (property === "borderColor") {
    return `border: 2px solid ${fg};\nbackground-color: ${bg};\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class="specimen" role="img" aria-label="Campione statico del bordo"> */\n.surface {\n  padding: 12px;\n  background: ${bg};\n  border-radius: 8px;\n}`;
  }
  if (property === "outlineColor") {
    return `outline: 3px solid ${fg};\noutline-offset: 2px;\nbackground-color: ${bg};\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class="specimen" role="img" aria-label="Campione statico dell'anello"> */\n.surface {\n  padding: 12px;\n  background: ${bg};\n  border-radius: 8px;\n}`;
  }
  return `color: ${fg};\nbackground-color: ${bg};`;
}

function pairCompactSnippet(foreground, background, property) {
  const prop = property === "borderColor" ? "border-color" : property === "outlineColor" ? "outline-color" : "color";
  return `${prop}: var(${foreground});\nbackground-color: var(${background});`;
}

// Human kind of a catalogue pair. The exact token identity stays visible in the main area; this
// label only names what the specimen geometry is, never a compliance claim.
function pairKindLabel(pair) {
  if (!pair || pair.kind !== "non-text") {
    return pair && pair.catalogueKind === "on-color" ? "testo su riempimento" : "testo";
  }
  return /focus-ring/.test(String(pair.foreground)) ? "anello" : "bordo";
}

// The catalogue kind for an on-color pair is a token-shape fact, never a numeric threshold: the same
// pair geometry is used by `verification-core` (`<family>-ink` on `<family>`, or `solid-text` on a
// solid fill). It only decides which specimen copy applies; it does not change the criterion.
function isOnColorPair(foreground, background) {
  const fg = String(foreground || "");
  const bg = String(background || "");
  if (/^--color-.+-ink$/.test(fg)) return bg === fg.replace(/-ink$/, "");
  if (/^--color-.+-solid-text$/.test(fg)) {
    const family = fg.replace(/-solid-text$/, "");
    return new RegExp("^" + family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-(solid|solid-hover)$").test(bg);
  }
  return false;
}

function pairIdentityHtml(pair) {
  if (!pair) return "Nessuna coppia selezionata.";
  return `<code>${escape(pair.foreground)}</code> su <code>${escape(pair.background)}</code> · ${escape(pairKindLabel(pair))}`;
}

function pairPurposeText(pair) {
  if (!pair) return "Scegli una coppia dal catalogo generato per leggere il criterio applicato.";
  if (pair.kind === "non-text") {
    return "Componente non testuale · 3:1 (SC 1.4.11). Il campione statico non verifica focus, comportamento o oscuramento.";
  }
  if (pair.catalogueKind === "on-color") {
    return "Testo su riempimento · AA 4,5:1 (SC 1.4.3) · etichetta a 16 px.";
  }
  return "Testo normale · AA 4,5:1 (SC 1.4.3) · campione a 16 px.";
}

// Source/recipe/control metadata for one token of the selected pair. The declared role stays the
// authored fact; a differing configured role is shown under its own explicit label. The recipe is
// labelled as the generator's initial rationale, never as the active formula of current bytes.
function tokenBindingHtml(token, label, design, language, theme, sourceEntries) {
  const binding = design && record(design.tokens) && record(design.tokens[token]) ? design.tokens[token] : null;
  const recipe = pairRecipe(design, token);
  const usage = binding && text(binding.usage) ? binding.usage : recipe && recipe.usage ? recipe.usage : "uso non dichiarato";
  const sources = binding && Array.isArray(binding.sources) ? binding.sources.filter((item) => text(item)) : [];
  // The authored role belongs to the palette source, not to the semantic token. Show it next to the
  // source it belongs to; never substitute the configured role for the declared one.
  const sourceLabels = sources.map((source) => {
    const meta = designSource(design, source);
    const sourceEntry = sourceEntries.find((item) => item.token === source) || null;
    const facts = [];
    if (meta && text(meta.name)) facts.push(`nome ${meta.name}`);
    if (sourceEntry && sourceEntry.declaredRole) {
      facts.push(`ruolo dichiarato: ${language.roleLabel(sourceEntry.declaredRole)}`);
      if (sourceEntry.effectiveRole && sourceEntry.effectiveRole !== sourceEntry.declaredRole) {
        facts.push(`ruolo effettivo (config): ${language.roleLabel(sourceEntry.effectiveRole)}`);
      }
    } else if (sourceEntry && sourceEntry.effectiveRole) {
      facts.push(`ruolo effettivo: ${language.roleLabel(sourceEntry.effectiveRole)}`);
    }
    return facts.length ? `${source} (${facts.join(" · ")})` : source;
  });
  const ownEntry = sourceEntries.find((item) => item.token === token) || null;
  const ownRole = ownEntry && ownEntry.declaredRole ? ` · ruolo dichiarato del token: ${language.roleLabel(ownEntry.declaredRole)}` : "";
  const controls = controlsFor(design, token, theme).map((control) => {
    if (control.kind === "override") return `<code>${escape(control.control)}</code> override completo`;
    const percent = control.defaultMix == null ? "" : ` (default ${formatNumber(control.defaultMix * 100)}%)`;
    return `<code>${escape(control.control)}</code> mix superficie${percent}`;
  });
  return `<div>
<p class="eyebrow">${escape(label)}</p>
<p><code>${escape(token)}</code> · ${escape(usage)}</p>
<p class="margin-note">Sorgenti: ${sourceLabels.length ? sourceLabels.map((name) => `<code>${escape(name)}</code>`).join(", ") : "non dichiarate"}${escape(ownRole)}</p>
<p class="margin-note">Ricetta iniziale del generatore: ${escape(recipe ? `${recipe.recipe}${recipe.kind ? ` (${recipe.kind})` : ""}` : "non dichiarata")}.</p>
<p class="margin-note">Controlli pubblici (${escape(theme === "dark" ? "tema scuro" : "tema chiaro")}): ${controls.length ? controls.join(" · ") : "nessuno dichiarato"}.</p>
</div>`;
}

function pairDetailsHtml(pair, session, design, language, sourceEntries, theme) {
  if (!pair) return `<p>Nessuna coppia diagnostica disponibile: il banco non inventa coppie.</p>`;
  const light = pair.themes.light;
  const dark = pair.themes.dark;
  const activeTheme = theme === "dark" ? "dark" : "light";
  const entries = Array.isArray(sourceEntries) ? sourceEntries : [];
  return `<article class="wb-details" data-smart-colors-workbench="details-body">
<h3>${escape(pair.title)}</h3>
<p><code>${escape(pair.foreground)}</code> su <code>${escape(pair.background)}</code> · ${pair.kind === "non-text" ? "bordo o indicatore" : "testo"} · proprietà <code>${escape(pair.property)}</code></p>
<div class="grid-2">
${tokenBindingHtml(pair.foreground, "Primo piano", design, language, activeTheme, entries)}
${tokenBindingHtml(pair.background, "Sfondo", design, language, activeTheme, entries)}
</div>
<pre role="group" tabindex="0" aria-label="Snippet CSS della coppia, con le stesse variabili della resa"><code>${escape(pairSnippet(pair.foreground, pair.background, pair.property))}</code></pre>
<dl class="wb-thresholds">
<div><dt>Tema chiaro</dt><dd>${escape(light ? minimoTarget(light.minimum, light.target) : "coppia non disponibile")}</dd></div>
<div><dt>Tema scuro</dt><dd>${escape(dark ? minimoTarget(dark.minimum, dark.target) : "coppia non disponibile")}</dd></div>
<div><dt>Tema e preferenza</dt><dd>Il tema è la variante misurata; la preferenza di sistema (<code>prefers-color-scheme</code>) resta separata e non viene emulata.</dd></div>
</dl>
<p class="margin-note">${escape(generatorNote(session))}</p>
<p class="margin-note">Byte associati alle viste: ${escape(cssBytesText(session))}.</p>
</article>`;
}

function sourcesAttribute(pair) {
  return pair && pair.sources.length ? pair.sources.join(" ") : "";
}

function foregroundSourcesAttribute(pair) {
  return pair && Array.isArray(pair.foregroundSources) && pair.foregroundSources.length ? pair.foregroundSources.join(" ") : "";
}

function backgroundSourcesAttribute(pair) {
  return pair && Array.isArray(pair.backgroundSources) && pair.backgroundSources.length ? pair.backgroundSources.join(" ") : "";
}

// Options stay compact: only the fields that cannot be derived cheaply in the view
// factory are serialized. Thresholds are packed as `min,target` per theme, in
// light;dark order, so a missing theme is an empty slot rather than a fabricated value.
function thresholdPack(theme) {
  if (!theme) return "";
  const minimum = finite(theme.minimum) ? String(theme.minimum) : "";
  const target = finite(theme.target) ? String(theme.target) : "";
  return `${minimum},${target}`;
}

function pairOptionsHtml(pairs, selected) {
  if (!pairs.length) return `<option value="">Nessuna coppia diagnostica disponibile</option>`;
  return pairs.map((pair) => {
    const value = `${pair.foreground}|${pair.background}|${pair.kind}`;
    const chosen = selected && selected.key === pair.key;
    const thresholds = `${thresholdPack(pair.themes.light)};${thresholdPack(pair.themes.dark)}`;
    const pickerLabel = pairPickerLabel(pair);
    // Most labels already exist in data-usage. Only embed a distinct human fallback when needed,
    // keeping the offline artifact bounded even with a full automation session.
    const pickerAttribute = pickerLabel && pickerLabel !== pair.title ? ` data-picker-label="${escape(pickerLabel)}"` : "";
    // The catalogue kind is only a refinement of `data-kind` (for example `on-color`): the runtime
    // already falls back to `data-kind` when the attribute is absent, so the equal value stays out.
    const catalogueAttribute = pair.catalogueKind && pair.catalogueKind !== pair.kind ? ` data-catalogue-kind="${escape(pair.catalogueKind)}"` : "";
    const light = pair.themes.light || {};
    const dark = pair.themes.dark || {};
    const matrixData = [finite(light.ratio) ? String(light.ratio) : "", text(light.status) || "unmeasured", finite(dark.ratio) ? String(dark.ratio) : "", text(dark.status) || "unmeasured"].join(",");
    return `<option value="${escape(value)}"${chosen ? " selected" : ""} data-fg="${escape(pair.foreground)}" data-bg="${escape(pair.background)}" data-kind="${escape(pair.kind)}"${catalogueAttribute} data-usage="${escape(pair.title)}"${pickerAttribute} data-sources="${escape(sourcesAttribute(pair))}" data-fg-sources="${escape(foregroundSourcesAttribute(pair))}" data-bg-sources="${escape(backgroundSourcesAttribute(pair))}" data-use-bucket="${escape(pair.useBucket || "other")}" data-use-rank="${escape(String(finite(pair.useRank) ? pair.useRank : 999))}" data-thresholds="${escape(thresholds)}" data-matrix="${escape(matrixData)}">${escape(pair.title)}</option>`;
  }).join("");
}

function sourceOptionsHtml(sources, selected) {
  const chosen = selected && selected.sources.length ? selected.sources[0] : null;
  const options = sources.map((entry) => {
    // The compact native fallback uses the same human name as the swatch strip; the exact token
    // remains visible so the choice is unambiguous. Declared roles stay in the source archive.
    return `<option value="${escape(entry.token)}"${chosen === entry.token ? " selected" : ""}>${escape(`${sourceSwatchName(entry)} · ${entry.token}`)}</option>`;
  });
  return `<option value=""${chosen ? "" : " selected"}>Tutte le sorgenti</option>${options.join("")}`;
}

function controlsFor(design, token, theme) {
  if (!design || !record(design.tokens) || !record(design.tokens[token])) return [];
  const controls = record(design.tokens[token].controls) ? design.tokens[token].controls : null;
  if (!controls || !record(controls[theme])) return [];
  const control = controls[theme];
  const rows = [];
  if (text(control.override)) rows.push({ control: control.override, kind: "override", defaultMix: null });
  if (text(control.mix)) rows.push({ control: control.mix, kind: "mix", defaultMix: finite(control.defaultMix) ? control.defaultMix : null });
  return rows;
}

function controlRowsHtml(pair, theme, design) {
  if (!pair) return `<p class="margin-note">Nessuna coppia selezionata: nessun controllo pubblico da mostrare.</p>`;
  const tokens = [pair.foreground, pair.background].filter((token, index, all) => all.indexOf(token) === index);
  const rows = [];
  for (const token of tokens) {
    for (const control of controlsFor(design, token, theme)) {
      const id = `smart-colors-workbench-control-${control.control.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      if (control.kind === "override") {
        rows.push(`<div class="wb-field"><details class="wb-raw"><summary>CSS testuale (avanzato) · ${escape(token)}</summary><label for="${escape(id)}"><code>${escape(token)}</code> · override completo</label><input id="${escape(id)}" type="text" data-control="${escape(control.control)}" data-kind="override" placeholder="es. oklch(0.5 0.1 250)" autocomplete="off" spellcheck="false"></details>${lightRowsHtml(token, control.control)}<span class="margin-note">La rimozione di una personalizzazione salvata è distinta dallo scarto della bozza.</span></div>`);
      } else {
        const percent = control.defaultMix == null ? "" : String(Math.round(control.defaultMix * 100 * 100) / 100).replace(".", ",");
        // The default is a PLACEHOLDER, never an active value: an untouched mix is not submitted and
        // cannot silently override a saved setting.
        rows.push(`<div class="wb-field"><label for="${escape(id)}"><code>${escape(token)}</code> · mix superficie (%)</label><input id="${escape(id)}" type="number" min="0" max="100" step="0.1" placeholder="${escape(percent)}" data-control="${escape(control.control)}" data-kind="mix"><span class="margin-note">Default dichiarato: ${control.defaultMix == null ? "non disponibile" : `${escape(percent)}%`} (segnaposto: nessun override finché non modifichi il campo).</span></div>`);
      }
    }
  }
  if (!rows.length) return `<p class="margin-note">Nessun controllo pubblico dichiarato per questa coppia e questo tema. Il banco non inventa knob.</p>`;
  return `<div class="wb-control-grid">${rows.join("")}</div>`;
}

function tokenCatalogueHtml(design, pairs, sources) {
  if (!design || !record(design.tokens)) return `<p>Metadati di design assenti: il catalogo completo non è disponibile e nessuna coppia viene inventata.</p>`;
  const names = Object.keys(design.tokens).sort((a, b) => a.localeCompare(b, "en"));
  const counts = new Map();
  for (const pair of pairs) {
    for (const token of [pair.foreground, pair.background]) counts.set(token, (counts.get(token) || 0) + 1);
  }
  const rows = names.map((token) => {
    const binding = record(design.tokens[token]) ? design.tokens[token] : {};
    const recipe = text(binding.recipe) || "ricetta non dichiarata";
    const count = counts.get(token) || 0;
    return `<li><code>${escape(token)}</code> · ${escape(recipe)} · ${count ? `${count} coppie diagnostiche` : "nessun abbinamento verificato"}</li>`;
  });
  const represented = new Set();
  for (const pair of pairs) for (const source of pair.sources) represented.add(source);
  const unrepresented = sources.entries.map((entry) => entry.token).filter((token) => !represented.has(token));
  return `<p class="margin-note">Catalogo completo: ${names.length} token, nessun limite nascosto. Un token senza coppie diagnostiche resta elencato come <strong>nessuna coppia diagnostica</strong>.</p>
<ul class="wb-catalogue">${rows.join("")}</ul>
${unrepresented.length ? `<p class="margin-note">Sorgenti senza coppia diagnostica: ${unrepresented.map((token) => `<code>${escape(token)}</code>`).join(", ")}.</p>` : ""}`;
}

function tuningState(session) {
  const css = record(session.css) ? session.css : {};
  if (!text(css.tuning)) return { available: false, reason: "tuning assente nello snapshot" };
  if (css.tuningSupport === "unsupported") return { available: false, reason: "tuning non supportato (risorse esterne non valutabili offline)" };
  return { available: true, reason: null };
}

// Short human name for a source swatch: the authored name when present, otherwise a short label
// derived from the token. Tokens are technical, so the primary surface never shows the raw string.
// The label is title-cased for readability while acronyms and mixed case stay intact.
function titleCase(value) {
  const words = String(value).split(/\s+/).filter(Boolean);
  if (!words.length) return String(value);
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function sourceSwatchName(entry) {
  if (text(entry.name)) return titleCase(entry.name);
  const token = text(entry.token) || "";
  const short = token.replace(/^--/, "").replace(/^(palette|color)-/, "");
  const words = short.split("-").filter(Boolean);
  if (!words.length) return titleCase(token) || "sorgente";
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

// The clickable source palette that opens the workbench. Each swatch is a real color tile with a
// neutral label below (never text painted over the authored color). Buttons ship disabled and inert
// without JS: the view factory enables them and owns the pressed state via `aria-pressed`.
function sourceSwatchesHtml(entries, selectedToken) {
  if (!entries.length) return `<p class="wb-uses-empty">Nessun colore sorgente disponibile in questa sessione: il banco non inventa sorgenti.</p>`;
  const items = entries.map((entry) => {
    const color = sourceColor(entry.value);
    const style = color ? ` style="--sample-color:${escape(color)}"` : "";
    const pressed = selectedToken && entry.token === selectedToken;
    const blendAttr = entry.darkBlend != null ? ` data-dark-blend="${escape(String(entry.darkBlend))}"` : "";
    const roleAttr = entry.declaredRole ? ` data-role="${escape(entry.declaredRole)}"` : "";
    return `<li><button type="button" class="wb-swatch" data-smart-colors-workbench="swatch" data-token="${escape(entry.token)}"${roleAttr}${blendAttr} aria-pressed="${pressed ? "true" : "false"}" disabled>
<span class="wb-swatch-block" aria-hidden="true"${style}></span>
<span class="wb-swatch-name"><span class="wb-swatch-mark" aria-hidden="true">✓</span>${escape(sourceSwatchName(entry))}</span>
</button></li>`;
  });
  return `<ul class="wb-palette" aria-labelledby="smart-colors-workbench-palette-label">${items.join("")}</ul>`;
}

// Uses for one source, derived from the real diagnostics only. Foreground bindings win; a source
// that is only a background dependency of other tokens is shown under an explicit note instead of
// dumping the whole catalogue. A source with no diagnostic gets an explicit empty state.
function usesForSource(pairs, design, sourceToken) {
  if (!sourceToken) return { pairs: [], backgroundOnly: false };
  const foreground = [];
  const background = [];
  for (const pair of pairs) {
    if (tokenSources(design, pair.foreground).includes(sourceToken)) foreground.push(pair);
    else if (tokenSources(design, pair.background).includes(sourceToken)) background.push(pair);
  }
  if (foreground.length) return { pairs: foreground, backgroundOnly: false };
  if (background.length) return { pairs: background, backgroundOnly: true };
  return { pairs: [], backgroundOnly: false };
}

// Round-robin across semantic buckets so the first pages are diverse (text, button, callout,
// border, focus) instead of six borders. With a single bucket (for example the ink source) it still
// yields six text choices. No pair is dropped: the paginated picker exposes every match.
function diversifyPairs(list) {
  const buckets = new Map();
  for (const pair of list) {
    const key = pair.useBucket || "other";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(pair);
  }
  const groups = [...buckets.entries()].sort((a, b) => (a[1][0].useRank ?? 999) - (b[1][0].useRank ?? 999));
  const ordered = [];
  let round = 0;
  let pushed = true;
  while (pushed) {
    pushed = false;
    for (const group of groups) {
      if (round < group[1].length) { ordered.push(group[1][round]); pushed = true; }
    }
    round += 1;
  }
  return ordered;
}

function pickerValue(pair) {
  return `${pair.foreground}|${pair.background}|${pair.kind}`;
}

function pairFallbackLabel(pair) {
  return `${pair.foreground} su ${pair.background}`;
}

function pairHasHumanName(pair) {
  return Boolean(pair && pair.title) && pair.title !== pairFallbackLabel(pair);
}


// Human selection label. A known on-color pair (`<base>-ink` on the exact `<base>`) gets a
// readable identity label without changing the pair title / `data-usage` technical contract.
function pairPickerLabel(pair) {
  if (pairHasHumanName(pair)) return pair.title;
  const ink = /^--color-(.+)-ink$/.exec(pair.foreground);
  if (pair.kind !== "non-text" && pair.catalogueKind === "on-color" && ink && pair.background === `--color-${ink[1]}`) {
    return `Testo sul colore ${sourceSwatchName({ token: pair.background })}`;
  }
  return "";
}

function pairHasPickerLabel(pair) {
  return Boolean(pairPickerLabel(pair));
}

function pairPickerDisplay(pair) {
  return pairPickerLabel(pair) || "Uso senza nome";
}

function foldSearch(value) {
  const raw = String(value == null ? "" : value).toLowerCase();
  return typeof raw.normalize === "function" ? raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : raw;
}

// Preferred foreground uses win; a source that only appears as a background dependency falls back to
// that explicit scope. The current option is kept visible even if the scope would otherwise hide it,
// so an external runtime selection always has a truthful selected row.
function pickerCandidates(pairs, design, sourceToken, activeValue) {
  let pool = [];
  let backgroundOnly = false;
  if (!sourceToken) {
    pool = pairs.slice();
  } else {
    const result = usesForSource(pairs, design, sourceToken);
    pool = result.pairs.slice();
    backgroundOnly = result.backgroundOnly;
  }
  const active = activeValue ? pool.find((pair) => pickerValue(pair) === activeValue) || null : null;
  let ordered = diversifyPairs(pool);
  if (active) ordered = [active, ...ordered.filter((pair) => pair !== active)];
  return { pairs: ordered, backgroundOnly, active };
}

function pickerFiltered(candidates, query, category) {
  const words = foldSearch(query).split(/\s+/).filter(Boolean);
  return candidates.filter((pair) => {
    if (category && (pair.useBucket || "other") !== category) return false;
    return words.every((word) => foldSearch([pair.title, pairPickerLabel(pair), pair.foreground, pair.background, pairKindLabel(pair)].join(" ")).includes(word));
  });
}

function pickerCountText(total, query, category) {
  if (total === 0) {
    return query || category
      ? "Nessun uso corrisponde ai filtri. Modifica la ricerca o scegli Tutti gli usi."
      : "Nessun uso disponibile per questa sorgente.";
  }
  const pages = Math.max(1, Math.ceil(total / USE_VISIBLE_LIMIT));
  return `${total} ${total === 1 ? "uso" : "usi"} · pagina 1 di ${pages}`;
}

function pickerCategoryOptionsHtml(candidates) {
  const present = new Set(candidates.map((pair) => pair.useBucket || "other"));
  return PICKER_CATEGORIES
    .filter(([bucket]) => present.has(bucket))
    .map(([bucket, label]) => `<option value="${escape(bucket)}">${escape(label)}</option>`)
    .join("");
}

function pickerSourceNote(sourceToken, sources) {
  const entries = sources && Array.isArray(sources.entries) ? sources.entries : [];
  const entry = sourceToken ? entries.find((item) => item.token === sourceToken) : null;
  const label = entry ? sourceSwatchName(entry) : sourceToken || "Tutte le sorgenti";
  return `Sorgente: ${label}. Usi generati dalla palette, non rilevati nel sito.`;
}

function usesChips(pairs, activeValue) {
  return pairs.map((pair) => {
    const value = pickerValue(pair);
    const pressed = activeValue && value === activeValue;
    const tech = pairHasPickerLabel(pair)
      ? ""
      : `<span class="wb-use-tech"><code>${escape(pair.foreground)}</code> su <code>${escape(pair.background)}</code></span>`;
    return `<li><button type="button" class="wb-use" data-smart-colors-workbench="use" data-pair-value="${escape(value)}" aria-pressed="${pressed ? "true" : "false"}" disabled><span class="wb-use-main"><span class="wb-use-label">${escape(pairPickerDisplay(pair))}</span>${tech}</span><span class="wb-use-kind">${escape(pairKindLabel(pair))}</span><span class="wb-use-mark" aria-hidden="true"> ✓</span></button></li>`;
  }).join("");
}

function pickerModel(pairs, design, sources, sourceToken, activeValue) {
  const candidates = pickerCandidates(pairs, design, sourceToken, activeValue);
  const filtered = pickerFiltered(candidates.pairs, "", "");
  const visible = filtered.slice(0, USE_VISIBLE_LIMIT);
  const empty = pickerCountText(0, "", "");
  const list = visible.length
    ? `<ul class="wb-uses">${usesChips(visible, activeValue)}</ul>`
    : `<p class="wb-uses-empty">${escape(empty)}</p>`;
  const note = candidates.backgroundOnly
    ? `<p class="wb-uses-note">Questo colore compare come sfondo nelle coppie del catalogo: è una dipendenza del token di sfondo.</p>`
    : "";
  return {
    total: filtered.length,
    count: pickerCountText(filtered.length, "", ""),
    categoriesHtml: pickerCategoryOptionsHtml(candidates.pairs),
    resultsHtml: `${list}${note}`,
    sourceNote: pickerSourceNote(sourceToken, sources),
  };
}

// Snapshot wording stays deliberately separate from the live runtime column. A snapshot ratio is
// never labelled as a browser measurement; the live cell stays empty until the runtime publishes it.
function matrixStatusLabel(status) {
  if (status === "below-minimum") return "sotto il minimo";
  if (status === "below-target") return "sotto il target";
  if (status === "pass") return "minimo raggiunto";
  return "non misurato";
}

function matrixCriterionLabel(pair) {
  if (!pair) return "tipo non indicato";
  if (pair.kind === "non-text") return "Non testo · 3:1 (SC 1.4.11)";
  if (pair.catalogueKind === "on-color") return "Testo su riempimento · AA 4,5:1";
  return "Testo · AA 4,5:1";
}


function pairCategory(pair) {
  const kind = pair.kind || "";
  const prop = pair.property || "";
  const fg = (pair.foreground || "").toLowerCase();
  const bg = (pair.background || "").toLowerCase();
  const usage = (pair.usage || "").toLowerCase();
  if (kind === "non-text" || prop === "borderColor" || prop === "outlineColor" || fg.includes("border") || fg.includes("outline") || usage.includes("bordo")) {
    return "border";
  }
  if ((fg.includes("surface") && (bg.includes("bg") || bg.includes("canvas"))) || usage.includes("superficie")) {
    return "surface";
  }
  if (kind === "decorative" || usage.includes("decorat")) {
    return "decorative";
  }
  return "text";
}


function matrixSnapshotHtml(theme, source) {
  if (!theme) return `<span class="wb-matrix-status" data-status="unmeasured">tema non disponibile</span>`;
  const status = text(theme.status) || "unmeasured";
  const ratio = finite(theme.ratio) ? `${formatNumber(theme.ratio)}:1` : "non misurato";
  const thresholds = [];
  if (finite(theme.minimum)) thresholds.push(`min ${formatNumber(theme.minimum)}:1`);
  if (finite(theme.target)) thresholds.push(`target ${formatNumber(theme.target)}:1`);
  return `<span class="wb-matrix-ratio">${escape(ratio)}</span><span class="wb-matrix-status" data-status="${escape(status)}">${escape(matrixStatusLabel(status))}</span><span class="wb-matrix-thresholds">${escape(thresholds.join(" · ") || "soglie non dichiarate")}</span><span class="wb-matrix-source">${escape(source || "stima build")}</span>`;
}

function matrixStaticGridHtml(pairs) {
  // The no-JS surface is the snapshot table; keep this hidden scaffold bounded.
  // Enhancement rebuilds every declared pair before filters and pagination run.
  return pairs.slice(0, 1).map((pair) => {
    const value = pickerValue(pair);
    const label = pairHasPickerLabel(pair) ? pairPickerDisplay(pair) : pairFallbackLabel(pair);
    const views = ["light", "dark"].map((theme, index) => `<span class="wb-tile-view" data-slot="${index === 0 ? "left" : "right"}" data-source="build">
<span class="wb-tile-view-title">${theme === "light" ? "A · Tema chiaro" : "B · Tema scuro"}</span>
<span class="wb-pair-swatch is-unmeasured" aria-hidden="true"></span>
<span class="wb-tile-result">${matrixSnapshotHtml(pair.themes[theme], "stima build")}<span>Colori live non disponibili</span></span></span>`).join("");
    return `<li class="wb-matrix-tile" data-smart-colors-workbench="matrix-tile" data-pair-value="${escape(value)}" data-category="${escape(pairCategory(pair))}">
<button type="button" class="wb-tile-select" aria-pressed="false" disabled>
<span class="wb-tile-heading"><span class="wb-tile-title">${escape(label)}</span><span class="wb-tile-mark" aria-hidden="true">✓</span></span>
<code class="wb-tile-tokens">${escape(pair.foreground)} su ${escape(pair.background)}</code>
<span class="wb-tile-views">${views}</span></button></li>`;
  }).join("");
}

function matrixStaticRowsHtml(pairs) {
  if (!pairs.length) {
    return `<tr><td colspan="3">Nessun abbinamento diagnostico disponibile: il banco non inventa coppie.</td></tr>`;
  }
  const rows = pairs.slice(0, 4).map((pair) => {
    const value = pickerValue(pair);
    const label = pairHasPickerLabel(pair) ? pairPickerDisplay(pair) : pairFallbackLabel(pair);
    const cat = pairCategory(pair);
    const status = worstStatus(pair);
    const lightStatus = text(pair.themes.light && pair.themes.light.status) || "unmeasured";
    const darkStatus = text(pair.themes.dark && pair.themes.dark.status) || "unmeasured";
    return `<tr data-smart-colors-workbench="matrix-row" data-pair-value="${escape(value)}" data-category="${escape(cat)}" data-status="${escape(status)}" data-all-pass="${lightStatus === "pass" && darkStatus === "pass" ? "true" : "false"}" data-unmeasured="${lightStatus === "unmeasured" || darkStatus === "unmeasured" ? "true" : "false"}" data-live-status="false"><th scope="row" class="wb-matrix-uso"><div class="wb-matrix-info"><span class="wb-matrix-label">${escape(label)}</span><code class="wb-matrix-tokens">${escape(pair.foreground)} su ${escape(pair.background)}</code><span class="wb-matrix-type">${escape(matrixCriterionLabel(pair))}</span></div><button type="button" class="wb-matrix-inspect" data-smart-colors-workbench="matrix-inspect" data-pair-value="${escape(value)}" tabindex="-1" disabled>Ispeziona<span class="wb-visually-hidden"> ${escape(label)}</span></button></th><td class="wb-matrix-view" data-smart-colors-workbench="matrix-cell" data-slot="left">${matrixSnapshotHtml(pair.themes.light, "stima build")}</td><td class="wb-matrix-view" data-smart-colors-workbench="matrix-cell" data-slot="right">${matrixSnapshotHtml(pair.themes.dark, "stima build")}</td></tr>`;
  }).join("");
  return `${rows}<tr data-smart-colors-workbench="matrix-empty" hidden><td colspan="3">Nessun abbinamento corrisponde alla selezione corrente.</td></tr>`;
}

function matrixHtml(pairs) {
  const total = pairs.length;
  const count = total === 1 ? "1 abbinamento" : `${total} abbinamenti`;
  return `<details class="wb-overview" data-smart-colors-workbench="overview" aria-labelledby="smart-colors-workbench-overview-title" open>
<summary id="smart-colors-workbench-overview-title" class="wb-overview-summary">Abbinamenti e filtri <span id="smart-colors-workbench-overview-scope" class="wb-overview-scope">Tutti gli abbinamenti</span></summary>
<div class="wb-overview-body">
<p id="smart-colors-workbench-matrix-note" class="wb-snapshot-note">Misure live quando disponibili; altrimenti stime di build etichettate.</p>
<noscript><p class="wb-snapshot-note">Senza JavaScript la matrice mostra solo le prime stime di build, non le misure live.</p></noscript>
<div class="wb-overview-filters" role="search" aria-label="Cerca e filtra gli abbinamenti">
<div class="wb-field"><label for="smart-colors-workbench-matrix-search">Cerca un abbinamento</label><input id="smart-colors-workbench-matrix-search" data-smart-colors-workbench="matrix-search" type="search" placeholder="es. testo card" autocomplete="off" spellcheck="false" disabled></div>
<div class="wb-field"><label for="smart-colors-workbench-matrix-filter">Filtra per esito</label><select id="smart-colors-workbench-matrix-filter" data-smart-colors-workbench="matrix-filter" disabled><option value="">Tutti gli esiti</option><option value="issues">Solo problemi (sotto soglia)</option><option value="below-minimum">Sotto il minimo</option><option value="below-target">Sotto il target</option><option value="pass">Minimo raggiunto</option><option value="unmeasured">Non misurati</option><option value="live">Con misura live</option></select></div>
<div class="wb-field"><label for="smart-colors-workbench-matrix-category">Filtra per tipo</label><select id="smart-colors-workbench-matrix-category" data-smart-colors-workbench="matrix-category" disabled><option value="">Tutti i tipi</option><option value="text">Testo</option><option value="border">Bordo / UI</option><option value="surface">Superficie / Canvas</option><option value="decorative">Decorativo</option></select></div>
<button type="button" id="smart-colors-workbench-matrix-clear" data-smart-colors-workbench="matrix-clear" class="wb-ghost" disabled>Azzera filtri</button>
<label class="wb-scope-toggle"><input id="smart-colors-workbench-matrix-all" data-smart-colors-workbench="matrix-all" type="checkbox" checked disabled> Tutto il catalogo</label>
</div>
<p id="smart-colors-workbench-matrix-count" data-smart-colors-workbench="matrix-count" role="status" aria-live="polite" class="wb-picker-count">${escape(count)}</p>
<details class="is-detail wb-matrix-help"><summary>Come leggere la matrice</summary>
<p class="margin-note">L'ambito iniziale segue il colore sorgente; «Tutto il catalogo» mostra tutte le coppie dichiarate, non ogni combinazione teorica. Campioni e tabella condividono filtri e paginazione. Ogni vista usa la propria misura live, altrimenti una stima di build etichettata: nessun verdetto globale.</p>
</details>
<div class="wb-matrix-toolbar">
<fieldset class="wb-matrix-display"><legend>Visualizzazione</legend><label><input id="smart-colors-workbench-display-grid" type="radio" name="smart-colors-matrix-display" value="grid" disabled> Campioni</label><label><input id="smart-colors-workbench-display-table" type="radio" name="smart-colors-matrix-display" value="table" checked disabled> Tabella</label></fieldset>
<p class="wb-swatch-legend">Diagonale: primo piano in alto a sinistra, sfondo in basso a destra. I nomi dei token identificano i due colori.</p>
</div>
<ul class="wb-matrix-grid" data-smart-colors-workbench="matrix-grid" aria-label="Mappa visiva degli abbinamenti colore" hidden>
${matrixStaticGridHtml(pairs)}
</ul>
<p id="smart-colors-workbench-matrix-no-results" class="wb-matrix-empty" hidden>Nessun abbinamento corrisponde ai filtri. Prova ad azzerarli o ad ampliare l'ambito.</p>
<div id="smart-colors-workbench-matrix-table" class="wb-matrix-scroll" role="region" aria-labelledby="smart-colors-workbench-matrix-caption" aria-describedby="smart-colors-workbench-matrix-note" tabindex="0">
<table class="wb-matrix">
<caption id="smart-colors-workbench-matrix-caption">Abbinamenti tra token: uso e criterio, poi le due viste del confronto con la misura di ciascuna coppia.</caption>
<colgroup><col class="wb-matrix-col-uso"><col class="wb-matrix-col-view"><col class="wb-matrix-col-view"></colgroup>
<thead><tr><th scope="col" class="wb-matrix-uso">Uso e criterio</th><th scope="col" id="smart-colors-workbench-matrix-a" class="wb-matrix-view">Vista A · stima build tema chiaro</th><th scope="col" id="smart-colors-workbench-matrix-b" class="wb-matrix-view">Vista B · stima build tema scuro</th></tr></thead>
<tbody data-smart-colors-workbench="matrix-body">${matrixStaticRowsHtml(pairs)}</tbody>
</table>
</div>
<div class="wb-matrix-pager" aria-label="Pagine degli abbinamenti"><button type="button" id="smart-colors-workbench-matrix-prev" disabled>Precedenti</button><p id="smart-colors-workbench-matrix-page" role="status" aria-live="polite">Snapshot: prime ${Math.min(total, 4)} coppie di ${total}</p><button type="button" id="smart-colors-workbench-matrix-next" disabled>Successivi</button></div>
<a class="wb-detail-link" href="#smart-colors-workbench-inspector">Vai al dettaglio selezionato ↓</a>
</div>
</details>`;
}

function lightRowsHtml(token, control) {
  const id = `smart-colors-workbench-lightness-${control.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return `<fieldset class="wb-l-control" data-smart-colors-workbench="lightness" data-control="${escape(control)}">
<legend>Luminosità L% · <code>${escape(token)}</code></legend>
<div class="wb-l-inputs"><input id="${escape(id)}-range" data-control="${escape(control)}" data-kind="lightness" type="range" min="0" max="100" step="0.1" aria-label="Luminosità L percento per ${escape(token)} (${escape(control)})" aria-describedby="${escape(id)}-note" disabled hidden><input id="${escape(id)}-number" data-control="${escape(control)}" data-kind="lightness" type="number" min="0" max="100" step="any" inputmode="decimal" placeholder="—" aria-label="Valore L percento per ${escape(token)} (${escape(control)})" aria-describedby="${escape(id)}-note" disabled></div>
<span id="${escape(id)}-note" class="margin-note">La L corrente sarà disponibile dal runtime dopo la misura; nessun valore viene inventato. La regolazione invia solo L: C e H sono quelli del colore calcolato; gli altri knob (mix/macro) restano attivi.</span>
</fieldset>`;
}

/**
 * Static guided workbench. The interactive workspace is the main content: a compact horizontal toolbar
 * with the bounded source strip, a human current-use summary and a "Cambia uso" opener, the
 * comparison modes and the theme, then the full-width comparison area with the visible pair identity,
 * the real CSS specimens and their scoped results. The opener reveals a native modal with search,
 * category and paginated uses. The verbose source-palette archive follows it inside a closed native
 * detail. Every action is a native control and remains inert without JS.
 */
export function renderContrastWorkbench(session) {
  const value = record(session) ? session : {};
  const language = createDesignerLanguage();
  const tools = createDesignTools();
  const design = record(value.design) ? value.design : null;
  const pairs = pairCatalogue(value, design, language);
  const selected = pairs.find((pair) => worstStatus(pair) !== "pass") || pairs[0] || null;
  const sources = sourceCatalogue(value, design, tools);
  const tuning = tuningState(value);
  const thresholdsNote = "Minimo e target restano separati: il minimo è la soglia dichiarata, il target è l'obiettivo del generatore. Nessun rapporto viene calcolato qui.";
  // The primary picker starts on the static best pair's own source; the runtime then keeps this in
  // sync with the active selection.
  const defaultSource = selected && selected.sources.length ? selected.sources[0] : "";
  const defaultSourceEntry = sources.entries.find((e) => e.token === defaultSource) || sources.entries[0] || null;
  const defaultDarkBlendNote = defaultSourceEntry ? darkBlendLine(design, defaultSourceEntry, tools) : "";
  const currentTitle = selected ? selected.title : "Nessuna coppia selezionata";
  const currentHuman = selected ? pairPickerDisplay(selected) : "Nessuna coppia selezionata";
  const currentKind = selected ? pairKindLabel(selected) : "";
  const currentTech = selected && !pairHasPickerLabel(selected) ? `${selected.foreground} su ${selected.background}` : "";
  const picker = pickerModel(pairs, design, sources, defaultSource, selected ? pickerValue(selected) : "");
  const identityHtml = pairIdentityHtml(selected);
  const purposeText = pairPurposeText(selected);
  const initialSnippet = selected ? pairCompactSnippet(selected.foreground, selected.background, selected.property) : "/* Nessun abbinamento selezionato */";
  const initialHarmony = "Relazione cromatica descrittiva: non è una verifica di accessibilità.";
  return `<section id="banco" aria-labelledby="banco-titolo"><h2 id="banco-titolo" class="wb-visually-hidden">Banco di contrasto guidato</h2>
<div id="${HOST_ID}" ${HOOK}="host">
<noscript><p class="wb-nojs">JavaScript è disattivato: i pulsanti dei colori restano inerti e nessuna misura live viene eseguita. La matrice mostra solo dati dello snapshot di build.</p></noscript>
<div class="wb-shell"><div class="wb-workspace">
<section class="wb-toolbar" aria-labelledby="smart-colors-workbench-toolbar-title">
<h3 id="smart-colors-workbench-toolbar-title" class="wb-visually-hidden">Selezione e confronto</h3>
<div class="wb-toolbar-line wb-palette-line">
<div class="wb-field wb-source-select"><label for="smart-colors-workbench-source">Colore sorgente</label><select id="smart-colors-workbench-source" ${HOOK}="source">${sourceOptionsHtml(sources.entries, selected)}</select></div>
<span id="smart-colors-workbench-palette-label" class="wb-palette-label">Colore sorgente</span>
${sourceSwatchesHtml(sources.entries, defaultSource)}
</div>
<div class="wb-toolbar-line wb-control-line">
<div class="wb-current-use">
<span class="wb-current-use-label">Uso attuale</span>
<p id="smart-colors-workbench-current-use" ${HOOK}="current-use" class="wb-current-use-value"><strong>${escape(currentHuman)}</strong>${currentKind ? `<span class="wb-current-use-kind">${escape(currentKind)}</span>` : ""}${currentTech ? `<code class="wb-current-use-tech">${escape(currentTech)}</code>` : ""}</p>
</div>
<button type="button" id="smart-colors-workbench-open-picker" ${HOOK}="open-picker" class="wb-open-picker" aria-haspopup="dialog" disabled>Cambia uso</button>
<form id="smart-colors-workbench-selection" class="wb-compare" data-smart-colors-workbench="selection">
<fieldset class="wb-fieldset"><legend>Confronta</legend><label><input id="smart-colors-workbench-comparison-themes" type="radio" name="smart-colors-workbench-comparison" value="themes" checked> Chiaro/scuro</label><label><input id="smart-colors-workbench-comparison-tuning" type="radio" name="smart-colors-workbench-comparison" value="tuning"${tuning.available ? "" : " disabled"}> Generato/tuning</label><label><input id="smart-colors-workbench-comparison-draft" type="radio" name="smart-colors-workbench-comparison" value="draft"${tuning.available ? "" : " disabled"}> Prima/dopo</label>${tuning.available ? "" : `<span class="margin-note">Confronti personalizzati non disponibili: ${escape(tuning.reason)}.</span>`}</fieldset>
<fieldset class="wb-fieldset wb-theme-fieldset"><legend>Tema per le modifiche</legend><label><input id="smart-colors-workbench-theme-light" type="radio" name="smart-colors-workbench-theme" value="light" form="smart-colors-workbench-selection" checked> chiaro</label><label><input id="smart-colors-workbench-theme-dark" type="radio" name="smart-colors-workbench-theme" value="dark" form="smart-colors-workbench-selection"> scuro</label></fieldset>
</form>
</div>
</section>
${matrixHtml(pairs)}
<div class="wb-main">
<div class="wb-main-split">
<section id="smart-colors-workbench-inspector" class="wb-pane-inspector" aria-labelledby="smart-colors-workbench-current" tabindex="-1">
<header class="wb-head">
<div class="wb-inspector-heading"><h3 id="smart-colors-workbench-current" ${HOOK}="current" class="wb-current"><strong>${escape(currentTitle)}</strong></h3><span class="wb-selected-note">Abbinamento selezionato</span></div>
<p id="smart-colors-workbench-identity" ${HOOK}="identity" class="wb-identity">${identityHtml}</p>
<p id="smart-colors-workbench-purpose" ${HOOK}="purpose" class="wb-purpose">${escape(purposeText)}</p>
</header>

<p id="smart-colors-workbench-status" ${HOOK}="status" role="status" aria-live="polite" class="wb-status">Misura non disponibile senza JavaScript.</p>
<div id="smart-colors-workbench-result" ${HOOK}="result" class="wb-frames" role="group" aria-label="Campioni CSS del consumatore">
<section class="wb-view" aria-labelledby="smart-colors-workbench-left-title"><div class="wb-view-head"><span data-smart-colors-workbench="left-sample" class="wb-aa is-unmeasured" aria-hidden="true">Aa</span><h3 id="smart-colors-workbench-left-title" class="wb-view-title">Tema chiaro</h3></div><span id="smart-colors-workbench-left-meta" data-smart-colors-workbench="left-meta" class="wb-view-meta wb-visually-hidden"></span><div id="smart-colors-workbench-left" ${HOOK}="left" class="wb-frame" role="group" aria-label="Vista CSS sinistra"></div><dl id="smart-colors-workbench-left-measure" ${HOOK}="left-measure" class="wb-measure"><div class="wb-measure-row wb-measure-ratio"><dt class="wb-visually-hidden">Rapporto</dt><dd><span class="wb-verdict" data-status="unmeasured">Non misurato</span> · serve JavaScript</dd></div></dl></section>
<section class="wb-view" aria-labelledby="smart-colors-workbench-right-title"><div class="wb-view-head"><span data-smart-colors-workbench="right-sample" class="wb-aa is-unmeasured" aria-hidden="true">Aa</span><h3 id="smart-colors-workbench-right-title" class="wb-view-title">Tema scuro</h3></div><span id="smart-colors-workbench-right-meta" data-smart-colors-workbench="right-meta" class="wb-view-meta wb-visually-hidden"></span><div id="smart-colors-workbench-right" ${HOOK}="right" class="wb-frame" role="group" aria-label="Vista CSS destra"></div><dl id="smart-colors-workbench-right-measure" ${HOOK}="right-measure" class="wb-measure"><div class="wb-measure-row wb-measure-ratio"><dt class="wb-visually-hidden">Rapporto</dt><dd><span class="wb-verdict" data-status="unmeasured">Non misurato</span> · serve JavaScript</dd></div></dl></section>
</div>
<p id="smart-colors-workbench-empty" ${HOOK}="empty" class="wb-uses-empty" hidden>Nessuna coppia diagnostica per questa sorgente. Scegli un altro colore.</p>
<p class="wb-scope-note">Le misure valgono per la coppia e il tema mostrati: non sono un verdetto di conformità globale.</p>
<details class="is-detail wb-advanced" data-smart-colors-workbench="manual" open><summary>Regola la coppia (L)</summary>
<form class="wb-controls" data-smart-colors-workbench="controls">
<p class="margin-note">L e mix agiscono sulla bozza temporanea della coppia e del tema attivo; la palette sorgente resta di sola lettura. Il CSS testuale è un'alternativa avanzata.</p>
<div id="smart-colors-workbench-controls" ${HOOK}="controls-body">${controlRowsHtml(selected, "light", design)}</div>
<div class="wb-actions"><button type="submit" id="smart-colors-workbench-controls-submit">Applica override</button><button type="button" id="smart-colors-workbench-reset-pair" ${HOOK}="reset-pair">Scarta la bozza della coppia</button><button type="button" id="smart-colors-workbench-reset-all" ${HOOK}="reset-all">Scarta la bozza di tuning</button></div>
<p class="margin-note">«Scarta la bozza…» non rimuove gli override già salvati: per quelli usa «Rimuovi personalizzazione» sul singolo controllo.</p>
<p class="margin-note">Un override completo ha precedenza sul mix della superficie; il mix resta un valore pubblico separato.</p>
</form>
</details>
<section class="wb-action-strip wb-suggestions" data-smart-colors-workbench="correction" aria-labelledby="smart-colors-workbench-suggestions-title">
<div class="wb-strip-head"><h3 id="smart-colors-workbench-suggestions-title">Cerca una correzione</h3><p id="smart-colors-workbench-action-theme" ${HOOK}="action-theme" class="wb-action-theme">Tema per proposta e override: chiaro.</p></div>
<div class="wb-actions"><button type="button" id="smart-colors-workbench-suggest-foreground" ${HOOK}="suggest-foreground">Correggi testo</button><button type="button" id="smart-colors-workbench-suggest-background" ${HOOK}="suggest-background">Correggi sfondo</button><button type="button" id="smart-colors-workbench-discard-suggestion" ${HOOK}="discard-suggestion" hidden disabled>Scarta proposta</button><button type="button" id="smart-colors-workbench-apply" ${HOOK}="apply" hidden disabled>Prova proposta</button></div>
<div id="smart-colors-workbench-proposal" ${HOOK}="proposal" class="wb-proposal">Nessuna proposta richiesta.</div>
<section id="smart-colors-workbench-proposal-frames" ${HOOK}="proposal-frames" class="wb-frames wb-proposal-frames" hidden aria-labelledby="smart-colors-workbench-proposal-frames-title">
<h4 id="smart-colors-workbench-proposal-frames-title">Viste verificate della proposta</h4>
<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-frames-title smart-colors-workbench-proposal-before-title"><h4 id="smart-colors-workbench-proposal-before-title">Attuale</h4><div id="smart-colors-workbench-proposal-before" ${HOOK}="proposal-before" class="wb-frame" role="region" tabindex="0" aria-label="Vista CSS attuale della proposta: viewport di verifica fisso 360×480; scorri orizzontalmente per vedere tutta la vista"></div></section>
<section class="wb-view" aria-labelledby="smart-colors-workbench-proposal-frames-title smart-colors-workbench-proposal-after-title"><h4 id="smart-colors-workbench-proposal-after-title">Proposta</h4><div id="smart-colors-workbench-proposal-after" ${HOOK}="proposal-after" class="wb-frame" role="region" tabindex="0" aria-label="Vista CSS proposta: viewport di verifica fisso 360×480; scorri orizzontalmente per vedere tutta la vista"></div></section>
</section>
</section>
<details class="is-detail wb-how"><summary>Come funziona la ricerca della correzione</summary>
<p class="margin-note">La ricerca varia la luminosità quanto basta per raggiungere il minimo dichiarato, non il target del progetto, e non cerca il colore più vicino in ΔE.</p>
</details>
<details class="wb-code-details" data-smart-colors-workbench="snippet-card"><summary id="smart-colors-workbench-snippet-title">Codice CSS e relazione cromatica</summary>
<div class="wb-snippet-header"><button type="button" id="smart-colors-workbench-copy-snippet" ${HOOK}="copy-snippet" class="wb-snippet-copy-btn" disabled>Copia codice CSS</button></div>
<pre class="wb-snippet-pre" tabindex="0" aria-label="Codice CSS dell'abbinamento"><code id="smart-colors-workbench-snippet-code" ${HOOK}="snippet-code">${escape(initialSnippet)}</code></pre>
<p id="smart-colors-workbench-harmony" ${HOOK}="harmony" class="wb-harmony-note margin-note">${escape(initialHarmony)}</p>
</details>
</section>
<section id="smart-colors-workbench-tuning" class="wb-pane-export" aria-labelledby="smart-colors-workbench-tuning-title">
<div class="wb-export-panel-head">
<div class="wb-export-panel-title-wrap">
<span class="wb-export-panel-icon" aria-hidden="true">💾</span>
<h3 id="smart-colors-workbench-tuning-title" class="wb-export-panel-title">Tuning ed esportazione</h3>
</div>
<span class="wb-export-panel-desc">Esporta gli override temporanei. Nessun file del progetto viene modificato automaticamente.</span>
</div>
<details class="is-detail"><summary>Indicazioni per dark-blend nella palette</summary>
<aside class="wb-darkblend-callout" data-smart-colors-workbench="darkblend-callout">
<div class="wb-darkblend-icon" aria-hidden="true">🌓</div>
<div class="wb-darkblend-body">
<h4>Ottimizzazione Dark Mode: <code>dark-blend</code> in <code>palette.css</code></h4>
<p class="margin-note">Il trigger <code>dark-blend</code> (0–100) regola lo sbiadimento verso il bianco nel tema scuro senza mai scurire. Regola gli slider per sperimentare override temporanei per <code>colors-tuning.css</code>, oppure imposta <code>dark-blend</code> direttamente in <code>src/styles/tokens/palette.css</code>.</p>
<p id="smart-colors-workbench-darkblend-current" ${HOOK}="darkblend-current" class="wb-darkblend-current margin-note">Sorgente attiva: <strong>${escape(defaultSource || "nessuna")}</strong>${defaultDarkBlendNote ? ` · ${escape(defaultDarkBlendNote)}` : ""}</p>
</div>
</aside></details>
<details class="is-detail wb-export" data-smart-colors-workbench="export"><summary>Esporta modifiche</summary>
<p class="margin-note">Il comando di esportazione è nell'intestazione della pagina. Qui restano il CSS generato e il download manuale.</p>
<div class="wb-actions"><button type="button" id="smart-colors-workbench-copy-export" ${HOOK}="copy-export">Seleziona il CSS esportato</button></div>
<p id="smart-colors-workbench-export-note" class="margin-note">Nessun tuning pubblico da esportare: nessun override attivo.</p>
<p id="smart-colors-workbench-export-mode" class="margin-note">Export non ancora richiesto.</p>
<label for="smart-colors-workbench-export-text">CSS pubblico esportato, selezionabile senza permessi clipboard</label>
<textarea id="smart-colors-workbench-export-text" ${HOOK}="export-text" aria-describedby="smart-colors-workbench-export-note" readonly rows="8"></textarea>
<a id="smart-colors-workbench-download" ${HOOK}="download" hidden>Scarica colors-tuning.css (azione manuale)</a>
</details>
<details class="is-detail wb-criteria" data-smart-colors-workbench="criteria"><summary>Soglie di riferimento e testo grande</summary>
<dl class="wb-criteria-list">
<div><dt>Testo normale · AA</dt><dd>4,5:1 · <a href="https://www.w3.org/TR/WCAG22/#contrast-minimum">SC 1.4.3</a></dd></div>
<div><dt>Testo normale · AAA</dt><dd>7:1 · <a href="https://www.w3.org/TR/WCAG22/#contrast-enhanced">SC 1.4.6</a></dd></div>
<div><dt>Testo grande · AA</dt><dd>3:1 · 18 pt / 24 CSS px regular oppure 14 pt / ~18,67 CSS px bold · <a href="https://www.w3.org/TR/WCAG22/#contrast-minimum">SC 1.4.3</a></dd></div>
<div><dt>Testo grande · AAA</dt><dd>4,5:1 · <a href="https://www.w3.org/TR/WCAG22/#contrast-enhanced">SC 1.4.6</a></dd></div>
<div><dt>Componenti non testuali</dt><dd><a href="https://www.w3.org/TR/WCAG22/#non-text-contrast">SC 1.4.11</a> · 3:1 solo per le informazioni necessarie a identificare componenti e stati; i bordi decorativi non sono automaticamente soggetti.</dd></div>
<div><dt>Anello statico</dt><dd>Test del solo colore: non verifica comportamento, visibilità, oscuramento o aspetto.</dd></div>
<div><dt>Target del progetto</dt><dd>Obiettivo separato dal minimo WCAG; per esempio 7,5:1 non è una soglia WCAG.</dd></div>
</dl>
</details>
<details class="is-detail wb-technical"><summary>Dettagli tecnici della coppia e selezione completa</summary>
<button type="submit" form="smart-colors-workbench-selection" id="smart-colors-workbench-submit" class="wb-ghost">Aggiorna il confronto</button>
<div class="wb-field wb-pair-field"><label for="smart-colors-workbench-pair">Abbinamento tecnico</label><select id="smart-colors-workbench-pair" ${HOOK}="pair"${pairs.length ? "" : " disabled"}>${pairOptionsHtml(pairs, selected)}</select><span class="margin-note">Fallback tecnico: la scelta principale è «Cambia uso»; questo selettore resta per l'accesso diretto al catalogo completo.</span></div>
<div id="smart-colors-workbench-details" ${HOOK}="details">${pairDetailsHtml(selected, value, design, language, sources.entries, "light")}</div>
<details id="smart-colors-workbench-catalogue" ${HOOK}="catalogue" class="is-detail"><summary>Catalogo completo dei token</summary>
${tokenCatalogueHtml(design, pairs, sources)}
</details>
<p class="margin-note">${escape(thresholdsNote)}</p>
</details>
<details class="is-detail wb-exploration" data-smart-colors-workbench="exploration" hidden>
<summary>Tutte le combinazioni dei colori base (esplorazione)</summary>
<p class="margin-note">Massimo 24 famiglie, coppie non self, sola lettura. È un'anteprima advisory: non entra nella copertura primaria, non abilita l'uscita e non è un verdetto di conformità.</p>
<div class="wb-actions"><button type="button" id="smart-colors-workbench-exploration-run" data-smart-colors-workbench="exploration-run" disabled>Misura le combinazioni dei colori base</button></div>
<p id="smart-colors-workbench-exploration-status" data-smart-colors-workbench="exploration-status" role="status" aria-live="polite" class="margin-note">Non misurato. Nessun dato vecchio viene mostrato.</p>
<div id="smart-colors-workbench-exploration-results" data-smart-colors-workbench="exploration-results" class="wb-matrix-scroll"></div>
</details>
</section>
</div>
</div>
</div>
</div>
<dialog id="smart-colors-workbench-picker" class="wb-picker-dialog" aria-labelledby="smart-colors-workbench-picker-title" aria-describedby="smart-colors-workbench-picker-source">
<div class="wb-picker-panel">
<div class="wb-picker-header">
<h2 id="smart-colors-workbench-picker-title">Scegli cosa verificare</h2>
<p id="smart-colors-workbench-picker-source" ${HOOK}="picker-source" class="margin-note">${escape(picker.sourceNote)}</p>
</div>
<div class="wb-picker-filters">
<div class="wb-field"><label for="smart-colors-workbench-use-search">Cerca un uso</label><input id="smart-colors-workbench-use-search" ${HOOK}="use-search" type="search" placeholder="es. testo card" autocomplete="off" spellcheck="false" disabled></div>
<div class="wb-field"><label for="smart-colors-workbench-use-category">Tipo di uso</label><select id="smart-colors-workbench-use-category" ${HOOK}="use-category" disabled><option value="">Tutti gli usi</option>${picker.categoriesHtml}</select></div>
<button type="button" id="smart-colors-workbench-clear-search" ${HOOK}="clear-search" class="wb-ghost" disabled>Azzera filtri</button>
</div>
<p id="smart-colors-workbench-use-count" ${HOOK}="use-count" role="status" aria-live="polite" class="wb-picker-count">${escape(picker.count)}</p>
<div id="smart-colors-workbench-uses" ${HOOK}="uses" class="wb-picker-results">${picker.resultsHtml}</div>
<div class="wb-picker-footer">
<button type="button" id="smart-colors-workbench-use-prev" ${HOOK}="use-prev" class="wb-pager" aria-disabled="true" disabled>Precedenti</button>
<button type="button" id="smart-colors-workbench-use-next" ${HOOK}="use-next" class="wb-pager" aria-disabled="true" disabled>Successivi</button>
<button type="button" id="smart-colors-workbench-close-picker" ${HOOK}="close-picker" disabled>Chiudi</button>
</div>
</div>
</dialog>
</div>
</section>
${sourcePaletteHtml(value, design, tools, language)}`;
}

/**
 * Serialized view factory. It is deliberately self-contained: no import, no
 * module-scope binding and no external helper. Every dynamic node is created with
 * DOM methods and written with `textContent`.
 */
export function createContrastWorkbenchView(deps) {
  var doc = deps && deps.document;
  var controller = deps && deps.controller;
  var host = doc && typeof doc.getElementById === "function" ? doc.getElementById("smart-colors-workbench") : null;
  if (!doc || !host || typeof doc.createElement !== "function") return null;
  if (!controller || typeof controller.select !== "function" || typeof controller.subscribe !== "function") {
    throw new TypeError("createContrastWorkbenchView requires the workbench controller installed by contrast-workbench-runtime.mjs");
  }
  var HOOK = "data-smart-colors-workbench";

  function byId(id) { return doc.getElementById(id); }
  function make(tag, className, value) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined && value !== null) node.textContent = String(value);
    return node;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function isRecord(value) { return value !== null && typeof value === "object"; }
  function finite(value) { return typeof value === "number" && isFinite(value); }
  function attribute(node, name) { return node && typeof node.getAttribute === "function" ? node.getAttribute(name) : null; }
  function setAttribute(node, name, value) { if (node && typeof node.setAttribute === "function") node.setAttribute(name, value); }
  function textOf(value) { return value === null || value === undefined ? "" : String(value); }
  var INVALID_L = "L non valida: 0–100.";

  var status = host.querySelector("[" + HOOK + '="status"]');
  var sourceSelect = byId("smart-colors-workbench-source");
  var pairSelect = byId("smart-colors-workbench-pair");
  var themeLight = byId("smart-colors-workbench-theme-light");
  var themeDark = byId("smart-colors-workbench-theme-dark");
  var comparisonThemes = byId("smart-colors-workbench-comparison-themes");
  var comparisonTuning = byId("smart-colors-workbench-comparison-tuning");
  var comparisonDraft = byId("smart-colors-workbench-comparison-draft");
  var details = byId("smart-colors-workbench-details");
  var left = byId("smart-colors-workbench-left");
  var right = byId("smart-colors-workbench-right");
  var leftMeasure = byId("smart-colors-workbench-left-measure");
  var rightMeasure = byId("smart-colors-workbench-right-measure");
  var controlsBody = byId("smart-colors-workbench-controls");
  var proposal = byId("smart-colors-workbench-proposal");
  var proposalFrames = byId("smart-colors-workbench-proposal-frames");
  var proposalBefore = byId("smart-colors-workbench-proposal-before");
  var proposalAfter = byId("smart-colors-workbench-proposal-after");
  var applyButton = byId("smart-colors-workbench-apply");
  var discardButton = byId("smart-colors-workbench-discard-suggestion");
  var exportButton = byId("smart-colors-workbench-export");
  var sessionStatus = byId("smart-colors-workbench-session-status");
  var exportText = byId("smart-colors-workbench-export-text");
  var exportNote = byId("smart-colors-workbench-export-note");
  var download = byId("smart-colors-workbench-download");
  var copyPalette = byId("smart-colors-workbench-copy-palette");
  var paletteSource = byId("smart-colors-workbench-palette-source");
  var selectionForm = host.querySelector("[" + HOOK + '="selection"]');
  var controlsForm = host.querySelector("[" + HOOK + '="controls"]');
  var submit = byId("smart-colors-workbench-submit");
  var controlsSubmit = byId("smart-colors-workbench-controls-submit");
  var resetPair = byId("smart-colors-workbench-reset-pair");
  var resetAll = byId("smart-colors-workbench-reset-all");
  var suggestForeground = byId("smart-colors-workbench-suggest-foreground");
  var suggestBackground = byId("smart-colors-workbench-suggest-background");
  var leftTitle = byId("smart-colors-workbench-left-title");
  var rightTitle = byId("smart-colors-workbench-right-title");
  var usesBox = host.querySelector("[" + HOOK + '="uses"]');
  var currentUse = byId("smart-colors-workbench-current-use");
  var openPicker = byId("smart-colors-workbench-open-picker");
  var pickerDialog = byId("smart-colors-workbench-picker");
  var pickerSource = byId("smart-colors-workbench-picker-source");
  var useSearch = byId("smart-colors-workbench-use-search");
  var useCategory = byId("smart-colors-workbench-use-category");
  var useClear = byId("smart-colors-workbench-clear-search");
  var useCount = byId("smart-colors-workbench-use-count");
  var usePrev = byId("smart-colors-workbench-use-prev");
  var useNext = byId("smart-colors-workbench-use-next");
  var closePicker = byId("smart-colors-workbench-close-picker");
  var currentHeading = byId("smart-colors-workbench-current");
  var identityNode = byId("smart-colors-workbench-identity");
  var darkBlendCurrent = byId("smart-colors-workbench-darkblend-current");
  var snippetCode = byId("smart-colors-workbench-snippet-code");
  var copySnippet = byId("smart-colors-workbench-copy-snippet");
  var harmonyNode = byId("smart-colors-workbench-harmony");
  var purposeNode = byId("smart-colors-workbench-purpose");
  var actionThemeNode = byId("smart-colors-workbench-action-theme");
  var suggestionsTitle = byId("smart-colors-workbench-suggestions-title");
  var resultBox = byId("smart-colors-workbench-result");
  var emptyNote = byId("smart-colors-workbench-empty");
  var correctionBox = host.querySelector("[" + HOOK + '="correction"]');
  var manualBox = host.querySelector("[" + HOOK + '="manual"]');
  var exportBox = host.querySelector("[" + HOOK + '="export"]');

  var matrixSearch = byId("smart-colors-workbench-matrix-search");
  var matrixFilter = byId("smart-colors-workbench-matrix-filter");
  var matrixCategory = byId("smart-colors-workbench-matrix-category");
  var matrixTable = byId("smart-colors-workbench-matrix-table");
  var matrixDisplayGrid = byId("smart-colors-workbench-display-grid");
  var matrixDisplayTable = byId("smart-colors-workbench-display-table");
  var matrixPrev = byId("smart-colors-workbench-matrix-prev");
  var matrixNext = byId("smart-colors-workbench-matrix-next");
  var matrixPageNote = byId("smart-colors-workbench-matrix-page");
  var matrixNoResults = byId("smart-colors-workbench-matrix-no-results");
  var matrixPage = 0;
  var matrixPageSize = 8;
  var matrixFilterKey = null;
  var matrixMatches = null;
  var matrixClear = byId("smart-colors-workbench-matrix-clear");
  var matrixAll = byId("smart-colors-workbench-matrix-all");
  var overviewScope = byId("smart-colors-workbench-overview-scope");
  var matrixCount = byId("smart-colors-workbench-matrix-count");
  var matrixViewA = byId("smart-colors-workbench-matrix-a");
  var matrixViewB = byId("smart-colors-workbench-matrix-b");
  var leftSample = host.querySelector("[" + HOOK + '="left-sample"]');
  var leftMeta = host.querySelector("[" + HOOK + '="left-meta"]');
  var rightSample = host.querySelector("[" + HOOK + '="right-sample"]');
  var rightMeta = host.querySelector("[" + HOOK + '="right-meta"]');
  var explorationBox = host.querySelector("[" + HOOK + '="exploration"]');
  var explorationRun = byId("smart-colors-workbench-exploration-run");
  var explorationStatus = host.querySelector("[" + HOOK + '="exploration-status"]');
  var explorationResults = host.querySelector("[" + HOOK + '="exploration-results"]');
  var exportMode = byId("smart-colors-workbench-export-mode");
  var swatchNodes = host.querySelectorAll("[" + HOOK + '="swatch"]');
  var swatchButtons = [];
  for (var swatchIndex = 0; swatchIndex < swatchNodes.length; swatchIndex += 1) swatchButtons.push(swatchNodes[swatchIndex]);
  var matrixBody = host.querySelector("[" + HOOK + '="matrix-body"]');
  var matrixGrid = host.querySelector("[" + HOOK + '="matrix-grid"]');
  var matrixEntries = [];
  var matrixTiles = [];
  var matrixEmptyRow = null;
  var lastState = null;
  var lastAnnouncement = "";
  var lastControlsKey = "";
  var lastSelectionKey = null;
  var lastDetailsSignature = null;
  var selectionAvailable = true;
  var lastDraftSignature = null;
  var lastRevision = null;
  var controlInputs = [];
  var lightnessInputs = [];
  var lastExportStamp = null;
  var lastExplorationSignature = null;
  var useButtons = [];
  var lastUsesSource = null;
  var lastUsesKey = null;
  var pickerQuery = "";
  var pickerCategory = "";
  var pickerPage = 0;
  var busy = false;
  var overridesPending = false;
  var useVisibleLimit = 6;
  var sourceBlocked = false;
  var blockedSource = null;
  var blockedPairId = null;
  var suggestionVerified = false;
  var suggestionPresent = false;
  var unsubscribe = null;
  var mounted = false;
  var payload = null;

  function readPayload() {
    if (payload) return payload;
    var node = byId("smart-colors-payload");
    if (!node) return null;
    try { payload = JSON.parse(node.textContent || ""); } catch (error) { payload = null; }
    return payload;
  }
  function design() {
    var value = readPayload();
    return value && isRecord(value.design) ? value.design : null;
  }
  function cssMeta() {
    var value = readPayload();
    return value && isRecord(value.css) ? value.css : {};
  }
  function tuningAvailable() {
    var css = cssMeta();
    return typeof css.tuning === "string" && css.tuning !== "" && css.tuningSupport === "supported";
  }
  function announce(message) {
    if (!status) return;
    var next = String(message);
    if (next === lastAnnouncement) return;
    lastAnnouncement = next;
    status.textContent = next;
  }
  function setStatusVisibility(phase, hasError, blocked) {
    if (!status) return;
    var quiet = phase === "complete" && !hasError && !blocked;
    var className = quiet ? "wb-status wb-visually-hidden" : "wb-status";
    if (status.className !== className) status.className = className;
  }
  function themeName(value) { return value === "dark" ? "scuro" : "chiaro"; }
  function variantName(value) {
    if (value === "baseline") return "senza tuning";
    if (value === "tuned") return "con tuning";
    if (value === "draft") return "bozza";
    return "variante non indicata";
  }
  function compactThreshold(value) {
    if (!finite(value)) return "soglia non dichiarata";
    return String(Math.round(value * 100) / 100).replace(".", ",") + ":1";
  }
  function declaredKindOf(option) {
    var kind = attribute(option, "data-kind");
    if (kind === "on-color") return "text";
    return kind === "text" || kind === "non-text" ? kind : null;
  }
  function catalogueKindOf(option) {
    var runtime = attribute(option, "data-pair-kind");
    if (runtime === "on-color") return "on-color";
    var kind = attribute(option, "data-catalogue-kind");
    if (kind === "text" || kind === "non-text" || kind === "on-color") return kind;
    return declaredKindOf(option);
  }
  function criterionFor(option, measurement) {
    var declared = declaredKindOf(option);
    var minimum = measurement && finite(measurement.minimum) && measurement.minimum > 0 ? measurement.minimum : null;
    var target = measurement && finite(measurement.target) && measurement.target > 0 ? measurement.target : null;
    var ratio = measurement && finite(measurement.ratio) ? measurement.ratio : null;
    var status = measurement && typeof measurement.status === "string" ? measurement.status : null;
    var supportedStatus = status === "pass" || status === "below-target" || status === "below-minimum";
    var normative = declared === "text" ? 4.5 : declared === "non-text" ? 3 : null;
    var canonical = normative !== null && minimum !== null && Math.abs(minimum - normative) < 1e-9;
    var expectedStatus = ratio !== null && minimum !== null
      ? (ratio < minimum ? "below-minimum" : target !== null && ratio < target ? "below-target" : "pass")
      : null;
    var reason = null;
    if (!declared) reason = "kind";
    else if (!supportedStatus) reason = "status";
    else if (minimum === null || ratio === null) reason = "measure";
    else if (!canonical) reason = "threshold";
    else if (expectedStatus !== status) reason = "status";
    var measured = reason === null;
    return {
      kind: declared,
      catalogueKind: catalogueKindOf(option),
      minimum: minimum,
      target: target,
      ratio: ratio,
      status: status,
      normative: normative,
      canonical: canonical,
      measured: measured,
      reason: reason,
      reached: measured ? ratio >= minimum : null,
      targetReached: measured && target !== null ? ratio >= target : null,
    };
  }
  function criterionStatus(criterion) {
    if (!criterion.measured) return "unmeasured";
    if (!criterion.reached) return "below-minimum";
    return criterion.targetReached === false ? "below-target" : "pass";
  }
  function criterionLabel(criterion) {
    if (!criterion.measured) {
      return criterion.reason === "kind" || criterion.reason === "threshold" ? "Non applicabile" : "Non misurato";
    }
    if (criterion.kind === "non-text") {
      return "Soglia di confronto " + compactThreshold(criterion.minimum) + (criterion.reached ? " raggiunta" : " non raggiunta");
    }
    return "Soglia AA per testo normale " + (criterion.reached ? "raggiunta" : "non raggiunta");
  }
  function criterionValue(criterion) {
    if (criterion.measured) {
      return (criterion.kind === "non-text" ? "SC 1.4.11 · " : "SC 1.4.3 · ") + ratioText(criterion.minimum);
    }
    if (criterion.reason === "kind") return "Tipo di coppia non riconosciuto: nessun criterio WCAG applicato.";
    if (criterion.reason === "threshold") return "Soglia non canonica per questo tipo: nessun criterio WCAG applicato.";
    if (criterion.reason === "status") return "Stato di misura non supportato o incoerente: nessun esito.";
    return "Misura assente o incompleta.";
  }
  function targetText(criterion) {
    if (criterion.target === null) return "non dichiarato";
    if (!criterion.measured) return ratioText(criterion.target) + " · non misurato";
    return ratioText(criterion.target) + (criterion.targetReached ? " · raggiunto" : " · non raggiunto");
  }
  function optionKindLabel(option) {
    if (!option) return "coppia non indicata";
    if (!declaredKindOf(option)) return "tipo non riconosciuto";
    if (catalogueKindOf(option) === "on-color") return "testo su riempimento";
    if (attribute(option, "data-kind") !== "non-text") return "testo";
    return /focus-ring/.test(attribute(option, "data-fg") || "") ? "anello" : "bordo";
  }
  function purposeFor(option) {
    if (!option) return "Scegli una coppia dal catalogo generato per leggere il criterio applicato.";
    var kind = declaredKindOf(option);
    if (!kind) return "Tipo di coppia non riconosciuto: nessun criterio WCAG viene applicato.";
    if (kind === "non-text") {
      return "Componente non testuale · 3:1 (SC 1.4.11). Il campione statico non verifica focus, comportamento o oscuramento.";
    }
    if (catalogueKindOf(option) === "on-color") {
      return "Testo su riempimento · AA 4,5:1 (SC 1.4.3) · etichetta a 16 px.";
    }
    return "Testo normale · AA 4,5:1 (SC 1.4.3) · campione a 16 px.";
  }
  function ratioText(value, thresholds) {
    if (!finite(value)) return "non misurata";
    var rounded = Math.round(value * 100) / 100;
    var crossed = [];
    for (var index = 0; thresholds && index < thresholds.length; index += 1) {
      var threshold = thresholds[index];
      if (finite(threshold) && value < threshold && rounded >= threshold) crossed.push(threshold);
    }
    if (crossed.length) return "< " + String(Math.min.apply(null, crossed)).replace(".", ",") + ":1";
    return (rounded === value ? "" : "circa ") + rounded.toFixed(2).replace(".", ",") + ":1";
  }
  function bytesText(variant) {
    var css = cssMeta();
    if (variant === "tuned") return "tuning pubblico applicato ai byte catturati";
    if (variant === "draft") return "bozza temporanea di override";
    if (css.status === "stale") return "output non aggiornato (stale)";
    if (css.source === "generated-candidate") return "candidato generato (diagnostico), non output";
    if (css.status === "absent") return "output assente: byte candidati";
    if (css.status === "empty") return "output vuoto: nessun byte utilizzabile";
    if (css.source === "output") return "output attuale del progetto";
    return "provenienza CSS non indicata";
  }
  function checkedTheme() { return themeDark && themeDark.checked ? "dark" : "light"; }
  function checkedComparison() {
    if (comparisonTuning && comparisonTuning.checked) return "tuning";
    if (comparisonDraft && comparisonDraft.checked) return "draft";
    return "themes";
  }
  function options() {
    if (!pairSelect) return [];
    if (pairSelect.options && typeof pairSelect.options.length === "number") return Array.prototype.slice.call(pairSelect.options);
    return [];
  }
  function selectedOption() {
    var list = options();
    for (var index = 0; index < list.length; index += 1) {
      if (list[index].selected || list[index].value === pairSelect.value) return list[index];
    }
    return list.length ? list[0] : null;
  }
  function optionByValue(value) {
    var list = options();
    for (var index = 0; index < list.length; index += 1) {
      if (list[index].value === value) return list[index];
    }
    return null;
  }
  function viewMatchesOption(view, option) {
    if (!view || !option) return true;
    var pair = isRecord(view.pair) ? view.pair : null;
    if (!pair) return true;
    var foreground = pair.foreground || pair.foregroundToken;
    var background = pair.background || pair.backgroundToken;
    if (foreground !== attribute(option, "data-fg") || background !== attribute(option, "data-bg")) return false;
    return !pair.property || pair.property === propertyFor(option);
  }
  function foldLocal(value) {
    var raw = textOf(value).toLowerCase();
    if (typeof raw.normalize === "function") {
      try { return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (error) { return raw; }
    }
    return raw;
  }
  function safeComputedColor(value) {
    var candidate = textOf(value).trim();
    if (!candidate || candidate.length > 140) return null;
    if (!/^(#|oklch|oklab|rgb|rgba|hsl|hsla|hwb|lab|lch|color)\(?/i.test(candidate) && !/^#[0-9a-f]{3,8}$/i.test(candidate)) return null;
    if (/[;"'<>{}\\]|url\(|expression\(|@import/i.test(candidate)) return null;
    return candidate;
  }
  function controlsForToken(theme, token) {
    var designValue = design();
    var binding = designValue && isRecord(designValue.tokens) && isRecord(designValue.tokens[token]) ? designValue.tokens[token] : null;
    var controls = binding && isRecord(binding.controls) && isRecord(binding.controls[theme]) ? binding.controls[theme] : null;
    if (!controls) return [];
    var list = [];
    if (typeof controls.override === "string" && controls.override) list.push({ control: controls.override, kind: "override" });
    if (typeof controls.mix === "string" && controls.mix) list.push({ control: controls.mix, kind: "mix" });
    return list;
  }
  function overrideSummary(state, theme, option) {
    if (!option) return null;
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var removed = state && Array.isArray(state.removed) ? state.removed : [];
    var tokens = [attribute(option, "data-fg") || "", attribute(option, "data-bg") || ""];
    var active = [];
    var removedControls = [];
    for (var t = 0; t < tokens.length; t += 1) {
      if (!tokens[t]) continue;
      var controls = controlsForToken(theme, tokens[t]);
      for (var c = 0; c < controls.length; c += 1) {
        if (Object.hasOwn(draft, controls[c].control) && active.indexOf(controls[c].control) === -1) active.push(controls[c].control);
        if (removed.indexOf(controls[c].control) !== -1 && removedControls.indexOf(controls[c].control) === -1) removedControls.push(controls[c].control);
      }
    }
    var parts = [];
    if (active.length) parts.push("override attivo: " + active.join(", "));
    if (removedControls.length) parts.push("personalizzazione rimossa: " + removedControls.join(", "));
    return parts.length ? parts.join(" · ") : null;
  }
  function matrixStatusLabelLocal(status) {
    if (status === "below-minimum") return "sotto il minimo";
    if (status === "below-target") return "sotto il target";
    if (status === "pass") return "minimo raggiunto";
    return "non misurato";
  }
  function matrixCriterionLocal(option) {
    if (attribute(option, "data-kind") === "non-text") return "Non testo · 3:1 (SC 1.4.11)";
    if (attribute(option, "data-catalogue-kind") === "on-color") return "Testo su riempimento · AA 4,5:1";
    return "Testo · AA 4,5:1";
  }
  function matrixOptionData(option) {
    var parts = (attribute(option, "data-matrix") || "").split(",");
    return {
      light: { ratio: parts[0] || "", status: parts[1] || "unmeasured" },
      dark: { ratio: parts[2] || "", status: parts[3] || "unmeasured" },
    };
  }
  function matrixLabelLocal(option) {
    return pickerHasHuman(option) ? pickerHuman(option) : pickerFallback(option);
  }
  function matrixWorstStatus(option) {
    var data = matrixOptionData(option);
    var light = data.light.status;
    var dark = data.dark.status;
    if (light === "below-minimum" || dark === "below-minimum") return "below-minimum";
    if (light === "below-target" || dark === "below-target") return "below-target";
    if (light === "pass" || dark === "pass") return "pass";
    return "unmeasured";
  }
  function matrixPairIdForTheme(option, theme) {
    return theme + "|" + propertyFor(option) + "|" + (attribute(option, "data-fg") || "") + "|" + (attribute(option, "data-bg") || "");
  }
  function measurementIndex(view) {
    var map = {};
    var list = view && Array.isArray(view.measurements) ? view.measurements : [];
    for (var index = 0; index < list.length; index += 1) {
      var entry = list[index];
      if (entry && typeof entry.pairId === "string") map[entry.pairId] = entry;
    }
    return map;
  }
  function matrixViewLabel(view, slot, comparison) {
    var letter = slot === "left" ? "A" : "B";
    if (!view) return "Vista " + letter + " · stima build tema " + (slot === "left" ? "chiaro" : "scuro");
    var position = comparison === "themes" ? "" : slot === "left" ? "Attuale · " : "Modifica · ";
    return "Vista " + letter + " · " + position + "tema " + themeName(view.theme) + " · " + variantName(view.variant);
  }
  function paintMatrixSwatch(node, measurement) {
    var foreground = measurement ? safeComputedColor(measurement.foreground) : null;
    var background = measurement ? safeComputedColor(measurement.background) : null;
    var available = Boolean(foreground && background);
    if (node.style && typeof node.style.setProperty === "function") {
      node.style.setProperty("--pair-foreground", available ? foreground : "");
      node.style.setProperty("--pair-background", available ? background : "");
    }
    setAttribute(node, "class", (attribute(node, "data-swatch-class") || "wb-pair-swatch") + (available ? "" : " is-unmeasured"));
    return available;
  }
  function renderMatrixCell(cell, option, theme, measurement) {
    clear(cell);
    var hasMeasurement = Boolean(measurement);
    var status;
    var ratio;
    var minimum;
    var target;
    if (hasMeasurement) {
      status = textOf(measurement.status) || "unmeasured";
      ratio = measurement.ratio;
      minimum = measurement.minimum;
      target = measurement.target;
    } else {
      var data = matrixOptionData(option)[theme] || { ratio: "", status: "unmeasured" };
      status = data.status;
      ratio = data.ratio === "" ? NaN : Number(data.ratio);
      var slot = thresholdsFor(option)[theme] || { minimum: "", target: "" };
      minimum = slot.minimum !== "" ? Number(slot.minimum) : null;
      target = slot.target !== "" ? Number(slot.target) : null;
    }
    if (attribute(cell, HOOK) === "matrix-cell") {
      var swatch = make("span", "wb-matrix-cell-swatch");
      setAttribute(swatch, "data-swatch-class", "wb-matrix-cell-swatch");
      setAttribute(swatch, "aria-hidden", "true");
      paintMatrixSwatch(swatch, measurement);
      cell.appendChild(swatch);
    }
    cell.appendChild(make("span", "wb-matrix-ratio", finite(ratio) ? ratioText(ratio) : "non misurato"));
    var statusNode = make("span", "wb-matrix-status", matrixStatusLabelLocal(status));
    setAttribute(statusNode, "data-status", status);
    cell.appendChild(statusNode);
    var thresholds = [];
    if (finite(minimum)) thresholds.push("min " + ratioText(minimum));
    if (finite(target)) thresholds.push("target " + ratioText(target));
    if (thresholds.length) cell.appendChild(make("span", "wb-matrix-thresholds", thresholds.join(" · ")));
    cell.appendChild(make("span", "wb-matrix-source", hasMeasurement ? "live" : "stima build · generato"));
    setAttribute(cell, "data-source", hasMeasurement ? "live" : "build");
    setAttribute(cell, "data-status", status);
    return { status: status, live: hasMeasurement };
  }
  function renderMatrixTileView(entry, option, theme, measurement, view, slot, comparison) {
    setIfChanged(entry.title, matrixViewLabel(view, slot, comparison));
    var available = paintMatrixSwatch(entry.swatch, measurement);
    renderMatrixCell(entry.result, option, theme, measurement);
    setAttribute(entry.node, "data-source", measurement ? "live" : "build");
    setAttribute(entry.node, "data-status", attribute(entry.result, "data-status"));
    if (!available) entry.result.appendChild(make("span", null, "Colori live non disponibili"));
  }
  function worstStatusOf(statuses) {
    var worst = "unmeasured";
    for (var index = 0; index < statuses.length; index += 1) {
      if (statuses[index] === "below-minimum") return "below-minimum";
      if (statuses[index] === "below-target") worst = "below-target";
    }
    if (worst === "below-target") return worst;
    for (var unmeasuredIndex = 0; unmeasuredIndex < statuses.length; unmeasuredIndex += 1) {
      if (statuses[unmeasuredIndex] === "unmeasured") return "unmeasured";
    }
    for (var passIndex = 0; passIndex < statuses.length; passIndex += 1) {
      if (statuses[passIndex] === "pass") return "pass";
    }
    return "unmeasured";
  }
  function bindMatrixButton(entry) {
    if (!entry || !entry.button) return;
    entry.button.disabled = false;
    listen(entry.button, "click", function () {
      if (busy) return;
      var value = attribute(entry.button, "data-pair-value");
      var option = optionByValue(value);
      if (!option) { announce("Questo abbinamento non è più nel catalogo statico: nessuna misura inventata."); return; }
      clearSourceBlocked();
      setPairOption(option);
      renderDetails(stateNow());
      renderControls(stateNow());
      applySelection();
    });
    listen(entry.button, "keydown", function (event) {
      var key = event && event.key;
      if (key === "ArrowDown" || key === "ArrowRight") { prevent(event); moveMatrixFocus(entry.button, "next"); }
      else if (key === "ArrowUp" || key === "ArrowLeft") { prevent(event); moveMatrixFocus(entry.button, "previous"); }
      else if (key === "Home") { prevent(event); moveMatrixFocus(entry.button, "first"); }
      else if (key === "End") { prevent(event); moveMatrixFocus(entry.button, "last"); }
    });
  }
  function bindMatrixRow(entry) {
    if (!entry || !entry.row) return;
    listen(entry.row, "click", function (event) {
      if (busy) return;
      if (event && event.target && event.target.closest && event.target.closest('[data-smart-colors-workbench="matrix-inspect"]')) return;
      var value = attribute(entry.row, "data-pair-value");
      var option = optionByValue(value);
      if (!option) return;
      clearSourceBlocked();
      setPairOption(option);
      renderDetails(stateNow());
      renderControls(stateNow());
      applySelection();
      syncMatrixFocus();
    });
  }
  function bindMatrixTile(entry) {
    if (!entry || !entry.tile) return;
    listen(entry.button, "click", function () {
      if (busy) return;
      var opt = optionByValue(entry.value);
      if (!opt) return;
      clearSourceBlocked();
      setPairOption(opt);
      renderDetails(stateNow());
      renderControls(stateNow());
      applySelection();
      syncMatrixFocus();
    });

  }
  function buildMatrix() {
    if (!matrixBody) return;
    clear(matrixBody);
    if (matrixGrid) clear(matrixGrid);
    matrixEntries = [];
    matrixTiles = [];
    var list = options();
    if (!list.length) {
      var missingRow = make("tr");
      var missingCell = make("td", null, "Nessun abbinamento diagnostico disponibile.");
      setAttribute(missingCell, "colspan", "3");
      missingRow.appendChild(missingCell);
      matrixBody.appendChild(missingRow);
      return;
    }
    for (var index = 0; index < list.length; index += 1) {
      var option = list[index];
      var value = option.value;
      var foreground = attribute(option, "data-fg") || "";
      var background = attribute(option, "data-bg") || "";
      var row = make("tr");
      var matrixData = matrixOptionData(option);
      var buildStatus = matrixWorstStatus(option);
      var buildAllPass = matrixData.light.status === "pass" && matrixData.dark.status === "pass" ? "true" : "false";
      var buildUnmeasured = matrixData.light.status === "unmeasured" || matrixData.dark.status === "unmeasured" ? "true" : "false";
      setAttribute(row, "data-smart-colors-workbench", "matrix-row");
      setAttribute(row, "data-pair-value", value);
      setAttribute(row, "data-matrix-index", String(index));
      setAttribute(row, "data-fg", foreground);
      setAttribute(row, "data-bg", background);
      setAttribute(row, "data-status", buildStatus);
      setAttribute(row, "data-build-status", buildStatus);
      setAttribute(row, "data-status-effective", buildStatus);
      setAttribute(row, "data-status-live", "");
      setAttribute(row, "data-all-pass", buildAllPass);
      setAttribute(row, "data-build-all-pass", buildAllPass);
      setAttribute(row, "data-unmeasured", buildUnmeasured);
      setAttribute(row, "data-build-unmeasured", buildUnmeasured);
      setAttribute(row, "data-search", pickerSearchText(option));
      setAttribute(row, "data-live-status", "false");
      setAttribute(row, "data-live-revision", "");
      function pairCategoryLocal(opt) {
        var kind = attribute(opt, "data-kind") || "";
        var prop = attribute(opt, "data-property") || "";
        var fg = (attribute(opt, "data-fg") || "").toLowerCase();
        var bg = (attribute(opt, "data-bg") || "").toLowerCase();
        var label = (attribute(opt, "data-picker-label") || opt.textContent || "").toLowerCase();
        if (kind === "non-text" || prop === "borderColor" || prop === "outlineColor" || fg.indexOf("border") !== -1 || fg.indexOf("outline") !== -1 || label.indexOf("bordo") !== -1) {
          return "border";
        }
        if ((fg.indexOf("surface") !== -1 && (bg.indexOf("bg") !== -1 || bg.indexOf("canvas") !== -1)) || label.indexOf("superficie") !== -1) {
          return "surface";
        }
        if (kind === "decorative" || label.indexOf("decorat") !== -1) {
          return "decorative";
        }
        return "text";
      }

      var cat = pairCategoryLocal(option);
      setAttribute(row, "data-category", cat);
      var th = make("th", "wb-matrix-uso");
      setAttribute(th, "scope", "row");

      var infoBox = make("div", "wb-matrix-info");
      infoBox.appendChild(make("span", "wb-matrix-label", matrixLabelLocal(option)));
      infoBox.appendChild(make("code", "wb-matrix-tokens", foreground + " su " + background));
      infoBox.appendChild(make("span", "wb-matrix-type", matrixCriterionLocal(option)));
      th.appendChild(infoBox);
      var button = make("button", "wb-matrix-inspect", "Ispeziona");
      button.type = "button";
      setAttribute(button, "data-smart-colors-workbench", "matrix-inspect");
      setAttribute(button, "data-pair-value", value);
      setAttribute(button, "tabindex", "-1");
      button.appendChild(make("span", "wb-visually-hidden", " " + matrixLabelLocal(option)));
      th.appendChild(button);
      row.appendChild(th);
      var leftCell = make("td", "wb-matrix-view");
      setAttribute(leftCell, "data-smart-colors-workbench", "matrix-cell");
      setAttribute(leftCell, "data-slot", "left");
      renderMatrixCell(leftCell, option, "light", null);
      row.appendChild(leftCell);
      var rightCell = make("td", "wb-matrix-view");
      setAttribute(rightCell, "data-smart-colors-workbench", "matrix-cell");
      setAttribute(rightCell, "data-slot", "right");
      renderMatrixCell(rightCell, option, "dark", null);
      row.appendChild(rightCell);
      matrixBody.appendChild(row);

      if (matrixGrid) {
        var tile = make("li", "wb-matrix-tile");
        setAttribute(tile, HOOK, "matrix-tile");
        setAttribute(tile, "data-pair-value", value);
        setAttribute(tile, "data-category", cat);
        var tileButton = make("button", "wb-tile-select");
        tileButton.type = "button";
        setAttribute(tileButton, "aria-pressed", "false");
        var tileHeading = make("span", "wb-tile-heading");
        tileHeading.appendChild(make("span", "wb-tile-title", matrixLabelLocal(option)));
        var tileMark = make("span", "wb-tile-mark", "✓");
        setAttribute(tileMark, "aria-hidden", "true");
        tileHeading.appendChild(tileMark);
        tileButton.appendChild(tileHeading);
        tileButton.appendChild(make("code", "wb-tile-tokens", foreground + " su " + background));
        var tileViews = make("span", "wb-tile-views");
        var tileSlots = {};
        for (var tileIndex = 0; tileIndex < 2; tileIndex += 1) {
          var tileSlot = tileIndex === 0 ? "left" : "right";
          var tileTheme = tileIndex === 0 ? "light" : "dark";
          var tileView = make("span", "wb-tile-view");
          setAttribute(tileView, "data-slot", tileSlot);
          var tileTitle = make("span", "wb-tile-view-title");
          var tileSwatch = make("span", "wb-pair-swatch is-unmeasured");
          setAttribute(tileSwatch, "aria-hidden", "true");
          var tileResult = make("span", "wb-tile-result");
          tileView.appendChild(tileTitle);
          tileView.appendChild(tileSwatch);
          tileView.appendChild(tileResult);
          tileViews.appendChild(tileView);
          tileSlots[tileSlot] = { node: tileView, title: tileTitle, swatch: tileSwatch, result: tileResult };
          renderMatrixTileView(tileSlots[tileSlot], option, tileTheme, null, null, tileSlot, "themes");
        }
        tileButton.appendChild(tileViews);
        tile.appendChild(tileButton);
        matrixGrid.appendChild(tile);
        var tileEntry = { tile: tile, button: tileButton, views: tileSlots, value: value, option: option };
        matrixTiles.push(tileEntry);
        bindMatrixTile(tileEntry);
      }

      var entry = { row: row, button: button, cells: { left: leftCell, right: rightCell }, option: option };
      matrixEntries.push(entry);
      bindMatrixButton(entry);
      bindMatrixRow(entry);
    }
    var emptyRow = make("tr");
    setAttribute(emptyRow, "data-smart-colors-workbench", "matrix-empty");
    emptyRow.hidden = true;
    var emptyCell = make("td", null, "Nessun abbinamento corrisponde alla selezione corrente.");
    setAttribute(emptyCell, "colspan", "3");
    emptyRow.appendChild(emptyCell);
    matrixBody.appendChild(emptyRow);
    matrixEmptyRow = emptyRow;
    syncMatrixFocus();
    applyMatrixFilter();
  }
  function matrixVisibleEntries() {
    var visible = [];
    for (var index = 0; index < matrixEntries.length; index += 1) {
      var entry = matrixEntries[index];
      if (entry.row && !entry.row.hidden && entry.button && !entry.button.disabled) visible.push(entry);
    }
    return visible;
  }
  function syncMatrixFocus() {
    var selectedValue = pairSelect ? pairSelect.value : "";
    var visible = matrixVisibleEntries();
    var selectedEntry = null;
    for (var index = 0; index < visible.length; index += 1) {
      if (selectedValue && attribute(visible[index].button, "data-pair-value") === selectedValue) selectedEntry = visible[index];
    }
    if (!selectedEntry) selectedEntry = visible.length ? visible[0] : null;
    for (var rowIndex = 0; rowIndex < matrixEntries.length; rowIndex += 1) {
      var entry = matrixEntries[rowIndex];
      if (!entry.button) continue;
      var isSelected = Boolean(selectedValue) && attribute(entry.button, "data-pair-value") === selectedValue;
      setAttribute(entry.row, "aria-current", isSelected ? "true" : "false");

      setAttribute(entry.row, "data-selected", isSelected ? "true" : "false");
      setAttribute(entry.button, "aria-current", isSelected ? "true" : "false");
      setAttribute(entry.button, "tabindex", selectedEntry && entry === selectedEntry ? "0" : "-1");
    }
    for (var t = 0; t < matrixTiles.length; t += 1) {
      var tEntry = matrixTiles[t];
      var isTileSelected = Boolean(selectedValue) && tEntry.value === selectedValue;
      setAttribute(tEntry.button, "aria-pressed", isTileSelected ? "true" : "false");
      setAttribute(tEntry.tile, "data-selected", isTileSelected ? "true" : "false");
    }
  }
  function applyMatrixDisplay() {
    var grid = Boolean(matrixGrid && matrixDisplayGrid && matrixDisplayGrid.checked);
    if (matrixGrid) matrixGrid.hidden = !grid;
    if (matrixTable) matrixTable.hidden = grid;
    if (matrixNoResults) matrixNoResults.hidden = !grid || !matrixEmptyRow || matrixEmptyRow.hidden;
  }
  function applyMatrixFilter() {
    var query = matrixSearch ? foldLocal(matrixSearch.value) : "";
    var filter = matrixFilter ? matrixFilter.value : "";
    var catFilter = matrixCategory ? matrixCategory.value : "";
    var sourceToken = sourceSelect ? sourceSelect.value : "";
    var scoped = Boolean(sourceToken) && !(matrixAll && matrixAll.checked);
    var filterKey = JSON.stringify([query, filter, catFilter, scoped ? sourceToken : "", scoped]);
    var measuring = lastState && lastState.phase === "running";
    if (filterKey !== matrixFilterKey) { matrixPage = 0; matrixFilterKey = filterKey; matrixMatches = null; }
    setAttribute(matrixGrid, "aria-busy", measuring ? "true" : "false");
    setAttribute(matrixTable, "aria-busy", measuring ? "true" : "false");
    var scopeValues = null;
    if (scoped) {
      var preferred = preferredUses(sourceToken);
      scopeValues = {};
      for (var p = 0; p < preferred.options.length; p += 1) scopeValues[preferred.options[p].value] = true;
    }
    var scopeName = scoped ? pickerSourceName(sourceToken) : "";
    var matches = [];
    for (var index = 0; index < matrixEntries.length; index += 1) {
      var entry = matrixEntries[index];
      var row = entry.row;
      var status = attribute(row, "data-status-effective") || attribute(row, "data-status") || "unmeasured";
      var live = attribute(row, "data-live-status") === "true";
      var haystack = attribute(row, "data-search") || "";
      var rowCat = attribute(row, "data-category") || "text";
      var matchScope = !scopeValues || scopeValues[entry.option.value] === true;
      var matchQuery = !query || haystack.indexOf(query) !== -1;
      var matchCat = !catFilter || rowCat === catFilter;
      var matchFilter = true;
      if (filter === "issues") matchFilter = status === "below-minimum" || status === "below-target";
      else if (filter === "pass") matchFilter = attribute(row, "data-all-pass") === "true";
      else if (filter === "unmeasured") matchFilter = attribute(row, "data-unmeasured") === "true";
      else if (filter === "live") matchFilter = live;
      else if (filter) matchFilter = status === filter;
      row.hidden = true;
      if (matrixTiles[index]) matrixTiles[index].tile.hidden = true;
      if (matchScope && matchQuery && matchFilter && matchCat) matches.push(index);
    }
    // Keep only the navigation projection while measurements are pending. The samples and
    // live results have already been cleared; a transient empty live filter must not steal focus.
    if (measuring && matrixMatches) matches = matrixMatches.slice();
    else if (!measuring) matrixMatches = matches.slice();
    var visible = matches.length;
    var pages = Math.max(1, Math.ceil(visible / matrixPageSize));
    matrixPage = Math.max(0, Math.min(matrixPage, pages - 1));
    var start = matrixPage * matrixPageSize;
    for (var shown = start; shown < Math.min(start + matrixPageSize, visible); shown += 1) {
      var matchIndex = matches[shown];
      matrixEntries[matchIndex].row.hidden = false;
      if (matrixTiles[matchIndex]) matrixTiles[matchIndex].tile.hidden = false;
    }
    if (matrixAll) {
      matrixAll.disabled = !sourceToken;
      matrixAll.checked = !scoped;
    }
    if (overviewScope) setIfChanged(overviewScope, scoped ? scopeName + " · " + visible : "Tutti gli abbinamenti");
    if (matrixEmptyRow) matrixEmptyRow.hidden = visible !== 0 || Boolean(measuring);
    if (matrixNoResults) matrixNoResults.hidden = visible !== 0 || Boolean(measuring) || !(matrixDisplayGrid && matrixDisplayGrid.checked);
    if (matrixPrev) matrixPrev.disabled = matrixPage === 0;
    if (matrixNext) matrixNext.disabled = matrixPage >= pages - 1;
    if (matrixPageNote) setIfChanged(matrixPageNote, (measuring ? "Verifica in corso · " : "") + "Pagina " + (matrixPage + 1) + " di " + pages + " · " + (visible ? start + 1 : 0) + "–" + Math.min(start + matrixPageSize, visible) + " di " + visible);
    syncMatrixFocus();
    var active = doc.activeElement;
    for (var focusIndex = 0; focusIndex < matrixEntries.length; focusIndex += 1) {
      var focused = matrixEntries[focusIndex];
      var focusedTile = matrixTiles[focusIndex];
      if (!focused.row.hidden || (focused.button !== active && (!focusedTile || focusedTile.button !== active))) continue;
      if (matches.length) {
        var firstIndex = matches[start];
        var first = matrixDisplayGrid && matrixDisplayGrid.checked && matrixTiles[firstIndex] ? matrixTiles[firstIndex].button : matrixEntries[firstIndex].button;
        focusSafely(first);
      } else focusSafely(matrixSearch);
      break;
    }
    if (matrixCount) {
      var total = matrixEntries.length;
      var message = (scoped
        ? String(visible) + (visible === 1 ? " abbinamento" : " abbinamenti") + " per " + scopeName + " · " + String(total) + " nel catalogo"
        : String(visible) + (visible === 1 ? " abbinamento visibile" : " abbinamenti visibili") + " su " + String(total)) + (query || filter || catFilter ? " · filtro attivo" : "");
      setIfChanged(matrixCount, message);
    }
  }
  function moveMatrixFocus(button, direction) {
    var visible = matrixVisibleEntries();
    if (!visible.length) return;
    var current = -1;
    for (var index = 0; index < visible.length; index += 1) if (visible[index].button === button) current = index;
    if (current === -1) current = 0;
    var next = direction === "first" ? 0 : direction === "last" ? visible.length - 1 : current + (direction === "next" ? 1 : -1);
    if (next < 0) next = 0;
    if (next >= visible.length) next = visible.length - 1;
    var target = visible[next].button;
    for (var reset = 0; reset < visible.length; reset += 1) setAttribute(visible[reset].button, "tabindex", visible[reset].button === target ? "0" : "-1");
    if (typeof target.focus === "function") target.focus();
  }
  function thresholdsFor(option) {
    var packed = (attribute(option, "data-thresholds") || "").split(";");
    function read(index) {
      var slot = packed[index] || "";
      var parts = slot.split(",");
      return { minimum: parts[0], target: parts[1] };
    }
    return { light: read(0), dark: read(1) };
  }
  function propertyFor(option) {
    if (attribute(option, "data-kind") !== "non-text") return "color";
    var foreground = attribute(option, "data-fg") || "";
    if (/focus-ring/.test(foreground)) return "outlineColor";
    if (/border/.test(foreground)) return "borderColor";
    return "ui";
  }
  function optionAvailable(option, theme) {
    var slot = thresholdsFor(option)[theme];
    return Boolean(slot && (slot.minimum !== "" || slot.target !== ""));
  }
  function pairIdFor(option, theme) {
    var slot = thresholdsFor(option)[theme];
    if (!slot || (slot.minimum === "" && slot.target === "")) return null;
    var property = propertyFor(option);
    var provisional = theme + "|" + property + "|" + (attribute(option, "data-fg") || "") + "|" + (attribute(option, "data-bg") || "");
    var pairs = controller.pairs(theme);
    if (Array.isArray(pairs) && pairs.length) {
      var foreground = attribute(option, "data-fg");
      var background = attribute(option, "data-bg");
      for (var index = 0; index < pairs.length; index += 1) {
        var pair = pairs[index];
        if (!isRecord(pair)) continue;
        var pairForeground = pair.foreground || pair.foregroundToken;
        var pairBackground = pair.background || pair.backgroundToken;
        if (pairForeground === foreground && pairBackground === background && (!pair.property || pair.property === property)) return pair.id || provisional;
      }
      return null;
    }
    return provisional;
  }
  function field(label, value, className) {
    var row = make("div", className || "wb-measure-row");
    row.appendChild(make("dt", null, label));
    row.appendChild(make("dd", null, value));
    return row;
  }
  function roleName(value) {
    var key = textOf(value).toLowerCase();
    if (key === "canvas") return "sfondo della pagina";
    if (key === "ink") return "testo di base";
    if (key === "ui") return "interfaccia";
    if (key === "feedback") return "feedback";
    if (key === "decorative") return "decorativo";
    return textOf(value) || "ruolo non indicato";
  }
  function percentLabel(value) {
    return String(Math.round(value * 100 * 100) / 100).replace(".", ",");
  }
  function paletteEntry(token) {
    var value = readPayload();
    var source = value && isRecord(value.paletteSource) ? value.paletteSource : null;
    var entries = source && Array.isArray(source.sources) ? source.sources : [];
    for (var index = 0; index < entries.length; index += 1) {
      if (isRecord(entries[index]) && entries[index].token === token) return entries[index];
    }
    return null;
  }
  function designEntry(token) {
    var value = design();
    var entries = value && Array.isArray(value.sources) ? value.sources : [];
    for (var index = 0; index < entries.length; index += 1) {
      if (isRecord(entries[index]) && entries[index].token === token) return entries[index];
    }
    return null;
  }
  function tokenDetail(state, theme, token, label) {
    var designValue = design();
    var binding = designValue && isRecord(designValue.tokens) && isRecord(designValue.tokens[token]) ? designValue.tokens[token] : null;
    var palette = paletteEntry(token);
    var recipeKey = binding && typeof binding.recipe === "string" && binding.recipe ? binding.recipe : null;
    var shared = recipeKey && designValue && isRecord(designValue.recipes) && isRecord(designValue.recipes[recipeKey]) ? designValue.recipes[recipeKey] : null;
    var usage = binding && typeof binding.usage === "string" && binding.usage ? binding.usage : shared && typeof shared.usage === "string" && shared.usage ? shared.usage : "uso non dichiarato";
    var sources = binding && Array.isArray(binding.sources) ? binding.sources : [];
    var labels = [];
    for (var index = 0; index < sources.length; index += 1) {
      if (typeof sources[index] !== "string" || !sources[index]) continue;
      var meta = designEntry(sources[index]);
      var sourceEntry = paletteEntry(sources[index]);
      var facts = [];
      if (meta && typeof meta.name === "string" && meta.name) facts.push("nome " + meta.name);
      if (sourceEntry && typeof sourceEntry.role === "string" && sourceEntry.role) {
        facts.push("ruolo dichiarato: " + roleName(sourceEntry.role));
        if (meta && typeof meta.role === "string" && meta.role && meta.role !== sourceEntry.role) facts.push("ruolo effettivo (config): " + roleName(meta.role));
      } else if (meta && typeof meta.role === "string" && meta.role) {
        facts.push("ruolo effettivo: " + roleName(meta.role));
      }
      labels.push(sources[index] + (facts.length ? " (" + facts.join(" · ") + ")" : ""));
    }
    var ownRole = palette && typeof palette.role === "string" && palette.role ? " · ruolo dichiarato del token: " + roleName(palette.role) : "";
    var controls = binding && isRecord(binding.controls) && isRecord(binding.controls[theme]) ? binding.controls[theme] : null;
    var controlLines = [];
    if (controls && typeof controls.override === "string" && controls.override) controlLines.push(controls.override + " · override completo");
    if (controls && typeof controls.mix === "string" && controls.mix) {
      controlLines.push(controls.mix + " · mix superficie" + (finite(controls.defaultMix) ? " (default " + percentLabel(controls.defaultMix) + "%)" : ""));
    }
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var removed = state && Array.isArray(state.removed) ? state.removed : [];
    var draftKeys = [];
    var removedKeys = [];
    if (controls && typeof controls.override === "string" && Object.hasOwn(draft, controls.override)) draftKeys.push(controls.override);
    if (controls && typeof controls.mix === "string" && Object.hasOwn(draft, controls.mix)) draftKeys.push(controls.mix);
    if (controls && typeof controls.override === "string" && removed.indexOf(controls.override) !== -1) removedKeys.push(controls.override);
    if (controls && typeof controls.mix === "string" && removed.indexOf(controls.mix) !== -1) removedKeys.push(controls.mix);
    var container = make("div");
    container.appendChild(make("p", "eyebrow", label));
    var tokenLine = make("p");
    tokenLine.appendChild(make("code", null, token));
    tokenLine.appendChild(make("span", null, " · " + usage));
    container.appendChild(tokenLine);
    container.appendChild(make("p", "margin-note", "Sorgenti: " + (labels.length ? labels.join(", ") : "non dichiarate") + ownRole + "."));
    container.appendChild(make("p", "margin-note", "Ricetta iniziale del generatore: " + (recipeKey ? recipeKey + (shared && typeof shared.kind === "string" && shared.kind ? " (" + shared.kind + ")" : "") : "non dichiarata") + "."));
    container.appendChild(make("p", "margin-note", "Controlli pubblici (tema " + themeName(theme) + "): " + (controlLines.length ? controlLines.join("; ") : "nessuno dichiarato") + "."));
    container.appendChild(make("p", "margin-note", draftKeys.length ? "Bozza attiva: " + draftKeys.join(", ") + "." : "Nessun override in bozza: vale la formula dei byte catturati."));
    container.appendChild(make("p", "margin-note", removedKeys.length ? "Personalizzazione rimossa: verrà usato il fallback del token (" + removedKeys.join(", ") + ")." : "Nessuna personalizzazione rimossa per questo token."));
    return container;
  }
  function renderDetails(state) {
    if (!details || !selectionAvailable) return;
    var current = state && isRecord(state) ? state : stateNow();
    clear(details);
    var option = selectedOption();
    var article = make("article", "wb-details");
    if (!option) {
      article.appendChild(make("p", null, "Nessuna coppia selezionata: il banco non inventa coppie."));
      details.appendChild(article);
      return;
    }
    var theme = checkedTheme();
    var foreground = attribute(option, "data-fg") || "";
    var background = attribute(option, "data-bg") || "";
    var kind = attribute(option, "data-kind") || "text";
    var property = propertyFor(option);
    var usage = attribute(option, "data-usage") || (foreground + " su " + background);
    var slot = thresholdsFor(option)[theme];
    var minimum = slot ? slot.minimum : "";
    var target = slot ? slot.target : "";
    article.appendChild(make("h3", null, usage));
    article.appendChild(make("p", null, foreground + " su " + background + " · " + (kind === "non-text" ? "bordo o indicatore" : "testo") + " · proprietà " + property));
    var usageLine = make("p", "margin-note", "Tema " + themeName(theme) + ": primo piano e sfondo sono letti dalle stesse variabili CSS della resa.");
    article.appendChild(usageLine);
    var bindingGrid = make("div", "grid-2");
    bindingGrid.appendChild(tokenDetail(current, theme, foreground, "Primo piano"));
    bindingGrid.appendChild(tokenDetail(current, theme, background, "Sfondo"));
    article.appendChild(bindingGrid);
    var snippetText = property === "borderColor"
      ? "border: 2px solid var(" + foreground + ");\nbackground-color: var(" + background + ");\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class=\"specimen\" role=\"img\" aria-label=\"Campione statico del bordo\"> */\n.surface {\n  padding: 12px;\n  background: var(" + background + ");\n  border-radius: 8px;\n}"
      : property === "outlineColor"
        ? "outline: 3px solid var(" + foreground + ");\noutline-offset: 2px;\nbackground-color: var(" + background + ");\nborder-radius: 8px;\npadding: 0;\nwidth: 100%;\nbox-sizing: border-box;\nheight: 48px;\n\n/* Campione vuoto: <div class=\"specimen\" role=\"img\" aria-label=\"Campione statico dell'anello\"> */\n.surface {\n  padding: 12px;\n  background: var(" + background + ");\n  border-radius: 8px;\n}"
        : "color: var(" + foreground + ");\nbackground-color: var(" + background + ");";
    var snippet = make("pre");
    setAttribute(snippet, "role", "group");
    setAttribute(snippet, "tabindex", "0");
    setAttribute(snippet, "aria-label", "Snippet CSS della coppia, con le stesse variabili della resa");
    snippet.appendChild(make("code", null, snippetText));
    article.appendChild(snippet);
    var thresholds = make("dl", "wb-thresholds");
    thresholds.appendChild(field("Minimo tema " + themeName(theme), minimum ? ratioText(Number(minimum)) : "non dichiarato"));
    thresholds.appendChild(field("Target tema " + themeName(theme), target ? ratioText(Number(target)) : "non dichiarato"));
    thresholds.appendChild(field("Tema e preferenza", "Il tema è la variante misurata; la preferenza di sistema è separata e non emulata."));
    article.appendChild(thresholds);
    var css = cssMeta();
    var note = css.status === "stale"
      ? "Stato: output non aggiornato (stale). Le misure riguardano i byte catturati; la ricetta descritta è il rationale iniziale, non la formula attiva dei byte correnti."
      : css.source === "generated-candidate"
        ? "Stato: candidato generato (diagnostico), non un file di output; le misure riguardano il candidato."
        : "Le misure riguardano i byte CSS catturati.";
    article.appendChild(make("p", "margin-note", note));
    article.appendChild(make("p", "margin-note", "Byte associati: " + bytesText("baseline") + "."));
    details.appendChild(article);
  }
  function bindControl(node, control, kind) {
    var entry = { node: node, control: control, kind: kind, dirty: false };
    var mark = function () { entry.dirty = true; };
    if (node && typeof node.addEventListener === "function") {
      node.addEventListener("input", mark);
      node.addEventListener("change", mark);
    }
    return entry;
  }
  function renderControls(state) {
    if (!controlsBody) return;
    if (!selectionAvailable) {
      if (lastControlsKey === "__unavailable__") return;
      lastControlsKey = "__unavailable__";
      controlInputs = [];
      disposeLightnessInputs();
      clear(controlsBody);
      controlsBody.appendChild(make("p", "margin-note", "Nessun controllo pubblico: la coppia attiva non è disponibile nel catalogo statico."));
      return;
    }
    var option = selectedOption();
    if (!option) { clear(controlsBody); controlInputs = []; disposeLightnessInputs(); controlsBody.appendChild(make("p", "margin-note", "Nessuna coppia selezionata: nessun controllo pubblico.")); return; }
    var theme = checkedTheme();
    var foreground = attribute(option, "data-fg") || "";
    var background = attribute(option, "data-bg") || "";
    var key = foreground + "|" + background + "|" + theme;
    if (key === lastControlsKey) { syncDraft(state); return; }
    lastControlsKey = key;
    clear(controlsBody);
    controlInputs = [];
    disposeLightnessInputs();
    var designValue = design();
    var tokens = foreground === background ? [foreground] : [foreground, background];
    var rendered = 0;
    var controlGrid = make("div", "wb-control-grid");
    for (var t = 0; t < tokens.length; t += 1) {
      var binding = designValue && isRecord(designValue.tokens) ? designValue.tokens[tokens[t]] : null;
      var controls = binding && isRecord(binding.controls) && isRecord(binding.controls[theme]) ? binding.controls[theme] : null;
      if (!controls) continue;
      if (typeof controls.override === "string" && controls.override) {
        var overrideRow = make("div", "wb-field");
        var overrideId = "smart-colors-workbench-control-" + controls.override.replace(/[^a-zA-Z0-9_-]/g, "-");
        var overrideLabel = make("label", null, tokens[t] + " · override completo");
        setAttribute(overrideLabel, "for", overrideId);
        var overrideInput = make("input");
        overrideInput.type = "text";
        overrideInput.id = overrideId;
        setAttribute(overrideInput, "data-control", controls.override);
        setAttribute(overrideInput, "data-kind", "override");
        setAttribute(overrideInput, "autocomplete", "off");
        setAttribute(overrideInput, "spellcheck", "false");
        overrideInput.placeholder = "es. oklch(0.5 0.1 250)";
        var raw = make("details", "wb-raw");
        raw.appendChild(make("summary", null, "CSS testuale (avanzato) · " + tokens[t]));
        raw.appendChild(overrideLabel);
        raw.appendChild(overrideInput);
        overrideRow.appendChild(raw);
        appendLightnessControls(overrideRow, tokens[t], controls.override, state);
        appendPersonalizationActions(overrideRow, tokens[t], controls.override);
        controlGrid.appendChild(overrideRow);
        controlInputs.push(bindControl(overrideInput, controls.override, "override"));
        rendered += 1;
      }
      if (typeof controls.mix === "string" && controls.mix) {
        var mixRow = make("div", "wb-field");
        var mixId = "smart-colors-workbench-control-" + controls.mix.replace(/[^a-zA-Z0-9_-]/g, "-");
        var mixLabel = make("label", null, tokens[t] + " · mix superficie (%)");
        setAttribute(mixLabel, "for", mixId);
        var mixInput = make("input");
        mixInput.type = "number";
        mixInput.id = mixId;
        setAttribute(mixInput, "data-control", controls.mix);
        setAttribute(mixInput, "data-kind", "mix");
        setAttribute(mixInput, "min", "0");
        setAttribute(mixInput, "max", "100");
        setAttribute(mixInput, "step", "0.1");
        var defaultPercent = finite(controls.defaultMix) ? String(Math.round(controls.defaultMix * 100 * 100) / 100) : "";
        if (defaultPercent) mixInput.placeholder = defaultPercent;
        mixRow.appendChild(mixLabel);
        mixRow.appendChild(mixInput);
        mixRow.appendChild(make("span", "margin-note", "Default: " + (defaultPercent ? defaultPercent + "%" : "non disponibile") + " (segnaposto: nessun override finché non modifichi il campo)"));
        appendPersonalizationActions(mixRow, tokens[t], controls.mix);
        controlGrid.appendChild(mixRow);
        controlInputs.push(bindControl(mixInput, controls.mix, "mix"));
        rendered += 1;
      }
    }
    if (rendered) controlsBody.appendChild(controlGrid);
    else controlsBody.appendChild(make("p", "margin-note", "Nessun controllo pubblico dichiarato per questa coppia e questo tema. Il banco non inventa knob."));
    syncDraft(state);
  }
  function parseOklchLightness(value) {
    var match = /^\s*oklch\(\s*([0-9]*\.?[0-9]+)(%?)/i.exec(textOf(value));
    if (!match) return null;
    var number = Number(match[1]);
    if (!isFinite(number)) return null;
    if (match[2] === "%") number = number / 100;
    if (number < 0 || number > 1) return null;
    return number * 100;
  }
  function computedLightnessFor(state, theme, token) {
    var option = selectedOption();
    if (!option) return null;
    var side = attribute(option, "data-fg") === token ? "foreground" : attribute(option, "data-bg") === token ? "background" : null;
    if (!side) return null;
    var views = state && Array.isArray(state.views) ? state.views : [];
    var comparison = state && isRecord(state.selection) ? state.selection.comparison : null;
    for (var index = 0; index < views.length; index += 1) {
      var view = views[index];
      if (!isRecord(view) || !isRecord(view.measurement) || !viewMatchesOption(view, option)) continue;
      var match = comparison === "tuning" || comparison === "draft" ? view.slot === "right" : view.theme === theme;
      if (!match) continue;
      var measurement = view.measurement;
      var sideLightness = lightnessFromChannels(measurement[side + "Oklch"]);
      if (sideLightness !== null) return sideLightness;
      var sharedLightness = lightnessFromChannels(measurement.oklch);
      if (sharedLightness !== null) return sharedLightness;
      if (finite(measurement.lightness) && measurement.lightness >= 0 && measurement.lightness <= 1) return measurement.lightness * 100;
      return parseOklchLightness(measurement[side]);
    }
    return null;
  }
  function lightnessFromChannels(value) {
    if (!isRecord(value)) return null;
    var l = value.l;
    if (!finite(l) || l < 0 || l > 1) return null;
    return l * 100;
  }
  function roundLightness(value) { return Math.round(value * 10) / 10; }
  function displayLightness(value) { return String(roundLightness(value)); }
  function validL(value) { var n = Number(value); return value !== "" && finite(n) && n >= 0 && n <= 100 ? n : null; }
  function markInvalidL(entry) {
    entry.invalid = true; entry.dirty = false;
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    if (entry.noteBeforeInvalid === null) entry.noteBeforeInvalid = entry.note.textContent;
    setAttribute(entry.number, "aria-invalid", "true");
    entry.note.textContent = INVALID_L;
  }
  function clearInvalidL(entry) {
    if (!entry.invalid) return;
    entry.invalid = false;
    if (entry.noteBeforeInvalid !== null) { entry.note.textContent = entry.noteBeforeInvalid; entry.noteBeforeInvalid = null; }
    setAttribute(entry.number, "aria-invalid", "false");
  }
  function syncLightnessEntry(entry, state) {
    if (!entry || !entry.range || !entry.number) return;
    if (doc.activeElement === entry.range || doc.activeElement === entry.number) return;
    if (entry.invalid || entry.committing || entry.dirty) return;
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var removed = state && Array.isArray(state.removed) ? state.removed : [];
    var value = Object.hasOwn(draft, entry.control) ? parseOklchLightness(draft[entry.control]) : null;
    var fromDraft = value !== null;
    if (value === null) value = computedLightnessFor(state, checkedTheme(), entry.token);
    var available = value !== null;
    entry.available = available;
    entry.range.hidden = !available;
    entry.range.disabled = !entry.supported || !available;
    entry.number.disabled = !entry.supported || !available;
    entry.number.hidden = false;
    if (available) {
      var next = displayLightness(value);
      if (entry.range.value !== next) entry.range.value = next;
      if (entry.number.value !== next) entry.number.value = next;
      entry.number.placeholder = "";
      setAttribute(entry.number, "aria-invalid", "false");
      setAttribute(entry.range, "aria-valuetext", next + "%");
    } else {
      entry.number.value = "";
      entry.number.placeholder = "—";
      setAttribute(entry.range, "aria-valuetext", "non disponibile");
    }
    if (!entry.supported) entry.note.textContent = "Il runtime non espone setLightness: il controllo L resta disabilitato e nessun valore viene inviato.";
    else if (removed.indexOf(entry.control) !== -1) entry.note.textContent = "Personalizzazione rimossa: si usa il fallback del token. Imposta L o il CSS testuale per aggiungerne una.";
    else if (!available) entry.note.textContent = "L non disponibile: il runtime non ha restituito una L leggibile in OKLCH. Nessun valore viene inventato; usa il controllo testuale o attendi la misura.";
    else if (fromDraft) entry.note.textContent = "L dalla bozza, arrotondata a 0,1; altri knob (mix/macro) restano attivi.";
    else entry.note.textContent = "L letta dal colore CSS calcolato, arrotondata a 0,1; altri knob (mix/macro) restano attivi.";
  }
  function syncLightness(state) {
    for (var index = 0; index < lightnessInputs.length; index += 1) syncLightnessEntry(lightnessInputs[index], state);
  }
  function disposeLightnessInputs() {
    for (var index = 0; index < lightnessInputs.length; index += 1) {
      var entry = lightnessInputs[index];
      entry.disposed = true;
      entry.queued = false;
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    }
    lightnessInputs = [];
  }
  function commitLightness(entry) {
    if (!entry || entry.disposed || !entry.supported) return Promise.resolve(false);
    if (!entry.available) { announce("L non disponibile: il runtime non ha restituito una L leggibile. Nessun valore viene inviato."); return Promise.resolve(false); }
    if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    var raw = validL(entry.number && entry.number.value !== "" ? entry.number.value : entry.range.value);
    if (raw === null) { markInvalidL(entry); announce(INVALID_L); return Promise.resolve(false); }
    if (entry.committing) { entry.queued = true; return Promise.resolve(false); }
    entry.committing = true;
    return Promise.resolve(controller.setLightness(entry.control, raw / 100)).then(function (result) {
      if (entry.disposed) return false;
      entry.committing = false;
      entry.dirty = false;
      if (result && result.error) {
        announce("Regolazione L non applicata: " + String(result.error) + ". Nessun valore viene inventato.");
        render(stateNow());
        return false;
      }
      if (entry.queued) { entry.queued = false; return commitLightness(entry); }
      render(stateNow());
      return true;
    }, function (error) {
      if (entry.disposed) return false;
      entry.committing = false;
      entry.dirty = false;
      announce("Regolazione L non riuscita: " + (error && error.message ? error.message : String(error)) + ". Nessun valore viene inventato.");
      return false;
    });
  }
  function scheduleLightness(entry) {
    if (!entry || entry.disposed || !entry.supported || !entry.available) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(function () { entry.timer = null; commitLightness(entry); }, 180);
  }
  function appendLightnessControls(row, token, control, state) {
    var supported = typeof controller.setLightness === "function";
    var id = "smart-colors-workbench-lightness-" + control.replace(/[^a-zA-Z0-9_-]/g, "-");
    var group = make("fieldset", "wb-l-control");
    setAttribute(group, "data-smart-colors-workbench", "lightness");
    setAttribute(group, "data-control", control);
    setAttribute(group, "data-token", token);
    group.appendChild(make("legend", null, "Luminosità L% · " + token));
    var inputs = make("div", "wb-l-inputs");
    var range = make("input");
    range.type = "range";
    range.id = id + "-range";
    setAttribute(range, "data-control", control);
    setAttribute(range, "data-kind", "lightness");
    setAttribute(range, "min", "0");
    setAttribute(range, "max", "100");
    setAttribute(range, "step", "0.1");
    setAttribute(range, "aria-label", "Luminosità L percento per " + token + " (" + control + ")");
    setAttribute(range, "aria-describedby", id + "-note");
    range.disabled = true;
    range.hidden = true;
    var number = make("input");
    number.type = "number";
    number.id = id + "-number";
    setAttribute(number, "data-control", control);
    setAttribute(number, "data-kind", "lightness");
    setAttribute(number, "min", "0");
    setAttribute(number, "max", "100");
    setAttribute(number, "step", "any");
    setAttribute(number, "inputmode", "decimal");
    setAttribute(number, "aria-label", "Valore L percento per " + token + " (" + control + ")");
    setAttribute(number, "aria-describedby", id + "-note");
    number.disabled = true;
    number.placeholder = "—";
    inputs.appendChild(range);
    inputs.appendChild(number);
    group.appendChild(inputs);
    var note = make("span", "margin-note");
    note.id = id + "-note";
    group.appendChild(note);
    row.appendChild(group);
    var entry = { token: token, control: control, range: range, number: number, note: note, dirty: false, invalid: false, noteBeforeInvalid: null, timer: null, committing: false, queued: false, disposed: false, supported: supported, available: false };
    if (supported) {
      listen(range, "input", function () { clearInvalidL(entry); number.value = range.value; setAttribute(range, "aria-valuetext", range.value + "%"); entry.dirty = true; scheduleLightness(entry); });
      listen(range, "change", function () { clearInvalidL(entry); number.value = range.value; entry.dirty = true; commitLightness(entry); });
      listen(number, "input", function () {
        var next = validL(number.value);
        if (next === null) { markInvalidL(entry); return; }
        clearInvalidL(entry);
        range.value = displayLightness(next);
        setAttribute(range, "aria-valuetext", range.value + "%");
        entry.dirty = true;
      });
      listen(number, "change", function () {
        if (validL(number.value) === null) { markInvalidL(entry); announce(INVALID_L); return; }
        clearInvalidL(entry); entry.dirty = true; commitLightness(entry);
      });
      listen(number, "blur", function () { if (!entry.invalid && entry.dirty && !entry.committing) commitLightness(entry); });
    }
    lightnessInputs.push(entry);
    syncLightnessEntry(entry, state);
  }
  function appendPersonalizationActions(row, token, control) {
    var actions = make("div", "wb-l-actions");
    if (typeof controller.removeOverride === "function") {
      var remove = make("button", "wb-ghost", "Rimuovi personalizzazione");
      remove.type = "button";
      setAttribute(remove, "data-smart-colors-workbench", "remove-override");
      setAttribute(remove, "data-control", control);
      setAttribute(remove, "aria-label", "Rimuovi la personalizzazione salvata di " + token + " (" + control + ")");
      listen(remove, "click", function () {
        if (busy) return;
        run(function () { return Promise.resolve(controller.removeOverride(control)).then(resultOrThrow); }, "Rimozione richiesta per " + control + ": se la personalizzazione esisteva, verrà usato il fallback del token. Esporta per rendere la rimozione durevole.");
      });
      actions.appendChild(remove);
    } else {
      actions.appendChild(make("span", "margin-note", "Rimozione della personalizzazione salvata non disponibile nel runtime attuale."));
    }
    var discard = make("button", "wb-ghost", "Scarta la modifica in bozza");
    discard.type = "button";
    setAttribute(discard, "data-smart-colors-workbench", "discard-draft");
    setAttribute(discard, "data-control", control);
    setAttribute(discard, "aria-label", "Scarta la modifica in bozza di " + token + " (" + control + "), senza rimuovere l'override salvato");
    listen(discard, "click", function () {
      if (busy) return;
      var state = stateNow();
      var draft = state && isRecord(state.draft) ? state.draft : {};
      if (!Object.hasOwn(draft, control)) { announce("Nessuna bozza da scartare per " + control + ". Gli override salvati non sono stati modificati."); return; }
      run(function () { return Promise.resolve(controller.reset(control)).then(resultOrThrow); }, "Bozza scartata per " + control + ". Gli override salvati non sono stati modificati.");
    });
    actions.appendChild(discard);
    row.appendChild(actions);
  }
  function syncDraft(state) {
    var draft = state && isRecord(state.draft) ? state.draft : {};
    for (var index = 0; index < controlInputs.length; index += 1) {
      var entry = controlInputs[index];
      if (entry.dirty || doc.activeElement === entry.node) continue;
      var next = "";
      if (Object.hasOwn(draft, entry.control)) {
        var value = draft[entry.control];
        if (value !== null && value !== undefined) next = entry.kind === "mix" ? String(value).replace("%", "") : String(value);
      }
      if (entry.node.value !== next) entry.node.value = next;
    }
    syncLightness(state);
  }
  function detailValueRow(label, content) {
    var row = make("div", "wb-measure-row");
    row.appendChild(make("span", "wb-measure-label", label));
    var value = make("span");
    value.appendChild(content);
    row.appendChild(value);
    return row;
  }
  function renderMeasure(node, view, slot, complete, option, state) {
    if (!node) return;
    clear(node);
    if (!view) {
      node.appendChild(field("Rapporto", "Nessuna vista " + slot + " restituita dal runtime."));
      return;
    }
    if (!viewMatchesOption(view, option)) {
      node.appendChild(field("Rapporto", "La vista " + slot + " non corrisponde alla coppia selezionata: nessun esito viene attribuito a un'altra coppia."));
      return;
    }
    var measurement = isRecord(view.measurement) ? view.measurement : null;
    var criterion = criterionFor(option, measurement);
    var ratio = make("p", "wb-ratio");
    ratio.appendChild(make("span", "wb-ratio-value", measurement ? ratioText(measurement.ratio, [measurement.minimum, measurement.target]) : "non misurata"));
    var verdict = make("span", "wb-verdict", criterionLabel(criterion));
    setAttribute(verdict, "data-status", criterionStatus(criterion));
    ratio.appendChild(verdict);
    var ratioDd = make("dd");
    ratioDd.appendChild(ratio);
    if (!complete) ratioDd.appendChild(make("span", "wb-coverage", "Copertura incompleta: questo esito è locale e non un verdetto globale."));
    var ratioRow = make("div", "wb-measure-row wb-measure-ratio");
    ratioRow.appendChild(make("dt", "wb-visually-hidden", "Rapporto"));
    ratioRow.appendChild(ratioDd);
    node.appendChild(ratioRow);
    var detail = make("details", "wb-measure-more");
    detail.appendChild(make("summary", null, "Dettagli della misura"));
    var computedForeground = measurement ? safeComputedColor(measurement.foreground) : null;
    var computedBackground = measurement ? safeComputedColor(measurement.background) : null;
    var computed = make("span");
    if (computedForeground && computedBackground) {
      computed.appendChild(make("code", null, computedForeground));
      computed.appendChild(make("span", null, " su "));
      computed.appendChild(make("code", null, computedBackground));
    } else if (measurement) {
      computed.textContent = "Non disponibili: il runtime non ha restituito entrambi i colori calcolati.";
    } else {
      computed.textContent = "Non misurati.";
    }
    detail.appendChild(detailValueRow("Colori CSS calcolati (runtime)", computed));
    var minimumRow = detailValueRow("Minimo richiesto e criterio", make("span", null, criterionValue(criterion)));
    minimumRow.className += " wb-threshold";
    detail.appendChild(minimumRow);
    var targetRow = detailValueRow("Obiettivo progetto (non WCAG)", make("span", null, targetText(criterion)));
    targetRow.className += " wb-threshold";
    detail.appendChild(targetRow);
    var personalization = overrideSummary(state, view.theme, option);
    if (personalization) detail.appendChild(detailValueRow("Stato personalizzazioni", make("span", null, personalization)));
    var count = Array.isArray(view.measurements) ? view.measurements.length : 0;
    detail.appendChild(make("p", "margin-note", "Provenienza: " + slot + " · tema " + themeName(view.theme) + " · " + variantName(view.variant) + " · " + bytesText(view.variant) + (count > 1 ? " · " + String(count) + " misure" : "") + "."));
    var detailRow = make("div", "wb-measure-row wb-measure-more-row");
    detailRow.appendChild(make("dt", "wb-visually-hidden", "Dettagli della misura"));
    var detailValue = make("dd");
    detailValue.appendChild(detail);
    detailRow.appendChild(detailValue);
    node.appendChild(detailRow);
    var errors = Array.isArray(view.errors) ? view.errors : [];
    if (errors.length) {
      var errorRow = make("div", "wb-measure-row");
      errorRow.appendChild(make("dt", null, "Errori"));
      var errorList = make("dd");
      for (var index = 0; index < errors.length; index += 1) {
        var error = isRecord(errors[index]) ? errors[index] : {};
        errorList.appendChild(make("span", null, (error.phase ? error.phase + " · " : "") + (error.message ? String(error.message) : "errore non indicato") + (index < errors.length - 1 ? "; " : "")));
      }
      errorRow.appendChild(errorList);
      node.appendChild(errorRow);
    }
  }
  function setIfChanged(node, value) { if (node && node.textContent !== value) node.textContent = value; }
  function renderSample(sampleNode, metaNode, view, state, option) {
    var measurement = view && isRecord(view.measurement) ? view.measurement : null;
    var foreground = measurement ? safeComputedColor(measurement.foreground) : null;
    var background = measurement ? safeComputedColor(measurement.background) : null;
    if (sampleNode && sampleNode.style && typeof sampleNode.style.setProperty === "function") {
      sampleNode.style.setProperty("color", foreground && background ? foreground : "");
      sampleNode.style.setProperty("background-color", foreground && background ? background : "");
    }
    setAttribute(sampleNode, "class", foreground && background ? "wb-aa" : "wb-aa is-unmeasured");
    var text;
    if (view && foreground && background) {
      var summary = overrideSummary(state, view.theme, option);
      text = "Campione «Aa» dai colori CSS calcolati · tema " + themeName(view.theme) + " · " + variantName(view.variant) + " · " + bytesText(view.variant) + (summary ? " · " + summary : "");
    } else if (view) {
      text = "Colori CSS calcolati non disponibili per questa vista: nessun campione viene dipinto.";
    } else {
      text = "Campione live non disponibile: serve una misura del runtime.";
    }
    if (metaNode) setIfChanged(metaNode, text);
  }
  function renderSamples(state) {
    var views = state && Array.isArray(state.views) ? state.views : [];
    var leftView = null;
    var rightView = null;
    for (var index = 0; index < views.length; index += 1) {
      if (views[index] && views[index].slot === "left") leftView = views[index];
      if (views[index] && views[index].slot === "right") rightView = views[index];
    }
    var phase = state && state.phase ? String(state.phase) : "unavailable";
    var ready = phase === "complete" || phase === "incomplete";
    var option = selectedOption();
    renderSample(leftSample, leftMeta, ready && viewMatchesOption(leftView, option) ? leftView : null, state, option);
    renderSample(rightSample, rightMeta, ready && viewMatchesOption(rightView, option) ? rightView : null, state, option);
    if (!ready) {
      var message = phase === "running" ? "Verifica in corso…" : phase === "idle" ? "Campione live non disponibile: avvia il confronto." : "Campione live non disponibile.";
      if (leftMeta) setIfChanged(leftMeta, message);
      if (rightMeta) setIfChanged(rightMeta, message);
    }
  }
  function renderMatrix(state) {
    if (!matrixEntries.length) return;
    var phase = state && state.phase ? String(state.phase) : "unavailable";
    var ready = phase === "complete" || phase === "incomplete";
    var views = state && Array.isArray(state.views) ? state.views : [];
    var leftView = null;
    var rightView = null;
    for (var viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
      if (views[viewIndex] && views[viewIndex].slot === "left") leftView = views[viewIndex];
      if (views[viewIndex] && views[viewIndex].slot === "right") rightView = views[viewIndex];
    }
    var selection = state && isRecord(state.selection) ? state.selection : {};
    var comparison = selection.comparison === "tuning" || selection.comparison === "draft" ? selection.comparison : "themes";
    if (matrixViewA) setIfChanged(matrixViewA, matrixViewLabel(leftView, "left", comparison));
    if (matrixViewB) setIfChanged(matrixViewB, matrixViewLabel(rightView, "right", comparison));
    var indexes = {
      left: leftView && ready ? measurementIndex(leftView) : {},
      right: rightView && ready ? measurementIndex(rightView) : {},
    };
    var expected = [];
    if (leftView) expected.push("left");
    if (rightView) expected.push("right");
    for (var index = 0; index < matrixEntries.length; index += 1) {
      var entry = matrixEntries[index];
      if (!entry.cells) continue;
      var statuses = { left: null, right: null };
      var liveStatuses = [];
      var hasLive = false;
      for (var slotIndex = 0; slotIndex < 2; slotIndex += 1) {
        var slot = slotIndex === 0 ? "left" : "right";
        var view = slot === "left" ? leftView : rightView;
        var theme = view ? view.theme : slot === "left" ? "light" : "dark";
        var measurement = view && ready ? indexes[slot][matrixPairIdForTheme(entry.option, view.theme)] || null : null;
        var result = renderMatrixCell(entry.cells[slot], entry.option, theme, measurement);
        if (matrixTiles[index]) renderMatrixTileView(matrixTiles[index].views[slot], entry.option, theme, measurement, view, slot, comparison);
        statuses[slot] = result;
        if (result.live) { hasLive = true; liveStatuses.push(result.status); }
      }
      var effective;
      var allPass;
      var unmeasured;
      if (hasLive) {
        effective = worstStatusOf(liveStatuses);
        allPass = expected.length > 0;
        unmeasured = false;
        for (var expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
          var expectedSlot = expected[expectedIndex];
          var stateForSlot = statuses[expectedSlot];
          if (!stateForSlot || !stateForSlot.live) { allPass = false; unmeasured = true; continue; }
          if (stateForSlot.status !== "pass") allPass = false;
          if (stateForSlot.status === "unmeasured") unmeasured = true;
        }
      } else {
        effective = attribute(entry.row, "data-build-status") || attribute(entry.row, "data-status") || "unmeasured";
        allPass = attribute(entry.row, "data-build-all-pass") === "true" || attribute(entry.row, "data-all-pass") === "true";
        unmeasured = attribute(entry.row, "data-build-unmeasured") === "true" || attribute(entry.row, "data-unmeasured") === "true";
      }
      setAttribute(entry.row, "data-status-effective", effective);
      setAttribute(entry.row, "data-status-live", hasLive ? worstStatusOf(liveStatuses) : "");
      setAttribute(entry.row, "data-all-pass", allPass ? "true" : "false");
      setAttribute(entry.row, "data-unmeasured", unmeasured ? "true" : "false");
      setAttribute(entry.row, "data-live-status", hasLive ? "true" : "false");
      setAttribute(entry.row, "data-live-revision", hasLive ? textOf(state && state.revision) : "");
    }
    syncMatrixFocus();
    applyMatrixFilter();
  }
  var explorationPairCache = { light: null, dark: null };
  function explorationPairsFor(theme) {
    if (typeof controller.explorationPairs !== "function") return [];
    if (!explorationPairCache[theme]) {
      try {
        var list = controller.explorationPairs(theme);
        explorationPairCache[theme] = Array.isArray(list) ? list : [];
      } catch (error) { explorationPairCache[theme] = []; }
    }
    return explorationPairCache[theme];
  }
  function explorationLabel(pairs, measurement, theme) {
    var pairId = measurement && typeof measurement.pairId === "string" ? measurement.pairId : "";
    for (var index = 0; index < pairs.length; index += 1) {
      var pair = pairs[index];
      if (!isRecord(pair)) continue;
      if (pair.id === pairId) return pair.label || ((pair.foreground || pair.foregroundToken) + " su " + (pair.background || pair.backgroundToken));
    }
    if (measurement && isRecord(measurement) && typeof measurement.foreground === "string" && typeof measurement.background === "string") return measurement.foreground + " su " + measurement.background;
    return pairId || "coppia non indicata";
  }
  function renderExploration(state) {
    if (!explorationBox || !explorationResults || !explorationStatus) return;
    var available = typeof controller.explorationPairs === "function" && typeof controller.measureExploration === "function";
    explorationBox.hidden = !available;
    if (!available) { if (explorationRun) explorationRun.disabled = true; return; }
    var theme = checkedTheme();
    var phase = state && state.phase ? String(state.phase) : "unavailable";
    var exploration = state && isRecord(state.exploration) ? state.exploration : null;
    var measurements = exploration && Array.isArray(exploration.measurements) ? exploration.measurements : [];
    var signature = [theme, phase, textOf(state && state.revision), textOf(exploration && exploration.revision), textOf(exploration && exploration.phase), textOf(exploration && exploration.variant), String(measurements.length), busy ? "busy" : "idle"].join("|");
    if (explorationRun) explorationRun.disabled = busy || phase === "running";
    if (signature === lastExplorationSignature) return;
    lastExplorationSignature = signature;
    clear(explorationResults);
    explorationResults.hidden = true;
    if (!exploration) {
      setIfChanged(explorationStatus, "Non misurato. Nessun dato vecchio viene mostrato.");
      return;
    }
    if (exploration.theme !== theme) {
      setIfChanged(explorationStatus, "Tema cambiato: rimisura l'esplorazione. I dati precedenti non vengono mostrati come attuali.");
      return;
    }
    if (exploration.revision !== undefined && exploration.revision !== null && state && state.revision !== undefined && state.revision !== null && String(exploration.revision) !== String(state.revision)) {
      setIfChanged(explorationStatus, "La selezione o la bozza è cambiata: i dati dell'esplorazione non sono aggiornati. Rimisura.");
      return;
    }
    if (exploration.phase === "running") { setIfChanged(explorationStatus, "Misura in corso…"); return; }
    if (exploration.phase === "idle") { setIfChanged(explorationStatus, "Non misurato."); return; }
    if (exploration.phase === "unavailable") {
      var unavailable = Array.isArray(exploration.errors) ? exploration.errors : [];
      setIfChanged(explorationStatus, "Esplorazione non disponibile." + (unavailable.length ? " " + unavailable.map(function (item) { return isRecord(item) ? textOf(item.message || item.phase) : textOf(item); }).join("; ") : ""));
      return;
    }
    if (!measurements.length) { setIfChanged(explorationStatus, "Nessuna combinazione misurata: nessun dato inventato."); return; }
    var pairs = explorationPairsFor(theme);
    var table = make("table", "wb-exploration-table");
    var caption = make("caption", null, "Combinazioni dei colori base · tema " + themeName(theme) + " · sola lettura, fuori dalla copertura primaria.");
    table.appendChild(caption);
    var head = make("thead");
    var headRow = make("tr");
    var headings = ["Coppia", "Rapporto", "Minimo", "Target", "Esito"];
    for (var h = 0; h < headings.length; h += 1) {
      var th = make("th", null, headings[h]);
      setAttribute(th, "scope", "col");
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    table.appendChild(head);
    var body = make("tbody");
    for (var m = 0; m < measurements.length; m += 1) {
      var measurement = isRecord(measurements[m]) ? measurements[m] : {};
      var row = make("tr");
      var rowHead = make("th", null, explorationLabel(pairs, measurement, theme));
      setAttribute(rowHead, "scope", "row");
      row.appendChild(rowHead);
      row.appendChild(make("td", null, finite(measurement.ratio) ? ratioText(measurement.ratio, [measurement.minimum, measurement.target]) : "non misurato"));
      row.appendChild(make("td", null, finite(measurement.minimum) ? ratioText(measurement.minimum) : "non dichiarato"));
      row.appendChild(make("td", null, finite(measurement.target) ? ratioText(measurement.target) : "non dichiarato"));
      row.appendChild(make("td", null, matrixStatusLabelLocal(textOf(measurement.status) || "unmeasured")));
      body.appendChild(row);
    }
    table.appendChild(body);
    explorationResults.hidden = false;
    explorationResults.appendChild(table);
    var summary = measurements.length + (measurements.length === 1 ? " combinazione misurata" : " combinazioni misurate") + " · tema " + themeName(theme) + (exploration.variant ? " · " + variantName(exploration.variant) : "") + " · advisory, non copertura.";
    var omitted = exploration.omittedFamilies;
    if (Array.isArray(omitted) && omitted.length) summary += " Famiglie omesse dal limite: " + omitted.map(function (item) { return textOf(item); }).join(", ") + ".";
    else if (omitted && typeof omitted === "object" && !Array.isArray(omitted)) {
      var omittedKeys = Object.keys(omitted);
      if (omittedKeys.length) summary += " Limite famiglie per tema: " + omittedKeys.map(function (key) { return key + " " + textOf(omitted[key]); }).join(", ") + ".";
    }
    var errors = Array.isArray(exploration.errors) ? exploration.errors : [];
    if (errors.length) summary += " Errori: " + errors.map(function (item) { return isRecord(item) ? textOf(item.message || item.phase) : textOf(item); }).join("; ") + ".";
    if (state && state.error) summary += " Ultimo tentativo non riuscito: " + textOf(state.error) + ".";
    setIfChanged(explorationStatus, summary);
  }
  function countOf(value) {
    if (Array.isArray(value)) return value.length;
    if (finite(value)) return value;
    return null;
  }
  function deltaText(value) {
    if (!finite(value)) return null;
    var magnitude = Math.abs(value).toFixed(2).replace(".", ",");
    if (value > 0) return "+" + magnitude;
    if (value < 0) return "−" + magnitude;
    return "0,00";
  }
  function sideName(value) {
    if (value === "background") return "sfondo";
    if (value === "foreground") return "primo piano";
    return "lato non indicato";
  }
  function regressionText(item) {
    if (!isRecord(item)) return textOf(item);
    var label = item.label || item.pairId || "coppia non indicata";
    var where = item.theme === "light" || item.theme === "dark" ? " (tema " + themeName(item.theme) + ")" : "";
    var before = finite(item.before) ? ratioText(item.before) : "non misurata";
    var after = finite(item.after) ? ratioText(item.after) : "non misurata";
    return label + where + ": " + before + " → " + after;
  }
  function scopeText(scope) {
    if (!isRecord(scope)) return null;
    var parts = [];
    if (scope.affectedTheme === "light" || scope.affectedTheme === "dark") parts.push("tema " + themeName(scope.affectedTheme) + " modificato");
    if (Array.isArray(scope.measuredThemes) && scope.measuredThemes.length) parts.push("temi misurati: " + scope.measuredThemes.map(themeName).join(", "));
    if (Array.isArray(scope.unchangedThemes) && scope.unchangedThemes.length) parts.push("altri temi rimisurati solo per regressioni: " + scope.unchangedThemes.map(themeName).join(", "));
    return parts.length ? "Ambito: " + parts.join(" · ") + "." : null;
  }
  function setProposalFrames(verified) {
    if (proposalFrames) proposalFrames.hidden = !verified;
    if (!verified) {
      if (proposalBefore) clear(proposalBefore);
      if (proposalAfter) clear(proposalAfter);
    }
  }
  function suggestionThresholds(state) {
    var selection = state && isRecord(state.selection) ? state.selection : {};
    var theme = selection.theme === "dark" ? "dark" : "light";
    var option = selection.pairId ? optionForPairId(selection.pairId, theme) : selectedOption();
    var slot = option ? thresholdsFor(option)[theme] : null;
    var minimum = slot && slot.minimum !== "" && finite(Number(slot.minimum)) ? Number(slot.minimum) : null;
    var target = slot && slot.target !== "" && finite(Number(slot.target)) ? Number(slot.target) : null;
    return { minimum: minimum, target: target, list: [minimum, target] };
  }
  function selectedMeasurement(state) {
    var selection = state && isRecord(state.selection) ? state.selection : {};
    var views = state && Array.isArray(state.views) ? state.views : [];
    var comparison = selection.comparison === "tuning" || selection.comparison === "draft" ? selection.comparison : "themes";
    var theme = selection.theme === "dark" ? "dark" : "light";
    for (var index = 0; index < views.length; index += 1) {
      var view = views[index];
      if (!isRecord(view)) continue;
      if (comparison !== "themes" ? view.slot === "right" : view.theme === theme) {
        return isRecord(view.measurement) ? view.measurement : null;
      }
    }
    return null;
  }
  function noneTargetSentence(state, suggestion) {
    var threshold = suggestionThresholds(state);
    var measurement = selectedMeasurement(state);
    var minimum = measurement && finite(measurement.minimum) ? measurement.minimum : threshold.minimum;
    var target = measurement && finite(measurement.target) ? measurement.target : threshold.target;
    var ratio = measurement && finite(measurement.ratio) ? measurement.ratio : (suggestion && finite(suggestion.before) ? suggestion.before : null);
    var targetState;
    if (target === null || ratio === null) targetState = "Target del progetto non verificabile con questa misura.";
    else if (ratio >= target) targetState = "Target del progetto " + ratioText(target) + " raggiunto.";
    else targetState = "Target del progetto " + ratioText(target) + " non raggiunto.";
    var minimumState = minimum === null ? "Questa ricerca corregge solo il minimo dichiarato." : "Questa ricerca corregge solo il minimo " + ratioText(minimum) + ".";
    return targetState + " " + minimumState;
  }
  function renderSuggestion(state) {
    if (!proposal) return;
    clear(proposal);
    var suggestion = state && isRecord(state.suggestion) ? state.suggestion : null;
    if (!suggestion) {
      suggestionVerified = false;
      suggestionPresent = false;
      setProposalFrames(false);
      if (proposal) proposal.hidden = true;
      if (suggestionsTitle) suggestionsTitle.textContent = "Cerca una correzione";
      if (applyButton) { applyButton.disabled = true; applyButton.hidden = true; }
      if (discardButton) { discardButton.hidden = true; discardButton.disabled = true; }
      return;
    }
    suggestionPresent = true;
    if (proposal) proposal.hidden = false;
    if (discardButton) { discardButton.hidden = false; discardButton.disabled = busy || typeof controller.discardSuggestion !== "function"; }
    var statusValue = suggestion.status;
    var verified = statusValue === "verified";
    if (suggestionsTitle) suggestionsTitle.textContent = verified ? "Proposta di correzione" : "Esito della ricerca";
    setProposalFrames(verified);
    var side = sideName(suggestion.side);
    var title = verified
      ? "Proposta verificata per il " + side
      : statusValue === "none"
        ? "Minimo già raggiunto"
        : statusValue === "regression"
          ? "Proposta scartata per regressioni"
          : "Ricerca non disponibile";
    proposal.appendChild(make("p", "wb-proposal-title", title));
    if (verified) proposal.appendChild(make("p", null, "La proposta raggiunge il minimo dichiarato con il CSS dei byte catturati; il target del progetto resta un obiettivo separato. Non rigenera il generatore."));
    else if (statusValue === "none") proposal.appendChild(make("p", null, noneTargetSentence(state, suggestion)));
    else if (statusValue === "regression") proposal.appendChild(make("p", null, "Il candidato non ha superato la verifica: nessun valore viene presentato come correzione."));
    else proposal.appendChild(make("p", null, "Il runtime non ha potuto verificare una proposta: nessun esito positivo viene mostrato."));
    var proposedValue = typeof suggestion.value === "string" && suggestion.value.trim() ? suggestion.value.trim() : null;
    if (proposedValue && (verified || statusValue === "regression")) {
      var valueLine = make("p", null, verified ? "Valore proposto: " : "Candidato scartato: ");
      valueLine.appendChild(make("code", "wb-proposal-value", proposedValue));
      proposal.appendChild(valueLine);
    }
    var threshold = suggestionThresholds(state);
    if (suggestion.before !== undefined || suggestion.after !== undefined) {
      proposal.appendChild(make("p", null, "Prima: " + (finite(suggestion.before) ? ratioText(suggestion.before, threshold.list) : "non misurata") + " · Dopo: " + (finite(suggestion.after) ? ratioText(suggestion.after, threshold.list) : "non misurata") + "."));
    }
    var technical = [];
    var identity = [];
    if (suggestion.control) identity.push("controllo " + suggestion.control);
    if (suggestion.token) identity.push("token " + suggestion.token);
    identity.push("lato " + side);
    technical.push(make("p", "margin-note", identity.join(" · ") + "."));
    if ((threshold.minimum !== null || threshold.target !== null) && statusValue !== "none") {
      technical.push(make("p", "margin-note", "Soglia rilevante: " + (threshold.minimum !== null ? "minimo " + ratioText(threshold.minimum) : "minimo non dichiarato") + " · " + (threshold.target !== null ? "target " + ratioText(threshold.target) : "target non dichiarato") + "."));
    }
    var delta = deltaText(suggestion.deltaL);
    var gamut = suggestion.gamutAdjusted === true;
    if (delta !== null || gamut) {
      var deltaLine = delta !== null ? "ΔL " + delta + "." : "";
      if (gamut) deltaLine += (deltaLine ? " " : "") + "Il fit di gamut ha ridotto il chroma: hue resta l'intento, ma non è garantito identico.";
      else deltaLine += (deltaLine ? " " : "") + "Nessun aggiustamento di gamut applicato.";
      technical.push(make("p", "margin-note", deltaLine));
    }
    var checked = countOf(suggestion.checked);
    if (checked !== null) technical.push(make("p", "margin-note", "Controlli eseguiti: " + checked + (countOf(suggestion.unmeasured) !== null ? " · non misurati: " + countOf(suggestion.unmeasured) : "") + "."));
    var regressions = Array.isArray(suggestion.regressions) ? suggestion.regressions : [];
    if (regressions.length) technical.push(make("p", "margin-note", "Regressioni: " + regressions.map(regressionText).join("; ") + "."));
    var scope = scopeText(suggestion.scope);
    if (scope) technical.push(make("p", "margin-note", scope));
    if (suggestion.reason) technical.push(make("p", "margin-note", String(suggestion.reason)));
    if (technical.length) {
      var technicalDetails = make("details", "is-detail");
      technicalDetails.appendChild(make("summary", null, "Dettagli tecnici della proposta"));
      for (var technicalIndex = 0; technicalIndex < technical.length; technicalIndex += 1) technicalDetails.appendChild(technical[technicalIndex]);
      proposal.appendChild(technicalDetails);
    }
    if (verified) proposal.appendChild(make("p", "margin-note", "Anteprima non applicata: usa Prova proposta per applicarla come override temporaneo."));
    suggestionVerified = Boolean(verified);
    if (applyButton) { applyButton.hidden = !verified; applyButton.disabled = !verified; }
  }
  function renderSessionStatus(state) {
    if (!sessionStatus) return;
    var suggestion = state && isRecord(state.suggestion) ? state.suggestion : null;
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var draftCount = Object.keys(draft).length;
    var phase = state && state.phase ? String(state.phase) : "idle";
    var message = "Anteprima locale";
    if (sourceBlocked) message += " · selezione non disponibile";
    else if (suggestion && suggestion.status === "verified") message += " · proposta verificata in attesa";
    else if (draftCount) message += " · " + (draftCount === 1 ? "1 modifica in bozza non salvata" : draftCount + " modifiche in bozza non salvate");
    if (!sourceBlocked && suggestion && suggestion.status !== "verified") {
      if (suggestion.status === "none") message += " · minimo già raggiunto";
      else if (suggestion.status === "regression") message += " · candidato scartato";
      else message += " · ricerca non disponibile";
    }
    if (phase === "running") message += " · verifica in corso";
    setIfChanged(sessionStatus, message);
  }
  function detailsSignature(state) {
    var selection = state && isRecord(state.selection) ? state.selection : {};
    var draft = state && isRecord(state.draft) ? state.draft : {};
    var keys = Object.keys(draft).sort();
    var pairs = [];
    for (var index = 0; index < keys.length; index += 1) pairs.push(keys[index] + "=" + textOf(draft[keys[index]]));
    return textOf(selection.pairId) + "|" + textOf(selection.theme) + "|" + textOf(selection.comparison) + "|" + pairs.join(",");
  }
  function renderUnavailableSelection(pairId) {
    selectionAvailable = false;
    lastControlsKey = "";
    if (!details) return;
    clear(details);
    var article = make("article", "wb-details");
    article.appendChild(make("p", null, "La coppia attiva del runtime non è nel catalogo statico: " + textOf(pairId) + ". Nessun dettaglio viene inventato."));
    details.appendChild(article);
  }
  function syncSelection(selection) {
    var value = isRecord(selection) ? selection : {};
    var theme = value.theme === "dark" ? "dark" : "light";
    if (themeDark) themeDark.checked = theme === "dark";
    if (themeLight) themeLight.checked = theme === "light";
    var comparison = value.comparison === "tuning" || value.comparison === "draft" ? value.comparison : "themes";
    if (comparisonThemes) comparisonThemes.checked = comparison === "themes";
    if (comparisonTuning) comparisonTuning.checked = comparison === "tuning";
    if (comparisonDraft) comparisonDraft.checked = comparison === "draft";
    var pairId = typeof value.pairId === "string" && value.pairId ? value.pairId : null;
    var key = (pairId || "") + "|" + theme + "|" + comparison;
    var changed = key !== lastSelectionKey;
    lastSelectionKey = key;
    if (!pairSelect) return changed;
    if (!pairId) {
      selectionAvailable = Boolean(selectedOption());
      return changed;
    }
    var option = optionForPairId(pairId, theme);
    if (!option) {
      if (changed) renderUnavailableSelection(pairId);
      return true;
    }
    selectionAvailable = true;
    var own = (attribute(option, "data-sources") || "").split(/\s+/).filter(Boolean);
    var currentSource = sourceSelect ? sourceSelect.value : "";
    var compatible = currentSource === "" || own.indexOf(currentSource) !== -1;
    var pinned = sourceBlocked && pairId === blockedPairId;
    var sourceReset = false;
    if (sourceSelect && !compatible && !pinned) { sourceSelect.value = own.length ? own[0] : ""; sourceReset = true; }
    if (pairSelect.value !== option.value) pairSelect.value = option.value;
    var all = options();
    for (var index = 0; index < all.length; index += 1) all[index].selected = all[index] === option;
    return changed || sourceReset;
  }
  function optionForPairId(pairId, theme) {
    if (!pairSelect) return null;
    var pairs = controller.pairs(theme);
    var descriptor = null;
    if (Array.isArray(pairs)) {
      for (var index = 0; index < pairs.length; index += 1) {
        if (isRecord(pairs[index]) && pairs[index].id === pairId) { descriptor = pairs[index]; break; }
      }
    }
    if (!descriptor) return null;
    var foreground = descriptor.foreground || descriptor.foregroundToken;
    var background = descriptor.background || descriptor.backgroundToken;
    var property = typeof descriptor.property === "string" && descriptor.property ? descriptor.property : null;
    var list = options();
    for (var candidate = 0; candidate < list.length; candidate += 1) {
      if (attribute(list[candidate], "data-fg") !== foreground || attribute(list[candidate], "data-bg") !== background) continue;
      if (property && propertyFor(list[candidate]) !== property) continue;
      if (typeof descriptor.kind === "string" && descriptor.kind) setAttribute(list[candidate], "data-pair-kind", descriptor.kind);
      return list[candidate];
    }
    return null;
  }
  function frameTitle(slot, comparison) {
    if (comparison === "themes") return slot === "left" ? "Tema chiaro" : "Tema scuro";
    return slot === "left" ? "Attuale" : "Modifica";
  }
  function syncViews(views) {
    var comparison = checkedComparison();
    var list = Array.isArray(views) ? views : [];
    var leftView = null;
    var rightView = null;
    for (var index = 0; index < list.length; index += 1) {
      if (list[index] && list[index].slot === "left") leftView = list[index];
      if (list[index] && list[index].slot === "right") rightView = list[index];
    }
    setIfChanged(leftTitle, frameTitle("left", comparison));
    setIfChanged(rightTitle, frameTitle("right", comparison));
    if (left) setAttribute(left, "aria-label", "Vista CSS sinistra · " + frameTitle("left", comparison) + (leftView ? " · tema " + themeName(leftView.theme) + " · " + variantName(leftView.variant) : ""));
    if (right) setAttribute(right, "aria-label", "Vista CSS destra · " + frameTitle("right", comparison) + (rightView ? " · tema " + themeName(rightView.theme) + " · " + variantName(rightView.variant) : ""));
  }
  function renderIdentity(option) {
    if (!identityNode) return;
    clear(identityNode);
    if (!option) { identityNode.appendChild(make("span", null, "Nessuna coppia selezionata.")); return; }
    identityNode.appendChild(make("code", null, attribute(option, "data-fg") || ""));
    identityNode.appendChild(make("span", null, " su "));
    identityNode.appendChild(make("code", null, attribute(option, "data-bg") || ""));
    identityNode.appendChild(make("span", null, " · " + optionKindLabel(option)));
  }
  function renderActionTheme() {
    if (!actionThemeNode) return;
    setIfChanged(actionThemeNode, "Tema per proposta e override: " + themeName(checkedTheme()) + ".");
  }
  function renderCurrentUse() {
    if (!currentUse) return;
    clear(currentUse);
    var option = sourceBlocked ? null : selectedOption();
    if (!option) { currentUse.appendChild(make("span", null, "Nessun uso disponibile")); return; }
    currentUse.appendChild(make("strong", null, pickerHuman(option)));
    currentUse.appendChild(make("span", "wb-current-use-kind", optionKindLabel(option)));
    if (!pickerHasHuman(option)) currentUse.appendChild(make("code", "wb-current-use-tech", pickerTech(option)));
  }
  function pairCompactSnippetLocal(fg, bg, property) {
    var p = property === "borderColor" ? "border-color" : property === "outlineColor" ? "outline-color" : "color";
    return p + ": var(" + (fg || "--color-text") + ");\nbackground-color: var(" + (bg || "--color-bg") + ");";
  }
  function updateHarmonyText(option) {
    if (!harmonyNode) return;
    if (!option) { setIfChanged(harmonyNode, "Armonia cromatica: nessuna selezione attiva."); return; }
    var state = stateNow();
    var views = state && Array.isArray(state.views) ? state.views : [];
    var measurement = null;
    for (var i = 0; i < views.length; i += 1) {
      if (views[i] && isRecord(views[i].measurement) && viewMatchesOption(views[i], option)) {
        measurement = views[i].measurement;
        break;
      }
    }
    var fgOklch = measurement && isRecord(measurement.foregroundOklch) ? measurement.foregroundOklch : null;
    var bgOklch = measurement && isRecord(measurement.backgroundOklch) ? measurement.backgroundOklch : null;
    if (fgOklch && bgOklch && finite(fgOklch.h) && finite(bgOklch.h)) {
      var diffH = Math.round(Math.min(Math.abs(fgOklch.h - bgOklch.h), 360 - Math.abs(fgOklch.h - bgOklch.h)));
      var type = diffH < 25 ? "Affinità monocromatica (tono su tono)"
        : diffH < 70 ? "Armonia analoga"
        : diffH < 140 ? "Contrasto tonale bilanciato"
        : "Contrasto complementare";
      var diffL = Math.round(Math.abs((fgOklch.l || 0) - (bgOklch.l || 0)) * 100);
      setIfChanged(harmonyNode, "Armonia cromatica: " + type + " (ΔH " + diffH + "°) · Stacco ΔL: " + diffL + "%.");
    } else {
      setIfChanged(harmonyNode, "Relazione cromatica non disponibile: i risultati di contrasto restano separati.");
    }
  }
  function updateSnippetAndHarmony(option) {
    if (snippetCode) {
      if (!option) {
        snippetCode.textContent = "/* Nessun abbinamento selezionato */";
      } else {
        var fg = attribute(option, "data-fg") || "";
        var bg = attribute(option, "data-bg") || "";
        var prop = propertyFor(option);
        snippetCode.textContent = pairCompactSnippetLocal(fg, bg, prop);
      }
    }
    if (harmonyNode) updateHarmonyText(option);
  }
  function renderCurrent() {
    var option = selectedOption();
    if (currentHeading) {
      clear(currentHeading);
      if (sourceBlocked) currentHeading.appendChild(make("strong", null, "Nessun confronto disponibile"));
      else {
        var title = option ? attribute(option, "data-usage") || "" : "";
        if (title) currentHeading.appendChild(make("strong", null, title));
        else currentHeading.appendChild(make("span", null, "Nessuna coppia selezionata"));
      }
    }
    renderIdentity(sourceBlocked ? null : option);
    renderCurrentUse();
    updateSnippetAndHarmony(sourceBlocked ? null : option);
    if (purposeNode) setIfChanged(purposeNode, sourceBlocked ? "Nessun criterio applicato: la sorgente non ha una coppia disponibile." : purposeFor(option));
    renderActionTheme();
  }
  function matchUses(chosen) {
    var list = options();
    var foreground = [];
    var background = [];
    for (var index = 0; index < list.length; index += 1) {
      var option = list[index];
      var fgSources = (attribute(option, "data-fg-sources") || "").split(/\s+/).filter(Boolean);
      var bgSources = (attribute(option, "data-bg-sources") || "").split(/\s+/).filter(Boolean);
      if (fgSources.indexOf(chosen) !== -1) foreground.push(option);
      else if (bgSources.indexOf(chosen) !== -1) background.push(option);
    }
    return { foreground: foreground, background: background };
  }
  function useRankOf(option) {
    var raw = attribute(option, "data-use-rank");
    var value = raw === null || raw === "" ? 999 : Number(raw);
    return isFinite(value) ? value : 999;
  }
  function rankOptions(list) {
    var copy = [];
    for (var index = 0; index < list.length; index += 1) copy.push(list[index]);
    copy.sort(function (a, b) { return useRankOf(a) - useRankOf(b); });
    return copy;
  }
  function diversified(list, activeOption) {
    var buckets = [];
    var seen = {};
    for (var item = 0; item < list.length; item += 1) {
      if (list[item] === activeOption) continue;
      var key = attribute(list[item], "data-use-bucket") || "other";
      if (!seen[key]) { seen[key] = { rank: useRankOf(list[item]), items: [] }; buckets.push(seen[key]); }
      seen[key].items.push(list[item]);
    }
    buckets.sort(function (a, b) { return a.rank - b.rank; });
    var ordered = [];
    if (activeOption) ordered.push(activeOption);
    var round = 0;
    var pushed = true;
    while (pushed) {
      pushed = false;
      for (var bucket = 0; bucket < buckets.length; bucket += 1) {
        if (round < buckets[bucket].items.length) { ordered.push(buckets[bucket].items[round]); pushed = true; }
      }
      round += 1;
    }
    return ordered;
  }
  function preferredUses(chosen) {
    if (!chosen) return { options: [], backgroundOnly: false };
    var matched = matchUses(chosen);
    if (matched.foreground.length) return { options: rankOptions(matched.foreground), backgroundOnly: false };
    return { options: rankOptions(matched.background), backgroundOnly: matched.background.length > 0 };
  }
  function pickerFold(value) {
    var raw = textOf(value).toLowerCase();
    if (typeof raw.normalize === "function") {
      try { return raw.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (error) { return raw; }
    }
    return raw;
  }
  function pickerSourceName(token) {
    if (!token) return "Tutte le sorgenti";
    var meta = designEntry(token);
    if (meta && typeof meta.name === "string" && meta.name) return meta.name.charAt(0).toUpperCase() + meta.name.slice(1);
    var short = token.replace(/^--/, "").replace(/^(palette|color)-/, "");
    var words = short.split("-").filter(Boolean);
    if (!words.length) return token;
    var out = [];
    for (var index = 0; index < words.length; index += 1) out.push(words[index].charAt(0).toUpperCase() + words[index].slice(1));
    return out.join(" ");
  }
  function pickerFallback(option) {
    return (attribute(option, "data-fg") || "") + " su " + (attribute(option, "data-bg") || "");
  }
  function usageHasHuman(option) {
    var usage = attribute(option, "data-usage") || "";
    return Boolean(usage) && usage !== pickerFallback(option) && usage.indexOf("--") !== 0;
  }
  function usageHuman(option) {
    return usageHasHuman(option) ? attribute(option, "data-usage") || "" : "Uso senza nome";
  }
  function pickerHasHuman(option) {
    var label = attribute(option, "data-picker-label");
    if (label !== null) return Boolean(label);
    return usageHasHuman(option);
  }
  function pickerHuman(option) {
    var label = attribute(option, "data-picker-label");
    if (label !== null) return label || "Uso senza nome";
    return usageHuman(option);
  }
  function pickerTech(option) {
    return pickerFallback(option);
  }
  function pickerBucket(option) {
    return attribute(option, "data-use-bucket") || "other";
  }
  function pickerBucketLabel(bucket) {
    if (bucket === "page") return "Testo su pagina";
    if (bucket === "callout") return "Riquadri";
    if (bucket === "button") return "Pulsanti";
    if (bucket === "border") return "Bordi";
    if (bucket === "focus") return "Indicatore statico";
    return "Altri usi";
  }
  function pickerSearchText(option) {
    var parts = [
      attribute(option, "data-usage"),
      attribute(option, "data-picker-label"),
      attribute(option, "data-fg"),
      attribute(option, "data-bg"),
      optionKindLabel(option),
      attribute(option, "data-sources"),
      attribute(option, "data-fg-sources"),
      attribute(option, "data-bg-sources"),
    ];
    var sources = [attribute(option, "data-sources"), attribute(option, "data-fg-sources"), attribute(option, "data-bg-sources")].join(" ").split(/\s+/);
    for (var index = 0; index < sources.length; index += 1) {
      if (sources[index]) parts.push(pickerSourceName(sources[index]));
    }
    return pickerFold(parts.join(" "));
  }
  function pickerCandidates(chosen) {
    var list = options();
    var pool = [];
    var backgroundOnly = false;
    var active = null;
    var activeValue = pairSelect ? pairSelect.value : "";
    if (!chosen) {
      pool = list.slice();
      for (var allIndex = 0; allIndex < list.length; allIndex += 1) if (list[allIndex].value === activeValue) { active = list[allIndex]; break; }
    } else {
      var matched = matchUses(chosen);
      backgroundOnly = !matched.foreground.length && matched.background.length > 0;
      pool = matched.foreground.length ? matched.foreground.slice() : matched.background.slice();
      var union = matched.foreground.concat(matched.background);
      for (var match = 0; match < union.length; match += 1) if (union[match].value === activeValue) { active = union[match]; break; }
      if (active && pool.indexOf(active) === -1) pool.unshift(active);
    }
    return { options: diversified(pool, active), backgroundOnly: backgroundOnly, active: active };
  }
  function pickerFiltered(scope) {
    var words = pickerFold(pickerQuery).split(/\s+/).filter(Boolean);
    var filtered = [];
    for (var index = 0; index < scope.options.length; index += 1) {
      var option = scope.options[index];
      if (pickerCategory && pickerBucket(option) !== pickerCategory) continue;
      if (words.length) {
        var haystack = pickerSearchText(option);
        var matched = true;
        for (var word = 0; word < words.length; word += 1) {
          if (haystack.indexOf(words[word]) === -1) { matched = false; break; }
        }
        if (!matched) continue;
      }
      filtered.push(option);
    }
    return filtered;
  }
  function pickerCountText(total) {
    var pages = Math.max(1, Math.ceil(total / useVisibleLimit));
    if (total === 0) {
      return pickerQuery || pickerCategory
        ? "Nessun uso corrisponde ai filtri. Modifica la ricerca o scegli Tutti gli usi."
        : "Nessun uso disponibile per questa sorgente.";
    }
    var page = Math.min(pickerPage, pages - 1);
    return total + (total === 1 ? " uso" : " usi") + " · pagina " + (page + 1) + " di " + pages;
  }
  function renderPickerSource(chosen) {
    if (!pickerSource) return;
    setIfChanged(pickerSource, "Sorgente: " + pickerSourceName(chosen) + ". Usi generati dalla palette, non rilevati nel sito.");
  }
  function buildPickerCategories(scope) {
    if (!useCategory) return;
    var present = {};
    for (var index = 0; index < scope.options.length; index += 1) present[pickerBucket(scope.options[index])] = true;
    var keep = pickerCategory && present[pickerCategory] ? pickerCategory : "";
    clear(useCategory);
    var all = make("option", null, "Tutti gli usi");
    all.value = "";
    useCategory.appendChild(all);
    var order = ["page", "callout", "button", "border", "focus", "other"];
    for (var bucket = 0; bucket < order.length; bucket += 1) {
      if (!present[order[bucket]]) continue;
      var option = make("option", null, pickerBucketLabel(order[bucket]));
      option.value = order[bucket];
      useCategory.appendChild(option);
    }
    useCategory.value = keep;
    pickerCategory = keep;
  }
  function setPagerState(button, enabled) {
    if (!button) return;
    button.disabled = false;
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
  }
  function updateUsePressed(active) {
    for (var index = 0; index < useButtons.length; index += 1) {
      var button = useButtons[index];
      var on = attribute(button, "data-pair-value") === active;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.disabled = false;
    }
  }
  function resetPickerFilters() {
    pickerQuery = "";
    pickerCategory = "";
    pickerPage = 0;
    if (useSearch && useSearch.value !== "") useSearch.value = "";
    if (useCategory && useCategory.value !== "") useCategory.value = "";
  }
  function useButton(option) {
    var li = make("li");
    var button = make("button", "wb-use");
    button.type = "button";
    setAttribute(button, "data-smart-colors-workbench", "use");
    setAttribute(button, "data-pair-value", option.value);
    button.setAttribute("aria-pressed", pairSelect && pairSelect.value === option.value ? "true" : "false");
    button.disabled = false;
    var main = make("span", "wb-use-main");
    main.appendChild(make("span", "wb-use-label", pickerHuman(option)));
    if (!pickerHasHuman(option)) {
      var tech = make("span", "wb-use-tech");
      tech.appendChild(make("code", null, attribute(option, "data-fg") || ""));
      tech.appendChild(make("span", null, " su "));
      tech.appendChild(make("code", null, attribute(option, "data-bg") || ""));
      main.appendChild(tech);
    }
    button.appendChild(main);
    button.appendChild(make("span", "wb-use-kind", optionKindLabel(option)));
    var mark = make("span", "wb-use-mark", "✓");
    mark.setAttribute("aria-hidden", "true");
    button.appendChild(mark);
    li.appendChild(button);
    useButtons.push(button);
    bindUse(button);
    return li;
  }
  function buildUses(scope) {
    useButtons = [];
    if (!usesBox) return;
    clear(usesBox);
    if (pickerCategory) {
      var categoryFound = false;
      for (var candidate = 0; candidate < scope.options.length; candidate += 1) {
        if (pickerBucket(scope.options[candidate]) === pickerCategory) { categoryFound = true; break; }
      }
      if (!categoryFound) { pickerCategory = ""; if (useCategory) useCategory.value = ""; }
    }
    var filtered = pickerFiltered(scope);
    var pages = Math.max(1, Math.ceil(filtered.length / useVisibleLimit));
    if (pickerPage >= pages) pickerPage = pages - 1;
    if (pickerPage < 0) pickerPage = 0;
    var start = pickerPage * useVisibleLimit;
    var visible = filtered.slice(start, start + useVisibleLimit);
    if (visible.length) {
      var list = make("ul", "wb-uses");
      for (var index = 0; index < visible.length; index += 1) list.appendChild(useButton(visible[index]));
      usesBox.appendChild(list);
    } else {
      usesBox.appendChild(make("p", "wb-uses-empty", pickerCountText(0)));
    }
    if (scope.backgroundOnly) usesBox.appendChild(make("p", "wb-uses-note", "Questo colore compare come sfondo nelle coppie del catalogo: è una dipendenza del token di sfondo."));
    if (useCount) setIfChanged(useCount, pickerCountText(filtered.length));
    setPagerState(usePrev, pickerPage > 0);
    setPagerState(useNext, pickerPage < pages - 1);
  }
  function renderUses(chosen) {
    var sourceChanged = chosen !== lastUsesSource;
    if (sourceChanged) {
      lastUsesSource = chosen;
      resetPickerFilters();
      renderPickerSource(chosen);
    }
    var scope = pickerCandidates(chosen);
    if (sourceChanged) buildPickerCategories(scope);
    var key = chosen + "|" + pickerQuery + "|" + pickerCategory + "|" + pickerPage;
    if (sourceChanged || key !== lastUsesKey) {
      buildUses(scope);
      lastUsesKey = chosen + "|" + pickerQuery + "|" + pickerCategory + "|" + pickerPage;
    } else {
      updateUsePressed(pairSelect ? pairSelect.value : "");
    }
  }
  function syncDarkBlendCallout(chosen) {
    if (!darkBlendCurrent) return;
    clear(darkBlendCurrent);
    if (!chosen) { darkBlendCurrent.appendChild(make("span", null, "Nessun colore sorgente selezionato.")); return; }
    var found = null;
    for (var i = 0; i < swatchButtons.length; i += 1) {
      if (attribute(swatchButtons[i], "data-token") === chosen) { found = swatchButtons[i]; break; }
    }
    var isDark = themeDark && themeDark.checked;
    darkBlendCurrent.appendChild(make("span", null, "Sorgente attiva: "));
    darkBlendCurrent.appendChild(make("strong", null, chosen));
    if (found) {
      var blend = attribute(found, "data-dark-blend");
      var role = attribute(found, "data-role");
      if (blend) {
        var num = Number(blend);
        var white = Math.round((num / 100) * 28 * 10) / 10;
        darkBlendCurrent.appendChild(make("span", null, " · dark-blend " + num + " (" + (100 - white) + "% sorgente + " + white + "% bianco)"));
      } else {
        darkBlendCurrent.appendChild(make("span", null, " · dark-blend automatico" + (role ? " per " + role : "")));
      }
      darkBlendCurrent.appendChild(make("span", null, isDark ? " · attivo in dark mode" : " · regola il tema scuro"));
    }
  }
  function syncPalette() {
    var chosen = sourceSelect ? sourceSelect.value : "";
    for (var index = 0; index < swatchButtons.length; index += 1) {
      var button = swatchButtons[index];
      var on = attribute(button, "data-token") === chosen;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.disabled = false;
    }
    syncDarkBlendCallout(chosen);
    renderUses(chosen);
  }
  function bindSwatch(button) {
    listen(button, "click", function () { if (busy) return; applySourceSelection(attribute(button, "data-token")); });
  }
  function bindUse(button) {
    listen(button, "click", function () {
      if (busy) { announce("Verifica in corso: attendi la misura prima di cambiare uso."); return; }
      var pending = applyUse(button);
      if (!pending) return;
      closePickerDialog();
      if (typeof pending.then === "function") pending.then(function () {}, function () {});
    });
  }
  function setPairOption(option) {
    if (!pairSelect || !option) return;
    pairSelect.value = option.value;
    var list = options();
    for (var index = 0; index < list.length; index += 1) list[index].selected = list[index] === option;
    syncMatrixFocus();
  }
  function applyBlockedPresentation() {
    if (resultBox) resultBox.hidden = sourceBlocked;
    if (emptyNote) emptyNote.hidden = !sourceBlocked;
    if (correctionBox) correctionBox.hidden = sourceBlocked;
    if (manualBox) manualBox.hidden = sourceBlocked;
    if (exportBox) exportBox.hidden = sourceBlocked;
    if (details) details.hidden = sourceBlocked;
    if (exportButton) exportButton.disabled = sourceBlocked || busy;
    renderSessionStatus(stateNow());
  }
  function setSourceBlocked(message, source) {
    sourceBlocked = true;
    blockedSource = source === undefined ? (sourceSelect ? sourceSelect.value : null) : source;
    var state = stateNow();
    blockedPairId = state && isRecord(state.selection) ? state.selection.pairId : null;
    if (emptyNote) emptyNote.textContent = message;
    applyBlockedPresentation();
    renderCurrent();
  }
  function clearSourceBlocked() {
    if (!sourceBlocked) return;
    sourceBlocked = false;
    blockedSource = null;
    blockedPairId = null;
    applyBlockedPresentation();
  }
  function applySourceSelection(token, trigger) {
    if (!sourceSelect) return;
    var next = token || "";
    if (sourceSelect.value !== next) sourceSelect.value = next;
    if (matrixAll && next) matrixAll.checked = false;
    var theme = checkedTheme();
    var preferred = preferredUses(next);
    if (!preferred.options.length) {
      setSourceBlocked(next ? "Nessuna coppia diagnostica per questo colore: la misura precedente è stata rimossa." : "Scegli un colore per vedere le coppie generate che lo usano.", next);
      syncPalette();
      applyMatrixFilter();
      announce(next ? "Nessuna coppia diagnostica per questo colore." : "Scegli un colore per vedere le coppie generate che lo usano.");
      return;
    }
    var target = null;
    for (var pick = 0; pick < preferred.options.length; pick += 1) if (optionAvailable(preferred.options[pick], theme)) { target = preferred.options[pick]; break; }
    if (!target) {
      setSourceBlocked("Nessuna coppia disponibile per questo colore nel tema " + themeName(theme) + ". Cambia tema per confrontarla.", next);
      syncPalette();
      applyMatrixFilter();
      announce("Nessuna coppia disponibile per questo colore nel tema " + themeName(theme) + ". Cambia tema per confrontarla.");
      return;
    }
    clearSourceBlocked();
    var current = selectedOption();
    var keep = false;
    for (var index = 0; index < preferred.options.length; index += 1) {
      if (preferred.options[index] === current && optionAvailable(current, theme)) keep = true;
    }
    if (!keep) setPairOption(target);
    syncPalette();
    applySelection(trigger);
  }
  function resumeSelection(trigger) {
    if (sourceBlocked && blockedSource) { applySourceSelection(blockedSource, trigger); return; }
    applySelection(trigger);
  }
  function applyUse(button) {
    if (!pairSelect || !button) return null;
    var value = attribute(button, "data-pair-value");
    if (!value) return null;
    var list = options();
    var found = null;
    for (var index = 0; index < list.length; index += 1) if (list[index].value === value) found = list[index];
    if (!found) return null;
    clearSourceBlocked();
    setPairOption(found);
    renderDetails(stateNow());
    renderControls(stateNow());
    return applySelection();
  }
  function closePickerDialog() {
    if (!pickerDialog) return;
    try {
      if (typeof pickerDialog.close === "function" && pickerDialog.open) pickerDialog.close();
      else pickerDialog.open = false;
    } catch (error) {
      try { pickerDialog.open = false; } catch (ignored) { /* the dialog is already inert */ }
    }
    if (openPicker && !openPicker.disabled && typeof openPicker.focus === "function") openPicker.focus();
  }
  function openPickerDialog() {
    if (!pickerDialog) return;
    pickerPage = 0;
    lastUsesKey = null;
    renderUses(sourceSelect ? sourceSelect.value : "");
    try {
      if (typeof pickerDialog.showModal === "function") {
        if (!pickerDialog.open) pickerDialog.showModal();
      } else {
        pickerDialog.open = true;
      }
    } catch (error) {
      try { pickerDialog.open = true; } catch (ignored) { /* the opener remains inert */ }
    }
    if (useSearch) {
      if (typeof useSearch.focus === "function") useSearch.focus();
      if (typeof useSearch.select === "function") useSearch.select();
    }
  }

  function initializeSelection() {
    var state = stateNow();
    if (!state) return;
    if (state.phase && state.phase !== "idle") return;
    if (state.draft && typeof state.draft === "object" && Object.keys(state.draft).length) return;
    var selection = isRecord(state.selection) ? state.selection : {};
    if (selection.comparison === "themes") return;
    try {
      var result = controller.select({ comparison: "themes" });
      if (result && typeof result.then === "function") result.then(function () {}, function () {});
    } catch (error) { /* presentation must never break the run */ }
  }
  function render(state) {
    lastState = state;
    var projectedPairId = state && isRecord(state.selection) ? state.selection.pairId : null;
    if (sourceBlocked && projectedPairId !== blockedPairId) clearSourceBlocked();
    var selectionChanged = syncSelection(state && state.selection);
    var detailKey = detailsSignature(state);
    if (selectionChanged) filterPairs(state);
    else if (detailKey !== lastDetailsSignature && selectionAvailable) renderDetails(state);
    lastDetailsSignature = detailKey;
    syncViews(state && state.views);
    renderCurrent();
    syncPalette();
    applyBlockedPresentation();
    var phase = state && state.phase ? String(state.phase) : "unavailable";
    var error = state && state.error ? " " + String(state.error) : "";
    setStatusVisibility(phase, Boolean(state && state.error), sourceBlocked);
    if (sourceBlocked) {
      announce(emptyNote && emptyNote.textContent ? String(emptyNote.textContent) : "Nessun confronto disponibile per questa sorgente.");
    } else if (phase === "idle") {
      announce("In attesa: scegli un colore e avvia il confronto." + error);
      if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", "Non misurato: seleziona una coppia.")); }
      if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", "Non misurato: seleziona una coppia.")); }
    } else if (phase === "running") {
      announce("Verifica in corso…" + error);
      if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", "Verifica in corso…")); }
      if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", "Verifica in corso…")); }
    } else if (phase === "unavailable") {
      announce("Misura non disponibile." + (state && state.error ? " " + String(state.error) : ""));
      if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", "Non disponibile.")); }
      if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", "Non disponibile.")); }
    } else {
      var views = state && Array.isArray(state.views) ? state.views : [];
      var leftView = null;
      var rightView = null;
      for (var index = 0; index < views.length; index += 1) {
        if (views[index] && views[index].slot === "left") leftView = views[index];
        if (views[index] && views[index].slot === "right") rightView = views[index];
      }
      renderMeasure(leftMeasure, leftView, "sinistra", phase === "complete", selectedOption(), state);
      renderMeasure(rightMeasure, rightView, "destra", phase === "complete", selectedOption(), state);
      if (phase === "complete") announce("Misure di questa coppia aggiornate in questo browser." + error);
      else announce("Misura incompleta: nessun esito globale." + error);
    }
    renderSamples(state);
    renderMatrix(state);
    renderExploration(state);
    renderSuggestion(state);
    renderSessionStatus(state);
    renderControls(state);
    var draftObject = state && isRecord(state.draft) ? state.draft : {};
    var removedObject = state && Array.isArray(state.removed) ? state.removed.slice().sort() : [];
    var hasDraft = Object.keys(draftObject).length > 0 || removedObject.length > 0;
    var draftSignature = JSON.stringify(draftObject) + "|" + JSON.stringify(removedObject);
    var revision = state && state.revision !== undefined && state.revision !== null ? String(state.revision) : "";
    if (draftSignature !== lastDraftSignature || revision !== lastRevision) {
      lastDraftSignature = draftSignature;
      lastRevision = revision;
      if (hasDraft || (exportText && exportText.value !== "")) refreshExport();
    }
    if (exportButton) exportButton.disabled = Boolean(state && state.phase === "running") || sourceBlocked || busy;
    if (state && state.phase === "running" && applyButton) applyButton.disabled = true;
  }
  function run(action, success, failure, keep) {
    setBusy(true, keep);
    return Promise.resolve()
      .then(action)
      .then(function (result) {
        if (success) announce(success);
        return result;
      }, function (error) {
        announce("Azione non riuscita: " + (error && error.message ? error.message : String(error)) + ". Nessun risultato inventato.");
        if (failure) failure(error);
        return null;
      })
      .then(function (result) {
        setBusy(false);
        render(stateNow());
        return result;
      });
  }
  function stateNow() {
    try { return controller.state(); } catch (error) { return null; }
  }
  function markPending() {
    var message = "Verifica in corso…";
    if (leftMeasure) { clear(leftMeasure); leftMeasure.appendChild(field("Rapporto", message)); }
    if (rightMeasure) { clear(rightMeasure); rightMeasure.appendChild(field("Rapporto", message)); }
  }
  function setBusy(value, keep) {
    busy = Boolean(value);
    setAttribute(host, "aria-busy", busy ? "true" : "false");
    var buttons = [submit, controlsSubmit, resetPair, resetAll, suggestForeground, suggestBackground, exportButton, copyPalette, explorationRun];
    for (var index = 0; index < buttons.length; index += 1) {
      if (buttons[index]) buttons[index].disabled = busy && buttons[index] !== keep;
    }
    if (discardButton) discardButton.disabled = busy || !suggestionPresent || typeof controller.discardSuggestion !== "function";
    if (applyButton) applyButton.disabled = busy || !suggestionVerified;
    if (explorationRun) explorationRun.disabled = busy || typeof controller.measureExploration !== "function" || typeof controller.explorationPairs !== "function";
  }
  function canTakeFocus(node) {
    if (!node || node.disabled || node.hidden || typeof node.focus !== "function") return false;
    if (typeof node.getClientRects === "function" && node.getClientRects().length === 0) return false;
    if (typeof node.closest === "function" && node.closest("details:not([open])")) return false;
    return true;
  }
  function focusSafely(node) {
    if (!canTakeFocus(node)) return false;
    try { node.focus({ preventScroll: true }); } catch (error) { return false; }
    return true;
  }
  function focusAfterAction(kind) {
    var active = doc.activeElement, body = doc.body, root = doc.documentElement;
    if (active && active !== body && active !== root && active !== host && active !== applyButton && active !== discardButton) return false;
    var order = kind === "discard" ? [suggestForeground, suggestBackground, submit] : [applyButton, suggestForeground, suggestBackground, controlsSubmit, submit];
    for (var index = 0; index < order.length; index += 1) if (focusSafely(order[index])) return true;
    return false;
  }
  function restoreFocusAfterReset(trigger) {
    var active = doc.activeElement;
    if (active && active !== doc.body && active !== doc.documentElement && active !== host && active !== trigger) return false;
    return focusSafely(trigger);
  }
  function applySelection(trigger) {
    var option = selectedOption();
    var source = sourceSelect ? sourceSelect.value : null;
    if (!option) { announce("Nessuna coppia selezionata: nessuna misura viene inventata."); setSourceBlocked("Nessuna coppia selezionata.", source); return Promise.resolve(null); }
    var theme = checkedTheme();
    var comparison = checkedComparison();
    if ((comparison === "tuning" || comparison === "draft") && !tuningAvailable()) {
      announce("Confronto non disponibile: il tuning è assente o non supportato nello snapshot.");
      setSourceBlocked("Confronto personalizzato non disponibile: il tuning è assente o non supportato.", source);
      return Promise.resolve(null);
    }
    if (!optionAvailable(option, theme)) {
      announce("Questa coppia non è disponibile nel tema " + themeName(theme) + "; nessuna misura viene inventata.");
      setSourceBlocked("Nessuna coppia disponibile in questo tema. Cambia tema per confrontarla.", source);
      return Promise.resolve(null);
    }
    var pairId = pairIdFor(option, theme);
    if (!pairId) {
      announce("La coppia non è disponibile nei descrittori del runtime; nessuna misura viene inventata.");
      setSourceBlocked("La coppia non è disponibile nel runtime: nessun campione viene mostrato.", source);
      return Promise.resolve(null);
    }
    clearSourceBlocked();
    markPending();
    return run(
      function () { return controller.select({ pairId: pairId, theme: theme, comparison: comparison }); },
      "Confronto richiesto: attendo le misure del runtime.",
      function () { setSourceBlocked("Selezione non applicata: la misura precedente è stata rimossa. Riprova.", source); },
      trigger
    );
  }
  function filterPairs(state) {
    if (!sourceSelect || !pairSelect) return;
    var chosen = sourceSelect.value;
    var list = options();
    var firstVisible = null;
    for (var index = 0; index < list.length; index += 1) {
      var sources = (attribute(list[index], "data-sources") || "").split(/\s+/).filter(Boolean);
      var visible = !chosen || !sources.length || sources.indexOf(chosen) !== -1;
      list[index].hidden = !visible;
      if (visible && !firstVisible) firstVisible = list[index];
    }
    var current = selectedOption();
    if (current && current.hidden) {
      for (var index2 = 0; index2 < list.length; index2 += 1) list[index2].selected = list[index2] === firstVisible;
    }
    if (selectionAvailable) {
      renderDetails(state);
      renderControls(state || stateNow());
    }
  }
  function readValue(input) {
    var value = input && input.value !== undefined ? String(input.value).trim() : "";
    return value;
  }
  function flushLightness() {
    var jobs = [];
    for (var index = 0; index < lightnessInputs.length; index += 1) {
      var entry = lightnessInputs[index];
      if (!entry || entry.disposed || entry.invalid || !(entry.dirty || entry.timer || entry.committing)) continue;
      if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
      jobs.push(commitLightness(entry));
    }
    return jobs;
  }
  function applyOverrides() {
    if (overridesPending) { announce("Override già in corso: attendi il risultato."); return Promise.resolve(null); }
    var pending = [];
    for (var index = 0; index < controlInputs.length; index += 1) {
      var entry = controlInputs[index];
      var raw = readValue(entry.node);
      if (entry.dirty && raw !== "") pending.push([entry, entry.kind === "mix" ? raw + "%" : raw]);
    }
    var jobs = flushLightness();
    var flushed = Promise.all(jobs);
    if (!pending.length) {
      return flushed.then(function () {
        announce(jobs.length ? "L già nella bozza, nessun altro campo CSS da applicare." : "Nessun campo testuale modificato.");
        return null;
      });
    }
    overridesPending = true;
    var settled = function () { overridesPending = false; };
    var index = 0;
    function next() {
      if (index >= pending.length) return Promise.resolve(null);
      var job = pending[index];
      index += 1;
      return Promise.resolve(controller.setOverride(job[0].control, job[1])).then(function () {
        job[0].dirty = false;
        return next();
      });
    }
    return flushed.then(function () { return run(next, "Override pubblici applicati al runtime. La palette sorgente non è stata modificata. Solo i campi modificati sono stati inviati."); }).then(settled, settled);
  }
  function setDownload(css, mode) {
    if (!download) return;
    if (typeof css === "string" && css !== "") {
      download.href = "data:text/css;charset=utf-8," + encodeURIComponent(css);
      download.download = mode === "complete" ? "colors-tuning.css" : "colors-tuning.patch.css";
      download.textContent = mode === "complete" ? "Scarica colors-tuning.css (azione manuale)" : "Scarica colors-tuning.patch.css (frammento, azione manuale)";
      download.hidden = false;
    } else {
      download.hidden = true;
      download.removeAttribute("href");
      download.removeAttribute("download");
    }
  }
  function exportFileModel() {
    if (typeof controller.exportTuningFile === "function") {
      try {
        var file = controller.exportTuningFile();
        if (isRecord(file)) {
          var css = typeof file.css === "string" ? file.css : "";
          var mode = file.mode === "complete" || file.mode === "fragment" ? file.mode : "unavailable";
          if (css === "") mode = "unavailable";
          var warnings = [];
          if (Array.isArray(file.warnings)) {
            for (var w = 0; w < file.warnings.length; w += 1) if (typeof file.warnings[w] === "string" && file.warnings[w]) warnings.push(file.warnings[w]);
          }
          var removed = [];
          if (Array.isArray(file.removed)) {
            for (var r = 0; r < file.removed.length; r += 1) if (typeof file.removed[r] === "string" && file.removed[r]) removed.push(file.removed[r]);
          }
          var unmatched = [];
          if (Array.isArray(file.unmatched)) {
            for (var u = 0; u < file.unmatched.length; u += 1) if (typeof file.unmatched[u] === "string" && file.unmatched[u]) unmatched.push(file.unmatched[u]);
          }
          return { css: css, mode: mode, warnings: warnings, removed: removed, unmatched: unmatched };
        }
      } catch (error) {
        var legacy = typeof controller.exportTuning === "function" ? controller.exportTuning() : "";
        if (typeof legacy !== "string") legacy = "";
        return { css: legacy, mode: legacy ? "fragment" : "unavailable", warnings: legacy ? ["exportTuningFile non disponibile: " + (error && error.message ? error.message : String(error)) + ". È stato usato il frammento legacy."] : [], removed: [], unmatched: [] };
      }
    }
    var css = typeof controller.exportTuning === "function" ? controller.exportTuning() : "";
    if (typeof css !== "string") css = "";
    return {
      css: css,
      mode: css ? "fragment" : "unavailable",
      warnings: css ? ["Il runtime espone solo il frammento legacy: l'esportazione non è un file completo."] : [],
      removed: [],
      unmatched: [],
    };
  }
  function refreshExport() {
    var model = exportFileModel();
    var css = model.css;
    var current = stateNow();
    var currentDraft = current && isRecord(current.draft) ? current.draft : {};
    var currentRemoved = current && Array.isArray(current.removed) ? current.removed : [];
    var hasEdits = Object.keys(currentDraft).length > 0 || currentRemoved.length > 0;
    if (exportText) exportText.value = css;
    setDownload(css, model.mode);
    var notes = [];
    if (css === "") {
      notes.push("Nessun tuning pubblico da esportare: nessun override attivo.");
    } else if (model.mode === "complete") {
      notes.push(hasEdits
        ? "CSS della bozza corrente: file completo pronto per colors-tuning.css, costruito dal tuning salvato. Controlla gli avvisi per le regole non abbinate. L'esportazione non salva nel progetto: sostituisci il file manualmente."
        : "Nessuna modifica in bozza: file completo del tuning salvato preservato, pronto per colors-tuning.css. L'esportazione non salva nel progetto: sostituisci il file manualmente.");
    } else if (model.mode === "fragment") {
      notes.push("CSS della bozza corrente come frammento: colors-tuning.patch.css, non un file completo. Unisci o applica manualmente; l'anteprima non modifica il progetto.");
    } else {
      notes.push("Nessun file esportabile: il runtime non ha restituito CSS.");
    }
    if (model.removed.length) {
      notes.push(model.mode === "complete" ? "Rimozioni incluse nel file: " + model.removed.join(", ") + "." : "Rimozioni non applicabili in questo export: " + model.removed.join(", ") + ".");
    }
    if (model.unmatched.length) notes.push("Override salvati non trovati nei token attuali: " + model.unmatched.join(", ") + ". Non vengono cancellati automaticamente.");
    for (var index = 0; index < model.warnings.length; index += 1) notes.push(model.warnings[index]);
    if (css !== "") {
      if (lastExportStamp === null) notes.push(hasEdits ? "Non hai ancora esportato questa bozza." : "Il file salvato non è stato ancora scaricato da questa anteprima.");
      else if (css !== lastExportStamp) notes.push("Modifiche non esportate rispetto all'ultima esportazione.");
      else notes.push("Nessuna modifica dopo l'ultima esportazione.");
    }
    if (exportNote) exportNote.textContent = notes.join(" ");
    if (exportMode) exportMode.textContent = model.mode === "complete" ? "File completo: colors-tuning.css." : model.mode === "fragment" ? "Frammento: colors-tuning.patch.css, non un file completo." : "Export non disponibile.";
    return model;
  }
  function exportTuning() {
    if (exportBox) exportBox.open = true;
    var model = refreshExport();
    if (exportText && typeof exportText.focus === "function") exportText.focus();
    if (model.css === "") { announce("Nessun tuning pubblico da esportare: nessun override attivo."); return; }
    lastExportStamp = model.css;
    refreshExport();
    if (model.mode === "complete") announce("File completo esportato nel campo selezionabile: scarica colors-tuning.css. Non è un salvataggio nel progetto.");
    else if (model.mode === "fragment") announce("Frammento esportato nel campo selezionabile: scarica colors-tuning.patch.css. Non sostituisce colors-tuning.css.");
    else announce("Nessun file esportabile: il runtime non ha restituito CSS.");
  }
  function copyTextarea(node, label) {
    if (!node) return;
    var value = String(node.value || "");
    if (value === "") { announce("Nessun testo da copiare: il campo è vuoto."); return; }
    node.focus();
    if (typeof node.select === "function") node.select();
    if (typeof node.setSelectionRange === "function") node.setSelectionRange(0, value.length);
    var clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (clipboard && typeof clipboard.writeText === "function") {
      clipboard.writeText(value).then(function () {
        announce(label + " copiato negli appunti.");
      }, function () {
        announce(label + " selezionato: usa Cmd/Ctrl+C. Nessun permesso clipboard richiesto.");
      });
    } else {
      announce(label + " selezionato: usa Cmd/Ctrl+C. Nessun permesso clipboard richiesto.");
    }
  }
  function listen(node, event, handler) {
    if (node && typeof node.addEventListener === "function") node.addEventListener(event, handler);
  }
  function prevent(event) { if (event && typeof event.preventDefault === "function") event.preventDefault(); }
  function resultOrThrow(result) {
    if (result && result.error) throw new Error(String(result.error));
    return result;
  }

  initializeSelection();
  if (left && right) {
    try {
      var slots = { left: left, right: right };
      if (proposalBefore) slots.proposalBefore = proposalBefore;
      if (proposalAfter) slots.proposalAfter = proposalAfter;
      controller.mount(slots);
      mounted = true;
    } catch (error) {
      announce("Il runtime non ha accettato i contenitori delle viste: " + (error && error.message ? error.message : String(error)));
    }
  }
  unsubscribe = controller.subscribe(function (next) {
    try { render(next); } catch (error) { /* presentation must never break the run */ }
  });
  listen(sourceSelect, "change", function () {
    if (sourceSelect.value === "") { clearSourceBlocked(); filterPairs(); syncPalette(); applyMatrixFilter(); return; }
    applySourceSelection(sourceSelect.value);
  });
  listen(openPicker, "click", openPickerDialog);
  listen(closePicker, "click", closePickerDialog);
  listen(pickerDialog, "close", function () {
    if (openPicker && !openPicker.disabled && typeof openPicker.focus === "function") openPicker.focus();
  });
  listen(useSearch, "input", function () {
    pickerQuery = useSearch.value || "";
    pickerPage = 0;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(useCategory, "change", function () {
    pickerCategory = useCategory.value || "";
    pickerPage = 0;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(useClear, "click", function () {
    resetPickerFilters();
    renderUses(sourceSelect ? sourceSelect.value : "");
    if (useSearch && typeof useSearch.focus === "function") useSearch.focus();
  });
  listen(usePrev, "click", function () {
    if (attribute(usePrev, "aria-disabled") === "true") return;
    pickerPage -= 1;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(useNext, "click", function () {
    if (attribute(useNext, "aria-disabled") === "true") return;
    pickerPage += 1;
    renderUses(sourceSelect ? sourceSelect.value : "");
  });
  listen(pairSelect, "change", function () { renderDetails(); renderControls(stateNow()); applySelection(); });
  listen(themeLight, "change", function () { syncDarkBlendCallout(sourceSelect ? sourceSelect.value : ""); renderCurrent(); renderDetails(); renderControls(stateNow()); resumeSelection(); });
  listen(themeDark, "change", function () { syncDarkBlendCallout(sourceSelect ? sourceSelect.value : ""); renderCurrent(); renderDetails(); renderControls(stateNow()); resumeSelection(); });
  listen(comparisonThemes, "change", resumeSelection);
  listen(comparisonTuning, "change", resumeSelection);
  listen(comparisonDraft, "change", resumeSelection);
  listen(selectionForm, "submit", function (event) {
    prevent(event);
    if (busy) { announce("Confronto già in corso: attendi le misure."); return; }
    resumeSelection(submit);
  });
  listen(controlsForm, "submit", function (event) { prevent(event); applyOverrides(); });
  listen(resetPair, "click", function () {
    var controls = controlInputs.map(function (entry) { return entry.control; });
    var index = 0;
    function next() {
      if (index >= controls.length) return Promise.resolve(null);
      var control = controls[index];
      index += 1;
      return Promise.resolve(controller.reset(control)).then(resultOrThrow).then(next);
    }
    run(next, "Bozza dei controlli della coppia scartata. Gli override salvati non sono stati modificati.", null, resetPair).then(function (result) { restoreFocusAfterReset(resetPair); return result; });
  });
  listen(resetAll, "click", function () {
    run(function () { return Promise.resolve(controller.reset()).then(resultOrThrow); }, "Bozza di tuning scartata. Gli override salvati non sono stati rimossi: usa Rimuovi personalizzazione per quelli.", null, resetAll).then(function (result) { restoreFocusAfterReset(resetAll); return result; });
  });
  listen(suggestForeground, "click", function () { run(function () { return controller.suggest("foreground"); }, "Ricerca della proposta per il primo piano richiesta."); });
  listen(suggestBackground, "click", function () { run(function () { return controller.suggest("background"); }, "Ricerca della proposta per lo sfondo richiesta."); });
  listen(applyButton, "click", function () {
    var failed = false;
    var pending = run(
      function () { return controller.applySuggestion(); },
      "Proposta applicata come override temporaneo. Esporta il CSS pubblico per conservarla.",
      function () { failed = true; }
    );
    if (pending && typeof pending.then === "function") {
      pending.then(function () {
        if (!failed) focusAfterAction("apply");
      }, function () { /* the failure path already announced its own error */ });
    }
  });
  listen(discardButton, "click", function () {
    if (!suggestionPresent) { announce("Nessuna proposta da scartare."); return; }
    if (typeof controller.discardSuggestion !== "function") { announce("Il runtime non espone lo scarto della proposta. Nessun override viene modificato."); return; }
    try {
      var discarded = controller.discardSuggestion();
      var finish = function () {
        render(stateNow());
        announce("Proposta scartata: nessun override pubblico è stato modificato.");
        focusAfterAction("discard");
      };
      var failed = function (error) {
        announce("Scarto non riuscito: " + (error && error.message ? error.message : String(error)) + ". Nessun override viene modificato.");
      };
      if (discarded && typeof discarded.then === "function") discarded.then(finish, failed);
      else finish();
    } catch (error) {
      announce("Scarto non riuscito: " + (error && error.message ? error.message : String(error)) + ". Nessun override viene modificato.");
    }
  });
  listen(exportButton, "click", exportTuning);
  listen(copyPalette, "click", function () { copyTextarea(paletteSource, "Sorgente palette"); });
  var copyExport = byId("smart-colors-workbench-copy-export");
  listen(copyExport, "click", function () {
    var model = refreshExport();
    if (model.css === "") { announce("Nessun CSS pubblico da copiare: nessun override attivo."); return; }
    lastExportStamp = model.css;
    refreshExport();
    copyTextarea(exportText, "CSS pubblico");
  });
  listen(download, "click", function () {
    if (!exportText || exportText.value === "") return;
    lastExportStamp = exportText.value;
    refreshExport();
  });
  if (copySnippet) {
    listen(copySnippet, "click", function () {
      if (!snippetCode) return;
      var textToCopy = snippetCode.textContent || "";
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(textToCopy).then(function () {
          setIfChanged(copySnippet, "Copiato! ✓");
          setTimeout(function () { setIfChanged(copySnippet, "Copia codice CSS"); }, 2000);
        }, function () {
          setIfChanged(copySnippet, "Selezionato!");
          setTimeout(function () { setIfChanged(copySnippet, "Copia codice CSS"); }, 2000);
        });
      } else {
        setIfChanged(copySnippet, "Selezionato!");
        setTimeout(function () { setIfChanged(copySnippet, "Copia codice CSS"); }, 2000);
      }
    });
  }
  listen(matrixSearch, "input", applyMatrixFilter);
  listen(matrixFilter, "change", applyMatrixFilter);
  listen(matrixCategory, "change", applyMatrixFilter);
  listen(matrixAll, "change", applyMatrixFilter);
  listen(matrixClear, "click", function () {
    matrixPage = 0;
    if (matrixSearch) matrixSearch.value = "";
    if (matrixFilter) matrixFilter.value = "";
    if (matrixCategory) matrixCategory.value = "";
    applyMatrixFilter();
    if (matrixSearch && typeof matrixSearch.focus === "function") matrixSearch.focus();
  });
  if (matrixAll) matrixAll.checked = !(sourceSelect && sourceSelect.value);
  if (matrixDisplayGrid) { matrixDisplayGrid.checked = true; matrixDisplayGrid.disabled = false; }
  if (matrixDisplayTable) { matrixDisplayTable.checked = false; matrixDisplayTable.disabled = false; }
  listen(matrixDisplayGrid, "change", applyMatrixDisplay);
  listen(matrixDisplayTable, "change", applyMatrixDisplay);
  listen(matrixPrev, "click", function () {
    if (matrixPrev.disabled) return;
    matrixPage -= 1;
    applyMatrixFilter();
    if (matrixPrev.disabled) focusSafely(matrixNext);
  });
  listen(matrixNext, "click", function () {
    if (matrixNext.disabled) return;
    matrixPage += 1;
    applyMatrixFilter();
    if (matrixNext.disabled) focusSafely(matrixPrev);
  });
  buildMatrix();
  applyMatrixDisplay();
  if (explorationRun) {
    listen(explorationRun, "click", function () {
      if (busy) return;
      if (typeof controller.measureExploration !== "function") { announce("Il runtime non espone la misura esplorativa: nessun dato inventato."); return; }
      run(function () { return controller.measureExploration(checkedTheme()); }, "Richiesta di esplorazione completata: controlla lo stato dell'esplorazione qui sotto.");
    });
  }

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", function () { if (unsubscribe) unsubscribe(); });
  }
  if (copySnippet) copySnippet.disabled = false;
  if (openPicker) openPicker.disabled = false;
  if (useSearch) useSearch.disabled = false;
  if (useCategory) useCategory.disabled = false;
  if (useClear) useClear.disabled = false;
  if (closePicker) closePicker.disabled = false;
  if (matrixSearch) matrixSearch.disabled = false;
  if (matrixFilter) matrixFilter.disabled = false;
  if (matrixCategory) matrixCategory.disabled = false;
  if (matrixClear) matrixClear.disabled = false;
  if (explorationRun) explorationRun.disabled = typeof controller.measureExploration !== "function" || typeof controller.explorationPairs !== "function";
  for (var swatchBind = 0; swatchBind < swatchButtons.length; swatchBind += 1) bindSwatch(swatchButtons[swatchBind]);
  applyMatrixFilter();
  syncDarkBlendCallout(sourceSelect ? sourceSelect.value : "");
  render(stateNow());
  return {
    render: render,
    destroy: function () {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      disposeLightnessInputs();
      setProposalFrames(false);
      controller.destroy();
      mounted = false;
    },
  };
}

/**
 * Classic-script fragment installing the serialized view factory. It carries no
 * import and no external reference, so the preview can hash exactly these bytes.
 * `globalName` is the controller global the delivered workbench runtime installs;
 * the caller resolves it from that module so the two never drift.
 */
export function createContrastWorkbenchViewSource(globalName) {
  const name = text(globalName);
  if (!name) throw new TypeError("createContrastWorkbenchViewSource requires the workbench controller global name");
  return [
    "(function () {",
    '  "use strict";',
    // This self-contained factory uses quoted strings, not multiline template literals. Removing
    // line indentation saves artifact space without stripping comments, newlines or executable code.
    "  var createContrastWorkbenchView = " + createContrastWorkbenchView.toString().replace(/^[\t ]+/gm, "") + ";",
    "  createContrastWorkbenchView({ controller: globalThis[" + JSON.stringify(name) + "], document: document });",
    "})();",
    "",
  ].join("\n");
}
