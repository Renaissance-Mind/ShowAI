import { useEffect, useState } from "react";
import { Check, X } from "../../ui/icons";
import { desktop } from "../../host/bridge";
import { getLocale } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import commonMessages from "../../i18n/messages/common";
import pageSessionMessages from "../../i18n/messages/pageSession";
import studioMessages from "../../i18n/messages/studio";
import syncMessages from "../../i18n/messages/sync";
import {
  NoticeStack,
  ProblemNotice,
  bindProblemActions,
  describeError,
  revealLabel,
} from "../../problems";
import { SaveFailureBanner } from "../SaveProblem";
import { largestBlock } from "../save-problem";
import { ExternalChangeNotice, locateBlocks } from "../ExternalChangeNotice";
import { authorName } from "../external-change";
import type { StudioFeedback } from "./useStudioFeedback";
import type { LibraryState } from "./useLibraryState";
import type { RouteState } from "./useRouteState";
import type { DialogControl } from "./useDialogState";
import type { DirectoryState } from "./useDirectory";
import type { StudioRouter } from "./useStudioRouter";
import type { PageActions } from "./usePageActions";
import type { PageState } from "./types";

/** External edits are listed only while some are waiting for a decision. */
export function useExternalChangeCount({
  available,
  dialogOpen,
  home,
}: {
  available: boolean;
  dialogOpen: boolean;
  home: string | undefined;
}) {
  const [externalChangeCount, setExternalChangeCount] = useState(0);
  useEffect(() => {
    if (!available || dialogOpen) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      void desktop.invoke<unknown[]>("workspace:conflicts").then(
        (items) => {
          if (active) setExternalChangeCount(items.length);
        },
        (error) => console.error("Could not read external file changes", error),
      );
    load();
    const unsubscribe = desktop.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 600);
    });
    window.addEventListener("focus", load);
    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      window.removeEventListener("focus", load);
    };
  }, [available, dialogOpen, home]);
  return externalChangeCount;
}

/**
 * Notices above the content: problems, sync and read-only states, unreadable
 * projects, save failures and conflicts, and the outline of an external edit.
 */
export function StudioNotices({
  feedback: { problemQueue, setNotice, report, action },
  library: {
    info,
    capabilities,
    projects,
    unreadableProjects,
    dismissedUnreadable,
    setDismissedUnreadable,
    syncOverview,
  },
  route: {
    view,
    selectedProject,
    setSettingsSection,
    setSyncRequest,
    catalogScrollRef,
  },
  dialogs: { setDialog },
  directory: { syncReadOnly, project },
  router: { navigate, openPage, locateAssistantTarget },
  pageActions: { runSaveLocalCopy, keepDraftAsCopy },
  page,
  externalChange,
}: {
  feedback: StudioFeedback;
  library: LibraryState;
  route: RouteState;
  dialogs: DialogControl;
  directory: DirectoryState;
  router: StudioRouter;
  pageActions: PageActions;
  page: PageState;
  externalChange: PageState["externalChange"] | undefined;
}) {
  const t = useTranslator(studioMessages);
  const ts = useTranslator(syncMessages);
  const tps = useTranslator(pageSessionMessages);
  return (
    <>
      <NoticeStack>
        {problemQueue.problems.map((entry) => (
          <ProblemNotice
            key={`problem-${entry.id}`}
            data-priority={3}
            problem={entry.problem}
            count={entry.count}
            reportable={entry.problem.code !== "LOCKED"}
            actions={bindProblemActions(entry.problem.actions, {
              // Repeating the operation replaces this notice.
              ...Object.fromEntries(
                Object.entries({ ...entry.handlers, retry: entry.retry })
                  .filter(([, handler]) => handler)
                  .map(([id, handler]) => [
                    id,
                    () => {
                      problemQueue.dismiss(entry.id);
                      handler!();
                    },
                  ]),
              ),
              reload: () => window.location.reload(),
              librarySpace: capabilities.manageLibrary
                ? () => {
                    setSettingsSection("general");
                    void navigate("settings").catch(report);
                  }
                : undefined,
            })}
            onDismiss={() => problemQueue.dismiss(entry.id)}
          />
        ))}
        {syncOverview.expired.map((entry) => (
          <div
            key={`expired-${entry.connectionId}`}
            className="studio-conflict"
            role="alert"
            data-priority={3}
          >
            <div>
              <strong>{ts("loginExpired.title")}</strong>
              <p>
                {ts("loginExpired.body", {
                  names: entry.projectIds
                    .map(
                      (id) =>
                        `「${projects.find((item) => item.id === id)?.name ?? id}」`,
                    )
                    .join(""),
                })}
              </p>
            </div>
            <button
              onClick={action(async () => {
                setSyncRequest({
                  projectId: entry.projectIds[0],
                  intent: "signIn",
                  key: Date.now(),
                });
                setSettingsSection("sync");
                await navigate("settings");
              })}
            >
              {ts("loginExpired.action")}
            </button>
          </div>
        ))}
        {(view === "page" || view === "project") &&
          selectedProject &&
          syncReadOnly && (
            <div className="studio-conflict" role="status" data-priority={2}>
              <p>
                {ts(
                  syncOverview.bindings.get(selectedProject)?.status ===
                    "revoked"
                    ? "readOnly.revokedBanner"
                    : "readOnly.banner",
                  { name: project?.name ?? "" },
                )}
              </p>
              {view === "page" && page.draft && (
                <button onClick={runSaveLocalCopy}>
                  {ts("readOnly.copy")}
                </button>
              )}
            </div>
          )}
        {unreadableProjects
          .filter((item) => !dismissedUnreadable.includes(item.directory))
          .map((item) => (
            <div
              key={`unreadable-${item.directory}`}
              id={`unreadable-${item.directory}`}
              tabIndex={-1}
              data-priority={2}
            >
              <ProblemNotice
                problem={{
                  ...describeError(item, {
                    action: t("readProject"),
                    object: item.directory,
                  }),
                  title: t("unreadableProject", { name: item.directory }),
                  cause: t("unreadableProjectCause"),
                }}
                tone="warning"
                actions={[
                  {
                    label: revealLabel(info?.platform),
                    onSelect: () =>
                      void desktop
                        .invoke("library:reveal", { path: item.path })
                        .catch(report),
                  },
                ]}
                onDismiss={() =>
                  setDismissedUnreadable((current) => [
                    ...current,
                    item.directory,
                  ])
                }
              />
            </div>
          ))}
        {page.backgroundIssues
          .filter((issue) => issue.kind === "retire")
          .map((issue) => (
            <div
              key={`retire-${issue.projectId}:${issue.pageId}`}
              className="studio-conflict"
              role="alert"
              data-priority={3}
            >
              <div>
                <strong>{t("retireIssueTitle", { title: issue.title })}</strong>
                <p>{t("retireIssueBody", { error: issue.error })}</p>
              </div>
              <button
                onClick={action(() => openPage(issue.pageId, issue.projectId))}
              >
                {t("openPageAgain")}
              </button>
            </div>
          ))}
        {page.backgroundIssues.some((issue) => issue.kind !== "retire") && (
          <div className="studio-conflict" role="alert" data-priority={3}>
            <p>{t("backgroundSaveIssue")}</p>
            {page.backgroundIssues
              .filter((issue) => issue.kind !== "retire")
              .map((issue) => (
                <button
                  key={`${issue.projectId}:${issue.pageId}`}
                  onClick={action(() =>
                    openPage(issue.pageId, issue.projectId),
                  )}
                >
                  {t("viewIssue", { title: issue.title })}
                </button>
              ))}
          </div>
        )}
        {view === "page" && page.draftNotice && !page.error && (
          <div className="studio-conflict" role="status" data-priority={1}>
            <p>{page.draftNotice}</p>
          </div>
        )}
        {view === "page" && !!page.record?.retainedSyncConflicts?.length && (
          <div className="studio-conflict" role="status" data-priority={2}>
            <p>{t("retainedSyncConflict")}</p>
            {page.record.retainedSyncConflicts
              .flatMap((item) => item.variants)
              .filter((variant) => variant.pageId !== page.draft?.id)
              .map((variant) => (
                <button
                  key={variant.pageId}
                  onClick={action(() => openPage(variant.pageId))}
                >
                  {t("viewOtherVariant", {
                    account: variant.source.account,
                    device: variant.source.deviceId.slice(0, 8),
                  })}
                </button>
              ))}
          </div>
        )}
        {view === "page" && page.error && page.status !== "conflict" && (
          <SaveFailureBanner
            data-priority={4}
            state={{
              error: page.error,
              failure: page.failure,
              dirty: page.dirty,
              draftDurable: page.draftDurable,
              title: page.draft?.title,
            }}
            platform={info?.platform}
            onRetry={action(page.retry)}
            onKeepCopy={action(keepDraftAsCopy)}
            onLibrarySpace={
              capabilities.manageLibrary
                ? () => {
                    setSettingsSection("general");
                    void navigate("settings").catch(report);
                  }
                : undefined
            }
            onReveal={(path) =>
              void desktop.invoke("library:reveal", { path }).catch(report)
            }
            onLocateLargest={() => {
              const id = largestBlock(page.draft?.content);
              if (id && page.draft)
                void locateAssistantTarget(page.draft.id, [id]);
            }}
            // Without unsaved edits, loading the file loses nothing.
            onDiscard={
              page.dirty
                ? () => setDialog({ type: "discardDraft" })
                : action(page.acceptResolution)
            }
          />
        )}
        {view === "page" && page.error && page.status === "conflict" && (
          <div
            className="studio-conflict studio-save-conflict"
            role="alert"
            tabIndex={-1}
            data-priority={4}
          >
            <div>
              <strong>{t("saveConflictTitle")}</strong>
              <p>{page.error}</p>
            </div>
            <>
              {page.reviewingConflict && (
                <button onClick={action(page.retry)}>{t("saveAgain")}</button>
              )}
              {page.conflictId ? (
                <button
                  onClick={action(async () => {
                    await page.retainDraft();
                    setDialog({
                      type: "externalConflict",
                      id: page.conflictId!,
                    });
                  })}
                >
                  {t("resolveExternal")}
                </button>
              ) : page.mergeBase && page.draft && selectedProject ? (
                <button
                  onClick={action(async () => {
                    await page.retainDraft();
                    setDialog({
                      type: "merge",
                      projectId: selectedProject,
                      document: structuredClone(page.draft!),
                      baseRevision: page.mergeBase!,
                    });
                  })}
                >
                  {t("compareAndMerge")}
                </button>
              ) : (
                <button onClick={action(keepDraftAsCopy)}>
                  {t("keepAsCopy")}
                </button>
              )}
              <button
                className="is-destructive"
                onClick={() => setDialog({ type: "discardDraft" })}
              >
                {t("discardAndLoad")}
              </button>
            </>
          </div>
        )}
        {view === "page" && !!page.availableDrafts.length && (
          <div className="studio-conflict" role="status" data-priority={2}>
            <p>{t("draftsAvailable")}</p>
            {page.availableDrafts.map((item) => (
              <button
                key={item.id}
                onClick={action(() => page.recoverDraft(item.id))}
              >
                {t("restoreDraft", {
                  time: new Date(item.savedAt).toLocaleString(getLocale()),
                })}
              </button>
            ))}
          </div>
        )}
      </NoticeStack>
      {externalChange && (
        <ExternalChangeNotice
          key={`external-${externalChange.id}`}
          change={externalChange}
          onLocate={() =>
            locateBlocks(catalogScrollRef.current, externalChange.blockIds)
          }
          onUndo={action(async () => {
            const name = authorName(externalChange.author);
            const outcome = await page.undoExternalChange();
            if (outcome === "merged")
              setNotice(tps("external.undone", { name }), {
                kind: "success",
              });
            else if (outcome === "conflict")
              setNotice(tps("external.undoConflict"), { kind: "warning" });
          })}
          onDismiss={action(page.dismissExternalChange)}
        />
      )}
    </>
  );
}

/** Where an export was saved, with a way to show it in the file manager. */
export function ExportReceipt({
  feedback: { action },
  library: { info, capabilities },
  pageActions: { exportReceipt, setExportReceipt },
}: {
  feedback: StudioFeedback;
  library: LibraryState;
  pageActions: PageActions;
}) {
  const tc = useTranslator(commonMessages);
  return (
    exportReceipt && (
      <div className="studio-toast studio-export-receipt" role="status">
        <Check size={14} />
        <span className="studio-export-receipt-text">
          <span>{exportReceipt.message}</span>
          <code title={exportReceipt.path}>{exportReceipt.path}</code>
        </span>
        {capabilities.revealFiles && (
          <button
            type="button"
            onClick={action(async () => {
              await desktop.invoke("export:reveal", {
                path: exportReceipt.path,
              });
              setExportReceipt(null);
            })}
          >
            {revealLabel(info?.platform)}
          </button>
        )}
        <button
          type="button"
          className="studio-export-receipt-close"
          aria-label={tc("close")}
          onClick={() => setExportReceipt(null)}
        >
          <X size={14} />
        </button>
      </div>
    )
  );
}
