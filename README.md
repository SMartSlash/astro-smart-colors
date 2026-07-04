# @smartslash/astro-smart-colors

Portable Astro integration + CLI that turns a small editable OKLCH palette into a semantic, accessible CSS color API.

The package is build-time/dev-time only: it generates static CSS before Astro renders the site. No client JavaScript is required for the baseline color system.

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
    ui: 3,
    maxIdentity: 7.5,
  },
  roles: {
    bg: "--palette-bg",
    ink: "--palette-ink",
    identities: {
      primary: { token: "--palette-primary", role: "accent-text" },
      secondary: { token: "--palette-secondary", role: "accent-ui" },
      tertiary: { token: "--palette-tertiary", role: "soft-surface" },
    },
    decoratives: {},
    focus: "primary",
  },
  aliases: {
    accent: "secondary",
  },
  logo: {
    enabled: false,
    sources: {},
  },
});
```

## Palette input

The palette file should contain simple OKLCH source tokens. Tokens registered in `roles.identities` are required and fail generation if missing; tokens registered in `roles.decoratives` are optional and are skipped with a warning if missing.

```css
:root {
  --palette-bg: oklch(0.9865 0.0078 105.49);
  --palette-ink: oklch(0.28 0.007 3.68);

  --palette-primary: oklch(0.664 0.106 156.4);
  --palette-secondary: oklch(0.62 0.16 32);
  --palette-tertiary: oklch(0.850 0.040 105);
}
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

--color-border-subtle
--color-border-strong
--color-focus-ring

--color-control-*
```

Generated internal tokens use the `--_color-*` prefix and should not be consumed by components.

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

## CLI

```sh
smart-colors build
smart-colors check
smart-colors check --config smart-colors.config.mjs --root .
smart-colors --config=smart-colors.config.mjs check
smart-colors --help
```

Options can be placed before or after the command. Supported flags are `--config`/`-c`, `--root`/`-r`, and `--help`/`-h`.

Useful package scripts:

```json
{
  "scripts": {
    "colors:build": "smart-colors build",
    "colors:check": "smart-colors check"
  }
}
```

## Astro behavior

- On `astro dev`, the integration generates the CSS and watches both the palette and config files.
- On `astro build`, it generates before the build starts.
- If generated output is out of date, `smart-colors check` exits with a non-zero status.

## Design principle

Keep the CSS API small and memorable. Put contrast search, dark derivation, fallback generation and brand-specific glue in build-time code/config, not in components.
