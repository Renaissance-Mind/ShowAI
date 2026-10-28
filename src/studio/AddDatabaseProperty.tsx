import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ColumnType, DatabaseColumn } from "../components/blocks/types";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/projectDatabase";
import { Plus } from "../ui/icons";

const TYPES: ColumnType[] = [
  "text",
  "number",
  "select",
  "date",
  "checkbox",
  "url",
];

export default function AddDatabaseProperty({
  disabled,
  atLimit,
  onCreate,
}: {
  disabled: boolean;
  atLimit: boolean;
  onCreate: (column: DatabaseColumn) => boolean;
}) {
  const t = useTranslator(messages);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ColumnType>("text");
  const [options, setOptions] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="project-db-add-property"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled || atLimit}
        title={t(atLimit ? "propertyLimit" : "addProperty")}
        onClick={() => {
          setName("");
          setType("text");
          setOptions("");
          setError("");
          setOpen(true);
        }}
      >
        <Plus size={15} />
        {t("addProperty")}
      </button>
      {open &&
        createPortal(
          <PropertyPopover
            id={id}
            anchor={trigger.current}
            type={type}
            onClose={() => setOpen(false)}
          >
            <form
              className="studio-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (disabled || atLimit) return;
                if (!name.trim()) {
                  setError(t("propertyEmpty"));
                  return;
                }
                const column: DatabaseColumn = {
                  id: `property-${crypto.randomUUID()}`,
                  name: name.trim(),
                  type,
                  ...(type === "select"
                    ? {
                        options: Array.from(
                          new Set(
                            options
                              .split(/[,，\n]/)
                              .map((option) => option.trim())
                              .filter(Boolean),
                          ),
                        ),
                      }
                    : {}),
                };
                if (onCreate(column)) setOpen(false);
                else setError(t("propertyChanged"));
              }}
            >
              <strong>{t("addProperty")}</strong>
              <label>
                {t("propertyName")}
                <input
                  value={name}
                  maxLength={1000}
                  placeholder={t("newProperty")}
                  disabled={disabled || atLimit}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                />
              </label>
              <label>
                {t("propertyType")}
                <select
                  value={type}
                  disabled={disabled || atLimit}
                  onChange={(event) =>
                    setType(event.target.value as ColumnType)
                  }
                >
                  {TYPES.map((value) => (
                    <option key={value} value={value}>
                      {t(`type.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              {type === "select" && (
                <label>
                  {t("propertyOptions")}
                  <input
                    value={options}
                    placeholder={t("optionsPlaceholder")}
                    disabled={disabled || atLimit}
                    onChange={(event) => setOptions(event.target.value)}
                  />
                </label>
              )}
              {error && (
                <p className="studio-form-error" role="alert">
                  {error}
                </p>
              )}
              {atLimit && <p role="status">{t("propertyLimit")}</p>}
              <footer>
                <button
                  type="button"
                  className="studio-button"
                  onClick={() => setOpen(false)}
                >
                  {t("cancel")}
                </button>
                <button
                  type="submit"
                  className="studio-button primary"
                  disabled={disabled || atLimit}
                >
                  {t("createProperty")}
                </button>
              </footer>
            </form>
          </PropertyPopover>,
          document.body,
        )}
    </>
  );
}

/** The native popover handles outside clicks and Escape without a modal shade. */
function PropertyPopover({
  id,
  anchor,
  type,
  onClose,
  children,
}: {
  id: string;
  anchor: HTMLButtonElement | null;
  type: ColumnType;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useTranslator(messages);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const place = () => {
    if (!panel.current || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popup = panel.current.getBoundingClientRect();
    panel.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - popup.width - 8))}px`;
    const below = rect.bottom + 6;
    const above = rect.top - popup.height - 6;
    panel.current.style.top = `${Math.max(8, Math.min(below + popup.height <= window.innerHeight - 8 ? below : above, window.innerHeight - popup.height - 8))}px`;
  };
  useLayoutEffect(() => {
    const popup = panel.current;
    if (!popup || !anchor) return;
    popup.showPopover();
    place();
    popup.querySelector("input")?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    document.addEventListener("scroll", place, true);
    const observer = new ResizeObserver(place);
    observer.observe(popup);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      document.removeEventListener("scroll", place, true);
      if (
        popup.contains(document.activeElement) ||
        document.activeElement === document.body
      )
        anchor.focus({ preventScroll: true });
    };
  }, [anchor]);
  useLayoutEffect(place, [type]);
  return (
    <div
      id={id}
      ref={panel}
      className="project-db-property-popover"
      popover="auto"
      role="dialog"
      aria-label={t("addProperty")}
      onToggle={(event) => {
        if (event.newState === "closed") close.current();
      }}
    >
      {children}
    </div>
  );
}
