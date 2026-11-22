export type HostProfile =
  | "codex"
  | "claude"
  | "antigravity"
  | "deepseek"
  | "kimi"
  | "mcp-app";
export const HOST_PROFILES: Record<HostProfile, string>;
export interface HostSetup {
  name: string;
  en: { install: string; features: string };
  zh: { install: string; features: string };
}
export function readHostSetup(source: string, profile: string): Promise<HostSetup>;
export function hostGuidance(source: string, profile: string, transport?: "local" | "remote" | "manual"): Promise<{
  files: Record<string, string>;
  readmes?: Record<string, string>;
}>;
export const HOST_GUIDE: string;
export const DELIVERY_WORKFLOWS: readonly string[];
export function workflowWithHostDelivery(file: string, workflow: string, adapter: string): string;
export const ANTIGRAVITY_EAGER_TOOLS: Record<
  "show_component",
  { eager: true }
>;
export function bindWorkflowDelivery(
  sourceSkills: string,
  targetSkills: string,
  adapter: string,
): Promise<Record<string, string>>;
export function skillFiles(root: string, options?: { includeHidden?: boolean }): Promise<Record<string, string>>;
export function bindHostSkills(options: {
  source: string;
  target: string;
  profile: HostProfile;
}): Promise<{
  protocol: string;
  profile: HostProfile;
  declaredHostDisplay: string;
  commonVersion: string;
  commonSha256: string;
  commonFiles: Record<string, string>;
  workflowFiles: Record<string, string>;
  adapterSha256: string;
  entrySha256?: string;
  connectionSha256?: string;
  runtimeSha256?: string;
}>;
export function writeHostLauncher(
  source: string,
  target: string,
  profile: HostProfile,
): Promise<void>;
export function publishPluginDirectory(staging: string, target: string): Promise<void>;
export function antigravityManifest(
  manifest: { name?: string; version: string },
  version?: string,
): Record<string, unknown>;
export function antigravitySidecarConfig(launch?: {
  command: string;
  env?: Record<string, string | undefined>;
}): Record<string, unknown>;
export function writeAntigravityAssets(options: {
  source: string;
  target: string;
  manifest: { name?: string; version: string };
  version?: string;
  launch?: { command: string; env?: Record<string, string | undefined> };
}): Promise<void>;
export function stageHostPlugin(options: {
  source: string;
  target: string;
  profile: "codex" | "claude" | "antigravity";
}): ReturnType<typeof bindHostSkills>;
