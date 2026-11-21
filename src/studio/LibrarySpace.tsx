import { useNotify } from "../problems/toast-context";
import settingsMessages from "../i18n/messages/settings";
import { useCallback, useEffect, useState } from "react";
import { CircleAlert, Loader2, RefreshCw } from "../ui/icons";
import { desktop, errorMessage } from "../host/bridge";
import Dialog from "../ui/Dialog";
import type {
  LibraryStorage,
  CleanupPlan,
  StorageCategory,
} from "../core/library-maintenance";
import type { IntegrityResult } from "../core/library-integrity";
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import common from "../i18n/messages/common";
import messages from "../i18n/messages/library";

function bytes(value: number) {
  if (value < 1024) return `${value.toLocaleString(getLocale())} B`;
  const unit = value >= 1024 ** 3 ? "GB" : value >= 1024 ** 2 ? "MB" : "KB",
    divisor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return `${(value / divisor).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} ${unit}`;
}

const KNOWN_INTEGRITY = new Set([
  "database",
  "content",
  "history",
  "repository",
  "unknown",
]);

export default function LibrarySpace({ home }: { home: string }) {
  const t = useTranslator(messages);
  const ts = useTranslator(settingsMessages);
  const tc = useTranslator(common);
  const [refreshing, setRefreshing] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivePending, setArchivePending] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const [storage, setStorage] = useState<LibraryStorage | null>(null);
  const notify = useNotify();
  const [plan, setPlan] = useState<CleanupPlan | null>(null),
    [busy, setBusy] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [showProjects, setShowProjects] = useState(false),
    [error, setError] = useState("");
  const [archivePath, setArchivePath] = useState("");
  const [integrity, setIntegrity] = useState<IntegrityResult | null>(null);
  const [integrityErrorOpen, setIntegrityErrorOpen] = useState(false);
  const refresh = useCallback(
    async (projects = false) => {
      setStorage(
        await desktop.invoke<LibraryStorage>("library:storage", { projects }),
      );
    },
    [home],
  );
  useEffect(() => {
    let active = true;
    void refresh().catch((reason) => {
      if (active) setError(errorMessage(reason));
    });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function run(action: () => Promise<void>, refreshAfter = true) {
    setBusy(true);
    setError("");
    try {
      await action();
      if (refreshAfter) await refresh(!!storage?.projects);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  function analyzeProjects() {
    setShowProjects(true);
    setAnalyzing(true);
    void run(() => refresh(true), false).finally(() => setAnalyzing(false));
  }
  const integrityProblemKey =
    integrity && !integrity.ok
      ? (`integrity.${KNOWN_INTEGRITY.has(integrity.problem) ? integrity.problem : "unknown"}` as Parameters<
          typeof t
        >[0])
      : undefined;
  return (
    <>
      <section
        className="settings-group library-space"
        aria-labelledby="settings-space-title"
      >
        <div className="settings-group-heading">
          <div>
            <h2 id="settings-space-title">{t("spaceManagement")}</h2>
          </div>
          <div className="library-space-actions">
            <button
              type="button"
              className="settings-button"
              disabled={busy || !storage}
              onClick={analyzeProjects}
            >
              {analyzing && <Loader2 size={14} className="studio-spin" />}
              {analyzing ? t("analyzingProjects") : t("analyzeProjects")}
            </button>
            <button
              type="button"
              className="settings-button"
              disabled={busy}
              aria-label={t("refreshStats")}
              onClick={() => {
                setRefreshing(true);
                void run(async () => {
                  await refresh(!!storage?.projects);
                  notify(t("storageRefreshed"));
                }, false).finally(() => setRefreshing(false));
              }}
            >
              <RefreshCw
                size={14}
                className={refreshing ? "studio-spin" : undefined}
                aria-hidden="true"
              />
              {t(refreshing ? "refreshingStats" : "refreshStats")}
            </button>
          </div>
        </div>

        <div className="settings-card">
          <div className="settings-card-section" aria-label={t("storage")}>
            {storage ? (
              <>
                <div className="library-space-metrics">
                  <div>
                    <span>{t("metric.totalSize")}</span>
                    <strong>{bytes(storage.totalBytes)}</strong>
                  </div>
                  <div>
                    <span>{t("metric.allocated")}</span>
                    <strong>{bytes(storage.allocatedBytes)}</strong>
                  </div>
                  <div>
                    <span>{t("metric.files")}</span>
                    <strong>
                      {t("fileCount", { count: storage.files })}
                    </strong>
                  </div>
                </div>
                <div className="library-space-breakdown">
                  {Object.entries(storage.categories)
                    .filter(([, item]) => item.files)
                    .map(([name, item]) => (
                      <div key={name}>
                        <span>{t(`category.${name as StorageCategory}`)}</span>
                        <span>{bytes(item.bytes)}</span>
                      </div>
                    ))}
                </div>
              </>
            ) : (
              <p className="library-space-summary">{t("checkingFiles")}</p>
            )}
          </div>

          <div className="settings-card-section" aria-label={t("maintenance")}>
            <div className="settings-row settings-row-compact">
              <div className="settings-row-text">
                <h3>{t("findCleanupTitle")}</h3>
                <p>{t("findCleanupDetail")}</p>
              </div>
              <button
                type="button"
                className="settings-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setPlan(
                      await desktop.invoke<CleanupPlan>("library:cleanupPlan"),
                    );
                  })
                }
              >
                {t("findCleanup")}
              </button>
            </div>
          </div>

          <div className="settings-card-section">
            <div className="settings-row settings-row-compact">
              <div className="settings-row-text">
                <h3>{t("checkIntegrityTitle")}</h3>
                <p
                  className={integrity?.ok ? "library-space-integrity-ok" : undefined}
                  role={integrity?.ok ? "status" : undefined}
                >
                  {integrity?.ok
                    ? t("integrity.ok", {
                        date: new Date(integrity.checkedAt).toLocaleString(
                          getLocale(),
                        ),
                      })
                    : t("checkIntegrityDetail")}
                </p>
              </div>
              <button
                type="button"
                className="settings-button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next =
                      await desktop.invoke<IntegrityResult>("library:integrity");
                    setIntegrity(next);
                    if (!next.ok) setIntegrityErrorOpen(true);
                  }, false)
                }
              >
                {t("checkIntegrity")}
              </button>
            </div>
          </div>

          <div
            className="settings-card-section"
            aria-labelledby="library-maintenance-tools"
          >
            <div className="settings-row settings-row-compact">
              <div className="settings-row-text">
                <h3 id="library-maintenance-tools">
                  {t("compactAndIndexTitle")}
                </h3>
                <p>{t("maintenanceEffects")}</p>
              </div>
              <div className="library-space-actions">
                <button
                  type="button"
                  className="settings-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await desktop.invoke<{
                        beforeBytes: number;
                        afterBytes: number;
                      }>("library:compact");
                      notify(
                        t("toast.compacted", {
                          before: bytes(result.beforeBytes),
                          after: bytes(result.afterBytes),
                        }),
                      );
                    })
                  }
                >
                  {t("compactNow")}
                </button>
                <button
                  type="button"
                  className="settings-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await desktop.invoke("library:rebuildIndex");
                      notify(t("toast.indexRebuilt"));
                    })
                  }
                >
                  {t("rebuildIndex")}
                </button>
              </div>
            </div>
          </div>

          {(storage?.maintenance?.state === "running" ||
            storage?.maintenance?.state === "failed" ||
            (error && !showProjects)) && (
            <div className="settings-card-section">
              {storage?.maintenance?.state === "running" && (
                <div className="settings-callout" role="status">
                  <Loader2 size={15} className="studio-spin" />
                  <span>{t("maintenanceRunning")}</span>
                </div>
              )}
              {storage?.maintenance?.state === "failed" && (
                <div
                  className="settings-callout"
                  data-tone="warn"
                  role="status"
                >
                  <span>
                    {t("maintenanceFailed", {
                      error: storage.maintenance.error ?? "",
                    })}
                  </span>
                </div>
              )}
              {error && !showProjects && (
                <div
                  className="settings-callout"
                  data-tone="error"
                  role="alert"
                >
                  <CircleAlert size={15} aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      <section
        className="settings-group"
        aria-labelledby="settings-backup-title"
      >
        <h2 id="settings-backup-title">{t("fullArchive")}</h2>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <h3>{t("archiveLocation")}</h3>
              <p>{t("fullArchiveDetail")}</p>
            </div>
            <button
              type="button"
              className="settings-button"
              disabled={busy}
              onClick={() => {
                setArchiveError("");
                setArchiveOpen(true);
              }}
            >
              {t("createBackup")}
            </button>
          </div>
        </div>
      </section>

      {plan && (
        <Dialog
          title={t("findCleanupTitle")}
          onClose={() => {
            if (!busy) setPlan(null);
          }}
        >
          <div className="studio-dialog-body studio-dialog-form">
            <div className="library-space-plan">
              <p className="library-space-plan-summary">
                {plan.files.length > 0
                  ? t("cleanupPlan", {
                      count: plan.files.length,
                      size: bytes(plan.bytes),
                      drafts: plan.protectedDrafts,
                      conflicts: plan.protectedConflicts,
                    })
                  : t("noCleanupNeeded")}
              </p>
              {plan.files.length > 0 && (
                <section aria-label={t("showCleanupFiles")}>
                  <h4 className="settings-section-heading">
                    {t("showCleanupFiles")}
                  </h4>
                  {plan.files.map((item) => (
                    <p key={item.path}>
                      <code>{item.path}</code>
                      <span>{bytes(item.bytes)}</span>
                    </p>
                  ))}
                </section>
              )}
            </div>
            <div className="studio-dialog-actions">
              <button
                type="button"
                className="settings-button"
                disabled={busy}
                onClick={() => setPlan(null)}
              >
                {t("dismissCleanupPlan")}
              </button>
              {plan.files.length > 0 && (
                <button
                  type="button"
                  className="settings-button settings-primary-button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await desktop.invoke("library:cleanup", {
                        id: plan.id,
                      });
                      setPlan(null);
                      notify(t("toast.cleaned"));
                    })
                  }
                >
                  {t("cleanUpFiles")}
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}

      {integrityErrorOpen && integrity && !integrity.ok && integrityProblemKey && (
        <Dialog
          tone="danger"
          title={t("checkIntegrityTitle")}
          onClose={() => setIntegrityErrorOpen(false)}
        >
          <div className="studio-dialog-body studio-dialog-form">
            <div className="library-space-integrity" role="alert">
              <div className="library-space-integrity-head">
                <CircleAlert size={16} aria-hidden="true" />
                <p>{t(integrityProblemKey)}</p>
              </div>
              {integrity.message && <code>{integrity.message}</code>}
            </div>
            <div className="studio-dialog-actions">
              <button
                type="button"
                className="settings-button"
                onClick={() =>
                  void desktop
                    .invoke("library:reveal", { path: "." })
                    .catch((reason) => setError(errorMessage(reason)))
                }
              >
                {t("integrity.reveal")}
              </button>
              <button
                type="button"
                className="settings-button"
                onClick={() =>
                  void desktop
                    .invoke("clipboard:write", {
                      text: `${t(integrityProblemKey)}\n${integrity.message}\n${home}\n${integrity.checkedAt}`,
                    })
                    .then(() => notify(t("integrity.copied")))
                    .catch((reason) => setError(errorMessage(reason)))
                }
              >
                {t("integrity.copy")}
              </button>
              <button
                type="button"
                className="settings-button settings-primary-button"
                onClick={() => setIntegrityErrorOpen(false)}
              >
                {tc("done")}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {archiveOpen && (
        <Dialog
          title={t("fullArchive")}
          onClose={() => {
            if (!archivePending) setArchiveOpen(false);
          }}
        >
          <form
            className="studio-dialog-body studio-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!archivePath.trim() || archivePending || busy) return;
              setArchiveError("");
              setArchivePending(true);
              void run(async () => {
                const result = await desktop
                  .invoke<{ path: string }>("library:archive", {
                    out: archivePath.trim(),
                  })
                  .catch((reason) => {
                    setArchiveError(errorMessage(reason));
                    return null;
                  });
                if (result) {
                  setArchiveOpen(false);
                  notify(t("toast.archived", { path: result.path }));
                }
              }, false).finally(() => setArchivePending(false));
            }}
          >
            <p className="settings-help">{t("fullArchiveDetail")}</p>
            <div className="library-space-archive">
              <input
                className="showai-input"
                aria-label={t("archiveLocation")}
                placeholder={t("archivePlaceholder")}
                value={archivePath}
                autoFocus
                aria-invalid={!!archiveError}
                aria-describedby={
                  archiveError ? "library-backup-error" : undefined
                }
                onChange={(event) => {
                  setArchivePath(event.target.value);
                  setArchiveError("");
                }}
              />
              <button
                className="settings-button"
                type="button"
                disabled={busy || archivePending}
                onClick={() =>
                  void desktop
                    .invoke<string | null>("settings:chooseFolder")
                    .then(
                      (folder) => {
                        if (folder)
                          setArchivePath(
                            folder.replace(/[/\\]$/, "") +
                              "/ShowAI-backup-" +
                              new Date().toISOString().replace(/[:.]/g, "-"),
                          );
                        setArchiveError("");
                      },
                      (reason) => setArchiveError(errorMessage(reason)),
                    )
                }
              >
                {ts("chooseFolder")}
              </button>
            </div>
            {archiveError && (
              <p
                id="library-backup-error"
                className="studio-form-error"
                role="alert"
              >
                {archiveError}
              </p>
            )}
            <div className="studio-dialog-actions">
              <button
                type="button"
                className="settings-button"
                disabled={archivePending}
                onClick={() => setArchiveOpen(false)}
              >
                {tc("cancel")}
              </button>
              <button
                type="submit"
                className="settings-button settings-primary-button"
                disabled={busy || archivePending || !archivePath.trim()}
              >
                {archivePending && (
                  <Loader2
                    size={14}
                    className="studio-spin"
                    aria-hidden="true"
                  />
                )}
                {t(archivePending ? "archiving" : "saveArchive")}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {showProjects && (
        <Dialog
          title={t("projectStorage")}
          wide
          className="library-project-space-dialog"
          onClose={() => setShowProjects(false)}
        >
          <div className="library-project-space-content" aria-busy={analyzing}>
            <div className="library-space-actions">
              <button
                type="button"
                className="settings-button"
                disabled={busy}
                onClick={analyzeProjects}
              >
                {analyzing ? (
                  <Loader2 size={14} className="studio-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {analyzing ? t("analyzing") : t("analyzeAgain")}
              </button>
              {analyzing && (
                <p className="settings-help" role="status">
                  {t("checkingProjects")}
                </p>
              )}
            </div>
            {storage?.projects && (
              <section
                className="library-project-space"
                aria-label={t("projectUsage")}
              >
                <p className="settings-help" role="status">
                  {t("projectsSummary", {
                    count: storage.projects.items.length,
                  })}
                </p>
                {storage.projects.items.length ? (
                  <div className="library-project-space-table">
                    <table>
                      <caption className="settings-sr-only">
                        {t("tableCaption")}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{t("column.project")}</th>
                          <th scope="col">{t("column.size")}</th>
                          <th scope="col">{t("column.allocated")}</th>
                          <th scope="col">{t("column.files")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {storage.projects.items.map((project) => (
                          <tr key={project.id}>
                            <th scope="row">
                              {project.name}
                              {project.archived && (
                                <small>{t("archived")}</small>
                              )}
                              {project.retained && (
                                <small>{t("retained")}</small>
                              )}
                            </th>
                            <td>{bytes(project.bytes)}</td>
                            <td>{bytes(project.allocatedBytes)}</td>
                            <td>{project.files.toLocaleString(getLocale())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="settings-help">{t("noProjects")}</p>
                )}
                <p className="settings-help">
                  {t("sharedStorage", {
                    size: bytes(storage.projects.shared.bytes),
                    allocated: bytes(storage.projects.shared.allocatedBytes),
                  })}
                </p>
                <p className="settings-help">
                  {t("measuredAt", {
                    date: new Date(storage.measuredAt).toLocaleString(
                      getLocale(),
                    ),
                  })}
                </p>
              </section>
            )}
            {error && (
              <p className="studio-form-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
