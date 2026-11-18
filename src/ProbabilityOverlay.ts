import { formatInteger } from "./NumberFormat";
import { OverviewRiskBins } from "./OverviewRiskBins";
import { ProbabilityPreview } from "./ProbabilityPreview";
import { renderQuality } from "./RenderQuality";
import { frontierIndex } from "./FrontierIndex";
import { Field } from "./Field";
import { probabilityModel, cellKey } from "./MineProbability";
import { CELL_WIDTH } from "./CellSprite";

export class ProbabilityOverlay {
  constructor(
    field: Field,
    transform: () => { x: number; y: number; k: number },
  ) {
    const canvas = document.createElement("canvas");
    canvas.id = "probability-overlay";
    canvas.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:2;image-rendering:auto";
    document.body.appendChild(canvas);
    const tooltip = document.createElement("div");
    tooltip.id = "risk-tooltip";
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    const context = canvas.getContext("2d")!;
    const model = probabilityModel(field);
    const profile = renderQuality(field);
    let lastSignature = "",
      lastProfile = -1,
      lastVisible: boolean | undefined;
    const toggle =
      document.querySelector<HTMLInputElement>("#show-probability")!;
    const hint = document.querySelector<HTMLElement>("#overlay-hint")!;
    toggle.checked = localStorage.getItem("probabilityOverlay") !== "off";
    let held = false;
    let pointer: { x: number; y: number } | undefined;
    const updateHint = () => {
      const visible = toggle.checked !== held;
      hint.textContent = held
        ? `Holding F · temporarily ${visible ? "shown" : "hidden"}`
        : "Hold F to temporarily invert visibility";
      toggle.setAttribute(
        "aria-description",
        held ? hint.textContent : "Toggle probability overlay",
      );
    };
    toggle.addEventListener("change", () => {
      localStorage.setItem("probabilityOverlay", toggle.checked ? "on" : "off");
      updateHint();
    });
    window.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement | null;
      if (
        event.code !== "KeyF" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.isContentEditable ||
        target?.matches(
          "textarea, select, input:not([type=checkbox]):not([type=range])",
        )
      )
        return;
      event.preventDefault();
      held = true;
      updateHint();
    });
    const release = () => {
      held = false;
      pointer = undefined;
      updateHint();
    };
    window.addEventListener("keyup", (event) => {
      if (event.code === "KeyF") {
        held = false;
        updateHint();
      }
    });
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) release();
    });
    window.addEventListener("pointermove", (event) => {
      pointer =
        (event.target as HTMLElement)?.tagName === "CANVAS"
          ? { x: event.clientX, y: event.clientY }
          : undefined;
    });
    document.documentElement.addEventListener("pointerleave", () => {
      pointer = undefined;
    });
    updateHint();
    let refreshed = -Infinity;
    const preview = new ProbabilityPreview(field);
    preview.request();
    let snapshot = preview.result;
    let previewVersion = preview.version;
    const index = frontierIndex(field);
    const known = index.known;
    let lastPaintRevision = -1;
    let markers: { x: number; y: number; p: number; key: string }[] = [];
    const invalid = new Set<string>();
    field.on("cellChanged", (cell: { x: number; y: number }) => {
      if (preview.background) return;
      // A changed cell affects neighboring clues and their adjacent unknowns.
      // Invalidate the live tooltip; visual estimates remain until replaced atomically.
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          invalid.add(cellKey(cell.x + dx, cell.y + dy));
    });
    const format = (p: number) =>
      `${p > 0 && p < 0.01 ? "<1" : p < 1 && p > 0.99 ? ">99" : Math.round(p * 100)}%`;
    const tone = (p: number) =>
      p === 0
        ? "80,255,222"
        : p <= 0.1
          ? "80,211,255"
          : p < 0.5
            ? "190,174,117"
            : p < 0.9
              ? "255,158,65"
              : "255,65,100";
    let measuredMs = 0, requestMs = 0, measuredFrames = 0, measuredAt = performance.now();
    const draw = (now: number) => {
      const drawStart = performance.now();
      if (document.hidden) return;
      if (toggle.checked === held && lastVisible === false) return;
      const quality = profile.current;
      const t = transform();
      const signature = `${t.x},${t.y},${t.k},${pointer?.x},${pointer?.y},${toggle.checked !== held},${window.innerWidth},${window.innerHeight}`;
      const changed =
        signature !== lastSignature ||
        profile.revision !== lastProfile ||
        preview.version !== previewVersion;
      if (refreshed === -Infinity) refreshed = now;
      const refreshDue =
        preview.needsUpdate &&
        now - refreshed >= quality.probabilityMs;
      if (!changed && lastPaintRevision === index.revision && !refreshDue)
        return;
      lastPaintRevision = index.revision;
      lastVisible = toggle.checked !== held;
      // Camera/hover changes remain responsive; static views do not redraw every RAF.
      lastSignature = signature;
      lastProfile = profile.revision;
      const width = window.innerWidth,
        height = window.innerHeight;
      const ratio = Math.min(
        window.devicePixelRatio || 1,
        quality.overlayResolution,
      );
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      tooltip.hidden = true;
      if (toggle.checked === held) return;
      // A completed worker result must not trigger another request. Otherwise
      // fast worker replies bypass probabilityMs and serialize the full frontier
      // on every animation frame while auto-play changes the board.
      if (refreshDue) {
        const requestStart = performance.now();
        preview.request();
        requestMs += performance.now() - requestStart;
        refreshed = now;
      }
      if (preview.version !== previewVersion || !markers.length) {
        snapshot = preview.result;
        previewVersion = preview.version;
        invalid.clear();
        markers = [...snapshot.risks]
          .map(([key, p]) => {
            const [x, y] = key.split(",").map(Number);
            return { x, y, p, key };
          })
          .sort(
            (a, b) =>
              Number(a.p <= 0.01 || a.p >= 0.99) -
              Number(b.p <= 0.01 || b.p >= 0.99),
          );
      }
      const size = CELL_WIDTH * t.k;
      if (size < 14) {
        context.fillStyle = "rgba(5,9,14,0.5)";
        context.fillRect(0, 0, width, height);
      }
      const risk = (x: number, y: number) => {
        const key = cellKey(x, y),
          c = known.get(key);
        return c?.isOpen
          ? c.isMine
            ? 1
            : 0
          : c?.isFlagged
            ? 1
            : (snapshot.risks.get(key) ?? model.prior(x, y));
      };
      const overviewBins = size < 14 ? new OverviewRiskBins(size) : undefined;
      const paint = (x: number, y: number, p: number, exact: boolean, key: string) => {
        const sx = t.x + x * size,
          sy = t.y + y * size;
        if (sx + size < 0 || sy + size < 0 || sx > width || sy > height) return;
        const c = known.get(key);
        const resolved = c?.isOpen || c?.isFlagged;
        if (resolved) return;
        const rgb = tone(p);
        const extreme = p <= 0.01 || p >= 0.99;
        if (overviewBins) {
          overviewBins.add(x, y, p);
          return;
        }
        const inset = Math.min(2, size * 0.12);
        context.fillStyle = `rgba(${rgb},${extreme ? 0.42 : 0.14})`;
        context.fillRect(
          sx + inset,
          sy + inset,
          Math.max(1, size - 2 * inset),
          Math.max(1, size - 2 * inset),
        );
        if (extreme && size >= 8) {
          context.strokeStyle = `rgb(${rgb})`;
          context.lineWidth = p === 0 || p === 1 ? 2 : 1;
          context.strokeRect(
            sx + inset,
            sy + inset,
            size - 2 * inset,
            size - 2 * inset,
          );
        }
        if (size >= 8) {
          context.fillStyle = `rgb(${rgb})`;
          context.fillRect(
            sx + size * 0.2,
            sy + size * 0.78,
            size * 0.6,
            Math.max(1, Math.min(3, size * 0.1)),
          );
        }
        if (size < 26 || !quality.probabilityLabels) return;
        context.font = `${extreme ? 700 : 500} ${Math.min(12, Math.max(9, size * 0.24))}px ui-monospace, monospace`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillStyle = resolved
          ? "#87939e"
          : exact
            ? `rgb(${rgb})`
            : "#66717c";
        const label = `${snapshot.approximate.has(cellKey(x, y)) ? "≈" : ""}${format(p)}`;
        context.fillText(
          label,
          sx + size / 2,
          sy + size * (resolved ? 0.86 : 0.48),
          size - 5,
        );
      };
      for (const { x, y, p, key } of markers) {
        // Retain the last completed visual estimate until its replacement arrives.
        // Invalidation must not flash every tile back to the density prior.
        // Live inference is separate; the tooltip identifies pending updates.
        if (t.x + (x + 1) * size < 0 || t.y + (y + 1) * size < 0 || t.x + x * size > width || t.y + y * size > height) continue;
        const cell = known.get(key);
        if (cell?.isOpen || cell?.isFlagged) continue;
        paint(x, y, p, true, key);
      }
      for (const bin of overviewBins?.bins.values() ?? []) {
        const left = Math.round(t.x + bin.x * size - 3.5), top = Math.round(t.y + bin.y * size - 3.5);
        context.fillStyle = "#080d14"; context.fillRect(left - 1, top - 1, 9, 9);
        const low = tone(bin.low), high = tone(bin.high);
        context.fillStyle = `rgb(${low})`; context.fillRect(left, top, 7, 7);
        if (low !== high) {
          context.fillStyle = `rgb(${high})`; context.fillRect(left + 4, top, 3, 7);
        }
        // Separate dots preserve both certainties in a mixed-risk overview bin.
        context.fillStyle = "#ffffff";
        if (bin.low === 0) context.fillRect(left + 1, top + 3, 2, 2);
        if (bin.high === 1) context.fillRect(left + 5, top + 3, 1, 2);
      }
      if (pointer) {
        const x = Math.floor((pointer.x - t.x) / size),
          y = Math.floor((pointer.y - t.y) / size);
        const p = risk(x, y),
          key = cellKey(x, y),
          c = known.get(key);
        context.strokeStyle = "#d7e4eeaa";
        context.lineWidth = 1;
        context.strokeRect(
          t.x + x * size + 1,
          t.y + y * size + 1,
          size - 2,
          size - 2,
        );
        const description = c?.isOpen
          ? "Opened"
          : c?.isFlagged
            ? "Assumed mine (flagged)"
            : invalid.has(key) || preview.isInvalid(key)
              ? "Updating · previous estimate (not a current proof)"
              : snapshot.approximate.has(key)
                ? "Approximate estimate"
                : snapshot.risks.has(key)
                  ? "Combined clue inference"
                  : "Local density prior";
        tooltip.textContent = `${format(p)} mine probability · ${description}  (${formatInteger(x)}, ${formatInteger(y)})`;
        tooltip.hidden = false;
        tooltip.style.left = `${Math.max(8, Math.min(width - tooltip.offsetWidth - 8, pointer.x + 16))}px`;
        tooltip.style.top = `${Math.max(8, Math.min(height - tooltip.offsetHeight - 8, pointer.y + 20))}px`;
      }
      measuredMs += performance.now() - drawStart;
      measuredFrames++;
      if (performance.now() - measuredAt >= 1000) {
        toggle.setAttribute("data-timing", JSON.stringify({drawMs: Math.round(measuredMs), requestMs: Math.round(requestMs), frames: measuredFrames, wallMs: Math.round(performance.now() - measuredAt), markers: markers.length}));
        measuredMs = 0; requestMs = 0; measuredFrames = 0; measuredAt = performance.now();
      }
    };
    field.on("renderFrame", draw);
  }
}
