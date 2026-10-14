import { LibraryContextMenu } from "../studio/LibraryNavigation";
import type { SurfaceGeometryStore } from "./geometry-store";
import type { ShowDocument } from "../types";
import { useBoardInteraction } from "./useBoardInteraction";
import type { BoardGesture } from "./useBoardInteraction";
import { useInlineInk } from "./useInlineInk";
import { BoardGestureInput } from "./BoardGestureInput";
import { DrawingInput } from "./Drawing";
import { boardToolForKey } from "./board-tools";
import type { JSONContent } from "@tiptap/core";
import type { BoardTool, BoardDrawingTool, DrawingStyle } from "./types";
import { findSurfaceNode } from "./document.mjs";
import { BoardStyleControls } from "./BoardStyleControls";
import { DockableBoardToolbar } from "./DockableBoardToolbar";
import { readingCapture } from "./reading-capture";
import { flushSync } from "react-dom";
import { fingerNavigatesBoard } from "./board-input.mjs";
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
  FileText,
  Ruler,
} from "../ui/icons";
import {
  useSurfaceViewport,
  useViewportScale,
  type ViewportScale,
} from "./useSurfaceViewport";
import {
  useViewportLock,
  ViewportLockButton,
} from "../components/blocks/ViewportLock";
import { ObjectContext, type ObjectActions } from "./SurfaceObject";
import type { NodeLayout, PageViews, SavedView } from "./types";
import "./surface.css";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";

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
  drawTool?: BoardTool | null;
  drawColor?: string;
  drawFillColor?: string;
  drawStrokeWidth?: number;
  onStyleChange?: (ids: string[], patch: Partial<DrawingStyle>) => void;
  onAddComponent?: (kind: string, point: { x: number; y: number }) => void;
  onOpenComponents?: (
    point: { x: number; y: number },
    position: { x: number; y: number },
  ) => void;
  onDraw?: (node: JSONContent, frame: NodeLayout) => void;
  onDrawExit?: () => void;
  onToolChange?: (tool: BoardTool | null) => void;
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
  onInspect?: (id: string | null) => void;
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
  drawFillColor = "none",
  drawStrokeWidth = 2.5,
  onStyleChange,
  onAddComponent,
  onOpenComponents,
  onDraw,
  onDrawExit,
  onToolChange,
}: Props) {
  const t = useTranslator(messages);
  const mobile =
    typeof document !== "undefined" &&
    document.documentElement.dataset.native === "ios";
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const capture = useRef(readingCapture()).current;
  const [componentActionsHost, setComponentActionsHost] =
    useState<HTMLDivElement | null>(null);
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
  const [ruler, setRuler] = useState(false);
  const writingSettings = useRef<HTMLDetailsElement>(null);
  useInlineInk({
    root: rootRef,
    world: worldRef,
    document: boardDocument,
    boardId: containerId ?? "",
    tool: drawTool,
    color: drawColor,
    width: drawStrokeWidth,
    ruler,
    enabled: enabled && !locked && !!onDraw && !printing,
    onCamera: (value, final) => controls.current.navigateTo(value, final),
    onTool: (value) => {
      if (value === "settings") {
        if (writingSettings.current) writingSettings.current.open = true;
      } else if (
        value === "eraser" ||
        value === "pen" ||
        value === "highlighter"
      )
        onToolChange?.(value);
    },
  });
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
    insertion?: { x: number; y: number };
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
    preserveSelection: boolean;
  } | null>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const hoverWindow = useRef({ id: "", since: 0, until: 0 });
  const clearHover = () => {
    hovered.current?.classList.remove("is-hovered");
    hovered.current = null;
    rootRef.current?.classList.remove("has-drawing-hit");
  };
  const cancelPointing = () => {
    const pointer = pointing.current?.pointer;
    pointing.current = null;
    board.cancel();
    controls.current.objectGesture(false);
    if (pointer !== undefined && rootRef.current?.hasPointerCapture(pointer))
      rootRef.current.releasePointerCapture(pointer);
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
    if (drag && rootRef.current?.hasPointerCapture(drag.id))
      rootRef.current.releasePointerCapture(drag.id);
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
    if (capture) {
      controls.current.moveTo(
        capture.cameras?.[containerId!] ?? { x: 0, y: 0, scale: 1 },
        true,
      );
      return;
    }
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
  const selectedNodes = boardDocument
    ? [...board.ids].flatMap((id) => {
        const node = findSurfaceNode(boardDocument, id)?.node;
        return node ? [node] : [];
      })
    : [];
  const selectedContainer =
    selectedNodes.length === 1 && selectedNodes[0].type === "surface";
  return (
    <ObjectContext.Provider
      value={{
        componentActionsHost,
        // Read live so zoom frames do not re-render every object.
        get scale() {
          return camera.current.scale;
        },
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
        revealAll: revealAll || printing || !!capture,
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
        data-board-tool={drawTool ?? "select"}
        onContextMenu={(event) => {
          onInspect?.(null);
          if (
            pointing.current ||
            marquee.current ||
            (event.target as Element).closest('[data-drawing-active="true"]')
          ) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          const hit = board.hitTest(event.clientX, event.clientY);
          if (navigation.current) navigation.current.open = false;
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
          } else if (
            onAddComponent &&
            onTransform &&
            !locked &&
            (event.target as Element).closest(".page-surface") ===
              event.currentTarget &&
            !(event.target as Element).closest(
              '[data-surface-ui],input,textarea,select,[contenteditable=true],[data-surface-gesture="own"],.react-flow',
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
            setObjectMenu({
              anchor: event.currentTarget,
              point: { x: event.clientX, y: event.clientY },
              id: "",
              ids: [],
              container: false,
              insertion: controls.current.point(event.clientX, event.clientY),
            });
          }
        }}
        onPointerDownCapture={(event) => {
          const target = event.target as Element;
          if (
            ["pan", "eraser"].includes(drawTool ?? "") &&
            !target.closest("[data-surface-ui]")
          )
            return;
          if (
            fingerNavigatesBoard(event.pointerType) &&
            !target.closest(
              "[data-surface-ui],button,input,textarea,select,iframe,[contenteditable=true]",
            )
          )
            return;
          if (target.closest(".page-surface") !== event.currentTarget) return;
          if (!target.closest(".surface-popover-anchor") && navigation.current)
            navigation.current.open = false;
          if (!target.closest("[data-surface-ui]")) setObjectMenu(null);
          const selectedHit =
            drawTool === "lasso"
              ? board.hitTest(event.clientX, event.clientY)
              : null;
          const selectionId =
            board.selectionHit(event.clientX, event.clientY) ??
            (selectedHit && board.ids.has(selectedHit.id)
              ? selectedHit.id
              : null);
          const handle =
            target.closest<HTMLElement>(
              ".board-resize-handle,.surface-object-rotate",
            ) ??
            (drawTool && target.closest("[data-board-drawing-input]")
              ? [
                  ...(worldRef.current?.querySelectorAll<HTMLElement>(
                    ".surface-object.is-selected > .board-resize-handle, .surface-object.is-selected > .surface-object-rotate",
                  ) ?? []),
                ].find((element) => {
                  const box = element.getBoundingClientRect();
                  return (
                    event.clientX >= box.left - 4 &&
                    event.clientX <= box.right + 4 &&
                    event.clientY >= box.top - 4 &&
                    event.clientY <= box.bottom + 4
                  );
                })
              : undefined);
          const edge = board.edgeHit(event.clientX, event.clientY);
          const quickSelect =
            !!drawTool &&
            !!edge &&
            (board.ids.has(edge.id) ||
              (hoverWindow.current.id === edge.id &&
                performance.now() >= hoverWindow.current.since + 180 &&
                (hovered.current === edge.element ||
                  performance.now() <= hoverWindow.current.until)));
          if (
            target.closest("[data-surface-handle]") ||
            (event.pointerType !== "touch" &&
              target.closest("[data-board-drawing-input]"))
          ) {
            cancelMarquee();
            controls.current.cancel();
          }
          if (
            !onTransform ||
            locked ||
            (drawTool && !quickSelect && !selectionId && !handle) ||
            event.button !== 0 ||
            (event.pointerType === "touch" && !handle) ||
            spaceHeld.current ||
            (!handle && target.closest("[data-surface-handle]")) ||
            (!handle && target.closest("[data-surface-ui]")) ||
            (!handle &&
              target.closest(
                'input,textarea,select,button,a,[contenteditable=true],iframe,[data-surface-gesture="own"],.react-flow',
              ))
          )
            return;
          const hit = board.hitTest(event.clientX, event.clientY);
          const forceBrush = event.ctrlKey || event.metaKey;
          const moveId = handle
            ? handle.closest<HTMLElement>("[data-surface-id]")?.dataset
                .surfaceId
            : !forceBrush && !event.shiftKey && selectionId
              ? selectionId
              : quickSelect
                ? edge?.id
                : hit?.node.type === "drawing" ||
                    (hit &&
                      (target === hit.element ||
                        (board.ids.has(hit.id) &&
                          !target.closest(
                            'input,textarea,select,button,a,[contenteditable=true],iframe,[data-surface-gesture="own"],.react-flow',
                          ))))
                  ? hit?.id
                  : null;
          if (moveId && (!forceBrush || handle)) {
            event.preventDefault();
            event.stopPropagation();
            controls.current.cancel();
            cancelMarquee();
            clearHover();
            const wasSelected = board.ids.has(moveId);
            if (event.shiftKey && !wasSelected) board.select(moveId, true);
            const gesture: BoardGesture = handle?.dataset.resizeDirection
              ? `resize-${handle.dataset.resizeDirection}`
              : handle
                ? "rotate"
                : "move";
            if (!board.start(moveId, gesture, event)) return;
            controls.current.objectGesture(true);
            pointing.current = {
              pointer: event.pointerId,
              id: moveId,
              x: event.clientX,
              y: event.clientY,
              moved: false,
              wasSelected,
              additive: event.shiftKey,
              preserveSelection: !!handle || (!!selectionId && !event.shiftKey),
            };
            (handle ?? event.currentTarget).focus({ preventScroll: true });
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
            !locked &&
            !event.buttons &&
            (event.target as Element).closest(".page-surface") ===
              event.currentTarget
          ) {
            const hit = drawTool
              ? board.edgeHit(event.clientX, event.clientY)
              : board.hitTest(event.clientX, event.clientY, false);
            const now = performance.now();
            if (hit) {
              if (
                hoverWindow.current.id !== hit.id ||
                (hovered.current !== hit.element &&
                  now > hoverWindow.current.until)
              )
                hoverWindow.current = {
                  id: hit.id,
                  since: now,
                  until: now + 900,
                };
              else hoverWindow.current.until = now + 900;
            }
            const element = hit?.element ?? null;
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
            controls.current.objectGesture(false);
            if (
              !pointer.moved &&
              pointer.wasSelected &&
              !pointer.preserveSelection
            )
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
        onPointerCancelCapture={(event) => {
          if (
            event.pointerId !== pointing.current?.pointer &&
            event.pointerId !== marquee.current?.id
          )
            return;
          cancelMarquee(true);
          cancelPointing();
          clearHover();
        }}
        onLostPointerCapture={(event) => {
          if (event.target !== event.currentTarget) return;
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
            const active = !!marquee.current || !!pointing.current;
            cancelMarquee(true);
            cancelPointing();
            if (active) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            if (drawTool && !target.closest('[data-drawing-active="true"]')) {
              event.preventDefault();
              event.stopPropagation();
              onDrawExit?.();
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
            const entry = boardToolForKey(event.key);
            if (entry && (!mobile || entry.tool !== "region")) {
              event.preventDefault();
              event.stopPropagation();
              clearHover();
              board.select(null);
              onToolChange?.(entry.tool);
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
        aria-label={t("board")}
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
            ? t("board.descriptionLocked")
            : onTransform
              ? t("board.descriptionEdit")
              : t("board.descriptionRead")
        }
      >
        {objectMenu && (
          <LibraryContextMenu
            anchor={objectMenu.anchor}
            point={objectMenu.point}
            label={t("menu.objectActions")}
            onClose={() => setObjectMenu(null)}
            items={
              objectMenu.insertion
                ? [
                    {
                      label: t("menu.addPage"),
                      icon: <PanelTop size={14} />,
                      onSelect: () =>
                        onAddComponent?.("page", objectMenu.insertion!),
                    },
                    {
                      label: t("menu.addRichText"),
                      icon: <FileText size={14} />,
                      onSelect: () =>
                        onAddComponent?.("text", objectMenu.insertion!),
                    },
                    {
                      label: t("menu.addComponent"),
                      icon: <Plus size={14} />,
                      separatorBefore: true,
                      onSelect: () =>
                        onOpenComponents?.(
                          objectMenu.point,
                          objectMenu.insertion!,
                        ),
                    },
                  ]
                : [
                    {
                      label:
                        objectMenu.ids.length > 1
                          ? t("menu.duplicateMany", {
                              count: objectMenu.ids.length,
                            })
                          : t("menu.duplicate"),
                      icon: <Copy size={14} />,
                      onSelect: () => duplicateSelection(objectMenu.ids),
                    },
                    {
                      label: t("menu.settings"),
                      icon: <Settings2 size={14} />,
                      onSelect: () => onInspect?.(objectMenu.id),
                    },
                    ...(objectMenu.container
                      ? [
                          {
                            label: t("menu.expand"),
                            icon: <Maximize2 size={14} />,
                            onSelect: () => onExpand?.(objectMenu.id),
                          },
                        ]
                      : []),
                    {
                      label:
                        objectMenu.ids.length > 1
                          ? t("menu.deleteMany", {
                              count: objectMenu.ids.length,
                            })
                          : t("menu.delete"),
                      icon: <Trash2 size={14} />,
                      danger: true,
                      separatorBefore: true,
                      onSelect: () => {
                        onDeleteSelection?.(objectMenu.ids);
                        board.select(null);
                      },
                    },
                  ]
            }
          />
        )}
        {embedded && (
          <ViewportLockButton {...lock} label={t("board.lockTarget")} />
        )}
        <div className="surface-metadata" data-surface-ui>
          {header}
        </div>
        <div ref={scrollRef} className="surface-scroll">
          <div ref={worldRef} className="surface-world">
            {children}
          </div>
        </div>
        {drawTool &&
          !["pan", "eraser", "lasso"].includes(drawTool) &&
          !(
            window.showai?.inlineInk &&
            (drawTool === "pen" || drawTool === "highlighter")
          ) &&
          enabled &&
          !locked &&
          onDraw && (
            <DrawingInput
              key={drawTool}
              tool={drawTool as BoardDrawingTool}
              ruler={ruler}
              panHeld={spaceHeld}
              makeSnapIndex={board.drawingSnapIndex}
              color={drawColor}
              fillColor={drawFillColor}
              strokeWidth={drawStrokeWidth}
              camera={camera}
              point={(x, y) => controls.current.point(x, y)}
              onDraw={(node, frame) => {
                onDraw(node, frame);
                requestAnimationFrame(() => {
                  if (
                    !rootRef.current?.querySelector(
                      "[data-board-drawing-input]",
                    )
                  )
                    rootRef.current?.focus({ preventScroll: true });
                });
              }}
              onExit={() => onDrawExit?.()}
            />
          )}
        {(drawTool === "eraser" || drawTool === "lasso") &&
          enabled &&
          !locked &&
          onDeleteSelection && (
            <BoardGestureInput
              key={drawTool}
              tool={drawTool}
              board={board}
              world={worldRef}
              onDelete={onDeleteSelection}
              onExit={() => onDrawExit?.()}
            />
          )}
        {!nodes.length && !drawTool && !onMove && (
          <div className="surface-empty" data-surface-ui>
            <p>{t("board.empty")}</p>
          </div>
        )}
        <DockableBoardToolbar
          root={rootRef}
          enabled={enabled && !locked && !printing}
        >
          {onTransform && !objectMenu && board.ids.size > 1 && (
            <span className="board-selection-count" role="status">
              {t("board.selectedCount", { count: board.ids.size })}
            </span>
          )}
          {onTransform && !objectMenu && board.ids.size > 0 && (
            <>
              {selectedContainer && (
                <button
                  type="button"
                  aria-label={t("board.expandSelected")}
                  onClick={() => selected && onExpand?.(selected)}
                >
                  <Maximize2 size={15} />
                </button>
              )}
              <button
                type="button"
                onClick={() => duplicateSelection([...board.ids])}
                aria-label={t("board.duplicateSelected")}
                title={t("board.duplicateSelectedTitle")}
              >
                {t("board.duplicate")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSelection?.([...board.ids]);
                  board.select(null);
                }}
                aria-label={t("board.deleteSelected")}
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
          {!mobile && (
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
              <summary
                aria-label={t("nav.regionsAndViews")}
                title={t("nav.regionsAndViews")}
              >
                <List size={16} />
              </summary>
              <div className="surface-navigation">
                <strong>{t("nav.regionsAndContent")}</strong>
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
                          aria-label={t("nav.moveEarlier", { name: node.name })}
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

                <strong>{t("nav.namedViews")}</strong>
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
                          aria-label={t("nav.setInitial", { name: view.name })}
                          aria-pressed={views.initial === view.id}
                          onClick={() =>
                            onViews({
                              ...views,
                              initial:
                                views.initial === view.id ? null : view.id,
                            })
                          }
                        >
                          <Star size={13} />
                        </button>
                        <button
                          type="button"
                          aria-label={t("nav.deleteView", { name: view.name })}
                          onClick={() =>
                            onViews({
                              ...views,
                              initial:
                                views.initial === view.id
                                  ? null
                                  : views.initial,
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
                      aria-label={t("nav.viewName")}
                      placeholder={
                        selected
                          ? names.get(selected)
                            ? t("nav.viewOf", { name: names.get(selected)! })
                            : t("nav.viewOfSelection")
                          : t("nav.viewOfVisible")
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
                      {t("nav.saveView")}
                    </button>
                  </form>
                )}
              </div>
            </details>
          )}
          {!mobile && (
            <>
              <button
                type="button"
                aria-label={t("board.fit")}
                disabled={locked}
                title={t("board.fitTitle")}
                onClick={() => focusAfterMount()}
              >
                <Maximize2 size={15} />
              </button>
              <button
                type="button"
                aria-label={t("board.locate")}
                title={t("board.locateTitle")}
                disabled={locked || !selected}
                onClick={() => selected && focusAfterMount([selected], true)}
              >
                <Focus size={15} />
              </button>
              <span className="surface-toolbar-divider" />
              <ZoomControls scale={scale} controls={controls} locked={locked} />
            </>
          )}
          <fieldset className="surface-extra-actions" disabled={locked}>
            {extraActions}
          </fieldset>
          {onDraw && !locked && (
            <div className="board-writing-options" data-surface-ui>
              <button
                type="button"
                aria-label={t("tool.ruler")}
                title={t("tool.ruler")}
                aria-pressed={ruler}
                onClick={() => setRuler((value) => !value)}
              >
                <Ruler size={15} />
              </button>
              {window.showai?.inlineInk && (
                <details ref={writingSettings}>
                  <summary
                    aria-label={t("tool.writingSettings")}
                    title={t("tool.writingSettings")}
                  >
                    <Settings2 size={15} />
                  </summary>
                  <div data-surface-ui>
                    <label>
                      <input
                        type="checkbox"
                        defaultChecked={
                          document.documentElement.dataset.fingerDrawing ===
                          "true"
                        }
                        onChange={async (e) => {
                          const fingerDrawing = e.currentTarget.checked;
                          await window.showai!.invoke(
                            "native:boardPreferences",
                            { fingerDrawing },
                          );
                          document.documentElement.dataset.fingerDrawing =
                            String(fingerDrawing);
                          document.dispatchEvent(
                            new Event("showai-board-preferences"),
                          );
                        }}
                      />
                      {t("tool.fingerDrawing")}
                    </label>
                  </div>
                </details>
              )}
            </div>
          )}
          {onTransform && !locked && (
            <div className="board-settings-controls" hidden={!!objectMenu}>
              {board.ids.size > 0 && (
                <button
                  type="button"
                  aria-label={t("board.objectSettings")}
                  title={t("board.objectSettingsTitle")}
                  onClick={() => selected && onInspect?.(selected)}
                >
                  <Settings2 size={15} />
                </button>
              )}
              <div
                ref={setComponentActionsHost}
                className="board-component-actions"
                data-surface-ui
              />
              {!objectMenu && (
                <BoardStyleControls
                  tool={drawTool}
                  style={{
                    color: drawColor,
                    fillColor: drawFillColor,
                    strokeWidth: drawStrokeWidth,
                  }}
                  nodes={selectedNodes}
                  onChange={(patch) => onStyleChange?.([...board.ids], patch)}
                />
              )}
            </div>
          )}
        </DockableBoardToolbar>
      </div>
    </ObjectContext.Provider>
  );
}

function ZoomControls({
  scale: store,
  controls,
  locked,
}: {
  scale: ViewportScale;
  controls: ReturnType<typeof useSurfaceViewport>["controls"];
  locked: boolean;
}) {
  const scale = useViewportScale(store);
  const t = useTranslator(messages);
  return (
    <>
      <button
        type="button"
        aria-label={t("board.zoomOut")}
        disabled={locked || scale <= 0.25}
        onClick={() => controls.current.zoom(scale / 1.2)}
      >
        <Minus size={15} />
      </button>
      <button
        type="button"
        className="surface-zoom"
        aria-label={t("board.resetZoom")}
        disabled={locked}
        onClick={() => controls.current.zoom(1)}
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        aria-label={t("board.zoomIn")}
        disabled={locked || scale >= 2}
        onClick={() => controls.current.zoom(scale * 1.2)}
      >
        <Plus size={15} />
      </button>
    </>
  );
}
