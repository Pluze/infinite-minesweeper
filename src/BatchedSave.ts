/** A trailing checkpoint with a fixed deadline: continuous clicks cannot starve it. */
export class BatchedSave {
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    private write: () => void | Promise<void>,
    private onError: (error: unknown) => void,
    private delay = 1000,
  ) {}
  public request() {
    this.dirty = true;
    if (this.timer === undefined)
      this.timer = setTimeout(() => this.flush(), this.delay);
  }
  public discard() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty = false;
  }
  public flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty) return;
    try {
      const result = this.write();
      this.dirty = false;
      if (result)
        result.catch((error) => {
          this.dirty = true;
          this.onError(error);
        });
    } catch (error) {
      this.onError(error);
    }
  }
}
