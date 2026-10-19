import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import type { LibraryTarget } from "./LibraryNavigation";
import { LibraryDragPreview } from "./LibraryDragPreview";
import { translator } from "../i18n";
import sidebarMessages from "../i18n/messages/sidebar";

const t = translator(sidebarMessages);

export interface LibraryDrop {
  source: LibraryTarget;
  projectId?: string;
  parentId?: string | null;
  sectionId?: string;
  relativeId?: string;
  placement?: "before" | "after";
}
interface Destination {
  element: HTMLElement;
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
  onDrop: (drop: LibraryDrop) => unknown | Promise<unknown>;
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
    element: HTMLElement;
  } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const visual = useRef<LibraryDragPreview | null>(null);
  const destination = useRef<Destination | null>(null);
  const finishing = useRef(false);

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
      destination.current = null;
      visual.current?.dispose();
      visual.current = null;
      finishing.current = false;
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
      if (visual.current?.inPlaceholder(point.x, point.y)) {
        const next = destination.current;
        const binding = next && rows.current.get(next.key);
        return {
          destination: next,
          expand:
            next?.position === "inside" && !binding?.expanded
              ? (binding?.toggle ??
                sections.current.get(next.key.replace(/^section:/, "")))
              : undefined,
        };
      }
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit || !current.sidebar.contains(hit)) return { destination: null };
      const element =
        visual.current?.hit(point.x, point.y) ??
        hit.closest<HTMLElement>(".studio-tree-row, .studio-page-list-row");
      if (!element) {
        const section = hit.closest<HTMLElement>("[data-library-drop-section]");
        const id = section?.dataset.libraryDropSection;
        return id && item.kind === "project"
          ? {
              destination: {
                element: section!,
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
      const rect =
        visual.current?.layoutRect(element) ?? element.getBoundingClientRect();
      const grid =
        element.closest<HTMLElement>(".studio-page-list")?.dataset.view;
      const fraction =
        grid && grid !== "list"
          ? (point.x - rect.left) / rect.width
          : (point.y - rect.top) / rect.height;
      if (item.kind === "project") {
        const position = fraction < 0.5 ? "before" : "after";
        return {
          destination:
            target.kind === "project"
              ? {
                  element,
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
          element,
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
      if (!gesture.current?.element.isConnected) {
        reset();
        return;
      }
      const { destination: next, expand } = locate();
      destination.current = next;
      if (next) visual.current?.project(next.element, next.position);
      else visual.current?.restorePosition();
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
      if (!current?.active || finishing.current) return;
      const panel = [
        ...current.sidebar.querySelectorAll<HTMLElement>(
          ".studio-sidebar-projects, .studio-scroll",
        ),
      ].find((element) => {
        const rect = element.getBoundingClientRect();
        return (
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom
        );
      });
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
      update();
      frame = requestAnimationFrame(scroll);
    };
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (
        !current ||
        finishing.current ||
        event.pointerId !== current.pointerId
      )
        return;
      point = { x: event.clientX, y: event.clientY };
      if (!current.active) {
        if (Math.hypot(point.x - current.x, point.y - current.y) < 6) return;
        current.active = true;
        visual.current = new LibraryDragPreview(
          current.element,
          current.sidebar,
          current.x,
          current.y,
        );
        latest.current.onStart();
        setDragging(current.source.id);
        document.body.classList.add("library-drag-active");
        frame = requestAnimationFrame(scroll);
      }
      event.preventDefault();
      visual.current?.move(point);
      update();
    };
    const up = async (event: PointerEvent) => {
      if (event.pointerId !== gesture.current?.pointerId || finishing.current)
        return;
      point = { x: event.clientX, y: event.clientY };
      const current = gesture.current;
      const next = current.active ? locate().destination : null;
      if (!current.active) {
        reset();
        return;
      }
      event.preventDefault();
      finishing.current = true;
      cancelAnimationFrame(frame);
      clearExpansion();
      if (!next) visual.current?.restorePosition();
      await visual.current?.settle();
      if (gesture.current !== current) return;
      // Release the preview before React moves its rows. Persistence must not
      // leave a settled ghost blocking clicks for the duration of disk I/O.
      reset();
      if (next) await latest.current.onDrop(next.drop);
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

  const bindings = useMemo(() => {
    const row = (
      target: LibraryTarget,
      expanded: boolean,
      toggle?: () => void,
    ): HTMLAttributes<HTMLDivElement> => {
      const previous = rows.current.get(target.id);
      rows.current.set(target.id, {
        target,
        expanded: !toggle && previous?.toggle ? previous.expanded : expanded,
        toggle: toggle ?? previous?.toggle,
      });
      return {
        "aria-description": t("dragHint"),
        "data-library-draggable": true,
        "data-dragging": dragging === target.id || undefined,
        onDragStart: (event) => event.preventDefault(),
        onPointerDown: (event) => {
          if (
            finishing.current ||
            event.button !== 0 ||
            (event.target as HTMLElement).closest(
              ".studio-row-menu,.studio-tree-chevron",
            )
          )
            return;
          const sidebar = event.currentTarget.closest<HTMLElement>(".studio");
          if (!sidebar) return;
          gesture.current = {
            source: target,
            x: event.clientX,
            y: event.clientY,
            pointerId: event.pointerId,
            active: false,
            sidebar,
            element: event.currentTarget,
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
      } as HTMLAttributes<HTMLDivElement>;
    };
    return { row, section };
  }, [dragging]);
  return { dragging: !!dragging, bindings };
}
