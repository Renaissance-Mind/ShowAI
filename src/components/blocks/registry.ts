import {
  TextBlock,
  ImageBlock,
  TableBlock,
  CalloutBlock,
  ToggleBlock,
  DividerBlock,
  CodeBlock,
  validatePrimitiveData,
} from "./Primitives";
import { createElement } from "react";
import primitiveMetadata from "../../../resources/catalog/primitives.json";
import componentMetadata from "../../../resources/catalog/components.json";
import { BookmarkBlock } from "./Bookmark";
import { ChartBlock } from "./Chart";
import { DatabaseBlock } from "./Database";
import { GalleryBlock } from "./Gallery";
import { MetricsBlock } from "./Metrics";
import { PlaygroundBlock } from "./Playground";
import { FlowchartBlock } from "./Flowchart";
import { validateFlowchartData } from "./flowchart-contract.mjs";
import { parseChartData } from "./helpers";
import g2Metadata from "../../../resources/catalog/g2.json";
import { G2ChartBlock } from "./G2Chart";
import { validateG2Data } from "./g2/contract.mjs";
import { CustomBlock } from "../custom/CustomBlock";
import { readCustomBlockData } from "../custom/contract";
import type { BlockData, BlockDefinition, BlockRegistration } from "./types";

export type {
  BlockData,
  BlockDefinition,
  BlockProps,
  BlockRegistration,
} from "./types";

/** Register before mounting the editor. Existing readers also update if a renderer is added later. */
export const blockDefinitions: BlockDefinition[] = [];
const allBlockDefinitions: BlockDefinition[] = [];
const listeners = new Set<() => void>();
let revision = 0;
export const subscribeToBlocks = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getRegistryRevision = () => revision;

export function registerBlock(
  input: BlockDefinition | BlockRegistration,
): void {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(input.kind))
    throw new Error(
      "Block kind must use lowercase letters, numbers, and hyphens.",
    );
  if (getBlockDefinition(input.kind))
    throw new Error(`Block "${input.kind}" is already registered.`);
  const definition: BlockDefinition =
    "Component" in input
      ? {
          kind: input.kind,
          title: input.label,
          description: input.description,
          icon: input.icon ?? "◇",
          defaultData: input.createData(),
          createData: input.createData,
          renderer: input.Component,
          validate: input.validate,
        }
      : { ...input };
  if (!definition.title.trim()) throw new Error("Block title is required.");
  definition.defaultData = cloneBlockData(definition.defaultData);
  definition.validate?.(definition.defaultData);
  allBlockDefinitions.push(definition);
  if (!definition.replacedBy) blockDefinitions.push(definition);
  revision++;
  for (const listener of listeners) listener();
}

export function getBlockDefinition(kind: string): BlockDefinition | undefined {
  return allBlockDefinitions.find((definition) => definition.kind === kind);
}

function cloneBlockData(data: BlockData): BlockData {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Block data must be a JSON object.");
  // structuredClone catches executable values; the JSON check prevents silent loss on export.
  const cloned = structuredClone(data);
  const assertJson = (value: unknown, depth = 0): void => {
    if (depth > 40) throw new Error("Block data is nested too deeply.");
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      value.forEach((item) => assertJson(item, depth + 1));
      return;
    }
    if (
      value &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype
    ) {
      for (const [key, item] of Object.entries(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key))
          throw new Error("Block data contains a reserved key.");
        assertJson(item, depth + 1);
      }
      return;
    }
    throw new Error(
      "Block data must contain only finite, serializable JSON values.",
    );
  };
  assertJson(cloned);
  return cloned;
}

export function createBlockData(kind: string): BlockData {
  const definition = getBlockDefinition(kind);
  if (!definition) throw new Error(`Unknown block kind: ${kind}`);
  const data = cloneBlockData(
    definition.createData?.() ?? definition.defaultData,
  );
  definition.validate?.(data);
  return data;
}

function objectArray(data: BlockData, key: string): Record<string, unknown>[] {
  if (data[key] === undefined) return [];
  if (
    !Array.isArray(data[key]) ||
    data[key].some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new Error(`${key} 必须是对象数组。`);
  return data[key];
}

for (const item of primitiveMetadata) {
  registerBlock({
    kind: item.kind,
    replacedBy: item.replacedBy,
    title: item.name,
    description: item.description,
    icon: (
      {
        text: "T",
        image: "▧",
        table: "▦",
        callout: "!",
        toggle: "⌄",
        divider: "—",
        code: "{}",
      } as Record<string, string>
    )[item.kind],
    defaultData: item.defaultData as BlockData,
    renderer: {
      text: TextBlock,
      image: ImageBlock,
      table: TableBlock,
      callout: CalloutBlock,
      toggle: ToggleBlock,
      divider: DividerBlock,
      code: CodeBlock,
    }[
      item.kind as
        "text" | "image" | "table" | "callout" | "toggle" | "divider" | "code"
    ],
    validate: (data) => validatePrimitiveData(item.kind, data),
  });
}

registerBlock({
  kind: "flowchart",
  title: "交互流程图",
  description: "节点、分支与按需展开的说明",
  icon: "⌘",
  defaultData: componentMetadata.find((item) => item.kind === "flowchart")!
    .defaultData as BlockData,
  renderer: FlowchartBlock,
  validate: validateFlowchartData,
});
registerBlock({
  kind: "chart",
  title: "数据图表",
  description: "交互式折线图、柱状图与原始数据",
  icon: "↗",
  defaultData: {
    title: "数据图表",
    type: "line",
    labels: [],
    series: [],
    unit: "",
  },
  renderer: ChartBlock,
  validate: (data) => {
    parseChartData(
      JSON.stringify({
        ...data,
        labels: data.labels ?? [],
        series: data.series ?? [],
      }),
    );
  },
});
registerBlock({
  kind: "database",
  title: "数据库",
  description: "表格、看板、筛选和排序",
  icon: "▦",
  defaultData: {
    title: "数据库",
    columns: [
      { id: "name", name: "名称", type: "text" },
      {
        id: "status",
        name: "状态",
        type: "select",
        options: ["待开始", "进行中", "已完成"],
      },
    ],
    rows: [],
  },
  renderer: DatabaseBlock,
  validate: (data) => {
    const columns = objectArray(data, "columns"),
      rows = objectArray(data, "rows");
    const validIds = (items: Record<string, unknown>[]) =>
      items.every(
        (item) =>
          typeof item.id === "string" &&
          item.id &&
          !["__proto__", "constructor", "prototype"].includes(item.id),
      ) && new Set(items.map((item) => item.id)).size === items.length;
    if (!validIds(columns) || !validIds(rows))
      throw new Error("属性和记录必须使用不重复的 id。");
    if (columns.some((column) => column.id === "id"))
      throw new Error("属性 id 不能使用保留名称 id。");
    if (
      rows.some((row) =>
        Object.values(row).some(
          (value) => !["string", "number", "boolean"].includes(typeof value),
        ),
      )
    )
      throw new Error("单元格只支持文字、数字或布尔值。");
  },
});
registerBlock({
  kind: "metrics",
  title: "关键指标",
  description: "数值、变化率与简洁说明",
  icon: "◴",
  defaultData: { title: "关键指标", items: [] },
  renderer: MetricsBlock,
  validate: (data) => {
    objectArray(data, "items");
  },
});
registerBlock({
  kind: "playground",
  title: "交互计算",
  description: "滑动参数，即时探索计算结果",
  icon: "⌁",
  defaultData: {
    title: "交互计算",
    inputs: [],
    operation: "sum",
    resultLabel: "计算结果",
    unit: "",
  },
  renderer: PlaygroundBlock,
  validate: (data) => {
    const inputs = objectArray(data, "inputs");
    if (
      inputs.some(
        (input) =>
          typeof input.id !== "string" ||
          typeof input.label !== "string" ||
          !["min", "max", "step", "value"].every(
            (key) =>
              typeof input[key] === "number" && Number.isFinite(input[key]),
          ) ||
          Number(input.min) >= Number(input.max) ||
          Number(input.step) <= 0,
      )
    )
      throw new Error("参数需要名称和有限数值范围，且步长必须大于 0。");
    if (new Set(inputs.map((input) => input.id)).size !== inputs.length)
      throw new Error("参数 id 不能重复。");
  },
});
registerBlock({
  kind: "gallery",
  title: "图片画廊",
  description: "本地图片、图注与全屏预览",
  icon: "▧",
  defaultData: { title: "图片画廊", columns: 2, images: [] },
  renderer: GalleryBlock,
  validate: (data) => {
    objectArray(data, "images");
  },
});
registerBlock({
  kind: "bookmark",
  title: "来源书签",
  description: "保存网页、论文和项目出处",
  icon: "↗",
  defaultData: { title: "", description: "", url: "", image: "" },
  renderer: BookmarkBlock,
});

registerBlock({
  kind: "custom",
  title: "自定义组件",
  description: "使用项目中安装的 React 组件",
  icon: "◇",
  defaultData: {
    componentId: "value-slider",
    version: "1.0.0",
    props: { label: "数值", value: 0, min: 0, max: 100 },
  },
  renderer: CustomBlock,
  validate: (data) => {
    readCustomBlockData(data);
  },
});

for (const item of g2Metadata) {
  registerBlock({
    kind: item.kind,
    title: item.name,
    description: item.description,
    icon: "↗",
    defaultData: item.defaultData as BlockData,
    renderer: (props) =>
      createElement(G2ChartBlock, { ...props, chartType: item.kind.slice(3) }),
    validate: validateG2Data,
  });
}
