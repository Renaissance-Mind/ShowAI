import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import Dialog from "./Dialog";
import type {
  LibraryStorage,
  CleanupPlan,
  StorageCategory,
} from "../core/library-maintenance";
import type { MaintenancePolicy } from "../core/maintenance-scheduler";
import { getLocale } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/library";
function bytes(value: number) {
  if (value < 1024) return `${value.toLocaleString(getLocale())} B`;
  const unit = value >= 1024 ** 3 ? "GB" : value >= 1024 ** 2 ? "MB" : "KB",
    divisor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return `${(value / divisor).toLocaleString(getLocale(), { maximumFractionDigits: 1 })} ${unit}`;
}
export default function LibrarySpace({ home }: { home: string }) {
  const t = useTranslator(messages);
  const [storage, setStorage] = useState<LibraryStorage | null>(null),
    [policy, setPolicy] = useState<MaintenancePolicy | null>(null);
  const [plan, setPlan] = useState<CleanupPlan | null>(null),
    [busy, setBusy] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
    [showProjects, setShowProjects] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [archivePath, setArchivePath] = useState("");
  const refresh = useCallback(
    async (projects = false) => {
      const [stats, rules] = await Promise.all([
        desktop.invoke<LibraryStorage>("library:storage", { projects }),
        desktop.invoke<MaintenancePolicy>("library:maintenancePolicy"),
      ]);
      setStorage(stats);
      setPolicy(rules);
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
    setNotice("");
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
  return (
    <section
      className="settings-group library-space"
      aria-label={t("spaceManagement")}
    >
      <section className="library-space-section" aria-label={t("storage")}>
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>{t("storage")}</h3>
          </div>
          <div className="library-space-actions">
            <button
              className="settings-button"
              disabled={busy || !storage}
              onClick={analyzeProjects}
            >
              {analyzing && <Loader2 size={14} className="studio-spin" />}
              {analyzing ? t("analyzingProjects") : t("analyzeProjects")}
            </button>
            <button
              className="settings-button settings-button-icon"
              disabled={busy}
              aria-label={t("refreshStats")}
              title={t("refreshStats")}
              onClick={() => void run(async () => {})}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <div className="library-space-section-content">
          <p className="library-space-summary">
            {storage
              ? t("summary", {
                  size: bytes(storage.totalBytes),
                  allocated: bytes(storage.allocatedBytes),
                  count: storage.files.toLocaleString(getLocale()),
                })
              : t("checkingFiles")}
          </p>
          {storage && (
            <div className="library-space-breakdown">
              {Object.entries(storage.categories)
                .filter(([, item]) => item.files)
                .map(([name, item]) => (
                  <div key={name}>
                    <span>{t(`category.${name as StorageCategory}`)}</span>
                    <span>{bytes(item.bytes)}</span>
                  </div>
                ))}
              <p>
                {t("gitSummary", {
                  packs: storage.git.packs.toLocaleString(getLocale()),
                  objects: storage.git.looseObjects.toLocaleString(getLocale()),
                })}
              </p>
            </div>
          )}
        </div>
      </section>
      <section className="library-space-section" aria-label={t("autoCompact")}>
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>{t("autoCompact")}</h3>
          </div>
          <label className="library-space-toggle">
            <input
              type="checkbox"
              aria-label={t("autoCompactLabel")}
              checked={policy?.automatic ?? true}
              disabled={!policy || busy}
              onChange={(event) =>
                void run(async () => {
                  setPolicy(
                    await desktop.invoke<MaintenancePolicy>(
                      "library:setMaintenancePolicy",
                      { automatic: event.target.checked },
                    ),
                  );
                })
              }
            />
            {t("on")}
          </label>
        </div>
        <div className="library-space-section-content">
          <div className="library-space-actions">
            <button
              className="settings-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await desktop.invoke<{
                    beforeBytes: number;
                    afterBytes: number;
                  }>("library:compact");
                  setNotice(
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
            <button
              className="settings-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await desktop.invoke("library:rebuildIndex");
                  setNotice(t("toast.indexRebuilt"));
                })
              }
            >
              {t("rebuildIndex")}
            </button>
            {busy && <Loader2 size={15} className="studio-spin" />}
          </div>
          {plan && (
            <div className="library-space-plan">
              <p>
                {t("cleanupPlan", {
                  count: plan.files.length,
                  size: bytes(plan.bytes),
                  drafts: plan.protectedDrafts,
                  conflicts: plan.protectedConflicts,
                })}
              </p>
              <details>
                <summary>{t("showCleanupFiles")}</summary>
                {plan.files.map((item) => (
                  <p key={item.path}>
                    <code>{item.path}</code> · {bytes(item.bytes)}
                  </p>
                ))}
              </details>
              <button
                className="settings-button"
                disabled={busy || !plan.files.length}
                onClick={() =>
                  void run(async () => {
                    await desktop.invoke("library:cleanup", { id: plan.id });
                    setPlan(null);
                    setNotice(t("toast.cleaned"));
                  })
                }
              >
                {t("cleanUpFiles")}
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="library-space-section" aria-label={t("fullArchive")}>
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>{t("fullArchive")}</h3>
          </div>
        </div>
        <div className="library-space-section-content">
          <div className="library-space-archive">
            <input
              aria-label={t("archiveLocation")}
              placeholder={t("archivePlaceholder")}
              value={archivePath}
              onChange={(event) => setArchivePath(event.target.value)}
            />
            <button
              className="settings-button"
              disabled={busy || !archivePath.trim()}
              onClick={() =>
                void run(async () => {
                  const result = await desktop.invoke<{ path: string }>(
                    "library:archive",
                    { out: archivePath },
                  );
                  setNotice(t("toast.archived", { path: result.path }));
                })
              }
            >
              {t("saveArchive")}
            </button>
          </div>
        </div>
      </section>
      {storage?.maintenance?.state === "running" && (
        <p role="status">{t("maintenanceRunning")}</p>
      )}
      {storage?.maintenance?.state === "failed" && (
        <p className="settings-help" role="status">
          {t("maintenanceFailed", { error: storage.maintenance.error ?? "" })}
        </p>
      )}
      {notice && (
        <p className="settings-help" role="status">
          {notice}
        </p>
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
      {error && !showProjects && (
        <p className="studio-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
