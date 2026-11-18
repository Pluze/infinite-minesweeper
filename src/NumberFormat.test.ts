import {expect,it} from 'vitest';
import {formatInteger} from './NumberFormat';
it('groups positive and negative UI integers with commas',()=>{
 expect(formatInteger(1234567)).toBe('1,234,567');
 expect(formatInteger(-12345)).toBe('-12,345');
 expect(formatInteger(0)).toBe('0');
});
