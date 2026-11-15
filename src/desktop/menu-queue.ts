export class MenuCommandQueue<Target extends object, Command> {
  private readonly ready = new WeakSet<Target>();
  private readonly pending = new WeakMap<Target, Command[]>();

  constructor(private readonly deliver: (target: Target, command: Command) => void) {}

  send(target: Target, command: Command) {
    if (this.ready.has(target)) this.deliver(target, command);
    else this.pending.set(target, [...(this.pending.get(target) ?? []), command]);
  }

  markReady(target: Target) {
    this.ready.add(target);
    const queued = this.pending.get(target) ?? [];
    this.pending.delete(target);
    for (const command of queued) this.deliver(target, command);
  }

  reset(target: Target) {
    this.ready.delete(target);
  }
}
