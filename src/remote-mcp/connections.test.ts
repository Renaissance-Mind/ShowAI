import { test, expect } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AgentService } from "../agent/service";
import { RemoteMcpManager } from "./manager";
import { RemoteMcpConnections } from "./connections";
import { defaultRemoteMcpConfig } from "./types";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "showai-remote-connections-")),
    service = new AgentService({ root: join(root, "library") }),
    key = randomBytes(32);
  await service.createProject("Independent connection permissions");
  const options = {
    directory: join(root, "profile"),
    home: () => service.store.root,
    encrypt(value: string) {
      const iv = randomBytes(16),
        cipher = createCipheriv("aes-256-cbc", key, iv);
      return Buffer.concat([iv, cipher.update(value), cipher.final()]).toString(
        "base64",
      );
    },
    decrypt(value: string) {
      const bytes = Buffer.from(value, "base64"),
        decipher = createDecipheriv("aes-256-cbc", key, bytes.subarray(0, 16));
      return Buffer.concat([
        decipher.update(bytes.subarray(16)),
        decipher.final(),
      ]).toString();
    },
  };
  return { root, options, pool: new RemoteMcpConnections(options) };
}
test("each provider retains its configuration and encrypted credential across pool recreation", async () => {
  const { root, pool, options } = await fixture();
  try {
    await pool.configure(
      {
        ...defaultRemoteMcpConfig("cloudflare"),
        publicUrl: "https://private.example",
        port: 18794,
      },
      "only-for-domain",
    );
    await pool.configure({
      ...defaultRemoteMcpConfig("lan"),
      bindAddress: "192.168.40.2",
      port: 18793,
    });
    await pool.configure({
      ...defaultRemoteMcpConfig("tailscale-private"),
      httpsPort: 8443,
    });
    const restored = new RemoteMcpConnections(options);
    try {
      expect((await restored.status(false, "lan")).config).toMatchObject({
        provider: "lan",
        bindAddress: "192.168.40.2",
        port: 18793,
      });
      expect(
        (await restored.status(false, "cloudflare")).config.publicUrl,
      ).toBe("https://private.example");
      expect((await restored.status(false, "cloudflare")).tokenSaved).toBe(
        true,
      );
      expect((await restored.status(false, "lan")).tokenSaved).toBe(false);
      expect(
        (await restored.status(false, "tailscale-private")).config.httpsPort,
      ).toBe(8443);
      expect((await restored.status(false, "tailscale")).config.httpsPort).toBe(
        443,
      );
      const saved = await readFile(
        join(options.directory, "connections/cloudflare/config.json"),
        "utf8",
      );
      expect(saved).not.toContain("only-for-domain");
    } finally {
      await restored.suspend();
    }
  } finally {
    await pool.suspend();
    await rm(root, { recursive: true, force: true });
  }
});
test("legacy configuration and credentials keep their original directory when other profiles are added", async () => {
  const { root, options, pool } = await fixture(),
    legacy = new RemoteMcpManager(options);
  try {
    await legacy.configure(
      {
        ...defaultRemoteMcpConfig("cloudflare"),
        publicUrl: "https://legacy.example",
      },
      "legacy-token",
    );
    await pool.configure({
      ...defaultRemoteMcpConfig("tailscale-private"),
      httpsPort: 8443,
    });
    expect((await pool.status(false, "cloudflare")).tokenSaved).toBe(true);
    expect((await pool.status(false, "cloudflare")).config.publicUrl).toBe(
      "https://legacy.example",
    );
    expect(
      JSON.parse(await readFile(join(options.directory, "config.json"), "utf8"))
        .config.provider,
    ).toBe("cloudflare");
    expect(
      JSON.parse(
        await readFile(join(options.directory, "connections.json"), "utf8"),
      ).legacyProvider,
    ).toBe("cloudflare");
  } finally {
    await legacy.suspend();
    await pool.suspend();
    await rm(root, { recursive: true, force: true });
  }
});
test("independent real HTTP listeners coexist and stopping one preserves the other", async () => {
  const { root, pool } = await fixture();
  try {
    const first = await pool.prepare({
      ...defaultRemoteMcpConfig("cloudflare"),
      publicUrl: "https://first.example",
    });
    const second = await pool.prepare(
      defaultRemoteMcpConfig("cloudflare-quick"),
    );
    expect(first.localUrl).not.toBe(second.localUrl);
    const health = (url: string) =>
      fetch(url + "/health").then((response) => response.json());
    expect((await health(first.localUrl!)).instanceId).not.toBe(
      (await health(second.localUrl!)).instanceId,
    );
    await pool.stop("cloudflare");
    await expect(fetch(first.localUrl! + "/health")).rejects.toThrow();
    expect((await pool.status(false, "cloudflare-quick")).phase).toBe(
      "prepared",
    );
    expect((await health(second.localUrl!)).ok).toBe(true);
  } finally {
    await pool.suspend();
    await rm(root, { recursive: true, force: true });
  }
});
