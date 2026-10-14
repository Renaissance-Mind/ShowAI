import { LibraryContextMenu } from "../studio/LibraryNavigation";
import type { LibraryContextMenuItem } from "../studio/LibraryNavigation";
import type { SurfaceGeometryStore } from "./geometry-store";
import type { ShowDocument } from "../types";
import { useBoardInteraction } from "./useBoardInteraction";
import type { BoardGesture, BoardGestureInput } from "./useBoardInteraction";
import { DrawingInput } from "./Drawing";
import { boardToolForKey } from "./board-tools";
import type { JSONContent } from "@tiptap/core";
import type { BoardMode, BoardTool, DrawingStyle } from "./types";
import { findSurfaceNode } from "./document.mjs";
import { BoardStyleControls } from "./BoardStyleControls";
import { BoardMinimap } from "./BoardMinimap";
import { readingCapture } from "./reading-capture";
import {
  alignOffsets,
  isBoardClip,
  type AlignMode,
  type BoardClip,
  type StackOrder,
} from "./board-commands";
import { MAX_ZOOM, MIN_ZOOM } from "./model";
import { flushSync } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
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
  Clipboard,
  Scissors,
  BringToFront,
  SendToBack,
  ChevronUp,
  ChevronDown,
  Group,
  Ungroup,
  LockKeyhole,
  LockKeyholeOpen,
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  MapIcon,
  CheckSquare,
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
  /** Start editing an object's text at its end, e.g. right after creating it. */
  edit: (id: string) => void;
}
interface Props {
  children: ReactNode;
  boardDocument?: ShowDocument;
  geometry?: SurfaceGeometryStore;
  containerId?: string;
  onTransform?: (frames: Record<string, NodeLayout>, group?: string) => void;
  onDuplicate?: (
    ids: string[],
    offset?: { x: number; y: number },
  ) => string[] | void;
  onDeleteSelection?: (ids: string[]) => void;
  onCopyObjects?: (ids: string[]) => BoardClip | null;
  onPasteObjects?: (
    paste: { clip: BoardClip } | { text: string },
    point: { x: number; y: number } | null,
  ) => string[] | void;
  onReorder?: (ids: string[], order: StackOrder) => void;
  onGroup?: (
    ids: string[],
    bounds: { x: number; y: number; width: number; height: number },
    offset: { x: number; y: number },
  ) => string | null | void;
  onUngroup?: (id: string, offset: { x: number; y: number }) => string[] | void;
  onLock?: (ids: string[], locked: boolean) => void;
  ref?: Ref<SurfaceHandle>;
  pageId: string;
  enabled?: boolean;
  embedded?: boolean;
  printing?: boolean;
  onExpand?: (id: string) => void;
  drawTool?: BoardTool | null;
  boardMode?: "hand" | "text" | null;
  drawColor?: string;
  drawFillColor?: string;
  drawStrokeWidth?: number;
  onStyleChange?: (ids: string[], patch: Partial<DrawingStyle>) => void;
  onAddComponent?: (
    kind: string,
    point: { x: number; y: number },
  ) => string | void;
  onOpenComponents?: (
    point: { x: number; y: number },
    position: { x: number; y: number },
  ) => void;
  onDraw?: (
    node: JSONContent,
    frame: NodeLayout,
    adopt?: { ids: string[]; offset: { x: number; y: number } },
  ) => void;
  onDrawExit?: () => void;
  onToolChange?: (tool: BoardMode | null) => void;
  nodes: { id: string; name: string }[];
  layoutKey: unknown;
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

const controlSelector =
  'input,textarea,select,button,a,summary,[role="slider"],iframe,[data-surface-gesture="own"],.react-flow';
/** Free-region children are laid out inside its padding and border. */
const regionContentFallback = { x: 45, y: 27 };
/** Rich text sits inside the object's content padding. */
const textInset = { x: 28, y: 30 };
/** The most recent Board copy, for menu paste where the system clipboard is unreadable. */
let lastClip: BoardClip | null = null;
const clipType = "application/x-showai-board+json";

/** Place the caret under the pointer in the object's text, or at its end. */
function enterEditing(element: HTMLElement, x?: number, y?: number) {
  const under =
    x === undefined
      ? null
      : document
          .elementFromPoint(x, y!)
          ?.closest<HTMLElement>('[contenteditable="true"]');
  const editable =
    under && element.contains(under)
      ? under
      : element.querySelector<HTMLElement>('[contenteditable="true"]');
  if (!editable) return false;
  editable.focus({ preventScroll: true });
  let range: Range | null = null;
  if (x !== undefined) {
    const doc = document as Document & {
      caretPositionFromPoint?: (
        x: number,
        y: number,
      ) => { offsetNode: Node; offset: number } | null;
    };
    if (doc.caretRangeFromPoint) range = doc.caretRangeFromPoint(x, y!);
    else {
      const position = doc.caretPositionFromPoint?.(x, y!);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
      }
    }
  }
  if (!range || !editable.contains(range.startContainer)) {
    range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
  }
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

export default function PageSurface({
  children,
  boardDocument,
  geometry,
  containerId,
  onTransform,
  onDuplicate,
  onDeleteSelection,
  onCopyObjects,
  onPasteObjects,
  onReorder,
  onGroup,
  onUngroup,
  onLock,
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
  boardMode = null,
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
  const panMode = useRef(false);
  panMode.current = boardMode === "hand";
  const {
    rootRef,
    scrollRef,
    worldRef,
    scaleLabelRef,
    camera,
    controls,
    scale,
  } = useSurfaceViewport(
    layoutKey,
    onMove ? `showai.viewport.v3:${pageId}` : undefined,
    enabled && !locked,
    { reading: !onMove, anchorScreen: !embedded, panMode },
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
  const editable = !!onTransform && !locked;
  const focusRoot = () =>
    requestAnimationFrame(() =>
      rootRef.current?.focus({ preventScroll: true }),
    );
  const duplicateSelection = (ids: string[]) => {
    const copied = onDuplicate?.(ids);
    if (copied?.length) {
      board.selectIds(copied);
      focusRoot();
    }
  };
  const layoutOf = (id: string) => boardDocument?.layout?.[id];
  const selectedIds = [...board.ids];
  const allLocked =
    selectedIds.length > 0 && selectedIds.every((id) => layoutOf(id)?.locked);
  const selectedRegion =
    selectedIds.length === 1 &&
    boardDocument &&
    findSurfaceNode(boardDocument, selectedIds[0])?.node.type === "region" &&
    layoutOf(selectedIds[0])?.mode === "free"
      ? selectedIds[0]
      : null;
  /** The padding offset of a free region's children, measured when it is on screen. */
  const regionOffset = (id?: string) => {
    const element = id
      ? worldRef.current?.querySelector<HTMLElement>(
          `[data-surface-id="${CSS.escape(id)}"]`,
        )
      : null;
    const layer = element?.querySelector<HTMLElement>(
      ":scope > .surface-object-content .surface-layout-free",
    );
    if (!element || !layer || !element.offsetWidth)
      return regionContentFallback;
    const box = element.getBoundingClientRect(),
      inner = layer.getBoundingClientRect(),
      ratio = box.width / element.offsetWidth || 1;
    return {
      x: (inner.left - box.left) / ratio,
      y: (inner.top - box.top) / ratio,
    };
  };
  const copySelection = (ids: string[], cut = false) => {
    const clip = onCopyObjects?.(ids);
    if (!clip) return null;
    lastClip = clip;
    if (cut) {
      onDeleteSelection?.(ids);
      board.select(null);
    }
    return clip;
  };
  /** Last pointer position over the Board, in client coordinates. */
  const pastePoint = useRef<{ x: number; y: number } | null>(null);
  const paste = (
    value: { clip: BoardClip } | { text: string },
    point = pastePoint.current &&
      controls.current.point(pastePoint.current.x, pastePoint.current.y),
  ) => {
    const ids = onPasteObjects?.(value, point);
    if (ids?.length) {
      board.selectIds(ids);
      focusRoot();
    }
  };
  const reorder = (ids: string[], order: StackOrder) =>
    ids.length && onReorder?.(ids, order);
  const align = (mode: AlignMode) => {
    const ids = selectedIds.filter((id) => !layoutOf(id)?.locked);
    const offsets = alignOffsets(board.measured(ids), mode);
    const frames: Record<string, NodeLayout> = {};
    for (const [id, offset] of Object.entries(offsets)) {
      const frame = layoutOf(id);
      if (frame && (Math.abs(offset.x) > 1e-6 || Math.abs(offset.y) > 1e-6))
        frames[id] = { ...frame, x: frame.x + offset.x, y: frame.y + offset.y };
    }
    if (Object.keys(frames).length) onTransform?.(frames);
  };
  const group = (ids: string[]) => {
    const boxes = Object.values(board.measured(ids));
    if (!boxes.length || !onGroup) return;
    const left = Math.min(...boxes.map((b) => b.x)),
      top = Math.min(...boxes.map((b) => b.y));
    const bounds = {
      x: left,
      y: top,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - left,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - top,
    };
    const id = onGroup(ids, bounds, regionOffset());
    if (id) {
      board.selectIds([id]);
      focusRoot();
    }
  };
  const ungroup = (id: string) => {
    const ids = onUngroup?.(id, regionOffset(id));
    if (ids?.length) {
      board.selectIds(ids);
      focusRoot();
    }
  };
  const toggleLock = (ids: string[]) =>
    ids.length && onLock?.(ids, !ids.every((id) => layoutOf(id)?.locked));
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
    /** A click on the selected text object starts editing at the pointer. */
    enterEdit: HTMLElement | null;
    /** A click inside a multi-selection narrows it to the object under the pointer. */
    groupClick: boolean;
    input: BoardGestureInput;
  } | null>(null);
  const hovered = useRef<HTMLElement | null>(null);
  const hoverWindow = useRef({ id: "", since: 0, until: 0 });
  const hoverFrame = useRef(0);
  const bindTarget = useRef<HTMLElement | null>(null);
  const highlightTarget = (x: number | null, y?: number, exclude?: string) => {
    let next: HTMLElement | null = null;
    if (x !== null && Number.isFinite(x) && Number.isFinite(y)) {
      const hit = board.hitTest(x, y!);
      if (
        hit &&
        hit.id !== exclude &&
        !(hit.node.type === "drawing" && hit.node.attrs?.tool === "arrow")
      )
        next = hit.element;
    }
    if (next === bindTarget.current) return;
    bindTarget.current?.classList.remove("is-bind-target");
    next?.classList.add("is-bind-target");
    bindTarget.current = next;
  };
  const clearHover = () => {
    cancelAnimationFrame(hoverFrame.current);
    hovered.current?.classList.remove("is-hovered");
    hovered.current = null;
    rootRef.current?.classList.remove("has-drawing-hit");
  };
  const autoPan = useRef({ frame: 0, x: 0, y: 0 });
  const stopAutoPan = () => {
    cancelAnimationFrame(autoPan.current.frame);
    autoPan.current = { frame: 0, x: 0, y: 0 };
  };
  /** Dragging near the viewport edge scrolls the Board toward the pointer. */
  const trackEdges = (x: number, y: number) => {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect(),
      margin = 40,
      speed = 16;
    const velocity = (low: number, high: number, value: number) =>
      value < low + margin
        ? (Math.min(margin, low + margin - value) / margin) * speed
        : value > high - margin
          ? -(Math.min(margin, value - (high - margin)) / margin) * speed
          : 0;
    autoPan.current.x = velocity(box.left, box.right, x);
    autoPan.current.y = velocity(box.top, box.bottom, y);
    if ((autoPan.current.x || autoPan.current.y) && !autoPan.current.frame) {
      const step = () => {
        const { x, y } = autoPan.current;
        if (!x && !y) {
          autoPan.current.frame = 0;
          return;
        }
        controls.current.panBy(x, y);
        autoPan.current.frame = requestAnimationFrame(step);
      };
      autoPan.current.frame = requestAnimationFrame(step);
    }
  };
  const cancelPointing = () => {
    const pointer = pointing.current?.pointer;
    pointing.current = null;
    stopAutoPan();
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
    last: { x: number; y: number; shift: boolean; wrap: boolean };
  } | null>(null);
  const cancelMarquee = (restore = false) => {
    const drag = marquee.current;
    drag?.element.remove();
    marquee.current = null;
    stopAutoPan();
    if (restore && drag) board.selectIds(drag.base);
    if (drag && rootRef.current?.hasPointerCapture(drag.id))
      rootRef.current.releasePointerCapture(drag.id);
  };
  const updateMarquee = () => {
    const drag = marquee.current;
    if (!drag) return;
    const end = controls.current.point(drag.last.x, drag.last.y);
    drag.next = {
      x: Math.min(drag.start.x, end.x),
      y: Math.min(drag.start.y, end.y),
      width: Math.abs(end.x - drag.start.x),
      height: Math.abs(end.y - drag.start.y),
    };
    board.marquee(drag.next, drag.last.shift, drag.base, drag.last.wrap);
    Object.assign(drag.element.style, {
      left: `${drag.next.x}px`,
      top: `${drag.next.y}px`,
      width: `${drag.next.width}px`,
      height: `${drag.next.height}px`,
    });
  };
  // Camera moves during a gesture (wheel or edge auto-pan) keep the dragged
  // object or the marquee corner under the pointer.
  useEffect(() => {
    const root = rootRef.current!;
    const changed = (event: Event) => {
      if (event.target !== root) return;
      if (pointing.current?.moved) board.update(pointing.current.input);
      if (marquee.current) updateMarquee();
    };
    root.addEventListener("showai:viewport-change", changed);
    return () => root.removeEventListener("showai:viewport-change", changed);
  });
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
  const [minimap, setMinimap] = useState(() => {
    try {
      return localStorage.getItem("showai.board-minimap") === "true";
    } catch {
      return false;
    }
  });
  const toggleMinimap = () =>
    setMinimap((value) => {
      try {
        localStorage.setItem("showai.board-minimap", String(!value));
      } catch {
        /* A personal preference; the minimap still toggles for this view. */
      }
      return !value;
    });
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
  const editObject = (id: string) => {
    // The new object renders on the next frame; edit once its editor exists.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const element = worldRef.current?.querySelector<HTMLElement>(
          `[data-surface-id="${CSS.escape(id)}"]`,
        );
        if (element) enterEditing(element);
      }),
    );
  };
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
    edit: editObject,
  }));
  const addText = (point: { x: number; y: number }) => {
    // Offset by the text box padding so typing starts where the user clicked.
    const id = onAddComponent?.("text", {
      x: point.x - textInset.x,
      y: point.y - textInset.y,
    });
    if (id) {
      board.selectIds([id]);
      editObject(id);
    }
  };
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
    ? selectedIds.flatMap((id) => {
        const node = findSurfaceNode(boardDocument, id)?.node;
        return node ? [node] : [];
      })
    : [];
  const selectedContainer =
    selectedNodes.length === 1 && selectedNodes[0].type === "surface";
  const focusSelection = () =>
    selectedIds.length &&
    (selectedIds.length === 1
      ? focusAfterMount(selectedIds, true)
      : focusAfterMount(selectedIds));
  const alignItems: [AlignMode, string, ReactNode, string][] = [
    ["left", "左对齐", <AlignStartVertical size={14} />, "⌥A"],
    ["center", "水平居中", <AlignCenterVertical size={14} />, "⌥H"],
    ["right", "右对齐", <AlignEndVertical size={14} />, "⌥D"],
    ["top", "顶部对齐", <AlignStartHorizontal size={14} />, "⌥W"],
    ["middle", "垂直居中", <AlignCenterHorizontal size={14} />, "⌥V"],
    ["bottom", "底部对齐", <AlignEndHorizontal size={14} />, "⌥S"],
    [
      "distribute-x",
      "水平等距分布",
      <AlignHorizontalDistributeCenter size={14} />,
      "⌥⇧H",
    ],
    [
      "distribute-y",
      "垂直等距分布",
      <AlignVerticalDistributeCenter size={14} />,
      "⌥⇧V",
    ],
  ];
  const objectMenuItems = (ids: string[], id: string, container: boolean) => {
    const many = ids.length > 1;
    const lockedNow = ids.every((item) => layoutOf(item)?.locked);
    const region =
      ids.length === 1 &&
      boardDocument &&
      findSurfaceNode(boardDocument, id)?.node.type === "region" &&
      layoutOf(id)?.mode === "free";
    const items: LibraryContextMenuItem[] = [
      {
        label: many ? `复制 ${ids.length} 个对象` : "复制对象",
        icon: <Copy size={14} />,
        shortcut: "⌘D",
        onSelect: () => duplicateSelection(ids),
      },
      {
        label: "拷贝",
        icon: <Clipboard size={14} />,
        shortcut: "⌘C",
        disabled: !onCopyObjects,
        onSelect: () => copySelection(ids),
      },
      {
        label: "剪切",
        icon: <Scissors size={14} />,
        shortcut: "⌘X",
        disabled: !onCopyObjects,
        onSelect: () => copySelection(ids, true),
      },
      {
        label: "置于顶层",
        icon: <BringToFront size={14} />,
        shortcut: "⇧]",
        separatorBefore: true,
        onSelect: () => reorder(ids, "front"),
      },
      {
        label: "上移一层",
        icon: <ChevronUp size={14} />,
        shortcut: "]",
        onSelect: () => reorder(ids, "forward"),
      },
      {
        label: "下移一层",
        icon: <ChevronDown size={14} />,
        shortcut: "[",
        onSelect: () => reorder(ids, "backward"),
      },
      {
        label: "置于底层",
        icon: <SendToBack size={14} />,
        shortcut: "⇧[",
        onSelect: () => reorder(ids, "back"),
      },
      ...(many
        ? alignItems.map(
            ([mode, label, icon, shortcut], index): LibraryContextMenuItem => ({
              label,
              icon,
              shortcut,
              separatorBefore: index === 0,
              disabled: mode.startsWith("distribute") && ids.length < 3,
              onSelect: () => align(mode),
            }),
          )
        : []),
      region
        ? {
            label: "解除区域",
            icon: <Ungroup size={14} />,
            shortcut: "⇧⌘G",
            separatorBefore: true,
            onSelect: () => ungroup(id),
          }
        : {
            label: "放入区域",
            icon: <Group size={14} />,
            shortcut: "⌘G",
            separatorBefore: true,
            disabled: !onGroup,
            onSelect: () => group(ids),
          },
      {
        label: lockedNow ? "解锁" : "锁定",
        icon: lockedNow ? (
          <LockKeyholeOpen size={14} />
        ) : (
          <LockKeyhole size={14} />
        ),
        shortcut: "⇧⌘L",
        onSelect: () => toggleLock(ids),
      },
      {
        label: "对象设置",
        icon: <Settings2 size={14} />,
        onSelect: () => onInspect?.(id),
      },
      ...(container
        ? [
            {
              label: "展开容器",
              icon: <Maximize2 size={14} />,
              onSelect: () => onExpand?.(id),
            },
          ]
        : []),
      {
        label: many ? `删除 ${ids.length} 个对象` : "删除对象",
        icon: <Trash2 size={14} />,
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          onDeleteSelection?.(ids);
          board.select(null);
        },
      },
    ];
    return items;
  };
  const objectContext = useMemo<ObjectActions>(
    () => ({
      componentActionsHost,
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
      highlightTarget,
      readOnly: !onMove,
      revealAll: revealAll || printing || !!capture,
      revealed,
    }),
    // The board interaction object is rebuilt each render; its selection is
    // the part objects read.
    [
      componentActionsHost,
      scale,
      geometry,
      selected,
      [...board.ids].join(":"),
      onTransform,
      locked,
      onInspect,
      onExpand,
      onRemove,
      onMove,
      onConnect,
      revealAll,
      printing,
      revealed,
      boardDocument,
    ],
  );
  const showSelectionBar = editable && !objectMenu;
  return (
    <ObjectContext.Provider value={objectContext}>
      <div
        ref={(element) => {
          rootRef.current = element;
          lock.ref.current = element;
        }}
        className={`page-surface${objectMenu ? " has-object-menu" : ""}${onMove && !embedded && !printing && !capture ? " has-board-grid" : ""}${boardMode === "hand" ? " is-hand-tool" : ""}${boardMode === "text" ? " is-text-tool" : ""}`}
        data-input-surface={enabled && !locked ? pageId : undefined}
        data-viewport-lock-scope={embedded ? "board" : undefined}
        data-viewport-locked={locked}
        data-board-id={pageId}
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
          const target = event.target as Element;
          const hit = board.hitTest(event.clientX, event.clientY);
          if (navigation.current) navigation.current.open = false;
          // Any object under the pointer gets the object menu, not only its frame.
          if (
            openObjectMenu(
              hit && !target.closest(controlSelector) ? hit.element : target,
              { x: event.clientX, y: event.clientY },
            )
          ) {
            event.preventDefault();
            event.stopPropagation();
          } else if (
            onAddComponent &&
            onTransform &&
            !locked &&
            target.closest(".page-surface") === event.currentTarget &&
            !target.closest(
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
        onDoubleClick={(event) => {
          // Double-clicking empty Board space writes text there.
          const target = event.target as Element;
          if (
            !editable ||
            !onAddComponent ||
            drawTool ||
            boardMode === "hand" ||
            target.closest(".page-surface") !== event.currentTarget ||
            target.closest("[data-surface-content],[data-surface-ui]") ||
            board.hitTest(event.clientX, event.clientY)
          )
            return;
          event.preventDefault();
          addText(controls.current.point(event.clientX, event.clientY));
        }}
        onPointerDownCapture={(event) => {
          const target = event.target as Element;
          if (target.closest(".page-surface") !== event.currentTarget) return;
          if (!target.closest(".surface-popover-anchor") && navigation.current)
            navigation.current.open = false;
          if (!target.closest("[data-surface-ui]")) setObjectMenu(null);
          if (
            boardMode === "text" &&
            editable &&
            event.button === 0 &&
            !spaceHeld.current &&
            !target.closest("[data-surface-ui]")
          ) {
            event.preventDefault();
            event.stopPropagation();
            addText(controls.current.point(event.clientX, event.clientY));
            return;
          }
          const selectionId = board.selectionHit(event.clientX, event.clientY);
          const handle =
            target.closest<HTMLElement>(
              ".board-resize-handle,.surface-object-rotate",
            ) ??
            (drawTool && target.closest("[data-board-drawing-input]")
              ? [
                  ...(worldRef.current?.querySelectorAll<HTMLElement>(
                    ".surface-object.is-selected > .board-resize-handle, .surface-object.is-selected > .surface-object-rotate, .board-group-outline > .board-resize-handle",
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
          // While drawing, pausing on an object's edge grabs it. Freehand and
          // arrow tools never grab: strokes and connections start on edges.
          const edge =
            drawTool && drawTool !== "arrow"
              ? board.edgeHit(event.clientX, event.clientY)
              : null;
          const quickSelect =
            !!edge &&
            drawTool !== "pen" &&
            drawTool !== "highlighter" &&
            hoverWindow.current.id === edge.id &&
            performance.now() >= hoverWindow.current.since + 180 &&
            (hovered.current === edge.element ||
              performance.now() <= hoverWindow.current.until);
          if (
            target.closest("[data-surface-handle],[data-board-drawing-input]")
          ) {
            cancelMarquee();
            controls.current.cancel();
          }
          if (
            !onTransform ||
            locked ||
            (drawTool && !quickSelect && !handle) ||
            event.button !== 0 ||
            (event.pointerType === "touch" && !handle) ||
            spaceHeld.current ||
            panMode.current ||
            (!handle && target.closest("[data-surface-handle]")) ||
            (!handle && target.closest("[data-surface-ui]")) ||
            (!handle && target.closest(controlSelector))
          )
            return;
          const hit = board.hitTest(event.clientX, event.clientY);
          const forceBrush = event.ctrlKey || event.metaKey;
          let enterEdit: HTMLElement | null = null;
          let moveId: string | null | undefined = null;
          if (handle)
            moveId =
              handle.dataset.groupTarget ??
              handle.closest<HTMLElement>("[data-surface-id]")?.dataset
                .surfaceId;
          else if (!forceBrush && !event.shiftKey && selectionId)
            moveId = selectionId;
          else if (quickSelect) moveId = edge?.id;
          else if (hit?.node.type === "drawing") moveId = hit.id;
          else if (hit) {
            const element = hit.element;
            const inText = target.closest('[contenteditable="true"]');
            const editing =
              !!inText &&
              element.contains(inText) &&
              element.contains(document.activeElement);
            const solo = board.ids.size === 1 && board.ids.has(hit.id);
            const textual =
              hit.node.type !== "region" &&
              !!element.querySelector('[contenteditable="true"]');
            // Editing text keeps native caret and selection gestures. A
            // selected component receives clicks on its own content; a
            // selected text object or region moves on drag, and text starts
            // editing on click.
            if (
              editing ||
              (solo &&
                !textual &&
                hit.node.type !== "region" &&
                target !== element &&
                element.contains(target) &&
                !forceBrush)
            )
              return;
            if (!forceBrush) {
              moveId = hit.id;
              if (solo && textual && !event.shiftKey) enterEdit = element;
            }
          }
          if (moveId && (!forceBrush || handle)) {
            event.preventDefault();
            event.stopPropagation();
            controls.current.cancel();
            cancelMarquee();
            clearHover();
            const gesture: BoardGesture = handle?.dataset.resizeDirection
              ? `resize-${handle.dataset.resizeDirection}`
              : handle
                ? "rotate"
                : "move";
            let wasSelected = board.ids.has(moveId);
            // Alt-drag leaves the original in place and moves a copy.
            if (event.altKey && gesture === "move" && onDuplicate) {
              const ids = wasSelected ? [...board.ids] : [moveId];
              let copies: string[] | void = undefined;
              flushSync(() => {
                copies = onDuplicate(ids, { x: 0, y: 0 });
                if (copies?.length) board.selectIds(copies);
              });
              const copied = copies as string[] | void;
              if (copied?.length) {
                moveId = copied[ids.indexOf(moveId)] ?? copied[0];
                wasSelected = true;
                enterEdit = null;
              }
            }
            const groupClick =
              !handle && !event.shiftKey && board.ids.size > 1 && wasSelected;
            if (event.shiftKey && !wasSelected) board.select(moveId, true);
            if (!board.start(moveId, gesture, event)) {
              // Locked objects are selected but stay in place.
              if (!event.shiftKey) board.select(moveId);
              event.currentTarget.focus({ preventScroll: true });
              return;
            }
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
              enterEdit,
              groupClick,
              input: event,
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
            last: {
              x: event.clientX,
              y: event.clientY,
              shift: event.shiftKey,
              wrap: forceBrush,
            },
          };
          if (!event.shiftKey && !forceBrush) board.select(null);
        }}
        onPointerMoveCapture={(event) => {
          pastePoint.current = { x: event.clientX, y: event.clientY };
          const pointer = pointing.current;
          if (pointer?.pointer === event.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            pointer.moved ||=
              Math.hypot(
                event.clientX - pointer.x,
                event.clientY - pointer.y,
              ) >= 3;
            pointer.input = {
              clientX: event.clientX,
              clientY: event.clientY,
              altKey: event.altKey,
              shiftKey: event.shiftKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
            };
            board.update(pointer.input);
            if (pointer.moved) trackEdges(event.clientX, event.clientY);
            return;
          }
          if (
            !marquee.current &&
            !locked &&
            !event.buttons &&
            (event.target as Element).closest(".page-surface") ===
              event.currentTarget
          ) {
            // Hover feedback runs once per frame, not once per pointer sample.
            const x = event.clientX,
              y = event.clientY;
            cancelAnimationFrame(hoverFrame.current);
            hoverFrame.current = requestAnimationFrame(() => {
              const hit = drawTool
                ? drawTool === "arrow"
                  ? null
                  : board.edgeHit(x, y)
                : board.hitTest(x, y, false);
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
                hovered.current?.classList.remove("is-hovered");
                hovered.current = element;
                element?.classList.add("is-hovered");
              }
              // The move cursor appears only once a grab is actually armed.
              rootRef.current?.classList.toggle(
                "has-drawing-hit",
                !!element &&
                  !!drawTool &&
                  drawTool !== "pen" &&
                  drawTool !== "highlighter" &&
                  now >= hoverWindow.current.since + 180,
              );
            });
          }
          const drag = marquee.current;
          if (!drag || drag.id !== event.pointerId) return;
          event.preventDefault();
          event.stopPropagation();
          drag.last = {
            x: event.clientX,
            y: event.clientY,
            shift: event.shiftKey,
            wrap: event.ctrlKey || event.metaKey,
          };
          updateMarquee();
          trackEdges(event.clientX, event.clientY);
        }}
        onPointerUpCapture={(event) => {
          const pointer = pointing.current;
          if (pointer?.pointer === event.pointerId) {
            event.preventDefault();
            event.stopPropagation();
            pointing.current = null;
            stopAutoPan();
            pointer.moved ||=
              Math.hypot(
                event.clientX - pointer.x,
                event.clientY - pointer.y,
              ) >= 3;
            board.update(event);
            board.finish();
            controls.current.objectGesture(false);
            if (!pointer.moved) {
              if (pointer.enterEdit)
                enterEditing(pointer.enterEdit, event.clientX, event.clientY);
              else if (pointer.groupClick) {
                const hit = board.hitTest(event.clientX, event.clientY);
                board.select(hit && board.ids.has(hit.id) ? hit.id : null);
              } else if (pointer.wasSelected && !pointer.preserveSelection)
                board.select(pointer.id, pointer.additive);
            }
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
        onPointerLeave={() => {
          clearHover();
          pastePoint.current = null;
        }}
        onCopy={(event) => {
          if (!editable || !board.ids.size || ownsText(event.target)) return;
          const clip = copySelection([...board.ids]);
          if (!clip) return;
          event.preventDefault();
          event.clipboardData.setData(clipType, JSON.stringify(clip));
          event.clipboardData.setData("text/plain", JSON.stringify(clip));
        }}
        onCut={(event) => {
          if (!editable || !board.ids.size || ownsText(event.target)) return;
          const clip = copySelection([...board.ids], true);
          if (!clip) return;
          event.preventDefault();
          event.clipboardData.setData(clipType, JSON.stringify(clip));
          event.clipboardData.setData("text/plain", JSON.stringify(clip));
        }}
        onPaste={(event) => {
          if (!editable || !onPasteObjects || ownsText(event.target)) return;
          const data =
            event.clipboardData.getData(clipType) ||
            event.clipboardData.getData("text/plain");
          let clip: unknown = null;
          try {
            clip = JSON.parse(data);
          } catch {
            /* Ordinary text becomes a text object. */
          }
          event.preventDefault();
          if (isBoardClip(clip)) paste({ clip });
          else if (data.trim()) paste({ text: data });
        }}
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
            if (
              (drawTool || boardMode) &&
              !target.closest('[data-drawing-active="true"]')
            ) {
              event.preventDefault();
              event.stopPropagation();
              onDrawExit?.();
              return;
            }
          }
          // View shortcuts work in every Board, including read-only ones.
          const command = event.metaKey || event.ctrlKey;
          if (event.shiftKey && !command && !event.altKey && !locked) {
            const view = { Digit0: 0, Digit1: 1, Digit2: 2 }[event.code];
            if (view !== undefined) {
              event.preventDefault();
              event.stopPropagation();
              if (view === 0) controls.current.zoom(1);
              else if (view === 1) focusAfterMount();
              else focusSelection();
              return;
            }
          }
          if (!editable || target.closest('[data-drawing-active="true"]'))
            return;
          if (
            !command &&
            !event.altKey &&
            !event.shiftKey &&
            !pointing.current &&
            !marquee.current
          ) {
            const entry = boardToolForKey(event.key);
            if (entry) {
              event.preventDefault();
              event.stopPropagation();
              clearHover();
              board.select(null);
              onToolChange?.(entry.tool);
              return;
            }
          }
          const ids = [...board.ids];
          const run = (action: () => void) => {
            event.preventDefault();
            event.stopPropagation();
            action();
          };
          if (command && event.key.toLowerCase() === "a")
            return run(() => board.selectAll());
          if (command && event.key.toLowerCase() === "d" && ids.length)
            return run(() => duplicateSelection(ids));
          if (command && event.code === "KeyG" && ids.length)
            return run(() =>
              event.shiftKey
                ? selectedRegion && ungroup(selectedRegion)
                : group(ids),
            );
          if (command && event.shiftKey && event.code === "KeyL" && ids.length)
            return run(() => toggleLock(ids));
          if (
            (event.code === "BracketRight" || event.code === "BracketLeft") &&
            ids.length
          )
            return run(() =>
              reorder(
                ids,
                event.code === "BracketRight"
                  ? event.shiftKey || event.altKey
                    ? "front"
                    : "forward"
                  : event.shiftKey || event.altKey
                    ? "back"
                    : "backward",
              ),
            );
          if (event.altKey && !command && ids.length > 1) {
            const mode = (
              {
                KeyA: "left",
                KeyD: "right",
                KeyW: "top",
                KeyS: "bottom",
                KeyH: event.shiftKey ? "distribute-x" : "center",
                KeyV: event.shiftKey ? "distribute-y" : "middle",
              } as Record<string, AlignMode>
            )[event.code];
            if (mode) return run(() => align(mode));
          }
          if (event.key === "Enter" && !command && ids.length === 1) {
            const element = worldRef.current?.querySelector<HTMLElement>(
              `[data-surface-id="${CSS.escape(ids[0])}"]`,
            );
            if (element?.querySelector('[contenteditable="true"]'))
              return run(() => enterEditing(element));
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
            ids.length &&
            !target.closest(
              "[data-resize-direction],.surface-object-rotate,.board-arrow-endpoint,input,select",
            )
          )
            return run(() =>
              board.nudge(
                step[0] * (event.shiftKey ? 10 : 1),
                step[1] * (event.shiftKey ? 10 : 1),
              ),
            );
          if (
            (event.key === "Delete" || event.key === "Backspace") &&
            ids.length
          )
            return run(() => {
              onDeleteSelection?.(ids);
              board.select(null);
            });
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
          const target = event.target as Element;
          if (
            target.closest("[data-input-surface]") !== event.currentTarget ||
            event.key !== "Escape" ||
            event.defaultPrevented ||
            target.closest("input,textarea")
          )
            return;
          const text = target.closest("[contenteditable]");
          if (text?.getAttribute("contenteditable") === "true") {
            // Escape leaves text editing and keeps that object selected.
            const object = text.closest<HTMLElement>(".surface-object");
            if (
              !object ||
              object.closest(".page-surface") !== event.currentTarget
            )
              return;
            event.preventDefault();
            window.getSelection()?.removeAllRanges();
            event.currentTarget.focus({ preventScroll: true });
            if (editable) board.selectIds([object.dataset.surfaceId!]);
            return;
          }
          board.select(null);
          if (navigation.current) navigation.current.open = false;
        }}
        aria-description={
          locked
            ? "视图已锁定。可以点击内容，滚动用于外层页面阅读；右上角解锁后可缩放和移动。"
            : onTransform
              ? "单击选择对象，拖动移动，再次单击编辑文字；拖动空白处框选；空格、中键或 H 抓手拖动画布；双击空白处写文字。V 选择，P 画笔，M 荧光笔，R 矩形，E 椭圆，A 箭头，F 区域，T 文字；⇧1 总览，⇧2 定位所选，⇧0 回到 100%；Escape 取消当前操作。"
              : "在白板上滚动或拖动空白处浏览。方向键浏览，0 总览；Escape 取消当前操作。"
        }
      >
        {objectMenu && (
          <LibraryContextMenu
            anchor={objectMenu.anchor}
            point={objectMenu.point}
            label="对象操作"
            onClose={() => setObjectMenu(null)}
            items={
              objectMenu.insertion
                ? [
                    {
                      label: "添加 Page",
                      icon: <PanelTop size={14} />,
                      onSelect: () =>
                        onAddComponent?.("page", objectMenu.insertion!),
                    },
                    {
                      label: "添加文字",
                      icon: <FileText size={14} />,
                      shortcut: "T",
                      onSelect: () => addText(objectMenu.insertion!),
                    },
                    {
                      label: "添加组件…",
                      icon: <Plus size={14} />,
                      onSelect: () =>
                        onOpenComponents?.(
                          objectMenu.point,
                          objectMenu.insertion!,
                        ),
                    },
                    {
                      label: "粘贴",
                      icon: <Clipboard size={14} />,
                      shortcut: "⌘V",
                      separatorBefore: true,
                      disabled: !lastClip || !onPasteObjects,
                      onSelect: () =>
                        lastClip &&
                        paste({ clip: lastClip }, objectMenu.insertion!),
                    },
                    {
                      label: "全选",
                      icon: <CheckSquare size={14} />,
                      shortcut: "⌘A",
                      disabled: !nodes.length,
                      onSelect: () => board.selectAll(),
                    },
                  ]
                : objectMenuItems(
                    objectMenu.ids,
                    objectMenu.id,
                    objectMenu.container,
                  )
            }
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
            fillColor={drawFillColor}
            strokeWidth={drawStrokeWidth}
            camera={camera}
            point={(x, y) => controls.current.point(x, y)}
            onTarget={(x, y) => highlightTarget(x, y)}
            onDraw={(node, frame) => {
              // A region drawn around objects takes them in, like a frame.
              let adopt;
              if (node.type === "region" && containerId && boardDocument) {
                const index = findSurfaceNode(boardDocument, containerId)?.node;
                const siblings = (index?.content ?? [])
                  .map((child) => child.attrs?.id as string)
                  .filter((id) => id && !layoutOf(id)?.locked);
                const inside = Object.entries(board.measured(siblings))
                  .filter(
                    ([, box]) =>
                      box.x >= frame.x &&
                      box.y >= frame.y &&
                      box.x + box.width <= frame.x + frame.width &&
                      box.y + box.height <= frame.y + (frame.height ?? 0),
                  )
                  .map(([id]) => id);
                if (inside.length)
                  adopt = { ids: inside, offset: regionOffset() };
              }
              onDraw(node, frame, adopt);
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
        {!nodes.length && !drawTool && !boardMode && editable && !embedded && (
          <div className="surface-empty is-hint" aria-hidden="true">
            <p>双击空白处写文字，按 / 或右键添加组件，P 画笔、R 矩形</p>
          </div>
        )}
        {minimap && !embedded && !printing && boardDocument && containerId && (
          <BoardMinimap
            root={rootRef}
            world={worldRef}
            camera={camera}
            layoutKey={layoutKey}
            onNavigate={(next) => controls.current.moveTo(next, true)}
          />
        )}
        {showSelectionBar && (
          <div
            className="board-selection-bar"
            data-surface-ui
            role="toolbar"
            aria-label="所选对象"
          >
            {board.ids.size > 1 && (
              <span className="board-selection-count" role="status">
                已选 {board.ids.size} 项
              </span>
            )}
            {board.ids.size > 0 && (
              <>
                {selectedContainer && (
                  <button
                    type="button"
                    aria-label="展开选中容器"
                    title="展开容器"
                    onClick={() => selected && onExpand?.(selected)}
                  >
                    <Maximize2 size={15} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => duplicateSelection(selectedIds)}
                  aria-label="复制选中对象"
                  title="复制选中对象（⌘/Ctrl D，或按住 Alt 拖动）"
                >
                  <Copy size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => reorder(selectedIds, "front")}
                  aria-label="置于顶层"
                  title="置于顶层（⇧]）；] 上移一层"
                >
                  <BringToFront size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => reorder(selectedIds, "back")}
                  aria-label="置于底层"
                  title="置于底层（⇧[）；[ 下移一层"
                >
                  <SendToBack size={15} />
                </button>
                {board.ids.size > 1 && (
                  <details className="surface-popover-anchor board-align-menu">
                    <summary aria-label="对齐与分布" title="对齐与分布">
                      <AlignStartVertical size={15} />
                    </summary>
                    <div className="board-align-options" role="group">
                      {alignItems.map(([mode, label, icon, shortcut]) => (
                        <button
                          type="button"
                          key={mode}
                          aria-label={label}
                          title={`${label}（${shortcut}）`}
                          disabled={
                            mode.startsWith("distribute") && board.ids.size < 3
                          }
                          onClick={() => align(mode)}
                        >
                          {icon}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
                {selectedRegion ? (
                  <button
                    type="button"
                    aria-label="解除区域"
                    title="解除区域（⇧⌘G）"
                    onClick={() => ungroup(selectedRegion)}
                  >
                    <Ungroup size={15} />
                  </button>
                ) : (
                  board.ids.size > 1 &&
                  onGroup && (
                    <button
                      type="button"
                      aria-label="放入区域"
                      title="放入区域（⌘G）"
                      onClick={() => group(selectedIds)}
                    >
                      <Group size={15} />
                    </button>
                  )
                )}
                <button
                  type="button"
                  aria-label={allLocked ? "解锁" : "锁定"}
                  aria-pressed={allLocked}
                  title={`${allLocked ? "解锁" : "锁定"}（⇧⌘L）`}
                  onClick={() => toggleLock(selectedIds)}
                >
                  {allLocked ? (
                    <LockKeyhole size={15} />
                  ) : (
                    <LockKeyholeOpen size={15} />
                  )}
                </button>
                <button
                  type="button"
                  aria-label="选中对象设置"
                  title="对象布局设置：名称、尺寸与所属容器"
                  onClick={() => selected && onInspect?.(selected)}
                >
                  <Settings2 size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onDeleteSelection?.(selectedIds);
                    board.select(null);
                  }}
                  aria-label="删除选中对象"
                  title="删除（Delete）"
                >
                  <Trash2 size={15} />
                </button>
              </>
            )}
            <div
              ref={setComponentActionsHost}
              className="board-component-actions"
              data-surface-ui
            />
            <BoardStyleControls
              tool={drawTool}
              style={{
                color: drawColor,
                fillColor: drawFillColor,
                strokeWidth: drawStrokeWidth,
              }}
              nodes={drawTool ? [] : selectedNodes}
              onChange={(patch) =>
                onStyleChange?.(drawTool ? [] : selectedIds, patch)
              }
            />
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
            title="总览全部内容（⇧1）"
            onClick={() => focusAfterMount()}
          >
            <Maximize2 size={15} />
          </button>
          <button
            type="button"
            aria-label="定位所选"
            title="定位所选内容（⇧2）"
            disabled={locked || !selectedIds.length}
            onClick={focusSelection}
          >
            <Focus size={15} />
          </button>
          <span className="surface-toolbar-divider" />
          <button
            type="button"
            aria-label="缩小白板"
            title="缩小（-）"
            disabled={locked || scale <= MIN_ZOOM}
            onClick={() => controls.current.zoom(camera.current.scale / 1.2)}
          >
            <Minus size={15} />
          </button>
          <button
            type="button"
            className="surface-zoom"
            aria-label="重置缩放"
            title="回到 100%（⇧0）"
            disabled={locked}
            onClick={() => controls.current.zoom(1)}
          >
            <span ref={scaleLabelRef}>{Math.round(scale * 100)}%</span>
          </button>
          <button
            type="button"
            aria-label="放大白板"
            title="放大（+）"
            disabled={locked || scale >= MAX_ZOOM}
            onClick={() => controls.current.zoom(camera.current.scale * 1.2)}
          >
            <Plus size={15} />
          </button>
          <fieldset className="surface-extra-actions" disabled={locked}>
            {extraActions}
          </fieldset>
          {!embedded && !printing && (
            <button
              type="button"
              aria-label="小地图"
              aria-pressed={minimap}
              title="小地图"
              onClick={toggleMinimap}
            >
              <MapIcon size={15} />
            </button>
          )}
        </div>
      </div>
    </ObjectContext.Provider>
  );
}

/** Clipboard events inside text or form fields stay with that field. */
function ownsText(target: EventTarget) {
  return (
    target instanceof Element &&
    !!target.closest(
      "input,textarea,select,[contenteditable=true],[data-editor-keyboard-scope]",
    )
  );
}
