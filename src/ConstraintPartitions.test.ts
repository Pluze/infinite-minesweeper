import { expect, it } from "vitest";
import { ConstraintPartitions } from "./ConstraintPartitions";
import { estimateRisks, type Constraint } from "./RiskEstimator";
it("merges and splits dependencies across arbitrary spatial tile boundaries", () => {
  const graph = new ConstraintPartitions();
  graph.update(
    new Map([
      ["left", { cells: ["31,0", "32,0"], mines: 1 }],
      ["right", { cells: ["33,0", "34,0"], mines: 1 }],
      ["remote", { cells: ["1000,0"], mines: 0 }],
    ]),
  );
  const remote = [...graph.selected(new Set(["1000,0"]))][0];
  graph.update(new Map([["bridge", { cells: ["32,0", "33,0"], mines: 1 }]]));
  expect(graph.groups.size).toBe(2);
  expect([...graph.selected(new Set(["31,0"]))][0].cells.size).toBe(4);
  expect(graph.groups.has(remote)).toBe(true);
  graph.update(new Map([["bridge", undefined]]));
  expect(graph.groups.size).toBe(3);
  expect(graph.groups.has(remote)).toBe(true);
});
it("matches a fresh component reconstruction through repeated additions and deletions", () => {
  const graph = new ConstraintPartitions(),
    current = new Map<string, Constraint>();
  const normalized = (g: ConstraintPartitions) =>
    [...g.groups].map((p) => [...p.cells].sort().join(";")).sort();
  for (let i = 0; i < 160; i++) {
    const key = String((i * 13) % 37);
    const next =
      i % 4
        ? { cells: [String(i % 17), String((i * 7) % 19)], mines: 1 }
        : undefined;
    if (next) current.set(key, next);
    else current.delete(key);
    graph.update(new Map([[key, next]]));
    const fresh = new ConstraintPartitions();
    fresh.update(current);
    expect(normalized(graph)).toEqual(normalized(fresh));
  }
});
it("preserves joint deductions at a grid boundary", () => {
  const graph = new ConstraintPartitions();
  const constraints = [
    { cells: ["31,0", "32,0"], mines: 1 },
    { cells: ["31,0", "32,0", "33,0"], mines: 1 },
  ];
  graph.update(new Map(constraints.map((c, i) => [String(i), c])));
  const group = [...graph.selected(new Set(["33,0"]))][0];
  const result = estimateRisks(
    [...group.clues].map((id) => graph.constraints.get(id)!),
    0.2,
  );
  expect(result.risks.get("33,0")).toBe(0);
  expect(result.approximate.has("33,0")).toBe(false);
});
it("benchmarks local updates against rebuilding every component", () => {
  const initial = new Map<string, Constraint>();
  for (let i = 0; i < 2000; i++)
    initial.set(String(i), {
      cells: [`${i * 4},0`, `${i * 4 + 1},0`],
      mines: 1,
    });
  const incremental = new ConstraintPartitions();
  incremental.update(initial);
  const t = performance.now();
  for (let i = 0; i < 100; i++)
    incremental.update(
      new Map([[String(i), { cells: [`${i * 4},0`], mines: 0 }]]),
    );
  const localMs = performance.now() - t;
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    const full = new ConstraintPartitions();
    full.update(initial);
  }
  console.log(
    `2,000 independent regions / 100 updates: incremental ${localMs.toFixed(2)} ms; full rebuild ${(performance.now() - start).toFixed(2)} ms`,
  );
  expect(incremental.groups.size).toBe(2000);
});
