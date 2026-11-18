import { LoadBudget } from "./LoadingScreen";
import { Field } from "./Field";
import { Cell } from "./Cell";

/** Counts only revealed mines and flags, never hidden mine state. */
function* initializeDensity(field: Field) {
  const cells = new Map<string, number>();
  let area = 0,
    mines = 0,
    opened = 0,
    detonated = 0;
  const update = (cell: Cell) => {
    const key = `${cell.x},${cell.y}`;
    const before = cells.get(key) ?? 0;
    const after =
      cell.isOpen || cell.isFlagged
        ? (cell.isFlagged || cell.isMine === true ? 2 : 1) |
          (cell.isOpen ? 4 : 0) |
          (cell.isOpen && cell.isMine === true ? 8 : 0)
        : 0;
    area += Number(after > 0) - Number(before > 0);
    mines += Number((after & 2) !== 0) - Number((before & 2) !== 0);
    detonated += Number((after & 8) !== 0) - Number((before & 8) !== 0);
    opened += Number((after & 4) !== 0) - Number((before & 4) !== 0);
    if (after) cells.set(key, after);
    else cells.delete(key);
  };
  let processed = 0;
  for (const cell of field.cellData.cells()) {
    update(cell);
    if (++processed % 2000 === 0) yield processed;
  }
  const density = () => (area ? mines / area : 0);
  if (!Array.isArray(field.densityHistory) || !field.densityHistory.length) {
    field.densityStartClick = Math.max(0, field.clickScores.length - 1);
    field.densityHistory = [density()];
  }
  if (
    !Array.isArray(field.mineCountHistory) ||
    !field.mineCountHistory.length
  ) {
    field.mineCountStartClick = Math.max(0, field.clickScores.length - 1);
    field.mineCountHistory = [mines];
  }
  if (
    !Array.isArray(field.openedCountHistory) ||
    !field.openedCountHistory.length
  ) {
    field.openedCountStartClick = Math.max(0, field.clickScores.length - 1);
    field.openedCountHistory = [opened];
  }
  if (
    !Array.isArray(field.detonatedCountHistory) ||
    !field.detonatedCountHistory.length
  ) {
    field.detonatedCountStartClick = Math.max(0, field.clickScores.length - 1);
    field.detonatedCountHistory = [detonated];
  }
  field.on("cellChanged", update);
  field.on("clickRecorded", () => {
    field.densityHistory.push(density());
    field.mineCountHistory.push(mines);
    field.detonatedCountHistory.push(detonated);
    field.openedCountHistory.push(opened);
  });
}

export function trackDensity(field: Field) {
  for (const _processed of initializeDensity(field)) { /* Synchronous callers. */ }
}
export async function trackDensityAsync(field: Field, signal: AbortSignal, progress: (done: number) => void) {
  const budget = new LoadBudget();
  for (const processed of initializeDensity(field)) {
    signal.throwIfAborted(); if (budget.due()) {progress(processed); await budget.yield();}
  }
  signal.throwIfAborted();
}
