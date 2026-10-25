# Contributing

Thanks for trying Smart Colors. This repository is the package only: the
generator, the validation, the CLI and the report renderers. No build step is
required, because the package ships its ESM sources directly.

## Setup

```sh
pnpm install
pnpm test
```

`pnpm test` runs the package’s default Node groups through
`scripts/run-tests.mjs`: `unit`, `integration` and `browser`. The `browser`
files are hybrid — their Node assertions run in this default — while native
Playwright proofs stay opt-in. The reference-site group is never implied, and
the default needs no browser binary and no network access.

Use the focused unit group while iterating, and the default `pnpm test` before
opening a pull request. The full run is a pre-PR gate, not an every-save loop:
unit feedback is the fast path when you only touched the colour model or a
parser.

| Command | What it runs |
| --- | --- |
| `pnpm test` | unit + integration + browser, native proofs off |
| `pnpm test:unit` | pure Node unit tests only |
| `pnpm test:integration` | Node tests with temporary projects, filesystem and CLI |
| `pnpm test:browser` | browser group with native proofs for Chromium and WebKit |
| `pnpm test:site` | the explicit reference-site root proofs (Chromium) |
| `node scripts/run-tests.mjs --list` | print the selected files without running them |

The runner accepts a group and `--list`, and `--help` prints its options.
`pnpm test:browser` and `pnpm test:site` need an already installed Playwright and
browser binaries (see below); nothing is installed or downloaded by the suite. A
manual native subset is explicit about both the group and the engines:

```sh
node scripts/run-tests.mjs browser --native --browser=chromium
```

Native proofs exist only for Chromium and WebKit. Firefox remains a supported
product automation engine, but the package has no native Firefox proof, so an
explicit `--browser=firefox` is rejected instead of producing a green run where
every native proof is skipped. `--list` validates the group and browser flags but
skips the site filesystem preflight: `--list site` works without `--browser` and
without a checkout.

With native proofs enabled, the runner serializes the selected files with
`--test-concurrency=1` so browser proofs do not compete for the same engine and
produce false timeouts. The default Node run keeps Node’s normal file
parallelism.

### Test groups

`test/` is grouped by what a test needs, not by feature:

```text
test/
  unit/          pure Node: colour model, parsers and contracts
  integration/   temporary projects, filesystem, CLI and workflows
  browser/       hybrid files: Node checks always run; native proofs opt in
  site/          reference-site root proofs (three, Chromium only)
  helpers/       shared roots, Playwright discovery and the CSS oracle
```

The `browser` group is not “the E2E suite”: those files contain Node assertions
that the default executes, and only their native proofs launch a browser. The
`site` group is the only one that reads the reference-site checkout, and it is
always explicit.

CI runs the default `pnpm test` only, with a frozen lockfile, on Node 22.12.0,
24 and 26. There is no browser job and CI installs no Playwright.

## How to propose a change

1. Open an issue describing the case, or the palette that exposes it.
2. Keep the change narrow: one behaviour, one test.
3. Run the focused group while iterating and `pnpm test` before opening a pull
   request.

## House rules

- **Contrast is measured, never rounded into passing.** A ratio below its
  threshold stays below it; compact display values may not promote a shortfall
  onto its threshold.
- **The generator adapts, warns, or stops.** It adjusts derived tokens when it
  can, warns when a project target is missed but the reference minimum holds,
  and fails without writing anything when it cannot guarantee a contract
  requirement. Keep those three outcomes distinguishable.
- **Sources stay the designer's.** `palette.css` holds the authored OKLCH
  values, the configuration holds project-level definitions, and the tuning
  file holds measured runtime overrides. Generated CSS is never hand-edited and
  a suggestion is never applied automatically.
- **No colour is "correct" in isolation.** A change to a threshold, a role or a
  derivation must show which measured pairs it moves.
- **The full report stays static.** `smart-colors-reports/report.html` keeps
  `script-src 'none'` and has no script. It loads only its same-folder
  `styles/report.css`: no remote assets or remote styles are permitted. An
  unverified snapshot never receives a positive verdict or a suggested colour.
  The preview loads only its same-folder `styles/preview.css` and the classic
  deferred `scripts/preview.js`, next to an inert JSON payload; its runtime
  touches only the in-memory DOM and never the project files. Keep the whole
  `smart-colors-reports/` folder together. The writer never deletes, moves or
  rewrites a legacy `reports/` directory.

## Optional peers and browser E2E

`astro` is the only declared peer, and it is optional. Playwright is **not** a
dependency or a peer. The default `pnpm test` never launches a browser. Native
proofs are opt-in through the runner and resolve an already installed
`playwright` or `@playwright/test` from the package root by default, or from an
explicit `SMART_COLORS_PLAYWRIGHT_ROOT`. A missing Playwright module or browser
binary is a visible failure, not a silent skip; an engine excluded by
`--browser` is reported as a declared skip. The suite never installs or downloads
anything. Consumer projects need none of this: they only install Playwright
themselves when they opt into `build`/`report` automation or the strict `audit`.

The extracted reference-site proofs live in `test/site`; they run only with the
explicit `site` group and require `SMART_COLORS_SITE_ROOT` or the
monorepo-shaped sibling checkout. They enforce the approved **896 KiB
(917504 bytes)** preview budget; the raise follows a previous run that measured
596,886 bytes for the starter, 816,277 bytes for the stress fixture and 806,508
bytes for the root-sized session, as current measurements rather than a
permanent guarantee. This guide does not report the site group as passing: it is
opt-in, is not part of `pnpm test` or CI, and a green default or browser run is
not a site verification. The reference site’s own `scripts/*` harnesses remain
site tools, not shipped package files, and are not part of `pnpm test`.

The three reference-site proofs cover the real root inputs, the Primary source’s
representative uses and a root-sized automation session against the preview
budget. They are read-only and copy the inputs to a temporary directory; a
missing root is a failure, not a skip. The budget is a current gate, not a claim
that the site group has already been run in this checkout.

## Documentation and examples

Keep consumer commands runnable with `pnpm exec smart-colors` and the effective
`--root`/`--config` paths. `scripts/run-tests.mjs` is package development
tooling for the grouped suite; the `scripts/*` harnesses in the site repository
remain site files and must not be documented as shipped examples. Do not bump
the version or create a tag as part of a documentation change. When documenting
the diagnostic artifacts, name the whole `smart-colors-reports/` folder and its
local assets; do not describe an HTML file as self-contained.

## Navigating the source

The generator is the main tool; diagnostics help inspect its output. The directory
layout keeps those responsibilities visible without splitting every helper into
its own module:

```text
src/
  astro-integration.mjs  Astro hooks and watcher lifecycle
  cli.mjs               Commands and exit policy
  cli-style.mjs         Terminal presentation
  init.mjs              Starter-file creation
  colors/               Palette/config input, colour model and generated CSS
  diagnostics/          Captured sessions, workflow and artifact publication
    browser/            DOM measurement, automation and optional Playwright discovery
    preview/            Interactive workbench, browser UI and its CSS
    report/             Static report renderer and its CSS
  templates/            Authored palette and tuning starters
```

Declaration files stay beside the modules they describe. The CSS next to the
report/preview renderers is **source CSS**: published asset paths such as
`styles/preview.css`, `styles/report.css` and `scripts/preview.js` do not change.

### Read the generator first

Start at `colors/generate-colors.mjs`. Follow this path before opening the preview:

1. `colors/load-config.mjs` and `colors/parse-palette.mjs` read the authored inputs.
2. `colors/validate-config.mjs` checks the input contract before generation or writes.
3. The model in `colors/generate-colors.mjs` uses `colors/design-recipes.mjs`,
   `colors/foreground-solver.mjs` and the shared numeric core to derive colours and
   evaluate the declared pairs.
4. `colors/format-css.mjs` formats the model; the generator's write path publishes
   CSS, while `check` remains read-only.

For diagnostic commands, continue at `diagnostics/diagnostic-workflow.mjs`: it
coordinates captured inputs, intentional CSS writes, optional browser automation
and report publication. It does not introduce another colour engine. Browser
factories remain self-contained because the preview serializes them for offline
use; moving an ordinary imported helper inside one can break the emitted script.

Inside `diagnostics/preview/`, follow the execution environment:

- `contrast-workbench-markup.mjs` prepares the initial HTML and loads `workbench.css`
  in Node; it does not bind browser events.
- `contrast-workbench-view.mjs` binds DOM events and renders controller state in
  the browser. Its factory stays self-contained and has no Node dependencies.
- `contrast-workbench-runtime.mjs` owns interactive state, measurements and proposals.
- `format-report-preview.mjs` composes the page, styles and serialized factories.

Playwright is optional. Generating CSS, running `check` and running the default
Node groups must not require a browser. The existing `auto`, `off` and `required`
automation policies stay separate from the generator.

### Finding the owner of a change

Paths below are relative to `src/`.

| Concern | Start here | Boundary |
| --- | --- | --- |
| Config and palette inputs | `colors/load-config.mjs`, `colors/parse-palette.mjs`, `colors/validate-config.mjs` | Diagnose invalid input before generation or writes. |
| Color math and thresholds | `colors/verification-core.mjs`, `colors/color-math.mjs` | `color-math` delegates to the shared core; do not add a second contrast algorithm. |
| Derivation and CSS | `colors/generate-colors.mjs`, `colors/design-recipes.mjs`, `colors/format-css.mjs` | Recipes own design constants; formatting does not change the model. |
| File safety | `colors/output-paths.mjs`, `init.mjs`, `diagnostics/report-artifact.mjs` | Reuse canonical path checks, including absent files and symlinked parents. |
| Captured inputs and orchestration | `diagnostics/diagnostic-session.mjs`, `diagnostics/diagnostic-workflow.mjs`, `diagnostics/report-data.mjs` | Preserve captured bytes and keep intentional build writes distinct from external changes. |
| Browser verification | `diagnostics/browser/browser-audit.mjs`, `diagnostics/browser/verification-dom.mjs`, `diagnostics/browser/diagnostic-runtime.mjs` | Separate orchestration, applied-style collection and browser lifecycle. |
| Interactive tuning | `diagnostics/preview/contrast-workbench-runtime.mjs` | Own selection, drafts, proposals and conservative export; never write project files. |
| Report layout and bundle | `diagnostics/report-paths.mjs`, `diagnostics/report-artifact.mjs` | Own the shared folder/document/asset names and the writer bundle; renderers keep their standalone inline output and expose the asset bundle. |
| Initial workbench HTML | `diagnostics/preview/contrast-workbench-markup.mjs` | Prepare static markup and load its stylesheet in Node; do not bind browser events. |
| Browser workbench view | `diagnostics/preview/contrast-workbench-view.mjs` | Bind DOM events and render controller state; keep the serialized factory self-contained. |
| Preview and report composition | `diagnostics/preview/format-report-preview.mjs`, `diagnostics/report/format-report-html.mjs` | Compose the artifacts; do not recalculate contrast in presentation code. |
| CLI and Astro | `cli.mjs`, `astro-integration.mjs` | Consume validated config and existing workflow results, rather than duplicating them. |

Package entry points are declared in `package.json#exports`. Do not add an exported
helper solely for a test; exercise the owning entry point instead.
See [the October 2026 review](./docs/CODE-REVIEW.md) for fixes and remaining risks. That review and [`PREVIEW-UX-ANALYSIS.md`](./docs/PREVIEW-UX-ANALYSIS.md) are historical: their `reports/*.html` paths describe the pre-migration layout.

## Keeping changes human-maintainable

- Add a regression for the smallest real failing case, then test its caller. A helper
  returning the right options is not proof that the write path uses them.
- Keep one owner for validation, recipes and status vocabulary. Reuse existing
  helpers before adding a second parser or another copy of a rule.
- Prefer names that describe intent. Add short English comments for constraints or
  trade-offs, not a narration of the implementation.
- Keep refactors separate from bug fixes. Avoid broad formatting changes and test-only
  exports; remove private dead code only after checking its callers and emitted use.
- Serialized browser factories must be self-contained. Module-scope helpers are not
  available in the generated page; test the emitted HTML, not only imported functions.
- An offline byte budget is not a reason to remove a correctness guard. Remove dead
  code and redundant output instead; preserve the exact CSP hash and meaningful errors.

Project configuration is trusted ESM and executes with the caller's Node permissions;
it is not a sandbox for third-party configuration. Generated HTML still treats paths,
labels, snippets and captured CSS as data: escaping, CSP and isolated frames remain
necessary. Path validation prevents accidental collisions, but it does not promise a
transaction across several files or protection against a hostile concurrent writer.
