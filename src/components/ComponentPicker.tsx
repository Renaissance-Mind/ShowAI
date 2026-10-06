import { ComponentLibraryContext } from "./ComponentLibrary";
import type { CompiledComponent } from "./custom/types";
import type { CatalogComponent } from "../core/component-categories";
import { useMemo, useState, useContext, useEffect } from "react";
import { createPortal } from "react-dom";
import { Search, Plus } from "lucide-react";
import { builtinComponentCatalog } from "./catalog";
import { BuiltinPreview } from "./BuiltinPreview";
import {
  useAvailableComponents,
  CustomComponentsProvider,
} from "./custom/CustomBlock";
import { componentWidgetData } from "./custom/contract";
import { Widget } from "./blocks/Widget";
import Dialog from "../studio/Dialog";
import {
  componentCategory,
  componentCategories,
} from "../core/component-categories";
import "./component-picker.css";
export function ComponentPicker({
  onInsert,
  onClose,
}: {
  onInsert: (
    kind: string,
    data: Record<string, unknown>,
    component?: CompiledComponent,
  ) => void;
  onClose: () => void;
}) {
  const builtins = useMemo(() => builtinComponentCatalog(), []),
    custom = useAvailableComponents();
  const library = useContext(ComponentLibraryContext);
  const [catalog, setCatalog] = useState<CatalogComponent[] | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [resolved, setResolved] = useState<CompiledComponent | null>(null);
  useEffect(() => {
    if (!library) return;
    let active = true;
    setLoading(true);
    library
      .list()
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch((reason) => {
        if (active) setError(String(reason.message ?? reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [library]);
  const items: CatalogComponent[] = catalog ?? [
    ...builtins,
    ...new Map(
      custom.map((item) => [
        `${item.id}@${item.version}#${item.integrity}`,
        item,
      ]),
    ).values(),
  ];
  const key = (item: (typeof items)[number]) =>
    "kind" in item ? item.kind : `${item.id}@${item.version}#${item.integrity}`;
  const [query, setQuery] = useState(""),
    [selection, setSelection] = useState(builtins[0]?.kind ?? "");
  const filtered = items.filter((item) =>
    `${item.name} ${item.description} ${"kind" in item ? item.kind : item.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected =
    filtered.find((item) => key(item) === selection) ?? filtered[0];
  const selectedKey = selected ? key(selected) : "";
  const loaded =
    selected &&
    !("kind" in selected) &&
    resolved &&
    key(selected) === key(resolved)
      ? resolved
      : null;
  useEffect(() => {
    setResolved(null);
    if (!selected || "kind" in selected) {
      setLoading(false);
      return;
    }
    if ("html" in selected) {
      setResolved(selected as CompiledComponent);
      setLoading(false);
      return;
    }
    if (!library) return;
    let active = true;
    setLoading(true);
    setError("");
    library
      .read(selected)
      .then((component) => {
        if (active) setResolved(component);
      })
      .catch((reason) => {
        if (active) setError(String(reason.message ?? reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedKey, catalog, library]);
  return createPortal(
    <Dialog
      title="添加组件"
      onClose={onClose}
      wide
      className="component-picker"
    >
      <label className="component-picker-search">
        <Search size={16} />
        <input
          autoFocus
          aria-label="搜索组件"
          placeholder="搜索组件"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="component-picker-body">
        <div className="component-picker-list">
          {componentCategories.map((category) => {
            const group = filtered.filter(
              (item) => componentCategory(item) === category.id,
            );
            return group.length ? (
              <section key={category.id}>
                <strong>{category.label}</strong>
                {group.map((item) => (
                  <button
                    type="button"
                    aria-pressed={selected === item}
                    key={key(item)}
                    onClick={() => setSelection(key(item))}
                  >
                    <span>{item.name}</span>
                    <small>{item.description}</small>
                  </button>
                ))}
              </section>
            ) : null;
          })}
          {!filtered.length && <p>没有匹配的组件</p>}
        </div>
        <div className="component-picker-preview">
          {selected && (
            <>
              <h3>{selected.name}</h3>
              <p>{selected.description}</p>
              {"kind" in selected ? (
                <BuiltinPreview
                  component={selected}
                  data={selected.defaultData}
                />
              ) : loaded ? (
                <CustomComponentsProvider components={[loaded]}>
                  <Widget
                    kind="custom"
                    data={componentWidgetData(loaded)}
                    readOnly
                  />
                </CustomComponentsProvider>
              ) : (
                <p>正在加载组件…</p>
              )}
            </>
          )}
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      <footer>
        <button
          type="button"
          className="studio-button primary"
          disabled={!selected || loading || (!("kind" in selected) && !loaded)}
          onClick={() => {
            if (selected)
              onInsert(
                "kind" in selected ? selected.kind : "custom",
                "kind" in selected
                  ? structuredClone(selected.defaultData)
                  : componentWidgetData(loaded!),
                "kind" in selected ? undefined : loaded!,
              );
          }}
        >
          <Plus size={15} />
          插入组件
        </button>
      </footer>
    </Dialog>,
    document.body,
  );
}
