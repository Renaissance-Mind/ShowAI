/** Merge bursts, retaining one follow-up for changes received during a running task. */
export function coalescedTask<T>(action: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined,
    requested = false;
  return () => {
    requested = true;
    if (pending) return pending;
    const run = async () => {
      let result: T;
      do {
        requested = false;
        try {
          result = await action();
        } catch (error) {
          if (!requested) throw error;
        }
      } while (requested);
      return result!;
    };
    pending = run().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
