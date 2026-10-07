import { FileText } from "../ui/icons";
import type { PageSummary, ProjectSummary } from "../core/model";

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
  const term = query.trim().toLocaleLowerCase();
  const visible = pages.filter((page) =>
    `${page.title} ${page.projectName}`.toLocaleLowerCase().includes(term),
  );
  if (!visible.length)
    return (
      <div className="studio-empty">
        <FileText size={34} strokeWidth={1.2} />
        <h2>{term ? "没有找到页面" : "暂无最近编辑的页面"}</h2>
        <p>
          {term
            ? "试试页面名称或项目名称。"
            : "创建或编辑页面后，会显示在这里。"}
        </p>
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
            <time dateTime={page.updatedAt}>
              {new Intl.DateTimeFormat("zh-CN", {
                month: "short",
                day: "numeric",
              }).format(new Date(page.updatedAt))}
            </time>
          </button>
        </div>
      ))}
    </div>
  );
}
