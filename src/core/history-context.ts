import { AsyncLocalStorage } from "node:async_hooks";
import type { ChangeContext, FileChanges } from "./history-model";

export interface LibraryMutation {
  root: string;
  head: string | null;
  changes: FileChanges;
  expected: Map<string, string | null>;
  origins?: Pick<
    ChangeContext,
    "restoredFrom" | "mergedFrom" | "externalConflictId" | "restoredSnapshot"
  >;
}
const actors = new AsyncLocalStorage<ChangeContext>();
export const libraryMutations = new AsyncLocalStorage<LibraryMutation>();
/** Serializes legacy writers with the one-time activation barrier. */
export const legacyMutations = new AsyncLocalStorage<string>();

export function changeContext(): ChangeContext {
  return actors.getStore() ?? { actor: { kind: "unknown" }, channel: "system" };
}
export function withChangeContext<T>(
  context: ChangeContext,
  action: () => T,
): T {
  return actors.run(context, action);
}
