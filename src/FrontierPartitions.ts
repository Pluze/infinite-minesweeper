import { CellFocus } from "./CellFocus";
import { Field } from "./Field";
import { frontierIndex, keyOf } from "./FrontierIndex";
import {
  ConstraintPartitions,
  type ConstraintPartition,
} from "./ConstraintPartitions";
import {
  estimateRisks,
  type Constraint,
  type RiskCache,
} from "./RiskEstimator";
import { reduceConstraints } from "./ConstraintReduction";
type Result = ReturnType<typeof estimateRisks>;
type Cached = { priorVersion: number; result: Result };
type FocusedProof = { result: Result; revision?: number; dependencies: Set<string>; invalidated: boolean };
/** Changed clue neighborhoods + exact dependency components + reusable inference. */
export class FrontierPartitions {
  readonly graph = new ConstraintPartitions();
  readonly stats = { solved: 0, reused: 0, constraintsSolved: 0, solveMs: 0, refreshMs: 0, calls: 0 };
  private riskCache: RiskCache = new Map();
  private focusedProofs = new WeakMap<
    Set<string>,
    FocusedProof
  >();
  private activeProof?: FocusedProof;
  private initialized = false;
  private dirty = new Set<string>();
  private bucketVersions = new Map<string, number>();
  private epoch = 0;
  private caches = [
    new WeakMap<ConstraintPartition, Cached>(),
    new WeakMap<ConstraintPartition, Cached>(),
  ];
  private deductionsCache = new WeakMap<
    ConstraintPartition,
    Map<string, number>
  >();
  private buckets = new WeakMap<ConstraintPartition, Set<string>>();
  constructor(
    private field: Field,
    private prior: (x: number, y: number) => number,
  ) {
    frontierIndex(field);
    field.on("cellChanged", (cell: { x: number; y: number }) => {
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++) {
          const key = keyOf(cell.x + x, cell.y + y);
          this.dirty.add(key);
          if (this.activeProof?.dependencies.has(key)) this.activeProof.invalidated = true;
        }
      this.epoch++;
      const bx = Math.floor(cell.x / 8),
        by = Math.floor(cell.y / 8);
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++)
          this.bucketVersions.set(keyOf(bx + x, by + y), this.epoch);
    });
  }
  refresh() {
    const started = performance.now();
    const entries = frontierIndex(this.field).refresh();
    const changes = new Map<string, Constraint | undefined>();
    for (const key of this.initialized ? this.dirty : entries.keys()) {
      const entry = entries.get(key);
      changes.set(
        key,
        entry
          ? {
              cells: entry.unknown.map((c) => keyOf(c.x, c.y)),
              mines: entry.remaining,
            }
          : undefined,
      );
    }
    this.graph.update(changes);
    this.initialized = true;
    this.dirty.clear();
    this.stats.refreshMs += performance.now() - started;
    return this.graph;
  }
  deductions(focus?: Set<string>) {
    const known = new Map<string, number>();
    for (const group of this.refresh().selected(focus)) {
      let result = this.deductionsCache.get(group);
      if (!result) {
        result = reduceConstraints(
          [...group.clues].map((id) => this.graph.constraints.get(id)!),
        ).known;
        this.deductionsCache.set(group, result);
      }
      for (const [key, p] of result) known.set(key, p);
    }
    return known;
  }
  snapshot(focus?: Set<string>, proofOnly = false) {
    this.stats.calls++;
    const result: Result = { risks: new Map(), approximate: new Set() };
    const previous = focus?.size && proofOnly ? this.focusedProofs.get(focus) : undefined;
    if (previous && previous === this.activeProof && !previous.invalidated &&
        previous.revision === (focus instanceof CellFocus ? focus.revision : undefined)) return previous.result;
    const graph = this.refresh(), cache = this.caches[Number(proofOnly)];
    const selected = graph.selected(focus);
    for (const group of selected) {
      let buckets = this.buckets.get(group);
      if (!buckets && !proofOnly) {
        buckets = new Set(
          [...group.cells].map((key) => {
            const [x, y] = key.split(",").map(Number);
            return keyOf(Math.floor(x / 8), Math.floor(y / 8));
          }),
        );
        this.buckets.set(group, buckets);
      }
      let priorVersion = 0;
      for (const key of proofOnly ? [] : buckets!)
        priorVersion = Math.max(
          priorVersion,
          this.bucketVersions.get(key) ?? 0,
        );
      let saved = cache.get(group);
      if (!saved || saved.priorVersion !== priorVersion) {
        const constraints = [...group.clues].map((id) =>
          graph.constraints.get(id)!,
        );
        const started = performance.now();
        saved = {
          priorVersion,
          result: estimateRisks(
            constraints,
            this.field.probability,
            this.riskCache,
            proofOnly
              ? undefined
              : (key) => {
                  const [x, y] = key.split(",").map(Number);
                  return this.prior(x, y);
                },
            proofOnly,
          ),
        };
        this.stats.solveMs += performance.now() - started;
        cache.set(group, saved);
        this.stats.solved++;
        this.stats.constraintsSolved += constraints.length;
      } else this.stats.reused++;
      for (const [key, p] of saved.result.risks)
        if (!proofOnly || (p === 0 && !saved.result.approximate.has(key)))
          result.risks.set(key, p);
      for (const key of saved.result.approximate) result.approximate.add(key);
    }
    if (focus?.size && proofOnly) {
      const dependencies = new Set<string>();
      const dependencyCells = new Set(focus);
      for (const group of selected) for (const key of group.cells) dependencyCells.add(key);
      for (const key of dependencyCells) {
        const [cx, cy] = key.split(",").map(Number);
        for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) dependencies.add(keyOf(cx + x, cy + y));
      }
      const saved: FocusedProof = {result, dependencies, invalidated: false, revision: focus instanceof CellFocus ? focus.revision : undefined};
      this.focusedProofs.set(focus, saved);
      this.activeProof = saved;
    }
    return result;
  }
}
