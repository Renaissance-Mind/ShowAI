export type HostProfile =
  | "codex"
  | "claude"
  | "antigravity"
  | "deepseek"
  | "kimi"
  | "mcp-app";
export const HOST_PROFILES: Record<HostProfile, string>;
export const HOST_GUIDE: string;
export function skillFiles(root: string): Promise<Record<string, string>>;
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
  adapterSha256: string;
  entrySha256?: string;
}>;
export function writeHostLauncher(
  source: string,
  target: string,
  profile: HostProfile,
): Promise<void>;
export function publishPluginDirectory(staging: string, target: string): Promise<void>;
export function stageHostPlugin(options: {
  source: string;
  target: string;
  profile: "codex" | "claude" | "antigravity";
}): ReturnType<typeof bindHostSkills>;
