# Fork consolidation audit — 2026-11-17

## Baseline and scope

Upstream/fork point: `556a8dc`. Reviewed published tip: `0bcf4c3`.
The 15 fork commits are consolidated into one commit whose parent is the fork
point. Upstream history and authorship remain intact.

The accepted visual baseline is `19bd779`, with the mobile overlap correction
`d447823` and resource-lifetime safeguards `0bcf4c3`. This consolidation does
not change board colors, probability presentation, camera behavior, inference
policy, save format, or the loading sequence.

## Decisions on every fork commit

| Commit | Decision and reason |
| --- | --- |
| `a6c1041` | Keep automatic play, controls, statistics, frontier planning, overview textures and batched saves: these implement the fork's purpose. Keep regression tests and npm lockfile. |
| `fcbbfb3` | Keep current local-density prior to preserve the accepted solver behavior; document that it is a biased heuristic, not a number-derived certainty. |
| `e627d4f` | Keep bounded legal-layout sampling and validation. Sampling is approximate and never establishes safety. |
| `13edc44` | Keep automatic Pages deployment. Remove redundant second validation on the same master push. |
| `593e318` | Keep subset constraint reduction and import-menu fix. Reduction supplies useful deterministic deductions. |
| `fddead5` | Keep launcher reuse/conflict handling; it avoids duplicate local servers. |
| `57ea9e0` | Keep exact island classification reuse, component-focused inference, coalesced visual events and chart indexes. Keep ablation tooling, remove dated microbenchmark sales claims from README. |
| `03c33e7` | Keep safe-only inference before pause: sampling is unnecessary when the policy forbids guesses. |
| `ad96e97` | Keep the shared estimator and background overlay worker; moving UI inference off the main thread is valuable. |
| `a76d8c7` | Keep incremental dependency partitions and detonation ratio history. Remove unused focused-proof group references. |
| `41c5dd3` | Keep global deterministic search before guessing, even with pause disabled. Internal joint deductions retain priority. |
| `5f5259d` | Keep compact mobile controls, incremental frontier/focus tracking, lossless archive and IndexedDB journal. Remove obsolete class-transformer decorators/dependencies now that hydration is explicit. |
| `19bd779` | Keep accepted persistent probability display and overview markers unchanged. |
| `d447823` | Keep mobile menu stacking, scrolling and mutually exclusive control panels. |
| `0bcf4c3` | Keep offscreen sprite disposal, bounded hidden-overlay queues, worker-cache pruning and optional heap-pressure pause. These are safeguards, not proof that all crashes are fixed. |

Also replace broken legacy `uvu`/`tsm` test commands and the mutating multi-tool
`check` script with the existing Vitest/validation commands. Remove two obsolete JSON snapshots that no test reads. No new framework
or solver is introduced.

## Excluded work

Uncommitted experiments in the original worktree (exact-probability worker,
windowed analysis, hole outlines, rendering/loading rewrites and other trial
optimizations) are not included. The separate stability worktree's three
uncommitted hot-path changes are also excluded: they have not passed a sustained
million-cell browser benchmark. Both working directories remain intact so no
uncommitted work is destroyed.

## Current state and unresolved issues

- **Throughput remains below target.** A browser run reached score 2,320,148,
  1,287,881 recorded operations, with score/opened approximately 1.000. Late
  instantaneous rates were about 7,475–7,868 operations/s. Probability visibility
  changed during the run, so it is not a valid sustained all-overlay-on benchmark.
  Earlier 15,000/s readings around 400,000 operations are not acceptance evidence.
- **Acceptance still needed:** start with at least one million opened cells;
  keep probability overlay enabled and normal rendering/saving active; measure
  actual operation deltas over at least 60 seconds and report successive windows,
  not only the instantaneous label. Target: sustained >10,000 operations/s.
- **Probability is not universally exact.** Small components use exact bounded
  enumeration; larger components can use sampling/fallback and unconstrained
  cells use a local prior. Known flags are assumptions. A cached display can lag
  changed clues while the worker updates. This audit does not silently change the
  accepted behavior or claim the earlier exact-everywhere request was achieved.
- **Long-run memory is not bounded overall.** Board cells, recorded histories,
  connected-region data and some coordinate indexes still grow with exploration.
  Visual-cache disposal only removes avoidable retention. Heap telemetry is
  browser-dependent, and an automatic pause cannot guarantee an asynchronous save
  finishes before a process crash.
- **Large saves still need profiling.** Startup reconstructs several indexes,
  textures and full-board arrays; full history is retained by design. These are
  likely scaling costs, not measured attribution. No speculative loading rewrite
  is included.
- **Remaining performance suspects:** topology rebuilds, complete frontier
  serialization for worker responses, whole-board initialization and append-only
  history indexes. Profile these at million-cell scale before changing algorithms.

## Verification and recovery

Run `npm run check` for type checking, regression tests and production build.
Retained tests cover deterministic move ordering, stale dependency invalidation,
worker reset, saved-board round trips, mobile-related rendering policy, sprite
release and pressure thresholds. Unit tests are not a long-run browser benchmark.

Before rewriting history, the full original Git history was saved in the local
`archive/pre-squash-20261117` branch and a Git bundle outside this worktree. Remote
replacement must use a lease against the reviewed tip to avoid overwriting a
concurrent contributor's changes.

Consolidated-tree validation: `npm run check` passed (118 tests passed,
3 external-board diagnostic tests skipped), including type checking and the
production build. `git diff --check` passed. Rendering, overlay, estimator,
loading, camera and mobile-layout implementation files match `0bcf4c3`.
The existing bundle-size warning remains; it is not a new runtime failure.
