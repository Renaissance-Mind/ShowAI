import { topDialog } from "./modal";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslator } from "../i18n/react";
import studioMessages from "../i18n/messages/studio";
import "./dialog.css";

export default function Dialog({
  title,
  children,
  onClose,
  wide = false,
  className = "",
  showTitle = true,
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
  showTitle?: boolean;
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
  const startedOutside = useRef(false);
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
            : 'input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[role="combobox"]:not([disabled])',
        ) ??
        panel.current)
    )?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || panel.current !== topDialog()) return;
      if (event.key === "Escape") {
        if (
          panel.current?.contains(document.fullscreenElement) ||
          document.querySelector('[role="menu"], [role="listbox"]')
        )
          return;
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const items = [
          ...(panel.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[role="combobox"]:not([disabled]),a[href],summary,[tabindex],[contenteditable="true"]',
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
  return (
    <div
      className="studio-modal-shade"
      onPointerDown={(event) => {
        startedOutside.current =
          event.target === event.currentTarget && event.button === 0;
      }}
      onPointerCancel={() => {
        startedOutside.current = false;
      }}
      onClick={(event) => {
        const outside =
          startedOutside.current && event.target === event.currentTarget;
        startedOutside.current = false;
        if (outside && dismissible && panel.current === topDialog()) onClose();
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
        {(showTitle || headerContent || headerActions || titleAccessory) && (
          <header
            className="studio-dialog-header"
            data-toolbar={
              headerContent || headerActions || titleAccessory ? "" : undefined
            }
          >
            {showTitle && (
              <div className="studio-modal-title">
                <h2 title={title}>{title}</h2>
                {titleAccessory}
              </div>
            )}
            {headerContent}
            {headerActions && (
              <div className="studio-modal-header-actions">{headerActions}</div>
            )}
          </header>
        )}
        {description && (
          <p className="studio-dialog-description" id={descriptionId}>
            {description}
          </p>
        )}
        {children}
        {dismissible && (
          <button
            type="button"
            className="studio-dialog-dismiss"
            data-review-ignore
            onClick={onClose}
          >
            {t("closeDialog")}
          </button>
        )}
      </div>
    </div>
  );
}
