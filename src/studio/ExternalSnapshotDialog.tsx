import Dialog from "./Dialog";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import messages from "../i18n/messages/exportSnapshots";

/** What an export would embed from datasets read from external files. */
export interface ExternalSnapshotReport {
  datasets: {
    projectId: string;
    datasetId: string;
    name?: string;
    format: string;
    path?: string;
    fileBytes?: number;
    snapshotBytes: number;
    blocks: { pageId: string; blockId: string }[];
    available: boolean;
    error?: string;
  }[];
  snapshotBytes: number;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Shows how much data from external files an export would embed, so the
 * person decides whether to export it as a snapshot.
 */
export function ExternalSnapshotDialog({
  report,
  onDecide,
}: {
  report: ExternalSnapshotReport;
  onDecide: (embed: boolean) => void;
}) {
  const t = useTranslator(messages);
  const tc = useTranslator(commonMessages);
  const unavailable = report.datasets.filter((item) => !item.available);
  return (
    <Dialog title={t("title")} onClose={() => onDecide(false)} wide>
      <div className="studio-form external-snapshots">
        <p>{t("intro")}</p>
        <table>
          <thead>
            <tr>
              <th scope="col">{t("dataset")}</th>
              <th scope="col">{t("file")}</th>
              <th scope="col">{t("fileSize")}</th>
              <th scope="col">{t("snapshotSize")}</th>
            </tr>
          </thead>
          <tbody>
            {report.datasets.map((item) => (
              <tr key={`${item.projectId}/${item.datasetId}`}>
                <td>
                  {item.name ?? item.datasetId}
                  <div className="external-snapshots-muted">
                    {t("blocks", { count: item.blocks.length })}
                  </div>
                </td>
                <td className="external-snapshots-path">
                  {item.path ?? t("notLinked")}
                  {!item.available && (
                    <div className="external-snapshots-warning">
                      {t("unavailable")}
                    </div>
                  )}
                </td>
                <td>
                  {item.fileBytes === undefined
                    ? "—"
                    : formatSize(item.fileBytes)}
                </td>
                <td>{item.available ? formatSize(item.snapshotBytes) : "—"}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={3}>
                {t("total")}
              </th>
              <td>{formatSize(report.snapshotBytes)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="external-snapshots-muted">{t("explain")}</p>
        {unavailable.length > 0 && (
          <p className="studio-form-error" role="alert">
            {t("unavailableHint", { count: unavailable.length })}
          </p>
        )}
        <footer>
          <button
            className="studio-button"
            type="button"
            onClick={() => onDecide(false)}
          >
            {tc("cancel")}
          </button>
          <button
            className="studio-button primary"
            type="button"
            onClick={() => onDecide(true)}
          >
            {t("export")}
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
