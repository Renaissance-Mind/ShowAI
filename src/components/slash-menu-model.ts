/**
 * Rows of the insert (slash) menus. Without a query the menu opens with the
 * recently inserted items, keeps rarely used entries out of view and folds
 * chart types into one entry with its own level; a query searches everything.
 */
export interface SlashEntry {
  /** Stable across menus: the same component has the same id everywhere. */
  id: string;
  title: string;
  keywords: string;
  group: string;
  /** Reached by typing only. */
  hidden?: boolean;
  /** Listed on the chart level instead of the first one. */
  chart?: boolean;
}

export type SlashLevel = "root" | "charts";

export type SlashRow<T extends SlashEntry> =
  | { type: "item"; key: string; group: string; item: T }
  | { type: "charts"; key: "charts"; group: string };

export const RECENT_LIMIT = 5;
const RECENT_PREFERENCE = "showai:slash-recent";

export function slashMenuRows<T extends SlashEntry>(
  items: readonly T[],
  options: {
    query: string;
    level: SlashLevel;
    recent: readonly string[];
    labels: { recent: string; charts: string };
  },
): SlashRow<T>[] {
  const row = (item: T, group = item.group, prefix = ""): SlashRow<T> => ({
    type: "item",
    key: prefix + item.id,
    group,
    item,
  });
  const query = options.query.trim().toLowerCase();
  if (query)
    return items
      .filter((item) =>
        `${item.title} ${item.keywords}`.toLowerCase().includes(query),
      )
      .map((item) => row(item));
  if (options.level === "charts")
    return items
      .filter((item) => item.chart)
      .map((item) => row(item, options.labels.charts));
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows: SlashRow<T>[] = options.recent
    .map((id) => byId.get(id))
    .filter((item): item is T => !!item)
    .slice(0, RECENT_LIMIT)
    .map((item) => row(item, options.labels.recent, "recent:"));
  let charts = false;
  for (const item of items) {
    if (item.hidden) continue;
    if (!item.chart) rows.push(row(item));
    else if (!charts) {
      charts = true;
      rows.push({ type: "charts", key: "charts", group: item.group });
    }
  }
  return rows;
}

/** The @ menu keeps its own recent list. */
export const RECENT_MENTIONS = "showai:mention-recent";

/** Ids of recently inserted items, most recent first. */
export function readRecentSlashItems(
  storage: Pick<Storage, "getItem">,
  key = RECENT_PREFERENCE,
) {
  return (storage.getItem(key) ?? "")
    .split("\n")
    .filter(Boolean)
    .slice(0, RECENT_LIMIT);
}

export function rememberSlashItem(
  storage: Storage,
  id: string,
  key = RECENT_PREFERENCE,
) {
  const next = [
    id,
    ...readRecentSlashItems(storage, key).filter((value) => value !== id),
  ].slice(0, RECENT_LIMIT);
  storage.setItem(key, next.join("\n"));
  return next;
}

/** Built-in chart kinds: the generic chart and every G2 chart type. */
export function isChartKind(kind: string) {
  return kind === "chart" || kind.startsWith("g2-");
}

/** The catalog fields an insert-menu row is made from. */
export type SlashComponent = { name: string; description: string } & (
  | { kind: string }
  | { kind?: undefined; id: string; version: string; integrity: string }
);

/**
 * Whether a catalog component is offered as a block by the insert menus and
 * quick jump. Components that fill another slot (the page outline, the @ menu
 * inside a line) are placed by that slot instead.
 */
export function insertsAsBlock(item: {
  kind?: string;
  role?: string;
  mention?: unknown;
}) {
  return !item.mention && (item.kind !== undefined || item.role !== "page-outline");
}

/**
 * The insert-menu row of one catalog component. The page and board insert
 * menus and quick jump all list components through it, so a component has
 * one id, title and set of keywords everywhere and recent items are shared.
 */
export function componentSlashEntry<T extends SlashComponent>(
  item: T,
  group: string,
  display: { name: (item: T) => string; description: (item: T) => string },
): SlashEntry & { component: T } {
  const id = item.kind !== undefined ? item.kind : item.id;
  return {
    id:
      "catalog:" +
      (item.kind !== undefined
        ? item.kind
        : `${item.id}@${item.version}#${item.integrity}`),
    title: display.name(item),
    keywords: `${item.name} ${item.description} ${display.description(item)} ${id}`,
    group,
    chart: item.kind !== undefined && isChartKind(item.kind),
    component: item,
  };
}

/**
 * Asks the rich-text editor that holds focus to insert a resolved catalog
 * component at its caret, exactly as its "/" menu does. The editor calls
 * preventDefault when it took the request.
 */
export const INSERT_COMPONENT_EVENT = "showai:insert-component";
export interface InsertComponentDetail<C = unknown> {
  kind: string;
  data: Record<string, unknown>;
  /** A native container or primitive the host inserts as its own node. */
  native: boolean;
  component?: C;
  /** Where in the editor: its caret (default) or the end of its content. */
  at?: "selection" | "end";
}
