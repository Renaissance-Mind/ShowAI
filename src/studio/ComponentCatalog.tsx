import { useState } from "react";
import { useAppearanceTheme } from "../design/useAppearanceTheme";
import {
  Blocks,
  PanelsTopLeft,
  ChartNoAxesCombined,
  Code2,
  Image,
  Table2,
  Type,
  Workflow,
} from "../ui/icons";
import type { ComponentCategory } from "../components/custom/types";
import { reuseLabels } from "../components/custom/documentation";
import type {
  CatalogComponent,
  ComponentGroup,
} from "../core/component-categories";
import ComponentThumbnail, {
  componentPreviewReference,
} from "./ComponentThumbnail";
import "./component-catalog.css";
const categoryIcons = {
  text: Type,
  image: Image,
  table: Table2,
  data: ChartNoAxesCombined,
  flow: Workflow,
  surface: PanelsTopLeft,
  other: Blocks,
};
export function ComponentNavigation({
  groups,
  active,
  onSelect,
}: {
  groups: ComponentGroup[];
  active: ComponentCategory | null;
  onSelect: (category: ComponentCategory | null) => void;
}) {
  return (
    <div className="component-type-sidebar">
      <div className="settings-nav-label">类型</div>
      <nav className="settings-nav component-type-nav" aria-label="组件类型">
        <button
          aria-current={active === null ? "page" : undefined}
          onClick={() => onSelect(null)}
        >
          <Blocks size={17} strokeWidth={1.7} />
          <span>全部</span>
        </button>
        {groups.map(({ id, label, items }) => {
          const Icon = categoryIcons[id];
          return (
            <button
              key={id}
              aria-label={label}
              aria-current={active === id ? "page" : undefined}
              disabled={!items.length}
              onClick={() => onSelect(id)}
            >
              <Icon size={17} strokeWidth={1.7} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
export function ComponentCatalog({
  groups,
  category,
  onOpen,
  browser = false,
  showProjectNames = false,
  query = "",
}: {
  groups: ComponentGroup[];
  category: ComponentCategory | null;
  onOpen: (item: CatalogComponent) => void;
  browser?: boolean;
  showProjectNames?: boolean;
  query?: string;
}) {
  const theme = useAppearanceTheme(),
    [selected, setSelected] = useState<string | null>(null);
  const visible = groups.filter((group) => !category || group.id === category),
    items = visible.flatMap((group) => group.items);
  return (
    <div className="component-catalog">
      <section
        className="component-category"
        aria-label={`${category ? (visible[0]?.label ?? "") : "全部"}组件`}
      >
        <div className="studio-component-grid">
          {items.map((item) => {
            const builtin = "kind" in item,
              key = JSON.stringify(componentPreviewReference(item)),
              Icon =
                categoryIcons[
                  visible.find((group) => group.items.includes(item))!.id
                ];
            const scope = builtin
              ? "内置"
              : ({
                  builtin: "内置",
                  project: "项目",
                  global: "全局",
                  published: "已发布",
                }[item.scope] ?? item.scope);
            return (
              <button
                className={`studio-component-card${selected === key ? " is-selected" : ""}`}
                key={key}
                aria-haspopup="dialog"
                onClick={() => {
                  setSelected(key);
                  onOpen(item);
                }}
              >
                <ComponentThumbnail
                  item={item}
                  browser={browser}
                  theme={theme}
                />
                <div className="component-card-copy">
                  <div className="component-card-identity">
                    <span className="studio-component-symbol">
                      {builtin ? (
                        <Icon size={20} strokeWidth={1.6} />
                      ) : (
                        <Code2 size={20} strokeWidth={1.6} />
                      )}
                    </span>
                    <h3>{item.name}</h3>
                  </div>
                  <p>{item.description}</p>
                  <div className="component-card-metadata">
                    <span>
                      {showProjectNames && !builtin && item.projectName
                        ? item.projectName
                        : scope}
                    </span>
                    {!builtin && <span>v{item.version}</span>}
                    <span>
                      {
                        reuseLabels[
                          item.documentation?.reuse.kind ?? "unclassified"
                        ]
                      }
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      {!items.length && (
        <div className="studio-empty">
          <Blocks size={30} />
          <h2>{query ? "没有匹配的组件" : "暂无组件"}</h2>
        </div>
      )}
    </div>
  );
}
