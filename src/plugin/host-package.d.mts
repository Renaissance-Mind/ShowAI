export type HostProfile = "codex" | "claude" | "deepseek" | "kimi" | "mcp-app";
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
}>;
export function stageHostPlugin(options: {
  source: string;
  target: string;
  profile: "codex" | "claude";
}): ReturnType<typeof bindHostSkills>;
