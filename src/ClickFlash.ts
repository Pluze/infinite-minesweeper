import { renderQuality } from "./RenderQuality";
import { Field } from "./Field";
import { CELL_WIDTH } from "./CellSprite";

/** Fixed-size DOM pool: highlight targets without spawning sprite tweens. */
export class ClickFlash {
  constructor(
    field: Field,
    transform: () => { x: number; y: number; k: number },
  ) {
    const pool = Array.from({ length: 8 }, () => {
      const element = document.createElement("div");
      element.className = "click-flash";
      element.hidden = true;
      document.body.appendChild(element);
      return { element, x: 0, y: 0, time: -Infinity };
    });
    const profile = renderQuality(field);
    let position = 0;
    let active = false;
    let lastDraw = -Infinity,
      lastCamera = "",
      lastRevision = -1;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    field.on("autoClick", (point: { x: number; y: number }) => {
      const count = profile.current.flashCount;
      if (!count) return;
      active = true;
      const item = pool[position++ % count];
      item.x = point.x;
      item.y = point.y;
      item.time = performance.now();
    });
    const draw = (now: number) => {
      requestAnimationFrame(draw);
      if (!active) return;
      const t = transform(),
        size = CELL_WIDTH * t.k;
      const quality = profile.current;
      const camera = `${t.x},${t.y},${t.k}`;
      if (
        now - lastDraw < quality.flashFrameMs &&
        camera === lastCamera &&
        lastRevision === profile.revision &&
        !document.hidden
      )
        return;
      lastDraw = now;
      lastCamera = camera;
      lastRevision = profile.revision;
      let anyVisible = false;
      for (let i = 0; i < pool.length; i++) {
        const item = pool[i];
        if (i >= quality.flashCount) {
          if (!item.element.hidden) item.element.hidden = true;
          item.time = -Infinity;
          continue;
        }
        const age = (now - item.time) / quality.flashDuration;
        const hidden = age >= 1 || document.hidden;
        if (item.element.hidden !== hidden) item.element.hidden = hidden;
        if (item.element.hidden) continue;
        anyVisible = true;
        const expand = reduced.matches || !quality.flashExpand ? 0 : age * 5;
        item.element.style.boxShadow = quality.flashGlow ? "" : "none";
        item.element.style.width = `${Math.max(6, size) + expand * 2}px`;
        item.element.style.height = `${Math.max(6, size) + expand * 2}px`;
        item.element.style.transform = `translate(${t.x + (item.x + 0.5) * size - Math.max(6, size) / 2 - expand}px,${t.y + (item.y + 0.5) * size - Math.max(6, size) / 2 - expand}px)`;
        item.element.style.opacity = String((1 - age) * 0.9);
      }
      active = anyVisible;
    };
    requestAnimationFrame(draw);
  }
}
