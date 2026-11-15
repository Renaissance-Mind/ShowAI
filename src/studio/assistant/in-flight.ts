export function createInFlight(onChange: (keys: string[]) => void) {
  const keys = new Set<string>();
  const changed = () => onChange([...keys]);
  const release = (key: string) => {
    if (keys.delete(key)) changed();
  };
  return {
    has: (key: string) => keys.has(key),
    claim(key: string) {
      if (keys.has(key)) return false;
      keys.add(key);
      changed();
      return true;
    },
    release,
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
