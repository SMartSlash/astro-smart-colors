# @smartslash/astro-smart-colors

**Palette in, accessible semantic CSS out.** A portable Astro integration + standalone CLI that turns a small editable OKLCH palette into a semantic color API.

You author a few `@property` source colors. The package derives the rest at build time and emits plain CSS built on modern native features:

- `light-dark()` pairs for every theme-aware token;
- `color-mix()` for the adaptive dark identity and the neutral mixes;
- `oklch(from ...)` for lightness-relative derivations;
- `contrast-color()` for the `--ink-*` progressive-enhancement helpers.

It runs build-time/dev-time only: the browser receives static CSS, **no client JavaScript** is required, and the package has **zero runtime dependencies**. Use it as an Astro integration or through the CLI in any project.

[Quickstart](#quickstart) · [Daily API](#start-here-i-want-x--use-yz) · [Tuning](#runtime-tuning-colorstuningcss) · [CLI](#cli--browser-audit) · [Reference](./docs/REFERENCE.md)

## Quickstart

### 1. Create the two authored files

```sh
smart-colors init
```

`init` writes a starter `src/styles/tokens/palette.css` and a `src/styles/tokens/colors-tuning.css`. Add `--dir src/tokens` for another folder, or `--yes` to skip the prompts. In Astro you can instead register the integration, which builds and checks the tokens on `dev`, `sync`, `check` and `build`:

```js
import { defineConfig } from "astro/config";
import smartColors from "@smartslash/astro-smart-colors";

export default defineConfig({
  integrations: [smartColors()],
});
```

### 2. Author the palette

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

### 3. Import the generated CSS

```css
@import "./colors.css";
@import "./colors-tuning.css";
```

`smart-colors build` generates `colors.css` from the palette; `smart-colors check` fails if the file on disk is stale. Components never read `--palette-*` and never edit the generated file.

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

| Command | What it does |
|---|---|
| `smart-colors init` | Writes the starter palette and `colors-tuning.css` (plus a config when `--dir` moves the tokens). |
| `smart-colors build` | Generates `colors.css` (and the optional motion file) from the palette. |
| `smart-colors check` | Verifies the generated files are current; exits `1` when they are stale. |
| `smart-colors audit` | Measures the generated tokens and the tuning file in a real browser across four theme/preference scenarios. Read-only. |
| `smart-colors report` | Runs the same measurement plus the read-only proposal solver and publishes the two HTML artifacts. |

`report` writes `reports/smart-colors.html` (the full report) and `reports/smart-colors-preview.html` (the page to open first: measured samples, worst-case pairs and the manual proposals the solver could verify). A preview is a **static snapshot**: regenerate it after changing the palette, the config or `colors-tuning.css`, and treat a stale one as outdated.

Playwright is an **optional** peer dependency used only by `audit` and `report`:

```sh
pnpm add -D playwright
pnpm exec playwright install chromium
```

Without it those two commands exit with a clear error and write nothing; `init`, `build` and `check` never load it.

## Links

- **Starter HTML, no framework**: [`./examples/minimal/`](./examples/minimal/) — one palette, one plain page, no config file.
- **Full technical reference**: [`./docs/REFERENCE.md`](./docs/REFERENCE.md) — configuration, contrast contract and solver, generated API, `--surface-color` substrate, `--ink-*` helpers, motion, programmatic API, validation guarantees and browser regression checks.
