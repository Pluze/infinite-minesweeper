import { frontierIndex } from "./FrontierIndex";
import { probabilityModel } from "./MineProbability";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Field } from "./Field";
import { AutoPlayer, findNumberMove } from "./AutoPlayer";

describe("automatic number clicks", () => {
  it("expands and flags using revealed information without hitting mines", () => {
    const field = new Field(0.2, 3, "bot-test", "1");
    field.open(1, 1);
    const initial = field.score;
    let steps = 0;
    for (; steps < 500; steps++) {
      const move = findNumberMove(field);
      if (!move) break;
      const before = field
        .getAll()
        .filter((c) => c.isOpen || c.isFlagged).length;
      field.open(move.x, move.y);
      expect(
        field.getAll().filter((c) => c.isOpen || c.isFlagged).length,
      ).toBeGreaterThan(before);
      expect(field.getAll().some((c) => c.isOpen && c.isMine)).toBe(false);
    }
    expect(steps).toBeGreaterThan(0);
    expect(field.score).toBeGreaterThan(initial);
  });
  it.each([false, true])(
    "prioritizes an interior gap over a nearby outer edge (mine=%s)",
    (mine) => {
      const field = new Field(0.2, 0, "interior", "1");
      field.pristine = false;
      for (let y = -3; y <= 3; y++) {
        for (let x = -3; x <= 3; x++) {
          field._setCell(x, y, { isOpen: x !== 0 || y !== 0, isMine: false });
        }
      }
      field._setCell(0, 0, { isMine: mine });
      const move = findNumberMove(field, { x: 3, y: 3 });
      expect(move).toBeDefined();
      expect(Math.abs(move!.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(move!.y)).toBeLessThanOrEqual(1);
      // Once the interior gap is resolved, allow outward progress again.
      field._setCell(0, 0, mine ? { isFlagged: true } : { isOpen: true });
      field.emit("cellChanged", field.getCell(0, 0));
      const outer = findNumberMove(field, { x: 3, y: 3 });
      expect(Math.max(Math.abs(outer!.x), Math.abs(outer!.y))).toBe(3);
    },
  );
  it("stops when no number can be deduced", () => {
    const field = new Field(0.2, 0, "stuck", "1");
    field.pristine = false;
    field._setCell(0, 0, { isOpen: true, isMine: false });
    field._setCell(1, 1, { isMine: true });
    expect(findNumberMove(field)).toBeUndefined();
  });
});

describe("playback controls", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup(rate = "4", initial?: Field) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const elements = new Map<
      string,
      {
        value: string;
        textContent: string;
        disabled: boolean;
        checked: boolean;
        onchange?: () => void;
        setAttribute: ReturnType<typeof vi.fn>;
        onclick?: () => void;
        addEventListener: ReturnType<typeof vi.fn>;
      }
    >();
    for (const id of [
      "#auto-speed",
      "#auto-status",
      "#auto-toggle",
      "#playback-label",
      "#speed-value",
      "#actual-rate",
      "#run-to-guess",
    ]) {
      elements.set(id, {
        value: "2",
        textContent: "",
        disabled: false,
        checked: false,
        setAttribute: vi.fn(),
        addEventListener: vi.fn(),
      });
    }
    const listeners = new Map<string, (event: unknown) => void>();
    vi.stubGlobal("document", {
      querySelector: (id: string) => elements.get(id),
      addEventListener: (name: string, callback: (event: unknown) => void) =>
        listeners.set(name, callback),
    });
    vi.stubGlobal("localStorage", { getItem: () => rate, setItem: vi.fn() });
    const field = initial ?? new Field(0.2, 3, "controls", "1");
    if (!initial) field.open(1, 1);
    const click = vi.fn();
    new AutoPlayer(field, click);
    return { elements, click, listeners, field };
  }

  it.each([false, true])(
    "exhausts exterior certainty before guessing (pause=%s)",
    (pause) => {
      const f = new Field(0.2, 0, "safe-mode", "1");
      f.pristine = false;
      for (let y = -3; y <= 3; y++)
        for (let x = -3; x <= 3; x++)
          if (Math.abs(x) === 3 || Math.abs(y) === 3)
            f._setCell(x, y, { isOpen: true, isMine: false });
      vi.spyOn(frontierIndex(f), "refresh").mockReturnValue(
        new Map([
          [
            "inside",
            {
              cell: f.getCell(0, 3),
              unknown: [f.getCell(0, 0), f.getCell(1, 0)],
              remaining: 1,
            },
          ],
          [
            "outside",
            {
              cell: f.getCell(0, -3),
              unknown: [f.getCell(0, -4)],
              remaining: 0,
            },
          ],
        ]),
      );
      const inference = vi.spyOn(probabilityModel(f), "guess");
      const { elements, click } = setup("4", f);
      const toggle = elements.get("#run-to-guess")!;
      toggle.checked = pause;
      toggle.onchange!();
      elements.get("#auto-toggle")!.onclick!();
      vi.advanceTimersByTime(250);
      expect(click).toHaveBeenCalledWith(0, -3);
      expect(inference).toHaveBeenCalledWith(
        expect.anything(),
        true,
        expect.any(Set),
      );
      vi.restoreAllMocks();
    },
  );

  it.each([false, true])(
    "resolves an internal joint proof before an exterior simple move (pause=%s)",
    (pause) => {
      const f = new Field(0.2, 0, "joint-island", "1");
      f.pristine = false;
      for (let y = -3; y <= 3; y++)
        for (let x = -3; x <= 3; x++)
          if (Math.abs(x) === 3 || Math.abs(y) === 3)
            f._setCell(x, y, { isOpen: true, isMine: false });
      const a = f.getCell(0, 0),
        b = f.getCell(1, 0),
        safe = f.getCell(0, 1);
      vi.spyOn(frontierIndex(f), "refresh").mockReturnValue(
        new Map([
          ["0,3", { cell: f.getCell(0, 3), unknown: [a, b], remaining: 1 }],
          [
            "1,3",
            { cell: f.getCell(1, 3), unknown: [a, b, safe], remaining: 1 },
          ],
          [
            "0,-3",
            {
              cell: f.getCell(0, -3),
              unknown: [f.getCell(0, -4)],
              remaining: 0,
            },
          ],
        ]),
      );
      const model = probabilityModel(f),
        inference = vi.spyOn(model, "guess");
      const { elements, click } = setup("4", f);
      const toggle = elements.get("#run-to-guess")!;
      toggle.checked = pause;
      toggle.onchange!();
      elements.get("#auto-toggle")!.onclick!();
      vi.advanceTimersByTime(250);
      expect(click).toHaveBeenCalledWith(0, 1);
      expect(inference.mock.calls.every((call) => call[1] === true)).toBe(true);
      vi.restoreAllMocks();
    },
  );

  it("starts paused and stops immediately when paused again", () => {
    const { elements, click } = setup();
    vi.advanceTimersByTime(1000);
    expect(click).not.toHaveBeenCalled();
    expect(elements.get("#playback-label")!.textContent).toBe("Paused");
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(1000);
    expect(click).toHaveBeenCalledTimes(4);
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(1000);
    expect(click).toHaveBeenCalledTimes(4);
  });

  it("Space toggles playback once per press without activating focused controls", () => {
    const { click, listeners, elements } = setup();
    const key = {
      code: "Space",
      repeat: false,
      preventDefault: vi.fn(),
      target: { matches: () => false },
    };
    listeners.get("keydown")!(key);
    expect(key.preventDefault).toHaveBeenCalled();
    expect(elements.get("#playback-label")!.textContent).toBe("Running");
    listeners.get("keydown")!({ ...key, repeat: true });
    vi.advanceTimersByTime(1000);
    expect(click).toHaveBeenCalledTimes(4);
    listeners.get("keydown")!(key);
    vi.advanceTimersByTime(1000);
    expect(click).toHaveBeenCalledTimes(4);
    expect(elements.get("#playback-label")!.textContent).toBe("Paused");
    listeners.get("keydown")!({ ...key, target: { matches: () => true } });
    expect(elements.get("#playback-label")!.textContent).toBe("Paused");
  });

  it("debug run stops before a risky guess and normal play can resume", () => {
    const f = new Field(0.2, 0, "debug", "1");
    f.pristine = false;
    f._setCell(0, 0, { isOpen: true, isMine: false });
    f._setCell(1, 1, { isMine: true });
    const { elements, click } = setup("4", f);
    const debug = elements.get("#run-to-guess")!;
    debug.checked = true;
    debug.onchange!();
    expect(elements.get("#playback-label")!.textContent).toBe("Paused");
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(250);
    expect(click).not.toHaveBeenCalled();
    expect(elements.get("#playback-label")!.textContent).toBe("Paused");
    expect(debug.checked).toBe(true);
    expect(elements.get("#auto-status")!.textContent).toContain(
      "Paused before guessing",
    );
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(250);
    expect(click).not.toHaveBeenCalled();
    debug.checked = false;
    debug.onchange!();
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(250);
    expect(click).toHaveBeenCalledOnce();
  });
  it("emits an automatic click highlight and reports measured throughput", () => {
    const { elements, field } = setup();
    const flash = vi.fn();
    field.on("autoClick", flash);
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(1000);
    expect(flash).toHaveBeenCalledTimes(4);
    expect(elements.get("#actual-rate")!.textContent).toBe("Actual 4 /s");
  });

  it("supports 65,536 clicks per second and still pauses between batches", () => {
    const { elements, click } = setup("65536");
    expect(elements.get("#auto-speed")!.value).toBe("16");
    expect(elements.get("#speed-value")!.textContent).toBe("65,536");
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(16);
    expect(click).toHaveBeenCalledTimes(Math.floor(65536 * 0.016));
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(100);
    expect(click).toHaveBeenCalledTimes(Math.floor(65536 * 0.016));
  });

  it("preserves the 512 setting and batches high rates", () => {
    const { elements, click } = setup("512");
    expect(elements.get("#auto-speed")!.value).toBe("9");
    expect(elements.get("#speed-value")!.textContent).toBe("512");
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(1000);
    expect(click.mock.calls.length).toBeGreaterThanOrEqual(500);
    expect(click.mock.calls.length).toBeLessThanOrEqual(512);
  });
  it("prevents mobile growth before a click and visibly explains the saved pause", () => {
    vi.stubGlobal("navigator", {userAgent: "iPhone EdgiOS", platform: "iPhone", maxTouchPoints: 5});
    const {elements, click, field} = setup();
    vi.spyOn(field.cellData.numberStorage, "size", "get").mockReturnValue(200000);
    const save = vi.fn(); field.on("playbackPaused", save);
    elements.get("#auto-toggle")!.onclick!();
    vi.advanceTimersByTime(1000);
    expect(click).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledOnce();
    expect(elements.get("#auto-status")!.textContent).toContain("mobile memory safety limit");
    expect(elements.get("#auto-status")!.setAttribute).toHaveBeenCalledWith("class", "safety-status");
    elements.get("#auto-toggle")!.onclick!();
    expect(click).not.toHaveBeenCalled();
  });

});
