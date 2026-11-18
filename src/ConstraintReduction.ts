import type { Constraint } from "./RiskEstimator";

/** Sound zero/full and subset-difference deductions before probabilistic work.
 * Limits only stop deductions early; they never turn a guess into a proof. */
export function reduceConstraints(input: Constraint[]) {
  const known = new Map<string, number>();
  let constraints = input;
  const deadline = performance.now() + 3;
  for (let round = 0; round < 16; round++) {
    const unique = new Map<string, Constraint>();
    let changed = false;
    for (const c of constraints) {
      let mines = c.mines;
      const cells = c.cells
        .filter((key) => {
          const value = known.get(key);
          if (value === undefined) return true;
          mines -= value;
          return false;
        })
        .sort();
      if (mines < 0 || mines > cells.length)
        return { constraints: input, known: new Map<string, number>() };
      if (!cells.length) continue;
      const signature = cells.join(";");
      const previous = unique.get(signature);
      if (previous && previous.mines !== mines)
        return { constraints: input, known: new Map<string, number>() };
      unique.set(signature, { cells, mines });
      if (mines === 0 || mines === cells.length) {
        const value = Number(mines > 0);
        for (const key of cells) {
          if (known.has(key) && known.get(key) !== value)
            return { constraints: input, known: new Map<string, number>() };
          if (!known.has(key)) {
            known.set(key, value);
            changed = true;
          }
        }
      }
    }
    constraints = [...unique.values()];
    if (!changed && performance.now() < deadline && constraints.length < 4096) {
      const byCell = new Map<string, Constraint[]>();
      for (const c of constraints)
        for (const key of c.cells) {
          const list = byCell.get(key) ?? [];
          list.push(c);
          byCell.set(key, list);
        }
      let checks = 0;
      outer: for (const a of constraints) {
        for (const b of byCell.get(a.cells[0]) ?? []) {
          if (++checks > 12000 || performance.now() >= deadline) break outer;
          if (
            a.cells.length >= b.cells.length ||
            !a.cells.every((k) => b.cells.includes(k))
          )
            continue;
          const cells = b.cells.filter((k) => !a.cells.includes(k));
          const signature = cells.join(";");
          if (!unique.has(signature)) {
            const c = { cells, mines: b.mines - a.mines };
            unique.set(signature, c);
            changed = true;
            if (unique.size >= 4096) break outer;
          }
        }
      }
      constraints = [...unique.values()];
    }
    if (!changed) break;
  }
  // Remove proven variables even when the round budget was exhausted.
  return {
    known,
    constraints: constraints
      .map((c) => ({
        cells: c.cells.filter((k) => !known.has(k)),
        mines:
          c.mines - c.cells.reduce((sum, k) => sum + (known.get(k) ?? 0), 0),
      }))
      .filter((c) => c.cells.length),
  };
}
