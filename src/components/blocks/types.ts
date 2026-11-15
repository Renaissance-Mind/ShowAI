import type { ComponentType } from "react";

export type BlockData = Record<string, unknown>;
export interface BlockProps {
  data: BlockData;
  onChange?: (data: BlockData) => void;
  readOnly?: boolean;
  host?: import("../rich-text/RichText").RichTextHost;
  inline?: boolean;
}

export interface BlockDefinition {
  kind: string;
  replacedBy?: string;
  title: string;
  description: string;
  icon: string;
  defaultData: BlockData;
  renderer: ComponentType<BlockProps>;
  createData?: () => BlockData;
  validate?: (data: BlockData) => void;
}

export interface BlockRegistration {
  kind: string;
  label: string;
  description: string;
  icon?: string;
  createData: () => BlockData;
  Component: ComponentType<BlockProps>;
  validate?: (data: BlockData) => void;
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: string;
}
export interface ChartData extends BlockData {
  title: string;
  description?: string;
  type: "line" | "bar";
  labels: string[];
  series: ChartSeries[];
  unit?: string;
}
export type ColumnType =
  | "text"
  | "number"
  | "select"
  | "checkbox"
  | "url"
  | "date"
  | "page"
  | "multiSelect"
  | "relation"
  | "formula"
  | "rollup"
  | "custom";
export interface DatabaseColumn {
  id: string;
  name: string;
  type: ColumnType;
  options?: string[];
  folder?: string;
  titleColumn?: string;
  colors?: Record<string, string>;
  relation?: {
    dataset: string;
    project?: string;
    reverse?: { name?: string };
    reverseOf?: string;
  };
  formula?: { expression: string; kind?: string };
  rollup?: { relation: string; column?: string; aggregate: string };
  component?: {
    componentId: string;
    version: string;
    integrity?: string;
    scope?: string;
  };
  config?: Record<string, unknown>;
  kind?: import("../../datasets/value-types.mjs").ValueKind;
}
export type DatabaseValue = string | number | boolean | string[];
export interface DatabaseRow {
  id: string;
  [key: string]: DatabaseValue;
}
export interface DatabaseData extends BlockData {
  title: string;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  groupBy?: string;
  view?: DatabaseViewType;
  calendar?: DatabaseCalendarConfig;
  views?: DatabaseView[];
}
export type DatabaseViewType = "table" | "board" | "list" | "calendar";
export interface DatabaseView {
  id: string;
  name: string;
  type: DatabaseViewType;
  groupBy?: string;
  sort?: { column: string; direction: "asc" | "desc" } | null;
  sorts?: import("../../datasets/record-query.mjs").RecordSort[];
  filter?:
    | import("../../datasets/record-query.mjs").FilterGroup
    | import("../../datasets/record-query.mjs").LegacyFilter;
  columnWidths?: Record<string, number>;
}
export interface DatabaseCalendarConfig {
  dateColumn?: string;
  endDateColumn?: string;
  startTimeColumn?: string;
  endTimeColumn?: string;
  colorColumn?: string;
  doneColumn?: string;
  contextColumn?: string;
  mode?: "month" | "week" | "heatmap";
  initialDate?: string;
  weekStartsOn?: 0 | 1;
  weeks?: number;
}
