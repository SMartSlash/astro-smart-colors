# Contributing

Thanks for trying Smart Colors. This repository is the package only: the
generator, the validation, the CLI and the report renderers. No build step is
required, because the package ships its ESM sources directly.

## Setup

```sh
pnpm install
pnpm test
```

`pnpm test` runs the whole suite with `node --test`. It needs no browser and no
network access, so it stays fast enough to run on every save.

## How to propose a change

1. Open an issue describing the case, or the palette that exposes it.
2. Keep the change narrow: one behaviour, one test.
3. Run `pnpm test` before pushing.

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
dependency or a peer: when `build`/`report` automation or the strict `audit` asks
for it, the CLI discovers an already-installed `playwright` or `@playwright/test`
from the consumer root, checks the existing browser binary and never downloads
one. `--automation=off` performs no discovery or import.

The unit and contract suite in `test/` runs entirely in Node (`pnpm test`) with
an injected fake provider where needed, without launching a browser. The
end-to-end browser harnesses are tools of the reference site repository, not
files shipped by this package; they use the site's `@playwright/test` and
pre-installed binaries and must not be presented as package requirements.

## Documentation and examples

Keep consumer commands runnable with `pnpm exec smart-colors` and the effective
`--root`/`--config` paths. The `scripts/*` harnesses in the site repository are
not package files and must not be documented as shipped examples. Do not bump
the version or create a tag as part of a documentation change. When documenting
the diagnostic artifacts, name the whole `smart-colors-reports/` folder and its
local assets; do not describe an HTML file as self-contained.

## Finding the owner of a change

| Concern | Start here | Boundary |
| --- | --- | --- |
| Config and palette inputs | `load-config.mjs`, `parse-palette.mjs`, `validate-config.mjs` | Diagnose invalid input before generation or writes. |
| Color math and thresholds | `verification-core.mjs`, `color-math.mjs` | `color-math` delegates to the shared core; do not add a second contrast algorithm. |
| Derivation and CSS | `generate-colors.mjs`, `design-recipes.mjs`, `format-css.mjs` | Recipes own design constants; formatting does not change the model. |
| File safety | `output-paths.mjs`, `init.mjs`, `report-artifact.mjs` | Reuse canonical path checks, including absent files and symlinked parents. |
| Captured inputs and orchestration | `diagnostic-session.mjs`, `diagnostic-workflow.mjs`, `report-data.mjs` | Preserve captured bytes and keep intentional build writes distinct from external changes. |
| Browser verification | `browser-audit.mjs`, `verification-dom.mjs`, `diagnostic-runtime.mjs` | Separate orchestration, applied-style collection and browser lifecycle. |
| Interactive tuning | `contrast-workbench-runtime.mjs` | Own selection, drafts, proposals and conservative export; never write project files. |
| Report layout and bundle | `report-paths.mjs`, `report-artifact.mjs` | Own the shared folder/document/asset names and the writer bundle; renderers keep their standalone inline output and expose the asset bundle. |
| Preview UI and reports | `contrast-workbench-view.mjs`, `format-report-preview.mjs`, `format-report-html.mjs` | Render controller state; do not recalculate contrast in presentation code. |
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
