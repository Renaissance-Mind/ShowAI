export interface RemoteApprovalRequest {
  id: string;
  code: string;
  clientName: string;
  callbackOrigin: string;
  scopes: string[];
  access: "all" | "selected";
  createdAt: string;
  expiresAt: string;
}
export type RemoteMcpProvider = "cloudflare-quick" | "cloudflare" | "tailscale";
export interface PairingStatus {
  id: string;
  expiresAt: string;
  state: "ready" | "used" | "expired";
}
export interface RemoteMcpConfig {
  provider: RemoteMcpProvider;
  publicUrl: string;
  port: number;
  executable: string;
  access?: "all" | "selected";
  chatgptAppId?: string;
  chatgptEndpoint?: string;
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
  pairing?: PairingStatus;
  resumeOnLaunch?: boolean;
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
  "remoteMcp:requests",
  "remoteMcp:decide",
  "remoteMcp:exportPlugin",
  "remoteMcp:revoke",
  "remoteMcp:chooseExecutable",
]);
