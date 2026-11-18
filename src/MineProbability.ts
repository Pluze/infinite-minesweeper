import { CellFocus } from "./CellFocus";
import { FrontierPartitions } from "./FrontierPartitions";
import { LocalMineDensity } from "./LocalMineDensity";
import { regionKey } from "./MovePlanner";
import { frontierIndex, prepareFrontier } from "./FrontierIndex";
import { boardGeometry } from "./BoardGeometry";
import { Field } from "./Field";
import { Cell } from "./Cell";

import { cellKey } from "./RiskEstimator";
export { estimateRisks, cellKey, type Constraint } from "./RiskEstimator";

export class MineProbability {
  private dirty = true;
  private focusedMiss = new WeakMap<Set<string>, Map<string, number>>();
  private safe = new Map<string, Cell>();
  private activeFocus?: Set<string>;
  private activeFocusRevision?: number;
  private focusedSafe = new Map<string, Cell>();
  private addSafe(key: string, cell: Cell) {
    this.safe.set(key, cell);
    if (this.activeFocus?.has(key)) this.focusedSafe.set(key, cell);
  }
  private density: LocalMineDensity;
  public prior(x: number, y: number) {
    return this.density.prior(x, y);
  }
  private partitions: FrontierPartitions;
  private result = {
    risks: new Map<string, number>(),
    approximate: new Set<string>(),
  };
  public constructor(private field: Field, density = new LocalMineDensity(field)) {
    this.density = density;
    this.partitions = new FrontierPartitions(field, (x, y) => this.prior(x, y));
    field.on("clueValueChanged", () => {
      this.safe.clear(); this.focusedSafe.clear(); this.dirty = true;
    });
    field.on("cellChanged", (cell: Cell) => {
      this.safe.delete(cellKey(cell.x, cell.y));
      this.focusedSafe.delete(cellKey(cell.x, cell.y));
      // Removing a flag invalidates proofs that assumed it was a mine.
      if (!cell.isOpen && !cell.isFlagged) { this.safe.clear(); this.focusedSafe.clear(); }
      this.dirty = true;
    });
  }
  public snapshot(focus?: Set<string>, proofOnly = false) {
    if (!this.dirty) return this.result;
    const result = this.partitions.snapshot(focus, proofOnly);
    for (const [key, p] of result.risks) {
      if (p === 0 && !result.approximate.has(key)) {
        const [x, y] = key.split(",").map(Number);
        this.addSafe(key, this.field.getCell(x, y));
      }
    }
    if (!focus?.size && !proofOnly) {
      this.result = result;
      this.dirty = false;
    }
    return result;
  }
  public isCertainSafe(cell: Cell) {
    const key = cellKey(cell.x, cell.y);
    return (
      this.safe.has(key) ||
      (!this.dirty &&
        this.result.risks.get(key) === 0 &&
        !this.result.approximate.has(key))
    );
  }
  public risk(cell: Cell): number {
    if (cell.isOpen) return cell.isMine ? 1 : 0;
    if (cell.isFlagged) return 1; // Conditional on the user's flags being correct.
    return (
      this.snapshot().risks.get(cellKey(cell.x, cell.y)) ??
      this.prior(cell.x, cell.y)
    );
  }
  public guess(
    near: { x: number; y: number },
    onlyCertain = false,
    targetFocus?: Set<string>,
  ) {
    if (targetFocus && !targetFocus.size) return;
    // Decision pipeline: look for proofs before paying for a posterior.
    // Overlay refreshes can still request the full snapshot independently.
    if (this.dirty && !this.safe.size && !targetFocus) {
      for (const [key, p] of this.partitions.deductions(targetFocus))
        if (p === 0) {
          const [x, y] = key.split(",").map(Number);
          this.addSafe(key, this.field.getCell(x, y));
        }
    }
    if (targetFocus) {
      const revision = targetFocus instanceof CellFocus ? targetFocus.revision : undefined;
      if (this.activeFocus !== targetFocus || this.activeFocusRevision !== revision) {
        this.activeFocus = targetFocus;
        this.activeFocusRevision = revision;
        this.focusedSafe.clear();
        for (const key of targetFocus) {
          const cell = this.safe.get(key);
          if (cell) this.focusedSafe.set(key, cell);
        }
      }
    }
    const availableSafe = targetFocus ? this.focusedSafe : this.safe;
    if (availableSafe.size) {
      const geometry = boardGeometry(this.field);
      geometry.prepare(near);
      let best:
        | {
            cell: Cell;
            probability: number;
            expected: number;
            distance: number;
            geometry: number;
            island: number;
            local: boolean;
          }
        | undefined;
      const islandExists =
        !onlyCertain &&
        [...frontierIndex(this.field).refresh().values()].some(
          (e) => geometry.islandPriority(e.unknown) > 0,
        );
      for (const [key, old] of availableSafe) {
        if (targetFocus && !targetFocus.has(key)) continue;
        const cell = this.field.getCell(old.x, old.y);
        if (cell.isOpen || cell.isFlagged) {
          this.safe.delete(key);
          this.focusedSafe.delete(key);
          continue;
        }
        const island = geometry.islandPriority([cell]);
        if (islandExists && !island) continue;
        const local = regionKey(cell) === regionKey(near);
        const weight = geometry.weight(cell);
        const distance = (cell.x - near.x) ** 2 + (cell.y - near.y) ** 2;
        if (
          !best ||
          island > best.island ||
          (island === best.island &&
            ((local && !best.local) ||
              (local === best.local && weight < best.geometry)))
        ) {
          best = {
            cell,
            probability: 0,
            expected: 1,
            distance,
            geometry: weight,
            island,
            local,
          };
        }
      }
      if (best) return best;
    }
    const geometry = boardGeometry(this.field);
    geometry.prepare(near);
    const focus = targetFocus ?? new Set<string>();
    if (!onlyCertain && !targetFocus)
      for (const entry of frontierIndex(this.field).refresh().values())
        for (const cell of entry.unknown)
          if (geometry.islandPriority([cell]))
            focus.add(cellKey(cell.x, cell.y));
    const { risks, approximate } = this.snapshot(
      focus.size ? focus : undefined,
      onlyCertain,
    );
    if (targetFocus && this.focusedMiss.get(targetFocus) === risks) return;
    const candidates = new Map<string, Cell>();
    let islandFrontier = false;
    for (const key of risks.keys()) {
      if (targetFocus && !targetFocus.has(key)) continue;
      const [x, y] = key.split(",").map(Number);
      const cell = this.field.getCell(x, y);
      candidates.set(key, cell);
      if (geometry.islandPriority([cell])) islandFrontier = true;
    }
    let lowest = Infinity;
    for (const [key, cell] of candidates) {
      if (onlyCertain || !islandFrontier || geometry.islandPriority([cell]))
        lowest = Math.min(lowest, risks.get(key)!);
    }
    // An unconstrained prior cannot beat an already lower-risk frontier cell.
    // Avoid constructing/ranking the large second ring on every safe inference.
    if (!onlyCertain && lowest >= 0.01) {
      for (const cell of [...candidates.values()]) {
        if (islandFrontier && !geometry.islandPriority([cell])) continue;
        for (const n of this.field.getNeighbors(cell.x, cell.y))
          if (!n.isOpen && !n.isFlagged) candidates.set(cellKey(n.x, n.y), n);
      }
    }
    if (!candidates.size && onlyCertain) return;
    if (!candidates.size) {
      for (const c of this.field.getAll())
        for (const n of this.field.getNeighbors(c.x, c.y)) {
          if (!n.isOpen && !n.isFlagged) candidates.set(cellKey(n.x, n.y), n);
        }
    }
    let best:
      | {
          cell: Cell;
          probability: number;
          distance: number;
          expected: number;
          geometry: number;
          island: number;
          local: boolean;
        }
      | undefined;
    const hasIsland = [...candidates.values()].some(
      (cell) => geometry.islandPriority([cell]) > 0,
    );
    for (const cell of candidates.values()) {
      if (cell.isOpen || cell.isFlagged) continue;
      const probability =
        risks.get(cellKey(cell.x, cell.y)) ?? this.prior(cell.x, cell.y);
      const island = geometry.islandPriority([cell]);
      if (onlyCertain) {
        if (probability !== 0 || approximate.has(cellKey(cell.x, cell.y)))
          continue;
      } else if (hasIsland && !island) continue;
      const expected = 1 - 101 * probability;
      if (best && expected < best.expected - 1e-9) continue;
      const local = regionKey(cell) === regionKey(near);
      const shape = geometry.weight(cell);
      const distance = (cell.x - near.x) ** 2 + (cell.y - near.y) ** 2;
      // Original game: safe +1, mine -100; excludes bonus flood-fill gains.
      if (
        !best ||
        expected > best.expected + 1e-9 ||
        (Math.abs(expected - best.expected) < 1e-9 &&
          (island > best.island ||
            (island === best.island &&
              ((local && !best.local) ||
                (local === best.local &&
                  (shape < best.geometry - 1e-9 ||
                    (Math.abs(shape - best.geometry) < 1e-9 &&
                      distance < best.distance)))))))
      ) {
        best = {
          cell,
          probability,
          distance,
          expected,
          geometry: shape,
          island,
          local,
        };
      }
    }
    if (!best && targetFocus) this.focusedMiss.set(targetFocus, risks);
    return best;
  }
}
const models = new WeakMap<Field, MineProbability>();
export function probabilityModel(field: Field) {
  let model = models.get(field);
  if (!model) {
    model = new MineProbability(field);
    models.set(field, model);
  }
  return model;
}

export async function prepareProbability(field: Field, signal: AbortSignal, progress: (done: number, phase: string) => void) {
  if (models.has(field)) return;
  const density = new LocalMineDensity(field, true);
  await density.initialize(signal, done => progress(done, "Restoring local statistics"));
  await prepareFrontier(field, signal, progress);
  signal.throwIfAborted();
  models.set(field, new MineProbability(field, density));
}
