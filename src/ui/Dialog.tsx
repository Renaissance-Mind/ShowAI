import { topDialog } from "./modal";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "./icons";
import { useTranslator } from "../i18n/react";
import studioMessages from "../i18n/messages/studio";
import "./dialog.css";

export default function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = "",
  icon: Icon,
  tone,
  description,
  titleAccessory,
  headerContent,
  headerActions,
  dismissible = true,
  initialFocus = "auto",
  returnFocus,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  icon?: typeof X;
  tone?: "caution" | "positive" | "danger";
  description?: string;
  titleAccessory?: ReactNode;
  headerContent?: ReactNode;
  headerActions?: ReactNode;
  dismissible?: boolean;
  initialFocus?: "auto" | "container";
  returnFocus?: HTMLElement | null;
}) {
  const t = useTranslator(studioMessages);
  const descriptionId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = dismissible ? onClose : () => {};
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    (initialFocus === "container"
      ? panel.current
      : (panel.current?.querySelector<HTMLElement>(
          "[data-autofocus]:not([disabled])",
        ) ??
        panel.current?.querySelector<HTMLElement>(
          className.includes("catalog-")
            ? '[role="tab"][aria-selected="true"]'
            : "input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
        ) ??
        panel.current)
    )?.focus();
    const handle = (event: KeyboardEvent) => {
      if (panel.current !== topDialog()) return;
      if (event.key === "Escape") {
        if (
          panel.current?.contains(document.fullscreenElement) ||
          document.querySelector('[role="menu"]')
        )
          return;
        close.current();
      }
      if (event.key === "Tab") {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),a[href],summary,[tabindex],[contenteditable="true"]',
          ) ?? []),
        ].filter(
          (item) =>
            item.offsetParent !== null &&
            item.tabIndex >= 0 &&
            !item.closest("[inert]"),
        );
        const first = items[0],
          last = items.at(-1);
        if (
          document.activeElement === panel.current ||
          !panel.current?.contains(document.activeElement)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
          return;
        }
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
      (returnFocus?.isConnected ? returnFocus : previous)?.focus({
        preventScroll: true,
      });
    };
  }, []);
  const closeButton = dismissible && (
    <button
      type="button"
      className="studio-icon studio-dialog-close"
      aria-label={t("closeDialog")}
      data-no-tooltip
      onClick={onClose}
    >
      <X size={16} aria-hidden="true" />
    </button>
  );
  return (
    <div
      className="studio-modal-shade"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-describedby={description ? descriptionId : undefined}
        data-tone={tone}
        tabIndex={-1}
        className={`studio-modal ${wide ? "wide" : ""} ${className}`}
      >
        <header className="studio-dialog-header">
          {Icon || titleAccessory ? (
            <div className="studio-modal-title">
              {Icon && (
                <span className="studio-dialog-mark" aria-hidden="true">
                  <Icon size={20} strokeWidth={1.7} />
                </span>
              )}
              <h2>{title}</h2>
              {titleAccessory}
            </div>
          ) : (
            <h2>{title}</h2>
          )}
          {headerContent}
          {headerActions ? (
            <div className="studio-modal-header-actions">
              {headerActions}
              {closeButton}
            </div>
          ) : (
            closeButton
          )}
        </header>
        {description && (
          <p className="studio-dialog-description" id={descriptionId}>
            {description}
          </p>
        )}
        {children}
      </div>
    </div>
  );
}
