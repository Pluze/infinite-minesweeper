/** Display-only aggregation: retain both extremes rather than overpaint them. */
export class OverviewRiskBins {
  readonly stride: number;
  readonly bins = new Map<string, {x: number; y: number; low: number; high: number}>();
  constructor(cellPixels: number) { this.stride = Math.max(1, Math.ceil(9 / cellPixels)); }
  add(x: number, y: number, probability: number) {
    const bx = Math.floor(x / this.stride), by = Math.floor(y / this.stride), key = `${bx},${by}`;
    const bin = this.bins.get(key);
    if (bin) { bin.low = Math.min(bin.low, probability); bin.high = Math.max(bin.high, probability); }
    else this.bins.set(key, {x: (bx + .5) * this.stride, y: (by + .5) * this.stride, low: probability, high: probability});
  }
}
