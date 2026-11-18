import { ConnectedRegions, Region } from "./ConnectedRegions";
import { EnclosedRegions } from "./EnclosedRegions";
import { Cell } from "./Cell";
import { Field } from "./Field";
import { frontierIndex, keyOf } from "./FrontierIndex";
type Point = { x: number; y: number };
const offsets: Point[] = [];
for (let y = -1; y <= 1; y++)
  for (let x = -1; x <= 1; x++) if (x || y) offsets.push({ x, y });
const cross = (o: Point, a: Point, b: Point) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

export function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const half = (list: Point[]) => {
    const result: Point[] = [];
    for (const p of list) {
      while (
        result.length >= 2 &&
        cross(result[result.length - 2], result[result.length - 1], p) <= 0
      )
        result.pop();
      result.push(p);
    }
    return result;
  };
  return [...half(sorted).slice(0, -1), ...half(sorted.reverse()).slice(0, -1)];
}

/** Soft digital-topology penalty: foreground 8-connected, background 4-connected.
 * Filling the final square of an existing hole is deliberately permitted. */
function computeTopologyPenalty(
  point: Point,
  occupied: (x: number, y: number) => boolean,
) {
  const filled = offsets.map((p) => occupied(point.x + p.x, point.y + p.y));
  const components = (foreground: boolean) => {
    const visited = new Set<number>();
    let count = 0;
    for (let i = 0; i < 8; i++) {
      if (visited.has(i) || filled[i] !== foreground) continue;
      const queue = [i];
      visited.add(i);
      let touchesCenter = foreground;
      for (let j = 0; j < queue.length; j++) {
        const a = offsets[queue[j]];
        if (Math.abs(a.x) + Math.abs(a.y) === 1) touchesCenter = true;
        for (let k = 0; k < 8; k++) {
          const b = offsets[k],
            dx = Math.abs(a.x - b.x),
            dy = Math.abs(a.y - b.y);
          if (
            !visited.has(k) &&
            filled[k] === foreground &&
            (foreground ? Math.max(dx, dy) === 1 : dx + dy === 1)
          ) {
            visited.add(k);
            queue.push(k);
          }
        }
      }
      if (touchesCenter) count++;
    }
    return count;
  };
  const fg = components(true),
    bg = components(false);
  if (fg === 1 && bg <= 1) return 0;
  return fg === 0 ? 2 : Math.max(0, fg - 1) + Math.max(0, bg - 1);
}

// There are only 256 possible occupancy patterns around a square.
const topologyTable = Array.from({ length: 256 }, (_, mask) =>
  computeTopologyPenalty({ x: 0, y: 0 }, (x, y) => {
    const i = offsets.findIndex((p) => p.x === x && p.y === y);
    return i >= 0 && (mask & (1 << i)) !== 0;
  }),
);
export function topologyPenalty(
  point: Point,
  occupied: (x: number, y: number) => boolean,
) {
  let mask = 0;
  for (let i = 0; i < 8; i++)
    if (occupied(point.x + offsets[i].x, point.y + offsets[i].y))
      mask |= 1 << i;
  return topologyTable[mask];
}

export class BoardGeometry {
  public version = 0;
  public islandChanges?: {from: number; rows: Set<number>};
  public stats = {
    fullBuilds: 0,
    enclosureBuilds: 0,
    fullMs: 0,
    enclosureMs: 0,
  };
  private index;
  private regions: ConnectedRegions;
  private current?: Region;
  private hull: Point[] = [];
  private center = { x: 0, y: 0 };
  private radiusSquared = 1;
  private weights = new Map<string, number>();
  private islands = new EnclosedRegions([]);
  private topologyDirty = true;
  private lastBuilt = -Infinity;
  private lastRevision = -1;
  constructor(field: Field) {
    this.index = frontierIndex(field);
    this.regions = new ConnectedRegions(field);
    field.on("cellChanged", (cell: Cell) => {
      if (
        !this.topologyDirty &&
        ((!cell.isOpen && !cell.isFlagged) ||
          (!this.islands.contains(cell) &&
            topologyPenalty(cell, (x, y) => this.index.known.has(keyOf(x, y))) >
              0))
      )
        this.topologyDirty = true;
      this.weights.delete(keyOf(cell.x, cell.y));
      for (const p of offsets)
        this.weights.delete(keyOf(cell.x + p.x, cell.y + p.y));
    });
  }
  public prepare(near: Point) {
    const now = performance.now(),
      before = this.regions.rebuilds;
    const region = this.regions.at(near);
    if (this.regions.rebuilds !== before) {
      this.stats.fullBuilds++;
      this.stats.fullMs += performance.now() - now;
    }
    const switched = region !== this.current;
    this.current = region;
    if (!region) {
      this.islandChanges = undefined;
      this.center = near;
      this.hull = [];
      this.islands = new EnclosedRegions([]);
      this.weights.clear();
      this.version++;
      return;
    }
    this.center = {
      x: region.sumX / region.points.length,
      y: region.sumY / region.points.length,
    };
    this.radiusSquared = Math.max(1, region.points.length / Math.PI);
    if (switched || this.topologyDirty) {
      const started = performance.now();
      const next = new EnclosedRegions([], region.occupied.rows);
      this.islandChanges = switched ? undefined : {from: this.version, rows: next.changedRows(this.islands)};
      this.islands = next;
      this.stats.enclosureBuilds++;
      this.stats.enclosureMs += performance.now() - started;
      this.topologyDirty = false;
      this.version++;
    }
    if (
      switched ||
      (region.revision !== this.lastRevision && now - this.lastBuilt >= 100)
    ) {
      this.hull = convexHull(
        [...region.rows].flatMap(([y, [a, b]]) => [
          { x: a, y },
          { x: b, y },
        ]),
      );
      // Hull/centroid weights are soft preferences. Updating them must not
      // rebuild every frontier heap: on a large board that rebuild can itself
      // take over 100 ms and trigger another rebuild on the next click.
      // Changed frontier entries receive fresh weights incrementally.
      this.weights.clear();
      this.lastBuilt = now;
      this.lastRevision = region.revision;
    }
  }
  public islandPriority(targets: Point[]) {
    let enclosed = 0;
    for (const p of targets)
      if (!this.index.known.has(keyOf(p.x, p.y)) && this.islands.contains(p))
        enclosed++;
    return enclosed === targets.length && enclosed > 0
      ? 2
      : enclosed > 0
        ? 1
        : 0;
  }
  public weight(p: Point) {
    const key = keyOf(p.x, p.y),
      cached = this.weights.get(key);
    if (cached !== undefined) return cached;
    let inside = this.hull.length >= 3;
    for (let i = 0; i < this.hull.length && inside; i++)
      if (cross(this.hull[i], this.hull[(i + 1) % this.hull.length], p) < 0)
        inside = false;
    const radial =
      ((p.x - this.center.x) ** 2 + (p.y - this.center.y) ** 2) /
      this.radiusSquared;
    const attached = offsets.some(
      (d) =>
        this.current &&
        this.regions.belongs({ x: p.x + d.x, y: p.y + d.y }, this.current),
    );
    const weight =
      radial +
      (inside ? 0 : 2) +
      (attached ? 0 : 4) +
      3 * topologyPenalty(p, (x, y) => this.index.known.has(keyOf(x, y)));
    this.weights.set(key, weight);
    return weight;
  }
  public rank(targets: Point[]) {
    let total = 0;
    for (const p of targets) total += this.weight(p);
    return total / Math.max(1, targets.length);
  }
  public centroid() {
    return { ...this.center };
  }
}
const geometries = new WeakMap<Field, BoardGeometry>();
export function boardGeometry(field: Field) {
  let geometry = geometries.get(field);
  if (!geometry) {
    geometry = new BoardGeometry(field);
    geometries.set(field, geometry);
  }
  return geometry;
}
