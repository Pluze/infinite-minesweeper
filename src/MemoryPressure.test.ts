import {expect,it} from 'vitest';
import {MemoryPressureGuard} from './MemoryPressure';
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
