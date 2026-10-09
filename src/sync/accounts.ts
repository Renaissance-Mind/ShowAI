import type { SyncUser } from "./protocol";

export const accountCapability = "account-federation-v1";
export interface AccountIdentity {
  format: "showai-account-identity-v1";
  serverId: string;
  url: string;
  serverName: string;
  user: SyncUser;
  generation: string;
  publicKey: JsonWebKey;
}
export interface SignedIdentity {
  identity: AccountIdentity;
  signature: string;
}
export interface AccountBinding {
  descriptor: SignedIdentity;
  state: "active" | "removed";
  updatedAt: number;
  changeId: string;
}
export interface AccountProfile {
  own: SignedIdentity | null;
  peers: AccountBinding[];
}
export interface AccountGrant {
  format: "showai-account-grant-v1";
  issuer: { serverId: string; userId: string; generation: string };
  audience: { serverId: string; userId: string };
  deviceId: string;
  device: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}
export interface SignedGrant {
  grant: AccountGrant;
  signature: string;
}
export interface AccountResource {
  id: string;
  name: string;
  provider:
    "chatgpt" | "openrouter" | "deepseek" | "openai" | "moonshot" | "custom";
  baseUrl: string;
  model: string;
  protocol: "responses" | "chat";
  credential: "api-key" | "chatgpt";
  connected: boolean;
  account?: string;
  updatedAt: string;
  version: string;
  source: { serverId: string; serverName: string; url: string; user: SyncUser };
}
export interface ResolvedResource extends AccountResource {
  connectionId: string;
  resourceId: string;
  available: boolean;
  error?: string;
}
