import { it, expect } from "vitest";
import { Field } from "./Field";
import { ConnectedRegions } from "./ConnectedRegions";
import { frontierIndex, keyOf } from "./FrontierIndex";
it("matches a fresh flood fill across additions, merges and removals", () => {
  const f = new Field(0.2, 0, "regions", "1"),
    regions = new ConnectedRegions(f);
  let seed = 41;
  for (let step = 0; step < 100; step++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % 9;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const y = seed % 9;
    f.flag(x, y);
    const known = frontierIndex(f).known;
    for (const start of known.values()) {
      const visited = new Set([keyOf(start.x, start.y)]),
        queue = [start];
      for (let i = 0; i < queue.length; i++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const key = keyOf(queue[i].x + dx, queue[i].y + dy),
              cell = known.get(key);
            if (cell && !visited.has(key)) {
              visited.add(key);
              queue.push(cell);
            }
          }
      const region = regions.at(start)!;
      expect(new Set(region.points.map((p) => keyOf(p.x, p.y)))).toEqual(
        visited,
      );
      expect(region.sumX).toBe(queue.reduce((sum, p) => sum + p.x, 0));
    }
  }
});
