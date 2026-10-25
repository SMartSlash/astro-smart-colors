// Build-time markup for the diagnostic preview workbench.
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
//   `workbench.css`, read once at import. It reuses the preview
//   tokens and never paints an actual specimen; specimens are real CSS consumer
//   frames rendered by the browser runtime with `var(--token)`.
//
// Browser interaction lives in contrast-workbench-view.mjs; this module only
// prepares the initial HTML and loads the presentation stylesheet.
//
// Contract notes: the source palette is read-only input (roles and dark blend are
// not editable). Overrides are temporary public CSS tuning, not a rebuilt
// generator. Suggestions only come from the runtime; this module never invents a
// ratio, a pair or a colour distance.
import { readFileSync } from "node:fs";
import { createDesignerLanguage } from "../designer-language.mjs";
import { createDesignTools } from "../../colors/design-recipes.mjs";
import { colorCss, escape, list, record } from "../report/format-report-html.mjs";

const WORKBENCH_STYLESHEET = new URL("./workbench.css", import.meta.url);
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
