import { latestRequest } from "../lib/latest-request";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Loader2,
  RotateCcw,
  Bot,
  User,
  FileText,
} from "../ui/icons";
import Dialog from "./Dialog";
import ExpandableSearch from "../components/ExpandableSearch";
import { desktop, errorCode, errorMessage } from "./bridge";
import type { HistoryEntry } from "../core/history-model";
import type { PageChange } from "../core/model";
import type { HistoricalPage } from "../core/library-operations";
import type { LibraryOperations } from "../core/library-operations";
import type { SearchResult } from "../core/library-index";
import type { PageMergePreview } from "../core/page-merge";
import type { ShowDocument } from "../types";
import "./history.css";
import type { WorkspaceConflict } from "../core/workspace-conflicts";
import type { recoverExternalPackage } from "../core/package-recovery";
export type PackageRecoveryResult = Awaited<
  ReturnType<typeof recoverExternalPackage>
>;
export function WorkspaceConflictsDialog({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [items, setItems] = useState<WorkspaceConflict[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void desktop.invoke<WorkspaceConflict[]>("history:conflicts").then(
      (values) => {
        if (active) setItems(values);
      },
      (reason) => {
        if (active) setError(errorMessage(reason));
      },
    );
    return () => {
      active = false;
    };
  }, []);
  return (
    <Dialog title="外部文件修改" onClose={onClose} wide>
      <div className="history-search-results">
        <p>外部版本会保留。组件与模板先恢复为可编辑草稿，再保存为新版本。</p>
        {error && (
          <p className="history-error" role="alert">
            {error}
          </p>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            className="history-search-result"
            onClick={() => onSelect(item.id)}
          >
            <FileText size={18} />
            <span>
              <strong>{item.path.split("/").at(-1)}</strong>
              <small>{item.path}</small>
              <p>
                {time(item.observedAt)} ·{" "}
                {
                  { modified: "已修改", added: "新增文件", deleted: "已删除" }[
                    item.kind
                  ]
                }
              </p>
            </span>
            <ArrowRight size={16} />
          </button>
        ))}
        {!items.length && !error && (
          <p className="history-empty">正在检查或暂无外部修改。</p>
        )}
      </div>
    </Dialog>
  );
}

function time(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
function author(entry: HistoryEntry) {
  return entry.actor.kind === "agent"
    ? `${entry.actor.harness ?? "Agent"} · ${entry.actor.sessionId ?? "未知会话"}`
    : ({
        human: "人工编辑",
        system: "系统操作",
        external: "外部工具",
        unknown: "来源未知",
      }[entry.actor.kind] ?? entry.actor.kind);
}
function message(entry: HistoryEntry) {
  const labels: Record<string, string> = {
    "pages:create": "创建页面",
    "pages:save": "保存页面",
    "pages:rename": "重命名页面",
    "pages:remove": "归档页面",
    "projects:create": "创建项目",
    "projects:rename": "重命名项目",
    "components:save": "保存组件版本",
    "templates:save": "保存模板版本",
    "history:restore": "恢复历史版本",
    "history:mergeSave": "保存合并版本",
    "history:resolve": "处理外部修改",
  };
  return labels[entry.message ?? ""] ?? entry.message ?? "保存内容";
}
function pathLabel(path: string) {
  if (/\/pages\/[^/]+\.json$/.test(path)) return "页面内容";
  if (/\/project\.json$/.test(path)) return "项目信息";
  const pkg = path.match(/\/(components|templates)\/([^/]+)\/([^/]+)\/(.+)/);
  return pkg ? `${pkg[2]} ${pkg[3]} · ${pkg[4]}` : path;
}
function Value({ value }: { value: unknown }) {
  if (typeof value === "string" && /^data:image\//.test(value))
    return (
      <img className="history-value-image" src={value} alt="修改中的图片" />
    );
  if (value === undefined)
    return <span className="history-empty-value">未设置</span>;
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <>
      <pre>{text.length > 8000 ? text.slice(0, 8000) + "\n…" : text}</pre>
      {text.length > 8000 && (
        <details>
          <summary>查看完整内容（{text.length.toLocaleString()} 字符）</summary>
          <pre>{text}</pre>
        </details>
      )}
    </>
  );
}
const fieldNames: Record<string, string> = {
  title: "标题",
  icon: "图标",
  cover: "封面",
  favorite: "置顶",
  archived: "归档",
  parentId: "归属",
  layout: "布局",
  views: "视图",
  surfaceViews: "容器视图",
  attrs: "区块参数",
  content: "内容",
  type: "内容类型",
};
export function ChangeList({ changes }: { changes: PageChange[] }) {
  return (
    <div className="history-change-list">
      {changes.length ? (
        changes.map((change, index) => (
          <section key={index} className="history-change">
            <header>
              <strong>
                {
                  {
                    "page.changed": "页面信息",
                    "block.changed": "修改区块",
                    "block.added": "新增区块",
                    "block.removed": "删除区块",
                    "block.moved": "移动区块",
                  }[change.type]
                }
              </strong>
              {"blockId" in change && (
                <code title={change.blockId}>
                  {change.blockId.slice(0, 12)}
                </code>
              )}
            </header>
            {"fields" in change ? (
              change.fields.map((field) => (
                <div className="history-field" key={field.field}>
                  <p>{fieldNames[field.field] ?? field.field}</p>
                  <div className="history-value-pair">
                    <div className="before">
                      <small>修改前</small>
                      <Value value={field.before} />
                    </div>
                    <div className="after">
                      <small>修改后</small>
                      <Value value={field.after} />
                    </div>
                  </div>
                </div>
              ))
            ) : change.type === "block.moved" ? (
              <p>
                移动到
                {change.parentId
                  ? `容器 ${change.parentId.slice(0, 12)}`
                  : "页面根部"}
                {change.afterId
                  ? `，位于 ${change.afterId.slice(0, 12)} 之后`
                  : "的开头"}
              </p>
            ) : (
              <details>
                <summary>查看区块内容</summary>
                <Value value={change.node} />
              </details>
            )}
          </section>
        ))
      ) : (
        <p className="history-empty">这两个版本的页面内容相同。</p>
      )}
    </div>
  );
}

export function HistoryDialog({
  projectId,
  pageId,
  onClose,
  beforeRestore,
  onRestored,
  onImportedSnapshots,
}: {
  projectId: string;
  pageId?: string;
  onClose: () => void;
  beforeRestore: () => Promise<boolean>;
  onRestored: () => Promise<void>;
  onImportedSnapshots: () => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [selected, setSelected] = useState<HistoryEntry | null>(null);
  const [snapshot, setSnapshot] = useState<HistoricalPage | null>(null),
    [changes, setChanges] = useState<PageChange[]>([]),
    [tab, setTab] = useState<"changes" | "page">("changes");
  const [frozenHtml, setFrozenHtml] = useState("");
  const [resourcePath, setResourcePath] = useState(""),
    [compareRevision, setCompareRevision] = useState("");
  const [raw, setRaw] = useState<{ before?: string; after?: string } | null>(
    null,
  );
  const choiceRequest = useRef(0);
  const [query, setQuery] = useState(""),
    [session, setSession] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  const request = useRef(0);
  const load = useCallback(
    async (next?: string) => {
      const ticket = ++request.current;
      setBusy(true);
      setError("");
      try {
        const result = await desktop.invoke<{
          items: HistoryEntry[];
          nextCursor: string | null;
        }>("history:list", {
          projectId,
          pageId,
          query: query || undefined,
          sessionId: session || undefined,
          cursor: next,
          limit: 50,
        });
        if (ticket !== request.current) return;
        setEntries((current) =>
          next ? [...current, ...result.items] : result.items,
        );
        setCursor(result.nextCursor);
      } catch (reason) {
        if (ticket === request.current) setError(errorMessage(reason));
      } finally {
        if (ticket === request.current) setBusy(false);
      }
    },
    [projectId, pageId, query, session],
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [load]);
  async function choose(entry: HistoryEntry, path?: string, compare?: string) {
    const ticket = ++choiceRequest.current;
    setSelected(entry);
    setSnapshot(null);
    setFrozenHtml("");
    setChanges([]);
    setConfirm(false);
    setError("");
    const resource = pageId
      ? { id: pageId, path: `projects/${projectId}/pages/${pageId}.json` }
      : (entry.resources.find(
          (item) => item.kind === "page" && item.projectId === projectId,
        ) ?? entry.resources[0]);
    const chosenPath =
      path ??
      entry.paths.find(
        (item) =>
          item === resource?.path || item.startsWith(`${resource?.path}/`),
      ) ??
      entry.paths[0];
    const parent = compare ?? entry.parents[0];
    setResourcePath(chosenPath);
    setCompareRevision(parent ?? "");
    setRaw(null);
    if (!chosenPath) return;
    setBusy(true);
    try {
      const read = async (revision: string | undefined) => {
        if (!revision) return undefined;
        try {
          return (
            await desktop.invoke<{ content: string }>("history:resource", {
              path: chosenPath,
              revision,
            })
          ).content;
        } catch (reason) {
          if (errorCode(reason) === "NOT_FOUND") return undefined;
          throw reason;
        }
      };
      const [before, after] = await Promise.all([
        read(parent),
        read(entry.revision),
      ]);
      if (ticket !== choiceRequest.current) return;
      setRaw({ before, after });
      const pageMatch = chosenPath.match(
        /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
      );
      if (!pageMatch) return;
      const value = await desktop.invoke<HistoricalPage>("history:page", {
        projectId: pageMatch[1],
        pageId: pageMatch[2],
        revision: entry.revision,
      });
      if (ticket !== choiceRequest.current) return;
      setSnapshot(value);
      if (value.reader) {
        const rendered = await desktop.invoke<{ html: string }>(
          "history:html",
          {
            projectId: pageMatch[1],
            pageId: pageMatch[2],
            revision: entry.revision,
          },
        );
        if (ticket !== choiceRequest.current) return;
        setFrozenHtml(rendered.html);
      }
      if (parent && before) {
        try {
          const diff = await desktop.invoke<{ changes: PageChange[] }>(
            "history:compare",
            {
              projectId: pageMatch[1],
              pageId: pageMatch[2],
              before: parent,
              after: entry.revision,
            },
          );
          if (ticket === choiceRequest.current) setChanges(diff.changes);
        } catch (reason) {
          if (errorCode(reason) !== "NOT_FOUND") throw reason;
        }
      }
    } catch (reason) {
      if (ticket === choiceRequest.current) setError(errorMessage(reason));
    } finally {
      if (ticket === choiceRequest.current) setBusy(false);
    }
  }
  async function restore() {
    if (!snapshot || !selected || !(await beforeRestore())) return;
    setBusy(true);
    setError("");
    try {
      const current = await desktop.invoke<{ revision?: string }>("pages:get", {
        projectId,
        pageId: snapshot.document.id,
      });
      await desktop.invoke("history:restore", {
        projectId,
        pageId: snapshot.document.id,
        revision: selected.revision,
        baseRevision: current.revision,
      });
      await onRestored();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={pageId ? "页面历史" : "项目历史"}
      onClose={onClose}
      wide
      className="history-dialog"
    >
      <div className="history-toolbar">
        <button className="studio-button" onClick={onImportedSnapshots}>
          旧快照
        </button>
        <ExpandableSearch
          label="搜索修改说明"
          value={query}
          onChange={setQuery}
        />
        <input
          aria-label="按会话筛选历史"
          placeholder="Agent 会话 ID（可选）"
          value={session}
          onChange={(event) => setSession(event.target.value)}
        />
      </div>
      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}
      <div className="history-layout">
        <aside className="history-timeline" aria-label="修改时间线">
          {entries.map((entry, index) => (
            <button
              key={entry.revision}
              className={
                selected?.revision === entry.revision ? "selected" : ""
              }
              onClick={() => void choose(entry)}
            >
              <span className="history-time">{time(entry.at)}</span>
              <strong>{message(entry)}</strong>
              <span className="history-author" title={author(entry)}>
                {entry.actor.kind === "agent" ? (
                  <Bot size={13} />
                ) : (
                  <User size={13} />
                )}
                {author(entry)}
              </span>
              <small>
                {entry.resources.length} 项内容
                {entry.groupId && entries[index + 1]?.groupId === entry.groupId
                  ? " · 连续编辑"
                  : ""}
              </small>
            </button>
          ))}
          {cursor && (
            <button disabled={busy} onClick={() => void load(cursor)}>
              加载更早记录
            </button>
          )}
          {!entries.length && !busy && (
            <p className="history-empty">暂无匹配记录。</p>
          )}
        </aside>
        <main className="history-detail">
          {busy && <Loader2 className="studio-spin" size={20} />}
          {selected ? (
            <>
              <header className="history-detail-heading">
                <div>
                  <p>{time(selected.at)}</p>
                  <h3>{message(selected)}</h3>
                  <span title={author(selected)}>{author(selected)}</span>
                </div>
                {snapshot && (
                  <button
                    className="studio-button"
                    disabled={busy}
                    onClick={() => setConfirm(true)}
                  >
                    <RotateCcw size={14} />
                    恢复此版本
                  </button>
                )}
              </header>
              <div className="history-comparison-controls">
                <label>
                  修改的文件
                  <select
                    aria-label="修改的文件"
                    value={resourcePath}
                    onChange={(event) =>
                      void choose(
                        selected,
                        event.target.value,
                        compareRevision || undefined,
                      )
                    }
                  >
                    {selected.paths.map((path) => (
                      <option key={path} value={path}>
                        {pathLabel(path)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  比较基础
                  <select
                    aria-label="比较基础"
                    value={compareRevision}
                    onChange={(event) =>
                      void choose(selected, resourcePath, event.target.value)
                    }
                  >
                    {compareRevision &&
                      !entries.some(
                        (entry) => entry.revision === compareRevision,
                      ) && (
                        <option value={compareRevision}>
                          上一个版本 · {compareRevision.slice(0, 10)}
                        </option>
                      )}
                    {!compareRevision && <option value="">首次创建</option>}
                    {entries
                      .filter((entry) => entry.revision !== selected.revision)
                      .map((entry) => (
                        <option key={entry.revision} value={entry.revision}>
                          {time(entry.at)} ·{" "}
                          {entry.message || entry.revision.slice(0, 10)}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
              {confirm && (
                <div className="history-confirm" role="alert">
                  <button
                    className="studio-button primary"
                    disabled={busy}
                    onClick={() => void restore()}
                  >
                    确认恢复
                  </button>
                  <button
                    className="studio-text-button"
                    onClick={() => setConfirm(false)}
                  >
                    取消
                  </button>
                </div>
              )}
              {snapshot && (
                <nav className="history-tabs">
                  <button
                    aria-pressed={tab === "changes"}
                    onClick={() => setTab("changes")}
                  >
                    修改内容
                  </button>
                  <button
                    aria-pressed={tab === "page"}
                    onClick={() => setTab("page")}
                  >
                    完整页面
                  </button>
                </nav>
              )}
              {snapshot && tab === "page" ? (
                <div className="history-preview">
                  <h3 className="history-preview-title">
                    {snapshot.document.title || "无标题"}
                  </h3>
                  {frozenHtml ? (
                    <iframe
                      title="历史页面预览"
                      sandbox="allow-scripts allow-downloads"
                      srcDoc={frozenHtml}
                      className="history-frozen-reader"
                    />
                  ) : (
                    <p className="history-empty">
                      这个版本没有记录阅读器。页面数据与差异仍可查看。
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {snapshot && raw?.before ? (
                    <ChangeList changes={changes} />
                  ) : raw ? (
                    <div className="history-value-pair history-raw-change">
                      <div className="before">
                        <small>修改前</small>
                        <Value value={raw.before} />
                      </div>
                      <div className="after">
                        <small>修改后</small>
                        <Value value={raw.after} />
                      </div>
                    </div>
                  ) : null}
                  <details>
                    <summary>涉及的内容与版本</summary>
                    {selected.resources.map((resource) => (
                      <p key={resource.path}>
                        <strong>
                          {resource.kind === "page"
                            ? "页面"
                            : resource.kind === "component"
                              ? "组件"
                              : resource.kind === "template"
                                ? "模板"
                                : "项目内容"}
                        </strong>{" "}
                        · {resource.id}
                      </p>
                    ))}
                    <code>{selected.revision}</code>
                    <p>
                      入口：
                      {
                        {
                          desktop: "桌面编辑器",
                          browser: "浏览器编辑器",
                          cli: "命令行",
                          mcp: "MCP",
                          external: "外部文件",
                          system: "系统",
                        }[selected.channel]
                      }
                    </p>
                    <p>
                      操作标识：<code>{selected.operationId}</code>
                    </p>
                    {selected.groupId && (
                      <p>
                        连续编辑组：<code>{selected.groupId}</code>
                      </p>
                    )}
                    <p>
                      修改文件：<code>{resourcePath}</code>
                    </p>
                  </details>
                </>
              )}
            </>
          ) : null}
        </main>
      </div>
    </Dialog>
  );
}

type LegacySnapshot = Awaited<
  ReturnType<LibraryOperations["importedSnapshots"]>
>[number];
export function ImportedSnapshotsDialog({
  projectId,
  pageId,
  onClose,
  beforeRestore,
  onRestored,
}: {
  projectId: string;
  pageId?: string;
  onClose: () => void;
  beforeRestore: () => Promise<boolean>;
  onRestored: () => Promise<void>;
}) {
  const [items, setItems] = useState<LegacySnapshot[]>([]),
    [selected, setSelected] = useState<LegacySnapshot | null>(null);
  const [preview, setPreview] = useState<HistoricalPage | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  const [frozenHtml, setFrozenHtml] = useState("");
  const request = useRef(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    void desktop
      .invoke<LegacySnapshot[]>("history:importedSnapshots", {
        projectId,
        pageId,
      })
      .then(
        (values) => {
          if (active) setItems(values);
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
      request.current++;
    };
  }, [projectId, pageId]);
  async function choose(item: LegacySnapshot) {
    const ticket = ++request.current;
    setSelected(item);
    setPreview(null);
    setFrozenHtml("");
    setError("");
    setConfirm(false);
    if (item.issue) {
      setError(item.issue);
      return;
    }
    setBusy(true);
    try {
      const value = await desktop.invoke<HistoricalPage>(
        "history:importedPage",
        {
          projectId,
          pageId: item.pageId,
          importId: item.importId,
          snapshotId: item.id,
        },
      );
      if (ticket === request.current) setPreview(value);
      if (value.reader) {
        const rendered = await desktop.invoke<{ html: string }>(
          "history:importedHtml",
          {
            projectId,
            pageId: item.pageId,
            importId: item.importId,
            snapshotId: item.id,
          },
        );
        if (ticket === request.current) setFrozenHtml(rendered.html);
      }
    } catch (reason) {
      if (ticket === request.current) setError(errorMessage(reason));
    } finally {
      if (ticket === request.current) setBusy(false);
    }
  }
  async function restore() {
    if (!selected || !preview || !(await beforeRestore())) return;
    setBusy(true);
    setError("");
    try {
      let baseRevision: string | null;
      try {
        baseRevision = (
          await desktop.invoke<{ revision: string }>("pages:get", {
            projectId,
            pageId: selected.pageId,
          })
        ).revision;
      } catch (reason) {
        if (errorCode(reason) !== "NOT_FOUND") throw reason;
        baseRevision = null;
      }
      await desktop.invoke("history:restoreImportedSnapshot", {
        projectId,
        pageId: selected.pageId,
        importId: selected.importId,
        snapshotId: selected.id,
        baseRevision,
      });
      await onRestored();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="导入的旧快照"
      onClose={onClose}
      wide
      className="history-dialog"
    >
      <p className="history-merge-summary">
        这些快照来自旧内容库，原修改时间、作者和顺序均未知。恢复会生成一个新的完整修改记录。
      </p>
      {error && (
        <p className="history-error" role="alert">
          {error}。原始字节仍被保留。
        </p>
      )}
      <div className="history-layout">
        <aside className="history-timeline" aria-label="旧快照列表">
          {items.map((item) => (
            <button
              key={`${item.importId}:${item.id}`}
              className={selected?.id === item.id ? "selected" : ""}
              onClick={() => void choose(item)}
            >
              <strong>旧快照 · {item.originalHash.slice(0, 10)}</strong>
              <span className="history-time">
                导入于 {time(item.importedAt)}
              </span>
              <small>
                {item.issue ? "原始文件已保留，无法预览" : "可预览和恢复"}
              </small>
            </button>
          ))}
          {!items.length && !busy && (
            <p className="history-empty">没有导入的旧快照。</p>
          )}
        </aside>
        <main className="history-detail">
          {busy && <Loader2 size={20} className="studio-spin" />}
          {preview && (
            <>
              <header className="history-detail-heading">
                <h3>{preview.document.title || "无标题"}</h3>
                <button
                  className="studio-button"
                  disabled={busy}
                  onClick={() => setConfirm(true)}
                >
                  <RotateCcw size={14} />
                  恢复为新版本
                </button>
              </header>
              {confirm && (
                <div className="history-confirm">
                  <p>恢复当前选中的旧内容，正式版本仍会保留在历史中。</p>
                  <button
                    className="studio-button primary"
                    disabled={busy}
                    onClick={() => void restore()}
                  >
                    确认恢复
                  </button>
                </div>
              )}
              <p className="history-merge-summary">
                原阅读器版本未知，此预览使用导入时保存的阅读器。
              </p>
              <div className="history-preview">
                {frozenHtml ? (
                  <iframe
                    title="旧快照预览"
                    sandbox="allow-scripts allow-downloads"
                    srcDoc={frozenHtml}
                    className="history-frozen-reader"
                  />
                ) : (
                  <p className="history-empty">这个旧快照未保存阅读器。</p>
                )}
              </div>
            </>
          )}
          {selected && (
            <details>
              <summary>原始快照信息</summary>
              <p>原修改来源：未知</p>
              <p>原修改时间：未知</p>
              <code>{selected.originalPath}</code>
            </details>
          )}
        </main>
      </div>
    </Dialog>
  );
}

export function LibrarySearchResults({
  projectId,
  query,
  onOpen,
}: {
  projectId?: string;
  query: string;
  onOpen: (result: SearchResult) => Promise<void>;
}) {
  const [kind, setKind] = useState(""),
    [results, setResults] = useState<SearchResult[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [total, setTotal] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useRef(0);
  const searchQueue =
    useRef(
      latestRequest<{
        items: SearchResult[];
        total: number;
        nextCursor: string | null;
      }>(),
    );
  const find = useCallback(
    async (next?: string) => {
      const ticket = ++request.current;
      if (!query.trim()) {
        setResults([]);
        setTotal(0);
        setCursor(null);
        setBusy(false);
        setError("");
        return;
      }
      setBusy(true);
      setError("");
      try {
        const result = await searchQueue.current(() =>
          desktop.invoke<{
            items: SearchResult[];
            total: number;
            nextCursor: string | null;
          }>("library:search", {
            projectId,
            query,
            kind: kind || undefined,
            cursor: next,
          }),
        );
        if (ticket !== request.current) return;
        setResults((current) =>
          next ? [...current, ...result.items] : result.items,
        );
        setCursor(result.nextCursor);
        setTotal(result.total);
      } catch (reason) {
        if (ticket === request.current) setError(errorMessage(reason));
      } finally {
        if (ticket === request.current) setBusy(false);
      }
    },
    [projectId, query, kind],
  );
  useEffect(() => {
    const timer = setTimeout(() => void find(), 180);
    return () => {
      clearTimeout(timer);
      request.current++;
    };
  }, [find]);
  return (
    <section aria-label="内容库搜索结果">
      <div className="history-toolbar">
        <select
          aria-label="搜索内容类型"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="">全部内容</option>
          <option value="page">页面正文</option>
          <option value="component">组件</option>
          <option value="template">模板</option>
          <option value="source">源码</option>
          <option value="project">项目</option>
        </select>
      </div>
      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}
      <div className="history-search-results">
        <p className="history-search-count">
          {busy
            ? "正在搜索…"
            : query
              ? `${total} 个结果`
              : "输入关键词开始搜索"}
        </p>
        {results.map((result) => {
          const page = result.path.match(
            /^projects\/([^/]+)\/pages\/([^/]+)\.json$/,
          );
          return (
            <button
              key={result.id}
              className="history-search-result"
              onClick={async () => {
                try {
                  await onOpen(result);
                } catch (reason) {
                  setError(errorMessage(reason));
                }
              }}
            >
              <FileText size={18} />
              <span>
                <small>
                  {result.location.join(" / ") || result.resourceId}
                </small>
                <strong>{result.title}</strong>
                <p>{result.snippet}</p>
                {!page && <code>{result.path}</code>}
              </span>
              <ArrowRight size={17} />
            </button>
          );
        })}
        {cursor && (
          <button
            className="studio-button"
            disabled={busy}
            onClick={() => void find(cursor)}
          >
            更多结果
          </button>
        )}
      </div>
    </section>
  );
}

export function MergeDialog({
  projectId,
  pageId,
  baseRevision,
  document,
  onClose,
  onMerged,
}: {
  projectId: string;
  pageId: string;
  baseRevision: string;
  document: ShowDocument;
  onClose: () => void;
  onMerged: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [preview, setPreview] = useState<
      (PageMergePreview & { currentRevision: string }) | null
    >(null),
    [resolved, setResolved] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void desktop
      .invoke<PageMergePreview & { currentRevision: string }>(
        "history:mergePreview",
        { projectId, pageId, baseRevision, document },
      )
      .then(
        (value) => {
          if (active) {
            setPreview(value);
            setResolved(JSON.stringify(value.document, null, 2));
          }
        },
        (reason) => {
          if (active) setError(errorMessage(reason));
        },
      );
    return () => {
      active = false;
    };
  }, [projectId, pageId, baseRevision, document]);
  async function save() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await desktop.invoke("history:mergeSave", {
        projectId,
        pageId,
        baseRevision,
        currentRevision: preview.currentRevision,
        document: JSON.parse(resolved),
      });
      await onMerged();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="比较并合并草稿"
      onClose={onClose}
      wide
      className="history-merge-dialog"
    >
      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}
      {preview ? (
        <>
          <p className="history-merge-summary">
            {preview.conflicts.length
              ? `${preview.conflicts.length} 处修改需要选择，草稿已经保留。`
              : "修改可以自动合并，请检查结果后保存。"}
          </p>
          <ChangeList changes={preview.changes} />
          {preview.conflicts.map((conflict, index) => (
            <section className="history-change" key={index}>
              <header>
                <strong>冲突 {index + 1}</strong>
                <code>{conflict.path}</code>
              </header>
              <div className="history-conflict-values">
                {["base", "ours", "theirs"].map((side) => (
                  <div key={side}>
                    <small>
                      {
                        {
                          base: "共同基础",
                          ours: "我的草稿",
                          theirs: "正式版本",
                        }[side]
                      }
                    </small>
                    <Value
                      value={conflict[side as "base" | "ours" | "theirs"]}
                    />
                  </div>
                ))}
              </div>
            </section>
          ))}
          <details open={preview.conflicts.length > 0}>
            <summary>检查并编辑合并后的页面数据</summary>
            <textarea
              className="history-resolution"
              aria-label="合并后的页面数据"
              value={resolved}
              onChange={(event) => setResolved(event.target.value)}
              spellCheck={false}
            />
          </details>
          {!!preview.conflicts.length && (
            <label className="history-review-confirm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              已检查并解决所有冲突，保存当前合并结果
            </label>
          )}
          <footer className="history-footer">
            <button
              className="studio-button primary"
              disabled={busy || (!!preview.conflicts.length && !reviewed)}
              onClick={() => void save()}
            >
              保存合并版本
            </button>
            <button className="studio-button" onClick={onClose}>
              保留草稿并返回
            </button>
          </footer>
        </>
      ) : (
        <Loader2 className="studio-spin" />
      )}
    </Dialog>
  );
}

export function ExternalConflictDialog({
  id,
  onClose,
  onResolved,
  projectId,
  onPackageRecovered,
}: {
  id: string;
  onClose: () => void;
  onResolved: () => Promise<void>;
  projectId?: string;
  onPackageRecovered: (result: PackageRecoveryResult) => Promise<void>;
}) {
  const [detail, setDetail] = useState<{
      path: string;
      baseline: string | null;
      current: string | null;
      external: string | null;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resolved, setResolved] = useState(""),
    [tab, setTab] = useState<"compare" | "merge">("compare");
  useEffect(() => {
    let active = true;
    void desktop
      .invoke<typeof detail>("history:conflict", { id })
      .then(
        (value) => {
          if (active && value) {
            setDetail(value);
            if (
              value.path.includes("/packages/") ||
              value.path.startsWith("packages/")
            )
              return;
            const artifact = value.external
              ? JSON.parse(value.external)
              : value.current
                ? JSON.parse(value.current)
                : {};
            setResolved(JSON.stringify(artifact.document ?? artifact, null, 2));
          }
        },
        (reason) => {
          if (active) setError(errorMessage(reason));
        },
      )
      .catch((reason) => {
        if (active) setError(errorMessage(reason));
      });
    return () => {
      active = false;
    };
  }, [id]);
  const packageConflict =
    !!detail &&
    (detail.path.includes("/packages/") || detail.path.startsWith("packages/"));
  async function recoverPackage() {
    setBusy(true);
    setError("");
    try {
      const result = await desktop.invoke<PackageRecoveryResult>(
        "history:recoverPackage",
        {
          id,
          clientId: `external:${crypto.randomUUID()}`,
          targetProjectId: projectId,
        },
      );
      await onPackageRecovered(result);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  async function choose(resolution: "discard" | "import" | "merge") {
    setBusy(true);
    setError("");
    try {
      await desktop.invoke("history:resolve", {
        id,
        resolution,
        ...(resolution === "merge" ? { document: JSON.parse(resolved) } : {}),
      });
      await onResolved();
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="处理外部文件修改"
      onClose={onClose}
      wide
      className="history-external-dialog"
    >
      <p className="history-merge-summary">
        外部版本已独立保留。选择如何处理，不会删除保存的外部快照。
      </p>
      {error && (
        <p className="history-error" role="alert">
          {error}
        </p>
      )}
      {detail && (
        <>
          <nav className="history-tabs">
            <button
              aria-pressed={tab === "compare"}
              onClick={() => setTab("compare")}
            >
              查看版本
            </button>
            <button
              aria-pressed={tab === "merge"}
              onClick={() => setTab("merge")}
              disabled={packageConflict}
            >
              编辑合并结果
            </button>
          </nav>
          {tab === "compare" ? (
            <div className="history-conflict-values">
              <div>
                <h3>原始基础</h3>
                <Value value={detail.baseline} />
              </div>
              <div>
                <h3>正式版本</h3>
                <Value value={detail.current} />
              </div>
              <div>
                <h3>外部修改</h3>
                <Value value={detail.external} />
              </div>
            </div>
          ) : (
            <textarea
              aria-label="外部修改的合并结果"
              className="history-resolution"
              value={resolved}
              onChange={(event) => setResolved(event.target.value)}
              spellCheck={false}
            />
          )}
          <footer className="history-footer">
            <button
              className="studio-button primary"
              disabled={busy}
              onClick={() =>
                packageConflict
                  ? void recoverPackage()
                  : void choose(tab === "merge" ? "merge" : "import")
              }
            >
              {packageConflict
                ? "保留为编辑草稿"
                : tab === "merge"
                  ? "保存合并结果"
                  : "导入外部修改"}
            </button>
            <button
              className="studio-button"
              disabled={busy}
              onClick={() => void choose("discard")}
            >
              使用正式版本
            </button>
            <button className="studio-text-button" onClick={onClose}>
              稍后处理
            </button>
          </footer>
        </>
      )}
    </Dialog>
  );
}
