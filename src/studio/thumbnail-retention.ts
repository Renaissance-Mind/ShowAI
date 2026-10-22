/** Keep recently viewed previews warm without retaining every visited renderer. */
export class ThumbnailRetention {
  private entries = new Map<
    symbol,
    { visible: boolean; release: () => void }
  >();

  constructor(private limit: number) {}

  update(key: symbol, visible: boolean, release: () => void) {
    if (visible) {
      this.entries.delete(key);
      this.entries.set(key, { visible, release });
    } else {
      const entry = this.entries.get(key);
      if (entry) entry.visible = false;
    }
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.limit) break;
      // A large viewport may need more than the retention limit.
      if (entry.visible) continue;
      this.entries.delete(oldest);
      entry.release();
    }
  }

  remove(key: symbol) {
    this.entries.delete(key);
  }
}
