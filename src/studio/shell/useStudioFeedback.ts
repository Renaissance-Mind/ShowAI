import { useCallback } from "react";
import {
  useProblemQueue,
  useToasts,
  type ReportOptions,
  type ToastOptions,
} from "../../problems";
import { useTranslator } from "../../i18n/react";
import navigationMessages from "../../i18n/messages/navigation";
import studioMessages from "../../i18n/messages/studio";
import { DraftHeld } from "./types";

export function useStudioFeedback() {
  const t = useTranslator(studioMessages);
  const tn = useTranslator(navigationMessages);
  const toasts = useToasts();
  const { show: showToast, clear: clearToasts } = toasts;
  const setNotice = useCallback(
    (message: string, options?: ToastOptions) => {
      if (message) showToast(message, options);
      else clearToasts();
    },
    [showToast, clearToasts],
  );
  const problemQueue = useProblemQueue();
  const notifyWithUndo = (message: string, run: () => Promise<unknown>) => {
    showToast(message, {
      kind: "success",
      duration: 10000,
      action: { label: tn("undo"), onSelect: () => void run().catch(report) },
    });
  };

  const { report: queueProblem, resolve: resolveProblem } = problemQueue;
  const report = useCallback(
    (error: unknown, options?: ReportOptions) => {
      if (error instanceof DraftHeld)
        showToast(error.message, { kind: "warning", duration: 6000 });
      else queueProblem(error, options);
    },
    [queueProblem, showToast],
  );
  function draftHeld(): false {
    report(new DraftHeld(t("resolveDraftFirst")));
    return false;
  }
  const action = (operation: () => Promise<unknown>) => () => {
    void operation().catch(report);
  };
  return {
    toasts,
    setNotice,
    problemQueue,
    notifyWithUndo,
    report,
    resolveProblem,
    draftHeld,
    action,
  };
}

export type StudioFeedback = ReturnType<typeof useStudioFeedback>;
