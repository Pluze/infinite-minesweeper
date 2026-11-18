import { expect, it, vi, afterEach } from "vitest";
import {
  MemoryPressureGuard,
  isMemoryConstrainedDevice,
  mobileBoardLimitReached,
  MOBILE_CELL_LIMIT,
  MOBILE_HISTORY_LIMIT,
} from "./MemoryPressure";
it("does not pause unsupported browsers or a transient heap spike", () => {
  const guard = new MemoryPressureGuard();
  expect(guard.check()).toBe(false);
  expect(guard.check({ usedJSHeapSize: 86, jsHeapSizeLimit: 100 })).toBe(false);
  expect(guard.check({ usedJSHeapSize: 50, jsHeapSizeLimit: 100 })).toBe(false);
  expect(guard.check({ usedJSHeapSize: 86, jsHeapSizeLimit: 100 })).toBe(false);
  expect(guard.check({ usedJSHeapSize: 87, jsHeapSizeLimit: 100 })).toBe(true);
});
it("pauses immediately at critical heap pressure", () => {
  expect(
    new MemoryPressureGuard().check({
      usedJSHeapSize: 96,
      jsHeapSizeLimit: 100,
    }),
  ).toBe(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});
it.each([
  { userAgent: "Mozilla iPhone EdgiOS", platform: "iPhone", maxTouchPoints: 5 },
  { userAgent: "Mozilla Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
  { userAgent: "Mozilla Android", platform: "Linux", maxTouchPoints: 5 },
])("protects mobile browsers without heap telemetry: %o", (platform) => {
  vi.stubGlobal("navigator", platform);
  expect(isMemoryConstrainedDevice()).toBe(true);
  expect(
    mobileBoardLimitReached(MOBILE_CELL_LIMIT - 1, MOBILE_HISTORY_LIMIT - 1),
  ).toBe(false);
  expect(mobileBoardLimitReached(MOBILE_CELL_LIMIT, 0)).toBe(true);
  expect(mobileBoardLimitReached(0, MOBILE_HISTORY_LIMIT)).toBe(true);
  expect(
    mobileBoardLimitReached(MOBILE_CELL_LIMIT, MOBILE_HISTORY_LIMIT, {
      usedJSHeapSize: 0,
      jsHeapSizeLimit: 0,
    }),
  ).toBe(true);
  expect(
    mobileBoardLimitReached(MOBILE_CELL_LIMIT, MOBILE_HISTORY_LIMIT, {
      usedJSHeapSize: 50,
      jsHeapSizeLimit: 100,
    }),
  ).toBe(false);
});
it("does not impose mobile limits on desktops", () => {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla Macintosh",
    platform: "MacIntel",
    maxTouchPoints: 0,
  });
  expect(mobileBoardLimitReached(2000000, 2000000)).toBe(false);
});
