import {expect,it} from "vitest";
import {Field} from "./Field";
it("matches decoded clue counts for every encoded state, including legacy unknown mines",()=>{
 const field=new Field(.2,0,"clue","1");
 for(let center=-1;center<16;center++) {
  if(center>=0) field.cellData.numberStorage.set(0,0,center);
  for(let neighbor=0;neighbor<16;neighbor++) {
   field.cellData.numberStorage.set(1,0,neighbor);
   const expected=field.getCell(0,0).isOpen===false?null:field.getNeighbors(0,0).filter(c=>c.isMine).length;
   expect(field.value(0,0)).toBe(expected);
  }
 }
});
