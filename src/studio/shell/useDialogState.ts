import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioFeedback } from "./useStudioFeedback";
import type { RouteState } from "./useRouteState";
import type { DialogState, PageState } from "./types";

/** The one workbench dialog that is open, if any. */
export function useDialogState() {
  const [dialog, setDialog] = useState<DialogState>(null);
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;
  const closeDialog = useCallback(() => setDialog(null), []);
  return { dialog, setDialog, dialogRef, closeDialog };
}

export type DialogControl = ReturnType<typeof useDialogState>;

/**
 * A save that fails on a conflict opens its comparison dialog once; dismissing
 * that dialog keeps the edits in the local draft until the next failure.
 */
export function useSaveConflictDialog({
  route: { view, selectedProject },
  page,
  dialogs: { setDialog, closeDialog },
  feedback: { report },
}: {
  route: Pick<RouteState, "view" | "selectedProject">;
  page: PageState;
  dialogs: Pick<DialogControl, "setDialog" | "closeDialog">;
  feedback: Pick<StudioFeedback, "report">;
}) {
  const shownSaveFailure = useRef("");
  // A conflict the person dismissed stays closed (its banner remains) until a
  // later save attempt fails again or another conflict appears.
  const deferredSaveFailure = useRef("");
  const saveFailureIdentity = () =>
    JSON.stringify([
      selectedProject,
      page.draft?.id,
      page.conflictId,
      page.saveFailureAttempt,
    ]);
  useEffect(() => {
    if (
      view !== "page" ||
      page.status !== "conflict" ||
      page.reviewingConflict ||
      !page.draft ||
      !selectedProject
    )
      return;
    const key = JSON.stringify([
      selectedProject,
      page.draft.id,
      page.conflictId,
      page.mergeBase,
      page.error,
      page.saveFailureAttempt,
    ]);
    if (
      shownSaveFailure.current === key ||
      deferredSaveFailure.current === saveFailureIdentity()
    )
      return;
    shownSaveFailure.current = key;
    if (page.conflictId)
      setDialog({
        type: "externalConflict",
        id: page.conflictId,
        saveFailure: true,
      });
    else if (page.mergeBase)
      setDialog({
        type: "merge",
        projectId: selectedProject,
        document: structuredClone(page.draft),
        baseRevision: page.mergeBase,
        saveFailure: true,
      });
  }, [
    view,
    selectedProject,
    page.status,
    page.reviewingConflict,
    page.draft,
    page.conflictId,
    page.mergeBase,
    page.error,
    page.saveFailureAttempt,
  ]);
  // Dismissing a conflict dialog defers the decision: the unsaved edits stay
  // in the local draft and the save-conflict banner reopens the dialog.
  const deferConflict = () => {
    deferredSaveFailure.current = saveFailureIdentity();
    closeDialog();
    void page
      .retainDraft()
      .catch((error: unknown) => report(error, { safety: "windowOnly" }));
  };
  return { deferConflict };
}
