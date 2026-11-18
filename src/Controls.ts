import { renderQuality } from "./RenderQuality";
import { BatchedSave } from "./BatchedSave";
import { ClickFlash } from "./ClickFlash";
import { ProbabilityOverlay } from "./ProbabilityOverlay";
import { AutoPlayer } from "./AutoPlayer";
import { CELL_WIDTH } from "./CellSprite";
import { Cursor } from "./Cursor";
import * as PIXI from "pixi.js";
import { zoom, zoomTransform, ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
import { z } from "zod";
import { Field } from "./Field";
import { FieldPersistence } from "./FieldPersistence";
import { assert } from "./assert";
import { WorldPos } from "./CoordTypes";

// todo add setting for long press duration
const LONG_PRESS_DURATION = 200; // Duration in milliseconds to consider it a long press

export class Controls {
  private static saver: BatchedSave;
  private static center: (x: number, y: number) => void;
  private static cursor: Cursor;
  private static field: Field;
  private static fieldStorage: FieldPersistence | undefined;
  private static skipEventTimer: NodeJS.Timeout | null = null;

  public constructor(
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
    Controls.fieldStorage = fieldStorage;
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
    field.on("playbackPaused", () => Controls.saver.flush());
    field.on("beforeRestart", () => Controls.saver.discard());

    Controls.cursor = new Cursor();
    const foreground = rootObject.getChildByLabel("container");
    assert(foreground);
    foreground.addChild(Controls.cursor);

    Controls.setupZoom(rootObject);
    Controls.disableRightClickContextMenu();
    field.on("autoBatchFinished", () => Controls.finishBatch());
    field.on("playbackPaused", () => {
      Controls.finishBatch();
      Controls.saver.flush();
    });
    new AutoPlayer(field, (x, y) => Controls.openAt(x, y));
  }

  private static disableRightClickContextMenu() {
    document.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  private static setupZoom(rootObject: PIXI.Container) {
    // We have to get this before setting up zoom so we don't show the zoomed out version for some frames after it has been created.
    const savedTransform = savedCameraTransform.get();

    const logEvent = (_event: Event) => {};

    let cameraFrame = 0;
    let cameraMoving = false;
    let manualUntil = 0;
    let pendingRegion = "";
    let pendingSince = 0;
    const stopCameraAnimation = () => {
      cancelAnimationFrame(cameraFrame);
      cameraMoving = false;
    };
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
    const zoomHandler = zoom()
      .on("start", (event) => {
        if (event.sourceEvent) {
          stopCameraAnimation();
          manualUntil = performance.now() + 1500;
        }
      })
      .on("zoom", (rawEvent) => {
        logEvent(rawEvent);
        const event = eventSchema.parse(rawEvent);

        const container = rootObject.getChildByLabel(
          "container",
        ) as PIXI.Sprite;
        const foreground = container.getChildByLabel("fg") as PIXI.Sprite;
        const background = rootObject.getChildByLabel(
          "bg",
        ) as PIXI.TilingSprite;

        const x = event.transform.x;
        const y = event.transform.y;
        const scale = event.transform.k;
        renderQuality(Controls.field).update({ scale });

        container.position.set(x, y);
        container.scale.set(scale);
        background.tilePosition.set(x, y);
        background.tileScale.set(scale);
        function lerp(a: number, b: number, alpha: number): number {
          return a + alpha * (b - a);
        }
        const lerpedScale = lerp(-1, 0.5, scale);
        background.alpha = lerpedScale;
        foreground.alpha = lerpedScale;

        // todo dedupe between touchend
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }

        savedCameraTransform.set(event.transform);
      });
    // todo when pressing mousedown, then i want to update the cell sprite to be from closed to open. This is both when pressing down(before releasing) on a closed cell, and on an open cell with a closed unflagged neighbor
    // todo add option to pan using middle mouse button, which allows us to enable immediate mode on left and right click.
    // todo enable immediate mode on right click, because we are not using it to flag
    // todo allow switching what the mouse buttons does, we have the actions: pan, chord open, chord flag, open, flag. these actions can be assigned to mouse right, mouse left, middle mouse click, or optionally keyboard buttons.
    // todo try to create a new mode where we are locking the mouse to the center of the screen, and move the whole field in addition to the cursor when we move the cursor. Then we can open with mouse click. We need to be able to unlock the mouse using escape.

    let longPressTimer: NodeJS.Timeout | null = null;

    const selection = select<Element, unknown>("canvas")
      .on("touchstart", (event: TouchEvent) => {
        logEvent(event);

        if (Controls.skipEventTimer) {
          clearTimeout(Controls.skipEventTimer);
          Controls.skipEventTimer = null;
        }

        if (event.touches.length > 1) return;

        const touchPosition = event.touches[0];

        // todo dedup between mousemove.
        assert(typeof touchPosition.clientX === "number");
        assert(typeof touchPosition.clientY === "number");
        const foreground = rootObject.getChildByLabel("container");
        assert(foreground);
        const worldPos = foreground.toLocal({
          x: touchPosition.clientX,
          y: touchPosition.clientY,
        }) as WorldPos;

        longPressTimer = setTimeout(() => {
          Controls.cursor.moveTo(worldPos.x, worldPos.y);
          Controls.flag();

          /**
           * Workaround: On mobile devices, when a long press is done and
           * released before 300ms, a `mouseup` and `click` event is fired. This
           * is expected for a short tap, but if we tap for a duration which is
           * longer than LONG_PRESS_DURATION but shorter than the 300 ms, we
           * will both trigger a long press and a short press. We create a timer
           * to disable this long press event which is created by the dom, and
           * clear this if another touch event starts.
           */
          Controls.skipEventTimer = setTimeout(() => {
            Controls.skipEventTimer = null;
          }, 200);
        }, LONG_PRESS_DURATION);
      })
      .on("touchend", (e) => {
        logEvent(e);
        if (longPressTimer) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      })
      .on("click", (e) => {
        if (Controls.skipEventTimer) {
          e.stopImmediatePropagation();
          return;
        }
        logEvent(e);
        const foreground = rootObject.getChildByLabel("container")!;
        const point = foreground.toLocal({
          x: e.clientX,
          y: e.clientY,
        }) as WorldPos;
        Controls.cursor.moveTo(point.x, point.y);
        Controls.open();
      })
      .on("mouseup", (e: MouseEvent) => {
        if (Controls.skipEventTimer) {
          e.stopImmediatePropagation();
          return;
        }
        logEvent(e);
        if (e.button === 2) Controls.flag();
      })
      .on("mousemove", (event: MouseEvent) => {
        logEvent(event);
        assert(typeof event.x === "number");
        assert(typeof event.y === "number");
        const foreground = rootObject.getChildByLabel("container");
        assert(foreground);
        const worldPos = foreground.toLocal(event) as WorldPos;

        Controls.cursor.moveTo(worldPos.x, worldPos.y);
      })
      .call(zoomHandler)
      .on("dblclick.zoom", null);

    new ClickFlash(Controls.field, () => zoomTransform(selection.node()!));
    new ProbabilityOverlay(Controls.field, () =>
      zoomTransform(selection.node()!),
    );

    Controls.center = (x, y) => {
      if (!autoPan || cameraMoving || performance.now() < manualUntil) return;
      const canvas = selection.node();
      if (!canvas) return;
      const from = zoomTransform(canvas);
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

  // todo create method on the parent which applies transform instead of mutating the object directly.
  // todo add different types (maybe with brands) for the different types of transforms, because we are starting to work in a lot of different coordinate systems.

  // todo i need a global camera state, and based on when the camera changes we should update foreground and background position.
  // todo cursor is always in upper left corner
  // todo pressing a square does nothing

  // todo after restarting, the opened cell is not in the middle
  // todo, when i load the page, then press somewhere, then it jumps to another place
  // - todo i need to pass initial transform to controls

  // todo this logic should be moved to the field. If we want custom behavior then we should save settings on the field to enable/disable multi-flagging.
  private static open() {
    const x = Controls.cursor.getX();
    const y = Controls.cursor.getY();

    if (Controls.fieldStorage === undefined)
      throw new Error("tried to save, but fieldstorage is undefined");

    Controls.openAt(x, y);
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

  // todo this logic should be moved to the field. If we want custom behavior then we should save settings on the field to enable/disable multi-flagging.
  private static flag() {
    const x = Controls.cursor.getX();
    const y = Controls.cursor.getY();

    if (Controls.fieldStorage === undefined)
      throw new Error("tried to save, but fieldstorage is undefined");

    Controls.field.flag(x, y);
    Controls.field.recordClick();

    Controls.saver.request();
  }
}

const eventSchema = z
  .object({
    type: z.enum(["start", "end", "zoom"]),
    transform: z.object({
      k: z.number(),
      x: z.number(),
      y: z.number(),
    }),
  })
  .passthrough();

const savedCameraTransform = {
  key: "savedCamerTransform",
  get: (): CameraTransform | null => {
    return JSON.parse(
      (localStorage.getItem(savedCameraTransform.key) as string | null) ??
        "null",
    ) as CameraTransform;
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
