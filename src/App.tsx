import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { JSONContent } from "@tiptap/core";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  CircleHelp,
  Clock3,
  Copy,
  FileJson,
  FilePlus2,
  FileText,
  FolderOpen,
  History,
  LayoutTemplate,
  List,
  Maximize2,
  MessageSquare,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import DocumentEditor from "./editor/DocumentEditor";
import { parseMarkdown } from "./lib/markdown";
import {
  descendantIds,
  hasWorkspaceCapacity,
  validateHistory,
  type HistoryStore,
  importDocumentTree,
  validateWorkspace,
} from "./lib/workspace-state";
import {
  buildArtifactHtml,
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "./lib/artifact";
import {
  STORAGE_KEY,
  HISTORY_KEY,
  canReparent,
  downloadFile,
  heading,
  initialWorkspace,
  newDocument,
  outlines,
  paragraph,
  plainText,
  toMarkdown,
} from "./lib/workspace";
import type { ShowDocument, Workspace } from "./types";

type ModalName =
  "search" | "templates" | "export" | "history" | "trash" | "help" | null;

function loadWorkspace(): { workspace: Workspace; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workspace: initialWorkspace(), error: "" };
    return { workspace: validateWorkspace(JSON.parse(raw)), error: "" };
  } catch (error) {
    return {
      workspace: initialWorkspace(),
      error: `本地数据读取失败，已暂停自动保存以保护原数据。${error instanceof Error ? error.message : ""}`,
    };
  }
}

function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    const target = panel.current;
    target
      ?.querySelector<HTMLElement>(
        'input,button,select,textarea,[tabindex="0"]',
      )
      ?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && target) {
        const focusable = [
          ...target.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,select,textarea,[tabindex="0"],a[href]',
          ),
        ].filter((el) => el.offsetParent !== null);
        const first = focusable[0],
          last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${className}`}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CoverArt() {
  return (
    <svg
      className="cover-art"
      viewBox="0 0 800 150"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth=".7" opacity=".25">
        <path d="M-40 180C120-70 265 235 400 40S675-40 850 110" />
        <path d="M-40 195C120-55 265 250 400 55S675-25 850 125" />
        <path d="M-40 210C120-40 265 265 400 70S675-10 850 140" />
        <path d="M-40 225C120-25 265 280 400 85S675 5 850 155" />
        <path d="M-40 240C120-10 265 295 400 100S675 20 850 170" />
        <circle cx="675" cy="60" r="85" />
        <circle cx="675" cy="60" r="65" />
        <circle cx="675" cy="60" r="45" />
        <path d="M675-25V145M590 60H760" />
      </g>
      <g fill="currentColor" opacity=".5">
        <circle cx="400" cy="40" r="3" />
        <circle cx="675" cy="60" r="3" />
      </g>
    </svg>
  );
}

export default function App() {
  const [initial] = useState(loadWorkspace);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [saveError, setSaveError] = useState(initial.error);
  const [saving, setSaving] = useState(false);
  const [sidebar, setSidebar] = useState(() => window.innerWidth >= 850);
  const [modal, setModal] = useState<ModalName>(null);
  const [menu, setMenu] = useState<
    "page" | "appearance" | "icon" | "cover" | null
  >(null);
  const [rightPanel, setRightPanel] = useState<"outline" | "comments" | null>(
    "outline",
  );
  const [readOnly, setReadOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [toast, setToast] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmPurge, setConfirmPurge] = useState(false);
  const [historyLoad] = useState(() => {
    let raw = "";
    try {
      raw = localStorage.getItem(HISTORY_KEY) ?? "{}";
      return { history: validateHistory(JSON.parse(raw)), error: "", raw };
    } catch {
      return {
        history: {} as HistoryStore,
        error: "历史记录损坏，已暂停版本写入。当前文档不受影响。",
        raw,
      };
    }
  });
  const [history, setHistory] = useState<HistoryStore>(historyLoad.history);
  const [historyBlocked, setHistoryBlocked] = useState(!!historyLoad.error);

  const fileInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const saveBlocked = useRef(!!initial.error);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const active =
    workspace.documents.find((d) => d.id === workspace.activeId) ??
    workspace.documents[0];
  const visibleDocs = workspace.documents.filter((d) => !d.archived);
  const headings = outlines(active.content);
  const wordCount = plainText(active.content).replace(/\s/g, "").length;
  useEffect(() => {
    if (titleInput.current) {
      titleInput.current.style.height = "auto";
      titleInput.current.style.height = `${titleInput.current.scrollHeight}px`;
    }
  }, [active.id, active.title]);
  const closeModal = useCallback(() => {
    setModal(null);
    setConfirmPurge(false);
  }, []);

  useEffect(() => {
    const theme =
      workspace.theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : workspace.theme;
    document.documentElement.dataset.theme = theme;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => {
      if (workspace.theme === "system")
        document.documentElement.dataset.theme = media.matches
          ? "dark"
          : "light";
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [workspace.theme]);

  useEffect(() => {
    if (saveBlocked.current) return;
    setSaving(true);
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
        setSaveError("");
        setSaving(false);
      } catch (error) {
        setSaveError(
          `保存失败，请导出备份。${error instanceof Error ? error.message : ""}`,
        );
        setSaving(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [workspace]);

  useEffect(() => {
    const flush = () => {
      if (!saveBlocked.current) {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(workspaceRef.current),
          );
        } catch {
          /* The visible save status already reports persistent storage failures. */
        }
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const updateDoc = useCallback((patch: Partial<ShowDocument>) => {
    setWorkspace((w) => ({
      ...w,
      documents: w.documents.map((d) =>
        d.id === w.activeId
          ? { ...d, ...patch, updatedAt: new Date().toISOString() }
          : d,
      ),
    }));
  }, []);
  const updateContent = useCallback(
    (content: JSONContent) => updateDoc({ content }),
    [updateDoc],
  );

  const saveSnapshot = useCallback(
    (doc: ShowDocument, notify = false) => {
      if (historyBlocked) {
        if (notify) setToast("历史记录损坏，请在版本历史中修复。");
        return;
      }
      setHistory((existing) => {
        const next = {
          ...existing,
          [doc.id]: [
            {
              document: structuredClone(doc),
              savedAt: new Date().toISOString(),
            },
            ...(existing[doc.id] ?? []),
          ].slice(0, 15),
        };
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
          if (notify) setToast("当前版本已保存");
        } catch {
          setToast("版本存储空间不足，请导出 JSON 备份");
        }
        return next;
      });
    },
    [historyBlocked],
  );

  function openDocument(id: string) {
    if (id !== active.id) saveSnapshot(active);
    setWorkspace((w) => ({ ...w, activeId: id }));
    setModal(null);
    setMenu(null);
    document.querySelector(".main-scroll")?.scrollTo(0, 0);
    if (window.innerWidth < 850) setSidebar(false);
  }

  function ensurePageCapacity(count = 1) {
    if (hasWorkspaceCapacity(workspaceRef.current.documents.length, count))
      return true;
    setToast("工作区最多支持 1000 个页面，请先备份并清理回收站。");
    return false;
  }

  function addDocument(
    template?: "research" | "meeting" | "playground",
    parentId: string | null = null,
  ) {
    if (!ensurePageCapacity()) return;
    saveSnapshot(active);
    let doc = newDocument("无标题", parentId);
    if (template === "research" || template === "playground") {
      doc = initialWorkspace().documents[template === "research" ? 1 : 2];
      doc.parentId = parentId;
    }
    if (template === "meeting") {
      doc.title = "会议记录";
      doc.icon = "📝";
      doc.content = {
        type: "doc",
        content: [
          heading("会议主题"),
          paragraph(),
          heading("讨论记录"),
          paragraph(),
          heading("决定与下一步"),
          {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked: false },
                content: [paragraph("待办事项")],
              },
            ],
          },
        ],
      };
    }
    setWorkspace((w) => ({
      ...w,
      documents: [...w.documents, doc],
      activeId: doc.id,
    }));
    setModal(null);
    setMenu(null);
    setToast("新页面已创建");
  }

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        !event.shiftKey
      ) {
        event.preventDefault();
        setQuery("");
        setModal((m) => (m === "search" ? null : "search"));
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        setSidebar((s) => !s);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveSnapshot(
          workspaceRef.current.documents.find(
            (d) => d.id === workspaceRef.current.activeId,
          )!,
          true,
        );
      }
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [saveSnapshot]);

  const descendants = (id: string): string[] =>
    descendantIds(workspace.documents, id);
  function archivePage() {
    const ids = descendants(active.id);
    let remaining = workspace.documents.filter(
      (d) => !ids.includes(d.id) && !d.archived,
    );
    const nextDocs = workspace.documents.map((d) =>
      ids.includes(d.id) ? { ...d, archived: true } : d,
    );
    if (!remaining.length) {
      if (!ensurePageCapacity()) return;
      const blank = newDocument();
      nextDocs.push(blank);
      remaining = [blank];
    }
    saveSnapshot(active);
    setWorkspace((w) => ({
      ...w,
      documents: nextDocs,
      activeId: remaining[0].id,
    }));
    setMenu(null);
    setToast("页面已移至回收站，可随时恢复");
  }

  async function importFile(file: File) {
    if (file.size > 25 * 1024 * 1024) {
      setToast("文件超过 25 MB，请拆分后导入");
      return;
    }
    try {
      const raw = await file.text();
      if (/\.md$|\.markdown$|\.txt$/i.test(file.name)) {
        if (!ensurePageCapacity()) return;
        const doc = newDocument(file.name.replace(/\.[^.]+$/, ""));
        doc.content = parseMarkdown(raw);
        validateDocument(doc);
        setWorkspace((w) => ({
          ...w,
          documents: [...w.documents, doc],
          activeId: doc.id,
        }));
      } else {
        const parsed = JSON.parse(raw);
        if (parsed.format === "showai-workspace") {
          if (parsed.version !== 1) throw new Error("不支持的备份版本");
          const documents = importDocumentTree(parsed.workspace?.documents);
          if (!ensurePageCapacity(documents.length)) return;
          setWorkspace((w) => ({
            ...w,
            documents: [...w.documents, ...documents],
            activeId: documents[0]?.id ?? w.activeId,
          }));
        } else {
          if (!ensurePageCapacity()) return;
          const doc = {
            ...parseArtifact(parsed).document,
            id: crypto.randomUUID(),
            parentId: null,
            archived: false,
          };
          setWorkspace((w) => ({
            ...w,
            documents: [...w.documents, doc],
            activeId: doc.id,
          }));
        }
      }
      setToast("导入完成");
    } catch (error) {
      setToast(
        `导入失败：${error instanceof Error ? error.message : "文件格式不正确"}`,
      );
    }
  }

  async function exportDocument(kind: "html" | "json" | "md" | "workspace") {
    setBusy(true);
    try {
      if (kind === "html")
        downloadFile(
          `${active.title}.html`,
          await buildArtifactHtml(active),
          "text/html;charset=utf-8",
        );
      if (kind === "json")
        downloadFile(
          `${active.title}.showai.json`,
          serializeArtifact(active),
          "application/json",
        );
      if (kind === "md")
        downloadFile(
          `${active.title}.md`,
          `# ${active.title}\n\n${toMarkdown(active.content)}`,
          "text/markdown;charset=utf-8",
        );
      if (kind === "workspace")
        downloadFile(
          "ShowAI-workspace.json",
          JSON.stringify(
            { format: "showai-workspace", version: 1, workspace },
            null,
            2,
          ),
          "application/json",
        );
      setToast("文件已导出");
      setModal(null);
    } catch (error) {
      setToast(`导出失败：${error instanceof Error ? error.message : ""}`);
    } finally {
      setBusy(false);
    }
  }

  const results = visibleDocs.filter((d) =>
    (d.title + " " + plainText(d.content))
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  function renderPageTree(
    parentId: string | null = null,
    depth = 0,
  ): ReactNode {
    if (depth > 20) return null;
    return visibleDocs
      .filter(
        (d) =>
          d.parentId === parentId ||
          (parentId === null &&
            d.parentId &&
            !visibleDocs.some((p) => p.id === d.parentId)),
      )
      .map((doc) => {
        const hasChildren = visibleDocs.some((d) => d.parentId === doc.id);
        return (
          <div key={doc.id}>
            <div
              className={`page-tree-row ${active.id === doc.id ? "active" : ""}`}
              style={{ paddingLeft: 12 + depth * 14 }}
            >
              <button
                className={`tree-toggle ${hasChildren ? "" : "empty"}`}
                aria-label={`${collapsed.has(doc.id) ? "展开" : "折叠"} ${doc.title}`}
                onClick={() =>
                  setCollapsed((s) => {
                    const next = new Set(s);
                    next.has(doc.id) ? next.delete(doc.id) : next.add(doc.id);
                    return next;
                  })
                }
              >
                {hasChildren ? (
                  collapsed.has(doc.id) ? (
                    <ChevronRight size={12} />
                  ) : (
                    <ChevronDown size={12} />
                  )
                ) : (
                  <span />
                )}
              </button>
              <button
                className="page-tree-link"
                onClick={() => openDocument(doc.id)}
              >
                <span className="page-emoji">{doc.icon}</span>
                <span>{doc.title || "无标题"}</span>
              </button>
              <button
                className="tree-add icon-button"
                aria-label={`在 ${doc.title} 下新建页面`}
                onClick={() => addDocument(undefined, doc.id)}
              >
                <Plus size={13} />
              </button>
            </div>
            {!collapsed.has(doc.id) && renderPageTree(doc.id, depth + 1)}
          </div>
        );
      });
  }

  const popup = (name: typeof menu, children: ReactNode, cls = "") =>
    menu === name ? (
      <>
        <div className="menu-shade" onClick={() => setMenu(null)} />
        <div className={`floating-menu ${cls}`}>{children}</div>
      </>
    ) : null;

  return (
    <div
      className={`app ${sidebar ? "" : "sidebar-hidden"} ${readOnly ? "reading" : ""}`}
    >
      <aside
        className="sidebar"
        aria-label="工作区导航"
        aria-hidden={!sidebar}
        inert={!sidebar}
      >
        <button
          className="workspace-brand"
          onClick={() => openDocument(visibleDocs[0].id)}
        >
          <span className="brand-mark">✳</span>
          <span>
            ShowAI<span className="brand-subtitle">a space for your mind</span>
          </span>
          <ChevronDown size={14} />
        </button>
        <div className="sidebar-primary">
          <button
            onClick={() => {
              setQuery("");
              setModal("search");
            }}
          >
            <Search size={16} />
            <span>搜索文档</span>
            <kbd>⌘ K</kbd>
          </button>
          <button onClick={() => setModal("templates")}>
            <LayoutTemplate size={16} />
            <span>模板空间</span>
            <span className="tiny-new">NEW</span>
          </button>
        </div>
        <div className="sidebar-section">
          <div className="section-label">收藏</div>
          {visibleDocs
            .filter((d) => d.favorite)
            .map((d) => (
              <button
                key={d.id}
                className="favorite-row"
                onClick={() => openDocument(d.id)}
              >
                <span>{d.icon}</span>
                <span>{d.title || "无标题"}</span>
              </button>
            ))}
          {!visibleDocs.some((d) => d.favorite) && (
            <p className="sidebar-empty">为常用文档加一颗星</p>
          )}
        </div>
        <div className="sidebar-section pages-section">
          <div className="section-label">
            我的空间
            <button
              className="icon-button"
              aria-label="新建页面"
              onClick={() => addDocument()}
            >
              <Plus size={15} />
            </button>
          </div>
          <nav>{renderPageTree()}</nav>
          <button className="add-page" onClick={() => addDocument()}>
            <Plus size={16} />
            新建页面
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="local-dot" />
            <div>
              灵感，安心留在这里<span>本地存储 · 无需登录</span>
            </div>
            <FolderOpen size={16} />
          </div>
          <button onClick={() => fileInput.current?.click()}>
            <Upload size={15} />
            导入文档
          </button>
          <button onClick={() => setModal("trash")}>
            <Trash2 size={15} />
            回收站
            {workspace.documents.filter((d) => d.archived).length > 0 && (
              <span className="count">
                {workspace.documents.filter((d) => d.archived).length}
              </span>
            )}
          </button>
          <div className="sidebar-footer">
            <span className="avatar">C</span>
            <span>个人工作区</span>
            <button
              className="icon-button"
              aria-label="使用帮助"
              onClick={() => setModal("help")}
            >
              <CircleHelp size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="收起侧边栏"
              onClick={() => setSidebar(false)}
            >
              <ChevronsLeft size={16} />
            </button>
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          className="mobile-sidebar-shade"
          aria-label="关闭导航"
          onClick={() => setSidebar(false)}
        />
      )}
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button"
              aria-label={sidebar ? "隐藏侧边栏" : "显示侧边栏"}
              onClick={() => setSidebar(!sidebar)}
            >
              <PanelLeft size={17} />
            </button>
            <span className="breadcrumb-space">我的空间</span>
            <ChevronRight size={13} />
            {active.parentId && (
              <>
                <button onClick={() => openDocument(active.parentId!)}>
                  {
                    workspace.documents.find((d) => d.id === active.parentId)
                      ?.title
                  }
                </button>
                <ChevronRight size={13} />
              </>
            )}
            <span className="breadcrumb-title">
              {active.icon} <span>{active.title || "无标题"}</span>
            </span>
          </div>
          <div className="topbar-actions">
            <span
              className={`save-state ${saveError ? "error" : ""}`}
              title={saveError || "修改已保存到当前浏览器"}
            >
              {saving ? <span className="saving-dot" /> : <Check size={12} />}
              <span>
                {saveError ? "保存异常" : saving ? "保存中" : "已保存"}
              </span>
            </span>
            <button
              className={`icon-button ${active.favorite ? "is-favorite" : ""}`}
              aria-label={active.favorite ? "取消收藏" : "收藏页面"}
              onClick={() => updateDoc({ favorite: !active.favorite })}
            >
              <Star
                size={17}
                fill={active.favorite ? "currentColor" : "none"}
              />
            </button>
            <button
              className={`icon-button ${rightPanel === "comments" ? "selected" : ""}`}
              aria-label="页面批注"
              onClick={() =>
                setRightPanel(rightPanel === "comments" ? null : "comments")
              }
            >
              <MessageSquare size={17} />
              {active.comments.filter((c) => !c.resolved).length > 0 && (
                <i className="notification-dot" />
              )}
            </button>
            <button
              className="export-button"
              onClick={() => setModal("export")}
            >
              <ArrowUpRight size={15} />
              导出
            </button>
            <div className="menu-anchor">
              <button
                className="icon-button"
                aria-label="页面菜单"
                onClick={() => setMenu(menu === "page" ? null : "page")}
              >
                <MoreHorizontal size={19} />
              </button>
              {popup(
                "page",
                <>
                  <div className="menu-caption">页面操作</div>
                  <button
                    onClick={() => {
                      if (!ensurePageCapacity()) return;
                      const doc = {
                        ...structuredClone(active),
                        id: crypto.randomUUID(),
                        title: active.title + " 副本",
                        favorite: false,
                        createdAt: new Date().toISOString(),
                      };
                      setWorkspace((w) => ({
                        ...w,
                        documents: [...w.documents, doc],
                        activeId: doc.id,
                      }));
                      setMenu(null);
                      setToast("页面已复制");
                    }}
                  >
                    <Copy size={15} />
                    复制页面
                  </button>
                  <button onClick={() => addDocument(undefined, active.id)}>
                    <FilePlus2 size={15} />
                    添加子页面
                  </button>
                  <button
                    onClick={() => {
                      saveSnapshot(active, true);
                      setMenu(null);
                    }}
                  >
                    <History size={15} />
                    保存当前版本<kbd>⌘ S</kbd>
                  </button>
                  <button
                    onClick={() => {
                      setModal("history");
                      setMenu(null);
                    }}
                  >
                    <Clock3 size={15} />
                    版本历史
                  </button>
                  <label className="menu-field">
                    移动到
                    <select
                      aria-label="页面位置"
                      value={active.parentId ?? ""}
                      onChange={(e) =>
                        updateDoc({ parentId: e.target.value || null })
                      }
                    >
                      <option value="">我的空间</option>
                      {visibleDocs
                        .filter((d) =>
                          canReparent(workspace.documents, active.id, d.id),
                        )
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}
                          </option>
                        ))}
                    </select>
                  </label>
                  <hr />
                  <button className="danger" onClick={archivePage}>
                    <Trash2 size={15} />
                    移至回收站
                  </button>
                </>,
              )}
            </div>
          </div>
        </header>
        {saveError && (
          <div className="storage-error" role="alert">
            {saveError}
            <button onClick={() => exportDocument("workspace")}>
              导出当前工作区
            </button>
            {saveBlocked.current && (
              <button
                onClick={() =>
                  downloadFile(
                    "ShowAI-recovery.json",
                    localStorage.getItem(STORAGE_KEY) ?? "",
                    "application/json",
                  )
                }
              >
                下载原始数据
              </button>
            )}
          </div>
        )}
        <div className="main-scroll">
          <div
            className={`document-layout ${workspace.wide ? "wide" : ""} font-${workspace.font}`}
          >
            <article className="document-page">
              {active.cover !== "none" && (
                <div className={`page-cover cover-${active.cover}`}>
                  <CoverArt />
                  <span className="cover-caption">
                    A LITTLE SPACE. ENDLESS POSSIBILITIES.
                  </span>
                  {!readOnly && (
                    <button
                      className="cover-edit"
                      onClick={() => setMenu("cover")}
                    >
                      更换封面
                    </button>
                  )}
                </div>
              )}
              <div className="document-inner">
                <div className="document-heading">
                  <div className="page-icon-row">
                    <div className="menu-anchor">
                      <button
                        className="page-icon"
                        aria-label="更换页面图标"
                        disabled={readOnly}
                        onClick={() => setMenu(menu === "icon" ? null : "icon")}
                      >
                        {active.icon}
                      </button>
                      {popup(
                        "icon",
                        <>
                          <div className="menu-caption">为页面选一个表情</div>
                          <div className="emoji-grid">
                            {[
                              "✳",
                              "📄",
                              "🔎",
                              "🧪",
                              "📚",
                              "💡",
                              "🌱",
                              "✍️",
                              "🧭",
                              "🔖",
                              "🎨",
                              "🪐",
                              "🧠",
                              "📊",
                              "🗂️",
                              "✨",
                              "📝",
                              "🌿",
                              "🚀",
                              "☕",
                            ].map((icon) => (
                              <button
                                key={icon}
                                onClick={() => {
                                  updateDoc({ icon });
                                  setMenu(null);
                                }}
                              >
                                {icon}
                              </button>
                            ))}
                          </div>
                        </>,
                        "icon-picker",
                      )}
                    </div>
                    <div className="page-heading-tools">
                      {!readOnly && active.cover === "none" && (
                        <button onClick={() => setMenu("cover")}>
                          添加封面
                        </button>
                      )}
                      <span>你的想法，在这里展开</span>
                    </div>
                  </div>
                  <div className="menu-anchor cover-picker-anchor">
                    {popup(
                      "cover",
                      <>
                        <div className="menu-caption">封面的颜色</div>
                        <div className="cover-options">
                          {["sage", "sand", "blue", "rose", "ink", "none"].map(
                            (cover) => (
                              <button
                                key={cover}
                                aria-label={`封面 ${cover}`}
                                className={`cover-option cover-${cover}`}
                                onClick={() => {
                                  updateDoc({ cover });
                                  setMenu(null);
                                }}
                              >
                                {cover === "none" ? (
                                  "无"
                                ) : active.cover === cover ? (
                                  <Check size={16} />
                                ) : null}
                              </button>
                            ),
                          )}
                        </div>
                      </>,
                      "cover-picker",
                    )}
                  </div>
                  <textarea
                    ref={titleInput}
                    maxLength={1000}
                    className="page-title"
                    aria-label="页面标题"
                    placeholder="无标题"
                    rows={1}
                    value={active.title}
                    readOnly={readOnly}
                    onChange={(e) =>
                      updateDoc({ title: e.target.value.replaceAll("\n", "") })
                    }
                    onInput={(e) => {
                      e.currentTarget.style.height = "auto";
                      e.currentTarget.style.height =
                        e.currentTarget.scrollHeight + "px";
                    }}
                    key={`title-${active.id}`}
                  />
                  <div className="document-meta">
                    <span className="meta-label">
                      <span className="meta-dot" />
                      个人笔记
                    </span>
                    <span className="meta-divider" />
                    <span>
                      {new Intl.DateTimeFormat("zh-CN", {
                        month: "long",
                        day: "numeric",
                      }).format(new Date(active.updatedAt))}{" "}
                      更新
                    </span>
                    <span className="meta-divider" />
                    <span>{wordCount.toLocaleString()} 字</span>
                  </div>
                </div>
                <div className="document-viewbar">
                  <div className="view-tab">
                    <FileText size={14} />
                    文档
                    <span />
                  </div>
                  <div className="view-actions">
                    <button
                      className={readOnly ? "active" : ""}
                      onClick={() => setReadOnly(!readOnly)}
                      title={readOnly ? "继续编辑" : "阅读模式"}
                    >
                      <BookOpen size={14} />
                      <span>{readOnly ? "继续编辑" : "阅读"}</span>
                    </button>
                    <div className="menu-anchor">
                      <button
                        aria-label="文档外观"
                        onClick={() =>
                          setMenu(menu === "appearance" ? null : "appearance")
                        }
                      >
                        <Settings2 size={14} />
                        <span>外观</span>
                      </button>
                      {popup(
                        "appearance",
                        <>
                          <div className="menu-caption">让阅读更舒服</div>
                          <div className="appearance-fonts">
                            {(["sans", "serif", "mono"] as const).map(
                              (font) => (
                                <button
                                  key={font}
                                  className={`${workspace.font === font ? "active" : ""} font-${font}`}
                                  onClick={() =>
                                    setWorkspace((w) => ({ ...w, font }))
                                  }
                                >
                                  <span>Aa</span>
                                  {
                                    {
                                      sans: "默认",
                                      serif: "衬线",
                                      mono: "等宽",
                                    }[font]
                                  }
                                </button>
                              ),
                            )}
                          </div>
                          <hr />
                          <button
                            onClick={() =>
                              setWorkspace((w) => ({ ...w, wide: !w.wide }))
                            }
                          >
                            <Maximize2 size={15} />
                            全宽显示
                            <span
                              className={`switch ${workspace.wide ? "on" : ""}`}
                            />
                          </button>
                          <button
                            onClick={() =>
                              setWorkspace((w) => ({
                                ...w,
                                theme: w.theme === "dark" ? "light" : "dark",
                              }))
                            }
                          >
                            {workspace.theme === "dark" ? (
                              <Sun size={15} />
                            ) : (
                              <Moon size={15} />
                            )}
                            深色模式
                            <span
                              className={`switch ${workspace.theme === "dark" ? "on" : ""}`}
                            />
                          </button>
                        </>,
                      )}
                    </div>
                    <button
                      className={rightPanel === "outline" ? "active" : ""}
                      aria-label="切换目录"
                      onClick={() =>
                        setRightPanel(
                          rightPanel === "outline" ? null : "outline",
                        )
                      }
                    >
                      <List size={15} />
                    </button>
                  </div>
                </div>
                <DocumentEditor
                  key={active.id}
                  content={active.content}
                  onChange={updateContent}
                  readOnly={readOnly}
                />
                <footer className="document-footer">
                  <span className="footer-flower">✳</span>
                  <span>给想法一点空间</span>
                  <span className="footer-line" />
                  <button onClick={() => setModal("help")}>
                    快捷键与帮助 <CircleHelp size={13} />
                  </button>
                </footer>
              </div>
            </article>
            {rightPanel && (
              <aside
                className={`right-panel ${rightPanel === "comments" ? "comments-panel" : ""}`}
                aria-label={rightPanel === "outline" ? "文档目录" : "页面批注"}
              >
                <div className="right-panel-heading">
                  <span>
                    {rightPanel === "outline" ? "本页目录" : "页面批注"}
                  </span>
                  <button
                    aria-label="关闭右侧栏"
                    className="icon-button"
                    onClick={() => setRightPanel(null)}
                  >
                    <X size={13} />
                  </button>
                </div>
                {rightPanel === "outline" ? (
                  <>
                    <nav>
                      {headings.length ? (
                        headings.map((h, i) => (
                          <button
                            key={i}
                            style={{
                              paddingLeft: 12 + Math.max(0, h.level - 2) * 12,
                            }}
                            onClick={() => {
                              document
                                .querySelectorAll(
                                  ".tiptap h1,.tiptap h2,.tiptap h3",
                                )
                                [i]?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "center",
                                });
                            }}
                          >
                            {h.title || "无标题"}
                          </button>
                        ))
                      ) : (
                        <p className="empty-outline">
                          添加标题后，目录会出现在这里。
                        </p>
                      )}
                    </nav>
                    <div className="margin-note">
                      <span>✧</span>
                      <p>
                        好的想法，
                        <br />
                        值得一个好看的家。
                      </p>
                      <small>MADE FOR YOUR MIND</small>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="panel-hint">记录你的想法与待核实的问题。</p>
                    <div className="comments-list">
                      {active.comments
                        .filter((c) => !c.resolved)
                        .map((c) => (
                          <div className="comment" key={c.id}>
                            <div>
                              <span className="avatar small">我</span>
                              <span>我的批注</span>
                              <button
                                className="icon-button"
                                aria-label="解决批注"
                                onClick={() =>
                                  updateDoc({
                                    comments: active.comments.map((item) =>
                                      item.id === c.id
                                        ? { ...item, resolved: true }
                                        : item,
                                    ),
                                  })
                                }
                              >
                                <Check size={14} />
                              </button>
                            </div>
                            <p>{c.text}</p>
                            <time>
                              {new Date(c.createdAt).toLocaleDateString(
                                "zh-CN",
                              )}
                            </time>
                          </div>
                        ))}
                    </div>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (comment.trim()) {
                          updateDoc({
                            comments: [
                              ...active.comments,
                              {
                                id: crypto.randomUUID(),
                                text: comment.trim(),
                                createdAt: new Date().toISOString(),
                                resolved: false,
                              },
                            ],
                          });
                          setComment("");
                        }
                      }}
                    >
                      <textarea
                        aria-label="新批注"
                        placeholder="写下你的想法…"
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                      />
                      <button
                        className="primary-button"
                        disabled={!comment.trim()}
                      >
                        添加批注
                      </button>
                    </form>
                    {active.comments.some((c) => c.resolved) && (
                      <details className="resolved-comments">
                        <summary>
                          已解决 (
                          {active.comments.filter((c) => c.resolved).length})
                        </summary>
                        {active.comments
                          .filter((c) => c.resolved)
                          .map((c) => (
                            <div key={c.id}>
                              <p>{c.text}</p>
                              <button
                                onClick={() =>
                                  updateDoc({
                                    comments: active.comments.map((x) =>
                                      x.id === c.id
                                        ? { ...x, resolved: false }
                                        : x,
                                    ),
                                  })
                                }
                              >
                                重新打开
                              </button>
                            </div>
                          ))}
                      </details>
                    )}
                  </>
                )}
              </aside>
            )}
          </div>
        </div>
      </main>
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept=".json,.md,.markdown,.txt"
        onChange={(e) => {
          if (e.target.files?.[0]) void importFile(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {modal === "search" && (
        <Modal
          title="搜索你的空间"
          onClose={closeModal}
          className="search-modal"
        >
          <div className="search-field">
            <Search size={20} />
            <input
              aria-label="搜索文档"
              placeholder="搜索标题和正文…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSearchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSearchIndex((i) => Math.min(i + 1, results.length - 1));
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSearchIndex((i) => Math.max(i - 1, 0));
                }
                if (e.key === "Enter" && results[searchIndex])
                  openDocument(results[searchIndex].id);
              }}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="search-results">
            {results.length ? (
              results.map((doc, index) => (
                <button
                  key={doc.id}
                  className={index === searchIndex ? "active" : ""}
                  onClick={() => openDocument(doc.id)}
                >
                  <span className="result-icon">{doc.icon}</span>
                  <div>
                    <strong>{doc.title || "无标题"}</strong>
                    <span>{plainText(doc.content).slice(0, 90)}</span>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))
            ) : (
              <div className="empty-state">
                <Search size={24} />
                <p>没有找到「{query}」</p>
                <button
                  className="text-button"
                  onClick={() => {
                    if (!ensurePageCapacity()) return;
                    const d = newDocument(query);
                    setWorkspace((w) => ({
                      ...w,
                      documents: [...w.documents, d],
                      activeId: d.id,
                    }));
                    setModal(null);
                  }}
                >
                  以此标题创建页面
                </button>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <span>↑ ↓ 选择</span>
            <span>↵ 打开页面</span>
            <span>{results.length} 个结果</span>
          </div>
        </Modal>
      )}
      {modal === "templates" && (
        <Modal
          title="每个好想法，都有一个开始"
          onClose={closeModal}
          className="templates-modal"
        >
          <p className="modal-description">
            选一张空白纸，或从一个熟悉的结构开始。
          </p>
          <div className="templates-grid">
            {(
              [
                {
                  key: undefined,
                  icon: "✳",
                  title: "空白页面",
                  description: "留出空间，自由开始",
                  className: "sage",
                },
                {
                  key: "research",
                  icon: "🔎",
                  title: "研究工作台",
                  description: "收集来源，组织证据与结论",
                  className: "sand",
                },
                {
                  key: "meeting",
                  icon: "📝",
                  title: "会议记录",
                  description: "从讨论到决定，清晰记录",
                  className: "blue",
                },
                {
                  key: "playground",
                  icon: "🧪",
                  title: "交互实验室",
                  description: "用参数与计算，让想法动起来",
                  className: "rose",
                },
              ] as const
            ).map((t) => (
              <button
                className="template-card"
                key={t.title}
                onClick={() => addDocument(t.key)}
              >
                <div className={`template-art cover-${t.className}`}>
                  <span>{t.icon}</span>
                  <div className="mini-lines">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
                <strong>
                  {t.title}
                  <ArrowUpRight size={17} />
                </strong>
                <p>{t.description}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {modal === "export" && (
        <Modal title="把想法，带去任何地方" onClose={closeModal}>
          <p className="modal-description">
            {active.icon} {active.title}
          </p>
          <div className="export-options">
            <button disabled={busy} onClick={() => void exportDocument("html")}>
              <span className="export-type">
                <ArrowUpRight size={21} />
              </span>
              <div>
                <strong>
                  交互式 HTML <span className="recommended">推荐</span>
                </strong>
                <p>独立网页，保留图表与交互，离线也能打开</p>
              </div>
              <ArrowDownToLine size={18} />
            </button>
            <button disabled={busy} onClick={() => void exportDocument("json")}>
              <span className="export-type">
                <FileJson size={21} />
              </span>
              <div>
                <strong>ShowAI 文档</strong>
                <p>完整保存区块与设置，可重新导入编辑</p>
              </div>
              <ArrowDownToLine size={18} />
            </button>
            <button disabled={busy} onClick={() => void exportDocument("md")}>
              <span className="export-type">
                <FileText size={21} />
              </span>
              <div>
                <strong>Markdown</strong>
                <p>便于迁移的文字格式，交互区块保存为数据代码块</p>
              </div>
              <ArrowDownToLine size={18} />
            </button>
          </div>
          <div className="modal-footer">
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void exportDocument("workspace")}
            >
              备份整个工作区
            </button>
            <button className="text-button" onClick={() => window.print()}>
              打印 / 保存 PDF
            </button>
          </div>
          {busy && (
            <p className="export-progress" role="status">
              正在打包文档与图片…
            </p>
          )}
        </Modal>
      )}
      {modal === "history" && (
        <Modal title="版本历史" onClose={closeModal}>
          {historyBlocked && (
            <div className="history-recovery" role="alert">
              <p>{historyLoad.error}</p>
              <button
                className="text-button"
                onClick={() =>
                  downloadFile(
                    "ShowAI-history-recovery.json",
                    historyLoad.raw,
                    "application/json",
                  )
                }
              >
                下载原始历史数据
              </button>
              <button
                className="text-button"
                onClick={() => {
                  downloadFile(
                    "ShowAI-history-recovery.json",
                    historyLoad.raw,
                    "application/json",
                  );
                  try {
                    localStorage.setItem(HISTORY_KEY, "{}");
                    setHistory({});
                    setHistoryBlocked(false);
                    setToast("原始历史已下载，可以重新保存版本");
                  } catch {
                    setToast("历史记录仍无法写入，请检查浏览器存储空间");
                  }
                }}
              >
                备份并重建历史
              </button>
            </div>
          )}

          <p className="modal-description">
            切换页面时自动保存快照，也可以按 ⌘ S 保存。每页保留最近 15 个版本。
          </p>
          <button
            className="primary-button history-save"
            onClick={() => saveSnapshot(active, true)}
          >
            <Plus size={15} />
            保存当前版本
          </button>
          <div className="history-list">
            {(history[active.id] ?? []).map((snapshot, index) => (
              <div key={snapshot.savedAt + index}>
                <span>
                  <Clock3 size={17} />
                </span>
                <div>
                  <strong>{snapshot.document.title}</strong>
                  <small>
                    {new Date(snapshot.savedAt).toLocaleString("zh-CN")}
                  </small>
                  <p>{plainText(snapshot.document.content).slice(0, 70)}</p>
                </div>
                <button
                  onClick={() => {
                    saveSnapshot(active);
                    updateDoc({
                      content: snapshot.document.content,
                      title: snapshot.document.title,
                      icon: snapshot.document.icon,
                      cover: snapshot.document.cover,
                      comments: snapshot.document.comments,
                    });
                    setModal(null);
                    setToast("版本已恢复，恢复前的内容也已保存");
                  }}
                >
                  恢复
                </button>
              </div>
            ))}
            {!history[active.id]?.length && (
              <div className="empty-state">
                <History size={25} />
                <p>还没有保存的版本</p>
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal === "trash" && (
        <Modal title="回收站" onClose={closeModal}>
          <p className="modal-description">
            移除的页面会保留在这里，恢复后可以继续编辑。
          </p>
          <div className="trash-list">
            {workspace.documents
              .filter((d) => d.archived)
              .map((doc) => (
                <div key={doc.id}>
                  <span>{doc.icon}</span>
                  <strong>{doc.title}</strong>
                  <button
                    onClick={() => {
                      const ids = descendants(doc.id);
                      setWorkspace((w) => ({
                        ...w,
                        documents: w.documents.map((d) =>
                          ids.includes(d.id)
                            ? {
                                ...d,
                                archived: false,
                                parentId: d.id === doc.id ? null : d.parentId,
                              }
                            : d,
                        ),
                      }));
                      setToast("页面已恢复");
                    }}
                  >
                    <ArrowLeft size={14} />
                    恢复
                  </button>
                </div>
              ))}
            {!workspace.documents.some((d) => d.archived) && (
              <div className="empty-state">
                <Trash2 size={26} />
                <p>回收站是空的</p>
                <small>你的想法都好好地待在原处。</small>
              </div>
            )}
          </div>
          {workspace.documents.some((d) => d.archived) && (
            <div className="modal-footer">
              {confirmPurge ? (
                <>
                  <span>永久删除回收站中的页面与历史？</span>
                  <button
                    className="text-button"
                    onClick={() => setConfirmPurge(false)}
                  >
                    取消
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => {
                      const ids = new Set(
                        workspace.documents
                          .filter((d) => d.archived)
                          .map((d) => d.id),
                      );
                      const nextHistory = Object.fromEntries(
                        Object.entries(history).filter(([id]) => !ids.has(id)),
                      );
                      try {
                        localStorage.setItem(
                          HISTORY_KEY,
                          JSON.stringify(nextHistory),
                        );
                        setHistory(nextHistory);
                        setWorkspace((w) => ({
                          ...w,
                          documents: w.documents.filter((d) => !d.archived),
                        }));
                        setConfirmPurge(false);
                        setToast("回收站已清空");
                      } catch {
                        setToast("清空失败，请先导出工作区备份");
                      }
                    }}
                  >
                    确认永久删除
                  </button>
                </>
              ) : (
                <button
                  className="text-button danger"
                  onClick={() => setConfirmPurge(true)}
                >
                  清空回收站
                </button>
              )}
            </div>
          )}
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="随手写，慢慢探索" onClose={closeModal}>
          <p className="modal-description">常用操作就在手边。</p>
          <dl className="shortcut-list">
            <div>
              <dt>搜索全部文档</dt>
              <dd>⌘ / Ctrl + K</dd>
            </div>
            <div>
              <dt>显示或隐藏侧边栏</dt>
              <dd>⌘ / Ctrl + \</dd>
            </div>
            <div>
              <dt>保存版本快照</dt>
              <dd>⌘ / Ctrl + S</dd>
            </div>
            <div>
              <dt>插入区块</dt>
              <dd>/</dd>
            </div>
            <div>
              <dt>加粗 / 斜体</dt>
              <dd>⌘ + B / I</dd>
            </div>
            <div>
              <dt>撤销 / 重做</dt>
              <dd>⌘ + Z / ⇧ Z</dd>
            </div>
            <div>
              <dt>Markdown 标题 / 列表 / 引用</dt>
              <dd>## / - / &gt; + 空格</dd>
            </div>
          </dl>
          <p className="help-note">
            ShowAI 将数据保存在当前浏览器。建议定期导出工作区备份；导出的 HTML
            是可交互的阅读版本，JSON 文档可导入后继续编辑。
          </p>
        </Modal>
      )}
    </div>
  );
}
