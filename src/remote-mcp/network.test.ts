import { expect, test } from "vitest";
import { isLanAddress, tailscalePort } from "./network";
import { validateRemoteMcpConfig } from "./manager";

test("LAN listeners accept private interface addresses and preserve existing Funnel configurations", () => {
  for (const address of [
    "10.0.0.2",
    "172.16.0.1",
    "192.168.50.12",
    "169.254.1.2",
  ])
    expect(isLanAddress(address)).toBe(true);
  for (const address of [
    "127.0.0.1",
    "0.0.0.0",
    "100.83.192.74",
    "8.8.8.8",
    "192.168.999.1",
    "device.local",
  ])
    expect(isLanAddress(address)).toBe(false);
  const saved = {
    provider: "tailscale",
    publicUrl: "",
    port: 0,
    executable: "",
    projects: [],
  };
  expect(validateRemoteMcpConfig(saved).provider).toBe("tailscale");
  expect(
    validateRemoteMcpConfig({ ...saved, provider: "tailscale-private" })
      .provider,
  ).toBe("tailscale-private");
  expect(() =>
    validateRemoteMcpConfig({
      ...saved,
      provider: "lan",
      bindAddress: "0.0.0.0",
    }),
  ).toThrow();
});

test("Serve and Funnel reserve unused HTTPS ports without replacing other foreground or background routes", () => {
  expect(tailscalePort({})).toBe(443);
  expect(tailscalePort({ TCP: { "443": {} } })).toBe(8443);
  expect(
    tailscalePort({ Foreground: { existing: { TCP: { "443": {} } } } }),
  ).toBe(8443);
  expect(
    tailscalePort({
      TCP: { "443": {} },
      Foreground: { existing: { TCP: { "8443": {} } } },
    }),
  ).toBe(10000);
  expect(tailscalePort({}, 10000)).toBe(10000);
  expect(() =>
    tailscalePort({ TCP: { "443": {}, "8443": {}, "10000": {} } }),
  ).toThrow(/already in use/);
});
