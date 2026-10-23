/**
 * Holds menu commands for a window until its renderer has registered its
 * menu listener. A Help or File command chosen while no window is open opens
 * a new window; sending immediately would reach a page that is still loading
 * and the command would be lost.
 */
export class MenuCommandQueue<Target extends object, Command> {
  private readonly ready = new WeakSet<Target>();
  private readonly pending = new WeakMap<Target, Command[]>();

  constructor(private readonly deliver: (target: Target, command: Command) => void) {}

  send(target: Target, command: Command) {
    if (this.ready.has(target)) this.deliver(target, command);
    else this.pending.set(target, [...(this.pending.get(target) ?? []), command]);
  }

  /** The renderer listens for menu commands; deliver what waited, in order. */
  markReady(target: Target) {
    this.ready.add(target);
    const queued = this.pending.get(target) ?? [];
    this.pending.delete(target);
    for (const command of queued) this.deliver(target, command);
  }

  /** The renderer is loading a new document; hold commands until it listens again. */
  reset(target: Target) {
    this.ready.delete(target);
  }
}
