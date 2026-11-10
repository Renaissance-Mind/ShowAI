/**
 * Runs one navigation at a time. A request made while another runs waits for
 * it; only the latest waiting request runs, and earlier waiting requests
 * resolve with their fallback. The running request can ask whether a newer
 * one has arrived and skip showing its result.
 */
export class LatestRequest {
  private running = false;
  private ticket = 0;
  private waiting?: { start: () => void; drop: () => void };
  constructor(
    private readonly hooks: { start?: () => void; settle?: () => void } = {},
  ) {}
  get busy() {
    return this.running;
  }
  run<T>(fallback: T, task: (current: () => boolean) => Promise<T>): Promise<T> {
    if (this.running) {
      this.ticket++;
      return new Promise<T>((resolve, reject) => {
        this.waiting?.drop();
        this.waiting = {
          start: () => void this.run(fallback, task).then(resolve, reject),
          drop: () => resolve(fallback),
        };
      });
    }
    this.running = true;
    const ticket = ++this.ticket;
    this.hooks.start?.();
    return task(() => ticket === this.ticket).finally(() => {
      this.running = false;
      this.hooks.settle?.();
      const next = this.waiting;
      this.waiting = undefined;
      next?.start();
    });
  }
}
