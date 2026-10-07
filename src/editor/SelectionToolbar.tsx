import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** One selection menu container; object-specific actions append to its children. */
export function SelectionToolbar({
  id,
  anchor,
  children,
  onEscape,
}: {
  id: string;
  anchor: { left: number; top: number };
  children: ReactNode;
  onEscape: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(anchor);
  useLayoutEffect(() => {
    const element = menu.current!;
    const place = () => {
      const { width, height } = element.getBoundingClientRect();
      setPosition({
        left: Math.max(
          8,
          Math.min(anchor.left - width / 2, window.innerWidth - width - 8),
        ),
        top: Math.max(8, anchor.top - height - 8),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [anchor.left, anchor.top]);
  return createPortal(
    <div
      ref={menu}
      id={id}
      className="editor-bubble"
      data-editor-menu-trigger="selection"
      role="toolbar"
      aria-label="选中文字格式"
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
