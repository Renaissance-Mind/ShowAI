import { useEffect, useState } from "react";
import { Loader2, Check } from "../ui/icons";
import Dialog from "./Dialog";
import { desktop, errorMessage } from "./bridge";
import type { LibraryImportReport } from "../core/library-import";
import { translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/library";
import common from "../i18n/messages/common";

const translate = translator(messages);
export default function LibraryMigrationDialog({
  home,
  beforePrepare,
  onActivated,
  onClose,
}: {
  home: string;
  beforePrepare: () => Promise<boolean>;
  onActivated: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(common);
  const [report, setReport] = useState<LibraryImportReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    void (async () => {
      if (!(await beforePrepare()))
        throw new Error(translate("upgrade.unsaved"));
      return desktop.invoke<LibraryImportReport>("library:prepareImport");
    })()
      .then(
        (value) => {
          if (active) setReport(value);
        },
        (reason) => {
          if (active) setError(errorMessage(reason));
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [home, beforePrepare]);
  async function activate() {
    if (!report) return;
    setBusy(true);
    setError("");
    try {
      await desktop.invoke("library:activateImport", { id: report.id });
      await onActivated();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={t("upgrade.title")}
      onClose={onClose}
      className="library-migration-dialog"
    >
      <div className="studio-form">
        <p>{t("upgrade.intro")}</p>
        <code className="history-import-path">{home}</code>
        {busy && !report && (
          <p role="status">
            <Loader2 size={15} className="studio-spin" />{" "}
            {t("upgrade.preparing")}
          </p>
        )}
        {report && (
          <>
            <p className="history-import-ready">
              <Check size={16} /> {t("upgrade.verified")}
            </p>
            <dl className="history-import-counts">
              <div>
                <dt>{t("upgrade.projects")}</dt>
                <dd>{report.projects}</dd>
              </div>
              <div>
                <dt>{t("upgrade.pages")}</dt>
                <dd>{report.pages.length}</dd>
              </div>
              <div>
                <dt>{t("upgrade.components")}</dt>
                <dd>{report.components}</dd>
              </div>
              <div>
                <dt>{t("upgrade.templates")}</dt>
                <dd>{report.templates}</dd>
              </div>
              <div>
                <dt>{t("upgrade.snapshots")}</dt>
                <dd>{report.snapshots.length}</dd>
              </div>
            </dl>
            <p>{t("upgrade.snapshotNote")}</p>
            {!!report.issues.length && (
              <details open>
                <summary>
                  {t("upgrade.issues", { count: report.issues.length })}
                </summary>
                <p>{t("upgrade.issuesNote")}</p>
                {report.issues.map((issue) => (
                  <p key={issue} className="history-import-issue">
                    {issue}
                  </p>
                ))}
              </details>
            )}
          </>
        )}
        {error && (
          <p className="studio-form-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button className="studio-button" onClick={onClose}>
            {tc("close")}
          </button>
          <button
            className="studio-button primary"
            disabled={busy || !report}
            onClick={() => void activate()}
          >
            {busy && <Loader2 size={14} className="studio-spin" />}{" "}
            {t("upgrade.title")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
