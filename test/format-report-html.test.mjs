import assert from "node:assert/strict";
import test from "node:test";
import * as renderer from "../src/format-report-html.mjs";

const { formatContrastReportHtml: render, prepareContrastReport } = renderer;
const color = (l = 0.5, c = 0.1, h = 350) => ({ l, c, h });
const statusFor = (ratio, target, minimum) => ratio < minimum ? "below-minimum" : ratio < target ? "below-target" : "pass";
function diagnostic(overrides = {}) {
  const item = {
    label: "identità / superficie", scheme: "light", foregroundToken: "--color-primary",
    backgroundToken: "--color-bg", foreground: color(), background: color(1, 0, 0),
    ratio: 5, target: 4.6, minimum: 4.5, kind: "text", provenance: "generated",
    ...overrides,
  };
  return { ...item, status: overrides.status ?? statusFor(item.ratio, item.target, item.minimum) };
}
function scenario(overrides = {}) {
  return { browser: "chromium", scheme: "light", preference: "no-preference", provenance: "browser: computed styles", diagnostics: [diagnostic()], ...overrides };
}
function report(overrides = {}) {
  return {
    generatedAt: "2026-07-01T12:34:56.789Z", inputDigest: "a".repeat(64),
    files: { palette: "tokens/palette.css", config: "smart-colors.config.mjs", tuning: null, output: "tokens/colors.css" },
    palette: [{ name: "primary", role: "accent-text", authored: color(0.5, 0.3), resolved: color(), darkBlend: 0.78 }],
    scenarios: [scenario()], proposals: [], generationErrors: [], auditErrors: [], notes: [],
    ...overrides,
  };
}
function issueReport(overrides = {}) {
  return report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.499999999999999 })] })], ...overrides });
}
function proposal(overrides = {}) {
  return {
    id: "primary-lightness", title: "Correzione locale del primo piano", kind: "palette-lightness",
    destination: { file: "tokens/palette.css", path: "primary", snippet: "--primary: oklch(0.4 0.1 350);" },
    impact: "Modifica la luminosità del primo piano", search: "griglia locale di lightness, chroma e hue invariati",
    changes: [{ label: "primary", before: color(), after: color(0.4) }],
    checks: [diagnostic({ foreground: color(0.4), browser: "chromium", preference: "no-preference", ratio: 6 })],
    issueLabels: ["identità / superficie"], verified: true,
    ...overrides,
  };
}
const styles = (html) => [...html.matchAll(/\sstyle="([^"]*)"/g)].map((match) => match[1]);
const header = (html) => html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
const section = (html, id) => html.match(new RegExp(`<section aria-labelledby="${id}">[\\s\\S]*?<\\/section>`))?.[0] ?? "";
const headingLevels = (html) => [...html.matchAll(/<h([1-6])[^>]*>/g)].map((match) => Number(match[1]));
const idReferences = (html) => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
  const refs = [];
  for (const attr of ["for", "form", "aria-labelledby", "aria-describedby", "aria-controls"]) {
    for (const match of html.matchAll(new RegExp(`\\s${attr}="([^"]+)"`, "g"))) {
      for (const id of match[1].split(/\s+/).filter(Boolean)) refs.push({ attr, id, exists: ids.has(id) });
    }
  }
  return refs;
};
const proposalsSection = (html) => section(html, "proposte");
const scenarioSection = (html) => section(html, "scenari");
function publicContent(html) {
  let depth = 0, start = 0, result = "";
  for (const match of html.matchAll(/<details\b[^>]*>|<\/details>/g)) {
    if (match[0].startsWith("</")) {
      depth--;
      if (depth === 0) start = match.index + match[0].length;
    } else {
      if (depth === 0) result += html.slice(start, match.index);
      depth++;
    }
  }
  return result + (depth === 0 ? html.slice(start) : "");
}
test("the correction, suggested colors and exact manual edit precede the audit and remain visible without disclosures", () => {
  const input = issueReport({ proposals: [proposal()] });
  const html = render(input);
  const primary = publicContent(html);
  const correction = publicContent(proposalsSection(html));
  assert.ok(html.indexOf('id="proposte"') < html.indexOf('id="problemi"'));
  for (const id of ["scenari", "palette", "esito", "limiti"]) {
    assert.ok(html.indexOf('id="problemi"') < html.indexOf(`id="${id}"`));
    assert.ok(!primary.includes(`<h2 id="${id}"`));
  }
  for (const value of ["Colore che cambia:", "Attuale", "Suggerito", "oklch(0.5 0.1 350)", "oklch(0.4 0.1 350)", input.proposals[0].destination.file, input.proposals[0].destination.snippet]) assert.ok(correction.includes(value), value);
  assert.match(correction, /class="color-choice color-choice--suggested"/);
  assert.match(correction, /aria-label="Snippet della proposta"/);
  assert.doesNotMatch(primary, /<table>|Controlli cambiati dalla proposta|Coppie complete:|Tabella completa dei controlli|SHA-256/);
  assert.match(primary, /ΔL -0,1 · ΔC 0 · ΔH 0° · ΔEOK 0,1/);
  assert.match(primary, /1 problema di contrasto · 1 correzione verificata/);
});

test("navigation order matches the document order of its sections and comparisons stay intrinsically responsive", () => {
  const html = render(issueReport({ proposals: [proposal()] }));
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  const links = [...nav.matchAll(/href="#([\w-]+)"/g)].map(([, id]) => id);
  assert.deepEqual(links, ["proposte", "problemi", "usi", "tecnici"]);
  const positions = links.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position, index) => position > 0 && (index === 0 || position > positions[index - 1])));
  assert.match(html, /repeat\(auto-fit, minmax\(min\(100%, 15rem\), 1fr\)\)/);
  assert.doesNotMatch(html, /repeat\(2, minmax\(0, 1fr\)\)/);
});

test("problem cards show the baseline-to-tuned delta only when tuning really changed the measurement", () => {
  const withTuning = render(issueReport({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 6.8, target: 7, baselineRatio: 7.02 })] })] }));
  const problems = section(withTuning, "problemi");
  assert.match(publicContent(problems), /Senza i tuning di progetto questa coppia rispettava le soglie/);
  assert.match(publicContent(problems), /con i tuning attivi misura/);
  assert.match(publicContent(problems), /\(-0,22\)/);
  assert.match(problems, /<strong>1 di 1<\/strong> problemi compaiono con i tuning di progetto/);
  for (const baselineRatio of [undefined, 6.8, 6.800000000000001]) {
    const html = render(issueReport({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 6.8, target: 7, baselineRatio })] })] }));
    assert.doesNotMatch(section(html, "problemi"), /class="baseline-note"/);
    assert.doesNotMatch(section(html, "problemi"), /compaiono con i tuning di progetto/);
  }
  const preexisting = render(issueReport({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 6.8, target: 7, baselineRatio: 6.5 })] })] }));
  const preexistingProblems = section(preexisting, "problemi");
  assert.match(preexistingProblems, /Anche senza i tuning di progetto questa coppia non raggiungeva le soglie/);
  assert.match(preexistingProblems, /\(\+0,3\)/);
  assert.doesNotMatch(preexistingProblems, /compaiono con i tuning di progetto/);
});

test("proposal deltas stay visible while repeated cards collapse and the long table gets its own disclosure", () => {
  const ratio = 4.5 - Number.EPSILON * 4;
  const scenarios = ["light", "dark"].map((preference) => scenario({ preference, diagnostics: [diagnostic({ preference, ratio })] }));
  const checks = ["light", "dark"].map((preference) => diagnostic({ preference, ratio: 6 }));
  const html = render(report({ scenarios, proposals: [proposal({ checks })] }));
  const primary = publicContent(proposalsSection(html));
  assert.match(primary, /ΔL -0,1 · ΔC 0 · ΔH 0° · ΔEOK 0,1/);
  assert.doesNotMatch(primary, /<table>|Controlli cambiati dalla proposta|Tabella completa dei controlli/);
  const details = proposalsSection(html);
  assert.match(details, /<details><summary>Controlli cambiati dalla proposta — 2 di 2<\/summary>/);
  assert.match(details, /Altri 0 controlli invariati/);
  assert.equal((details.match(/Prima — snapshot originale/g) ?? []).length, 1);
  assert.equal((details.match(/Dopo — proposta/g) ?? []).length, 1);
  assert.match(details, /2 misure identiche in scenari diversi/);
  assert.match(details, /Coppie complete: 2\/2; issue coperte: 2\/2/);
  assert.match(details, /Rapporto minimo del testo: <code>6:1<\/code>/);
  assert.match(details, /minimo UI\/bordi: non disponibile \(insieme completo\)/);
});

test("family atlas renders only measured families, keeps the worst measurement and never invents samples", () => {
  const diagnostics = [
    diagnostic({ label: "primary-text / family surface", foregroundToken: "--color-primary-text", backgroundToken: "--color-primary-surface", ratio: 4.4 }),
    diagnostic({ label: "primary-border-strong / family surface", foregroundToken: "--color-primary-border-strong", backgroundToken: "--color-primary-surface", ratio: 3.2, minimum: 3, target: 3, kind: "non-text" }),
    diagnostic({ label: "primary-on-solid / solid", foregroundToken: "--color-primary-solid-text", backgroundToken: "--color-primary-solid", ratio: 4.8 }),
    diagnostic({ label: "on-primary / primary", foregroundToken: "--color-primary-ink", backgroundToken: "--color-primary", ratio: 5.1 }),
    diagnostic({ label: "on-spark / spark", foregroundToken: "--color-spark-ink", backgroundToken: "--color-spark", ratio: 2.2 }),
  ];
  const html = render(report({ scenarios: [scenario({ diagnostics })] }));
  const guide = section(html, "usi");
  const cards = [...guide.matchAll(/<article class="card family-card">[\s\S]*?<\/article>/g)].map(([card]) => card);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /Famiglia <code>--color-primary<\/code>/);
  for (const label of ["Testo su callout", "Bottone", "Chip o badge"]) assert.ok(cards[0].includes(label), label);
  assert.match(cards[0], /4,40:1/);
  assert.match(cards[0], /3,20:1/);
  assert.match(cards[0], /Sotto il minimo/);
  assert.match(cards[0], /--sample-border:oklch\(0\.5 0\.1 350\)/);
  assert.match(cards[1], /Famiglia <code>--color-spark<\/code>/);
  assert.doesNotMatch(cards[1], /Testo su callout|Bottone/);
  assert.match(cards[1], /--sample-fg:oklch\(0\.5 0\.1 350\);--sample-bg:oklch\(1 0 0\)/);
  assert.match(publicContent(guide), /Famiglie di colori: come appaiono nei componenti/);
  const unverified = render(report({ scenarios: [scenario({ diagnostics })], auditErrors: ["Audit incompleto"] }));
  assert.match(section(unverified, "usi"), /verifica incompleta: il quadro può essere parziale/);
  const empty = render(issueReport());
  assert.doesNotMatch(section(empty, "usi"), /class="card family-card"/);
});

test("repeated browser/preference measurements become distinct problems without discarding ratios or colors", () => {
  const scenarios = ["chromium", "webkit"].flatMap((browser) => ["light", "dark"].map((preference, index) => scenario({ browser, preference, diagnostics: [
    diagnostic({ ratio: 4.1 + index / 10, foreground: color(0.51 + index / 100) }),
    diagnostic({ label: "seconda coppia", foregroundToken: "--color-other", ratio: 4.3 }),
  ] })));
  const html = render(report({ scenarios }));
  const problems = section(html, "problemi");
  assert.match(header(html), /2 problemi di contrasto/);
  assert.equal((problems.match(/class="card problem-card"/g) ?? []).length, 2);
  assert.match(problems, /4 misure raggruppate/);
  assert.ok(problems.includes("4.1:1"));
  assert.ok(problems.includes("4.199999999999999:1") || problems.includes("4.2:1"));
  assert.ok(problems.includes("oklch(0.52 0.1 350)"));
  assert.match(publicContent(problems), /chromium \/ light \/ light/);
  assert.match(publicContent(problems), /--sample-fg:oklch\(0\.51 0\.1 350\)/);
  assert.equal((scenarioSection(html).match(/<caption>Coppie misurate nello scenario<\/caption>/g) ?? []).length, 4);
});

test("problem grouping preserves different themes, usages, thresholds, tokens and outcomes", () => {
  const base = diagnostic({ ratio: 4 });
  const diagnostics = [base,
    diagnostic({ ratio: 4, minimum: 3 }), diagnostic({ ratio: 4, target: 7 }),
    diagnostic({ ratio: 4, kind: "non-text" }), diagnostic({ ratio: 4.55 }),
    diagnostic({ ratio: 4, backgroundToken: "--color-surface" }),
  ];
  const html = render(report({ scenarios: [scenario({ diagnostics }), scenario({ scheme: "dark", diagnostics: [{ ...base, scheme: "dark" }] })] }));
  assert.equal((section(html, "problemi").match(/class="card problem-card"/g) ?? []).length, 7);
  assert.match(header(html), /7 problemi di contrasto/);
});

test("compact ratios cannot round a shortfall up to the minimum or target", () => {
  for (const value of [4.499999999999999, 4.599999999999999]) {
    const html = render(issueReport({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: value })] })] }));
    const primary = publicContent(section(html, "problemi"));
    assert.match(primary, value < 4.5 ? /&lt; 4,5:1/ : /&lt; 4,6:1/);
    assert.match(primary, value < 4.5 ? /Sotto il minimo/ : /Sotto il target/);
    assert.ok(html.includes(`<code>${value}:1</code>`));
  }
});

test("incomplete proposals are not styled or labeled as recommended colors", () => {
  const html = render(issueReport({ proposals: [proposal({ checks: [] })] }));
  const primary = publicContent(proposalsSection(html));
  assert.match(primary, /Verifica incompleta: nessuna copertura attribuita/);
  assert.doesNotMatch(primary, /color-choice--suggested|<strong>Suggerito<\/strong>|class="card recommendation"/);
  assert.match(publicContent(section(html, "problemi")), /Nessuna proposta verificata per questa coppia/);
});

function overlapScenario(overrides = {}) {
  const browser = overrides.browser ?? "chromium", scheme = overrides.scheme ?? "light", preference = overrides.preference ?? "no-preference";
  return scenario({ browser, scheme, preference, provenance: "browser-resolved-overlap", diagnostics: [diagnostic({
    label: "colori base", scheme, browser, preference, provenance: "browser-resolved-overlap",
    foregroundToken: "--color-primary", backgroundToken: "--color-secondary", ratio: 2.999999999999999,
    minimum: 4.5, target: 4.5,
  })], ...overrides });
}

test("usage overview separates usage, theme, minimum and target and does not multiply browser measurements", () => {
  const diagnostics = [
    diagnostic({ foregroundToken: "--color-text-muted", ratio: 6.8, target: 7 }),
    diagnostic({ label: "fill", foregroundToken: "--color-info-solid-text", backgroundToken: "--color-info-solid", ratio: 4.49999999999999 }),
    diagnostic({ label: "callout", foregroundToken: "--color-info-text", backgroundToken: "--color-info-surface" }),
    diagnostic({ label: "border", foregroundToken: "--color-focus-ring", minimum: 3, target: 3, ratio: 3.2, kind: "non-text" }),
  ];
  const scenarios = ["chromium", "webkit"].flatMap((browser) => ["light", "dark"].map((scheme) => scenario({ browser, scheme, diagnostics: diagnostics.map((item) => ({ ...item, scheme })) })));
  const html = render(report({ scenarios }));
  const guide = section(html, "usi");
  assert.ok(html.indexOf('id="problemi"') < html.indexOf('id="usi"'));
  assert.ok(html.indexOf('id="usi"') < html.indexOf('id="tecnici"'));
  const cards = [...guide.matchAll(/<article class="card usage-card">[\s\S]*?<\/article>/g)].map(([card]) => card);
  assert.equal(cards.length, 4);
  assert.match(cards[0], /Testi su pagina e card/);
  assert.equal((cards[0].match(/Da migliorare: 1/g) ?? []).length, 2);
  assert.match(cards[1], /Testi su colori pieni/);
  assert.equal((cards[1].match(/Da evitare: 1/g) ?? []).length, 2);
  for (const card of cards) assert.equal((card.match(/1 abbinamenti/g) ?? []).length, 2);
  for (const card of cards.slice(2)) assert.equal((card.match(/OK nelle coppie controllate/g) ?? []).length, 2);
  assert.match(guide, /Situazione attuale, prima delle correzioni/);
});

test("missing usage measurements, incomplete scenarios or audit errors never receive an OK badge", () => {
  for (const input of [report({ auditErrors: ["Audit incompleto"] }), report({ inputDigest: "bad" }), report({ scenarios: [] })]) {
    assert.doesNotMatch(section(render(input), "usi"), /OK nelle coppie controllate|usage-state--pass/);
  }
  const html = render(report());
  const guide = section(html, "usi");
  assert.match(guide, /Non verificato/);
  assert.match(guide, /Sovrapposizioni libere non verificate/);
  assert.doesNotMatch(guide, /class="card overlap-card"/);
});

function overlapPair(foregroundToken, backgroundToken, ratio, overrides = {}) {
  return diagnostic({ label: `${foregroundToken} on ${backgroundToken}`, foregroundToken, backgroundToken, ratio,
    minimum: 4.5, target: 4.5, browser: "chromium", preference: "no-preference", provenance: "browser-resolved-overlap", ...overrides });
}

test("overlap matrix crosses neutral and base backgrounds symmetrically without inventing cells", () => {
  const ratios = [
    ["--color-alpha", "--color-bg", 5.2], ["--color-alpha", "--color-surface", 4.4], ["--color-alpha", "--color-beta", 3.1], ["--color-alpha", "--color-gamma", 4.6],
    ["--color-beta", "--color-bg", 2.4], ["--color-beta", "--color-surface", 3.05], ["--color-beta", "--color-gamma", 7.1],
    ["--color-gamma", "--color-bg", 6.2],
  ];
  const html = render(report({ overlaps: [overlapScenario({ diagnostics: ratios.map(([foreground, background, ratio]) => overlapPair(foreground, background, ratio)) })] }));
  const guide = section(html, "usi");
  assert.match(guide, /<details><summary>Tutte le sovrapposizioni esplorative[^<]*<\/summary>[\s\S]*Matrice sovrapposizioni — tema chiaro/);
  assert.doesNotMatch(guide, /Matrice sovrapposizioni — tema scuro/, "Only measured themes may get a matrix");
  const matrix = guide.slice(guide.indexOf("Matrice sovrapposizioni — tema chiaro"));
  const row = (token) => matrix.slice(matrix.indexOf(`<code>${token}</code></th>`), matrix.indexOf("</tr>", matrix.indexOf(`<code>${token}</code></th>`)));
  assert.match(matrix, /<caption>Matrice sovrapposizioni — tema chiaro<\/caption>/);
  assert.match(matrix, /<th scope="col">Primo piano ↓ \/ sfondo →<\/th>/);
  for (const token of ["bg", "surface", "alpha", "beta", "gamma"]) assert.ok(matrix.includes(`<th scope="col">${token}</th>`), token);
  assert.match(row("--color-alpha"), /<span class="matrix-badge matrix-badge--aa">AA<\/span> <span class="matrix-ratio">5,20:1<\/span>/);
  assert.match(row("--color-alpha"), /matrix-badge--ui">3:1<\/span> <span class="matrix-ratio">4,40:1<\/span>/);
  assert.match(row("--color-alpha"), /matrix-badge--ui">3:1<\/span> <span class="matrix-ratio">3,10:1<\/span>/);
  assert.match(row("--color-alpha"), /matrix-ratio">4,60:1<\/span>/);
  assert.match(row("--color-beta"), /matrix-badge--no">no<\/span> <span class="matrix-ratio">2,40:1<\/span>/);
  assert.match(row("--color-gamma"), /Non misurato/);
  assert.equal((row("--color-alpha").match(/<td>—<\/td>/g) ?? []).length, 1, "The diagonal is not a measurement");
  const scope = matrix.slice(matrix.indexOf("<caption>Matrice sovrapposizioni — tema chiaro</caption>"), matrix.indexOf("</table>", matrix.indexOf("<caption>Matrice sovrapposizioni — tema chiaro</caption>")));
  const { tableRows, tableColumns } = (() => {
    const body = scope.slice(scope.indexOf("<tbody>"), scope.indexOf("</tbody>"));
    const rows = [...body.matchAll(/<tr><th scope="row">.*?<\/tr>/g)].map(([text]) => text);
    const columns = [...scope.matchAll(/<th scope="col">/g)].length;
    return { tableRows: rows, tableColumns: columns };
  })();
  assert.equal(tableColumns, 6);
  assert.equal(tableRows.length, 3);
  for (const text of tableRows) assert.equal((text.match(/<td>/g) ?? []).length, 5, "Every base row crosses every listed background once");
  const unverified = render(report({ overlaps: [overlapScenario({ diagnostics: ratios.map(([foreground, background, ratio]) => overlapPair(foreground, background, ratio)) })], auditErrors: ["Audit fallito"] }));
  assert.doesNotMatch(section(unverified, "usi"), /Matrice sovrapposizioni/);
});

test("exploratory overlaps have separate thresholds and examples without becoming actual audit failures", () => {
  const input = report({ overlaps: [overlapScenario()] });
  const html = render(input);
  const guide = section(html, "usi");
  assert.match(header(html), /Esito positivo dello snapshot: 0 issue/);
  assert.match(publicContent(guide), /non problemi già presenti nei componenti/);
  assert.match(publicContent(guide), /<strong>0<\/strong> abbinamenti utilizzabili per testo normale · <strong>0<\/strong> solo per titoli grandi, bordi o icone · <strong>1<\/strong> da evitare/);
  assert.match(publicContent(guide), /Esempio da evitare per il testo/);
  assert.match(publicContent(guide), /&lt; 3:1/);
  assert.match(guide, /<code>2\.999999999999999:1<\/code>/);
  assert.match(guide, /browser-resolved-overlap/);
  assert.doesNotMatch(publicContent(guide), /<table>|Sovrapposizioni esplorative — tema/);
  assert.match(proposalsSection(html), /Non serve una correzione/);
});

test("overlap tables keep the worst measurement per theme and name the scenario that produced it", () => {
  const scenarios = [scenario(), scenario({ browser: "webkit" })];
  const overlaps = [overlapScenario(), overlapScenario({ browser: "webkit" })];
  overlaps[0].diagnostics[0] = diagnostic({ ...overlaps[0].diagnostics[0], ratio: 4.500000000000001, status: "pass" });
  const html = render(report({ scenarios, overlaps }));
  const guide = section(html, "usi");
  assert.match(publicContent(guide), /<strong>0<\/strong> abbinamenti utilizzabili per testo normale · <strong>0<\/strong> solo per titoli grandi, bordi o icone · <strong>1<\/strong> da evitare/);
  assert.match(publicContent(guide), /&lt; 3:1/);
  assert.equal((guide.match(/<caption>Sovrapposizioni esplorative — tema chiaro<\/caption>/g) ?? []).length, 1);
  assert.equal((guide.match(/<caption>Sovrapposizioni esplorative — tema scuro<\/caption>/g) ?? []).length, 0);
  const table = guide.slice(guide.indexOf("Sovrapposizioni esplorative — tema chiaro"));
  assert.match(table, /<code>2\.999999999999999:1<\/code>/, "The worst measurement is kept at full precision");
  assert.match(table, /<td>webkit \/ light \/ no-preference<\/td>/, "The table names the scenario that produced the worst value");
  assert.match(guide, /<h4>Tema chiaro — 1 abbinamenti<\/h4>/);
  assert.doesNotMatch(guide, /4\.500000000000001:1/, "Non-worst scenarios are not duplicated, as the section text states");
  assert.match(guide, /la colonna dello scenario indica quale misura l’ha prodotto/);
});

test("missing, duplicate, inconsistent or unsafe overlap data cannot confer an exploratory pass", () => {
  const invalid = [[], [null], [overlapScenario(), overlapScenario()], [overlapScenario({ scheme: "dark" })]];
  for (const override of [
    { ratio: NaN }, { ratio: 5, status: "below-minimum" }, { minimum: 3 }, { kind: "non-text" },
    { browser: "firefox" }, { preference: "more" }, { provenance: "generated" },
    { backgroundToken: "--color-primary" }, { foreground: { l: '0);display:none', c: 0, h: 0 } },
  ]) {
    const scenario = overlapScenario();
    scenario.diagnostics[0] = { ...scenario.diagnostics[0], ...override };
    invalid.push([scenario]);
  }
  const duplicate = overlapScenario();
  duplicate.diagnostics.push(duplicate.diagnostics[0]);
  invalid.push([duplicate]);
  const reversed = overlapScenario();
  const original = reversed.diagnostics[0];
  reversed.diagnostics.push({ ...original, label: "coppia invertita", foregroundToken: original.backgroundToken, backgroundToken: original.foregroundToken, foreground: original.background, background: original.foreground });
  invalid.push([reversed]);
  for (const overlaps of invalid) {
    const html = render(report({ overlaps }));
    assert.match(header(html), /Esito positivo dello snapshot: 0 issue/);
    const guide = section(html, "usi");
    assert.match(guide, /Sovrapposizioni libere non verificate/);
    assert.doesNotMatch(guide, /class="card overlap-card"|style="[^"]*display:none/);
  }
  const incomplete = render(report({ overlaps: [overlapScenario()], auditErrors: ["Audit fallito"] }));
  assert.doesNotMatch(section(incomplete, "usi"), /class="card overlap-card"/);
});

test("variant shifts are reported only above threshold, from measured variants and real brand sources", () => {
  const roles = { identities: [{ name: "tertiary", role: "ui", token: "--palette-tertiary", paletteName: "--palette-tertiary" }] };
  const palette = [{ name: "--palette-tertiary", role: "ui", authored: color(0.8254, 0.16, 89), resolved: color(0.8254, 0.16, 89) }];
  const scenarios = ["light", "dark"].map((scheme) => scenario({ scheme, diagnostics: [
    diagnostic({ label: "tertiary-text / canvas", scheme, foregroundToken: "--color-tertiary-text", backgroundToken: "--color-bg", foreground: color(0.4144, 0.0847, 89.16) }),
    diagnostic({ label: "tertiary-border-strong / canvas", scheme, foregroundToken: "--color-tertiary-border-strong", backgroundToken: "--color-bg", foreground: color(0.8104, 0.15, 89), kind: "non-text", minimum: 3, target: 3, ratio: 3.4 }),
  ] }));
  const html = render(report({ scenarios, palette, roles }));
  const guide = section(html, "usi");
  const items = [...guide.matchAll(/<li><span class="variant-swatch" aria-hidden="true" style="--sample-color:([^"]+)"><\/span><code>([^<]+)<\/code> \(tema (chiaro|scuro)\) rispetto a <code>([^<]+)<\/code>: ΔL ([^ ]+) · ΔC ([^ ]+) — la variante è (.+?) della sorgente\.<\/li>/g)];
  assert.equal(items.length, 2, "Only the text variant is beyond the threshold, once per theme");
  for (const [, sample, token, theme, sourceToken, deltaL] of items) {
    assert.equal(sample, "oklch(0.4144 0.0847 89.16)");
    assert.equal(token, "--color-tertiary-text");
    assert.equal(sourceToken, "--palette-tertiary");
    assert.ok(["chiaro", "scuro"].includes(theme));
    assert.equal(deltaL, "-0,411");
  }
  assert.match(publicContent(guide), /Varianti che si allontanano dal colore di marca/);
  assert.match(publicContent(guide), /\|ΔL\| o \|ΔC\| ≥ 0,04/);
  assert.doesNotMatch(guide, /tertiary-border-strong<\/code>/);
  assert.match(publicContent(guide), /Come intervenire su palette\.css/);
  assert.match(publicContent(guide), /indicazioni da valutare, <strong>non verifiche<\/strong>/);
  assert.match(publicContent(guide), /valuta <code>role: decorative<\/code>/);
  assert.equal((publicContent(guide).match(/class="palette-swatch"/g) ?? []).length, 2);
  const closePalette = [{ ...palette[0], resolved: color(0.4144, 0.0847, 89.16) }];
  const onlyText = render(report({ scenarios: scenarios.map((entry) => ({ ...entry, diagnostics: [entry.diagnostics[0]] })), palette: closePalette, roles }));
  assert.match(section(onlyText, "usi"), /Varianti vicine al colore di marca/);
  assert.doesNotMatch(section(onlyText, "usi"), /variant-swatch/);
  const bleed = render(report({ scenarios, palette: closePalette, roles }));
  assert.match(section(bleed, "usi"), /Varianti che si allontanano dal colore di marca/);
  assert.equal((section(bleed, "usi").match(/<li><span class="variant-swatch"/g) ?? []).length, 2, "A variant equal to the source stays unreported while the border variant is reported");
  for (const missing of [report({ scenarios }), report({ scenarios, roles: { identities: [] } }), report({ scenarios, roles: { identities: [{ name: "tertiary", paletteName: "--palette-missing" }] } }), report({ scenarios, palette, roles, auditErrors: ["Audit fallito"] })]) {
    const controls = section(render(missing), "usi");
    assert.doesNotMatch(controls, /Varianti che si allontanano|Varianti vicine/);
  }
});

test("a variant that only moves in chroma is never described as lighter or darker", () => {
  const roles = { identities: [{ name: "tertiary", role: "ui", token: "--palette-tertiary", paletteName: "--palette-tertiary" }] };
  const palette = [{ name: "--palette-tertiary", role: "ui", authored: color(0.6, 0.1, 89), resolved: color(0.6, 0.1, 89) }];
  const scenarios = [scenario({ scheme: "light", diagnostics: [
    diagnostic({ label: "tertiary-text / canvas", scheme: "light", foregroundToken: "--color-tertiary-text", backgroundToken: "--color-bg", foreground: color(0.6, 0.16, 89) }),
  ] })];
  const guide = section(render(report({ scenarios, palette, roles })), "usi");
  // ΔL is exactly zero: only the chroma moved, so a lightness direction would be a false claim.
  assert.match(guide, /ΔL 0 · ΔC 0,06 — la variante è di pari lightness della sorgente\./);
  assert.doesNotMatch(guide, /più chiara della sorgente|più scura della sorgente/);
});

test("the proposal summary sentence follows the actual tuning knob and never mislabels it", () => {
  const cases = [
    ["--color-tune-surface-lightness-shift", /Regola la superficie del tema chiaro/],
    ["--color-tune-dark-surface-mix", /Regola il tema scuro senza cambiare la palette/],
    ["--color-tune-tertiary-dark", /Regola una manopola di tuning senza cambiare la palette/],
    ["", /Regola una manopola di tuning senza cambiare la palette/],
  ];
  for (const [path, expected] of cases) {
    const html = render(issueReport({ proposals: [proposal({ kind: "tuning", destination: { file: "tokens/colors-tuning.css", path, snippet: `--x: 1;` } })] }));
    const primary = publicContent(proposalsSection(html));
    assert.match(primary, expected, path || "empty path");
    if (path !== "--color-tune-surface-lightness-shift") assert.doesNotMatch(primary, /superficie del tema chiaro/);
  }
  const foreground = render(issueReport({ proposals: [proposal({ kind: "foreground" })] }));
  assert.match(publicContent(proposalsSection(foreground)), /Cambia il testo sul riempimento indicato/);
});

test("tuning proposals name the build-time home and the runtime override caveat", () => {
  const tuning = (restoresConfig) => proposal({
    kind: "tuning",
    destination: { file: "tokens/colors-tuning.css", path: "--color-tune-surface-lightness-shift", snippet: "--color-tune-surface-lightness-shift: 0.02;" },
    configKey: "derivation.surface.lightShift",
    configValue: -0.018,
    restoresConfig,
  });
  const restored = publicContent(proposalsSection(render(issueReport({ proposals: [tuning(true)] }))));
  assert.match(restored, /Il valore di build vive in <code>smart-colors\.config\.mjs<\/code> \(<code>derivation\.surface\.lightShift = -0,018<\/code>\)/);
  assert.match(restored, /<code>colors-tuning\.css<\/code> sovrascrive <code>--color-tune-\*<\/code> solo a runtime/);
  assert.match(restored, /i token di testo derivati \(<code>--color-text-muted<\/code>, <code>--color-\*-text<\/code>\) restano quelli calcolati per il valore configurato/);
  assert.match(restored, /Il valore proposto coincide già con quello in <code>smart-colors\.config\.mjs<\/code>: allineare o rimuovere l’override lo ripristina\./);
  assert.doesNotMatch(restored, /L’alternativa strutturale/);

  const alternative = publicContent(proposalsSection(render(issueReport({ proposals: [tuning(false)] }))));
  assert.match(alternative, /L’alternativa strutturale è cambiare <code>derivation\.surface\.lightShift<\/code> in <code>smart-colors\.config\.mjs<\/code>\./);
  assert.doesNotMatch(alternative, /Il valore proposto coincide già/);
});

test("config proposals describe the structural definition and the regenerated derived tokens", () => {
  const input = issueReport({ proposals: [proposal({
    kind: "config",
    destination: { file: "smart-colors.config.mjs", path: "derivation.surface.lightShift", snippet: "derivation: { surface: { lightShift: -0.016 } }," },
    configKey: "derivation.surface.lightShift",
    configValue: -0.018,
    promotedValue: -0.016,
    configToken: "--color-tune-surface-lightness-shift",
  })] });
  const primary = publicContent(proposalsSection(render(input)));
  assert.match(primary, /Definizione strutturale in <code>smart-colors\.config\.mjs<\/code>: <code>derivation\.surface\.lightShift = -0,016<\/code>/);
  assert.match(primary, /La build rigenera i token di testo derivati \(<code>--color-text-muted<\/code>, <code>--color-\*-text<\/code>\)\./);
  assert.match(primary, /La dichiarazione <code>--color-tune-surface-lightness-shift<\/code> in <code>colors-tuning\.css<\/code> diventa ridondante: va rimossa o allineata\./);
});

test("rejected palette sources render only when valid, inside the proposals section", () => {
  const entries = [
    { id: "surface-hover", file: "tokens/palette.css", reason: "non raggiunge il minimo" },
    { id: "dark-border", file: "tokens/palette.css", reason: "copre solo un tema" },
  ];
  const input = issueReport({ proposals: [proposal()], rejectedSources: [
    ...entries,
    { id: 5, file: "tokens/palette.css", reason: "id non valido" },
    { id: "missing-reason", file: "tokens/palette.css" },
    { id: "missing-file", reason: "file assente" },
    "testo", null,
  ] });
  const html = render(input);
  const proposals = proposalsSection(html);
  assert.match(proposals, /Nessuna alternativa verificata in palette\.css/);
  assert.match(proposals, /Per questi problemi non esiste un’alternativa verificata in palette\.css\./);
  assert.match(proposals, /<code>surface-hover<\/code> — non raggiunge il minimo/);
  assert.match(proposals, /<code>dark-border<\/code> — copre solo un tema/);
  assert.doesNotMatch(proposals, /missing-reason|missing-file|<code>5<\/code>/);
  assert.deepEqual(prepareContrastReport(input).rejectedSources, entries);
  assert.doesNotMatch(render(issueReport({ rejectedSources: [{ id: "", file: "tokens/palette.css", reason: "x" }, "testo"] })), /Nessuna alternativa verificata/);
});

test("invalid structural fields render nothing and never invent values", () => {
  const tuningWithoutKey = publicContent(proposalsSection(render(issueReport({ proposals: [proposal({
    kind: "tuning", configKey: 42, configValue: -0.018, restoresConfig: true,
  })] }))));
  assert.doesNotMatch(tuningWithoutKey, /Il valore di build vive|<code>42<\/code>/);

  const tuningBadValue = publicContent(proposalsSection(render(issueReport({ proposals: [proposal({
    kind: "tuning", configKey: "derivation.surface.lightShift", configValue: Number.POSITIVE_INFINITY, restoresConfig: true,
  })] }))));
  assert.match(tuningBadValue, /Il valore di build vive in <code>smart-colors\.config\.mjs<\/code> \(<code>derivation\.surface\.lightShift<\/code>\)/);
  assert.doesNotMatch(tuningBadValue, /Infinity|NaN|non disponibile/);

  const configBadValue = publicContent(proposalsSection(render(issueReport({ proposals: [proposal({
    kind: "config", configKey: "derivation.surface.lightShift", promotedValue: "14", configToken: 5,
  })] }))));
  assert.doesNotMatch(configBadValue, /Definizione strutturale|La dichiarazione/);
});

test("file roles distinguish build-time config from runtime tuning and palette sources", () => {
  assert.match(renderer.fileRole("smart-colors.config.mjs"), /Definizioni strutturali di build \(derivazioni e companion\)/);
  assert.match(renderer.fileRole("tokens/colors-tuning.css"), /Regolazioni a runtime/);
  assert.match(renderer.fileRole("tokens/palette.css"), /Fonte iniziale/);
});

test("proposal cards report the border side effect as information, never as a verification", () => {
  const entry = (ratio, scheme = "dark") => ({ label: `${scheme} primary-border / canvas`, scheme, foregroundToken: "--color-primary-border", backgroundToken: "--color-bg",
    before: { color: color(0.4), ratio: 4.2 }, after: { color: color(0.5), ratio }, provenance: "browser-proposal-side-effect" });
  const html = render(issueReport({ proposals: [proposal({ sideEffects: [entry(4.5)] })] }));
  const primary = publicContent(proposalsSection(html));
  assert.match(primary, /Altro effetto della stessa modifica/);
  assert.match(primary, /--color-primary-border<\/code> su <code>--color-bg<\/code> \(tema scuro\): da <span class="contrast-value">4,20:1<\/span> a <span class="contrast-value">4,50:1<\/span> — in aumento\./);
  assert.match(primary, /Misura informativa: questo bordo non fa parte delle coppie verificate/);
  assert.match(primary, /Verificata nello snapshot/);
  assert.doesNotMatch(primary, /Resta sotto il riferimento 3:1/);
  const degraded = publicContent(proposalsSection(render(issueReport({ proposals: [proposal({ sideEffects: [entry(2.999999999998, "light")] })] }))));
  assert.match(degraded, /\(tema chiaro\)/);
  assert.match(degraded, /da <span class="contrast-value">4,20:1<\/span> a <span class="contrast-value">&lt; 3:1<\/span> — in calo\. Resta sotto il riferimento 3:1 per bordi e icone necessari/);
  const unsafe = render(issueReport({ proposals: [proposal({ sideEffects: [
    { ...entry(4.5), after: { color: { l: "0);display:none", c: 0, h: 0 }, ratio: 4.5 } },
    { ...entry(4.5), before: { color: color(0.4), ratio: NaN } },
    null, "text",
  ] })] }));
  const declared = publicContent(proposalsSection(unsafe));
  assert.match(declared, /Effetto collaterale dichiarato ma non misurabile/);
  assert.doesNotMatch(unsafe, /0\);display:none|display:none/);
  const absent = publicContent(proposalsSection(render(issueReport({ proposals: [proposal()] }))));
  assert.doesNotMatch(absent, /Altro effetto della stessa modifica|non misurabile/);
});

function deepFreeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}

test("exports the renderer with its internal helpers and returns a complete marked static Italian document", () => {
  assert.deepEqual(Object.keys(renderer).sort(), [
    "CSP", "MARKER", "VARIANT_SHIFT_THRESHOLD", "agree", "automationHtml", "automationScope", "baselineNote", "colorChoice", "colorCss", "compactRatio",
    "cssEmbedHtml", "deltaSummary", "entriesFor", "escape", "familyAtlasData", "fileRole", "formatContrastReportHtml",
    "isDiagnosticSession", "issueGroups", "it", "list", "overlapList", "overlapView", "prepareContrastReport", "prepareDiagnosticReport", "proposalSentence", "proposalView", "record",
    "sampleVisual", "sessionIdentityHtml", "sessionVerification", "sideEffectsHtml", "status", "validation", "variantShiftView",
  ]);
  const html = render(issueReport());
  assert.equal(html.split("\n")[0], "<!-- smart-colors-report:v1 -->");
  assert.match(html, /<!doctype html>\s*<html lang="it">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<h1>Rapporto di contrasto<\/h1>/);
  assert.ok((html.match(/<h1>/g) ?? []).length === 1);
  assert.match(html, /<main id="contenuto">/);
  assert.match(html, /<h2[^>]*>Palette originale e colori risolti/);
  assert.match(html, /<h3>primary<\/h3>/);
  assert.match(html, /<details[^>]*><summary>/);
  assert.match(html, /<\/body><\/html>\n$/);
});

test("CSP denies scripts and network resources; there are no fake actions or external dependencies", () => {
  const html = render(issueReport({ proposals: [proposal()] }));
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replaceAll("&#39;", "'");
  for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "img-src 'none'", "font-src 'none'", "object-src 'none'", "base-uri 'none'", "form-action 'none'"]) assert.ok(csp.includes(directive));
  assert.ok(csp.includes("style-src 'unsafe-inline'"));
  assert.doesNotMatch(html, /<(?:script|link|img|iframe|button|input|form)\b|\bon\w+=|\ssrc=/i);
  assert.doesNotMatch(html, /@import|url\(|https?:\/\//i);
  assert.ok([...html.matchAll(/href="([^"]+)"/g)].every((match) => match[1].startsWith("#")));
  assert.match(html, /<pre tabindex="0" role="group" aria-label="Snippet della proposta"><code>--primary:/);
  assert.match(html, /user-select:\s*text/);
});

test("static report keeps every IDREF closed and names only elements with an explicit role", () => {
  const html = render(issueReport({ proposals: [proposal()] }));
  const refs = idReferences(html);
  assert.ok(refs.length > 0, "the report must expose at least the skip link and ARIA references");
  for (const ref of refs) assert.ok(ref.exists, `${ref.attr} must resolve to an existing id: ${ref.id}`);
  for (const tag of html.matchAll(/<(div|span|pre)\b([^>]*)>/g)) {
    if (/\baria-label=/.test(tag[2])) assert.match(tag[2], /\brole="[^"]+"/, `${tag[1]} must expose a role when it is named`);
  }
  const snippet = html.match(/<pre\b[^>]*aria-label="Snippet della proposta"[^>]*>/)[0];
  assert.match(snippet, /\brole="group"/);
});

test("report heading hierarchy never skips a level for snapshot, model and measured sessions", () => {
  for (const [label, html] of [
    ["snapshot", render(issueReport({ proposals: [proposal()] }))],
    ["model session", render(diagnosticSession())],
    ["measured session", render(measuredSession())],
  ]) {
    const levels = headingLevels(html);
    assert.equal(levels[0], 1, `${label}: the report must start with one h1`);
    for (let index = 1; index < levels.length; index += 1) {
      assert.ok(levels[index] <= levels[index - 1] + 1, `${label}: heading jump ${levels[index - 1]} → ${levels[index]}`);
    }
  }
});

test("family cards keep their h4 identity under an h3 in both measured and model catalogs", () => {
  const measured = render(measuredSession());
  assert.match(section(measured, "usi"), /<h3>Famiglie di colori: come appaiono nei componenti<\/h3>[\s\S]*<article class="card family-card"><h4>Famiglia/);
  assert.match(section(measured, "sessione"), /<h3 class="model-atlas-title">Famiglie di colori nel modello<\/h3>[\s\S]*<article class="card family-card"><h4>Famiglia/);
  const model = render(diagnosticSession());
  assert.match(section(model, "sessione"), /<h3 class="model-atlas-title">Famiglie di colori nel modello<\/h3>[\s\S]*<article class="card family-card"><h4>Famiglia/);
  assert.match(measured, /\.family-card h4 \{ margin-block-end: var\(--space-3\); \}/);
  assert.match(measured, /\.model-atlas-title \{ margin-block: var\(--space-4\) var\(--space-3\); \}/);
});

test("layout and accessibility contracts use intrinsic grids, native disclosures, focus and semantic tables", () => {
  const html = render(issueReport({ proposals: [proposal()] }));
  assert.match(html, /repeat\(auto-fit, minmax\(min\(100%, 22rem\), 1fr\)\)/);
  assert.doesNotMatch(html, /@media[^\{]*(?:min-width|max-width|width\s*[<>:])/);
  assert.match(html, /:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  assert.match(html, /@media \(forced-colors: active\)/);
  assert.match(html, /href="#contenuto"/);
  assert.match(html, /<details><summary>Issue:/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  for (const table of html.matchAll(/<table>([\s\S]*?)<\/table>/g)) {
    assert.match(table[1], /<caption>.+<\/caption>/);
    assert.match(table[1], /<th scope="col">/);
    assert.match(table[1], /<th scope="row">/);
    assert.doesNotMatch(table[1], /<th>/);
  }
  assert.match(html, /class="table-scroll" tabindex="0" role="region" aria-label=/);
});

test("escaping covers text, filenames, nested provenance, snippets, identities and malformed metadata", () => {
  const attack = '\"><img src=x onerror=alert(1)><script>bad()</script><style>body{display:none}</style>&\'';
  const input = issueReport({
    generatedAt: attack, inputDigest: attack,
    files: Object.fromEntries(["palette", "config", "tuning", "output"].map((key) => [key, `${key}${attack}`])),
    palette: [{ name: attack, role: attack, authored: color(), resolved: color(), darkBlend: { [attack]: attack } }],
    scenarios: [scenario({ browser: attack, preference: attack, provenance: { source: attack }, diagnostics: [diagnostic({ label: attack, foregroundToken: attack, backgroundToken: attack, ratio: 4, provenance: attack })] })],
    proposals: [proposal({ id: attack, title: attack, kind: attack, impact: attack, search: attack,
      destination: { file: attack, path: attack, snippet: `</code></pre>${attack}` },
      issueLabels: [attack], changes: [{ label: attack, before: color(), after: color(0.4) }],
      checks: [diagnostic({ label: attack, browser: attack, preference: attack, foregroundToken: attack, backgroundToken: attack, provenance: attack })],
    })],
    generationErrors: [attack], auditErrors: [attack], notes: [attack],
  });
  const html = render(input);
  assert.doesNotMatch(html, /<img\b|<script\b|<style>body|<\/code><\/pre>\"><img/);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(html.includes("&lt;/code&gt;&lt;/pre&gt;"));
  assert.ok(html.includes("&amp;&#39;"));
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
  assert.equal((html.match(/<\/style>/g) ?? []).length, 1);
  assert.ok(styles(html).every((style) => !style.includes("img") && !style.includes("alert") && !style.includes("&")));
  assert.doesNotMatch(header(html), /<time/);
  assert.match(html, /Esito non verificato o incompleto/);
  assert.doesNotMatch(html, /href="[^#]/);
});

test("malicious numeric strings never enter CSS, including proposal and palette colors", () => {
  const attack = '0);background-image:url(https://evil.invalid/);--x:"</style><script>x</script>';
  for (const channel of ["l", "c", "h"]) {
    const bad = { ...color(), [channel]: attack };
    const html = render(issueReport({
      palette: [{ name: "primary", role: "accent-text", authored: bad, resolved: bad }],
      scenarios: [scenario({ diagnostics: [diagnostic({ foreground: bad, background: bad, ratio: 4 })] })],
      proposals: [proposal({ changes: [{ label: "x", before: bad, after: bad }], checks: [diagnostic({ foreground: bad, background: bad })] })],
    }));
    assert.deepEqual(styles(html), []);
    assert.match(html, /OKLCH non valido:/);
    assert.match(html, /Campione non disponibile:/);
    assert.match(html, /Esito non verificato o incompleto/);
    assert.doesNotMatch(html, /<script>|style="[^"]*(?:evil|background-image)/);
  }
});

test("CSS numbers reject non-finite values, negative chroma, invalid lightness, missing channels and coercion", () => {
  const invalid = [
    color(NaN), color(Infinity), color(-Infinity), color(-0.1), color(1.1),
    color(0.5, -0.01), color(0.5, Infinity), color(0.5, NaN), color(0.5, 0.1, Infinity), color(0.5, 0.1, NaN),
    { l: 0.5, c: 0.1 }, { l: "0.5", c: 0.1, h: 0 }, { l: 0.5, c: "0.1", h: 0 },
    { l: 0.5, c: 0.1, h: "0" }, { l: null, c: 0.1, h: 0 }, null, [], {},
  ];
  for (const bad of invalid) {
    const html = render(report({ palette: [{ name: "primary", role: "accent-text", authored: bad, resolved: bad }], scenarios: [scenario({ diagnostics: [diagnostic({ foreground: bad, background: bad, ratio: 4 })] })] }));
    assert.deepEqual(styles(html), []);
    assert.match(header(html), /Esito non verificato o incompleto/);
  }
});

test("finite hue is allowed outside the canonical turn and valid CSS retains original numeric precision", () => {
  for (const h of [-725, 725, Number.MAX_VALUE]) {
    const sample = color(0.5000000000000001, 0, h);
    const html = render(report({ palette: [{ name: "primary", role: "accent-text", authored: sample, resolved: sample }] }));
    assert.ok(styles(html).includes(`--sample-color:oklch(0.5000000000000001 0 ${h})`));
    assert.match(header(html), /Esito positivo dello snapshot: 0 issue/);
  }
});

test("original palette retains authored and resolved swatches, OKLCH, role, dark blend and gamut differences", () => {
  const html = render(report());
  assert.match(html, /Fonte originale<\/strong> — <code>oklch\(0\.5 0\.3 350\)/);
  assert.match(html, /Colore risolto<\/strong> — <code>oklch\(0\.5 0\.1 350\)/);
  assert.match(html, /Ruolo: <code>accent-text<\/code>/);
  assert.match(html, /Differenza fonte\/risolto presente \(eventuale adattamento gamut\)/);
  assert.match(html, /Miscela dark dichiarata: <code>0\.78<\/code>/);
  const same = render(report({ palette: [{ name: "primary", role: "accent-text", authored: color(), resolved: color() }] }));
  assert.match(same, /Nessuna differenza fonte\/risolto/);
});

test("intentional text and border samples are hidden from assistive output and always accompanied by readable pair data", () => {
  for (const kind of ["text", "non-text"]) {
    const html = render(issueReport({ scenarios: [scenario({ diagnostics: [diagnostic({ kind, ratio: 1, foreground: color(1, 0, 0), background: color(1, 0, 0) })] })] }));
    assert.match(html, /class="pair-visual" aria-hidden="true" style="--sample-fg:oklch\(1 0 0\);--sample-bg:oklch\(1 0 0\)"/);
    assert.match(html, /può risultare illeggibile; i dati sono sulla UI neutra/);
    assert.match(html, /Primo piano \(foreground\)/);
    assert.match(html, /Sfondo \(background\)/);
    assert.match(html, /<code>1:1<\/code> \/ <code>4\.5:1<\/code> \/ <code>4\.6:1<\/code>/);
    assert.ok(html.includes(kind === "text" ? 'class="pair-text"' : 'class="pair-border"'));
    assert.ok(!html.includes(kind === "text" ? '<span class="pair-border">' : '<span class="pair-text">'));
  }
});

test("full ratios and threshold boundaries never round a shortfall into a pass", () => {
  for (const value of [4.5 - Number.EPSILON * 4, 4.5, 4.6 - Number.EPSILON * 4, 4.6]) {
    const html = render(report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: value, baselineRatio: 4.500000000000001 })] })] }));
    assert.ok(html.includes(`<code>${String(value)}:1</code>`));
    assert.ok(html.includes("<code>4.500000000000001:1</code>"));
    assert.ok(html.includes("<code>4.5:1</code>"));
    assert.ok(html.includes("<code>4.6:1</code>"));
    if (value < 4.5) assert.match(html, /Issue:.*Sotto il minimo/);
    else if (value < 4.6) assert.match(html, /Issue:.*Sotto il target/);
    else assert.match(header(html), /Esito positivo dello snapshot: 0 issue/);
  }
  const belowMinimum = render(report({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.4, target: 4 })] })] }));
  assert.match(belowMinimum, /Sotto il minimo/);
});

test("inconsistent statuses, invalid ratios and invalid kinds fail closed", () => {
  for (const overrides of [{ ratio: 4, status: "pass" }, { ratio: 5, status: "below-target" }, { ratio: NaN }, { ratio: Infinity }, { ratio: "4.6" }, { ratio: 0 }, { ratio: 22 }, { minimum: -1 }, { target: Infinity }, { kind: "other" }, { baselineRatio: "5" }]) {
    const html = render(report({ scenarios: [scenario({ diagnostics: [diagnostic(overrides)] })] }));
    assert.match(header(html), /Esito non verificato o incompleto/);
    assert.doesNotMatch(header(html), /Esito positivo/);
    assert.match(html, /Non verificato: dati mancanti, non validi o incoerenti/);
  }
});

test("light and dark remain separate scenarios, with browser, preference, provenance and baseline retained", () => {
  const light = scenario({ diagnostics: [diagnostic({ ratio: 4.4, baselineRatio: 4.2 })] });
  const dark = scenario({ browser: "webkit", scheme: "dark", preference: "more", provenance: { source: "playwright", engine: "webkit" }, diagnostics: [diagnostic({ scheme: "dark", ratio: 2.99, target: 3, minimum: 3, kind: "non-text", provenance: "browser: clipped sRGB" })] });
  const html = render(report({ scenarios: [light, dark] }));
  assert.match(html, /<h3>chromium · light · no-preference<\/h3>/);
  assert.match(html, /<h3>webkit · dark · more<\/h3>/);
  assert.match(html, /browser: computed styles/);
  assert.match(html, /generated/);
  assert.match(html, /&quot;source&quot;: &quot;playwright&quot;/);
  assert.match(html, /browser: clipped sRGB/);
  assert.match(html, /4\.2:1/);
  assert.match(html, /2\.99:1/);
  assert.match(header(html), /2 problemi di contrasto · 0 correzioni verificate/);
  assert.equal((scenarioSection(html).match(/Nessuna proposta verificata per questa coppia/g) ?? []).length, 2);
});

test("only explicitly verified proposals are rendered; snippets stay text and report is not a writer", () => {
  const hidden = [false, undefined, "true", 1].map((verified, index) => proposal({ verified, title: `HIDDEN-${index}`, destination: { file: "secret", path: "secret", snippet: `HIDDEN-SNIPPET-${index}` } }));
  const html = render(issueReport({ proposals: [...hidden, proposal()] }));
  assert.doesNotMatch(html, /HIDDEN|secret/);
  assert.match(html, /Proposta verificata per le coppie coperte nello snapshot/);
  assert.match(html, /href="#proposal-1"/);
  assert.match(html, /Coppie complete: 1\/1; issue coperte: 1\/1/);
  assert.match(html, /Prima — snapshot originale/);
  assert.match(html, /Dopo — proposta/);
  assert.match(html, /File<\/dt><dd><code>tokens\/palette\.css/);
  assert.match(html, /Percorso nella configurazione<\/dt><dd><code>primary/);
  assert.match(html, /il report non modifica file/);
});

test("before pairs come from diagnostics, not palette changes, and after checks retain independent foreground and background", () => {
  const before = diagnostic({ ratio: 4.1, foreground: color(0.55), background: color(0.95, 0, 40) });
  const after = diagnostic({ ratio: 5.123456789123456, foreground: color(0.45), background: color(0.9, 0.01, 50), provenance: "browser after" });
  const html = render(issueReport({ scenarios: [scenario({ diagnostics: [before] })], proposals: [proposal({ changes: [{ label: "not the pair", before: color(0.7), after: color(0.6) }], checks: [after] })] }));
  const section = proposalsSection(html);
  assert.ok(section.includes("--sample-fg:oklch(0.55 0.1 350);--sample-bg:oklch(0.95 0 40)"));
  assert.ok(section.includes("--sample-fg:oklch(0.45 0.1 350);--sample-bg:oklch(0.9 0.01 50)"));
  assert.ok(section.includes("5.123456789123456:1"));
  assert.match(section, /Provenienza prima: browser: computed styles; diagnostica: generated/);
  assert.match(section, /Provenienza dopo: browser after/);
});

test("missing or ambiguous original diagnostics and duplicate checks never invent before samples or coverage", () => {
  const cases = [
    { checks: [diagnostic({ label: "nonexistent" })], issueLabels: ["nonexistent"] },
    { checks: [diagnostic({ browser: "firefox" })] },
    { checks: [diagnostic({ preference: "more" })] },
    { checks: [diagnostic({ backgroundToken: "--other-bg" })] },
    { checks: [diagnostic({ scheme: "dark" })] },
    { checks: [diagnostic({ foreground: null })] },
    { checks: [diagnostic(), diagnostic()] },
    { checks: [] },
    { issueLabels: [] },
    { changes: [] },
    { destination: {} },
  ];
  for (const changes of cases) {
    const html = render(issueReport({ proposals: [proposal(changes)] }));
    assert.match(html, /Verifica incompleta: nessuna copertura attribuita/);
    assert.match(scenarioSection(html), /Nessuna proposta verificata per questa coppia/);
    assert.doesNotMatch(scenarioSection(html), /href="#proposal-/);
  }
  const ambiguous = render(issueReport({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4 })] }), scenario({ browser: "firefox", diagnostics: [diagnostic({ ratio: 4 })] })], proposals: [proposal({ checks: [diagnostic()] })] }));
  assert.match(proposalsSection(ambiguous), /coppia originale assente, ambigua/);
  assert.doesNotMatch(proposalsSection(ambiguous), /Prima — snapshot originale/);
});

test("coverage needs every affected scenario and the exact target and minimum, not a rounded pass", () => {
  for (const value of [4.6 - Number.EPSILON * 4, 4.5 - Number.EPSILON * 4]) {
    const html = render(issueReport({ proposals: [proposal({ checks: [diagnostic({ ratio: value })] })] }));
    assert.match(scenarioSection(html), /Nessuna proposta verificata/);
    assert.match(proposalsSection(html), /Verifica incompleta/);
  }
  const scenarios = [scenario({ diagnostics: [diagnostic({ ratio: 4 })] }), scenario({ browser: "firefox", diagnostics: [diagnostic({ ratio: 4 })] })];
  const incomplete = render(report({ scenarios, proposals: [proposal()] }));
  assert.match(proposalsSection(incomplete), /issue coperte: 0\/2/);
  const complete = render(report({ scenarios, proposals: [proposal({ checks: [diagnostic({ browser: "chromium" }), diagnostic({ browser: "firefox" })] })] }));
  assert.match(proposalsSection(complete), /Coppie complete: 2\/2; issue coperte: 2\/2/);
  assert.doesNotMatch(scenarioSection(complete), /Nessuna proposta verificata/);
});

test("proposal completeness requires every original control, even outside named issues", () => {
  const original = [diagnostic({ ratio: 4 }), diagnostic({ label: "passing control", ratio: 5 }),
    diagnostic({ label: "unrelated shortfall", ratio: 4.55 })];
  const checks = original.map((item, index) => index === 0 ? diagnostic({ ratio: 6 }) : { ...item });
  const input = issueReport({ scenarios: [scenario({ diagnostics: original })], proposals: [proposal({ checks })] });
  assert.equal(prepareContrastReport(input).complete.length, 1);
  for (const missingIndex of [0, 1, 2]) {
    const partial = { ...input, proposals: [proposal({ checks: checks.filter((_, index) => index !== missingIndex) })] };
    const prepared = prepareContrastReport(partial);
    assert.equal(prepared.verified, true, "The original snapshot is still valid");
    assert.equal(prepared.proposals[0].complete, false);
    assert.equal(prepared.proposals[0].covered.size, 0);
    assert.equal(prepared.complete.length, 0);
    const html = render(partial);
    assert.match(header(html), /0 correzioni verificate/);
    assert.match(proposalsSection(html), /Verifica incompleta: nessuna copertura attribuita/);
    assert.doesNotMatch(proposalsSection(html), /color-choice--suggested|<strong>Suggerito<\/strong>/);
    assert.doesNotMatch(scenarioSection(html), /href="#proposal-/);
  }
  const duplicate = { ...input, proposals: [proposal({ checks: [checks[0], checks[1], checks[1]] })] };
  assert.equal(prepareContrastReport(duplicate).complete.length, 0, "Equal counts cannot replace a missing control with a duplicate");
});

test("minimum ratio includes all checks, including unaffected pairs, and provenance is never synthesized", () => {
  const other = diagnostic({ label: "altra coppia", ratio: 5 });
  const input = issueReport({
    scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4 }), other] })],
    proposals: [proposal({ checks: [diagnostic({ ratio: 6, provenance: undefined }), diagnostic({ label: "altra coppia", ratio: 4.7, provenance: "browser verified" })] })],
  });
  const html = proposalsSection(render(input));
  assert.match(html, /Coppie complete: 2\/2/);
  assert.match(html, /Rapporto minimo del testo: <code>4\.7:1<\/code>/);
  assert.match(html, /Provenienza dopo: Non disponibile \(se assente, non dedotta\)/);
  assert.match(html, /browser verified/);
  const partial = proposalsSection(render(issueReport({ proposals: [proposal({ checks: [diagnostic(), diagnostic({ ratio: NaN })] })] })));
  assert.match(partial, /validi disponibili \(insieme incompleto\)/);
});

test("delta metrics are numerical OKLab distances with shortest signed hue arcs", () => {
  const html = proposalsSection(render(issueReport({ proposals: [proposal({ changes: [
    { label: "hue forward", before: color(0.5, 0.1, 350), after: color(0.5, 0.1, 10) },
    { label: "hue reverse", before: color(0.5, 0.1, 10), after: color(0.5, 0.1, 350) },
    { label: "lightness", before: color(0.5, 0.1, 350), after: color(0.6, 0.1, 350) },
    { label: "chroma", before: color(0.5, 0.1, 350), after: color(0.5, 0.2, 350) },
  ] })] })));
  assert.match(html, /ΔL 0; ΔC 0; ΔH 20° \(arco più breve\); ΔEOK 0\.034729636/);
  assert.match(html, /ΔH -20° \(arco più breve\)/);
  assert.match(html, /ΔL 0\.1; ΔC 0; ΔH 0° \(arco più breve\); ΔEOK 0\.1/);
  assert.match(html, /ΔL 0; ΔC 0\.1; ΔH 0° \(arco più breve\); ΔEOK 0\.1/);
  assert.match(html, /scala 0–1, non ×100/);
  assert.match(html, /ΔEOK non è una misura di contrasto/);
});

test("empty, malformed and data-less reports explicitly remain unverified and do not throw", () => {
  const invalid = [undefined, null, [], "", 42, {}, { scenarios: [null, {}], palette: [null], proposals: [null, {}] }, report({ scenarios: [] }), report({ scenarios: [scenario({ diagnostics: [] })] }), report({ scenarios: [null] }), report({ palette: null }), report({ files: {} }), report({ inputDigest: "not-sha256" }), report({ generatedAt: "yesterday" }), report({ notes: [null] })];
  for (const input of invalid) {
    const html = render(input);
    assert.match(header(html), /Esito non verificato o incompleto/);
    assert.doesNotMatch(header(html), /Esito positivo|Snapshot verificato:/);
    assert.match(html, /Nessuna conclusione positiva/);
    assert.ok(html.startsWith("<!-- smart-colors-report:v1 -->\n"));
  }
});

test("generation and audit errors prevent positive outcomes, while notes are displayed without changing valid results", () => {
  for (const key of ["generationErrors", "auditErrors"]) {
    const html = render(report({ [key]: ["Audit interrotto & incompleto"] }));
    assert.match(header(html), /Esito non verificato o incompleto/);
    assert.match(html, /Audit interrotto &amp; incompleto/);
  }
  assert.match(header(render(report({ notes: ["Nota informativa"] }))), /Esito positivo dello snapshot: 0 issue/);
});

test("snapshot warning and time stay visible; full fingerprint and file identity move to technical details, never freshness", () => {
  const input = report();
  const html = render(input);
  const top = header(html);
  assert.match(top, /Esito positivo dello snapshot: 0 issue/);
  assert.match(top, /Snapshot statico, non stato attuale del progetto/);
  assert.match(top, /Rigenera il report dopo ogni modifica/);
  assert.ok(top.includes(input.generatedAt));
  assert.ok(!top.includes(input.inputDigest));
  const identity = section(html, "esito");
  assert.match(identity, /non ne ricalcola l’impronta e non si aggiorna/);
  assert.ok(identity.includes(input.inputDigest));
  for (const path of Object.values(input.files).filter(Boolean)) assert.ok(identity.includes(path));
  assert.ok(top.includes(`<time datetime="${input.generatedAt}">`));
  assert.ok(!publicContent(html).includes(input.inputDigest));
  const newer = render(report({ generatedAt: "2026-07-02T12:34:56.789Z", inputDigest: "b".repeat(64), files: { ...input.files, palette: "other/palette.css" } }));
  assert.notEqual(header(newer), top);
  assert.ok(!section(newer, "esito").includes(input.inputDigest));
  assert.ok(section(newer, "esito").includes("other/palette.css"));
  assert.equal(render(input), html);
});

test("lowering proposal thresholds does not solve an original issue, and unrelated checks cannot regress", () => {
  const lowered = render(issueReport({ proposals: [proposal({ checks: [diagnostic({ ratio: 4.5, target: 4, minimum: 3 })] })] }));
  assert.match(proposalsSection(lowered), /Verifica incompleta/);
  assert.match(scenarioSection(lowered), /Nessuna proposta verificata/);
  const regressed = render(issueReport({
    scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4 }), diagnostic({ label: "altra coppia", ratio: 5 })] })],
    proposals: [proposal({ checks: [diagnostic({ ratio: 6 }), diagnostic({ label: "altra coppia", ratio: 4.5, target: 4, minimum: 3 })] })],
  }));
  assert.match(proposalsSection(regressed), /Verifica incompleta/);
  assert.match(scenarioSection(regressed), /Nessuna proposta verificata/);
});

test("invalid snapshot identity or audit failure cannot confer verified proposal coverage", () => {
  for (const overrides of [{ inputDigest: "invalid" }, { generatedAt: null }, { auditErrors: ["Audit incompleto"] }]) {
    const html = render(issueReport({ ...overrides, proposals: [proposal()] }));
    assert.match(header(html), /Esito non verificato o incompleto/);
    assert.match(proposalsSection(html), /Verifica incompleta/);
    assert.match(scenarioSection(html), /Nessuna proposta verificata/);
  }
});

test("invalid calendar dates and absent required file identities cannot look like successful snapshots", () => {
  for (const generatedAt of ["2026-02-30T12:00:00Z", "2025-02-29T12:00:00Z", "2026-13-01T00:00:00Z", "2026-07-01T12:34:56Z\n"]) {
    const html = render(report({ generatedAt }));
    assert.match(header(html), /Esito non verificato o incompleto/);
    assert.doesNotMatch(header(html), /<time/);
  }
  for (const key of ["palette", "output"]) {
    assert.match(header(render(report({ files: { ...report().files, [key]: null } }))), /Esito non verificato o incompleto/);
  }
  assert.match(header(render(report({ inputDigest: "a".repeat(64) + "\n" }))), /Esito non verificato o incompleto/);
    assert.match(header(render(report({ generatedAt: "2024-02-29T12:00:00+02:00" }))), /Esito positivo dello snapshot/);
});

test("scenario mismatch or missing provenance stays unverified even with otherwise passing diagnostics", () => {
  for (const overrides of [{ scheme: "dark" }, { provenance: undefined }, { provenance: [] }, { preference: undefined }, { browser: undefined }]) {
    const html = render(report({ scenarios: [scenario(overrides)] }));
    assert.match(header(html), /Esito non verificato o incompleto/);
    assert.match(scenarioSection(html), /Issue:.*Non verificato: dati mancanti/);
    assert.doesNotMatch(scenarioSection(html), /Nessuna issue/);
  }
});

test("changed proposal rows retain explicit browser and preference while unchanged rows are counted, not reprinted", () => {
  const html = proposalsSection(render(issueReport({
    scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4 })] }), scenario({ browser: "webkit", preference: "more", diagnostics: [diagnostic({ label: "other", browser: "webkit", preference: "more" })] })],
    proposals: [proposal({ checks: [diagnostic({ browser: "chromium", preference: "no-preference" }), diagnostic({ label: "other", browser: "webkit", preference: "more" })] })],
  })));
  assert.match(html, /<td>chromium \/ light \/ no-preference<\/td>/);
  assert.match(html, /Controlli cambiati dalla proposta — 1 di 2/);
  assert.match(html, /Altri 1 controlli invariati: rapporto identico al valore già misurato negli scenari/);
  const table = html.slice(html.indexOf("Controlli cambiati dalla proposta — 1 di 2"));
  assert.doesNotMatch(table, /<td>webkit \/ light \/ more<\/td>/, "An identical measurement is counted once, not reprinted");
});

test("shared preparation exposes the snapshot summary without mutating frozen inputs", () => {
  const input = issueReport({
    scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4, baselineRatio: 5 })] })],
    proposals: [proposal()],
  });
  const before = structuredClone(input);
  deepFreeze(input);
  const prepared = prepareContrastReport(input);
  assert.deepEqual(Object.keys(prepared).sort(), [
    "report", "scenarios", "entries", "problems", "iso", "digest", "issues", "errors", "verified", "proposals",
    "groups", "overlaps", "variantShifts", "tuningGroups", "complete", "rejectedSources", "outcome", "files",
  ].sort());
  assert.equal(prepared.report, input);
  assert.equal(prepared.scenarios, input.scenarios);
  assert.equal(prepared.files, input.files);
  assert.equal(prepared.verified, true);
  assert.equal(prepared.iso, true);
  assert.equal(prepared.digest, true);
  assert.deepEqual(prepared.problems, []);
  assert.deepEqual(prepared.errors, []);
  for (const key of ["entries", "issues", "groups", "tuningGroups", "proposals", "complete"]) assert.equal(prepared[key].length, 1, key);
  assert.equal(prepared.complete[0], prepared.proposals[0]);
  assert.deepEqual([...prepared.complete[0].covered], [prepared.entries[0].key]);
  assert.equal(prepared.outcome, "1 problema di contrasto · 1 correzione verificata");
  assert.deepEqual(prepareContrastReport(input), prepared);
  assert.deepEqual(input, before);
  assert.ok(header(render(input)).includes(prepared.outcome));
  assert.equal(prepareContrastReport(report()).outcome, "Esito positivo dello snapshot: 0 issue");
});

test("shared preparation fails closed and rendering cannot bypass snapshot validation", () => {
  const prepared = prepareContrastReport(issueReport({ proposals: [proposal()] }));
  for (const input of [undefined, null, [], {}, report({ scenarios: [] }),
    issueReport({ inputDigest: "invalid", proposals: [proposal()] }),
    issueReport({ auditErrors: ["Audit incompleto"], proposals: [proposal()] }),
    issueReport({ generationErrors: ["Generazione incompleta"], proposals: [proposal()] })]) {
    const result = prepareContrastReport(input);
    assert.equal(result.verified, false);
    assert.equal(result.outcome, "Esito non verificato o incompleto");
    assert.equal(result.complete.length, 0);
    assert.ok(result.proposals.every((view) => !view.complete && view.covered.size === 0));
    assert.equal(render(input, prepared), render(input), "No optional prepared-view bypass");
  }
  assert.equal(render.length, 1);
  assert.match(header(render(prepared)), /Esito non verificato o incompleto/);
});

test("rendering is deterministic, has no side effects on inputs and states scope limitations", () => {
  const input = issueReport({ proposals: [proposal()] });
  const before = structuredClone(input);
  deepFreeze(input);
  const html = render(input);
  assert.deepEqual(input, before);
  assert.equal(render(input), html);
  for (const phrase of ["sRGB con canali clipped", "non sostituisce un audit completo", "Trasparenze, foto, gradienti", "primo piano/sfondo", "né ricalcola i contrasti", "Nessuna garanzia di palette ottimale", "ricerca globale"]) assert.ok(html.includes(phrase), phrase);
});

// ---------------------------------------------------------------------------
// SC-03 diagnostic session: the static report presents the model and the
// automation, never as a local browser measurement, and never gains a script.
// ---------------------------------------------------------------------------

function diagnosticSession(overrides = {}) {
  const sample = (scheme) => ({
    browser: "model", scheme, preference: "no-preference", provenance: "model",
    diagnostics: [diagnostic({ scheme, foregroundToken: "--color-primary-text", backgroundToken: "--color-primary-surface", ratio: 4.2 })],
  });
  return {
    ...report({ scenarios: [] }),
    schemaVersion: 1,
    toolVersion: "0.3.0",
    snapshotId: "snap-123",
    config: { contrast: {}, roles: {} },
    inputs: [{ name: "palette", path: "tokens/palette.css", present: true, sha256: "b".repeat(64) }],
    css: { baseline: ":root { --color-bg: oklch(1 0 0); }", tuning: null, tuningSupport: "absent" },
    model: { diagnostics: [], errors: [], warnings: [] },
    samples: [sample("light")],
    automation: { provenance: "model", mode: "off", status: "disabled", expected: { scenarios: [], pairs: [] }, executed: { scenarios: [], pairs: [] }, measurements: [], errors: [], environment: null, measuredAt: null },
    ...overrides,
  };
}

test("a diagnostic session renders a scoped evidence section and links the preview as the primary action", () => {
  const html = render(diagnosticSession());
  assert.equal(html.split("\n")[0], "<!-- smart-colors-report:v1 -->");
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /href="smart-colors-preview\.html"/);
  assert.match(html, /Snapshot incorporato: <code>snap-123<\/code> · Versione tool: <code>0\.3\.0<\/code> · Input catturati: 1\/1\./);
  // The headline is scoped to the snapshot and to the environments actually executed, and the
  // static report never claims a browser-local measurement it does not contain.
  assert.match(html, /class="scope-note">L'esito sopra riguarda solo le coppie dello snapshot e l'automazione <strong>negli ambienti eseguiti<\/strong>/);
  assert.match(html, /class="preview-cta"><a href="smart-colors-preview\.html">Apri la preview diagnostica e verifica i contrasti nel browser attivo<\/a>/);
  assert.match(html, /<h2 id="sessione">Sessione diagnostica: ambito ed evidenze<\/h2>/);
  assert.match(html, /<dl class="session-evidence">/);
  assert.match(html, /<dt>Modello<\/dt><dd>1 coppia prevista — stima del modello, non una verifica<\/dd>/);
  assert.match(html, /<dt>Automazione<\/dt><dd>Automazione disattivata: nessuna misura browser è inclusa in questo snapshot\.<\/dd>/);
  assert.match(html, /<dt>Verifica locale<\/dt><dd>Non inclusa in questo report statico/);
  assert.match(html, /Campioni calcolati dal modello del generatore, non da misure browser/);
  assert.match(html, /<details><summary>Verifica automatizzata \(Playwright\) — dettagli, cause e misure<\/summary>/);
  assert.match(html, /Automazione disattivata/);
  assert.match(html, /<h2 id="css">CSS incorporato nello snapshot<\/h2>/);
  assert.match(html, /<a href="#sessione">Sessione diagnostica<\/a>/);
  assert.doesNotMatch(html, /class="color-choice color-choice--suggested"/);
});

test("the report keeps a scriptless CSP and adds no script for a diagnostic session", () => {
  const html = render(diagnosticSession());
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replaceAll("&#39;", "'");
  assert.ok(csp.includes("script-src 'none'"));
  assert.doesNotMatch(html, /<(?:script|iframe|button|input|form)\b|\son\w+=/i);
});

test("a diagnostic session escapes hostile identity and automation metadata", () => {
  const attack = '<script>"&\u2028</script>';
  const html = render(diagnosticSession({
    snapshotId: attack,
    toolVersion: attack,
    automation: { provenance: "model", mode: attack, status: "unavailable", expected: {}, executed: {}, measurements: [], errors: [], environment: { browser: attack, version: attack }, measuredAt: attack },
  }));
  assert.doesNotMatch(html, /<script>"&/);
  assert.ok(!html.includes(attack), "the raw attack string must never reach the markup");
  assert.match(html, /&lt;script&gt;&quot;&amp;/);
});

test("diagnostic session rendering is deterministic and never mutates the input", () => {
  const input = diagnosticSession();
  const before = structuredClone(input);
  deepFreeze(input);
  const html = render(input);
  assert.deepEqual(input, before);
  assert.equal(render(input), html);
});

test("the session detector accepts the SC-03 payload and rejects the legacy snapshot", () => {
  assert.equal(renderer.isDiagnosticSession(diagnosticSession()), true);
  assert.equal(renderer.isDiagnosticSession(report()), false);
  for (const value of [undefined, null, [], {}, { schemaVersion: 1 }, { schemaVersion: 1, css: {}, model: {}, samples: [] }]) {
    assert.equal(renderer.isDiagnosticSession(value), false);
  }
});

// Real VerificationRun shape (SC-05): engines[], environment.engines[], errors[] with
// phase/cause/message, expected/executed, measurements with threshold and ratio.
function automationRun(overrides = {}) {
  return {
    provenance: "browser-automation", mode: "required", status: "complete", snapshotId: "snap-123",
    engines: [{ name: "chromium", launched: true, status: "complete", version: "151.0.7922.34", executable: "/opt/chromium", phase: null, reason: null }],
    environment: { engines: [{ name: "chromium", version: "151.0.7922.34", executable: "/opt/chromium", environments: [{ userAgent: "Mozilla/5.0", language: "it-IT", preference: "light", forcedColors: false, measuredAt: "2026-07-01T12:00:00.000Z" }] }] },
    expected: { scenarios: ["chromium/baseline-light-light"], pairs: { "chromium/baseline-light-light": ["light|color|--color-primary-text|--color-primary-surface"] } },
    executed: { scenarios: ["chromium/baseline-light-light"], pairs: { "chromium/baseline-light-light": ["light|color|--color-primary-text|--color-primary-surface"] } },
    scenarios: [{ id: "chromium/baseline-light-light", theme: "light", variant: "baseline", preference: "light", status: "measured", reason: null, engine: "chromium" }],
    measurements: [{ pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "chromium/baseline-light-light", engine: "chromium", target: 4.6, minimum: 4.5, ratio: 4.7, status: "pass", error: null }],
    coverage: { complete: true, expectedCount: 1, measuredCount: 1, scenarios: [], duplicateScenarios: [], missingScenarios: [], unexpectedScenarios: [], duplicates: [], unmeasured: [] },
    unsupported: [], errors: [], notes: [], partial: false, measuredAt: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

test("automation details list versioned engines, phases, causes, thresholds and measurement groups", () => {
  const run = automationRun({
    partial: true,
    engines: [
      { name: "chromium", launched: true, status: "complete", version: "151.0.7922.34", executable: "/opt/chromium", phase: null, reason: null },
      { name: "firefox", launched: false, status: "unavailable", version: null, executable: null, phase: "availability", reason: "browser binary unavailable at /opt/firefox" },
    ],
    errors: [
      { phase: "availability", cause: "binary-missing", engine: "firefox", scenarioId: null, pairId: null, message: "firefox: install it with pnpm exec playwright install firefox" },
      { phase: "measure", cause: "runtime-run-failed", engine: "chromium", scenarioId: null, pairId: null, message: "preferenza dark: timeout" },
    ],
    measurements: [
      { pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "chromium/baseline-light-light", engine: "chromium", target: 4.6, minimum: 4.5, ratio: 4.2, status: "below-minimum", error: null },
      { pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "webkit/baseline-light-light", engine: "webkit", target: 4.6, minimum: 4.5, ratio: 4.4, status: "below-target", error: null },
      { pairId: "dark|color|--color-primary-text|--color-primary-surface", scenarioId: "chromium/baseline-dark-dark", engine: "chromium", target: 4.5, minimum: 4.5, ratio: 3.9, status: "below-minimum", error: null },
    ],
  });
  const html = render(diagnosticSession({ automation: run }));
  assert.match(html, /Copertura parziale o incompleta/);
  assert.doesNotMatch(html, /Copertura completa negli ambienti eseguiti \(/);
  assert.match(html, /<div><dt>Motori eseguiti<\/dt><dd>1 di 2<\/dd><\/div>/);
  assert.match(html, /<div><dt>Copertura<\/dt><dd>parziale o incompleta<\/dd><\/div>/);
  assert.match(html, /<div><dt>Errori di misura<\/dt><dd>1<\/dd><\/div>/);
  assert.match(html, /<div><dt>Errori d&#39;ambiente<\/dt><dd>1<\/dd><\/div>/);
  assert.match(html, /<code>chromium<\/code> 151\.0\.7922\.34 · Completa · eseguito/);
  assert.match(html, /<code>firefox<\/code> · Non disponibile · non eseguito · fase <code>availability<\/code> — browser binary unavailable at \/opt\/firefox/);
  assert.match(html, /<h4>Errori dell'automazione \(2\)<\/h4>/);
  assert.match(html, /<code>availability<\/code> · <code>binary-missing<\/code> — firefox:/);
  assert.match(html, /<code>measure<\/code> · <code>runtime-run-failed<\/code> — preferenza dark: timeout/);
  assert.match(html, /<h4>Misure automatizzate \(3\)<\/h4>/);
  assert.match(html, /<caption>Misure automatizzate per coppia<\/caption>/);
  assert.match(html, /<th scope="row"><code>--color-primary-text<\/code> su <code>--color-primary-surface<\/code><\/th><td>Chiaro<\/td><td><code>4\.5:1<\/code><\/td><td><code>4\.6:1<\/code><\/td><td>4,20:1<\/td><td>Sotto il minimo<\/td><td>2<\/td>/);
  assert.match(html, /<td>Scuro<\/td><td><code>4\.5:1<\/code><\/td><td><code>4\.5:1<\/code><\/td><td>3,90:1<\/td><td>Sotto il minimo<\/td><td>1<\/td>/);
  assert.match(html, /<strong>Copertura non verificata:<\/strong>/);
});

test("an incomplete automation run with zero measurements still lists causes and unsupported reasons", () => {
  const run = automationRun({
    status: "incomplete", partial: true,
    coverage: { complete: false, expectedCount: 2, measuredCount: 0, scenarios: [], duplicateScenarios: [], missingScenarios: ["chromium/baseline-light-light"], unexpectedScenarios: [], duplicates: [], unmeasured: [] },
    engines: [{ name: "chromium", launched: true, status: "incomplete", version: "151.0", executable: "/opt/chromium", phase: "measure", reason: "preferenza light: timeout" }],
    measurements: [],
    errors: [{ phase: "measure", cause: "runtime-run-failed", engine: "chromium", scenarioId: null, pairId: null, message: "preferenza light: timeout" }],
    unsupported: [{ id: "chromium/baseline-dark-dark", reason: "forced-colors is active", engine: "chromium" }],
    expected: { scenarios: ["chromium/baseline-light-light", "chromium/baseline-dark-dark"], pairs: {} },
    executed: { scenarios: [], pairs: {} },
  });
  const html = render(diagnosticSession({ automation: run }));
  assert.match(html, /Copertura parziale o incompleta/);
  assert.doesNotMatch(html, /Copertura completa/);
  assert.match(html, /<div><dt>Scenari<\/dt><dd>0 di 2 eseguiti<\/dd><\/div>/);
  assert.match(html, /<h4>Errori dell'automazione \(1\)<\/h4>/);
  assert.match(html, /<code>measure<\/code> · <code>runtime-run-failed<\/code> — preferenza light: timeout/);
  assert.match(html, /<h4>Scenari non supportati \(1\)<\/h4>/);
  assert.match(html, /<code>chromium\/baseline-dark-dark<\/code> — forced-colors is active · motore <code>chromium<\/code>/);
  assert.doesNotMatch(html, /<h4>Misure automatizzate/);
  assert.match(html, /<strong>Copertura non verificata:<\/strong>/);
});

test("automationHtml keeps the full tables by default and compact replaces them with accurate counts and a link", () => {
  const run = automationRun({
    partial: true,
    measurements: [
      { pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "chromium/light", engine: "chromium", minimum: 4.5, target: 4.6, ratio: 4.2, status: "below-minimum", error: null },
      { pairId: "light|color|--color-primary-text|--color-primary-surface", scenarioId: "webkit/light", engine: "webkit", minimum: 4.5, target: 4.6, ratio: 4.4, status: "below-target", error: null },
      { pairId: "dark|color|--color-primary-text|--color-primary-surface", scenarioId: "chromium/dark", engine: "chromium", minimum: 4.5, target: 4.6, ratio: null, status: "unmeasured", error: null },
      { pairId: "dark|color|--color-primary-text|--color-primary-surface", scenarioId: "webkit/dark", engine: "webkit", minimum: 4.5, target: 4.6, ratio: 4.7, status: "pass", error: null },
      { pairId: "light|color|--color-info-text|--color-info-surface", scenarioId: "chromium/info", engine: "chromium", minimum: 4.5, target: 4.6, ratio: null, status: null, error: "aborted" },
    ],
    explorations: [
      { pairId: "light|color|--color-info-text|--color-info-surface", scenarioId: "chromium/light", engine: "chromium", minimum: 4.5, target: 4.6, ratio: 4.4, status: "below-target", error: null, family: "info" },
    ],
    explorationCoverage: { expected: 3, measured: 1, unmeasured: ["dark|color|--color-warning-text|--color-warning-surface"], omittedFamilies: ["muted"], complete: false },
  });
  const full = renderer.automationHtml(run);
  assert.equal(full, renderer.automationHtml(run, {}), "the default mode is exact and additive");
  assert.match(full, /<caption>Misure automatizzate per coppia<\/caption>/);
  assert.match(full, /<caption>Primi abbinamenti esplorativi<\/caption>/);
  assert.match(full, /<h5>Coppie non misurate<\/h5>/);
  assert.doesNotMatch(full, /Apri misure complete nel report/);

  const compact = renderer.automationHtml(run, { compact: true });
  assert.doesNotMatch(compact, /<table\b/);
  assert.doesNotMatch(compact, /Misure automatizzate per coppia/);
  assert.doesNotMatch(compact, /Primi abbinamenti esplorativi/);
  assert.doesNotMatch(compact, /Coppie non misurate/);
  assert.doesNotMatch(compact, /Famiglie omesse dalla copertura/);
  assert.match(compact, /<h4>Misure automatizzate \(5\)<\/h4>/);
  assert.match(compact, /<li><strong>1<\/strong> sotto il minimo<\/li>/);
  assert.match(compact, /<li><strong>1<\/strong> sotto il target<\/li>/);
  assert.match(compact, /<li><strong>2<\/strong> non misurate<\/li>/, "an errored measurement counts as unmeasured");
  assert.match(compact, /<li><strong>1<\/strong> raggiungono minimo e target<\/li>/);
  assert.match(compact, /<h4>Esplorazioni di sovrapposizione \(1 misure, canale separato\)<\/h4>/);
  assert.match(compact, /Copertura esplorativa parziale: 1 di 3 misurate/);
  assert.match(compact, /<a href="smart-colors.html">Apri misure complete nel report<\/a>/);
});

test("automationHtml compact keeps engine, error and unsupported causes visible", () => {
  const run = automationRun({
    status: "incomplete", partial: true,
    engines: [
      { name: "chromium", launched: true, status: "incomplete", version: "151.0", executable: "/opt/chromium", phase: "measure", reason: "preferenza light: timeout" },
      { name: "firefox", launched: false, status: "unavailable", version: null, executable: null, phase: "availability", reason: "browser binary unavailable at /opt/firefox" },
    ],
    measurements: [],
    errors: [{ phase: "measure", cause: "runtime-run-failed", engine: "chromium", scenarioId: null, pairId: null, message: "preferenza light: timeout" }],
    unsupported: [{ id: "chromium/baseline-dark-dark", reason: "forced-colors is active", engine: "chromium" }],
    coverage: { complete: false, expectedCount: 1, measuredCount: 0, scenarios: [], duplicateScenarios: [], missingScenarios: ["chromium/baseline-light-light"], unexpectedScenarios: [], duplicates: [], unmeasured: [] },
  });
  const compact = renderer.automationHtml(run, { compact: true });
  assert.match(compact, /<code>firefox<\/code> · Non disponibile · non eseguito · fase <code>availability<\/code> — browser binary unavailable at \/opt\/firefox/);
  assert.match(compact, /<h4>Errori dell'automazione \(1\)<\/h4>/);
  assert.match(compact, /<code>measure<\/code> · <code>runtime-run-failed<\/code> — preferenza light: timeout/);
  assert.match(compact, /<h4>Scenari non supportati \(1\)<\/h4>/);
  assert.match(compact, /<code>chromium\/baseline-dark-dark<\/code> — forced-colors is active/);
  assert.doesNotMatch(compact, /<h4>Misure automatizzate/);
  assert.doesNotMatch(compact, /Apri misure complete nel report/, "nothing was omitted, so no report link is needed");
});

test("a complete automation run scopes the verification sentence to the executed environments", () => {
  const html = render(diagnosticSession({ automation: automationRun() }));
  assert.match(html, /<strong>Copertura verificata:<\/strong> le coppie automatizzate sono complete negli ambienti eseguiti/);
  assert.match(html, /Copertura completa negli ambienti eseguiti \(i motori e gli scenari elencati qui sotto\), non universale/);
  assert.doesNotMatch(html, /Copertura non verificata/);
  assert.match(html, /Campioni calcolati dal modello del generatore, non da misure browser/);
});

test("session verification requires intact identity and complete automation in executed engines", () => {
  assert.equal(renderer.sessionVerification(diagnosticSession({ automation: automationRun() })).verified, true);
  assert.equal(renderer.sessionVerification(diagnosticSession({ automation: automationRun({ partial: true }) })).verified, false);
  assert.equal(renderer.sessionVerification(diagnosticSession({ automation: automationRun({ status: "incomplete" }) })).verified, false);
  assert.equal(renderer.sessionVerification(diagnosticSession({ automation: automationRun({ coverage: { complete: false, expectedCount: 1, measuredCount: 1 } }) })).verified, false);
  assert.equal(renderer.sessionVerification(diagnosticSession({ automation: automationRun({ measurements: [] }) })).verified, false);
  assert.equal(renderer.sessionVerification(diagnosticSession({ automation: automationRun(), inputDigest: "invalid" })).verified, false);
  assert.equal(renderer.sessionVerification(report()), null);
  const envScope = renderer.automationScope(automationRun({ errors: [{ phase: "availability", cause: "binary-missing", message: "x" }] }));
  assert.equal(envScope.measurementErrors.length, 0);
  assert.equal(envScope.environmentErrors.length, 1);
  assert.equal(renderer.automationScope(automationRun({ measurements: [] })).complete, false);
});

// QA finding: a session with externally supplied, structurally valid scenarios must NOT inherit the
// legacy "0 issue" outcome while its automation run is incomplete, partial, unsupported or absent.
function sessionAllPass(overrides = {}) {
  return diagnosticSession({ scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 5 })] })], ...overrides });
}

function sessionWithIssue(overrides = {}) {
  return diagnosticSession({
    scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4.499999999999999 })] })],
    proposals: [proposal()],
    ...overrides,
  });
}

const INCOMPLETE_RUN = { status: "incomplete", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [] };

const AUTOMATION_GATE_CASES = [
  ["missing automation", () => { const session = sessionAllPass(); delete session.automation; return session; }],
  ["disabled automation", () => sessionAllPass({ automation: automationRun({ mode: "off", status: "disabled", partial: false, engines: [], measurements: [], coverage: { complete: false, expectedCount: 0, measuredCount: 0 } }) })],
  ["incomplete automation", () => sessionAllPass({ automation: automationRun(INCOMPLETE_RUN) })],
  ["unavailable automation", () => sessionAllPass({ automation: automationRun({ status: "unavailable", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [], engines: [{ name: "chromium", launched: false, status: "unavailable", version: null, phase: "discovery", reason: "Playwright non trovato" }] }) })],
  ["partial automation", () => sessionAllPass({ automation: automationRun({ partial: true }) })],
  ["unsupported automation", () => sessionAllPass({ automation: automationRun({ status: "unsupported", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [] }) })],
  ["broken identity", () => sessionAllPass({ automation: automationRun(), inputDigest: "invalid" })],
];

test("a session never inherits a positive outcome while automation is incomplete, partial or missing", () => {
  for (const [label, build] of AUTOMATION_GATE_CASES) {
    const prepared = renderer.prepareDiagnosticReport(build());
    assert.equal(prepared.verified, false, label);
    assert.equal(prepared.outcome, "Esito non verificato o incompleto", label);
    const html = render(build());
    assert.doesNotMatch(html, /Esito positivo dello snapshot: 0 issue/, label);
    assert.match(html, /Nessuna conclusione positiva/, label);
    assert.match(html, /<strong>Copertura non verificata:<\/strong>/, label);
  }
});

test("a session with valid scenarios and complete automation may conclude positively", () => {
  assert.match(render(sessionAllPass({ automation: automationRun() })), /Esito positivo dello snapshot: 0 issue/);
  const withProposal = render(sessionWithIssue({ automation: automationRun() }));
  assert.match(withProposal, /1 problema di contrasto · 1 correzione verificata/);
  assert.match(withProposal, /class="color-choice color-choice--suggested"/);
  assert.equal(renderer.prepareDiagnosticReport(sessionWithIssue({ automation: automationRun() })).complete.length, 1);
});

test("a verified proposal loses its coverage when the automation run is not complete", () => {
  const html = render(sessionWithIssue({ automation: automationRun(INCOMPLETE_RUN) }));
  assert.doesNotMatch(html, /class="color-choice color-choice--suggested"/);
  assert.match(html, /Non applicare correzioni non verificate/);
  assert.equal(renderer.prepareDiagnosticReport(sessionWithIssue({ automation: automationRun(INCOMPLETE_RUN) })).complete.length, 0);
});

test("prepareDiagnosticReport downgrades only, never mutates the session and never consults itself", () => {
  const input = sessionWithIssue({ automation: automationRun(INCOMPLETE_RUN) });
  const before = structuredClone(input);
  deepFreeze(input);
  const prepared = renderer.prepareDiagnosticReport(input);
  assert.equal(prepared.verified, false);
  assert.equal(prepared.verification.verified, false);
  assert.equal(prepared.outcome, "Esito non verificato o incompleto");
  assert.deepEqual(input, before);
  // A legacy snapshot keeps its own prepared view untouched and exposes no session verification.
  assert.equal(renderer.prepareDiagnosticReport(report()).verification, null);
  assert.equal(renderer.prepareDiagnosticReport(report()).verified, true);
  // Both helpers terminate on the same session (no mutual recursion).
  const session = sessionWithIssue({ automation: automationRun() });
  assert.doesNotThrow(() => renderer.sessionVerification(session));
  assert.doesNotThrow(() => renderer.prepareDiagnosticReport(session));
  assert.equal(renderer.prepareDiagnosticReport(session).verified, true);
});

test("prepareDiagnosticReport downgrades only, never mutates the session and never consults itself", () => {
  const input = sessionWithIssue({ automation: automationRun({ status: "incomplete", partial: true, coverage: { complete: false, expectedCount: 1, measuredCount: 0 }, measurements: [] }) });
  const before = structuredClone(input);
  deepFreeze(input);
  const prepared = renderer.prepareDiagnosticReport(input);
  assert.equal(prepared.verified, false);
  assert.equal(prepared.verification.verified, false);
  assert.equal(prepared.outcome, "Esito non verificato o incompleto");
  assert.deepEqual(input, before);
  // A legacy snapshot keeps its own prepared view untouched and exposes no session verification.
  assert.equal(renderer.prepareDiagnosticReport(report()).verification, null);
  assert.equal(renderer.prepareDiagnosticReport(report()).verified, true);
  // Both helpers terminate on the same session (no mutual recursion).
  const session = sessionWithIssue({ automation: automationRun() });
  assert.doesNotThrow(() => renderer.sessionVerification(session));
  assert.doesNotThrow(() => renderer.prepareDiagnosticReport(session));
  assert.equal(renderer.prepareDiagnosticReport(session).verified, true);
});

// ---------------------------------------------------------------------------
// Static session report UX: a document of declared evidence, not a duplicated
// dashboard. Data lives in native disclosures, one family catalog is visible by
// default, and usage names replace duplicated token prose.
// ---------------------------------------------------------------------------

function measuredSession(overrides = {}) {
  return diagnosticSession({
    scenarios: [scenario({ diagnostics: [diagnostic({ label: "primary-text / family surface", foregroundToken: "--color-primary-text", backgroundToken: "--color-primary-surface", ratio: 4.2 })] })],
    ...overrides,
  });
}

test("the static session keeps its section order and every technical artifact inside a closed native disclosure", () => {
  const html = render(measuredSession({ automation: automationRun() }));
  const order = ["proposte", "problemi", "usi", "sessione", "tecnici"];
  const positions = order.map((id) => html.indexOf(`id="${id}"`));
  assert.ok(positions.every((position) => position > 0), "Every top-level section must be present");
  assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]), "Sections must follow the documented order");
  for (const id of ["scenari", "palette", "esito", "limiti"]) {
    assert.match(html, new RegExp(`<details><summary>[^<]*<\\/summary>\\s*<section aria-labelledby="${id}">`), `${id} must be a disclosure body`);
  }
  assert.match(html, /<details><summary>Verifica automatizzata \(Playwright\) — dettagli, cause e misure<\/summary>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/, "No disclosure may start open");
  for (const match of html.matchAll(/<details[^>]*><summary>([\s\S]*?)<\/summary>/g)) assert.ok(match[1].trim().length > 0, "Every disclosure needs a nonempty summary");
});

test("a session shows one family catalog by default and preserves the model estimate in a disclosure", () => {
  const both = render(measuredSession());
  // The measured atlas stays visible; the model estimate is preserved inside a native disclosure.
  assert.match(both, /<details><summary>Campioni dal modello — previsioni senza browser<\/summary>/);
  assert.equal((publicContent(both).match(/class="card family-card"/g) ?? []).length, 1, "Only one family catalog may be visible without disclosure");
  assert.equal((both.match(/class="card family-card"/g) ?? []).length, 2, "The model catalog data must not be dropped");
  // Without measured scenarios the model estimate is the catalog, and it stays visible.
  const modelOnly = render(diagnosticSession());
  assert.doesNotMatch(modelOnly, /<summary>Campioni dal modello/);
  assert.equal((publicContent(modelOnly).match(/class="card family-card"/g) ?? []).length, 1);
});

test("problem cards and scenario issues lead with human usage names while the tokens remain as provenance", () => {
  const html = render(measuredSession({ automation: automationRun() }));
  assert.match(html, /<h3>Testo sul callout primary<\/h3><p class="margin-note">primary-text \/ family surface<\/p><p><code>--color-primary-text<\/code> su <code>--color-primary-surface<\/code><\/p>/);
  assert.match(html, /<p><strong>Testo sul callout primary<\/strong><\/p>/);
  // The shared automation table keeps its exact token shape for the preview renderer; the same
  // usage name is derived from the identical frozen helper there.
  assert.match(html, /<code>--color-primary-text<\/code> su <code>--color-primary-surface<\/code><\/th>/);
  // A pair outside the known catalog keeps the faithful tokens instead of a guessed name.
  const unknown = render(measuredSession({ scenarios: [scenario({ diagnostics: [diagnostic({ label: "unknown", foregroundToken: "--color-mystery", backgroundToken: "--color-bg", ratio: 4.2 })] })] }));
  assert.match(unknown, /<h3>--color-mystery su --color-bg<\/h3>/);
});

test("severe identity problems stay visible while the full integrity data stays disclosed, never hidden", () => {
  const html = render(diagnosticSession({ inputDigest: "not-a-sha256" }));
  const visible = publicContent(html);
  assert.match(visible, /Nessuna conclusione positiva/);
  assert.match(visible, /Impronta SHA-256 degli input assente o non valida\./);
  assert.match(html, /<details><summary>File, impronta dello snapshot ed errori<\/summary>/);
  assert.match(html, /SHA-256 degli input \(dichiarato, non ricalcolato\)/);
  assert.match(html, /Snapshot statico, non stato attuale del progetto\./);
});

test("the static session report stays scriptless, network-free and escapes names that reach the usage title", () => {
  const attack = '<img src=x onerror=alert(1)>';
  const html = render(diagnosticSession({
    scenarios: [scenario({ diagnostics: [diagnostic({ label: attack, foregroundToken: attack, backgroundToken: attack, ratio: 4.2 })] })],
    automation: automationRun(),
  }));
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replaceAll("&#39;", "'");
  assert.ok(csp.includes("script-src 'none'"));
  assert.ok(csp.includes("connect-src 'none'"));
  assert.doesNotMatch(html, /<(?:script|iframe|link|img|button|input|form)\b/i);
  assert.doesNotMatch(html, /<[a-z][^>]*\son\w+=/i, "No event handler may appear in a real tag");
  assert.doesNotMatch(html, /<[a-z][^>]*\ssrc=/i, "No resource attribute may appear in a real tag");
  assert.doesNotMatch(html, /@import|url\(|https?:\/\//i);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; su &lt;img src=x onerror=alert(1)&gt;"), "The token fallback reaches the markup escaped");
  assert.doesNotMatch(html, /<img\b/);
});

// ---------------------------------------------------------------------------
// New designer contract: CSS provenance, design registry and exploratory
// coverage are rendered from the session data, never inferred by the report.
// ---------------------------------------------------------------------------

test("session CSS separates the generated model from the captured baseline and never promotes a candidate", () => {
  const digest = { generated: "a".repeat(64), baseline: "b".repeat(64) };
  const stale = render(diagnosticSession({ css: {
    generated: "expected", baseline: "actual", source: "output", status: "stale", production: false,
    digest, tuning: null, tuningSupport: "absent",
  } }));
  assert.match(stale, /Modello atteso \(generated\)<\/dt><dd>8 byte · SHA-256 <code>a{64}<\/code>/);
  assert.match(stale, /Baseline incorporata<\/dt><dd>6 byte · SHA-256 <code>b{64}<\/code>/);
  assert.match(stale, /Stato dell'output<\/dt><dd>Obsoleto<\/dd>/);
  assert.match(stale, /Provenienza della baseline<\/dt><dd>Output reale catturato<\/dd>/);
  assert.match(stale, /Produzione<\/dt><dd>No<\/dd>/);
  assert.match(stale, /la baseline è l'output reale catturato, non un candidato generato/);
  assert.doesNotMatch(stale, /candidato generato dal modello, non un file misurato su disco/);

  const candidate = render(diagnosticSession({ css: {
    generated: "expected", baseline: "expected", source: "generated-candidate", status: "empty", production: false,
    digest, tuning: null, tuningSupport: "absent",
  } }));
  assert.match(candidate, /Provenienza della baseline<\/dt><dd>Candidato generato \(non misurato su disco\)<\/dd>/);
  assert.match(candidate, /La baseline mostrata è il candidato generato dal modello, non un file misurato su disco/);
  assert.match(candidate, /Produzione<\/dt><dd>No<\/dd>/);

  const empty = render(diagnosticSession({ css: {
    generated: "expected", baseline: "", source: "output", status: "empty", production: true,
    digest, tuning: null, tuningSupport: "absent",
  } }));
  assert.match(empty, /Baseline incorporata<\/dt><dd>0 byte/);
  assert.match(empty, /L'output reale esiste ma è vuoto \(0 byte\)/);
  assert.match(empty, /Produzione<\/dt><dd>No<\/dd>/);
  assert.doesNotMatch(empty, /Produzione<\/dt><dd>Sì/);

  // The expected model is never shown as the baseline when no actual output was captured.
  const absent = render(diagnosticSession({ css: {
    generated: "expected", source: "output", status: "absent", production: false,
    digest, tuning: null, tuningSupport: "absent",
  } }));
  assert.match(absent, /Modello atteso \(generated\)<\/dt><dd>8 byte/);
  assert.match(absent, /Baseline incorporata<\/dt><dd>Non disponibile/);
  assert.match(absent, /Nessun output reale disponibile/);
});

test("design registry metadata traces source, recipe, use and controls without exposing internals", () => {
  const design = {
    version: 1,
    sources: [
      { token: "--palette-primary", name: "primary", role: "ui", darkBlend: 80, darkMix: { mode: "white-wash", sourcePercent: 77.6, whitePercent: 22.4 } },
      { token: "--palette-ink", name: "ink", role: "ink", darkBlend: null, darkMix: { mode: "automatic", sourcePercent: null, whitePercent: null } },
      { token: "--_palette-hidden", name: "hidden", role: "ui" },
    ],
    recipes: {
      "identity-base": { kind: "identity", usage: "Riempimento diretto", basis: "sorgente + dark-blend" },
      "text-adaptive": { kind: "text", usage: "Testo sul callout", basis: "contrasto risolto" },
      "--_secret-recipe": { kind: "hidden", usage: "nascosta", basis: "nascosta" },
    },
    tokens: {
      "--color-primary": { sources: ["--palette-primary"], recipe: "identity-base", usage: "Riempimento diretto", controls: {
        light: { override: "--color-tune-primary-light" },
        dark: { override: "--color-tune-primary-dark", mix: "--color-tune-primary-dark-mix", defaultMix: 0.776 },
      } },
      "--color-primary-text": { sources: ["--palette-primary"], recipe: "text-adaptive", usage: "Testo sul callout", controls: {
        light: { override: "--color-tune-primary-text-light" },
        dark: { override: "--color-tune-primary-text-dark" },
      } },
      "--color-primary-surface": { sources: ["--palette-primary"], recipe: "surface", usage: "Soft tint", controls: {
        light: { override: "--color-tune-primary-surface-light", mix: "--color-tune-primary-surface-light-mix", defaultMix: 0.1 },
        dark: { override: "--color-tune-primary-surface-dark", mix: "--color-tune-primary-surface-dark-mix", defaultMix: 0.18 },
      } },
      "--_color-secret": { sources: ["--palette-primary"], recipe: "identity-base", usage: "interna", controls: {} },
    },
  };
  const html = render(diagnosticSession({ design }));
  assert.match(html, /<section aria-labelledby="design"><h2 id="design">Sorgenti, ricette e controlli<\/h2>/);
  assert.match(html, /<a href="#design">Sorgenti e ricette<\/a>/);
  assert.match(html, /<code>--palette-primary<\/code>/);
  assert.match(html, /sorgente 77,6% · bianco 22,4%/);
  assert.match(html, /Automatico per ruolo \(nessun dark-blend dichiarato: non equivale a 0\)/);
  assert.match(html, /<code>identity-base<\/code> — identity/);
  assert.match(html, /aspettative di partenza del generatore/);
  assert.match(html, /CSS misurato \(baseline\) resta la fonte finale/);
  assert.match(html, /Ricette di partenza del generatore/);
  assert.match(html, /Controllo per personalizzare \(chiaro\)/);
  assert.match(html, /le superfici sono espressioni runtime \(mix\), non letterali risolti/);
  assert.match(html, /<code>text-adaptive<\/code> — text/);
  assert.match(html, /override <code>--color-tune-primary-light<\/code>/);
  assert.match(html, /override <code>--color-tune-primary-dark<\/code> · mix <code>--color-tune-primary-dark-mix<\/code> · default 77,6%/);
  assert.match(html, /override <code>--color-tune-primary-surface-light<\/code> · mix <code>--color-tune-primary-surface-light-mix<\/code> · default 10%/);
  assert.match(html, /Il <code>dark-blend<\/code> mescola bianco/);
  assert.match(html, /mix 10% source \/ 90% base \(chiaro\), 18%\/82% \(scuro\) — regola di progetto, non WCAG/);
  assert.doesNotMatch(html, /--_color-secret|--_palette-hidden|--_secret-recipe/);
  assert.ok(html.indexOf('id="usi"') < html.indexOf('id="design"'));
  assert.ok(html.indexOf('id="design"') < html.indexOf('id="sessione"'));
});

test("exploratory coverage is separate from the verified pairs and reports partial missing families", () => {
  const pair = (scheme, foreground, background, ratio, family) => ({
    pairId: `${scheme}|color|${foreground}|${background}`, scenarioId: `chromium/${scheme}`, engine: "chromium",
    minimum: 4.5, target: 4.6, ratio, status: statusFor(ratio, 4.6, 4.5), error: null, family,
  });
  const run = automationRun({
    explorations: [
      pair("light", "--color-primary-text", "--color-primary-surface", 4.8, "primary"),
      pair("light", "--color-info-text", "--color-info-surface", 4.4, "info"),
      pair("dark", "--color-danger-text", "--color-danger-surface", 3.9, "danger"),
      { pairId: "light|color|--color-broken|--color-broken-surface", scenarioId: "chromium/light", engine: "chromium", minimum: 4.5, target: 4.6, ratio: null, status: "unmeasured", error: "timeout", family: "broken" },
    ],
    explorationCoverage: {
      expected: 4, measured: 3, unmeasured: ["dark|color|--color-warning-text|--color-warning-surface"],
      omittedFamilies: ["muted"], complete: false,
    },
  });
  const html = render(diagnosticSession({ automation: run }));
  assert.match(html, /<h4>Esplorazioni di sovrapposizione \(3 misure, canale separato\)<\/h4>/);
  assert.doesNotMatch(html, /timeout/);
  assert.match(html, /Copertura esplorativa parziale: 3 di 4 misurate · 1 non misurata · 1 famiglia omessa\./);
  assert.match(html, /Gli abbinamenti sono ordinati per fascia d'uso: testo normale \(almeno 4,5:1\), poi solo titoli grandi, bordi e icone \(3:1–4,5:1\), poi da evitare \(sotto 3:1\)\./);
  assert.match(html, /<caption>Primi abbinamenti esplorativi<\/caption>/);
  assert.match(html, /<code>--color-primary-text<\/code> su <code>--color-primary-surface<\/code>/);
  assert.match(html, /<td>Chiaro<\/td><td><code>4\.8:1<\/code><\/td><td><code>4\.5:1<\/code><\/td><td><code>4\.6:1<\/code><\/td>/);
  assert.match(html, /<h5>Coppie non misurate<\/h5>/);
  assert.match(html, /dark\|color\|--color-warning-text\|--color-warning-surface/);
  assert.match(html, /<h5>Famiglie omesse dalla copertura<\/h5>/);
  assert.match(html, /Misure automatizzate \(1\)/);
  assert.doesNotMatch(html, /Misure automatizzate \(3\)/);
  assert.match(html, /non sostituiscono un audit di accessibilità/);
  assert.match(html, /<strong>Copertura verificata:<\/strong>/, "the normal complete run keeps its own gate");
  const absent = render(diagnosticSession({ automation: automationRun() }));
  assert.doesNotMatch(absent, /Esplorazioni di sovrapposizione|Copertura esplorativa/);
});

test("exploration rendering caps the schema at 24 families without inventing a verdict", () => {
  const items = Array.from({ length: 25 }, (_, index) => ({
    pairId: `light|color|--color-f${index}-text|--color-f${index}-surface`, scenarioId: "chromium/light", engine: "chromium",
    minimum: 4.5, target: 4.5, ratio: 4.6, status: "pass", error: null, family: `f${index}`,
  }));
  const html = render(diagnosticSession({ automation: automationRun({ explorations: items, explorationCoverage: { expected: 25, measured: 25, unmeasured: [], omittedFamilies: [], complete: true } }) }));
  assert.match(html, /1 famiglia supera il limite di schema di 24/);
  assert.match(html, /<code>f24<\/code>/);
  assert.match(html, /Esplorazioni di sovrapposizione \(25 misure/);
});
