# @smartslash/astro-smart-colors

**Palette in, accessible semantic CSS out.** A portable Astro integration + standalone CLI that turns a small editable OKLCH palette into a semantic color API.

You author a few `@property` source colors. The package derives the rest at build time and emits plain CSS built on modern native features:

- `light-dark()` pairs for every theme-aware token;
- `color-mix()` for the adaptive dark identity and the neutral mixes;
- `oklch(from ...)` for lightness-relative derivations;
- `contrast-color()` for the `--ink-*` progressive-enhancement helpers.

It runs build-time/dev-time only: the browser receives static CSS, **no client JavaScript** is required, and the package has **zero runtime dependencies**. Use it as an Astro integration or through the CLI in any project.

[Quickstart](#quickstart) · [Daily API](#start-here-i-want-x--use-yz) · [Tuning](#runtime-tuning-colorstuningcss) · [CLI](#cli--browser-audit) · [Reference](./docs/REFERENCE.md) · [Changelog](./CHANGELOG.md)

## Quickstart

Works in an Astro project and in a project with no Astro at all: `build` emits plain CSS.

### 1. Requirements and install

- **Node `>=22.12.0`** (the `engines` field). The generator and the CLI run on Node only; no browser is involved unless you ask for `audit` or `report`.
- **No runtime dependencies and no build step**: the ESM sources ship as they are, so installing from a tag is enough.
- The package is distributed **from GitHub**; nothing is published to npm.

```sh
pnpm add -D github:SMartSlash/astro-smart-colors#v0.3.0
```

A dev dependency is enough, because the package only runs at build/dev time; with npm the same command is `npm i -D github:SMartSlash/astro-smart-colors#<tag>`. `v0.2.1` stays installable for a project that has not migrated yet: 0.3.0 renames public tokens and [`CHANGELOG.md`](./CHANGELOG.md) carries the rename map and the migration steps.

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
pnpm exec smart-colors build   # writes src/styles/tokens/colors.css
pnpm exec smart-colors check   # read-only; exits 1 while the file on disk is stale
```

```css
@import "./colors.css";
@import "./colors-tuning.css";
```

`build` generates `colors.css` from the palette; `check` fails if the file on disk is stale. Components never read `--palette-*` and never edit the generated file. This is the whole non-Astro path: the output is plain CSS you import wherever the project keeps its styles.

### 5. Register the Astro integration (Astro only)

In Astro you register the integration instead of running `build` by hand; it generates and checks the tokens on `dev`, `sync`, `check` and `build`:

```js
import { defineConfig } from "astro/config";
import smartColors from "@smartslash/astro-smart-colors";

export default defineConfig({
  integrations: [smartColors()],
});
```

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

These overrides act at runtime and are **not** revalidated by `smart-colors check`; measure them with `audit` or `report` before relying on them.

## CLI & Browser Audit

Run the commands from the project root, through the package manager that installed the package — `pnpm exec smart-colors …` — or wrap them in `package.json` scripts (`pnpm colors:build`, `pnpm colors:check`, …).

| Command | What it does |
|---|---|
| `smart-colors init` | Writes the starter palette and `colors-tuning.css` (plus a config when `--dir` moves the tokens). |
| `smart-colors build` | Generates `colors.css` (and the optional motion file) from the palette. |
| `smart-colors check` | Verifies the generated files are current; exits `1` when they are stale. |
| `smart-colors audit` | Measures the generated tokens and the tuning file in a real browser across four theme/preference scenarios. Read-only. |
| `smart-colors report` | Runs the same measurement plus the read-only proposal solver and publishes the two HTML artifacts. |

`report` writes `reports/smart-colors.html` (the full report) and `reports/smart-colors-preview.html` (the page to open first: measured samples, worst-case pairs and the manual proposals the solver could verify). A preview is a **static snapshot**: regenerate it after changing the palette, the config or `colors-tuning.css`, and treat a stale one as outdated.

Playwright is an **optional** peer dependency, needed only by `audit` and `report`:

```sh
pnpm add -D playwright
pnpm exec playwright install chromium
```

Without it, `audit` exits with a clear error and writes nothing, and `report` exits `1` after publishing the two artifacts as an **incomplete snapshot** (the error is on the page and no correction is proposed). `init`, `build` and `check` never load it, so a project that only generates tokens needs Node and nothing else. `@playwright/test` (`>=1.40`) is accepted in place of `playwright`.

## Upgrading from 0.2.x

0.3.0 renames three public token families; the old names are no longer emitted.
Rename them in components and in `colors-tuning.css`:

| 0.2.x | 0.3.0 | Applies to |
|---|---|---|
| `--color-on-<name>` | `--color-<name>-ink` | identities, decoratives and aliases |
| `--color-<name>-on-solid` | `--color-<name>-solid-text` | identity families |
| `--color-tune-dark-*-depth` | `--color-tune-dark-*-mix` | `bg`, `surface`, `text`, `muted` tuning knobs |

Everything else keeps its name, including the configuration keys (`contrast.*`, `onSolid.<identity>.<theme>`, `derivation.*`). A stale tuning name is not an error: it is simply not consumed, so that override stops applying. Then run `pnpm exec smart-colors build` and `pnpm exec smart-colors check`, and re-measure with `audit` or `report` if the project tunes or overrides tokens. The full list, with the migration steps, is in [`CHANGELOG.md`](./CHANGELOG.md).

## Links

- **Starter HTML, no framework**: [`./examples/minimal/`](./examples/minimal/) — one palette, one plain page, no config file.
- **Releases and token renames**: [`./CHANGELOG.md`](./CHANGELOG.md) — what each tag changes, and the migration steps between them.
- **Full technical reference**: [`./docs/REFERENCE.md`](./docs/REFERENCE.md) — configuration, contrast contract and solver, generated API, `--surface-color` substrate, `--ink-*` helpers, motion, programmatic API, validation guarantees and browser regression checks.
