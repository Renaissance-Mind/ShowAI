import type { ComponentType } from "react";

export type BlockData = Record<string, unknown>;
export interface BlockProps {
  data: BlockData;
  onChange?: (data: BlockData) => void;
  readOnly?: boolean;
  host?: import("../rich-text/RichText").RichTextHost;
  /** Placed inside a line of text (a mention); render as inline content. */
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
  /** Page columns: the folder that new linked pages go into. */
  folder?: string;
  /** Page columns: the text column kept equal to the linked page's title. */
  titleColumn?: string;
  /** Select and multi-select: a tone per option; others take one by position. */
  colors?: Record<string, string>;
  /** Relation columns: records of another dataset; reverseOf marks a derived reverse side. */
  relation?: {
    dataset: string;
    project?: string;
    reverse?: { name?: string };
    reverseOf?: string;
  };
  /** Formula columns: a JavaScript expression over prop("Name"), and its value kind. */
  formula?: { expression: string; kind?: string };
  /** Rollup columns: aggregate a field of the records a relation column links. */
  rollup?: { relation: string; column?: string; aggregate: string };
  /** Custom columns: the field type component and its settings. */
  component?: {
    componentId: string;
    version: string;
    integrity?: string;
    scope?: string;
  };
  config?: Record<string, unknown>;
  /** Custom columns: the component's value kind, kept so readers without it filter alike. */
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
  /** Named views; without them the component shows one view built from view and groupBy. */
  views?: DatabaseView[];
}
export type DatabaseViewType = "table" | "board" | "list" | "calendar";
export interface DatabaseView {
  id: string;
  name: string;
  type: DatabaseViewType;
  groupBy?: string;
  /** Saved before sort lists; read as a one-item `sorts`. */
  sort?: { column: string; direction: "asc" | "desc" } | null;
  sorts?: import("../../datasets/record-query.mjs").RecordSort[];
  /** A filter group; a {column, value} filter saved earlier reads as one condition. */
  filter?:
    | import("../../datasets/record-query.mjs").FilterGroup
    | import("../../datasets/record-query.mjs").LegacyFilter;
  /** Table widths in pixels by column id. */
  columnWidths?: Record<string, number>;
}
/** Calendar view settings; every column id is optional and resolved against columns. */
export interface DatabaseCalendarConfig {
  dateColumn?: string;
  endDateColumn?: string;
  startTimeColumn?: string;
  endTimeColumn?: string;
  colorColumn?: string;
  doneColumn?: string;
  /** Text or select column shown as a small line above each entry title, e.g. the project. */
  contextColumn?: string;
  mode?: "month" | "week" | "heatmap";
  initialDate?: string;
  weekStartsOn?: 0 | 1;
  weeks?: number;
}
