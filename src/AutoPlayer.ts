import { formatInteger } from "./NumberFormat";
import {MemoryPressureGuard, mobileBoardLimitReached, isMemoryConstrainedDevice, type HeapUsage} from "./MemoryPressure";
import { renderQuality } from "./RenderQuality";
import { probabilityModel } from "./MineProbability";
import { Field } from "./Field";

export { findNumberMove } from "./MovePlanner";
import { findNumberMove, islandFocus } from "./MovePlanner";

export class AutoPlayer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
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
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.pause("Paused: page is hidden.");
    });
    this.pause("Paused. Start auto-play to explore.");
  }

  private schedule() {
    const generation = ++this.wakeGeneration;
    if (
      this.channel &&
      this.clicksPerSecond >= 128 &&
      performance.now() - this.lastStep >= 1000 / this.clicksPerSecond
    ) {
      this.channel.port2.postMessage(generation);
    } else {
      this.timer = setTimeout(
        () => {
          if (generation === this.wakeGeneration) this.tick();
        },
        this.channel
          ? Math.max(
              0,
              1000 / this.clicksPerSecond - (performance.now() - this.lastStep),
            )
          : Math.max(4, 1000 / this.clicksPerSecond),
      );
    }
  }

  private mobileLimit() {
    if (!isMemoryConstrainedDevice()) return false;
    if (!mobileBoardLimitReached(this.field.cellData.numberStorage.size, this.field.clickScores.length)) return false;
    this.pause("Paused: mobile memory safety limit reached. Saving progress. Use a desktop for larger games; reloading will not remove this limit.");
    return true;
  }

  private start() {
    if (this.running || this.mobileLimit()) return;
    this.running = true;
    renderQuality(this.field).update({
      running: true,
      target: this.clicksPerSecond,
    });
    this.lastStep = performance.now();
    this.rateStarted = this.lastStep;
    this.rateCount = this.count;
    this.busyMs = 0;
    this.batches = 0;
    this.toggleButton.setAttribute("aria-checked", "true");
    this.playbackLabel.textContent = "Running";
    this.status.setAttribute("class", "sr-only");
    this.status.textContent = "Auto-playing";
    this.schedule();
  }

  private pause(
    message = "Paused. You can play manually before resuming.",
    flush = true,
  ) {
    this.running = false;
    this.wakeGeneration++;
    renderQuality(this.field).update({ running: false });
    clearTimeout(this.timer);
    this.toggleButton.setAttribute("aria-checked", "false");
    this.playbackLabel.textContent = "Paused";
    this.status.setAttribute("class", message.startsWith("Paused:") && !message.includes("page is hidden") ? "safety-status" : "sr-only");
    this.status.textContent = message;
    if (this.actualRate) this.actualRate.textContent = "Actual 0 /s";
    if (flush) this.field.emit("playbackPaused");
  }

  private tick() {
    if (!this.running) return;
    try {
      if (this.mobileLimit()) return;
      const now = performance.now();
      if (now - this.memoryChecked >= 1000) {
        this.memoryChecked = now;
        if (this.memoryGuard.check((performance as Performance & {memory?:HeapUsage}).memory)) {
          this.pause("Paused: browser memory is nearly full. Saving progress; reload before continuing.");
          return;
        }
      }
      const interval = 1000 / this.clicksPerSecond;
      // Batch high speeds to avoid the browser's nested timer minimum, while
      // yielding regularly so pause buttons and camera animation stay responsive.
      const due = Math.min(
        Math.floor((now - this.lastStep) / interval),
        Math.ceil(this.clicksPerSecond / 10),
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
        if (this.clicksPerSecond < 128)
          this.field.emit("autoClick", lastVisual);
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
      if (lastVisual && this.clicksPerSecond >= 128)
        this.field.emit("autoClick", lastVisual);
      this.field.emit("autoBatchFinished");
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
