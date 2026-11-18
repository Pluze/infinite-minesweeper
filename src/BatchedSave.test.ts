import { it, expect, vi, afterEach } from "vitest";
import { BatchedSave } from "./BatchedSave";
afterEach(() => {
  vi.useRealTimers();
});
it("coalesces writes on a fixed deadline and flushes immediately on pause", () => {
  vi.useFakeTimers();
  const write = vi.fn(),
    error = vi.fn();
  const save = new BatchedSave(write, error);
  for (let i = 0; i < 100; i++) {
    save.request();
    vi.advanceTimersByTime(9);
  }
  expect(write).not.toHaveBeenCalled();
  vi.advanceTimersByTime(100);
  expect(write).toHaveBeenCalledTimes(1);
  save.request();
  save.flush();
  expect(write).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1000);
  expect(write).toHaveBeenCalledTimes(2);
});
it("reports a failed write and permits a later retry", () => {
  const write = vi.fn().mockImplementationOnce(() => {
      throw new Error("quota");
    }),
    error = vi.fn();
  const save = new BatchedSave(write, error);
  save.request();
  save.flush();
  expect(error).toHaveBeenCalledOnce();
  save.flush();
  expect(write).toHaveBeenCalledTimes(2);
});

it("does not restore the previous game after restart clears storage", () => {
  vi.useFakeTimers();
  const write = vi.fn();
  const save = new BatchedSave(write, vi.fn());
  save.request();
  save.discard();
  save.flush();
  vi.advanceTimersByTime(2000);
  expect(write).not.toHaveBeenCalled();
});

it("reports asynchronous persistence failures and retries the dirty checkpoint", async () => {
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error("db failure"))
    .mockResolvedValue(undefined);
  const error = vi.fn(),
    save = new BatchedSave(write, error);
  save.request();
  save.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(error).toHaveBeenCalledOnce();
  save.flush();
  await Promise.resolve();
  expect(write).toHaveBeenCalledTimes(2);
});
