import { CellFocus } from "./CellFocus";
import { Field } from "./Field";
import { Cell } from "./Cell";
import { frontierIndex, FrontierEntry } from "./FrontierIndex";
import { boardGeometry } from "./BoardGeometry";
type Point = { x: number; y: number };
export const regionKey = (p: Point) =>
  `${Math.floor(p.x / 24)},${Math.floor(p.y / 24)}`;
type Candidate = {
  key: string;
  entry: FrontierEntry;
  island: number;
  weight: number;
  distance: number;
};
const before = (a: Candidate, b: Candidate) =>
  a.island !== b.island
    ? a.island > b.island
    : Math.abs(a.weight - b.weight) > 1e-9
      ? a.weight < b.weight
      : a.distance < b.distance;
class MovePlanner {
  private heap: Candidate[] = [];
  private latest = new Map<string, Candidate>();
  private islands = new Set<string>();
  private focus = new CellFocus();
  private focusRefs = new Map<string, number>();
  private clueFocus = new Map<string, string[]>();
  private regionHeaps = new Map<string, Candidate[]>();
  private activeRegion?: string;
  private lastMove?: string;
  private version = -1;
  constructor(private field: Field) {}
  private push(value: Candidate, heap = this.heap) {
    let i = heap.length;
    heap.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(value, heap[parent])) break;
      heap[i] = heap[parent];
      i = parent;
    }
    heap[i] = value;
  }
  private pop(heap = this.heap) {
    const last = heap.pop();
    if (!heap.length || !last) return;
    let i = 0;
    while (i * 2 + 1 < heap.length) {
      let child = i * 2 + 1;
      if (child + 1 < heap.length && before(heap[child + 1], heap[child]))
        child++;
      if (!before(heap[child], last)) break;
      heap[i] = heap[child];
      i = child;
    }
    heap[i] = last;
  }
  islandFocus() { return this.focus; }
  private updateFocus(key: string, cells: string[]) {
    const old = this.clueFocus.get(key) ?? [];
    for (const cell of old) if (!cells.includes(cell)) {
      const count = this.focusRefs.get(cell)! - 1;
      if (count) this.focusRefs.set(cell, count);
      else { this.focusRefs.delete(cell); this.focus.delete(cell); }
    }
    for (const cell of cells) if (!old.includes(cell)) {
      this.focusRefs.set(cell, (this.focusRefs.get(cell) ?? 0) + 1);
      this.focus.add(cell);
    }
    if (cells.length) this.clueFocus.set(key, cells);
    else this.clueFocus.delete(key);
  }
  select(near: Point, restrict: boolean): Cell | undefined {
    const index = frontierIndex(this.field),
      entries = index.refresh(),
      geometry = boardGeometry(this.field);
    geometry.prepare(near);
    if (this.lastMove && this.lastMove !== `${near.x},${near.y}`)
      this.activeRegion = regionKey(near);
    const add = (key: string) => {
      const entry = entries.get(key);
      this.latest.delete(key);
      this.islands.delete(key);
      const focused = (entry?.unknown ?? []).filter(cell => geometry.islandPriority([cell])).map(cell => `${cell.x},${cell.y}`);
      this.updateFocus(key, focused);
      if (!entry) return;
      const island = focused.length ? (focused.length === entry.unknown.length ? 2 : 1) : 0;
      if (island) this.islands.add(key);
      if (entry.remaining !== 0 && entry.remaining !== entry.unknown.length)
        return;
      const candidate = {
        key,
        entry,
        island,
        weight: geometry.rank(entry.unknown),
        distance: (entry.cell.x - near.x) ** 2 + (entry.cell.y - near.y) ** 2,
      };
      this.latest.set(key, candidate);
      this.push(candidate);
      const region = regionKey(entry.cell);
      let heap = this.regionHeaps.get(region);
      if (!heap) {
        heap = [];
        this.regionHeaps.set(region, heap);
      }
      this.push(candidate, heap);
    };
    if (
      (this.version !== geometry.version && geometry.islandChanges?.from !== this.version) ||
      this.heap.length > entries.size * 4 + 256
    ) {
      this.version = geometry.version;
      this.heap = [];
      this.latest.clear();
      this.regionHeaps.clear();
      this.islands.clear();
      this.focus.clear();
      this.focusRefs.clear();
      this.clueFocus.clear();
      for (const key of entries.keys()) add(key);
    } else {
      if (this.version !== geometry.version) {
        const affected = new Set(index.changedEntries);
        for (const y of geometry.islandChanges!.rows)
          for (let dy = -1; dy <= 1; dy++)
            for (const key of index.rows.get(y + dy) ?? []) affected.add(key);
        for (const key of affected) add(key);
        this.version = geometry.version;
      } else for (const key of index.changedEntries) add(key);
    }
    index.changedEntries.clear();
    while (this.heap.length) {
      const candidate = this.heap[0];
      if (entries.get(candidate.key) !== candidate.entry || this.latest.get(candidate.key) !== candidate) {
        this.pop();
        continue;
      }
      if (restrict && this.islands.size && !candidate.island) return;
      let selected = candidate;
      const local = this.activeRegion
        ? this.regionHeaps.get(this.activeRegion)
        : undefined;
      if (local) {
        while (local.length && (entries.get(local[0].key) !== local[0].entry || this.latest.get(local[0].key) !== local[0]))
          this.pop(local);
        if (local.length && local[0].island >= candidate.island)
          selected = local[0];
      }
      this.activeRegion = regionKey(selected.entry.cell);
      this.lastMove = `${selected.entry.cell.x},${selected.entry.cell.y}`;
      return selected.entry.cell;
    }
  }
}
const planners = new WeakMap<Field, MovePlanner>();
export function findNumberMove(
  field: Field,
  near: Point = { x: 1, y: 1 },
  restrictToIslands = true,
) {
  let planner = planners.get(field);
  if (!planner) {
    planner = new MovePlanner(field);
    planners.set(field, planner);
  }
  return planner.select(near, restrictToIslands);
}

export function islandFocus(field: Field) {
  return planners.get(field)?.islandFocus() ?? new Set<string>();
}
