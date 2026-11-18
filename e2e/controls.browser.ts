import { expect, Page, test } from "@playwright/test";

type Camera = { x: number; y: number; k: number };

async function startBoard(page: Page, transform: Camera) {
  await page.addInitScript((camera) => {
    if (!localStorage.getItem("savedCamerTransform")) {
      localStorage.setItem("savedCamerTransform", JSON.stringify(camera));
    }
    localStorage.setItem("autoPan", "off");
  }, transform);
  await page.goto("/");
  await expect(page.locator("#minefield")).toBeVisible();
  await expect(page.locator("#loading-screen")).toBeHidden();
}

async function camera(page: Page): Promise<Camera> {
  return page.locator("#minefield").evaluate((canvas) => {
    const { x, y, k } = (canvas as HTMLCanvasElement & { __zoom: Camera })
      .__zoom;
    return { x, y, k };
  });
}

async function savedCell(page: Page, x: number, y: number) {
  return page.evaluate(
    async ({ x, y }) => {
      const field = await window.FieldStorage.loadLatest(window.fieldName);
      if (!field) throw new Error("Game was not saved");
      const { isOpen, isFlagged } = field.getCell(x, y);
      return { isOpen, isFlagged };
    },
    { x, y },
  );
}

async function recordedClicks(page: Page) {
  return page.evaluate(
    async () =>
      (await window.FieldStorage.loadLatest(window.fieldName))?.clickScores
        .length ?? 0,
  );
}

test("two-axis scrolling pans, pinch zooms at the cursor, and refresh restores the camera", async ({
  page,
}) => {
  await startBoard(page, { x: 400, y: 340, k: 1 });
  await page.mouse.move(500, 340);
  await page.mouse.wheel(48, -32);
  await expect.poll(() => camera(page)).toEqual({ x: 352, y: 372, k: 1 });

  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -50);
  await page.keyboard.up("Control");
  const magnified = { x: 204, y: 404, k: 2 };
  await expect.poll(() => camera(page)).toEqual(magnified);

  // Safari delivers an absolute scale for each update in a gesture.
  await page.locator("#minefield").evaluate((canvas) => {
    const gesture = (name: string, scale: number) => {
      const event = new MouseEvent(name, {
        clientX: 500,
        clientY: 340,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "scale", { value: scale });
      canvas.dispatchEvent(event);
    };
    gesture("gesturestart", 1);
    gesture("gesturechange", 1.25);
    gesture("gesturechange", 1.5);
    canvas.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: -50,
        ctrlKey: true,
        cancelable: true,
        clientX: 500,
        clientY: 340,
      }),
    );
    gesture("gestureend", 1.5);
  });
  const final = { x: 56, y: 436, k: 3 };
  await expect.poll(() => camera(page)).toEqual(final);

  await page.reload();
  await expect(page.locator("#loading-screen")).toBeHidden();
  await expect.poll(() => camera(page)).toEqual(final);
});

test("a mouse wheel zooms at the cursor, while vertical trackpad scrolling pans", async ({
  page,
}) => {
  await startBoard(page, { x: 400, y: 340, k: 1 });
  await page.mouse.move(500, 340);
  await page.mouse.wheel(0, -100);

  const scale = 2 ** 0.2;
  const x = 500 - 100 * scale;
  await expect.poll(() => camera(page)).toEqual({ x, y: 340, k: scale });

  await page.locator("#minefield").evaluate((canvas) => {
    // On Mac, Blink reports roughly three legacy units per point of continuous
    // scrolling. A fast sample can momentarily look like a mouse notch.
    for (const deltaY of [7, 9, 40]) {
      const event = new WheelEvent("wheel", {
        deltaY,
        clientX: 500,
        clientY: 340,
        cancelable: true,
      });
      Object.defineProperty(event, "wheelDeltaY", { value: -3 * deltaY });
      canvas.dispatchEvent(event);
    }
  });
  await expect.poll(() => camera(page)).toEqual({ x, y: 284, k: scale });

  // A discrete mouse event still zooms after a trackpad scroll.
  await page.locator("#minefield").evaluate((canvas) => {
    const event = new WheelEvent("wheel", {
      deltaY: 100,
      clientX: 500,
      clientY: 340,
      cancelable: true,
    });
    Object.defineProperty(event, "wheelDeltaY", { value: -120 });
    canvas.dispatchEvent(event);
  });
  await expect.poll(async () => (await camera(page)).k).toBeCloseTo(1);

  // A lone sample with the Mac mouse notch's delta falls back to zoom.
  await page.locator("#minefield").evaluate((canvas) => {
    const event = new WheelEvent("wheel", {
      deltaY: -40,
      clientX: 500,
      clientY: 340,
      cancelable: true,
    });
    Object.defineProperty(event, "wheelDeltaY", { value: 120 });
    canvas.dispatchEvent(event);
  });
  await expect
    .poll(async () => (await camera(page)).k)
    .toBeCloseTo(2 ** 0.08, 6);
});

test.describe("Retina wheel ticks", () => {
  test.use({ deviceScaleFactor: 2 });

  test("a scaled Mac mouse notch zooms after horizontal or vertical trackpad panning", async ({
    page,
  }) => {
    await startBoard(page, { x: 400, y: 340, k: 1 });
    const wheel = async (
      samples: { dx?: number; dy: number; ticks: number; delay: number }[],
    ) =>
      page.locator("#minefield").evaluate((canvas, input) => {
        const start = performance.now();
        for (const { dx, dy, ticks, delay } of input) {
          const event = new WheelEvent("wheel", {
            deltaX: dx,
            deltaY: dy,
            clientX: 500,
            clientY: 340,
            cancelable: true,
          });
          Object.defineProperties(event, {
            wheelDeltaY: { value: ticks },
            timeStamp: { value: start + delay },
          });
          canvas.dispatchEvent(event);
        }
      }, samples);

    await wheel([
      { dx: 12, dy: 0, ticks: 0, delay: 0 },
      { dy: -20, ticks: 60, delay: 8 },
    ]);
    await expect
      .poll(async () => (await camera(page)).k)
      .toBeCloseTo(2 ** 0.04, 6);

    // An identical 60-unit sample can be part of a continuous vertical gesture.
    const magnified = await camera(page);
    await wheel([
      { dy: 7, ticks: -21, delay: 0 },
      { dy: 8, ticks: -24, delay: 8 },
      { dy: 20, ticks: -60, delay: 16 },
      { dy: 20, ticks: -60, delay: 100 },
    ]);
    await expect.poll(async () => (await camera(page)).k).toBeCloseTo(1, 6);
    expect((await camera(page)).y).toBeLessThan(magnified.y);
  });
});

test("line, page and single or fixed pixel wheel steps zoom across browsers", async ({
  page,
}) => {
  await startBoard(page, { x: 400, y: 340, k: 1 });
  const wheel = (
    samples: { y: number; mode: number; ticks?: number; delay?: number }[],
  ) =>
    page.locator("#minefield").evaluate((canvas, events) => {
      const start = performance.now();
      for (const { y, mode, ticks, delay } of events) {
        const event = new WheelEvent("wheel", {
          deltaMode: mode,
          deltaY: y,
          clientX: 500,
          clientY: 340,
          cancelable: true,
        });
        Object.defineProperties(event, {
          wheelDeltaY: { value: ticks },
          timeStamp: { value: start + (delay ?? 0) },
        });
        canvas.dispatchEvent(event);
      }
    }, samples);

  await wheel([{ mode: 1, y: -3 }]);
  await expect
    .poll(async () => (await camera(page)).k)
    .toBeCloseTo(2 ** 0.15, 7);
  await wheel([{ mode: 2, y: -1 }]);
  await expect
    .poll(async () => (await camera(page)).k)
    .toBeCloseTo(2 ** 1.15, 7);
  await wheel([{ mode: 0, y: -20.5 }]);
  await expect
    .poll(async () => (await camera(page)).k)
    .toBeCloseTo(2 ** 1.191, 7);
  await wheel([
    { mode: 0, y: -12, ticks: 36 },
    { mode: 0, y: -12, ticks: 36, delay: 8 },
    { mode: 0, y: -12, ticks: 36, delay: 16 },
  ]);
  await expect
    .poll(async () => (await camera(page)).k)
    .toBeCloseTo(2 ** 1.263, 7);
  await expect.poll(async () => (await camera(page)).y).toBeCloseTo(340, 7);
});

test("the recorded M575S burst zooms even with trackpad-like legacy tick ratios", async ({
  page,
}) => {
  await startBoard(page, { x: 400, y: 340, k: 1 });
  // Representative mouse samples captured in macOS Edge 157.
  const samples = [
    [0, -12],
    [23.1, -26],
    [30.2, -103],
    [45.1, -103],
    [67.5, -206],
  ];
  await page.locator("#minefield").evaluate((canvas, input) => {
    const start = performance.now();
    for (const [delay, deltaY] of input) {
      const event = new WheelEvent("wheel", {
        deltaY,
        clientX: 500,
        clientY: 340,
        cancelable: true,
      });
      Object.defineProperties(event, {
        wheelDeltaY: { value: -3 * deltaY },
        timeStamp: { value: start + delay },
      });
      canvas.dispatchEvent(event);
    }
  }, samples);
  const k = 2 ** (samples.reduce((sum, [, dy]) => sum - dy, 0) * 0.002);
  await expect.poll(async () => (await camera(page)).k).toBeCloseTo(k, 7);
  await expect.poll(async () => (await camera(page)).y).toBeCloseTo(340, 7);
});

test("individual mouse-wheel pulses zoom despite tiny pixel deltas or horizontal noise", async ({
  page,
}) => {
  await startBoard(page, { x: 400, y: 340, k: 1 });
  const wheel = async (dx: number, dy: number, ticks: number) =>
    page.locator("#minefield").evaluate(
      (canvas, [deltaX, deltaY, value]) => {
        const event = new WheelEvent("wheel", {
          deltaX,
          deltaY,
          clientX: 500,
          clientY: 340,
          cancelable: true,
        });
        Object.defineProperty(event, "wheelDeltaY", { value });
        canvas.dispatchEvent(event);
      },
      [dx, dy, ticks],
    );
  await wheel(0, -3, 9);
  await expect
    .poll(async () => (await camera(page)).k)
    .toBeCloseTo(2 ** 0.006, 7);
  await wheel(0.25, -12, 36);
  await expect
    .poll(async () => (await camera(page)).k)
    .toBeCloseTo(2 ** 0.03, 7);
});

test("a burst of small vertical trackpad samples pans without zooming", async ({
  page,
}) => {
  await startBoard(page, { x: 400, y: 340, k: 1 });
  await page.locator("#minefield").evaluate((canvas) => {
    const time = performance.now();
    for (const [delay, deltaY] of [
      [0, 1],
      [17, 2],
      [34, 2],
    ]) {
      const event = new WheelEvent("wheel", {
        deltaY,
        clientX: 500,
        clientY: 340,
        cancelable: true,
      });
      Object.defineProperties(event, {
        timeStamp: { value: time + delay },
        wheelDeltaY: { value: 0 },
      });
      canvas.dispatchEvent(event);
    }
  });
  await expect.poll(() => camera(page)).toEqual({ x: 400, y: 335, k: 1 });
});

test("mouse click tolerates jitter, drag pans, and right click flags", async ({
  page,
}) => {
  await startBoard(page, { x: 400, y: 340, k: 1 });
  await expect
    .poll(() => savedCell(page, 12, 12))
    .toEqual({ isOpen: false, isFlagged: false });

  await page.mouse.click(650, 540, { button: "right" });
  await expect
    .poll(() => savedCell(page, 15, 12))
    .toEqual({ isOpen: false, isFlagged: true });
  const afterFlag = await recordedClicks(page);

  await page.mouse.move(600, 540);
  await page.mouse.down();
  await page.mouse.move(640, 550, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => camera(page)).toEqual({ x: 440, y: 350, k: 1 });

  await page.mouse.move(640, 550);
  await page.mouse.down();
  await page.mouse.move(642, 551);
  await page.mouse.up();
  await expect
    .poll(() => savedCell(page, 12, 12))
    .toMatchObject({ isOpen: true });
  expect(await recordedClicks(page)).toBe(afterFlag + 1);

  await page.mouse.move(620, 520);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(590, 500);
  await page.mouse.up({ button: "middle" });
  await expect.poll(() => camera(page)).toEqual({ x: 412, y: 331, k: 1 });
});

test("background playback works by default and shows the saved score on return", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("autoPlayInBackground", "off"),
  );
  await startBoard(page, { x: 400, y: 340, k: 1 });
  const play = page.getByRole("switch", { name: "Auto-play", exact: true });
  await expect(
    page.getByRole("switch", { name: "Allow background play" }),
  ).toHaveCount(0);
  const score = page.locator("#score");
  const originalScore = await score.innerText();
  const originalClicks = await recordedClicks(page);
  const setHidden = (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);

  // Trigger the same visibility lifecycle events without relying on which tab
  // a headless browser treats as visible.
  await setHidden(true);
  await play.click();
  await expect(play).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => recordedClicks(page)).toBeGreaterThan(originalClicks);
  await expect(score).toHaveText(originalScore);
  await play.click();
  await setHidden(false);
  await expect(score).not.toHaveText(originalScore);
  await expect
    .poll(async () => {
      const savedScore = await page.evaluate(
        async () =>
          (await window.FieldStorage.loadLatest(window.fieldName))?.score,
      );
      return (
        (await score.innerText()) ===
        new Intl.NumberFormat("en-US").format(savedScore!)
      );
    })
    .toBe(true);

  await page.reload();
  await expect(page.locator("#loading-screen")).toBeHidden();
  await expect(play).toHaveAttribute("aria-checked", "false");
});

test.describe("touch board", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test("tap and long press act once, while drag, cancel, and pinch never open a cell", async ({
    page,
    context,
  }) => {
    await startBoard(page, { x: 140, y: 310, k: 1 });
    await page.touchscreen.tap(308, 598);
    await expect
      .poll(() => savedCell(page, 10, 18))
      .toMatchObject({ isOpen: true });
    const afterTap = await recordedClicks(page);

    const touch = await context.newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 342, y: 684 }],
    });
    // Wait for the flag to be saved while the finger is still on the board.
    await expect
      .poll(() => savedCell(page, 12, 23))
      .toEqual({ isOpen: false, isFlagged: true });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });

    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 195, y: 430 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 225, y: 460 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(() => camera(page)).toEqual({ x: 170, y: 340, k: 1 });

    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: 190, y: 600 }],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchCancel",
      touchPoints: [],
    });

    const fingers = [
      { x: 170, y: 510, id: 0 },
      { x: 225, y: 510, id: 1 },
    ];
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: fingers,
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { ...fingers[0], x: 145 },
        { ...fingers[1], x: 250 },
      ],
    });
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect.poll(async () => (await camera(page)).k).toBeGreaterThan(1.5);

    // A subsequent persisted tap proves no extra actions were recorded by the gestures.
    await page.touchscreen.tap(290, 700);
    await expect.poll(() => recordedClicks(page)).toBe(afterTap + 2);
  });
});
