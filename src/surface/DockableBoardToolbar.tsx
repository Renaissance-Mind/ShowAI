import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
  type RefObject,
  type PointerEvent,
} from "react";
import { GripVertical } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/surface";
import {
  readToolbarDock,
  snapToolbar,
  toolbarCenter,
  toolbarPropertiesReserve,
  type DockEdge,
  type ToolbarDock,
} from "./toolbar-dock";
import "./toolbar-dock.css";

const ToolbarDockContext = createContext<DockEdge>("bottom");
export const useToolbarDock = () => useContext(ToolbarDockContext);

export function DockableBoardToolbar({
  children,
  actions,
  properties,
  root,
  enabled,
}: {
  children: ReactNode;
  actions?: ReactNode;
  properties?: ReactNode;
  root: RefObject<HTMLDivElement | null>;
  enabled: boolean;
}) {
  const t = useTranslator(messages);
  const preference = `showai:board-toolbar:${typeof document !== "undefined" && document.documentElement.dataset.native === "ios" ? "mobile" : "desktop"}`;
  const [dock, setDock] = useState(() => {
    // Sandboxed previews (no allow-same-origin) throw on any storage access.
    try {
      return readToolbarDock(localStorage.getItem(preference));
    } catch {
      return readToolbarDock(null);
    }
  });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [bounds, setBounds] = useState({ width: 0, height: 0 });
  const [point, setPoint] = useState<{
    x: number;
    y: number;
    edge: DockEdge;
  } | null>(null);
  const primary = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    origin: { x: number; y: number };
  } | null>(null);
  useEffect(() => {
    const surface = root.current!,
      element = primary.current!;
    const measure = () => {
      setBounds({ width: surface.clientWidth, height: surface.clientHeight });
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(surface);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [root, dock.edge]);
  const reserve = toolbarPropertiesReserve(dock.edge);
  const center = toolbarCenter(dock, bounds, size, reserve);
  const save = (next: ToolbarDock) => {
    setDock(next);
    try {
      localStorage.setItem(preference, `${next.edge}:${next.position}`);
    } catch {
      /* A personal preference; the toolbar still docks for this view. */
    }
  };
  const localDelta = (event: PointerEvent) => {
    const start = drag.current!,
      rect = root.current!.getBoundingClientRect();
    return {
      x:
        start.origin.x +
        ((event.clientX - start.x) * bounds.width) / rect.width,
      y:
        start.origin.y +
        ((event.clientY - start.y) * bounds.height) / rect.height,
    };
  };
  const localPointer = (event: PointerEvent) => {
    const rect = root.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * bounds.width) / rect.width,
      y: ((event.clientY - rect.top) * bounds.height) / rect.height,
    };
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    if (drag.current?.id !== event.pointerId) return;
    if (!cancel) {
      const target = snapToolbar(localPointer(event), bounds);
      const location = localDelta(event);
      const horizontal = target.edge === "top" || target.edge === "bottom";
      save({
        edge: target.edge,
        position: Math.max(
          0,
          Math.min(
            1,
            horizontal
              ? location.x / Math.max(1, bounds.width)
              : location.y /
                  Math.max(
                    1,
                    bounds.height - toolbarPropertiesReserve(target.edge),
                  ),
          ),
        ),
      });
    }
    drag.current = null;
    setPoint(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const preview = point?.edge;
  return (
    <ToolbarDockContext.Provider value={dock.edge}>
      {preview && (
        <div
          className="board-toolbar-dock-preview"
          data-edge={preview}
          aria-hidden="true"
        />
      )}
      <div
        className="surface-toolbar board-dockable-toolbar"
        data-dock={dock.edge}
        data-dragging={!!point || undefined}
        data-surface-ui
        role="group"
        aria-label={t("board.tools")}
        style={
          {
            left: (point ?? center).x,
            top: (point ?? center).y,
            bottom: "auto",
            "--board-toolbar-height": `${bounds.height}px`,
            "--board-toolbar-width": `${bounds.width}px`,
            "--board-properties-reserve": `${reserve}px`,
          } as CSSProperties
        }
      >
        <div ref={primary} className="board-toolbar-primary">
          {enabled && (
            <button
              type="button"
              className="board-toolbar-grip"
              aria-label={t("board.moveToolbar")}
              title={t("board.moveToolbarTitle")}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.stopPropagation();
                drag.current = {
                  id: event.pointerId,
                  x: event.clientX,
                  y: event.clientY,
                  origin: center,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
                setPoint({ ...center, edge: dock.edge });
              }}
              onPointerMove={(event) => {
                if (drag.current?.id === event.pointerId) {
                  event.preventDefault();
                  event.stopPropagation();
                  setPoint({
                    ...localDelta(event),
                    edge: snapToolbar(localPointer(event), bounds).edge,
                  });
                }
              }}
              onPointerUp={(event) => finish(event)}
              onPointerCancel={(event) => finish(event, true)}
              onLostPointerCapture={(event) => finish(event, true)}
              onKeyDown={(event) => {
                const edge = (
                  {
                    ArrowUp: "top",
                    ArrowDown: "bottom",
                    ArrowLeft: "left",
                    ArrowRight: "right",
                  } as Record<string, DockEdge>
                )[event.key];
                if (edge) {
                  event.preventDefault();
                  event.stopPropagation();
                  save({ edge, position: 0.5 });
                }
              }}
            >
              <GripVertical size={15} />
            </button>
          )}
          {children}
          {properties && (
            <div className="board-toolbar-inline-properties" data-surface-ui>
              {properties}
            </div>
          )}
        </div>
        {actions && (
          <div className="board-toolbar-actions" data-surface-ui>
            {actions}
          </div>
        )}
      </div>
    </ToolbarDockContext.Provider>
  );
}
