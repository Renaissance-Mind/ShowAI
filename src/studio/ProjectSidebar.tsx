import {
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
  type ReactNode,
} from "react";
import { ChevronDown, ChevronRight, MoreHorizontal, Plus } from "../ui/icons";
import type {
  ProjectGroup,
  ProjectSummary,
  SidebarOrganization,
} from "../core/model";
import { orderSidebarItems } from "../core/sidebar-order";
import { useLibraryDrag } from "./LibraryDrag";

export default function ProjectSidebar({
  projects,
  organization,
  selectedProject,
  collapsed,
  setCollapsed,
  renderProject,
  onCreate,
  onMenu,
  onGroupMenu,
}: {
  projects: ProjectSummary[];
  organization: SidebarOrganization;
  selectedProject: string | null;
  collapsed: Record<string, boolean>;
  setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
  renderProject: (project: ProjectSummary) => ReactNode;
  onCreate: (groupId?: string) => void;
  onMenu: (anchor: HTMLElement) => void;
  onGroupMenu: (group: ProjectGroup, anchor: HTMLElement) => void;
}) {
  const drag = useLibraryDrag();
  projects = orderSidebarItems(projects, organization.projectOrder);
  const selected = projects.find((item) => item.id === selectedProject);
  const selectedSection =
    selected && !selected.pinned
      ? (organization.projectGroups[selected.id] ?? null)
      : null;
  const previousSelection = useRef({ selectedProject, selectedSection });
  useEffect(() => {
    const previous = previousSelection.current;
    previousSelection.current = { selectedProject, selectedSection };
    if (
      selectedSection &&
      (previous.selectedProject !== selectedProject ||
        previous.selectedSection !== selectedSection)
    )
      setCollapsed((current) => ({ ...current, [selectedSection]: false }));
  }, [selectedProject, selectedSection, setCollapsed]);
  const toggle = (id: string) =>
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));
  const ungrouped = projects.filter(
    (item) => !item.pinned && !organization.projectGroups[item.id],
  );
  const pinned = projects.filter((item) => item.pinned);
  const section = (
    id: string,
    name: string,
    items: ProjectSummary[],
    group?: ProjectGroup,
  ) => (
    <section
      className="studio-project-section"
      key={id}
      data-project-section={id}
      aria-label={name}
    >
      <div
        className="studio-sidebar-label"
        {...drag?.section(id, () =>
          setCollapsed((current) => ({ ...current, [id]: false })),
        )}
      >
        {group ? (
          <button
            className="studio-section-toggle"
            aria-expanded={!collapsed[id]}
            onClick={() => toggle(id)}
          >
            {collapsed[id] ? (
              <ChevronRight size={13} />
            ) : (
              <ChevronDown size={13} />
            )}
            <span>{name}</span>
          </button>
        ) : (
          <span className="studio-section-title">{name}</span>
        )}
        <div className="studio-section-tools">
          {id !== "pinned" && (
            <button
              className="studio-row-menu"
              aria-label={group ? `在${name}中新建项目` : "新建项目"}
              title="新建项目"
              onClick={() => onCreate(group?.id)}
            >
              <Plus size={16} />
            </button>
          )}
          {id !== "pinned" && (
            <button
              className="studio-row-menu"
              aria-label={group ? `${name}的分组操作` : "项目列表操作"}
              aria-haspopup="menu"
              onClick={(event) =>
                group
                  ? onGroupMenu(group, event.currentTarget)
                  : onMenu(event.currentTarget)
              }
            >
              <MoreHorizontal size={16} />
            </button>
          )}
        </div>
      </div>
      {(!group || !collapsed[id]) && (
        <div
          className="studio-project-section-items"
          {...drag?.section(id, () =>
            setCollapsed((current) => ({ ...current, [id]: false })),
          )}
        >
          {items.map(renderProject)}
          {!items.length && group && (
            <div className="studio-group-empty">暂无项目</div>
          )}
        </div>
      )}
    </section>
  );
  return (
    <div className="studio-sidebar-projects">
      {!!pinned.length && section("pinned", "置顶", pinned)}
      {section("projects", "项目", ungrouped)}
      {organization.groups.map((group) =>
        section(
          group.id,
          group.name,
          projects.filter(
            (item) =>
              !item.pinned && organization.projectGroups[item.id] === group.id,
          ),
          group,
        ),
      )}
    </div>
  );
}
