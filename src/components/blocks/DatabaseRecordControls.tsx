import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Pencil } from "../../ui/icons";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";

export function activateRecord(
  event: MouseEvent<HTMLElement>,
  open: () => void,
) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey
  )
    return;
  const control = (event.target as Element).closest(
    "button, a, input, select, textarea, summary, label, [contenteditable=true], [role=button]",
  );
  const selection = event.currentTarget.ownerDocument.getSelection();
  if (control && event.currentTarget.contains(control)) return;
  if (
    selection &&
    !selection.isCollapsed &&
    event.currentTarget.contains(selection.anchorNode) &&
    event.currentTarget.contains(selection.focusNode)
  )
    return;
  open();
}

export function RecordTitle({
  name,
  open,
  editor,
  selected,
}: {
  name: string;
  open: () => void;
  editor?: ReactNode;
  selected?: boolean;
}) {
  const t = useTranslator(messages);
  const [editing, setEditing] = useState(false);
  const container = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (editing)
      container.current
        ?.querySelector<HTMLElement>("input, select, button, textarea")
        ?.focus();
  }, [editing]);
  return (
    <span
      className="sb-record-title"
      ref={container}
      onBlur={(event) => {
        if (
          editing &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        )
          setEditing(false);
      }}
      onKeyDown={(event) => {
        if (!editing && editor && event.key === "F2") {
          event.preventDefault();
          setEditing(true);
        } else if (
          editing &&
          (event.key === "Escape" ||
            (event.key === "Enter" &&
              event.target instanceof HTMLInputElement &&
              !event.nativeEvent.isComposing))
        ) {
          event.preventDefault();
          event.stopPropagation();
          setEditing(false);
          requestAnimationFrame(() => trigger.current?.focus());
        }
      }}
    >
      {editing ? (
        editor
      ) : (
        <>
          <button
            ref={trigger}
            type="button"
            className="sb-record-open"
            aria-label={t(
              selected === undefined ? "openRecord" : "selectRecord",
              { name },
            )}
            aria-pressed={selected}
            title={name}
            onClick={open}
          >
            {name}
          </button>
          {editor && (
            <button
              type="button"
              className="sb-icon-button sb-record-rename"
              aria-label={t("editRecordTitle", { name })}
              title={t("editRecordTitle", { name })}
              onClick={() => setEditing(true)}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </span>
  );
}

export function RecordDialog({
  title,
  close,
  actions,
  children,
}: {
  title: string;
  close: () => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  useEffect(() => {
    const dialog = panel.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={panel}
      role="dialog"
      aria-modal="true"
      className="sb-block sb-record-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onPointerDown={(event) => {
        pressedOutside.current =
          event.target === event.currentTarget &&
          event.clientX < event.currentTarget.getBoundingClientRect().left;
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget)
          close();
        pressedOutside.current = false;
      }}
    >
      <header>
        <h2>{title}</h2>
        <div>{actions}</div>
      </header>
      {children}
    </dialog>
  );
}
