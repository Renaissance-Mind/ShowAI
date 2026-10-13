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
import {
  componentCategoryLabel,
  componentDisplayDescription,
  componentDisplayName,
} from "../components/component-display";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
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
  const t = useTranslator(messages);
  return (
    <div className="component-type-sidebar">
      <div className="settings-nav-label">{t("types")}</div>
      <nav
        className="settings-nav component-type-nav"
        aria-label={t("componentTypes")}
      >
        <button
          aria-current={active === null ? "page" : undefined}
          onClick={() => onSelect(null)}
        >
          <Blocks size={17} strokeWidth={1.7} />
          <span>{t("all")}</span>
        </button>
        {groups.map(({ id, items }) => {
          const Icon = categoryIcons[id];
          const label = componentCategoryLabel(id);
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
  const t = useTranslator(messages);
  const theme = useAppearanceTheme(),
    [selected, setSelected] = useState<string | null>(null);
  const visible = groups.filter((group) => !category || group.id === category),
    items = visible.flatMap((group) => group.items);
  return (
    <div className="component-catalog">
      <section
        className="component-category"
        aria-label={
          category
            ? t("categoryComponents", {
                category: componentCategoryLabel(category),
              })
            : t("allComponents")
        }
      >
        <div className="studio-component-grid">
          {items.map((item) => {
            const builtin = "kind" in item,
              key = JSON.stringify(componentPreviewReference(item)),
              Icon =
                categoryIcons[
                  visible.find((group) => group.items.includes(item))!.id
                ];
            const scope = t(builtin ? "scope.builtin" : `scope.${item.scope}`);
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
                    <h3>{componentDisplayName(item)}</h3>
                  </div>
                  <p>{componentDisplayDescription(item)}</p>
                  <div className="component-card-metadata">
                    <span>
                      {showProjectNames && !builtin && item.projectName
                        ? item.projectName
                        : scope}
                    </span>
                    {!builtin && <span>v{item.version}</span>}
                    <span>
                      {t(
                        `reuse.${item.documentation?.reuse.kind ?? "unclassified"}`,
                      )}
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
          <h2>{query ? t("empty.noMatches") : t("empty.none")}</h2>
        </div>
      )}
    </div>
  );
}
