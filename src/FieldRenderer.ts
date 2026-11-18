import { LoadBudget } from "./LoadingScreen";
import { OverviewTiles, TILE_CELLS } from "./OverviewTiles";
import { renderQuality } from "./RenderQuality";
/**
 * Created by sisc0606 on 19.08.2017.
 */

import * as PIXI from "pixi.js";
import { getTextures } from "./Textures.js";
import { Controls } from "./Controls";
import { CellSprite, numberToNeighborCount, overviewColor } from "./CellSprite";
import { Cell } from "./Cell.js";
import { Field } from "./Field.js";
import { FieldPersistence } from "./FieldPersistence.js";

// todo bug: when i open a mine, and the mine has only a single neighbor which is a closed mine, then right pressing the mine flags the
type CellSprites = Record<
  number,
  Record<number, CellSprite | undefined> | undefined
>;

export class FieldRenderer extends PIXI.Application {
  private fieldContainer = new PIXI.Container({
    isRenderGroup: true,
    interactiveChildren: false,
  });

  private clickHandler = new PIXI.Container();
  private flushPending: () => void;
  private overview!: OverviewTiles;
  private canvasReady = false;
  private detailChunks = new Map<
    string,
    { x: number; y: number; container: PIXI.Container; dirty: boolean }
  >();
  private detailParent(cell: Cell) {
    const x = Math.floor(cell.x / TILE_CELLS),
      y = Math.floor(cell.y / TILE_CELLS),
      key = `${x},${y}`;
    let chunk = this.detailChunks.get(key);
    if (!chunk) {
      const container = new PIXI.Container({ interactiveChildren: false });
      chunk = { x, y, container, dirty: true };
      container.visible = false;
      this.detailChunks.set(key, chunk);
      this.fieldContainer.getChildByLabel("fg")!.addChild(container);
    }
    return chunk;
  }
  private cullDetails(showDetails = true) {
    const size = TILE_CELLS * 16 * this.fieldContainer.scale.x;
    for (const chunk of this.detailChunks.values()) {
      const { x, y, container } = chunk;
      const sx = this.fieldContainer.x + x * size,
        sy = this.fieldContainer.y + y * size;
      container.visible =
        showDetails && sx + size >= 0 &&
        sy + size >= 0 &&
        sx <= window.innerWidth &&
        sy <= window.innerHeight;
      if (!container.visible && container.children.length) {
        for (let dy = 0; dy < TILE_CELLS; dy++) {
          const row = this.cellSprites[y * TILE_CELLS + dy];
          if (!row) continue;
          for (let dx = 0; dx < TILE_CELLS; dx++) {
            const key = x * TILE_CELLS + dx;
            row[key]?.stopAnimation();
            delete row[key];
          }
          if (!Object.keys(row).length) delete this.cellSprites[y * TILE_CELLS + dy];
        }
        for (const child of container.removeChildren()) child.destroy({children: true});
        chunk.dirty = true;
      }
      if (container.visible && chunk.dirty) {
        for (let dy = 0; dy < TILE_CELLS; dy++)
          for (let dx = 0; dx < TILE_CELLS; dx++) {
            const cell = this.field.getCell(
              x * TILE_CELLS + dx,
              y * TILE_CELLS + dy,
            );
            if (
              cell.isOpen ||
              cell.isFlagged ||
              this.cellSprites[cell.y]?.[cell.x]
            )
              this.updateDetailed(cell, false);
          }
        chunk.dirty = false;
      }
    }
  }

  public cellSprites: CellSprites = {};

  public constructor(
    private field: Field,
    updateScore: (input: Field) => void,
    private fieldPersistence: FieldPersistence,
    private deferredInitialDraw = false,
  ) {
    super();

    const pending = new Map<string, Cell>();
    field.on("cellChanged", (cell: Cell) => {
      pending.set(`${cell.x},${cell.y}`, cell);
    });
    const profile = renderQuality(field);
    try {
      const saved = JSON.parse(
        localStorage.getItem("savedCamerTransform") ?? "null",
      ) as { k: number } | null;
      if (saved) profile.update({ scale: saved.k });
    } catch {
      /* An invalid camera preference must not prevent loading a board. */
    }
    const activeAnimations = new Map<CellSprite, number>();
    this.flushPending = () => {
      const quality = profile.current;
      if (this.ticker.maxFPS !== quality.maxFPS)
        this.ticker.maxFPS = quality.maxFPS;
      this.fieldContainer.getChildByLabel("fg")!.visible = quality.details;
      this.fieldContainer.getChildByLabel("lorez")!.visible = !quality.details;
      this.cullDetails(quality.details);
      const now = performance.now();
      for (const [sprite, expires] of activeAnimations) {
        if (!quality.animateCells) sprite.stopAnimation();
        if (!quality.animateCells || now >= expires)
          activeAnimations.delete(sprite);
      }
      if (!pending.size) {
        field.emit("renderFrame", now);
        return;
      }
      const animate = quality.animateCells && pending.size < 20;
      for (const cell of pending.values()) {
        this.updateCell(cell, animate);
        const sprite = this.cellSprites[cell.y]?.[cell.x];
        if (animate && sprite) activeAnimations.set(sprite, now + 250);
      }
      pending.clear();
      this.overview.flush();
      updateScore(field);
      field.emit("renderFrame", now);
    };

    this.setup();
  }

  public updateCell(cell: Cell, playAnimation: boolean) {
    this.overview.set(
      cell.x,
      cell.y,
      overviewColor(cell, this.field.value(cell.x, cell.y)),
    );
    const chunk = this.detailParent(cell);
    if (
      !this.canvasReady ||
      !renderQuality(this.field).current.details ||
      !chunk.container.visible
    ) {
      chunk.dirty = true;
      return;
    }
    this.updateDetailed(cell, playAnimation);
  }

  private updateDetailed(cell: Cell, playAnimation: boolean) {
    if (!this.cellSprites[cell.y]) {
      this.cellSprites[cell.y] = {};
    }
    let cellSprite = this.cellSprites[cell.y]![cell.x];
    const neighborCount = numberToNeighborCount(
      this.field.value(cell.x, cell.y),
    );

    if (cellSprite) {
      cellSprite.neighborCount = neighborCount;
      cellSprite.update(cell, playAnimation);
    } else {
      cellSprite = new CellSprite(
        cell,
        neighborCount,
        this.detailParent(cell).container,
        playAnimation,
        () => {},
      );
      this.cellSprites[cell.y]![cell.x] = cellSprite;
    }
  }

  public updateAllCells(): void {
    // Stream restored cells instead of retaining multiple full-board arrays.
    for (const cell of this.field.cellData.cells()) {
      if (cell.isOpen || cell.isFlagged) this.updateCell(cell, false);
    }
  }

  // todo inline
  private setup(): void {
    const background = new PIXI.TilingSprite({
      texture: getTextures().closed,
      width: this.renderer?.width ?? window.innerWidth,
      height: this.renderer?.height ?? window.innerHeight,
    });

    window.addEventListener("resize", () => {
      const width = window.innerWidth;
      const height = window.innerHeight;

      this.renderer.resize(width, height);

      background.width = width;
      background.height = height;
    });

    background.label = "bg";
    const lorezLayer = new PIXI.Container({ interactiveChildren: false });
    const foregroundLayer = new PIXI.Container({ interactiveChildren: false });
    foregroundLayer.label = "fg";
    lorezLayer.label = "lorez";
    this.fieldContainer.addChild(lorezLayer);
    this.fieldContainer.addChild(foregroundLayer);
    this.fieldContainer.label = "container";
    this.overview = new OverviewTiles(lorezLayer);

    this.clickHandler.addChildAt(background, 0);
    this.clickHandler.addChildAt(this.fieldContainer, 1);
    this.clickHandler.eventMode = "static";

    this.stage.addChild(this.clickHandler);

    if (!this.deferredInitialDraw) this.updateAllCells();
    this.overview.flush();
  }

  public async prepareCells(signal: AbortSignal, progress: (done: number) => void) {
    let processed = 0; const budget = new LoadBudget();
    for (const cell of this.field.cellData.cells()) {
      if (cell.isOpen || cell.isFlagged) this.updateCell(cell, false);
      if (++processed % 2000 === 0 && budget.due()) {
        signal.throwIfAborted(); progress(processed); await budget.yield();
      }
    }
    signal.throwIfAborted(); this.overview.flush();
  }

  public setupAfterCanvasReady() {
    this.canvasReady = true;
    this.ticker.add(this.flushPending);
    new Controls(this.clickHandler, this.field, this.fieldPersistence);
  }
}
