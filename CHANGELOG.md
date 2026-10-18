# Changelog

Releases are **git tags** on [`github.com/SMartSlash/astro-smart-colors`](https://github.com/SMartSlash/astro-smart-colors); nothing is published to npm.

```sh
# Install a released tag (adjust the tag after each release):
pnpm add -D github:SMartSlash/astro-smart-colors#v0.4.0
```

## 0.4.0 — 2026-10-18

A **minor** bump on 0.x, following the same policy as 0.3.0: before 1.0, a new
documented behavior is a minor release, not a patch. `build` now also publishes
the diagnostic artifacts, `report` gains the native preview runtime and the CLI
gains the `auto|off|required` automation policy. The preview runtime and its
payload schema are embedded only in the generated page behind its own CSP; they
are not part of the color CSS and add no required dependency or peer. Playwright
remains a consumer tool, discovered only when automation is requested.

### Added

- `build` (also the default command) now publishes
  `reports/smart-colors-preview.html` and `reports/smart-colors.html` after a
  safe analysis, even when the CSS output is already current. The HTML files are
  attempted even when Playwright is absent.
- `report` publishes the same two artifacts from the same captured snapshot and
  never writes the palette, config, tuning or generated CSS.
- `--automation=auto|off|required` for `build` and `report`. `auto` tries the
  supported engines available in the consumer and declares skipped ones; `off`
  performs no Playwright discovery or import; `required` without a list requests
  Chromium. An explicit `report` browser list implies `required`, and combining
  a list with `auto` or `off` is a usage error. `init`, `check` and `audit`
  reject the flag.
- A native local verification runtime in the preview: baseline and, when a
  non-empty tuning file is present, tuned CSS in light and dark, always with the
  **active** `prefers-color-scheme` preference.
  The other preference is declared unmeasured; a preference change invalidates
  the local results and reruns both themes. The preview embeds the exact CSS
  bytes and an inert payload, measures in sandboxed `iframe srcdoc` documents and
  modifies only the in-memory DOM.
- Snapshot identity and an abbreviated SHA-256 fingerprint in both artifacts,
  with an explicit instruction to regenerate after edits.

### Changed

- Playwright is no longer declared as a dependency or peer. `astro` remains the
  only declared peer, and it is optional. When automation is requested, the CLI
  discovers `playwright` or `@playwright/test` from the consumer root, accepts
  the ESM or CJS export shape, checks the already-installed browser binary and
  never downloads or installs one.
- `build auto` remains non-blocking for an unavailable environment, an incomplete
  runner or measured below-minimum pairs; the reasons and problems stay visible
  in the console and in both HTML files. `report auto` exits `0` while the
  environment never became available, but exits non-zero once a launched run is
  incomplete or a measured pair is below minimum. `required` and `audit` are
  strict; below-target-only results remain advisory. `check` still exits `1` for
  stale output.
- The preview has a dedicated CSP with the hash of the exact emitted runtime.
  The full report keeps `script-src 'none'` and remains useful without
  JavaScript.
- Publication uses the byte-zero ownership marker, protects configured inputs and
  outputs from collisions, refuses symlink/hard-link targets and replaces each
  file atomically. Success is announced only after both requested files are
  written; the pair is not a transaction.
- Legacy `./report` and `./audit` API wrappers keep their documented behavior.
  The new exit policy belongs to the CLI workflow; adapters return structured
  data and do not set `process.exitCode`.
- The CLI console summary is now Italian and coherent: headings, state lines,
  help descriptions and parser messages are localized, while model
  warning/suggestion strings and raw core errors stay verbatim on stderr (the
  technical channel).
- An empty argument (for example `smart-colors ""` or `smart-colors build ""`)
  is now a usage error that exits `1` and writes nothing, instead of silently
  falling back to the default `build` command.
- `build` and `report` no longer print a plain success heading on a non-zero
  exit. A strict-invalid model prints `Build non completata` with the model
  error count and an explicit note that the two diagnostic HTML files were
  still published. A non-zero `build` otherwise distinguishes
  `Build completata · verifica richiesta non disponibile` (no engine started),
  `· verifica incompleta` (a launched run that did not complete) and
  `· problemi di contrasto` (complete measurement, below-minimum pairs);
  `report` distinguishes `Report generati · problemi rilevati`,
  `· verifica incompleta` and `· contratto non valido`.
- `build`/`report` print two clickable `file://` link lines (`Anteprima:` and
  `Report:`) instead of four path/URL lines, and the next step is “open the
  preview”. `report` no longer recycles an identical `report` command as its
  only next action; `build` keeps a secondary regenerate command.
- Optional automation is a brief stdout note with no install instruction by
  default. In `auto`, an expected absence (Playwright simply not installed) is
  only that brief note: its discovery reason is not echoed as a raw stderr
  detail, while import/availability/launch/measurement failures stay detailed.
  `required` keeps the technical detail and states the explicit action instead.
  A zero-engine run names every selected engine with a brief cause and never
  substitutes a hardcoded `chromium` install command for another engine, and it
  distinguishes a missing package/API from a missing engine binary. The raw
  engine/run detail is deduplicated on stderr, stays bounded, and stdout lines
  are length-capped with terminal control characters escaped (clickable URLs and
  command lines are never truncated). Automation keeps one shared 60-second
  budget for the whole run, proposals included.
- The CLI localizes the two typed absent-input errors: a missing palette points
  at `pnpm exec smart-colors init --root …`, and a missing explicitly selected
  config explains how to create it or drop `--config`, without suggesting an
  `init` that would fail on the same missing config. Other I/O errors keep their
  raw shape. `check` suggests the real regeneration command with the effective
  `--root`/`--config`, and its summary is printed before the raw stderr detail.
- The model facts are shown once: a single grouped problem synthesis in the
  console, counts in the model line, and the raw warning/suggestion strings on
  stderr only. A partial or empty run after a launch is reported as an explicit
  incomplete verification, never as a green all-clear. `report` names a stale or
  absent CSS output on the console as a diagnostic candidate, not accepted
  production. `init` lists only the files it actually created as “File creati”,
  keeps the effective `--root`/`--config` in its next-step command, and surfaces
  the owner's tuning guidance as an “Avvisi” section instead of a false success.

### Removed from the manifest

- The `playwright` and `@playwright/test` optional peer entries. This does not
  rewrite the 0.3.0 entry below: that release did declare them.

### Migration from 0.3.0

1. Point the dependency at the new tag:
   `pnpm add -D github:SMartSlash/astro-smart-colors#v0.4.0`.
2. Expect `build` to create `reports/` as well as the CSS output. Use the Astro
   integration or `generateColorTokens()` when you need CSS-only generation.
3. Playwright is no longer installed as a peer. Add `playwright` or
   `@playwright/test` in the consumer only if you use automation or `audit`, and
   install the browser binaries explicitly.
4. Treat the preview as an interactive snapshot and the full report as the static
   record. Both measure the embedded bytes; regenerate after every palette,
   config or tuning edit.
5. `check` remains read-only and still returns non-zero when the generated file is
   stale. No autofix is introduced.

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
