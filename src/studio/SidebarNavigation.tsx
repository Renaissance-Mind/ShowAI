import { History, LayoutTemplate, Blocks, Settings2 } from "../ui/icons";
import { useTranslator } from "../i18n/react";
import sidebarMessages from "../i18n/messages/sidebar";
export type SidebarSection = "recent" | "templates" | "components" | "settings";

const sections = [
  ["recent", "nav.recent", History],
  ["templates", "nav.templates", LayoutTemplate],
  ["components", "nav.components", Blocks],
  ["settings", "nav.settings", Settings2],
] as const;

export default function SidebarNavigation({
  current,
  onSelect,
}: {
  /** The section the workspace shows now, or null for projects and pages. */
  current: SidebarSection | null;
  onSelect: (section: SidebarSection) => void;
}) {
  const t = useTranslator(sidebarMessages);
  return (
    <nav
      className="studio-sidebar-bottom studio-main-nav"
      aria-label={t("nav.main")}
    >
      {sections.map(([section, label, Icon]) => (
        <button
          key={section}
          aria-label={t(label)}
          aria-current={current === section ? "page" : undefined}
          className={current === section ? "active" : undefined}
          title={t(label)}
          onClick={() => onSelect(section)}
        >
          <Icon size={15} aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
}
