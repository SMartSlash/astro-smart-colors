import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { pairsFor as legacyPairsFor } from "../../src/diagnostics/browser/browser-audit.mjs";
import { createVerificationCore } from "../../src/colors/verification-core.mjs";

const core = createVerificationCore();

const CONFIG = {
  contrast: { text: 4.6, onColor: 4.6, ui: 3, maxIdentity: 7.5, darkRichness: 1.15 },
  roles: { identities: { primary: {}, secondary: {}, info: {} }, decoratives: { spark: {} } },
};

const WHITE = "rgb(255, 255, 255)";
const BLACK = "rgb(0, 0, 0)";

// Independent oracle: WCAG relative luminance from clipped sRGB channels, written
// without reusing the module under test.
function luminance([r, g, b]) {
  const linear = (value) => {
    const u = value / 255;
    return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function wcag(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("createVerificationCore exposes the frozen §5.1.1 surface", () => {
  for (const name of ["pairsFor", "pairTarget", "warningStatus", "parseComputedColor", "contrast", "createContract", "measurePair", "coverage"]) {
    assert.equal(typeof core[name], "function", `${name} must be a function`);
  }
});

test("contrast matches independent clipped-sRGB oracles, including 21:1 and 1:1", () => {
  const white = core.parseComputedColor(WHITE, "white");
  const black = core.parseComputedColor(BLACK, "black");

  const ratio = core.contrast(white, black);
  assert.ok(Number.isFinite(ratio));
  assert.ok(Math.abs(ratio - 21) < 1e-6, `expected the 21:1 oracle, got ${ratio}`);
  assert.ok(Math.abs(ratio - wcag([255, 255, 255], [0, 0, 0])) < 1e-6);
  assert.equal(core.contrast(white, white), 1);
  assert.equal(core.contrast(black, black), 1);

  for (const [first, second] of [[[255, 0, 0], [0, 0, 0]], [[255, 0, 0], [255, 255, 255]], [[12, 200, 64], [10, 10, 10]]]) {
    const measured = core.contrast(
      core.parseComputedColor(`rgb(${first.join(", ")})`, "a"),
      core.parseComputedColor(`rgb(${second.join(", ")})`, "b"),
    );
    assert.ok(Math.abs(measured - wcag(first, second)) < 1e-6, `${first} on ${second}: ${measured}`);
  }
});

test("thresholds are exact and never rounded", () => {
  assert.equal(core.warningStatus(4.6, 4.6, 4.5), "pass");
  assert.equal(core.warningStatus(4.5, 4.6, 4.5), "below-target");
  assert.equal(core.warningStatus(4.4999999999, 4.6, 4.5), "below-minimum");
  assert.equal(core.warningStatus(3, 3, 3), "pass");
  assert.equal(core.warningStatus(2.9999999999, 3, 3), "below-minimum");
});

test("parseComputedColor accepts rgb/rgba opaque, color(srgb) and oklch", () => {
  assert.deepEqual(core.parseComputedColor("color(srgb 1 0 0)", "c"), core.parseComputedColor("rgb(255, 0, 0)", "c"));
  assert.deepEqual(core.parseComputedColor("rgb(100%, 0%, 0%)", "c"), core.parseComputedColor("rgb(255, 0, 0)", "c"));
  assert.deepEqual(core.parseComputedColor("rgba(255, 0, 0, 1)", "c"), core.parseComputedColor("rgb(255, 0, 0)", "c"));
  assert.deepEqual(core.parseComputedColor("oklch(0.5 0.1 200)", "c"), { l: 0.5, c: 0.1, h: 200 });
  assert.deepEqual(core.parseComputedColor("oklch(0.5 0.1 200deg)", "c"), { l: 0.5, c: 0.1, h: 200 });
  assert.deepEqual(core.parseComputedColor("oklch(50% 0.1 0.5turn)", "c"), { l: 0.5, c: 0.1, h: 180 });

  const white = core.parseComputedColor(WHITE, "c");
  assert.ok(Math.abs(white.l - 1) < 1e-5, `white lightness ${white.l}`);
  assert.ok(Math.abs(white.c) < 1e-5, `white chroma ${white.c}`);
  assert.ok(Number.isFinite(white.h));
});

test("parseComputedColor fails closed on missing, invalid, translucent and unsupported values", () => {
  const rejected = [
    "", " ", "transparent", "currentColor", "#fff", "lab(50% 0 0)", "color(display-p3 1 0 0)",
    "rgb(1, 2)", "rgb(a b c)", "rgb(1, 2, 3, 0.5)", "rgba(1, 2, 3, 0.5)", "rgba(1, 2, 3, abc)",
    "rgb(1 2 3 / 0.5)", "rgba(1 2 3 / 50%)", "oklch(0.5 0.1 200 / 0.5)", "oklch(1.5 0 0)", "oklch(0.5 -0.1 200)",
    "rgb(1 2 3 4 5)", "rgb(1 2 3 4)", "rgb(1 2 3", "rgb(1 2 3))", "rgb(1 2 3)(", "rgb()",
    "rgba(1, 2, 3, 1.5)", "rgba(1 2 3 200%)", "rgba(0 0 0 0)", "rgb(Infinity 0 0)", "rgb(1e999 0 0)",
    "color(srgb 1 0 0 0)", "color(srgb 1 0 0 4)", "color(srgb 1 0)",
  ];
  for (const value of rejected) {
    assert.throws(() => core.parseComputedColor(value, "probe"), /probe/, `expected throw for ${JSON.stringify(value)}`);
  }
});

test("pairsFor reproduces the legacy dynamic catalog, with ids from theme/property/tokens", () => {
  const legacy = legacyPairsFor("light", ["primary", "secondary", "info"], ["spark"]);
  const mine = core.pairsFor("light", ["primary", "secondary", "info"], ["spark"]);
  assert.equal(mine.length, legacy.length);
  for (let index = 0; index < mine.length; index += 1) {
    for (const field of ["label", "foreground", "background", "kind", "property", "warning"]) {
      assert.deepEqual(mine[index][field], legacy[index][field], `${field} at #${index}`);
    }
    assert.equal(mine[index].theme, "light");
    assert.ok(mine[index].id.startsWith("light|"));
    assert.ok(mine[index].id.includes(mine[index].foreground));
    assert.ok(mine[index].id.includes(mine[index].background));
    assert.ok(!mine[index].id.includes(mine[index].label));
  }
  assert.deepEqual(core.pairsFor("light").map((pair) => pair.label), legacyPairsFor("light").map((pair) => pair.label));

  const findId = (list, label) => list.find((pair) => pair.label === `light ${label}`).id;
  const reordered = core.pairsFor("light", ["info", "primary", "secondary"], ["spark"]);
  assert.equal(findId(mine, "primary-text / canvas"), findId(reordered, "primary-text / canvas"));
  assert.equal(findId(mine, "neutral text / canvas"), findId(reordered, "neutral text / canvas"));
});

test("createContract freezes identities, decoratives, themes and exact thresholds", () => {
  const contract = core.createContract(CONFIG);
  assert.deepEqual(contract.config, { contrast: CONFIG.contrast });
  assert.deepEqual(contract.identities, ["primary", "secondary", "info"]);
  assert.deepEqual(contract.decoratives, ["spark"]);
  assert.deepEqual(Object.keys(contract.pairs), ["light", "dark"]);

  for (const scheme of ["light", "dark"]) {
    const pairs = contract.pairs[scheme];
    assert.ok(pairs.length > 0);
    assert.ok(pairs.every((pair) => pair.theme === scheme));
    assert.ok(pairs.every((pair) => typeof pair.id === "string" && pair.id.length > 0));
    assert.ok(pairs.every((pair) => Number.isFinite(pair.target) && Number.isFinite(pair.minimum)));
    const ids = pairs.map((pair) => pair.id);
    assert.equal(new Set(ids).size, ids.length, "pair ids must be unique");
  }

  const byLabel = (scheme, label) => contract.pairs[scheme].find((pair) => pair.label === `${scheme} ${label}`);
  assert.equal(byLabel("light", "neutral text / canvas").target, CONFIG.contrast.text);
  assert.equal(byLabel("light", "neutral text / canvas").minimum, 4.5);
  assert.equal(byLabel("dark", "neutral text / canvas").target, Math.min(CONFIG.contrast.maxIdentity, CONFIG.contrast.text * CONFIG.contrast.darkRichness));
  assert.equal(byLabel("light", "focus / canvas").target, CONFIG.contrast.ui);
  assert.equal(byLabel("light", "focus / canvas").minimum, 3);
  assert.equal(byLabel("light", "primary-border-strong / canvas").minimum, 3);
  assert.equal(byLabel("light", "primary-border-strong / canvas").target, CONFIG.contrast.ui);
  assert.equal(byLabel("light", "on-primary / primary").target, CONFIG.contrast.onColor);
  assert.equal(byLabel("light", "on-primary / primary").minimum, 4.5);

  assert.deepEqual(core.createContract({ contrast: CONFIG.contrast }).identities, ["primary", "secondary", "info"]);
  assert.deepEqual(core.createContract({ contrast: CONFIG.contrast, roles: {} }).identities, ["primary", "secondary", "info"]);
  assert.deepEqual(core.createContract({ contrast: CONFIG.contrast, roles: { identities: {}, decoratives: {} } }).identities, []);
});

test("explorationPairsFor compares every supported pair of the first 24 families plus canvas/surface", () => {
  // A family contributes exactly its base color; canvas and surface are always compared.
  const many = Array.from({ length: 40 }, (_, index) => `id${index}`);
  const bounded = core.explorationPairsFor("light", many, []);
  // 24 families + canvas + surface = 26 colors => 26*25 ordered non-self pairs, with NO 24-pair cap.
  assert.equal(bounded.pairs.length, 26 * 25, "all supported pairs are compared, never an arbitrary first 24");
  assert.equal(bounded.omittedFamilies.length, 40 - 24, "the 16 families beyond the cap are declared omitted");
  assert.ok(bounded.pairs.every((pair) => pair.foreground !== pair.background), "no self pair");
  assert.ok(bounded.pairs.every((pair) => pair.kind === "on-color" && pair.property === "color"), "text/on-color semantics on the DOM property color");
  assert.ok(bounded.pairs.every((pair) => pair.exploration === true));
  assert.ok(bounded.pairs.every((pair) => pair.id.split("|")[1] === "exploration"), "ids use the exploration namespace, never the DOM property");
  const ids = bounded.pairs.map((pair) => pair.id);
  assert.equal(new Set(ids).size, ids.length, "exploration ids are unique");

  const first = core.explorationPairsFor("light", ["primary", "secondary"], ["spark"]);
  const again = core.explorationPairsFor("light", ["primary", "secondary"], ["spark"]);
  assert.deepEqual(first.pairs.map((pair) => pair.id), again.pairs.map((pair) => pair.id), "the catalog is deterministic for identical inputs");
});

test("exploration covers every included family as foreground and background, including the last one", () => {
  const identities = ["primary", "secondary", "info"];
  const { pairs } = core.explorationPairsFor("light", identities, ["spark"]);
  const tokens = new Set();
  for (const pair of pairs) { tokens.add(pair.foreground); tokens.add(pair.background); }
  assert.ok(tokens.has("--color-bg") && tokens.has("--color-surface"), "canvas and surface are always compared");
  for (const name of [...identities, "spark"]) {
    assert.ok(tokens.has(`--color-${name}`), `${name} must appear as foreground and background`);
  }

  // Exactly 24 families: the last one is still explored, nothing is silently dropped.
  const exactly = core.explorationPairsFor("light", Array.from({ length: 24 }, (_, index) => `id${index}`), []);
  assert.equal(exactly.omittedFamilies.length, 0);
  assert.ok(exactly.pairs.some((pair) => pair.foreground === "--color-id23"));
  assert.ok(exactly.pairs.some((pair) => pair.background === "--color-id23"));

  // 25 families: the 25th is the coherent omitted family, and the 24th is still explored.
  const beyond = core.explorationPairsFor("light", Array.from({ length: 25 }, (_, index) => `id${index}`), []);
  assert.deepEqual(beyond.omittedFamilies, ["id24"]);
  assert.ok(beyond.pairs.some((pair) => pair.foreground === "--color-id23"));
  assert.ok(!beyond.pairs.some((pair) => pair.foreground === "--color-id24" || pair.background === "--color-id24"));
});

test("createContract adds explorationPairs/explorationScope without changing the primary pairs", () => {
  const contract = core.createContract(CONFIG);
  const baseline = core.createContract({ contrast: CONFIG.contrast, roles: { identities: { primary: {}, secondary: {}, info: {} }, decoratives: { spark: {} } } });
  assert.deepEqual(contract.pairs, baseline.pairs, "the primary catalog is untouched by exploration");

  assert.deepEqual(Object.keys(contract.explorationPairs), ["light", "dark"]);
  for (const scheme of ["light", "dark"]) {
    const pairs = contract.explorationPairs[scheme];
    // 3 identities + 1 decorative + canvas + surface = 6 colors => 6*5 = 30 pairs, above 24: no pair cap.
    assert.equal(pairs.length, 30);
    assert.ok(pairs.every((pair) => pair.theme === scheme && pair.kind === "on-color" && pair.property === "color"));
    assert.ok(pairs.every((pair) => pair.minimum === 4.5), "exploration reuses the text minimum 4.5");
    assert.ok(pairs.every((pair) => Number.isFinite(pair.target) && pair.target >= pair.minimum), "the on-color target is never below the minimum");
    const ids = pairs.map((pair) => pair.id);
    assert.equal(new Set(ids).size, ids.length);
    const primary = new Set(contract.pairs[scheme].map((pair) => pair.id));
    assert.ok(ids.every((id) => !primary.has(id)), "no exploration id collides with a primary pair id");
  }
  assert.equal(contract.explorationScope.advisory, true);
  assert.equal(contract.explorationScope.minimum, 4.5);
  assert.deepEqual(Object.keys(contract.explorationScope.omittedFamilies), ["light", "dark"]);
});

test("a 3.2:1 exploration ratio is never usable body text, while the 4.5 minimum governs the verdict", () => {
  const pair = core.createContract(CONFIG).explorationPairs.light[0];
  assert.equal(pair.kind, "on-color");
  assert.equal(pair.minimum, 4.5);
  assert.ok(pair.target >= pair.minimum);
  // Same clipped-sRGB contrast math, text semantics: 3:1 / 3.2:1 is below-minimum for body text.
  assert.equal(core.warningStatus(3, pair.target, pair.minimum), "below-minimum");
  assert.equal(core.warningStatus(3.2, pair.target, pair.minimum), "below-minimum");
  assert.equal(core.warningStatus(4.5, pair.target, pair.minimum), pair.target > 4.5 ? "below-target" : "pass");
  assert.equal(core.warningStatus(21, pair.target, pair.minimum), "pass");
  // The measurable verdict is derived by the same measurePair used everywhere.
  const measured = core.measurePair(pair, { id: "light" }, { foreground: WHITE, background: BLACK });
  assert.equal(measured.minimum, 4.5);
  assert.equal(measured.target, pair.target);
  assert.equal(measured.status, "pass");
});

test("measurePair classifies exact boundaries without rounding and keeps the raw ratio", () => {
  const pair = { id: "probe", label: "probe", target: 4.6, minimum: 4.5 };
  const measurement = core.measurePair(pair, { id: "light" }, { foreground: WHITE, background: BLACK });
  assert.equal(measurement.pairId, "probe");
  assert.equal(measurement.scenarioId, "light");
  assert.equal(measurement.foreground, WHITE);
  assert.equal(measurement.background, BLACK);
  assert.equal(measurement.error, null);
  assert.equal(measurement.status, "pass");
  assert.equal(
    measurement.ratio,
    core.contrast(core.parseComputedColor(WHITE), core.parseComputedColor(BLACK)),
  );

  const ratio = measurement.ratio;
  const at = (target, minimum) => core.measurePair({ id: "probe", target, minimum }, { id: "light" }, { foreground: WHITE, background: BLACK });
  assert.equal(at(ratio, ratio).status, "pass");
  assert.equal(at(ratio + 1e-9, 4.5).status, "below-target");
  assert.equal(at(ratio + 1, ratio + 1e-9).status, "below-minimum");
});

test("measurePair fails closed on thresholds that are not finite, positive and coherent", () => {
  const base = { foreground: WHITE, background: BLACK };
  const thresholds = [
    undefined,
    { target: 4.6 },
    { minimum: 4.5 },
    { target: 0, minimum: 0 },
    { target: -1, minimum: 4.5 },
    { target: 4.5, minimum: 4.6 },
    { target: Number.NaN, minimum: 4.5 },
    { target: Infinity, minimum: 4.5 },
    { target: 4.6, minimum: 0 },
  ];
  for (const entry of thresholds) {
    const pair = entry ? { id: "probe", ...entry } : { id: "probe" };
    const measurement = core.measurePair(pair, { id: "light" }, base);
    assert.equal(measurement.status, "unmeasured", JSON.stringify(entry));
    assert.equal(measurement.ratio, null);
    assert.equal(typeof measurement.error, "string");
    assert.ok(measurement.error.length > 0);
  }
});

test("measurePair fails closed to unmeasured, never to a default pass", () => {
  const pair = { id: "probe", target: 4.6, minimum: 4.5 };
  const cases = [
    { error: "browser unavailable" },
    { foreground: BLACK, background: "rgba(0, 0, 0, 0.5)" },
    { foreground: "", background: BLACK },
    { foreground: "color(display-p3 1 0 0)", background: BLACK },
    {},
  ];
  for (const computed of cases) {
    const measurement = core.measurePair(pair, { id: "light" }, computed);
    assert.equal(measurement.status, "unmeasured", JSON.stringify(computed));
    assert.equal(measurement.ratio, null);
    assert.equal(typeof measurement.error, "string");
    assert.ok(measurement.error.length > 0);
  }

  const noThresholds = core.measurePair({ id: "probe" }, { id: "light" }, { foreground: WHITE, background: BLACK });
  assert.equal(noThresholds.status, "unmeasured");
  assert.notEqual(noThresholds.status, "pass");
});

test("coverage verifies identity and duplicates, not just counts", () => {
  const expected = [{ id: "light", pairIds: ["a", "b"] }, { id: "dark", pairIds: ["a"] }];
  const measured = (scenarioId, pairId, status = "pass") => ({ scenarioId, pairId, status });

  const complete = core.coverage(expected, [measured("light", "a"), measured("light", "b"), measured("dark", "a")]);
  assert.equal(complete.complete, true);
  assert.equal(complete.expectedCount, 3);
  assert.equal(complete.measuredCount, 3);

  const missing = core.coverage(expected, [measured("light", "a"), measured("dark", "a")]);
  assert.equal(missing.complete, false);
  assert.deepEqual(missing.scenarios.find((scenario) => scenario.id === "light").missing, ["b"]);

  const wrongIdentity = core.coverage(expected, [measured("light", "a"), measured("light", "c"), measured("dark", "a")]);
  assert.equal(wrongIdentity.complete, false);
  assert.deepEqual(wrongIdentity.scenarios.find((scenario) => scenario.id === "light").unexpected, ["c"]);
  assert.deepEqual(wrongIdentity.scenarios.find((scenario) => scenario.id === "light").missing, ["b"]);

  const duplicated = core.coverage(expected, [measured("light", "a"), measured("light", "a"), measured("light", "b"), measured("dark", "a")]);
  assert.equal(duplicated.complete, false);
  assert.deepEqual(duplicated.duplicates, [{ scenarioId: "light", pairId: "a" }]);

  const stray = core.coverage(expected, [measured("light", "a", "unmeasured"), measured("light", "b"), measured("extra", "a")]);
  assert.equal(stray.complete, false);
  assert.deepEqual(stray.missingScenarios, ["dark"]);
  assert.deepEqual(stray.unexpectedScenarios, ["extra"]);
  assert.deepEqual(stray.unmeasured, [{ scenarioId: "light", pairId: "a" }]);
});

test("coverage never confirms an empty matrix, an empty scenario or unmeasured pairs", () => {
  assert.equal(core.coverage([], [{ scenarioId: "light", pairId: "a", status: "pass" }]).complete, false);
  assert.equal(core.coverage([{ id: "light", pairIds: [] }], []).complete, false);

  const only = (status) => core.coverage([{ id: "light", pairIds: ["a"] }], [{ scenarioId: "light", pairId: "a", status }]);
  assert.equal(only("pass").complete, true);
  const unmeasured = only("unmeasured");
  assert.equal(unmeasured.complete, false);
  assert.deepEqual(unmeasured.scenarios[0].unmeasured, ["a"]);
  assert.deepEqual(unmeasured.scenarios[0].missing, []);
  assert.equal(only("below-minimum").complete, true, "a classified but failing pair is still covered; the verdict belongs to the caller");
});

test("coverage treats a measurement without a classified status as unmeasured", () => {
  for (const status of [undefined, null, "", "measured", "passing", "unknown", "unmeasured"]) {
    const result = core.coverage([{ id: "light", pairIds: ["a"] }], [{ scenarioId: "light", pairId: "a", status }]);
    assert.equal(result.complete, false, JSON.stringify(status));
    assert.equal(result.measuredCount, 0, JSON.stringify(status));
    assert.deepEqual(result.unmeasured, [{ scenarioId: "light", pairId: "a" }], JSON.stringify(status));
    assert.deepEqual(result.scenarios[0].unmeasured, ["a"], JSON.stringify(status));
    assert.deepEqual(result.scenarios[0].missing, [], JSON.stringify(status));
  }

  // A classified failing outcome is still a measurement; the verdict belongs to the caller.
  for (const status of ["pass", "below-target", "below-minimum"]) {
    const result = core.coverage([{ id: "light", pairIds: ["a"] }], [{ scenarioId: "light", pairId: "a", status }]);
    assert.equal(result.complete, true, status);
    assert.equal(result.measuredCount, 1, status);
    assert.deepEqual(result.unmeasured, [], status);
  }
});

test("coverage flags duplicate scenario ids and duplicate pair declarations instead of deduplicating", () => {
  const duplicateScenario = core.coverage(
    [{ id: "light", pairIds: ["a"] }, { id: "light", pairIds: ["b"] }],
    [{ scenarioId: "light", pairId: "a", status: "pass" }],
  );
  assert.equal(duplicateScenario.complete, false);
  assert.deepEqual(duplicateScenario.duplicateScenarios, ["light"]);

  const duplicatePair = core.coverage(
    [{ id: "light", pairIds: ["a", "a"] }],
    [{ scenarioId: "light", pairId: "a", status: "pass" }],
  );
  assert.equal(duplicatePair.complete, false);
  assert.deepEqual(duplicatePair.scenarios[0].duplicateExpected, ["a"]);
});

test("the factory serializes into an isolated realm with no imports", () => {
  const source = `(${createVerificationCore.toString()})()`;
  const isolated = vm.runInNewContext(source, {});
  assert.equal(typeof isolated.process, "undefined");
  assert.equal(typeof isolated.require, "undefined");

  const white = isolated.parseComputedColor(WHITE, "white");
  const black = isolated.parseComputedColor(BLACK, "black");
  assert.equal(isolated.contrast(white, black), core.contrast(core.parseComputedColor(WHITE), core.parseComputedColor(BLACK)));

  const contract = isolated.createContract(CONFIG);
  assert.deepEqual([...contract.identities], ["primary", "secondary", "info"]);
  assert.deepEqual([...contract.decoratives], ["spark"]);
  assert.equal(contract.pairs.light.length, core.createContract(CONFIG).pairs.light.length);
  assert.deepEqual(Object.keys(contract.explorationPairs), ["light", "dark"]);
  assert.equal(contract.explorationPairs.light.length, 30);

  const pair = contract.pairs.light[0];
  const measurement = isolated.measurePair(pair, { id: "light" }, { foreground: WHITE, background: BLACK });
  assert.equal(measurement.status, "pass");
  assert.equal(isolated.coverage([{ id: "light", pairIds: [pair.id] }], [measurement]).complete, true);

  // Shared numeric invariants survive serialization bit for bit.
  assert.equal(isolated.fitToSrgb({ l: 0.5, c: 0.02, h: 392 }).h, 32);
  assert.deepEqual({ ...isolated.serializedColor({ l: 0.985249, c: 0.200049, h: 32.410049 }) }, { l: 0.9852, c: 0.2, h: 32.41 });
  const mixed = isolated.mixOklch({ l: 0.54, c: 0.0918, h: 198 }, { l: 1, c: 0, h: null }, 0.7592);
  for (const channel of ["l", "c", "h"]) {
    assert.equal(mixed[channel], core.mixOklch({ l: 0.54, c: 0.0918, h: 198 }, { l: 1, c: 0, h: null }, 0.7592)[channel], channel);
  }
});
