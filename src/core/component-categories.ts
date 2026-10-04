import type {
  BuiltinComponentMetadata,
  ComponentCategory,
  ComponentMetadata,
} from "../components/custom/types";

export const componentCategories = [
  { id: "text", label: "文本" },
  { id: "image", label: "图片" },
  { id: "table", label: "表格" },
  { id: "data", label: "数据" },
  { id: "flow", label: "流程" },
  { id: "other", label: "其他" },
] as const satisfies readonly { id: ComponentCategory; label: string }[];

const builtinCategories: Record<string, ComponentCategory> = {
  text: "text",
  callout: "text",
  toggle: "text",
  divider: "text",
  code: "text",
  bookmark: "text",
  image: "image",
  gallery: "image",
  table: "table",
  database: "table",
  chart: "data",
  metrics: "data",
  playground: "data",
  flowchart: "flow",
};

export type CatalogComponent = BuiltinComponentMetadata | ComponentMetadata;
export type ComponentFilter = "all" | "builtin" | "custom";
export type ComponentGroup = (typeof componentCategories)[number] & {
  items: CatalogComponent[];
};

export function componentCategory(item: CatalogComponent): ComponentCategory {
  if ("kind" in item) return builtinCategories[item.kind] ?? "other";
  if (item.category) return item.category;
  return builtinCategories[item.id.replace(/^my-/, "")] ?? "other";
}

export function groupComponents(
  catalog: { builtin: BuiltinComponentMetadata[]; custom: ComponentMetadata[] },
  filter: ComponentFilter,
): ComponentGroup[] {
  const items = [
    ...(filter === "custom" ? [] : catalog.builtin),
    ...(filter === "builtin" ? [] : catalog.custom),
  ];
  return componentCategories.map((category) => ({
    ...category,
    items: items.filter((item) => componentCategory(item) === category.id),
  }));
}
