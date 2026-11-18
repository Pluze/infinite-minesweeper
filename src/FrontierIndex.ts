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
  constructor(private field: Field) {
    for (const cell of field.getAll()) {
      if (cell.isOpen || cell.isFlagged)
        this.known.set(keyOf(cell.x, cell.y), cell);
      if (cell.isOpen && !cell.isMine)
        this.dirty.set(keyOf(cell.x, cell.y), cell);
    }
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
  public refresh() {
    for (const [key, pos] of this.dirty) {
      const oldRow = this.rows.get(pos.y);
      oldRow?.delete(key);
      if (oldRow && !oldRow.size) this.rows.delete(pos.y);
      this.changedEntries.add(key);
      const cell = this.field.getCell(pos.x, pos.y);
      if (!cell.isOpen || cell.isMine) {
        this.entries.delete(key);
        continue;
      }
      const neighbors = this.field.getNeighbors(cell.x, cell.y);
      const unknown = neighbors.filter((n) => !n.isOpen && !n.isFlagged);
      if (!unknown.length) {
        this.entries.delete(key);
        continue;
      }
      // Reuse the neighbors already read above. Legacy saves may omit generated
      // neighbors, so a forever-cached value can become stale when they appear.
      const value = neighbors.reduce((sum, cell) => sum + Number(!!cell.isMine), 0);
      const known = neighbors.filter(
        (n) => n.isFlagged || (n.isOpen && n.isMine),
      ).length;
      this.entries.set(key, { cell, unknown, remaining: value - known });
      let row = this.rows.get(cell.y);
      if (!row) this.rows.set(cell.y, row = new Set());
      row.add(key);
    }
    this.dirty.clear();
    return this.entries;
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
