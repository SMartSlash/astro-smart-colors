import assert from "node:assert/strict";
import test from "node:test";
import * as renderer from "../src/format-report-html.mjs";

const { formatContrastReportHtml: render } = renderer;
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
  assert.doesNotMatch(primary, /<table>|Controlli della proposta|Coppie complete:|Tabella completa dei controlli|SHA-256/);
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
  assert.doesNotMatch(primary, /<table>|Controlli della proposta|Tabella completa dei controlli/);
  const details = proposalsSection(html);
  assert.match(details, /<details><summary>Tabella completa dei controlli — 2 righe<\/summary>/);
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
    diagnostic({ label: "primary-on-solid / solid", foregroundToken: "--color-primary-on-solid", backgroundToken: "--color-primary-solid", ratio: 4.8 }),
    diagnostic({ label: "on-primary / primary", foregroundToken: "--color-on-primary", backgroundToken: "--color-primary", ratio: 5.1 }),
    diagnostic({ label: "on-spark / spark", foregroundToken: "--color-on-spark", backgroundToken: "--color-spark", ratio: 2.2 }),
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
    diagnostic({ label: "fill", foregroundToken: "--color-info-on-solid", backgroundToken: "--color-info-solid", ratio: 4.49999999999999 }),
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
  assert.doesNotMatch(publicContent(guide), /<table>|Sovrapposizioni esplorative nello scenario/);
  assert.match(proposalsSection(html), /Non serve una correzione/);
});

test("overlap summary uses the worst exact ratio across browser preferences without hiding either measurement", () => {
  const scenarios = [scenario(), scenario({ browser: "webkit" })];
  const overlaps = [overlapScenario(), overlapScenario({ browser: "webkit" })];
  overlaps[0].diagnostics[0] = diagnostic({ ...overlaps[0].diagnostics[0], ratio: 4.500000000000001, status: "pass" });
  const html = render(report({ scenarios, overlaps }));
  const guide = section(html, "usi");
  assert.match(publicContent(guide), /<strong>0<\/strong> abbinamenti utilizzabili per testo normale · <strong>0<\/strong> solo per titoli grandi, bordi o icone · <strong>1<\/strong> da evitare/);
  assert.match(publicContent(guide), /&lt; 3:1/);
  const both = render(report({ scenarios, overlaps: overlaps.map((entry) => ({ ...entry, diagnostics: [{ ...entry.diagnostics[0], ratio: 4.6, status: "pass" }] })) }));
  assert.match(publicContent(section(both, "usi")), /<strong>1<\/strong> abbinamenti utilizzabili per testo normale · <strong>0<\/strong> solo per titoli grandi, bordi o icone · <strong>0<\/strong> da evitare/);
  assert.match(guide, /4\.500000000000001:1/);
  assert.match(guide, /2\.999999999999999:1/);
  assert.equal((guide.match(/<caption>Sovrapposizioni esplorative nello scenario<\/caption>/g) ?? []).length, 2);
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

test("the proposal summary sentence follows the actual tuning knob and never mislabels it", () => {
  const cases = [
    ["--color-tune-surface-lightness-shift", /Regola la superficie del tema chiaro/],
    ["--color-tune-dark-surface-depth", /Regola il tema scuro senza cambiare la palette/],
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

test("exports only the requested renderer and returns a complete marked static Italian document", () => {
  assert.deepEqual(Object.keys(renderer), ["formatContrastReportHtml"]);
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
  assert.match(html, /<pre tabindex="0" aria-label="Snippet della proposta"><code>--primary:/);
  assert.match(html, /user-select:\s*text/);
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

test("proposal control rows retain explicit browser and preference for every check, not only covered issues", () => {
  const html = proposalsSection(render(issueReport({
    scenarios: [scenario({ diagnostics: [diagnostic({ ratio: 4 })] }), scenario({ browser: "webkit", preference: "more", diagnostics: [diagnostic({ label: "other" })] })],
    proposals: [proposal({ checks: [diagnostic({ browser: "chromium", preference: "no-preference" }), diagnostic({ label: "other", browser: "webkit", preference: "more" })] })],
  })));
  assert.match(html, /<td>chromium \/ light \/ no-preference<\/td>/);
  assert.match(html, /<td>webkit \/ light \/ more<\/td>/);
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
