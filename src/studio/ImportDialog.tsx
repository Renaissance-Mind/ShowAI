import { useEffect, useRef, useState } from "react";
import { Loader2 } from "../ui/icons";
import Dialog from "../ui/Dialog";
import { desktop, errorMessage } from "../host/bridge";
import { formatSize } from "../lib/format-size";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/imports";
import type {
  ImportPlan,
  ImportProgress,
  ImportReport,
} from "../agent/import-service";

export type StagedImportPlan = ImportPlan & { token: string };

/**
 * Shows what an import will create; writes only after the person confirms,
 * then follows its progress and shows what was not imported.
 */
export default function ImportDialog({
  plan,
  destination,
  onFinished,
  onOpen,
  onClose,
}: {
  plan: StagedImportPlan;
  destination: string;
  onFinished: (report: ImportReport) => Promise<void>;
  onOpen: (pageId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!runId || report) return;
    const timer = setInterval(() => {
      void desktop
        .invoke<ImportProgress | null>("imports:progress", { runId })
        .then((value) => {
          if (active.current && value) setProgress(value);
        });
    }, 300);
    return () => clearInterval(timer);
  }, [runId, report]);

  async function start() {
    const id = crypto.randomUUID();
    setRunId(id);
    setError("");
    try {
      const result = await desktop.invoke<ImportReport>("imports:run", {
        projectId: plan.target.projectId,
        parentId: plan.target.parentId,
        importer: plan.importer.id,
        token: plan.token,
        runId: id,
      });
      if (!active.current) return;
      setReport(result);
      await onFinished(result);
    } catch (reason) {
      if (active.current) {
        setError(errorMessage(reason));
        setRunId(null);
      }
    }
  }
  const stop = () => {
    if (!runId || stopping) return;
    setStopping(true);
    void desktop.invoke("imports:cancel", { runId });
  };
  const running = !!runId && !report;
  const counts = report
    ? {
        folders: report.created.folders,
        pages: report.created.pages,
        databases: report.created.databases,
        resources: report.created.resources,
      }
    : plan.counts;
  const notes = report ? report.problems : plan.warnings;
  return (
    <Dialog
      title={t("title", { name: plan.source.name })}
      onClose={running ? stop : onClose}
      className="library-migration-dialog"
    >
      <div className="studio-form">
        <dl className="history-import-counts">
          <div>
            <dt>{t("importer")}</dt>
            <dd>{plan.importer.name}</dd>
          </div>
          <div>
            <dt>{t("destination")}</dt>
            <dd>{destination}</dd>
          </div>
          {!!counts.folders && (
            <div>
              <dt>{t("folders")}</dt>
              <dd>{counts.folders}</dd>
            </div>
          )}
          <div>
            <dt>{t("pages")}</dt>
            <dd>{counts.pages}</dd>
          </div>
          {!!counts.databases && (
            <div>
              <dt>{t("databases")}</dt>
              <dd>{counts.databases}</dd>
            </div>
          )}
          {!!counts.resources && (
            <div>
              <dt>{t("resources")}</dt>
              <dd>
                {report
                  ? counts.resources
                  : t("resourceSize", {
                      count: plan.counts.resources,
                      size: formatSize(plan.counts.resourceBytes),
                    })}
              </dd>
            </div>
          )}
        </dl>
        {running && (
          <progress
            aria-label={t("progress")}
            max={progress?.total || 1}
            value={progress?.done ?? 0}
          />
        )}
        {!!notes.length && (
          <details open={!!report}>
            <summary>
              {report
                ? t("problems", { count: notes.length })
                : t("warnings", { count: notes.length })}
            </summary>
            {notes.map((note, index) => (
              <p key={index} className="history-import-issue">
                {"title" in note
                  ? `${note.title}: ${note.message}`
                  : note.source
                    ? `${note.source}: ${note.message}`
                    : note.message}
              </p>
            ))}
          </details>
        )}
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          {report ? (
            <>
              <button className="studio-button" onClick={onClose}>
                {t("close")}
              </button>
              {report.openPageId && (
                <button
                  className="studio-button primary"
                  onClick={() => onOpen(report.openPageId!)}
                >
                  {t("open")}
                </button>
              )}
            </>
          ) : running ? (
            <button
              className="studio-button"
              disabled={stopping}
              onClick={stop}
            >
              {stopping && <Loader2 size={14} className="studio-spin" />}{" "}
              {stopping ? t("stopping") : t("stop")}
            </button>
          ) : (
            <>
              <button className="studio-button" onClick={onClose}>
                {t("close")}
              </button>
              <button
                className="studio-button primary"
                disabled={!plan.counts.pages && !plan.counts.folders}
                onClick={() => void start()}
              >
                {t("start")}
              </button>
            </>
          )}
        </footer>
      </div>
    </Dialog>
  );
}
