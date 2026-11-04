import type { ComponentSource } from "../components/custom/types";
import type { ShowDocument } from "../types";
/** Stage keys declared by schemaVersion 3 bundles. */
export type StagedTemplateStage = "intent" | "material" | "logic" | "design";
export type LegacyTemplateStage =
  | "intent"
  | "evidence"
  | "understanding"
  | "design"
  | "authoring"
  | "review";
export interface TemplateBundleSource {
  format: 1;
  files: Record<string, string>;
  assets?: Record<string, string>;
}
export interface TemplateBundleMetadata {
  format: "showai-template";
  schemaVersion: 1 | 2 | 3 | 4;
  id: string;
  name: string;
  version: string;
  description: string;
  scenarios: string[];
  /** Ordered Markdown paths for schemaVersion 4; stage maps for schemaVersion 1–3. */
  guides: string[] | Record<string, string | null>;
  components: { id: string; path: string }[];
  /** Legacy schemaVersion 1 only. */
  page?: string | null;
}
export interface ParsedTemplateBundle {
  metadata: TemplateBundleMetadata;
  body: string;
  /** Every guide in reading order; an Agent reads them whole. */
  guides: { path: string; markdown: string }[];
  components: { id: string; path: string; source: ComponentSource }[];
  document?: Partial<ShowDocument>;
  /** True for schemaVersion 1–2 six-stage bundles. */
  legacy: boolean;
  /** True for schemaVersion 1–3 bundles that declared stages. */
  staged: boolean;
  source: TemplateBundleSource;
}
export const STAGED_TEMPLATE_STAGES: readonly StagedTemplateStage[];
export const TEMPLATE_SCHEMA_VERSION: 4;
export const LEGACY_TEMPLATE_STAGES: readonly LegacyTemplateStage[];
export const SYSTEM_TEMPLATE_ID: "system-presentation";
export const TEMPLATE_WORKFLOW_CAPABILITIES: Readonly<{
  protocol: "showai-template-workflow-v3";
  bundleFormat: 1;
  schemaVersion: 4;
  legacySchemaVersions: number[];
  systemBaselineRequired: true;
  systemBaseline: string;
  guideDisclosure: "whole-template";
  contextBinding: string;
  directoryImport: string;
  portableBundleInput: string;
  compactResponses: string[];
}>;
export function templateFilePath(value: unknown): string;
export function declaredGuidePaths(metadata: TemplateBundleMetadata): string[];
export function parseTemplateReadme(source: unknown): {
  metadata: TemplateBundleMetadata;
  body: string;
};
export function parseTemplateBundle(source: unknown): ParsedTemplateBundle;
