import { titleScore } from "../../components/title-match";
import type { PageHoverPreviewTarget } from "../page-hover-preview";

export type QuickJumpIcon =
  | "page"
  | "board"
  | "folder"
  | "project"
  | "content"
  | "command"
  | "component";

export interface QuickJumpItem<D = unknown> {
  key: string;
  identity?: string;
  title: string;
  path?: string;
  keywords?: string;
  updatedAt?: string;
  shortcut?: string;
  icon: QuickJumpIcon;
  emoji?: string;
  disabled?: boolean;
  preview?: PageHoverPreviewTarget;
  data: D;
}

export interface QuickJumpSource<C, D = unknown> {
  id: string;
  label: (context: C) => string;
  search: (
    query: string,
    context: C,
  ) => readonly QuickJumpItem<D>[] | Promise<readonly QuickJumpItem<D>[]>;
  run: (item: QuickJumpItem<D>, context: C) => void | Promise<unknown>;
  limit?: number;
  emptyLimit?: number;
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

export function itemScore(query: string, item: QuickJumpItem<unknown>): number {
  return titleScore(query, item.title, item.keywords);
}

const newest = (a: QuickJumpItem<unknown>, b: QuickJumpItem<unknown>) =>
  (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

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

export function flattenGroups<D>(groups: readonly QuickJumpGroup<D>[]) {
  return groups.flatMap((group) => group.rows);
}

export class QuickJumpRegistry<C> {
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
