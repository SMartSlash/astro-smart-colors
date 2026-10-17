# @smartslash/astro-smart-colors

Portable Astro integration + CLI that turns a small editable OKLCH palette into a semantic, accessible CSS color API.

The package is build-time/dev-time only: it generates static CSS before Astro renders the site. No client JavaScript is required for the baseline color system.

## Palette in, readable CSS out

Use `palette.css` as the normal authoring interface: choose a name, an OKLCH source and a role. The current foundation accepts **one `canvas` and one `ink`**; add `ui`, `feedback` and `decorative` colors as needed. Explicit config can override role annotations; advanced tuning is not required for the normal workflow.

The generated `colors.css` is organized for consumption, not for editing:

1. **Foundation** — neutral backgrounds, text, borders and focus.
2. **Identity / brand (`ui`), then feedback** — palette order within each role; each direct color and its companion stay beside its surface, text, solid and border variants.
3. **Decorative colors, aliases and controls** — decorative pairs, alternative names and existing control-state tokens.
4. **Advanced** — surface/elevation composition, enabled logo/scales/hue options, native contrast helpers, tuning and resolved-value reference.
5. **Internal implementation** — all `--_*` declarations, including optional logo pairs; not a component API.

This organization changes neither token names nor generated values. It adds no utility classes or component framework. Pairing and contrast limits still apply; a custom source color is not a promise that every possible combination will be accessible.

## Start here: “I want X → use Y/Z”

Choose a **background/foreground pair**, not an isolated color. For daily component work, start with the seven neutral/border/focus names (`bg`, `surface`, `text`, `text-muted`, `border-subtle`, `border-strong`, `focus-ring`) plus five suffixes of one family (`surface`, `text`, `solid`, `on-solid`, `solid-hover`): **12 names**, not 230 choices. Substitute the family name when you need another brand color or a feedback state.

| I want… | Use this token combination | Important boundary |
|---|---|---|
| Neutral page and body text | `--color-bg` / `--color-text` | Use `--color-text-muted` for secondary content on neutral backgrounds. |
| Neutral card | `--color-surface` / `--color-text` | `--color-border-subtle` is an ornamental separator; optional `--elevation-1` is root-based elevation. |
| Filled button or badge | `--color-primary-solid` / `--color-primary-on-solid`; hover: `--color-primary-solid-hover` | Keep the same `on-solid` on hover. Check the current report and both rendered states; do not substitute `--color-on-primary`. |
| Soft colored callout or status | `--color-success-surface` / `--color-success-text` | The same family's `surface-strong` / `text-strong` are stronger variants. Include a label/icon, not color alone. |
| Decorative border or separator | `--color-primary-border` on `--color-primary-surface`, or neutral `--color-border-subtle` | Family `border` preserves the source; neither this nor a translucent neutral border promises a necessary control boundary. |
| Meaningful chromatic boundary | `--color-primary-border-strong` against the intended background | This family variant uses a stronger UI generation target derived from `contrast.ui`, capped by `contrast.maxIdentity`, then a final UI check against canvas, neutral surface and both family surfaces. This is not a guarantee on arbitrary backgrounds. Neutral `--color-border-strong` is a different, translucent token. |
| Identity color itself with overlaid content | `--color-primary` / `--color-on-primary` (or `--color-accent` / `--color-on-accent`) | Direct companions belong to direct fills, not family surfaces or hover fills. Check the actual pair after tuning. |
| Visible keyboard focus | `--color-focus-ring` against `--color-bg` or `--color-surface` | For example `outline: 2px solid var(--color-focus-ring); outline-offset: 2px` on `:focus-visible`. The generated target covers these neutral backgrounds, not every local surface. |

Use the same family combinations for `primary`, `secondary`, `tertiary`, `quaternary`, `success`, `warning`, `danger` and `info` when present in your palette. Controls have their own `--color-control-*` state tokens; the [control state pairs](#control-state-pairs) below list the opaque combinations checked. Alpha borders/icons and arbitrary combinations are not validated.

### Are 230 names too many?

**Too many to memorize; not 230 independent design decisions.** The measured inventory below belongs to **this repository's current `smart-colors.config.mjs` and `src/styles/tokens/colors.css`**, not the package defaults. It counts unique declared public custom-property names, excluding comments, references and every `--_*` internal; a `light-dark()` declaration counts as one name. Categories are disjoint: alias families are counted under aliases, not counted again under functional families.

| Current-project category | Public names | How to use it |
|---|---:|---|
| Neutral colors | 4 | Daily: canvas, surface, text, muted text |
| Neutral borders + focus | 3 | Daily, with the boundary caveats above |
| Functional families | 72 = 8 × 9 | Daily: learn suffixes once; choose a family |
| Direct identities + `on-*` companions | 16 = 8 × 2 | When the identity fill itself is intended |
| `accent` aliases | 11 = 2 + 9 | Alternative names for `secondary`, not new colors |
| Decorative bases + companions | 12 = 6 × 2 | Ornament and optional overlaid content |
| Controls | 8 | State-specific control styling |
| Surface substrate | 5 | Advanced/local composition; see inheritance limits below |
| Elevation | 4 | Optional box-shadow/filter combinations |
| Numeric scales | 70 = 7 × 10 | Optional advanced tonal choices; no per-step contrast promise |
| Hue variants | 4 = 2 × 2 | Optional advanced warm/cool choices |
| Native `--ink-*` helpers | 8 | Progressive enhancement, not baseline companions |
| Declared tuning knobs | 13 | Project-level refinement, outside generated contrast checks |
| **Total** | **230** | **A catalog, not a daily checklist** |

The seven numeric scales cover `primary`, `secondary`, `tertiary`, `success`, `warning`, `danger` and `info`; `quaternary` has a functional family but no numeric scale here. Hue variants cover only `primary` and `secondary`. Logo output is disabled. Optional `--color-tune-<identity>-dark` override hooks are accepted through fallbacks but are not declared in this output, so they are not additional names in this count. The separate motion output's registrations do not add names to this inventory.

**Recommended adoption:** start with neutral tokens and functional families. Scales and hue variants default to disabled in the package. If a project needs them, enable them deliberately and keep `scales.applyTo` and `scales.hueVariants.applyTo` focused on identities with real consumers; do not enable all scales just to build a button. Audit existing uses before narrowing those lists or disabling output, because that removes optional names. Functional families do not depend on numeric scales. This advice does not change this repository's config, defaults or public naming.

## Install

Workspace/local package example:

```json
{
  "dependencies": {
    "@smartslash/astro-smart-colors": "workspace:*"
  }
}
```

Astro config:

```js
import { defineConfig } from "astro/config";
import smartColors from "@smartslash/astro-smart-colors";

export default defineConfig({
  integrations: [smartColors()],
});
```

## Project config

Create `smart-colors.config.mjs` in the project root:

```js
import { defineSmartColorsConfig } from "@smartslash/astro-smart-colors/config";

export default defineSmartColorsConfig({
  palette: "src/styles/tokens/palette.css",
  output: "src/styles/tokens/colors.css",
  contrast: {
    text: 4.6,
    onColor: 4.6,
    ui: 3,
    maxIdentity: 7.5,
  },
  roles: {
    canvas: "--palette-bg",
    ink: "--palette-ink",
    identities: {},
    decoratives: {},
    focus: "primary",
  },
  aliases: {
    accent: "secondary",
  },
  motion: {
    enabled: false,
    output: "src/styles/colors-motion.css",
  },
  logo: {
    enabled: false,
    sources: {},
  },
});
```

### Optional on-solid foregrounds

The optional root-level `onSolid` map lets you author the functional foreground for an existing `ui` or `feedback` identity, independently for `light` and `dark`. Omitted identities and themes keep the generated foreground.

Merge this fragment into your existing config object; do not replace its other settings or existing `onSolid` entries:

```js
onSolid: {
  info: {
    light: "oklch(0.9944 0 0)",
  },
},
```

This is an optional authoring example, not a required fix: the current solver already generates `oklch(0.9944 0 0)` for this project's light `info` functional and direct companions without a palette/config edit.

`info` must already be a resolved UI/feedback identity. This setting affects only the light-theme value of `--color-info-on-solid`, used on both `--color-info-solid` and `--color-info-solid-hover`. It does not change `--color-on-info`, the direct identity companion, or either fill.

Values must be concrete opaque OKLCH strings accepted by the same parser as the palette, including its numeric/percentage channels and hue angle units. Alpha channels, calculated values, malformed colors, unknown identities and theme keys other than `light` or `dark` are validation errors. A syntax-valid foreground that misses contrast is retained (subject to the usual sRGB gamut mapping) and produces the existing contrast warnings, not an automatic replacement: the authored source remains yours to change.

## Palette input

The palette is the designer-facing source of truth. Each opaque OKLCH source declares one explicit role:

| Role | Designer intent | Generated contract |
|---|---|---|
| `canvas` | Main interface foundation; exactly one | `--color-bg`, neutral surfaces and dark foundation |
| `ink` | Main neutral content color; exactly one | `--color-text`, `--color-text-muted` and dark counterparts |
| `ui` | Operational brand/interface color | Source-preserving `border`/`solid`, derived surfaces, validated text and best-effort `on-solid` |
| `feedback` | Status or outcome such as success, warning, danger, info | Same source-preserving family, classified separately from brand UI |
| `decorative` | Ornament, mask, gradient or visual detail that carries no meaning alone | Theme-adapted base plus readable `--color-on-*` companion |

`content`, `action` and `fill` are deliberately not palette roles: they are usage variants generated by the engine. Every `@property` block must declare a role. Exactly one `canvas` and one `ink` must be available after palette/config resolution.

The parser ignores ordinary comments and commented-out declarations and rejects duplicate `@property` palette declarations. Legacy root-token input still supports standalone `/* @role ... */` annotations; role-like prose inside ordinary comments is not metadata.

The parser accepts CSS-compatible numeric channels: lightness as a number or percentage, chroma as a number or percentage (`100%` maps to `0.4`), and hue as a unitless degree value or a `deg`, `grad`, `rad`, or `turn` angle. Alpha channels and calculated values are intentionally rejected because the build-time contrast model requires a concrete opaque color.

```css
@property --palette-bg {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.9865 0.0078 105.49);
  role: canvas;
}

@property --palette-ink {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.28 0.007 3.68);
  role: ink;
}

@property --palette-primary {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.664 0.106 156.4);
  role: ui;
  dark-blend: 80;
}

@property --palette-danger {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.52 0.20 25);
  role: feedback;
}

@property --palette-spark {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.72 0.18 280);
  role: decorative;
}
```

### Per-color dark blending

`ui` and `feedback` colors may declare an optional unitless `dark-blend` descriptor from `0` to `100`. It controls a bounded white wash inspired by the Palette Lab rather than mapping directly to a CSS percentage:

- `0` keeps `100%` of the source color and produces no light/dark identity variation;
- `50` keeps `86%` of the source color and mixes `14%` white;
- `100` keeps `72%` of the source color and mixes `28%` white.

The generated source ratio is `100% - (dark-blend × 0.28%)`. When the descriptor is omitted, Smart Colors preserves the adaptive lightness-based fallback. `dark-blend` is rejected on `canvas`, `ink` and `decorative` colors because those roles use separate dark-mode derivations.

The resolved dark identity feeds functional families, numeric scales, contrast validation and the generated quick reference. Relative mode emits the authored mix as `color-mix()`; static mode emits the equivalent resolved OKLCH value. Runtime `--color-tune-<name>-dark` overrides remain an unvalidated escape hatch.

## Contrast contract

Contrast is validated as a relationship between generated foreground/background pairs, independently in light and dark mode:

| Pair | Configured target (light) | Enforcement |
|---|---:|---|
| neutral text or muted text / canvas and neutral surface | `contrast.text` (default `4.6`) | Adapted; target shortfalls fail generation |
| `<name>-text` and `text-strong` / canvas, neutral surface, family surface and surface-strong | `contrast.text` | All four backgrounds checked for each variant; target shortfalls fail generation |
| `<name>-border-strong` / the same four backgrounds | `contrast.ui` (default `3`) | Stronger generation target; final UI-target shortfalls fail generation |
| `<name>-border` or `solid` / canvas | No automatic correction | Preserve the designer's source (after sRGB gamut mapping) |
| direct `on-<name>` / direct identity | `contrast.onColor` (default `4.6`) | Foreground solver; target or normal-text minimum shortfalls warn |
| `<name>-on-solid` / solid and solid-hover | `contrast.onColor` | Best-effort or authored common foreground; target or normal-text minimum shortfalls warn |
| focus ring / canvas and neutral surface | `contrast.ui` | Adapted; target shortfalls fail generation |
| opaque control text / active or focus background | `contrast.text` | Explicit state pairs checked; shortfalls warn, fills preserved |
| opaque control active border / canvas and active background | `contrast.ui` | Shortfalls warn, state colors preserved |
| decorative `on-*` / decorative base | `contrast.onColor` | Adapted; target or normal-text minimum shortfalls warn |

Dark body/family text and family UI targets retain `min(contrast.maxIdentity, configuredTarget × contrast.darkRichness)`. Direct companions use `contrast.onColor + 0.02` during foreground search in **both** themes, with no `darkRichness` multiplier; their final warning target is `contrast.onColor`, as for `on-solid`. Focus and control active-border checks also use unamplified `contrast.ui`. Decorative derivation retains its existing dark-richness target and may adjust the derived decorative background; this is separate from UI/feedback fill preservation. The table describes generated defaults, not runtime CSS overrides or arbitrary token combinations.

The palette remains the source of truth. In each theme, `border` and `solid` retain the resolved identity color; `solid-hover` is derived from it without automatic correction of the fill. Dark identities respect authored `dark-blend` or the adaptive fallback. Out-of-sRGB colors have their chroma reduced while preserving lightness and hue; that gamut mapping is not a contrast correction.

Unless an `onSolid` foreground is authored for that identity/theme, the solver seeks one `on-solid` foreground for both normal and hover fills; direct companions run the same solver against their direct fill alone. Candidate contrast is scored **after sRGB fitting and serialization**, maximizing the minimum contrast across the supplied backgrounds when ranking preferred colors. The best preferred foreground among emitted ink, neutral `L = 0.02` and neutral `L = 0.99` is kept when it passes the search target. Otherwise the solver searches `L = 0…1` inclusive in `0.0001` steps (including black/white endpoints), in the ink's C/H domain and a neutral domain, selecting a passing candidate nearest to a preferred emitted L. If none passes, it retains the highest minimum-contrast candidate found as best effort within those domains—not a claim of global impossibility or perceptual nearest color.

Foreground warnings do not rewrite the source, lower the target or abort generation. Body/family text, family `border-strong` and focus target failures still abort before CSS is written.

A warning is not an accessibility certification: inspect the actual component and its normal/hover states. `4.6` includes a margin above the **4.5:1 normal-text reference minimum**; necessary UI boundaries/indicators use a **3:1 non-text reference minimum**. Contrast warning strings append `Status: below-target` when the configured target is missed but the minimum is met, or `Status: below-minimum` when that reference minimum is missed (which takes precedence), plus the minimum and intended usage. A target below the reference minimum does not suppress warnings: a pair may pass its configured target and still warn as `below-minimum`. These are diagnostic string details, not new report/API fields or an accessibility certification.

Source-preserving borders/fills must not be relied on as the necessary control boundary or sole state indicator unless their actual contrast is sufficient. Neutral alpha borders and alpha control focus-border/icon-muted tokens are decorative and are **not contrast-validated**.

Contrast pass/fail uses the emitted OKLCH literals (up to four decimal places) and emitted mix percentages, not higher-precision pre-serialization candidates. There is no permissive epsilon: a ratio below the target fails. Shortfall diagnostics reveal extra precision when two-decimal rounding would hide the difference. The text-generation safety margin is applied after the target cap, including a dark target capped at `7.5`; on-solid shortfalls remain warnings, not automatic source or authored-foreground replacements.

Native OKLCH mixes use neutral endpoints with missing hue (`none`), not explicit hue `0`. The JavaScript model follows CSS shorter-hue interpolation and missing-hue borrowing, keeping native mix intermediates raw rather than gamut-mapping or rounding them again. Correcting this correspondence can change native dark colors and derived family surfaces in both themes without changing the authored palette or light identity fills. Project-level overrides remain outside these checks.

### Read-only contrast suggestions

For on-solid shortfalls, the CLI prints the advice returned in `report.suggestions`. Suggestions never autofix the palette, config or generated `colors.css`. Existing palette and config choices stay unchanged until you explicitly apply an option.

The search prefers preserving the fill:

1. **Foreground first.** Find the nearest foreground lightness on a four-decimal `L` grid, keeping its hue and chroma fixed. Both solid and hover contrast must meet `contrast.onColor + 0.02` (capped at `21`) after sRGB gamut mapping and CSS serialization. Advice identifies the authored and resolved fill source, destination `onSolid.<name>.<theme>` key and exact scope: only that identity/theme's `on-solid`, shared by solid/hover, not the direct companion or either fill. “Nearest” means nearest L on that four-decimal grid, not globally nearest perceptual color.
2. **Optional source fallback.** If no foreground candidate works, search for the nearest authored palette-source lightness on the same grid, keeping the source's chroma and hue fixed. The parser retains raw authored chroma and hue separately from gamut-mapped colors, so source advice preserves those authored channels even for out-of-sRGB sources. Advice identifies the actual source syntax: the palette `@property` and its `initial-value`, or the legacy `:root` custom-property declaration. The source trial preserves full authored chroma/hue precision. Full generation is rechecked in both light and dark schemes; the affected pair must meet the safety target, and neither new contrast-warning labels nor deterioration of an existing warning to `below-minimum` may appear. A source edit affects the identity in both themes and its derived families/scales; logo sources remain separate. This is an optional palette edit, not a silent fill correction.
3. **Explicitly unavailable.** If neither search yields a verified candidate, the report says no verified suggestion was found within those constraints. It does not claim that another hue/chroma or a redesigned solid/hover pair could never work, and it never applies an unverified fix.

For this project's current light `info`, generation now selects `oklch(0.9944 0 0)` automatically for **both** `--color-info-on-solid` and `--color-on-info`, preserving the authored palette/config and fills. The `onSolid.info.light` example remains a valid optional override but is no longer necessary to fix this pair; do not assume its former warning or suggestion still appears. An existing generated file can be stale until regeneration. Advice remains read-only: it never applies a config/palette edit.

Suggestions reflect the generated model, not runtime overrides in `colors-tuning.css` or other project-level tuning styles. Those overrides are not included in the advisory contrast checks.

### Project tuning audit (browser, read-only)

This repository has a separate audit for the final root token pairs after `colors-tuning.css`. It is project tooling, **not a new package API or a change to `smart-colors check`**:

```sh
pnpm colors:audit chromium webkit
```

Without browser arguments it uses Chromium. It requires already installed Playwright browser binaries; it never downloads browsers automatically. All test content is inline and network requests are blocked.

The audit reads the actual generated file on disk, applies it and `src/styles/tokens/colors-tuning.css` in the `tokens` layer, and compares computed baseline/tuned pairs. It covers both explicit `data-theme` values with both browser color preferences, including root tuning conditional on either. Presentation-only output drift is accepted after checking the complete single-root declaration map, including `color-scheme`; changed values, duplicates or different rule structures require regeneration. It does not overwrite either file.

- **`below-target`** — meets the reference minimum but misses the configured target; advisory, exit `0` if these are the only deficits.
- **`below-minimum`** — misses the normal-text reference `4.5:1` or necessary UI reference `3:1`; exit `1` after reporting all scenarios.
- Missing/invalid colors, alpha within an audited pair, tuning `@import` rules, unavailable browser or other incomplete checks exit `1`; inherited/default colors or unmeasured imported overrides must not produce a false pass.

Measurements use opaque computed CSS colors with the generator's **clipped-sRGB WCAG reference**. They are not screenshot-pixel measurements or a wide-gamut display certification. Scope: neutral text/focus, UI/feedback text/border-strong/direct/solid-hover, decorative companions and opaque control pairs. Excluded: alpha compositing, alias overrides, numeric/hue choices, forced colors, component styles, local themes and arbitrary backgrounds. The audit does not regenerate foregrounds, apply fixes or change existing build/CI behavior.

Browser regression and entrypoint tests remain separate from the package's browser-independent unit suite:

```sh
node scripts/test-smart-colors-browser.mjs chromium webkit
node scripts/test-smart-colors-audit.mjs chromium webkit
```

The first includes empty, macro, per-color, media/attribute-conditioned, invalid, RGB and alpha tuning probes. The second checks audit exit codes, presentation drift, stale value rejection and byte-for-byte preservation on success and failure.

Suggestions honor the selected `--config` path rather than assuming `smart-colors.config.mjs`. Merge config snippets into that file while preserving other settings, identities and themes. If you choose the source fallback, edit only the indicated `initial-value` or legacy custom-property declaration, preserving roles and other descriptors. Regenerate and check the output after your chosen edit; do not hand-edit generated `colors.css`.

### Visual diagnostic report

```sh
pnpm colors:report chromium webkit
```

This explicit, project-local command writes **`reports/smart-colors-preview.html`** (designer overview, ≤120 KB) and **`reports/smart-colors.html`** (full audit), from the same snapshot through the same ownership-checked writer. They are autonomous offline HTML files, not website pages, with no JavaScript or external assets. Chromium is the default if no browser is specified. Normal `colors:check`, `colors:audit` and the dev watcher do not create reports or apply corrections.

#### Designer workflow

1. Choose colors, roles and optional `dark-blend` in **`palette.css`**. This remains the initial source of creative choices; do not edit generated `colors.css`.
2. Run `pnpm colors:build`, then `pnpm colors:report chromium webkit` to measure the generated pairs with project tuning in the installed browsers. A successful build/check alone does not verify runtime tuning or real components.
3. Read the CLI's grouped summary: **below minimum**, **below target**, or **incomplete verification**. It uses the same validation and grouping as both HTML renderers. It identifies measured baseline/tuning differences without blaming the palette for a pre-existing problem. Raw repeated browser diagnostics stay in the full report; the audit-only command retains its detailed console output.
4. Follow the printed `file:` URL to the newly written preview. Compare current/suggested swatches, use-specific combinations, source/variant differences and the exact destination snippet. Decide whether to change a source color, its use, or a separate tuning/config setting. Suggestions are independent manual alternatives, not a combined patch; regenerate and remeasure after choosing one.

The tool evaluates **color combinations for a stated use**, not aesthetic quality. Intentional brand-to-functional shifts and exploratory combinations are information, not palette-validation warnings. No global “optimal palette” is claimed, and no source choice is changed automatically. Unverified snapshots never receive a positive verdict or a suggested color; proposals missing even a previously passing control cannot be recommended.

The preview puts five sections within reach: action, problems, measured family atlas, the five largest brand/variant lightness shifts, and free-pairing counts with the best three normal-text combinations per theme. Full precision, complete measurements and provenance remain in the full report. Both are static: a prior file may be stale, and the CLI advertises a newly generated file **only after publication succeeds**, including diagnostic previews for incomplete runs.

The full page starts with the correction, not the audit log:

- verified corrections show large **current / suggested** color swatches, their OKLCH values, and the exact destination file and manually selectable snippet, without opening any disclosure;
- affected pairs are grouped by problem and theme rather than repeated for each browser/preference; before/after samples and compact ratios show the expected improvement;
- when a pair fails only because of the project tuning layer, the problem card says so with the measured numbers (**"without project tuning this pair measured X; with tuning active Y"**), and the section counts how many problems are of that kind. When the baseline already missed its thresholds, the note explicitly says the problem existed without tuning; it never attributes that pre-existing shortfall to tuning;
- proposal channel deltas (ΔL, ΔC, ΔH, ΔEOK) sit next to the suggested swatch; problem and changed-check rows live in a dedicated disclosure, with unchanged controls counted and linked back to the original scenario measurements; repeated before/after cards collapse to one per distinct measurement with an explicit scenario count;
- the minimum ratio is reported **separately for text and UI/borders** so a UI threshold cannot look like a text failure;
- a dark-fill tuning proposal also shows the **border side effect** it causes (`--color-<id>-border` on both canvas and neutral surface, before → after, measured in the browser in dark). This is explicitly **informational**: that border stays outside the verified pair set by design, so it never blocks or promotes a proposal — the card says when the border falls below the 3:1 non-text reference so the decision stays explicit.
- grouping never combines different usages, thresholds or outcomes; differing ratios/colors remain explicit in per-problem details, with the lowest-contrast scenario used for the preview;
- compact ratios never round a shortfall onto its minimum or target; classification and verification always use the original numbers;
- full-precision measurements, proposal coverage, provenance and OKLab details stay in initially closed native disclosures;
- the report navigation lists its sections in the same order as the document;
- **hue values are not perturbed by normalization**: an in-gamut authored color keeps its exact hue, so the palette comparison reports a source/resolved difference only when the color really changed (gamut fitting), not for a serialization artifact.
- the complete authored/resolved palette, file identities, SHA-256 fingerprint, errors and scope limitations are available in the technical details at the bottom. Audit errors preventing verification remain visible at the top.

The **usage overview** separately summarizes normal text on neutral backgrounds, text on solid colors, callout/control pairs, and opaque boundaries/focus. Each category shows light/dark results from the **current snapshot**, not the proposed corrections: OK applies only to measured pairs, below-target means the minimum is met but the project target is missed, and below-minimum means avoid that pair for the indicated use. Browser/preference repeats count once, using the worst outcome; missing or incomplete data never receives an OK badge.

A **family atlas** then renders each `--color-<name>` that appears in the measurements: text on its callout (with the strong border), the solid/hover button pair with its on-solid text, and the chip/badge on-color pair, for light and dark. Samples are built **only from pairs that were actually measured**, each using its worst browser/preference measurement; families without measurements produce no sample, and an incomplete snapshot says so instead of implying a clean result. Visual samples use a real typographic scale (title, body, small label) and real border widths (1, 2, 3 px), because an isolated thick border does not show how visible a 1 px border is.

The same section reports **functional variants that drift away from their brand color**: for each identity it compares the resolved palette source with its `*-text` and `*-border-strong` variants and lists the ones beyond `|ΔL|` or `|ΔC| ≥ 0.04`, sorted by magnitude, with the direction (lighter/darker). This is presentation only: the generator does **not** warn about normal, intentional contrast adaptation, so `colors:build` output is unchanged. A variant equal to its source is never listed, and when no source/variant comparison is possible the block is omitted instead of implying a clean result.

A separate **exploratory overlap** check compares every configured identity/decorative base color against neutral `bg`/`surface`, plus every unordered pair of distinct base colors. For `N` base colors it checks `N*2 + N*(N-1)/2` pairs per scenario, reusing opaque browser-resolved tokens. Results are reported as **what you can use**: pairs safe for normal text (≥ 4.5:1), pairs limited to large text, boundaries and icons (≥ 3:1), and the number to avoid, with the full tables in closed details. A compact **N×N matrix** (rows: foreground base color, columns: neutral and base backgrounds) gives the same verdict per cell, showing `AA`, `3:1` or `no` plus the exact compact ratio; the diagonal is not a measurement, an unmeasured cell says so, and a theme without measurements has no matrix at all. It does not grant a general color-distinguishability or large-text certification. These are **possible misuse risks, not existing site defects**, and they never affect the original audit outcome, exit policy or correction proposals. Alpha, images, gradients and component-specific overrides still require contextual checks.

The report remains static and useful without JavaScript. Recommendations do not claim a globally optimal palette. Multiple corrections are independent options, not an automatically verified combined patch.

Correction order is conservative: preserve the fill via an existing on-solid foreground override, refine the neutral light-surface knob when that causes the deficit, then consider available source-palette suggestions. The same machinery also searches the **dark** neutral knobs (`--color-tune-dark-bg-depth`, `-surface-depth`, `-muted-depth`) and the per-identity `--color-tune-<id>-dark` escape hatch, and a source-palette trial covers both the on-solid pair and the direct `--color-on-<id>` companion. Every candidate is applied only in memory and checked in **all four theme/preference scenarios and every requested browser**. It must resolve its named issues without new target failures or deterioration below a reference minimum. A search that cannot be verified produces no proposal at all. Source trials use the exact authored serialization shown in their snippets. Ambiguous repeated tuning declarations are not rewritten speculatively. If no candidate passes within these supported searches, the report explicitly says no verified proposal is available; it never promises an optimal palette or a globally nearest color.

The report command preserves palette, config, tuning and generated color files. Unlike the strict generator, its internal read-only analysis can inspect a finite but contrast-failing model. If generated output is missing or differs, the page clearly identifies the measured CSS as a **diagnostic in-memory candidate**, not accepted production output. Invalid input produces an incomplete report without verified proposals when its configured paths are known safely; an unloadable config or an input change during the session aborts publication. Captured palette bytes drive both analysis and trials, so a fingerprint cannot silently identify a different palette from the one measured.

The HTML is a **static snapshot**, not a live validity badge. It is refreshed even after a successful or incomplete run, so a previous failure is not left as the apparent latest result. It cannot detect later edits by itself: regenerate and compare its timestamp/fingerprint before using its recommendations. Scope and exit policy match the browser audit: `below-target` alone is advisory, `below-minimum` or an incomplete/contrast-error analysis exits `1` even if a report was created. Report creation does not make a failed check pass.

Only an existing report bearing the generator's ownership marker may be replaced. The writer protects configured/default input and output paths, refuses symlink/hardlink report targets, and writes atomically. These protections are conservative guards, not a filesystem security sandbox against hostile concurrent changes. Both artifacts are gitignored and are never opened automatically.

Report end-to-end checks, separate from the unit suite:

```sh
node scripts/test-smart-colors-report.mjs chromium webkit
```

## Generated public API

Components should consume only the public tokens:

```css
--color-bg
--color-surface
--color-text
--color-text-muted

--color-primary
--color-secondary
--color-tertiary
--color-accent

--color-on-primary
--color-on-secondary
--color-on-tertiary
--color-on-accent

--ink-primary
--ink-secondary
--ink-tertiary

--color-<identity>-surface
--color-<identity>-border
--color-<identity>-solid
--color-<identity>-on-solid
--color-<identity>-text

--color-border-subtle
--color-border-strong
--color-focus-ring

--color-control-*

--surface-color
--surface-contrast
--surface-text
--surface-text-muted
--surface-border

--elevation-1
--elevation-2
--elevation-filter-1
--elevation-filter-2

--color-tune-light-warmth
--color-tune-surface-lightness-shift
--color-tune-dark-warmth
--color-tune-dark-bg-depth
--color-tune-dark-surface-depth
--color-tune-dark-text-depth
--color-tune-dark-muted-depth
--color-tune-elevation-*
--color-tune-<identity>-dark
```

Generated internal tokens use the `--_*` prefix (including `--_color-*` and optional `--_logo-*`) and should not be consumed by components. This listing is an API overview, not a set always emitted by every config. An identity alias such as `accent` emits the direct pair and nine family aliases when its target has a family; it does **not** emit `--ink-accent`, numeric-step aliases or hue-variant aliases. Use `--ink-secondary` for that native helper in this project's `accent → secondary` mapping.

## Token consumption guide

Use this hierarchy when writing components. It keeps component CSS readable and prevents accidental coupling to generated internals.

### 1. Base components and neutral layout

For ordinary text, page chrome, neutral cards and layout defaults, start with the global semantic tokens:

```css
.component {
  background: var(--color-surface);
  color: var(--color-text);
  border-color: var(--color-border-subtle);
}

.component__meta {
  color: var(--color-text-muted);
}

.component:focus-visible {
  outline-color: var(--color-focus-ring);
}
```

Recommended tokens:

```css
--color-bg
--color-surface
--color-text
--color-text-muted
--color-border-subtle
--color-border-strong
--color-focus-ring
--color-control-*
```

### 2. Local surfaces

When a section, card or component owns a local background, assign its foreground and border explicitly as well. Overriding only `--surface-color` does **not** retheme inherited companion tokens:

```css
.feature-card {
  --surface-color: var(--color-primary-surface);
  --surface-text: var(--color-primary-text);
  --surface-text-muted: var(--color-primary-text);
  --surface-border: var(--color-primary-border);

  background: var(--surface-color);
  color: var(--surface-text);
  border-color: var(--surface-border);
  box-shadow: var(--elevation-1);
}
```

Custom-property references are resolved where their declarations compute. `--surface-contrast` and the elevation recipes declared on `:root` are inherited with root-resolved references; changing a child's `--surface-color` does not recompute them there. `--surface-text`, `--surface-text-muted` and `--surface-border` are neutral aliases, not automatic contrast solvers. The example deliberately assigns the same readable family text to secondary content because there is no family `text-muted` token; its inherited `--elevation-1` remains root-based, not newly derived from the card background. Verify local colors and any locally authored elevation in both themes; no local-scope primitive is generated.

Recommended tokens:

```css
--surface-color
--surface-text
--surface-text-muted
--surface-border
--surface-contrast
--elevation-1
--elevation-2
```

### 3. Buttons, badges, chips and colored states

For colored UI, prefer the semantic functional families over raw identity colors or numeric steps. They describe intent instead of tonal math. Text variants are contrast-adapted; source-preserving solid/on-solid pairs must be checked when generation reports a warning:

```css
.button--primary {
  background: var(--color-primary-solid);
  color: var(--color-primary-on-solid);
}

.button--primary:hover {
  background: var(--color-primary-solid-hover);
}

.badge--primary {
  background: var(--color-primary-surface);
  color: var(--color-primary-text);
  border-color: var(--color-primary-border);
}
```

Stable functional family:

```css
--color-<identity>-surface
--color-<identity>-surface-strong
--color-<identity>-border
--color-<identity>-border-strong
--color-<identity>-solid
--color-<identity>-solid-hover
--color-<identity>-on-solid
--color-<identity>-text
--color-<identity>-text-strong
```

Numeric steps such as `--color-primary-500` are optional advanced tokens. They never source the functional family and carry no independent semantic contrast promise.

### 4. Direct identity/on-color pairs

Use the direct identity pair when you need the configured identity color itself and the foreground generated for that fill. This is a different pairing from `solid` / `on-solid`; it does not promise contrast on a family surface or hover fill:

```css
.callout-icon {
  background: var(--color-primary);
  color: var(--color-on-primary);
}
```

Recommended tokens:

```css
--color-primary
--color-on-primary
--color-secondary
--color-on-secondary
--color-tertiary
--color-on-tertiary
--color-accent
--color-on-accent
```

`--ink-*` tokens are native `contrast-color()` helpers for progressive enhancement. Keep `--color-on-*` as the deterministic baseline when text/icon contrast is critical.

### Control state pairs

Controls preserve their source-derived state colors; checks report shortfalls rather than adjusting these fills. In both themes the explicit opaque matrix is:

| Foreground / boundary | Background(s) checked | Warning target |
|---|---|---|
| `--color-control-active-text` | `--color-control-bg-active` | Body-text target, including dark richness; normal-text minimum `4.5` |
| `--color-text` | `--color-control-focus-bg` | Same body-text target and minimum |
| `--color-control-border-active` | `--color-bg` and `--color-control-bg-active` | Unamplified `contrast.ui` (default `3`); necessary-boundary minimum `3` |

`--color-control-focus-border` (alpha), `--color-control-icon-muted` (alpha), `--color-control-border` (neutral alpha alias), `--color-border-subtle` and neutral `--color-border-strong` are decorative, **not validated pairs**. In particular, the alpha focus border is not a substitute for the checked opaque `--color-focus-ring`. Check compositing against the actual background if these details become necessary indicators.

### 5. Forbidden in components

Do not consume palette sources or generated internals from components, pages or layouts:

```css
/* Avoid */
--palette-*
--_color-*
```

`--palette-*` is editable input for the generator. `--_color-*` is implementation detail and may change when the generator changes.

### Quick chooser

| Case | Prefer |
|---|---|
| Body text | `--color-text` |
| Muted text | `--color-text-muted` |
| Page background | `--color-bg` |
| Neutral card | `--color-surface`, `--surface-*`, `--elevation-1` |
| Clipped/masked surface | `--surface-*`, `--elevation-filter-1` |
| Filled button | `--color-primary-solid`, `--color-primary-on-solid` |
| Soft badge/callout | `--color-primary-surface`, `--color-primary-text`, `--color-primary-border` |
| Generic border | `--color-border-subtle` |
| Focus state | `--color-focus-ring` |
| Form control | `--color-control-*` |
| Decorative, non-textual detail | `--color-spark`, `--color-glow`, or another decorative token |
| Never in component CSS | `--palette-*`, `--_color-*` |

## Global surface substrate

The generator emits a small root-level substrate. The optional motion output also registers `--surface-color` and `--surface-contrast` as inherited `<color>` properties; those registrations are not part of the baseline `colors.css`:

```css
:root {
  --surface-color: var(--color-bg);
  --surface-contrast: contrast-color(var(--surface-color));
  --surface-text: var(--color-text);
  --surface-text-muted: var(--color-text-muted);
  --surface-border: var(--color-border-subtle);

  --elevation-1: /* box-shadow: light shadows, dark tinted glow */;
  --elevation-2: /* stronger box-shadow elevation */;
  --elevation-filter-1: /* filter: alpha-aware drop-shadow chain */;
  --elevation-filter-2: /* stronger alpha-aware filter elevation */;
}
```

These root declarations provide reusable defaults, **not automatic local retheming**. A local `--surface-color` override alone does not recompute the inherited `--surface-contrast` or elevation recipes and does not choose new text/border colors. Assign the intended local companions explicitly, as in the local-surface example above; typed registrations do not change this dependency rule. `contrast-color()` is a native enhancement, not a fallback for a missing verified foreground.

Use `--elevation-1/2` with `box-shadow`, and `--elevation-filter-1/2` with `filter` for alpha-aware shadows. `drop-shadow()` follows the input alpha silhouette; it does not automatically make a shadow outside a clip applied to the same element visible. Use a suitable outer owner if clipping would cut the shadow off.

## Native ink helpers (`--ink-<identity>`)

For every identity, the generator emits a native `contrast-color()` helper:

```css
--ink-primary: contrast-color(var(--color-primary));
--ink-secondary: contrast-color(var(--color-secondary));
```

These tokens are progressive-enhancement hooks for components that want to branch with style queries. Keep the deterministic `--color-on-<identity>` pair as the baseline when readable text or icons are critical:

```css
.button {
  color: var(--color-on-primary);
}

@container style(--ink-primary: white) {
  .button {
    color: oklch(from var(--color-primary) 0.92 0.06 h);
  }
}
```

The package does not register a global `@property --ink` slot. If a component needs its own typed, animatable ink property, register and own that property in the consumer project's motion layer rather than coupling it to the generated color-token file.

## Optional theme motion

Color tokens and motion policy are generated as separate files. Enable the optional motion output when the consumer wants typed color interpolation during theme changes:

```js
motion: {
  enabled: true,
  output: "src/styles/colors-motion.css",
}
```

Import the generated file in the consumer's motion layer, not in the token layer:

```css
@layer reset, tokens, base, components, pages, animations, layout, utilities, capabilities, preferences, overrides;

@import "./tokens/colors.css" layer(tokens);
@import "./colors-motion.css" layer(animations);
```

The motion output dynamically registers every configured identity and its available `on-*` pair. `--color-bg` is registered but intentionally excluded from the transition to avoid browser-chrome sampling glitches. The duration uses `var(--theme-transition-duration, 0.4s)`.

Motion is progressive enhancement. Consumers that enable it must also provide a `prefers-reduced-motion` or equivalent application preference policy; projects that leave `motion.enabled` false receive only static semantic color tokens.

## Project-level tuning contract

The package emits public tuning knobs intended to be overridden by a project-level token file imported after `colors.css`, for example `src/styles/tokens/colors-tuning.css`:

```css
:root {
  --color-tune-light-warmth: 45%;
  --color-tune-dark-warmth: 75%;
  --color-tune-dark-bg-depth: 14%;
  --color-tune-dark-surface-depth: 19%;
  --color-tune-dark-text-depth: 88%;
  --color-tune-dark-muted-depth: 72%;

  --color-tune-elevation-1-shadow-alpha: 10%;
  --color-tune-elevation-1-border-alpha: 28%;
  --color-tune-elevation-1-glow-alpha: 14%;
}
```

Project-level overrides are applied by the browser after generation and therefore are not revalidated by `smart-colors check`. Keep accessibility-critical palette and contrast decisions in the source palette/config; use tuning tokens for controlled visual refinement.

In relative mode, `--color-tune-dark-text-depth` is the **weight of the authored canvas source** in the dark text mix with `oklch(0.99 0 none)`, not a percentage of ink, text opacity or a generic “make text brighter” control. More weight moves the text toward that source; with this project's canvas it slightly lowers lightness. `--color-tune-dark-muted-depth` instead weights the resolved dark text against the dark canvas: increasing it moves muted text toward full text. The emitted percentages may be adjusted by generation to meet contrast and need not equal the requested config ratio.

An identity override `--color-tune-<name>-dark` affects the dark direct `--color-<name>` **and the dark functional `<name>-border` and `<name>-solid`**, which reference the same identity variable. It does **not** regenerate `solid-hover`, `on-solid`, the direct `on-*` companion, surfaces, `border-strong`, text variants, numeric scales or hue variants, whose values were resolved separately. Aliases follow their target. If `<name>` is the configured focus identity, its dark override also feeds the dark control active-background, active-border and focus-background mixes; their foregrounds and the generated focus ring are not recomputed. A tuned fill/state can therefore disagree with its original hover state or foreground: recheck those rendered pairs explicitly.

For one-off dark identity corrections, prefer palette/config first. If a project still needs a CSS-level override, use public tuning tokens instead of internal generated variables:

```css
:root {
  --color-tune-primary-dark: oklch(0.60 0.13 32);
}
```

## Designer-facing functional families

Every `ui` and `feedback` color emits the same stable family, even when numeric scales are disabled:

```css
--color-primary-surface          /* subtle tinted background */
--color-primary-surface-strong   /* stronger selected/active surface */
--color-primary-border           /* chromatic border */
--color-primary-border-strong    /* stronger border/accent line */
--color-primary-solid            /* filled control / emphasis surface */
--color-primary-solid-hover      /* hover/pressed solid tone */
--color-primary-on-solid         /* text/icon on the solid color */
--color-primary-text             /* colored text/icon on neutral surfaces */
--color-primary-text-strong      /* stronger colored text/icon */
```

Numeric steps (`--color-primary-50` … `--color-primary-900`) are emitted only when `scales.enabled` applies to the color. They remain available for advanced fine tuning, but they are independent from the functional family and are not individually contrast-validated. Steps are theme-adaptive: `50` is the softest tint in the current color scheme, `500` is the identity color, and `900` is the strongest tone in the configured scale.

Paired hue variants use designer-facing names, for example:

```css
--color-primary-warm
--color-primary-cool
```

When more than two hue shifts are configured, the package falls back to explicit technical names such as `--color-primary-hue-plus-30`.

## Logo / brand tokens

The core package does not know about any specific brand system. If a project needs logo tokens, register source OKLCH colors through `logo.sources` in `smart-colors.config.mjs`:

```js
logo: {
  enabled: true,
  sources: {
    accent: "oklch(0.585 0.095 156.59)",
    body: "oklch(0.435 0.006 68)",
  },
}
```

The generator emits `--logo-*` tokens with light/dark variants. This keeps UI colors accessible while preserving brand-specific logo rendering.

## Programmatic API

The supported public entry points are:

```js
import smartColors from "@smartslash/astro-smart-colors";
import { defineSmartColorsConfig } from "@smartslash/astro-smart-colors/config";
import { generateColorTokens } from "@smartslash/astro-smart-colors/generate";
```

`generateColorTokens()` accepts `root`, `configFile`, `inlineConfig`, an already resolved `config`, `check`, and `suggest`. It returns the color CSS, optional motion CSS, resolved config, per-output state, warnings, read-only suggestions, errors and whether any output changed:

```js
const report = await generateColorTokens({
  root: new URL("./", import.meta.url),
  check: true,
});

if (report.changed) {
  console.error(report.errors.join("\n"));
}

for (const output of report.outputs) {
  console.log(output.path, output.changed);
}

for (const suggestion of report.suggestions) {
  console.log(suggestion);
}
```

Programmatic consumers can read `report.suggestions` as an array of advisory strings, separate from `report.warnings` and `report.errors`. Reading or displaying suggestions does not apply them; use `check: true` when inspecting the report without writing generated outputs.

CLI commands and default programmatic calls provide suggestions when available. Pass `suggest: false` to `generateColorTokens()` to skip the advisory search and return `report.suggestions` as `[]`, without changing generated CSS or warnings. This option controls advice only; it does not disable contrast validation.

Invalid configuration, palette or I/O rejects with an error. In check mode, stale output is represented by `report.changed === true` and a message in `report.errors`.

## Validation guarantees

Before generation, Smart Colors rejects:

- missing required palette tokens (own declarations, not inherited object properties), malformed/non-finite OKLCH values including overflow after unit conversion, and duplicate `@property` palette declarations;
- invalid public names, roles, contrast ratios and dark derivation modes, including public identity/decorative/alias names in the reserved `tune-*` namespace;
- malformed `onSolid` maps, unknown UI/feedback identities or themes, and non-concrete or non-opaque OKLCH foregrounds;
- aliases or configured colors that would collide with generated public tokens, including enabled logo-source names that duplicate automatically emitted logo tokens;
- scale steps that are non-integer, duplicated, or do not contain the configured base.

An explicitly selected config file (`--config` or programmatic/integration `configFile`) must exist: a missing file fails loading, even if its name is `smart-colors.config.mjs`. Only the **implicit** default path is optional. Astro's watcher preserves this distinction when the config disappears and reports errors for a missing explicit selection instead of silently loading defaults.

Before reading the palette or writing outputs, including in `check` mode, an output-path guard rejects collisions between an enabled output and the palette, selected config file or another enabled output. It compares normalized, symlink-resolved paths, including dangling symlinks and symlinked directory ancestors, without creating directories.

Canonically equivalent Unicode path spellings are conservatively rejected after NFC comparison, even on filesystems that can keep them separate; no path is silently renamed. Potential aliases that match after case folding are rejected unless both relevant existing ancestor directories are proven case-sensitive by a read-only probe bounded to 32 entries per directory. Unknown results are rejected conservatively; choose paths that differ beyond letter case. This guard is not a filesystem sandbox and does not protect against hard-link aliases or filesystem changes between validation and use (TOCTOU).

Output directories are created automatically. Changed files are written through a temporary sibling and atomically renamed, avoiding partially written CSS during development.

Neutral mix searches are verified at the two-decimal percentage precision actually emitted. Text correction considers exact black/white endpoints when the existing result is insufficient and checks the final serialized candidate against all declared backgrounds. Existing valid outputs are preserved rather than rewritten merely to unify algorithms.

Astro/Vite shutdown cancels the debounce, removes watcher listeners, skips queued regenerations and awaits a generation already in progress. In-flight writes may finish during teardown; no new generation or reload is scheduled after shutdown, and teardown does not complete while an active generation is still running.

## CLI

```sh
smart-colors build
smart-colors check
smart-colors check --config smart-colors.config.mjs --root .
smart-colors --config=smart-colors.config.mjs check
smart-colors --help
```

Options can be placed before or after the command. Supported flags are `--config`/`-c`, `--root`/`-r`, and `--help`/`-h`.

Diagnostic statuses do **not** change exit policy: a successful warning-only run exits `0`, including `below-minimum` warnings. Stale output in `check` mode, generation/validation errors or config/I/O failures exit non-zero. Treat warnings separately if your CI needs a stricter policy; the package introduces no new CI gate.

Both commands print warnings and read-only contrast suggestions from `report.suggestions` when available. `check` does not write generated outputs; `build` performs normal output generation but never applies suggested config or palette edits. Advice uses the config path selected with `--config` (relative to `--root`), and its fragments are meant to be merged into existing settings, not used as replacement config files. There is no autofix step and no recommendation to edit generated `colors.css`.

After a returned build/check result (including a stale-output check), the CLI also identifies the configured palette source and reminds the designer that browser tuning and real components have not been measured. If the selected project defines a nonempty `colors:report` package script and uses the default config path, it suggests running that command **before** opening the preview; it does not assume a report already exists or is current. Custom config paths, absent/malformed package metadata, and projects without that script do not get an inapplicable report command. Thrown validation/config/I/O failures retain their focused error output. This optional guidance performs no writes, launches no browser, and never changes warning strings or exit policy.

Useful package scripts:

```json
{
  "scripts": {
    "colors:build": "smart-colors build",
    "colors:check": "smart-colors check"
  }
}
```

## Browser regression checks

From this repository's root, using the existing `@playwright/test` dependency:

```sh
node scripts/test-smart-colors-browser.mjs chromium webkit
```

The requested browser binaries must already be installed; the script does not download them automatically. It checks independent mix oracles, generated light/dark pairs with and without scales, solid/hover warning correspondence, and a capped dark target of `7.5` with strict ratio comparisons. Fixture files live in a temporary directory and generation uses `check: true`; no application outputs, real palette or real config are written. This is a color-model regression check, not a full accessibility audit.

## Astro behavior

- On `astro dev`, the integration generates all enabled outputs and watches both palette and config files across `add`, `change`, and `unlink` events. Rapid atomic-save events are debounced into one regeneration.
- On `astro build`, it generates all enabled outputs before the build starts.
- The integration uses `suggest: false` to keep the exhaustive four-decimal lightness search out of the dev watcher. Generated CSS, contrast validation and warnings are unchanged; use the CLI or a default programmatic call to inspect suggestions.
- If generated output is out of date, `smart-colors check` exits with a non-zero status.

## Design principle

Keep the daily vocabulary small and memorable even when the generated catalog is large: use neutral pairs and repeatable functional-family suffixes first; opt into advanced scales, helpers and tuning only when needed. Put contrast search, dark derivation, fallback generation and brand-specific glue in build-time code/config, not in components.
