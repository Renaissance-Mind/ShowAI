import type { ShowDocument } from "../../types";

export type CatalogScope = "builtin" | "user" | "project";
export type JsonSchema = Record<string, unknown> | boolean;

export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  scope: CatalogScope;
  updatedAt: string;
}

export interface TemplateRecord extends TemplateMetadata {
  document: ShowDocument;
}

export interface ComponentExample {
  name: string;
  data: Record<string, unknown>;
}

/** User packages contain manifest.json, props.schema.json and a local React entry. */
export interface ComponentManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  scenarios: string[];
  entry: string;
  defaultData: Record<string, unknown>;
  examples: ComponentExample[];
}

export interface ComponentMetadata extends ComponentManifest {
  scope: CatalogScope;
  integrity: string;
  updatedAt: string;
}

/** Browser-safe portable payload; a page stores only the component reference and props. */
export interface CompiledComponent extends ComponentMetadata {
  html: string;
  schema: JsonSchema;
  /** Mount code for an already sandboxed conversation host; never used by desktop. */
  inline?: { script: string; styles: string };
}

export interface ComponentSource {
  manifest: ComponentManifest;
  schema: JsonSchema;
  source: string;
  files: Record<string, string>;
  /** Base64-encoded local images/fonts preserved when saving an edited version. */
  assets?: Record<string, string>;
}

export interface BuiltinComponentMetadata {
  kind: string;
  name: string;
  description: string;
  scenarios: string[];
  defaultData: Record<string, unknown>;
  propsSchema: JsonSchema;
  examples: ComponentExample[];
}

export interface CustomComponentRef {
  componentId: string;
  version: string;
  integrity?: string;
}

export interface CustomBlockData extends CustomComponentRef {
  props: Record<string, unknown>;
}

/** The only SDK available to custom React components. No host or filesystem API. */
export interface CustomComponentProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  data: T;
  onChange?: (data: T) => void;
  readOnly: boolean;
}
