import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ComponentType,
} from "react";
import type {
  FormulaInputs,
  FormulaResults,
  RecordTable,
} from "../../datasets/derived-fields.mjs";
import type {
  TypedField,
  ValueType,
  ValueKind,
} from "../../datasets/value-types.mjs";

export interface FieldComponentRef {
  componentId: string;
  version: string;
  integrity?: string;
  scope?: string;
}
export interface FieldDisplay {
  text: string;
  tone?: string;
}
export interface FieldEditorProps {
  column: TypedField;
  value: unknown;
  onValue?: (value: unknown) => void;
  onClose: () => void;
}
export interface ContributedField {
  ref: FieldComponentRef;
  name: string;
  valueKind: ValueKind;
  valueType: ValueType;
  display(value: unknown, column: TypedField): FieldDisplay | undefined;
  Editor?: ComponentType<FieldEditorProps>;
}
export interface FieldTypeListing {
  ref: FieldComponentRef;
  name: string;
  valueKind: ValueKind;
  defaultConfig: Record<string, unknown>;
}
export interface DatasetListing {
  id: string;
  name: string;
}
export interface DatabaseHost {
  selfDataset?: string;
  datasets?: () => DatasetListing[] | undefined;
  related(datasetId: string): RecordTable | undefined;
  incoming?: (
    datasetId: string,
  ) => { datasetId: string; name?: string; value: unknown }[] | undefined;
  formulas?: (inputs: FormulaInputs) => Promise<FormulaResults>;
  precomputed?: {
    values: Record<string, Record<string, unknown>>;
    columns: TypedField[];
    titles: Record<string, Record<string, string>>;
  };
  fieldTypes?: () => FieldTypeListing[];
  field?: (column: TypedField) => ContributedField | undefined;
  subscribe(listener: () => void): () => void;
  version(): number;
}

export const DatabaseHostContext = createContext<DatabaseHost | null>(null);

const idle = () => () => {};
export function useDatabaseHost(): DatabaseHost | null {
  const host = useContext(DatabaseHostContext);
  useSyncExternalStore(
    host?.subscribe ?? idle,
    () => host?.version() ?? 0,
    () => host?.version() ?? 0,
  );
  return host;
}

export interface DerivedSnapshot {
  values?: Record<string, Record<string, unknown>>;
  columns?: TypedField[];
  titles?: Record<string, Record<string, string>>;
}
export const DERIVED_KEY = "$derived";

const frozen = { subscribe: idle, version: () => 0 };
export function snapshotHost(snapshot: unknown): DatabaseHost | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const value = snapshot as DerivedSnapshot;
  return {
    ...frozen,
    related: () => undefined,
    precomputed: {
      values: value.values ?? {},
      columns: Array.isArray(value.columns) ? value.columns : [],
      titles: value.titles ?? {},
    },
  };
}
