import { Field } from "./Field";
const histories = ["clickScores", "densityHistory", "mineCountHistory", "openedCountHistory", "detonatedCountHistory"] as const;
type HistoryName = typeof histories[number];
export type SaveDelta = {
  cells: [number, number, number][];
  histories: Partial<Record<HistoryName, {start: number; values: number[]}>>;
  metadata: Record<string, unknown>;
};
/** Append-only histories and coalesced cell changes since the last checkpoint. */
export class SaveDeltaTracker {
  private dirty = new Map<string, {x: number; y: number}>();
  private lengths = new Map<HistoryName, number>();
  constructor(private field: Field) {
    field.on("cellStored", (cell: {x: number; y: number}) => this.dirty.set(`${cell.x},${cell.y}`, cell));
  }
  baseline() {
    this.dirty.clear();
    for (const name of histories) this.lengths.set(name, this.field[name].length);
  }
  capture() {
    const dirty = this.dirty; this.dirty = new Map();
    const delta: SaveDelta = {cells: [], histories: {}, metadata: {}};
    for (const {x, y} of dirty.values()) {
      const value = this.field.cellData.numberStorage.get(x, y);
      if (value !== null) delta.cells.push([x, y, value]);
    }
    for (const name of histories) {
      const start = this.lengths.get(name) ?? 0;
      if (this.field[name].length !== start) delta.histories[name] = {start, values: this.field[name].slice(start)};
    }
    for (const name of ["score", "pristine", "gameOver", "densityStartClick", "mineCountStartClick", "openedCountStartClick", "detonatedCountStartClick"] as const)
      delta.metadata[name] = this.field[name];
    return {
      delta,
      commit: () => {for (const name of histories) {
        const part = delta.histories[name];
        if (part) this.lengths.set(name, part.start + part.values.length);
      }},
      rollback: () => {for (const [key, point] of dirty) if (!this.dirty.has(key)) this.dirty.set(key, point);},
    };
  }
}
export function applySaveDelta(target: any, delta: SaveDelta) {
  const data = target.cellData.numberStorage.data;
  for (const [x, y, value] of delta.cells) (data[x] ??= {})[y] = value;
  for (const name of histories) {
    const part = delta.histories[name];
    if (!part) continue;
    const values: number[] = target[name] ??= [];
    values.length = part.start;
    // Avoid argument-count limits on large append batches.
    for (const value of part.values) values.push(value);
  }
  Object.assign(target, delta.metadata);
}
