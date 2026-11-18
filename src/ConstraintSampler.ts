import type { Constraint } from "./RiskEstimator";

/** Sequential importance sampling: reject dead ends, weight by target/proposal.
 * Samples are never proofs, even when every accepted layout agrees. */
export function sampleConstraints(
  keys: string[],
  constraints: Constraint[],
  priors: Map<string, number>,
  deadline: number,
  random = Math.random,
  attempts = 256,
) {
  if (keys.length > 128 || performance.now() >= deadline) return;
  const ids = new Map(keys.map((key, i) => [key, i]));
  const groups = constraints.map((c) => ({
    ids: c.cells.map((k) => ids.get(k)!),
    mines: c.mines,
  }));
  const memberships = keys.map((_, i) =>
    groups.flatMap((g, j) => (g.ids.includes(i) ? [j] : [])),
  );
  const sums = new Float64Array(keys.length);
  let total = 0,
    squared = 0,
    accepted = 0,
    scale = -Infinity;
  for (
    let trial = 0;
    trial < attempts && performance.now() < deadline;
    trial++
  ) {
    const remaining = groups.map((g) => g.ids.length),
      needed = groups.map((g) => g.mines);
    const values = new Uint8Array(keys.length);
    let logWeight = 0,
      valid = true;
    for (let i = 0; i < keys.length; i++) {
      const allow = [0, 1].map((v) =>
        memberships[i].every(
          (j) => needed[j] - v >= 0 && needed[j] - v <= remaining[j] - 1,
        ),
      );
      if (!allow[0] && !allow[1]) {
        valid = false;
        break;
      }
      const p = Math.max(0.001, Math.min(0.999, priors.get(keys[i])!));
      const forced = !allow[0] || !allow[1];
      const value = forced ? Number(allow[1]) : Number(random() < p);
      values[i] = value;
      // Unforced proposals match the Bernoulli prior and cancel in the ratio.
      if (forced) logWeight += Math.log(value ? p : 1 - p);
      for (const j of memberships[i]) {
        remaining[j]--;
        needed[j] -= value;
      }
    }
    if (!valid || needed.some((n) => n !== 0)) continue;
    if (logWeight > scale) {
      const factor = Math.exp(scale - logWeight);
      total *= factor;
      squared *= factor * factor;
      for (let i = 0; i < sums.length; i++) sums[i] *= factor;
      scale = logWeight;
    }
    const w = Math.exp(logWeight - scale);
    total += w;
    squared += w * w;
    accepted++;
    for (let i = 0; i < keys.length; i++) sums[i] += w * values[i];
  }
  const effective = (total * total) / squared;
  if (accepted < 16 || effective < 12) return;
  return {
    risks: new Map(keys.map((key, i) => [key, sums[i] / total])),
    effective,
    accepted,
  };
}
