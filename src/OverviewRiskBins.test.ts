import { expect, it } from "vitest";
import { OverviewRiskBins } from "./OverviewRiskBins";
it("keeps safe and mine colors independent of insertion order", () => {
  const a = new OverviewRiskBins(.5), b = new OverviewRiskBins(.5);
  a.add(1, 1, 0); a.add(2, 2, 1);
  b.add(2, 2, 1); b.add(1, 1, 0);
  expect([...a.bins.values()]).toEqual([...b.bins.values()]);
  expect([...a.bins.values()][0]).toMatchObject({low: 0, high: 1});
  expect(a.stride * .5).toBeGreaterThanOrEqual(9);
});
it("bounds overdraw for many cells occupying the same screen area", () => {
  const bins = new OverviewRiskBins(.01);
  for (let x = 0; x < 800; x++) for (let y = 0; y < 20; y++) bins.add(x, y, .2);
  expect(bins.bins.size).toBe(1);
});
