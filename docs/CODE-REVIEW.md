# Code review — 22 October 2026

## Scope and method

Review of the package sources, declaration files, templates, package exports, test workflow and minimal consumer example. Focus: reproducible bugs, local simplification, security and human maintainability.

The review was split into generation/validation, CLI/filesystem/Astro, browser verification, diagnostic/workbench runtime and HTML/UI. DeepSeek V4.1 Flash implemented scoped fixes; the coordinating reviewer checked cross-module behavior and final artifacts. Existing uncommitted preview fixes were preserved. No structural module split, dependency addition, public token rename, version bump, commit or push was performed.

This is a source review with regression evidence, not a proof that every input or browser behavior is correct. A green imported-module test alone was not accepted as proof of a working generated page.

## Fixed findings

Severity reflects the reachable effect, not an assumed remote attacker.

| Severity | Area / source | Reproducible defect and correction |
| --- | --- | --- |
| High | `init.mjs` | Palette/tuning could coincide with the config that init creates, or alias each other through symlinked parent directories while neither file existed. Later writes overwrote earlier authored content. All pre-write comparisons now reuse `validateOutputPaths`, including canonical, case and NFC checks. Regression fixtures assert refusal before any writes. |
| High | `verification-core.mjs` | Missing/unknown statuses counted as covered and could produce `coverage.complete: true`. Only `pass`, `below-target` and `below-minimum` now count as measured. Classified failures remain covered; coverage is not a passing verdict. |
| High | `verification-dom.mjs` | Outline contrast used the element's background even when the ring was painted outside it, over a different ancestor surface. Synthetic probes now place the outline inside; visible specimens check the actual surrounding backdrop and fail closed on mismatch, images, translucency or border overlap. Native regression covers outside, inside and partial-inset geometry. |
| Medium | `load-config.mjs` | A directory supplied as a file URL without trailing slash resolved to its parent. `fileURLToPath(root)` now preserves the intended directory. Tests cover config reads and init writes remaining inside that root. |
| Medium | `validate-config.mjs` | A public identity/decorative named `on-X` could redeclare the internal companion for `X`, silently changing generated colors. Validation now rejects these collisions before generation/writes. |
| Medium | `validate-config.mjs` | Non-array scale/hue lists could throw incidental iteration errors. Shape checks now produce validation diagnostics before dependent collision checks iterate them. |
| Medium | `browser-audit.mjs` | Legacy pair classification could return pass with missing or incoherent thresholds. It now applies the shared finite-positive/minimum-versus-target contract. |
| Medium | `browser-audit.mjs` | Audit report publication omitted the effective config/tuning paths. The captured tuning path is now assigned before analysis and protected even when analysis fails. An integration regression uses an owned report aliased by a custom tuning symlink and verifies the report bytes remain unchanged. |
| Medium | `report-data.mjs` | A partial state without browser-resolved neutral tokens crashed proposal generation. It now records an explicit rejection rather than dereferencing missing data. |
| Medium | `report-data.mjs` | Palette replacement counted or edited commented-out blocks; tuning token strings could be interpreted as regex syntax. Active-source matching now preserves offsets/comments and tuning tokens are validated and escaped. |
| Medium | `astro-integration.mjs` | Initial setup loaded config twice, allowing generation and watch registration to use different snapshots. Setup now passes the already-loaded validated config into generation, matching the watcher pattern. |
| Low–medium | `contrast-workbench-runtime.mjs` | No-op/reset/selection actions could clear an unavailable-payload diagnosis; successful suggestion/exploration actions could retain a stale prior action error. One local `settleError()` rule now recomputes payload/measurement errors consistently. |
| Low–medium | `contrast-workbench-view.mjs` | Comparison submit disabled its own focused trigger; a corrected L field retained its old invalid description; clearing picker filters left the category active; repeated override submits scheduled duplicate writes to the in-memory draft. Local focus handling, restored field descriptions, the existing filter-reset helper and a synchronous per-action pending flag address these cases. |
| Low | `validate-config.mjs` | A scale step represented as `1e+21` produced an invalid custom-property name. Such steps now fail validation instead of being interpolated into CSS. |
| Low | `parse-palette.mjs` | A final `dark-blend` descriptor without a semicolon was silently ignored despite being valid CSS. It is accepted at the block end; malformed missing separators still fail explicitly. |
| Low | `format-css.mjs` | A `*/` in a configured path terminated the generated header comment. Presentation-only escaping now keeps the comment intact without changing I/O paths. |
| Low | `init.mjs`, `report-data.mjs` | Invalid path types failed inside incidental string/path helpers. Diagnostics now name the offending input before resolution. Report capture also uses the shared resolver for URL roots. |
| Low | `browser-audit.mjs` | Measurement deadlines lost their structured timeout cause. That cause is retained, and cleanup timeout messages identify the failed close operation. |
| Low | `init.mjs` | Custom-tuning guidance could name a file build would not read, and its actionable text was truncated. Guidance now follows the actual resolver and remains concise. |
| Low | `diagnostic-runtime.mjs`, `contrast-workbench-runtime.mjs` | Run-trigger notifications discarded their reason; an empty export claimed a new root block had been created. Notifications preserve the trigger and export warnings describe the actual bytes. |
| Low | `format-report-html.mjs` | A chroma-only change with zero lightness delta was described as lighter. The text now distinguishes unchanged lightness. |

## Simplifications applied

- Reused the existing path-safety resolver in init instead of adding another canonical-path implementation.
- Reused the initial Astro config snapshot instead of importing the same config twice.
- Centralized workbench error settlement and reused picker filter reset.
- Removed unused private presenter/build-time helpers, unreachable CSS rules and write-only matrix focus state.
- Omitted redundant catalogue attributes and static matrix search/index attributes rebuilt before interaction is enabled. The runtime search/filter contracts remain tested.
- Removed a temporary test-only export during review: the publication regression now exercises the real caller and writer.
- Added a module ownership map and concrete maintenance rules to `CONTRIBUTING.md`.

The emitted preview budget was not raised and no comment stripper or custom minifier was introduced. Correctness guards were retained; savings came from dead code and redundant output.

## Security boundaries

- The config is trusted project ESM, executed with Node permissions. It is not a sandbox for untrusted configuration.
- Paths are protected against accidental source/output collisions, canonical aliases and owned-report replacement hazards. Read-check-write sequences are not an OS-level transaction or a defense against a hostile concurrent writer.
- The full report remains script-free under `script-src 'none'`. The preview hashes its exact emitted script bytes and uses isolated measurement frames with no required external assets.
- Labels, paths, snippets and inert JSON remain data. Regression coverage includes hostile script-closing content, HTML escaping and dynamic DOM construction.
- No direct project-saving endpoint, runtime dependency or new browser download was introduced.
- This review does not certify optional peer dependencies, upstream GitHub Actions or all browser accessibility behavior.

## Final validation

All commands ran after source edits settled.

| Check | Result |
| --- | --- |
| `pnpm colors:test` in the reference consumer | Package: 995 tests, 955 pass, 40 opt-in skips, zero failures. Consumer: 22 pass, zero failures. |
| Eight focused suites with `SMART_COLORS_NATIVE_PROOF=1` | 311 pass, zero skips/failures; includes real outline backdrop, workbench and emitted-page proofs. |
| Declaration-file TypeScript check | Passed during generation/API review. |
| `pnpm check` in the consumer | 219 files, zero errors/warnings, 86 non-blocking hints. Hints include existing backups and audit scripts. |
| `pnpm exec astro build` | Static build completed. No prebuild was invoked. |
| Generated preview in Chromium, WebKit and Firefox | Real initial exploration, edits, invalid L, reset focus and CSS download passed in every engine; 240 exploration rows; zero page/console errors or unhandled rejections. |
| HTML validator on preview + report | Zero findings under the documented static configuration. |
| HTML validator on nine captured runtime DOMs | Zero findings under the browser-serialization configuration. |
| Real preview size | 784266 bytes, below the unchanged 786432-byte budget; margin 2166 bytes. A new self-contained generated 16-source/scales fixture guards the package budget. |
| `git diff --check` | Passed. |
| Consumer palette, tuning and generated CSS | SHA-256 unchanged. Only diagnostic HTML was regenerated. |

Browser artifacts/logs are retained by the reference consumer in `reports/smart-colors-code-review/`; they are not package requirements. Static validation excludes doctype/native-role style conventions; runtime validation additionally excludes browser attribute-serialization conventions and the generic inline-style prohibition needed by color samples. Actual ID, attribute, ARIA and landmark checks remain active.

The root report was generated with `--automation=off`, so its build snapshot correctly remains unverified. Opening and testing the live preview does not relabel the whole snapshot or certify the site's accessibility. WebKit here means Playwright WebKit, not a manual Safari or screen-reader test.

## Remaining maintainability risks — not silently refactored

1. **Large browser modules.** The view is still over 4,000 lines, and the workbench controller over 2,000. Navigation is helped by the ownership map, but these are not yet easy modules for a new human maintainer. A future extraction should separate pure catalogue/markup, view rendering and event coordination behind existing contracts; it must preserve standalone factory serialization and exact CSP behavior. This needs a dedicated structural-refactor decision, not another helper layer added during a bug fix.
2. **Derived-token registry duplication.** Validation and formatting independently know scale/hue/family emission names. A shared emission registry would prevent future collision checks drifting from actual output. The recipe registry is already shared; it should remain the precedent.
3. **Parallel parsing/status conventions.** Palette source parsing and computed-color parsing intentionally accept different inputs, but numeric parsing and status/minimum rules overlap. Consolidation needs explicit grammar boundaries and contract tests, not a blanket parser replacement.
4. **Diagnostics coupled to display strings.** Some advisory regression checks parse warning text. Structured diagnostics should be preferred when that contract is deliberately revised; changing output shapes was not smuggled into this review.
5. **Repeated CLI option branches.** A data-driven option table could shorten `parseArgs`, but a generic parser abstraction is not automatically simpler. Preserve tested precedence/errors if this is changed later.
6. **Legacy audit path.** `projectAudit` remains a separate exported orchestration path with older lifecycle behavior, including an unbounded browser close. The main workflow has deadline-based cleanup. Consolidation/deprecation needs an API decision and integration coverage.
7. **Error attribution and concurrency hardening.** Proposal generation currently labels any thrown solver error as a budget exhaustion; late browser cleanup can append diagnostics after a returned run. These remain diagnostic/lifecycle risks, not a claim of a reproduced false pass with valid current inputs. Multi-file writes and capture/accept operations still have ordinary read-check-write race windows.
8. **Ambiguous annotated source names.** `--palette-x` and `--x` can map to the same public name with deterministic last-annotated-wins behavior. The current review did not redefine that public convention. An explicit policy and test would make it easier to understand.
9. **Tight root byte margin.** The complete consumer artifact still has only about 2 KiB of headroom. Continue measuring a representative emitted artifact, not just small synthetic formatter fixtures. Never remove validation to meet this budget.

Valid existing configurations keep their token API and output. Previously ambiguous internal-name collisions, malformed list shapes and steps that cannot form CSS identifiers now fail before writing; affected configurations need an explicit author correction, not an automatic rename.
