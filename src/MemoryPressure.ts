export type HeapUsage = {usedJSHeapSize:number; jsHeapSizeLimit:number};
/** Browser heap telemetry is optional; unsupported browsers keep running normally. */
export class MemoryPressureGuard {
 private highSamples=0;
 check(heap?:HeapUsage) {
  if(!heap || !Number.isFinite(heap.usedJSHeapSize) || !Number.isFinite(heap.jsHeapSizeLimit) || heap.jsHeapSizeLimit<=0) {this.highSamples=0;return false;}
  const fraction=heap.usedJSHeapSize/heap.jsHeapSizeLimit;
  this.highSamples=fraction>=.85 ? this.highSamples+1 : 0;
  return fraction>=.95 || this.highSamples>=2;
 }
}

/** iPadOS can advertise itself as a Mac. Do not rely on heap telemetry on WebKit. */
export function isMemoryConstrainedDevice() {
 if (typeof navigator === "undefined") return false;
 return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
// Conservative growth limits, not measurements of the device's available RAM.
export const MOBILE_CELL_LIMIT = 200_000;
export const MOBILE_HISTORY_LIMIT = 250_000;
export function mobileBoardLimitReached(cells: number, clicks: number) {
 return isMemoryConstrainedDevice() &&
  (cells >= MOBILE_CELL_LIMIT || clicks >= MOBILE_HISTORY_LIMIT);
}
