# @smartslash/astro-smart-colors

**Palette in, accessible semantic CSS out.** A portable Astro integration + standalone CLI that turns a small editable OKLCH palette into a semantic color API.

You author a few `@property` source colors. The package derives the rest at build time and emits plain CSS built on modern native features:

- `light-dark()` pairs for every theme-aware token;
- `color-mix()` for the adaptive dark identity and the neutral mixes;
- `oklch(from ...)` for lightness-relative derivations;
- `contrast-color()` for the `--ink-*` progressive-enhancement helpers.

The generated color system runs build-time/dev-time only: the browser receives static CSS and **no client JavaScript is required for the baseline tokens**.

`build` and `report` can also publish two file-only diagnostic HTML pages. The preview page embeds an isolated local runtime; the full report stays static. That diagnostic JavaScript never becomes part of your site's color CSS, and it is unrelated to Astro hydration.

[Quickstart](#quickstart) · [Daily API](#start-here-i-want-x--use-yz) · [Tuning](#runtime-tuning-colors-tuningcss) · [CLI](#cli) · [Diagnostics](#diagnostic-artifacts) · [Reference](./docs/REFERENCE.md) · [Changelog](./CHANGELOG.md)

## Quickstart

Works in an Astro project and in a project with no Astro at all: `build` emits plain CSS.

### 1. Requirements, install and release status

- **Node `>=22.12.0`** (the `engines` field). The generator and the CLI run on Node only; no browser is involved unless you request browser automation.
- **No runtime dependencies and no build step**: the ESM sources ship as they are.
- **Astro is the only declared peer**, and it is optional. Playwright is **not** a dependency or a peer: when automation is requested, the CLI looks for an already-installed `playwright` or `@playwright/test` in your project, from your project root.
- The package is distributed **from GitHub**; nothing is published to npm.

**Release status.** The current tag is `v0.3.0`. The build/report workflow, automation policy and native preview described in this worktree are **Unreleased**: they are not part of that tag and are not installable from it. No version bump or new tag is introduced here.

```sh
# v0.3.0: the previous release, without the Unreleased diagnostic workflow below.
pnpm add -D github:SMartSlash/astro-smart-colors#v0.3.0
```

To try the Unreleased behavior, use a checkout of this worktree or a workspace reference. Do not install `v0.3.0` expecting the new `build`/`report` effects.

### 2. Create the two authored files

```sh
pnpm exec smart-colors init
```

`init` writes a starter `src/styles/tokens/palette.css` and a `src/styles/tokens/colors-tuning.css`. Add `--dir src/tokens` for another folder, or `--yes` to skip the prompts. `pnpm exec` runs the binary from your project's dependency; with a global install, `smart-colors` works directly.

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

`dark-blend: 0…100` is optional on `ui`/`feedback`: it bounds how much white is mixed into the dark variant. Omit it to keep the adaptive lightness-based fallback.

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

This is the Unreleased behavior: `v0.3.0` `build` writes only the CSS output. `build` defaults to `--automation=auto`. On a valid model, a missing Playwright still exits `0`, publishes both HTML files and prints why browser measurement was skipped. For CI, use `--automation=required` or `audit` when a missing browser must fail the command. `--automation=off` never resolves or imports Playwright and still publishes the pages.

Use `--root <dir>` and `--config <file>` when the project root or config path is not the default; both are relative to the root and are the effective paths used by the command.

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

## Runtime Tuning (`colors-tuning.css`)

Project deviations that must survive a rebuild live in `colors-tuning.css`, imported after `colors.css`. Tune public `--color-tune-*` tokens only; `--_color-*` internals are not a contract.

```css
:root {
  /* Macro: how much of the light tint survives in dark mode. */
  --color-tune-dark-bg-mix: 14%;
  --color-tune-dark-surface-mix: 18%;
  --color-tune-dark-text-mix: 88%;
  --color-tune-dark-muted-mix: 72%;

  /* Per identity: share of the source kept in the generated dark color-mix(). */
  --color-tune-primary-dark-mix: 77.6%;

  /* Per identity escape hatch: a whole OKLCH dark fill. */
  --color-tune-primary-dark: oklch(0.6 0.13 32);
}
```

- `--color-tune-dark-{bg,surface,text,muted}-mix` are the neutral knobs; lower values mix in more black or white.
- `--color-tune-<id>-dark-mix` reparametrizes the generated dark `color-mix()`, so `border` and `solid` stay aligned with the fill.
- `--color-tune-<id>-dark` replaces the dark fill entirely; it does not regenerate hover, `solid-text`, text variants or scales.

These overrides act at runtime and are **not** revalidated by `smart-colors check`; measure them before relying on them.

## CLI

Run the commands from your project root through the package manager that installed the package:

```sh
pnpm exec smart-colors build
pnpm exec smart-colors check
pnpm exec smart-colors report --automation=off
pnpm exec smart-colors audit chromium webkit
```

Use `--root <dir>` when the project root is not the current directory, and `--config <file>` when the config file is not `smart-colors.config.mjs`. Both are relative to `--root`. Options can appear before or after the command.

| Command | Writes | HTML | Automation |
|---|---|---|---|
| `init` | Starter palette and `colors-tuning.css` (plus a config when `--dir` moves the tokens) | No; `build` is the next step | No |
| `build` (also the default command) | Generated CSS/motion outputs and the two HTML artifacts | Always attempted after a safe analysis, even when CSS is already current | `auto` by default |
| `check` | Nothing | Does not regenerate or present old HTML as current | No |
| `report` | The two HTML artifacts; never palette, config, tuning or CSS | Always attempted with safe paths | `auto` by default |
| `audit` | Nothing | No | Strict, Playwright required; default Chromium |
| Generator API and Astro integration | Only the configured CSS/motion outputs | No implicit HTML | No |

`init`, `check` and `audit` reject `--automation`. `build` does not accept a browser list. `report` accepts `chromium`, `firefox` and `webkit` positionals; an explicit list implies `--automation=required`. An explicit list combined with `auto` or `off` is a usage error, not a silent downgrade.

`report` writes `reports/smart-colors-preview.html` (open this first) and `reports/smart-colors.html`. It does not modify the palette, config, tuning or generated CSS. A missing or stale CSS output is shown as a declared diagnostic candidate, never accepted as production.

### Automation modes

`--automation=auto|off|required` applies only to `build` and `report`:

- `auto` (default, no list): tries the supported engines available to the consumer — Chromium, Firefox and WebKit — and declares the ones it skipped. It never downloads browsers.
- `off`: does not resolve, import or launch Playwright. Both HTML artifacts and the native preview runtime are still produced.
- `required` (no list): requires Chromium for a deterministic request. With an explicit report list, requires exactly those engines.

`audit` keeps its original strict behavior and has no second automation mode.

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

- **`reports/smart-colors-preview.html`** — designer-facing preview with the palette, families, model samples and the local browser verification section. It embeds an isolated runtime and an inert JSON payload containing the exact CSS bytes.
- **`reports/smart-colors.html`** — the complete **static** report with model and automation data. It keeps `script-src 'none'` and has no script.

### What the native preview measures

The preview validates the **embedded bytes**, not the project files on disk. When opened, it reads the active `prefers-color-scheme` preference and measures, with that preference, in fresh isolated `iframe srcdoc` documents:

- baseline CSS in light and dark;
- when a non-empty tuning file is present, tuned CSS in light and dark.

It does not rewrite media queries to fake the other preference. The other preference is declared **unmeasured**, and only browser automation can fill that cross of theme and preference. A preference change invalidates the local results first and then reruns both themes. The native retry button reruns the checks and does not move focus automatically.

The runtime uses the same pure verification core and DOM collector as the automation adapter, but it only verifies the snapshot's declared pairs. It does not carry the full read-only proposal solver into the browser. Local results modify only the in-memory DOM: they never rewrite the preview, the full report or the project. With JavaScript disabled, or when CSP/support blocks the runtime, the page keeps the snapshot, model samples and an explicit “local measurements not run” state.

The preview has a dedicated CSP built from the SHA-256 hash of the exact runtime bytes it emits. Measurement frames are sandboxed without scripts; network, forms, popups and top-level navigation are blocked. The static report keeps its stricter CSP and remains useful without JavaScript.

### Snapshot identity and regeneration

Both pages show the generation time and an abbreviated input SHA-256 fingerprint. They are snapshots, not live badges: after editing the palette, config or tuning, run `build` or `report` again. Do not treat a prior file as current. The two artifacts are published through one ownership-checked writer: byte-zero marker, input/output collision checks, refusal of symlinks and hard links, and atomic replacement per file. Success is reported only after both requested files are in place.

### Model, local and automation are different

- **Model** — generator analysis without a browser. Samples and warnings are predictions; displaying them never adds a “verified” badge.
- **Browser-local** — the preview runtime in the browser you opened. It covers the active preference only and is scoped to that browser and those embedded bytes.
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

These are the Unreleased changes, not a new tag:

- `build` now also publishes the two HTML artifacts, even when the CSS output is already current. The Astro integration and the generator API still write only the CSS/motion outputs.
- `report` now publishes the same two artifacts without writing CSS, palette, config or tuning. The full report stays static; the preview gains the isolated local runtime described above.
- Playwright is no longer declared as a peer. `off` never resolves or imports it. `auto` tries the engines already available in the consumer; `required` is the strict request for CI.
- The preview has its own hash-based CSP; the full report keeps `script-src 'none'`. Both are snapshots to regenerate after edits, and both go through the same ownership and output-path guardrails.
- The read-only proposal solver and the `./report` / `./audit` legacy API wrappers keep their behavior; the new exit policy belongs to the CLI workflow, not to the adapters. See [`docs/REFERENCE.md`](./docs/REFERENCE.md).

## Links

- **Starter HTML, no framework**: [`./examples/minimal/`](./examples/minimal/) — one palette, one plain page, no config file.
- **Releases and token renames**: [`./CHANGELOG.md`](./CHANGELOG.md) — what each tag changes, and the migration steps between them.
- **Full technical reference**: [`./docs/REFERENCE.md`](./docs/REFERENCE.md) — configuration, contrast contract and solver, generated API, `--surface-color` substrate, `--ink-*` helpers, motion, programmatic API, validation guarantees and the CLI policy.
