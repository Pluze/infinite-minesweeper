import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { FieldPersistence } from "./FieldPersistence";
import { frontierIndex } from "./FrontierIndex";
import { ConstraintPartitions } from "./ConstraintPartitions";
import type { Constraint } from "./RiskEstimator";
const path = process.env.PARTITION_BOARD;
it.skipIf(!path)(
  "compares dirty-region granularity on an identical saved frontier",
  () => {
    const field = new FieldPersistence({
      getItem: () => readFileSync(path!, "utf8"),
    } as unknown as Storage).load("benchmark")!;
    const entries = frontierIndex(field).refresh();
    const initial = new Map<string, Constraint>();
    for (const [key, e] of entries)
      initial.set(key, {
        cells: e.unknown.map((c) => `${c.x},${c.y}`),
        mines: e.remaining,
      });
    const keys = [...initial.keys()];
    const edits = Array.from(
      { length: 100 },
      (_, i) => keys[Math.floor((i * keys.length) / 100)],
    );
    const results = [];
    for (const mode of [0, 16, 32, 64, Infinity]) {
      const graph = new ConstraintPartitions();
      graph.update(initial);
      const buckets = new Map<string, string[]>();
      if (mode > 0 && Number.isFinite(mode))
        for (const key of keys) {
          const [x, y] = key.split(",").map(Number),
            b = `${Math.floor(x / mode)},${Math.floor(y / mode)}`;
          const list = buckets.get(b) ?? [];
          list.push(key);
          buckets.set(b, list);
        }
      let refreshed = 0;
      const start = performance.now();
      for (const key of edits) {
        const changes = new Map<string, Constraint>();
        const [x, y] = key.split(",").map(Number);
        if (mode === Infinity)
          for (const [id, c] of initial) changes.set(id, c);
        else if (mode === 0) {
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const id = `${x + dx},${y + dy}`,
                c = initial.get(id);
              if (c) changes.set(id, c);
            }
        } else {
          const dirty = new Set<string>();
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++)
              dirty.add(
                `${Math.floor((x + dx) / mode)},${Math.floor((y + dy) / mode)}`,
              );
          for (const b of dirty)
            for (const id of buckets.get(b) ?? [])
              changes.set(id, initial.get(id)!);
        }
        refreshed += changes.size;
        graph.update(changes);
      }
      results.push({
        mode:
          mode === 0
            ? "exact-neighborhood"
            : mode === Infinity
              ? "global"
              : `${mode}x${mode}`,
        ms: performance.now() - start,
        refreshed,
        components: graph.groups.size,
      });
    }
    console.log(
      JSON.stringify({ clues: keys.length, updates: edits.length, results }),
    );
    writeFileSync(
      "/private/tmp/minesweeper-partition-comparison.json",
      JSON.stringify(results, null, 2),
    );
  },
  120000,
);
