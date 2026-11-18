import { expect, it } from "vitest";
import { Field } from "./Field";

it("opens a large zero region exactly once and stops at its mine boundary", () => {
  const field = new Field(0.1, 0, "test", "large-flood");
  field.pristine = false;
  const size = 128;
  for (let y = -1; y <= size; y++) {
    for (let x = -1; x <= size; x++) {
      field._setCell(x, y, {
        isMine: x < 0 || y < 0 || x === size || y === size,
      });
    }
  }
  field.flag(64, 65);
  let changes = 0;
  field.on("cellChanged", () => changes++);

  const opened = field.open(64, 64);
  expect(opened.length).toBe(size * size - 1);
  expect(changes).toBe(opened.length);
  expect(field.score).toBe(opened.length);
  expect(field.getCell(64, 65)).toMatchObject({ isFlagged: true, isOpen: false });
  expect(field.getCell(-1, 64)).toMatchObject({ isMine: true, isOpen: false });
});
