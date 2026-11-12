import { useSyncExternalStore } from "react";
import { desktop } from "../../host/bridge";
import { translator } from "../../i18n";
import persistMessages from "../../i18n/messages/assistantPersist";
import { createDraftStore, type ComposerDraft } from "./draft-store";

const t = translator(persistMessages);
const store = createDraftStore(() => localStorage);

let detach: (() => void) | null = null;
/** Saves before the window closes while any Agent input is on screen. */
function attach() {
  const stop = desktop.onBeforeClose(async () => {
    const error = store.persist();
    return error === undefined
      ? true
      : {
          allow: false,
          blockers: [
            {
              code: "ASSISTANT_DRAFT_NOT_SAVED",
              source: "assistant",
              message: t("draftCloseBlocked", { error }),
            },
          ],
        };
  }, "assistant");
  const pagehide = () => store.persist();
  window.addEventListener("pagehide", pagehide);
  return () => {
    stop();
    window.removeEventListener("pagehide", pagehide);
  };
}
function subscribe(listener: () => void) {
  const stop = store.subscribe(listener);
  detach ??= attach();
  return () => {
    stop();
    if (store.listenerCount()) return;
    store.persist();
    detach?.();
    detach = null;
  };
}

export function useAssistantDrafts(key: string) {
  const snapshot = useSyncExternalStore(subscribe, store.getSnapshot);
  // Drafts saved before a field existed take its empty value.
  const current: ComposerDraft = store.draft(key);
  return {
    ...current,
    /** Whether anything was typed or picked for this key. */
    saved: key in snapshot.drafts,
    persistenceError: snapshot.error,
    update: (patch: Partial<ComposerDraft>, capturedKey = key) =>
      store.update(capturedKey, patch),
    clear: (capturedKey = key, sentText?: string, sentAt?: number) =>
      store.clear(capturedKey, sentText, sentAt),
  };
}
