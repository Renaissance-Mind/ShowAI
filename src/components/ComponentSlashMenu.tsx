import ExpandableSearch from "./ExpandableSearch";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PanelTop } from "../ui/icons";
import {
  useComponentCatalog,
  RegisterComponentContext,
} from "./useComponentCatalog";
import {
  componentCategory,
  type CatalogComponent,
} from "../core/component-categories";
import { SlashMenuItems, useSlashMenu } from "./SlashMenuItems";
import { isChartKind, type SlashEntry } from "./slash-menu-model";
import {
  componentCategoryLabel,
  componentDisplayDescription,
  componentDisplayName,
} from "./component-display";
import { useTranslator } from "../i18n/react";
import messages from "../i18n/messages/catalog";
import "../editor/editor.css";

export function ComponentSlashMenu({
  left,
  top,
  onInsert,
  onClose,
}: {
  left: number;
  top: number;
  onInsert: (kind: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const t = useTranslator(messages);
  const catalog = useComponentCatalog(true),
    register = useContext(RegisterComponentContext);
  const [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null),
    active = useRef(true),
    restore = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      restore.current?.focus();
    };
  }, []);
  const items = useMemo(
    () =>
      catalog.items
        .filter(
          (item) =>
            ("kind" in item || item.role !== "page-outline") && !item.mention,
        )
        .map(
          (item): SlashEntry & { component: CatalogComponent } => ({
            // The rich-text menu uses the same ids, so recent items are shared.
            id:
              "catalog:" +
              ("kind" in item
                ? item.kind
                : `${item.id}@${item.version}#${item.integrity}`),
            title: componentDisplayName(item),
            keywords: `${item.name} ${item.description} ${componentDisplayDescription(item)} ${"kind" in item ? item.kind : item.id}`,
            group: t("allComponents"),
            chart: "kind" in item && isChartKind(item.kind),
            component: item,
          }),
        ),
    [catalog.items, t],
  );
  const insert = async (item: CatalogComponent) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await catalog.resolve(item);
      if (!active.current) return;
      if (value.component) register(value.component);
      onInsert(value.kind, value.data);
      onClose();
    } catch (reason) {
      if (active.current) {
        setBusy(false);
        setError((reason as Error).message);
      }
    }
  };
  const menu = useSlashMenu(items, query, (entry) => void insert(entry.component));
  useEffect(() => {
    root.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [menu.selected, menu.charts]);
  return createPortal(
    <>
      <div className="slash-dismiss" onClick={onClose} />
      <div
        ref={root}
        className="slash-menu is-minimal"
        role="dialog"
        aria-label={t("insertContent")}
        style={{
          left: Math.max(12, Math.min(left, window.innerWidth - 320)),
          top: Math.max(12, Math.min(top, window.innerHeight - 410)),
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          event.stopPropagation();
          if (menu.key(event)) return;
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="slash-search">
          <ExpandableSearch
            label={t("searchBlocks")}
            placeholder={t("searchComponentsPlaceholder")}
            defaultExpanded
            value={query}
            onChange={setQuery}
          />
          <kbd>esc</kbd>
        </div>
        {(error || catalog.error) && (
          <p role="alert" className="slash-empty">
            {error || catalog.error}
          </p>
        )}
        <div
          className="slash-items"
          role="listbox"
          aria-label={t("blockTypes")}
          aria-busy={busy || catalog.loading}
        >
          {!menu.rows.length && (
            <p className="slash-empty">
              {catalog.loading
                ? t("loadingComponents")
                : t("noComponentsFound")}
            </p>
          )}
          <SlashMenuItems
            menu={menu}
            disabled={busy}
            icon={() => <PanelTop size={20} />}
            detail={(entry) => (
              <small>
                {componentCategoryLabel(componentCategory(entry.component))}
              </small>
            )}
          />
        </div>
      </div>
    </>,
    document.body,
  );
}
