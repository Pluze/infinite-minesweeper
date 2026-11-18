/** Sorted disjoint occupied runs. Adding a cell touches only one row. */
export class OccupiedRows {
  readonly rows = new Map<number, [number, number][]>();
  add(x: number, y: number) {
    let runs = this.rows.get(y);
    if (!runs) {
      this.rows.set(y, [[x, x]]);
      return;
    }
    let low = 0,
      high = runs.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (runs[mid][1] < x - 1) low = mid + 1;
      else high = mid;
    }
    const run = runs[low];
    if (!run || run[0] > x + 1) {
      runs.splice(low, 0, [x, x]);
      return;
    }
    run[0] = Math.min(run[0], x);
    run[1] = Math.max(run[1], x);
    const next = runs[low + 1];
    if (next && next[0] <= run[1] + 1) {
      run[1] = Math.max(run[1], next[1]);
      runs.splice(low + 1, 1);
    }
  }
}
