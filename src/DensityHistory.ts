import { LoadBudget } from "./LoadingScreen";
import { Field } from "./Field";
import { Observation, observeCell } from "./Cell";

/** Counts only revealed mines and flags, never hidden mine state. */
function* initializeDensity(field: Field) {
  let area = 0,
    mines = 0,
    opened = 0,
    detonated = 0;
  const update = (before: number, after: number) => {
    area += Number(after !== 0) - Number(before !== 0);
    const knownMine = Observation.Flagged | Observation.Detonated;
    mines += Number(!!(after & knownMine)) - Number(!!(before & knownMine));
    detonated +=
      Number(!!(after & Observation.Detonated)) -
      Number(!!(before & Observation.Detonated));
    opened +=
      Number(!!(after & Observation.Open)) -
      Number(!!(before & Observation.Open));
  };
  let processed = 0;
  for (const cell of field.cellData.cells()) {
    update(0, observeCell(cell));
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
  field.on(
    "observationChanged",
    (_x: number, _y: number, before: number, after: number) =>
      update(before, after),
  );
  field.on("clickRecorded", () => {
    field.densityHistory.push(density());
    field.mineCountHistory.push(mines);
    field.detonatedCountHistory.push(detonated);
    field.openedCountHistory.push(opened);
  });
}

export function trackDensity(field: Field) {
  for (const _processed of initializeDensity(field)) {
    /* Synchronous callers. */
  }
}
export async function trackDensityAsync(
  field: Field,
  signal: AbortSignal,
  progress: (done: number) => void,
) {
  const budget = new LoadBudget();
  for (const processed of initializeDensity(field)) {
    signal.throwIfAborted();
    if (budget.due()) {
      progress(processed);
      await budget.yield();
    }
  }
  signal.throwIfAborted();
}
