export const yieldToBrowser = () => new Promise<void>(resolve => {
  // Message tasks avoid the nested setTimeout 4 ms floor while allowing input.
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {channel.port1.close(); channel.port2.close(); resolve();};
  channel.port2.postMessage(null);
});
export class LoadBudget {
 private resumed = -Infinity;
 due() { return performance.now() - this.resumed >= 8; }
 async yield() { await yieldToBrowser(); this.resumed = performance.now(); }
}
export class LoadingScreen {
 private stageName = "";
 private stageStarted = performance.now();
 private reportStage() {
  if (this.stageName) console.debug(`[load] ${this.stageName}: ${Math.round(performance.now() - this.stageStarted)} ms`);
 }
 readonly controller = new AbortController();
 private screen = document.querySelector<HTMLElement>("#loading-screen")!;
 private detail = document.querySelector<HTMLElement>("#loading-detail")!;
 private progress = document.querySelector<HTMLProgressElement>("#loading-progress")!;
 private button = document.querySelector<HTMLButtonElement>("#loading-new-game")!;
 constructor(startFresh: () => Promise<void>) {
  this.button.onclick = async () => {
   this.button.disabled = true;
   this.controller.abort();
   this.update("Starting new game…");
   try { await startFresh(); }
   catch (error) { this.fail(error); this.button.disabled = false; }
  };
 }
 update(message: string, completed?: number, total?: number) {
  this.detail.textContent = message;
  if (completed !== undefined && total !== undefined && total > 0) {
   this.progress.max = total; this.progress.value = completed;
  } else this.progress.removeAttribute("value");
 }
 async stage(message: string) {
  this.controller.signal.throwIfAborted();
  this.reportStage(); this.stageName = message; this.stageStarted = performance.now();
  this.update(message);
  await yieldToBrowser();
  this.controller.signal.throwIfAborted();
 }
 finish() { this.controller.signal.throwIfAborted(); this.reportStage(); this.screen.hidden = true; }
 fail(_error: unknown) { this.update("Loading failed. You can start a new game."); }
}
