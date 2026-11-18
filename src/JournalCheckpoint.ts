import { applySaveDelta } from "./SaveDelta";
export const journalRange = (id: string, through = Number.MAX_SAFE_INTEGER) =>
  IDBKeyRange.bound([id, 0], [id, through]);

/** Consume the journal incrementally instead of cloning every delta into an array. */
export function readJournal(db: IDBDatabase, id: string, through = Number.MAX_SAFE_INTEGER, signal?: AbortSignal, progress?: (done: number, total: number) => void) {
  return new Promise<{board?: any; epoch?: string}>((resolve, reject) => {
    signal?.throwIfAborted();
    const tx = db.transaction("boards"), store = tx.objectStore("boards");
    const abort = () => tx.abort();
    signal?.addEventListener("abort", abort, {once: true});
    let done = 0, total = 0;
    const count = store.count(journalRange(id, through));
    count.onsuccess = () => {total = count.result; progress?.(0, total);};
    let board: any;
    const base = store.get(id), epoch = store.get([id, "epoch"]);
    base.onsuccess = () => {
      try { board = base.result ? JSON.parse(base.result) : undefined; }
      catch (error) { reject(error); tx.abort(); }
    };
    const cursor = store.openCursor(journalRange(id, through));
    cursor.onsuccess = () => {
      try {
        if (!cursor.result) return;
        if (board) applySaveDelta(board, cursor.result.value);
        progress?.(++done, total);
        if (!signal?.aborted) cursor.result.continue();
      } catch (error) { reject(error); tx.abort(); }
    };
    tx.oncomplete = () => {signal?.removeEventListener("abort", abort); resolve({board, epoch: epoch.result});};
    tx.onerror = tx.onabort = () => {
      signal?.removeEventListener("abort", abort);
      reject(signal?.aborted ? signal.reason : tx.error ?? new Error("Save read aborted"));
    };
  });
}

/** Runs in a worker. Replace only the captured prefix; concurrent appends survive. */
export async function compactJournal(db: IDBDatabase, id: string, through: number) {
  const {board, epoch} = await readJournal(db, id, through);
  if (!board) return;
  const text = JSON.stringify(board);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("boards", "readwrite"), store = tx.objectStore("boards");
    const current = store.get([id, "epoch"]);
    current.onsuccess = () => {
      // A new game or a fresh session checkpoint supersedes this worker snapshot.
      if (current.result !== epoch) return;
      store.put(text, id);
      store.delete(journalRange(id, through));
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Checkpoint aborted"));
  });
}
