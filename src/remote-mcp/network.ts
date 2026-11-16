import { networkInterfaces } from "node:os";
import { isIPv4 } from "node:net";

export function isLanAddress(address: string) {
  if (!isIPv4(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export function lanAddresses() {
  return Object.entries(networkInterfaces()).flatMap(([name, addresses]) =>
    (addresses ?? [])
      .filter((entry) => !entry.internal && isLanAddress(entry.address))
      .map(({ address }) => ({ name, address })),
  );
}

type ServeConfig = {
  TCP?: Record<string, unknown>;
  Foreground?: Record<string, ServeConfig>;
};

export function tailscalePort(config: ServeConfig, preferred = 443) {
  const occupied = (value: ServeConfig, port: number): boolean =>
    !!value.TCP?.[port] ||
    Object.values(value.Foreground ?? {}).some((child) =>
      occupied(child, port),
    );
  const port = [...new Set([preferred, 443, 8443, 10000])].find(
    (candidate) => !occupied(config, candidate),
  );
  if (!port)
    throw new Error(
      "Tailscale HTTPS ports 443, 8443 and 10000 are already in use. Keep those services running and free a port before connecting ShowAI.",
    );
  return port;
}
