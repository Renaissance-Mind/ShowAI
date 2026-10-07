import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "../ui/icons";
import { desktop, errorMessage } from "./bridge";
import type {
  LibraryStorage,
  CleanupPlan,
  StorageCategory,
} from "../core/library-maintenance";
import type { MaintenancePolicy } from "../core/maintenance-scheduler";
const labels: Record<StorageCategory, string> = {
  repository: "正式内容与历史",
  workspace: "可读文件",
  indexes: "搜索与操作索引",
  receipts: "操作回执缓存",
  cache: "临时执行文件",
  drafts: "本机草稿",
  conflicts: "外部修改快照",
  recovery: "恢复数据",
  imports: "导入准备文件",
  originals: "原始内容库",
  other: "设置与其他文件",
};
function bytes(value: number) {
  if (value < 1024) return `${value.toLocaleString("zh-CN")} B`;
  const unit = value >= 1024 ** 3 ? "GB" : value >= 1024 ** 2 ? "MB" : "KB",
    divisor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return `${(value / divisor).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} ${unit}`;
}
export default function LibrarySpace({ home }: { home: string }) {
  const [storage, setStorage] = useState<LibraryStorage | null>(null),
    [policy, setPolicy] = useState<MaintenancePolicy | null>(null);
  const [plan, setPlan] = useState<CleanupPlan | null>(null),
    [busy, setBusy] = useState(false),
    [analyzing, setAnalyzing] = useState(false),
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
  return (
    <section
      className="settings-group library-space"
      aria-label="内容库空间管理"
    >
      <section className="library-space-section" aria-label="存储空间">
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>存储空间</h3>
          </div>
          <div className="library-space-actions">
            <button
              className="settings-button"
              disabled={busy || !storage}
              onClick={() => {
                setAnalyzing(true);
                void run(() => refresh(true), false).finally(() =>
                  setAnalyzing(false),
                );
              }}
            >
              {analyzing && <Loader2 size={14} className="studio-spin" />}
              {analyzing ? "正在分析项目存储空间…" : "分析项目存储空间"}
            </button>
            <button
              className="settings-button settings-button-icon"
              disabled={busy}
              aria-label="刷新空间统计"
              title="刷新空间统计"
              onClick={() => void run(async () => {})}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <div className="library-space-section-content">
          <p className="library-space-summary">
            {storage
              ? `文件大小 ${bytes(storage.totalBytes)} · 磁盘分配 ${bytes(storage.allocatedBytes)} · ${storage.files.toLocaleString()} 个文件`
              : "正在核对文件与历史…"}
          </p>
          {storage && (
            <div className="library-space-breakdown">
              {Object.entries(storage.categories)
                .filter(([, item]) => item.files)
                .map(([name, item]) => (
                  <div key={name}>
                    <span>{labels[name as StorageCategory]}</span>
                    <span>{bytes(item.bytes)}</span>
                  </div>
                ))}
              <p>
                {storage.git.packs} 个存储包 ·{" "}
                {storage.git.looseObjects.toLocaleString()} 个未打包对象
              </p>
            </div>
          )}
          {storage?.projects && (
            <section
              className="library-project-space"
              aria-label="项目占用空间"
            >
              <p className="settings-help" role="status">
                {storage.projects.items.length} 个项目，按文件大小从大到小排列。
                统计项目目录中的内容、资源、导出与缓存，以及保留的原始文件。
              </p>
              {storage.projects.items.length ? (
                <div className="library-project-space-table">
                  <table>
                    <caption className="settings-sr-only">
                      每个项目的存储占用
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">项目</th>
                        <th scope="col">文件大小</th>
                        <th scope="col">磁盘分配</th>
                        <th scope="col">文件数</th>
                      </tr>
                    </thead>
                    <tbody>
                      {storage.projects.items.map((project) => (
                        <tr key={project.id}>
                          <th scope="row">
                            {project.name}
                            {project.archived && <small>已归档</small>}
                            {project.retained && <small>保留文件</small>}
                          </th>
                          <td>{bytes(project.bytes)}</td>
                          <td>{bytes(project.allocatedBytes)}</td>
                          <td>{project.files.toLocaleString("zh-CN")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="settings-help">内容库中暂无项目。</p>
              )}
              <p className="settings-help">
                共享历史与其他文件：{bytes(storage.projects.shared.bytes)}
                ，磁盘分配 {bytes(storage.projects.shared.allocatedBytes)}。
                历史仓库、共享资源、索引与本机草稿单独计入此项；
                历史仓库的压缩数据由项目共用，无法准确分摊。
              </p>
              <p className="settings-help">
                统计时间：{new Date(storage.measuredAt).toLocaleString("zh-CN")}
              </p>
            </section>
          )}
        </div>
      </section>
      <section className="library-space-section" aria-label="自动压缩">
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>自动压缩</h3>
          </div>
          <label className="library-space-toggle">
            <input
              type="checkbox"
              aria-label="自动压缩历史"
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
            开启
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
                    `压缩完成：${bytes(result.beforeBytes)} → ${bytes(result.afterBytes)}，历史完整保留。`,
                  );
                })
              }
            >
              立即压缩
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
              检查可清理文件
            </button>
            <button
              className="settings-button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await desktop.invoke("library:rebuildIndex");
                  setNotice("搜索、引用和历史索引已重建。 ");
                })
              }
            >
              重建搜索索引
            </button>
            {busy && <Loader2 size={15} className="studio-spin" />}
          </div>
          {plan && (
            <div className="library-space-plan">
              <p>
                可清理 {plan.files.length} 个文件，共 {bytes(plan.bytes)}。保留{" "}
                {plan.protectedDrafts} 份草稿及 {plan.protectedConflicts}{" "}
                份冲突快照。
              </p>
              <details>
                <summary>查看待清理文件</summary>
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
                    setNotice("清理完成，正式内容和完整历史已保留。");
                  })
                }
              >
                清理这些文件
              </button>
            </div>
          )}
        </div>
      </section>
      <section className="library-space-section" aria-label="完整归档">
        <div className="settings-row">
          <div className="settings-row-text">
            <h3>完整归档</h3>
          </div>
        </div>
        <div className="library-space-section-content">
          <div className="library-space-archive">
            <input
              aria-label="归档保存位置"
              placeholder="完整的新文件夹路径"
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
                  setNotice(`完整归档已保存并验证：${result.path}`);
                })
              }
            >
              保存完整归档
            </button>
          </div>
        </div>
      </section>
      {storage?.maintenance?.state === "running" && (
        <p role="status">后台维护正在进行，编辑草稿仍可保留。</p>
      )}
      {storage?.maintenance?.state === "failed" && (
        <p className="settings-help" role="status">
          上一次维护未完成：{storage.maintenance.error}
        </p>
      )}
      {notice && (
        <p className="settings-help" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="studio-form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
