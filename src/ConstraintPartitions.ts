import type { Constraint } from "./RiskEstimator";
export type ConstraintPartition = {
  clues: Set<string>;
  cells: Set<string>;
};
/** Dynamic connected components of the clue/unknown-cell bipartite graph.
 * Deletions rebuild only touched components; additions merge across tile borders.
 * A spatial tile is never treated as an independence assumption. */
export class ConstraintPartitions {
  readonly constraints = new Map<string, Constraint>();
  readonly groups = new Set<ConstraintPartition>();
  private byCell = new Map<string, Set<string>>();
  private byClue = new Map<string, ConstraintPartition>();
  update(changes: Map<string, Constraint | undefined>) {
    const affected = new Set<string>();
    const invalidate = (id: string) => {
      const group = this.byClue.get(id);
      if (!group || !this.groups.delete(group)) return;
      for (const clue of group.clues) {
        affected.add(clue);
        this.byClue.delete(clue);
      }
    };
    for (const [id, next] of changes) {
      const old = this.constraints.get(id);
      // Dirty neighborhoods include clues whose variables did not change.
      // Preserve component identity and its proof cache for those clues.
      if (old === next || (old && next && old.mines === next.mines &&
          old.cells.length === next.cells.length &&
          old.cells.every((cell, i) => cell === next.cells[i]))) continue;
      invalidate(id);
      if (old)
        for (const cell of old.cells) {
          const refs = this.byCell.get(cell)!;
          refs.delete(id);
          if (!refs.size) this.byCell.delete(cell);
        }
      this.constraints.delete(id);
      if (next) {
        this.constraints.set(id, next);
        affected.add(id);
        for (const cell of next.cells) {
          let refs = this.byCell.get(cell);
          if (!refs) this.byCell.set(cell, (refs = new Set()));
          for (const clue of refs) invalidate(clue);
          refs.add(id);
        }
      }
    }
    const visited = new Set<string>();
    for (const first of affected) {
      if (!this.constraints.has(first) || visited.has(first)) continue;
      const group: ConstraintPartition = { clues: new Set(), cells: new Set() };
      const queue = [first];
      visited.add(first);
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        group.clues.add(id);
        this.byClue.set(id, group);
        for (const cell of this.constraints.get(id)!.cells) {
          if (group.cells.has(cell)) continue;
          group.cells.add(cell);
          for (const neighbor of this.byCell.get(cell) ?? []) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
      this.groups.add(group);
    }
  }
  selected(focus?: Set<string>) {
    if (!focus?.size) return this.groups;
    const selected = new Set<ConstraintPartition>();
    for (const cell of focus)
      for (const clue of this.byCell.get(cell) ?? []) {
        const group = this.byClue.get(clue);
        if (group) selected.add(group);
      }
    return selected;
  }
}
