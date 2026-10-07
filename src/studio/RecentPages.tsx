import { useEffect, useState } from "react";
import { FileText } from "../ui/icons";
import type { PageSummary, ProjectSummary } from "../core/model";

const absoluteTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function recentTime(value: string, now: number): string {
  const date = new Date(value);
  const elapsed = Math.max(0, now - date.getTime());
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed >= 3 * day) return absoluteTime.format(date);
  if (elapsed >= day) return `${Math.floor(elapsed / day)} 天前`;
  if (elapsed >= hour) return `${Math.floor(elapsed / hour)} 小时前`;
  if (elapsed >= minute) return `${Math.floor(elapsed / minute)} 分钟前`;
  return "刚刚";
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
  onCreateProject,
}: {
  pages: RecentPage[];
  query: string;
  onOpen: (page: RecentPage) => void;
  onCreateProject: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const term = query.trim().toLocaleLowerCase();
  const visible = pages.filter((page) =>
    `${page.title} ${page.projectName}`.toLocaleLowerCase().includes(term),
  );
  if (!visible.length)
    return (
      <div className="studio-empty">
        <FileText size={34} strokeWidth={1.2} />
        <h2>{term ? "没有找到页面" : "暂无最近编辑的页面"}</h2>
        {!term && (
          <button className="studio-button primary" onClick={onCreateProject}>
            新建项目
          </button>
        )}
      </div>
    );
  return (
    <div
      className="studio-page-list studio-recent-pages"
      aria-label="最近编辑的页面"
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
            onClick={() => onOpen(page)}
          >
            <span className="studio-page-list-icon" aria-hidden="true">
              {page.icon || <FileText size={19} />}
            </span>
            <span className="studio-recent-page-details">
              <strong>{page.title || "无标题"}</strong>
              <span className="studio-recent-page-project">
                {page.projectName}
              </span>
            </span>
            <time
              dateTime={page.updatedAt}
              title={absoluteTime.format(new Date(page.updatedAt))}
            >
              {recentTime(page.updatedAt, now)}
            </time>
          </button>
        </div>
      ))}
    </div>
  );
}
