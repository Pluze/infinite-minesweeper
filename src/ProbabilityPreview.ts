import { Field } from "./Field";
import { frontierIndex } from "./FrontierIndex";
import { probabilityModel, cellKey } from "./MineProbability";
type Result = { risks: Map<string, number>; approximate: Set<string> };
/** UI inference owns a background worker; decision proofs remain synchronous. */
export class ProbabilityPreview {
  public result: Result = { risks: new Map(), approximate: new Set() };
  public version = 0;
  private worker?: Worker;
  private busy = false;
  private requested = -1;
  private initialized = false;
  private fullRefresh = false;
  private dirtyClues = new Set<string>();
  private dirtyBuckets = new Set<string>();
  private patchCells = new Map<string, {x: number; y: number}>();
  private pendingInvalidations = new Map<string, {x: number; y: number}>();
  get background() { return !!this.worker; }
  get needsUpdate() {
    return !this.busy && this.requested !== frontierIndex(this.field).revision;
  }
  private groupByKey = new Map<string, number>();
  private invalidGroups = new Set<number>();
  private changed = new Map<string, { x: number; y: number }>();
  private invalidateAll = false;
  constructor(private field: Field) {
    if (typeof Worker !== "undefined") {
      this.worker = new Worker(
        new URL("./ProbabilityWorker.ts", import.meta.url),
        { type: "module" },
      );
      this.worker.onmessage = (
        event: MessageEvent<{
          risks: [string, number][];
          approximate: string[];
          groups: string[][];
        }>,
      ) => {
        this.result = {
          risks: new Map(event.data.risks),
          approximate: new Set(event.data.approximate),
        };
        this.groupByKey.clear();
        this.invalidGroups.clear();
        event.data.groups.forEach((group, id) =>
          group.forEach((key) => this.groupByKey.set(key, id)),
        );
        this.pendingInvalidations.clear();
        if (this.invalidateAll)
          for (let i = 0; i < event.data.groups.length; i++)
            this.invalidGroups.add(i);
        else for (const [key, cell] of this.changed) this.pendingInvalidations.set(key, cell);
        this.changed.clear();
        this.invalidateAll = false;
        this.busy = false;
        this.version++;
      };
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = undefined;
        this.busy = false;
        this.requested = -1;
        this.version++;
      };
      field.on("cellChanged", (cell: { x: number; y: number }) => {
        const key = cellKey(cell.x, cell.y);
        this.pendingInvalidations.set(key, cell);
        if (this.pendingInvalidations.size > 4096) {
          for (const group of this.groupByKey.values()) this.invalidGroups.add(group);
          this.pendingInvalidations.clear();
        }
        if (!this.fullRefresh) {
          this.patchCells.set(key, cell);
          if (this.patchCells.size > 4096) {
            this.patchCells.clear();
            this.fullRefresh = true;
          }
        }
        if (this.busy && !this.invalidateAll) {
          this.changed.set(cellKey(cell.x, cell.y), cell);
          if (this.changed.size > 4096) {
            this.changed.clear();
            this.invalidateAll = true;
          }
        }
      });
      field.on("beforeRestart", () => this.worker?.terminate());
    }
  }
  private flushInvalidations() {
    if (!this.pendingInvalidations.size) return;
    const keys = new Set<string>();
    for (const cell of this.pendingInvalidations.values())
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) keys.add(cellKey(cell.x + dx, cell.y + dy));
    this.pendingInvalidations.clear();
    for (const key of keys) {
      const group = this.groupByKey.get(key);
      if (group !== undefined) this.invalidGroups.add(group);
    }
  }
  public isInvalid(key: string) {
    this.flushInvalidations();
    const group = this.groupByKey.get(key);
    return group !== undefined && this.invalidGroups.has(group);
  }
  public request() {
    const index = frontierIndex(this.field),
      model = probabilityModel(this.field);
    if (this.busy || this.requested === index.revision) return;
    this.requested = index.revision;
    if (!this.worker) {
      this.groupByKey.clear();
      this.invalidGroups.clear();
      this.result = model.snapshot();
      this.version++;
      return;
    }
    const reset = this.fullRefresh;
    if (reset) this.initialized = false;
    this.fullRefresh = false;
    for (const cell of this.patchCells.values())
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        this.dirtyClues.add(cellKey(cell.x + dx, cell.y + dy));
        this.dirtyBuckets.add(cellKey(Math.floor(cell.x / 8) + dx, Math.floor(cell.y / 8) + dy));
      }
    this.patchCells.clear();
    const entries = index.refresh();
    const updates = [...(this.initialized ? this.dirtyClues : entries.keys())].map(key => {
      const entry = entries.get(key);
      if (!entry) return [key, null] as const;
      const cells = entry.unknown.map(cell => {
        if (!this.initialized) this.dirtyBuckets.add(cellKey(Math.floor(cell.x / 8), Math.floor(cell.y / 8)));
        return cellKey(cell.x, cell.y);
      });
      return [key, {cells, mines: entry.remaining}] as const;
    });
    const bucketPriors = [...this.dirtyBuckets].map(key => {
      const [x, y] = key.split(",").map(Number);
      return [key, model.prior(x * 8, y * 8)] as const;
    });
    this.initialized = true;
    this.dirtyClues.clear(); this.dirtyBuckets.clear();
    this.busy = true;
    this.changed.clear();
    this.invalidateAll = false;
    this.worker.postMessage({
      updates,
      reset,
      prior: this.field.probability,
      bucketPriors,
    });
  }
}
