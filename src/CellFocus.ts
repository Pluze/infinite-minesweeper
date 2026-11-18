/** Stable identity with an explicit membership revision for incremental queries. */
export class CellFocus extends Set<string> {
  revision = 0;
  override add(key: string) { if (!this.has(key)) { super.add(key); this.revision++; } return this; }
  override delete(key: string) { const changed = super.delete(key); if (changed) this.revision++; return changed; }
  override clear() { if (this.size) { super.clear(); this.revision++; } }
}
