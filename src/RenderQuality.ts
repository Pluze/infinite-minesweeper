import { Field } from "./Field";
export type VisualState = {
  running: boolean;
  target: number;
  scale: number;
  reducedMotion: boolean;
};

/** Presentation only: never changes solver decisions, clicks or history. */
export function qualityFor(state: VisualState) {
  const cellPixels = 16 * state.scale;
  const overview = cellPixels < 14;
  const dense = cellPixels < 6;
  const fast = state.running && state.target >= 128;
  const extreme = state.running && state.target >= 2048;
  const lean = fast || overview;
  return {
    animateCells: !lean && !state.reducedMotion,
    details: !overview,
    maxFPS: 0, // Let requestAnimationFrame follow the display refresh rate.
    cameraCooldownMs: extreme ? 2000 : fast ? 1000 : overview ? 600 : 0,
    flashFrameMs: lean ? 50 : 16,
    flashCount: dense ? 0 : lean ? 1 : 8,
    flashDuration: lean ? 160 : 360,
    flashExpand: !lean && !state.reducedMotion,
    flashGlow: !lean,
    overlayFrameMs: extreme || dense ? 100 : lean ? 50 : 16,
    probabilityMs: extreme || dense ? 250 : lean ? 150 : 100,
    overlayResolution: lean ? 1 : 2,
    probabilityLabels: cellPixels >= 26,
    plotMs: extreme || dense ? 500 : lean ? 250 : 100,
  };
}
export class RenderQuality {
  public state: VisualState = {
    running: false,
    target: 4,
    scale: 2,
    reducedMotion: false,
  };
  public current = qualityFor(this.state);
  public revision = 0;
  public update(next: Partial<VisualState>) {
    let changed = false;
    for (const key of Object.keys(next) as (keyof VisualState)[])
      if (next[key] !== this.state[key]) changed = true;
    if (!changed) return;
    this.state = { ...this.state, ...next };
    this.current = qualityFor(this.state);
    this.revision++;
  }
}
const profiles = new WeakMap<Field, RenderQuality>();
export function renderQuality(field: Field) {
  let profile = profiles.get(field);
  if (!profile) {
    profile = new RenderQuality();
    profiles.set(field, profile);
  }
  return profile;
}
