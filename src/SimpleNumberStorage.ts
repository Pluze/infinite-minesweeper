export class SimpleNumberStorage implements NumberStorage {
  private data: DOKFormat = {};

  #cachedSize?: number;
  public get size(): number {
    if (this.#cachedSize === undefined) {
      let count = 0;
      for (const x in this.data) for (const y in this.data[x]) if (this.data[x][y] !== undefined) count++;
      this.#cachedSize = count;
    }
    return this.#cachedSize;
  }

  public set(x: number, y: number, value: number): void {
    if (this.#cachedSize !== undefined && this.data[x]?.[y] === undefined) this.#cachedSize++;
    if (this.data[x] !== undefined) this.data[x]![y] = value;
    else {
      this.data[x] = {};
      this.data[x]![y] = value;
    }
  }

  public get(x: number, y: number): number | null {
    return this.data[x]?.[y] ?? null;
  }

  public compress(): string {
    return JSON.stringify(this.data);
  }

  public decompress(input: string): SimpleNumberStorage {
    const instance = new SimpleNumberStorage();
    // todo use zod to parse
    instance.data = JSON.parse(input) as DOKFormat;
    return instance;
  }

  public *entries(): Generator<{x: number; y: number; value: number}> {
    for (const x in this.data) {
      for (const y in this.data[x]) {
        yield {x: Number(x), y: Number(y), value: this.data[x][y]};
      }
    }
  }

  public getAll(): { x: number; y: number; value: number }[] {
    return [...this.entries()];
  }

}

type DOKFormat = Record<number, Record<number, number>>;
