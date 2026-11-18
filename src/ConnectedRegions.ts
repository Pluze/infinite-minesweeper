import { Field } from "./Field";
import { frontierIndex, keyOf } from "./FrontierIndex";
import { OccupiedRows } from "./OccupiedRows";
type Point = { x: number; y: number };
export type Region = {
  parent?: Region;
  points: Point[];
  sumX: number;
  sumY: number;
  rows: Map<number, [number, number]>;
  occupied: OccupiedRows;
  revision: number;
};
/** Union by size keeps normal growth and region merges incremental. */
export class ConnectedRegions {
  private nodes = new Map<string, Region>();
  private dirty = true;
  public rebuilds = 0;
  constructor(private field: Field) {
    frontierIndex(field);
    field.on("cellChanged", (cell) => {
      if (this.dirty) return;
      const key = keyOf(cell.x, cell.y);
      if (!cell.isOpen && !cell.isFlagged) {
        if (this.nodes.has(key)) this.dirty = true;
      } else if (!this.nodes.has(key)) this.add(cell);
    });
  }
  private root(r: Region): Region {
    if (r.parent) r.parent = this.root(r.parent);
    return r.parent ?? r;
  }
  private append(r: Region, p: Point) {
    r.points.push(p);
    r.sumX += p.x;
    r.sumY += p.y;
    r.occupied.add(p.x, p.y);
    const row = r.rows.get(p.y);
    r.rows.set(
      p.y,
      row ? [Math.min(row[0], p.x), Math.max(row[1], p.x)] : [p.x, p.x],
    );
    r.revision++;
  }
  private add(p: Point) {
    let group: Region = {
      points: [],
      sumX: 0,
      sumY: 0,
      rows: new Map(),
      occupied: new OccupiedRows(),
      revision: 0,
    };
    this.append(group, p);
    this.nodes.set(keyOf(p.x, p.y), group);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const node = this.nodes.get(keyOf(p.x + dx, p.y + dy));
        if (!node) continue;
        let other = this.root(node);
        group = this.root(group);
        if (group === other) continue;
        if (group.points.length < other.points.length)
          [group, other] = [other, group];
        other.parent = group;
        for (const point of other.points) this.append(group, point);
        // Non-root objects remain as tiny disjoint-set links only.
        other.points = [];
        other.rows.clear();
        other.occupied = new OccupiedRows();
      }
  }
  public at(near: Point): Region | undefined {
    const known = frontierIndex(this.field).known;
    if (this.dirty) {
      this.nodes.clear();
      this.dirty = false;
      this.rebuilds++;
      for (const cell of known.values()) this.add(cell);
    }
    const direct = this.nodes.get(keyOf(near.x, near.y));
    if (direct) return this.root(direct);
    let nearest: Region | undefined,
      distance = Infinity;
    for (const cell of known.values()) {
      const d = (cell.x - near.x) ** 2 + (cell.y - near.y) ** 2;
      if (d < distance) {
        distance = d;
        nearest = this.nodes.get(keyOf(cell.x, cell.y));
      }
    }
    return nearest ? this.root(nearest) : undefined;
  }
  public belongs(p: Point, r: Region) {
    const node = this.nodes.get(keyOf(p.x, p.y));
    return !!node && this.root(node) === this.root(r);
  }
}
