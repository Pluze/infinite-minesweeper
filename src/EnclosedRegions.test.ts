import { describe, it, expect, vi, afterEach } from "vitest";
import { EnclosedRegions } from "./EnclosedRegions";
import { Field } from "./Field";
import { boardGeometry } from "./BoardGeometry";
import { frontierIndex } from "./FrontierIndex";
import { probabilityModel } from "./MineProbability";
import { findNumberMove } from "./AutoPlayer";
afterEach(() => {
  vi.useRealTimers();
});
const ring = () => {
  const points: { x: number; y: number }[] = [];
  for (let y = -3; y <= 3; y++)
    for (let x = -3; x <= 3; x++)
      if (Math.abs(x) === 3 || Math.abs(y) === 3) points.push({ x, y });
  return points;
};
describe("enclosed unknown islands", () => {
  it("distinguishes an enclosed island from an open concavity", () => {
    expect(new EnclosedRegions(ring()).contains({ x: 0, y: 0 })).toBe(true);
    const open = ring().filter((p) => p.x !== 0 || p.y !== -3);
    expect(new EnclosedRegions(open).contains({ x: 0, y: 0 })).toBe(false);
    expect(new EnclosedRegions(ring()).contains({ x: 3, y: 3 })).toBe(false);
  });
  it("matches a four-neighbor exterior flood-fill on irregular boards", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let trial = 0; trial < 60; trial++) {
      const filled = new Set<string>(),
        points: { x: number; y: number }[] = [];
      for (let y = -4; y <= 4; y++)
        for (let x = -4; x <= 4; x++)
          if (random() < 0.62) {
            points.push({ x, y });
            filled.add(`${x},${y}`);
          }
      const outside = new Set(["-5,-5"]),
        queue = [{ x: -5, y: -5 }];
      for (let i = 0; i < queue.length; i++)
        for (const [dx, dy] of [
          [0, 1],
          [0, -1],
          [1, 0],
          [-1, 0],
        ]) {
          const x = queue[i].x + dx,
            y = queue[i].y + dy,
            key = `${x},${y}`;
          if (
            x < -5 ||
            x > 5 ||
            y < -5 ||
            y > 5 ||
            filled.has(key) ||
            outside.has(key)
          )
            continue;
          outside.add(key);
          queue.push({ x, y });
        }
      const regions = new EnclosedRegions(points);
      for (let y = -4; y <= 4; y++)
        for (let x = -4; x <= 4; x++)
          expect(regions.contains({ x, y })).toBe(
            !filled.has(`${x},${y}`) && !outside.has(`${x},${y}`),
          );
    }
  });
  it("handles huge empty gaps without allocating the bounding-box area", () => {
    const regions = new EnclosedRegions([
      { x: 0, y: 0 },
      { x: 1e9, y: 1e9 },
    ]);
    expect(regions.contains({ x: 5e8, y: 5e8 })).toBe(false);
  });
  it("rebuilds immediately when a neck closes or a flag reopens it", () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const f = new Field(0.2, 0, "neck", "1");
    f.pristine = false;
    for (const p of ring().filter((p) => p.x !== 0 || p.y !== -3))
      f._setCell(p.x, p.y, { isOpen: true, isMine: false });
    const shape = boardGeometry(f);
    shape.prepare({ x: 3, y: 0 });
    expect(shape.islandPriority([{ x: 0, y: 0 }])).toBe(0);
    f.flag(0, -3);
    shape.prepare({ x: 3, y: 0 });
    expect(shape.islandPriority([{ x: 0, y: 0 }])).toBe(2);
    f.flag(0, -3);
    shape.prepare({ x: 3, y: 0 });
    expect(shape.islandPriority([{ x: 0, y: 0 }])).toBe(0);
  });
  it("clears a distant internal island before a frontier nearer the centroid", () => {
    const f = new Field(0.2, 0, "priority", "1");
    f.pristine = false;
    for (let y = 0; y <= 10; y++)
      for (let x = 0; x <= 100; x++)
        if (x !== 90 || y !== 5)
          f._setCell(x, y, { isOpen: true, isMine: false });
    const chosen = findNumberMove(f, { x: 50, y: 0 })!;
    expect(Math.abs(chosen.x - 90)).toBeLessThanOrEqual(1);
    expect(Math.abs(chosen.y - 5)).toBeLessThanOrEqual(1);
    // A resolved island no longer blocks outward progress.
    f._setCell(90, 5, { isOpen: true, isMine: false });
    f.emit("cellChanged", f.getCell(90, 5));
    const next = findNumberMove(f, { x: 50, y: 0 })!;
    expect(
      next.x === 0 || next.x === 100 || next.y === 0 || next.y === 10,
    ).toBe(true);
  });
});

it("does not bypass an uncertain island for a deterministic exterior move", () => {
  const f = new Field(0.2, 0, "strict-island", "1");
  f.pristine = false;
  for (const p of ring()) f._setCell(p.x, p.y, { isOpen: true, isMine: false });
  const inner = [f.getCell(0, 0), f.getCell(1, 0)];
  const entries = new Map([
    ["0,3", { cell: f.getCell(0, 3), unknown: inner, remaining: 1 }],
    [
      "0,-3",
      { cell: f.getCell(0, -3), unknown: [f.getCell(0, -4)], remaining: 0 },
    ],
  ]);
  vi.spyOn(frontierIndex(f), "refresh").mockReturnValue(entries);
  expect(findNumberMove(f, { x: 0, y: 3 })).toBeUndefined();
  expect(findNumberMove(f, { x: 0, y: 3 }, false)).toEqual(
    entries.get("0,-3")!.cell,
  );
  const model = probabilityModel(f);
  vi.spyOn(model, "snapshot").mockReturnValue({
    risks: new Map([
      ["0,0", 0.5],
      ["1,0", 0.5],
      ["0,-4", 0],
    ]),
    approximate: new Set(),
  });
  const guess = model.guess({ x: 0, y: 3 })!;
  expect(boardGeometry(f).islandPriority([guess.cell])).toBe(2);
  // An unconstrained cell inside the island is safer than its 50% boundary.
  expect(guess.probability).toBe(model.prior(guess.cell.x, guess.cell.y));
  expect(model.guess({ x: 0, y: 3 }, true)?.cell).toEqual(f.getCell(0, -4));
  // Remove the exact clue/proof before testing an approximate-only zero.
  entries.set("0,-3", {
    cell: f.getCell(0, -3),
    unknown: [f.getCell(0, -4), f.getCell(1, -4)],
    remaining: 1,
  });
  f.emit("cellChanged", f.getCell(0, -4));
  vi.mocked(model.snapshot).mockReturnValue({
    risks: new Map([["0,-4", 0]]),
    approximate: new Set(["0,-4"]),
  });
  expect(model.guess({ x: 0, y: 3 }, true)).toBeUndefined();
});

it("keeps island classification when a hole is filled or split without rebuilding", () => {
  const f = new Field(0.2, 0, "incremental-hole", "1");
  f.pristine = false;
  for (const p of ring()) f._setCell(p.x, p.y, { isOpen: true, isMine: false });
  const shape = boardGeometry(f);
  shape.prepare({ x: 3, y: 0 });
  const builds = shape.stats.enclosureBuilds;
  for (let y = -2; y <= 2; y++) {
    f._setCell(0, y, { isOpen: true, isMine: false });
    f.emit("cellChanged", f.getCell(0, y));
    shape.prepare({ x: 3, y: 0 });
    expect(shape.islandPriority([{ x: -1, y: 0 }])).toBe(2);
    expect(shape.islandPriority([{ x: 1, y: 0 }])).toBe(2);
  }
  expect(shape.stats.enclosureBuilds).toBe(builds);
  expect(shape.islandPriority([{ x: 0, y: 0 }])).toBe(0);
});
