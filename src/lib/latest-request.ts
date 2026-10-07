/** Run one request at a time, keeping only the newest waiting request. */
export function latestRequest<T>() {
  let pending: Promise<T> | undefined, next: (() => Promise<T>) | undefined;
  return (action: () => Promise<T>): Promise<T> => {
    next = action;
    if (pending) return pending;
    const run = async () => {
      let result: T;
      while (next) {
        const work = next;
        next = undefined;
        try {
          result = await work();
        } catch (error) {
          if (!next) throw error;
        }
      }
      return result!;
    };
    pending = run().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
