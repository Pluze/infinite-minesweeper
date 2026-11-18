import { formatInteger } from "./NumberFormat";
import {
  MemoryPressureGuard,
  reportedHeapFraction,
  type HeapUsage,
} from "./MemoryPressure";
import { renderQuality } from "./RenderQuality";
import { probabilityModel } from "./MineProbability";
import { Field } from "./Field";

export { findNumberMove } from "./MovePlanner";
import { findNumberMove, islandFocus } from "./MovePlanner";

const ACTIVE_PLAYBACK_KEY = "activeBackgroundPlayback";

export class AutoPlayer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private suspended = false;
  private memoryGuard = new MemoryPressureGuard();
  private memoryChecked = -Infinity;
  private wakeGeneration = 0;
  private channel =
    typeof window !== "undefined" && typeof MessageChannel !== "undefined"
      ? new MessageChannel()
      : undefined;
  private near = { x: 1, y: 1 };
  private count = 0;
  private lastGuess = "";
  private lastStep = 0;
  private stopBeforeGuess = false;
  private rateStarted = 0;
  private rateCount = 0;
  private busyMs = 0;
  private batches = 0;
  private debugToggle =
    document.querySelector<HTMLInputElement>("#run-to-guess");
  private actualRate = document.querySelector<HTMLElement>("#actual-rate");
  private get clicksPerSecond() {
    return 2 ** Number(this.speed.value);
  }
  private speed = document.querySelector<HTMLInputElement>("#auto-speed")!;
  private status = document.querySelector<HTMLElement>("#auto-status")!;
  private toggleButton =
    document.querySelector<HTMLButtonElement>("#auto-toggle")!;
  private playbackLabel =
    document.querySelector<HTMLElement>("#playback-label")!;

  constructor(
    private field: Field,
    private click: (x: number, y: number) => void,
  ) {
    if (this.channel)
      this.channel.port1.onmessage = (event) => {
        if (event.data === this.wakeGeneration && this.running) this.tick();
      };
    const stored = Number(localStorage.getItem("autoClickSpeed") ?? 4);
    this.speed.value = String(
      Number.isFinite(stored) && stored > 0
        ? Math.max(0, Math.min(16, Math.round(Math.log2(stored))))
        : 2,
    );
    const updateSpeed = () => {
      renderQuality(this.field).update({ target: this.clicksPerSecond });
      document.querySelector("#speed-value")!.textContent = formatInteger(
        this.clicksPerSecond,
      );
      localStorage.setItem("autoClickSpeed", String(this.clicksPerSecond));
      if (this.running) {
        clearTimeout(this.timer);
        this.lastStep = performance.now();
        this.schedule();
      }
    };
    this.speed.addEventListener("input", updateSpeed);
    updateSpeed();
    const toggle = () => (this.running ? this.pause() : this.start());
    this.toggleButton.onclick = toggle;
    if (this.debugToggle) {
      this.stopBeforeGuess = localStorage.getItem("pauseBeforeGuess") === "on";
      this.debugToggle.checked = this.stopBeforeGuess;
      this.debugToggle.onchange = () => {
        this.stopBeforeGuess = this.debugToggle!.checked;
        localStorage.setItem(
          "pauseBeforeGuess",
          this.stopBeforeGuess ? "on" : "off",
        );
      };
    }
    field.on("beforeRestart", () => this.pause("Paused", false));
    field.on("saveFailed", () =>
      this.pause("Paused: saving failed. Check available storage.", false),
    );
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.matches(
          "textarea, select, input:not([type=range]):not([type=checkbox])",
        )
      )
        return;
      // Prevent native button/checkbox activation as well as page scrolling.
      event.preventDefault();
      if (!event.repeat) toggle();
    });
    document.addEventListener("visibilitychange", () =>
      this.visibilityChanged(),
    );
    document.addEventListener("freeze", () => this.suspend());
    document.addEventListener("resume", () => this.resume());
    window.addEventListener("pagehide", (event) => {
      if (!this.running) return;
      if (event.persisted) this.suspend();
      else this.pause();
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) this.resume();
    });

    if (this.shouldRestorePlayback()) this.start();
    else this.pause("Paused. Start auto-play to explore.");
  }

  private shouldRestorePlayback() {
    const discarded = (document as Document & { wasDiscarded?: boolean })
      .wasDiscarded;
    if (!discarded) return false;
    try {
      return sessionStorage.getItem(ACTIVE_PLAYBACK_KEY) === "on";
    } catch {
      return false;
    }
  }

  private rememberPlayback() {
    try {
      if (this.running) sessionStorage.setItem(ACTIVE_PLAYBACK_KEY, "on");
      else sessionStorage.removeItem(ACTIVE_PLAYBACK_KEY);
    } catch {
      // The browser can restrict session storage. Ordinary play still works.
    }
  }

  private visibilityChanged() {
    if (this.running && !this.suspended) this.reschedule();
  }

  private cancelWake() {
    this.wakeGeneration++;
    clearTimeout(this.timer);
  }

  private suspend() {
    if (!this.running || this.suspended) return;
    this.suspended = true;
    this.cancelWake();
    this.field.emit("playbackSuspended");
  }

  private resume() {
    if (!this.suspended) return;
    this.suspended = false;
    this.visibilityChanged();
  }

  private schedule() {
    if (this.suspended) return;
    const generation = ++this.wakeGeneration;
    const rate = this.clicksPerSecond;
    const remaining = 1000 / rate - (performance.now() - this.lastStep);
    if (this.channel && rate >= 128 && remaining <= 0) {
      this.channel.port2.postMessage(generation);
    } else {
      this.timer = setTimeout(
        () => {
          if (generation === this.wakeGeneration) this.tick();
        },
        this.channel ? Math.max(0, remaining) : Math.max(4, 1000 / rate),
      );
    }
  }

  private reschedule() {
    clearTimeout(this.timer);
    this.lastStep = this.rateStarted = performance.now();
    this.rateCount = this.count;
    this.busyMs = 0;
    this.batches = 0;
    if (this.actualRate) this.actualRate.textContent = "Actual 0 /s";
    this.schedule();
  }

  private checkMemory(now: number, starting = false) {
    if (!starting && now - this.memoryChecked < 1000) return false;
    this.memoryChecked = now;
    const heap = (performance as Performance & { memory?: HeapUsage }).memory;
    if (!this.memoryGuard.check(heap)) return false;
    const fraction = reportedHeapFraction(heap);
    if (fraction === undefined) return false;
    this.pause(
      `Paused: browser-reported heap is ${formatInteger(100 * fraction)}% full.`,
    );
    return true;
  }

  private start() {
    if (this.running || this.checkMemory(performance.now(), true)) return;
    this.running = true;
    this.rememberPlayback();
    renderQuality(this.field).update({
      running: true,
      target: this.clicksPerSecond,
    });
    this.toggleButton.setAttribute("aria-checked", "true");
    this.playbackLabel.textContent = "Running";
    this.status.setAttribute("class", "sr-only");
    this.status.textContent = "Auto-playing";
    this.reschedule();
  }

  private pause(
    message = "Paused. You can play manually before resuming.",
    flush = true,
  ) {
    this.running = false;
    this.suspended = false;
    this.cancelWake();
    this.rememberPlayback();
    renderQuality(this.field).update({ running: false });
    this.toggleButton.setAttribute("aria-checked", "false");
    this.playbackLabel.textContent = "Paused";
    this.status.setAttribute(
      "class",
      message.startsWith("Paused:") ||
        message.startsWith("Paused before guessing")
        ? "safety-status"
        : "sr-only",
    );
    this.status.textContent = message;
    if (this.actualRate) this.actualRate.textContent = "Actual 0 /s";
    if (flush) this.field.emit("playbackPaused");
  }

  private tick() {
    if (!this.running || this.suspended) return;
    try {
      const hidden = document.hidden;
      const now = performance.now();
      if (this.checkMemory(now)) return;
      const rate = this.clicksPerSecond;
      const interval = 1000 / rate;
      if (hidden) this.lastStep = Math.max(this.lastStep, now - 1000);
      // Batch high speeds to avoid the browser's nested timer minimum, while
      // yielding regularly so pause buttons and camera animation stay responsive.
      const due = Math.min(
        Math.floor((now - this.lastStep) / interval),
        Math.ceil(rate / 10),
      );
      let lastVisual: { x: number; y: number } | undefined;
      for (let i = 0; i < due; i++) {
        let move = findNumberMove(this.field, this.near);
        if (!move) {
          const model = probabilityModel(this.field);
          const focus = islandFocus(this.field);
          if (focus.size) {
            const safe = model.guess(this.near, true, focus);
            if (
              safe &&
              safe.probability === 0 &&
              model.isCertainSafe(safe.cell)
            )
              move = safe.cell;
          }
          if (!move) move = findNumberMove(this.field, this.near, false);
          if (!move) {
            const safe = model.guess(this.near, true);
            if (
              safe &&
              safe.probability === 0 &&
              model.isCertainSafe(safe.cell)
            )
              move = safe.cell;
          }
          if (move) this.lastGuess = "";
          else if (this.stopBeforeGuess) {
            this.pause("Paused before guessing. No guess has been made.");
            return;
          } else {
            const guess = model.guess(this.near);
            if (guess) {
              move = guess.cell;
              this.lastGuess = ` · Last estimated mine risk: ${(guess.probability * 100).toFixed(1)}%, expected cell score: ${guess.expected.toFixed(2)} points`;
            }
          }
        }
        if (!move) {
          this.pause("Paused: no available cells.");
          return;
        }
        this.near = { x: move.x, y: move.y };
        lastVisual = { x: move.x, y: move.y };
        if (!hidden && rate < 128) this.field.emit("autoClick", lastVisual);
        this.click(move.x, move.y);
        this.count++;
        this.lastStep += interval;
        if (performance.now() - now >= 8) {
          // Keep accrued click debt across slices so a slow frame can be
          // recovered. Bound it to one second rather than dropping every remainder.
          this.lastStep = Math.max(this.lastStep, performance.now() - 1000);
          break;
        }
      }
      if (!hidden && lastVisual && rate >= 128)
        this.field.emit("autoClick", lastVisual);
      this.field.emit("autoBatchFinished");
      if (hidden || !this.running) {
        if (this.running) this.schedule();
        return;
      }
      this.busyMs += performance.now() - now;
      this.batches++;
      const elapsed = performance.now() - this.rateStarted;
      if (elapsed >= 500) {
        if (this.actualRate)
          this.actualRate.textContent = `Actual ${formatInteger(Math.round(((this.count - this.rateCount) * 1000) / elapsed))} /s`;
        this.actualRate?.setAttribute(
          "title",
          `Auto-play computation: ${Math.round((100 * this.busyMs) / elapsed)}% of wall time; ${this.batches} batches in ${Math.round(elapsed)} ms. Remaining time includes rendering, saving and scheduler waits.`,
        );
        this.busyMs = 0;
        this.batches = 0;
        this.rateStarted = performance.now();
        this.rateCount = this.count;
      }
      this.status.textContent = `Auto-playing · ${formatInteger(this.count)} clicks${this.lastGuess}`;
      this.schedule();
    } catch (error) {
      console.error(error);
      this.pause("Paused: action or save failed. Check the browser console.");
    }
  }
}
