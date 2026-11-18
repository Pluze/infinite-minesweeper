import { it, expect } from "vitest";
import seedrandom from "seedrandom";
import { sampleConstraints } from "./ConstraintSampler";
it("matches a known weighted posterior and only samples legal layouts", () => {
  const keys = ["a", "b", "c"],
    priors = new Map(keys.map((k) => [k, 0.2]));
  const result = sampleConstraints(
    keys,
    [
      { cells: ["a", "b"], mines: 1 },
      { cells: ["b", "c"], mines: 1 },
    ],
    priors,
    Infinity,
    seedrandom("sample"),
    5000,
  )!;
  expect(result.risks.get("b")).toBeCloseTo(0.8, 1);
  expect(result.risks.get("a")! + result.risks.get("b")!).toBeCloseTo(1);
  expect(result.risks.get("a")).toBe(result.risks.get("c"));
  expect(result.effective).toBeGreaterThan(12);
});
it("falls back on exhausted budgets, oversized or inconsistent components", () => {
  expect(
    sampleConstraints(
      ["a"],
      [{ cells: ["a"], mines: 2 }],
      new Map([["a", 0.2]]),
      Infinity,
    ),
  ).toBeUndefined();
  expect(
    sampleConstraints(["a"], [], new Map([["a", 0.2]]), 0),
  ).toBeUndefined();
  expect(
    sampleConstraints(
      Array.from({ length: 129 }, (_, i) => String(i)),
      [],
      new Map(),
      Infinity,
    ),
  ).toBeUndefined();
});
