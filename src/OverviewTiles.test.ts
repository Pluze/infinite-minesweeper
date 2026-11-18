import { it, expect, vi, afterEach } from "vitest";
vi.mock("./CellSprite", () => ({ CELL_WIDTH: 16 }));
vi.mock("pixi.js", () => ({
  Texture: {
    from: vi.fn(() => ({ source: { scaleMode: "", update: vi.fn() } })),
  },
  Sprite: class {
    position = { set: vi.fn() };
    width = 0;
    height = 0;
    constructor(public texture: unknown) {}
  },
}));
import { OverviewTiles } from "./OverviewTiles";
import * as PIXI from "pixi.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("groups 4096 cells into one texture and uploads changed chunks once", () => {
  const paint = vi.fn();
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect: paint, fillStyle: "" }),
    }),
  });
  const layer = { addChild: vi.fn() },
    overview = new OverviewTiles(layer as unknown as PIXI.Container);
  overview.set(0, 0, 0xff0000);
  overview.set(63, 63, 0x00ff00);
  overview.set(-1, -1, 0x0000ff);
  expect(layer.addChild).toHaveBeenCalledTimes(2);
  expect(paint).toHaveBeenCalledWith(63, 63, 1, 1);
  overview.flush();
  overview.flush();
  for (const result of vi.mocked(PIXI.Texture.from).mock.results)
    expect(result.value.source.update).toHaveBeenCalledOnce();
});
