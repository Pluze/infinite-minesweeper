import { LoadBudget } from "./LoadingScreen";
import { Field } from "./Field";
import { Cell } from "./Cell";
export const keyOf = (x: number, y: number) => `${x},${y}`;
export type FrontierEntry = { cell: Cell; unknown: Cell[]; remaining: number };

/** Maintain only clues touched by a cell change, not the entire explored board. */
export class FrontierIndex {
  public readonly known = new Map<string, Cell>();
  public readonly entries = new Map<string, FrontierEntry>();
  public revision = 0;
  public rows = new Map<number, Set<string>>();
  public changedEntries = new Set<string>();
  private dirty = new Map<string, { x: number; y: number }>();
  constructor(private field: Field, deferred = false) {
    if (!deferred) for (const cell of field.cellData.cells()) this.seed(cell);
    // Older saves can contain opened clues with ungenerated neighbors. Notify
    // all consumers when generating one changes an already-visible number.
    field.on("mineGenerated", ({x, y}: {x: number; y: number}) => {
      for (const [dx, dy] of field.neighborPosition) {
        const clue = this.known.get(keyOf(x + dx, y + dy));
        if (clue?.isOpen && !clue.isMine) {
          field.emit("clueValueChanged", clue);
          field.emit("cellChanged", clue);
        }
      }
    });
    field.on("cellChanged", (cell: Cell) => {
      const key = keyOf(cell.x, cell.y);
      if (cell.isOpen || cell.isFlagged) this.known.set(key, cell);
      else this.known.delete(key);
      this.revision++;
      this.dirty.set(key, cell);
      for (const [dx, dy] of field.neighborPosition) {
        const x = cell.x + dx,
          y = cell.y + dy;
        this.dirty.set(keyOf(x, y), { x, y });
      }
    });
  }
  private seed(cell: Cell) {
    if (cell.isOpen || cell.isFlagged) this.known.set(keyOf(cell.x, cell.y), cell);
    if (cell.isOpen && !cell.isMine) this.dirty.set(keyOf(cell.x, cell.y), cell);
  }
  public async initialize(signal: AbortSignal, progress: (done: number, phase: string) => void) {
    let done = 0; const budget = new LoadBudget();
    // The restored board is immutable until startup finishes: seed each clue
    // directly, without building a second map containing every interior cell.
    for (const cell of this.field.cellData.cells()) {
      const key = keyOf(cell.x, cell.y);
      if (cell.isOpen || cell.isFlagged) this.known.set(key, cell);
      if (cell.isOpen && !cell.isMine) this.refreshEntry(key, cell);
      if (++done % 2000 === 0 && budget.due()) {
        signal.throwIfAborted(); progress(done, "Indexing clues"); await budget.yield();
      }
    }
    signal.throwIfAborted();
  }
  public refresh() {
    for (const [key, pos] of this.dirty) this.refreshEntry(key, pos);
    this.dirty.clear();
    return this.entries;
  }
  private refreshEntry(key: string, pos: {x: number; y: number}) {
      const oldRow = this.rows.get(pos.y);
      oldRow?.delete(key);
      if (oldRow && !oldRow.size) this.rows.delete(pos.y);
      if (this.entries.has(key)) this.changedEntries.add(key);
      const cell = this.field.getCell(pos.x, pos.y);
      if (!cell.isOpen || cell.isMine) {
        this.entries.delete(key);
        return;
      }
      const neighbors = this.field.getNeighbors(cell.x, cell.y);
      const unknown = neighbors.filter((n) => !n.isOpen && !n.isFlagged);
      if (!unknown.length) {
        this.entries.delete(key);
        return;
      }
      // Reuse the neighbors already read above. Legacy saves may omit generated
      // neighbors, so a forever-cached value can become stale when they appear.
      const value = neighbors.reduce((sum, cell) => sum + Number(!!cell.isMine), 0);
      const known = neighbors.filter(
        (n) => n.isFlagged || (n.isOpen && n.isMine),
      ).length;
      this.changedEntries.add(key);
      this.entries.set(key, { cell, unknown, remaining: value - known });
      let row = this.rows.get(cell.y);
      if (!row) this.rows.set(cell.y, row = new Set());
      row.add(key);

  }
}
const indexes = new WeakMap<Field, FrontierIndex>();
export function frontierIndex(field: Field) {
  let index = indexes.get(field);
  if (!index) {
    index = new FrontierIndex(field);
    indexes.set(field, index);
  }
  return index;
}

export async function prepareFrontier(field: Field, signal: AbortSignal, progress: (done: number, phase: string) => void) {
  if (indexes.has(field)) return;
  const index = new FrontierIndex(field, true);
  await index.initialize(signal, progress);
  indexes.set(field, index);
}
