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
