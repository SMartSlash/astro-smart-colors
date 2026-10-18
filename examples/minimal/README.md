# Minimal Smart Colors example

A plain HTML page consuming the generated token API. No framework, no build
tool, no JavaScript. The only authored color file is
`src/styles/tokens/palette.css`, with five sources: canvas, ink, one `ui`,
one `feedback` and one decorative.

The palette is the same starter palette that `smart-colors init` writes.

## Run it

With the package installed in a project (the example ships inside the package; the install line is in the [README](../../README.md)):

```sh
# 1. Generate src/styles/tokens/colors.css from the palette.
pnpm exec smart-colors build

# 2. Verify the generated file is present and current (read-only).
pnpm exec smart-colors check
```

In a checkout of the package repository, the same two steps without an install:

```sh
node ../../src/cli.mjs build
node ../../src/cli.mjs check
```

Then open `index.html` in a browser.

In a new project of your own, start with the same command `init`:

```sh
# 3. Create a palette and a colors-tuning.css panel with every value commented out.
pnpm exec smart-colors init   # or: npx smart-colors init
```

## What to look at

- The page background, cards and body text use `--color-bg`,
  `--color-surface`, `--color-text` and `--color-text-muted`.
- The button uses `--color-brand-solid` with `--color-brand-solid-text`, and
  hover moves to `--color-brand-solid-hover`.
- The success callout pairs `--color-success-surface` with
  `--color-success-text` and `--color-success-border`.
- The badge uses the decorative `--color-highlight` and its
  `--color-highlight-ink` companion.
- Keyboard focus (Tab) uses `--color-focus-ring`.
- Light and dark values come from generated `light-dark()` pairs and
  `color-scheme: light dark`; switch the OS appearance to see both.

`src/styles/tokens/colors.css` is generated, not committed here: run `build`
first. Edit `palette.css`, run `build` again, and use `check` in CI.
