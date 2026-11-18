import { afterEach, expect, it, vi } from "vitest";
import { Field } from "./Field";
import { ProbabilityPreview } from "./ProbabilityPreview";
import { probabilityModel } from "./MineProbability";
class FakeWorker {
  static current: FakeWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.current = this;
  }
  reply() {
    this.onmessage?.({
      data: {
        risks: [
          ["1,0", 0],
          ["20,0", 0],
          ["100,0", 1],
        ],
        approximate: [],
        groups: [["1,0", "20,0"], ["100,0"]],
      },
    });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("limits inference to one in-flight job and rejects the whole changed dependency group", () => {
  vi.stubGlobal("Worker", FakeWorker);
  const field = new Field(0.2, 0, "preview", "1");
  const preview = new ProbabilityPreview(field),
    worker = FakeWorker.current;
  preview.request();
  preview.request();
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  field._setCell(0, 0, { isOpen: true, isMine: false });
  field.emit("cellChanged", field.getCell(0, 0));
  worker.reply();
  expect(preview.isInvalid("20,0")).toBe(true);
  expect(preview.isInvalid("100,0")).toBe(false);
  preview.request();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  worker.reply();
  expect(preview.isInvalid("20,0")).toBe(false);
  field.emit("beforeRestart");
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it("recovers from worker failure without retaining invalid group flags", () => {
  vi.stubGlobal("Worker", FakeWorker);
  const field = new Field(0.2, 0, "preview-fallback", "1");
  const preview = new ProbabilityPreview(field),
    worker = FakeWorker.current;
  preview.request();
  worker.reply();
  field._setCell(0, 0, { isOpen: true, isMine: false });
  field.emit("cellChanged", field.getCell(0, 0));
  expect(preview.isInvalid("20,0")).toBe(true);
  worker.onerror?.();
  const snapshot = vi.spyOn(probabilityModel(field), "snapshot");
  preview.request();
  expect(snapshot).toHaveBeenCalledOnce();
  expect(preview.isInvalid("20,0")).toBe(false);
});
it('bounds hidden-overlay changes and resynchronizes the complete frontier',()=>{
 vi.stubGlobal('Worker',FakeWorker);
 const field=new Field(.2,0,'bounded-preview','1');
 const preview=new ProbabilityPreview(field), worker=FakeWorker.current;
 preview.request();worker.reply();
 for(let x=0;x<12000;x++) field.emit('cellChanged',{x,y:0});
 expect((preview as any).patchCells.size).toBeLessThanOrEqual(4096);
 expect((preview as any).pendingInvalidations.size).toBeLessThanOrEqual(4096);
 preview.request();
 expect(worker.postMessage.mock.calls.at(-1)![0].reset).toBe(true);
});
