// Filter group and sort list of a database view, edited in the filter row
// the view menu opens. Operators come from each field's value type.
import { ArrowDown, ArrowUp, Filter, Plus, Trash2 } from "../../ui/icons";
import {
  OPERATORS,
  formatDay,
  kindOf,
  localDay,
  operatorsOf,
  type FilterOperator,
  type ValueTypeContext,
} from "../../datasets/value-types.mjs";
import {
  MAX_FILTER_CONDITIONS,
  MAX_SORTS,
  filterConditions,
  type FilterCondition,
  type FilterGroup,
  type RecordSort,
} from "../../datasets/record-query.mjs";
import type { MessageKey } from "../../i18n";
import { useTranslator } from "../../i18n/react";
import messages from "../../i18n/messages/database";
import fieldMessages from "../../i18n/messages/databaseFields";
import type { DatabaseColumn } from "./types";

export interface QueryChoices {
  /** Options or records a list operand can name for this column. */
  (column: DatabaseColumn): { id: string; label: string }[];
}

const isGroup = (item: unknown): item is FilterGroup =>
  !!item &&
  typeof item === "object" &&
  Array.isArray((item as FilterGroup).conditions);

/** A fitting starting value for an operator on a column. */
function initialOperand(
  operator: FilterOperator,
  column: DatabaseColumn,
  context: ValueTypeContext,
): unknown {
  const kind = kindOf(column, context);
  const today = formatDay(localDay());
  switch (OPERATORS[operator]) {
    case "none":
      return undefined;
    case "text":
      return "";
    case "number":
      return 0;
    case "date":
      return today;
    case "range":
      return kind === "date" ? [today, today] : [0, 0];
    case "relative":
      return { direction: "past", days: 7 };
    case "list":
      return [];
    default:
      return kind === "number"
        ? 0
        : kind === "date"
          ? today
          : kind === "option"
            ? (column.options?.[0] ?? "")
            : "";
  }
}

function Operand({
  condition,
  column,
  context,
  choices,
  onChange,
}: {
  condition: FilterCondition;
  column: DatabaseColumn;
  context: ValueTypeContext;
  choices: QueryChoices;
  onChange: (value: unknown) => void;
}) {
  const tf = useTranslator(fieldMessages);
  const kind = kindOf(column, context);
  const operand = OPERATORS[condition.operator];
  const value = condition.value;
  const field = (
    current: unknown,
    label: string,
    set: (next: unknown) => void,
  ) =>
    kind === "date" || operand === "date" ? (
      <input
        type="date"
        aria-label={label}
        value={String(current ?? "")}
        onChange={(event) => set(event.target.value)}
      />
    ) : kind === "number" || operand === "number" ? (
      <input
        type="number"
        aria-label={label}
        value={typeof current === "number" ? current : ""}
        onChange={(event) =>
          set(event.target.value === "" ? 0 : Number(event.target.value))
        }
      />
    ) : kind === "option" ? (
      <select
        aria-label={label}
        value={String(current ?? "")}
        onChange={(event) => set(event.target.value)}
      >
        {[...new Set([...(column.options ?? []), String(current ?? "")])].map(
          (option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ),
        )}
      </select>
    ) : (
      <input
        aria-label={label}
        value={String(current ?? "")}
        onChange={(event) => set(event.target.value)}
      />
    );
  if (operand === "none") return null;
  if (operand === "range") {
    const range = Array.isArray(value) ? value : [];
    return (
      <>
        {field(range[0], tf("conditionFrom"), (next) =>
          onChange([next, range[1]]),
        )}
        {field(range[1], tf("conditionTo"), (next) =>
          onChange([range[0], next]),
        )}
      </>
    );
  }
  if (operand === "relative") {
    const relative = (value ?? { direction: "past", days: 7 }) as {
      direction: "past" | "next";
      days: number;
    };
    return (
      <>
        <select
          aria-label={tf("conditionValue")}
          value={relative.direction}
          onChange={(event) =>
            onChange({ ...relative, direction: event.target.value })
          }
        >
          <option value="past">{tf("within.past")}</option>
          <option value="next">{tf("within.next")}</option>
        </select>
        <input
          type="number"
          min={0}
          max={3660}
          aria-label={tf("conditionDays")}
          value={relative.days}
          onChange={(event) =>
            onChange({
              ...relative,
              days: Math.max(
                0,
                Math.min(3660, Math.round(Number(event.target.value) || 0)),
              ),
            })
          }
        />
      </>
    );
  }
  if (operand === "list") {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <span
        className="sb-query-choices"
        role="group"
        aria-label={tf("conditionValue")}
      >
        {choices(column).map((choice) => (
          <label key={choice.id}>
            <input
              type="checkbox"
              checked={selected.includes(choice.id)}
              onChange={() =>
                onChange(
                  selected.includes(choice.id)
                    ? selected.filter((item) => item !== choice.id)
                    : [...selected, choice.id],
                )
              }
            />
            {choice.label}
          </label>
        ))}
      </span>
    );
  }
  return field(value, tf("conditionValue"), onChange);
}

function ConditionRow({
  condition,
  columns,
  context,
  choices,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  columns: DatabaseColumn[];
  context: ValueTypeContext;
  choices: QueryChoices;
  onChange: (condition: FilterCondition) => void;
  onRemove: () => void;
}) {
  const tf = useTranslator(fieldMessages);
  const column = columns.find((item) => item.id === condition.column);
  const operators = column ? operatorsOf(column, context) : [];
  return (
    <div className="sb-query-condition">
      <select
        aria-label={tf("conditionProperty")}
        value={condition.column}
        onChange={(event) => {
          const next = columns.find((item) => item.id === event.target.value)!;
          const operator = operatorsOf(next, context)[0];
          onChange({
            column: next.id,
            operator,
            ...(OPERATORS[operator] === "none"
              ? {}
              : { value: initialOperand(operator, next, context) }),
          });
        }}
      >
        {!column && (
          <option value={condition.column}>{condition.column}</option>
        )}
        {columns.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select
        aria-label={tf("conditionOperator")}
        value={condition.operator}
        onChange={(event) => {
          const operator = event.target.value as FilterOperator;
          const keep = OPERATORS[operator] === OPERATORS[condition.operator];
          onChange({
            column: condition.column,
            operator,
            ...(OPERATORS[operator] === "none"
              ? {}
              : {
                  value: keep
                    ? condition.value
                    : column
                      ? initialOperand(operator, column, context)
                      : "",
                }),
          });
        }}
      >
        {(operators.includes(condition.operator)
          ? operators
          : [condition.operator, ...operators]
        ).map((operator) => (
          <option key={operator} value={operator}>
            {tf(`op.${operator}` as MessageKey<typeof fieldMessages>)}
          </option>
        ))}
      </select>
      {column && (
        <Operand
          condition={condition}
          column={column}
          context={context}
          choices={choices}
          onChange={(value) => onChange({ ...condition, value })}
        />
      )}
      <button
        type="button"
        className="sb-icon-button"
        aria-label={tf("removeCondition")}
        onClick={onRemove}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  columns,
  context,
  choices,
  nested,
  canAdd,
  onChange,
  onRemove,
}: {
  group: FilterGroup;
  columns: DatabaseColumn[];
  context: ValueTypeContext;
  choices: QueryChoices;
  nested: boolean;
  canAdd: boolean;
  onChange: (group: FilterGroup) => void;
  onRemove?: () => void;
}) {
  const tf = useTranslator(fieldMessages);
  const first = columns[0];
  const newCondition = (): FilterCondition => {
    const operator = operatorsOf(first, context)[0];
    return {
      column: first.id,
      operator,
      ...(OPERATORS[operator] === "none"
        ? {}
        : { value: initialOperand(operator, first, context) }),
    };
  };
  const replace = (index: number, item: FilterCondition | FilterGroup | null) =>
    onChange({
      ...group,
      conditions: item
        ? group.conditions.map((entry, at) => (at === index ? item : entry))
        : group.conditions.filter((_entry, at) => at !== index),
    });
  return (
    <div className={nested ? "sb-query-group is-nested" : "sb-query-group"}>
      <div className="sb-query-group-head">
        <select
          aria-label={tf("filterJoin")}
          value={group.join}
          onChange={(event) =>
            onChange({ ...group, join: event.target.value as "and" | "or" })
          }
        >
          <option value="and">{tf("join.and")}</option>
          <option value="or">{tf("join.or")}</option>
        </select>
        {onRemove && (
          <button
            type="button"
            className="sb-icon-button"
            aria-label={tf("removeGroup")}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {group.conditions.map((item, index) =>
        isGroup(item) ? (
          <GroupEditor
            key={index}
            group={item}
            columns={columns}
            context={context}
            choices={choices}
            nested
            canAdd={canAdd}
            onChange={(next) => replace(index, next)}
            onRemove={() => replace(index, null)}
          />
        ) : (
          <ConditionRow
            key={index}
            condition={item}
            columns={columns}
            context={context}
            choices={choices}
            onChange={(next) => replace(index, next)}
            onRemove={() => replace(index, null)}
          />
        ),
      )}
      {first && canAdd && (
        <div className="sb-query-actions">
          <button
            type="button"
            className="sb-text-button"
            onClick={() =>
              onChange({
                ...group,
                conditions: [...group.conditions, newCondition()],
              })
            }
          >
            <Plus size={13} aria-hidden="true" />
            {tf("addCondition")}
          </button>
          {!nested && (
            <button
              type="button"
              className="sb-text-button"
              onClick={() =>
                onChange({
                  ...group,
                  conditions: [
                    ...group.conditions,
                    {
                      join: group.join === "and" ? "or" : "and",
                      conditions: [newCondition()],
                    },
                  ],
                })
              }
            >
              <Plus size={13} aria-hidden="true" />
              {tf("addGroup")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function DatabaseQueryEditor({
  columns,
  filter,
  sorts,
  context,
  choices,
  onFilter,
  onSorts,
}: {
  columns: DatabaseColumn[];
  filter: FilterGroup | null;
  sorts: RecordSort[];
  context: ValueTypeContext;
  choices: QueryChoices;
  onFilter: (filter: FilterGroup | undefined) => void;
  onSorts: (sorts: RecordSort[]) => void;
}) {
  const t = useTranslator(messages);
  const tf = useTranslator(fieldMessages);
  const group = filter ?? { join: "and" as const, conditions: [] };
  const count = filterConditions(group).length;
  const unsorted = columns.filter(
    (column) => !sorts.some((sort) => sort.column === column.id),
  );
  return (
    <div className="sb-filter-row sb-query-editor">
      <Filter size={13} aria-hidden="true" />
      <GroupEditor
        group={group}
        columns={columns}
        context={context}
        choices={choices}
        nested={false}
        canAdd={count < MAX_FILTER_CONDITIONS}
        onChange={(next) =>
          onFilter(filterConditions(next).length ? next : undefined)
        }
      />
      <div className="sb-query-sorts" role="group" aria-label={tf("sorts")}>
        {sorts.map((sort, index) => (
          <div className="sb-query-condition" key={`${sort.column}-${index}`}>
            {sort.direction === "asc" ? (
              <ArrowUp size={12} aria-hidden="true" />
            ) : (
              <ArrowDown size={12} aria-hidden="true" />
            )}
            <select
              aria-label={tf("sortProperty")}
              value={sort.column}
              onChange={(event) =>
                onSorts(
                  sorts.map((item, at) =>
                    at === index
                      ? { ...item, column: event.target.value }
                      : item,
                  ),
                )
              }
            >
              {columns
                .filter(
                  (column) =>
                    column.id === sort.column ||
                    !sorts.some((item) => item.column === column.id),
                )
                .map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
            </select>
            <select
              aria-label={tf("sortDirection")}
              value={sort.direction}
              onChange={(event) =>
                onSorts(
                  sorts.map((item, at) =>
                    at === index
                      ? {
                          ...item,
                          direction: event.target.value as "asc" | "desc",
                        }
                      : item,
                  ),
                )
              }
            >
              <option value="asc">{tf("direction.asc")}</option>
              <option value="desc">{tf("direction.desc")}</option>
            </select>
            <button
              type="button"
              className="sb-icon-button"
              aria-label={tf("removeSort")}
              onClick={() => onSorts(sorts.filter((_item, at) => at !== index))}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="sb-query-actions">
          {unsorted.length > 0 && sorts.length < MAX_SORTS && (
            <button
              type="button"
              className="sb-text-button"
              onClick={() =>
                onSorts([
                  ...sorts,
                  { column: unsorted[0].id, direction: "asc" },
                ])
              }
            >
              <Plus size={13} aria-hidden="true" />
              {tf("addSort")}
            </button>
          )}
          {(count > 0 || sorts.length > 0) && (
            <button
              type="button"
              className="sb-text-button"
              onClick={() => {
                onFilter(undefined);
                onSorts([]);
              }}
            >
              {t("clear")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
