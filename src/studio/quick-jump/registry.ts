/**
 * Quick jump (⌘K / Ctrl+K) lists results from sources. A source finds its own
 * candidates and runs the one the person picks; ranking, limits and grouping
 * happen here, once, for every source.
 */
import { titleScore } from "../../components/title-match";

export type QuickJumpIcon =
  | "page"
  | "board"
  | "folder"
  | "project"
  | "content"
  | "command"
  | "component";

export interface QuickJumpItem<D = unknown> {
  /** Unique within its source. */
  key: string;
  /** What the row opens, e.g. `page:PROJECT/PAGE`; shown once across sources. */
  identity?: string;
  title: string;
  /** Project and folder path of a page or folder: the only secondary text. */
  path?: string;
  /** Matched after the title, never shown. */
  keywords?: string;
  /** ISO time. With an empty query the most recent come first. */
  updatedAt?: string;
  /** A key chord as keyboard-shortcuts.ts writes it, e.g. `Mod+\\`. */
  shortcut?: string;
  icon: QuickJumpIcon;
  /** A page or folder emoji, shown instead of the icon. */
  emoji?: string;
  disabled?: boolean;
  data: D;
}

export interface QuickJumpSource<C, D = unknown> {
  id: string;
  label: (context: C) => string;
  /**
   * Candidates for a query. Sources return everything they offer (or, with
   * `matched`, results already matched elsewhere); the registry filters.
   */
  search: (
    query: string,
    context: C,
  ) => readonly QuickJumpItem<D>[] | Promise<readonly QuickJumpItem<D>[]>;
  run: (item: QuickJumpItem<D>, context: C) => void | Promise<unknown>;
  /** Rows listed with a query; default 6. */
  limit?: number;
  /** Rows listed with an empty query (most recent first); default 0. */
  emptyLimit?: number;
  /**
   * The source matched its results itself (the full-text index); they keep
   * their order and rank after every title match.
   */
  matched?: boolean;
}

export interface QuickJumpRow<D = unknown> {
  source: string;
  item: QuickJumpItem<D>;
  score: number;
}

export interface QuickJumpGroup<D = unknown> {
  source: string;
  label: string;
  rows: QuickJumpRow<D>[];
}

export { termScore } from "../../components/title-match";

/** Every term must match the title or the keywords; the title counts more. */
export function itemScore(query: string, item: QuickJumpItem<unknown>): number {
  return titleScore(query, item.title, item.keywords);
}

const newest = (a: QuickJumpItem<unknown>, b: QuickJumpItem<unknown>) =>
  (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/** Ranks one source's candidates and keeps its share of the list. */
export function rankSource<C, D>(
  source: QuickJumpSource<C, D>,
  query: string,
  items: readonly QuickJumpItem<D>[],
): QuickJumpRow<D>[] {
  const empty = !query.trim();
  const limit = empty ? (source.emptyLimit ?? 0) : (source.limit ?? 6);
  if (!limit) return [];
  if (source.matched)
    return items
      .slice(0, limit)
      .map((item) => ({ source: source.id, item, score: 0 }));
  if (empty)
    return [...items]
      .sort(newest)
      .slice(0, limit)
      .map((item) => ({ source: source.id, item, score: 1 }));
  const rows: QuickJumpRow<D>[] = [];
  for (const item of items) {
    const score = itemScore(query, item);
    if (score) rows.push({ source: source.id, item, score });
  }
  rows.sort((a, b) => b.score - a.score || newest(a.item, b.item));
  return rows.slice(0, limit);
}

/**
 * Groups in a fixed, keyboard-reachable order: sources whose best match is
 * stronger come first (by hundreds, so close scores keep the source order),
 * and results matched by content follow every title match. A result whose
 * identity an earlier row already shows is left out.
 */
export function groupRows<C, D>(
  sources: readonly QuickJumpSource<C, D>[],
  ranked: ReadonlyMap<string, QuickJumpRow<D>[]>,
  context: C,
): QuickJumpGroup<D>[] {
  const shown = new Set<string>();
  return sources
    .map((source, order) => ({ source, order, rows: ranked.get(source.id) ?? [] }))
    .filter((entry) => entry.rows.length)
    .sort((a, b) => {
      const tier = (entry: typeof a) =>
        entry.source.matched ? -1 : Math.floor(entry.rows[0].score / 100);
      return tier(b) - tier(a) || a.order - b.order;
    })
    .map(({ source, rows }) => ({
      source: source.id,
      label: source.label(context),
      rows: rows.filter((row) => {
        const identity = row.item.identity;
        if (identity === undefined) return true;
        if (shown.has(identity)) return false;
        shown.add(identity);
        return true;
      }),
    }))
    .filter((group) => group.rows.length);
}

/** The rows in the order the arrow keys walk them. */
export function flattenGroups<D>(groups: readonly QuickJumpGroup<D>[]) {
  return groups.flatMap((group) => group.rows);
}

/**
 * The registered sources. Built-ins register at startup; anything else that
 * contributes results registers the same way and gets the same ranking.
 */
export class QuickJumpRegistry<C> {
  // Each source keeps its own item data type; the registry only passes it back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sources: QuickJumpSource<C, any>[] = [];

  constructor(sources: readonly QuickJumpSource<C, any>[] = []) {
    sources.forEach((source) => this.register(source));
  }

  register<D>(source: QuickJumpSource<C, D>): () => void {
    if (this.sources.some((item) => item.id === source.id))
      throw new Error(`Quick jump source ${source.id} is already registered.`);
    this.sources = [...this.sources, source];
    return () => {
      this.sources = this.sources.filter((item) => item !== source);
    };
  }

  list(): readonly QuickJumpSource<C, unknown>[] {
    return this.sources;
  }

  /**
   * Reports the synchronous results at once and again as each asynchronous
   * source settles. The returned function stops later reports.
   */
  search(
    query: string,
    context: C,
    report: (groups: QuickJumpGroup[]) => void,
    fail: (error: unknown) => void,
  ): () => void {
    let active = true;
    const sources = this.sources;
    const ranked = new Map<string, QuickJumpRow[]>();
    const publish = () => report(groupRows(sources, ranked, context));
    for (const source of sources) {
      const found = source.search(query, context);
      if (found instanceof Promise)
        found.then(
          (items) => {
            if (!active) return;
            ranked.set(source.id, rankSource(source, query, items));
            publish();
          },
          (error) => {
            if (active) fail(error);
          },
        );
      else ranked.set(source.id, rankSource(source, query, found));
    }
    publish();
    return () => {
      active = false;
    };
  }

  run(row: QuickJumpRow, context: C): void | Promise<unknown> {
    const source = this.sources.find((item) => item.id === row.source);
    if (!source) throw new Error(`Quick jump source ${row.source} is gone.`);
    return source.run(row.item, context);
  }
}
