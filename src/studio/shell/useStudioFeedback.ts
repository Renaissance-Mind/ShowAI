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

/** Toasts, the problem queue and the helpers every workbench action reports through. */
export function useStudioFeedback() {
  const t = useTranslator(studioMessages);
  const tn = useTranslator(navigationMessages);
  const toasts = useToasts();
  const { show: showToast, clear: clearToasts } = toasts;
  /** L1 toast; an empty message clears transient toasts. */
  const setNotice = useCallback(
    (message: string, options?: ToastOptions) => {
      if (message) showToast(message, options);
      else clearToasts();
    },
    [showToast, clearToasts],
  );
  const problemQueue = useProblemQueue();
  // Undoable notices: the toast carries a 撤销 action and stays 10 s.
  const notifyWithUndo = (message: string, run: () => Promise<unknown>) => {
    showToast(message, {
      kind: "success",
      duration: 10000,
      action: { label: tn("undo"), onSelect: () => void run().catch(report) },
    });
  };

  const { report: queueProblem, resolve: resolveProblem } = problemQueue;
  /**
   * Shows a failed operation in the problem queue. Pass the operation name
   * (`{ action: te("op.exportSite") }`) so the title says what failed; a
   * later success of the same operation clears it via resolveProblem.
   */
  const report = useCallback(
    (error: unknown, options?: ReportOptions) => {
      // An action refused over an unresolved draft answers next to the action;
      // the conflict banner already holds the notice stack.
      if (error instanceof DraftHeld)
        showToast(error.message, { kind: "warning", duration: 6000 });
      else queueProblem(error, options);
    },
    [queueProblem, showToast],
  );
  /** A page that could not keep its edits holds navigation; say so instead of doing nothing. */
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
