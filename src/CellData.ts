import { Cell } from "./Cell";
import { SimpleNumberStorage } from "./SimpleNumberStorage";

interface CellData {
  get(x: number, y: number): Cell;
  set(x: number, y: number, cell: Cell): void;
  compress(): string;
  decompress(compressed: string): CellData;
  getAll(): Cell[];
}

export class SimpleCellData implements CellData {
  public numberStorage = new SimpleNumberStorage();

  public getAll(): Cell[] {
    const numbers = this.numberStorage.getAll();
    return numbers.map((val) => {
      return this.numberToCell(val.x, val.y, val.value);
    });
  }

  private cellToNumber(cell: Cell): number {
    return (
      (cell.isMine ? 8 : 0) |
      (cell.isMine === undefined ? 4 : 0) |
      (cell.isFlagged ? 2 : 0) |
      (cell.isOpen ? 1 : 0)
    );
  }
  private numberToCell(x: number, y: number, input: number | null): Cell {
    const cell = new Cell(x, y);

    if (input === null) return cell;
    cell.isMine = (input & 4) !== 0 ? undefined : (input & 8) !== 0;
    cell.isFlagged = (input & 2) !== 0;
    cell.isOpen = (input & 1) !== 0;

    return cell;
  }

  public get(x: number, y: number): Cell {
    return this.numberToCell(x, y, this.numberStorage.get(x, y));
  }

  public set(x: number, y: number, cell: Cell): void {
    this.numberStorage.set(x, y, this.cellToNumber(cell));
  }
  public compress(): string {
    throw new Error("Method not implemented.");
  }

  public decompress(_compressed: string): CellData {
    throw new Error("Method not implemented.");
  }
}
