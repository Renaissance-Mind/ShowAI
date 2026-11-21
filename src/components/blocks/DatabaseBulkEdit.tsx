import { useState, type ReactNode } from "react";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import type { DatabaseColumn, DatabaseValue } from "./types";

export function SelectRecords({
  checked,
  mixed = false,
  label,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      className="showai-checkbox sb-record-check"
      aria-label={label}
      title={label}
      checked={checked}
      ref={(input) => {
        if (input) input.indeterminate = mixed;
      }}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}

export function DatabaseBulkEdit({
  count,
  total,
  columns,
  all,
  clear,
  renderValue,
  apply,
}: {
  count: number;
  total: number;
  columns: DatabaseColumn[];
  all: () => void;
  clear: () => void;
  renderValue: (
    column: DatabaseColumn,
    draft: DatabaseValue | undefined,
    change: (value: DatabaseValue) => void,
  ) => ReactNode;
  apply: (column: DatabaseColumn, value: DatabaseValue | undefined) => void;
}) {
  const t = useTranslator(messages);
  const [field, setField] = useState("");
  const [draft, setDraft] = useState<DatabaseValue>();
  const column = columns.find((item) => item.id === field);
  return (
    <div className="sb-bulk-edit" role="region" aria-label={t("bulkEdit")}>
      <strong aria-live="polite">{t("selectedCount", { count })}</strong>
      {count < total && (
        <button type="button" className="sb-text-button" onClick={all}>
          {t("selectAllRecords", { count: total })}
        </button>
      )}
      {count > 0 && (
        <select
          aria-label={t("bulkField")}
          className="showai-select"
          value={column?.id ?? ""}
          onChange={(event) => {
            setField(event.target.value);
            setDraft(undefined);
          }}
        >
          <option value="">{t("bulkField")}</option>
          {columns.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      )}
      {column && count > 0 && (
        <>
          <div className="sb-bulk-value" key={column.id}>
            {renderValue(column, draft, setDraft)}
          </div>
          <button
            type="button"
            className="showai-button"
            disabled={draft === undefined}
            onClick={() => apply(column, draft)}
          >
            {t("bulkApply")}
          </button>
          <button
            type="button"
            className="sb-text-button"
            onClick={() => apply(column, undefined)}
          >
            {t("bulkClearField")}
          </button>
        </>
      )}
      <button type="button" className="sb-text-button" onClick={clear}>
        {t("exitSelection")}
      </button>
    </div>
  );
}

export type DatabaseSelection = {
  active: boolean;
  selected: ReadonlySet<string>;
  count: number;
  toggleAll: (checked: boolean) => void;
};
