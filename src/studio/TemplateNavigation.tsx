import { FileText, FlaskConical, LayoutTemplate } from "../ui/icons";
import type { TemplateMetadata } from "../components/custom/types";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/templates";
import "./template-navigation.css";

// Labels are templates-namespace keys (`type.<id>`), translated at render.
const types = [
  { id: "all", icon: LayoutTemplate },
  { id: "system-presentation", icon: FileText },
  { id: "paper-explainer", icon: FlaskConical },
  { id: "blank", icon: FileText },
  { id: "custom", icon: LayoutTemplate },
] as const;

export type TemplateType = (typeof types)[number]["id"];

export function matchesTemplateType(
  item: TemplateMetadata,
  type: TemplateType,
) {
  if (type === "all") return true;
  if (type === "custom") return item.scope !== "builtin";
  return item.scope === "builtin" && item.id === type;
}

export default function TemplateNavigation({
  active,
  onSelect,
}: {
  templates: TemplateMetadata[];
  active: TemplateType;
  onSelect: (type: TemplateType) => void;
}) {
  const t = useTranslator(messages);
  return (
    <div className="template-type-sidebar">
      <div className="settings-nav-label">{t("types")}</div>
      <nav className="settings-nav" aria-label={t("templateTypes")}>
        {types.map(({ id, icon: Icon }) => {
          const label = t(`type.${id}`);
          return (
            <button
              key={id}
              aria-label={label}
              aria-current={active === id ? "page" : undefined}
              onClick={() => onSelect(id)}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
