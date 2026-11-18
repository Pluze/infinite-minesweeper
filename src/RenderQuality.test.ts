import { it, expect } from "vitest";
import { qualityFor, renderQuality } from "./RenderQuality";
import { Field } from "./Field";
const normal = {
  running: false,
  target: 65536,
  scale: 2,
  reducedMotion: false,
};
it("restores full detail when a high target is paused", () => {
  const paused = qualityFor(normal),
    running = qualityFor({ ...normal, running: true });
  expect(paused.animateCells).toBe(true);
  expect(paused.maxFPS).toBe(0);
  expect(running.animateCells).toBe(false);
  expect(running.maxFPS).toBe(0);
  expect(running.cameraCooldownMs).toBe(2000);
  expect(paused.cameraCooldownMs).toBe(0);
  expect(running.flashCount).toBe(1);
  expect(running.probabilityLabels).toBe(true);
  expect(running.details).toBe(true); // preserve readable clues at close zoom
});
it("uses a single low-detail layer and suppresses tiny flashes when zoomed out", () => {
  const overview = qualityFor({ ...normal, scale: 0.6 }),
    dense = qualityFor({ ...normal, scale: 0.25 });
  expect(overview.details).toBe(false);
  expect(overview.animateCells).toBe(false);
  expect(overview.maxFPS).toBe(0);
  expect(dense.flashCount).toBe(0);
  expect(dense.overlayResolution).toBe(1);
  expect(dense.probabilityLabels).toBe(false);
});
it("reduces expensive secondary views under load without changing field state", () => {
  const field = new Field(0.2, 3, "quality", "1"),
    before = JSON.stringify(field);
  const profile = renderQuality(field);
  profile.update({ running: true, target: 65536 });
  expect(profile.current.probabilityMs).toBe(250);
  expect(profile.current.plotMs).toBe(500);
  profile.update({ running: false });
  expect(profile.current.probabilityMs).toBe(100);
  expect(JSON.stringify(field)).toBe(before);
});
it("honors reduced motion even at a slow speed", () => {
  const quality = qualityFor({ ...normal, reducedMotion: true });
  expect(quality.animateCells).toBe(false);
  expect(quality.flashExpand).toBe(false);
});
