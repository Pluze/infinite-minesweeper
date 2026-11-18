import { it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import seedrandom from "seedrandom";
import { FieldPersistence } from "./FieldPersistence";
import { findNumberMove, islandFocus } from "./MovePlanner";
import { probabilityModel } from "./MineProbability";
import { boardGeometry } from "./BoardGeometry";
import { trackDensity } from "./DensityHistory";
import * as sampling from "./ConstraintSampler";
import * as reduction from "./ConstraintReduction";
import { frontierIndex } from "./FrontierIndex";
const fixture = process.env.ABLATION_BOARD;
it.skipIf(!fixture)(
  "measures feature ablations on the same saved board",
  () => {
    const json = readFileSync(fixture!, "utf8");
    const cases = [
      "baseline",
      "safe-only",
      "no-sampling",
      "no-reduction",
      "no-local-density",
      "no-geometry-ranking",
      "no-islands",
      "force-island-rebuild",
      "no-history",
      "cheap-probability",
      "cheap-probability-no-geometry",
      "replay-only",
    ];
    const results: unknown[] = [];
    let replay: { x: number; y: number }[] = [];
    for (const name of cases.filter(
      (name) =>
        !process.env.ABLATION_CASE || name === process.env.ABLATION_CASE,
    )) {
      const trials = [];
      for (let trial = 0; trial < 2; trial++) {
        const f = new FieldPersistence({
          getItem: () => json,
        } as unknown as Storage).load("bench")!;
        Object.assign(f, { rng: seedrandom("ablation-board") });
        vi.spyOn(Math, "random").mockImplementation(
          seedrandom("ablation-sampler"),
        );
        if (name !== "no-history") trackDensity(f);
        const geometry = boardGeometry(f),
          model = probabilityModel(f);
        if (name === "no-sampling")
          vi.spyOn(sampling, "sampleConstraints").mockReturnValue(undefined);
        if (name === "no-reduction")
          vi.spyOn(reduction, "reduceConstraints").mockImplementation(
            (constraints) => ({ constraints, known: new Map() }),
          );
        if (name === "no-local-density")
          vi.spyOn(model, "prior").mockReturnValue(f.probability);
        if (name.includes("no-geometry") || name === "no-geometry-ranking") {
          vi.spyOn(geometry, "weight").mockReturnValue(0);
          vi.spyOn(geometry, "rank").mockReturnValue(0);
        }
        if (name === "force-island-rebuild") {
          const prepare = geometry.prepare.bind(geometry);
          vi.spyOn(geometry, "prepare").mockImplementation((near) => {
            Object.assign(geometry, { topologyDirty: true });
            prepare(near);
          });
        }
        if (name === "no-islands")
          vi.spyOn(geometry, "islandPriority").mockReturnValue(0);
        let cheapRevision = -1,
          cheapResult:
            | { risks: Map<string, number>; approximate: Set<string> }
            | undefined;
        if (name.startsWith("cheap-probability"))
          vi.spyOn(model, "snapshot").mockImplementation(() => {
            const index = frontierIndex(f);
            if (cheapResult && cheapRevision === index.revision)
              return cheapResult;
            cheapRevision = index.revision;
            const risks = new Map<string, number>();
            for (const e of frontierIndex(f).refresh().values())
              for (const c of e.unknown) {
                const key = c.x + "," + c.y;
                risks.set(
                  key,
                  Math.max(risks.get(key) ?? 0, e.remaining / e.unknown.length),
                );
              }
            return (cheapResult = {
              risks,
              approximate: new Set(risks.keys()),
            });
          });
        let near = { x: 1, y: 1 },
          select = 0,
          guess = 0,
          act = 0,
          guesses = 0,
          count = 0;
        // Exclude one-time index construction from steady-state throughput.
        findNumberMove(f, near);
        model.snapshot();
        const before = f.score,
          positions: { x: number; y: number }[] = [];
        const started = performance.now();
        for (
          ;
          count < Number(process.env.ABLATION_STEPS ?? 1000) &&
          performance.now() - started < 15000;
          count++
        ) {
          let t = performance.now();
          let move =
            name === "replay-only" ? replay[count] : findNumberMove(f, near);
          select += performance.now() - t;
          if (!move && name !== "replay-only") {
            t = performance.now();
            if (name === "safe-only") {
              const focus = islandFocus(f);
              if (focus.size) move = model.guess(near, true, focus)?.cell;
              move ??= findNumberMove(f, near, false);
              move ??= model.guess(near, true)?.cell;
            } else move = model.guess(near)?.cell;
            guess += performance.now() - t;
            guesses++;
          }
          if (!move) break;
          t = performance.now();
          const revision = frontierIndex(f).revision;
          f.open(move.x, move.y);
          if (frontierIndex(f).revision === revision) throw new Error(`No-op selected at ${move.x},${move.y}, step ${count}`);
          if (name !== "no-history") f.recordClick();
          act += performance.now() - t;
          near = { x: move.x, y: move.y };
          positions.push(near);
        }
        const elapsed = performance.now() - started;
        if (name === "baseline" && trial === 0) replay = positions;
        trials.push({
          rate: Math.round((count * 1000) / elapsed),
          count,
          select: Math.round(select),
          guess: Math.round(guess),
          act: Math.round(act),
          inferenceRequests: guesses,
          scoreGain: f.score - before,
          geometry: geometry.stats,
          inference: (model as any).partitions.stats,
        });
        vi.restoreAllMocks();
      }
      const row = { name, trials };
      results.push(row);
      process.stdout.write(JSON.stringify(row) + "\n");
    }
    writeFileSync(
      process.env.ABLATION_OUTPUT ?? "/private/tmp/minesweeper-ablation.json",
      JSON.stringify(results, null, 2),
    );
  },
  120000,
);
