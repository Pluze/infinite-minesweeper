import { expect, it } from "vitest";
import { Field } from "./Field";
import { LocalMineDensity } from "./LocalMineDensity";
import { estimateRisks } from "./MineProbability";

it("uses only nearby observed cells and updates when a flag is removed", () => {
  const field = new Field(0.2, 0, "density-prior", "1");
  field.pristine = false;
  field._setCell(1, 1, { isMine: true });
  const model = new LocalMineDensity(field);
  expect(model.prior(0, 0)).toBe(0.2);
  field.flag(1, 1);
  expect(model.prior(0, 0)).toBeGreaterThan(0.2);
  expect(model.prior(100, 100)).toBe(0.2);
  field.flag(1, 1);
  expect(model.prior(0, 0)).toBe(0.2);
  field._setCell(2, 2, { isOpen: true, isMine: false });
  field.emit("cellChanged", field.getCell(2, 2));
  expect(model.prior(0, 0)).toBeLessThan(0.2);
});

it("weights valid layouts by local priors without changing exact deductions or reusing stale cache", () => {
  const cache = new Map();
  const constraints = [
    { cells: ["a", "b"], mines: 1 },
    { cells: ["a", "b", "c"], mines: 1 },
  ];
  const first = estimateRisks(constraints, 0.2, cache, (key) =>
    key === "a" ? 0.8 : 0.2,
  );
  expect(first.risks.get("a")).toBeCloseTo(16 / 17);
  expect(first.risks.get("c")).toBe(0);
  const second = estimateRisks(constraints, 0.2, cache, (key) =>
    key === "b" ? 0.8 : 0.2,
  );
  expect(second.risks.get("b")).toBeCloseTo(16 / 17);
  expect(second.risks.get("c")).toBe(0);
});
