import type { ComponentType } from "react";

export type BlockData = Record<string, unknown>;
export interface BlockProps {
  data: BlockData;
  onChange?: (data: BlockData) => void;
  readOnly?: boolean;
}

export interface BlockDefinition {
  kind: string;
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
export type ColumnType = "text" | "number" | "select" | "checkbox" | "url";
export interface DatabaseColumn {
  id: string;
  name: string;
  type: ColumnType;
  options?: string[];
}
export interface DatabaseRow {
  id: string;
  [key: string]: string | number | boolean;
}
export interface DatabaseData extends BlockData {
  title: string;
  columns: DatabaseColumn[];
  rows: DatabaseRow[];
  groupBy?: string;
}
