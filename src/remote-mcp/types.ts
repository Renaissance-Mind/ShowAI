export type RemoteMcpProvider = "cloudflare-quick" | "cloudflare" | "tailscale";
export interface RemoteMcpConfig {
  provider: RemoteMcpProvider;
  publicUrl: string;
  port: number;
  executable: string;
  access?: "all" | "selected";
  projects: Array<{ id: string; write: boolean }>;
}
export interface RemoteMcpStatus {
  phase: "stopped" | "prepared" | "starting" | "running" | "error";
  config: RemoteMcpConfig;
  tokenSaved: boolean;
  url?: string;
  localUrl?: string;
  error?: string;
  diagnostics?: string;
  checkedAt?: string;
  reachable?: boolean;
  lastCallAt?: string;
  lastCallClientId?: string;
  clients: Array<{
    id: string;
    name: string;
    projectIds: string[];
    scopes: string[];
  }>;
  projects: Array<{ id: string; name: string }>;
  executables: { cloudflare: string | null; tailscale: string | null };
}
export const remoteMcpActions = new Set([
  "remoteMcp:installCloudflare",
  "remoteMcp:status",
  "remoteMcp:prepare",
  "remoteMcp:start",
  "remoteMcp:stop",
  "remoteMcp:check",
  "remoteMcp:pair",
  "remoteMcp:revoke",
  "remoteMcp:chooseExecutable",
]);
