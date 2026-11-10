import { useCallback, useState, type SetStateAction } from "react";

/**
 * Form drafts that outlive their section for the rest of the App session.
 * They stay in memory only, since some hold API keys, and are never written
 * to browser storage or disk.
 */
const drafts = new Map<string, unknown>();

export function readSessionDraft<T>(id: string, initial: T): T {
  return drafts.has(id) ? (drafts.get(id) as T) : initial;
}
export function writeSessionDraft<T>(id: string, value: T) {
  drafts.set(id, value);
}
/**
 * Changes a draft, also after its component unmounted, e.g. a save that
 * finishes once the user has left Settings still clears the form.
 */
export function updateSessionDraft<T>(
  id: string,
  initial: T,
  next: SetStateAction<T>,
): T {
  const value =
    typeof next === "function"
      ? (next as (before: T) => T)(readSessionDraft(id, initial))
      : next;
  drafts.set(id, value);
  return value;
}

/** useState whose value is kept under id while the component is away. */
export function useSessionDraft<T>(id: string, initial: T) {
  const [value, setValue] = useState<T>(() => readSessionDraft(id, initial));
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setValue(updateSessionDraft(id, initial, next)),
    // The initial value only matters before the first write.
    [id],
  );
  return [value, set] as const;
}
