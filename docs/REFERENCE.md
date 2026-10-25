# @smartslash/astro-smart-colors

> Full technical reference. For the 90-second tour, start from the [README](../README.md).

Portable Astro integration + CLI that turns a small editable OKLCH palette into a semantic, accessible CSS color API.

The package is build-time/dev-time only: it generates static CSS before Astro renders the site. No client JavaScript is required for the baseline color system.

In the **Unreleased** sources, the `build` and `report` commands can also publish a portable diagnostic folder (`smart-colors-reports/` by default, configurable with `reports.directory`). The preview page loads an isolated local runtime that measures the embedded CSS bytes; the full report remains static (`script-src 'none'`) and loads only its same-folder stylesheet. That diagnostic runtime is not part of the generated color CSS and is not an Astro island. Keep the folder together; a single HTML file is no longer self-contained.

> **Release status.** The development sources (**Unreleased**) are no longer presentation-only: they add the designer provenance report, the public `--color-tune-<public-name>-light|dark` controls and the per-identity surface-mix knobs documented below. Existing tokens, macros and legacy dark knobs keep working. The current release tag is `v0.4.0`; that tag keeps the behavior documented in its [changelog](../CHANGELOG.md).

## Palette in, readable CSS out

The normal loop is short: edit the palette, run `build`, then **open the preview** the console points at. The terminal teaches the split as it works — your palette is the source, the generated CSS is not edited by hand, and the tuning file refines it at runtime.

Use `palette.css` as the normal authoring interface: choose a name, an OKLCH source and a role. The current foundation accepts **one `canvas` and one `ink`**; add `ui`, `feedback` and `decorative` colors as needed. Explicit config can override role annotations; advanced tuning is not required for the normal workflow. The design flow is **source → recipe → use → control → check actual**: the palette is the source, the generator derives the recipe, components consume the public token by intent, and tuning changes only public controls before the actual CSS plus tuning is verified.

The generated `colors.css` is organized for consumption, not for editing:

1. **Foundation** — neutral backgrounds, text, borders and focus.
2. **Identity / brand (`ui`), then feedback** — palette order within each role; each direct color and its companion stay beside its surface, text, solid and border variants.
3. **Decorative colors, aliases and controls** — decorative pairs, alternative names and existing control-state tokens.
4. **Advanced** — surface/elevation composition, enabled logo/scales/hue options, native contrast helpers, tuning and resolved-value reference.
5. **Internal implementation** — all `--_*` declarations, including optional logo pairs; not a component API.

This organization changes neither token names nor generated values. It adds no utility classes or component framework. Pairing and contrast limits still apply; a custom source color is not a promise that every possible combination will be accessible.

## Start here: “I want X → use Y/Z”

Choose a **background/foreground pair**, not an isolated color. For daily component work, start with the seven neutral/border/focus names (`bg`, `surface`, `text`, `text-muted`, `border-subtle`, `border-strong`, `focus-ring`) plus five suffixes of one family (`surface`, `text`, `solid`, `solid-text`, `solid-hover`): **12 names**, not 230 choices. Substitute the family name when you need another brand color or a feedback state.

| I want… | Use this token combination | Important boundary |
|---|---|---|
| Neutral page and body text | `--color-bg` / `--color-text` | Use `--color-text-muted` for secondary content on neutral backgrounds. |
| Neutral card | `--color-surface` / `--color-text` | `--color-border-subtle` is an ornamental separator; optional `--elevation-1` is root-based elevation. |
| Filled button or badge | `--color-primary-solid` / `--color-primary-solid-text`; hover: `--color-primary-solid-hover` | Keep the same `solid-text` on hover. Check the current report and both rendered states; do not substitute `--color-primary-ink`. |
| Soft colored callout or status | `--color-success-surface` / `--color-success-text` | The same family's `surface-strong` / `text-strong` are stronger variants. Include a label/icon, not color alone. |
| Decorative border or separator | `--color-primary-border` on `--color-primary-surface`, or neutral `--color-border-subtle` | Family `border` preserves the source; neither this nor a translucent neutral border promises a necessary control boundary. |
| Meaningful chromatic boundary | `--color-primary-border-strong` against the intended background | This family variant uses a stronger UI generation target derived from `contrast.ui`, capped by `contrast.maxIdentity`, then a final UI check against canvas, neutral surface and both family surfaces. This is not a guarantee on arbitrary backgrounds. Neutral `--color-border-strong` is a different, translucent token. |
| Identity color itself with overlaid content | `--color-primary` / `--color-primary-ink` (or `--color-accent` / `--color-accent-ink`) | Direct companions belong to direct fills, not family surfaces or hover fills. Check the actual pair after tuning. |
| Visible keyboard focus | `--color-focus-ring` against `--color-bg` or `--color-surface` | For example `outline: 2px solid var(--color-focus-ring); outline-offset: 2px` on `:focus-visible`. The generated target covers these neutral backgrounds, not every local surface. |

Use the same family combinations for `primary`, `secondary`, `tertiary`, `quaternary`, `success`, `warning`, `danger` and `info` when present in your palette. Controls have their own `--color-control-*` state tokens; the [control state pairs](#control-state-pairs) below list the opaque combinations checked. Alpha borders/icons and arbitrary combinations are not validated.

### Are 230 names too many?

**Too many to memorize; not 230 independent design decisions.** The measured inventory below belongs to **the reference site repository's current `smart-colors.config.mjs` and `src/styles/tokens/colors.css`**, not the package defaults. It counts unique declared public custom-property names, excluding comments, references and every `--_*` internal; a `light-dark()` declaration counts as one name. Categories are disjoint: alias families are counted under aliases, not counted again under functional families.

| Current-project category | Public names | How to use it |
|---|---:|---|
| Neutral colors | 4 | Daily: canvas, surface, text, muted text |
| Neutral borders + focus | 3 | Daily, with the boundary caveats above |
| Functional families | 72 = 8 × 9 | Daily: learn suffixes once; choose a family |
| Direct identities + `*-ink` companions | 16 = 8 × 2 | When the identity fill itself is intended |
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

**Recommended adoption:** start with neutral tokens and functional families. Scales and hue variants default to disabled in the package. If a project needs them, enable them deliberately and keep `scales.applyTo` and `scales.hueVariants.applyTo` focused on identities with real consumers; do not enable all scales just to build a button. Audit existing uses before narrowing those lists or disabling output, because that removes optional names. Functional families do not depend on numeric scales. This advice does not change that project's config, defaults or public naming.

## Install

The package is distributed from GitHub; nothing is published to npm. Install the current release tag — [`CHANGELOG.md`](../CHANGELOG.md) lists the token renames each release carries:

```sh
pnpm add -D github:SMartSlash/astro-smart-colors#v0.4.0
```

**Release status.** `v0.4.0` is the current release. It introduces the build/report diagnostic workflow and the native preview; the generated color API is unchanged from 0.3.0. The **Unreleased** development sources add the designer provenance report, the public per-token tuning controls and the surface-mix knobs; they are additive and keep the existing token names, macros and legacy dark controls working.

A dev dependency is enough: the package runs at build/dev time only and has no runtime dependencies. Astro is the only declared peer and it is optional; Playwright is not a dependency or peer. Inside a monorepo, a local workspace reference works the same way:

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

A complete starter you can open in a browser lives in [`examples/minimal/`](../examples/minimal/): one palette, one plain HTML page, no framework and no config file.

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
  reports: {
    directory: "smart-colors-reports",
  },
});
```

### Report folder

`reports.directory` is the folder `build` and `report` publish, containing `index.html`, `report.html`, `styles/preview.css`, `styles/report.css` and `scripts/preview.js`. The field is additive and optional: a config without `reports` keeps the portable default `smart-colors-reports`.

- A relative value resolves from the consumer root — the effective `--root`, or the current directory when it is omitted. The default folder therefore lives under the project that runs the CLI, never inside the installed package or `node_modules`.
- An absolute file path or a `file:` URL is used literally; a remote URL is rejected because the report must stay local.
- The setting only selects the output folder. Palette, config, tuning and CSS inputs always resolve from the consumer root, so moving the report folder never reinterprets an input.
- The writer creates only the configured folder and the files it owns. It does not write HTML implicitly elsewhere, does not migrate, move or delete a legacy `reports/` directory and does not remove the folder used by a previous `reports.directory`. Changing the setting leaves the old folder in place; remove or archive it yourself.

The complete folder is portable; a single HTML document is not self-contained. Copy or archive the whole folder, including `styles/` and `scripts/`. Moving a single HTML document drops its stylesheet and runtime.

### Optional solid-text foregrounds

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

`info` must already be a resolved UI/feedback identity. This setting affects only the light-theme value of `--color-info-solid-text`, used on both `--color-info-solid` and `--color-info-solid-hover`. It does not change `--color-info-ink`, the direct identity companion, or either fill.

Values must be concrete opaque OKLCH strings accepted by the same parser as the palette, including its numeric/percentage channels and hue angle units. Alpha channels, calculated values, malformed colors, unknown identities and theme keys other than `light` or `dark` are validation errors. A syntax-valid foreground that misses contrast is retained (subject to the usual sRGB gamut mapping) and produces the existing contrast warnings, not an automatic replacement: the authored source remains yours to change.

## Palette input

The palette is the designer-facing source of truth. Each opaque OKLCH source declares one explicit role:

| Role | Designer intent | Generated contract |
|---|---|---|
| `canvas` | Main interface foundation; exactly one | `--color-bg`, neutral surfaces and dark foundation; `dark-blend` accepted |
| `ink` | Main neutral content color; exactly one | `--color-text`, `--color-text-muted` and dark counterparts; `dark-blend` accepted |
| `ui` | Operational brand/interface color | Source-preserving `border`/`solid`, derived surfaces, validated text and best-effort `solid-text`; `dark-blend` accepted |
| `feedback` | Status or outcome such as success, warning, danger, info | Same source-preserving family, classified separately from brand UI; `dark-blend` accepted |
| `decorative` | Ornament, mask, gradient or visual detail that carries no meaning alone | Theme-adapted base plus readable `--color-*-ink` companion; `dark-blend` accepted |

`dark-blend` is accepted on all five roles. It is a bounded white wash, not a darkening toward black; when omitted, the role keeps its automatic derivation and the value is **not** treated as `0`.

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

Every role may declare an optional unitless `dark-blend` descriptor from `0` to `100`. It controls a bounded **white** wash inspired by the Palette Lab rather than mapping directly to a CSS percentage:

- `0` keeps `100%` of the source color and mixes `0%` white;
- `50` keeps `86%` of the source color and mixes `14%` white;
- `80` keeps `77.6%` of the source color and mixes `22.4%` white;
- `100` keeps `72%` of the source color and mixes `28%` white.

The generated source ratio is `100% - (dark-blend × 0.28%)`. The cap is 28% white: the blend never darkens toward black. When the descriptor is omitted, Smart Colors keeps the role's automatic derivation; an omitted descriptor is **not** `0`. WCAG does not impose a 10/90 (or any other fixed) mix: the resolved foreground/background pairs are what gets checked. Foundations and neutrals follow the same verified model, and a custom source is not a promise that every possible combination will be accessible.

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
| `<name>-solid-text` / solid and solid-hover | `contrast.onColor` | Best-effort or authored common foreground; target or normal-text minimum shortfalls warn |
| focus ring / canvas and neutral surface | `contrast.ui` | Adapted; target shortfalls fail generation |
| opaque control text / active or focus background | `contrast.text` | Explicit state pairs checked; shortfalls warn, fills preserved |
| opaque control active border / canvas and active background | `contrast.ui` | Shortfalls warn, state colors preserved |
| decorative `*-ink` / decorative base | `contrast.onColor` | Adapted; target or normal-text minimum shortfalls warn |

Dark body/family text and family UI targets retain `min(contrast.maxIdentity, configuredTarget × contrast.darkRichness)`. Direct companions use `contrast.onColor + 0.02` during foreground search in **both** themes, with no `darkRichness` multiplier; their final warning target is `contrast.onColor`, as for `solid-text`. Focus and control active-border checks also use unamplified `contrast.ui`. Decorative derivation retains its existing dark-richness target and may adjust the derived decorative background; this is separate from UI/feedback fill preservation. The table describes generated defaults, not runtime CSS overrides or arbitrary token combinations.

The palette remains the source of truth. In each theme, `border` and `solid` retain the resolved identity color; `solid-hover` is derived from it without automatic correction of the fill. Dark identities respect authored `dark-blend` or the adaptive fallback. Out-of-sRGB colors have their chroma reduced while preserving lightness and hue; that gamut mapping is not a contrast correction.

Unless an `onSolid` foreground is authored for that identity/theme, the solver seeks one `solid-text` foreground for both normal and hover fills; direct companions run the same solver against their direct fill alone. Candidate contrast is scored **after sRGB fitting and serialization**, maximizing the minimum contrast across the supplied backgrounds when ranking preferred colors. The best preferred foreground among emitted ink, neutral `L = 0.02` and neutral `L = 0.99` is kept when it passes the search target. Otherwise the solver searches `L = 0…1` inclusive in `0.0001` steps (including black/white endpoints), in the ink's C/H domain and a neutral domain, selecting a passing candidate nearest to a preferred emitted L. If none passes, it retains the highest minimum-contrast candidate found as best effort within those domains—not a claim of global impossibility or perceptual nearest color.

Foreground warnings do not rewrite the source, lower the target or abort generation. Body/family text, family `border-strong` and focus target failures still abort before CSS is written.

A warning is not an accessibility certification: inspect the actual component and its normal/hover states. `4.6` includes a margin above the **4.5:1 normal-text reference minimum**; necessary UI boundaries/indicators use a **3:1 non-text reference minimum**. Contrast warning strings append `Status: below-target` when the configured target is missed but the minimum is met, or `Status: below-minimum` when that reference minimum is missed (which takes precedence), plus the minimum and intended usage. A target below the reference minimum does not suppress warnings: a pair may pass its configured target and still warn as `below-minimum`. These are diagnostic string details, not new report/API fields or an accessibility certification.

Source-preserving borders/fills must not be relied on as the necessary control boundary or sole state indicator unless their actual contrast is sufficient. Neutral alpha borders and alpha control focus-border/icon-muted tokens are decorative and are **not contrast-validated**.

Contrast pass/fail uses the emitted OKLCH literals (up to four decimal places) and emitted mix percentages, not higher-precision pre-serialization candidates. There is no permissive epsilon: a ratio below the target fails. Shortfall diagnostics reveal extra precision when two-decimal rounding would hide the difference. The text-generation safety margin is applied after the target cap, including a dark target capped at `7.5`; solid-text shortfalls remain warnings, not automatic source or authored-foreground replacements.

Native OKLCH mixes use neutral endpoints with missing hue (`none`), not explicit hue `0`. The JavaScript model follows CSS shorter-hue interpolation and missing-hue borrowing, keeping native mix intermediates raw rather than gamut-mapping or rounding them again. Correcting this correspondence can change native dark colors and derived family surfaces in both themes without changing the authored palette or light identity fills. Project-level overrides remain outside these checks.

### Read-only contrast suggestions

For solid-text shortfalls, the CLI prints the advice returned in `report.suggestions`. Suggestions never autofix the palette, config or generated `colors.css`. Existing palette and config choices stay unchanged until you explicitly apply an option.

The search prefers preserving the fill:

1. **Foreground first.** Find the nearest foreground lightness on a four-decimal `L` grid, keeping its hue and chroma fixed. Both solid and hover contrast must meet `contrast.onColor + 0.02` (capped at `21`) after sRGB gamut mapping and CSS serialization. Advice identifies the authored and resolved fill source, destination `onSolid.<name>.<theme>` key and exact scope: only that identity/theme's `solid-text`, shared by solid/hover, not the direct companion or either fill. “Nearest” means nearest L on that four-decimal grid, not globally nearest perceptual color.
2. **Optional source fallback.** If no foreground candidate works, search for the nearest authored palette-source lightness on the same grid, keeping the source's chroma and hue fixed. The parser retains raw authored chroma and hue separately from gamut-mapped colors, so source advice preserves those authored channels even for out-of-sRGB sources. Advice identifies the actual source syntax: the palette `@property` and its `initial-value`, or the legacy `:root` custom-property declaration. The source trial preserves full authored chroma/hue precision. Full generation is rechecked in both light and dark schemes; the affected pair must meet the safety target, and neither new contrast-warning labels nor deterioration of an existing warning to `below-minimum` may appear. A source edit affects the identity in both themes and its derived families/scales; logo sources remain separate. This is an optional palette edit, not a silent fill correction.
3. **Explicitly unavailable.** If neither search yields a verified candidate, the report says no verified suggestion was found within those constraints. It does not claim that another hue/chroma or a redesigned solid/hover pair could never work, and it never applies an unverified fix.

Example from the reference site: generation selected `oklch(0.9944 0 0)` automatically for **both** `--color-info-solid-text` and `--color-info-ink` in its light theme, preserving the authored palette/config and fills. The `onSolid.info.light` entry remains a valid optional override in any project; do not assume a former warning or suggestion still appears after a palette or config change. An existing generated file can be stale until regeneration. Advice remains read-only: it never applies a config/palette edit.

Suggestions reflect the generated model, not runtime overrides in `colors-tuning.css` or other project-level tuning styles. Those overrides are not included in the advisory contrast checks.

### Browser verification: audit, build and report

There are two browser-related command families, with different boundaries:

- **`audit`** is the original strict, read-only command. It has no automation mode, defaults to Chromium when no browser is listed, measures the generated CSS and `colors-tuning.css`, writes nothing and exits non-zero on an unavailable/incomplete environment or a below-minimum pair. `below-target` remains advisory.
- **`build` and `report`** use the diagnostic workflow described below. `build` writes CSS and then the diagnostic folder; `report` writes only the diagnostic folder. Both always attempt publication after a safe analysis, even when the color output is already current.

`check` is not a browser command: it never regenerates HTML, never launches Playwright and never presents a previous report as current.

#### Build and report artifacts

```sh
pnpm exec smart-colors build
pnpm exec smart-colors report
pnpm exec smart-colors report chromium webkit
```

| Command | Writes | HTML | Default automation |
|---|---|---|---|
| `build` (also the default command) | Generated CSS/motion outputs and the diagnostic folder (documents plus local assets) | Always attempted after a safe analysis, including when CSS is unchanged | `auto` |
| `report` | The diagnostic folder; never palette, config, tuning or CSS | Always attempted with safe paths | `auto` |
| `init` | Starter palette and `colors-tuning.css` (plus a config when needed) | No | No |
| `check` | Nothing | No | No |
| `audit` | Nothing | No | Strict; no mode flag |
| Generator API / Astro integration | Only configured CSS/motion outputs | No implicit HTML | No |

In the **Unreleased** sources, the diagnostic folder comes from `reports.directory` (default `smart-colors-reports`):

- **`index.html`** — the designer preview: a compact source/pair toolbar and full-width guided contrast workbench that measures real `var(--color-*)` consumer frames, followed by the raw source and extended local verification archives. It loads `styles/preview.css` and the classic deferred `scripts/preview.js`, next to an inert JSON payload.
- **`report.html`** — the complete **static** full technical report with model and automation data, designer provenance (sources → recipes → public tokens → controls), generated-vs-baseline CSS provenance and a separate exploratory-overlap channel. It keeps `script-src 'none'`, has no script and loads only `styles/report.css`.
- **`styles/preview.css`, `styles/report.css`, `scripts/preview.js`** — local assets referenced by relative path; no remote assets are loaded.

Open `index.html` for the preview and `report.html` for the static report. Neither needs a server or a network request. Move or archive the whole configured folder: moving only one HTML file leaves its styles and runtime behind. A legacy `reports/` directory and the folder used by a previous `reports.directory` are not deleted, moved or rewritten, and they are not migrated automatically. `docs/CODE-REVIEW.md` and `docs/PREVIEW-UX-ANALYSIS.md` are historical and refer to those pre-migration paths.

The direct renderers keep their legacy standalone documents for backward compatibility: `formatContrastPreviewHtml()` and `formatContrastReportHtml()` still return a single inline HTML document. The CLI writer owns the folder bundle and the external local assets.

A stale generated CSS file stays an actual captured baseline, not a relabeled candidate; `report` writes no CSS, and a generated candidate is never presented as an on-disk measurement.

The preview reads designer-first: source/pair selection and the guided contrast workbench on real `var(--color-*)` frames lead, followed by the source palette archive (roles, exact `@property` declarations, full source and manual download), then the technical archive of resolved samples, then the extended local browser verification archive, then a **Correzioni e problemi** section only when there is something to correct or review (the verified corrections grouped by destination file, each a manual snippet), and finally the technical data and the automation evidence. In the archive samples the first family is open and the rest are native `<details>`; the model samples are an **estimate** — a browser-free forecast, never a verification — and no sample carries a verification badge. The raw technical data sits in a native `<details>` and the automation evidence stays a separate final section. Nothing in the preview is an editor and no change is applied or written from the page: the workbench drafts, the correction and the export are temporary and manual.

The complete folder is portable: there is no server and no remote asset, but a single HTML document is not self-contained because the documents depend on their sibling `styles/` and `scripts/` files. It describes one captured snapshot. The preview includes an inert JSON payload with the exact embedded CSS bytes; the full report keeps `script-src 'none'` and never gains a script.

A missing generated CSS file is a declared **generated candidate**; a present but stale file stays the actual captured baseline, not a relabeled candidate. `report` does not rewrite either. An unloadable config or unsafe destination path can prevent publication; the CLI never links an older file as if it were new. The documents and their local assets are published through one ownership-checked writer: each file must either be absent or start with the Smart Colors marker; configured inputs/outputs are protected from collisions; symlink and hard-link targets are refused; each file is replaced atomically through a sibling temporary file. All files are reported as successful only after the last rename. The folder is not a filesystem transaction: a later rename can still fail. The writer publishes only the configured `reports.directory`; it never writes inside `node_modules` by default and never deletes, moves or migrates a legacy `reports/` directory or a previously configured report folder.

#### Audit (strict, read-only)

`audit` reads the actual generated file on disk, applies it and `colors-tuning.css` in the `tokens` layer, and compares computed baseline/tuned pairs in both explicit `data-theme` values with both browser color preferences, including root tuning conditional on either. Presentation-only drift is accepted after checking the complete single-root declaration map, including `color-scheme`; changed values, duplicates or different rule structures require regeneration. It never overwrites a file.

Missing or invalid colors, alpha inside an audited pair, tuning `@import` rules, an unavailable browser or another incomplete check exit `1`; inherited/default colors or unmeasured imported overrides cannot produce a false pass. Measurements use opaque computed CSS colors with the generator's **clipped-sRGB WCAG reference**; they are not screenshot-pixel measurements or wide-gamut certification. Scope: neutral text/focus, UI/feedback text/border-strong/direct/solid-hover, decorative companions and opaque control pairs. Excluded: alpha compositing, alias overrides, numeric/hue choices, forced colors, component styles, local themes and arbitrary backgrounds. `audit` does not regenerate foregrounds, apply fixes or change build behavior. Its terminal output uses `Start`, `Browser`, `Result`, `Scope` and, when presentation-only drift is accepted, `Note`; its publication mode adds `Preview`, `Report`, `Summary` and `Action`.

#### Native preview

On load, the preview loads `scripts/preview.js` with a classic `defer` and reads its inert `<script type="application/json">` payload; the stylesheet is the same-folder `styles/preview.css`. It then measures the **embedded bytes**, not the project files on disk. It uses fresh isolated `iframe srcdoc` documents with `sandbox="allow-same-origin"`, no scripts in the frame, and DOM `style.textContent` injection so the audited CSS bytes are preserved. It reads the active `prefers-color-scheme` preference and measures, with that preference:

- baseline CSS in light and dark;
- when a non-empty tuning file is present, tuned CSS in light and dark.

The other preference is declared **unmeasured**; the local runtime does not rewrite media queries to simulate it, and that other preference is explicitly **not a second theme**. Browser automation is the only path that fills the theme × preference cross. Baseline and tuned runs stay separate, and both themes are measured under the **active** preference. The section opens with the measured variant/theme combinations (baseline and, when present, tuned, each in both themes), then the problems — up to eight cards by default, the rest behind a disclosure — and keeps the raw per-pair table in a native disclosure. If the preference changes, the local results are invalidated first and the runner reruns both themes. The native retry button repeats the run without moving focus. A measured result is invalidated before a rerun, so an old value cannot be shown as current.

The runtime emits a controller for the preview (`preference()`, `scenarios()`, `status()`, `report()`, `run()`, `invalidate(reason)`, `subscribe(listener)`) and uses the same pure verification core and DOM collector as the automation adapter. It verifies the snapshot's declared pairs only; the full read-only proposal solver remains outside the browser. Local measurements modify only the in-memory DOM: they never rewrite the preview, the static report or any project file, and the browser has no way to apply a change — edit the file and regenerate the snapshot.

With JavaScript disabled, or when CSP/support blocks execution, the page keeps the snapshot, model samples and an explicit “local measurements not run” status. Missing, invalid, alpha, unsupported-resource or unmapped results are `unmeasured`/unsupported, never a pass.

The preview CSP starts from `default-src 'none'`. In the bundle it permits the runtime with `script-src 'sha256-<emitted bytes>' 'self'` and the stylesheet with `style-src 'unsafe-inline' 'self'`; there is no `file:` scheme. Those sources are broader than the emitted relative references: `'self'` is same-origin, not an exact folder or path, and the SHA-256 records the emitted `scripts/preview.js` bytes for traceability; it is not an SRI pin on external execution. The generated documents reference only `styles/preview.css` and `scripts/preview.js` and make no remote request. `form-action 'none'` blocks form submissions. The local `srcdoc` measurement frames use `sandbox="allow-same-origin"` without scripts, which blocks scripts, popups and top-level navigation inside those frames; ordinary Preview/Report links navigate intentionally. `frame-src 'none'` is retained but does not itself sandbox the `srcdoc` frames. Existing inline renderers keep their inline hash-pinned CSP. The static report keeps `script-src 'none'`, loads only `styles/report.css` and has no script.

Both documents display the generation time and an abbreviated input SHA-256 fingerprint. They are snapshots: after editing the palette, config or tuning, regenerate them. The page cannot detect later disk edits on its own. Keep the folder together so the relative assets stay resolved.

#### Guided contrast workbench

The preview leads with the **guided contrast workbench** (`src/contrast-workbench-view.mjs`, runtime `src/contrast-workbench-runtime.mjs`): a compact header with an honest local/pending/draft badge and one export command, a horizontal source strip (native source select on narrow containers), a human current-use summary and **Cambia uso** command, comparison/theme controls and full-width specimens. The native use-picker dialog filters the selected source's generated uses by category and normalized word-AND search, with at most six real results per page and no dropped matches. Escape closes without changing selection; choosing a result applies the selection through the controller and restores opener focus. The complete native technical pair select remains inside the technical disclosure, with its original metadata. Specimens stack on mobile. Contextual correction actions follow; technical metadata and manual tuning remain disclosures. The source palette section publishes, per authored token, the exact captured `@property` declaration (or the legacy `:root` declaration), the raw authored value, the **declared** role (and the **effective** configured role only when it differs), the `dark-blend` line and the palette path/SHA-256; the **full source CSS** is selectable in a textarea and downloadable **manually** as `palette.css`. Roles and `dark-blend` are read-only there.

Every visible sample and every measurement is a real consumer specimen that reads the public `var(--color-*)` tokens inside an isolated `iframe srcdoc` (`sandbox="allow-same-origin"`, no scripts in the frame). No resolved RGB color is painted in place of the proof. The workbench does not call the generator and never substitutes the model candidate for an empty captured output.

- **Comparisons.** `themes` (light vs dark), `tuning` (baseline vs saved tuned) and `draft` (tuned vs the temporary draft) — three only. Each side reports the applied theme/variant, the byte provenance, the measured status and the minimum/target. Baseline and tuned are kept separate; the workbench does not rewrite media queries, and the OS `prefers-color-scheme` preference is read, not emulated. The theme radios, the comparison radios and the two frame headings are projected from the runtime's own `selection` and measured `views` (DOM properties set directly, never via a change event), so the page cannot show a theme or variant other than the one measured.
- **Controls, scoped to the selected pair and theme.** The form edits only the public controls the design metadata declares for the **currently selected pair and theme** (`session.design.tokens[token].controls[theme]`): a **full-color override** (`--color-tune-<public-name>-light|dark`) and a **surface-mix percentage** (`--color-tune-<identity>-surface[-strong]-<theme>-mix`, shown as a percentage of the 0–1 `defaultMix`). Overrides and mixes are temporary drafts validated against `CSS.supports()` and a `KNOWN_KNOB` pattern; alpha, `transparent`, `;{}` and newlines are rejected. The seven known macro knobs (`--color-tune-light-warmth`, `--color-tune-dark-warmth`, `--color-tune-dark-bg-mix`, `--color-tune-dark-surface-mix`, `--color-tune-dark-text-mix`, `--color-tune-dark-muted-mix`, `--color-tune-surface-lightness-shift`) remain a **runtime-only** API — `setOverride()`/`reset()` accept them, but the view does not render a global macro editor. Reset is available per pair and globally.
- **Editing shows the draft.** `setOverride()`, `reset()` and `applySuggestion()` switch the selection to the `draft` comparison before the next measurement, so a successful public edit is always visible; error paths never switch. A correction search that runs while a draft already exists switches to the real draft view and awaits its frames before computing the candidate, so a candidate is never verified against the saved-only view and then silently merged with a hidden override.
- **Copy and export.** The header's single **Esporta CSS** command opens the export disclosure and focuses its selectable textarea. `exportTuning()` serializes the draft as a `:root { … }` block; the preview shows it in a readonly textarea with a manual `colors-tuning.css` download. The export is recomputed from the current draft whenever it changes, the download link is hidden while there is no draft, and the copy action recomputes the draft and refuses to copy an empty export. Every download is a manual action; the page writes no file.
- **Minimum-lightness correction.** `suggest(side)` for `foreground` or `background` runs the shared `suggestLightness` factory from `./contrast-advice.mjs`: it searches the **minimum lightness** on the 0..1 grid (step `0.0001`) that satisfies the declared constraints, keeping chroma and hue fixed. This is explicitly **not** a global perceptual nearest match and no ΔE is minimized. The candidate is then verified by `verifyCandidate()` in a **real CSS trial across the contract pairs in both themes**, applying the draft and the candidate declaration to isolated frames and re-measuring with the same core collector, including a regression check (a previously passing pair that falls below its minimum, or an unmeasured affected pair). The candidate edits one theme's control, so the targeted theme changes while the opposite theme is still re-measured as collateral and is not claimed to change. Only a `verified` candidate can be applied (`applySuggestion()`), and applying it is still only a temporary override. A `none`, `regression` or `unavailable` result is disclosed with its reason.
- **A verified proposal is previewed before it is applied.** The suggestion panel shows the exact proposed `oklch(...)` value and before/after ratios; control/token identity, relevant minimum/target, ΔL, gamut note and verification scope remain in a native technical disclosure. When the host provides the two optional proposal containers, `renderProposal()` also renders two **real `var(--color-*)` consumer frames** — `Attuale` and `Proposta` — measured at the same `360×480` size as the trial (locally scrollable on narrow containers, never resized by the responsive layout); if the visible frames do not reproduce the verified ratios the preview **fails closed** and shows no positive claim. The draft and the export are **not** touched until `applySuggestion()` runs; the proposal is removed by `setOverride()`/`reset()`/`select()` (any draft mutation), a `prefers-color-scheme` change, `mount()`, `destroy()`, or a new `suggest()`. `state().suggestion.preview` carries the frame labels/status metadata only and never enters the serialized draft or export.
- **Discard without reset.** `discardSuggestion()` is synchronous and returns `state()`. It invalidates pending searches and clears the suggestion, trial frames and proposal frames; it preserves `draft`, `selection`, main measurements, `revision` and `exportTuning()` byte-for-byte. The UI's **Scarta proposta** uses this method, never `reset()`. Explicit apply/discard hands keyboard focus to the stable header export/correction control; subscriptions never move focus.
- **Role provenance.** Each source shows the **declared** role from the captured palette annotation (`session.paletteSource.sources[].role`); the **effective** configured role (`session.roles.identities[].role`, keyed by `paletteName`) is shown only when it differs, so the config role is never presented as the authored one.
- **No automatic writes.** `setOverride`, `reset`, `suggest` and `applySuggestion` change only the in-memory draft and frames. Nothing writes the palette, the config, the tuning file or `colors.css`.
- **Frozen controller surface.** The emitted script installs the controller on `globalThis.__smartColorsWorkbench`: `payload()`, `pairs(theme)`, `controls()`, `mount({ left, right, proposalBefore?, proposalAfter? })`, `select({ pairId, theme, comparison })`, `setOverride(control, value)`, `reset(control?)`, `suggest(side)`, `discardSuggestion()`, `applySuggestion()`, `exportTuning()`, `state()`, `subscribe(listener)`, `destroy()`, plus `containsUnsupportedResources(css)` and the `mounted`/`destroyed`/`frames` getters. The two proposal containers are **additive and optional**: when both are present the verified suggestion is rendered into them as a real base/candidate comparison, and when they are omitted the controller behaves as before (`state().suggestion.preview` stays `null`). The phases are `idle`, `running`, `complete`, `incomplete`, `unavailable`; the comparisons are `themes`, `tuning`, `draft`; the sides are `foreground`, `background`.
- **Limitations.** The workbench is **not an accessibility audit** and **not a full component catalog or an APG pattern gallery**: the specimen is a small demonstration surface. It measures declared opaque token pairs only and fails closed — an unsupported `@import`/`url()` resource in the baseline or tuning bytes is not applied, alpha and gradients are outside the measured scope, and `forced-colors` is not emulated. Its results are context-specific and are not a WCAG conformance certification.
- **Unreleased (verified).** The development sources add: a live semantic pair matrix driven by the runtime's own measurements (`state.views[].measurements`, no contrast math in the UI), with search and an outcome filter; a read-only bounded exploration disclosure reusing the 24-family cap and non-self pairs; per-token lightness editing (`setLightness(control, L)`, `L` in `0..1`, which reads the computed C/H and serializes through the shared core `oklch` before `setOverride`); override removal (`removeOverride(control)`) that leaves a live `initial` tombstone so the export drops the declaration while `reset()` stays the whole-draft discard; and `exportTuningFile()` returning `{ css, mode, warnings, removed, unmatched }` with `mode` in `complete`/`fragment`/`unavailable`. Each measurement also carries foreground/background **OKLCH metadata** (`foregroundOklch`/`backgroundOklch`) computed by the same core for RGB-serializing browsers; there is **no second colour conversion or colour math in the UI** (a UI fallback reads only `L` from the computed serialization and never derives C/H). In the overview, each cell shows the live measurement when the runtime has one for that pair and view, otherwise a **build-snapshot estimate**, always labelled; the two views follow the active comparison (generated / tuned / draft). The main layout is a 12-column grid; the matrix keeps three columns (use plus the two views) that reflow on narrow containers, and on narrow containers the overview is a native collapsed `<details>`. `complete` preserves the whole saved source CSS through a controlled **source-aware** patch: only the **value** of the edited declarations is rewritten (existing declaration position and text are preserved), **multiple top-level `:root` blocks are allowed only when the edited control is globally unique**, and **new declarations are appended to the last top-level `:root`**. With no edits, `complete` returns the saved bytes **exactly**, even when the analysis does not interpret the file — that case stays a **warning**, and a warning is **not** a verification. `complete` is **not** a CSS validity certificate. `fragment` is **always only the draft delta** to integrate **manually** and **never removes or rewrites the source file**; it is returned with a warning on a duplicate declaration, a conditional or nested declaration (outside a top-level `:root`), active CSS escapes, `!important`, an internal declaration comment, or an unparseable structure. `removed` lists dropped tombstones (removed from the preserved file in `complete`; only reported, **not** applied, in a `fragment`) and `unmatched` lists saved overrides no longer matching a current control (reported, never deleted). The UI distinguishes complete tuning (`colors-tuning.css`), a patch (`colors-tuning.patch.css`) and an unavailable export, and writes nothing to the project. A `smart-colors preview` HTTP server is **not implemented**; no local URL is claimed, and alias coverage is not expanded. See [`PREVIEW-UX-ANALYSIS.md`](./PREVIEW-UX-ANALYSIS.md) for the final verified gates.

#### Automation modes and Playwright discovery

`--automation=auto|off|required` is accepted only by `build` and `report` (both `--automation=value` and `--automation value`). `init`, `check` and `audit` reject it.

- `auto`, without a browser list, discovers Playwright in the consumer and tries Chromium, Firefox and WebKit where available. It declares skipped engines; it never downloads anything.
- `off` performs no discovery, no import and no launch. The diagnostic folder and the native runtime are still produced.
- `required`, without a list, requests Chromium. An explicit `report chromium webkit` list implies `required`. An explicit list combined with `auto` or `off` is a usage error, not a reduced request.
- `build` accepts no browser positionals. `report` and `audit` accept `chromium`, `firefox`, `webkit`.

Playwright is **not** a dependency or a peer of this package. Only `astro` is declared, as an optional peer. When needed, the CLI resolves from the consumer root only:

1. `playwright`;
2. `@playwright/test`.

It accepts the ESM or CJS export shape and the engine objects exposed by that package. It checks the already-installed browser executable and never runs an automatic install or download. There is no fallback to this package's checkout or to a global Playwright.

The environment phases — `discovery`, `import`, `availability`, `launch` — are distinct from measurement phases such as payload validation, CSS application, parsing and classification. A launched runner that fails later is **incomplete**, not “environment unavailable”. The structured run records phase, cause and engine.

#### Exit policy

The policy is classified by phase, not by how many measurements succeeded:

| Event | `build auto` | `build off` | `report auto` | `required` / `audit` |
|---|---:|---:|---:|---:|
| Requested operation succeeds | 0 | 0 | 0 | 0 |
| Playwright absent, import incompatible, binary absent or no engine launchable during discovery/import/availability/launch | 0 + reason | Does not check Playwright | 0 + reason | Non-zero |
| One engine unavailable while others complete | 0 + partial coverage | Not applicable | 0 if executed measurements are clean; partial coverage explicit | Non-zero if that engine was required |
| Runner launched but validation/execution failed or mandatory scenarios are missing, even before a first successful measurement | 0 + incomplete result | Not applicable | Non-zero | Non-zero |
| Measured pairs below the minimum | 0 + visible problems | Not applicable | Non-zero | Non-zero |
| Only below the configured target, minimum met | Advisory | Advisory of the model | Advisory | Advisory |
| Usage, input/I/O, strict contract or requested publication failure | Non-zero | Non-zero | Non-zero | Non-zero |

Notes:

- `build auto` does not add a CI gate merely because Playwright is present. Its warnings and incomplete coverage remain visible in stdout/stderr and in the artifacts. Use `--automation=required` or `audit` for strict CI.
- `report auto` is non-blocking only while the environment never became available. Once a runner executed, an incomplete run or a below-minimum pair exits `1`.
- `report off` exits `0` when the model is valid and the diagnostic folder was published, and `1` for a strict model/contrast error. It declares that no automated measurement ran.
- `check` exits `0` when the output is current; stale output or an error exits non-zero.
- Model warnings remain warnings even when they are not generation errors. Missing or incomplete verification is never a pass.
- Measurements made in an opened preview page cannot change the CLI exit code retrospectively.

#### Coverage, provenance and read-only proposals

Provenance is explicit: `model`, `browser-local` or `browser-automation`. Execution state (`pending/running/complete/incomplete/unavailable/unsupported/disabled`) is separate from pair state (`pass/below-target/below-minimum/unmeasured`). Completeness requires pair identity and expected coverage, not only an equal count. A missing measurement is `unmeasured`, not ratio zero and not a pass. Optional `automation.explorations` and `explorationCoverage` are a separate channel: their expected/measured/unmeasured units and omitted families never alter the verified-pair coverage, never become an issue and never certify accessibility.

The tool evaluates **color combinations for a stated use**, not aesthetic quality. It does not claim a globally optimal palette, a universally certified interface or better contrast accuracy than the measured browser state. Scope excludes screenshot/pixel comparison, alpha compositing, images and gradients, arbitrary component/local-surface CSS, undeclared combinations, intermediate animation states and forced-colors confirmation. `solid`/`hover` checks are declared token pairs, not every `:hover` rule in a site.

Proposals remain read-only. Every candidate is applied only in memory, checked with the same core collector in all requested scenarios and engines, and published only when it resolves its named issues without new target or below-minimum failures. No palette/config/tuning/CSS edit is applied automatically. A discarded candidate is disclosed with its reason; absence of a verified proposal is stated explicitly. A local browser run or a single-engine result does not promote a proposal to “verified on all environments”. Existing `./report` and `./audit` API wrappers keep their documented behavior; the exit policy above belongs to the CLI workflow.

#### Designer provenance, baseline CSS and explorations

The diagnostic session carries an optional `design` record produced by the shared recipe registry. Its shape is:

```js
session.design = {
  version: 1,
  sources: [{ token, name, role, darkBlend, darkMix: { mode, sourcePercent, whitePercent } }],
  recipes: { [key]: { kind, usage, basis, ... } },
  tokens: {
    [publicToken]: {
      sources: [paletteToken],
      recipe: key,
      usage,
      controls: {
        light: { override, mix, defaultMix },
        dark: { override, mix, defaultMix },
      },
    },
  },
};
```

It is metadata, not a second derivation engine. **Sources and recipes are the generator's starting expectations**, not proof of the active formula: the measured CSS baseline remains the final source, and when the output is stale or a full-color override is active the recipe quota is not necessarily what renders. The static report reads the payload through `createDesignTools().describeToken()` and renders **source → recipe → use → control**; it does not re-derive a recipe, a surface mix or a contrast. `controls.<theme>.defaultMix` is the surface source quota as a **0–1 fraction** (the report shows it as a percentage, so `0.1` → `10%`), while `sources[].darkMix.sourcePercent`/`whitePercent` are already percentages. An omitted `dark-blend` is shown as the role's automatic derivation, never as `0`. `dark-blend` mixes white (at most 28%), never black, and the percentages are not a WCAG threshold.

The CSS snapshot is additive and explicit:

```js
session.css = {
  generated,        // expected model CSS
  baseline,         // actual captured output if present (even empty), else generated candidate
  source,           // "output" | "generated-candidate"
  status,           // "current" | "stale" | "absent" | "empty"
  production,       // boolean
  digest: { generated, baseline },
  tuning,
  tuningSupport,    // "absent" | "supported" | "unsupported"
};
```

The report writes no CSS. `build` measures after the write; a stale real file stays an actual measured baseline and is never relabeled as a candidate, while a generated candidate is never presented as an on-disk output. Both hashes are shown as declared/measured data, never recomputed by the report.

The diagnostic session also carries an **additive** `session.paletteSource` object built from the captured palette bytes (never a second read). The legacy `session.palette` **array** — the resolved gallery (`{ name, role, authored, resolved, darkBlend }` per authored token) the static report already consumes — is unchanged and keeps driving the static report; `paletteSource` does not replace it. The inert payload exposes the exact source as `payload.paletteSource`; the legacy gallery array stays a session field, not a payload field.

```js
session.paletteSource = {
  css,   // the full raw palette CSS bytes
  path,  // the captured source path
  sha256,// SHA-256 of those bytes
  sources: [
    {
      token,       // e.g. "--palette-brand"
      value,       // the raw authored value slice, or null
      role,        // the declared role from the palette annotation, or null
      darkBlend,   // the declared descriptor, or null
      declaration, // the exact @property block slice (or the legacy :root declaration), or null
    },
  ],
};
```

The two are distinct and neither supersedes the other: `session.palette` stays the resolved gallery array the static report renders, and `session.paletteSource` adds the exact source bytes. The preview publishes `paletteSource`'s bytes and declarations verbatim (the manual `palette.css` download is `session.paletteSource.css`), and the inert payload carries the same object as `payload.paletteSource`. `declaration` is the captured text, not a reconstruction. `paletteSource.sources[].role` is the **declared** role; the **effective** configured role lives separately in `session.roles.identities[]` (`{ name, role, token, paletteName }`, where `paletteName` is the `--palette-<key>` token), and the preview shows it only when it differs from the declared one.

The run may also include `automation.explorations` (measurement-shaped records) and `explorationCoverage: { expected, measured, unmeasured, omittedFamilies, complete }`. These are a **separate channel**: they never change the verified-pair coverage, never become an issue, and never certify accessibility. The static report shows the top scoped pairings with ratio, minimum and target, ordered by usage band (normal text at least 4.5:1, large text/borders/icons 3:1–4.5:1, avoid below 3:1), the partial/unmeasured units, and the omitted families; the rest stays in a disclosure. The family schema is capped at 24 families. The guided contrast workbench adds its own **read-only** exploration disclosure over the same cap (non-self base-color pairs, measured on demand); it is advisory, never enters the primary coverage or the exit policy, and is **verified** in the Unreleased sources.

#### Designer workflow

1. Choose colors, roles and optional `dark-blend` in **`palette.css`**. `dark-blend` is accepted on every role; omit it to keep the role's automatic derivation. Do not edit generated `colors.css` or use `--_color-*` internals.
2. Run `pnpm exec smart-colors build` to generate the CSS and the diagnostic folder, then `pnpm exec smart-colors report` when you want a fresh measurement with the automation modes you choose.
3. Read the chain **source → recipe → use → control → check actual** in the static report: the palette source, the declared recipe and usage, the public token and its light/dark control, then the generated CSS plus tuning actually captured. A control is not a fix and the report writes nothing.
4. Read the labelled console summary: **Palette**, **CSS**, **Verification** (`MEASURED` for any real measurement — a partial run keeps `MEASURED` and states its incomplete coverage on the same line — or `MODEL ESTIMATE` when nothing was measured), then **Verdict** and **Problems** with human usage names — any measured problem, below minimum **or** below target, is `NEEDS REVIEW` while the project target stays distinct from the reference minimum. **Extra** appears only when exploratory pairings are available. More model warnings never certify a palette.
5. Open the printed preview `file:` URL (the **Preview** link, shown first) and read it top-down: the **source palette and roles** first, then the **guided contrast workbench** (pick a source, pick a real pair, choose temi / baseline contro tuned / tuned contro draft, and read the real `var(--color-*)` frames), then the technical archive of resolved samples, then the extended local verification archive; a **Correzioni e problemi** section appears only when there is something to correct or review, and the technical data and automation evidence come last. The workbench controls, the minimum-lightness correction and the export are temporary and manual: nothing is written by the page. Use the static report for the complete captured detail. Local results are extra evidence, not a global verdict.
6. Apply any change manually, then regenerate and remeasure. The preview cannot detect later edits, the browser cannot apply a change, and the static report is not a live badge. The new per-token and surface overrides change the emitted declarations, so upgrading requires regenerating `colors.css`: byte parity with a pre-upgrade output is not preserved. The preview artifact budget is **896 KiB (917504 bytes)** and covers the preview document plus its local stylesheet and runtime assets, including the full palette source and its manual download, the serialized interactive runtimes and the view factory, the measurement frames and the comparison/correction metadata. A previous run measured 596,886 bytes for the starter, 816,277 bytes for the stress fixture and 806,508 bytes for the root-sized session; these are current measurements, not a permanent guarantee.

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

--color-primary-ink
--color-secondary-ink
--color-tertiary-ink
--color-accent-ink

--ink-primary
--ink-secondary
--ink-tertiary

--color-<identity>-surface
--color-<identity>-border
--color-<identity>-solid
--color-<identity>-solid-text
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
--color-tune-dark-bg-mix
--color-tune-dark-surface-mix
--color-tune-dark-text-mix
--color-tune-dark-muted-mix
--color-tune-<public-name>-light
--color-tune-<public-name>-dark
--color-tune-<identity>-surface-<theme>-mix
--color-tune-<identity>-surface-strong-<theme>-mix
--color-tune-elevation-*
--color-tune-<identity>-dark-mix
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

For colored UI, prefer the semantic functional families over raw identity colors or numeric steps. They describe intent instead of tonal math. Text variants are contrast-adapted; source-preserving solid/solid-text pairs must be checked when generation reports a warning:

```css
.button--primary {
  background: var(--color-primary-solid);
  color: var(--color-primary-solid-text);
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
--color-<identity>-solid-text
--color-<identity>-text
--color-<identity>-text-strong
```

Numeric steps such as `--color-primary-500` are optional advanced tokens. They never source the functional family and carry no independent semantic contrast promise.

### 4. Direct identity/on-color pairs

Use the direct identity pair when you need the configured identity color itself and the foreground generated for that fill. This is a different pairing from `solid` / `solid-text`; it does not promise contrast on a family surface or hover fill:

```css
.callout-icon {
  background: var(--color-primary);
  color: var(--color-primary-ink);
}
```

Recommended tokens:

```css
--color-primary
--color-primary-ink
--color-secondary
--color-secondary-ink
--color-tertiary
--color-tertiary-ink
--color-accent
--color-accent-ink
```

`--ink-*` tokens are native `contrast-color()` helpers for progressive enhancement. Keep `--color-*-ink` as the deterministic baseline when text/icon contrast is critical.

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
| Filled button | `--color-primary-solid`, `--color-primary-solid-text` |
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

These tokens are progressive-enhancement hooks for components that want to branch with style queries. Keep the deterministic `--color-<identity>-ink` pair as the baseline when readable text or icons are critical:

```css
.button {
  color: var(--color-primary-ink);
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

The motion output dynamically registers every configured identity and its available `*-ink` pair. `--color-bg` is registered but intentionally excluded from the transition to avoid browser-chrome sampling glitches. The duration uses `var(--theme-transition-duration, 0.4s)`.

Motion is progressive enhancement. Consumers that enable it must also provide a `prefers-reduced-motion` or equivalent application preference policy; projects that leave `motion.enabled` false receive only static semantic color tokens.

## Project-level tuning contract

The package emits public tuning knobs intended to be overridden by a project-level token file imported after `colors.css`, for example `src/styles/tokens/colors-tuning.css`:

```css
:root {
  /* Legacy macros, preserved. */
  --color-tune-light-warmth: 45%;
  --color-tune-dark-warmth: 75%;
  --color-tune-dark-bg-mix: 14%;
  --color-tune-dark-surface-mix: 19%;
  --color-tune-dark-text-mix: 88%;
  --color-tune-dark-muted-mix: 72%;

  /* New public per-token controls: a whole OKLCH color for one theme. */
  --color-tune-bg-light: oklch(0.97 0.005 250);
  --color-tune-bg-dark: oklch(0.18 0.01 250);
  --color-tune-primary-light: oklch(0.5456 0.1625 32.41);
  --color-tune-primary-dark: oklch(0.62 0.15 32.41);
  --color-tune-primary-text-light: oklch(0.42 0.14 32.41);

  /* Surface mix: source percentage; a full color override wins. */
  --color-tune-primary-surface-light-mix: 10%;
  --color-tune-primary-surface-strong-dark-mix: 28%;

  /* Legacy per-identity dark mix, preserved. */
  --color-tune-primary-dark-mix: 77.6%;

  --color-tune-elevation-1-shadow-alpha: 10%;
  --color-tune-elevation-1-border-alpha: 28%;
  --color-tune-elevation-1-glow-alpha: 14%;
}
```

Project-level overrides are applied by the browser after generation and therefore are not revalidated by `smart-colors check`. Keep accessibility-critical palette and contrast decisions in the source palette/config; use tuning tokens for controlled visual refinement, then check the actual generated CSS plus tuning.

### Public per-token controls

Every emitted public `--color-*` token reads the uniform per-theme pair `--color-tune-<public-name>-light|dark`, where `<public-name>` is the token without the `--color-` prefix. This covers neutral tokens (`bg`, `surface`, `text`, `text-muted`, `border-subtle`, `border-strong`, `focus-ring`), controls, identity base and `ink`, the nine family variants (`surface`, `surface-strong`, `border`, `border-strong`, `solid`, `solid-hover`, `solid-text`, `text`, `text-strong`), decoratives and `<decorative>-ink`, and enabled scale steps and hue variants. The generated value stays the literal fallback (contrast already resolved at build time); the override replaces it at runtime. A full-color control wins over a recipe (including a surface mix knob); an omitted control keeps the generated default; light and dark are independent. Runtime overrides are **not** revalidated by `smart-colors check`, so re-measure the affected pairs after the edit. Foundation dark values use `--color-tune-bg-dark` and `--color-tune-surface-dark`.

### Surface mix controls

Family surfaces are mixes of the identity source and the neutral backdrop. The public knobs are:

```css
--color-tune-<identity>-surface-<theme>-mix
--color-tune-<identity>-surface-strong-<theme>-mix
```

Defaults are `10%` source for `surface` in light, `18%` in dark; `18%` for `surface-strong` in light, `28%` in dark. A mix knob is a source percentage, not a WCAG ratio and not a fixed 10/90 rule. Precedence is explicit:

1. a full `--color-tune-<identity>-surface-[strong-]<theme>` color;
2. the `--color-tune-<identity>-surface[-strong]-<theme>-mix` source percentage;
3. the generated default.

The resulting surface is a design tint; the text and border pairs that sit on it remain the pairs to check.

### Dark mixing and legacy knobs

In relative mode, `--color-tune-dark-text-mix` is the **weight of the authored canvas source** in the dark text mix with `oklch(0.99 0 none)`, not a percentage of ink, text opacity or a generic “make text brighter” control. More weight moves the text toward that source; with this project's canvas it slightly lowers lightness. `--color-tune-dark-muted-mix` instead weights the resolved dark text against the dark canvas: increasing it moves muted text toward full text. The emitted percentages may be adjusted by generation to meet contrast and need not equal the requested config ratio.

Each `ui`/`feedback` identity emits `--color-tune-<name>-dark-mix`, the percentage of the authored source kept in the dark variant:

```css
--_color-<name>-dark-generated: color-mix(in oklch, var(--_color-<name>-source) var(--color-tune-<name>-dark-mix, <mixRatio>%), oklch(1 0 none));
```

The fallback `<mixRatio>` is the generated default (from `dark-blend` or the adaptive rule); lowering the knob mixes in more white and lightens the dark identity. It is a runtime knob only: `solid-hover`, `solid-text`, text variants, scales and hue variants are resolved at build time and are not recomputed by it. For a fully custom dark identity, override `--color-tune-<name>-dark` with a complete OKLCH color instead.

`dark-blend` in `palette.css` is accepted on all five roles. `0` keeps the source, `80` keeps 77.6% source and mixes 22.4% white, `100` keeps 72% source and mixes 28% white; an omitted descriptor keeps the role's automatic derivation and is not `0`. The mix never darkens toward black, and WCAG does not impose a 10/90 ratio.

An identity override `--color-tune-<name>-dark` affects the dark direct `--color-<name>` **and the dark functional `<name>-border` and `<name>-solid`**, which reference the same identity variable. It does **not** regenerate `solid-hover`, `solid-text`, the direct `-ink` companion, surfaces, `border-strong`, text variants, numeric scales or hue variants, whose values were resolved separately. Aliases follow their target. If `<name>` is the configured focus identity, its dark override also feeds the dark control active-background, active-border and focus-background mixes; their foregrounds and the generated focus ring are not recomputed. A tuned fill/state can therefore disagree with its original hover state or foreground: recheck those rendered pairs explicitly.

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
--color-primary-solid-text         /* text/icon on the solid color */
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
import * as reportData from "@smartslash/astro-smart-colors/report";
import { projectAudit } from "@smartslash/astro-smart-colors/audit";
```

The `./report` entry exposes the legacy snapshot builder and read-only proposal solver used by the report artifacts. The `./audit` entry exposes the legacy `projectAudit(names, { root, configFile, emitReport })`; it resolves `playwright` or `@playwright/test` at call time only, so importing it never requires Playwright.

The new `build`/`report` CLI pipeline uses internal modules (diagnostic session, verification core, DOM collector, Playwright provider and diagnostic workflow). They are implementation details, not new package entry points; no new manifest export is introduced. The structured automation adapter returns `VerificationRun` data and never sets `process.exitCode`; the exit policy belongs to the CLI workflow. The legacy `projectAudit` wrapper keeps its own strict behavior and documented return/exit conventions.

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

Before reading the palette or writing outputs, including in `check` mode, an output-path guard rejects collisions between an enabled output and the palette, selected config file or another enabled output. For `build`/`report`, the same guard runs against the documents and local assets under the resolved `reports.directory`, plus the configured palette, CSS, motion and tuning paths; the report writer also refuses an existing file without the Smart Colors marker, a symlink, a hard link or a non-regular file. Each file is replaced atomically, but the folder is not a filesystem transaction: a later rename may fail after the earlier ones succeeded. It compares normalized, symlink-resolved paths, including dangling symlinks and symlinked directory ancestors, without creating directories.

Canonically equivalent Unicode path spellings are conservatively rejected after NFC comparison, even on filesystems that can keep them separate; no path is silently renamed. Potential aliases that match after case folding are rejected unless both relevant existing ancestor directories are proven case-sensitive by a read-only probe bounded to 32 entries per directory. Unknown results are rejected conservatively; choose paths that differ beyond letter case. This guard is not a filesystem sandbox and does not protect against hard-link aliases or filesystem changes between validation and use (TOCTOU).

Output directories are created automatically. Changed files are written through a temporary sibling and atomically renamed, avoiding partially written CSS during development.

Neutral mix searches are verified at the two-decimal percentage precision actually emitted. Text correction considers exact black/white endpoints when the existing result is insufficient and checks the final serialized candidate against all declared backgrounds. Existing valid outputs are preserved rather than rewritten merely to unify algorithms.

Astro/Vite shutdown cancels the debounce, removes watcher listeners, skips queued regenerations and awaits a generation already in progress. In-flight writes may finish during teardown; no new generation or reload is scheduled after shutdown, and teardown does not complete while an active generation is still running.

## CLI

Run the binary through the package manager that installed the package, from the project root or with an explicit root:

```sh
pnpm exec smart-colors build
pnpm exec smart-colors build --root ./app --config config/colors.mjs
pnpm exec smart-colors build --automation=off
pnpm exec smart-colors build --automation=required
pnpm exec smart-colors check
pnpm exec smart-colors check --config smart-colors.config.mjs --root .
pnpm exec smart-colors report
pnpm exec smart-colors report --root ./app --config config/colors.mjs --automation=off
pnpm exec smart-colors report --automation=off
pnpm exec smart-colors report --automation=required
pnpm exec smart-colors report chromium webkit
pnpm exec smart-colors audit chromium webkit
pnpm exec smart-colors init
pnpm exec smart-colors init --dir src/tokens
pnpm exec smart-colors init --palette colors/personal.css --tuning colors/colors-tuning.css
pnpm exec smart-colors init --yes
pnpm exec smart-colors --help
```

With a global install, `smart-colors` works directly. Options can be placed before or after the command. Supported flags are `--config`/`-c`, `--root`/`-r`, `--dir`/`-d`, `--palette`, `--tuning`, `--yes`/`-y`, `--automation`, and `--help`/`-h`. `--root` and `--config` are the effective paths: the default config name never substitutes for an explicitly selected file. For `audit` and `report`, positionals after the command select browsers (`chromium`, `firefox`, `webkit`).

### Commands and boundaries

| Command | Writes | HTML | Automation |
|---|---|---|---|
| `init` | Starter palette and `colors-tuning.css`; a config when `--dir` changes the layout | No; it points to `build` as the next step | No |
| `build` (also the default command) | Generated CSS/motion outputs and the diagnostic folder (documents plus local assets) | Always attempted after a safe analysis, even when CSS is current | `auto` by default |
| `check` | Nothing | Does not regenerate or present old HTML as current | No |
| `report` | The diagnostic folder only (documents plus local assets) | Always attempted with safe paths | `auto` by default |
| `audit` | Nothing | No | Strict; Chromium default; no mode flag |
| Generator API and Astro integration | Only configured CSS/motion outputs | No implicit HTML | No |

`build` and `report` publish `index.html`, `report.html` and their local `styles/` and `scripts/` assets under `reports.directory`: relative values resolve from the consumer root, absolute file paths and `file:` URLs are literal, and the default is `smart-colors-reports` under that root. The default folder is never placed inside `node_modules` or the installed package, and configuring another folder never reinterprets the palette, config, tuning or CSS inputs. `build` performs normal CSS generation first; `report` never writes palette, config, tuning or CSS. Neither migrates, deletes or moves a legacy `reports/` directory or the folder used by a previous `reports.directory`. `init`, `check` and `audit` reject `--automation`. `build` accepts no browser list. An explicit `report` browser list implies `required`; combining a list with `auto` or `off` is a usage error. An empty argument (for example an empty positional) is a usage error that exits `1` and writes nothing.

### Console output and next steps

The console summary is plain terminal text in English and states its provenance once; the published preview and report HTML UI remain in Italian. `check` leads with the CSS file state under **CSS** (`up to date`, or `stale` plus the regeneration command), then **Contrast** (`model estimate: …`) and **Tuning**, and states its read-only scope under **Read-only**. `build`/`report` stream progress as each real phase starts (`smart-colors: palette analysis`, `token generation`, `checking optional automation` — `automated verification required` under `required` — and `preview and report`), never a spinner or an invented percentage, and only started phases reach stdout. The summary then groups the facts: **Palette** (colors and roles), **CSS** (the real output file and its state: `regenerated`, `already up to date`, `up to date`, `out of date`, `absent` or `empty`; `check` reports a failed comparison as `stale`), **Verification** (`MEASURED` or `MODEL ESTIMATE`), **Verdict** (the single verdict: `OK`, `NEEDS REVIEW`, `UNVERIFIED` or `ERROR`), **Problems** only when at least one real pair is listed, **Extra** only when exploratory pairings are available, the two clickable `file://` lines (**Preview** before **Report**) and **Action**. Generation is a fact separate from verification. Provenance and completeness stay separate: the **Verification** line says `MEASURED` for any real browser measurement — including a partial run, whose incomplete coverage is stated on the same line — and `MODEL ESTIMATE` only when no pair was measured; a partial measured run keeps its measured problems instead of falling back to the model list. The single **Verdict** is `NEEDS REVIEW` for any measured problem (below minimum or below target), `OK` only for a complete, clean measurement, `UNVERIFIED` for a measured-but-partial clean run or when no engine started, and `ERROR` for a strict-invalid model. **Action** opens the preview first; regenerating the CSS is a separate, conditional secondary step shown only when the output actually needs a build. Problems use human usage names and are capped at five, with the raw warning/suggestion strings and the token-level detail on stderr only. Raw external causes, model warning/suggestion strings and raw core errors stay verbatim, not translated. When output is piped it uses plain text without decorative glyphs or ANSI; paths and messages may still contain Unicode. Colour is used only on a TTY and is disabled by `NO_COLOR`, and a usage error keeps stdout empty.

`build` and `report` no longer print a success/failure heading: the heading is a plain `build` or `report` badge and the outcome lives in the **Verdict** line. A strict-invalid model shows `ERROR` with the model error count in **Verdict**, `CSS` with `not written, contrast contract invalid` and the model error list on stderr, while the diagnostic folder is still published. When `report` finds the CSS output absent, stale, empty or current, the **CSS** line names that state; an absent or stale file is the real measured baseline or a declared generated candidate, never accepted production. Under `auto`, an expected absence (Playwright simply not installed) is a brief note and is not echoed as a raw stderr detail, while other environment/measurement failures stay detailed; under `required` (and `audit`) the CLI states the explicit action. Raw engine/run detail is deduplicated on stderr and never printed as a wall on stdout; stdout lines are length-capped and terminal control characters are escaped.

### `--automation=auto|off|required`

- `auto`, without a list, tries the Chromium, Firefox and WebKit engines available to the consumer and declares skipped ones. It never downloads browsers and, when Playwright is simply not installed, prints only a brief optional-automation note (no install instruction by default) and no raw stderr detail.
- `off` does not resolve, import or launch Playwright. The diagnostic folder and the runtime are still produced.
- `required`, without a list, requests Chromium. With a report list, requires exactly the listed engines, and an unavailable environment states the explicit install action and exits non-zero.

Playwright is not a dependency or peer. The consumer installs `playwright` or `@playwright/test` itself and its binary with `pnpm exec playwright install <engine>`; the CLI checks the existing binary and never installs or downloads it. Discovery is anchored at the consumer root and has no global fallback. Automation is optional: one shared budget of 60 seconds covers the whole run, including proposal trials, so the optional work is bounded rather than mandatory. `audit` remains strict and does not take an automation mode.

### Exit policy

Diagnostic warnings are not silently converted into passes or failures:

- `build auto`: `0` for a successful build, an unavailable environment, an incomplete runner or measured below-minimum pairs; the reasons and problems are printed and included in the HTML. `build off`: `0` when the strict model is valid and publication succeeds, without checking Playwright. `build required`: non-zero for an unavailable/incomplete/partial run or below-minimum.
- `report auto`: `0` when the environment never became available; non-zero once a launched run is incomplete or a measured pair is below minimum. `report off`: `0` when the model is valid and the diagnostic folder is published; non-zero for a strict model/contrast error. `report required`: non-zero for an unavailable/incomplete/partial run or below-minimum.
- `audit`: non-zero for unavailable/incomplete or below-minimum; `below-target` alone is advisory.
- `check`: `0` when current; stale output or an error is non-zero.
- Below-target-only results are advisory in every mode. Usage, input/I/O, strict-contract and publication failures are non-zero everywhere.
- Warnings of the model remain warnings even when they are not generation errors. Missing, unsupported or incomplete verification is not a pass.

Measurements taken later in an opened preview cannot change the CLI exit code.

### `init`

`init` creates the two authored files a project starts from: a palette with neutral example values and a `colors-tuning.css` panel whose values are all commented out. The palette path comes from `config.palette` unless `--palette` or `--dir` is given; the tuning path defaults to `colors-tuning.css` in the palette directory unless `--tuning` is given. `--dir` picks a token directory (default `src/styles/tokens`) and cannot be combined with `--palette`. When no explicit or existing config is present and the effective palette differs from the default `config.palette` — a different directory, or a custom filename in the same directory via `--palette`, for example `src/styles/tokens/brand.css` — `init` also writes a plain `smart-colors.config.mjs` (no package import) with the matching `palette` and `output` paths, so later commands resolve the layout without `defineSmartColorsConfig`. Both parents are created as needed, and backslash separators in explicit paths are normalized to `/`.

On an interactive terminal and with no path options, `init` asks for the token directory first (Enter keeps the default) and then shows the files it will create before asking for confirmation; the prompt and confirmation text are in English (`Which folder should contain the token files?`, `Create these files? [Y/n]`). `--yes` skips the prompts, and a run without a terminal (CI) uses the resolved paths without ever prompting. Only an empty answer, `y` or `yes` proceeds; any other answer leaves the project untouched. If any target already exists, `init` exits non-zero, names the existing file and writes nothing. An existing or explicitly selected config is never rewritten: if the effective palette diverges from its `config.palette`, `init` refuses before any write instead of reporting a false success. It also refuses a target that would overwrite `config.output` or `config.motion.output`, even while motion is disabled, so enabling motion later cannot collide with a file authored now. `build` and `check` never prompt and never create a palette. `init` also prints a compact summary: `Created` lists the files it wrote with their role, `Output` names the generated file `build` owns (import it, do not edit it by hand), `Warnings` appears only when guidance is needed, and `Action` gives the next `build` command.

### Advice and writes

`build`, `check` and `report` print warnings and read-only contrast suggestions when their path provides them; `audit` prints its strict audit shortfalls and does not run the suggestion search. Advice uses the effective `--config` path, and its fragments are meant to be merged into existing settings rather than used as replacement files. There is no autofix and no recommendation to edit generated `colors.css`. `check` writes nothing; `build` writes only its configured outputs plus the diagnostic folder; `report` writes only the diagnostic folder; `audit` writes nothing. See [Browser verification](#browser-verification-audit-build-and-report) for the preview, static report, coverage and publication guarantees.

## Test groups and browser checks

The package suite is grouped by what a test needs and selected by
`scripts/run-tests.mjs`, which is development tooling and not a published entry
point:

| Command | Scope |
| --- | --- |
| `pnpm test` | `unit` + `integration` + `browser`; native proofs off |
| `pnpm test:unit` | pure Node unit tests |
| `pnpm test:integration` | Node tests with temporary projects, filesystem and CLI |
| `pnpm test:browser` | hybrid browser files with native proofs for Chromium and WebKit |
| `pnpm test:site` | reference-site root proofs (three, Chromium only) |
| `node scripts/run-tests.mjs --list` | selected files and counts, without running them |

The default is deliberately Node-only. The `browser` files are **hybrid**: their
Node assertions run in `pnpm test`, while only their native proofs launch a
browser. The `site` group is never implied. A manual native subset names both the
group and the engines:

```sh
node scripts/run-tests.mjs browser --native --browser=chromium
```

Native proofs exist only for Chromium and WebKit. Firefox remains a supported
product automation engine, but the package has no native Firefox proof, so an
explicit `--browser=firefox` is rejected instead of producing a green run where
every native proof is skipped. `--list` validates the group and browser flags but
skips the site filesystem preflight: `--list site` works without `--browser` and
without a checkout.

Native proofs resolve an already installed `playwright` or `@playwright/test`
from the package root by default, or from an explicit
`SMART_COLORS_PLAYWRIGHT_ROOT`. The explicit `site` group additionally requires
`SMART_COLORS_SITE_ROOT` or the monorepo-shaped sibling checkout and preflights
its four root inputs. Nothing in either path installs or downloads Playwright or
a browser binary; a missing Playwright module or binary fails with `BLOCKED`, and
an engine excluded by `--browser` is reported as a declared skip.

`test/site` holds three read-only reference-site proofs: the real root inputs,
the Primary source’s representative uses, and a root-sized automation session
against the preview budget. They copy the inputs to a temporary directory and
assert the root was not mutated. The approved preview budget is **896 KiB
(917504 bytes)**; the raise follows a previous run that measured 596,886 bytes for
the starter, 816,277 bytes for the stress fixture and 806,508 bytes for the
root-sized session. Those bytes are current measurements, not a permanent
guarantee. The site group is optional, is not part of `pnpm test` or CI, and this
reference does not report it as run or passing; a green default or browser run is
not a site verification.

CI runs `pnpm test` with a frozen lockfile on Node 22.12.0, 24 and 26, with no
browser job and no Playwright dependency.

Consumer projects do not need this development tooling. They use their installed
`smart-colors` binary, and only install Playwright themselves when they opt into
`build`/`report` automation or the strict `audit`; the CLI then checks that
existing installation and never installs a binary.

### Reference-site harnesses

The reference site’s own `scripts/*` harnesses exercise the measurement surface
end to end: `scripts/test-smart-colors-browser.mjs` (color model),
`scripts/test-smart-colors-audit.mjs`, `scripts/test-smart-colors-report.mjs`,
`scripts/test-smart-colors-native.mjs` (preview from `file://`,
themes/preference) and the standalone consumer harness. They are site tools, not
files shipped by this package, and they use the site’s own `@playwright/test`
dependency with already installed binaries; they do not download them
automatically.

The model harness checks independent mix oracles, generated light/dark pairs with and without scales, solid/hover warning correspondence, and a capped dark target of `7.5` with strict ratio comparisons. Fixture files live in a temporary directory and generation uses `check: true`; no application outputs, real palette or real config are written. This is a color-model regression check, not a full accessibility audit. Consumer projects use their own installed `smart-colors` binary with the CLI modes above; they do not need the site harnesses.

## Astro behavior

- On `astro dev`, the integration generates all enabled CSS/motion outputs and watches the palette and config files across `add`, `change`, and `unlink` events. Rapid atomic-save events are debounced into one regeneration.
- On `astro build`, it generates all enabled CSS/motion outputs before the build starts.
- The integration never creates the configured report folder, its documents or assets, or any implicit HTML, and never launches a browser. Those artifacts belong to the `build`/`report` CLI workflow.
- The integration uses `suggest: false` to keep the exhaustive four-decimal lightness search out of the dev watcher. Generated CSS, contrast validation and warnings are unchanged; use the CLI or a default programmatic call to inspect suggestions.
- If generated output is out of date, `smart-colors check` exits with a non-zero status.

## Design principle

Keep the daily vocabulary small and memorable even when the generated catalog is large: use neutral pairs and repeatable functional-family suffixes first; opt into advanced scales, helpers and tuning only when needed. Put contrast search, dark derivation, fallback generation and brand-specific glue in build-time code/config, not in components.
