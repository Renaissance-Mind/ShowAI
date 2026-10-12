import type { ComponentSource } from "../components/custom/types";
import type { ShowDocument } from "../types";
export type TemplateStage =
  "intent" | "evidence" | "understanding" | "design" | "authoring" | "review";
export interface TemplateBundleSource {
  format: 1;
  files: Record<string, string>;
  assets?: Record<string, string>;
}
export interface TemplateBundleMetadata {
  format: "showai-template";
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description: string;
  scenarios: string[];
  guides: Record<TemplateStage, string | null>;
  components: { id: string; path: string }[];
  page: string | null;
}
export interface ParsedTemplateBundle {
  metadata: TemplateBundleMetadata;
  body: string;
  guides: Partial<Record<TemplateStage, { path: string; markdown: string }>>;
  components: { id: string; path: string; source: ComponentSource }[];
  document?: Partial<ShowDocument>;
  source: TemplateBundleSource;
}
export const TEMPLATE_STAGES: readonly TemplateStage[];
export const SYSTEM_TEMPLATE_ID: "system-presentation";
export const TEMPLATE_WORKFLOW_CAPABILITIES: Readonly<{
  protocol: "showai-template-workflow-v1";
  bundleFormat: 1;
  stages: readonly TemplateStage[];
  systemBaselineRequired: true;
  contextBinding: string;
  stageDisclosure: string;
  directoryImport: string;
  portableBundleInput: string;
  compactResponses: string[];
}>;
export function templateFilePath(value: unknown): string;
export function parseTemplateReadme(source: unknown): {
  metadata: TemplateBundleMetadata;
  body: string;
};
export function parseTemplateBundle(source: unknown): ParsedTemplateBundle;
