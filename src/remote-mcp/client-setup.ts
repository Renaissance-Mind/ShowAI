import type { PairingStatus } from "./types";

/** These are public discovery values, never OAuth client secrets or access tokens. */
export function oauthSetupValues(endpoint: string) {
  const url = new URL(endpoint);
  return {
    authorization: `${url.origin}/oauth/authorize`,
    token: `${url.origin}/oauth/token`,
    registration: `${url.origin}/oauth/register`,
    issuer: url.origin,
    resource: endpoint,
  };
}
export function pairingDisplay(
  receipt: { id?: string; expiresAt: string } | undefined,
  current: PairingStatus | undefined,
  now = Date.now(),
): "none" | "ready" | "used" | "expired" | "replaced" {
  if (!receipt) return "none";
  if (current?.id === receipt.id && current?.state === "used") return "used";
  if (
    current &&
    current.id !== receipt.id &&
    Date.parse(current.expiresAt) >= Date.parse(receipt.expiresAt)
  )
    return "replaced";
  return now >= Date.parse(receipt.expiresAt) ? "expired" : "ready";
}
