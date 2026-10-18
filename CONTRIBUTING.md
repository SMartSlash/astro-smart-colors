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
- **The full report stays static.** `reports/smart-colors.html` keeps
  `script-src 'none'`, no external assets, and an unverified snapshot never
  receives a positive verdict or a suggested colour. The preview may embed the
  isolated diagnostic runtime behind its own SHA-256 CSP and sandboxed frames;
  that runtime touches only the in-memory DOM and never the project files.

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
the version or create a tag as part of a documentation change.
