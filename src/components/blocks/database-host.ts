// What the harness offers a database beyond its own data: the records of
// related datasets, relations pointing at its dataset, formula evaluation in
// the transform runtime and field types that library components contribute.
// The workbench provides a live host; exported readers build a fixed one from
// the `$derived` snapshot the exporter computed. Without either, relation
// titles, rollups and formulas show what the data itself holds.
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
/** How a contributed field type shows one value: text and an optional option tone. */
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
/** A field type a library component contributes (contributes.databaseField). */
export interface ContributedField {
  ref: FieldComponentRef;
  name: string;
  valueKind: ValueKind;
  valueType: ValueType;
  /** undefined while the sandbox has not answered for this value yet. */
  display(value: unknown, column: TypedField): FieldDisplay | undefined;
  Editor?: ComponentType<FieldEditorProps>;
}
/** A contributed field type the column type menu can offer. */
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
  /** The dataset a bound database shows, for its reverse relations. */
  selfDataset?: string;
  /** Datasets a relation may point at. */
  datasets?: () => DatasetListing[] | undefined;
  /** Records of a related dataset; undefined while loading or unavailable. */
  related(datasetId: string): RecordTable | undefined;
  /** Datasets whose relations point at `datasetId` (for reverse columns). */
  incoming?: (
    datasetId: string,
  ) => { datasetId: string; name?: string; value: unknown }[] | undefined;
  formulas?: (inputs: FormulaInputs) => Promise<FormulaResults>;
  /** Derived values computed ahead of time (exported readers). */
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
/** The host, re-rendering when its related data or field types change. */
export function useDatabaseHost(): DatabaseHost | null {
  const host = useContext(DatabaseHostContext);
  useSyncExternalStore(
    host?.subscribe ?? idle,
    () => host?.version() ?? 0,
    () => host?.version() ?? 0,
  );
  return host;
}

/** The snapshot an exporter stores in `$derived` for readers without a host. */
export interface DerivedSnapshot {
  values?: Record<string, Record<string, unknown>>;
  columns?: TypedField[];
  titles?: Record<string, Record<string, string>>;
}
export const DERIVED_KEY = "$derived";

const frozen = { subscribe: idle, version: () => 0 };
/** A fixed host from an exported snapshot. */
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
