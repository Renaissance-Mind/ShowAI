// Shared contract for the database built-in: validation plus the date math the
// calendar and heatmap views share. It runs in the workbench, the CLI and the
// portable reader. Value types, record queries and derived fields come from
// the harness modules in src/datasets, which every bound component shares.
import {
  VALUE_KINDS,
  formatDay,
  localDay,
  normalizeDate,
  parseDay,
  parsePageCell,
  valueTypeOf,
} from "../../datasets/value-types.mjs";
import { validateFilter, validateSorts } from "../../datasets/record-query.mjs";
import { ROLLUP_AGGREGATES } from "../../datasets/derived-fields.mjs";

const fail = (message) => {
  throw new Error(message);
};
const isObject = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const reservedIds = new Set(["id", "__proto__", "prototype", "constructor"]);

export const DATABASE_COLUMN_TYPES = [
  "text",
  "number",
  "select",
  "checkbox",
  "url",
  "date",
  "page",
  "multiSelect",
  "relation",
  "formula",
  "rollup",
  "custom",
];
/** Tones of select and multi-select options, shared with the board and calendar. */
export const OPTION_TONES = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
];
/** Column types whose values are lists of texts. */
const LIST_TYPES = new Set(["multiSelect", "relation", "custom"]);
export const DATABASE_VIEWS = ["table", "board", "list", "calendar"];
export const MAX_DATABASE_VIEWS = 20;
export const MIN_COLUMN_WIDTH = 80;
export const MAX_COLUMN_WIDTH = 1200;
export const CALENDAR_MODES = ["month", "week", "heatmap"];
export const MAX_HEATMAP_WEEKS = 53;
// A record spanning longer than this is drawn on its first day only.
export const MAX_SPAN_DAYS = 366;

const DAY_MS = 86400000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export { parseDay, formatDay, localDay, normalizeDate, parsePageCell };
/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(day) {
  return new Date(day * DAY_MS).getUTCDay();
}

export function startOfWeek(day, weekStartsOn = 1) {
  return day - ((weekdayOf(day) - weekStartsOn + 7) % 7);
}

/** "H:MM" or "HH:MM" (up to 24:00) to minutes after midnight, or null. */
export function parseTime(value) {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return Number(match[2]) < 60 && minutes <= 1440 ? minutes : null;
}

function validateCalendar(calendar, columns) {
  if (!isObject(calendar)) fail("calendar must be an object.");
  const column = (key, types) => {
    const id = calendar[key];
    if (id === undefined) return;
    if (typeof id !== "string")
      fail(`calendar.${key} must be a column id string.`);
    const target = columns.find((item) => item.id === id);
    if (!target) fail(`calendar.${key} refers to missing column ${id}.`);
    if (!types.includes(target.type))
      fail(`calendar.${key} must refer to a ${types.join(" or ")} column.`);
  };
  column("dateColumn", ["date"]);
  column("endDateColumn", ["date"]);
  column("startTimeColumn", ["text"]);
  column("endTimeColumn", ["text"]);
  column("colorColumn", ["select"]);
  column("doneColumn", ["checkbox"]);
  column("contextColumn", ["text", "select"]);
  if (
    calendar.endDateColumn !== undefined &&
    calendar.endDateColumn === calendar.dateColumn
  )
    fail("calendar.endDateColumn must differ from calendar.dateColumn.");
  if (calendar.endTimeColumn !== undefined && !calendar.startTimeColumn)
    fail("calendar.endTimeColumn requires calendar.startTimeColumn.");
  if (calendar.mode !== undefined && !CALENDAR_MODES.includes(calendar.mode))
    fail(`calendar.mode must be one of ${CALENDAR_MODES.join(", ")}.`);
  if (
    calendar.initialDate !== undefined &&
    parseDay(calendar.initialDate) === null
  )
    fail("calendar.initialDate must be a YYYY-MM-DD date.");
  if (
    calendar.weekStartsOn !== undefined &&
    ![0, 1].includes(calendar.weekStartsOn)
  )
    fail("calendar.weekStartsOn must be 0 (Sunday) or 1 (Monday).");
  if (
    calendar.weeks !== undefined &&
    (!Number.isInteger(calendar.weeks) ||
      calendar.weeks < 1 ||
      calendar.weeks > MAX_HEATMAP_WEEKS)
  )
    fail(`calendar.weeks must be an integer from 1 to ${MAX_HEATMAP_WEEKS}.`);
  for (const key of Object.keys(calendar))
    if (
      ![
        "dateColumn",
        "endDateColumn",
        "startTimeColumn",
        "endTimeColumn",
        "colorColumn",
        "doneColumn",
        "contextColumn",
        "mode",
        "initialDate",
        "weekStartsOn",
        "weeks",
      ].includes(key)
    )
      fail(`calendar.${key} is not a supported setting.`);
}

function validateViews(views, columns) {
  if (
    !Array.isArray(views) ||
    views.length < 1 ||
    views.length > MAX_DATABASE_VIEWS
  )
    fail(`views must be an array of 1 to ${MAX_DATABASE_VIEWS} views.`);
  const seen = new Set();
  const reference = (value, path) => {
    if (typeof value !== "string" || value.length > 200)
      fail(`${path} must be a column id, at most 200 characters.`);
  };
  for (const [index, view] of views.entries()) {
    const path = `views[${index}]`;
    if (!isObject(view)) fail(`${path} must be an object.`);
    for (const key of Object.keys(view))
      if (
        ![
          "id",
          "name",
          "type",
          "groupBy",
          "sort",
          "sorts",
          "filter",
          "columnWidths",
        ].includes(key)
      )
        fail(`${path}.${key} is not a supported setting.`);
    if (typeof view.id !== "string" || !ID.test(view.id))
      fail(`${path}.id must be letters, digits, _ or -, at most 128.`);
    if (seen.has(view.id)) fail(`views contains duplicate id ${view.id}.`);
    seen.add(view.id);
    if (
      typeof view.name !== "string" ||
      !view.name.trim() ||
      view.name.length > 200
    )
      fail(`${path}.name must be non-empty text, at most 200 characters.`);
    if (!DATABASE_VIEWS.includes(view.type))
      fail(`${path}.type must be one of ${DATABASE_VIEWS.join(", ")}.`);
    if (view.groupBy !== undefined) reference(view.groupBy, `${path}.groupBy`);
    if (view.sort !== undefined && view.sort !== null) {
      if (
        !isObject(view.sort) ||
        Object.keys(view.sort).some(
          (key) => key !== "column" && key !== "direction",
        ) ||
        !["asc", "desc"].includes(view.sort.direction)
      )
        fail(`${path}.sort must be {column, direction: asc|desc} or null.`);
      reference(view.sort.column, `${path}.sort.column`);
    }
    if (view.filter !== undefined)
      validateFilter(
        view.filter,
        `${path}.filter`,
        columns.filter((column) => column.type !== "custom"),
      );
    if (view.sorts !== undefined) validateSorts(view.sorts, `${path}.sorts`);
    if (view.columnWidths !== undefined) {
      if (!isObject(view.columnWidths))
        fail(`${path}.columnWidths must map column ids to widths.`);
      const entries = Object.entries(view.columnWidths);
      if (entries.length > 50)
        fail(`${path}.columnWidths names at most 50 columns.`);
      for (const [column, width] of entries)
        if (
          !Number.isInteger(width) ||
          width < MIN_COLUMN_WIDTH ||
          width > MAX_COLUMN_WIDTH
        )
          fail(
            `${path}.columnWidths.${column} must be an integer from ${MIN_COLUMN_WIDTH} to ${MAX_COLUMN_WIDTH}.`,
          );
    }
  }
}

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const keysOnly = (value, allowed, path) => {
  for (const key of Object.keys(value))
    if (!allowed.includes(key))
      fail(`${path}.${key} is not a supported setting.`);
};
/** Settings that belong to one column type: options, relation, formula, rollup, component. */
function validateColumnConfig(column, columns, path) {
  const only = (key, types) => {
    if (column[key] !== undefined && !types.includes(column.type))
      fail(`${path}.${key} only belongs to ${types.join(" or ")} columns.`);
  };
  only("colors", ["select", "multiSelect"]);
  only("relation", ["relation"]);
  only("formula", ["formula"]);
  only("rollup", ["rollup"]);
  only("component", ["custom"]);
  only("config", ["custom"]);
  if (column.colors !== undefined) {
    if (!isRecord(column.colors) || Object.keys(column.colors).length > 200)
      fail(`${path}.colors must map options to tones.`);
    for (const [option, tone] of Object.entries(column.colors))
      if (!OPTION_TONES.includes(tone))
        fail(
          `${path}.colors.${option} must be one of ${OPTION_TONES.join(", ")}.`,
        );
  }
  if (column.type === "relation") {
    const relation = column.relation;
    if (!isRecord(relation))
      fail(`${path}.relation must be {dataset, project?, reverse?}.`);
    keysOnly(
      relation,
      ["dataset", "project", "reverse", "reverseOf"],
      `${path}.relation`,
    );
    if (typeof relation.dataset !== "string" || !ID.test(relation.dataset))
      fail(`${path}.relation.dataset must be a dataset id.`);
    if (
      relation.project !== undefined &&
      (typeof relation.project !== "string" || !ID.test(relation.project))
    )
      fail(`${path}.relation.project must be a project id.`);
    if (relation.reverse !== undefined) {
      if (!isRecord(relation.reverse))
        fail(`${path}.relation.reverse must be {name?}.`);
      keysOnly(relation.reverse, ["name"], `${path}.relation.reverse`);
      if (
        relation.reverse.name !== undefined &&
        (typeof relation.reverse.name !== "string" ||
          relation.reverse.name.length > 1000)
      )
        fail(`${path}.relation.reverse.name must be text.`);
    }
    if (
      relation.reverseOf !== undefined &&
      (typeof relation.reverseOf !== "string" ||
        relation.reverseOf.length > 200)
    )
      fail(`${path}.relation.reverseOf must be a column id.`);
  }
  if (column.type === "formula") {
    const formula = column.formula;
    if (
      !isRecord(formula) ||
      typeof formula.expression !== "string" ||
      formula.expression.length > 4000
    )
      fail(
        `${path}.formula must be {expression, kind?} with an expression of at most 4000 characters.`,
      );
    keysOnly(formula, ["expression", "kind"], `${path}.formula`);
    if (formula.kind !== undefined && !VALUE_KINDS.includes(formula.kind))
      fail(`${path}.formula.kind must be one of ${VALUE_KINDS.join(", ")}.`);
  }
  if (column.type === "rollup") {
    const rollup = column.rollup;
    if (!isRecord(rollup))
      fail(`${path}.rollup must be {relation, column?, aggregate}.`);
    keysOnly(rollup, ["relation", "column", "aggregate"], `${path}.rollup`);
    if (
      !columns.some(
        (item) => item.id === rollup.relation && item.type === "relation",
      )
    )
      fail(`${path}.rollup.relation must name a relation column.`);
    if (
      rollup.column !== undefined &&
      (typeof rollup.column !== "string" || rollup.column.length > 200)
    )
      fail(`${path}.rollup.column must be a column id of the related records.`);
    if (!ROLLUP_AGGREGATES.includes(rollup.aggregate))
      fail(
        `${path}.rollup.aggregate must be one of ${ROLLUP_AGGREGATES.join(", ")}.`,
      );
    if (rollup.aggregate !== "count" && rollup.column === undefined)
      fail(`${path}.rollup.column is required for ${rollup.aggregate}.`);
  }
  if (column.type === "custom") {
    const component = column.component;
    if (
      !isRecord(component) ||
      typeof component.componentId !== "string" ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(component.componentId) ||
      typeof component.version !== "string" ||
      component.version.length > 100
    )
      fail(
        `${path}.component must be {componentId, version, integrity?, scope?} of a field type component.`,
      );
    keysOnly(
      component,
      ["componentId", "version", "integrity", "scope"],
      `${path}.component`,
    );
    if (
      component.integrity !== undefined &&
      (typeof component.integrity !== "string" ||
        !/^sha256-[a-f0-9]{64}$/.test(component.integrity))
    )
      fail(`${path}.component.integrity must be a sha256 fingerprint.`);
    if (column.config !== undefined && !isRecord(column.config))
      fail(`${path}.config must be an object.`);
  }
}

/** Validate database data; old data without date columns, page columns or views stays valid. */
export function validateDatabaseData(data) {
  if (!isObject(data)) fail("Component data must be an object.");
  for (const key of ["title", "description", "groupBy"])
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "string" || data[key].length > 10000)
    )
      fail(`${key} must be text, at most 10000 characters.`);
  const list = (key, limit) => {
    if (data[key] === undefined) return [];
    if (!Array.isArray(data[key]) || data[key].length > limit)
      fail(`${key} must be an array of at most ${limit} items.`);
    const seen = new Set();
    for (const [index, item] of data[key].entries()) {
      if (!isObject(item)) fail(`${key}[${index}] must be an object.`);
      if (typeof item.id !== "string" || !item.id || item.id.length > 200)
        fail(`${key}[${index}].id must be non-empty text.`);
      if (seen.has(item.id)) fail(`${key} contains duplicate id ${item.id}.`);
      if (reservedIds.has(item.id) && (key === "columns" || item.id !== "id"))
        fail(`${key}[${index}].id cannot use the reserved name ${item.id}.`);
      seen.add(item.id);
    }
    return data[key];
  };
  const columns = list("columns", 50);
  for (const [index, column] of columns.entries()) {
    const path = `columns[${index}]`;
    if (typeof column.name !== "string" || column.name.length > 1000)
      fail(`${path}.name must be text, at most 1000 characters.`);
    if (!DATABASE_COLUMN_TYPES.includes(column.type))
      fail(`${path}.type must be one of ${DATABASE_COLUMN_TYPES.join(", ")}.`);
    if (
      column.options !== undefined &&
      (!Array.isArray(column.options) ||
        column.options.length > 200 ||
        !column.options.every((value) => typeof value === "string"))
    )
      fail(`${path}.options must be an array of at most 200 texts.`);
    if (
      column.folder !== undefined &&
      (column.type !== "page" ||
        typeof column.folder !== "string" ||
        !ID.test(column.folder))
    )
      fail(`${path}.folder is a folder id and only belongs to page columns.`);
    if (
      column.titleColumn !== undefined &&
      (column.type !== "page" ||
        !columns.some(
          (item) => item.id === column.titleColumn && item.type === "text",
        ))
    )
      fail(
        `${path}.titleColumn only belongs to page columns and names a text column.`,
      );
    validateColumnConfig(column, columns, path);
  }
  const listColumns = new Set(
    columns.filter((column) => LIST_TYPES.has(column.type)).map((c) => c.id),
  );
  const checked = columns.filter(
    (column) =>
      column.type === "date" ||
      column.type === "page" ||
      LIST_TYPES.has(column.type),
  );
  const dateColumns = columns.filter((column) => column.type === "date");
  for (const [index, row] of list("rows", 5000).entries()) {
    for (const [key, value] of Object.entries(row))
      if (
        !["string", "number", "boolean"].includes(typeof value) &&
        !(
          listColumns.has(key) &&
          Array.isArray(value) &&
          value.length <= 1000 &&
          value.every((item) => typeof item === "string" && item.length <= 1000)
        )
      )
        fail(
          listColumns.has(key)
            ? `rows[${index}].${key} must be a list of texts, text, a number or a boolean.`
            : `rows[${index}].${key} must be text, a number or a boolean.`,
        );
    for (const column of checked) {
      if (column.type === "custom") continue;
      const issue = valueTypeOf(column).check(row[column.id], column);
      if (issue)
        fail(
          column.type === "date"
            ? `rows[${index}].${column.id} must be a YYYY-MM-DD date or empty.`
            : column.type === "page"
              ? `rows[${index}].${column.id} must be a showai://project/PROJECT/page/PAGE link or empty.`
              : `rows[${index}].${column.id} ${issue}`,
        );
    }
  }
  if (data.views !== undefined) validateViews(data.views, columns);
  if (data.view !== undefined && !DATABASE_VIEWS.includes(data.view))
    fail(`view must be one of ${DATABASE_VIEWS.join(", ")}.`);
  if (data.calendar !== undefined) validateCalendar(data.calendar, columns);
  if (data.view === "calendar" && !dateColumns.length)
    fail("view calendar requires a date column.");
  return data;
}

/**
 * Turn rows into dated entries. Rows without a valid start date are skipped; an
 * end date before the start, or a span past MAX_SPAN_DAYS, collapses to one day.
 */
export function calendarEntries(rows, settings) {
  const entries = [];
  for (const row of rows) {
    const start = parseDay(row[settings.dateColumn]);
    if (start === null) continue;
    let end = settings.endDateColumn
      ? parseDay(row[settings.endDateColumn])
      : null;
    if (end === null || end < start || end - start >= MAX_SPAN_DAYS)
      end = start;
    const startMinute = settings.startTimeColumn
      ? parseTime(row[settings.startTimeColumn])
      : null;
    let endMinute =
      startMinute !== null && settings.endTimeColumn
        ? parseTime(row[settings.endTimeColumn])
        : null;
    if (endMinute !== null && endMinute <= startMinute) endMinute = null;
    entries.push({
      row,
      start,
      end,
      startMinute,
      endMinute,
      done: settings.doneColumn ? row[settings.doneColumn] === true : false,
    });
  }
  return entries.sort(
    (a, b) =>
      a.start - b.start ||
      (a.startMinute ?? -1) - (b.startMinute ?? -1) ||
      b.end - a.end,
  );
}

/** Entries overlapping each day of [from, to], keyed by day number. */
export function entriesByDay(entries, from, to) {
  const days = new Map();
  for (let day = from; day <= to; day += 1) days.set(day, []);
  for (const entry of entries)
    for (
      let day = Math.max(from, entry.start);
      day <= Math.min(to, entry.end);
      day += 1
    )
      days.get(day).push(entry);
  return days;
}

/** Assign side-by-side lanes to timed entries of one day so overlaps stay readable. */
export function timeLanes(entries) {
  const lanes = [];
  const placed = entries
    .filter((entry) => entry.startMinute !== null)
    .map((entry) => {
      const end = entry.endMinute ?? Math.min(1440, entry.startMinute + 60);
      let lane = lanes.findIndex((laneEnd) => laneEnd <= entry.startMinute);
      if (lane < 0) lane = lanes.push(end) - 1;
      else lanes[lane] = end;
      return { entry, lane, end };
    });
  return { placed, laneCount: Math.max(1, lanes.length) };
}

/**
 * Heatmap of N whole weeks ending with the week of `endDay`. With a done column
 * only checked records count. Streaks count consecutive active days ending at
 * `today` — the reference day, normally the reader's date — or the day before
 * while that day is still open, within the window.
 */
export function heatmapSummary(entries, options) {
  const weekStartsOn = options.weekStartsOn ?? 1;
  const weeks = options.weeks ?? 12;
  const from = startOfWeek(options.endDay, weekStartsOn) - (weeks - 1) * 7;
  const to = from + weeks * 7 - 1;
  const counted = options.countDone
    ? entries.filter((entry) => entry.done)
    : entries;
  const byDay = entriesByDay(counted, from, to);
  const cells = [];
  let max = 0;
  for (let day = from; day <= to; day += 1) {
    const count = byDay.get(day).length;
    max = Math.max(max, count);
    cells.push({ day, count });
  }
  for (const cell of cells)
    cell.level = cell.count
      ? Math.max(1, Math.ceil((cell.count / max) * 4))
      : 0;
  const last = Math.min(to, options.today);
  let longest = 0,
    run = 0,
    activeDays = 0;
  for (let day = from; day <= last; day += 1) {
    const active = byDay.get(day).length > 0;
    if (active) activeDays += 1;
    run = active ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  let current = 0;
  let day = last;
  if (day >= from && day === options.today && !byDay.get(day).length) day -= 1;
  for (; day >= from && byDay.get(day).length; day -= 1) current += 1;
  return {
    from,
    to,
    cells,
    max,
    current,
    longest,
    activeDays,
    elapsedDays: Math.max(0, last - from + 1),
  };
}
