/** Bound capture work, choosing visible cards before speculative neighbors. */
export class CaptureQueue {
  private pending: { start: () => Promise<void>; priority: () => number }[] =
    [];
  private scheduled = false;
  private running = 0;

  constructor(private readonly concurrency = 1) {}

  enqueue<T>(
    run: () => Promise<T>,
    priority: () => number = () => 0,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        priority,
        start: async () => {
          await Promise.resolve().then(run).then(resolve, reject);
        },
      });
      this.pump();
    });
  }

  private pump() {
    if (
      this.running >= this.concurrency ||
      this.scheduled ||
      !this.pending.length
    )
      return;
    this.scheduled = true;
    setTimeout(() => {
      this.scheduled = false;
      let first = 0;
      for (let index = 1; index < this.pending.length; index++)
        if (this.pending[index].priority() < this.pending[first].priority())
          first = index;
      const [job] = this.pending.splice(first, 1);
      this.running++;
      void job.start().finally(() => {
        this.running--;
        this.pump();
      });
      this.pump();
    }, 0);
  }
}
