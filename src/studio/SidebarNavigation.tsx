import { useLayoutEffect, useRef, useState } from "react";
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

/**
 * Shows the section names while they fit and icons alone below that width.
 * The width where a name was cut is kept, so resizing does not flicker.
 */
function useLabelsFit(language: string) {
  const nav = useRef<HTMLElement>(null);
  const [labels, setLabels] = useState(true);
  const cutAt = useRef(0);
  useLayoutEffect(() => {
    cutAt.current = 0;
    setLabels(true);
  }, [language]);
  useLayoutEffect(() => {
    const element = nav.current!;
    const fit = () => {
      const width = element.clientWidth;
      if (!labels) {
        if (width >= cutAt.current) setLabels(true);
        return;
      }
      const cut = [
        ...element.querySelectorAll<HTMLElement>(".studio-main-nav-label"),
      ].some((label) => label.scrollWidth > label.clientWidth);
      if (cut) {
        cutAt.current = width + 1;
        setLabels(false);
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [labels]);
  return { nav, labels };
}

export default function SidebarNavigation({
  current,
  onSelect,
}: {
  /** The section the workspace shows now, or null for projects and pages. */
  current: SidebarSection | null;
  onSelect: (section: SidebarSection) => void;
}) {
  const t = useTranslator(sidebarMessages);
  const { nav, labels } = useLabelsFit(t("nav.recent"));
  return (
    <nav
      ref={nav}
      className="studio-sidebar-bottom studio-main-nav"
      data-labels={labels || undefined}
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
          {labels && (
            <span className="studio-main-nav-label" aria-hidden="true">
              {t(label)}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
