import { it, expect, vi, afterEach } from "vitest";
vi.mock("./CellSprite", () => ({ CELL_WIDTH: 16 }));
import { Field } from "./Field";
import { probabilityModel } from "./MineProbability";
import { ProbabilityOverlay } from "./ProbabilityOverlay";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("draws camera changes on the board frame and retains previous visual estimates until replacement without recomputing inference", () => {
  const fills: string[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn((..._args: number[]): void => {
      fills.push(ctx.fillStyle);
    }),
  };
  const element = () => ({
    style: {},
    hidden: false,
    checked: true,
    width: 0,
    height: 0,
    setAttribute: vi.fn(),
    addEventListener: vi.fn(),
    getContext: () => ctx,
  });
  const toggle = element();
  vi.stubGlobal("document", {
    hidden: false,
    createElement: element,
    body: { appendChild: vi.fn() },
    documentElement: { addEventListener: vi.fn() },
    addEventListener: vi.fn(),
    querySelector: () => toggle,
  });
  vi.stubGlobal("window", {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: vi.fn(),
  });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const f = new Field(0.2, 0, "overlay-sync", "1");
  const model = probabilityModel(f);
  const snapshot = vi.spyOn(model, "snapshot").mockReturnValue({
    risks: new Map([
      ["1,0", 0],
      ["2,0", 1],
    ]),
    approximate: new Set(),
  });
  let camera = { x: 0, y: 0, k: 2 };
  new ProbabilityOverlay(f, () => camera);
  f.emit("renderFrame", 0);
  expect(fills.some((c) => c.includes("80,255,222"))).toBe(true);
  expect(fills.some((c) => c.includes("255,65,100"))).toBe(true);
  const calls = snapshot.mock.calls.length;
  ctx.clearRect.mockClear();
  camera = { x: 20, y: 10, k: 2 };
  f.emit("renderFrame", 1);
  expect(ctx.clearRect).toHaveBeenCalledOnce();
  expect(snapshot).toHaveBeenCalledTimes(calls);
  camera = { x: 20, y: 10, k: 0.2 };
  ctx.fillRect.mockClear();
  f.emit("renderFrame", 1.5);
  expect(
    ctx.fillRect.mock.calls.some(
      (args: unknown[]) => args[2] === 7 && args[3] === 7,
    ),
  ).toBe(true);
  camera = { x: 20, y: 10, k: 2 };
  f._setCell(1, 0, { isOpen: true, isMine: false });
  f.emit("cellChanged", f.getCell(1, 0));
  ctx.fillRect.mockClear();
  fills.length = 0;
  f.emit("renderFrame", 2);
  expect(ctx.fillRect).toHaveBeenCalled();
  expect(fills.some((c) => c.includes("255,65,100"))).toBe(true);
  expect(fills.some((c) => c.includes("80,255,222"))).toBe(false);
  expect(snapshot).toHaveBeenCalledTimes(calls);
  let worker: any;
  class FastWorker {
    onmessage?: (event: any) => void;
    postMessage = vi.fn();
    constructor() { worker = this; }
  }
  vi.stubGlobal("Worker", FastWorker);
  const rapid = new Field(.2, 0, "rapid", "1");
  new ProbabilityOverlay(rapid, () => camera);
  rapid.emit("renderFrame", 0);
  rapid.emit("cellChanged", rapid.getCell(0, 0));
  worker.onmessage({data: {risks: [["2,0", .2]], approximate: [], groups: [["2,0"]]}});
  rapid.emit("renderFrame", 16);
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  rapid.emit("renderFrame", 120);
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
});
