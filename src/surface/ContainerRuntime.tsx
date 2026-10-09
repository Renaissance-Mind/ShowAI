import { SurfaceGeometryStore } from "./geometry-store";
import {
  transformObjects,
  duplicateObjects,
  removeObjects,
} from "./board-commands";
import {
  reconcileConnections,
  arrowEndpoints,
  arrowFromEndpoints,
  bindingAtPoint,
} from "./connections.mjs";
import type { EditorControls } from "./EditorControls";
import { AdditionalComponentsProvider } from "../components/custom/CustomBlock";
import type { CompiledComponent } from "../components/custom/types";
import { flushSync } from "react-dom";
import { ComponentSlashMenu } from "../components/ComponentSlashMenu";
import { RegisterComponentContext } from "../components/useComponentCatalog";
import { insertComponent } from "./component-insertion";
import {
  createContext,
  useContext,
  useCallback,
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
  LayoutDashboard,
  MousePointer2,
  Pencil,
  Square,
  Circle,
  ArrowUpRight,
  X,
} from "../ui/icons";
import type { ContainerDocument, ShowDocument } from "../types";
import type { DrawingTool, NodeLayout, PageWidthMode } from "./types";
import {
  SurfaceContent,
  nodeName,
  type ContentRenderer,
} from "./SurfaceContent";
import PageSurface, { type SurfaceHandle } from "./PageSurface";
import { ObjectContext, type ObjectActions } from "./SurfaceObject";
import { addNode, editNode, moveNode, removeNode } from "./editing";
import {
  findSurfaceNode,
  nodePaths,
  reconcileSurface,
  visitNodes,
} from "./document.mjs";
import {
  resourceNodes,
  surfaceKind,
  surfaceViews,
  wrapSurface,
} from "./containers.mjs";
import "./containers.css";
import PageIcon from "../components/PageIcon";
import PageIconDialog from "../studio/PageIconDialog";
import { PageWidthSwitch } from "./PageWidthSwitch";

interface Runtime {
  geometry: SurfaceGeometryStore;
  document: ContainerDocument;
  current: RefObject<ContainerDocument>;
  commit: (next: ShowDocument) => void;
  readOnly: boolean;
  printing: boolean;
  pageWidthModes: boolean;
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
  document: sourceDocument,
  geometry: suppliedGeometry,
  onChange,
  renderContent,
  header,
  revealId,
  revealInPlace,
  onRevealHandled,
  undo,
  redo,
  canUndo = false,
  canRedo = false,
  reading = false,
  hideTitle = false,
  pageWidthModes = false,
  onActiveSurfaceChange,
  onControlsChange,
}: {
  document: ContainerDocument;
  geometry?: SurfaceGeometryStore;
  onChange?: (next: ShowDocument) => void;
  renderContent: ContentRenderer;
  header?: ReactNode;
  revealId?: string | null;
  revealInPlace?: string | null;
  onRevealHandled?: () => void;
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  reading?: boolean;
  hideTitle?: boolean;
  /** App editors opt in; exported readers retain their existing width. */
  pageWidthModes?: boolean;
  onActiveSurfaceChange?: (id: string) => void;
  onControlsChange?: (controls: EditorControls | null) => void;
}) {
  const document = useMemo(
    () => reconcileConnections({ ...sourceDocument }),
    [sourceDocument],
  );
  const localGeometry = useMemo(
    () => new SurfaceGeometryStore(),
    [document.id],
  );
  const geometry = suppliedGeometry ?? localGeometry;
  const current = useRef(document);
  current.current = document;
  const [selected, select] = useState<string | null>(null),
    [inspecting, inspect] = useState<string | null>(null),
    [expanded, expand] = useState<string | null>(null),
    [active, activate] = useState(document.content.attrs!.id),
    [revealRequest, requestReveal] = useState<string | null>(null);
  const [iconTarget, setIconTarget] = useState<string | null>(null);
  const [slash, setSlash] = useState<{
    parentId: string;
    left: number;
    top: number;
  } | null>(null);
  const [loadedComponents, setLoadedComponents] = useState<CompiledComponent[]>(
    [],
  );
  const closeSlash = useCallback(() => setSlash(null), []);
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
  const rootId = document.content.attrs!.id;
  const focusSurface = useCallback(
    (id: string) => {
      expand(id === rootId ? null : id);
      activate(id);
      select(null);
      inspect(null);
    },
    [rootId],
  );
  const surfaceId = root.attrs!.id;
  const setSurfaceIcon = useCallback(
    () => setIconTarget(surfaceId),
    [surfaceId],
  );
  const setPageWidthMode = useCallback(
    (mode: PageWidthMode) => {
      const next = editNode(current.current, surfaceId, (node) => {
        node.attrs = { ...node.attrs, widthMode: mode };
      });
      current.current = next as ContainerDocument;
      onChange?.(next);
    },
    [surfaceId, onChange],
  );
  const wrap = useCallback(
    (kind: "page" | "board") => {
      const next = wrapSurface(current.current, surfaceId, kind);
      current.current = next;
      onChange?.(next);
      focusSurface(
        findSurfaceNode(next, surfaceId)?.parent?.attrs?.id ??
          next.content.attrs!.id,
      );
    },
    [surfaceId, onChange, focusSurface],
  );
  const name =
    root === document.content
      ? document.title || nodeName(root)
      : nodeName(root);
  const kind = surfaceKind(root);
  const controls = useMemo<EditorControls | null>(
    () =>
      onChange && undo && redo
        ? {
            documentId: document.id,
            surfaceId,
            name,
            kind,
            nested: surfaceId !== rootId,
            canUndo,
            canRedo,
            undo,
            redo,
            setIcon: setSurfaceIcon,
            wrap,
            pageWidthMode: root.attrs?.widthMode ?? "standard",
            setPageWidthMode,
          }
        : null,
    [
      document.id,
      surfaceId,
      name,
      kind,
      rootId,
      canUndo,
      canRedo,
      undo,
      redo,
      setSurfaceIcon,
      wrap,
      root.attrs?.widthMode,
      setPageWidthMode,
      onChange,
    ],
  );
  useLayoutEffect(() => {
    onControlsChange?.(controls);
  }, [onControlsChange, controls]);
  useLayoutEffect(
    () => () => {
      onControlsChange?.(null);
    },
    [onControlsChange],
  );
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
  useEffect(() => {
    if (revealInPlace) {
      select(revealInPlace);
      requestReveal(revealInPlace);
    }
  }, [revealInPlace]);
  const runtime: Runtime = {
    geometry,
    document,
    current,
    commit: (next) => {
      const measured = reconcileSurface(
        {
          ...geometry.materialize(next),
          surfaceViews: { ...next.surfaceViews },
        },
        { clone: false },
      );
      current.current = measured as ContainerDocument;
      onChange?.(measured);
    },
    readOnly: !onChange,
    printing,
    pageWidthModes,
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
    <AdditionalComponentsProvider components={loadedComponents}>
      <RegisterComponentContext.Provider
        value={(component) =>
          setLoadedComponents((items) => [...items, component])
        }
      >
        <Context.Provider value={runtime}>
          {iconTarget && !runtime.readOnly && (
            <PageIconDialog
              value={
                iconTarget === document.content.attrs!.id
                  ? document.icon
                  : (findSurfaceNode(document, iconTarget)?.node.attrs?.icon ??
                    "")
              }
              onClose={() => setIconTarget(null)}
              onSave={async (icon) => {
                const source = current.current;
                if (iconTarget === source.content.attrs!.id)
                  runtime.commit({ ...source, icon });
                else {
                  if (!findSurfaceNode(source, iconTarget))
                    throw new Error("该 Page 已被移除。");
                  runtime.commit(
                    editNode(source, iconTarget, (node) => {
                      node.attrs = { ...node.attrs, icon };
                    }),
                  );
                }
              }}
            />
          )}
          {slash && (
            <ComponentSlashMenu
              left={slash.left}
              top={slash.top}
              onClose={closeSlash}
              onInsert={(kind, data) => {
                const inserted = insertComponent(
                  current.current,
                  slash.parentId,
                  kind,
                  data,
                );
                runtime.commit(inserted.document);
                select(inserted.nodeId);
                requestReveal(inserted.nodeId);
                closeSlash();
              }}
            />
          )}
          <div
            className="container-workspace"
            data-resource-id={document.id}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.nativeEvent.isComposing)
                return;
              if (
                event.key === "/" &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !runtime.readOnly &&
                !(event.target as Element).closest(
                  'input,textarea,select,[role="dialog"]',
                ) &&
                (event.target as Element)
                  .closest("[contenteditable]")
                  ?.getAttribute("contenteditable") !== "true"
              ) {
                const element = (event.target as Element).closest<HTMLElement>(
                  "[data-component-container],[data-container-root]",
                );
                const parentId =
                  element?.dataset.componentContainer ??
                  element?.dataset.containerRoot ??
                  active;
                const rect =
                  element?.getBoundingClientRect() ??
                  event.currentTarget.getBoundingClientRect();
                event.preventDefault();
                event.stopPropagation();
                let owner = findSurfaceNode(current.current, parentId);
                while (owner && owner.node.type !== "surface")
                  owner = owner.parent?.attrs?.id
                    ? findSurfaceNode(current.current, owner.parent.attrs.id)
                    : undefined;
                activate(owner?.node.attrs?.id ?? active);
                setSlash({
                  parentId,
                  left: rect.left + 40,
                  top: rect.top + 80,
                });
                return;
              }
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
            {chain.length > 1 && (
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
                          <PageIcon
                            value={
                              node === document.content
                                ? document.icon
                                : node.attrs?.icon
                            }
                            size={14}
                          />
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
              </div>
            )}
            <div className="container-main">
              <ContainerView
                key={root.attrs!.id}
                node={root}
                root
                header={
                  root === document.content ? (
                    header
                  ) : (
                    <h1>
                      <PageIcon value={root.attrs?.icon} size={32} />{" "}
                      {nodeName(root)}
                    </h1>
                  )
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
                      selectedEntry.node.attrs?.name ??
                      nodeName(selectedEntry.node)
                    }
                    maxLength={200}
                    onChange={(event) =>
                      runtime.commit(
                        editNode(current.current, inspecting!, (node) => {
                          node.attrs = {
                            ...node.attrs,
                            name: event.target.value,
                          };
                        }),
                      )
                    }
                  />
                </label>
                {selectedEntry.node.type === "surface" && (
                  <button
                    type="button"
                    onClick={() => setIconTarget(selectedEntry.node.attrs!.id)}
                  >
                    <PageIcon
                      value={selectedEntry.node.attrs?.icon}
                      size={18}
                    />{" "}
                    设置图标…
                  </button>
                )}
                {pageWidthModes &&
                  selectedEntry.node.type === "surface" &&
                  surfaceKind(selectedEntry.node) === "page" && (
                    <label>
                      页面宽度
                      <PageWidthSwitch
                        value={
                          selectedEntry.node.attrs?.widthMode ?? "standard"
                        }
                        onChange={(mode) =>
                          runtime.commit(
                            editNode(current.current, inspecting!, (node) => {
                              node.attrs = {
                                ...node.attrs,
                                widthMode: mode,
                              };
                            }),
                          )
                        }
                      />
                    </label>
                  )}
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
                        if (
                          Number.isInteger(value) &&
                          value >= 1 &&
                          value <= 12
                        )
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
                                heightMode: event.target.value as
                                  "fixed" | "auto",
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
                        moveNode(
                          runtime.geometry.materialize(current.current),
                          inspecting!,
                          parentId,
                          {
                            ...(frame ?? { width: 640 }),
                            x: 0,
                            y: 0,
                          },
                        ),
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
                    runtime.commit(
                      removeNode(
                        runtime.geometry.materialize(current.current),
                        inspecting!,
                      ),
                    );
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
      </RegisterComponentContext.Provider>
    </AdditionalComponentsProvider>
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
    if (!target) return;
    const path = nodePaths(runtime.current.current)[target] ?? [];
    const owner = [...path]
      .reverse()
      .find(
        (parent) =>
          findSurfaceNode(runtime.current.current, parent)?.node.type ===
          "surface",
      );
    if (owner !== id) return;
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
  const actions: ObjectActions = {
    geometry: runtime.geometry,
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
            transformObjects(
              runtime.geometry.materialize(runtime.current.current),
              { [nodeId]: frame },
            ),
          ),
    remove: readOnly
      ? undefined
      : (nodeId) => {
          runtime.commit(
            removeNode(
              runtime.geometry.materialize(runtime.current.current),
              nodeId,
            ),
          );
          runtime.select(null);
        },
  };
  const heading =
    header ??
    (!root ? (
      <h2>
        <PageIcon value={node.attrs?.icon} size={24} /> {nodeName(node)}
      </h2>
    ) : undefined);
  const renderSurface = useCallback(
    (child: JSONContent) => <ContainerView node={child} />,
    [],
  );
  if (kind === "page" || reading)
    return (
      <ObjectContext.Provider value={actions}>
        <div
          ref={page}
          className={`container-page${root ? " is-root" : ""}${reading ? " is-reading-projection" : ""}`}
          data-container-root={id}
          data-width-mode={
            runtime.pageWidthModes && kind === "page"
              ? (node.attrs?.widthMode ?? "standard")
              : undefined
          }
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
            {heading && <div className="container-page-heading">{heading}</div>}
            <SurfaceContent
              document={runtime.document}
              container={node}
              spatial={!reading}
              renderContent={runtime.render}
              renderSurface={renderSurface}
            />
          </div>
        </div>
      </ObjectContext.Provider>
    );
  return (
    <div
      className={`container-board${root ? " is-root" : ""}${enabled ? " is-active" : ""}`}
      data-container-root={id}
      aria-label={`Board ${nodeName(node)}`}
      onPointerDownCapture={(event) => {
        if (
          (event.target as Element).closest("[data-container-root]") ===
          event.currentTarget
        )
          runtime.activate(id);
      }}
    >
      <div className="container-board-scene">
        <PageSurface
          embedded={!root}
          geometry={runtime.geometry}
          boardDocument={runtime.document}
          containerId={id}
          onTransform={
            readOnly
              ? undefined
              : (frames) =>
                  runtime.commit(
                    transformObjects(
                      runtime.geometry.materialize(runtime.current.current),
                      frames,
                    ),
                  )
          }
          onDuplicate={
            readOnly
              ? undefined
              : (ids) => {
                  const copied = duplicateObjects(
                    runtime.geometry.materialize(runtime.current.current),
                    ids,
                  );
                  runtime.commit(copied.document);
                  runtime.select(copied.ids[0] ?? null);
                  return copied.ids;
                }
          }
          onDeleteSelection={
            readOnly
              ? undefined
              : (ids) =>
                  runtime.commit(
                    removeObjects(
                      runtime.geometry.materialize(runtime.current.current),
                      ids,
                    ),
                  )
          }
          ref={viewport}
          pageId={`${runtime.document.id}:${id}:${root ? "expanded" : "embedded"}`}
          enabled
          printing={runtime.printing}
          nodes={resourceNodes(runtime.document, node).map((child) => ({
            id: child.attrs!.id,
            name: nodeName(child),
          }))}
          layoutKey={JSON.stringify(runtime.document.layout)}
          paths={nodePaths({ ...runtime.document, content: node })}
          views={surfaceViews(runtime.document, node)}
          header={root ? heading : undefined}
          selected={runtime.selected}
          onSelect={runtime.select}
          onInspect={runtime.inspect}
          onExpand={runtime.expand}
          onMove={actions.move}
          onConnect={
            readOnly
              ? undefined
              : (nodeId, endpoint, point) => {
                  const source = runtime.geometry.materialize(
                      runtime.current.current,
                    ),
                    entry = findSurfaceNode(source, nodeId);
                  if (!entry || !source.layout[nodeId]) return;
                  const endpoints = arrowEndpoints(
                    entry.node,
                    source.layout[nodeId],
                  );
                  endpoints[endpoint === "start" ? 0 : 1] = point;
                  const bindings = { ...entry.node.attrs?.bindings };
                  const binding = bindingAtPoint(
                    source,
                    entry.parent!.attrs!.id,
                    point,
                    8,
                  );
                  if (binding) bindings[endpoint] = binding;
                  else delete bindings[endpoint];
                  const resolved = arrowFromEndpoints(
                    entry.node,
                    source.layout[nodeId],
                    endpoints,
                    bindings,
                  );
                  runtime.commit(
                    editNode(
                      {
                        ...source,
                        layout: { ...source.layout, [nodeId]: resolved.frame },
                      },
                      nodeId,
                      (node) => {
                        node.attrs = resolved.node.attrs;
                      },
                    ),
                  );
                }
          }
          onRemove={actions.remove}
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
              : (drawing, frame) => {
                  if (drawing.attrs?.tool === "arrow") {
                    const endpoints = arrowEndpoints(drawing, frame);
                    const start = bindingAtPoint(
                      runtime.geometry.materialize(runtime.current.current),
                      id,
                      endpoints[0],
                    );
                    const end = bindingAtPoint(
                      runtime.geometry.materialize(runtime.current.current),
                      id,
                      endpoints[1],
                    );
                    if (start || end)
                      drawing.attrs.bindings = {
                        ...(start ? { start } : {}),
                        ...(end ? { end } : {}),
                      };
                  }
                  runtime.commit(
                    addNode(runtime.current.current, drawing, frame, id),
                  );
                }
          }
          extraActions={
            <>
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
