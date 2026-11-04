import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
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

const duration = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 180;

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
  shortcutHint = true,
}: WorkspaceTabsState & {
  busy: boolean;
  /** False in the browser, which keeps ⌘T / Ctrl+T for its own tabs. */
  shortcutHint?: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onMove: (id: string, targetId: string, placement: "before" | "after") => void;
}) {
  const t = useTranslator(sidebarMessages);
  const list = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
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
    finishing: boolean;
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
    /** Ids and scroll-content positions at drag start, free of in-flight animations. */
    original: string[];
    layout: Map<string, { left: number; width: number }>;
  } | null>(null);
  const latest = useRef({ busy, onMove });
  latest.current = { busy, onMove };
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [order, setOrder] = useState<string[] | null>(null);
  const shownOrder = useRef<string[] | null>(null);
  const flip = useRef<Map<string, DOMRect> | null>(null);
  const animations = useRef(new Map<string, Animation>());
  const measure = () =>
    new Map(
      Array.from(
        list.current?.querySelectorAll<HTMLElement>(".studio-tab") ?? [],
        (element) =>
          [element.dataset.tabId!, element.getBoundingClientRect()] as const,
      ),
    );
  const preview = (next: string[] | null) => {
    const current = shownOrder.current;
    if (
      current === next ||
      (current && next && current.join("\n") === next.join("\n"))
    )
      return;
    flip.current = measure();
    shownOrder.current = next;
    setOrder(next);
  };
  const finishDrag = () => {
    const current = gesture.current;
    if (current?.active) suppressClick.current = true;
    gesture.current = null;
    if (current?.element.hasPointerCapture(current.pointerId))
      current.element.releasePointerCapture(current.pointerId);
    shownOrder.current = null;
    flip.current = null;
    setDragging(null);
    setOrder(null);
    document.body.classList.remove("studio-tab-drag-active");
    document.body.style.cursor = "";
  };
  const locate = (x: number, y: number) => {
    const container = list.current;
    const current = gesture.current;
    if (!container || !current) return null;
    const bounds = container.getBoundingClientRect();
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top - current.height ||
      y > bounds.bottom + current.height
    )
      return null;
    const left = x - current.offsetX - bounds.left + container.scrollLeft;
    const right = left + current.width;
    const from = current.original.indexOf(current.id);
    const others = current.original.filter((id) => id !== current.id);
    // The ghost passes a neighbour once its leading edge crosses that tab's middle.
    let index = others.findIndex((id) => {
      const slot = current.layout.get(id)!;
      const middle = slot.left + slot.width / 2;
      return current.original.indexOf(id) < from
        ? left < middle
        : right <= middle;
    });
    if (index < 0) index = others.length;
    others.splice(index, 0, current.id);
    return others;
  };
  const update = () => {
    const current = gesture.current;
    if (!current) return;
    const next = locate(current.x, current.y);
    preview(next);
    document.body.style.cursor = next ? "grabbing" : "not-allowed";
  };
  const moveGhost = () => {
    const current = gesture.current;
    if (!current || !ghost.current) return;
    ghost.current.style.transform = `translate3d(${current.x - current.offsetX}px, ${current.y - current.offsetY}px, 0)`;
  };
  useLayoutEffect(() => {
    const before = flip.current;
    flip.current = null;
    if (!before || !list.current) return;
    for (const animation of animations.current.values()) animation.cancel();
    animations.current.clear();
    for (const element of list.current.querySelectorAll<HTMLElement>(
      ".studio-tab",
    )) {
      const id = element.dataset.tabId!;
      const old = before.get(id);
      if (!old || id === dragging) continue;
      const offset = old.left - element.getBoundingClientRect().left;
      if (Math.abs(offset) < 0.5) continue;
      const animation = element.animate(
        [
          { transform: `translateX(${offset}px)` },
          { transform: "translateX(0)" },
        ],
        { duration: duration(), easing: "cubic-bezier(.2,.8,.2,1)" },
      );
      animations.current.set(id, animation);
      animation.onfinish = () => {
        if (animations.current.get(id) === animation)
          animations.current.delete(id);
      };
    }
  }, [order, dragging]);
  useLayoutEffect(moveGhost, [dragging]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (
        !current ||
        current.finishing ||
        event.pointerId !== current.pointerId
      )
        return;
      if (latest.current.busy) return finishDrag();
      current.x = event.clientX;
      current.y = event.clientY;
      if (!current.active) {
        if (
          Math.hypot(current.x - current.startX, current.y - current.startY) < 5
        )
          return;
        const container = list.current;
        if (!container) return finishDrag();
        const bounds = container.getBoundingClientRect();
        const box = current.element
          .closest<HTMLElement>(".studio-tab")!
          .getBoundingClientRect();
        current.active = true;
        current.offsetX = current.startX - box.left;
        current.offsetY = current.startY - box.top;
        current.width = box.width;
        current.height = box.height;
        current.layout = new Map(
          Array.from(measure(), ([id, rect]) => [
            id,
            {
              left: rect.left - bounds.left + container.scrollLeft,
              width: rect.width,
            },
          ]),
        );
        document.body.classList.add("studio-tab-drag-active");
        setDragging(current.id);
      }
      event.preventDefault();
      moveGhost();
      update();
    };
    const up = async (event: PointerEvent) => {
      const current = gesture.current;
      if (
        !current ||
        current.finishing ||
        event.pointerId !== current.pointerId
      )
        return;
      if (!current.active) return finishDrag();
      event.preventDefault();
      current.finishing = true;
      current.x = event.clientX;
      current.y = event.clientY;
      const target = latest.current.busy ? null : locate(current.x, current.y);
      flushSync(() => preview(target));
      const slot = list.current?.querySelector<HTMLElement>(
        `.studio-tab[data-tab-id="${CSS.escape(current.id)}"]`,
      );
      if (ghost.current && slot) {
        const to = slot.getBoundingClientRect();
        const from = ghost.current.getBoundingClientRect();
        const animation = ghost.current.animate(
          [
            { transform: `translate3d(${from.x}px, ${from.y}px, 0)` },
            { transform: `translate3d(${to.x}px, ${to.y}px, 0)` },
          ],
          {
            duration: duration(),
            easing: "cubic-bezier(.2,.8,.2,1)",
            fill: "forwards",
          },
        );
        await animation.finished.catch(() => undefined);
      }
      if (gesture.current !== current) return;
      finishDrag();
      if (!target || latest.current.busy) return;
      const index = target.indexOf(current.id);
      if (target.every((id, position) => id === current.original[position]))
        return;
      if (index > 0)
        latest.current.onMove(current.id, target[index - 1], "after");
      else latest.current.onMove(current.id, target[1], "before");
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
  useEffect(() => {
    if (!dragging) return;
    const current = gesture.current;
    if (
      busy ||
      !current ||
      tabs.map((tab) => tab.id).join("\n") !== current.original.join("\n")
    ) {
      finishDrag();
      return;
    }
    let frame = 0;
    const scroll = () => {
      const container = list.current;
      const point = gesture.current;
      if (!container || !point || point.finishing) return;
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
          update();
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
  const shown = order
    ? order.map((id) => tabs.find((tab) => tab.id === id)!)
    : tabs;
  const tabIcon = (tab: (typeof tabs)[number]) => {
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
    return (
      <PageIcon
        value={entry.icon}
        size={15}
        fallback={view === "page" ? undefined : <Icon size={15} />}
      />
    );
  };

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
        {shown.map((tab) => {
          const index = tabs.indexOf(tab);
          const entry = currentEntry(tab);
          const active = tab.id === activeId;
          return (
            <div
              key={tab.id}
              className="studio-tab"
              data-active={active || undefined}
              data-tab-id={tab.id}
              data-dragging={dragging === tab.id || undefined}
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
                    finishing: false,
                    offsetX: 0,
                    offsetY: 0,
                    width: 0,
                    height: 0,
                    original: tabs.map((item) => item.id),
                    layout: new Map(),
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onLostPointerCapture={() => {
                  if (gesture.current && !gesture.current.finishing)
                    finishDrag();
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
                {tabIcon(tab)}
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
        title={shortcutHint ? t("newTabShortcut") : t("newTab")}
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
            ref={ghost}
            className="studio-tab-drag-ghost"
            aria-hidden="true"
            data-active={draggedTab.id === activeId || undefined}
            style={{
              width: gesture.current?.width,
              height: gesture.current?.height,
            }}
          >
            {tabIcon(draggedTab)}
            <span>{currentEntry(draggedTab).title}</span>
          </div>,
          document.body,
        )}
    </div>
  );
}
