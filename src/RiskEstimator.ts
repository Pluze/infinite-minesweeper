import { reduceConstraints } from "./ConstraintReduction";
import { sampleConstraints } from "./ConstraintSampler";
export type Constraint = { cells: string[]; mines: number };
export const cellKey = (x: number, y: number) => `${x},${y}`;

/** Enumerate independent components with Bernoulli-prior weighting. Never use
 * partial enumeration as a probability: fall back to a labeled approximation. */
export type RiskCache = Map<
  string,
  { risks: [string, number][]; approximate: string[] }
>;
export function estimateRisks(
  constraints: Constraint[],
  prior: number,
  cache?: RiskCache,
  localPrior?: (key: string) => number,
  proofOnly = false,
) {
  const reduced = reduceConstraints(constraints);
  constraints = reduced.constraints;
  const risks = new Map<string, number>(reduced.known);
  const approximate = new Set<string>();
  const byCell = new Map<string, Constraint[]>();
  for (const c of constraints)
    for (const key of c.cells) {
      const list = byCell.get(key) ?? [];
      list.push(c);
      byCell.set(key, list);
    }
  const visited = new Set<string>();
  let budget = 80000;
  const started = performance.now();
  const exactDeadline = started + 6;
  const deadline = started + 12;
  for (const first of byCell.keys()) {
    if (visited.has(first)) continue;
    const keys: string[] = [];
    const group = new Set<Constraint>();
    const queue = [first];
    visited.add(first);
    for (let i = 0; i < queue.length; i++) {
      const key = queue[i];
      keys.push(key);
      for (const c of byCell.get(key)!) {
        group.add(c);
        for (const next of c.cells)
          if (!visited.has(next)) {
            visited.add(next);
            queue.push(next);
          }
      }
    }
    const priors = new Map(
      keys.map((key) => [key, localPrior?.(key) ?? prior]),
    );
    const signature = cache
      ? `${prior}:${[...priors]
          .sort()
          .map(([k, p]) => k + "=" + p)
          .join(";")}:` +
        [...group]
          .map((c) => `${c.mines}:${[...c.cells].sort().join(";")}`)
          .sort()
          .join("|")
      : "";
    const saved = cache?.get(signature);
    if (saved) {
      for (const [key, risk] of saved.risks) risks.set(key, risk);
      for (const key of saved.approximate) approximate.add(key);
      continue;
    }
    // Exchangeable variables under one clue have an analytic marginal.
    const only = [...group][0];
    if (
      group.size === 1 &&
      only.mines >= 0 &&
      only.mines <= keys.length &&
      keys.every((key) => priors.get(key) === priors.get(keys[0]))
    ) {
      for (const key of keys) risks.set(key, only.mines / keys.length);
      continue;
    }
    keys.sort((a, b) => byCell.get(b)!.length - byCell.get(a)!.length);
    let total = 0;
    const sums = new Array<number>(keys.length).fill(0);
    const assigned = new Map<string, number>();
    let aborted = keys.length > 22 || budget <= 0;
    const enumerate = (index: number, weight: number) => {
      if (aborted) return;
      if (
        --budget < 0 ||
        (budget % 256 === 0 && performance.now() > exactDeadline)
      ) {
        aborted = true;
        return;
      }
      if (index === keys.length) {
        total += weight;
        keys.forEach((key, i) => {
          sums[i] += assigned.get(key)! * weight;
        });
        return;
      }
      const key = keys[index];
      for (const value of [0, 1]) {
        assigned.set(key, value);
        const valid = byCell.get(key)!.every((c) => {
          let mines = 0,
            unknown = 0;
          for (const k of c.cells) {
            const v = assigned.get(k);
            if (v === undefined) unknown++;
            else mines += v;
          }
          return mines <= c.mines && mines + unknown >= c.mines;
        });
        if (valid) {
          const p = priors.get(key)!;
          enumerate(index + 1, weight * (value ? p : 1 - p));
        }
        assigned.delete(key);
      }
    };
    if (!aborted) enumerate(0, 1);
    const sampled =
      aborted && !proofOnly
        ? sampleConstraints(keys, [...group], priors, deadline)
        : undefined;
    keys.forEach((key, i) => {
      if (!aborted && total > 0) risks.set(key, sums[i] / total);
      else {
        // Conservative local estimate, not an exact posterior.
        const local = byCell.get(key)!.map((c) => c.mines / c.cells.length);
        const fallback = Math.max(
          0.01,
          Math.min(0.99, (Math.max(...local) * 4 + priors.get(key)!) / 5),
        );
        const sample = sampled?.risks.get(key);
        const confidence = sampled
          ? sampled.effective / (sampled.effective + 16)
          : 0;
        risks.set(
          key,
          sample === undefined
            ? fallback
            : Math.max(
                0.001,
                Math.min(
                  0.999,
                  confidence * sample + (1 - confidence) * fallback,
                ),
              ),
        );
        approximate.add(key);
      }
    });
    if (cache && (!aborted || sampled)) {
      cache.set(signature, {
        risks: keys.map((key) => [key, risks.get(key)!]),
        approximate: keys.filter((key) => approximate.has(key)),
      });
      if (cache.size > 512) cache.delete(cache.keys().next().value!);
    }
  }
  return { risks, approximate };
}
