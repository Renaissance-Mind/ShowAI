import { useSyncExternalStore } from "react";
import type { LocatedThread } from "../core/comments";
import type { CommentAuthor, PageComment } from "../types";

/** What a mounted page editor offers the comments panel and its toggle. */
export interface PageCommentsController {
  documentId: string;
  readOnly: boolean;
  author: CommentAuthor;
  threads(): LocatedThread[];
  change(update: (comments: PageComment[]) => PageComment[]): void;
  /** Scroll to the thread's anchor and flash it. */
  reveal(threadId: string): void;
}

interface State {
  open: boolean;
  filter: "open" | "resolved";
  active: string | null;
  controllers: Map<string, PageCommentsController>;
  version: number;
}

let state: State = {
  open: false,
  filter: "open",
  active: null,
  controllers: new Map(),
  version: 0,
};
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch, version: state.version + 1 };
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const commentsStore = {
  get: () => state,
  subscribe,
  setOpen: (open: boolean) => set({ open }),
  setFilter: (filter: State["filter"]) => set({ filter }),
  setActive: (active: string | null) => {
    if (state.active !== active) set({ active });
  },
  register(controller: PageCommentsController) {
    const controllers = new Map(state.controllers);
    controllers.set(controller.documentId, controller);
    set({ controllers });
    return () => {
      if (state.controllers.get(controller.documentId) !== controller) return;
      const next = new Map(state.controllers);
      next.delete(controller.documentId);
      set({ controllers: next });
    };
  },
  /** The page's comments changed (an edit, an undo, a save from elsewhere). */
  changed: () => set({}),
};

export function useCommentsStore() {
  return useSyncExternalStore(subscribe, commentsStore.get);
}
