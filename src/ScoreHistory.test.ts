import { HistoryIndex } from "./ScoreHistory";
import { describe, it, expect } from "vitest";
import { historyWindow, reduceHistory, sampleHistory } from "./ScoreHistory";
import { Field } from "./Field";
import { FieldPersistence } from "./FieldPersistence";

describe("score history", () => {
  it("keeps the whole history and includes the baseline for rolling windows", () => {
    const scores = Array.from({ length: 1201 }, (_, i) => i);
    expect(historyWindow(scores, 0)).toHaveLength(1201);
    for (const count of [10, 100, 1000]) {
      const view = historyWindow(scores, count);
      expect(view).toHaveLength(count + 1);
      expect(view[0].click).toBe(1200 - count);
      expect(view.at(-1)!.click).toBe(1200);
    }
    expect(historyWindow([50], 10)).toEqual([{ click: 0, score: 50 }]);
  });
  it("retains a brief mine penalty when reducing a long curve", () => {
    const points = Array.from({ length: 10000 }, (_, click) => ({
      click,
      score: click === 4567 ? -100 : 10,
    }));
    const reduced = reduceHistory(points);
    expect(reduced.length).toBeLessThanOrEqual(302);
    expect(reduced).toContainEqual({ click: 4567, score: -100 });
    expect(reduced[0]).toEqual(points[0]);
    expect(reduced.at(-1)).toEqual(points.at(-1));
    expect(reduced.every((p, i) => !i || p.click > reduced[i - 1].click)).toBe(
      true,
    );
  });
  it("records one point per completed action and persists without truncating", () => {
    const field = new Field(0.2, 3, "history", "1");
    field.clickScores = [0];
    field.open(1, 1);
    field.recordClick();
    expect(field.clickScores).toEqual([0, field.score]);
    field.score -= 100;
    field.recordClick();
    field.recordClick(); // zero-score actions remain visible along the x axis
    const values = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const persistence = new FieldPersistence(storage);
    persistence.save(field, "history");
    const restored = persistence.load("history")!;
    expect(restored.clickScores).toEqual(field.clickScores);
    restored.recordClick();
    expect(restored.clickScores).toHaveLength(5);
    expect(restored.clickScores.at(-1)).toBe(restored.score);
  });
});

it("samples full and rolling history without losing extrema or click positions", () => {
  const scores = Array.from(
    { length: 20000 },
    (_, i) => Math.sin(i / 100) * 100,
  );
  scores[9988] = -500;
  scores[19999] = 999;
  for (const limit of [0, 1000, 100, 10])
    expect(sampleHistory(scores, limit)).toEqual(
      reduceHistory(historyWindow(scores, limit)),
    );
  expect(sampleHistory([], 0)).toEqual([]);
});

it("subtracts the click baseline before sampling extrema and keeps global click indices", () => {
  const scores = Array.from({ length: 1001 }, (_, i) => i);
  scores[450] += 30;
  scores[460] -= 20;
  const points = sampleHistory(scores, 0, 5, 1);
  expect(points).toContainEqual({ click: 450, score: 30 });
  expect(points).toContainEqual({ click: 460, score: -20 });
  expect(sampleHistory(scores, 10, 150, 1)[0]).toEqual({
    click: 990,
    score: 0,
  });
  expect(scores[450]).toBe(480);
});

it("samples both opened-cell metrics before reducing the curve", () => {
  const scores = [0, 2, -98, -97],
    opened = [0, 2, 3, 4];
  const difference = sampleHistory(
    opened,
    0,
    150,
    0,
    (count, i) => scores[i] - count,
  );
  expect(difference.map((p) => p.score)).toEqual([0, 0, -101, -101]);
  const ratio = sampleHistory(opened, 0, 150, 0, (count, i) =>
    count ? scores[i] / count : NaN,
  );
  expect(Number.isNaN(ratio[0].score)).toBe(true);
  expect(ratio[1].score).toBe(1);
  expect(ratio[3].score).toBe(-24.25);
});

it("incrementally indexed sampling matches full scans across appends, windows and metric changes", () => {
  const index = new HistoryIndex(),
    values: number[] = [];
  let seed = 42;
  for (let batch = 0; batch < 5; batch++) {
    for (let i = 0; i < 2000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      values.push(seed % 10000);
    }
    for (const limit of [0, 1000, 10000]) {
      expect(index.sample(values, limit, "raw")).toEqual(
        sampleHistory(values, limit),
      );
      const derive = (v: number, i: number) => v - i;
      expect(index.sample(values, limit, "subtract", derive)).toEqual(
        sampleHistory(values, limit, 150, 0, derive),
      );
    }
  }
});
