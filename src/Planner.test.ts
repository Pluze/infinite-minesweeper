import { describe, it, expect, vi } from "vitest";
import { Field } from "./Field";
import { frontierIndex } from "./FrontierIndex";
import { boardGeometry, BoardGeometry, topologyPenalty } from "./BoardGeometry";
import { findNumberMove } from "./AutoPlayer";

const fullScan = (field: Field) =>
  field.getAll().filter((c) => {
    if (!c.isOpen || c.isMine) return false;
    const ns = field.getNeighbors(c.x, c.y),
      unknown = ns.filter((n) => !n.isOpen && !n.isFlagged);
    const remaining =
      field.value(c.x, c.y)! -
      ns.filter((n) => n.isFlagged || (n.isOpen && n.isMine)).length;
    return unknown.length && (remaining === 0 || remaining === unknown.length);
  });

describe("incremental planner", () => {
  it("matches a full legality scan after opening, flagging, and unflagging", () => {
    const f = new Field(0.2, 3, "index", "1");
    f.open(1, 1);
    const index = frontierIndex(f);
    for (let i = 0; i < 80; i++) {
      const entries = [...index.refresh().values()].filter(
        (e) => e.remaining === 0 || e.remaining === e.unknown.length,
      );
      const keys = (cells: { x: number; y: number }[]) =>
        cells.map((c) => `${c.x},${c.y}`).sort();
      expect(keys(entries.map((e) => e.cell))).toEqual(keys(fullScan(f)));
      if (!entries.length) break;
      const c = entries[0].cell;
      f.open(c.x, c.y);
      if (i % 5 === 0) {
        const closed = f.getAll().find((c) => !c.isOpen && !c.isFlagged);
        if (closed) {
          f.flag(closed.x, closed.y);
          index.refresh();
          f.flag(closed.x, closed.y);
        }
      }
    }
  });
  it("updates at most neighboring clues without reading the whole board again", () => {
    const f = new Field(0.2, 3, "local", "1");
    f.open(1, 1);
    const index = frontierIndex(f);
    index.refresh();
    const all = vi.spyOn(f, "getAll"),
      neighbors = vi.spyOn(f, "getNeighbors");
    f.flag(2, 5);
    index.refresh();
    expect(all).not.toHaveBeenCalled();
    expect(neighbors.mock.calls.length).toBeLessThanOrEqual(9);
  });
  it("uses the current component's centroid, not the global bounding box", () => {
    const f = new Field(0.2, 0, "shape", "1");
    f.pristine = false;
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [0, 2],
      [100, 100],
      [101, 100],
    ])
      f._setCell(x, y, { isOpen: true, isMine: false });
    const shape = new BoardGeometry(f);
    shape.prepare({ x: 0, y: 0 });
    expect(shape.centroid()).toEqual({ x: 0.6, y: 0.6 });
    expect(shape.weight({ x: 1, y: 1 })).toBeLessThan(
      shape.weight({ x: -1, y: 0 }),
    );
    shape.prepare({ x: 100, y: 100 });
    expect(shape.centroid()).toEqual({ x: 100.5, y: 100 });
  });
  it("penalizes an isolated island but permits finishing an existing hole", () => {
    expect(topologyPenalty({ x: 0, y: 0 }, () => false)).toBeGreaterThan(0);
    expect(topologyPenalty({ x: 0, y: 0 }, () => true)).toBe(0);
    expect(topologyPenalty({ x: 0, y: 0 }, (x) => x < 0)).toBe(0);
    expect(topologyPenalty({ x: 0, y: 0 }, (x) => x !== 0)).toBeGreaterThan(0);
  });
  it("benchmarks cached selection against repeated full-board scanning", () => {
    const f = new Field(0.2, 0, "benchmark", "1");
    f.pristine = false;
    for (let y = 0; y < 100; y++)
      for (let x = 0; x < 100; x++)
        f._setCell(x, y, { isOpen: true, isMine: false });
    findNumberMove(f, { x: 50, y: 50 });
    let start = performance.now();
    for (let i = 0; i < 20; i++) fullScan(f);
    const fullMs = performance.now() - start;
    start = performance.now();
    for (let i = 0; i < 20; i++) findNumberMove(f, { x: 50, y: 50 });
    const cachedMs = performance.now() - start;
    console.log(
      `10,000-cell board, 20 selections: full scan ${fullMs.toFixed(1)}ms; cached geometry planner ${cachedMs.toFixed(1)}ms`,
    );
    expect(findNumberMove(f)).toBeDefined();
  });
});

it("updates a 150,000-cell component incrementally as its frontier grows", () => {
  const f = new Field(0.2, 0, "large-growth", "1");
  f.pristine = false;
  for (let y = 0; y < 300; y++)
    for (let x = 0; x < 500; x++)
      f._setCell(x, y, { isOpen: true, isMine: false });
  const geometry = new BoardGeometry(f);
  geometry.prepare({ x: 499, y: 150 });
  const known = frontierIndex(f).known;
  const scan = vi.spyOn(known, "values");
  const start = performance.now();
  for (let y = 100; y < 150; y++) {
    f._setCell(500, y, { isOpen: true, isMine: false });
    f.emit("cellChanged", f.getCell(500, y));
    geometry.prepare({ x: 500, y });
  }
  console.log(
    `150,000-cell board: 50 frontier additions + geometry updates ${(performance.now() - start).toFixed(1)}ms`,
  );
  expect(scan).not.toHaveBeenCalled();
  // Merging with a separate component still rebuilds and includes it.
  f._setCell(502, 125, { isOpen: true, isMine: false });
  f.emit("cellChanged", f.getCell(502, 125));
  geometry.prepare({ x: 500, y: 125 });
  f._setCell(501, 125, { isOpen: true, isMine: false });
  f.emit("cellChanged", f.getCell(501, 125));
  geometry.prepare({ x: 501, y: 125 });
  expect(geometry.centroid().x).toBeGreaterThan(249.5);
});

it("finishes the active region, but yields to an enclosed island and leaves exhausted regions", () => {
  const f = new Field(0.2, 0, "regions", "1");
  const index = frontierIndex(f);
  const geometry = boardGeometry(f);
  vi.spyOn(geometry, "prepare").mockImplementation(() => {});
  vi.spyOn(geometry, "rank").mockImplementation((cells) => cells[0].x);
  let islandX = Infinity;
  vi.spyOn(geometry, "islandPriority").mockImplementation((cells) =>
    cells[0].x === islandX ? 2 : 0,
  );
  const make = (x: number) => {
    const cell = f.getCell(x, 0)!;
    return { cell, unknown: [cell], remaining: 0 };
  };
  const entries = new Map([
    ["1,0", make(1)],
    ["2,0", make(2)],
    ["30,0", make(30)],
  ]);
  vi.spyOn(index, "refresh").mockReturnValue(entries);
  expect(findNumberMove(f)?.x).toBe(1);
  entries.delete("1,0");
  index.changedEntries.add("1,0");
  // A new globally better candidate must not interrupt this region.
  entries.set("-1,0", make(-1));
  index.changedEntries.add("-1,0");
  expect(findNumberMove(f, { x: 1, y: 0 })?.x).toBe(2);
  islandX = 30;
  geometry.version++;
  expect(findNumberMove(f, { x: 2, y: 0 })?.x).toBe(30);
  entries.delete("30,0");
  index.changedEntries.add("30,0");
  expect(findNumberMove(f, { x: 30, y: 0 })?.x).toBe(-1);
});

it("does not invalidate all candidate heaps when only soft hull weights refresh", () => {
  const f = new Field(0.2, 0, "hull-growth", "1");
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++)
      f._setCell(x, y, { isOpen: true, isMine: false });
  const clock = vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    const geometry = new BoardGeometry(f);
    geometry.prepare({x: 9, y: 5});
    const version = geometry.version;
    f._setCell(10, 5, {isOpen: true, isMine: false});
    f.emit("cellChanged", f.getCell(10, 5));
    clock.mockReturnValue(200);
    geometry.prepare({x: 10, y: 5});
    expect(geometry.version).toBe(version);
    expect(geometry.centroid().x).toBeGreaterThan(4.5);
  } finally { clock.mockRestore(); }
});
