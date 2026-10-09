import { LibraryContextMenu } from "../studio/LibraryNavigation";
import type { SurfaceGeometryStore } from "./geometry-store";
import type { ShowDocument } from "../types";
import { useBoardInteraction } from "./useBoardInteraction";
import { DrawingInput } from "./Drawing";
import type { JSONContent } from "@tiptap/core";
import type { DrawingTool } from "./types";
import { flushSync } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import {
  Focus,
  ArrowUp,
  PanelTop,
  List,
  Maximize2,
  Minus,
  Plus,
  BookmarkPlus,
  Star,
  Trash2,
  Copy,
  Settings2,
} from "../ui/icons";
import { useSurfaceViewport } from "./useSurfaceViewport";
import {
  useViewportLock,
  ViewportLockButton,
} from "../components/blocks/ViewportLock";
import { ObjectContext, type ObjectActions } from "./SurfaceObject";
import type { NodeLayout, PageViews, SavedView } from "./types";
import "./surface.css";

export interface SurfaceHandle {
  insertPosition: () => NodeLayout;
  scale: () => number;
  reveal: (id: string) => void;
  point: (x: number, y: number) => { x: number; y: number };
}
interface Props {
  children: ReactNode;
  boardDocument?: ShowDocument;
  geometry?: SurfaceGeometryStore;
  containerId?: string;
  onTransform?: (frames: Record<string, NodeLayout>) => void;
  onDuplicate?: (ids: string[]) => string[] | void;
  onDeleteSelection?: (ids: string[]) => void;
  ref?: Ref<SurfaceHandle>;
  pageId: string;
  enabled?: boolean;
  embedded?: boolean;
  printing?: boolean;
  onExpand?: (id: string) => void;
  drawTool?: DrawingTool | null;
  drawColor?: string;
  onDraw?: (node: JSONContent, frame: NodeLayout) => void;
  onDrawExit?: () => void;
  onToolChange?: (tool: DrawingTool | null) => void;
  nodes: { id: string; name: string }[];
  layoutKey: string;
  paths: Record<string, string[]>;
  views: PageViews;
  header?: ReactNode;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  onMove?: ObjectActions["move"];
  onConnect?: ObjectActions["connect"];
  onRemove?: (id: string) => void;
  onInspect?: (id: string) => void;
  onViews?: (views: PageViews) => void;
  extraActions?: ReactNode;
}

export default function PageSurface({
  children,
  boardDocument,
  geometry,
  containerId,
  onTransform,
  onDuplicate,
  onDeleteSelection,
  ref,
  pageId,
  nodes,
  layoutKey,
  paths,
  views,
  header,
  selected: controlledSelection,
  onSelect: selectControlled,
  onMove,
  onConnect,
  onRemove,
  onInspect,
  onViews,
  extraActions,
  enabled = true,
  embedded = true,
  printing = false,
  onExpand,
  drawTool,
  drawColor = "#252629",
  onDraw,
  onDrawExit,
  onToolChange,
}: Props) {
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const selected =
    controlledSelection === undefined ? localSelection : controlledSelection;
  const onSelect = selectControlled ?? setLocalSelection;
  const lock = useViewportLock(
    "board",
    `showai.viewport-lock.v1:board:${pageId.replace(/:(expanded|embedded)$/, "")}`,
  );
  const locked = embedded && lock.locked;
  const { rootRef, scrollRef, worldRef, camera, controls, scale } =
    useSurfaceViewport(
      layoutKey,
      onMove ? `showai.viewport.v3:${pageId}` : undefined,
      enabled && !locked,
    );
  const board = useBoardInteraction({
    geometry,
    document: boardDocument,
    containerId,
    world: worldRef,
    camera,
    onTransform: locked ? undefined : onTransform,
    onSelect,
    selected,
  });
  const duplicateSelection = (ids: string[]) => {
    const copied = onDuplicate?.(ids);
    if (copied?.length) {
      board.selectIds(copied);
      requestAnimationFrame(() =>
        rootRef.current?.focus({ preventScroll: true }),
      );
    }
  };
  const [objectMenu, setObjectMenu] = useState<{
    anchor: HTMLElement;
    point: { x: number; y: number };
    id: string;
    ids: string[];
    container: boolean;
  } | null>(null);
  const openObjectMenu = (target: Element, point: { x: number; y: number }) => {
    if (
      !onTransform ||
      locked ||
      target.closest(
        'input,textarea,select,iframe,video,audio,[contenteditable=true],[data-editor-keyboard-scope],[data-surface-gesture="own"],.react-flow',
      )
    )
      return false;
    const element = target.closest<HTMLElement>(".surface-object");
    if (!element || element.closest(".page-surface") !== rootRef.current)
      return false;
    if (
      !element.classList.contains("is-drawing") &&
      target !== element &&
      !target.closest(".surface-object-header")
    )
      return false;
    const id = element.dataset.surfaceId!;
    const ids = board.ids.has(id) ? [...board.ids] : [id];
    if (!board.ids.has(id)) board.select(id);
    setObjectMenu({
      anchor: element,
      point,
      id,
      ids,
      container: element.classList.contains("is-container"),
    });
    return true;
  };
  const spaceHeld = useRef(false);
  const pointing = useRef<{
    pointer: number;
    id: string;
    x: number;
    y: number;
    moved: boolean;
    wasSelected: boolean;
    additive: boolean;
  } | null>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const clearHover = () => {
    hovered.current?.classList.remove("is-hovered");
    hovered.current = null;
    rootRef.current?.classList.remove("has-drawing-hit");
  };
  const cancelPointing = () => {
    pointing.current = null;
    board.cancel();
  };
  const marquee = useRef<{
    id: number;
    start: { x: number; y: number };
    next: NodeLayout;
    element: HTMLDivElement;
    additive: boolean;
    base: string[];
    hitId?: string;
  } | null>(null);
  const cancelMarquee = (restore = false) => {
    const drag = marquee.current;
    drag?.element.remove();
    marquee.current = null;
    if (restore && drag) board.selectIds(drag.base);
  };
  useEffect(() => {
    const cancel = () => {
      spaceHeld.current = false;
      cancelMarquee(true);
      cancelPointing();
      clearHover();
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, []);
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
  useLayoutEffect(() => {
    const root = rootRef.current!,
      world = worldRef.current!;
    if (!printing) return;
    const fitPrint = () => {
      const elements = [...world.children].filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      );
      if (!elements.length) return;
      const boxes = elements.map((element) => ({
        x: parseFloat(element.style.left) || 0,
        y: parseFloat(element.style.top) || 0,
        width: element.offsetWidth,
        height: element.offsetHeight,
      }));
      const left = Math.min(...boxes.map((box) => box.x)) - 12,
        top = Math.min(...boxes.map((box) => box.y)) - 12;
      const width =
          Math.max(...boxes.map((box) => box.x + box.width)) - left + 12,
        height = Math.max(...boxes.map((box) => box.y + box.height)) - top + 12;
      const scale = Math.min(
        1,
        Math.max(1, root.clientWidth) / Math.max(1, width),
        1000 / Math.max(1, height),
      );
      const heading =
        root.querySelector<HTMLElement>(":scope > .surface-metadata")
          ?.offsetHeight ?? 0;
      root.style.setProperty(
        "--board-print-height",
        `${height * scale + heading}px`,
      );
      root.style.setProperty(
        "--board-print-transform",
        `translateY(${heading}px) scale(${scale}) translate(${-left}px,${-top}px)`,
      );
    };
    fitPrint();
    const observer = new ResizeObserver(fitPrint);
    observer.observe(root);
    for (const child of world.children) observer.observe(child);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--board-print-height");
      root.style.removeProperty("--board-print-transform");
    };
  }, [printing, nodes.length]);
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
    scale: () =>
      camera.current.scale *
      (rootRef.current!.getBoundingClientRect().width /
        rootRef.current!.clientWidth || 1),
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
    point: (x, y) => controls.current.point(x, y),
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
        geometry,
        selected,
        select: onTransform ? board.select : onSelect,
        board: onTransform && !locked ? board : undefined,
        inspect: onInspect,
        expand: onExpand,
        remove: onRemove,
        move: locked ? undefined : onMove,
        connect: locked ? undefined : onConnect,
        readOnly: !onMove,
        revealAll: revealAll || printing,
        revealed,
      }}
    >
      <div
        ref={(element) => {
          rootRef.current = element;
          lock.ref.current = element;
        }}
        className={`page-surface${objectMenu ? " has-object-menu" : ""}`}
        data-input-surface={enabled && !locked ? pageId : undefined}
        data-viewport-lock-scope={embedded ? "board" : undefined}
        data-viewport-locked={locked}
        data-board-id={pageId}
        onContextMenu={(event) => {
          if (drawTool || pointing.current || marquee.current) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          const hit = board.hitTest(event.clientX, event.clientY);
          if (
            openObjectMenu(
              hit?.node.type === "drawing"
                ? hit.element
                : (event.target as Element),
              {
                x: event.clientX,
                y: event.clientY,
              },
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onPointerDownCapture={(event) => {
          const target = event.target as Element;
          if (target.closest(".page-surface") !== event.currentTarget) return;
          if (
            target.closest("[data-surface-handle],[data-board-drawing-input]")
          ) {
            cancelMarquee();
            controls.current.cancel();
          }
          if (
            !onTransform ||
            locked ||
            drawTool ||
            event.button !== 0 ||
            event.pointerType === "touch" ||
            spaceHeld.current ||
            target.closest("[data-surface-ui],[data-board-drawing-input]")
          )
            return;
          const hit = board.hitTest(event.clientX, event.clientY);
          const forceBrush = event.ctrlKey || event.metaKey;
          if (hit?.node.type === "drawing" && !forceBrush) {
            event.preventDefault();
            event.stopPropagation();
            controls.current.cancel();
            cancelMarquee();
            clearHover();
            const wasSelected = board.ids.has(hit.id);
            if (event.shiftKey && !wasSelected) board.select(hit.id, true);
            if (!board.start(hit.id, "move", event)) return;
            pointing.current = {
              pointer: event.pointerId,
              id: hit.id,
              x: event.clientX,
              y: event.clientY,
              moved: false,
              wasSelected,
              additive: event.shiftKey,
            };
            event.currentTarget.focus({ preventScroll: true });
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
          if (
            (hit && (!forceBrush || hit.node.type !== "drawing")) ||
            target.closest("[data-surface-content]")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = controls.current.point(event.clientX, event.clientY),
            element = document.createElement("div");
          element.className = "board-marquee";
          element.setAttribute("data-surface-ui", "");
          worldRef.current!.append(element);
          marquee.current = {
            id: event.pointerId,
            start,
            next: { ...start, width: 0, height: 0 },
            element,
            base: [...board.ids],
            hitId: hit?.id,
            additive: event.shiftKey,
          };
          if (!event.shiftKey && !forceBrush) board.select(null);
        }}
        onPointerMoveCapture={(event) => {
          const pointer = pointing.current;
          if (pointer?.pointer === event.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            pointer.moved ||=
              Math.hypot(
                event.clientX - pointer.x,
                event.clientY - pointer.y,
              ) >= 3;
            board.update(event);
            return;
          }
          if (
            !marquee.current &&
            !drawTool &&
            !locked &&
            !event.buttons &&
            (event.target as Element).closest(".page-surface") ===
              event.currentTarget
          ) {
            const hit = board.hitTest(event.clientX, event.clientY, false);
            const element = hit?.node.type === "drawing" ? hit.element : null;
            if (element !== hovered.current) {
              clearHover();
              hovered.current = element;
              element?.classList.add("is-hovered");
              rootRef.current?.classList.toggle("has-drawing-hit", !!element);
            }
          }
          const drag = marquee.current;
          if (!drag || drag.id !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          const end = controls.current.point(event.clientX, event.clientY);
          drag.next = {
            x: Math.min(drag.start.x, end.x),
            y: Math.min(drag.start.y, end.y),
            width: Math.abs(end.x - drag.start.x),
            height: Math.abs(end.y - drag.start.y),
          };
          board.marquee(
            drag.next,
            event.shiftKey,
            drag.base,
            event.ctrlKey || event.metaKey,
          );
          Object.assign(drag.element.style, {
            left: `${drag.next.x}px`,
            top: `${drag.next.y}px`,
            width: `${drag.next.width}px`,
            height: `${drag.next.height}px`,
          });
        }}
        onPointerUpCapture={(event) => {
          const pointer = pointing.current;
          if (pointer?.pointer === event.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            pointing.current = null;
            pointer.moved ||=
              Math.hypot(
                event.clientX - pointer.x,
                event.clientY - pointer.y,
              ) >= 3;
            board.update(event);
            board.finish();
            if (!pointer.moved && pointer.wasSelected)
              board.select(pointer.id, pointer.additive);
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            return;
          }
          const drag = marquee.current;
          if (!drag || drag.id !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          if (
            drag.hitId &&
            drag.next.width < 3 &&
            (drag.next.height ?? 0) < 3
          ) {
            board.selectIds(drag.base);
            board.select(
              drag.hitId,
              event.shiftKey || event.ctrlKey || event.metaKey,
            );
          } else
            board.marquee(
              drag.next,
              event.shiftKey,
              drag.base,
              event.ctrlKey || event.metaKey,
            );
          cancelMarquee();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancelCapture={() => {
          cancelMarquee(true);
          cancelPointing();
          clearHover();
        }}
        onLostPointerCapture={() => {
          cancelMarquee(true);
          if (pointing.current) cancelPointing();
        }}
        onPointerLeave={clearHover}
        onKeyDownCapture={(event) => {
          const target = event.target as Element;
          if (
            target.closest(
              'input,textarea,select,iframe,video,audio,[contenteditable=true],[data-editor-keyboard-scope],[data-surface-gesture="own"],.react-flow',
            )
          )
            return;
          if (target.closest(".page-surface") !== event.currentTarget) return;
          const inner = target.closest(".surface-object-content");
          if (
            inner &&
            inner.closest(".page-surface") === event.currentTarget &&
            target.closest(".surface-object") === inner.parentElement &&
            !inner.parentElement?.classList.contains("is-drawing")
          )
            return;
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            const rect = target.getBoundingClientRect();
            if (
              openObjectMenu(target, {
                x: rect.left + Math.min(24, rect.width / 2),
                y: rect.top + Math.min(24, rect.height / 2),
              })
            ) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
          if (event.code === "Space") spaceHeld.current = true;
          if (event.key === "Escape") {
            if (drawTool && !target.closest('[data-drawing-active="true"]')) {
              event.preventDefault();
              event.stopPropagation();
              onDrawExit?.();
              return;
            }
            const active = !!marquee.current || !!pointing.current;
            cancelMarquee(true);
            cancelPointing();
            if (active) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
          }
          if (
            !onTransform ||
            locked ||
            target.closest('[data-drawing-active="true"]')
          )
            return;
          if (
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey &&
            !pointing.current &&
            !marquee.current &&
            !target.closest('[data-drawing-active="true"]')
          ) {
            const key = event.key.toLowerCase(),
              tools: Record<string, DrawingTool | null> = {
                v: null,
                r: "rectangle",
                e: "ellipse",
                a: "arrow",
                p: "pen",
              };
            if (key in tools) {
              event.preventDefault();
              event.stopPropagation();
              clearHover();
              onToolChange?.(tools[key]);
              return;
            }
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "a"
          ) {
            event.preventDefault();
            event.stopPropagation();
            board.selectAll();
            return;
          }
          const step = (
            {
              ArrowLeft: [-1, 0],
              ArrowRight: [1, 0],
              ArrowUp: [0, -1],
              ArrowDown: [0, 1],
            } as Record<string, number[]>
          )[event.key];
          if (
            step &&
            board.ids.size &&
            !target.closest(
              "[data-resize-direction],.surface-object-rotate,.board-arrow-endpoint,input,select",
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            board.nudge(
              step[0] * (event.shiftKey ? 10 : 1),
              step[1] * (event.shiftKey ? 10 : 1),
            );
            return;
          }
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key.toLowerCase() === "d" &&
            board.ids.size
          ) {
            event.preventDefault();
            event.stopPropagation();
            duplicateSelection([...board.ids]);
          }
          if (
            (event.key === "Delete" || event.key === "Backspace") &&
            board.ids.size
          ) {
            event.preventDefault();
            event.stopPropagation();
            onDeleteSelection?.([...board.ids]);
            board.select(null);
          }
        }}
        onKeyUpCapture={(event) => {
          if (event.code === "Space") spaceHeld.current = false;
        }}
        onPointerDown={(event) => {
          if (event.defaultPrevented || event.button !== 0 || spaceHeld.current)
            return;
          if (
            !(event.target as Element).closest(
              "[data-surface-content], [data-surface-ui]",
            )
          )
            board.select(null);
        }}
        role="region"
        aria-label="白板"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            (event.target as Element).closest("[data-input-surface]") ===
              event.currentTarget &&
            event.key === "Escape" &&
            !(event.target as Element).closest("input,textarea") &&
            (event.target as Element)
              .closest("[contenteditable]")
              ?.getAttribute("contenteditable") !== "true"
          ) {
            board.select(null);
            if (navigation.current) navigation.current.open = false;
          }
        }}
        aria-description={
          locked
            ? "视图已锁定。可以点击内容，滚动用于外层页面阅读；右上角解锁后可缩放和移动。"
            : onTransform
              ? "拖动空白处框选；空格或中键拖动画布。V 选择，R 矩形，E 椭圆，A 箭头，P 画笔；Escape 取消当前操作。"
              : "在白板上滚动或拖动空白处浏览。方向键浏览，0 总览；Escape 取消当前操作。"
        }
      >
        {objectMenu && (
          <LibraryContextMenu
            anchor={objectMenu.anchor}
            point={objectMenu.point}
            label="对象操作"
            onClose={() => setObjectMenu(null)}
            items={[
              {
                label:
                  objectMenu.ids.length > 1
                    ? `复制 ${objectMenu.ids.length} 个对象`
                    : "复制对象",
                icon: <Copy size={14} />,
                onSelect: () => duplicateSelection(objectMenu.ids),
              },
              {
                label: "对象设置",
                icon: <Settings2 size={14} />,
                onSelect: () => onInspect?.(objectMenu.id),
              },
              ...(objectMenu.container
                ? [
                    {
                      label: "展开容器",
                      icon: <Maximize2 size={14} />,
                      onSelect: () => onExpand?.(objectMenu.id),
                    },
                  ]
                : []),
              {
                label:
                  objectMenu.ids.length > 1
                    ? `删除 ${objectMenu.ids.length} 个对象`
                    : "删除对象",
                icon: <Trash2 size={14} />,
                danger: true,
                separatorBefore: true,
                onSelect: () => {
                  onDeleteSelection?.(objectMenu.ids);
                  board.select(null);
                },
              },
            ]}
          />
        )}
        {embedded && <ViewportLockButton {...lock} label="白板" />}
        <div className="surface-metadata" data-surface-ui>
          {header}
        </div>
        <div ref={scrollRef} className="surface-scroll">
          <div ref={worldRef} className="surface-world">
            {children}
          </div>
        </div>
        {drawTool && enabled && !locked && onDraw && (
          <DrawingInput
            key={drawTool}
            tool={drawTool}
            panHeld={spaceHeld}
            makeSnapIndex={board.drawingSnapIndex}
            color={drawColor}
            camera={camera}
            point={(x, y) => controls.current.point(x, y)}
            onDraw={(node, frame) => {
              onDraw(node, frame);
              requestAnimationFrame(() => {
                if (
                  !rootRef.current?.querySelector("[data-board-drawing-input]")
                )
                  rootRef.current?.focus({ preventScroll: true });
              });
            }}
            onExit={() => onDrawExit?.()}
          />
        )}
        {!nodes.length && !drawTool && !onMove && (
          <div className="surface-empty" data-surface-ui>
            <p>这块白板还没有内容</p>
          </div>
        )}
        <div
          className="surface-toolbar"
          data-surface-ui
          role="group"
          aria-label="白板工具"
        >
          {onTransform && !objectMenu && board.ids.size > 1 && (
            <span className="board-selection-count" role="status">
              已选 {board.ids.size} 项
            </span>
          )}
          {onTransform && !objectMenu && board.ids.size > 0 && (
            <>
              <button
                type="button"
                onClick={() => duplicateSelection([...board.ids])}
                aria-label="复制选中对象"
                title="复制选中对象（⌘/Ctrl D）"
              >
                复制
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSelection?.([...board.ids]);
                  board.select(null);
                }}
                aria-label="删除选中对象"
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
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
                    disabled={locked}
                    onClick={() => {
                      onSelect(node.id);
                      focusAfterMount([node.id], true);
                      navigation.current!.open = false;
                    }}
                  >
                    <PanelTop size={14} aria-hidden="true" />
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
                        <ArrowUp size={13} aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
              ))}

              <strong>命名视图</strong>
              {views.saved.map((view) => (
                <div className="surface-navigation-row" key={view.id}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => {
                      focusAfterMount(view.targets);
                      navigation.current!.open = false;
                    }}
                  >
                    <BookmarkPlus size={14} aria-hidden="true" />
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
            disabled={locked}
            title="总览全部内容（0）"
            onClick={() => focusAfterMount()}
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            aria-label="定位所选"
            title="定位所选内容"
            disabled={locked || !selected}
            onClick={() => selected && focusAfterMount([selected], true)}
          >
            <Focus size={15} />
          </button>
          <span className="surface-toolbar-divider" />
          <button
            type="button"
            aria-label="缩小白板"
            disabled={locked || scale <= 0.25}
            onClick={() => controls.current.zoom(scale / 1.2)}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="surface-zoom"
            aria-label="重置缩放"
            disabled={locked}
            onClick={() => controls.current.zoom(1)}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="放大白板"
            disabled={locked || scale >= 2}
            onClick={() => controls.current.zoom(scale * 1.2)}
          >
            <Plus size={15} />
          </button>
          <fieldset className="surface-extra-actions" disabled={locked}>
            {extraActions}
          </fieldset>
        </div>
      </div>
    </ObjectContext.Provider>
  );
}
