import { useEffect, useState } from "react";
import { Loader2, Check } from "../ui/icons";
import Dialog from "./Dialog";
import { desktop, errorMessage } from "./bridge";
import type { LibraryImportReport } from "../core/library-import";
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
  const [report, setReport] = useState<LibraryImportReport | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setBusy(true);
    void (async () => {
      if (!(await beforePrepare()))
        throw new Error("请先处理当前页面的未保存修改，本机草稿仍会保留。");
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
      title="升级内容库"
      onClose={onClose}
      className="library-migration-dialog"
    >
      <div className="studio-form">
        <p>
          导入现有内容，启用全文搜索和当前内容存储。原始文件会保留，内容库位置为：
        </p>
        <code className="history-import-path">{home}</code>
        {busy && !report && (
          <p role="status">
            <Loader2 size={15} className="studio-spin" />{" "}
            正在读取、转换并核对内容…
          </p>
        )}
        {report && (
          <>
            <p className="history-import-ready">
              <Check size={16} /> 内容与组件引用已核对
            </p>
            <dl className="history-import-counts">
              <div>
                <dt>项目</dt>
                <dd>{report.projects}</dd>
              </div>
              <div>
                <dt>页面</dt>
                <dd>{report.pages.length}</dd>
              </div>
              <div>
                <dt>组件版本</dt>
                <dd>{report.components}</dd>
              </div>
              <div>
                <dt>模板版本</dt>
                <dd>{report.templates}</dd>
              </div>
              <div>
                <dt>旧快照</dt>
                <dd>{report.snapshots.length}</dd>
              </div>
            </dl>
            <p>
              旧快照缺少可靠的修改时间、作者和顺序，会单独显示。启用后，新修改开始记录时间、修改内容和人工／Agent
              会话来源。
            </p>
            {!!report.issues.length && (
              <details open>
                <summary>{report.issues.length} 项内容需要留意</summary>
                <p>原始字节已保留；以下旧快照无法直接预览或恢复。</p>
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
            关闭
          </button>
          <button
            className="studio-button primary"
            disabled={busy || !report}
            onClick={() => void activate()}
          >
            {busy && <Loader2 size={14} className="studio-spin" />} 升级内容库
          </button>
        </footer>
      </div>
    </Dialog>
  );
}
