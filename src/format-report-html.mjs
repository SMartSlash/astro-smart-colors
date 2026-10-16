const MARKER = "<!-- smart-colors-report:v1 -->";
const FILE_KEYS = ["palette", "config", "tuning", "output"];
const STATUSES = {
  pass: "Target e minimo raggiunti",
  "below-target": "Sotto il target",
  "below-minimum": "Sotto il minimo",
};
const CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";

const CSS = `
@layer reset, tokens, base, components, pages, animations, layout, utilities, capabilities, preferences, overrides;
@layer reset {
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; }
}
@layer tokens {
  :root { color-scheme: light; --ink: #171717; --paper: #fff; --soft: #f4f4f4; --line: #767676; }
}
@layer base {
  html { font-family: system-ui, sans-serif; line-height: 1.6; color: var(--ink); background: var(--paper); }
  body { overflow-wrap: anywhere; }
  h1, h2, h3 { line-height: 1.25; }
  h1 { font-size: 2rem; margin-block-end: .5rem; }
  h2 { font-size: 1.5rem; }
  h3 { font-size: 1.125rem; }
  h4 { font-size: 1rem; margin-block: 1rem .5rem; }
  p { max-width: 80ch; }
  a { color: inherit; text-underline-offset: .2em; }
  :focus-visible { outline: 3px solid var(--ink); outline-offset: 4px; }
  code, pre { font-family: ui-monospace, monospace; user-select: text; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; padding: 1rem; background: var(--soft); border: 1px solid var(--line); }
  summary { cursor: pointer; padding: .75rem; min-height: 44px; font-weight: 650; }
  details { border: 1px solid var(--line); margin-block: 1rem; }
  details > :not(summary) { margin-inline: 1rem; }
  table { border-collapse: collapse; width: 100%; min-width: 48rem; }
  caption { text-align: start; font-weight: 650; padding-block: .75rem; }
  th, td { border: 1px solid var(--line); padding: .65rem; text-align: start; vertical-align: top; }
  th { background: var(--soft); }
  figure { margin: 0; }
  figcaption { padding-block: .5rem; }
  dt { font-weight: 650; }
  dd { margin: 0 0 .75rem; }
}
@layer components {
  .notice, .card { border: 1px solid var(--line); padding: 1.25rem; background: var(--paper); color: var(--ink); }
  .notice { border-inline-start-width: .35rem; }
  .recommendation { border: 2px solid var(--ink); }
  .status { font-weight: 750; }
  .overview { font-size: 1.25rem; }
  .eyebrow { font-size: .875rem; font-weight: 750; letter-spacing: .04em; text-transform: uppercase; }
  .badge { display: inline-block; padding: .2rem .6rem; background: var(--ink); color: var(--paper); font-weight: 750; }
  .table-scroll { overflow-x: auto; max-width: 100%; }
  .swatch { height: 4rem; border: 1px solid var(--line); background: var(--sample-color, var(--soft)); }
  .color-choice { padding: .75rem; border: 1px solid var(--line); }
  .color-choice--suggested { border: 3px solid var(--ink); }
  .color-choice .swatch { height: 7rem; }
  .color-choice figcaption strong { display: block; margin-block-end: .4rem; }
  .color-choice--suggested figcaption strong { font-size: 1.125rem; }
  .contrast-value { display: block; margin-block: .35rem; font-size: 1.5rem; font-weight: 750; font-variant-numeric: tabular-nums; }
  .problem-card h3 { margin-block-end: .5rem; }
  .snippet-label { font-weight: 750; }
  .destination dt, .destination dd { display: inline; }
  .destination dd { margin-inline-start: .5rem; }
  .destination div + div { margin-block-start: .5rem; }
  .pair-visual { display: grid; gap: .35rem; min-height: 6rem; padding: 1.25rem; background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); border: 1px solid var(--line); }
  .pair-title { font-size: 1.2rem; font-weight: 700; line-height: 1.25; }
  .pair-text { font-size: 1rem; font-weight: 400; }
  .pair-label { font-size: .8125rem; }
  .pair-border { display: block; width: 4rem; height: 1.25rem; border: 1px solid var(--sample-fg, var(--ink)); }
  .pair-border--2 { border-width: 2px; }
  .pair-border--3 { border-width: 3px; }
  .skip { display: inline-block; padding: .5rem; }
  .usage-card { padding: 1rem; }
  .usage-card h3 { margin-block-end: .75rem; }
  .usage-state { display: block; padding: .35rem .5rem; border: 1px solid var(--line); }
  .usage-state--attention { border-inline-start: .3rem solid var(--ink); font-weight: 650; }
  .usage-state--avoid { background: var(--ink); color: var(--paper); font-weight: 750; }
  .usage-count { font-size: .875rem; }
  .overlap-card .pair-visual { min-height: 4rem; }
  .overlap-card .contrast-value { font-size: 1.25rem; }
  .overlap-card h5 { font-size: .9375rem; margin-block: .9rem .35rem; }
  .family-card { padding: 1rem; }
  .family-card h4 { margin-block: 0 .5rem; }
  .family-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: .75rem; }
  .family-sample { border: 1px solid var(--line); background: var(--paper); }
  .family-visual { display: grid; gap: .35rem; padding: .9rem; background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); border: 1px solid var(--sample-border, var(--line)); }
  .family-visual .pair-border { width: 4rem; height: 1.25rem; }
  .family-sample ul { margin: 0; padding: .6rem .75rem .6rem 1.4rem; font-size: .875rem; }
  .family-sample li + li { margin-block-start: .3rem; }
  .family-title { margin: 0; padding: .6rem .75rem 0; font-weight: 700; font-size: .9375rem; }
  .family-sample .contrast-value { display: inline; margin: 0; font-size: 1rem; }
  .pair-list { padding-inline-start: 1.4rem; }
  .pair-list li { margin-block: .35rem; }
  .pair-list .contrast-value { display: inline; margin: 0; font-size: 1rem; }
  .pair-chip { display: inline-block; margin-inline-end: .35rem; padding: 0 .4rem; border: 1px solid var(--line); background: var(--sample-bg, var(--soft)); color: var(--sample-fg, var(--ink)); }
  .baseline-note { border-inline-start: .3rem solid var(--line); padding-inline-start: .6rem; }
  .margin-note { font-size: .875rem; }
  .side-effect { margin-block-start: .75rem; padding: .75rem; border: 1px dashed var(--line); }
  .side-effect ul { padding-inline-start: 1.2rem; }
  .side-effect .contrast-value { display: inline; margin: 0; font-size: 1rem; }
  .overlap-matrix { margin-block: .75rem; }
  .overlap-matrix table { min-width: 0; }
  .overlap-matrix th, .overlap-matrix td { padding: .3rem .4rem; font-size: .8125rem; }
  .matrix-badge { display: inline-block; padding: 0 .3rem; border: 1px solid var(--line); font-weight: 700; }
  .matrix-badge--aa { background: var(--ink); color: var(--paper); }
  .matrix-badge--no { border-style: dashed; }
  .matrix-ratio { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .variant-swatch { display: inline-block; width: 1.2rem; height: 1.2rem; vertical-align: -.25rem; margin-inline-end: .4rem; border: 1px solid var(--line); background: var(--sample-color, var(--soft)); }
  .variant-list li { margin-block: .4rem; }
}
@layer layout {
  .shell { max-width: 72rem; margin-inline: auto; padding: 1rem; }
  main > section, footer { margin-block: 2rem; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; }
  .comparison { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: 1rem; }
  .family-card + .family-card, .overlap-card + .overlap-card { margin-block-start: 0; }
  .usage-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 1rem; }
  .usage-grid > article + article { margin-block-start: 0; }
  .grid > *, .comparison > *, .card { min-width: 0; }
  .card > :first-child { margin-block-start: 0; }
  .color-change + .color-change { margin-block-start: 1.5rem; }
  nav ul { display: flex; flex-wrap: wrap; gap: .75rem 1.5rem; padding-inline-start: 1.25rem; }
  article + article { margin-block-start: 1.5rem; }
  .grid > article + article { margin-block-start: 0; }
}
@layer preferences {
  @media (forced-colors: active) {
    :root { --ink: CanvasText; --paper: Canvas; --soft: Canvas; --line: CanvasText; }
  }
}
`;

const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const list = (value) => Array.isArray(value) ? value : [];
const text = (value) => typeof value === "string" && value.trim().length > 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const ratioValid = (value) => finite(value) && value >= 1 && value <= 21;
const schemeValid = (value) => value === "light" || value === "dark";
// Non-lossy turn: adding 360 to a positive hue loses low mantissa bits (86.83 → 86.82999999999998).
const hue = (value) => { const remainder = value % 360; return remainder < 0 ? remainder + 360 : (remainder === 0 ? 0 : remainder); };

function printable(value) {
  if (value === undefined || value === null) return "Non disponibile";
  if (typeof value !== "object") return String(value);
  try { return JSON.stringify(value, null, 2) ?? "Dato non valido"; }
  catch { return "Dato non serializzabile"; }
}

function escape(value) {
  return printable(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function colorValid(color) {
  return record(color) && finite(color.l) && color.l >= 0 && color.l <= 1
    && finite(color.c) && color.c >= 0 && finite(color.h);
}

// Only validated primitive numbers may enter CSS; names, paths and snippets never do.
function colorCss(color) {
  return colorValid(color) ? `oklch(${color.l} ${color.c} ${color.h})` : null;
}

function colorCode(color) {
  const css = colorCss(color);
  return `<code>${escape(css ?? `OKLCH non valido: ${printable(color)}`)}</code>`;
}

function provenanceValid(value) {
  return text(value) || (record(value) && Object.keys(value).length > 0);
}

function expectedStatus(item) {
  return item.ratio < item.minimum ? "below-minimum" : item.ratio < item.target ? "below-target" : "pass";
}

function diagnosticValid(item) {
  return record(item) && text(item.label) && schemeValid(item.scheme)
    && text(item.foregroundToken) && text(item.backgroundToken)
    && colorValid(item.foreground) && colorValid(item.background)
    && ratioValid(item.ratio) && ratioValid(item.minimum) && ratioValid(item.target)
    && ["text", "non-text"].includes(item.kind) && item.status === expectedStatus(item)
    && (item.baselineRatio === undefined || ratioValid(item.baselineRatio));
}

function status(item, valid = diagnosticValid(item)) {
  return valid ? STATUSES[item.status] : "Non verificato: dati mancanti, non validi o incoerenti";
}

function ratio(value) {
  return ratioValid(value) ? `<code>${String(value)}:1</code>` : `${escape(value)} (non valido)`;
}

function table(caption, headings, rows) {
  return `<div class="table-scroll" tabindex="0" role="region" aria-label="${escape(caption)}"><table>
<caption>${escape(caption)}</caption><thead><tr>${headings.map((heading) => `<th scope="col">${escape(heading)}</th>`).join("")}</tr></thead>
<tbody>${rows.join("")}</tbody></table></div>`;
}

function diagnosticTable(caption, entries) {
  return table(caption, ["Coppia", "Scenario (browser / schema / preferenza)", "Uso", "Primo piano → sfondo", "Rapporto completo", "Minimo", "Target", "Baseline", "Esito", "Provenienza"], entries.map(({ item, scenario, valid }) => {
    const kind = item.kind === "text" ? "Testo" : item.kind === "non-text" ? "Non testuale (bordo)" : "Uso non valido";
    return `<tr><th scope="row">${escape(item.label)}</th><td>${escape(item.browser ?? scenario.browser)} / ${escape(item.scheme)} / ${escape(item.preference ?? scenario.preference)}</td><td>${kind}</td><td><code>${escape(item.foregroundToken)}</code> → <code>${escape(item.backgroundToken)}</code></td>
<td>${ratio(item.ratio)}</td><td>${ratio(item.minimum)}</td><td>${ratio(item.target)}</td><td>${item.baselineRatio === undefined ? "Non fornita" : ratio(item.baselineRatio)}</td>
<td>${status(item, valid ?? diagnosticValid(item))}</td><td>Scenario: ${escape(scenario.provenance)}<br>Diagnostica: ${escape(item.provenance)}</td></tr>`;
  }));
}

function colorSwatch(color, label) {
  const css = colorCss(color);
  return `<figure>${css ? `<div class="swatch" aria-hidden="true" style="--sample-color:${css}"></div>` : "<p>Campione non disponibile: colore non valido.</p>"}
<figcaption><strong>${escape(label)}</strong> — ${colorCode(color)}. Campione cromatico, non indicazione di leggibilità.</figcaption></figure>`;
}

function colorChoice(color, label, suggested = false) {
  const css = colorCss(color);
  return `<figure class="color-choice${suggested ? " color-choice--suggested" : ""}">${css ? `<div class="swatch" aria-hidden="true" style="--sample-color:${css}"></div>` : "<p>Campione non disponibile: colore non valido.</p>"}
<figcaption><strong>${escape(label)}</strong> ${colorCode(color)}</figcaption></figure>`;
}

// Compact human reading of a metric. Full precision stays in the technical disclosures.
function it(value, digits = 2) {
  if (!finite(value)) return "non disponibile";
  const rounded = Number(Math.abs(value).toFixed(digits));
  return `${value < 0 ? "-" : ""}${String(rounded).replace(".", ",")}`;
}

// Real-scale sample: a title (3:1), body text (4.5:1) and a small label, or borders at 1, 2 and 3 px.
function sampleVisual(item) {
  return item.kind === "non-text"
    ? '<span class="pair-border"></span><span class="pair-border pair-border--2"></span><span class="pair-border pair-border--3"></span>'
    : '<span class="pair-title">Titolo grande</span><span class="pair-text">Corpo del testo di esempio</span><span class="pair-label">Etichetta piccola</span>';
}

function sampleScaleNote(item) {
  return item.kind === "non-text"
    ? " Scala reale: bordi a 1, 2 e 3 px."
    : " Scala reale: titolo, corpo, etichetta.";
}

function marginText(item) {
  if (!diagnosticValid(item)) return "verifica non disponibile";
  if (item.status === "below-minimum") return `sotto il minimo di ${it(item.minimum - item.ratio)}`;
  if (item.status === "below-target") return `mancano ${it(item.target - item.ratio)} al target`;
  return `oltre il target di ${it(item.ratio - item.target)}`;
}

function pairSample(item, label, valid = diagnosticValid(item)) {
  const fg = colorCss(item.foreground);
  const bg = colorCss(item.background);
  const usable = fg && bg && ["text", "non-text"].includes(item.kind);
  return `<figure>${usable ? `<div class="pair-visual" aria-hidden="true" style="--sample-fg:${fg};--sample-bg:${bg}">${sampleVisual(item)}</div>` : "<p>Campione non disponibile: coppia non valida.</p>"}
<figcaption><strong>${escape(label)}</strong>. Campione intenzionale ${item.kind === "non-text" ? "di bordo sullo sfondo" : "di testo sullo sfondo"}: può risultare illeggibile; i dati sono sulla UI neutra.${sampleScaleNote(item)}</figcaption></figure>
<dl><dt>Primo piano (foreground)</dt><dd><code>${escape(item.foregroundToken)}</code>: ${colorCode(item.foreground)}</dd>
<dt>Sfondo (background)</dt><dd><code>${escape(item.backgroundToken)}</code>: ${colorCode(item.background)}</dd>
<dt>Rapporto / minimo / target</dt><dd>${ratio(item.ratio)} / ${ratio(item.minimum)} / ${ratio(item.target)} — ${status(item, valid)}</dd></dl>`;
}

function deltaValues(before, after) {
  const radians = (color) => hue(color.h) * Math.PI / 180;
  return [
    after.l - before.l,
    after.c - before.c,
    ((hue(after.h) - hue(before.h) + 540) % 360) - 180,
    Math.hypot(after.l - before.l,
      after.c * Math.cos(radians(after)) - before.c * Math.cos(radians(before)),
      after.c * Math.sin(radians(after)) - before.c * Math.sin(radians(before))),
  ];
}

function deltas(before, after) {
  if (!colorValid(before) || !colorValid(after)) return "ΔL, ΔC, ΔH e ΔEOK non disponibili: colori non validi.";
  const values = deltaValues(before, after);
  const show = (value) => finite(value) ? String(Number(value.toPrecision(8))) : "non disponibile";
  return `ΔL ${show(values[0])}; ΔC ${show(values[1])}; ΔH ${show(values[2])}° (arco più breve); ΔEOK ${show(values[3])} (distanza euclidea OKLab, scala 0–1, non ×100).`;
}

function deltaSummary(before, after) {
  if (!colorValid(before) || !colorValid(after)) return "";
  const [dl, dc, dh, distance] = deltaValues(before, after);
  return `ΔL ${it(dl, 4)} · ΔC ${it(dc, 4)} · ΔH ${it(dh, 3)}° · ΔEOK ${it(distance, 4)}`;
}

// Measured without the project tuning layer. The wording never blames tuning for a pre-existing shortfall.
function baselineNote(item, group) {
  const measured = group.filter((entry) => ratioValid(entry.item.baselineRatio));
  if (!measured.length || !ratioValid(item.baselineRatio)) return "";
  const delta = item.ratio - item.baselineRatio;
  if (Math.abs(delta) <= 1e-9) return "";
  const thresholds = [item.minimum, item.target];
  const opening = item.baselineRatio >= Math.max(item.minimum, item.target)
    ? `Senza i tuning di progetto questa coppia rispettava le soglie (${compactRatio(item.baselineRatio, thresholds)});`
    : `Anche senza i tuning di progetto questa coppia non raggiungeva le soglie (${compactRatio(item.baselineRatio, thresholds)});`;
  return `<p class="baseline-note">${opening} con i tuning attivi misura ${compactRatio(item.ratio, thresholds)} (${delta < 0 ? "-" : "+"}${it(Math.abs(delta))}).</p>`;
}

function paletteHtml(palette) {
  if (!palette.length) return "<p>Palette originale non disponibile.</p>";
  return `<div class="grid">${palette.map((value) => {
    const item = record(value) ? value : {};
    const valid = text(item.name) && text(item.role) && colorValid(item.authored) && colorValid(item.resolved);
    const same = valid && item.authored.l === item.resolved.l && item.authored.c === item.resolved.c && hue(item.authored.h) === hue(item.resolved.h);
    return `<article class="card"><h3>${escape(item.name)}</h3><p>Ruolo: <code>${escape(item.role)}</code></p>
<div class="grid">${colorSwatch(item.authored, "Fonte originale")}${colorSwatch(item.resolved, "Colore risolto")}</div>
<p>${!valid ? "Confronto gamut non verificato: dati non validi." : same ? "Nessuna differenza fonte/risolto." : "Differenza fonte/risolto presente (eventuale adattamento gamut)."}</p>
<p>${deltas(item.authored, item.resolved)}</p>${item.darkBlend === undefined ? "" : `<p>Miscela dark dichiarata: <code>${escape(item.darkBlend)}</code></p>`}</article>`;
  }).join("")}</div>`;
}

function scenarioValid(scenario) {
  return record(scenario) && text(scenario.browser) && schemeValid(scenario.scheme)
    && text(scenario.preference) && provenanceValid(scenario.provenance) && Array.isArray(scenario.diagnostics);
}

function entriesFor(scenarios) {
  return scenarios.flatMap((value, scenarioIndex) => {
    const scenario = record(value) ? value : {};
    return list(scenario.diagnostics).map((value, index) => {
      const item = record(value) ? value : {};
      return { item, scenario, scenarioIndex, key: `${scenarioIndex}-${index}`,
        valid: scenarioValid(scenario) && item.scheme === scenario.scheme && diagnosticValid(item) };
    });
  });
}

function samePair(before, after) {
  return before.item.label === after.label && before.item.scheme === after.scheme
    && before.item.kind === after.kind && before.item.foregroundToken === after.foregroundToken
    && before.item.backgroundToken === after.backgroundToken
    && (after.browser === undefined || before.scenario.browser === after.browser)
    && (after.preference === undefined || before.scenario.preference === after.preference);
}

function proposalView(proposal, index, entries) {
  const labels = list(proposal.issueLabels);
  const checks = list(proposal.checks).map((value) => {
    const item = record(value) ? value : {};
    const matches = entries.filter((before) => before.valid && samePair(before, item));
    return { item, before: matches.length === 1 && diagnosticValid(item) ? matches[0] : null };
  });
  const expected = entries.filter((entry) => entry.valid && entry.item.status !== "pass" && labels.includes(entry.item.label));
  const paired = checks.filter((check) => check.before);
  const covered = new Set(paired.filter(({ item, before }) => item.status === "pass"
      && item.ratio >= Math.max(before.item.minimum, before.item.target)
      && labels.includes(before.item.label)).map(({ before }) => before.key));
    const rank = { pass: 0, "below-target": 1, "below-minimum": 2 };
  const changes = list(proposal.changes);
  const complete = checks.length > 0 && paired.length === checks.length
    && new Set(paired.map(({ before }) => before.key)).size === paired.length
    && paired.every(({ item, before }) => rank[expectedStatus({ ...item, minimum: before.item.minimum, target: before.item.target })] <= rank[before.item.status])
    && labels.length > 0 && labels.every((label) => text(label) && expected.some(({ item }) => item.label === label))
    && expected.every(({ key }) => covered.has(key))
    && changes.length > 0 && changes.every((change) => record(change) && text(change.label) && colorValid(change.before) && colorValid(change.after))
    && text(proposal.id) && text(proposal.title) && text(proposal.kind) && text(proposal.impact) && text(proposal.search)
    && record(proposal.destination) && text(proposal.destination.file) && text(proposal.destination.path) && text(proposal.destination.snippet);
  return { proposal, id: `proposal-${index + 1}`, checks, expected, paired, covered: complete ? covered : new Set(), complete };
}

// Group only the presentation: every original measurement remains in the audit.
// Different themes, uses, thresholds or outcomes must never share a problem card.
function issueGroups(entries) {
  const groups = new Map();
  for (const entry of entries.filter(({ valid, item }) => valid && item.status !== "pass")) {
    const item = entry.item;
    const key = JSON.stringify([item.label, item.scheme, item.kind, item.foregroundToken, item.backgroundToken, item.minimum, item.target, item.status]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.values()];
}

function compactRatio(value, thresholds = []) {
  if (!ratioValid(value)) return ratio(value);
  const rounded = Number(value.toFixed(2));
  // A compact value must not visually promote a shortfall onto its threshold.
  const crossed = thresholds.filter((threshold) => ratioValid(threshold) && value < threshold && rounded >= threshold);
  if (crossed.length) return `&lt; ${String(Math.min(...crossed)).replace(".", ",")}:1`;
  return `${rounded === value ? "" : "≈ "}${rounded.toFixed(2).replace(".", ",")}:1`;
}

function compactPair(item, label, thresholds = [item.minimum, item.target]) {
  const fg = colorCss(item.foreground), bg = colorCss(item.background);
  return `<figure><div class="pair-visual" aria-hidden="true" style="--sample-fg:${fg};--sample-bg:${bg}">${sampleVisual(item)}</div>
<figcaption><strong>${escape(label)}</strong><span class="contrast-value">${compactRatio(item.ratio, thresholds)}</span>${status(item)}</figcaption></figure>`;
}

function usageCategory(item) {
  if (item.kind === "non-text") return "boundaries";
  if (item.kind !== "text") return "other";
  if (["--color-bg", "--color-surface"].includes(item.backgroundToken)) return "neutral";
  if (/^--color-on-/.test(item.foregroundToken) || /-on-solid$/.test(item.foregroundToken)) return "fills";
  return "surfaces";
}

function usageHtml(entries, scenarios, verified) {
  const categories = [
    ["neutral", "Testi su pagina e card", "Usa le varianti per il testo sugli sfondi indicati, non il colore base solo perché sembra leggibile."],
    ["fills", "Testi su colori pieni", "Abbina il riempimento al suo on-solid o on-color previsto: il bianco non è sempre la scelta giusta."],
    ["surfaces", "Callout e controlli", "Mantieni le coppie testo/superficie della stessa famiglia e controlla anche gli stati attivi e di focus."],
    ["boundaries", "Bordi e focus", "Controllati bordi opachi e focus. Un separatore decorativo non basta come unico segnale di un controllo."],
  ];
  const rank = { pass: 0, "below-target": 1, "below-minimum": 2 };
  return `<div class="usage-grid">${categories.map(([category, title, advice]) => `<article class="card usage-card"><h3>${title}</h3>
${["light", "dark"].map((scheme) => {
    const facts = entries.filter(({ item, scenario }) => scenario.scheme === scheme && usageCategory(item) === category);
    const expected = scenarios.filter((scenario) => record(scenario) && scenario.scheme === scheme);
    const complete = verified && facts.length > 0 && facts.every(({ valid }) => valid)
      && expected.every((scenario) => facts.some((entry) => entry.scenario === scenario));
    const pairs = new Map();
    for (const { item } of facts.filter(({ valid }) => valid)) {
      const key = JSON.stringify([item.foregroundToken, item.backgroundToken, item.kind, item.minimum, item.target]);
      if (!pairs.has(key) || rank[item.status] > rank[pairs.get(key)]) pairs.set(key, item.status);
    }
    const counts = [...pairs.values()];
    const avoid = counts.filter((status) => status === "below-minimum").length;
    const attention = counts.filter((status) => status === "below-target").length;
    const state = !complete ? "unknown" : avoid ? "avoid" : attention ? "attention" : "pass";
    const label = !complete ? "Non verificato" : avoid ? `Da evitare: ${avoid}` : attention ? `Da migliorare: ${attention}` : "OK nelle coppie controllate";
    return `<p><strong>${scheme === "light" ? "Chiaro" : "Scuro"}</strong><span class="usage-state usage-state--${state}">${label}</span>${complete ? `<span class="usage-count">${pairs.size} abbinamenti · ${avoid} sotto minimo · ${attention} sotto target</span>` : ""}</p>`;
  }).join("")}
<p>${advice}</p></article>`).join("")}</div>`;
}

function overlapView(overlaps, scenarios, verified) {
  const sources = list(overlaps);
  const entries = entriesFor(sources);
  const identity = (scenario) => JSON.stringify([scenario.browser, scenario.scheme, scenario.preference]);
  const pair = (item) => JSON.stringify([item.foregroundToken, item.backgroundToken].sort());
  const expected = scenarios.filter(record).map(identity);
  const identities = sources.filter(record).map(identity);
  const firstPairs = entries.filter(({ scenarioIndex }) => scenarioIndex === 0).map(({ item }) => pair(item));
  const complete = verified && expected.length > 0 && sources.length === expected.length
    && new Set(expected).size === expected.length && new Set(identities).size === expected.length
    && identities.every((key) => expected.includes(key)) && firstPairs.length > 0 && new Set(firstPairs).size === firstPairs.length
    && entries.length > 0 && entries.every(({ item, scenario, valid }) => valid
      && scenario.provenance === "browser-resolved-overlap" && item.provenance === scenario.provenance
      && item.browser === scenario.browser && item.preference === scenario.preference
      && item.kind === "text" && item.minimum === 4.5 && item.target === 4.5 && item.foregroundToken !== item.backgroundToken)
    && sources.every((_, index) => {
      const keys = entries.filter(({ scenarioIndex }) => scenarioIndex === index).map(({ item }) => pair(item));
      return keys.length === firstPairs.length && new Set(keys).size === keys.length && keys.every((key) => firstPairs.includes(key));
    });
  const groups = new Map();
  if (complete) for (const entry of entries) {
    const key = JSON.stringify([entry.item.scheme, pair(entry.item)]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return { complete, sources, entries, groups: [...groups.values()] };
}

function overlapList(items, thresholds) {
  if (!items.length) return "<p>Nessuno.</p>";
  return `<ul class="pair-list">${items.map(({ item }) => {
    const foreground = colorCss(item.foreground), background = colorCss(item.background);
    if (!foreground || !background) return "";
    return `<li><span class="pair-chip" aria-hidden="true" style="--sample-fg:${foreground};--sample-bg:${background}">Aa</span> <code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code> <span class="contrast-value">${compactRatio(item.ratio, thresholds)}</span></li>`;
  }).join("")}</ul>`;
}

function overlapsHtml(view) {
  if (!view.complete) return '<p class="usage-state">Sovrapposizioni libere non verificate: nessuna conclusione sui colori non misurati.</p>';
  const neutrals = ["--color-bg", "--color-surface"];
  const baseColors = [...new Set(view.entries.flatMap(({ item }) => [item.foregroundToken, item.backgroundToken])
    .filter((token) => !neutrals.includes(token)))].sort();
  const measured = new Map();
  for (const { item } of view.entries) {
    const key = `${item.scheme}|${[item.foregroundToken, item.backgroundToken].sort().join("|")}`;
    const current = measured.get(key);
    if (!current || item.ratio < current.ratio) measured.set(key, item);
  }
  const lookup = (scheme, first, second) => measured.get(`${scheme}|${[first, second].sort().join("|")}`);
  const cell = (scheme, foreground, background) => {
    if (foreground === background) return "<td>—</td>";
    const item = lookup(scheme, foreground, background);
    if (!item) return "<td>Non misurato</td>";
    const tier = item.ratio >= 4.5 ? "aa" : item.ratio >= 3 ? "ui" : "no";
    const label = tier === "aa" ? "AA" : tier === "ui" ? "3:1" : "no";
    return `<td><span class="matrix-badge matrix-badge--${tier}">${label}</span> <span class="matrix-ratio">${compactRatio(item.ratio, [4.5, 3])}</span></td>`;
  };
  // Symmetric crossings only: a cell never invents a measurement that the snapshot does not contain.
  // A theme without measurements gets no matrix at all instead of a grid of empty cells.
  const themes = ["light", "dark"].filter((scheme) => view.entries.some(({ item }) => item.scheme === scheme));
  const matrix = (scheme) => {
    const columns = [...neutrals, ...baseColors];
    return `<div class="overlap-matrix">${table(`Matrice sovrapposizioni — tema ${scheme === "light" ? "chiaro" : "scuro"}`, ["Primo piano ↓ / sfondo →", ...columns.map((token) => token.replace("--color-", ""))], baseColors.map((foreground) => `<tr><th scope="row"><code>${escape(foreground)}</code></th>${columns.map((background) => cell(scheme, foreground, background)).join("")}</tr>`))}</div>`;
  };
  return `<p>Simulazioni sui colori opachi risolti dal browser, <strong>non problemi già presenti nei componenti</strong>. Il confronto include colori base su pagina/card e colori base tra loro; non include trasparenze o immagini.</p>
<div class="grid">${["light", "dark"].map((scheme) => {
    const groups = view.groups.filter((group) => group[0].item.scheme === scheme);
    if (!groups.length) return `<p>${scheme === "light" ? "Chiaro" : "Scuro"}: non verificato.</p>`;
    const ranked = groups.map((group) => group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst))
      .sort((a, b) => b.item.ratio - a.item.ratio);
    const textSafe = ranked.filter(({ item }) => item.ratio >= 4.5);
    const largeOnly = ranked.filter(({ item }) => item.ratio >= 3 && item.ratio < 4.5);
    const avoid = ranked.filter(({ item }) => item.ratio < 3);
    const worst = ranked[ranked.length - 1];
    return `<article class="card overlap-card"><h4>Tema ${scheme === "light" ? "chiaro" : "scuro"}</h4>
<p><strong>${textSafe.length}</strong> abbinamenti utilizzabili per testo normale · <strong>${largeOnly.length}</strong> solo per titoli grandi, bordi o icone · <strong>${avoid.length}</strong> da evitare.</p>
<h5>Usabili per testo normale (almeno 4,5:1)</h5>
${overlapList(textSafe, [4.5])}
<h5>Solo per titoli grandi, bordi e icone (almeno 3:1)</h5>
${overlapList(largeOnly, [3])}
<p>Esempio da evitare per il testo: <code>${escape(worst.item.foregroundToken)}</code> su <code>${escape(worst.item.backgroundToken)}</code>.</p>
${compactPair(worst.item, "Esempio da valutare, non un uso consigliato", [3, 4.5])}
<p class="margin-note">Non usare il solo colore per distinguere stati o significati. Le soglie restano distinte: 4,5:1 per il testo normale, 3:1 per titoli grandi, bordi e icone essenziali.</p></article>`;
  }).join("")}</div>
<p><strong>Scelta pratica:</strong> per sovrapporre testo, preferisci le coppie semantiche controllate qui sopra. Cambiare sfondo, opacità o stato richiede una nuova verifica della coppia.</p>
<details><summary>Tutte le sovrapposizioni esplorative — ${view.groups.length} abbinamenti nei temi controllati</summary>
<p>Il rapporto tra due colori opachi è uguale invertendo primo piano e sfondo. Ogni coppia di colori base compare una sola volta per scenario. Le simulazioni non modificano l’esito dell’audit né le proposte di correzione.</p>
${baseColors.length && themes.length ? `<p class="margin-note">Righe: colore in primo piano. Colonne: sfondo. <span class="matrix-badge matrix-badge--aa">AA</span> usabile per testo normale (almeno 4,5:1); <span class="matrix-badge">3:1</span> solo titoli grandi, bordi e icone (almeno 3:1); <span class="matrix-badge matrix-badge--no">no</span> da evitare.</p>${themes.map(matrix).join("")}` : ""}
${view.sources.map((scenario, index) => `<h4>${escape(scenario.browser)} · ${escape(scenario.scheme)} · ${escape(scenario.preference)}</h4>${diagnosticTable("Sovrapposizioni esplorative nello scenario", view.entries.filter(({ scenarioIndex }) => scenarioIndex === index))}`).join("")}</details>`;
}

// Visual catalog of the generated families: only pairs that were actually measured,
// each shown with its worst measurement across browser/preference scenarios.
function familyAtlas(entries, verified) {
  const valid = entries.filter(({ valid }) => valid);
  const names = [...new Set([
    ...valid.map(({ item }) => /^--color-(.+)-text$/.exec(item.foregroundToken)?.[1]),
    ...valid.map(({ item }) => /^--color-on-(.+)$/.exec(item.foregroundToken)?.[1]),
  ].filter(Boolean))];
  if (!names.length) return "";
  const worst = new Map();
  for (const { item } of valid) {
    const key = `${item.scheme}|${item.kind}|${item.foregroundToken}|${item.backgroundToken}`;
    const current = worst.get(key);
    if (!current || item.ratio < current.ratio) worst.set(key, item);
  }
  const find = (scheme, kind, foreground, background) => worst.get(`${scheme}|${kind}|${foreground}|${background}`);
  const meta = (item) => item && diagnosticValid(item)
    ? `<li><code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code>: <span class="contrast-value">${compactRatio(item.ratio, [item.minimum, item.target])}</span> ${escape(status(item))} (${escape(marginText(item))})</li>` : "";
  const sample = (title, item, extra = [], border = null) => {
    const foreground = item ? colorCss(item.foreground) : null;
    const background = item ? colorCss(item.background) : null;
    if (!foreground || !background) return "";
    const borderColor = border ? colorCss(border.foreground) : null;
    return `<div class="family-sample">
<div class="family-visual" aria-hidden="true" style="--sample-fg:${foreground};--sample-bg:${background}${borderColor ? `;--sample-border:${borderColor}` : ""}"><span class="pair-text">Aa · Testo di esempio</span></div>
<p class="family-title">${escape(title)}</p>
<ul>${meta(item)}${extra.map(meta).join("")}</ul>
</div>`;
  };
  const theme = (scheme, name) => {
    const card = find(scheme, "text", `--color-${name}-text`, `--color-${name}-surface`);
    const border = find(scheme, "non-text", `--color-${name}-border-strong`, `--color-${name}-surface`);
    const button = find(scheme, "text", `--color-${name}-on-solid`, `--color-${name}-solid`);
    const hover = find(scheme, "text", `--color-${name}-on-solid`, `--color-${name}-solid-hover`);
    const direct = find(scheme, "text", `--color-on-${name}`, `--color-${name}`);
    return [
      card ? sample("Testo su callout", card, border ? [border] : [], border) : "",
      button ? sample("Bottone", button, hover ? [hover] : []) : "",
      direct ? sample("Chip o badge", direct) : "",
    ].join("");
  };
  const cards = names.map((name) => {
    const light = theme("light", name), dark = theme("dark", name);
    if (!light && !dark) return "";
    return `<article class="card family-card"><h4>Famiglia <code>--color-${escape(name)}</code></h4>
${light ? `<p class="eyebrow">Tema chiaro</p><div class="family-list">${light}</div>` : ""}
${dark ? `<p class="eyebrow">Tema scuro</p><div class="family-list">${dark}</div>` : ""}</article>`;
  }).join("");
  if (!cards) return "";
  return `<div class="grid">${cards}</div>
<p class="margin-note">Solo coppie misurate negli scenari${verified ? "" : "; verifica incompleta: il quadro può essere parziale"}. Per ogni abbinamento è mostrato il caso peggiore fra browser e preferenze; i rapporti esatti restano nei dettagli tecnici.</p>`;
}

// A functional variant normally shifts away from its brand source; only large shifts are reported,
// using the same ΔL threshold the generator historically used before that check was removed.
const VARIANT_SHIFT_THRESHOLD = 0.04;

function variantShiftView(entries, palette, roles) {
  const identities = list(roles?.identities).filter((item) => record(item) && text(item.name) && text(item.paletteName));
  if (!identities.length) return null;
  const sources = new Map(list(palette).filter((item) => record(item) && text(item.name) && colorValid(item.resolved)).map((item) => [item.name, item.resolved]));
  const worst = new Map();
  for (const { valid, item } of entries) {
    if (!valid || !colorValid(item.foreground)) continue;
    const identity = identities.find((entry) => item.foregroundToken === `--color-${entry.name}-text` || item.foregroundToken === `--color-${entry.name}-border-strong`);
    if (!identity || !["--color-bg", "--color-surface"].includes(item.backgroundToken)) continue;
    const source = sources.get(identity.paletteName);
    if (!colorValid(source)) continue;
    const variant = item.foregroundToken === `--color-${identity.name}-text` ? "text" : "border-strong";
    const shift = { name: identity.name, variant, scheme: item.scheme, token: item.foregroundToken, sourceToken: identity.paletteName,
      source, variantColor: item.foreground, deltaL: item.foreground.l - source.l, deltaC: item.foreground.c - source.c };
    const key = `${shift.scheme}|${shift.name}|${shift.variant}`;
    const current = worst.get(key);
    if (!current || Math.abs(shift.deltaL) > Math.abs(current.deltaL)) worst.set(key, shift);
  }
  // No comparison was possible (unknown sources or no measured variant): stay silent rather than implying a clean result.
  if (!worst.size) return null;
  const shifts = [...worst.values()].filter((shift) => Math.abs(shift.deltaL) >= VARIANT_SHIFT_THRESHOLD || Math.abs(shift.deltaC) >= VARIANT_SHIFT_THRESHOLD)
    .sort((a, b) => Math.abs(b.deltaL) - Math.abs(a.deltaL));
  return shifts;
}

function variantShiftsHtml(shifts) {
  if (shifts === null) return "";
  if (!shifts.length) return `<h3>Varianti vicine al colore di marca</h3><p>Nessuna variante <code>*-text</code> o <code>*-border-strong</code> si allontana oltre la soglia (|ΔL| o |ΔC| ≥ ${it(VARIANT_SHIFT_THRESHOLD)}): le varianti funzionali restano vicine alla sorgente.</p>`;
  return `<h3>Varianti che si allontanano dal colore di marca</h3>
<p>Un testo o un bordo molto più chiaro o scuro della sorgente non è più “quel” colore. ${shifts.length} ${shifts.length === 1 ? "variante supera" : "varianti superano"} la soglia (|ΔL| o |ΔC| ≥ ${it(VARIANT_SHIFT_THRESHOLD)}), dalla più divergente: le voci sono ordinate per scostamento.</p>
<ul class="variant-list">${shifts.map((shift) => {
    const source = colorCss(shift.source), variant = colorCss(shift.variantColor);
    if (!source || !variant) return "";
    const direction = shift.deltaL < 0 ? "più scura" : "più chiara";
    return `<li><span class="variant-swatch" aria-hidden="true" style="--sample-color:${variant}"></span><code>${escape(shift.token)}</code> (tema ${shift.scheme === "light" ? "chiaro" : "scuro"}) rispetto a <code>${escape(shift.sourceToken)}</code>: ΔL ${it(shift.deltaL, 3)} · ΔC ${it(shift.deltaC, 3)} — la variante è ${direction} della sorgente.</li>`;
  }).join("")}</ul>`;
}

function problemsHtml(groups, proposals, verified) {
  if (!groups.length) return `<p>${verified ? "Nessun problema nelle coppie misurate." : "Riepilogo non disponibile: verifica incompleta. Consulta gli errori nei dettagli tecnici."}</p>`;
  return groups.map((group) => {
    const before = group.reduce((worst, entry) => entry.item.ratio < worst.item.ratio ? entry : worst);
    const { item } = before;
    const view = proposals.find((view) => view.complete && group.every((entry) => view.covered.has(entry.key)));
    const after = view?.paired.find((check) => check.before.key === before.key)?.item;
    const context = (entry) => `${escape(entry.scenario.browser)} / ${escape(entry.scenario.scheme)} / ${escape(entry.scenario.preference)}`;
    const ratios = group.map(({ item }) => item.ratio);
    const title = item.backgroundToken === "--color-surface" && item.foregroundToken === "--color-text-muted" ? "Testo secondario sulla superficie"
      : item.backgroundToken === "--color-surface" && item.foregroundToken === "--color-tertiary-text" ? "Testo terziario sulla superficie" : item.label;
    return `<article class="card problem-card"><p class="eyebrow">${item.scheme === "light" ? "Tema chiaro" : "Tema scuro"} · ${item.kind === "text" ? "Testo" : "Non testuale (bordo)"}</p>
<h3>${escape(title)}</h3><p><code>${escape(item.foregroundToken)}</code> su <code>${escape(item.backgroundToken)}</code></p>
<p>${item.status === "below-minimum" ? "Il contrasto è sotto il minimo richiesto." : "Il minimo è rispettato; manca il target di progetto."} Minimo: ${ratio(item.minimum)} · Target: ${ratio(item.target)}.</p>
${baselineNote(item, group)}
<div class="comparison">${compactPair(item, "Attuale")}${after ? compactPair(after, "Con la correzione") : '<div><p class="status">Nessuna proposta verificata per questa coppia.</p><p>Il report non suggerisce un colore senza una verifica completa.</p></div>'}</div>
${view ? `<p><a href="#${view.id}">Usa la correzione ${proposals.indexOf(view) + 1}</a>. ${group.length} ${group.length === 1 ? "misura coperta" : "misure coperte"}.</p>` : ""}
<p>${group.length} ${group.length === 1 ? "misura" : "misure raggruppate"}. Scenario col contrasto più basso: ${context(before)}.</p>
<details><summary>Valori esatti e differenze tra gli scenari</summary>
<p>Coppia: ${escape(item.label)}. Intervallo attuale: ${ratio(Math.min(...ratios))} – ${ratio(Math.max(...ratios))}. Ogni misura e ogni colore sono conservati separatamente.</p>
${table("Misure del problema", ["Scenario", "Primo piano", "Sfondo", "Rapporto completo", "Minimo", "Target", "Esito"], group.map((entry) => `<tr><th scope="row">${context(entry)}</th><td>${colorCode(entry.item.foreground)}</td><td>${colorCode(entry.item.background)}</td><td>${ratio(entry.item.ratio)}</td><td>${ratio(entry.item.minimum)}</td><td>${ratio(entry.item.target)}</td><td>${status(entry.item)}</td></tr>`))}
</details></article>`;
  }).join("");
}

// One visual card per distinct measured pair: repeated browser/preference measurements stay counted.
function dedupeChecks(checks) {
  const groups = new Map();
  for (const check of checks) {
    const item = check.item;
    const key = JSON.stringify([item.label, item.scheme, item.kind, item.foregroundToken, item.backgroundToken, item.foreground, item.background, item.minimum, item.target, item.status]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(check);
  }
  return [...groups.values()];
}

// Public one-liner per proposal kind. Knob wording stays specific only when it is exactly true:
// a dark knob must never be described as a light-surface adjustment.
function proposalSentence(proposal) {
  const destination = record(proposal.destination) ? proposal.destination : {};
  const path = text(destination.path) ? destination.path : "";
  if (proposal.kind === "tuning") {
    if (path === "--color-tune-surface-lightness-shift") return "Regola la superficie del tema chiaro senza cambiare la palette di partenza.";
    if (/^--color-tune-dark-/.test(path)) return "Regola il tema scuro senza cambiare la palette di partenza.";
    if (/^--color-tune-/.test(path)) return "Regola una manopola di tuning senza cambiare la palette di partenza.";
    return "Regola una manopola di tuning senza cambiare la palette di partenza.";
  }
  if (proposal.kind === "foreground") return "Cambia il testo sul riempimento indicato, mantenendo il colore di sfondo.";
  return text(proposal.impact) ? proposal.impact : "Modifica locale della palette di partenza.";
}

// Informational only: these measurements never enter the proposal verification or its outcome.
function sideEffectsHtml(value) {
  const declared = list(value);
  if (!declared.length) return "";
  const entries = declared.filter((item) => {
    const entry = record(item) ? item : {};
    return text(entry.label) && schemeValid(entry.scheme) && text(entry.foregroundToken) && text(entry.backgroundToken)
      && record(entry.before) && colorValid(entry.before.color) && ratioValid(entry.before.ratio)
      && record(entry.after) && colorValid(entry.after.color) && ratioValid(entry.after.ratio);
  });
  if (!entries.length) return '<div class="side-effect"><p class="status">Effetto collaterale dichiarato ma non misurabile: nessun dato valido.</p></div>';
  return `<div class="side-effect"><p><strong>Altro effetto della stessa modifica</strong></p><ul>${entries.map((entry) => {
    const direction = entry.after.ratio > entry.before.ratio ? "in aumento" : entry.after.ratio < entry.before.ratio ? "in calo" : "invariato";
    const warning = entry.after.ratio < 3 ? " Resta sotto il riferimento 3:1 per bordi e icone necessari: valuta un bordo dedicato." : "";
    return `<li><code>${escape(entry.foregroundToken)}</code> su <code>${escape(entry.backgroundToken)}</code> (tema ${entry.scheme === "light" ? "chiaro" : "scuro"}): da <span class="contrast-value">${compactRatio(entry.before.ratio, [3])}</span> a <span class="contrast-value">${compactRatio(entry.after.ratio, [3])}</span> — ${direction}.${warning}</li>`;
  }).join("")}</ul><p class="margin-note">Misura informativa: questo bordo non fa parte delle coppie verificate e non decide l’esito della proposta.</p></div>`;
}

function proposalHtml(view, index) {
  const { proposal, id, checks, expected, paired, complete } = view;
  const destination = record(proposal.destination) ? proposal.destination : {};
  const valid = checks.filter(({ item }) => diagnosticValid(item));
  const minimumFor = (kind) => {
    const values = valid.filter(({ item }) => (item.kind === "non-text" ? "non-text" : "text") === kind).map(({ item }) => item.ratio);
    return values.length ? values.reduce((a, b) => Math.min(a, b)) : null;
  };
  const textMinimum = minimumFor("text"), uiMinimum = minimumFor("non-text");
  const completeness = checks.length && valid.length === checks.length ? "insieme completo" : "validi disponibili (insieme incompleto)";
  const issues = dedupeChecks(checks.filter(({ item }) => list(proposal.issueLabels).includes(item.label)));
  const context = (scenario) => `${escape(scenario.browser)} / ${escape(scenario.scheme)} / ${escape(scenario.preference)}`;
  const where = ({ item, before }) => before ? context(before.scenario) : `${escape(item.browser ?? "browser non indicato")} / ${escape(item.scheme)} / ${escape(item.preference ?? "preferenza non indicata")}`;
  return `<article class="card${complete ? " recommendation" : ""}" id="${id}"><h3>Correzione ${index + 1} · ${escape(proposal.title)}</h3>
<p><span class="badge">${complete ? "Verificata nello snapshot" : "Verifica incompleta: nessuna copertura attribuita"}</span></p>
<p>${escape(proposal.kind === "tuning" ? proposalSentence(proposal)
    : proposal.kind === "foreground" ? proposalSentence(proposal)
    : proposal.impact)}</p>
${list(proposal.changes).map((value) => {
    const change = record(value) ? value : {};
    const summary = deltaSummary(change.before, change.after);
    return `<div class="color-change"><p><strong>Colore che cambia:</strong> <code>${escape(change.label)}</code></p>
<div class="comparison">${colorChoice(change.before, "Attuale")}${colorChoice(change.after, complete ? "Suggerito" : "Dopo (non verificato)", complete)}</div>
<p class="margin-note">${summary ? `${summary}. Variazioni OKLCH e distanza percettiva 0–1: non sono misure di contrasto.` : "Differenze non disponibili: colore non valido."}</p></div>`;
  }).join("")}
${sideEffectsHtml(proposal.sideEffects)}
<p class="snippet-label">Modifica da applicare manualmente</p>
<dl class="destination"><div><dt>File</dt><dd><code>${escape(destination.file)}</code></dd></div><div><dt>Percorso nella configurazione</dt><dd><code>${escape(destination.path)}</code></dd></div></dl>
<pre tabindex="0" aria-label="Snippet della proposta"><code>${escape(destination.snippet)}</code></pre>
<p>Applicazione manuale: il report non modifica file. Dopo la modifica, rigenera il report per confermare il risultato.</p>
<details><summary>Verifica e misure complete della correzione</summary>
<p class="status">${complete ? "Proposta verificata per le coppie coperte nello snapshot" : "Verifica incompleta: nessuna copertura attribuita"}.</p>
<p>ID: <code>${escape(proposal.id)}</code> · Tipo: ${escape(proposal.kind)}</p><p>Impatto dichiarato: ${escape(proposal.impact)}</p>
<p>Ambito della ricerca: ${escape(proposal.search)}. Nessuna garanzia di palette ottimale o di soluzione più vicina globale.</p>
<p>Coppie complete: ${paired.length}/${checks.length}; issue coperte: ${view.covered.size}/${expected.length}.
Rapporto minimo del testo: ${textMinimum === null ? "non disponibile" : ratio(textMinimum)} · minimo UI/bordi: ${uiMinimum === null ? "non disponibile" : ratio(uiMinimum)} (${completeness}).</p>
<div class="grid">${issues.map((group) => {
      const { item, before } = group[0];
      return `<div class="card"><p><strong>${escape(item.label)}</strong></p>
${before ? `<p>Scenario: ${where(group[0])}${group.length > 1 ? ` — ${group.length} misure identiche in scenari diversi: ${group.map((entry) => where(entry)).join(", ")}` : ""}</p><div class="grid"><div><p><strong>Prima — snapshot originale</strong></p>${pairSample(before.item, "Prima")}</div><div><p><strong>Dopo — proposta</strong></p>${pairSample(item, "Dopo")}</div></div>
<p>Provenienza prima: ${escape(before.scenario.provenance)}; diagnostica: ${escape(before.item.provenance)}. Provenienza dopo: ${escape(item.provenance)} (se assente, non dedotta).</p>` : "<p>Prima/dopo non verificato: coppia originale assente, ambigua o controllo non valido. Nessun campione precedente inventato.</p>"}</div>`;
    }).join("")}</div>
${checks.length ? `<details><summary>Tabella completa dei controlli — ${checks.length} righe</summary>${diagnosticTable("Controlli della proposta", checks.map(({ item, before }) => ({ item, scenario: before?.scenario ?? {} })))}</details>` : "<p>Nessun controllo disponibile.</p>"}
<details><summary>Modifiche cromatiche e differenze numeriche</summary>
${table("Variazioni proposte", ["Colore", "Prima", "Dopo", "Differenze"], list(proposal.changes).map((value) => {
    const change = record(value) ? value : {};
    return `<tr><th scope="row">${escape(change.label)}</th><td>${colorCode(change.before)}</td><td>${colorCode(change.after)}</td><td>${deltas(change.before, change.after)}</td></tr>`;
  }))}<p>ΔH è nominale e non significativo per colori acromatici; ΔEOK non è una misura di contrasto.</p></details>
</details></article>`;
}

function scenariosHtml(scenarios, entries, proposals) {
  if (!scenarios.length) return "<p>Nessuno scenario disponibile: esito non verificato.</p>";
  return scenarios.map((value, index) => {
    const scenario = record(value) ? value : {};
    const facts = entries.filter((entry) => entry.scenarioIndex === index);
    const issues = facts.filter(({ valid, item }) => !valid || item.status !== "pass");
    return `<article class="card"><h3>${escape(scenario.browser)} · ${escape(scenario.scheme)} · ${escape(scenario.preference)}</h3>
<p>Browser: ${escape(scenario.browser)}; schema: ${escape(scenario.scheme)}; preferenza: ${escape(scenario.preference)}.</p>
<p>Provenienza dello scenario: <code>${escape(scenario.provenance)}</code>.</p>
${!scenarioValid(scenario) ? "<p>Scenario non valido: esito non verificato.</p>" : ""}
${facts.length ? `<details><summary>Dati completi: ${facts.length} coppie misurate nello scenario</summary>${diagnosticTable("Coppie misurate nello scenario", facts)}</details>` : "<p>Nessuna coppia misurata: esito non verificato.</p>"}
${!issues.length && facts.length ? `<p>Nessuna issue nelle coppie misurate di questo scenario (${facts.length}).</p>` : ""}
${issues.map((entry) => {
      const covered = proposals.filter((proposal) => proposal.covered.has(entry.key));
      return `<details><summary>Issue: ${escape(entry.item.label)} — ${status(entry.item, entry.valid)}</summary>
${pairSample(entry.item, "Coppia dello snapshot", entry.valid)}
<p>${covered.length ? `Proposte verificate per questa coppia: ${covered.map((view) => `<a href="#${view.id}">${escape(view.proposal.title)}</a>`).join(", ")}.` : "Nessuna proposta verificata per questa coppia nello scenario."}</p></details>`;
    }).join("")}</article>`;
  }).join("");
}

function validation(report, scenarios, entries) {
  const problems = [];
  const iso = typeof report.generatedAt === "string" && report.generatedAt === report.generatedAt.trim() && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(report.generatedAt)
    && Number.isFinite(Date.parse(report.generatedAt))
        && new Date(`${report.generatedAt.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === report.generatedAt.slice(0, 10);
  const digest = typeof report.inputDigest === "string" && report.inputDigest.length === 64 && /^[a-f\d]{64}$/i.test(report.inputDigest);
  if (!iso) problems.push("Data di generazione assente o non valida.");
  if (!digest) problems.push("Impronta SHA-256 degli input assente o non valida.");
  if (!record(report.files) || !text(report.files.palette) || !text(report.files.output) || !FILE_KEYS.every((key) => Object.hasOwn(report.files, key) && (report.files[key] === null || text(report.files[key])))) problems.push("Identità dei file incompleta o non valida.");
  for (const key of ["palette", "scenarios", "proposals", "generationErrors", "auditErrors", "notes"]) {
    if (!Array.isArray(report[key])) problems.push(`Campo ${key} assente o non valido.`);
  }
  if (list(report.palette).some((item) => !record(item) || !text(item.name) || !text(item.role) || !colorValid(item.authored) || !colorValid(item.resolved))) problems.push("La palette contiene dati non validi.");
  if (!scenarios.length || scenarios.some((scenario) => !scenarioValid(scenario) || !scenario.diagnostics.length)) problems.push("Scenari mancanti, non validi o senza misure.");
  if (!entries.length || entries.some(({ valid }) => !valid)) problems.push("Diagnostiche mancanti, non valide o incoerenti con lo scenario o con le soglie.");
  for (const key of ["generationErrors", "auditErrors", "notes"]) {
    if (list(report[key]).some((item) => typeof item !== "string")) problems.push(`Il campo ${key} contiene dati non validi.`);
  }
  return { problems, iso, digest };
}

/** Render a supplied snapshot only: no I/O, recalculation of contrast or client code. */
export function formatContrastReportHtml(value) {
  const report = record(value) ? value : {};
  const scenarios = list(report.scenarios);
  const entries = entriesFor(scenarios);
  const { problems, iso, digest } = validation(report, scenarios, entries);
  const issues = entries.filter(({ valid, item }) => valid && item.status !== "pass");
  const errors = [...list(report.generationErrors), ...list(report.auditErrors)];
  const verified = !problems.length && !errors.length;
  const proposals = list(report.proposals).filter((item) => record(item) && item.verified === true)
    .map((item, index) => proposalView(item, index, entries))
    .map((view) => verified ? view : { ...view, complete: false, covered: new Set() });
  const groups = issueGroups(entries);
  const overlaps = overlapView(report.overlaps, scenarios, verified);
  const variantShifts = verified ? variantShiftView(entries, list(report.palette), record(report.roles) ? report.roles : null) : null;
  const tuningGroups = groups.filter((group) => group.some(({ item }) => ratioValid(item.baselineRatio)
    && Math.abs(item.baselineRatio - item.ratio) > 1e-9 && item.baselineRatio >= Math.max(item.minimum, item.target)));
  const complete = proposals.filter((view) => view.complete);
  const outcome = !verified ? "Esito non verificato o incompleto" : issues.length
    ? `${groups.length} ${groups.length === 1 ? "problema di contrasto" : "problemi di contrasto"} · ${complete.length} ${complete.length === 1 ? "correzione verificata" : "correzioni verificate"}`
    : "Esito positivo dello snapshot: 0 issue";
  const files = record(report.files) ? report.files : {};
  const messages = (heading, values) => `<h3>${heading}</h3>${values.length ? `<ul>${values.map((item) => `<li>${escape(item)}</li>`).join("")}</ul>` : "<p>Nessuno.</p>"}`;
  return `${MARKER}
<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escape(CSP)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rapporto contrasto — snapshot ${escape(report.generatedAt)}</title>
<style>${CSS}</style></head><body><div class="shell">
<a class="skip" href="#contenuto">Vai al contenuto</a>
<header><h1>Rapporto di contrasto</h1><p class="status overview">${outcome}</p>
<p>Generato il ${iso ? `<time datetime="${escape(report.generatedAt)}">${escape(report.generatedAt)}</time>` : escape(report.generatedAt)}.</p>
<p><strong>Snapshot statico, non stato attuale del progetto.</strong> Rigenera il report dopo ogni modifica ai colori. Data, file e impronta sono nei dettagli tecnici.</p>
<nav aria-label="Sezioni del rapporto"><ul><li><a href="#proposte">Correzione consigliata</a></li><li><a href="#problemi">Problemi e risultato atteso</a></li><li><a href="#usi">Colpo d’occhio sugli usi</a></li><li><a href="#tecnici">Dettagli tecnici</a></li></ul></nav></header>
<main id="contenuto">
${verified ? "" : `<div class="notice"><p class="status">Nessuna conclusione positiva: dati assenti, non validi, incoerenti o errori impediscono di verificare lo snapshot.</p><ul>${[...problems, ...errors].map((item) => `<li>${escape(item)}</li>`).join("")}</ul></div>`}
${list(report.notes).length ? `<p>${escape(report.notes[0])}</p>` : ""}
<section aria-labelledby="proposte"><h2 id="proposte">${complete.length > 1 ? "Correzioni da valutare" : "Correzione consigliata"}</h2>
<p>${complete.length ? "Usa il colore suggerito applicando la modifica nel file indicato." : verified && !issues.length ? "Non serve una correzione per le coppie misurate." : "Non applicare correzioni non verificate: i dati disponibili non permettono di consigliarne una."}${complete.length > 1 ? " Le opzioni sono verificate separatamente: non sommarle senza una nuova verifica." : ""}</p>
${proposals.length ? proposals.map(proposalHtml).join("") : "<p>Nessuna proposta verificata disponibile.</p>"}</section>
<section aria-labelledby="problemi"><h2 id="problemi">${groups.length ? "Cosa migliora" : "Problemi rilevati"}</h2>
${groups.length ? '<p>Confronta il contrasto attuale con quello ottenuto dalla correzione. I rapporti sono sintetici; minimo, target ed esiti restano distinti.</p>' : ""}
${tuningGroups.length ? `<p><strong>${tuningGroups.length} di ${groups.length}</strong> problemi compaiono con i tuning di progetto: senza tuning il generatore rispettava il target. La riga “Senza i tuning” lo mostra coppia per coppia.</p>` : ""}
<div class="grid">${problemsHtml(groups, proposals, verified)}</div></section>
<section aria-labelledby="usi"><h2 id="usi">Palette: colpo d’occhio sugli usi</h2>
<p><strong>Situazione attuale, prima delle correzioni.</strong> OK vale solo per gli abbinamenti controllati; da migliorare significa minimo rispettato ma target mancato; da evitare significa sotto il minimo per quell’uso.</p>
${usageHtml(entries, scenarios, verified)}
<h3>Famiglie di colori: come appaiono nei componenti</h3>
<p>Ogni famiglia mostra testo su callout, bottone e chip con i rapporti misurati: vedi subito se la variante regge nell’uso previsto.</p>
${familyAtlas(entries, verified)}
${variantShiftsHtml(variantShifts)}
<h3>Se sovrapponi liberamente i colori base</h3>${overlapsHtml(overlaps)}
<p>Su foto, gradienti o trasparenze, verifica il risultato sullo sfondo reale. Colori diversi per tonalità possono avere poco contrasto: non basta che sembrino diversi.</p></section>
<section aria-labelledby="tecnici"><h2 id="tecnici">Dettagli tecnici</h2><p>Non servono per leggere la correzione. Tutti i dati originali restano disponibili qui.</p>
<details><summary>Misure complete — ${scenarios.length} scenari, ${entries.length} controlli</summary>
<section aria-labelledby="scenari"><h2 id="scenari">Scenari, misure e issue</h2><p>Ogni rapporto riguarda la coppia primo piano/sfondo indicata, non il colore isolato. Minimo e target sono distinti; i rapporti sono mostrati con la precisione completa del dato numerico fornito.</p>${scenariosHtml(scenarios, entries, proposals)}</section></details>
<details><summary>Palette completa — fonte e colori risolti</summary>
<section aria-labelledby="palette"><h2 id="palette">Palette originale e colori risolti</h2><p>I campioni possono essere alterati dal gamut del display, dal browser o dai colori forzati. I valori OKLCH restano disponibili sulla UI neutra.</p>${paletteHtml(list(report.palette))}</section></details>
<details><summary>File, impronta dello snapshot ed errori</summary>
<section aria-labelledby="esito"><h2 id="esito">Esito e integrità dello snapshot</h2>
<p>${verified ? `${entries.length} coppie misurate; ${issues.length} rilevazioni sotto minimo o target, raggruppate in ${groups.length} problemi distinti. Esito limitato a questi scenari e alla provenienza dichiarata.` : "Nessuna conclusione positiva: dati assenti, non validi, incoerenti o errori impediscono di verificare lo snapshot."}</p>
<p>Questo report non legge i file attuali, non ne ricalcola l’impronta e non si aggiorna. Confrontare data e SHA-256 con l’ultima esecuzione prima di applicare proposte.</p>
<dl><dt>Generato il (dato dichiarato)</dt><dd>${escape(report.generatedAt)}</dd><dt>SHA-256 degli input (dichiarato, non ricalcolato)</dt><dd><code>${escape(report.inputDigest)}</code>${digest ? "" : " — non valido"}</dd></dl>
${table("File dello snapshot", ["Ruolo", "Percorso dichiarato"], FILE_KEYS.map((key) => `<tr><th scope="row">${key}</th><td><code>${escape(files[key] === null ? "Non fornito" : files[key])}</code></td></tr>`))}
${messages("Problemi di integrità", problems)}${messages("Errori di generazione", list(report.generationErrors))}${messages("Errori di audit", list(report.auditErrors))}${messages("Note", list(report.notes))}</section></details>
<details><summary>Limiti delle verifiche e metodo</summary>
<section aria-labelledby="limiti"><h2 id="limiti">Limiti e metodo di lettura</h2>
<ul><li>Il comando di report verifica i colori calcolati nei browser indicati negli scenari. Le correzioni complete raggiungono le soglie delle coppie coperte, non di qualsiasi uso futuro.</li>
<li>Le sovrapposizioni libere sono simulazioni separate: segnalano rischi d’uso, non difetti accertati del sito. Un contrasto sufficiente non garantisce che due colori siano distinguibili per ogni persona: usa anche etichette, forme o icone.</li>
<li>Trasparenze, foto, gradienti, personalizzazioni CSS locali e stati non misurati richiedono una verifica nel componente reale. Il campione non certifica dimensioni, peso o contesto del testo.</li>
<li>Questo report non sostituisce un audit completo di accessibilità e non promette una palette esteticamente ottimale.</li></ul>
<p>Dettaglio di calcolo: rapporti WCAG 2.x in sRGB con canali clipped (limitati a 0–1), non letture dei pixel del display. La pagina HTML visualizza i risultati ricevuti e la loro provenienza: non esegue nuove misure né ricalcola i contrasti. Le differenze OKLCH/OKLab non sono una misura di contrasto né una ricerca globale della soluzione più vicina.</p></section></details></section></main>
<footer><p>Report autonomo e statico: nessuno script, risorsa di rete o framework. Validità circoscritta allo snapshot e alla sua impronta dichiarata.</p></footer>
</div></body></html>\n`;
}
