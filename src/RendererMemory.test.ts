import {expect,it,vi,afterEach} from 'vitest';
import {FieldRenderer} from './FieldRenderer';
afterEach(()=>{vi.unstubAllGlobals();});
it('releases offscreen sprites and reconstructs a visited chunk from board data',()=>{
 vi.stubGlobal('window',{innerWidth:390,innerHeight:844});
 const stopAnimation=vi.fn(),destroy=vi.fn();
 const container={visible:true,children:[{destroy}],removeChildren:vi.fn(function(this:any){const out=this.children;this.children=[];return out;})};
 const chunk={x:0,y:0,container,dirty:false};
 const renderer:any={fieldContainer:{scale:{x:1},x:0,y:0},detailChunks:new Map([['0,0',chunk]]),cellSprites:{0:{0:{stopAnimation}}},field:{getCell:vi.fn(()=>({isOpen:true}))},updateDetailed:vi.fn()};
 (FieldRenderer.prototype as any).cullDetails.call(renderer,false);
 expect(stopAnimation).toHaveBeenCalledOnce();expect(destroy).toHaveBeenCalledWith({children:true});expect(renderer.cellSprites).toEqual({});expect(chunk.dirty).toBe(true);
 (FieldRenderer.prototype as any).cullDetails.call(renderer,true);
 expect(renderer.updateDetailed).toHaveBeenCalledTimes(4096);expect(chunk.dirty).toBe(false);
});

it('streams initial drawing without materializing a full-board cell array', () => {
 const cells=[{x:-1,y:0,isOpen:true},{x:0,y:0,isFlagged:true},{x:1,y:0}];
 const renderer:any={field:{cellData:{*cells(){yield* cells;}},getAll:vi.fn(()=>{throw new Error('full-board allocation');})},updateCell:vi.fn()};
 (FieldRenderer.prototype as any).updateAllCells.call(renderer);
 expect(renderer.updateCell.mock.calls).toEqual([[cells[0],false],[cells[1],false]]);
 expect(renderer.field.getAll).not.toHaveBeenCalled();
});
