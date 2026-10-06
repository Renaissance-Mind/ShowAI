import { flushSync } from "react-dom";
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  Focus,
  List,
  Maximize2,
  Minus,
  Plus,
  BookmarkPlus,
  Star,
  Trash2,
} from "lucide-react";
import { useSurfaceViewport } from "./useSurfaceViewport";
import { ObjectContext, type ObjectActions } from "./SurfaceObject";
import type { NodeLayout, PageViews, SavedView } from "./types";
import "./surface.css";

export interface SurfaceHandle {
  insertPosition: () => NodeLayout;
  reveal: (id: string) => void;
}
interface Props {
  children: ReactNode;
  ref?: Ref<SurfaceHandle>;
  pageId: string;
  nodes: { id: string; name: string }[];
  layoutKey: string;
  paths: Record<string, string[]>;
  views: PageViews;
  header?: ReactNode;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onAdd?: (kind: "flow" | "grid" | "free" | "text" | "image") => void;
  onMove?: ObjectActions["move"];
  onRemove?: (id: string) => void;
  onInspect?: (id: string) => void;
  onAddText?: (id: string) => void;
  onViews?: (views: PageViews) => void;
  extraActions?: ReactNode;
}

export default function PageSurface({
  children,
  ref,
  pageId,
  nodes,
  layoutKey,
  paths,
  views,
  header,
  selected = null,
  onSelect = () => {},
  onAdd,
  onMove,
  onRemove,
  onInspect,
  onAddText,
  onViews,
  extraActions,
}: Props) {
  const { rootRef, scrollRef, worldRef, camera, controls, scale } =
    useSurfaceViewport(
      layoutKey,
      onMove ? `showai.viewport.v2:${pageId}` : undefined,
    );
  const [revealAll, setRevealAll] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [viewName, setViewName] = useState("");
  const initialized = useRef(false);
  const navigationFrames = useRef({ first: 0, second: 0 });
  useEffect(() => {
    const print = () => flushSync(() => setRevealAll(true));
    window.addEventListener("beforeprint", print);
    return () => {
      window.removeEventListener("beforeprint", print);
      cancelAnimationFrame(navigationFrames.current.first);
      cancelAnimationFrame(navigationFrames.current.second);
    };
  }, []);
  const navigation = useRef<HTMLDetailsElement>(null);
  const focusAfterMount = (
    ids?: string[],
    single = false,
    immediate = false,
  ) => {
    if (ids?.length)
      setRevealed(
        (current) =>
          new Set([
            ...current,
            ...ids.flatMap((id) => [...(paths[id] ?? []), id]),
          ]),
      );
    else setRevealAll(true);
    cancelAnimationFrame(navigationFrames.current.first);
    cancelAnimationFrame(navigationFrames.current.second);
    navigationFrames.current.first = requestAnimationFrame(
      () =>
        (navigationFrames.current.second = requestAnimationFrame(() => {
          if (single && ids?.[0]) controls.current.focus(ids[0], immediate);
          else controls.current.fit(ids, immediate);
        })),
    );
  };
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (
      controls.current.restored &&
      (!controls.current.restoredAnchor ||
        Object.hasOwn(paths, controls.current.restoredAnchor))
    ) {
      const saved = controls.current.restoredTargets;
      const available = saved.filter((id) => Object.hasOwn(paths, id));
      if (!saved.length || available.length) {
        setRevealed(
          new Set(available.flatMap((id) => [...(paths[id] ?? []), id])),
        );
        navigationFrames.current.first = requestAnimationFrame(() => {
          navigationFrames.current.second = requestAnimationFrame(() =>
            controls.current.restore(),
          );
        });
        return;
      }
    }
    const initial = views.saved.find((view) => view.id === views.initial);
    if (initial) focusAfterMount(initial.targets, false, true);
    else if (nodes[0]) focusAfterMount([nodes[0].id], true, true);
  }, []);
  useImperativeHandle(ref, () => ({
    insertPosition: () => {
      const root = rootRef.current!,
        c = camera.current;
      return {
        x: (root.clientWidth / 2 - c.x) / c.scale,
        y: (root.clientHeight / 3 - c.y) / c.scale,
        width: 360,
      };
    },
    reveal: (id) => focusAfterMount([id], true),
  }));
  const names = new Map(nodes.map((node) => [node.id, node.name]));
  const viewTargets = selected
    ? [selected]
    : !navigation.current?.open
      ? []
      : [
          ...(worldRef.current?.querySelectorAll<HTMLElement>(
            "[data-surface-id]",
          ) ?? []),
        ]
          .filter((element) => {
            const rect = element.getBoundingClientRect(),
              viewport = rootRef.current!.getBoundingClientRect();
            return (
              rect.right > viewport.left &&
              rect.left < viewport.right &&
              rect.bottom > viewport.top &&
              rect.top < viewport.bottom
            );
          })
          .map((element) => element.dataset.surfaceId!);
  const saveView = () => {
    if (!viewName.trim() || !onViews || !viewTargets.length) return;
    const view: SavedView = {
      id: crypto.randomUUID(),
      name: viewName.trim(),
      targets: viewTargets,
    };
    onViews({ ...views, saved: [...views.saved, view] });
    setViewName("");
  };
  return (
    <ObjectContext.Provider
      value={{
        scale,
        selected,
        select: onSelect,
        inspect: onInspect,
        addText: onAddText,
        remove: onRemove,
        move: onMove,
        readOnly: !onMove,
        revealAll,
        revealed,
      }}
    >
      <div
        ref={rootRef}
        className="page-surface"
        onPointerDown={(event) => {
          if (
            !(event.target as Element).closest(
              "[data-surface-content], [data-surface-ui]",
            )
          )
            onSelect(null);
        }}
        role="region"
        aria-label="白板"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" &&
            !(event.target as Element).closest(
              'input,textarea,[contenteditable="true"]',
            )
          ) {
            onSelect(null);
            if (navigation.current) navigation.current.open = false;
          }
        }}
        aria-description="在白板上滚动或拖动空白处浏览。内容区域支持弹性滑动和轻微吸附。方向键浏览，0 总览；Escape 取消当前操作。"
      >
        <div className="surface-metadata" data-surface-ui>
          {header}
        </div>
        <div ref={scrollRef} className="surface-scroll">
          <div ref={worldRef} className="surface-world">
            {children}
          </div>
        </div>
        {!nodes.length && (
          <div className="surface-empty" data-surface-ui>
            <p>{onAdd ? "在这里开始一份内容" : "这块白板还没有内容"}</p>
            {onAdd && (
              <button type="button" onClick={() => onAdd("flow")}>
                <Plus size={16} />
                开始写作
              </button>
            )}
          </div>
        )}
        <div
          className="surface-toolbar"
          data-surface-ui
          role="group"
          aria-label="白板工具"
        >
          <details
            ref={navigation}
            className="surface-popover-anchor"
            onKeyDownCapture={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                navigation.current!.open = false;
                navigation.current!.querySelector("summary")?.focus();
              }
            }}
          >
            <summary aria-label="区域与视图" title="区域与视图">
              <List size={16} />
            </summary>
            <div className="surface-navigation">
              <strong>区域与内容</strong>
              {nodes.map((node) => (
                <div className="surface-navigation-row" key={node.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(node.id);
                      focusAfterMount([node.id], true);
                      navigation.current!.open = false;
                    }}
                  >
                    {node.name}
                  </button>
                  {onViews && (
                    <>
                      <button
                        type="button"
                        aria-label={`前移 ${node.name} 阅读顺序`}
                        disabled={views.readingOrder.indexOf(node.id) < 1}
                        onClick={() => {
                          const order = [...views.readingOrder],
                            index = order.indexOf(node.id);
                          [order[index - 1], order[index]] = [
                            order[index],
                            order[index - 1],
                          ];
                          onViews({ ...views, readingOrder: order });
                        }}
                      >
                        ↑
                      </button>
                    </>
                  )}
                </div>
              ))}
              {!nodes.length && <p>添加内容后可在这里定位。</p>}
              <strong>命名视图</strong>
              {views.saved.map((view) => (
                <div className="surface-navigation-row" key={view.id}>
                  <button
                    type="button"
                    onClick={() => {
                      focusAfterMount(view.targets);
                      navigation.current!.open = false;
                    }}
                  >
                    {view.name}
                  </button>
                  {onViews && (
                    <>
                      <button
                        type="button"
                        aria-label={`设为初始视图 ${view.name}`}
                        aria-pressed={views.initial === view.id}
                        onClick={() =>
                          onViews({
                            ...views,
                            initial: views.initial === view.id ? null : view.id,
                          })
                        }
                      >
                        <Star size={13} />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除视图 ${view.name}`}
                        onClick={() =>
                          onViews({
                            ...views,
                            initial:
                              views.initial === view.id ? null : views.initial,
                            saved: views.saved.filter(
                              (entry) => entry.id !== view.id,
                            ),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              {onViews && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    saveView();
                  }}
                >
                  <input
                    aria-label="视图名称"
                    placeholder={
                      selected
                        ? `${names.get(selected) || "所选内容"}的视图`
                        : "当前可见内容的视图"
                    }
                    maxLength={200}
                    value={viewName}
                    onChange={(event) => setViewName(event.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={!viewName.trim() || !viewTargets.length}
                  >
                    <BookmarkPlus size={14} />
                    保存视图
                  </button>
                </form>
              )}
            </div>
          </details>
          <button
            type="button"
            aria-label="总览"
            title="总览全部内容（0）"
            onClick={() => focusAfterMount()}
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            aria-label="定位所选"
            title="定位所选内容"
            disabled={!selected}
            onClick={() => selected && focusAfterMount([selected], true)}
          >
            <Focus size={15} />
          </button>
          <span className="surface-toolbar-divider" />
          <button
            type="button"
            aria-label="缩小白板"
            disabled={scale <= 0.25}
            onClick={() => controls.current.zoom(scale / 1.2)}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="surface-zoom"
            aria-label="重置缩放"
            onClick={() => controls.current.zoom(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="放大白板"
            disabled={scale >= 2}
            onClick={() => controls.current.zoom(scale * 1.2)}
          >
            <Plus size={15} />
          </button>
          {onAdd && (
            <details className="surface-popover-anchor">
              <summary aria-label="添加内容">
                <Plus size={15} />
                <span>添加</span>
              </summary>
              <div className="surface-add-menu">
                {(
                  [
                    ["flow", "顺序区域"],
                    ["grid", "网格区域"],
                    ["free", "自由区域"],
                    ["text", "独立文本"],
                    ["image", "图片"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    type="button"
                    key={kind}
                    onClick={(event) => {
                      onAdd(kind);
                      event.currentTarget.closest("details")!.open = false;
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </details>
          )}
          {extraActions}
        </div>
      </div>
    </ObjectContext.Provider>
  );
}
