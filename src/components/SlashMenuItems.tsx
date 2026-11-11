import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { BarChart3, ChevronLeft, ChevronRight } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/slashMenu";
import {
  readRecentSlashItems,
  rememberSlashItem,
  slashMenuRows,
  type SlashEntry,
  type SlashLevel,
  type SlashRow,
} from "./slash-menu-model";

/**
 * Rows, selection and keys of an insert menu. `key` returns whether it used
 * the key: ↑ ↓ move, Enter inserts or opens charts, → opens charts, and ← or
 * Escape on the chart level go back.
 */
export function useSlashMenu<T extends SlashEntry>(
  items: readonly T[],
  query: string,
  onRun: (item: T) => void,
  open = true,
) {
  const t = useTranslator(messages);
  const [level, setLevel] = useState<SlashLevel>("root");
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  // Each opening starts on the first level with the current recent items.
  useLayoutEffect(() => {
    if (!open) return;
    setLevel("root");
    setSelected(0);
    setRecent(readRecentSlashItems(localStorage));
  }, [open]);
  const labels = { recent: t("recent"), charts: t("charts") };
  const rows = slashMenuRows(items, { query, level, recent, labels });
  useEffect(() => setSelected(0), [query]);
  const searching = !!query.trim();
  const openCharts = () => {
    setLevel("charts");
    setSelected(0);
  };
  const back = () => {
    setLevel("root");
    setSelected(
      Math.max(
        0,
        slashMenuRows(items, { query, level: "root", recent, labels }).findIndex(
          (row) => row.type === "charts",
        ),
      ),
    );
  };
  const activate = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.type === "charts") return openCharts();
    rememberSlashItem(localStorage, row.item.id);
    onRun(row.item);
  };
  const key = (event: { key: string; preventDefault(): void }) => {
    const count = rows.length;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected((index) => (count ? (index + step + count) % count : 0));
      return true;
    }
    if (event.key === "Enter" && count) {
      event.preventDefault();
      activate(selected);
      return true;
    }
    if (event.key === "ArrowRight" && rows[selected]?.type === "charts") {
      event.preventDefault();
      openCharts();
      return true;
    }
    if (
      (event.key === "ArrowLeft" || event.key === "Escape") &&
      level === "charts" &&
      !searching
    ) {
      event.preventDefault();
      back();
      return true;
    }
    return false;
  };
  return {
    rows,
    selected,
    setSelected,
    activate,
    key,
    back,
    charts: level === "charts" && !searching,
  };
}

/** The rows of an insert menu, with group headings. */
export function SlashMenuItems<T extends SlashEntry>({
  menu,
  disabled,
  icon,
  detail,
}: {
  menu: ReturnType<typeof useSlashMenu<T>>;
  disabled?: boolean;
  icon: (item: T) => ReactNode;
  detail?: (item: T) => ReactNode;
}) {
  const t = useTranslator(messages);
  const { rows, selected } = menu;
  const heading = (row: SlashRow<T>, index: number) => {
    if (index > 0 && rows[index - 1].group === row.group) return null;
    if (!row.group) return null;
    return menu.charts ? (
      <button
        type="button"
        className="slash-group slash-back"
        aria-label={t("back")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={menu.back}
      >
        <ChevronLeft size={14} aria-hidden="true" />
        {row.group}
      </button>
    ) : (
      <div className="slash-group">{row.group}</div>
    );
  };
  return rows.map((row, index) => (
    <div key={row.key}>
      {heading(row, index)}
      <button
        type="button"
        role="option"
        disabled={disabled}
        aria-selected={index === selected}
        aria-haspopup={row.type === "charts" ? "listbox" : undefined}
        className={`slash-item${index === selected ? " is-selected" : ""}`}
        onMouseEnter={() => menu.setSelected(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => menu.activate(index)}
      >
        <span className="slash-item-icon">
          {row.type === "charts" ? <BarChart3 size={20} /> : icon(row.item)}
        </span>
        <span>
          <strong>
            {row.type === "charts" ? t("charts") : row.item.title}
          </strong>
          {row.type === "item" && detail?.(row.item)}
        </span>
        {row.type === "charts" ? (
          <ChevronRight className="slash-enter" size={16} aria-hidden="true" />
        ) : (
          index === selected && <span className="slash-enter">↵</span>
        )}
      </button>
    </div>
  ));
}
