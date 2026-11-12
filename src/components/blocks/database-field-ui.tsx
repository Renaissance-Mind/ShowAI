// The database's field registry: each field type pairs a harness value type
// (src/datasets/value-types.mjs) with the cell renderer, the cell editor and
// the column settings this component shows for it. Field types a library
// component contributes come from the host and pair the same way.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ExternalLink, FileText, TriangleAlert } from "../../ui/icons";
import { safeUrl, text } from "./helpers";
import { OPTION_TONES } from "./database-contract.mjs";
import {
  VALUE_KINDS,
  isErrorValue,
  parsePageCell,
  valueTypeOf,
} from "../../datasets/value-types.mjs";
import {
  ROLLUP_AGGREGATES,
  recordTitle,
} from "../../datasets/derived-fields.mjs";
import { pageLink } from "../../document/page-link.mjs";
import { rankByTitle } from "../title-match";
import type { PageLinkBridge } from "../page-links";
import type { DatabaseHost } from "./database-host";
import type { DerivedDatabase } from "./database-derived";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import fieldMessages from "../../i18n/messages/databaseFields";
import type { DatabaseColumn, DatabaseRow, DatabaseValue } from "./types";

// A select value standing for "create a page"; page links never take this form.
const NEW_PAGE = "showai:new-page";

/** What every cell of one database shares. */
export interface CellEnvironment {
  derived: DerivedDatabase;
  host: DatabaseHost | null;
  pages: PageLinkBridge | null;
  openRecord?: (row: DatabaseRow, column: DatabaseColumn) => void;
}
export interface CellProps {
  row: DatabaseRow;
  column: DatabaseColumn;
  value: unknown;
  editable: boolean;
  update: (value: DatabaseValue) => void;
  createPage?: () => void;
  env: CellEnvironment;
}
export interface ConfigProps {
  column: DatabaseColumn;
  columns: DatabaseColumn[];
  onChange: (changes: Partial<DatabaseColumn>) => void;
  host: DatabaseHost | null;
}
export interface FieldUi {
  symbol: string;
  label?: MessageKey<typeof messages>;
  fieldLabel?: MessageKey<typeof fieldMessages>;
  Cell: (props: CellProps) => ReactNode;
  Config?: (props: ConfigProps) => ReactNode;
}

/** The class of an option tag: its saved tone, else a tone by position. */
export function optionClass(column: DatabaseColumn, option: string): string {
  const tone = column.colors?.[option];
  if (tone && OPTION_TONES.includes(tone)) return `sb-tag sb-tone-${tone}`;
  return `sb-tag sb-tag-${Math.max(0, column.options?.indexOf(option) ?? 0) % 5}`;
}

/** The title of the page a cell links to, when the host lists it. */
export function pageTitle(
  value: unknown,
  pages: PageLinkBridge | null,
): string | undefined {
  const target = parsePageCell(value);
  if (!target || pages?.projectId !== target.projectId) return undefined;
  return pages.pages.find((page) => page.id === target.pageId)?.title;
}

/** A small panel under a trigger button; Escape or a click outside closes it. */
function Popover({
  label,
  trigger,
  children,
  open,
  setOpen,
}: {
  label: string;
  trigger: ReactNode;
  children: ReactNode;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close, true);
    return () => document.removeEventListener("pointerdown", close, true);
  }, [open, setOpen]);
  return (
    <div
      className="sb-field-popover-root"
      ref={root}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }}
    >
      <button
        ref={button}
        type="button"
        className="sb-field-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open && (
        <div
          className="sb-field-popover"
          id={id}
          role="dialog"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function Placeholder() {
  return <span className="sb-cell-value sb-placeholder">—</span>;
}

function Tags({
  column,
  values,
}: {
  column: DatabaseColumn;
  values: string[];
}) {
  return values.length ? (
    <span className="sb-tag-list">
      {values.map((value) => (
        <span key={value} className={optionClass(column, value)}>
          {value}
        </span>
      ))}
    </span>
  ) : (
    <Placeholder />
  );
}

interface Choice {
  id: string;
  label: string;
  /** Orders choices without a query, recently changed first (pages). */
  updatedAt?: string;
}

/**
 * The picker of a cell: choices with optional search, ranked the way the @
 * menu and quick jump rank pages. Checkboxes for multi-select and relations,
 * radio buttons for a single page; leading choices (not set, new page) stay
 * first and are never filtered.
 */
function ChoiceList({
  choices,
  selected,
  onToggle,
  search,
  render,
  single,
  leading = [],
}: {
  choices: Choice[];
  selected: string[];
  onToggle: (id: string) => void;
  search?: string;
  render?: (choice: Choice) => ReactNode;
  single?: boolean;
  leading?: Choice[];
}) {
  const [query, setQuery] = useState("");
  const name = useId();
  const ranked =
    query.trim() || choices.some((choice) => choice.updatedAt)
      ? rankByTitle(
          choices,
          query,
          {
            title: (choice) => choice.label,
            updatedAt: (choice) => choice.updatedAt,
          },
          200,
        )
      : choices;
  const shown = [...(query.trim() ? [] : leading), ...ranked];
  return (
    <>
      {search && (
        <input
          className="sb-field-search"
          aria-label={search}
          placeholder={search}
          value={query}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <ul className="sb-field-choices">
        {shown.slice(0, 200).map((choice) => (
          <li key={choice.id}>
            <label>
              <input
                type={single ? "radio" : "checkbox"}
                name={single ? name : undefined}
                checked={selected.includes(choice.id)}
                autoFocus={!search && choice === shown[0]}
                onChange={() => onToggle(choice.id)}
              />
              {render ? render(choice) : choice.label}
            </label>
          </li>
        ))}
      </ul>
    </>
  );
}

function PageCell({
  row,
  column,
  value,
  editable,
  update,
  createPage,
  env,
}: CellProps) {
  const t = useTranslator(messages);
  const tf = useTranslator(fieldMessages);
  const [open, setOpen] = useState(false);
  const pages = env.pages;
  const target = parsePageCell(value);
  const title = pageTitle(value, pages);
  const canPeek = !!pages?.openRecord && !!env.openRecord;
  const link = target && (
    <a
      className="sb-cell-link sb-page-link"
      href={String(value)}
      data-open-project={target.projectId}
      data-open-page={target.pageId}
      data-database-record={canPeek || undefined}
      aria-label={editable ? t("openPage", { title: title ?? "" }) : undefined}
      onClick={(event) => {
        if (
          !canPeek ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        env.openRecord?.(row, column);
      }}
    >
      <FileText size={13} aria-hidden="true" />
      {editable ? null : title || t("linkedPage")}
    </a>
  );
  if (!editable || !pages) return link ?? <Placeholder />;
  const current = text(value);
  return (
    <div className="sb-cell-input-wrap">
      <Popover
        label={tf("chooseValues", { name: column.name })}
        open={open}
        setOpen={setOpen}
        trigger={
          target ? (
            <span className="sb-cell-value">{title || t("linkedPage")}</span>
          ) : (
            <Placeholder />
          )
        }
      >
        <ChoiceList
          single
          search={tf("searchPages")}
          selected={[current]}
          leading={[
            { id: "", label: t("notSet") },
            ...(createPage ? [{ id: NEW_PAGE, label: t("newPage") }] : []),
          ]}
          choices={pages.pages
            .filter((page) => page.id !== pages.pageId)
            .map((page) => ({
              id: pageLink({ projectId: pages.projectId, pageId: page.id }),
              label: page.title || t("untitled"),
              ...(page.updatedAt ? { updatedAt: page.updatedAt } : {}),
            }))}
          onToggle={(id) => {
            setOpen(false);
            if (id === NEW_PAGE) createPage?.();
            else update(id);
          }}
        />
      </Popover>
      {link}
    </div>
  );
}

function InputCell({ column, value, editable, update }: CellProps) {
  const t = useTranslator(messages);
  if (!editable) {
    if (column.type === "url" && safeUrl(value))
      return (
        <a
          className="sb-cell-link"
          href={safeUrl(value)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {text(value)}
          <ExternalLink size={12} />
        </a>
      );
    return (
      <span className="sb-cell-value">
        {text(value) || <span className="sb-placeholder">—</span>}
      </span>
    );
  }
  return (
    <div className="sb-cell-input-wrap">
      <input
        aria-label={column.name}
        type={
          column.type === "number" || column.type === "url"
            ? column.type
            : column.type === "date"
              ? "date"
              : "text"
        }
        className="sb-cell-input"
        value={text(value)}
        placeholder={column.type === "url" ? "https://…" : "—"}
        onChange={(event) =>
          update(
            column.type === "number" && event.target.value !== ""
              ? Number(event.target.value)
              : event.target.value,
          )
        }
      />
      {column.type === "url" && safeUrl(value) && (
        <a
          className="sb-icon-button"
          href={safeUrl(value)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t("openLink", { name: column.name })}
        >
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

function CheckboxCell({ column, value, editable, update }: CellProps) {
  return (
    <input
      type="checkbox"
      aria-label={column.name}
      checked={value === true || value === "true"}
      disabled={!editable}
      onChange={(event) => update(event.target.checked)}
    />
  );
}

function SelectCell({ column, value, editable, update }: CellProps) {
  const t = useTranslator(messages);
  const current = text(value);
  if (!editable)
    return current ? (
      <span className={optionClass(column, current)}>{current}</span>
    ) : (
      <span className="sb-cell-value">
        <span className="sb-placeholder">—</span>
      </span>
    );
  const tone = column.colors?.[current];
  return (
    <select
      aria-label={column.name}
      value={current}
      className={`sb-cell-select ${
        tone && OPTION_TONES.includes(tone)
          ? `sb-tone-${tone}`
          : `sb-tag-${Math.max(0, column.options?.indexOf(current) ?? 0) % 5}`
      }`}
      onChange={(event) => update(event.target.value)}
    >
      <option value="">{t("notSet")}</option>
      {column.options?.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
      {current && !column.options?.includes(current) && (
        <option value={current}>{current}</option>
      )}
    </select>
  );
}

const textList = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string" && value
      ? [value]
      : [];

function MultiSelectCell({ column, value, editable, update }: CellProps) {
  const tf = useTranslator(fieldMessages);
  const [open, setOpen] = useState(false);
  const values = textList(value);
  if (!editable) return <Tags column={column} values={values} />;
  const choices = [...new Set([...(column.options ?? []), ...values])].map(
    (option) => ({ id: option, label: option }),
  );
  return (
    <Popover
      label={tf("chooseValues", { name: column.name })}
      open={open}
      setOpen={setOpen}
      trigger={<Tags column={column} values={values} />}
    >
      <ChoiceList
        choices={choices}
        selected={values}
        render={(choice) => (
          <span className={optionClass(column, choice.id)}>{choice.label}</span>
        )}
        onToggle={(id) =>
          update(
            values.includes(id)
              ? values.filter((item) => item !== id)
              : [...values, id],
          )
        }
      />
    </Popover>
  );
}

function RelationCell({ column, value, editable, update, env }: CellProps) {
  const tf = useTranslator(fieldMessages);
  const [open, setOpen] = useState(false);
  const ids = textList(value);
  const titles = env.derived.recordTitles(column, ids) ?? ids;
  const chips = ids.length ? (
    <span className="sb-tag-list">
      {ids.map((id, index) => (
        <span key={id} className="sb-relation-chip">
          {titles[index]}
        </span>
      ))}
    </span>
  ) : (
    <Placeholder />
  );
  if (!editable || column.relation?.reverseOf) return chips;
  const table = column.relation?.dataset
    ? env.host?.related(column.relation.dataset)
    : undefined;
  const choices = (table?.rows ?? []).map((record) => ({
    id: record.id,
    label: recordTitle(record, table!.columns),
  }));
  return (
    <Popover
      label={tf("chooseValues", { name: column.name })}
      open={open}
      setOpen={setOpen}
      trigger={chips}
    >
      <ChoiceList
        choices={choices}
        selected={ids}
        search={tf("searchRecords")}
        onToggle={(id) =>
          update(
            ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id],
          )
        }
      />
    </Popover>
  );
}

function ComputedCell({ column, value }: CellProps) {
  const tf = useTranslator(fieldMessages);
  if (isErrorValue(value))
    return (
      <span
        className="sb-cell-error"
        role="note"
        aria-label={tf("formulaError", {
          name: column.name,
          message: value.error,
        })}
        title={value.error}
      >
        <TriangleAlert size={12} aria-hidden="true" />
        <span>{value.error}</span>
      </span>
    );
  const shown =
    typeof value === "number"
      ? Number.isInteger(value)
        ? String(value)
        : String(Math.round(value * 1000) / 1000)
      : Array.isArray(value)
        ? textList(value).join(", ")
        : typeof value === "boolean"
          ? value
            ? "✓"
            : ""
          : text(value);
  return (
    <span className="sb-cell-value sb-cell-computed">
      {shown || <span className="sb-placeholder">—</span>}
    </span>
  );
}

function CustomCell({ column, value, editable, update, env }: CellProps) {
  const tf = useTranslator(fieldMessages);
  const [open, setOpen] = useState(false);
  const field = env.host?.field?.(column);
  const display = field?.display(value, column);
  const raw = valueTypeOf(column).text(value, column);
  if (!field)
    return (
      <span
        className="sb-cell-value sb-cell-unknown"
        aria-label={`${column.name}: ${raw}`}
      >
        {raw || <span className="sb-placeholder">—</span>}
      </span>
    );
  const shown = display ? (
    display.tone && OPTION_TONES.includes(display.tone) ? (
      <span className={`sb-tag sb-tone-${display.tone}`}>{display.text}</span>
    ) : (
      <span className="sb-cell-value">
        {display.text || <span className="sb-placeholder">—</span>}
      </span>
    )
  ) : (
    <span className="sb-cell-value">{raw}</span>
  );
  if (!editable || !field.Editor) return shown;
  const Editor = field.Editor;
  return (
    <Popover
      label={tf("editValue", { name: column.name })}
      open={open}
      setOpen={setOpen}
      trigger={shown}
    >
      <Editor
        column={column}
        value={value}
        onValue={(next) => update(next as DatabaseValue)}
        onClose={() => setOpen(false)}
      />
    </Popover>
  );
}

function OptionsConfig({ column, onChange }: ConfigProps) {
  const t = useTranslator(messages);
  const tf = useTranslator(fieldMessages);
  const options = (column.options ?? [])
    .map((option) => option.trim())
    .filter(Boolean);
  return (
    <div className="sb-field-config">
      <input
        className="sb-options-input"
        aria-label={t("propertyOptions", { name: column.name })}
        placeholder={t("optionsPlaceholder")}
        value={column.options?.join(",") ?? ""}
        onChange={(event) =>
          onChange({ options: event.target.value.split(/[,，]/) })
        }
      />
      {options.length > 0 && (
        <div className="sb-option-tones">
          {[...new Set(options)].map((option) => (
            <label key={option} className={optionClass(column, option)}>
              {option}
              <select
                aria-label={tf("optionTone", { option })}
                value={column.colors?.[option] ?? ""}
                onChange={(event) => {
                  const { [option]: _previous, ...rest } = column.colors ?? {};
                  const colors = event.target.value
                    ? { ...rest, [option]: event.target.value }
                    : rest;
                  onChange({
                    colors: Object.keys(colors).length ? colors : undefined,
                  });
                }}
              >
                <option value="">{tf("tone.auto")}</option>
                {OPTION_TONES.map((tone) => (
                  <option key={tone} value={tone}>
                    {tf(`tone.${tone}` as MessageKey<typeof fieldMessages>)}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function PageConfig({ column, columns, onChange }: ConfigProps) {
  const t = useTranslator(messages);
  return (
    <select
      className="sb-options-input"
      aria-label={t("titleColumn", { name: column.name })}
      value={column.titleColumn ?? ""}
      onChange={(event) =>
        onChange({ titleColumn: event.target.value || undefined })
      }
    >
      <option value="">{t("titleColumnNone")}</option>
      {columns
        .filter((item) => item.type === "text")
        .map((item) => (
          <option key={item.id} value={item.id}>
            {t("titleColumnFrom", { name: item.name })}
          </option>
        ))}
    </select>
  );
}

function RelationConfig({ column, onChange, host }: ConfigProps) {
  const tf = useTranslator(fieldMessages);
  const t = useTranslator(messages);
  const datasets = host?.datasets?.() ?? [];
  const relation = column.relation ?? { dataset: "" };
  const current = relation.dataset;
  return (
    <div className="sb-field-config">
      <select
        aria-label={tf("relationTarget", { name: column.name })}
        value={current}
        onChange={(event) =>
          onChange({ relation: { ...relation, dataset: event.target.value } })
        }
      >
        <option value="">{t("notSet")}</option>
        {datasets
          .filter((dataset) => dataset.id !== host?.selfDataset)
          .map((dataset) => (
            <option key={dataset.id} value={dataset.id}>
              {dataset.name}
            </option>
          ))}
        {current && !datasets.some((dataset) => dataset.id === current) && (
          <option value={current}>{current}</option>
        )}
      </select>
      <label className="sb-field-toggle">
        <input
          type="checkbox"
          checked={!!relation.reverse}
          onChange={(event) => {
            const { reverse: _reverse, ...rest } = relation;
            onChange({
              relation: event.target.checked
                ? { ...rest, reverse: { name: column.name } }
                : rest,
            });
          }}
        />
        {tf("relationReverse", { name: column.name })}
      </label>
      {relation.reverse && (
        <input
          aria-label={tf("reverseName", { name: column.name })}
          value={relation.reverse.name ?? ""}
          maxLength={1000}
          onChange={(event) =>
            onChange({
              relation: { ...relation, reverse: { name: event.target.value } },
            })
          }
        />
      )}
    </div>
  );
}

function FormulaConfig({ column, onChange }: ConfigProps) {
  const tf = useTranslator(fieldMessages);
  const formula = column.formula ?? { expression: "" };
  return (
    <div className="sb-field-config">
      <input
        className="sb-formula-input"
        aria-label={tf("formulaExpression", { name: column.name })}
        placeholder='prop("…")'
        spellCheck={false}
        value={formula.expression}
        maxLength={4000}
        onChange={(event) =>
          onChange({ formula: { ...formula, expression: event.target.value } })
        }
      />
      <select
        aria-label={tf("formulaKind", { name: column.name })}
        value={formula.kind ?? "text"}
        onChange={(event) =>
          onChange({
            formula: {
              expression: formula.expression,
              ...(event.target.value === "text"
                ? {}
                : { kind: event.target.value }),
            },
          })
        }
      >
        {VALUE_KINDS.filter((kind) => kind !== "option").map((kind) => (
          <option key={kind} value={kind}>
            {tf(`kind.${kind}` as MessageKey<typeof fieldMessages>)}
          </option>
        ))}
      </select>
    </div>
  );
}

function RollupConfig({ column, columns, onChange, host }: ConfigProps) {
  const tf = useTranslator(fieldMessages);
  const t = useTranslator(messages);
  const rollup = column.rollup ?? { relation: "", aggregate: "count" };
  const relations = columns.filter((item) => item.type === "relation");
  const relation = relations.find((item) => item.id === rollup.relation);
  const target = relation?.relation?.dataset
    ? host?.related(relation.relation.dataset)
    : undefined;
  return (
    <div className="sb-field-config">
      <select
        aria-label={tf("rollupRelation", { name: column.name })}
        value={rollup.relation}
        onChange={(event) =>
          onChange({ rollup: { ...rollup, relation: event.target.value } })
        }
      >
        <option value="">{t("notSet")}</option>
        {relations.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select
        aria-label={tf("rollupColumn", { name: column.name })}
        value={rollup.column ?? ""}
        onChange={(event) =>
          onChange({
            rollup: {
              relation: rollup.relation,
              aggregate: rollup.aggregate,
              ...(event.target.value ? { column: event.target.value } : {}),
            },
          })
        }
      >
        <option value="">{t("notSet")}</option>
        {(target?.columns ?? []).map((item) => (
          <option key={item.id} value={item.id}>
            {String(item.name ?? item.id)}
          </option>
        ))}
        {rollup.column &&
          !target?.columns.some((item) => item.id === rollup.column) && (
            <option value={rollup.column}>{rollup.column}</option>
          )}
      </select>
      <select
        aria-label={tf("rollupAggregate", { name: column.name })}
        value={rollup.aggregate}
        onChange={(event) =>
          onChange({ rollup: { ...rollup, aggregate: event.target.value } })
        }
      >
        {ROLLUP_AGGREGATES.map((aggregate) => (
          <option key={aggregate} value={aggregate}>
            {tf(`aggregate.${aggregate}` as MessageKey<typeof fieldMessages>)}
          </option>
        ))}
      </select>
    </div>
  );
}

function CustomConfig({ column, onChange }: ConfigProps) {
  const tf = useTranslator(fieldMessages);
  const [draft, setDraft] = useState(() => JSON.stringify(column.config ?? {}));
  return (
    <input
      className="sb-formula-input"
      aria-label={tf("fieldConfig", { name: column.name })}
      spellCheck={false}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value);
        try {
          const parsed = JSON.parse(event.target.value);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            onChange({ config: parsed });
        } catch {
          // Kept as a draft until it is valid JSON; saving checks it again.
        }
      }}
    />
  );
}

const registry = new Map<string, FieldUi>();
/** Register the cells and settings of a built-in field type. */
export function registerFieldUi(type: string, ui: FieldUi) {
  registry.set(type, ui);
}
registerFieldUi("text", { symbol: "Aa", label: "type.text", Cell: InputCell });
registerFieldUi("number", {
  symbol: "#",
  label: "type.number",
  Cell: InputCell,
});
registerFieldUi("select", {
  symbol: "◉",
  label: "type.select",
  Cell: SelectCell,
  Config: OptionsConfig,
});
registerFieldUi("multiSelect", {
  symbol: "☰",
  fieldLabel: "type.multiSelect",
  Cell: MultiSelectCell,
  Config: OptionsConfig,
});
registerFieldUi("checkbox", {
  symbol: "☑",
  label: "type.checkbox",
  Cell: CheckboxCell,
});
registerFieldUi("url", { symbol: "↗", label: "type.url", Cell: InputCell });
registerFieldUi("date", { symbol: "◫", label: "type.date", Cell: InputCell });
registerFieldUi("page", {
  symbol: "▤",
  label: "type.page",
  Cell: PageCell,
  Config: PageConfig,
});
registerFieldUi("relation", {
  symbol: "⇄",
  fieldLabel: "type.relation",
  Cell: RelationCell,
  Config: RelationConfig,
});
registerFieldUi("formula", {
  symbol: "ƒ",
  fieldLabel: "type.formula",
  Cell: ComputedCell,
  Config: FormulaConfig,
});
registerFieldUi("rollup", {
  symbol: "Σ",
  fieldLabel: "type.rollup",
  Cell: ComputedCell,
  Config: RollupConfig,
});
const customUi: FieldUi = {
  symbol: "◇",
  Cell: CustomCell,
  Config: CustomConfig,
};

/** The built-in field types in menu order. */
export const BUILTIN_FIELD_TYPES = [...registry.keys()];
export function fieldUiOf(column: DatabaseColumn): FieldUi {
  return registry.get(column.type) ?? customUi;
}
/** Field type names for menus: built-ins and contributed ones. */
export function useFieldTypeLabel() {
  const t = useTranslator(messages);
  const tf = useTranslator(fieldMessages);
  return (type: string) => {
    const ui = registry.get(type);
    return ui?.label ? t(ui.label) : ui?.fieldLabel ? tf(ui.fieldLabel) : type;
  };
}
