import { renderQuality } from "./RenderQuality";
import { BatchedSave } from "./BatchedSave";
import { ClickFlash } from "./ClickFlash";
import { ProbabilityOverlay } from "./ProbabilityOverlay";
import { AutoPlayer } from "./AutoPlayer";
import { CELL_WIDTH } from "./CellSprite";
import { Cursor } from "./Cursor";
import * as PIXI from "pixi.js";
import { D3ZoomEvent, zoom, zoomTransform, ZoomTransform } from "d3-zoom";
import { pointer, select } from "d3-selection";
import { Field } from "./Field";
import { FieldPersistence } from "./FieldPersistence";
import { assert } from "./assert";
import { WorldPos } from "./CoordTypes";
import { WheelInput } from "./WheelInput";

const LONG_PRESS_DURATION = 200;
const MOUSE_CLICK_DISTANCE = 4;
const TOUCH_TAP_DISTANCE = 8;

type PinchEvent = MouseEvent & { scale: number };

export class Controls {
  private static saver: BatchedSave;
  private static center: (x: number, y: number) => void;
  private static cursor: Cursor;
  private static field: Field;

  public constructor(
    canvas: HTMLCanvasElement,
    rootObject: PIXI.Container,
    field: Field,
    fieldStorage: FieldPersistence,
  ) {
    Controls.field = field;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    renderQuality(field).update({ reducedMotion: reducedMotion.matches });
    reducedMotion.addEventListener("change", () =>
      renderQuality(field).update({ reducedMotion: reducedMotion.matches }),
    );
    Controls.saver = new BatchedSave(
      () => fieldStorage.saveAsync(field, field.fieldName),
      (error) => {
        console.error(error);
        field.emit("saveFailed");
      },
    );
    window.addEventListener("pagehide", () => Controls.saver.flush());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) Controls.saver.flush();
    });
    field.on("beforeRestart", () => Controls.saver.discard());

    Controls.cursor = new Cursor();
    const foreground = rootObject.getChildByLabel("container");
    assert(foreground);
    foreground.addChild(Controls.cursor);

    Controls.setupZoom(canvas, rootObject);
    field.on("autoBatchFinished", () => Controls.finishBatch());
    const flushPlaybackProgress = () => {
      Controls.finishBatch();
      Controls.saver.flush();
    };
    field.on("playbackPaused", flushPlaybackProgress);
    field.on("playbackSuspended", flushPlaybackProgress);
    new AutoPlayer(field, (x, y) => Controls.openAt(x, y));
  }

  private static setupZoom(
    canvas: HTMLCanvasElement,
    rootObject: PIXI.Container,
  ) {
    // We have to get this before setting up zoom so we don't show the zoomed out version for some frames after it has been created.
    const savedTransform = savedCameraTransform.get();

    let cameraFrame = 0;
    let cameraMoving = false;
    let manualUntil = 0;
    let pendingRegion = "";
    let pendingSince = 0;
    const stopCameraAnimation = () => {
      cancelAnimationFrame(cameraFrame);
      cameraMoving = false;
    };
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopCameraAnimation();
        pendingRegion = "";
      }
    });
    let lastCameraStart = -Infinity;
    const autoPanToggle =
      document.querySelector<HTMLInputElement>("#auto-center");
    let autoPan = localStorage.getItem("autoPan") !== "off";
    if (autoPanToggle) {
      autoPanToggle.checked = autoPan;
      autoPanToggle.onchange = () => {
        autoPan = autoPanToggle.checked;
        localStorage.setItem("autoPan", autoPan ? "on" : "off");
        if (!autoPan) stopCameraAnimation();
      };
    }
    const container = rootObject.getChildByLabel("container");
    const background = rootObject.getChildByLabel("bg") as PIXI.TilingSprite;
    const foreground = container?.getChildByLabel("fg");
    assert(container && background && foreground);

    const selection = select<HTMLCanvasElement, unknown>(canvas);
    const currentTransform = () => zoomTransform(canvas);
    let restarting = false;
    const cameraSaver = new BatchedSave(
      () => savedCameraTransform.set(currentTransform()),
      console.error,
      150,
    );
    window.addEventListener("pagehide", () => cameraSaver.flush());
    Controls.field.on("beforeRestart", () => {
      restarting = true;
      stopCameraAnimation();
      cameraSaver.discard();
    });

    const manualCameraInput = () => {
      stopCameraAnimation();
      pendingRegion = "";
      manualUntil = performance.now() + 1500;
    };
    let dragging = false;
    let pinchScale: number | undefined;
    const zoomHandler = zoom<HTMLCanvasElement, unknown>()
      .clickDistance(MOUSE_CLICK_DISTANCE)
      .filter(
        (event) => !event.ctrlKey && (!event.button || event.button === 1),
      )
      .on("start", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        if (event.sourceEvent) {
          dragging = true;
          manualCameraInput();
        }
      })
      .on("end", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        if (event.sourceEvent) {
          dragging = false;
          manualCameraInput();
        }
      })
      .on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
        if (event.sourceEvent) manualCameraInput();
        const { x, y, k } = event.transform;
        renderQuality(Controls.field).update({ scale: k });

        container.position.set(x, y);
        container.scale.set(k);
        background.tilePosition.set(x, y);
        background.tileScale.set(k);
        background.alpha = foreground.alpha = -1 + 1.5 * k;
        if (!restarting) cameraSaver.request();
      });

    const moveCursorTo = ([x, y]: [number, number]) => {
      const point = container.toLocal({ x, y }) as WorldPos;
      Controls.cursor.moveTo(point.x, point.y);
    };
    const moveCursor = (event: MouseEvent | Touch) =>
      moveCursorTo(pointer(event, canvas));
    let lastMousePoint: [number, number] | undefined;
    const zoomFromWheel = (event: WheelEvent) => {
      const sensitivity =
        event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
      const exponent = -event.deltaY * sensitivity * (event.ctrlKey ? 10 : 1);
      zoomHandler.scaleBy(selection, 2 ** exponent, pointer(event, canvas));
    };
    const panFromScroll = (event: WheelEvent) => {
      const from = currentTransform();
      const lineHeight = 16;
      const dx =
        event.deltaX *
        (event.deltaMode === 1
          ? lineHeight
          : event.deltaMode === 2
            ? canvas.clientWidth
            : 1);
      const dy =
        event.deltaY *
        (event.deltaMode === 1
          ? lineHeight
          : event.deltaMode === 2
            ? canvas.clientHeight
            : 1);
      zoomHandler.transform(
        selection,
        new ZoomTransform(from.k, from.x - dx, from.y - dy),
      );
    };

    const wheelInput = new WheelInput((action, event) => {
      manualCameraInput();
      if (action === "pan") panFromScroll(event);
      else zoomFromWheel(event);
      moveCursor(event);
    });
    Controls.field.on("beforeRestart", () => wheelInput.reset());
    let tap: { start: Touch; timer: ReturnType<typeof setTimeout> } | undefined;
    const cancelTap = () => {
      if (tap) clearTimeout(tap.timer);
      tap = undefined;
    };
    const isTapDistance = (start: Touch, end: Touch | undefined) =>
      end?.identifier === start.identifier &&
      Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) <=
        TOUCH_TAP_DISTANCE;
    window.addEventListener("blur", () => {
      cancelTap();
      wheelInput.reset();
      pinchScale = undefined;
      dragging = false;
    });

    selection
      .on(
        "touchstart.board",
        (event: TouchEvent) => {
          // We handle taps directly. Prevent touch from synthesizing mouse clicks.
          event.preventDefault();
          cancelTap();
          if (event.touches.length !== 1) return;
          const start = event.touches[0];
          tap = {
            start,
            timer: setTimeout(() => {
              cancelTap();
              moveCursor(start);
              Controls.flag();
            }, LONG_PRESS_DURATION),
          };
        },
        { passive: false },
      )
      .on("touchmove.board", (event: TouchEvent) => {
        if (tap && !isTapDistance(tap.start, event.touches[0])) cancelTap();
      })
      .on("touchend.board", (event: TouchEvent) => {
        const end = event.changedTouches[0];
        const shouldOpen =
          tap && !event.touches.length && isTapDistance(tap.start, end);
        cancelTap();
        if (shouldOpen) {
          moveCursor(end);
          Controls.open();
        }
      })
      .on("touchcancel.board", cancelTap)
      .on("click.board", (event: PointerEvent) => {
        if (event.pointerType === "touch") return;
        moveCursor(event);
        Controls.open();
      })
      .on("mouseup.board", (event: MouseEvent) => {
        if (event.button !== 2) return;
        moveCursor(event);
        Controls.flag();
      })
      .on("mousemove.board", (event: MouseEvent) => {
        lastMousePoint = pointer(event, canvas);
        moveCursorTo(lastMousePoint);
      })
      .on("contextmenu.board", (event) => event.preventDefault())
      .call(zoomHandler)
      .on("dblclick.zoom wheel.zoom", null)
      .on(
        "wheel.camera",
        (event: WheelEvent) => {
          event.preventDefault();
          // Safari can send separate gesture events for the same pinch.
          if (!restarting && pinchScale === undefined) wheelInput.handle(event);
        },
        { passive: false },
      );
    canvas.addEventListener("gesturestart", (event) => {
      event.preventDefault();
      if (dragging) return;
      wheelInput.reset();
      manualCameraInput();
      pinchScale = 1;
    });
    canvas.addEventListener("gesturechange", (rawEvent) => {
      const event = rawEvent as PinchEvent;
      event.preventDefault();
      if (
        pinchScale === undefined ||
        !Number.isFinite(event.scale) ||
        event.scale <= 0
      )
        return;
      manualCameraInput();
      const anchor: [number, number] =
        Number.isFinite(event.clientX) && Number.isFinite(event.clientY)
          ? pointer(event, canvas)
          : (lastMousePoint ?? [
              canvas.clientWidth / 2,
              canvas.clientHeight / 2,
            ]);
      zoomHandler.scaleBy(selection, event.scale / pinchScale, anchor);
      pinchScale = event.scale;
      moveCursorTo(anchor);
    });
    canvas.addEventListener("gestureend", (event) => {
      event.preventDefault();
      if (pinchScale === undefined) return;
      manualCameraInput();
      pinchScale = undefined;
    });

    new ClickFlash(Controls.field, currentTransform);
    new ProbabilityOverlay(Controls.field, currentTransform);

    Controls.center = (x, y) => {
      if (
        !autoPan ||
        document.hidden ||
        restarting ||
        cameraMoving ||
        dragging ||
        pinchScale !== undefined ||
        performance.now() < manualUntil
      )
        return;
      const from = currentTransform();
      const screenX = from.x + (x + 0.5) * CELL_WIDTH * from.k;
      const screenY = from.y + (y + 0.5) * CELL_WIDTH * from.k;
      const marginX = window.innerWidth * 0.05;
      const marginY = window.innerHeight * 0.05;
      if (
        screenX >= marginX &&
        screenX <= window.innerWidth - marginX &&
        screenY >= marginY &&
        screenY <= window.innerHeight - marginY
      ) {
        pendingRegion = "";
        return;
      }
      const targetX = window.innerWidth / 2 - (x + 0.5) * CELL_WIDTH * from.k;
      const targetY = window.innerHeight / 2 - (y + 0.5) * CELL_WIDTH * from.k;
      const started = performance.now();
      const elapsed = started - lastCameraStart;
      const profile = renderQuality(Controls.field);
      const offscreen =
        screenX < 0 ||
        screenX > window.innerWidth ||
        screenY < 0 ||
        screenY > window.innerHeight;
      const fast = profile.state.running && profile.state.target >= 128;
      const region = `${Math.floor(x / 24)},${Math.floor(y / 24)}`;
      if (fast) {
        if (region !== pendingRegion) {
          pendingRegion = region;
          pendingSince = started;
          return;
        }
        if (started - pendingSince < 120) return;
      }
      const cooldown = offscreen
        ? 400
        : Math.max(400, profile.current.cameraCooldownMs);
      if (elapsed < cooldown) return;
      cameraMoving = true;
      pendingRegion = "";
      lastCameraStart = started;
      const distance = Math.hypot(targetX - from.x, targetY - from.y);
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)")
        .matches
        ? 0
        : profile.state.running && profile.state.target >= 128
          ? Math.min(160, Math.max(90, 70 + distance * 0.06))
          : Math.min(280, Math.max(140, 100 + distance * 0.12));
      const animate = (now: number) => {
        const t = duration ? Math.min(1, (now - started) / duration) : 1;
        // Fast cubic ease-out preserves a soft stop without chasing stale targets.
        const eased = 1 - (1 - t) ** 3;
        zoomHandler.transform(
          selection,
          new ZoomTransform(
            from.k,
            from.x + (targetX - from.x) * eased,
            from.y + (targetY - from.y) * eased,
          ),
        );
        if (t < 1) cameraFrame = requestAnimationFrame(animate);
        else cameraMoving = false;
      };
      cameraFrame = requestAnimationFrame(animate);
    };

    if (savedTransform) {
      zoomHandler.transform(
        selection,
        new ZoomTransform(savedTransform.k, savedTransform.x, savedTransform.y),
      );
    } else {
      zoomHandler.translateTo(selection, 0, 0);
      zoomHandler.scaleBy(selection, window.devicePixelRatio * 2);
    }
  }

  private static open() {
    Controls.openAt(Controls.cursor.getX(), Controls.cursor.getY());
  }

  private static pendingCenter: { x: number; y: number } | undefined;
  private static pendingSave = false;
  private static finishBatch() {
    if (Controls.pendingCenter) {
      Controls.center(Controls.pendingCenter.x, Controls.pendingCenter.y);
      Controls.pendingCenter = undefined;
    }
    if (Controls.pendingSave) {
      Controls.saver.request();
      Controls.pendingSave = false;
    }
  }
  public static openAt(x: number, y: number) {
    const changed = Controls.field.open(x, y);
    Controls.field.recordClick();
    const quality = renderQuality(Controls.field);
    if (quality.state.running && quality.state.target >= 128) {
      if (changed.length) Controls.pendingCenter = { x, y };
      Controls.pendingSave = true;
      return;
    }
    if (changed.length) {
      // Follow the operation itself, not a potentially huge flood-fill bounding box.
      Controls.center(x, y);
    }
    Controls.saver.request();
  }

  private static flag() {
    const x = Controls.cursor.getX();
    const y = Controls.cursor.getY();

    Controls.field.flag(x, y);
    Controls.field.recordClick();

    Controls.saver.request();
  }
}

const savedCameraTransform = {
  key: "savedCamerTransform",
  get: (): CameraTransform | null => {
    try {
      const transform = JSON.parse(
        localStorage.getItem(savedCameraTransform.key) ?? "null",
      ) as CameraTransform | null;
      if (
        transform &&
        Number.isFinite(transform.x) &&
        Number.isFinite(transform.y) &&
        Number.isFinite(transform.k) &&
        transform.k > 0
      )
        return transform;
    } catch {
      // A stale or malformed camera preference should not block startup.
    }
    return null;
  },
  set: (transform: CameraTransform): void => {
    localStorage.setItem(savedCameraTransform.key, JSON.stringify(transform));
  },
};

type CameraTransform = {
  x: number;
  y: number;
  k: number;
};
