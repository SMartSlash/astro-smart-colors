import assert from "node:assert/strict";
import test from "node:test";
import { contrastDiagnostic, diagnosticsRegress, warningRegresses } from "../../src/colors/contrast-diagnostics.mjs";

const message = (ratio, target = 4.6, minimum = 4.5) => contrastDiagnostic("light info-on-solid / solid", ratio, target, minimum, "WCAG AA normal-text reference");

test("diagnostics distinguish the project target from the stated minimum without rounding passes", () => {
  assert.match(message(4.56), /Status: below-target;.*minimum 4\.50:1/);
  assert.match(message(4.49924), /Status: below-minimum;.*minimum 4\.500000:1/);
  assert.match(message(4.5), /Status: below-target;/);
  assert.match(message(4.6), /Status: pass;/);
  assert.match(message(4.49924, 4), /below the stated minimum.*Status: below-minimum/);
  assert.match(message(2.99, 3, 3), /Status: below-minimum;/);
});

test("diagnostics show enough precision to reveal arbitrarily small shortfalls", () => {
  const ratio = 4.5 - Number.EPSILON * 4;
  const output = message(ratio, 4.5);
  assert.ok(output.includes(String(ratio)));
  assert.match(output, /Status: below-minimum;/);
});

test("source advice rejects new labels and deterioration below the minimum", () => {
  assert.equal(warningRegresses([message(4.56)], [message(4.55)]), false);
  assert.equal(warningRegresses([message(4.56)], [message(4.4)]), true);
  assert.equal(warningRegresses([message(4.4)], [message(4.39)]), false);
  assert.equal(warningRegresses([], [message(4.56)]), true);
  assert.equal(warningRegresses([message(4.56)], []), false);
});

test("structured advice regression policy uses facts and ignores passing checks, not warning presentation", () => {
  const fact = (status, label = "light identity is named / hover", severity = "warning") => ({ label, status, severity });
  assert.equal(diagnosticsRegress([fact("below-target")], [fact("below-target")]), false);
  assert.equal(diagnosticsRegress([fact("below-target")], [fact("below-minimum")]), true);
  assert.equal(diagnosticsRegress([fact("below-minimum")], [fact("below-minimum")]), false);
  assert.equal(diagnosticsRegress([fact("pass")], [fact("below-target")]), true);
  assert.equal(diagnosticsRegress([fact("below-target")], [fact("pass")]), false);
  assert.equal(diagnosticsRegress([fact("below-target", "first is a label")], [fact("below-target", "first is another label")]), true);
  assert.equal(diagnosticsRegress([], [fact("pass", "strict pair", "error")]), false);
});
