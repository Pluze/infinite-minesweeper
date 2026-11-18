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
