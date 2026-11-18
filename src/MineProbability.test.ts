import * as sampling from "./ConstraintSampler";
import { frontierIndex } from "./FrontierIndex";
import { describe, it, expect, vi } from "vitest";
import { estimateRisks, MineProbability } from "./MineProbability";
import { Field } from "./Field";

describe("mine risk estimation", () => {
  it("combines overlapping clues with the board's mine prior", () => {
    const result = estimateRisks(
      [
        { cells: ["a", "b"], mines: 1 },
        { cells: ["b", "c"], mines: 1 },
      ],
      0.2,
    );
    expect(result.risks.get("b")).toBeCloseTo(0.8);
    expect(result.risks.get("a")).toBeCloseTo(0.2);
    expect(result.risks.get("c")).toBeCloseTo(0.2);
    expect(result.approximate.size).toBe(0);
  });
  it("deduces certainty from joint clues", () => {
    const result = estimateRisks(
      [
        { cells: ["a", "b"], mines: 1 },
        { cells: ["a", "b", "c"], mines: 1 },
      ],
      0.2,
    );
    expect(result.risks.get("c")).toBe(0);
  });
  it("solves a large symmetric single constraint analytically", () => {
    const result = estimateRisks(
      [{ cells: Array.from({ length: 30 }, (_, i) => String(i)), mines: 6 }],
      0.2,
    );
    expect(result.approximate.size).toBe(0);
    expect(result.risks.get("0")).toBeCloseTo(0.2);
  });
  it("does not use hidden mine locations and chooses the least expected loss", () => {
    const field = new Field(0.2, 0, "probability", "1");
    field.pristine = false;
    field._setCell(0, 0, { isOpen: true, isMine: false });
    field._setCell(1, 1, { isMine: true });
    let model = new MineProbability(field);
    expect(model.risk(field.getCell(1, 1))).toBeCloseTo(1 / 8);
    expect(model.risk(field.getCell(-1, -1))).toBeCloseTo(1 / 8);
    expect(model.guess({ x: 0, y: 0 })?.probability).toBeCloseTo(1 / 8);
    const expectedBefore = model.guess({ x: 0, y: 0 })!.expected;
    // Move the hidden mine while preserving the same visible clue.
    field._setCell(1, 1, { isMine: false });
    field._setCell(-1, -1, { isMine: true });
    model = new MineProbability(field);
    expect(model.risk(field.getCell(1, 1))).toBeCloseTo(1 / 8);
    expect(model.guess({ x: 0, y: 0 })?.expected).toBeCloseTo(expectedBefore);
  });
  it("prefers the unconstrained prior when the whole frontier is riskier", () => {
    const field = new Field(0.2, 0, "prior", "1");
    field.pristine = false;
    field._setCell(0, 0, { isOpen: true, isMine: false });
    for (const [x, y] of [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
    ])
      field._setCell(x, y, { isMine: true });
    const model = new MineProbability(field);
    expect(model.guess({ x: 0, y: 0 })?.probability).toBeLessThan(0.2);
  });
  it("invalidates probabilities after flags and opening cells", () => {
    const field = new Field(0.2, 0, "invalidate", "1");
    field.pristine = false;
    field._setCell(0, 0, { isOpen: true, isMine: false });
    field._setCell(1, 1, { isMine: true });
    const model = new MineProbability(field);
    expect(model.risk(field.getCell(-1, -1))).toBeCloseTo(1 / 8);
    field.flag(1, 1);
    expect(model.risk(field.getCell(-1, -1))).toBe(0);
  });
});

it("reuses sound safe proofs and invalidates them when flags are removed", () => {
  const field = new Field(0.2, 0, "proof-cache", "1");
  field.pristine = false;
  field._setCell(0, 0, { isOpen: true, isMine: false });
  const index = frontierIndex(field);
  const entries = new Map([
    [
      "one",
      {
        cell: field.getCell(0, 0),
        unknown: [field.getCell(1, 0), field.getCell(2, 0)],
        remaining: 1,
      },
    ],
    [
      "two",
      {
        cell: field.getCell(0, 0),
        unknown: [
          field.getCell(1, 0),
          field.getCell(2, 0),
          field.getCell(3, 0),
          field.getCell(4, 0),
        ],
        remaining: 1,
      },
    ],
  ]);
  vi.spyOn(index, "refresh").mockReturnValue(entries);
  const model = new MineProbability(field);
  const snapshot = vi.spyOn(model, "snapshot");
  const first = model.guess({ x: 0, y: 0 }, true)!;
  expect(first.probability).toBe(0);
  expect(model.isCertainSafe(first.cell)).toBe(true);
  expect(snapshot).not.toHaveBeenCalled();
  field._setCell(first.cell.x, 0, { isOpen: true, isMine: false });
  field.emit("cellChanged", field.getCell(first.cell.x, 0));
  const second = model.guess(first.cell, true)!;
  expect(second.cell.x).not.toBe(first.cell.x);
  expect(model.isCertainSafe(second.cell)).toBe(true);
  expect(snapshot).not.toHaveBeenCalled();
  field.emit("cellChanged", field.getCell(20, 20));
  expect(model.isCertainSafe(second.cell)).toBe(false);
  vi.restoreAllMocks();
});

it("focuses on complete island dependencies without hiding unrelated clues from a full snapshot", () => {
  const field = new Field(0.2, 0, "focused", "1");
  const a = field.getCell(1, 0),
    b = field.getCell(2, 0),
    c = field.getCell(3, 0),
    other = field.getCell(100, 0);
  const entries = new Map([
    ["one", { cell: field.getCell(0, 0), unknown: [a, b], remaining: 1 }],
    ["two", { cell: field.getCell(0, 1), unknown: [b, c], remaining: 1 }],
    [
      "unrelated",
      { cell: field.getCell(99, 0), unknown: [other], remaining: 0 },
    ],
  ]);
  vi.spyOn(frontierIndex(field), "refresh").mockReturnValue(entries);
  const model = new MineProbability(field);
  const focused = model.snapshot(new Set(["1,0"]));
  expect([...focused.risks.keys()].sort()).toEqual(["1,0", "2,0", "3,0"]);
  expect(focused.risks.get("2,0")).toBeCloseTo(0.8);
  expect(model.snapshot().risks.get("100,0")).toBe(0);
  vi.restoreAllMocks();
});

it("safe-only decisions do not spend time sampling uncertain components", () => {
  const field = new Field(0.2, 0, "proof-only", "1");
  const entries = new Map(
    Array.from({ length: 25 }, (_, i) => [
      String(i),
      {
        cell: field.getCell(i, 1),
        unknown: [field.getCell(i, 0), field.getCell(i + 1, 0)],
        remaining: 1,
      },
    ]),
  );
  vi.spyOn(frontierIndex(field), "refresh").mockReturnValue(entries);
  const sample = vi
    .spyOn(sampling, "sampleConstraints")
    .mockImplementation(() => {
      throw new Error("sampling should not run");
    });
  const model = new MineProbability(field);
  expect(model.guess({ x: 0, y: 1 }, true)).toBeUndefined();
  expect(sample).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
