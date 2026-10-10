import { latestRequest } from "../lib/latest-request";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { LibraryMenuPoint } from "./LibraryNavigation";
import { ArrowRight, Loader2, FileText } from "../ui/icons";
import Dialog from "./Dialog";
import ConflictPagePreview from "./ConflictPagePreview";
import { desktop, errorMessage } from "./bridge";
import type { PageChange } from "../core/model";
import type { SearchResult } from "../core/library-index";
import type { PageMergePreview } from "../core/page-merge";
import type { ShowDocument } from "../types";
import "./recovery.css";
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
    void desktop.invoke<WorkspaceConflict[]>("workspace:conflicts").then(
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

export function LibrarySearchResults({
  projectId,
  query,
  onOpen,
  onMenu,
}: {
  projectId?: string;
  query: string;
  onOpen: (
    result: SearchResult,
    event: MouseEvent<HTMLButtonElement>,
  ) => Promise<void>;
  onMenu: (
    result: SearchResult,
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
  ) => void;
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
  async function openResult(
    result: SearchResult,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    try {
      await onOpen(result, event);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }
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
              onClick={(event) => void openResult(result, event)}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                void openResult(result, event);
              }}
              onContextMenu={(event) => {
                if (!page && result.kind !== "project") return;
                event.preventDefault();
                onMenu(result, event.currentTarget, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onKeyDown={(event) => {
                if (
                  (!page && result.kind !== "project") ||
                  (event.key !== "ContextMenu" &&
                    !(event.shiftKey && event.key === "F10"))
                )
                  return;
                event.preventDefault();
                onMenu(result, event.currentTarget);
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
  saveFailure = false,
  onEdit,
  onDiscard,
}: {
  projectId: string;
  pageId: string;
  baseRevision: string;
  document: ShowDocument;
  onClose: () => void;
  onMerged: () => Promise<void>;
  saveFailure?: boolean;
  onEdit?: (
    document: ShowDocument,
    currentRevision: string,
    currentHash: string,
  ) => void;
  onDiscard?: () => Promise<void>;
}) {
  const [reviewed, setReviewed] = useState(false);
  const [preview, setPreview] = useState<
      | (PageMergePreview & { currentRevision: string; currentHash: string })
      | null
    >(null),
    [resolved, setResolved] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void desktop
      .invoke<
        PageMergePreview & { currentRevision: string; currentHash: string }
      >("page:mergePreview", { projectId, pageId, baseRevision, document })
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
      await desktop.invoke("page:mergeSave", {
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
      title={saveFailure ? "保存失败：请处理冲突" : "比较并合并草稿"}
      dismissible={!saveFailure}
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
              ? `${preview.conflicts.length} 处修改需要处理，当前草稿尚未保存。`
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
          <details open={!saveFailure && preview.conflicts.length > 0}>
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
            {saveFailure && onEdit && (
              <button
                className="studio-button primary"
                disabled={busy}
                onClick={() => {
                  onEdit(
                    JSON.parse(resolved),
                    preview.currentRevision,
                    preview.currentHash,
                  );
                  onClose();
                }}
              >
                修改后重新保存
              </button>
            )}
            {saveFailure && onDiscard && (
              <button
                className="studio-button"
                disabled={busy}
                onClick={() =>
                  void onDiscard()
                    .then(onClose)
                    .catch((reason) => setError(errorMessage(reason)))
                }
              >
                放弃修改，载入当前文件
              </button>
            )}
            <button
              className="studio-button primary"
              disabled={busy || (!!preview.conflicts.length && !reviewed)}
              onClick={() => void save()}
            >
              保存合并版本
            </button>
            {!saveFailure && (
              <button className="studio-button" onClick={onClose}>
                保留草稿并返回
              </button>
            )}
          </footer>
        </>
      ) : error && saveFailure && onDiscard ? (
        <button
          className="studio-button"
          disabled={busy}
          onClick={() =>
            void onDiscard()
              .then(onClose)
              .catch((reason) => setError(errorMessage(reason)))
          }
        >
          放弃修改，载入当前文件
        </button>
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
  saveFailure = false,
  draftDocument,
  onEdit,
}: {
  id: string;
  onClose: () => void;
  onResolved: () => Promise<void>;
  projectId?: string;
  onPackageRecovered: (result: PackageRecoveryResult) => Promise<void>;
  saveFailure?: boolean;
  draftDocument?: ShowDocument;
  onEdit?: (document: ShowDocument) => void;
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
      .invoke<typeof detail>("workspace:conflict", { id })
      .then(
        (value) => {
          if (active && value) {
            setDetail(value);
            if (
              value.path.includes("/packages/") ||
              value.path.startsWith("packages/")
            )
              return;
            const artifact =
              draftDocument ??
              (value.external
                ? JSON.parse(value.external)
                : value.current
                  ? JSON.parse(value.current)
                  : {});
            setResolved(
              JSON.stringify(
                draftDocument ?? artifact.document ?? artifact,
                null,
                2,
              ),
            );
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
  }, [id, draftDocument]);
  const packageConflict =
    !!detail &&
    (detail.path.includes("/packages/") || detail.path.startsWith("packages/"));
  async function recoverPackage() {
    setBusy(true);
    setError("");
    try {
      const result = await desktop.invoke<PackageRecoveryResult>(
        "workspace:recoverPackage",
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
      await desktop.invoke("workspace:resolve", {
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
      title={saveFailure ? "保存失败：请处理外部修改冲突" : "处理外部文件修改"}
      dismissible={!saveFailure}
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
          {tab === "compare" && saveFailure && draftDocument ? (
            <div className="history-conflict-values">
              <div>
                <h3>我的未保存修改</h3>
                <ConflictPagePreview value={draftDocument} />
              </div>
              <div>
                <h3>当前文件版本</h3>
                <ConflictPagePreview value={detail.external} />
              </div>
            </div>
          ) : tab === "compare" ? (
            <div className="history-conflict-values">
              {draftDocument && (
                <div>
                  <h3>尚未保存的 App 草稿</h3>
                  <Value value={draftDocument} />
                </div>
              )}
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
            {saveFailure && draftDocument && onEdit && (
              <button
                className="studio-button primary"
                disabled={busy || packageConflict}
                onClick={() => {
                  onEdit(JSON.parse(resolved));
                  onClose();
                }}
              >
                修改后重新保存
              </button>
            )}
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
                  : saveFailure
                    ? "放弃我的修改，采用文件版本"
                    : "导入外部修改"}
            </button>
            <button
              className="studio-button"
              disabled={busy}
              onClick={() => void choose("discard")}
            >
              使用正式版本
            </button>
            {!saveFailure && (
              <button className="studio-text-button" onClick={onClose}>
                稍后处理
              </button>
            )}
          </footer>
        </>
      )}
    </Dialog>
  );
}
