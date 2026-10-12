import { FileText, FlaskConical, LayoutTemplate, Columns3 } from "../ui/icons";
import type { TemplateMetadata } from "../components/custom/types";
import "./template-navigation.css";

const types = [
  { id: "all", label: "全部", icon: LayoutTemplate },
  { id: "concept-explainer", label: "概念讲解", icon: LayoutTemplate },
  { id: "decision-comparison", label: "方案决策", icon: Columns3 },
  { id: "evidence-report", label: "研究证据", icon: FlaskConical },
  { id: "procedure-guide", label: "操作排查", icon: FileText },
  { id: "progress-report", label: "进展汇报", icon: FileText },
  { id: "exploration-map", label: "资料探索", icon: LayoutTemplate },
  { id: "system-presentation", label: "基础指南", icon: FileText },
  { id: "blank", label: "空白", icon: FileText },
  { id: "research", label: "调研", icon: FlaskConical },
  { id: "comparison", label: "对比", icon: Columns3 },
  { id: "brief", label: "简报", icon: FileText },
  { id: "custom", label: "自定义", icon: LayoutTemplate },
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
  templates,
  active,
  onSelect,
}: {
  templates: TemplateMetadata[];
  active: TemplateType;
  onSelect: (type: TemplateType) => void;
}) {
  return (
    <div className="template-type-sidebar">
      <div className="settings-nav-label">类型</div>
      <nav className="settings-nav" aria-label="模板类型">
        {types.map(({ id, label, icon: Icon }) => {
          const count = templates.filter((item) =>
            matchesTemplateType(item, id),
          ).length;
          return (
            <button
              key={id}
              aria-label={label}
              aria-current={active === id ? "page" : undefined}
              onClick={() => onSelect(id)}
            >
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
              <span className="template-type-count" aria-hidden="true">
                {count}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
