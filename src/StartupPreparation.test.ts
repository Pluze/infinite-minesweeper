import {expect,it} from 'vitest';
import {Field} from './Field';
import {prepareProbability,probabilityModel} from './MineProbability';
import {frontierIndex} from './FrontierIndex';
import {trackDensity,trackDensityAsync} from './DensityHistory';
function board() {
 const field=new Field(.2,0,'startup','1');
 for(let y=0;y<50;y++) for(let x=0;x<50;x++)
  field._setCell(x,y,{isOpen:x%9!==0,isMine:(x+y)%7===0});
 return field;
}
it('prepares exactly the same clues, priors and histories in batches',async()=>{
 const synchronous=board(),asynchronous=board(),controller=new AbortController();
 trackDensity(synchronous);
 await trackDensityAsync(asynchronous,controller.signal,()=>{});
 await prepareProbability(asynchronous,controller.signal,()=>{});
 expect(frontierIndex(asynchronous).refresh()).toEqual(frontierIndex(synchronous).refresh());
 for(const [x,y] of [[0,0],[10,20],[49,49]])
  expect(probabilityModel(asynchronous).prior(x,y)).toBe(probabilityModel(synchronous).prior(x,y));
 expect(asynchronous.densityHistory).toEqual(synchronous.densityHistory);
 expect(asynchronous.mineCountHistory).toEqual(synchronous.mineCountHistory);
});
it('cancels preparation at a batch boundary',async()=>{
 const controller=new AbortController();
 await expect(prepareProbability(board(),controller.signal,()=>controller.abort())).rejects.toMatchObject({name:'AbortError'});
});
