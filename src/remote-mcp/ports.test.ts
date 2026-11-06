import { expect, test } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { RemoteMcpManager } from "./manager";
import { startMcpHttpServer } from "../agent/mcp-http";

test("occupied fixed-route ports allocate and reserve a free listener without stopping the owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-remote-port-"));
  const owner = createServer((_req, res) => res.end("existing owner"));
  await new Promise<void>((resolve) => owner.listen(0, "127.0.0.1", resolve));
  const address = owner.address();
  if (!address || typeof address === "string") throw new Error("No owner port");
  const key = randomBytes(32);
  const manager = new RemoteMcpManager({
    directory: join(directory, "profile"),
    home: () => join(directory, "library"),
    encrypt: (text) => {
      const iv = randomBytes(16),
        cipher = createCipheriv("aes-256-cbc", key, iv);
      return Buffer.concat([iv, cipher.update(text), cipher.final()]).toString(
        "base64",
      );
    },
    decrypt: (text) => {
      const bytes = Buffer.from(text, "base64"),
        cipher = createDecipheriv("aes-256-cbc", key, bytes.subarray(0, 16));
      return Buffer.concat([
        cipher.update(bytes.subarray(16)),
        cipher.final(),
      ]).toString();
    },
  });
  try {
    expect((await manager.status()).config).toMatchObject({
      access: "all",
      port: 0,
      projects: [],
    });
    const prepared = await manager.prepare({
      provider: "cloudflare",
      publicUrl: "",
      executable: "",
      projects: [],
      port: address.port,
    });
    expect(prepared.phase).toBe("prepared");
    expect(prepared.config.port).not.toBe(address.port);
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe(
      "existing owner",
    );
    expect((await fetch(prepared.localUrl + "/health")).status).toBe(200);
    const contender = createServer();
    const code = await new Promise<string>((resolve) => {
      contender.once("error", (error: NodeJS.ErrnoException) =>
        resolve(error.code!),
      );
      contender.listen(prepared.config.port, "127.0.0.1");
    });
    expect(code).toBe("EADDRINUSE");
    await manager.stop();
    await expect(fetch(prepared.localUrl + "/health")).rejects.toThrow();
    expect(await (await fetch(`http://127.0.0.1:${address.port}`)).text()).toBe(
      "existing owner",
    );
  } finally {
    await manager.stop();
    await new Promise<void>((resolve) => owner.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test("public-origin setup keeps the same bound socket and publishes matching OAuth metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-remote-origin-"));
  const server = await startMcpHttpServer({
    port: 0,
    stateDirectory: join(directory, "initial"),
  });
  try {
    const localUrl = server.localUrl;
    await server.configure({
      publicUrl: "https://device.example.com",
      stateDirectory: join(directory, "configured"),
    });
    expect(server.localUrl).toBe(localUrl);
    expect(server.url).toBe("https://device.example.com");
    const metadata = await fetch(
      localUrl + "/.well-known/oauth-protected-resource",
    ).then((r) => r.json());
    expect(metadata.resource).toBe("https://device.example.com/mcp");
    expect(metadata.authorization_servers).toEqual([
      "https://device.example.com",
    ]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
