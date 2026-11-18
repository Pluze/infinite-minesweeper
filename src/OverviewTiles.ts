import * as PIXI from "pixi.js";
import { CELL_WIDTH } from "./CellSprite";
export const TILE_CELLS = 64;
/** One texture per 4096 cells; upload only chunks changed in this frame. */
export class OverviewTiles {
  private tiles = new Map<
    string,
    { context: CanvasRenderingContext2D; texture: PIXI.Texture }
  >();
  private dirty = new Set<PIXI.Texture>();
  constructor(private layer: PIXI.Container) {}
  set(x: number, y: number, color: number) {
    const cx = Math.floor(x / TILE_CELLS),
      cy = Math.floor(y / TILE_CELLS),
      key = `${cx},${cy}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = TILE_CELLS;
      const context = canvas.getContext("2d")!;
      const texture = PIXI.Texture.from(canvas);
      texture.source.scaleMode = "nearest";
      const sprite = new PIXI.Sprite(texture);
      sprite.position.set(
        cx * TILE_CELLS * CELL_WIDTH,
        cy * TILE_CELLS * CELL_WIDTH,
      );
      sprite.width = sprite.height = TILE_CELLS * CELL_WIDTH;
      this.layer.addChild(sprite);
      tile = { context, texture };
      this.tiles.set(key, tile);
    }
    tile.context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    tile.context.fillRect(x - cx * TILE_CELLS, y - cy * TILE_CELLS, 1, 1);
    this.dirty.add(tile.texture);
  }
  flush() {
    for (const texture of this.dirty) texture.source.update();
    this.dirty.clear();
  }
}
