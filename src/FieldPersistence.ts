import { isMemoryConstrainedDevice } from "./MemoryPressure";
import { SaveDeltaTracker } from "./SaveDelta";
import { readJournal, journalRange } from "./JournalCheckpoint";
import { Field } from "./Field";
import { SimpleCellData } from "./CellData";
import { SimpleNumberStorage } from "./SimpleNumberStorage";

export class FieldPersistence {
  public constructor(public localStorage: Storage) {}

  private database?: Promise<IDBDatabase>;
  private generations = new Map<string, number>();
  private openDatabase() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("infinite-minesweeper-saves", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("boards");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  }
  public async loadLatest(id: string, signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<Field | undefined> {
    if (typeof indexedDB === "undefined") return this.load(id);
    const db = await this.openDatabase();
    const {board} = await readJournal(db, id, Number.MAX_SAFE_INTEGER, signal, progress);
    signal?.throwIfAborted();
    return board ? this.decompress(board) : this.load(id);
  }
  private checkpoint?: Worker;
  private compact(id: string, through: number) {
    // Full-board reconstruction in a second isolate can exceed iOS process memory.
    if (isMemoryConstrainedDevice() || this.checkpoint || typeof Worker === "undefined") return;
    const worker = new Worker(new URL("./CheckpointWorker.ts", import.meta.url), {type: "module"});
    this.checkpoint = worker;
    const finish = () => {worker.terminate(); this.checkpoint = undefined;};
    worker.onmessage = finish;
    worker.onerror = finish; // Journals remain authoritative if compaction fails.
    worker.postMessage({id, through});
  }
  private trackers = new WeakMap<Field, {tracker: SaveDeltaTracker; initialized: boolean; sequence: number; pending: Promise<void>}>();
  public async saveAsync(field: Field, id: string) {
    if (typeof indexedDB === "undefined") { this.save(field, id); return; }
    let state = this.trackers.get(field);
    if (!state) {
      state = {tracker: new SaveDeltaTracker(field), initialized: false, sequence: 0, pending: Promise.resolve()};
      this.trackers.set(field, state);
    }
    const current = state, generation = this.generations.get(id) ?? 0;
    const work = current.pending.catch(() => {}).then(async () => {
      if ((this.generations.get(id) ?? 0) !== generation) return;
      if (!current.initialized) {
        const text = this.compress(field);
        current.tracker.baseline();
        await this.writeSerialized(text, id);
        current.initialized = true;
        return;
      }
      const snapshot = current.tracker.capture();
      try {
        const db = await this.openDatabase();
        if ((this.generations.get(id) ?? 0) !== generation) return;
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("boards", "readwrite");
          tx.objectStore("boards").put(snapshot.delta, [id, current.sequence]);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
        current.sequence++; snapshot.commit();
        if (current.sequence % 128 === 0) {
          try { this.compact(id, current.sequence - 1); } catch { /* Keep the journal on unsupported workers. */ }
        }
      } catch (error) { snapshot.rollback(); throw error; }
    });
    current.pending = work;
    await work;
  }
  private async writeSerialized(text: string, id: string) {
    const db = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("boards", "readwrite");
      transaction.objectStore("boards").put(text, id);
      transaction.objectStore("boards").put(crypto.randomUUID(), [id, "epoch"]);
      transaction.objectStore("boards").delete(journalRange(id));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    this.localStorage.removeItem(id);
  }
  public async clearAsync(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    if (typeof indexedDB !== "undefined") {
      const db = await this.openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("boards", "readwrite");
        transaction.objectStore("boards").delete(id);
        transaction.objectStore("boards").put(crypto.randomUUID(), [id, "epoch"]);
        transaction.objectStore("boards").delete(journalRange(id));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
    this.localStorage.removeItem(id);
  }

  public save(field: Field, id: string) {
    const compressedField = this.compress(field);

    this.localStorage.setItem(id, compressedField);

    return;
  }

  public load(id: string): Field | undefined {
    const compressedField = this.localStorage.getItem(id);
    if (compressedField === null) return undefined;
    const recoveredField = JSON.parse(compressedField);
    if (
      recoveredField &&
      typeof recoveredField === "object" &&
      "cellData" in recoveredField &&
      recoveredField.cellData &&
      typeof recoveredField.cellData === "object" &&
      "numberStorage" in recoveredField.cellData
    ) {
      const field = this.decompress(
        recoveredField as { cellData: { numberStorage: unknown } },
      );
      return field;
    } else {
      return undefined;
    }
  }

  private compress(field: Field) {
    const stringifiedField = JSON.stringify(field, (key, value) => {
      if (key === "_events" || key === "localStorage") return undefined;
      else return value;
    });

    return stringifiedField;
  }

  private decompress(recoveredField: {
    cellData: { numberStorage: unknown };
  }): Field {
    // Hydrate the three actual class instances once. Recursively transforming
    // millions of primitive cells/history samples copied the save three times.
    const source = recoveredField as Partial<Field>;
    const field = new Field(source.probability, source.safeRadius, source.fieldName ?? "defaultSavedFieldv3");
    for (const key of ["pristine", "gameOver", "score", "neighborPosition", "clickScores", "densityHistory", "densityStartClick", "detonatedCountHistory", "detonatedCountStartClick", "mineCountHistory", "mineCountStartClick", "openedCountHistory", "openedCountStartClick", "visibleChunks"] as const)
      if (source[key] !== undefined) Object.assign(field, {[key]: source[key]});
    field.cellData = new SimpleCellData();
    const data = (recoveredField.cellData.numberStorage as {data: unknown}).data;
    field.cellData.numberStorage = Object.assign(new SimpleNumberStorage(), {data});
    return field;
  }
}
