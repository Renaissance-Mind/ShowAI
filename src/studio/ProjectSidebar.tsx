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
import { orderSidebarProjects } from "../core/sidebar-order";
import { useLibraryDrag } from "./LibraryDrag";
import { useTranslator } from "../i18n/react";
import sidebarMessages from "../i18n/messages/sidebar";
import navigationMessages from "../i18n/messages/navigation";

export default function ProjectSidebar({
  projects,
  organization,
  selectedProject,
  collapsed,
  setCollapsed,
  renderProject,
  onCreate,
  onNew,
  onMenu,
  onGroupMenu,
  unreadable,
  docs,
}: {
  projects: ProjectSummary[];
  organization: SidebarOrganization;
  selectedProject: string | null;
  collapsed: Record<string, boolean>;
  setCollapsed: Dispatch<SetStateAction<Record<string, boolean>>>;
  renderProject: (project: ProjectSummary) => ReactNode;
  onCreate: (groupId?: string) => void;
  /** Opens the New menu: content for the current project, and a new project. */
  onNew: (anchor: HTMLButtonElement) => void;
  onMenu: (anchor: HTMLElement) => void;
  onGroupMenu: (group: ProjectGroup, anchor: HTMLElement) => void;
  /** Rows for project folders that could not be read. */
  unreadable?: ReactNode;
  /** The built-in documentation, pinned under the New button. */
  docs?: ReactNode;
}) {
  const t = useTranslator(sidebarMessages);
  const tn = useTranslator(navigationMessages);
  const drag = useLibraryDrag();
  projects = orderSidebarProjects(projects, organization.projectOrder);
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
              aria-label={
                group ? t("newProjectIn", { name }) : t("createProject")
              }
              title={t("createProject")}
              onClick={() => onCreate(group?.id)}
            >
              <Plus size={16} />
            </button>
          )}
          {id !== "pinned" && (
            <button
              className="studio-row-menu"
              aria-label={
                group ? t("groupActions", { name }) : t("projectListActions")
              }
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
          {id === "projects" && unreadable}
          {!items.length && group && (
            <div className="studio-group-empty">{t("noProjects")}</div>
          )}
        </div>
      )}
    </section>
  );
  return (
    <div className="studio-sidebar-projects">
      <button
        className="studio-new-project"
        type="button"
        aria-label={tn("newHint")}
        aria-haspopup="menu"
        title={tn("newHint")}
        onClick={(event) => onNew(event.currentTarget)}
      >
        <Plus size={17} aria-hidden="true" />
        <span>{tn("new")}</span>
      </button>
      {docs}
      {!!pinned.length && section("pinned", t("section.pinned"), pinned)}
      {section("projects", t("section.projects"), ungrouped)}
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
