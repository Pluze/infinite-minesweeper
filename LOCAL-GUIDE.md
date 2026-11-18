# Local play and implementation notes

## Startup

Use `npm ci` followed by `npm start`, or run `./start.command` on macOS. The launcher uses the optional local Apple Silicon Node.js runtime if present; otherwise it uses Node.js from PATH. Dependencies require network access on the first installation. The server binds to 127.0.0.1:5173 and refuses to silently switch ports.

## Scoring and history

- Opening a safe cell adds 1 point; revealing a mine subtracts 100 points.
- Flags do not award points.
- Each recorded manual or automatic board operation contributes a history point, including operations with no score change. The initial board is the baseline.
- `Score ÷ opened cells` measures points per opened cell. It is undefined until at least one cell is open.
- Chart sampling preserves extrema for display while retaining the underlying recorded history. Selecting a recent window follows the newest operation.
- Starting a new game resets the board and history. Older saves cannot recover metrics that were never recorded.

## Solver policy

Deterministic clue operations use the original game's flagging and expansion rules. Enclosed islands are identified by the connectivity of unknown cells to the exterior. Concavities are not necessarily enclosed islands. Filling a hole itself changes topology, and cascades can also change the explored outline.

The planner checks internal deterministic moves first, then exterior and global deterministic moves before any guess. **Pause before guessing** pauses when these checks find no safe move; otherwise probabilistic selection follows. This is not a proof that no stronger mathematical deduction exists.

Small constraint components are enumerated with a smoothed local-density prior. Enumeration is bounded by variable count, node count, and time; approximate results are identified with `≈`. Unconstrained cells use the same local prior. Nearby buckets are weighted by distance and shrunk toward the base rate with 64 virtual observations; the prior is clamped to 1–99%. Exact deductions retain 0% or 100%. Local density is an empirical heuristic, not a guarantee of improved calibration: safe-cell selection and incorrect flags can bias it. No probability estimate guarantees safety unless it is an exact deduction under valid flag assumptions.

## Camera and rendering

Auto-pan only triggers near the outer 5% of the viewport. It uses cubic ease-out, keeps the current zoom, and respects reduced-motion preferences. Existing camera animations are allowed to finish rather than being retargeted by each click. Fast play requires sustained activity in a region before following it, with a cooldown between moves. Manual camera input interrupts the animation and suspends following for 1.5 seconds.

Auto-click flashes are simplified at high speed and when zoomed out. Overview rendering uses chunk textures; detailed sprites are created only when visible at an appropriate zoom. The board frame rate is not capped. Probability inference and chart drawing have separate update budgets; camera alignment is updated with the board frame.

## Persistence and diagnostics

Saves use IndexedDB, while camera and control settings use localStorage. Manual import/export is not available. A save failure pauses auto-play; the browser console contains diagnostic details. Page hiding also pauses auto-play.

The actual operations-per-second display counts executed operations, not scheduled requests. The optional `PERF_BOARD` test measures solver throughput without rendering. Results vary with the board, future generated cells, browser, and machine; they should not be presented as guaranteed live throughput.

The macOS launcher reopens an existing Infinite Minesweeper development server on port 5173. If a different service occupies the port, it reports the conflict without stopping that service.


The right chart now always plots score divided by opened cells. Its orange dashed overlay is detonated mines divided by known mines (revealed mines plus unopened flagged cells), with a separate percentage axis. Missing detonation history in older saves starts at the current click; it is not backfilled.
