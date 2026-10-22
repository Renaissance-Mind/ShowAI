/** One background admission at a time; input pauses pending work, abort removes stale cards. */
export class PreviewQueue {
  private pending: (() => void)[] = [];
  private running = false;
  private paused = false;
  private scheduled = false;

  constructor(
    private schedule: (run: () => void) => void = (run) => setTimeout(run, 0),
  ) {}

  pause(paused: boolean) {
    this.paused = paused;
    this.pump();
  }

  enqueue<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const aborted = () => {
        const index = this.pending.indexOf(start);
        if (index >= 0) this.pending.splice(index, 1);
        reject(signal.reason);
      };
      const start = () => {
        signal.removeEventListener("abort", aborted);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        this.running = true;
        void Promise.resolve()
          .then(run)
          .then(resolve, reject)
          .finally(() => {
            this.running = false;
            this.pump();
          });
      };
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener("abort", aborted, { once: true });
      this.pending.push(start);
      this.pump();
    });
  }

  private pump() {
    if (this.running || this.paused || this.scheduled || !this.pending.length)
      return;
    this.scheduled = true;
    this.schedule(() => {
      this.scheduled = false;
      if (this.running || this.paused) return;
      this.pending.shift()?.();
      this.pump();
    });
  }
}

let queue: PreviewQueue | undefined;
export function previewWork<T>(run: () => Promise<T>, signal: AbortSignal) {
  if (!queue) {
    queue = new PreviewQueue((run) =>
      window.requestIdleCallback(run, { timeout: 1000 }),
    );
    const pointers = new Set<number>();
    let idle: ReturnType<typeof setTimeout>;
    const defer = () => {
      queue!.pause(true);
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (!pointers.size) queue!.pause(false);
      }, 160);
    };
    window.addEventListener(
      "pointerdown",
      (event) => {
        pointers.add(event.pointerId);
        defer();
      },
      true,
    );
    for (const type of [
      "pointerup",
      "pointercancel",
      "lostpointercapture",
    ] as const)
      window.addEventListener(
        type,
        (event) => {
          pointers.delete(event.pointerId);
          defer();
        },
        true,
      );
    for (const type of ["wheel", "scroll"])
      window.addEventListener(type, defer, { capture: true, passive: true });
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape") pointers.clear();
        defer();
      },
      true,
    );
    window.addEventListener(
      "pointermove",
      (event) => {
        if (!event.buttons && pointers.size) {
          pointers.clear();
          defer();
        }
      },
      true,
    );
    window.addEventListener("blur", () => {
      pointers.clear();
      defer();
    });
  }
  return queue.enqueue(run, signal);
}
