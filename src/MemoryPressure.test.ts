import { expect, it, vi, afterEach } from "vitest";
import {
  MemoryPressureGuard,
  isMemoryConstrainedDevice,
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
])(
  "identifies mobile browsers, including iPads in desktop mode: %o",
  (platform) => {
    vi.stubGlobal("navigator", platform);
    expect(isMemoryConstrainedDevice()).toBe(true);
  },
);
it("distinguishes desktop Macs from iPads in desktop mode", () => {
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla Macintosh",
    platform: "MacIntel",
    maxTouchPoints: 0,
  });
  expect(isMemoryConstrainedDevice()).toBe(false);
});
