import { useCallback, useState, type SetStateAction } from "react";

const drafts = new Map<string, unknown>();

export function readSessionDraft<T>(id: string, initial: T): T {
  return drafts.has(id) ? (drafts.get(id) as T) : initial;
}
export function writeSessionDraft<T>(id: string, value: T) {
  drafts.set(id, value);
}
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

export function useSessionDraft<T>(id: string, initial: T) {
  const [value, setValue] = useState<T>(() => readSessionDraft(id, initial));
  const set = useCallback(
    (next: SetStateAction<T>) =>
      setValue(updateSessionDraft(id, initial, next)),
    [id],
  );
  return [value, set] as const;
}
