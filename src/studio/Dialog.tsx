import { useEffect, useRef, type ReactNode } from "react";
import { X } from "../ui/icons";

export default function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = "",
  titleAccessory,
  headerContent,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  titleAccessory?: ReactNode;
  headerContent?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    (
      panel.current?.querySelector<HTMLElement>("input,textarea,select") ??
      panel.current?.querySelector<HTMLElement>("button")
    )?.focus();
    const handle = (event: KeyboardEvent) => {
      // A local file picker can sit above a component or publication dialog.
      if (
        panel.current !==
        [...document.querySelectorAll('[role="dialog"]')].at(-1)
      )
        return;
      if (event.key === "Escape") close.current();
      if (event.key === "Tab") {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]),input,textarea,select,a[href]",
          ) ?? []),
        ].filter((item) => item.offsetParent !== null);
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="studio-modal-shade"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`studio-modal ${wide ? "wide" : ""} ${className}`}
      >
        <header>
          {titleAccessory ? (
            <div className="studio-modal-title">
              <h2>{title}</h2>
              {titleAccessory}
            </div>
          ) : (
            <h2>{title}</h2>
          )}
          {headerContent}
          <button
            className="studio-icon"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
