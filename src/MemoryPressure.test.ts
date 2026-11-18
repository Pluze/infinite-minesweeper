import {expect,it,vi,afterEach} from 'vitest';
import {MemoryPressureGuard,isMemoryConstrainedDevice,mobileBoardLimitReached} from './MemoryPressure';
it('does not pause unsupported browsers or a transient heap spike',()=>{
 const guard=new MemoryPressureGuard();
 expect(guard.check()).toBe(false);
 expect(guard.check({usedJSHeapSize:86,jsHeapSizeLimit:100})).toBe(false);
 expect(guard.check({usedJSHeapSize:50,jsHeapSizeLimit:100})).toBe(false);
 expect(guard.check({usedJSHeapSize:86,jsHeapSizeLimit:100})).toBe(false);
 expect(guard.check({usedJSHeapSize:87,jsHeapSizeLimit:100})).toBe(true);
});
it('pauses immediately at critical heap pressure',()=>{
 expect(new MemoryPressureGuard().check({usedJSHeapSize:96,jsHeapSizeLimit:100})).toBe(true);
});

afterEach(() => {vi.unstubAllGlobals();});
it.each([
 {userAgent: "Mozilla iPhone EdgiOS", platform: "iPhone", maxTouchPoints: 5},
 {userAgent: "Mozilla Macintosh", platform: "MacIntel", maxTouchPoints: 5},
 {userAgent: "Mozilla Android", platform: "Linux", maxTouchPoints: 5},
])('protects mobile browsers without heap telemetry: %o', platform => {
 vi.stubGlobal('navigator', platform);
 expect(isMemoryConstrainedDevice()).toBe(true);
 expect(mobileBoardLimitReached(199999,249999)).toBe(false);
 expect(mobileBoardLimitReached(200000,0)).toBe(true);
 expect(mobileBoardLimitReached(0,250000)).toBe(true);
});
it('does not impose mobile limits on desktops', () => {
 vi.stubGlobal('navigator',{userAgent:'Mozilla Macintosh',platform:'MacIntel',maxTouchPoints:0});
 expect(mobileBoardLimitReached(2000000,2000000)).toBe(false);
});
