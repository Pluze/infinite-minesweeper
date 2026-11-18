import { it, expect } from "vitest";
import { estimateRisks } from "./MineProbability";
import { reduceConstraints } from "./ConstraintReduction";

it("proves safe cells by subtracting overlapping clues in a large frontier", () => {
  const constraints = [
    { cells: ["a", "b"], mines: 1 },
    { cells: ["a", "b", "safe"], mines: 1 },
    {
      cells: ["safe", ...Array.from({ length: 30 }, (_, i) => "x" + i)],
      mines: 8,
    },
  ];
  const result = estimateRisks(constraints, 0.2);
  expect(result.risks.get("safe")).toBe(0);
  expect(result.approximate.has("safe")).toBe(false);
});
it("propagates certain mines and safe cells without sampling", () => {
  const r = estimateRisks(
    [
      { cells: ["a"], mines: 1 },
      { cells: ["a", "b"], mines: 1 },
    ],
    0.2,
  );
  expect(r.risks.get("a")).toBe(1);
  expect(r.risks.get("b")).toBe(0);
  expect(r.approximate.size).toBe(0);
});
it("does not report proofs from contradictory flags", () => {
  const r = reduceConstraints([
    { cells: ["a"], mines: 0 },
    { cells: ["a"], mines: 1 },
  ]);
  expect(r.known.size).toBe(0);
});
