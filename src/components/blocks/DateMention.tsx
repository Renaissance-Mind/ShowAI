import { useState } from "react";
import type { BlockProps } from "./types";
import { useLocale, useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/pageMention";
import "./page-mention.css";

export function DateBlock({ data, onChange, readOnly, inline }: BlockProps) {
  const t = useTranslator(messages);
  const locale = useLocale();
  const [editing, setEditing] = useState(false);
  const day = String(data.date ?? "");
  const [year, month, date] = day.split("-").map(Number);
  const label = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
  const editable = !!onChange && !readOnly;
  const Wrapper = inline ? "span" : "p";
  return (
    <Wrapper className={`sb-date-mention${inline ? "" : " sb-block"}`}>
      {editable && editing ? (
        <input
          type="date"
          className="sb-date-mention-input"
          aria-label={t("date.change")}
          value={day}
          autoFocus
          onChange={(event) => {
            if (event.target.value) onChange({ date: event.target.value });
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape" || event.key === "Enter") {
              event.preventDefault();
              setEditing(false);
            }
          }}
        />
      ) : editable ? (
        <button
          type="button"
          className="sb-date-mention-value"
          aria-label={`${t("date.change")}: ${label}`}
          onClick={() => setEditing(true)}
        >
          <time dateTime={day}>{label}</time>
        </button>
      ) : (
        <time className="sb-date-mention-value" dateTime={day}>
          {label}
        </time>
      )}
    </Wrapper>
  );
}
