import { useEffect, useRef, useState } from "react";
import { desktop } from "../bridge";
import type {
  AssistantTarget,
  ComponentContextItem,
} from "../../components/assistant-context";
import type { CanvasReference } from "../../surface/agent-reference";
import { translator } from "../../i18n";
import persistMessages from "../../i18n/messages/assistantPersist";

const t = translator(persistMessages);

interface ComposerDraft {
  text: string;
  target: AssistantTarget | null;
  reference: CanvasReference | null;
  /** Component states handed over on pageId, sent with the next message. */
  components: ComponentContextItem[];
  pageId: string | null;
  updatedAt: number;
}
const empty: ComposerDraft = {
  text: "",
  target: null,
  reference: null,
  components: [],
  pageId: null,
  updatedAt: 0,
};
const storageKey = "showai:assistant-drafts:v1";
export function useAssistantDrafts(key: string) {
  const [drafts, setDrafts] = useState<Record<string, ComposerDraft>>(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return {};
    try {
      const values = JSON.parse(saved);
      return Object.fromEntries(
        Object.entries(values as Record<string, ComposerDraft>).filter(
          ([, value]) =>
            !!value &&
            typeof value === "object" &&
            typeof (value as ComposerDraft).text === "string",
        ),
      );
    } catch (error) {
      console.warn("Assistant message draft could not be read", error);
      return {};
    }
  });
  const [persistenceError, setPersistenceError] = useState("");
  const latest = useRef(drafts);
  latest.current = drafts;
  /** Writes the drafts; returns why that failed, or undefined when written. */
  const persist = () => {
    const entries = Object.entries(latest.current).sort(
      ([, a], [, b]) => b.updatedAt - a.updatedAt,
    );
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(Object.fromEntries(entries)),
      );
      setPersistenceError("");
      return undefined;
    } catch (error) {
      setPersistenceError(String(error));
      return String(error);
    }
  };
  useEffect(() => {
    const timer = setTimeout(persist, 150);
    return () => clearTimeout(timer);
  }, [drafts]);
  useEffect(() => {
    const stop = desktop.onBeforeClose(async () => {
      const error = persist();
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
    const pagehide = () => persist();
    window.addEventListener("pagehide", pagehide);
    return () => {
      stop();
      window.removeEventListener("pagehide", pagehide);
      persist();
    };
  }, []);
  // Drafts saved before a field existed take its empty value.
  const current = { ...empty, ...drafts[key] };
  const update = (patch: Partial<ComposerDraft>, capturedKey = key) =>
    setDrafts((before) => ({
      ...before,
      [capturedKey]: {
        ...(before[capturedKey] ?? empty),
        ...patch,
        updatedAt: Date.now(),
      },
    }));
  return {
    ...current,
    persistenceError,
    update,
    clear: (capturedKey = key, sentText?: string, sentAt?: number) =>
      setDrafts((before) => {
        if (sentText !== undefined && before[capturedKey]?.text !== sentText)
          return before;
        if (
          sentAt !== undefined &&
          (before[capturedKey]?.updatedAt ?? 0) !== sentAt
        )
          return before;
        const next = { ...before };
        delete next[capturedKey];
        return next;
      }),
  };
}
