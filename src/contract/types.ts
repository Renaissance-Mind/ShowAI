import type { ShowDocument } from "../types";
import type { JSONContent } from "@tiptap/core";

export type CatalogScope = "builtin" | "global" | "published" | "project";
export type JsonSchema = Record<string, unknown> | boolean;

export interface PackageRevisionRef {
  kind: "component" | "template";
  id: string;
  version: string;
  integrity: string;
  scope?: CatalogScope;
  projectId?: string;
}
export interface CatalogReadOptions {
  scope?: CatalogScope | "all";
  version?: string;
  integrity?: string;
}
export interface RelatedPackage {
  kind: "component" | "template";
  id: string;
  version?: string;
  purpose: string;
}
export interface TemplateExample {
  name: string;
  request: string;
  steps: RelatedPackage[];
}
export type TemplatePart =
  | {
      type: "content";
      content: JSONContent;
      layout?: ShowDocument["layout"];
      views?: ShowDocument["views"];
      surfaceViews?: ShowDocument["surfaceViews"];
    }
  | { type: "template"; ref: PackageRevisionRef; title?: string };
export type TemplatePartInput =
  | {
      type: "content";
      content: JSONContent;
      layout?: ShowDocument["layout"];
      views?: ShowDocument["views"];
      surfaceViews?: ShowDocument["surfaceViews"];
    }
  | {
      type: "template";
      ref: Omit<PackageRevisionRef, "integrity"> & { integrity?: string };
      title?: string;
    };

export interface TemplateMetadata {
  id: string;
  name: string;
  description: string;
  scope: CatalogScope;
  updatedAt: string;
  version: string;
  integrity: string;
  scenarios: string[];
  contentGuide: { title: string; instructions: string[] }[];
  related: RelatedPackage[];
  examples: TemplateExample[];
  dependencies: PackageRevisionRef[];
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
  legacy?: boolean;
  workflow?: {
    format: 1;
    stages?: (
      | import("../portable/template-bundle.mjs").StagedTemplateStage
      | import("../portable/template-bundle.mjs").LegacyTemplateStage
    )[];
    components: { id: string; ref: PackageRevisionRef }[];
  };
}

export interface TemplateRecord extends TemplateMetadata {
  document: ShowDocument;
  composition?: TemplatePart[];
  bundle?: import("../portable/template-bundle.mjs").TemplateBundleSource;
}

export interface SaveTemplateInput {
  id?: string;
  version?: string;
  name?: string;
  description?: string;
  bundle?: import("../portable/template-bundle.mjs").TemplateBundleSource;
  document?: ShowDocument;
  scenarios?: string[];
  contentGuide?: { title: string; instructions: string[] }[];
  related?: RelatedPackage[];
  examples?: TemplateExample[];
  composition?: TemplatePartInput[];
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

export interface ComponentExample {
  name: string;
  data: Record<string, unknown>;
  request?: string;
  description?: string;
}

export type ComponentCategory =
  | "text"
  | "image"
  | "table"
  | "data"
  | "flow"
  | "surface"
  | "outline"
  | "other";

export interface ComponentManifest {
  contract?: import("./component-contract.mjs").ComponentContract;
  role?: "page-outline";
  pageOutlineProtocol?: 1;
  documentation?: import("./documentation").ComponentDocumentation;
  id: string;
  name: string;
  version: string;
  description: string;
  category?: ComponentCategory;
  scenarios: string[];
  effects?: string[];
  contributes?: import("./contributions").ComponentContributions;
  dependencies?: PackageRevisionRef[];
  entry: string;
  reader?: "readData";
  pageReferences?: true;
  defaultData: Record<string, unknown>;
  examples: ComponentExample[];
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

export interface ComponentMetadata extends ComponentManifest {
  scope: CatalogScope;
  integrity: string;
  updatedAt: string;
  signature?: string;
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

export interface ComponentListing extends Omit<
  ComponentMetadata,
  "defaultData" | "examples"
> {
  examples: Omit<ComponentExample, "data">[];
}

export interface CompiledComponent extends ComponentMetadata {
  presentationOnly?: "inline";
  html: string;
  schema: JsonSchema;
  inline?: { protocol?: number; script: string; styles: string };
}

export interface ComponentSource {
  manifest: ComponentManifest;
  schema: JsonSchema;
  source: string;
  files: Record<string, string>;
  assets?: Record<string, string>;
  parents?: PackageRevisionRef[];
  mergeBase?: PackageRevisionRef;
}

export interface BuiltinComponentMetadata {
  contract?: import("./component-contract.mjs").ComponentContract;
  documentation?: import("./documentation").ComponentDocumentation;
  insertion?:
    | { nodeType: "surface"; surfaceKind: "page" | "board" }
    | { nodeType: "region" };
  kind: string;
  replacedBy?: string;
  name: string;
  description: string;
  scenarios: string[];
  effects?: string[];
  contributes?: import("./contributions").ComponentContributions;
  version?: string;
  defaultData: Record<string, unknown>;
  propsSchema: JsonSchema;
  examples: ComponentExample[];
  conversation?: InlineReadiness;
  pageReferences?: true;
}

export interface InlineReadiness {
  status: "ready" | "limited" | "unsuitable";
  note?: string;
}

export interface CustomComponentRef {
  componentId: string;
  version: string;
  integrity?: string;
  scope?: CatalogScope;
}

export interface CustomBlockData extends CustomComponentRef {
  contract?: import("./component-contract.mjs").ComponentContract;
  props: Record<string, unknown>;
}

export interface PackageBundle {
  format: "showai-catalog-bundle";
  version: 1;
  root: PackageRevisionRef;
  components: { component: CompiledComponent; source?: ComponentSource }[];
  templates: TemplateRecord[];
}
export type EditablePackage =
  | ({ kind: "component" } & ComponentSource)
  | { kind: "template"; template: SaveTemplateInput };
export interface MergeConflict {
  path: string;
  kind: "text" | "value";
  base?: unknown;
  ours?: unknown;
  theirs?: unknown;
}
export interface PackageMergeInput {
  projectId: string;
  base: PackageRevisionRef;
  ours: PackageRevisionRef;
  theirs: PackageRevisionRef;
}
export interface PackageMergePreview extends PackageMergeInput {
  kind: "component" | "template";
  merged: EditablePackage;
  conflicts: MergeConflict[];
}

export interface CustomComponentProps<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  data: T;
  onChange?: (data: T) => void;
  readOnly: boolean;
  runtime?: import("./component-runtime.mjs").ComponentRuntime;
  dataState?: ReturnType<
    typeof import("../lib/component-editability.mjs").componentDataState
  >;
  inline?: boolean;
  goTo?: (target: unknown) => boolean;
  activationTargets?: readonly import("./component-contract.mjs").ComponentObject[];
  onActivate?: (
    target: import("./component-contract.mjs").ComponentObject,
  ) => boolean;
  viewState?: unknown;
  onViewState?: (value: unknown) => void;
  context?: import("./component-context.mjs").ComponentContextSnapshot;
  onContext?: (
    snapshot: import("./component-context.mjs").ComponentContextSnapshot,
  ) => boolean;
}

export type {
  PageOutlineComponentProps,
  PageOutlineItem,
  PageOutlineData,
} from "../document/page-outline.mjs";
