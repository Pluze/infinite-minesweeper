import { it, expect, vi, afterEach } from "vitest";
import { Field } from "./Field";
import { renderQuality } from "./RenderQuality";
import { ClickFlash } from "./ClickFlash";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("reuses eight markers and tracks camera transforms before fading out", () => {
  vi.useFakeTimers({ toFake: ["performance"] });
  const elements: {
    hidden: boolean;
    style: Record<string, string>;
    className: string;
  }[] = [];
  vi.stubGlobal("document", {
    hidden: false,
    createElement: () => {
      const e = { hidden: true, style: {}, className: "" };
      elements.push(e);
      return e;
    },
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  let frame: (now: number) => void = () => {};
  vi.stubGlobal("requestAnimationFrame", (callback: (now: number) => void) => {
    frame = callback;
    return 1;
  });
  const field = new Field(0.2, 0, "flash", "1");
  let camera = { x: 0, y: 0, k: 2 };
  new ClickFlash(field, () => camera);
  for (let i = 0; i < 10000; i++) field.emit("autoClick", { x: 3, y: 4 });
  frame(0);
  expect(elements).toHaveLength(8);
  expect(elements.every((e) => !e.hidden)).toBe(true);
  const previous = elements[0].style.transform;
  camera = { x: 100, y: 200, k: 2 };
  frame(0);
  expect(elements[0].style.transform).not.toBe(previous);
  frame(400);
  expect(elements.every((e) => e.hidden)).toBe(true);
  renderQuality(field).update({ running: true, target: 65536 });
  for (let i = 0; i < 1000; i++) field.emit("autoClick", { x: 4, y: 5 });
  frame(0);
  expect(elements.filter((e) => !e.hidden)).toHaveLength(1);
  expect(elements[0].style.boxShadow).toBe("none");
  renderQuality(field).update({ scale: 0.2 });
  frame(10);
  expect(elements.every((e) => e.hidden)).toBe(true);
  renderQuality(field).update({ running: false, scale: 2 });
  for (let i = 0; i < 8; i++) field.emit("autoClick", { x: 4, y: 5 });
  frame(0);
  expect(elements.filter((e) => !e.hidden)).toHaveLength(8);
});
