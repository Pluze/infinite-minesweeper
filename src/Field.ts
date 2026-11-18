/**
 * Created by sisc0606 on 19.08.2017.
 */
import * as Layouts from "./Layouts";
import * as PIXI from "pixi.js";
import { Chunk } from "./Chunk";
import seedrandom from "seedrandom";
import { Cell, observeCell } from "./Cell";
import { SimpleCellData } from "./CellData";
import { Layout } from "./Layouts";

export type ChunkedField = Record<number, Record<number, Chunk>>;

export const BASE_OPEN_SCORE = 1;

type OpenTarget = { x: number; y: number; chordIfOpened?: boolean };

export class Field extends PIXI.EventEmitter {
  public fieldData: ChunkedField;
  public probability: number;
  public safeRadius: number;
  public pristine: boolean;
  public gameOver: boolean;
  public neighborPosition: Layout;
  public score: number;
  public clickScores: number[] = [];
  public densityHistory: number[] = [];
  public densityStartClick = 0;
  public detonatedCountHistory: number[] = [];
  public detonatedCountStartClick = 0;
  public mineCountHistory: number[] = [];
  public mineCountStartClick = 0;
  public openedCountHistory: number[] = [];
  public openedCountStartClick = 0;
  public visibleChunks: { x: number; y: number }[];

  public fieldName: string;
  private rng: seedrandom.PRNG;

  public cellData = new SimpleCellData();

  public constructor(
    probability = 0.5,
    safeRadius = 1,
    fieldName: string,
    seed: string | undefined = undefined,
  ) {
    super();

    this.fieldData = {};
    // this is the probability that a mine is a cell
    this.probability = probability;
    // the field is pristine if no cells are opened, set this to true again with
    // Field.restart()
    this.pristine = true;
    // makes the first click not press a mine, radius is a float and checks in a circle
    this.safeRadius = safeRadius;
    this.gameOver = false;

    this.neighborPosition = Layouts.normal;
    this.score = 0;
    this.visibleChunks = [];
    this.fieldName = fieldName;
    this.rng = seedrandom(seed);

    // todo someday:
    // be able to change the options through an object
    // overwrite mine state
    // freeze mode
  }

  public recordClick() {
    this.clickScores.push(this.score);
    this.emit("clickRecorded");
  }

  public getCell(x: number, y: number): Cell {
    return this.cellData.get(x, y);
  }

  public open(x: number, y: number): Cell[] {
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y))
      throw new Error(
        `Open was passed (${x},${y}), but it should be passed safe integers`,
      );

    if (this.pristine) this.setSafeCells(x, y);
    const pending: OpenTarget[] = [{ x, y, chordIfOpened: true }];
    const changed: Cell[] = [];
    while (pending.length) {
      const { x, y, chordIfOpened } = pending.pop()!;
      const cell = this.getCell(x, y);
      if (cell.isOpen) {
        if (chordIfOpened && !cell.isMine) this.chordOpen(cell, pending, changed);
        continue;
      }
      if (cell.isFlagged) continue;

      if (cell.isMine === undefined) {
        cell.isMine = this.rng() < this.probability;
        this._setCell(x, y, cell);
      }
      this._setCell(x, y, { isOpen: true });
      cell.isOpen = true;

      if (cell.isMine) {
        this.score -= 100;
        this.emit("cellChanged", cell);
        continue;
      }
      this.score += BASE_OPEN_SCORE;

      const neighbors = this.getNeighbors(x, y);
      for (const neighbor of neighbors) {
        if (neighbor.isMine === undefined) {
          neighbor.isMine = this.rng() < this.probability;
          this._setCell(neighbor.x, neighbor.y, neighbor);
        }
      }
      this.emit("cellChanged", cell);
      changed.push(cell);

      // Reverse the push order to preserve depth-first visitation and seeded rolls.
      if (this.value(x, y) === 0) {
        for (let i = neighbors.length - 1; i >= 0; i--) {
          const neighbor = neighbors[i];
          if (!neighbor.isOpen && !neighbor.isFlagged)
            pending.push(neighbor);
        }
      }
    }
    return changed;
  }

  private chordOpen(cell: Cell, pending: OpenTarget[], changed: Cell[]) {
    const neighbors = this.getNeighbors(cell.x, cell.y);
    const closedUnflagged = neighbors.filter(
      (neighbor) => !neighbor.isOpen && !neighbor.isFlagged,
    );
    const value = this.value(cell.x, cell.y);
    const knownMines = neighbors.filter(
      (neighbor) => neighbor.isFlagged || (neighbor.isOpen && neighbor.isMine),
    );
    if (knownMines.length === value) {
      for (let i = closedUnflagged.length - 1; i >= 0; i--) {
        const { x, y } = closedUnflagged[i];
        pending.push({ x, y, chordIfOpened: true });
      }
    } else {
      const closed = neighbors.filter(
        (neighbor) => !neighbor.isOpen || neighbor.isMine,
      );
      if (closed.length === value) {
        for (const { x, y } of closedUnflagged) changed.push(...this.flag(x, y));
      }
    }
  }

  /**
   * If the cell is closed, it toggles the flag.
   *
   * If the cell is open, chords flags.
   * @returns Changed cells
   */
  public flag(x: number, y: number): Cell[] {
    const cell = this.getCell(x, y);
    if (!cell.isOpen) {
      cell.isFlagged = !cell.isFlagged;
      this._setCell(x, y, cell);
      // todo remove this, we should base on return value of flag.
      this.emit("cellChanged", cell);
      return [cell];
    } else {
      if (cell.isMine) return [];
      const closedNeighbors = this.getNeighbors(x, y).filter(
        (cell) => !cell.isOpen || (cell.isMine && cell.isOpen),
      );
      if (closedNeighbors.length === this.value(x, y)) {
        for (const closedNeighbor of closedNeighbors) {
          if (!closedNeighbor.isFlagged) {
            this.flag(closedNeighbor.x, closedNeighbor.y);
          }
        }
      }
    }
    return [];
  }

  public getNeighbors(x: number, y: number) {
    const neighbors = [];
    for (let i = 0; i <= this.neighborPosition.length - 1; i++) {
      const newX = x + this.neighborPosition[i][0];
      const newY = y + this.neighborPosition[i][1];
      neighbors.push(this.getCell(newX, newY));
    }
    return neighbors;
  }

  public restart() {
    // todo
    this.pristine = true;
    // todo: delete all of the rows, update all of the cells
    throw Error("not implemented");
  }

  public getAll(): Cell[] {
    return this.cellData.getAll();
  }

  public value(x: number, y: number): number | null {
    const storage = this.cellData.numberStorage;
    const encoded = storage.get(x, y);
    if (encoded === null || !(encoded & 1)) return null;
    let count = 0;
    for (const [dx, dy] of this.neighborPosition) {
      const neighbor = storage.get(x + dx, y + dy);
      // Bit 4 denotes an ungenerated mine state, even in a legacy encoding.
      if (neighbor !== null && (neighbor & 12) === 8) count++;
    }
    return count;
  }

  public setVisibleChunk(x: number, y: number) {
    this.visibleChunks.push({ x: x, y: y });
  }

  public loadVisibleChunks() {
    for (let i = 0; i < this.visibleChunks.length; i++) {
      this.showChunk(this.visibleChunks[i].x, this.visibleChunks[i].y);
    }
    this.visibleChunks = [];
  }

  private showChunk(x: number, y: number) {
    const showChunk = this.getCoordinatesInChunk(x, y);
    for (const cellCoords of showChunk) {
      const cell = this.getCell(cellCoords.x, cellCoords.y);
      if (cell.isOpen || cell.isFlagged) {
        this.emit("cellChanged", cell);
      }
    }
    return;
  }

  private getCoordinatesInChunk(
    x: number,
    y: number,
  ): { x: number; y: number }[] {
    const startCellX = 32 * x;
    const startCellY = 32 * y + 32;
    const endCellX = 32 * x;
    const endCellY = 32 * y + 32;

    const output: { x: number; y: number }[] = [];
    for (let i = startCellX; i <= endCellX; i++) {
      for (let j = startCellY; j <= endCellY; j++) {
        output.push({ x: i, y: j });
      }
    }
    return output;
  }

  private setSafeCells(x0: number, y0: number) {
    // initiate the field with a circle of cells that aren't mines
    this.pristine = false;
    const r = this.safeRadius;

    for (let dy = Math.floor(-r); dy < Math.ceil(r); dy++) {
      for (let dx = Math.floor(-r); dx < Math.ceil(r); dx++) {
        // if the cell is in a circle with radius r
        if (r ** 2 > dx ** 2 + dy ** 2) {
          const x = x0 + dx;
          const y = y0 + dy;
          // we generate the cell, and overwrite the isMine state
          this._setCell(x, y, { isFlagged: false, isMine: false });
          // this.generateCell(x, y, false, false);
        }
      }
    }
  }

  public _setCell(x: number, y: number, cell: Partial<Cell>) {
    const gottenCell = this.cellData.get(x, y);
    const oldMine = !!gottenCell.isMine;
    const before = observeCell(gottenCell);
    if (cell.isMine !== undefined) gottenCell.isMine = cell.isMine;
    if (cell.isFlagged !== undefined) gottenCell.isFlagged = cell.isFlagged;
    if (cell.isOpen !== undefined) gottenCell.isOpen = cell.isOpen;
    this.cellData.set(x, y, gottenCell);
    this.emit("cellStored", {x, y});
    const after = observeCell(gottenCell);
    if (before !== after) this.emit("observationChanged", x, y, before, after);
    if (oldMine !== !!gottenCell.isMine) this.emit("mineGenerated", {x, y});
  }
}
