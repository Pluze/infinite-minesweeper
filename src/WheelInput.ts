type WheelAction = "pan" | "zoom";
type ScrollEvent = WheelEvent & {
  wheelDeltaY?: number;
  momentum?: boolean;
};

// Briefly sample an ambiguous vertical burst, as MapLibre does for scrolling.
const WHEEL_DELTA = 4.000244140625;
const SAMPLE_WINDOW_MS = 40;
const LEGACY_NOTCH = 120;
const LARGE_VERTICAL_STEP = 64;

export class WheelInput {
  private lastPan?: { time: number; direction: number; magnitude: number };
  private pending: ScrollEvent[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private apply: (action: WheelAction, event: WheelEvent) => void,
  ) {}

  public reset() {
    this.takePending();
    this.lastPan = undefined;
  }

  public handle(event: ScrollEvent) {
    // Read deltaMode first because it can affect the values exposed by Firefox.
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

    const magnitude = Math.abs(deltaY);
    const sideways =
      deltaX !== 0 &&
      (!deltaY || Math.abs(deltaX) >= Math.max(1, magnitude / 8));
    if (sideways || event.momentum) {
      this.dispatch("pan", event);
      return;
    }

    // A physical wheel can report pixel deltas and even the same tick ratio
    // as a trackpad. A large vertical step is wheel evidence unless it
    // clearly continues a recent, already identified pan.
    const lastPan = this.lastPan;
    const continuingPan =
      lastPan &&
      event.timeStamp - lastPan.time < SAMPLE_WINDOW_MS &&
      Math.sign(deltaY) === lastPan.direction
        ? lastPan
        : undefined;
    if (
      deltaY % WHEEL_DELTA === 0 ||
      this.isDiscreteNotch(event) ||
      (magnitude >= LARGE_VERTICAL_STEP &&
        (!continuingPan || magnitude > 2 * continuingPan.magnitude))
    ) {
      this.dispatch("zoom", event);
      return;
    }
    if (continuingPan) {
      this.dispatch("pan", event);
      return;
    }

    if (this.pending.length) {
      const first = this.pending[0];
      if (
        event.timeStamp - first.timeStamp >= SAMPLE_WINDOW_MS ||
        Math.sign(deltaY) !== Math.sign(first.deltaY)
      ) {
        this.flushPending("zoom");
      }
    }
    if (!this.pending.length) {
      this.timer = setTimeout(
        () => this.flushPending("zoom"),
        SAMPLE_WINDOW_MS,
      );
    }

    this.pending.push(event);
    // A mouse tick can start with a couple of small samples before its main
    // step. Only a sustained sequence of small vertical samples starts a pan.
    if (
      this.pending.length >= 3 &&
      this.pending.some((sample) => !this.isWholeNotch(sample.wheelDeltaY))
    ) {
      this.flushPending("pan");
    }
  }

  private isDiscreteNotch(event: ScrollEvent) {
    const ticks = event.wheelDeltaY;
    return (
      ticks !== undefined &&
      ticks * event.deltaY < 0 &&
      this.isWholeNotch(ticks) &&
      Math.abs(ticks + 3 * event.deltaY) > 2
    );
  }

  private isWholeNotch(ticks?: number) {
    if (!ticks) return false;
    // Blink may scale the legacy 120-unit tick by devicePixelRatio.
    const scaledNotch = LEGACY_NOTCH / (window.devicePixelRatio || 1);
    const count = Math.round(Math.abs(ticks) / scaledNotch);
    return (
      ticks % LEGACY_NOTCH === 0 ||
      (count > 0 && Math.abs(Math.abs(ticks) - count * scaledNotch) < 1)
    );
  }

  private takePending() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const pending = this.pending;
    this.pending = [];
    return pending;
  }

  private flushPending(action: WheelAction) {
    for (const event of this.takePending()) this.applyEvent(action, event);
  }

  private dispatch(action: WheelAction, event: ScrollEvent) {
    this.flushPending(action);
    this.applyEvent(action, event);
  }

  private applyEvent(action: WheelAction, event: ScrollEvent) {
    this.lastPan =
      action === "pan" && event.deltaY
        ? {
            time: event.timeStamp,
            direction: Math.sign(event.deltaY),
            magnitude: Math.abs(event.deltaY),
          }
        : undefined;
    this.apply(action, event);
  }
}
