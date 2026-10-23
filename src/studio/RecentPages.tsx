import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import PageIcon from "../components/PageIcon";
import { FileText } from "../ui/icons";
import type { PageSummary, ProjectSummary } from "../core/model";
import type { LibraryMenuPoint } from "./LibraryNavigation";
import { getLocale, translator } from "../i18n";
import { useTranslator } from "../i18n/react";
import commonMessages from "../i18n/messages/common";
import sidebarMessages from "../i18n/messages/sidebar";
import { writerName } from "./external-change";
import "./external-change.css";

const translate = translator(sidebarMessages);
const absoluteTimeFormats = new Map<string, Intl.DateTimeFormat>();

function formatAbsoluteTime(date: Date): string {
  const locale = getLocale();
  let format = absoluteTimeFormats.get(locale);
  if (!format)
    absoluteTimeFormats.set(
      locale,
      (format = new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })),
    );
  return format.format(date);
}

function recentTime(value: string, now: number): string {
  const date = new Date(value);
  const elapsed = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed >= 3 * day) return formatAbsoluteTime(date);
  if (elapsed >= day)
    return translate("daysAgo", { count: Math.floor(elapsed / day) });
  if (elapsed >= hour)
    return translate("hoursAgo", { count: Math.floor(elapsed / hour) });
  if (elapsed >= minute)
    return translate("minutesAgo", { count: Math.floor(elapsed / minute) });
  return translate("justNow");
}

export type RecentPage = PageSummary & {
  projectId: string;
  projectName: string;
};

export function recentPages(
  projects: ProjectSummary[],
  contents: Record<string, { pages: PageSummary[] }>,
): RecentPage[] {
  return projects
    .filter((project) => !project.archived)
    .flatMap((project) =>
      (contents[project.id]?.pages ?? [])
        .filter((page) => !page.archived)
        .map((page) => ({
          ...page,
          projectId: project.id,
          projectName: project.name,
        })),
    )
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.projectId.localeCompare(b.projectId) ||
        a.id.localeCompare(b.id),
    );
}

export default function RecentPages({
  pages,
  query,
  onOpen,
  onMenu,
  onCreateProject,
  welcome,
}: {
  pages: RecentPage[];
  query: string;
  /** First-run content shown instead of the list until the library has pages of its own. */
  welcome?: ReactNode;
  onOpen: (page: RecentPage, event: MouseEvent<HTMLButtonElement>) => void;
  onMenu: (
    page: RecentPage,
    anchor: HTMLElement,
    point?: LibraryMenuPoint,
  ) => void;
  onCreateProject: () => void;
}) {
  const t = useTranslator(sidebarMessages);
  const tc = useTranslator(commonMessages);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const term = query.trim().toLocaleLowerCase();
  const visible = pages.filter((page) =>
    `${page.title} ${page.projectName}`.toLocaleLowerCase().includes(term),
  );
  if (welcome && !term) return <>{welcome}</>;
  if (!visible.length)
    return (
      <div className="studio-empty">
        <FileText size={34} strokeWidth={1.2} />
        <h2>{term ? t("noMatchingPages") : t("noRecentPages")}</h2>
        {!term && (
          <button className="studio-button primary" onClick={onCreateProject}>
            {t("createProject")}
          </button>
        )}
      </div>
    );
  return (
    <div
      className="studio-page-list studio-recent-pages"
      aria-label={t("recentPages")}
    >
      {visible.map((page) => (
        <div
          key={`${page.projectId}:${page.id}`}
          className="studio-page-list-row"
          data-recent-page={page.id}
          data-project-id={page.projectId}
        >
          <button
            className="studio-page-list-open"
            onClick={(event) => onOpen(page, event)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onOpen(page, event);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              onMenu(page, event.currentTarget, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
            onKeyDown={(event) => {
              if (
                event.key === "ContextMenu" ||
                (event.shiftKey && event.key === "F10")
              ) {
                event.preventDefault();
                onMenu(page, event.currentTarget);
              }
            }}
          >
            <span className="studio-page-list-icon" aria-hidden="true">
              <PageIcon value={page.icon} size={19} />
            </span>
            <span className="studio-recent-page-details">
              <strong>
                {page.title || tc("untitled")}
                {page.agentCreated && (
                  <span
                    className="agent-created-mark"
                    title={t("agentCreatedBy", {
                      name: page.agentCreated.label
                        ? writerName(page.agentCreated.label)
                        : "Agent",
                    })}
                  >
                    {t("agentCreated")}
                  </span>
                )}
              </strong>
              <span className="studio-recent-page-project">
                {page.projectName}
              </span>
            </span>
            <time
              dateTime={page.updatedAt}
              title={formatAbsoluteTime(new Date(page.updatedAt))}
            >
              {recentTime(page.updatedAt, now)}
            </time>
          </button>
        </div>
      ))}
    </div>
  );
}
