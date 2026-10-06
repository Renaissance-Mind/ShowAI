import { flushSync } from "react-dom";
import { MAX_ARTIFACT_BYTES } from "../portable/validation.mjs";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { JSONContent } from "@tiptap/core";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Maximize2,
  MousePointer2,
  Pencil,
  Square,
  Circle,
  ArrowUpRight,
  Plus,
  X,
  Undo2,
  Redo2,
} from "lucide-react";
import type { ContainerDocument, ShowDocument } from "../types";
import type { DrawingTool, NodeLayout, SurfaceKind } from "./types";
import {
  SurfaceContent,
  nodeName,
  type ContentRenderer,
} from "./SurfaceContent";
import PageSurface, { type SurfaceHandle } from "./PageSurface";
import { ObjectContext, type ObjectActions } from "./SurfaceObject";
import {
  addNode,
  createRegion,
  editNode,
  moveNode,
  removeNode,
} from "./editing";
import {
  findSurfaceNode,
  nodePaths,
  reconcileSurface,
  visitNodes,
} from "./document.mjs";
import {
  createSurface,
  resourceNodes,
  surfaceKind,
  surfaceViews,
  wrapSurface,
} from "./containers.mjs";
import "./containers.css";

type AddKind = SurfaceKind | "flow" | "grid" | "free" | "text" | "image";
interface Runtime {
  document: ContainerDocument;
  current: RefObject<ContainerDocument>;
  commit: (next: ShowDocument) => void;
  readOnly: boolean;
  printing: boolean;
  selected: string | null;
  select: (id: string | null) => void;
  inspect: (id: string) => void;
  expand: (id: string) => void;
  active: string;
  activate: (id: string) => void;
  render: ContentRenderer;
  scrolls: Map<string, number>;
  revealRequest: string | null;
  requestReveal: (id: string | null) => void;
}
const Context = createContext<Runtime>(null!);
export function ContainerRuntime({
  document,
  onChange,
  renderContent,
  header,
  revealId,
  onRevealHandled,
  undo,
  redo,
  canUndo = false,
  canRedo = false,
  reading = false,
  hideTitle = false,
  onActiveSurfaceChange,
}: {
  document: ContainerDocument;
  onChange?: (next: ShowDocument) => void;
  renderContent: ContentRenderer;
  header?: ReactNode;
  revealId?: string | null;
  onRevealHandled?: () => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  reading?: boolean;
  hideTitle?: boolean;
  onActiveSurfaceChange?: (id: string) => void;
}) {
  const current = useRef(document);
  current.current = document;
  const [selected, select] = useState<string | null>(null),
    [inspecting, inspect] = useState<string | null>(null),
    [expanded, expand] = useState<string | null>(null),
    [active, activate] = useState(document.content.attrs!.id),
    [revealRequest, requestReveal] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const media = matchMedia("print");
    const before = () => flushSync(() => setPrinting(true)),
      after = () => setPrinting(false),
      changed = () => setPrinting(media.matches);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    media.addEventListener("change", changed);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      media.removeEventListener("change", changed);
    };
  }, []);
  const scrolls = useRef(new Map<string, number>());
  useEffect(() => {
    onActiveSurfaceChange?.(active);
  }, [active, document.id]);
  const paths = useMemo(() => nodePaths(document), [document.content]);
  const target = expanded
    ? findSurfaceNode(document, expanded)?.node
    : undefined;
  const root = target?.type === "surface" ? target : document.content;
  const chain = [...(paths[root.attrs!.id] ?? []), root.attrs!.id]
    .map((id) => findSurfaceNode(document, id)?.node)
    .filter((node) => node?.type === "surface") as JSONContent[];
  const focusSurface = (id: string) => {
    expand(id === document.content.attrs!.id ? null : id);
    activate(id);
    select(null);
    inspect(null);
  };
  useEffect(() => {
    if (expanded && !target) focusSurface(document.content.attrs!.id);
  }, [expanded, !!target]);
  useEffect(() => {
    if (!revealId) return;
    requestReveal(revealId);
    select(revealId);
    const ancestors = paths[revealId] ?? [];
    const owner = [...ancestors]
      .reverse()
      .find((id) => findSurfaceNode(document, id)?.node.type === "surface");
    if (owner) {
      activate(owner);
      expand(owner === document.content.attrs!.id ? null : owner);
    }
    onRevealHandled?.();
  }, [revealId]);
  const runtime: Runtime = {
    document,
    current,
    commit: (next) => {
      current.current = next as ContainerDocument;
      onChange?.(next);
    },
    readOnly: !onChange,
    printing,
    selected,
    select,
    inspect,
    expand: focusSurface,
    active,
    activate,
    render: renderContent,
    scrolls: scrolls.current,
    revealRequest,
    requestReveal,
  };
  const selectedEntry = inspecting
    ? findSurfaceNode(document, inspecting)
    : undefined;
  const frame = inspecting ? document.layout[inspecting] : undefined;
  const updateFrame = (value: NodeLayout) =>
    runtime.commit(
      reconcileSurface({
        ...current.current,
        layout: { ...current.current.layout, [inspecting!]: value },
      }),
    );
  return (
    <Context.Provider value={runtime}>
      <div
        className="container-workspace"
        data-resource-id={document.id}
        onKeyDown={(event) => {
          if (event.defaultPrevented || event.nativeEvent.isComposing) return;
          if (
            event.key === "Escape" &&
            !(event.target as Element).closest("input,textarea,select")
          ) {
            if (inspecting) {
              inspect(null);
              return;
            }
            if (active !== root.attrs!.id) {
              activate(root.attrs!.id);
              return;
            }
            if (chain.length > 1) focusSurface(chain.at(-2)!.attrs!.id);
          }
        }}
      >
        {(!runtime.readOnly || chain.length > 1) && (
          <div className="container-workspace-bar" data-surface-ui>
            <nav aria-label="内容层级">
              {chain.map((node, index) => (
                <span key={node.attrs!.id}>
                  {index > 0 && <ChevronRight size={13} />}
                  <button
                    type="button"
                    aria-current={node === root ? "page" : undefined}
                    onClick={() => focusSurface(node.attrs!.id)}
                  >
                    {surfaceKind(node) === "page" ? (
                      <FileText size={14} />
                    ) : (
                      <LayoutDashboard size={14} />
                    )}
                    <span>
                      {index === 0
                        ? (!hideTitle && document.title) ||
                          (surfaceKind(node) === "page" && "Page") ||
                          "Board"
                        : nodeName(node)}
                    </span>
                  </button>
                </span>
              ))}
            </nav>
            {chain.length > 1 && (
              <button
                type="button"
                onClick={() => focusSurface(chain.at(-2)!.attrs!.id)}
              >
                <ArrowLeft size={14} />
                返回上层
              </button>
            )}
            {onChange && (
              <>
                <button
                  type="button"
                  aria-label="撤销操作"
                  disabled={!canUndo}
                  onClick={undo}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  type="button"
                  aria-label="重做操作"
                  disabled={!canRedo}
                  onClick={redo}
                >
                  <Redo2 size={15} />
                </button>
                <details className="container-menu">
                  <summary aria-label="容器操作">
                    {surfaceKind(root) === "page" ? "Page" : "Board"} ▾
                  </summary>
                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = wrapSurface(
                          current.current,
                          root.attrs!.id,
                          "board",
                        );
                        runtime.commit(next);
                        focusSurface(
                          findSurfaceNode(next, root.attrs!.id)?.parent?.attrs
                            ?.id ?? next.content.attrs!.id,
                        );
                      }}
                    >
                      放入 Board
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = wrapSurface(
                          current.current,
                          root.attrs!.id,
                          "page",
                        );
                        runtime.commit(next);
                        focusSurface(
                          findSurfaceNode(next, root.attrs!.id)?.parent?.attrs
                            ?.id ?? next.content.attrs!.id,
                        );
                      }}
                    >
                      放入 Page
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        )}
        <div className="container-main">
          <ContainerView
            key={root.attrs!.id}
            node={root}
            root
            header={
              root === document.content ? header : <h1>{nodeName(root)}</h1>
            }
            reading={reading}
          />
        </div>
        {selectedEntry && (
          <aside
            className="surface-inspector container-inspector"
            data-surface-ui
            aria-label="模块设置"
          >
            <header>
              <strong>模块设置</strong>
              <button
                type="button"
                aria-label="关闭模块设置"
                onClick={() => inspect(null)}
              >
                <X size={16} />
              </button>
            </header>
            <label>
              名称
              <input
                aria-label="模块名称"
                value={
                  selectedEntry.node.attrs?.name ?? nodeName(selectedEntry.node)
                }
                maxLength={200}
                onChange={(event) =>
                  runtime.commit(
                    editNode(current.current, inspecting!, (node) => {
                      node.attrs = { ...node.attrs, name: event.target.value };
                    }),
                  )
                }
              />
            </label>
            {selectedEntry.node.type === "region" && (
              <label>
                排列
                <select
                  aria-label="区域布局"
                  value={frame?.mode ?? "flow"}
                  onChange={(event) =>
                    updateFrame({
                      ...frame!,
                      mode: event.target.value as NodeLayout["mode"],
                    })
                  }
                >
                  <option value="flow">顺序</option>
                  <option value="grid">网格</option>
                  <option value="free">自由</option>
                </select>
              </label>
            )}
            {frame?.mode === "grid" && (
              <label>
                列数
                <input
                  aria-label="网格列数"
                  type="number"
                  min={1}
                  max={12}
                  value={frame.columns ?? 2}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isInteger(value) && value >= 1 && value <= 12)
                      updateFrame({ ...frame, columns: value });
                  }}
                />
              </label>
            )}
            {frame && (
              <>
                <label>
                  宽度
                  <input
                    aria-label="模块宽度"
                    type="number"
                    min={120}
                    max={10000}
                    value={Math.round(frame.width)}
                    onChange={(event) => {
                      const width = Number(event.target.value);
                      if (width >= 120 && width <= 10000)
                        updateFrame({ ...frame, width });
                    }}
                  />
                </label>
                {selectedEntry.node.type === "surface" && (
                  <>
                    <label>
                      高度方式
                      <select
                        aria-label="模块高度方式"
                        value={frame.heightMode ?? "fixed"}
                        onChange={(event) =>
                          updateFrame({
                            ...frame,
                            heightMode: event.target.value as "fixed" | "auto",
                          })
                        }
                      >
                        <option value="fixed">固定窗口</option>
                        {surfaceKind(selectedEntry.node) === "page" && (
                          <option value="auto">随内容增长</option>
                        )}
                      </select>
                    </label>
                    {frame.heightMode !== "auto" && (
                      <label>
                        高度
                        <input
                          aria-label="模块高度"
                          type="number"
                          min={180}
                          max={5000}
                          value={frame.height ?? 460}
                          onChange={(event) => {
                            const height = Number(event.target.value);
                            if (height >= 180 && height <= 5000)
                              updateFrame({ ...frame, height });
                          }}
                        />
                      </label>
                    )}
                  </>
                )}
              </>
            )}
            <label>
              所属容器
              <select
                aria-label="所属容器"
                value={selectedEntry.parent?.attrs?.id ?? ""}
                onChange={(event) => {
                  const parentId = event.target.value;
                  runtime.commit(
                    moveNode(current.current, inspecting!, parentId, {
                      ...(frame ?? { width: 640 }),
                      x: 0,
                      y: 0,
                    }),
                  );
                  inspect(null);
                  focusSurface(parentId);
                  requestReveal(inspecting);
                }}
              >
                {containerOptions(document, inspecting!).map((node) => (
                  <option key={node.attrs!.id} value={node.attrs!.id}>
                    {node === document.content ? "根 " : ""}
                    {nodeName(node)}
                  </option>
                ))}
              </select>
            </label>
            <div className="surface-inspector-actions">
              {[-1, 1].map((delta) => (
                <button
                  type="button"
                  key={delta}
                  onClick={() => {
                    const entry = findSurfaceNode(
                        current.current,
                        inspecting!,
                      )!,
                      parent = entry.parent!;
                    const index = parent.content!.indexOf(entry.node);
                    const next = moveNode(
                      current.current,
                      inspecting!,
                      parent.attrs?.id,
                      undefined,
                      Math.max(
                        0,
                        Math.min(parent.content!.length - 1, index + delta),
                      ),
                    );
                    const newParent = findSurfaceNode(
                      next,
                      parent.attrs!.id,
                    )!.node;
                    const views = next.surfaceViews![parent.attrs!.id];
                    if (views)
                      views.readingOrder = newParent.content!.map(
                        (node) => node.attrs!.id,
                      );
                    runtime.commit(next);
                  }}
                >
                  {delta < 0 ? "向前排列" : "向后排列"}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                runtime.commit(removeNode(current.current, inspecting!));
                inspect(null);
                select(null);
              }}
            >
              删除模块
            </button>
          </aside>
        )}
      </div>
    </Context.Provider>
  );
}
function containerOptions(document: ShowDocument, id: string) {
  const excluded = new Set<string>();
  const target = findSurfaceNode(document, id)?.node;
  if (target)
    visitNodes(target, (n) => {
      if (n.attrs?.id) excluded.add(n.attrs.id);
    });
  const result: JSONContent[] = [];
  visitNodes(document.content, (node) => {
    if (
      ["surface", "region"].includes(node.type ?? "") &&
      !excluded.has(node.attrs!.id)
    )
      result.push(node);
  });
  if (target?.type === "drawing")
    return result.filter((node) => {
      let owner: JSONContent | undefined = node;
      while (owner && owner.type !== "surface")
        owner = findSurfaceNode(document, owner.attrs!.id)?.parent ?? undefined;
      return owner?.attrs?.kind === "board";
    });
  return result;
}
function ContainerView({
  node,
  root = false,
  header,
  reading = false,
}: {
  node: JSONContent;
  root?: boolean;
  header?: ReactNode;
  reading?: boolean;
}) {
  const runtime = useContext(Context),
    id = node.attrs!.id,
    kind = surfaceKind(node),
    readOnly = runtime.readOnly;
  const file = useRef<HTMLInputElement>(null),
    imageTicket = useRef(0);
  const [fileError, setFileError] = useState("");
  useEffect(
    () => () => {
      imageTicket.current++;
    },
    [],
  );
  const viewport = useRef<SurfaceHandle>(null),
    page = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<DrawingTool | null>(null),
    [color, setColor] = useState("#252629");
  const enabled = root || runtime.active === id;
  const persistKey = `showai.page-scroll.v3:${runtime.document.id}:${id}:${root ? "expanded" : "embedded"}`;
  useLayoutEffect(() => {
    const element = page.current;
    if (!element) return;
    const saved = runtime.scrolls.get(persistKey) ?? readScroll(persistKey);
    if (Number.isFinite(saved)) element.scrollTop = saved;
    return () => {
      runtime.scrolls.set(persistKey, element.scrollTop);
      writeScroll(persistKey, element.scrollTop);
    };
  }, [persistKey]);
  useLayoutEffect(() => {
    if (!runtime.printing && page.current && runtime.scrolls.has(persistKey))
      page.current.scrollTop = runtime.scrolls.get(persistKey)!;
  }, [runtime.printing, persistKey]);
  useEffect(() => {
    const target = runtime.revealRequest;
    if (
      !target ||
      !(node.content ?? []).some((child) => child.attrs?.id === target)
    )
      return;
    if (kind === "board" && !reading) viewport.current?.reveal(target);
    else
      requestAnimationFrame(() =>
        page.current
          ?.querySelector(
            `[data-surface-id="${CSS.escape(target)}"],[data-block-id="${CSS.escape(target)}"]`,
          )
          ?.scrollIntoView({ block: "nearest" }),
      );
    runtime.requestReveal(null);
  }, [runtime.revealRequest]);
  const insert = (kind: AddKind) => {
    if (kind === "image") {
      file.current?.click();
      return;
    }
    const document = runtime.current.current;
    const parent = findSurfaceNode(document, id)?.node;
    if (!parent) return;
    let child: JSONContent, frame: NodeLayout;
    if (kind === "page" || kind === "board") {
      child = createSurface(kind);
      frame = {
        x: 0,
        y: 0,
        width: 760,
        height: 460,
        heightMode:
          kind === "page" && surfaceKind(node) === "page" ? "auto" : "fixed",
      };
    } else if (["flow", "grid", "free"].includes(kind)) {
      const region = createRegion("内容区域", kind as "flow" | "grid" | "free");
      child = region.node;
      frame = region.frame;
    } else {
      child = {
        type: "richText",
        attrs: { id: crypto.randomUUID(), name: "文本" },
        content: [{ type: "paragraph" }],
      };
      frame = { x: 0, y: 0, width: 420 };
    }
    if (surfaceKind(parent) === "board")
      frame.x = Math.max(
        0,
        ...(parent.content ?? []).map((child) => {
          const f = document.layout[child.attrs!.id];
          return f ? f.x + f.width + 48 : 0;
        }),
      );
    runtime.commit(addNode(document, child, frame, id));
    runtime.select(child.attrs!.id);
    runtime.activate(id);
    runtime.requestReveal(child.attrs!.id);
  };
  const actions: ObjectActions = {
    scale: 1,
    selected: runtime.selected,
    select: runtime.select,
    inspect: runtime.inspect,
    expand: runtime.expand,
    readOnly,
    revealAll: kind === "page" || reading,
    revealed: new Set(),
    move: readOnly
      ? undefined
      : (nodeId, frame) =>
          runtime.commit(
            reconcileSurface({
              ...runtime.current.current,
              layout: { ...runtime.current.current.layout, [nodeId]: frame },
            }),
          ),
    remove: readOnly
      ? undefined
      : (nodeId) => {
          runtime.commit(removeNode(runtime.current.current, nodeId));
          runtime.select(null);
        },
    addText: readOnly
      ? undefined
      : (parentId) =>
          runtime.commit(
            addNode(
              runtime.current.current,
              {
                type: "richText",
                attrs: { id: crypto.randomUUID(), name: "文本" },
                content: [{ type: "paragraph" }],
              },
              { x: 0, y: 0, width: 360 },
              parentId,
            ),
          ),
  };
  const renderSurface = (child: JSONContent) => <ContainerView node={child} />;
  const addMenu = !readOnly && (
    <>
      <details className="container-menu">
        <summary aria-label={`添加到 ${nodeName(node)}`}>
          <Plus size={14} />
          添加
        </summary>
        <div>
          {(
            [
              ["page", "Page 页面"],
              ["board", "Board 白板"],
              ["text", "文本"],
              ["image", "图片"],
              ["flow", "顺序分组"],
              ["grid", "网格分组"],
              ["free", "自由分组"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={(event) => {
                insert(value);
                event.currentTarget.closest("details")!.open = false;
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </details>
      <input
        ref={file}
        type="file"
        className="hidden"
        aria-label="添加图片文件"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        onChange={(event) => {
          const image = event.target.files?.[0];
          event.target.value = "";
          if (!image) return;
          if (
            image.size > 8 * 1024 * 1024 ||
            !/^image\/(png|jpeg|webp|gif|avif)$/.test(image.type)
          ) {
            setFileError("请选择 8 MB 以内的常见图片文件。");
            return;
          }
          const ticket = ++imageTicket.current,
            reader = new FileReader();
          reader.onerror = () => {
            if (ticket === imageTicket.current) setFileError("图片读取失败。");
          };
          reader.onload = () => {
            if (
              ticket !== imageTicket.current ||
              !findSurfaceNode(runtime.current.current, id)
            )
              return;
            const before = runtime.current.current;
            if (
              new TextEncoder().encode(JSON.stringify(before)).length +
                String(reader.result).length +
                4096 >
              MAX_ARTIFACT_BYTES
            ) {
              setFileError("图片会超出页面的 10 MB 保存上限，请先缩小图片。");
              return;
            }
            const parent = findSurfaceNode(before, id)!.node;
            const x =
              kind === "board"
                ? Math.max(
                    0,
                    ...(parent.content ?? []).map((node) => {
                      const frame = before.layout[node.attrs!.id];
                      return frame ? frame.x + frame.width + 48 : 0;
                    }),
                  )
                : 0;
            const node = {
              type: "image",
              attrs: {
                id: crypto.randomUUID(),
                name: image.name.slice(0, 200),
                alt: image.name,
                src: reader.result,
              },
            };
            runtime.commit(addNode(before, node, { x, y: 0, width: 480 }, id));
            runtime.select(node.attrs.id);
            runtime.requestReveal(node.attrs.id);
            setFileError("");
          };
          reader.readAsDataURL(image);
        }}
      />
      {fileError && (
        <span className="container-file-error" role="alert">
          {fileError}
          <button type="button" onClick={() => setFileError("")}>
            关闭
          </button>
        </span>
      )}
    </>
  );
  if (kind === "page" || reading)
    return (
      <ObjectContext.Provider value={actions}>
        <div
          ref={page}
          className={`container-page${root ? " is-root" : ""}${reading ? " is-reading-projection" : ""}`}
          data-container-root={id}
          data-input-surface={id}
          aria-label={`Page ${nodeName(node)}`}
          onScroll={(event) => {
            if (!runtime.printing && !matchMedia("print").matches)
              runtime.scrolls.set(persistKey, event.currentTarget.scrollTop);
          }}
          onPointerDownCapture={(event) => {
            if (
              (event.target as Element).closest("[data-container-root]") ===
              event.currentTarget
            )
              runtime.activate(id);
          }}
        >
          <div className="container-page-column">
            {header && <div className="container-page-heading">{header}</div>}
            <SurfaceContent
              document={runtime.document}
              container={node}
              spatial={!reading}
              renderContent={runtime.render}
              renderSurface={renderSurface}
            />
            {!readOnly && (
              <div className="container-page-add" data-surface-ui>
                {addMenu}
              </div>
            )}
          </div>
        </div>
      </ObjectContext.Provider>
    );
  return (
    <div
      className={`container-board${root ? " is-root" : ""}${enabled ? " is-active" : ""}`}
      data-container-root={id}
      aria-label={`Board ${nodeName(node)}`}
    >
      {!root && (
        <div className="container-activation" data-surface-ui>
          <button
            type="button"
            aria-pressed={enabled}
            onClick={() =>
              runtime.activate(
                enabled ? runtime.document.content.attrs!.id : id,
              )
            }
          >
            {enabled ? "结束操作" : "操作白板"}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={() => {
                runtime.activate(id);
                setTool("pen");
              }}
            >
              <Pencil size={13} />
              绘画
            </button>
          )}
        </div>
      )}
      <div className={`container-board-scene${enabled ? "" : " is-passive"}`}>
        <PageSurface
          ref={viewport}
          pageId={`${runtime.document.id}:${id}:${root ? "expanded" : "embedded"}`}
          enabled={enabled}
          printing={runtime.printing}
          nodes={resourceNodes(runtime.document, node).map((child) => ({
            id: child.attrs!.id,
            name: nodeName(child),
          }))}
          layoutKey={JSON.stringify(runtime.document.layout)}
          paths={nodePaths({ ...runtime.document, content: node })}
          views={surfaceViews(runtime.document, node)}
          header={header}
          selected={runtime.selected}
          onSelect={runtime.select}
          onInspect={runtime.inspect}
          onExpand={runtime.expand}
          onMove={actions.move}
          onRemove={actions.remove}
          onAddText={actions.addText}
          onViews={
            readOnly
              ? undefined
              : (views) =>
                  runtime.commit({
                    ...runtime.current.current,
                    surfaceViews: {
                      ...runtime.current.current.surfaceViews,
                      [id]: views,
                    },
                  })
          }
          drawTool={tool}
          drawColor={color}
          onDrawExit={() => setTool(null)}
          onDraw={
            readOnly
              ? undefined
              : (drawing, frame) =>
                  runtime.commit(
                    addNode(runtime.current.current, drawing, frame, id),
                  )
          }
          extraActions={
            <>
              {addMenu}
              {!readOnly && (
                <>
                  <span className="surface-toolbar-divider" />
                  <button
                    type="button"
                    aria-label="选择工具"
                    aria-pressed={!tool}
                    onClick={() => setTool(null)}
                  >
                    <MousePointer2 size={15} />
                  </button>
                  {(
                    [
                      ["pen", "画笔", Pencil],
                      ["rectangle", "矩形", Square],
                      ["ellipse", "椭圆", Circle],
                      ["arrow", "箭头", ArrowUpRight],
                    ] as const
                  ).map(([value, label, Icon]) => (
                    <button
                      type="button"
                      key={value}
                      aria-label={label}
                      aria-pressed={tool === value}
                      onClick={() => {
                        runtime.activate(id);
                        setTool(value);
                      }}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                  <input
                    className="board-pen-color"
                    type="color"
                    aria-label="画笔颜色"
                    value={color}
                    onChange={(event) => setColor(event.target.value)}
                  />
                </>
              )}
            </>
          }
        >
          <SurfaceContent
            document={runtime.document}
            container={node}
            renderContent={runtime.render}
            renderSurface={renderSurface}
          />
        </PageSurface>
      </div>
      {!enabled && (
        <button
          className="container-board-enter"
          aria-label={`进入 ${nodeName(node)}`}
          onClick={() => runtime.activate(id)}
        >
          <Maximize2 size={15} />
          点击操作白板
        </button>
      )}
    </div>
  );
}

function readScroll(key: string) {
  try {
    return Number(localStorage.getItem(key) || 0);
  } catch {
    return 0;
  }
}
function writeScroll(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Personal view storage may be unavailable in an opaque inline host. */
  }
}
