/**
 * Focused collector tests for compositing rules that a minimal stub cannot prove.
 *
 * The fake document resolves `var(--token)` into concrete colors and exposes the
 * inline styles the collector writes, so `measureDocument` reaches the pair loop
 * without Playwright. The outline cases mirror the painted backdrop: an outline
 * offset outside the border sits on the parent surface, not on the element's own
 * background-color.
 */
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createVerificationCore } from "../src/verification-core.mjs";
import {
  DOM_MEASUREMENT_STYLE_ATTRIBUTE,
  DOM_PROBE_ATTRIBUTE,
  DOM_PROBE_HOST_ATTRIBUTE,
  DOM_REGISTRATION_PROBE,
  DOM_THEME_PROBE_CLASS,
  createDomVerifier,
} from "../src/verification-dom.mjs";

const core = createVerificationCore();
const verifier = createDomVerifier(core);

const PAIR = {
  id: "light|outlineColor|--color-focus-ring|--color-bg",
  label: "light focus / canvas",
  foreground: "--color-focus-ring",
  background: "--color-bg",
  kind: "ui",
  property: "outlineColor",
  theme: "light",
  target: 3,
  minimum: 3,
};
const CONTRACT = { pairs: { light: [PAIR] } };
const SCENARIO = { id: "baseline-light-light", theme: "light", variant: "baseline", preference: "light" };
const TOKENS = {
  "--color-focus-ring": "rgb(255, 255, 0)",
  "--color-bg": "rgb(255, 255, 255)",
};
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(TEST_DIR, "../../..");
const NATIVE_PROOF = process.env.SMART_COLORS_NATIVE_PROOF === "1";

let documentRef;
class FakeElement {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.nodeType = 1;
    this.ownerDocument = documentRef;
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.textContent = "";
    this.isConnected = true;
    this.__background = "";
  }

  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }

  get firstChild() {
    return this.children[0] ?? null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    child.isConnected = true;
    this.children.push(child);
    return child;
  }

  insertBefore(child, reference) {
    child.parentNode = this;
    const index = reference ? this.children.indexOf(reference) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
}

function createFakeDocument({ tokenColors = TOKENS, themeColor = "rgb(255, 255, 255)" } = {}) {
  const document = {
    documentElement: null,
    head: null,
    body: null,
    defaultView: null,
    createElement(tag) { return new FakeElement(tag); },
    querySelector(selector) {
      const matches = (element) => {
        if (selector === `style[${DOM_MEASUREMENT_STYLE_ATTRIBUTE}]`) {
          return element.tagName === "STYLE" && element.getAttribute(DOM_MEASUREMENT_STYLE_ATTRIBUTE) !== null;
        }
        if (selector === `[${DOM_PROBE_HOST_ATTRIBUTE}]`) {
          return element.getAttribute(DOM_PROBE_HOST_ATTRIBUTE) !== null;
        }
        return false;
      };
      const walk = (element) => {
        for (const child of element.children) {
          if (matches(child)) return child;
          const found = walk(child);
          if (found) return found;
        }
        return null;
      };
      return walk(document.documentElement);
    },
  };
  documentRef = document;
  document.documentElement = new FakeElement("html");
  document.head = new FakeElement("head");
  document.body = new FakeElement("body");
  document.documentElement.appendChild(document.head);
  document.documentElement.appendChild(document.body);

  const resolve = (value) => {
    if (typeof value !== "string") return "";
    const match = /^var\((--[a-z0-9-]+)\)$/i.exec(value.trim());
    return match ? (tokenColors[match[1]] ?? "") : value;
  };

  document.defaultView = {
    matchMedia: () => ({ matches: false }),
    CSS: { supports: () => true },
    getComputedStyle: (element) => {
      if (element === document.documentElement) {
        return {
          colorScheme: element.style.colorScheme ?? "",
          getPropertyValue: (token) => (token === DOM_REGISTRATION_PROBE ? "" : (tokenColors[token] ?? "")),
        };
      }
      if (element.className === DOM_THEME_PROBE_CLASS) return { color: themeColor };
      const style = element.style ?? {};
      return {
        color: resolve(style.color),
        backgroundColor: resolve(style.backgroundColor) || element.__background || "rgba(0, 0, 0, 0)",
        backgroundImage: style.backgroundImage ?? "none",
        filter: style.filter ?? "none",
        backdropFilter: style.backdropFilter ?? "none",
        webkitBackdropFilter: style.webkitBackdropFilter ?? "none",
        opacity: style.opacity ?? "1",
        mixBlendMode: style.mixBlendMode ?? "normal",
        webkitTextFillColor: style.webkitTextFillColor ?? "",
        display: style.display ?? (element.tagName === "DIV" ? "block" : "inline"),
        visibility: style.visibility ?? "visible",
        borderStyle: style.borderStyle ?? "none",
        borderWidth: style.borderWidth ?? "0px",
        outlineStyle: style.outlineStyle ?? "none",
        outlineWidth: style.outlineWidth ?? "0px",
        outlineOffset: style.outlineOffset ?? "0px",
        outlineColor: resolve(style.outlineColor),
      };
    },
  };
  return document;
}

function visibleOutline(document, backdrop, { image = "none", transparentParent = false } = {}) {
  const parent = document.createElement("div");
  parent.__background = transparentParent ? "rgba(0, 0, 0, 0)" : backdrop;
  parent.style.backgroundImage = image;
  if (transparentParent) {
    const outer = document.createElement("div");
    outer.__background = backdrop;
    outer.appendChild(parent);
    document.body.appendChild(outer);
  } else {
    document.body.appendChild(parent);
  }
  const node = document.createElement("div");
  node.style.outlineColor = `var(${PAIR.foreground})`;
  node.style.backgroundColor = `var(${PAIR.background})`;
  node.style.outlineStyle = "solid";
  node.style.outlineWidth = "1px";
  node.style.outlineOffset = "0px";
  parent.appendChild(node);
  return node;
}

test("an outside outline is only measured when its painted ancestor is the declared background", () => {
  const mismatchDocument = createFakeDocument();
  const mismatch = verifier.measureDocument(
    mismatchDocument,
    SCENARIO,
    CONTRACT,
    { elements: new Map([[PAIR.id, visibleOutline(mismatchDocument, "rgb(0, 0, 0)")]]) },
  );
  assert.equal(mismatch.measurements[0].status, "unmeasured");
  assert.equal(mismatch.errors[0].cause, "outline-backdrop-mismatch");

  const matchDocument = createFakeDocument();
  const match = verifier.measureDocument(
    matchDocument,
    SCENARIO,
    CONTRACT,
    { elements: new Map([[PAIR.id, visibleOutline(matchDocument, TOKENS["--color-bg"])]]) },
  );
  assert.notEqual(match.measurements[0].status, "unmeasured");
  assert.equal(match.measurements[0].ratio, core.contrast(
    core.parseComputedColor(TOKENS["--color-focus-ring"]),
    core.parseComputedColor(TOKENS["--color-bg"]),
  ));
});

test("the synthetic outline probe is fully inside its own background", () => {
  const document = createFakeDocument();
  const result = verifier.measureDocument(document, SCENARIO, CONTRACT);
  assert.notEqual(result.measurements[0].status, "unmeasured");
  const host = document.querySelector(`[${DOM_PROBE_HOST_ATTRIBUTE}]`);
  const probe = host.children.find((child) => child.getAttribute(DOM_PROBE_ATTRIBUTE) === PAIR.id);
  assert.ok(probe, "the outline probe must exist");
  assert.equal(probe.style.outlineStyle, "solid");
  assert.equal(probe.style.outlineOffset, "-1px");
  assert.equal(probe.style.outlineWidth, "1px");
  const computed = document.defaultView.getComputedStyle(probe);
  const offset = Math.abs(parseFloat(probe.style.outlineOffset));
  const width = parseFloat(probe.style.outlineWidth);
  // Partial inward inset or a wider border would paint part of the ring outside the measured background.
  const border = Math.max(...computed.borderWidth.split(" ").map(parseFloat));
  assert.ok(offset >= width + border, "the inward offset must cover the ring and the border");
});

test("a partial inward outline over a border is unmeasured", () => {
  const document = createFakeDocument();
  const node = visibleOutline(document, TOKENS["--color-bg"]);
  node.style.outlineOffset = "-1px";
  node.style.borderWidth = "0px 0px 0px 4px";
  const result = verifier.measureDocument(document, SCENARIO, CONTRACT, { elements: new Map([[PAIR.id, node]]) });
  assert.equal(result.measurements[0].status, "unmeasured");
  assert.equal(result.errors[0].cause, "outline-border-inset");
});

test("a partial inward outline without a border follows the painted backdrop", () => {
  const matchDocument = createFakeDocument();
  const matchNode = visibleOutline(matchDocument, TOKENS["--color-bg"]);
  matchNode.style.outlineOffset = "-1px";
  matchNode.style.outlineWidth = "2px";
  const match = verifier.measureDocument(matchDocument, SCENARIO, CONTRACT, { elements: new Map([[PAIR.id, matchNode]]) });
  assert.notEqual(match.measurements[0].status, "unmeasured");

  const mismatchDocument = createFakeDocument();
  const mismatchNode = visibleOutline(mismatchDocument, "rgb(0, 0, 0)");
  mismatchNode.style.outlineOffset = "-1px";
  mismatchNode.style.outlineWidth = "2px";
  const mismatch = verifier.measureDocument(mismatchDocument, SCENARIO, CONTRACT, { elements: new Map([[PAIR.id, mismatchNode]]) });
  assert.equal(mismatch.measurements[0].status, "unmeasured");
  assert.equal(mismatch.errors[0].cause, "outline-backdrop-mismatch");
});

test("an image or translucent outline backdrop is unmeasured", () => {
  const imageDocument = createFakeDocument();
  const image = verifier.measureDocument(imageDocument, SCENARIO, CONTRACT, {
    elements: new Map([[PAIR.id, visibleOutline(imageDocument, "", { image: "linear-gradient(red, blue)" })]]),
  });
  assert.equal(image.measurements[0].status, "unmeasured");
  assert.equal(image.errors[0].cause, "outline-backdrop-composited");

  const translucentDocument = createFakeDocument();
  const translucent = verifier.measureDocument(translucentDocument, SCENARIO, CONTRACT, {
    elements: new Map([[PAIR.id, visibleOutline(translucentDocument, "rgba(0, 0, 0, 0.5)")]]),
  });
  assert.equal(translucent.measurements[0].status, "unmeasured");
  assert.equal(translucent.errors[0].cause, "outline-backdrop-unverified");
});

test("a transparent parent falls through to the opaque ancestor", () => {
  const document = createFakeDocument();
  const node = visibleOutline(document, TOKENS["--color-bg"], { transparentParent: true });
  const result = verifier.measureDocument(document, SCENARIO, CONTRACT, { elements: new Map([[PAIR.id, node]]) });
  assert.notEqual(result.measurements[0].status, "unmeasured");
});

function resolvePlaywright() {
  const require = createRequire(path.join(WORKSPACE_ROOT, "package.json"));
  for (const request of ["playwright", "@playwright/test"]) {
    try {
      const api = require(request);
      const browsers = api?.chromium ? api : api?.default?.chromium ? api.default : null;
      if (browsers) return browsers;
    } catch {
      // Try the next package name.
    }
  }
  throw new Error("BLOCKED native proof: Playwright is not resolvable from the workspace root.");
}

// Real computed styles are the only proof for the outline backdrop: a fake DOM cannot
// tell us where the browser paints the ring. Opt-in, no project file is written.
test("native proof: outline backdrop guards on real computed styles", {
  skip: NATIVE_PROOF ? false : "opt-in: set SMART_COLORS_NATIVE_PROOF=1 to run the real browser outline proof",
}, async () => {
  const browsers = resolvePlaywright();
  const executable = browsers.chromium.executablePath();
  try {
    await access(executable);
  } catch (cause) {
    throw new Error(`BLOCKED native proof: Chromium binary unavailable at ${executable}.`, { cause });
  }

  const browser = await browsers.chromium.launch({ headless: true, timeout: 60_000 });
  try {
    const page = await browser.newPage({ colorScheme: "light" });
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({
      content: `(function () { var core = (${createVerificationCore.toString()})(); window.__smartColorsProof = { verifier: (${createDomVerifier.toString()})(core) }; })();`,
    });

    const results = await page.evaluate(({ contract, scenario }) => {
      const cases = ["synthetic", "outside-match", "outside-mismatch", "inside", "inside-border", "partial-no-border", "partial-border", "image", "translucent", "transparent-parent"];
      const output = {};
      for (const kind of cases) {
        const frame = document.createElement("iframe");
        document.body.appendChild(frame);
        const doc = frame.contentDocument;
        doc.open();
        doc.write('<!doctype html><html><head><style>:root { --color-bg: rgb(255, 255, 255); --color-surface: rgb(0, 0, 0); --color-focus-ring: rgb(255, 0, 0); } html, body { margin: 0; padding: 0; }</style></head><body></body></html>');
        doc.close();

        let parent = doc.createElement("div");
        parent.style.padding = "12px";
        parent.style.backgroundColor = kind === "outside-mismatch" || kind === "image" || kind === "translucent" ? "var(--color-surface)" : "var(--color-bg)";
        if (kind === "image") parent.style.backgroundImage = "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))";
        if (kind === "translucent") parent.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
        if (kind === "transparent-parent") parent.style.backgroundColor = "transparent";
        doc.body.appendChild(parent);
        if (kind === "transparent-parent") {
          const outer = doc.createElement("div");
          outer.style.backgroundColor = "var(--color-bg)";
          doc.body.insertBefore(outer, parent);
          outer.appendChild(parent);
        }

        const node = doc.createElement("div");
        node.style.width = "80px";
        node.style.height = "40px";
        node.style.backgroundColor = "var(--color-bg)";
        node.style.color = "var(--color-focus-ring)";
        node.style.outlineColor = "var(--color-focus-ring)";
        node.style.outlineStyle = "solid";
        node.style.outlineWidth = "2px";
        node.style.outlineOffset = "4px";
        if (kind === "inside") node.style.outlineOffset = "-2px";
        if (kind === "inside-border") { node.style.outlineOffset = "-6px"; node.style.borderStyle = "solid"; node.style.borderWidth = "2px"; }
        if (kind === "partial-no-border" || kind === "partial-border") { node.style.outlineOffset = "-1px"; node.style.outlineWidth = "3px"; }
        if (kind === "partial-border") { node.style.borderStyle = "solid"; node.style.borderWidth = "2px"; }
        parent.appendChild(node);

        let measured;
        try {
          const elements = kind === "synthetic" ? {} : { elements: new Map([[contract.pairs.light[0].id, node]]) };
          measured = window.__smartColorsProof.verifier.measureDocument(doc, scenario, contract, elements);
          output[kind] = { status: measured.measurements[0]?.status, cause: measured.errors[0]?.cause, ratio: measured.measurements[0]?.ratio };
        } catch (error) {
          output[kind] = { error: String(error) };
        }
        frame.remove();
      }
      return output;
    }, { contract: CONTRACT, scenario: SCENARIO });

    assert.notEqual(results.synthetic.status, "unmeasured", JSON.stringify(results));
    assert.notEqual(results["outside-match"].status, "unmeasured", JSON.stringify(results));
    assert.equal(results["outside-mismatch"].status, "unmeasured", JSON.stringify(results));
    assert.equal(results["outside-mismatch"].cause, "outline-backdrop-mismatch");
    assert.notEqual(results.inside.status, "unmeasured", JSON.stringify(results));
    assert.notEqual(results["inside-border"].status, "unmeasured", JSON.stringify(results));
    assert.notEqual(results["partial-no-border"].status, "unmeasured", JSON.stringify(results));
    assert.equal(results["partial-border"].status, "unmeasured");
    assert.equal(results["partial-border"].cause, "outline-border-inset");
    assert.equal(results.image.cause, "outline-backdrop-composited", JSON.stringify(results));
    assert.equal(results.translucent.cause, "outline-backdrop-unverified", JSON.stringify(results));
    assert.notEqual(results["transparent-parent"].status, "unmeasured", JSON.stringify(results));
  } finally {
    await browser.close();
  }
});
