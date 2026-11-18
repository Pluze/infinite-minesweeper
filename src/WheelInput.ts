type WheelAction = "pan" | "zoom";
type ScrollEvent = WheelEvent & {
  wheelDeltaY?: number;
  momentum?: boolean;
};

// MapLibre's scroll handler identifies some wheel ticks directly and allows
// 40 ms for a second sample when a new sequence is ambiguous.
const WHEEL_DELTA = 4.000244140625;
const SAMPLE_WINDOW_MS = 40;
const CONTINUOUS_RATE_THRESHOLD = 200;
const LEGACY_NOTCH = 120;

export class WheelInput {
  private verticalPan?: { time: number; direction: number };
  private pending?: {
    event: ScrollEvent;
    timer: ReturnType<typeof setTimeout>;
  };

  constructor(
    private apply: (action: WheelAction, event: WheelEvent) => void,
  ) {}

  public reset() {
    const pending = this.takePending();
    if (pending) clearTimeout(pending.timer);
    this.verticalPan = undefined;
  }

  public handle(event: ScrollEvent) {
    // Read deltaMode first because some browsers change the units they expose
    // based on whether the caller checks this property.
    const units = event.deltaMode;
    const { deltaX, deltaY } = event;
    if (!deltaX && !deltaY) return;

    if (event.ctrlKey || event.metaKey) {
      // Chromium uses Ctrl+wheel for trackpad pinch.
      this.reset();
      this.apply("zoom", event);
      return;
    }

    if (units !== 0) {
      this.dispatch("zoom", event);
      return;
    }

    // Blink can divide the legacy 120-unit notch by devicePixelRatio before
    // exposing it to the page. An exact scaled notch can be either device.
    const ticks = event.wheelDeltaY;
    const hasTicks = ticks !== undefined && ticks * deltaY < 0;
    const matchesPointDelta = hasTicks && Math.abs(ticks + 3 * deltaY) <= 2;
    const wholeNotch = hasTicks && this.isWheelNotch(ticks);
    if (
      deltaX === 0 &&
      !event.momentum &&
      (deltaY % WHEEL_DELTA === 0 || (wholeNotch && !matchesPointDelta))
    ) {
      this.dispatch("zoom", event);
      return;
    }

    if (
      deltaX !== 0 ||
      event.momentum ||
      Math.abs(deltaY) < 4 ||
      (matchesPointDelta && !wholeNotch)
    ) {
      this.dispatch("pan", event);
      return;
    }

    if (
      this.verticalPan &&
      event.timeStamp - this.verticalPan.time < SAMPLE_WINDOW_MS &&
      Math.sign(deltaY) === this.verticalPan.direction
    ) {
      this.dispatch("pan", event);
      return;
    }

    if (!this.pending) {
      this.pending = {
        event,
        timer: setTimeout(() => {
          const pending = this.takePending();
          if (pending) this.dispatch("zoom", pending.event);
        }, SAMPLE_WINDOW_MS),
      };
      return;
    }

    const gap = event.timeStamp - this.pending.event.timeStamp;
    const continuous =
      gap < SAMPLE_WINDOW_MS &&
      Math.abs(deltaY * gap) < CONTINUOUS_RATE_THRESHOLD;
    this.dispatch(continuous ? "pan" : "zoom", event);
  }

  private isWheelNotch(ticks: number) {
    const scaledNotch = LEGACY_NOTCH / (window.devicePixelRatio || 1);
    const count = Math.round(Math.abs(ticks) / scaledNotch);
    return (
      ticks % LEGACY_NOTCH === 0 ||
      (count > 0 && Math.abs(Math.abs(ticks) - count * scaledNotch) < 1)
    );
  }

  private takePending() {
    const pending = this.pending;
    this.pending = undefined;
    return pending;
  }

  private dispatch(action: WheelAction, event: ScrollEvent) {
    const pending = this.takePending();
    if (pending) {
      clearTimeout(pending.timer);
      this.apply(action, pending.event);
    }
    this.verticalPan =
      action === "pan" && event.deltaY !== 0
        ? { time: event.timeStamp, direction: Math.sign(event.deltaY) }
        : undefined;
    this.apply(action, event);
  }
}
