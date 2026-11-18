import { afterEach, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { FieldPersistence } from "./FieldPersistence";
import { Field } from "./Field";
import { trackDensity } from "./DensityHistory";
afterEach(() => { vi.unstubAllGlobals(); });
const setup = () => {
  vi.stubGlobal("indexedDB", new IDBFactory()); vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const values = new Map<string, string>();
  return new FieldPersistence({getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key,value), removeItem: (key: string) => values.delete(key)} as unknown as Storage);
};
const plain = (f: Field) => JSON.parse(JSON.stringify(f, (key, value) => key === "_events" || key === "_eventsCount" ? undefined : value));
it("restores incremental cells including generated hidden mines and complete histories", async () => {
  const storage = setup(), f = new Field(.2, 2, "saved", "1");
  f.clickScores = [0]; trackDensity(f);
  await storage.saveAsync(f, "saved");
  for (let i = 0; i < 5; i++) {
    f.open(i * 4, 0); f.recordClick();
    await storage.saveAsync(f, "saved");
  }
  expect(plain((await storage.loadLatest("saved"))!)).toEqual(plain(f));
  // A new session compacts the recovered journal into a fresh baseline.
  const restored = (await storage.loadLatest("saved"))!;
  await storage.saveAsync(restored, "saved");
  restored.open(30, 0); restored.recordClick();
  await storage.saveAsync(restored, "saved");
  expect(plain((await storage.loadLatest("saved"))!)).toEqual(plain(restored));
});
it("does not revive a cleared board through pending checkpoint work", async () => {
  const storage = setup(), f = new Field(.2, 2, "saved", "1");
  await storage.saveAsync(f, "saved");
  f.open(0, 0);
  const pending = storage.saveAsync(f, "saved");
  await storage.clearAsync("saved"); await pending;
  expect(await storage.loadLatest("saved")).toBeUndefined();
});

import {compactJournal, journalRange} from "./JournalCheckpoint";
const openDB = () => new Promise<IDBDatabase>(resolve => {
 const request = indexedDB.open("infinite-minesweeper-saves",1);
 request.onsuccess=()=>resolve(request.result);
});
it("compacts a journal prefix without losing later cells or histories",async()=>{
 const storage=setup(), f=new Field(.2,2,"saved","1");
 f.clickScores=[0];trackDensity(f);await storage.saveAsync(f,"saved");
 for(let i=0;i<5;i++){f.open(i*4,0);f.recordClick();await storage.saveAsync(f,"saved");}
 const db=await openDB();await compactJournal(db,"saved",2);
 const count=await new Promise<number>(resolve=>{const r=db.transaction("boards").objectStore("boards").count(journalRange("saved"));r.onsuccess=()=>resolve(r.result);});
 expect(count).toBe(2);
 expect(plain((await storage.loadLatest("saved"))!)).toEqual(plain(f));
 db.close();
});
it("does not resurrect a cleared save when a checkpoint is in flight",async()=>{
 const storage=setup(),f=new Field(.2,2,"saved","1");
 await storage.saveAsync(f,"saved");f.open(0,0);await storage.saveAsync(f,"saved");
 const db=await openDB(), pending=compactJournal(db,"saved",0);
 await storage.clearAsync("saved");await pending;
 expect(await storage.loadLatest("saved")).toBeUndefined();db.close();
});

it("keeps mobile journals recoverable without allocating a full-board worker", async () => {
  vi.stubGlobal("navigator", {userAgent: "iPhone EdgiOS"});
  const worker = vi.fn(); vi.stubGlobal("Worker", worker);
  const storage = setup(), field = new Field(.2, 0, "mobile", "1");
  await storage.saveAsync(field, "mobile");
  for (let i = 0; i < 128; i++) {
    field._setCell(i, 0, {isOpen: true, isMine: false});
    await storage.saveAsync(field, "mobile");
  }
  expect(worker).not.toHaveBeenCalled();
  const restored = (await storage.loadLatest("mobile"))!;
  expect(restored.cellData.numberStorage.size).toBe(128);
  restored._setCell(128,0,{isOpen:true,isMine:false});
  restored._setCell(0,0,{isFlagged:true});
  expect(restored.cellData.numberStorage.size).toBe(129);
});

it("aborts recovery before a new game clears the save", async () => {
 const storage=setup(), field=new Field(.2,0,"cancel","1");
 await storage.saveAsync(field,"cancel");
 for(let i=0;i<3;i++) {field._setCell(i,0,{isOpen:true,isMine:false});await storage.saveAsync(field,"cancel");}
 const controller=new AbortController();
 const pending=storage.loadLatest("cancel",controller.signal,done=>{if(done===1)controller.abort();});
 await expect(pending).rejects.toMatchObject({name:"AbortError"});
 await storage.clearAsync("cancel");
 expect(await storage.loadLatest("cancel")).toBeUndefined();
});
