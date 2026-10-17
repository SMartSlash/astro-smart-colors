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
- **Report renderers stay static.** No scripts, no external assets, and an
  unverified snapshot never receives a positive verdict or a suggested colour.

## What is not in this package

The browser audit, the snapshot builder and the visual report generation are
project tooling that lives in the reference site repository. This package stays
free of Playwright so it can be installed anywhere.
