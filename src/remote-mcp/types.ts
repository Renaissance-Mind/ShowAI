export interface RemoteApprovalRequest {
  provider?: RemoteMcpProvider;
  id: string;
  code: string;
  clientName: string;
  callbackOrigin: string;
  scopes: string[];
  access: "all" | "selected";
  createdAt: string;
  expiresAt: string;
}
export type RemoteMcpProvider =
  "lan" | "tailscale-private" | "cloudflare-quick" | "cloudflare" | "tailscale";
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
  bindAddress?: string;
  httpsPort?: number;
  access?: "all" | "selected";
  chatgptAppId?: string;
  chatgptEndpoint?: string;
  projects: Array<{ id: string; write: boolean }>;
}
export interface RemoteMcpStatus {
  approval?: { decision: "allow" | "deny"; clientName: string; at: string };
  configured?: boolean;
  connections?: RemoteMcpConnectionSummary[];
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
    lastCallAt?: string;
  }>;
  projects: Array<{ id: string; name: string }>;
  executables: { cloudflare: string | null; tailscale: string | null };
  addresses: Array<{ name: string; address: string }>;
}
export interface RemoteMcpConnectionSummary {
  provider: RemoteMcpProvider;
  phase: RemoteMcpStatus["phase"];
  configured: boolean;
  enabled: boolean;
  config: RemoteMcpConfig;
  url?: string;
  reachable?: boolean;
  checkedAt?: string;
  tokenSaved?: boolean;
  clients: number;
  error?: string;
}
export const remoteMcpProviders: RemoteMcpProvider[] = [
  "lan",
  "tailscale-private",
  "tailscale",
  "cloudflare-quick",
  "cloudflare",
];
export function defaultRemoteMcpConfig(
  provider: RemoteMcpProvider,
): RemoteMcpConfig {
  return {
    provider,
    publicUrl: "",
    port: 0,
    access: "all",
    executable: "",
    projects: [],
    ...(provider === "tailscale-private"
      ? { httpsPort: 8443 }
      : provider === "tailscale"
        ? { httpsPort: 443 }
        : {}),
  };
}
export const remoteMcpActions = new Set([
  "remoteMcp:configure",
  "remoteMcp:installCloudflare",
  "remoteMcp:status",
  "remoteMcp:prepare",
  "remoteMcp:start",
  "remoteMcp:stop",
  "remoteMcp:check",
  "remoteMcp:createAccessKey",
  "remoteMcp:pair",
  "remoteMcp:requests",
  "remoteMcp:decide",
  "remoteMcp:exportPlugin",
  "remoteMcp:revoke",
  "remoteMcp:chooseExecutable",
]);
