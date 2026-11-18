import { OccupiedRows } from "./OccupiedRows";
type Point = { x: number; y: number };
type Interval = { left: number; right: number; id: number };

/** Exact 4-connected complement components, represented as row intervals.
 * Space scales with explored cells, not the area of a potentially huge box. */
export class EnclosedRegions {
  private rows = new Map<number, Interval[]>();
  private parent: number[] = [];
  private exterior: boolean[] = [];
  private sizes: number[] = [];
  constructor(occupied: Point[], runs?: Map<number, [number, number][]>) {
    if (!runs) {
      const built = new OccupiedRows();
      for (const p of occupied) built.add(p.x, p.y);
      runs = built.rows;
    }
    if (!runs.size) return;
    const filled = runs;
    let minX = Infinity,
      maxX = -Infinity;
    for (const row of filled.values()) {
      minX = Math.min(minX, row[0][0]);
      maxX = Math.max(maxX, row[row.length - 1][1]);
    }
    const ys = [...filled.keys()].sort((a, b) => a - b);
    const left = minX - 1,
      right = maxX + 1;
    let previous: Interval[] = [];
    const process = (y: number, xs: [number, number][]) => {
      const spans: Interval[] = [];
      const add = (a: number, b: number) => {
        if (a > b) return;
        const id = this.parent.length;
        this.parent.push(id);
        this.sizes.push(1);
        this.exterior.push(a === left || b === right);
        spans.push({ left: a, right: b, id });
      };
      let cursor = left;
      for (const [a, b] of xs) {
        add(cursor, a - 1);
        cursor = b + 1;
      }
      add(cursor, right);
      let a = 0,
        b = 0;
      while (a < previous.length && b < spans.length) {
        const p = previous[a],
          q = spans[b];
        if (p.right < q.left) {
          a++;
          continue;
        }
        if (q.right < p.left) {
          b++;
          continue;
        }
        this.union(p.id, q.id);
        if (p.right < q.right) a++;
        else b++;
      }
      this.rows.set(y, spans);
      previous = spans;
    };
    process(ys[0] - 1, []);
    let last = ys[0] - 1;
    for (const y of ys) {
      // A completely empty row connects to the exterior; collapse long gaps.
      if (y > last + 1) process(last + 1, []);
      process(y, filled.get(y)!);
      last = y;
    }
    process(last + 1, []);
    // Queries only need enclosed spans, not the exterior component or DSU.
    // Most frontier rows have no holes, making their query a single Map lookup.
    for (const [y, spans] of this.rows) {
      const enclosed = spans.filter(
        (span) => !this.exterior[this.root(span.id)],
      );
      if (enclosed.length) this.rows.set(y, enclosed);
      else this.rows.delete(y);
    }
    this.parent = [];
    this.exterior = [];
    this.sizes = [];
  }
  public changedRows(previous: EnclosedRegions) {
    const changed = new Set<number>();
    for (const y of new Set([...this.rows.keys(), ...previous.rows.keys()])) {
      const a = this.rows.get(y) ?? [], b = previous.rows.get(y) ?? [];
      if (a.length !== b.length || a.some((span, i) => span.left !== b[i].left || span.right !== b[i].right)) changed.add(y);
    }
    return changed;
  }
  private root(id: number): number {
    let root = id;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[id] !== id) {
      const next = this.parent[id];
      this.parent[id] = root;
      id = next;
    }
    return root;
  }
  private union(a: number, b: number) {
    a = this.root(a);
    b = this.root(b);
    if (a === b) return;
    if (this.sizes[a] < this.sizes[b]) [a, b] = [b, a];
    this.parent[b] = a;
    this.sizes[a] += this.sizes[b];
    this.exterior[a] ||= this.exterior[b];
  }
  public contains(p: Point) {
    const spans = this.rows.get(p.y);
    if (!spans) return false;
    let low = 0,
      high = spans.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1,
        s = spans[mid];
      if (p.x < s.left) high = mid - 1;
      else if (p.x > s.right) low = mid + 1;
      else return true;
    }
    return false;
  }
}
