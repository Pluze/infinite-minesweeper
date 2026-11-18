export type HeapUsage = { usedJSHeapSize: number; jsHeapSizeLimit: number };

export function reportedHeapFraction(heap?: HeapUsage) {
  if (
    !heap ||
    !Number.isFinite(heap.usedJSHeapSize) ||
    !Number.isFinite(heap.jsHeapSizeLimit) ||
    heap.usedJSHeapSize < 0 ||
    heap.jsHeapSizeLimit <= 0
  )
    return undefined;
  return heap.usedJSHeapSize / heap.jsHeapSizeLimit;
}

/** Pause only in response to usable browser-reported heap pressure. */
export class MemoryPressureGuard {
  private highSamples = 0;

  check(heap?: HeapUsage) {
    const fraction = reportedHeapFraction(heap);
    this.highSamples =
      fraction !== undefined && fraction >= 0.85 ? this.highSamples + 1 : 0;
    return (
      fraction !== undefined && (fraction >= 0.95 || this.highSamples >= 2)
    );
  }
}

/** iPadOS can advertise itself as a Mac. Do not rely on heap telemetry on WebKit. */
export function isMemoryConstrainedDevice() {
  if (typeof navigator === "undefined") return false;
  return (
    /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
