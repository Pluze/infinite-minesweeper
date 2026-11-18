import {
  estimateRisks,
  type Constraint,
  type RiskCache,
} from "./RiskEstimator";
import {
  ConstraintPartitions,
  type ConstraintPartition,
} from "./ConstraintPartitions";
const riskCache: RiskCache = new Map();
let graph = new ConstraintPartitions();
const cache = new WeakMap<
  ConstraintPartition,
  { priors: number[]; result: ReturnType<typeof estimateRisks> }
>();
const values = new Map<string, number>();
const bucketKeys = new Map<string, string>();
const bucket = (key: string) => {
  let found = bucketKeys.get(key);
  if (found === undefined) {
    const [x, y] = key.split(",").map(Number);
    found = `${Math.floor(x / 8)},${Math.floor(y / 8)}`;
    bucketKeys.set(key, found);
  }
  return found;
};
self.onmessage = (
  event: MessageEvent<{
    updates: [string, Constraint | null][];
    reset?: boolean;
    prior: number;
    bucketPriors: [string, number][];
  }>,
) => {
  const { updates, prior, bucketPriors } = event.data;
  if (event.data.reset) {
    graph = new ConstraintPartitions();
    values.clear(); bucketKeys.clear(); riskCache.clear();
  }
  for (const [key, p] of bucketPriors) values.set(key, p);
  graph.update(new Map(updates.map(([key, value]) => [key, value ?? undefined])));
  const risks = new Map<string, number>(),
    approximate = new Set<string>();
  const groups: string[][] = [];
  for (const group of graph.groups) {
    const keys = [...group.cells],
      local = keys.map((key) => values.get(bucket(key)) ?? prior);
    let saved = cache.get(group);
    if (!saved || saved.priors.some((p, i) => p !== local[i])) {
      saved = {
        priors: local,
        result: estimateRisks(
          [...group.clues].map((key) => graph.constraints.get(key)!),
          prior,
          riskCache,
          (key) => values.get(bucket(key)) ?? prior,
        ),
      };
      cache.set(group, saved);
    }
    groups.push(keys);
    for (const [key, p] of saved.result.risks) risks.set(key, p);
    for (const key of saved.result.approximate) approximate.add(key);
  }
  const activeCells = new Set<string>();
  const activeBuckets = new Set<string>();
  for (const group of graph.groups) for (const key of group.cells) {
    activeCells.add(key); activeBuckets.add(bucket(key));
  }
  for (const key of bucketKeys.keys()) if (!activeCells.has(key)) bucketKeys.delete(key);
  for (const key of values.keys()) if (!activeBuckets.has(key)) values.delete(key);
  self.postMessage({
    risks: [...risks],
    approximate: [...approximate],
    groups,
  });
};
