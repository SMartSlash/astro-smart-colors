import { contrast, fitToSrgb, serializedColor } from "./color-math.mjs";

const LIGHTNESS_STEPS = 10000;
const DARK = { l: 0.02, c: 0, h: 0 };
const LIGHT = { l: 0.99, c: 0, h: 0 };
const BLACK = { l: 0, c: 0, h: 0 };

// Backgrounds are already emitted literals or raw resolved native CSS mixes.
// Only foregrounds are materialized: rank exactly the color that is returned.
function scoreForeground(backgrounds, candidate) {
  const color = serializedColor(fitToSrgb(candidate));
  return { color, score: minimumContrast(backgrounds, color) };
}

function minimumContrast(backgrounds, color) {
  let score = Infinity;
  for (const background of backgrounds) {
    score = Math.min(score, contrast(color, background));
  }
  return score;
}

/**
 * Internal, pure selection over non-empty backgrounds/candidates. Highest minimum
 * contrast wins, passing the caller's effective target first; exact ties keep
 * candidate order. No safety margin or permissive epsilon is added here.
 */
export function chooseForeground(backgrounds, candidates, target) {
  if (backgrounds.length === 0 || candidates.length === 0) {
    throw new RangeError("Foreground selection requires backgrounds and candidates.");
  }

  let best;
  let passing;
  for (const candidate of candidates) {
    const scored = scoreForeground(backgrounds, candidate);
    if (!best || scored.score > best.score) best = scored;
    if (scored.score >= target && (!passing || scored.score > passing.score)) passing = scored;
  }
  return (passing ?? best).color;
}

/**
 * Preserve the best preferred [ink, .02 neutral, .99 neutral] when it passes.
 * Otherwise search L = 0..1 inclusive in .0001 steps in two domains: supplied
 * ink C/H (gamut-fit per candidate), and neutral C=0/H=0. Passing candidates are
 * ordered by distance to the nearest emitted preferred L, then lower L, then
 * chromatic before neutral. Contrast always uses the fit+serialized foreground
 * against ALL unchanged backgrounds. The caller supplies the safety target.
 *
 * If none passes, maximize minimum contrast among preferred and grid candidates;
 * exact ties keep the preferred winner, then the search order. This is best effort
 * within these domains, NOT a claim that no solution exists elsewhere in OKLCH.
 * Skip the grid only when all endpoints fail and their best score strictly
 * dominates the conservative continuous-luminance bound for every interior gap.
 */
export function bestOnSolid(backgrounds, ink, target) {
  const preferred = chooseForeground(backgrounds, [ink, DARK, LIGHT], target);
  let best = { color: preferred, score: minimumContrast(backgrounds, preferred) };
  if (best.score >= target) return best.color;

  const inkLightness = serializedColor(fitToSrgb(ink)).l;
  const anchors = [...new Set([inkLightness, DARK.l, LIGHT.l].map((l) => Math.round(l * LIGHTNESS_STEPS)))];
  const domains = [{ c: ink.c, h: ink.h }, { c: 0, h: 0 }];
  const endpoint = bestEndpoint(backgrounds, domains, anchors);
  if (endpoint.score < target && interiorContrastUpperBound(backgrounds) < endpoint.score) {
    return endpoint.score > best.score ? endpoint.color : best.color;
  }

  for (const index of nearestLightnessIndices(anchors)) {
    for (const domain of domains) {
      const scored = scoreForeground(backgrounds, { l: index / LIGHTNESS_STEPS, ...domain });
      if (scored.score >= target) return scored.color;
      if (scored.score > best.score) best = scored;
    }
  }
  return best.color;
}

function bestEndpoint(backgrounds, domains, anchors) {
  // Use the grid's tie order, not a new black/white or neutral preference.
  const distance = (index) => Math.min(...anchors.map((anchor) => Math.abs(index - anchor)));
  const indices = [0, LIGHTNESS_STEPS].sort((a, b) => distance(a) - distance(b) || a - b);
  let best;
  for (const index of indices) {
    for (const domain of domains) {
      const scored = scoreForeground(backgrounds, { l: index / LIGHTNESS_STEPS, ...domain });
      if (!best || scored.score > best.score) best = scored;
    }
  }
  return best;
}

function interiorContrastUpperBound(backgrounds) {
  // contrast(black, bg) = (Ybg + .05) / .05: order the unchanged, clipped
  // luminances without mapping/rounding a native mix or duplicating color math.
  const ordered = backgrounds.map((background) => ({ background, ratio: contrast(BLACK, background) }))
    .sort((a, b) => a.ratio - b.ratio);
  let bound = 1;
  for (let index = 1; index < ordered.length; index += 1) {
    // In each adjacent gap the max-min envelope peaks where the two contrasts
    // balance: sqrt((Yhi + .05) / (Ylo + .05)). Outside the outer backgrounds,
    // contrast is monotone toward black/white, so only endpoints can maximize it.
    bound = Math.max(bound, Math.sqrt(contrast(ordered[index - 1].background, ordered[index].background)));
  }
  // Round the pruning bound outward to cover division/sqrt roundoff and score
  // comparisons. This only DISABLES pruning near equality; never relaxes target.
  return bound * (1 + 8 * Number.EPSILON);
}

// Merge at most six outward integer streams. No full-grid sort/allocation on
// success: stop at the first passing lightness; exhaust the grid only on failure.
function* nearestLightnessIndices(anchors) {
  const cursors = anchors.flatMap((anchor) => [
    { anchor, index: anchor, step: -1 },
    { anchor, index: anchor + 1, step: 1 },
  ]);
  const visited = new Set();

  while (true) {
    let nearest;
    let distance = Infinity;
    for (const cursor of cursors) {
      if (cursor.index < 0 || cursor.index > LIGHTNESS_STEPS) continue;
      const currentDistance = Math.abs(cursor.index - cursor.anchor);
      if (currentDistance < distance || (currentDistance === distance && cursor.index < nearest.index)) {
        nearest = cursor;
        distance = currentDistance;
      }
    }
    if (!nearest) return;

    const index = nearest.index;
    nearest.index += nearest.step;
    if (visited.has(index)) continue;
    visited.add(index);
    yield index;
  }
}
