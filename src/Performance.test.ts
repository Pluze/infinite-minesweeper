import { it } from "vitest";
import { readFileSync } from "node:fs";
import { FieldPersistence } from "./FieldPersistence";
import { findNumberMove } from "./MovePlanner";
import { probabilityModel } from "./MineProbability";
import { boardGeometry } from "./BoardGeometry";
import { trackDensity } from "./DensityHistory";
const fixture = process.env.PERF_BOARD;
it.skipIf(!fixture)("profiles actual board decisions and actions", () => {
  const json = readFileSync(fixture!, "utf8");
  const f = new FieldPersistence({
    getItem: () => json,
  } as unknown as Storage).load("perf")!;
  trackDensity(f);
  const geometry = boardGeometry(f),
    prepare = geometry.prepare.bind(geometry);
  let geoMs = 0;
  geometry.prepare = (near) => {
    const t = performance.now();
    prepare(near);
    geoMs += performance.now() - t;
  };
  let near = { x: 1, y: 1 },
    selectMs = 0,
    guessMs = 0,
    actMs = 0,
    guesses = 0,
    steps = 0;
  const start = performance.now();
  for (; steps < 2000 && performance.now() - start < 15000; steps++) {
    let t = performance.now(),
      move = findNumberMove(f, near);
    selectMs += performance.now() - t;
    if (!move) {
      t = performance.now();
      move = probabilityModel(f).guess(near)?.cell;
      guessMs += performance.now() - t;
      guesses++;
    }
    if (!move) break;
    t = performance.now();
    f.open(move.x, move.y);
    f.recordClick();
    actMs += performance.now() - t;
    near = move;
  }
  console.log(
    JSON.stringify({
      steps,
      rate: Math.round((steps * 1000) / (performance.now() - start)),
      selectMs,
      geoMs,
      guessMs,
      actMs,
      guesses,
      geometry: geometry.stats,
      score: f.score,
    }),
  );
});
