# Changelog

Releases are **git tags** on [`github.com/SMartSlash/astro-smart-colors`](https://github.com/SMartSlash/astro-smart-colors); nothing is published to npm.

```sh
# Install a released tag (adjust the tag after each release):
pnpm add -D github:SMartSlash/astro-smart-colors#v0.3.0
```

## 0.3.0 — 2026-10-18

The first release that ships the browser audit and the renamed token API. It is a
**minor** bump on 0.x on purpose: before 1.0 a breaking change is still a minor
release, and a patch would claim the 0.2.x names keep working.

### Added

- `smart-colors init [--dir <dir>] [--palette <file>] [--tuning <file>] [--yes]` —
  writes the starter `palette.css` (neutral example sources, documented roles) and a
  `colors-tuning.css` panel whose values are all commented out; creates missing parent
  directories, refuses any existing target, and never prompts without a terminal.
- `smart-colors audit [browsers…]` — read-only browser measurement of the generated
  tokens plus the project's `colors-tuning.css` across four theme/preference scenarios,
  with `below-target` / `below-minimum` classification and no writes.
- `smart-colors report [browsers…]` — the same measurement plus the read-only proposal
  solver, published as `reports/smart-colors.html` and `reports/smart-colors-preview.html`.
- `examples/minimal/` — a plain-HTML starter that consumes the generated API and uses the
  same palette `init` writes.
- `--color-tune-<identity>-dark-mix` — runtime knob for the generated dark `color-mix()`
  of a single identity, so `border` and `solid` stay aligned with the fill.
- Package exports `./report` and `./audit`.
- `docs/REFERENCE.md` — the full technical reference moved out of the README; the README
  keeps the quick tour.

### Changed

- `astro` is now an **optional** peer dependency, and `playwright` / `@playwright/test`
  are optional peers loaded only by `audit` and `report`. `init`, `build` and `check` run
  without either.
- `build` and `check` report the contrast baseline (errors, warnings, suggestions) and the
  tuning overrides they found, in addition to the generated-file status.
- The published tree includes `docs/` and `examples/`, and the committed `pnpm-lock.yaml`
  lets CI install with `--frozen-lockfile`.

### Changed (breaking) — public token renames

| 0.2.1 | 0.3.0 | Applies to |
|---|---|---|
| `--color-on-<name>` | `--color-<name>-ink` | identities, decoratives and aliases |
| `--color-<name>-on-solid` | `--color-<name>-solid-text` | identity families |
| `--color-tune-dark-bg-depth` | `--color-tune-dark-bg-mix` | tuning contract |
| `--color-tune-dark-surface-depth` | `--color-tune-dark-surface-mix` | tuning contract |
| `--color-tune-dark-text-depth` | `--color-tune-dark-text-mix` | tuning contract |
| `--color-tune-dark-muted-depth` | `--color-tune-dark-muted-mix` | tuning contract |

Everything else keeps its name: the neutral tokens, the rest of every functional family,
scales, hue variants, controls, `--surface-*`, `--elevation-*`, the native
`--ink-<identity>` helpers, and the configuration keys (`contrast.*`,
`onSolid.<identity>.<theme>`, `derivation.*`, `scales.*`, `motion.*`, `logo.*`).

### Migration from 0.2.x

1. Point the dependency at the new tag:
   `pnpm add -D github:SMartSlash/astro-smart-colors#v0.3.0`.
2. Rename the tokens in components and page styles using the table above. The old names
   are not emitted any more, so a missed rename resolves to nothing.
3. Rename the same keys in `colors-tuning.css`. A stale name is **not** an error: it is
   simply not consumed, so that override silently stops applying and the generated default
   returns. There is no automatic rename.
4. Regenerate and verify: `pnpm exec smart-colors build`, then
   `pnpm exec smart-colors check` (which fails while the file on disk is stale).
5. If the project has a tuning file or local surfaces, re-measure with
   `pnpm exec smart-colors audit` (or `report`) before trusting the result.

## 0.2.1

- Package split published from the `ASTRO_SWL` monorepo with `git subtree split`; the
  site-level end-to-end tests stayed in the site repository.
- `astro` was a **required** peer dependency (`>=5`).

## 0.2.0

- First tagged release: the OKLCH generator, the contrast validation with its
  adapt/warn/stop contract, and the `build` / `check` CLI.
- No build step and no runtime dependencies: the ESM sources ship as they are.
