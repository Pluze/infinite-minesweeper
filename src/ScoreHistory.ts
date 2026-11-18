export type ScorePoint = { click: number; score: number };

export function historyWindow(scores: number[], limit: number): ScorePoint[] {
  const start = limit > 0 ? Math.max(0, scores.length - limit - 1) : 0;
  return scores.slice(start).map((score, i) => ({ click: start + i, score }));
}

/** Keep extrema in time order so a mine penalty never disappears in overview. */
export function reduceHistory(
  points: ScorePoint[],
  buckets = 150,
): ScorePoint[] {
  if (points.length <= buckets * 2) return points;
  const reduced = [points[0]];
  const width = Math.ceil((points.length - 2) / buckets);
  for (let start = 1; start < points.length - 1; start += width) {
    const end = Math.min(points.length - 1, start + width);
    let min = start,
      max = start;
    for (let i = start + 1; i < end; i++) {
      if (points[i].score < points[min].score) min = i;
      if (points[i].score > points[max].score) max = i;
    }
    for (const i of [...new Set([min, max])].sort((a, b) => a - b))
      reduced.push(points[i]);
  }
  reduced.push(points[points.length - 1]);
  return reduced;
}

/** Sample directly from saved scores: no full-history slice or point-object array. */
export function sampleHistory(
  scores: number[],
  limit: number,
  buckets = 150,
  baseScorePerClick = 0,
  derive?: (value: number, index: number) => number,
): ScorePoint[] {
  const value = (click: number) =>
    derive
      ? derive(scores[click], click)
      : scores[click] - click * baseScorePerClick;
  const first = limit > 0 ? Math.max(0, scores.length - limit - 1) : 0;
  const last = scores.length - 1;
  if (last < first) return [];
  if (last - first + 1 <= buckets * 2)
    return historyWindow(scores, limit).map((p) => ({
      click: p.click,
      score: value(p.click),
    }));
  const result: ScorePoint[] = [{ click: first, score: value(first) }];
  const stride = Math.ceil((last - first - 1) / buckets);
  for (let start = first + 1; start < last; start += stride) {
    const end = Math.min(last, start + stride);
    let min = start,
      max = start;
    for (let i = start + 1; i < end; i++) {
      if (
        Number.isFinite(value(i)) &&
        (!Number.isFinite(value(min)) || value(i) < value(min))
      )
        min = i;
      if (
        Number.isFinite(value(i)) &&
        (!Number.isFinite(value(max)) || value(i) > value(max))
      )
        max = i;
    }
    if (min === max) result.push({ click: min, score: value(min) });
    else
      for (const i of min < max ? [min, max] : [max, min])
        result.push({ click: i, score: value(i) });
  }
  result.push({ click: last, score: value(last) });
  return result;
}

/** Append-only chart index: derive each historical value once and reuse block extrema. */
export class HistoryIndex {
  private values: number[] = [];
  private blocks: { min: number; max: number }[] = [];
  private key = "";
  sample(
    scores: number[],
    limit: number,
    key: string,
    derive = (value: number, _index: number) => value,
    buckets = 150,
  ): ScorePoint[] {
    if (key !== this.key || scores.length < this.values.length) {
      this.values = [];
      this.blocks = [];
      this.key = key;
    }
    const better = (a: number, b: number, min: boolean) =>
      Number.isFinite(this.values[b]) &&
      (!Number.isFinite(this.values[a]) ||
        (min
          ? this.values[b] < this.values[a]
          : this.values[b] > this.values[a]));
    for (let i = this.values.length; i < scores.length; i++) {
      this.values.push(derive(scores[i], i));
      const b = Math.floor(i / 256),
        block = this.blocks[b];
      if (!block) this.blocks[b] = { min: i, max: i };
      else {
        if (better(block.min, i, true)) block.min = i;
        if (better(block.max, i, false)) block.max = i;
      }
    }
    const first = limit > 0 ? Math.max(0, scores.length - limit - 1) : 0,
      last = scores.length - 1;
    if (last < first) return [];
    const point = (click: number) => ({ click, score: this.values[click] });
    if (last - first + 1 <= buckets * 2)
      return Array.from({ length: last - first + 1 }, (_, i) =>
        point(first + i),
      );
    const result = [point(first)],
      stride = Math.ceil((last - first - 1) / buckets);
    for (let start = first + 1; start < last; start += stride) {
      const end = Math.min(last, start + stride);
      let min = start,
        max = start;
      for (let i = start; i < end;) {
        if (i % 256 === 0 && i + 256 <= end) {
          const block = this.blocks[i / 256];
          if (better(min, block.min, true)) min = block.min;
          if (better(max, block.max, false)) max = block.max;
          i += 256;
        } else {
          if (better(min, i, true)) min = i;
          if (better(max, i, false)) max = i;
          i++;
        }
      }
      for (const i of min === max ? [min] : min < max ? [min, max] : [max, min])
        result.push(point(i));
    }
    result.push(point(last));
    return result;
  }
}
