// Sources of the @ menu in rich text. Pages are the one source the editor
// owns; every component whose contract declares `contributes.mention` becomes a source,
// and hosts can register more. The menu itself is the slash menu with a
// second trigger.

import type { CatalogComponent } from "../../core/component-categories";
import type { SlashEntry } from "../slash-menu-model";
import type { LinkablePage } from "./environment";
import { pageLink } from "../../portable/page-link.mjs";
import { rankByTitle } from "../title-match";
import { isoDay, typedDays } from "../../portable/mention-contract.mjs";
import type { MentionContract } from "../custom/contributions";

/** What choosing an entry puts at the @: a page link, or a component in the line. */
export type MentionInsertion =
  | { type: "link"; href: string; text: string }
  | {
      type: "component";
      component: CatalogComponent;
      /** The top-level prop that receives `value`. */
      prop: string;
      value: string;
    };

export interface MentionEntry {
  /** Stable across openings, for the recent list. */
  id: string;
  title: string;
  keywords: string;
  /** A short second line, such as a formatted date. */
  detail?: string;
  insertion: MentionInsertion;
}

/** Everything a source may look at; it never reads the editor itself. */
export interface MentionContext {
  query: string;
  projectId?: string;
  pageId?: string;
  pages: readonly LinkablePage[];
  components: readonly CatalogComponent[];
  locale: string;
  today: Date;
  labels: { pages: string; today: string; tomorrow: string; yesterday: string };
  displayName(component: CatalogComponent): string;
}

export interface MentionSource {
  id: string;
  label(context: MentionContext): string;
  search(context: MentionContext): MentionEntry[];
}

const registered = new Map<string, MentionSource>();
/** Adds a source to every @ menu; returns its removal. */
export function registerMentionSource(source: MentionSource) {
  registered.set(source.id, source);
  return () => {
    if (registered.get(source.id) === source) registered.delete(source.id);
  };
}

const PAGE_LIMIT = { recent: 8, matches: 20 };
/**
 * Pages of the project ranked as quick jump ranks them (recently changed
 * first without a query); never the page being edited.
 */
export const pageMentionSource: MentionSource = {
  id: "pages",
  label: (context) => context.labels.pages,
  search(context) {
    const query = context.query.trim();
    const projectId = context.projectId;
    if (!projectId) return [];
    return rankByTitle(
      context.pages.filter((page) => page.id !== context.pageId),
      query,
      { title: (page) => page.title, updatedAt: (page) => page.updatedAt },
      query ? PAGE_LIMIT.matches : PAGE_LIMIT.recent,
    ).map((page) => ({
        id: `page:${projectId}/${page.id}`,
        title: page.title,
        keywords: page.id,
        insertion: {
          type: "link",
          href: pageLink({ projectId, pageId: page.id }),
          text: page.title,
        },
      }));
  },
};

function formatDay(day: string, locale: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, date)));
}

/** The source a component's `contributes.mention` describes. */
export function componentMentionSource(
  component: CatalogComponent,
  contract: MentionContract,
): MentionSource {
  const key =
    "kind" in component
      ? component.kind
      : `${component.id}@${component.version}#${component.integrity}`;
  const entry = (
    value: string,
    title: string,
    keywords: string,
    detail?: string,
  ): MentionEntry => ({
    id: `component:${key}:${value}`,
    title,
    keywords,
    ...(detail ? { detail } : {}),
    insertion: { type: "component", component, prop: contract.prop, value },
  });
  return {
    id: `component:${key}`,
    label: (context) => context.displayName(component),
    search(context) {
      const query = context.query.trim();
      const entries: MentionEntry[] = [];
      if (contract.input === "date") {
        const day = (offset: number) => {
          const date = new Date(context.today);
          date.setDate(date.getDate() + offset);
          return isoDay(date);
        };
        const relative: [string, number, string][] = [
          [context.labels.today, 0, "today"],
          [context.labels.tomorrow, 1, "tomorrow"],
          [context.labels.yesterday, -1, "yesterday"],
        ];
        for (const [label, offset, word] of relative)
          entries.push(
            entry(
              day(offset),
              label,
              `${word} ${day(offset)}`,
              formatDay(day(offset), context.locale),
            ),
          );
        const listed = new Set(relative.map(([, offset]) => day(offset)));
        for (const typed of typedDays(query, context.today))
          if (!listed.has(typed))
            entries.push(
              entry(typed, formatDay(typed, context.locale), `${query} ${typed}`),
            );
      } else if (contract.input === "text" && query)
        entries.push(entry(query, query, query));
      for (const option of contract.options ?? [])
        entries.push(
          entry(
            option.value,
            option.label,
            [option.value, ...(option.keywords ?? [])].join(" "),
          ),
        );
      return entries;
    },
  };
}

/** Rows for the @ menu: pages, component sources, then registered sources. */
export function mentionEntries(
  context: MentionContext,
): (SlashEntry & { entry: MentionEntry })[] {
  const sources = [
    pageMentionSource,
    ...context.components.flatMap((component) =>
      component.contributes?.mention
        ? [componentMentionSource(component, component.contributes.mention)]
        : [],
    ),
    ...registered.values(),
  ];
  return sources.flatMap((source) => {
    const group = source.label(context);
    return source.search(context).map((entry) => ({
      id: entry.id,
      title: entry.title,
      keywords: entry.keywords,
      group,
      entry,
    }));
  });
}
