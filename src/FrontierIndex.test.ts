import { expect, it } from "vitest";
import { Field } from "./Field";
import { frontierIndex } from "./FrontierIndex";
it("refreshes visible clue constraints when a legacy save generates missing neighbors", () => {
  const field = new Field(.2, 0, "legacy-neighbors", "1");
  field._setCell(0, 0, {isOpen: true, isMine: false});
  const index = frontierIndex(field);
  expect(index.refresh().get("0,0")!.remaining).toBe(0);
  field._setCell(1, 1, {isMine: true});
  expect(index.refresh().get("0,0")!.remaining).toBe(1);
});
