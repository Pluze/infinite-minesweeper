import { formatInteger } from "./NumberFormat";
import { renderQuality } from "./RenderQuality";
import { Field } from "./Field";
import { HistoryIndex } from "./ScoreHistory";

export class ScorePlot {
  constructor(field: Field, density = false) {
    const historyIndex = new HistoryIndex();
    const detonatedIndex = new HistoryIndex();
    const calculate = (score: number, opened: number) =>
      opened ? score / opened : NaN;
    const detonationRatio = (detonated: number, i: number) => {
      const click = i + field.detonatedCountStartClick;
      const known = field.mineCountHistory[click - field.mineCountStartClick];
      return known > 0 ? detonated / known : NaN;
    };
    const storageKey = density ? "densityPlotWindow" : "scorePlotWindow";
    const format = (value: number) =>
      density
        ? `${(value * 100).toFixed(2)}%`
        : Number.isFinite(value)
          ? `${value.toFixed(3)} points/cell`
          : "—";
    const panel = document.querySelector<HTMLElement>(
      density ? "#density-plot" : "#score-plot",
    )!;
    const svg = panel.querySelector<SVGSVGElement>("svg")!;
    const summary = panel.querySelector<HTMLElement>(".plot-summary")!;
    const tooltip = panel.querySelector<HTMLElement>(".plot-tooltip")!;
    const buttons = panel.querySelectorAll<HTMLButtonElement>(
      "button[data-window]",
    );
    const profile = renderQuality(field);
    let limit = Number(localStorage.getItem(storageKey) ?? 0);
    if (![0, 1000, 10000, 100000].includes(limit)) limit = 0;
    let dirty = true,
      lastDraw = -Infinity;
    const left = 46,
      right = density ? 302 : 270,
      top = 14,
      bottom = 132;
    let first = 0,
      final = 0;
    const select = () =>
      buttons.forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(Number(button.dataset.window) === limit),
        ),
      );
    buttons.forEach(
      (button) =>
        (button.onclick = () => {
          limit = Number(button.dataset.window);
          localStorage.setItem(storageKey, String(limit));
          select();
          dirty = true;
          tooltip.hidden = true;
        }),
    );
    select();
    field.on("clickRecorded", () => {
      dirty = true;
      if (!tooltip.hidden) tooltip.hidden = true;
    });
    const render = (now: number) => {
      requestAnimationFrame(render);
      if (!dirty || document.hidden || now - lastDraw < profile.current.plotMs)
        return;
      lastDraw = now;
      if (!panel.getClientRects().length) return;
      dirty = false;
      const points = density
        ? historyIndex
            .sample(field.densityHistory, limit, "density")
            .map((p) => ({
              ...p,
              click: p.click + field.densityStartClick,
            }))
        : historyIndex
            .sample(field.openedCountHistory, limit, "divide", (opened, i) =>
              calculate(
                field.clickScores[i + field.openedCountStartClick],
                opened,
              ),
            )
            .map((p) => ({
              ...p,
              click: p.click + field.openedCountStartClick,
            }))
            .filter((p) => Number.isFinite(p.score));
      if (!points.length) {
        svg.innerHTML = "";
        summary.textContent = "—";
        return;
      }
      first = points[0].click;
      final = points[points.length - 1].click;
      const reduced = points;
      let min = Infinity,
        max = -Infinity;
      for (const p of reduced) {
        min = Math.min(min, p.score);
        max = Math.max(max, p.score);
      }
      const pad = Math.max(density ? 0.002 : 0.01, (max - min) * 0.12);
      min = density ? Math.max(0, min - pad) : min - pad;
      max = density ? Math.min(1, max + pad) : max + pad;
      const sx = (click: number) =>
        left + ((click - first) / Math.max(1, final - first)) * (right - left);
      const sy = (score: number) =>
        bottom - ((score - min) / (max - min)) * (bottom - top);
      const path = reduced
        .map(
          (p, i) =>
            `${i ? "L" : "M"}${sx(p.click).toFixed(2)},${sy(p.score).toFixed(2)}`,
        )
        .join(" ");
      const latest = points[points.length - 1];
      let grid = "";
      for (let i = 0; i <= 2; i++) {
        const y = top + ((bottom - top) * i) / 2;
        const raw = max - ((max - min) * i) / 2;
        const value = density ? `${(raw * 100).toFixed(1)}%` : raw.toFixed(2);
        grid += `<line x1="${left}" x2="${right}" y1="${y}" y2="${y}" class="plot-grid"/><text x="${left - 7}" y="${y + 3}" text-anchor="end">${value}</text>`;
      }
      const ticks = [
        ...new Set([first, Math.round((first + final) / 2), final]),
      ];
      for (const tick of ticks)
        grid += `<text x="${sx(tick)}" y="150" text-anchor="middle">${formatInteger(tick)}</text>`;
      let overlay = "";
      const ratios = density
        ? []
        : detonatedIndex
            .sample(
              field.detonatedCountHistory,
              limit,
              "detonated/known",
              detonationRatio,
            )
            .map((p) => ({
              click: p.click + field.detonatedCountStartClick,
              score: p.score,
            }))
            .filter(
              (p) =>
                Number.isFinite(p.score) &&
                p.click >= first &&
                p.click <= final,
            );
      if (ratios.length) {
        const ratioMax = Math.min(
          1,
          Math.max(0.01, ...ratios.map((p) => p.score * 1.15)),
        );
        const ry = (p: number) => bottom - (p / ratioMax) * (bottom - top);
        const curve = ratios
          .map(
            (p, i) =>
              `${i ? "L" : "M"}${sx(p.click).toFixed(2)},${ry(p.score).toFixed(2)}`,
          )
          .join(" ");
        for (let i = 0; i <= 2; i++) {
          const p = ratioMax * (1 - i / 2);
          overlay += `<text x="${right + 5}" y="${ry(p) + 3}" class="mine-ratio-axis">${(p * 100).toFixed(1)}%</text>`;
        }
        overlay += `<path d="${curve}" class="plot-line mine-ratio-line"/>`;
        const last = ratios[ratios.length - 1];
        overlay += `<circle cx="${sx(last.click)}" cy="${ry(last.score)}" r="2.5" fill="#ffaf70"/>`;
      }
      svg.innerHTML = `<title>${density ? "Mine density" : "Score divided by opened cells"} versus clicks: ${formatInteger(first)} to ${formatInteger(final)}; current ${format(latest.score)}</title>${grid}${overlay}<path d="${path}" class="plot-line"/><circle cx="${sx(latest.click)}" cy="${sy(latest.score)}" r="3" fill="#a0d3c5"/><text x="${right}" y="170" text-anchor="end">Clicks</text>`;
      summary.textContent = `${format(latest.score)}${ratios.length ? ` · ${(ratios[ratios.length - 1].score * 100).toFixed(2)}% detonated` : ""} · ${formatInteger(final)} clicks`;
    };
    svg.addEventListener("pointermove", (event) => {
      const bounds = svg.getBoundingClientRect();
      const x = ((event.clientX - bounds.left) / bounds.width) * 320;
      const click = Math.round(
        first +
          Math.max(0, Math.min(1, (x - left) / (right - left))) *
            (final - first),
      );
      tooltip.textContent = density
        ? `Click ${formatInteger(click)} · ${format(field.densityHistory[click - field.densityStartClick])}`
        : `Click ${formatInteger(click)} · ${format(calculate(field.clickScores[click], field.openedCountHistory[click - field.openedCountStartClick]))}`;
      if (!density) {
        const ratio = detonationRatio(
          field.detonatedCountHistory[click - field.detonatedCountStartClick],
          click - field.detonatedCountStartClick,
        );
        tooltip.textContent += ` · Detonated / known mines: ${Number.isFinite(ratio) ? (ratio * 100).toFixed(2) + "%" : "—"}`;
      }
      tooltip.hidden = false;
    });
    svg.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
    });
    requestAnimationFrame(render);
  }
}
