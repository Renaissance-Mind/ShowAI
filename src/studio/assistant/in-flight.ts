/**
 * Requests that must not run twice at once, by key: sending from an input,
 * retrying, undoing or stopping a turn. A second run while the first is in
 * flight does nothing.
 */
export function createInFlight(onChange: (keys: string[]) => void) {
  const keys = new Set<string>();
  const changed = () => onChange([...keys]);
  const release = (key: string) => {
    if (keys.delete(key)) changed();
  };
  return {
    has: (key: string) => keys.has(key),
    /** Marks key busy; false when it already was. */
    claim(key: string) {
      if (keys.has(key)) return false;
      keys.add(key);
      changed();
      return true;
    },
    release,
    /**
     * Runs work once at a time per key. With hold, the key stays busy after
     * success until released, e.g. a stopped turn until it ends.
     */
    async run(key: string, work: () => Promise<unknown>, hold = false) {
      if (keys.has(key)) return false;
      keys.add(key);
      changed();
      let held = false;
      try {
        await work();
        held = hold;
      } finally {
        if (!held) release(key);
      }
      return true;
    },
  };
}
export type InFlight = ReturnType<typeof createInFlight>;
