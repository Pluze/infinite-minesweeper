# Infinite Minesweeper · Auto Explorer

[Play online](https://pluze.github.io/infinite-minesweeper/) · [Validation](https://github.com/Pluze/infinite-minesweeper/actions/workflows/ci.yml) · [Deployment](https://github.com/Pluze/infinite-minesweeper/actions/workflows/pages.yml)

An infinite Minesweeper game with automatic exploration, probability overlays, and live statistics. This fork builds on [Zikoat/infinite-minesweeper](https://github.com/Zikoat/infinite-minesweeper), originally based on borbit's mienfield.com.

## Run locally

Install Node.js 18 or newer, then run:

```sh
npm ci
npm start
```

Open http://127.0.0.1:5173. On macOS, you can also double-click `start.command`; it installs dependencies if needed. Press Ctrl+C in the terminal to stop the server. The optional local `.runtime` directory is not distributed with this repository.

## Controls

- **Space:** toggle auto-play. A new tab, manual refresh, or new game begins paused.
- **Speed:** powers of two from 1 to 65,536 operations per second. The actual rate is displayed separately.
- **Probability overlay:** toggle risk markers; hold **F** to temporarily invert visibility.
- **Pan:** scroll with two fingers or drag the board with the left or middle mouse button.
- **Zoom:** use a mouse wheel, pinch on a trackpad or touchscreen, or scroll while holding Ctrl or Command.
- **Open or flag:** left click or tap to open. Right click or hold a finger on the board to flag.
- **Auto-pan:** follow operations near the screen edge, preserving zoom. Manual camera input temporarily takes priority.
- **Background play:** an active game keeps using the selected click speed when you switch tabs. Browsers can throttle or suspend hidden tabs, especially on mobile. Play resumes after a freeze or a browser-reported tab discard if it was running beforehand.
- **Pause before guessing:** exhaust known deterministic moves across the board before pausing ahead of a risky move.
- **Mobile:** playback stays in a compact bar. Open Controls for settings; the bottom chart buttons show one chart at a time. Hidden charts skip rendering.
- **Menu:** start a new game or enter fullscreen.

## Exploration and visualization

The planner exhausts known deterministic moves before allowing any guess, regardless of the pause-before-guessing setting. Internal joint deductions take precedence over exterior simple moves. It prioritizes enclosed unknown islands among deterministic moves, then uses the current connected region's centroid, concavity, and local topology to rank moves. At equal risk and island priority, it continues through the active 24 × 24 region before moving elsewhere. These are geometric preferences, not a guarantee that board topology stays unchanged.

Nearby observed mine density adjusts the base prior using weighted 8 × 8 buckets in a 3 × 3 neighborhood, with 64 virtual observations for smoothing. Only opened cells and flags contribute; hidden mines are never sampled. This is an empirical heuristic affected by safe-cell selection bias and incorrect flags.

When a guess is necessary, bounded constraint enumeration estimates mine probabilities without inspecting hidden mine states. Large or expensive components use bounded sequential importance sampling of legal layouts (up to 128 variables and 256 attempts per component), with effective-sample-size checks and a smoothed fallback. Exact enumeration receives a 6 ms search budget and sampling uses the remaining 12 ms budget within each recomputed partition; these are cooperative search limits, not a hard limit on total snapshot time. Sampled probabilities remain approximate and never prove a cell safe. Symmetric single-clue components use an analytic solution. The single-cell expected score is `1 − 101 × mine probability`; cascade rewards are not included. Flags are assumed to be mines, so incorrect flags affect inference.

Probability labels remain visible at every click speed when a cell is at least 26 screen pixels wide; zoomed-out views use colors to avoid overlapping text. Bright cyan marks safe cells and bright pink-red marks mines. Overview mode uses high-contrast markers instead of crowded labels. Hover for probability details. Rendering follows the board camera on the same frame, while inference is updated separately with a bounded budget.

The bottom-left chart shows `(revealed mines + flags) / (opened cells + unopened flagged cells)`. The bottom-right chart shows `score / opened cells` (mint, left axis), overlaid with `detonated mines / known mines` (orange dashed line, right percentage axis). Known mines are revealed mines plus unopened flagged cells; a mine is counted once. Opened cells include revealed mines and exclude unopened flags. Both charts offer all history, 100k, 10k, and 1k clicks. A zero denominator displays a dash.

## Saves and performance

Board progress and recorded history are saved to IndexedDB, with migration from older localStorage saves. Settings remain in localStorage. History downsampling is not applied. Manual import/export is not available. Clearing browser data deletes the local save. After an initial checkpoint, saves append changed cells and new history samples to an IndexedDB journal. Reloading restores the checkpoint and journal through a cursor. Every 128 journal writes, a background worker compacts the captured prefix without removing newer writes; failed compaction leaves the journal intact. Saves are batched while playing and flushed on pause or page visibility changes; an abrupt browser exit can lose recent progress. Historical metrics missing from older saves begin recording when available rather than fabricating past values.

Incremental frontier queues, connected-component maintenance, cached constraint groups, chunked overview rendering, lazy detail sprites, and batched saves reduce work on large boards. Fast play simplifies effects without capping board rendering FPS. Auto-pan uses edge thresholds, region dwell time, cooldowns, and a temporary hold after manual camera input to reduce oscillation.

**65,536 is a requested rate, not a throughput guarantee.** Large-board performance still depends on inference cost and hardware.

## Development

```sh
npm run typecheck
npm run test:run
npm run build
```

The production build is written to `dist/`. To run the browser tests with Node.js 20 or newer:

```sh
npx playwright install chromium
npm run test:browser
```

To replay a JSON board fixture in the optional solver benchmark:

```sh
PERF_BOARD=/absolute/path/board.json npm run test:run -- src/Performance.test.ts
```

This benchmark excludes browser rendering and is not equivalent to the live actual-rate display. See [the local guide](LOCAL-GUIDE.md) for scoring and behavior details.

Built with TypeScript, Pixi.js, Vite, D3 zoom, and GreenSock. Original authorship and MIT license metadata are retained.

## GitHub Actions

The Validate workflow checks pull requests. Every push to `master` runs the same type checks, unit tests, production build, and browser tests in the Pages workflow before publishing `dist/`; validation is not duplicated across two push workflows.

### Publish your own fork

1. Fork this repository and enable GitHub Actions under the **Actions** tab if GitHub prompts you.
2. Open **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Push a commit to `master`, or open **Actions → Deploy to GitHub Pages → Run workflow**.
4. Wait for the deployment to succeed. Your URL is `https://<username>.github.io/<repository>/`; the deployment job also shows the exact URL.

Vite builds with relative asset paths, so the site works under a repository subpath as well as at a domain root. This is a static client-side application; no API keys or backend server are needed.

If deployment fails, check the workflow's failed step, confirm Pages uses **GitHub Actions**, and confirm Actions is enabled for the fork. Changes to the default branch name must also be reflected in both workflow triggers.

Online and local games have separate browser storage because they use different origins. Clearing site data removes that site's saves. A Pages deployment updates the application, not your saved board.

The macOS launcher reopens an existing Infinite Minesweeper development server on port 5173. If a different service occupies the port, it reports the conflict without stopping that service.


## Implementation and validation limits

Clue changes invalidate their 3 × 3 neighborhood. Constraint components follow shared unknown cells, including dependencies across spatial boundaries; unchanged components reuse cached deductions and probabilities. Enclosed unknown regions use row intervals, and candidate queues update incrementally. All known deterministic moves are checked before guessing.

The live rate counts executed board operations, which are not the same as opened cells. A chord or flood fill can open many cells in one operation. A short early-game rate does not establish sustained million-cell throughput. The latest large-board browser check fell below 10,000 operations/s; this target remains unmet. See [the consolidation audit](AUDIT.md) for the retained changes and open issues.

Optional diagnostic tests accept JSON board fixtures:

```sh
ABLATION_BOARD=/absolute/path/board.json npm run test:run -- src/Ablation.test.ts
PARTITION_BOARD=/absolute/path/board.json npm run test:run -- src/PartitionBenchmark.test.ts
```

These measure solver variants and dependency maintenance without rendering, persistence, or browser scheduling. Ablations that disable island priority change behavior and are not equivalent optimizations. They are diagnostic tools, not acceptance results for live throughput.

### Long-running sessions

Offscreen detailed sprites are released and reconstructed from the unchanged board when revisited. The overview palette and probability algorithm are unchanged. Probability-update queues are capped while the overlay is hidden; reopening it performs a complete frontier synchronization instead of replaying an unbounded queue. Worker coordinate caches retain only active frontier cells.

When the browser exposes heap telemetry, auto-play pauses after two consecutive readings above 85% of the heap limit (or immediately above 95%) and requests the normal save flush. The status explains the memory-pressure pause. This is a best-effort safeguard, not a guarantee against process crashes or total system memory exhaustion; browsers without this telemetry continue normally.

### Mobile memory safety

Automatic pauses for memory use the browser's reported JavaScript heap.
Browsers without that reading, including iOS Edge, continue automatic play
without a fixed cell or click count. Large boards still depend on how much
memory the browser and operating system make available.

Mobile saves keep incremental journals without background full-board compaction,
which would otherwise reconstruct an additional board in a worker. Statistics
derive changes from the board state instead of retaining two additional per-cell
lookup maps. Real-device iOS crash validation remains necessary.

### Loading

Startup reports its current stage and measured record/cell progress. Large
statistics, clue indexes and drawing preparation yield to input in bounded
batches. The loading screen's **Start new game** cancels restoration, clears
the current save and camera transform, then reloads at the initial board.
Other preferences are retained. Console `[load]` entries report stage timings.
Displayed integer counts use comma grouping regardless of browser locale.
