import { LoadBudget } from "./LoadingScreen";
import { Field } from "./Field";
import { Observation, observeCell, type Cell } from "./Cell";

function countsAsMine(observation: number) {
  return observation & Observation.Open
    ? !!(observation & Observation.Detonated)
    : !!(observation & Observation.Flagged);
}

/** Empirical local prior, shrunk toward the generator rate; never reads hidden mines. */
export class LocalMineDensity {
  private priors = new Map<string, number>();
  private buckets = new Map<string, { area: number; mines: number }>();
  constructor(
    private field: Field,
    deferred = false,
  ) {
    if (!deferred) for (const cell of field.cellData.cells()) this.seed(cell);
    field.on(
      "observationChanged",
      (x: number, y: number, before: number, after: number) =>
        this.update(x, y, before, after, true),
    );
  }
  public async initialize(
    signal: AbortSignal,
    progress: (done: number) => void,
  ) {
    let done = 0;
    const budget = new LoadBudget();
    for (const cell of this.field.cellData.cells()) {
      this.seed(cell);
      if (++done % 2000 === 0 && budget.due()) {
        signal.throwIfAborted();
        progress(done);
        await budget.yield();
      }
    }
    signal.throwIfAborted();
  }
  private seed(cell: Cell) {
    this.update(cell.x, cell.y, 0, observeCell(cell), false);
  }

  private update(
    x: number,
    y: number,
    before: number,
    after: number,
    invalidate: boolean,
  ) {
    if (before === after) return;
    const area = Number(after !== 0) - Number(before !== 0);
    const mines = Number(countsAsMine(after)) - Number(countsAsMine(before));
    if (!area && !mines) return;
    const bx = Math.floor(x / 8),
      by = Math.floor(y / 8);
    if (invalidate)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          this.priors.delete(`${bx + dx},${by + dy}`);
    const bucketKey = `${bx},${by}`;
    const bucket = this.buckets.get(bucketKey) ?? { area: 0, mines: 0 };
    bucket.area += area;
    bucket.mines += mines;
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
