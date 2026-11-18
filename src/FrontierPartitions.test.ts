import { expect, it } from "vitest";
import { Field } from "./Field";
import { frontierIndex } from "./FrontierIndex";
import { FrontierPartitions } from "./FrontierPartitions";
it("reuses distant inference but invalidates dependencies and nearby density priors", () => {
  const field = new Field(0.2, 0, "partition-cache", "1");
  field._setCell(0, 0, { isOpen: true, isMine: false });
  field._setCell(100, 0, { isOpen: true, isMine: false });
  const partition = new FrontierPartitions(field, () => 0.2);
  partition.snapshot();
  const solved = partition.stats.solved;
  expect(solved).toBe(2);
  partition.snapshot();
  expect(partition.stats.solved).toBe(solved);
  // Outside the clue's 3x3 neighborhood, but inside its density-prior influence.
  field._setCell(7, 0, { isFlagged: true, isMine: true });
  field.emit("cellChanged", field.getCell(7, 0));
  partition.snapshot();
  expect(partition.stats.solved).toBe(solved + 1);
  field._setCell(1, 0, { isFlagged: true, isMine: true });
  field.emit("cellChanged", field.getCell(1, 0));
  partition.snapshot();
  expect(partition.stats.solved).toBe(solved + 2);
  expect(frontierIndex(field).entries.size).toBe(2);
});

it("keeps a focused no-safe-move result across unrelated changes and prior updates", () => {
  const field = new Field(.2, 0, "proof-cache", "1");
  field._setCell(0, 0, {isOpen: true, isMine: false});
  field._setCell(100, 0, {isOpen: true, isMine: false});
  const partition = new FrontierPartitions(field, () => .2);
  const focus = new Set(["1,0"]);
  const first = partition.snapshot(focus, true);
  const solved = partition.stats.solved;
  field._setCell(7, 0, {isFlagged: true, isMine: true});
  field.emit("cellChanged", field.getCell(7, 0));
  field._setCell(101, 0, {isFlagged: true, isMine: true});
  field.emit("cellChanged", field.getCell(101, 0));
  expect(partition.snapshot(focus, true)).toBe(first);
  expect(partition.stats.solved).toBe(solved);
  field._setCell(1, 0, {isFlagged: true, isMine: true});
  field.emit("cellChanged", field.getCell(1, 0));
  expect(partition.snapshot(focus, true)).not.toBe(first);
});

it("does not refresh unrelated graph partitions but sees new focused dependencies", () => {
  const field = new Field(.2, 0, "focused-dirty", "1");
  field._setCell(0, 0, {isOpen: true, isMine: false});
  field._setCell(100, 0, {isOpen: true, isMine: false});
  const partition = new FrontierPartitions(field, () => .2);
  const focus = new Set(["1,0"]);
  const initial = partition.snapshot(focus, true);
  const before = partition.stats.refreshMs;
  field._setCell(101, 0, {isFlagged: true});
  field.emit("cellChanged", field.getCell(101, 0));
  expect(partition.snapshot(focus, true)).toBe(initial);
  expect(partition.stats.refreshMs).toBe(before);
  field._setCell(2, 0, {isOpen: true, isMine: false});
  field.emit("cellChanged", field.getCell(2, 0));
  expect(partition.snapshot(focus, true)).not.toBe(initial);
  expect(partition.graph.constraints.has("2,0")).toBe(true);
});
