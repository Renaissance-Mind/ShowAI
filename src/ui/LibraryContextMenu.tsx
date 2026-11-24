import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "./icons";
import { inSubmenuCorridor } from "./menu-aim";
import "./context-menu.css";

export interface LibraryMenuPoint {
  x: number;
  y: number;
}

interface LibraryMenuItemBase {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  shortcut?: string;
  checked?: boolean;
  description?: string;
  group?: string;
  command?: string;
}
export type LibrarySubmenuItem = LibraryMenuItemBase & {
  onSelect: () => void;
  control?: never;
};
export type LibraryContextMenuItem = LibraryMenuItemBase &
  (
    | { onSelect: () => void; control?: never; items?: never }
    | { control: ReactNode; onSelect?: never; items?: never }
    | { items: LibrarySubmenuItem[]; onSelect?: never; control?: never }
  );

export function LibraryMenuControl({ item }: { item: LibraryContextMenuItem }) {
  return (
    <div className="studio-context-menu-control" role="none">
      <div className="studio-context-menu-control-label">
        {item.icon}
        <span>{item.label}</span>
      </div>
      {item.control}
    </div>
  );
}

export interface LibraryContextMenuProps {
  anchor: HTMLElement;
  portalRoot?: HTMLElement;
  point?: LibraryMenuPoint;
  label: string;
  items: LibraryContextMenuItem[];
  onClose: () => void;
}

interface MenuPosition {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
}

interface SubmenuPosition extends MenuPosition {
  side: "left" | "right";
}

function enabledItems(
  menu: HTMLElement,
): (HTMLButtonElement | HTMLInputElement)[] {
  return [
    ...menu.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      'button[role="menuitem"],button[role="menuitemradio"],input[type="range"]',
    ),
  ].filter((item) => !item.disabled && item.closest('[role="menu"]') === menu);
}

function navigateItems(
  event: KeyboardEvent<HTMLDivElement>,
  menu: HTMLElement,
  search: { current: { value: string; time: number } },
): boolean {
  const buttons = enabledItems(menu);
  const document = menu.ownerDocument;
  const current = buttons.findIndex(
    (button) => button === document.activeElement,
  );
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    if (!buttons.length) return true;
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : current < 0
            ? event.key === "ArrowDown"
              ? 0
              : buttons.length - 1
            : (current +
                (event.key === "ArrowDown" ? 1 : -1) +
                buttons.length) %
              buttons.length;
    buttons[index].focus();
    return true;
  }
  if (
    event.key.length === 1 &&
    event.key !== " " &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.nativeEvent.isComposing
  ) {
    const now = Date.now();
    const character = event.key.toLocaleLowerCase();
    search.current = {
      value:
        now - search.current.time > 700
          ? character
          : search.current.value + character,
      time: now,
    };
    const ordered = [
      ...buttons.slice(current + 1),
      ...buttons.slice(0, current + 1),
    ];
    const match = ordered.find((button) =>
      button.textContent
        ?.trim()
        .toLocaleLowerCase()
        .startsWith(search.current.value),
    );
    if (match) {
      event.preventDefault();
      event.stopPropagation();
      match.focus();
      return true;
    }
  }
  return false;
}

function MenuItemContent({ item }: { item: LibraryMenuItemBase }) {
  return (
    <>
      {item.icon && (
        <span className="studio-context-menu-icon" aria-hidden="true">
          {item.icon}
        </span>
      )}
      {item.description ? (
        <span className="studio-context-menu-text">
          <span>{item.label}</span>
          <span className="studio-context-menu-description">
            {item.description}
          </span>
        </span>
      ) : (
        <span>{item.label}</span>
      )}
      {item.shortcut && (
        <span className="studio-context-menu-shortcut" aria-hidden="true">
          {item.shortcut}
        </span>
      )}
    </>
  );
}

export function LibraryContextMenu({
  anchor,
  portalRoot,
  point,
  label,
  items,
  onClose,
}: LibraryContextMenuProps) {
  const id = useId();
  const submenuId = `${id}-submenu`;
  const menuRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const restoreFocus = useRef(true);
  const focusedOnce = useRef(false);
  const focusSubmenu = useRef(false);
  const search = useRef({ value: "", time: 0 });
  const submenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeSubmenu, setActiveSubmenu] = useState<number | null>(null);
  const [submenuPosition, setSubmenuPosition] =
    useState<SubmenuPosition | null>(null);
  const activeItem = activeSubmenu === null ? undefined : items[activeSubmenu];
  const activeChildren =
    activeItem && "items" in activeItem ? activeItem.items : undefined;

  const clearSubmenuTimer = () => {
    if (submenuTimer.current) clearTimeout(submenuTimer.current);
    submenuTimer.current = null;
  };
  const openSubmenu = (index: number, focus = false) => {
    clearSubmenuTimer();
    if (focus && index === activeSubmenu && submenuRef.current) {
      (enabledItems(submenuRef.current)[0] ?? submenuRef.current).focus({
        preventScroll: true,
      });
      return;
    }
    focusSubmenu.current = focus;
    setActiveSubmenu(index);
  };
  const closeSubmenu = (restore = false) => {
    clearSubmenuTimer();
    if (restore && activeSubmenu !== null)
      itemRefs.current[activeSubmenu]?.focus({ preventScroll: true });
    focusSubmenu.current = false;
    setActiveSubmenu(null);
    setSubmenuPosition(null);
  };

  useLayoutEffect(() => {
    const menu = menuRef.current;
    const document = anchor.ownerDocument;
    const window = document.defaultView;
    if (!menu || !window || !anchor.isConnected) {
      latestClose.current();
      return;
    }
    restoreFocus.current = true;
    focusedOnce.current = false;
    const previousExpanded = anchor.getAttribute("aria-expanded");
    const previousControls = anchor.getAttribute("aria-controls");
    anchor.setAttribute("aria-expanded", "true");
    anchor.setAttribute("aria-controls", id);

    const reposition = () => {
      if (!anchor.isConnected) {
        latestClose.current();
        return;
      }
      const rect = anchor.getBoundingClientRect();
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (
        rect.bottom < 0 ||
        rect.top > height ||
        rect.right < 0 ||
        rect.left > width
      ) {
        latestClose.current();
        return;
      }
      const margin = 8;
      const gap = point ? 0 : 5;
      const origin = point
        ? { left: point.x, right: point.x, top: point.y, bottom: point.y }
        : rect;
      const maxWidth = Math.max(0, width - margin * 2);
      const menuWidth = Math.min(menu.getBoundingClientRect().width, maxWidth);
      const below = Math.max(0, height - origin.bottom - gap - margin);
      const above = Math.max(0, origin.top - gap - margin);
      const naturalHeight = menu.scrollHeight;
      const flip = naturalHeight > below && above > below;
      const maxHeight = Math.max(
        0,
        Math.min(height - margin * 2, flip ? above : below),
      );
      const visibleHeight = Math.min(naturalHeight, maxHeight);
      let left = origin.left;
      if (left + menuWidth > width - margin) left = origin.right - menuWidth;
      left = Math.max(margin, Math.min(left, width - margin - menuWidth));
      const top = Math.max(
        margin,
        Math.min(
          flip ? origin.top - gap - visibleHeight : origin.bottom + gap,
          height - margin - visibleHeight,
        ),
      );
      const next = { left, top, maxWidth, maxHeight };
      setPosition((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof MenuPosition] ===
            next[key as keyof MenuPosition],
        )
          ? previous
          : next,
      );
    };

    const outsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        !target ||
        menu.contains(target) ||
        submenuRef.current?.contains(target) ||
        anchor.contains(target)
      )
        return;
      restoreFocus.current = false;
      latestClose.current();
    };
    const outsideFocus = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !menu.contains(target) &&
        !submenuRef.current?.contains(target) &&
        !anchor.contains(target)
      ) {
        restoreFocus.current = false;
        latestClose.current();
      }
    };
    const scroll = (event: Event) => {
      if (
        event.target instanceof Node &&
        (menu.contains(event.target) ||
          submenuRef.current?.contains(event.target))
      )
        return;
      if (point) latestClose.current();
      else reposition();
    };

    reposition();
    document.addEventListener("pointerdown", outsidePointer, true);
    document.addEventListener("focusin", outsideFocus);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", scroll, true);
    const observer = new ResizeObserver(reposition);
    observer.observe(anchor);
    observer.observe(menu);

    return () => {
      clearSubmenuTimer();
      observer.disconnect();
      document.removeEventListener("pointerdown", outsidePointer, true);
      document.removeEventListener("focusin", outsideFocus);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", scroll, true);
      if (previousExpanded === null) anchor.removeAttribute("aria-expanded");
      else anchor.setAttribute("aria-expanded", previousExpanded);
      if (previousControls === null) anchor.removeAttribute("aria-controls");
      else anchor.setAttribute("aria-controls", previousControls);
      if (restoreFocus.current && anchor.isConnected)
        anchor.focus({ preventScroll: true });
    };
  }, [anchor, point, id]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!position || !menu || focusedOnce.current) return;
    focusedOnce.current = true;
    (enabledItems(menu)[0] ?? menu).focus({ preventScroll: true });
  }, [position, anchor, point]);

  useLayoutEffect(() => {
    const trigger =
      activeSubmenu === null ? null : itemRefs.current[activeSubmenu];
    const submenu = submenuRef.current;
    const window = anchor.ownerDocument.defaultView;
    if (!trigger || !submenu || !window || !activeChildren) return;
    const reposition = () => {
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      const right = Math.max(0, window.innerWidth - rect.right - gap - margin);
      const left = Math.max(0, rect.left - gap - margin);
      const menuWidth = Math.min(
        Math.max(
          180,
          submenu.scrollWidth + submenu.offsetWidth - submenu.clientWidth,
        ),
        Math.max(0, window.innerWidth - margin * 2),
      );
      const side: "left" | "right" =
        right >= menuWidth || right >= left ? "right" : "left";
      const beside =
        side === "right" ? rect.right + gap : rect.left - gap - menuWidth;
      const maxHeight = Math.max(0, window.innerHeight - margin * 2);
      const visibleHeight = Math.min(submenu.scrollHeight, maxHeight);
      const next = {
        side,
        left: Math.max(
          margin,
          Math.min(beside, window.innerWidth - margin - menuWidth),
        ),
        top: Math.max(
          margin,
          Math.min(rect.top - 4, window.innerHeight - margin - visibleHeight),
        ),
        maxWidth: menuWidth,
        maxHeight,
      };
      setSubmenuPosition((previous) =>
        previous &&
        Object.keys(next).every(
          (key) =>
            previous[key as keyof SubmenuPosition] ===
            next[key as keyof SubmenuPosition],
        )
          ? previous
          : next,
      );
    };
    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(trigger);
    observer.observe(submenu);
    window.addEventListener("resize", reposition);
    const menu = menuRef.current;
    menu?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      menu?.removeEventListener("scroll", reposition);
    };
  }, [activeSubmenu]);

  useLayoutEffect(() => {
    if (!submenuPosition || !submenuRef.current || !focusSubmenu.current)
      return;
    focusSubmenu.current = false;
    (enabledItems(submenuRef.current)[0] ?? submenuRef.current).focus({
      preventScroll: true,
    });
  }, [submenuPosition]);

  const hoverItem = (
    index: number,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    clearSubmenuTimer();
    if (index === activeSubmenu) return;
    const item = items[index];
    const next = item && "items" in item && !item.disabled ? index : null;
    let delay = activeChildren && submenuPosition ? 120 : 0;
    if (
      activeChildren &&
      submenuPosition &&
      lastPointer.current &&
      submenuRef.current
    ) {
      const bounds = submenuRef.current.getBoundingClientRect();
      if (
        inSubmenuCorridor(
          { x: event.clientX, y: event.clientY },
          lastPointer.current,
          bounds,
          submenuPosition.side,
        )
      )
        delay = 450;
    }
    if (delay) {
      submenuTimer.current = setTimeout(() => {
        focusSubmenu.current = false;
        setActiveSubmenu(next);
        setSubmenuPosition(null);
        submenuTimer.current = null;
      }, delay);
    } else {
      focusSubmenu.current = false;
      setActiveSubmenu(next);
      if (next === null) setSubmenuPosition(null);
    }
  };

  const handleKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const menu = menuRef.current;
    if (!menu) return;
    const document = anchor.ownerDocument;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key))
      closeSubmenu();
    if (navigateItems(event, menu, search)) return;
    if (event.key === "ArrowRight") {
      const index = itemRefs.current.findIndex(
        (button) => button === document.activeElement,
      );
      const item = items[index];
      if (item && "items" in item && !item.disabled) {
        event.preventDefault();
        event.stopPropagation();
        openSubmenu(index, true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      latestClose.current();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const focusable = [
        ...document.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex],iframe,[contenteditable="true"]',
        ),
      ].filter(
        (element) =>
          !menu.contains(element) &&
          !submenuRef.current?.contains(element) &&
          element.tabIndex >= 0 &&
          element.getClientRects().length > 0 &&
          !element.closest('[inert],[aria-hidden="true"]'),
      );
      const index = focusable.indexOf(anchor);
      const next =
        index < 0
          ? focusable[event.shiftKey ? focusable.length - 1 : 0]
          : focusable[index + (event.shiftKey ? -1 : 1)];
      restoreFocus.current = false;
      latestClose.current();
      queueMicrotask(() => {
        if (next?.isConnected) next.focus({ preventScroll: true });
        else if (anchor.isConnected) anchor.focus({ preventScroll: true });
      });
    }
  };

  const handleSubmenuKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const submenu = submenuRef.current;
    if (!submenu) return;
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      closeSubmenu(true);
      return;
    }
    if (navigateItems(event, submenu, search)) return;
    if (event.key === "Tab") handleKeyboard(event);
  };

  const style: CSSProperties = {
    position: "fixed",
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    maxWidth: position?.maxWidth ?? "calc(100vw - 16px)",
    maxHeight: position?.maxHeight ?? "calc(100vh - 16px)",
    overflowY: "auto",
    visibility: position ? "visible" : "hidden",
  };
  const submenuStyle: CSSProperties = {
    position: "fixed",
    left: submenuPosition?.left ?? 0,
    top: submenuPosition?.top ?? 0,
    width: submenuPosition?.maxWidth,
    maxWidth: submenuPosition?.maxWidth ?? "calc(100vw - 16px)",
    maxHeight: submenuPosition?.maxHeight ?? "calc(100vh - 16px)",
    overflowY: "auto",
    visibility: submenuPosition ? "visible" : "hidden",
  };

  return createPortal(
    <>
      <div
        id={id}
        ref={menuRef}
        role="menu"
        aria-label={label}
        tabIndex={-1}
        className="studio-context-menu"
        style={style}
        onKeyDown={handleKeyboard}
        onContextMenu={(event) => event.preventDefault()}
        onPointerMove={(event) => {
          lastPointer.current = { x: event.clientX, y: event.clientY };
        }}
      >
        {items.map((item, index) => (
          <div
            key={`${index}-${item.label}`}
            role="none"
            onPointerEnter={(event) => hoverItem(index, event)}
          >
            {(item.separatorBefore ||
              (!!item.group && item.group !== items[index - 1]?.group)) &&
              index > 0 && (
                <div
                  role="separator"
                  className="studio-context-menu-separator"
                />
              )}
            {item.group && item.group !== items[index - 1]?.group && (
              <div role="presentation" className="studio-context-menu-group">
                {item.group}
              </div>
            )}
            {item.control ? (
              <LibraryMenuControl item={item} />
            ) : (
              <button
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                aria-haspopup={"items" in item ? "menu" : undefined}
                aria-expanded={
                  "items" in item ? activeSubmenu === index : undefined
                }
                aria-controls={
                  "items" in item && activeSubmenu === index
                    ? submenuId
                    : undefined
                }
                tabIndex={-1}
                className={`studio-context-menu-item${item.danger ? " danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  if ("items" in item) {
                    openSubmenu(index, true);
                    return;
                  }
                  latestClose.current();
                  item.onSelect?.();
                }}
              >
                <MenuItemContent item={item} />
                {"items" in item && (
                  <span className="studio-context-menu-submenu-mark">
                    <ChevronRight size={14} />
                  </span>
                )}
              </button>
            )}
          </div>
        ))}
      </div>
      {activeItem && activeChildren && (
        <div
          id={submenuId}
          ref={submenuRef}
          role="menu"
          aria-label={activeItem.label}
          tabIndex={-1}
          className="studio-context-menu studio-context-submenu"
          style={submenuStyle}
          onKeyDown={handleSubmenuKeyboard}
          onContextMenu={(event) => event.preventDefault()}
          onPointerEnter={clearSubmenuTimer}
        >
          {activeChildren.map((item, index) => (
            <div key={`${index}-${item.label}`} role="none">
              {item.separatorBefore && index > 0 && (
                <div
                  role="separator"
                  className="studio-context-menu-separator"
                />
              )}
              <button
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemradio"}
                aria-checked={item.checked}
                tabIndex={-1}
                className={`studio-context-menu-item${item.danger ? " danger" : ""}`}
                disabled={item.disabled}
                onClick={() => {
                  latestClose.current();
                  item.onSelect();
                }}
              >
                <MenuItemContent item={item} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>,
    portalRoot ?? anchor.ownerDocument.body,
  );
}
