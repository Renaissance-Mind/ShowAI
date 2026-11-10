import type {
  AssistantTarget,
  ComponentContextItem,
} from "../../components/assistant-context";
import type { CanvasReference } from "../../surface/agent-reference";

export interface ComposerDraft {
  text: string;
  target: AssistantTarget | null;
  reference: CanvasReference | null;
  /** Component states handed over on pageId, sent with the next message. */
  components: ComponentContextItem[];
  pageId: string | null;
  updatedAt: number;
}
export const emptyDraft: ComposerDraft = {
  text: "",
  target: null,
  reference: null,
  components: [],
  pageId: null,
  updatedAt: 0,
};
export interface DraftSnapshot {
  drafts: Record<string, ComposerDraft>;
  error: string;
}
export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const draftStorageKey = "showai:assistant-drafts:v1";
/** Floating requests leave one draft per target; the oldest beyond this are dropped. */
export const draftLimit = 100;

function hash(text: string) {
  let value = 5381;
  for (let index = 0; index < text.length; index++)
    value = ((value << 5) + value + text.charCodeAt(index)) | 0;
  return (value >>> 0).toString(36);
}

/** The floating request box keeps one draft per project, page and target. */
export function composerDraftKey(
  projectId: string | null,
  pageId: string | null,
  target: AssistantTarget,
) {
  const blocks = "blockIds" in target ? target.blockIds.join(",") : "";
  const text = "text" in target && target.text ? hash(target.text) : "";
  const prompt = "prompt" in target && target.prompt ? hash(target.prompt) : "";
  return `${projectId ?? ""}/composer/${pageId ?? ""}/${target.kind}/${blocks}/${text}/${prompt}`;
}

/**
 * One store for every Agent input in the window, so the side panel and the
 * floating request box read and write the same drafts and storage entry.
 */
export function createDraftStore(
  storage: () => DraftStorage,
  { limit = draftLimit, delay = 150 } = {},
) {
  let snapshot: DraftSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  const read = (): Record<string, ComposerDraft> => {
    const saved = storage().getItem(draftStorageKey);
    if (!saved) return {};
    try {
      const values = JSON.parse(saved) as Record<string, ComposerDraft>;
      return Object.fromEntries(
        Object.entries(values).filter(
          ([, value]) =>
            !!value && typeof value === "object" && typeof value.text === "string",
        ),
      );
    } catch (error) {
      console.warn("Assistant message draft could not be read", error);
      return {};
    }
  };
  const get = () => (snapshot ??= { drafts: read(), error: "" });
  const publish = (next: DraftSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  /** Writes the drafts; returns why that failed, or undefined when written. */
  const persist = () => {
    clearTimeout(timer);
    timer = undefined;
    const current = get();
    const entries = Object.entries(current.drafts)
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
    let error = "";
    try {
      storage().setItem(
        draftStorageKey,
        JSON.stringify(Object.fromEntries(entries)),
      );
    } catch (reason) {
      error = String(reason);
    }
    const kept =
      entries.length === Object.keys(current.drafts).length
        ? current.drafts
        : Object.fromEntries(entries);
    if (error !== current.error || kept !== current.drafts)
      publish({ drafts: kept, error });
    return error || undefined;
  };
  const change = (
    edit: (drafts: Record<string, ComposerDraft>) => Record<string, ComposerDraft>,
  ) => {
    const current = get();
    const drafts = edit(current.drafts);
    if (drafts === current.drafts) return;
    publish({ ...current, drafts });
    clearTimeout(timer);
    timer = setTimeout(persist, delay);
  };
  return {
    getSnapshot: get,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listenerCount: () => listeners.size,
    persist,
    draft: (key: string): ComposerDraft => ({ ...emptyDraft, ...get().drafts[key] }),
    has: (key: string) => key in get().drafts,
    update(key: string, patch: Partial<ComposerDraft>) {
      change((before) => ({
        ...before,
        [key]: { ...(before[key] ?? emptyDraft), ...patch, updatedAt: Date.now() },
      }));
    },
    /** With sentText or sentAt, clears only while the draft is still what was sent. */
    clear(key: string, sentText?: string, sentAt?: number) {
      change((before) => {
        if (!(key in before)) return before;
        if (sentText !== undefined && before[key].text !== sentText)
          return before;
        if (sentAt !== undefined && before[key].updatedAt !== sentAt)
          return before;
        const next = { ...before };
        delete next[key];
        return next;
      });
    },
  };
}
export type DraftStore = ReturnType<typeof createDraftStore>;
