import type { ComponentSource } from "../contract/types";
import type { ShowDocument } from "../types";
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
  guides: string[] | Record<string, string | null>;
  components: { id: string; path: string }[];
  page?: string | null;
}
export interface ParsedTemplateBundle {
  metadata: TemplateBundleMetadata;
  body: string;
  guides: { path: string; markdown: string }[];
  components: { id: string; path: string; source: ComponentSource }[];
  document?: Partial<ShowDocument>;
  legacy: boolean;
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
