import { History, LayoutTemplate, Blocks, Settings2 } from "../ui/icons";
export type SidebarSection = "recent" | "templates" | "components" | "settings";

const sections = [
  ["recent", "最近", History],
  ["templates", "模板", LayoutTemplate],
  ["components", "组件", Blocks],
  ["settings", "设置", Settings2],
] as const;

export default function SidebarNavigation({
  active,
  onSelect,
}: {
  active: SidebarSection;
  onSelect: (section: SidebarSection) => void;
}) {
  return (
    <nav
      className="studio-sidebar-bottom studio-main-nav"
      aria-label="主要导航"
    >
      {sections.map(([section, label, Icon]) => (
        <button
          key={section}
          className={active === section ? "active" : ""}
          aria-current={active === section ? "page" : undefined}
          onClick={() => onSelect(section)}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
