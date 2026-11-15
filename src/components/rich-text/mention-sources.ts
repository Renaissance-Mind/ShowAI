import type { CatalogComponent } from "../../core/component-categories";
import type { SlashEntry } from "../slash-menu-model";
import type { LinkablePage } from "./environment";
import { pageLink } from "../../document/page-link.mjs";
import { rankByTitle } from "../title-match";
import { isoDay, typedDays } from "../../portable/mention-contract.mjs";
import type { MentionContract } from "../../contract/contributions";

export type MentionInsertion =
  | { type: "link"; href: string; text: string }
  | {
      type: "component";
      component: CatalogComponent;
      prop: string;
      value: string;
    };

export interface MentionEntry {
  id: string;
  title: string;
  keywords: string;
  detail?: string;
  insertion: MentionInsertion;
}

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
export function registerMentionSource(source: MentionSource) {
  registered.set(source.id, source);
  return () => {
    if (registered.get(source.id) === source) registered.delete(source.id);
  };
}

const PAGE_LIMIT = { recent: 8, matches: 20 };
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
