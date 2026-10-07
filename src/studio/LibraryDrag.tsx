import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import type { LibraryTarget } from "./LibraryNavigation";

export interface LibraryDrop {
  source: LibraryTarget;
  projectId?: string;
  parentId?: string | null;
  sectionId?: string;
  relativeId?: string;
  placement?: "before" | "after";
}
interface Destination {
  key: string;
  position: "before" | "after" | "inside";
  drop: LibraryDrop;
}
type RowBinding = {
  target: LibraryTarget;
  expanded: boolean;
  toggle?: () => void;
};
export const LibraryDragContext = createContext<{
  row: (
    target: LibraryTarget,
    expanded: boolean,
    toggle?: () => void,
  ) => HTMLAttributes<HTMLDivElement>;
  section: (id: string, expand: () => void) => HTMLAttributes<HTMLDivElement>;
} | null>(null);
export const useLibraryDrag = () => useContext(LibraryDragContext);

/** Pointer dragging keeps row buttons clickable and also works with touch/pen input. */
export function useLibraryDragController(options: {
  sectionFor: (projectId: string) => string;
  parentFor: (projectId: string, id: string) => string | null;
  onDrop: (drop: LibraryDrop) => void;
  onStart: () => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const rows = useRef(new Map<string, RowBinding>());
  const sections = useRef(new Map<string, () => void>());
  const gesture = useRef<{
    source: LibraryTarget;
    x: number;
    y: number;
    pointerId: number;
    active: boolean;
    sidebar: HTMLElement;
  } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    title: string;
    x: number;
    y: number;
  } | null>(null);
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    let expansion: {
      key: string;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    let frame = 0;
    let point = { x: 0, y: 0 };
    let suppressUntil = 0;
    const clearExpansion = () => {
      if (expansion) clearTimeout(expansion.timer);
      expansion = null;
    };
    const reset = () => {
      if (gesture.current?.active) suppressUntil = Date.now() + 250;
      clearExpansion();
      cancelAnimationFrame(frame);
      frame = 0;
      gesture.current = null;
      setDragging(null);
      setDestination(null);
      setPreview(null);
      document.body.classList.remove("library-drag-active");
      document.body.style.cursor = "";
    };
    const locate = (): {
      destination: Destination | null;
      expand?: () => void;
    } => {
      const current = gesture.current;
      if (!current) return { destination: null };
      const item = current.source;
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit || !current.sidebar.contains(hit)) return { destination: null };
      const element = hit.closest<HTMLElement>(".studio-tree-row");
      if (!element) {
        const section = hit.closest<HTMLElement>("[data-library-drop-section]");
        const id = section?.dataset.libraryDropSection;
        return id && item.kind === "project"
          ? {
              destination: {
                key: `section:${id}`,
                position: "inside",
                drop: { source: item, sectionId: id },
              },
              expand: sections.current.get(id),
            }
          : { destination: null };
      }
      const binding = rows.current.get(element.dataset.libraryId!);
      if (!binding) return { destination: null };
      const target = binding.target;
      if (target.id === item.id && target.projectId === item.projectId)
        return { destination: null };
      const rect = element.getBoundingClientRect();
      const fraction = (point.y - rect.top) / rect.height;
      if (item.kind === "project") {
        const position = fraction < 0.5 ? "before" : "after";
        return {
          destination:
            target.kind === "project"
              ? {
                  key: target.id,
                  position,
                  drop: {
                    source: item,
                    sectionId: latest.current.sectionFor(target.id),
                    relativeId: target.id,
                    placement: position,
                  },
                }
              : null,
        };
      }
      if (item.kind === "folder" && item.projectId !== target.projectId)
        return { destination: null };
      const inside =
        target.kind === "project" ||
        (target.kind === "folder" && fraction >= 0.25 && fraction <= 0.75);
      const parentId = inside
        ? target.kind === "project"
          ? null
          : target.id
        : target.parentId;
      if (item.kind === "folder") {
        let ancestor = parentId;
        const visited = new Set<string>();
        while (ancestor && !visited.has(ancestor)) {
          if (ancestor === item.id) return { destination: null };
          visited.add(ancestor);
          ancestor = latest.current.parentFor(target.projectId, ancestor);
        }
      }
      const position = inside ? "inside" : fraction < 0.5 ? "before" : "after";
      return {
        destination: {
          key: target.id,
          position,
          drop: {
            source: item,
            projectId: target.projectId,
            parentId,
            ...(!inside
              ? {
                  relativeId: target.id,
                  placement: position as "before" | "after",
                }
              : {}),
          },
        },
        expand: inside && !binding.expanded ? binding.toggle : undefined,
      };
    };
    const update = () => {
      const { destination: next, expand } = locate();
      setDestination((current) =>
        current?.key === next?.key && current?.position === next?.position
          ? current
          : next,
      );
      document.body.style.cursor = next ? "grabbing" : "not-allowed";
      if (next?.position === "inside" && expand) {
        if (expansion?.key !== next.key) {
          clearExpansion();
          expansion = { key: next.key, timer: setTimeout(expand, 650) };
        }
      } else clearExpansion();
    };
    const scroll = () => {
      const current = gesture.current;
      if (!current?.active) return;
      const panel = current.sidebar.querySelector<HTMLElement>(
        ".studio-sidebar-projects",
      );
      if (panel) {
        const rect = panel.getBoundingClientRect();
        if (
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom
        ) {
          const delta =
            point.y < rect.top + 32 ? -8 : point.y > rect.bottom - 32 ? 8 : 0;
          if (delta) {
            panel.scrollTop += delta;
            update();
          }
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      point = { x: event.clientX, y: event.clientY };
      if (!current.active) {
        if (Math.hypot(point.x - current.x, point.y - current.y) < 6) return;
        current.active = true;
        latest.current.onStart();
        setDragging(current.source.id);
        document.body.classList.add("library-drag-active");
        frame = requestAnimationFrame(scroll);
      }
      event.preventDefault();
      setPreview({
        title: current.source.title,
        x: Math.min(point.x + 14, window.innerWidth - 180),
        y: Math.min(point.y + 14, window.innerHeight - 36),
      });
      update();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== gesture.current?.pointerId) return;
      point = { x: event.clientX, y: event.clientY };
      const next = gesture.current.active ? locate().destination : null;
      reset();
      if (next) {
        event.preventDefault();
        latest.current.onDrop(next.drop);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current?.active) {
        event.preventDefault();
        event.stopPropagation();
        reset();
      }
    };
    const click = (event: MouseEvent) => {
      if (Date.now() < suppressUntil || gesture.current?.active) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", key, true);
    window.addEventListener("click", click, true);
    return () => {
      reset();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("click", click, true);
    };
  }, []);

  const row = (
    target: LibraryTarget,
    expanded: boolean,
    toggle?: () => void,
  ): HTMLAttributes<HTMLDivElement> => {
    rows.current.set(target.id, { target, expanded, toggle });
    return {
      "aria-description": "拖动调整顺序，拖到项目或文件夹中移动页面",
      "data-library-draggable": true,
      "data-dragging": dragging === target.id || undefined,
      "data-drop-position":
        destination?.key === target.id ? destination.position : undefined,
      onDragStart: (event) => event.preventDefault(),
      onPointerDown: (event) => {
        if (
          event.button !== 0 ||
          (event.target as HTMLElement).closest(
            ".studio-row-menu,.studio-tree-chevron",
          )
        )
          return;
        const sidebar =
          event.currentTarget.closest<HTMLElement>(".studio-sidebar");
        if (!sidebar) return;
        gesture.current = {
          source: target,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          active: false,
          sidebar,
        };
      },
    } as HTMLAttributes<HTMLDivElement>;
  };
  const section = (
    id: string,
    expand: () => void,
  ): HTMLAttributes<HTMLDivElement> => {
    sections.current.set(id, expand);
    return {
      "data-library-drop-section": id,
      "data-drop-position":
        destination?.key === `section:${id}` ? "inside" : undefined,
    } as HTMLAttributes<HTMLDivElement>;
  };
  return { dragging: !!dragging, preview, bindings: { row, section } };
}
