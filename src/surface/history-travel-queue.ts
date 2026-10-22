import type { OwnedSourceSession } from "./source-client";

interface OwnerTravels {
  queues: Set<HistoryTravelQueue>;
  listeners: Set<() => void>;
  accepting: boolean;
  tail: Promise<void>;
  failure?: { error: unknown };
}
const owners = new WeakMap<OwnedSourceSession, OwnerTravels>();
function state(owner: OwnedSourceSession) {
  let value = owners.get(owner);
  if (!value) {
    value = {
      queues: new Set(),
      listeners: new Set(),
      accepting: true,
      tail: Promise.resolve(),
    };
    owners.set(owner, value);
  }
  return value;
}
export function observeHistoryTravels(
  owner: OwnedSourceSession,
  listener: () => void,
) {
  const value = state(owner);
  value.listeners.add(listener);
  return () => {
    value.listeners.delete(listener);
  };
}
export function historyTravelsPending(owner: OwnedSourceSession | undefined) {
  return (
    !!owner &&
    [...(owners.get(owner)?.queues ?? [])].some(
      (queue) => queue.pending || queue.failure,
    )
  );
}
export function historyTravelsRunning(owner: OwnedSourceSession | undefined) {
  return (
    !!owner &&
    [...(owners.get(owner)?.queues ?? [])].some((queue) => queue.pending)
  );
}
export async function settleHistoryTravels(
  owner: OwnedSourceSession | undefined,
) {
  if (owner)
    await Promise.all(
      [...(owners.get(owner)?.queues ?? [])].map((queue) => queue.settled()),
    );
}
export function historyTravelFailure(owner: OwnedSourceSession | undefined) {
  if (owner && owners.get(owner)?.failure) return owners.get(owner)!.failure;
  if (owner)
    for (const queue of owners.get(owner)?.queues ?? [])
      if (queue.failure) return queue.failure;
}
export async function flushHistoryTravels(
  owner: OwnedSourceSession | undefined,
) {
  if (!owner) return;
  // A second click accepted while the first trip was awaited belongs to this
  // same persistence barrier. Never confuse its queue with history rebase work.
  while (true) {
    const queues = [...(owners.get(owner)?.queues ?? [])];
    await Promise.all(queues.map((queue) => queue.flush()));
    if (!historyTravelsPending(owner)) return;
  }
}
export function stopHistoryTravels(owner: OwnedSourceSession | undefined) {
  if (!owner) return;
  const value = state(owner);
  value.accepting = false;
  for (const queue of value.queues) queue.stop();
}
/** Only the explicit recovery path may retire failed commands, after saving
 * the actual recovery draft and reading a fresh authoritative backend body.
 * It does not retry an inverse whose durable result may already exist. */
export async function retireRecoveredHistoryTravels(owner: OwnedSourceSession) {
  stopHistoryTravels(owner);
  const value = state(owner);
  await Promise.all([...value.queues].map((queue) => queue.settled()));
  value.queues.clear();
  value.failure = undefined;
  value.tail = Promise.resolve();
  for (const listener of value.listeners) listener();
}

/** Accepted Undo/Redo requests are serialized from preflush through history
 * consumption and latestChange. This queue must never contain historyTail or
 * join itself from an internal Native publication save. */
export class HistoryTravelQueue {
  private tail: Promise<void> = Promise.resolve();
  private count = 0;
  private accepting = true;
  private failed: { error: unknown } | undefined;
  constructor(readonly owner?: OwnedSourceSession) {
    if (owner) state(owner).queues.add(this);
  }
  get pending() {
    return this.count > 0;
  }
  get failure() {
    return this.failed??(this.owner?state(this.owner).failure:undefined);
  }
  private changed() {
    if (this.owner)
      for (const listener of state(this.owner).listeners) listener();
  }
  enqueue(operation: () => Promise<void>): Promise<void> {
    if (
      !this.accepting ||
      this.owner?.disposed ||
      (this.owner && !state(this.owner).accepting)
    )
      return Promise.reject(new Error("History source is retiring"));
    const domain = this.owner ? state(this.owner) : undefined;
    if (this.failed || domain?.failure)
      return Promise.reject((this.failed ?? domain!.failure)!.error);
    this.count++;
    const work = (domain?.tail ?? this.tail).then(operation);
    this.tail = work;
    if (domain) domain.tail = work;
    // Observe without converting failure into success. Later accepted requests
    // fail with the same original error and cannot inverse the same old edge.
    void work.then(
      () => {
        this.count--;
        this.changed();
      },
      (error) => {
        this.failed ??= { error };
        if (domain) domain.failure ??= this.failed;
        this.count--;
        this.changed();
      },
    );
    this.changed();
    return work;
  }
  async flush() {
    while (true) {
      const captured = this.tail;
      await captured;
      if (captured === this.tail) return;
    }
  }
  async settled() {
    await this.tail.catch(() => {});
  }
  stop() {
    this.accepting = false;
  }
  async close() {
    this.stop();
    await this.flush();
    if (this.owner) {
      state(this.owner).queues.delete(this);
      this.changed();
    }
  }
}
