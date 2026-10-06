import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { ComponentLibraryContext } from "./ComponentLibrary";
import { useAvailableComponents } from "./custom/CustomBlock";
import type { CompiledComponent } from "./custom/types";
import type { CatalogComponent } from "../core/component-categories";
import { builtinComponentCatalog } from "./catalog";
import { componentWidgetData } from "./custom/contract";

export const RegisterComponentContext = createContext<
  (component: CompiledComponent) => void
>(() => {});
export function useComponentCatalog(open: boolean) {
  const library = useContext(ComponentLibraryContext);
  const available = useAvailableComponents();
  const builtins = useMemo(() => builtinComponentCatalog(), []);
  const [catalog, setCatalog] = useState<CatalogComponent[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open || !library) return;
    let active = true;
    setLoading(true);
    setError("");
    library
      .list()
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch((reason) => {
        if (active) setError(reason.message ?? String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, library]);
  const items = catalog ?? [...builtins, ...available];
  const resolve = async (item: CatalogComponent) => {
    if ("kind" in item)
      return {
        kind: item.kind,
        data: structuredClone(item.defaultData),
        native: !!item.insertion,
      };
    const component =
      available.find(
        (value) =>
          value.id === item.id &&
          value.version === item.version &&
          value.integrity === item.integrity,
      ) ?? (library ? await library.read(item) : null);
    if (!component) throw new Error("组件尚未安装。");
    return {
      kind: "custom",
      data: componentWidgetData(component),
      component,
      native: false,
    };
  };
  return { items, resolve, error, loading };
}
