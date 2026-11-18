import { createHash, X509Certificate } from "node:crypto";
import { isIPv4, isIPv6 } from "node:net";
import type { Server as HttpsServer } from "node:https";
import { execute } from "../agent-host/process";

export interface TailnetPeer {
  binding: string;
  name: string;
  owner: string;
}

function tailnetAddress(value: string) {
  if (isIPv4(value)) {
    const [a, b] = value.split(".").map(Number);
    return a === 100 && b >= 64 && b <= 127 ? value : undefined;
  }
  if (isIPv6(value)) {
    const address = new URL(`http://[${value}]`).hostname.slice(1, -1);
    if (address.startsWith("fd7a:115c:a1e0:")) return address;
  }
}

export async function tailnetDeviceTransport(
  executable: string,
  self: { ID: string; DNSName: string; TailscaleIPs: string[] },
) {
  const hostname = self.DNSName.replace(/\.$/, "");
  const addresses = [
    ...new Set(
      self.TailscaleIPs?.map(tailnetAddress).filter((ip): ip is string => !!ip),
    ),
  ];
  if (!self.ID || !hostname.endsWith(".ts.net") || !addresses.length)
    throw new Error(
      "Tailscale has no private address or HTTPS name for this device.",
    );
  async function certificate() {
    const result = await execute(
      executable,
      ["cert", "--min-validity=24h", "--cert-file=-", "--key-file=-", hostname],
      { timeout: 45000 },
    );
    const cert = result.stdout.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );
    const key = result.stdout.match(
      /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/,
    )?.[0];
    if (
      result.code ||
      !cert?.length ||
      !key ||
      !new X509Certificate(cert[0]).checkHost(hostname)
    )
      throw new Error(
        "Tailscale could not supply a certificate for this device. Check that HTTPS is enabled for the tailnet.",
      );
    return { cert: cert.join("\n"), key, minVersion: "TLSv1.2" as const };
  }
  return {
    addresses,
    tls: await certificate(),
    renew(servers: HttpsServer[]) {
      const timer = setInterval(() => {
        void certificate()
          .then((options) => {
            for (const server of servers) server.setSecureContext(options);
          })
          .catch(() =>
            console.warn(
              "ShowAI could not renew its private Tailscale HTTPS certificate. It will retry in 12 hours.",
            ),
          );
      }, 12 * 3600_000);
      timer.unref();
      return () => clearInterval(timer);
    },
    async identify(address?: string): Promise<TailnetPeer | undefined> {
      const ip = address && tailnetAddress(address);
      if (!ip) return;
      const result = await execute(executable, ["whois", "--json", ip], {
        timeout: 5000,
      });
      if (result.code) return;
      const { Node: node, UserProfile: user } = JSON.parse(result.stdout);
      if (
        !node?.StableID ||
        !user?.ID ||
        !user.LoginName ||
        user.ID !== node.User ||
        !node.Addresses?.some(
          (prefix: string) => prefix === `${ip}/${isIPv4(ip) ? 32 : 128}`,
        )
      )
        return;
      return {
        binding: createHash("sha256")
          .update(JSON.stringify([self.ID, node.StableID, user.ID]))
          .digest("hex"),
        name: String(node.Name || node.StableID).replace(/\.$/, ""),
        owner: String(user.LoginName),
      };
    },
  };
}
export type TailnetDeviceTransport = Awaited<
  ReturnType<typeof tailnetDeviceTransport>
>;
