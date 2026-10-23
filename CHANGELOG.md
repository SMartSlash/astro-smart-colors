# Changelog

Releases are **git tags** on [`github.com/SMartSlash/astro-smart-colors`](https://github.com/SMartSlash/astro-smart-colors); nothing is published to npm.

```sh
# Install a released tag (adjust the tag after each release):
pnpm add -D github:SMartSlash/astro-smart-colors#v0.4.0
```

## Unreleased

An **additive designer-contract** release in the development sources: it adds the
designer provenance report, the public per-token tuning controls, the surface-mix
knobs, the all-role `dark-blend` model and the optional exploratory-overlap
channel. Existing token names, legacy macros and the `--color-tune-<id>-dark` /
`--color-tune-<id>-dark-mix` escape hatches keep working; no existing generated
value is renamed. The console and preview presentation changes below are part of
the same unreleased sources. The version stays `0.4.0`, nothing is released,
tagged or published, and these entries describe the in-development sources, not
the `v0.4.0` tag.

### Added

- Visual A/B pair cards with hard diagonal foreground/background swatches from each
  view's actual runtime measurements, shared grid/table filters and eight pairs per
  page. Selection, pagination and focus remain stable during remeasurement, including
  the live-only filter, without retaining stale live colours or results.
- Full-width pair inspection followed by a separate tuning/export section, responsive
  manual controls, disclosed CSS snippets and a readable no-JavaScript snapshot table.
  Matrix results distinguish declared minimum, project target and provenance rather
  than inferring AA/AAA conformance from non-text ratios.
- The uniform public per-token controls `--color-tune-<public-name>-light|dark`.
  Every emitted public `--color-*` token reads its own pair: neutrals (`bg`,
  `surface`, `text`, `text-muted`, `border-subtle`, `border-strong`,
  `focus-ring`), controls, identity base and `ink`, the nine family variants
  (`surface`, `surface-strong`, `border`, `border-strong`, `solid`,
  `solid-hover`, `solid-text`, `text`, `text-strong`), decoratives and
  `<decorative>-ink`, and enabled scale steps and hue variants. The generated
  value stays the literal fallback (contrast already resolved at build time),
  while the override replaces it at runtime and is **not** revalidated by
  `smart-colors check`: re-measure the affected pairs after an override. A full
  color wins over a recipe (including a surface mix knob); light and dark stay
  independent.
- Per-identity surface mix knobs
  `--color-tune-<identity>-surface[-strong]-<theme>-mix`, with source-percentage
  defaults `10%/18%` for `surface` and `18%/28%` for `surface-strong`
  (light/dark). A full `--color-tune-<identity>-surface[-strong]-<theme>` color
  wins over the mix knob, which wins over the generated default.
- `dark-blend: 0…100` is accepted on all five palette roles. It is a bounded
  white wash (`80` → 77.6% source + 22.4% white; `100` → 72% source + 28%
  white), never a darkening toward black. Omitting it keeps the role's automatic
  derivation and is not `0`; WCAG does not impose a 10/90 mix.
- `session.design` metadata: `version: 1`, palette `sources`, derivation
  `recipes` and public `tokens` with `sources`, `recipe`, `usage` and
  light/dark `controls`. The static report traces source → recipe → use → control
  through the shared `createDesignTools().describeToken()` helper and never
  re-derives a recipe or a contrast.
- Additive `session.css` provenance: `generated` (expected model), `baseline`
  (actual captured output when present, even empty, otherwise the generated
  candidate), `source: "output" | "generated-candidate"`,
  `status: "current" | "stale" | "absent" | "empty"`, `production` and
  generated/baseline digests. The report writes no CSS; a stale real file is not
  relabeled as a candidate, and a candidate is not presented as an on-disk
  measurement.
- Optional `automation.explorations` and `explorationCoverage`
  (`expected`, `measured`, `unmeasured`, `omittedFamilies`, `complete`) as a
  separate exploratory-overlap channel. The static report shows the top scoped
  pairings with ratio/minimum/target, ordered by usage band (normal text at
  least 4.5:1, large text/borders/icons 3:1–4.5:1, avoid below 3:1), partial
  missing units and omitted families (schema cap: 24 families); the rest stays in
  a disclosure. The channel never changes verified-pair coverage, applies no
  autofix and does not substitute an accessibility audit.
- The starter `colors-tuning.css` is now a guided, fully commented panel:
  legacy macros, the uniform per-token light/dark overrides for every category,
  surface mixes, dark mixing plus the foundation dark controls
  (`--color-tune-bg-dark` / `--color-tune-surface-dark`) and elevation. It
  documents that the generated value is the fallback and the override is a
  runtime change that must be re-measured. It never activates arbitrary palette
  overrides or `--_color-*` internals.
- The guided contrast workbench in the preview. The source selector leads into real
  consumer specimens and contextual correction actions. The following source archive retains
  the exact captured `@property` declaration, raw authored value, role and `dark-blend`,
  with the palette path and SHA-256. The **declared** role is shown first and the
  **effective** configured role only when it differs. Full source CSS remains selectable
  and downloadable **manually** as `palette.css`; opening the page writes nothing.
- Synchronous `discardSuggestion()` controller API and **Scarta proposta**: invalidate
  in-flight suggestions and remove trial/proposal frames without changing the draft,
  selection, main measurements, revision or export. Discard is not a tuning reset.
- Real consumer specimens instead of painted RGB: every visible sample and every
  measurement is a `var(--color-*)` consumer inside an isolated `iframe srcdoc`
  (`sandbox="allow-same-origin"`, no scripts in the frame) that reads the embedded
  baseline (and, when present, the saved tuning and the temporary draft — see
  `src/contrast-workbench-runtime.mjs` and `src/contrast-workbench-view.mjs`). No
  resolved RGB color is painted in place of the proof.
- Three comparisons only: **temi** (`themes`, light vs dark), **baseline contro tuned**
  (`tuning`) and **tuned contro draft** (`draft`). Each side reports the applied
  theme/variant, the byte provenance (baseline, `output` vs generated candidate, the
  `stale`/`absent`/`empty` states), the measured status and the minimum/target. The theme and
  comparison radios and the two frame headings are projected from the runtime's own selection
  and measured views, so the page cannot show a theme or variant other than the one measured.
- Editable public tuning controls, scoped to the selected pair and theme. The form edits only
  the public controls the design metadata declares for the **currently selected pair and
  theme**: the full-color `--color-tune-<public-name>-light|dark` override and the surface-mix
  percentage `--color-tune-<identity>-surface[-strong]-<theme>-mix`. They are temporary in-memory
  drafts: applying them never writes the palette, the config, the tuning file or `colors.css`.
  The seven known macro knobs (`--color-tune-light-warmth`, `--color-tune-dark-warmth`,
  `--color-tune-dark-bg-mix`, `--color-tune-dark-surface-mix`, `--color-tune-dark-text-mix`,
  `--color-tune-dark-muted-mix`, `--color-tune-surface-lightness-shift`) remain a
  **runtime-only** API: `setOverride()`/`reset()` accept them, but the view does not render a
  global macro editor.
- Editing shows the draft. `setOverride()`, `reset()` and `applySuggestion()` switch the
  displayed comparison to `draft` before the next measurement, so a successful public edit is
  always visible; error paths never switch. A correction search that runs while a draft already
  exists switches to the real draft view and awaits its frames before computing the candidate,
  so a candidate is never verified against the saved-only view and then silently merged with a
  hidden override.
- Individual reset (**Azzera i controlli della coppia**), full reset (**Azzera tutto il
  tuning** / **Ripristina**) and the header's **Esporta CSS**. The export is the `:root { … }`
  block of the temporary draft declarations, published in a readonly textarea with a
  manual `colors-tuning.css` download. The export is recomputed from the current draft whenever
  it changes, the download link is hidden while there is no draft, and the copy action recomputes
  the draft and refuses to copy an empty export. The copy uses the clipboard when the browser
  permits it and otherwise selects the text for a manual Cmd/Ctrl+C. Every download stays
  a manual action; no file is written by the page.
- A read-only correction search per side (**Suggerisci primo piano** / **Suggerisci
  sfondo**). It is limited to the **minimum lightness** that satisfies the declared
  thresholds on the 0..1 grid (step 0.0001), keeping chroma and hue fixed — not a global
  perceptual nearest match and not a ΔE minimization. A candidate is verified in a real
  CSS trial across the known pairs in **both themes** (the same pure core and DOM
  collector as automation), including a regression check. The verified proposal is shown
  **before** it is applied: the exact proposed `oklch(...)`, the before/after ratios against
  the relevant minimum and target, the ΔL and a gamut note, plus two real `var(--color-*)`
  consumer frames — **Attuale** and **Proposta** — rendered by the runtime at the same size as
  the trial and failing closed if they do not reproduce the verified ratios. The draft and the
  export are untouched until **Prova proposta**; the proposal is removed by any draft mutation,
  a system preference change, or a new search. The candidate edits one theme's control, so the
  targeted theme changes while the opposite theme is still re-measured as collateral and is not
  claimed to change. A discarded or unverifiable candidate is disclosed, never applied.
- `mount()` gains two **additive, optional** proposal containers (`proposalBefore`,
  `proposalAfter`). When both are supplied the verified suggestion is rendered into them as a
  real base/candidate comparison; when omitted the controller behaves exactly as before and
  `state().suggestion.preview` stays `null`. The `preview` metadata is presentation-only and
  never enters the serialized draft or the exported CSS.
- Additive `session.paletteSource` object (exposed in the inert payload as
  `payload.paletteSource`): `{ css, path, sha256, sources: [{ token, value, role, darkBlend,
  declaration }] }`, where `declaration` is the exact captured `@property` block (or `null` in
  legacy mode) and `role` is the **declared** role. It is strictly additive: the legacy
  `session.palette` **array** (the resolved gallery the static report consumes) keeps its shape
  and keeps driving the static report, and `paletteSource` does not replace it. The **effective**
  configured role stays separate in `session.roles.identities[]` (keyed by `paletteName`) and is
  shown only when it differs from the declared one.

### Changed

- The `build`/`report` console summary is rebuilt as one compact labelled line per
  fact: **Palette** (colors and roles), **Output**, **Generato**, **Verifica**,
  **Esito**, **Problemi**, **Anteprima**, **Report** and **Fai ora**. Generation is
  shown as a fact separate from verification, so a successful write is never read as
  a positive verification.
- Live, plain progress lines are streamed as each real phase starts
  (`smart-colors · analisi palette`, `generazione token`,
  `controllo automazione opzionale` — `verifica automatizzata richiesta` in
  `required` — and `anteprima e report`) — no spinner, no TUI and no invented
  percentages. Only started phases reach stdout; a usage failure keeps stdout empty.
- Provenance and completeness are separate facts. The **Verifica** line says
  `MISURATO` for any real browser measurement — including a partial run, whose
  incomplete coverage is stated on the same line — and `STIMA DEL MODELLO` only when
  no pair was measured. A partial measured run keeps its measured problems instead
  of falling back to the model list.
- The single **Esito** verdict is `DA RIVEDERE` for any measured problem — below
  minimum **or** below target — `OK` only for a complete, clean measurement,
  `NON VERIFICATO` for a measured-but-partial clean run or when no engine started,
  and `ERRORE` for a strict-invalid model.
- **Fai ora** opens the preview first; regenerating the CSS is a separate,
  conditional secondary step shown only when the output actually needs a build.
- Problems use human usage names and the theme (a shared designer lexicon), capped
  at five per run; token names and raw ratios stay in the stderr detail and in the
  report. More model warnings still never certify a palette, and the project target
  stays distinct from the reference minimum.
- `init` prints a short **Come funziona** block naming the three files a designer
  touches: the palette (your source), the generated output (do not edit by hand)
  and the tuning file (optional runtime refinement).
- `check` labels its model result as **Contrasti non misurati (stima del modello)**.
- Blocking model errors are now also echoed once on stderr for `build`/`report`,
  bounded and deduplicated with the rest of the technical detail.
- The preview leads with source/pair selection and the guided contrast workbench on real
  `var(--color-*)` frames, followed by the source palette/roles archive, then the technical archive
  of resolved samples, then the extended local browser verification (kept as a secondary
  archive), then a **Correzioni e problemi** section only when there is something to correct
  or review, and finally the technical data and the automation evidence. The workbench is
  the main path; in the archive samples the first family is open and the rest are native
  `<details>`, and the model samples are an **estimate**, never a verification.
- The **Smart Colors** preview adopts a compact horizontal toolbar instead of a sidebar:
  source swatches (native source select on narrow containers), a human current-use summary
  and **Cambia uso**, all three comparison modes and theme controls, with full-width specimens
  side by side on desktop and stacked on mobile. The header has an honest local/pending/
  draft badge and one **Esporta CSS** action. Correction/apply/discard actions sit together
  below the specimens; proposal reasoning and manual controls remain secondary disclosures.
  Fixed `360×480` proposal verification frames scroll locally rather than resizing. Explicit
  apply/discard keeps keyboard focus on a stable export/correction control. Raw source
  metadata and manual palette download remain in their closed technical detail.
- Replaced the long primary pairing dropdown and duplicate catalogue disclosure with a
  native **Cambia uso** dialog: source-scoped categories, normalized word-AND search,
  explicit empty results and six results per page. Every match remains reachable through
  pagination; Escape preserves selection and choosing a result restores opener focus.
  The full technical select remains in the technical disclosure. Known on-color uses get
  readable labels without changing the measured pair or its technical metadata.
- The bench states its scope in the UI: the catalogue is **generated**, not a site scan or
  detected usage; the **4.5:1 normal-text threshold** is the WCAG minimum (with static
  SC 1.4.3, 1.4.6 and 1.4.11 references) while the project target stays a separate objective;
  the page is **not a site accessibility audit** and makes **no focus-conformity claim**
  (the ring sample verifies colour adjacency only).
- Fixed a real non-text adjacency bug: border and outline samples were painted on the frame
  canvas rather than the pair's background, so the reported ratio did not match the surface
  around the painted edge. The runtime now wraps the ring in a 12 px container painted with
  `var(<pair.background>)`, so the measured surface surrounds the whole edge, and renders the
  sample as an empty static `role="img"` element with a fixed 48 px size instead of
  unmeasured placeholder text.
- The local verification section leads with the measured variant/theme combinations,
  then the problems (up to eight cards by default, the rest behind a disclosure) and
  keeps the raw per-pair table in a disclosure. Baseline and tuned runs stay
  separate, both themes are measured under the **active** `prefers-color-scheme`
  preference, and the other preference is declared unmeasured and explicitly **not**
  a second theme.
- The full report documents the evidence it contains per channel (model estimate and
  automation in the executed environments), states that no browser-local
  measurement is included, and keeps `script-src 'none'` with no script.
- Both pages keep the read-only contract: the embedded runtime measures only the
  in-memory DOM from the embedded CSS bytes, writes no project file, and both
  artifacts stay snapshots to regenerate after any palette, config or tuning edit.
- The static report adds a designer-provenance section, the generated-vs-baseline
  CSS contract and the exploratory-overlap channel; it still keeps
  `script-src 'none'`, emits zero scripts or iframes and recalculates no contrast.
  Token metadata comes from the shared registry helper instead of copied rules.
- The palette and tuning documentation now follows the full designer chain
  **source → recipe → use → control → check actual**, including the all-role
  `dark-blend` model and the legacy/new tuning precedence. Regenerate the CSS and
  re-measure after any tuning change.
- Migration: the new per-token and surface overrides change the emitted
  declarations, so verifying the actual new CSS requires regenerating
  `colors.css`. Byte parity with a pre-upgrade output is **not** preserved;
  regenerate first, then re-measure with `report`/`audit`.
- The preview artifact budget is **768 KiB (786432 bytes)**, replacing the former
  **384 KiB (393216 bytes)**. The page carries the full palette source and its manual
  download, the serialized interactive runtimes and the view factory, the measurement
  frames, and the comparison/correction metadata. Current measurements stay around 675 KiB,
  within the budget, and are reported as current values, not a guarantee.
- The guided workbench is explicitly **not an accessibility audit** and **not a full
  component catalog or an APG pattern gallery**: the specimen is a small demonstration
  surface, the bench measures declared opaque token pairs only, it does not emulate the OS
  color preference or `forced-colors`, and it fails closed on unsupported resources
  (`@import`/`url()`), alpha and gradients. A palette/config/tuning edit still requires
  regenerating `colors.css` and re-measuring before any earlier snapshot is treated as
  current.

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
