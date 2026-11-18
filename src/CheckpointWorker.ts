import { compactJournal } from "./JournalCheckpoint";
self.onmessage = async (event: MessageEvent<{id: string; through: number}>) => {
 let db: IDBDatabase | undefined;
 try {
  db = await new Promise<IDBDatabase>((resolve, reject) => {
   const request = indexedDB.open("infinite-minesweeper-saves", 1);
   request.onsuccess = () => resolve(request.result);
   request.onerror = () => reject(request.error);
  });
  await compactJournal(db, event.data.id, event.data.through);
  self.postMessage({ok: true});
 } catch { self.postMessage({ok: false}); }
 finally { db?.close(); }
};
