import { Field } from "./Field";
import { Cell } from "./Cell";

/** Empirical local prior, shrunk toward the generator rate; never reads hidden mines. */
export class LocalMineDensity {
  private priors = new Map<string, number>();
  private cells = new Map<string, number>();
  private buckets = new Map<string, { area: number; mines: number }>();
  constructor(private field: Field) {
    for (const cell of field.getAll()) this.update(cell);
    field.on("cellChanged", (cell: Cell) => this.update(cell));
  }
  private update(cell: Cell) {
    const key = `${cell.x},${cell.y}`;
    const previous = this.cells.get(key) ?? 0;
    const next = cell.isOpen ? (cell.isMine ? 2 : 1) : cell.isFlagged ? 2 : 0;
    if (previous === next) return;
    const bx = Math.floor(cell.x / 8),
      by = Math.floor(cell.y / 8);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        this.priors.delete(`${bx + dx},${by + dy}`);
    if (next) this.cells.set(key, next);
    else this.cells.delete(key);
    const bucketKey = `${Math.floor(cell.x / 8)},${Math.floor(cell.y / 8)}`;
    const bucket = this.buckets.get(bucketKey) ?? { area: 0, mines: 0 };
    bucket.area += Number(next > 0) - Number(previous > 0);
    bucket.mines += Number(next === 2) - Number(previous === 2);
    if (bucket.area) this.buckets.set(bucketKey, bucket);
    else this.buckets.delete(bucketKey);
  }
  prior(x: number, y: number) {
    const bx = Math.floor(x / 8),
      by = Math.floor(y / 8);
    const key = `${bx},${by}`;
    const cached = this.priors.get(key);
    if (cached !== undefined) return cached;
    let area = 0,
      mines = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this.buckets.get(`${bx + dx},${by + dy}`);
        if (!bucket) continue;
        const weight = 1 / (1 + dx * dx + dy * dy);
        area += weight * bucket.area;
        mines += weight * bucket.mines;
      }
    // 64 virtual observations prevent a few flags or a safe cascade dominating.
    const value = Math.max(
      0.01,
      Math.min(0.99, (mines + 64 * this.field.probability) / (area + 64)),
    );
    this.priors.set(key, value);
    return value;
  }
}
