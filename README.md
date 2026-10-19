# @smartslash/astro-smart-colors

**Palette in, accessible semantic CSS out.** A portable Astro integration + standalone CLI that turns a small editable OKLCH palette into a semantic color API.

You author a few `@property` source colors. The package derives the rest at build time and emits plain CSS built on modern native features:

- `light-dark()` pairs for every theme-aware token;
- `color-mix()` for the adaptive dark identity and the neutral mixes;
- `oklch(from ...)` for lightness-relative derivations;
- `contrast-color()` for the `--ink-*` progressive-enhancement helpers.

The generated color system runs build-time/dev-time only: the browser receives static CSS and **no client JavaScript is required for the baseline tokens**.

`build` and `report` can also publish two file-only diagnostic HTML pages. The preview page puts the **source palette first**, then embeds an isolated local runtime that runs a **guided contrast workbench** on the real consumer CSS; the full report stays static. The static report shows the designer provenance (palette sources, derivation recipes, public tokens and controls) and the difference between the generated model CSS and the captured baseline, without writing CSS or recalculating contrast. That diagnostic JavaScript never becomes part of your site's color CSS, and it is unrelated to Astro hydration.

[Quickstart](#quickstart) · [Daily API](#start-here-i-want-x--use-yz) · [Tuning](#runtime-tuning-colors-tuningcss) · [CLI](#cli) · [Diagnostics](#diagnostic-artifacts) · [Reference](./docs/REFERENCE.md) · [Changelog](./CHANGELOG.md)

## Quickstart

Works in an Astro project and in a project with no Astro at all: `build` emits plain CSS.

### 1. Requirements, install and release status

- **Node `>=22.12.0`** (the `engines` field). The generator and the CLI run on Node only; no browser is involved unless you request browser automation.
- **No runtime dependencies and no build step**: the ESM sources ship as they are.
- **Astro is the only declared peer**, and it is optional. Playwright is **not** a dependency or a peer: when automation is requested, the CLI looks for an already-installed `playwright` or `@playwright/test` in your project, from your project root.
- The package is distributed **from GitHub**; nothing is published to npm.

**Release status.** `v0.4.0` is the current released tag and remains the install target above; it includes the build/report workflow, the automation policy and the native preview. The **development sources (Unreleased)** are **no longer presentation-only**: they add the designer provenance report, the public `--color-tune-<public-name>-light|dark` controls, the per-identity surface-mix knobs and the **guided contrast workbench** documented below — the palette is published first, then the real `var(--color-*)` pairs are measured in light/dark and baseline/tuned/draft comparisons, with editable public full-color and surface-mix knobs, a minimum-lightness correction, and no automatic writes — while keeping existing tokens, macros and legacy dark knobs working. `v0.4.0` keeps the behavior its [changelog](./CHANGELOG.md) documents. `build` writes the CSS and attempts both HTML artifacts; `check` and the Astro integration remain CSS-only. Opening the artifacts needs no server, and Playwright stays an optional consumer tool: with no Playwright installed, a valid `build` still exits `0` and publishes both pages.

```sh
pnpm add -D github:SMartSlash/astro-smart-colors#v0.4.0
```

### 2. Create the two authored files

```sh
pnpm exec smart-colors init
```

`init` writes a starter `src/styles/tokens/palette.css` and a `src/styles/tokens/colors-tuning.css`. Add `--dir src/tokens` for another folder, or `--yes` to skip the prompts. It then prints a short **Come funziona** block naming the three files a designer touches: the palette (your source), the generated output (`build` writes it; do not edit it by hand) and the tuning file (optional runtime refinement). With a custom `--dir` or `--palette`, `init` also writes a fresh plain `smart-colors.config.mjs` unless a config already exists; existing configs are never rewritten, and a diverging palette override is refused before writing. `pnpm exec` runs the binary from your project's dependency; with a global install, `smart-colors` works directly.

### 3. Author the palette

One `canvas`, one `ink`, then as many `ui`, `feedback` and `decorative` colors as you need:

```css
@property --palette-canvas {
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

@property --palette-brand {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.664 0.106 156.4);
  role: ui;
  dark-blend: 80;
}

@property --palette-success {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.6 0.13 150);
  role: feedback;
}

@property --palette-highlight {
  syntax: "<color>";
  inherits: true;
  initial-value: oklch(0.72 0.18 280);
  role: decorative;
}
```

`dark-blend: 0…100` is optional on **every role**. It is a bounded white wash: `0` keeps the source, `80` keeps 77.6% source and mixes 22.4% white, `100` keeps 72% source and mixes 28% white. Omit it to keep the role's automatic derivation — an omitted descriptor is not `0`. The blend never darkens toward black, and WCAG does not impose a 10/90 mix: the resolved pairs are what gets checked. Foundations and neutrals follow the same verified model; a custom source is not a promise that every possible combination will be accessible.

### 4. Generate the CSS and import it

```sh
pnpm exec smart-colors build   # writes src/styles/tokens/colors.css and both HTML artifacts
pnpm exec smart-colors check   # read-only; exits 1 while the file on disk is stale
```

```css
@import "./colors.css";
@import "./colors-tuning.css";
```

`build` generates `colors.css` from the palette and then attempts `reports/smart-colors-preview.html` and `reports/smart-colors.html`, even when the CSS output was already current. `check` is strictly read-only: it writes nothing and does not present an older report as current.

Components never read `--palette-*` and never edit the generated file. This is the whole non-Astro path: the output is plain CSS you import wherever the project keeps its styles.

`v0.3.0` `build` wrote only the CSS output; `v0.4.0` `build` also publishes the two diagnostic pages. `build` defaults to `--automation=auto`. On a valid model, a missing Playwright still exits `0`, publishes both HTML files and prints a brief optional-automation note (no install instruction by default). For CI, use `--automation=required` or `audit` when a missing browser must fail the command, including an explicit install action; `--automation=off` never resolves or imports Playwright and still publishes the pages.

The CLI console summary is Italian and single-purpose, and it states its provenance. `check` shows a stale verdict immediately, with its model line reading **Contrasti non misurati (stima del modello)**. `build`/`report` stream plain progress lines as each real phase starts (`smart-colors · analisi palette`, `generazione token`, `controllo automazione opzionale` — `verifica automatizzata richiesta` under `--automation=required` — and `anteprima e report`), then print one compact labelled line per fact — **Palette**, **Output**, **Generato**, **Verifica**, **Esito**, **Problemi**, the two clickable `file://` links (**Anteprima** first, then **Report**) and **Fai ora**. Generation is shown apart from verification. The **Verifica** line says `MISURATO` for any real browser measurement — including a partial run, whose incomplete coverage is stated on the same line — and `STIMA DEL MODELLO` only when no pair was measured; the single **Esito** verdict is `DA RIVEDERE` for any measured problem, below minimum or below target. **Fai ora** opens the preview, and a regenerate command appears only when the CSS needs a build. Model warning/suggestion strings and raw core errors stay verbatim on stderr.

Use `--root <dir>` when the project root is not the current directory (it is resolved from the current working directory) and `--config <file>` when the config file is not `smart-colors.config.mjs` (it is resolved relative to `--root`); these are the effective paths used by the command.

### 5. Register the Astro integration (Astro only)

In Astro you register the integration instead of running `build` by hand; it generates and checks the token outputs on `dev`, `sync`, `check` and `build`:

```js
import { defineConfig } from "astro/config";
import smartColors from "@smartslash/astro-smart-colors";

export default defineConfig({
  integrations: [smartColors()],
});
```

The integration writes only the configured CSS/motion outputs. It never creates the two HTML artifacts and never launches a browser.

## Start here: "I want X → use Y/Z"

Choose a **pair**, not an isolated color. Seven neutral/border/focus names plus five suffixes of one family cover daily work — **12 names**, not 230 choices.

| I want… | Use this token combination | Important boundary |
|---|---|---|
| Neutral page and body text | `--color-bg` / `--color-text` | `--color-text-muted` for secondary content on neutral backgrounds. |
| Neutral card | `--color-surface` / `--color-text` | `--color-border-subtle` is ornamental; `--elevation-1` is optional. |
| Filled button or badge | `--color-primary-solid` / `--color-primary-solid-text`; hover: `--color-primary-solid-hover` | Keep the same `solid-text` on hover; do not substitute `--color-primary-ink`. |
| Soft colored callout or status | `--color-success-surface` / `--color-success-text` | Add a label or icon: color alone never carries meaning. |
| Meaningful chromatic boundary | `--color-primary-border-strong` against the intended background | Stronger variant of the family border; not a guarantee on arbitrary backgrounds. |
| Identity color itself with overlaid content | `--color-primary` / `--color-primary-ink` | Direct companions belong to direct fills, not family surfaces or hover fills. |
| Visible keyboard focus | `--color-focus-ring` against `--color-bg` or `--color-surface` | Use on `:focus-visible` with `outline-offset`. |

Substitute `primary` with `secondary`, `tertiary`, `success`, `warning`, `danger` or `info` when present in your palette. Alpha borders, arbitrary backgrounds and local overrides are not validated.

The design flow is **source → recipe → use → control → check actual**: choose the source in `palette.css`, let the recipe derive the public token, use that token by intent, override only through a public `--color-tune-*` control when needed, then check the actual generated CSS plus tuning. The static report follows the same chain; it does not promise that every authored source or every arbitrary combination will be accessible.

## Runtime Tuning (`colors-tuning.css`)

Project deviations that must survive a rebuild live in `colors-tuning.css`, imported after `colors.css`. Tune public `--color-tune-*` tokens only; `--_color-*` internals are not a contract. The starter panel is fully commented: uncomment only what you need, and check the actual generated CSS plus the tuning file after the change.

```css
:root {
  /* Legacy macros: how much of the light tint survives in dark mode. */
  --color-tune-dark-bg-mix: 14%;
  --color-tune-dark-surface-mix: 18%;
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

  /* Legacy per-identity dark controls, still preserved. */
  --color-tune-primary-dark-mix: 77.6%;
  --color-tune-primary-dark: oklch(0.62 0.15 32.41);
}
```

- `--color-tune-<public-name>-light|dark` is **uniform**: every emitted public `--color-*` token reads its own pair — neutral tokens (`bg`, `surface`, `text`, `text-muted`, `border-subtle`, `border-strong`, `focus-ring`), controls, identity base and `ink`, the nine family variants (`surface`, `surface-strong`, `border`, `border-strong`, `solid`, `solid-hover`, `solid-text`, `text`, `text-strong`), decoratives and `<decorative>-ink`, and enabled scale steps and hue variants. `<public-name>` is the public token without the `--color-` prefix. The generated value stays the literal fallback (contrast solved at build time); the override replaces it at runtime and is **not** revalidated by `smart-colors check`, so re-measure the affected pairs after the edit.
- Foundation dark values are controlled by `--color-tune-bg-dark` and `--color-tune-surface-dark`.
- Surface knobs are `--color-tune-<identity>-surface-<theme>-mix` (default 10% source in light, 18% in dark) and `--color-tune-<identity>-surface-strong-<theme>-mix` (default 18% / 28%). A full `--color-tune-<identity>-surface-[strong-]<theme>` color wins over the mix knob, which wins over the generated default.
- `--color-tune-dark-{bg,surface,text,muted}-mix`, `--color-tune-<id>-dark-mix` and `--color-tune-<id>-dark` are legacy controls and keep working. `--color-tune-<id>-dark` replaces the dark fill only; it does not regenerate hover, `solid-text`, ink, surfaces, text variants, scales or hue variants.
- `dark-blend` in `palette.css` is accepted on all five roles. Omitted means automatic per role; `0` means “keep the source”; `100` mixes 28% white. It never darkens toward black, and WCAG does not impose a 10/90 mix.

These overrides act at runtime and are **not** revalidated by `smart-colors check`; measure the actual generated CSS plus tuning before relying on them. The report does not apply or write any tuning change.

## CLI

Run the commands from your project root through the package manager that installed the package:

```sh
pnpm exec smart-colors build
pnpm exec smart-colors check
pnpm exec smart-colors report --automation=off
pnpm exec smart-colors audit chromium webkit
```

Use `--root <dir>` when the project root is not the current directory (resolved from the current working directory), and `--config <file>` when the config file is not `smart-colors.config.mjs` (resolved relative to `--root`). Options can appear before or after the command.

| Command | Writes | HTML | Automation |
|---|---|---|---|
| `init` | Starter palette and `colors-tuning.css` (plus a config when `--dir` moves the tokens) | No; `build` is the next step | No |
| `build` (also the default command) | Generated CSS/motion outputs and the two HTML artifacts | Always attempted after a safe analysis, even when CSS is already current | `auto` by default |
| `check` | Nothing | Does not regenerate or present old HTML as current | No |
| `report` | The two HTML artifacts; never palette, config, tuning or CSS | Always attempted with safe paths | `auto` by default |
| `audit` | Nothing | No | Strict, Playwright required; default Chromium |
| Generator API and Astro integration | Only the configured CSS/motion outputs | No implicit HTML | No |

`init`, `check` and `audit` reject `--automation`. `build` does not accept a browser list. `report` accepts `chromium`, `firefox` and `webkit` positionals; an explicit list implies `--automation=required`. An explicit list combined with `auto` or `off` is a usage error, not a silent downgrade.

`report` writes `reports/smart-colors-preview.html` (open this first) and `reports/smart-colors.html`. It does not modify the palette, config, tuning or generated CSS. A missing or stale CSS output is shown as a declared diagnostic candidate, never accepted as production, and is named on the console. An empty argument is a usage error that writes nothing.

### Automation modes

`--automation=auto|off|required` applies only to `build` and `report`:

- `auto` (default, no list): tries the supported engines available to the consumer — Chromium, Firefox and WebKit — and declares the ones it skipped. It never downloads browsers.
- `off`: does not resolve, import or launch Playwright. Both HTML artifacts and the native preview runtime are still produced.
- `required` (no list): requires Chromium for a deterministic request. With an explicit report list, requires exactly those engines.

`audit` keeps its original strict behavior and has no second automation mode. Automation is optional: one shared budget of 60 seconds covers the whole run, including proposal trials, so the optional work is bounded rather than gating the command. Under `auto`, an expected absence (Playwright simply not installed) is a brief note and is not echoed as a raw stderr detail, while other environment or measurement failures stay detailed; under `required` (and `audit`) the CLI states the explicit action and exits non-zero. Run details are deduplicated on stderr, and stdout lines are length-capped with terminal control characters escaped.

### Exit policy

The CLI classifies failures by phase, not by how many measurements happened to succeed.

| Event | `build` `auto` | `build` `off` | `report` `auto` | `required` / `audit` |
|---|---:|---:|---:|---:|
| Requested operation succeeds | 0 | 0 | 0 | 0 |
| Playwright missing, import incompatible, binaries missing, or no engine launchable during discovery/import/availability/launch | 0 + reason | Does not check Playwright | 0 + reason | Non-zero |
| One engine unavailable but others completed | 0 + partial coverage | Not applicable | 0 if the executed measurements are clean; partial coverage explicit | Non-zero if that engine was required |
| Runner launched but validation/execution failed, or mandatory scenarios are missing, even before a first successful measurement | 0 + incomplete result | Not applicable | Non-zero | Non-zero |
| Measured pairs below the minimum | 0 + visible problems | Not applicable | Non-zero | Non-zero |
| Only below the configured target, minimum met | Advisory | Advisory | Advisory | Advisory |
| Usage, input/I/O, strict contrast contract or publication failure | Non-zero | Non-zero | Non-zero | Non-zero |

Additional rules:

- `check`: current output exits `0`; stale output or an error exits non-zero.
- `report off`: exits `0` when the model is valid and both HTML files are published; it declares that no automated measurement ran.
- `build auto` never adds a gate merely because Playwright is present. Use `required` or `audit` in CI.
- `report auto` is intentionally stricter than `build auto` once a runner actually executed: an incomplete run or a measured below-minimum pair exits `1`. An environment that never became available remains non-blocking and is reported.
- Model warnings remain warnings even when they are not generation errors. A below-target shortfall is advisory; an incomplete or missing measurement is not a pass.
- Measurements made later in an opened preview page cannot retroactively change the CLI exit code.

## Diagnostic artifacts

`build` and `report` publish two self-contained `file://` pages from the same captured snapshot, with no network access and no server:

- **`reports/smart-colors-preview.html`** — the designer-first preview. It publishes the source palette first, then embeds an isolated runtime and an inert JSON payload containing the exact CSS bytes to drive a guided contrast workbench and a local browser verification section.
- **`reports/smart-colors.html`** — the complete **static** report. It keeps `script-src 'none'` and has no script. It adds designer provenance (sources, recipes, public tokens and controls), separates the generated model CSS from the captured baseline, and keeps exploratory overlaps in their own channel.

### How to read the preview

The preview is a designer-first space, and the **source palette comes first**. It is not a live editor with automatic writes:

1. **Palette sorgente e ruoli** — the authored colors and the role of each one, published with the exact captured `@property` declaration, the raw source value, the `dark-blend` line and the palette path/SHA-256. The **declared** role (from the palette annotation) is shown first, and the **effective** configured role only when it differs. The **full source CSS** is selectable in a textarea and downloadable **manually** as `palette.css`; opening the page writes no file.
2. **Banco di contrasto guidato** — pick a declared palette source, then a pair the generator actually measured. Compare **temi (chiaro contro scuro)**, **baseline contro tuned** or **tuned contro draft**; each side is a real consumer specimen in an isolated frame that consumes the public `var(--color-*)` tokens, so no resolved RGB is painted in place of the proof. The measurement list reports the applied variant/theme, the byte it comes from, the status and the minimum/target.
3. **Archivio tecnico** — the resolved-color samples from the model, kept as a reference **estimate**, never a verification.
4. **Verifica locale completa (archivio)** — the extended local verification of all measured pairs, kept as a secondary technical archive.
5. **Correzioni e problemi** — shown only when there is something to correct or review; the verified corrections are grouped by destination file (`palette.css`, `colors-tuning.css` or `smart-colors.config.mjs`), each with a manual snippet and nothing applied for you.
6. **Dati tecnici** and **Verifica automatizzata** — the technical metadata (the embedded CSS bytes, the snapshot fingerprint and the errors) inside a native `<details>`, with the automation evidence kept separate as the last section.

Model samples are an **estimate**, never a verification: every sample is a forecast computed without a browser, and no sample receives a verification badge.

### The guided contrast workbench

The **Banco di contrasto guidato** measures the **embedded bytes**, not the project files on disk, in fresh isolated `iframe srcdoc` documents (`sandbox="allow-same-origin"`, no scripts in the frame). Its scope is deliberately narrow and honest:

- **Palette first, then real pairs.** The bench first shows the authored sources and roles (read-only), then the pairs the generator actually declared. It never invents a pair, a source or a ratio.
- **Three comparisons.** `themes` compares light against dark; `tuning` compares the baseline against the saved tuned variant; `draft` compares the tuned variant against the temporary draft. Baseline, tuned and draft stay distinct, and the workbench does not rewrite media queries to fake a preference. The runtime's initial selection is the `tuning` comparison; when no tuning bytes are embedded, the saved variant falls back to the baseline. The theme radios, the comparison radios and the two frame headings are projected from the runtime's own selection and measured views, so the page always shows the theme and variant that were actually measured.
- **Editable public knobs, for the selected pair and theme only.** The form edits only the public controls the design metadata declares for the **currently selected pair and theme**: a **full-color override** (`--color-tune-<public-name>-light|dark`) and a **surface-mix percentage** (`--color-tune-<identity>-surface[-strong]-<theme>-mix`). Overrides and mixes are temporary in-memory drafts; they never write the palette, the config, the tuning file or `colors.css`. **Azzera i controlli della coppia** resets one pair, **Azzera tutto il tuning** / **Ripristina** resets the draft. The seven known macro knobs (`--color-tune-light-warmth`, `--color-tune-dark-warmth`, `--color-tune-dark-bg-mix`, `--color-tune-dark-surface-mix`, `--color-tune-dark-text-mix`, `--color-tune-dark-muted-mix`, `--color-tune-surface-lightness-shift`) remain a **runtime-only** API: they are not exposed as a global macro editor in the view.
- **Editing shows the draft.** A successful edit, reset or **Prova proposta** switches the displayed comparison to `draft`, so the temporary change is always visible before the next measurement. A correction search that runs while a draft already exists switches to the real draft view first and waits for its frames before computing the candidate, so a candidate is never verified against the saved-only view and then silently merged with a hidden override.
- **Copy and export are manual.** **Esporta CSS pubblico** publishes the draft's `:root { … }` declarations in a readonly textarea with a manual `colors-tuning.css` download. The export is recomputed from the current draft whenever it changes, the download link is hidden while there is no draft, and the copy action recomputes and refuses to copy an empty export. The copy uses the clipboard when the browser allows it and otherwise selects the text for Cmd/Ctrl+C; the palette source offers the same manual select/download semantics. Nothing is written by the page.
- **Minimum-lightness correction, foreground or background.** **Suggerisci primo piano** and **Suggerisci sfondo** search the **minimum lightness** on the 0..1 grid (step `0.0001`) that satisfies the declared thresholds, keeping chroma and hue fixed. This is **not** a global perceptual nearest match and does not minimize ΔE. A candidate is verified in a real CSS trial across the known pairs in **both themes** (the same pure verification core and DOM collector used by automation, with a regression check). A verified result is shown **before** you apply it: the exact proposed `oklch(...)`, the before/after ratios, the relevant minimum/target, the ΔL and a gamut note (chroma reduced by the sRGB fit, or none applied), plus two real `var(--color-*)` consumer frames — **Attuale** and **Proposta** — measured at the same size as the trial and failing closed if they do not reproduce the verified ratios. The candidate edits one theme's control, so the targeted theme changes while the opposite theme is still re-measured as collateral — it is not claimed to change. Nothing is written to the draft or the export until **Prova proposta**; the proposal is cleared by any edit or reset, a system preference change, or a new search. A discarded or unverifiable candidate is disclosed and never applied.
- **No automatic writes.** Local results and drafts modify only the in-memory DOM. The browser cannot write a project file: edit the source and regenerate the snapshot. Editing the palette, config or tuning still requires regenerating `colors.css` before an earlier snapshot is treated as current.
- **Roles are declared, not assumed.** The source palette shows the **declared** role from the captured `@property` annotation, and shows the **effective** configured role only when it differs — the config role is never presented as the authored one.
- **Explicit exclusions.** The bench is a token-contrast bench, not an accessibility audit, and it is **not a full component catalog or an APG pattern gallery** — the specimen is a small demonstration surface. It measures declared opaque token pairs only; alpha, gradients, `forced-colors` and context-specific WCAG conformance are out of scope and fail closed (unsupported `@import`/`url()` resources are not applied).

### What the static report adds

The static report is the complete record of the same captured snapshot. Read it in this order:

1. **Palette source → recipe → use → control** — the designer section traces each public token from its `--palette-*` sources, through the declared recipe and usage, to its light/dark controls. Sources and recipes are the **generator's starting expectations**; the measured CSS baseline stays the final source, and a stale output or an active full-color control means the recipe quota is not necessarily what renders. The report never re-derives a recipe or applies an override.
2. **Generated model vs captured baseline** — `css.generated` describes the expected model output; `css.baseline` is the actual captured output when it exists (even when empty), otherwise the generated candidate. The source (`output` or `generated-candidate`), status (`current`, `stale`, `absent`, `empty`), production flag and both hashes stay visible. A stale real file is never presented as a candidate, and a candidate is never presented as an on-disk measurement.
3. **Exploratory overlaps** — optional `automation.explorations` and `explorationCoverage` are shown as a separate channel with their own expected/measured/unmeasured units and omitted families. They never change the verified-pair coverage, never become an issue and never substitute an accessibility audit.
4. **Model, automation, integrity and limits** — the existing static sections remain; the report writes no CSS, recalculates no contrast and keeps `script-src 'none'` with zero scripts or iframes.

Migrating to the new controls requires regenerating `colors.css`: the emitted declarations change, so byte parity with a pre-upgrade output is not preserved. Regenerate first, then re-measure. The preview artifact budget is **768 KiB (786432 bytes)**, replacing the former **384 KiB (393216 bytes)**, and covers the full palette source and its manual download, the serialized interactive runtimes and the view factory, the measurement frames and the comparison/correction metadata. Current measurements stay around 675 KiB, within the budget, and are reported as current values, not a guarantee. The guided contrast workbench is preview-only; the static report keeps its stricter CSP and stays script-free.

### What the native preview measures

The preview validates the **embedded bytes**, not the project files on disk. On load it validates the inert payload and reads the active OS `prefers-color-scheme` preference — it does **not** emulate the other preference. In fresh isolated `iframe srcdoc` documents it measures, under that preference:

- baseline CSS in light and dark;
- when a non-empty tuning file is present, the tuned variant in light and dark;
- for the guided workbench, the selected comparison's two sides (light vs dark, baseline vs tuned, or tuned vs draft), each a real `var(--color-*)` consumer specimen.

The guided workbench section leads with the selected comparison: a left and a right CSS frame, each with its applied variant/theme, its byte provenance and its measured status, and the minimum/target. The extended **Verifica locale** archive leads with the measured variant/theme combinations (baseline and, when present, tuned, each in both themes) and with the scoped problems — up to eight cards by default, the rest behind a disclosure — while the raw per-pair table stays in a disclosure. Baseline and tuned runs remain separate, and both themes are measured under the **active** preference. The preview does not rewrite media queries to fake the other preference: the other preference is declared **unmeasured** and is explicitly **not a second theme**, and only browser automation can fill that cross of theme and preference. A preference change invalidates the local results first and then reruns both themes. The native retry button reruns the checks and does not move focus automatically.

The workbench runtime and the legacy diagnostic presenter use the same pure verification core and DOM collector as the automation adapter, but they only verify the snapshot's declared pairs. The workbench runs the shared `suggestLightness` advice factory for its minimum-lightness correction and verifies each candidate in a real trial, but it never carries the generator or a full proposal solver that writes to disk. Local results and drafts modify only the in-memory DOM: they never rewrite the preview, the full report or the project, and the browser cannot apply a change — edit the file and regenerate the snapshot. With JavaScript disabled, or when CSP/support blocks the runtime, the page keeps the source palette, the `@property` declarations, the catalogue, the snapshot and model samples and an explicit “local measurements not run” state.

The preview has a dedicated CSP built from the SHA-256 hash of the exact runtime bytes it emits. Measurement frames are sandboxed without scripts; network, forms, popups and top-level navigation are blocked. The static report keeps its stricter CSP and remains useful without JavaScript.

### Snapshot identity and regeneration

Both pages show the generation time and an abbreviated input SHA-256 fingerprint. They are snapshots, not live badges: after editing the palette, config or tuning, run `build` or `report` again. Do not treat a prior file as current. The two artifacts are published through one ownership-checked writer: byte-zero marker, input/output collision checks, refusal of symlinks and hard links, and atomic replacement per file. Success is reported only after both requested files are in place.

### Model, local and automation are different

- **Model** — generator analysis without a browser. Samples and warnings are predictions; displaying them never adds a “verified” badge.
- **Browser-local** — the preview runtimes in the browser you opened: the guided workbench and the extended local verification. They measure both themes under the active preference only, are scoped to that browser and those embedded bytes, and their temporary drafts never touch disk.
- **Browser automation** — Playwright measurement of requested engines and emulated theme/preference scenarios. It uses the same core collector and records engine, version, phase and coverage.

None of these is a universal accessibility certification. Missing, unsupported or incomplete coverage is reported as such and never becomes a pass. Scope excludes screenshot/pixel comparison, alpha compositing, images and gradients, arbitrary component or local-surface CSS, undeclared combinations, intermediate animation states and forced-colors confirmation. `solid`/`hover` checks cover declared token pairs, not every `:hover` rule in a site.

Contrast suggestions remain **read-only**. The solver never edits the palette, config, tuning or generated CSS, and no autofix is applied. A proposal is published only when it can be verified in all requested scenarios and engines; a discarded candidate is disclosed, not silently dropped. Verifying a proposal in one browser or one local run does not promote it to “verified everywhere”.

## Playwright discovery

Playwright is an optional tool of the **consumer**, not a dependency or peer of this package:

```sh
pnpm add -D playwright
pnpm exec playwright install chromium
```

When automation is requested, discovery is anchored only to the consumer root. The CLI resolves `playwright` first and `@playwright/test` second, imports either the ESM or CJS export shape, and accepts the engine objects it exposes. It checks the already-installed browser binary path and never triggers an automatic download or installation. A package resolved from another checkout is not used as a fallback.

The phases are kept distinct: `discovery`, `import`, `availability` and `launch` describe the environment; payload validation, CSS application, measurement and classification failures describe an incomplete verification. The structured result keeps the phase, cause and engine.

## Upgrading from 0.2.x

0.3.0 renames three public token families; the old names are no longer emitted.
Rename them in components and in `colors-tuning.css`:

| 0.2.x | 0.3.0 | Applies to |
|---|---|---|
| `--color-on-<name>` | `--color-<name>-ink` | identities, decoratives and aliases |
| `--color-<name>-on-solid` | `--color-<name>-solid-text` | identity families |
| `--color-tune-dark-*-depth` | `--color-tune-dark-*-mix` | `bg`, `surface`, `text`, `muted` tuning knobs |

Everything else keeps its name, including the configuration keys (`contrast.*`, `onSolid.<identity>.<theme>`, `derivation.*`). A stale tuning name is not an error: it is simply not consumed, so that override stops applying. Then run `pnpm exec smart-colors build` and `pnpm exec smart-colors check`, and re-measure if the project tunes or overrides tokens. The full list, with the migration steps, is in [`CHANGELOG.md`](./CHANGELOG.md).

## Migrating from 0.3.0 behavior

Install the new tag first; the generated token API is unchanged:

```sh
pnpm add -D github:SMartSlash/astro-smart-colors#v0.4.0
```

- `build` now also publishes the two HTML artifacts, even when the CSS output is already current. The Astro integration and the generator API still write only the CSS/motion outputs.
- `report` now publishes the same two artifacts without writing CSS, palette, config or tuning. The full report stays static; the preview gains the isolated local runtime described above.
- Playwright is no longer declared as a peer. `off` never resolves or imports it. `auto` tries the engines already available in the consumer; `required` is the strict request for CI.
- The preview has its own hash-based CSP; the full report keeps `script-src 'none'`. Both are snapshots to regenerate after edits, and both go through the same ownership and output-path guardrails.
- The read-only proposal solver and the `./report` / `./audit` legacy API wrappers keep their behavior; the new exit policy belongs to the CLI workflow, not to the adapters. See [`docs/REFERENCE.md`](./docs/REFERENCE.md).

## Links

- **Release 0.4.0**: [tag `v0.4.0`](https://github.com/SMartSlash/astro-smart-colors/releases/tag/v0.4.0) — the install target above.
- **Starter HTML, no framework**: [`./examples/minimal/`](./examples/minimal/) — one palette, one plain page, no config file.
- **Releases and token renames**: [`./CHANGELOG.md`](./CHANGELOG.md) — what each tag changes, and the migration steps between them.
- **Full technical reference**: [`./docs/REFERENCE.md`](./docs/REFERENCE.md) — configuration, contrast contract and solver, generated API, `--surface-color` substrate, `--ink-*` helpers, motion, programmatic API, validation guarantees and the CLI policy.
