import "./selection-toolbar.css";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** One selection menu container; object-specific actions append to its children. */
export function SelectionToolbar({
  id,
  anchor,
  anchorElement,
  children,
  onEscape,
  label = "选中文字格式",
  keyboardScope,
}: {
  id: string;
  label?: string;
  keyboardScope?: string;
  anchor: { left: number; top: number };
  anchorElement?: HTMLElement | null;
  children: ReactNode;
  onEscape: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const element = menu.current!;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      const bounds = anchorElement?.isConnected
        ? anchorElement.getBoundingClientRect()
        : null;
      const point = bounds
        ? { left: (bounds.left + bounds.right) / 2, top: bounds.top }
        : anchor;
      const next = {
        left: Math.max(
          8,
          Math.min(point.left - width / 2, window.innerWidth - width - 8),
        ),
        top: Math.max(8, point.top - height - 8),
      };
      setPosition((previous) =>
        previous.left === next.left && previous.top === next.top
          ? previous
          : next,
      );
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    // Ancestors can move the anchor while the anchor's own size stays unchanged.
    if (anchorElement)
      for (
        let ancestor: HTMLElement | null = anchorElement;
        ancestor;
        ancestor = ancestor.parentElement
      )
        observer.observe(ancestor);
    window.addEventListener("resize", place);
    if (anchorElement) window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      if (anchorElement) window.removeEventListener("scroll", place, true);
    };
  }, [anchor.left, anchor.top, anchorElement]);
  return createPortal(
    <div
      ref={menu}
      id={id}
      className="editor-bubble"
      data-editor-menu-trigger="selection"
      data-editor-keyboard-scope={keyboardScope}
      role="toolbar"
      aria-label={label}
      style={position}
      onMouseDown={(event) => {
        if (!(event.target as Element).closest("input,select,textarea"))
          event.preventDefault();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
