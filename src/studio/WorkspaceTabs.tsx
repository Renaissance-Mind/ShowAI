import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Blocks,
  Folder,
  History,
  LayoutTemplate,
  Plus,
  Settings2,
  X,
} from "../ui/icons";
import PageIcon from "../components/PageIcon";
import { currentEntry, type WorkspaceTabsState } from "./workspace-tabs";
import "./workspace-tabs.css";
import { useTranslator } from "../i18n/react";
import sidebarMessages from "../i18n/messages/sidebar";

export function WorkspaceHistory({
  busy,
  canBack,
  canForward,
  onStep,
}: {
  busy: boolean;
  canBack: boolean;
  canForward: boolean;
  onStep: (offset: number) => void;
}) {
  const t = useTranslator(sidebarMessages);
  return (
    <div className="studio-tab-history" aria-label={t("tabHistory")}>
      <button
        type="button"
        aria-label={t("back")}
        title={t("back")}
        disabled={busy || !canBack}
        onClick={() => onStep(-1)}
      >
        <ArrowLeft size={16} />
      </button>
      <button
        type="button"
        aria-label={t("forward")}
        title={t("forward")}
        disabled={busy || !canForward}
        onClick={() => onStep(1)}
      >
        <ArrowRight size={16} />
      </button>
    </div>
  );
}

export default function WorkspaceTabs({
  tabs,
  activeId,
  busy,
  onSelect,
  onClose,
  onAdd,
  onMove,
}: WorkspaceTabsState & {
  busy: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onMove: (id: string, targetId: string, placement: "before" | "after") => void;
}) {
  const t = useTranslator(sidebarMessages);
  const list = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const gesture = useRef<{
    id: string;
    x: number;
    y: number;
    startX: number;
    startY: number;
    pointerId: number;
    element: HTMLButtonElement;
    active: boolean;
  } | null>(null);
  const latest = useRef({ busy, onMove });
  latest.current = { busy, onMove };
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [drop, setDrop] = useState<{
    id: string;
    placement: "before" | "after";
  } | null>(null);
  const finishDrag = () => {
    const current = gesture.current;
    if (current?.active) suppressClick.current = true;
    gesture.current = null;
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    setDragging(null);
    setDrop(null);
  };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (latest.current.busy) return finishDrag();
      current.x = event.clientX;
      current.y = event.clientY;
      if (!current.active) {
        if (
          Math.hypot(current.x - current.startX, current.y - current.startY) < 5
        )
          return;
        current.active = true;
        setDragging(current.id);
      }
      event.preventDefault();
      setPoint({ x: current.x, y: current.y });
      setDrop(locateDrop(current.x, current.y));
    };
    const up = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const target = current.active
        ? locateDrop(event.clientX, event.clientY)
        : null;
      finishDrag();
      if (!latest.current.busy && target)
        latest.current.onMove(current.id, target.id, target.placement);
    };
    const cancel = () => finishDrag();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && gesture.current) {
        event.preventDefault();
        event.stopPropagation();
        finishDrag();
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      finishDrag();
    };
  }, []);
  const locateDrop = (x: number, y: number) => {
    const container = list.current;
    if (!container || !gesture.current) return null;
    const bounds = container.getBoundingClientRect();
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return null;
    const elements = Array.from(
      container.querySelectorAll<HTMLElement>(".studio-tab"),
    );
    const target = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return x >= rect.left && x <= rect.right;
    });
    if (!target || target.dataset.tabId === gesture.current.id) return null;
    const rect = target.getBoundingClientRect();
    return {
      id: target.dataset.tabId!,
      placement:
        x < rect.left + rect.width / 2
          ? ("before" as const)
          : ("after" as const),
    };
  };
  useEffect(() => {
    if (!dragging) return;
    if (busy || !tabs.some((tab) => tab.id === dragging)) {
      finishDrag();
      return;
    }
    let frame = 0;
    const scroll = () => {
      const container = list.current;
      const point = gesture.current;
      if (!container || !point) return;
      const bounds = container.getBoundingClientRect();
      if (
        point.y >= bounds.top &&
        point.y <= bounds.bottom &&
        point.x >= bounds.left &&
        point.x <= bounds.right
      ) {
        const distance =
          point.x < bounds.left + 32
            ? -10
            : point.x > bounds.right - 32
              ? 10
              : 0;
        if (distance) {
          container.scrollLeft += distance;
          setDrop(locateDrop(point.x, point.y));
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragging, busy, tabs]);
  useEffect(() => {
    list.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);
  useEffect(() => {
    if (busy || !restoreFocus.current) return;
    restoreFocus.current = false;
    list.current
      ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
      ?.focus();
  }, [activeId, busy, tabs.length]);
  const draggedTab = tabs.find((tab) => tab.id === dragging);

  return (
    <div
      className="studio-tabs-bar"
      onClickCapture={(event) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDownCapture={() => {
        suppressClick.current = false;
      }}
    >
      <div
        ref={list}
        className="studio-tabs"
        role="tablist"
        aria-label={t("workspaceTabs")}
      >
        {tabs.map((tab, index) => {
          const entry = currentEntry(tab);
          const view = entry.location.view;
          const Icon =
            view === "projects"
              ? History
              : view === "templates"
                ? LayoutTemplate
                : view === "components"
                  ? Blocks
                  : view === "settings"
                    ? Settings2
                    : Folder;
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className="studio-tab"
              data-active={active || undefined}
              data-tab-id={tab.id}
              data-dragging={dragging === tab.id || undefined}
              data-drop={drop?.id === tab.id ? drop.placement : undefined}
            >
              <button
                type="button"
                role="tab"
                id={`workspace-tab-${tab.id}`}
                aria-selected={active}
                aria-controls="studio-tab-panel"
                tabIndex={active ? 0 : -1}
                disabled={busy}
                title={`${entry.title}\n${t("tabDragHint")}`}
                aria-description={t("tabDragHint")}
                data-reorderable={(!busy && tabs.length > 1) || undefined}
                onDragStart={(event) => event.preventDefault()}
                onPointerDown={(event) => {
                  if (
                    busy ||
                    tabs.length < 2 ||
                    event.button !== 0 ||
                    !event.isPrimary
                  )
                    return;
                  gesture.current = {
                    id: tab.id,
                    x: event.clientX,
                    y: event.clientY,
                    startX: event.clientX,
                    startY: event.clientY,
                    pointerId: event.pointerId,
                    element: event.currentTarget,
                    active: false,
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onLostPointerCapture={() => {
                  if (gesture.current) finishDrag();
                }}
                onClick={() => {
                  restoreFocus.current = true;
                  onSelect(tab.id);
                }}
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    onClose(tab.id);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.altKey &&
                    event.shiftKey &&
                    (event.key === "ArrowLeft" || event.key === "ArrowRight")
                  ) {
                    event.preventDefault();
                    const offset = event.key === "ArrowLeft" ? -1 : 1;
                    const target = tabs[index + offset];
                    if (target)
                      onMove(
                        tab.id,
                        target.id,
                        offset < 0 ? "before" : "after",
                      );
                    return;
                  }
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % tabs.length
                      : event.key === "ArrowLeft"
                        ? (index - 1 + tabs.length) % tabs.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? tabs.length - 1
                            : null;
                  if (next !== null) {
                    event.preventDefault();
                    restoreFocus.current = true;
                    onSelect(tabs[next].id);
                  } else if (event.key === "Delete") {
                    event.preventDefault();
                    restoreFocus.current = true;
                    onClose(tab.id);
                  }
                }}
              >
                <PageIcon
                  value={entry.icon}
                  size={15}
                  fallback={view === "page" ? undefined : <Icon size={15} />}
                />
                <span>{entry.title}</span>
              </button>
              <button
                type="button"
                className="studio-tab-close"
                tabIndex={active ? 0 : -1}
                disabled={busy}
                aria-label={t("closeTabNamed", { title: entry.title })}
                title={t("closeTab")}
                onClick={() => {
                  restoreFocus.current = true;
                  onClose(tab.id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="studio-tab-add"
        disabled={busy}
        aria-label={t("newTab")}
        title={t("newTabShortcut")}
        onClick={() => {
          restoreFocus.current = true;
          onAdd();
        }}
      >
        <Plus size={18} />
      </button>
      {draggedTab &&
        createPortal(
          <div
            className="studio-tab-drag-preview"
            aria-hidden="true"
            style={{ left: point.x + 12, top: point.y + 12 }}
          >
            {currentEntry(draggedTab).title}
          </div>,
          document.body,
        )}
    </div>
  );
}
