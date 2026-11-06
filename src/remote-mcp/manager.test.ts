import { expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { RemoteMcpManager, validateRemoteMcpConfig } from "./manager";
import { AgentService } from "../agent/service";
import { installCloudflared } from "./install";
import { execute } from "../agent-host/process";

test("remote configuration accepts only explicit provider, local port, project IDs and HTTPS origin", () => {
  const config = {
    provider: "cloudflare",
    publicUrl: "https://device.example.com/mcp",
    port: 18789,
    executable: "",
    projects: [{ id: "test-project", write: false }],
  };
  expect(validateRemoteMcpConfig(config).publicUrl).toBe(
    "https://device.example.com",
  );
  for (const publicUrl of [
    "http://example.com",
    "https://secret@example.com",
    "https://example.com/path",
    "https://example.com/?token=secret",
  ])
    expect(() => validateRemoteMcpConfig({ ...config, publicUrl })).toThrow();
  expect(() =>
    validateRemoteMcpConfig({
      ...config,
      projects: [{ id: "../other", write: true }],
    }),
  ).toThrow();
  expect(() => validateRemoteMcpConfig({ ...config, port: 0 })).toThrow();
});

test.skipIf(!process.env.SHOWAI_TEST_DOWNLOAD)(
  "downloads, verifies and runs the official connector without a system installation",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "showai-connector-install-"),
    );
    try {
      const executable = await installCloudflared(directory);
      const result = await execute(executable, ["--version"], {
        timeout: 10000,
      });
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("cloudflared version");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);

test.skipIf(!process.env.SHOWAI_TEST_CLOUDFLARED)(
  "real Cloudflare Quick connector serves the local MCP and closes its process and listener",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "showai-quick-tunnel-"));
    const key = randomBytes(32);
    const service = new AgentService({ root: join(directory, "library") });
    const project = await service.createProject(
      "Remote MCP transport acceptance",
    );
    const manager = new RemoteMcpManager({
      directory: join(directory, "profile"),
      home: () => service.store.root,
      encrypt: (value) => {
        const iv = randomBytes(16);
        const cipher = createCipheriv("aes-256-cbc", key, iv);
        return Buffer.concat([
          iv,
          cipher.update(value),
          cipher.final(),
        ]).toString("base64");
      },
      decrypt: (value) => {
        const bytes = Buffer.from(value, "base64");
        const cipher = createDecipheriv(
          "aes-256-cbc",
          key,
          bytes.subarray(0, 16),
        );
        return Buffer.concat([
          cipher.update(bytes.subarray(16)),
          cipher.final(),
        ]).toString();
      },
    });
    let localUrl: string | undefined;
    try {
      await manager.start({
        provider: "cloudflare-quick",
        publicUrl: "",
        port: 18796,
        executable: process.env.SHOWAI_TEST_CLOUDFLARED,
        projects: [{ id: project.id, write: true }],
      });
      const deadline = Date.now() + 65000;
      let status = await manager.status();
      while (
        (status.phase === "starting" ||
          (status.phase === "running" && status.reachable === undefined)) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        status = await manager.status();
      }
      localUrl = status.localUrl;
      if (process.env.SHOWAI_TEST_EVIDENCE)
        await writeFile(
          join(process.env.SHOWAI_TEST_EVIDENCE, "quick-tunnel.json"),
          JSON.stringify(status, null, 2),
        );
      expect(status.phase, status.error).toBe("running");
      expect(status.reachable, status.error).toBe(true);
      const response = await fetch(status.url!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "public-transport-acceptance", version: "1" },
          },
        }),
        signal: AbortSignal.timeout(15000),
      });
      const readJson = async (response: Response, stage: string) => {
        const body = await response.text();
        if (!response.headers.get("content-type")?.includes("application/json"))
          throw new Error(
            `${stage}: HTTP ${response.status}; ${body.slice(0, 600)}`,
          );
        return JSON.parse(body);
      };
      expect(response.ok).toBe(true);
      expect(
        (await readJson(response, "initialize")).result.serverInfo.name,
      ).toBe("showai");
      const origin = new URL(status.url!).origin;
      const post = (path: string, body: Record<string, string>) =>
        fetch(origin + path, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(body),
          signal: AbortSignal.timeout(20000),
        });
      const redirect = "http://127.0.0.1:12345/callback";
      const registrationResponse = await fetch(origin + "/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Public transport acceptance",
          redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
        }),
        signal: AbortSignal.timeout(20000),
      });
      expect(registrationResponse.status).toBe(201);
      const registration = await readJson(registrationResponse, "register");
      const verifier = randomBytes(32).toString("base64url");
      const authorization = await fetch(
        origin +
          "/oauth/authorize?" +
          new URLSearchParams({
            client_id: registration.client_id,
            redirect_uri: redirect,
            response_type: "code",
            code_challenge_method: "S256",
            code_challenge: createHash("sha256")
              .update(verifier)
              .digest("base64url"),
            scope: "projects.read projects.write",
            resource: status.url!,
          }),
        { signal: AbortSignal.timeout(20000) },
      );
      const form = await authorization.text();
      expect(authorization.status).toBe(200);
      const consent = await fetch(origin + "/oauth/consent", {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin,
          cookie: authorization.headers.get("set-cookie")!.split(";")[0],
        },
        body: new URLSearchParams({
          flow: form.match(/name="flow" value="([^"]+)"/)![1],
          csrf: form.match(/name="csrf" value="([^"]+)"/)![1],
          decision: "allow",
          pairingCode: manager.pair().code,
        }),
      });
      expect(consent.status).toBe(302);
      const authorizationCode = new URL(
        consent.headers.get("location")!,
      ).searchParams.get("code")!;
      const tokens = await readJson(
        await post("/oauth/token", {
          client_id: registration.client_id,
          grant_type: "authorization_code",
          code: authorizationCode,
          redirect_uri: redirect,
          code_verifier: verifier,
          resource: status.url!,
        }),
        "token",
      );
      const mcp = new Client({ name: "public-roundtrip", version: "1" });
      try {
        await mcp.connect(
          new StreamableHTTPClientTransport(new URL(status.url!), {
            requestInit: {
              headers: { authorization: `Bearer ${tokens.access_token}` },
            },
          }),
        );
        const created = await mcp.callTool({
          name: "page_create",
          arguments: {
            projectId: project.id,
            title: "Saved through public tunnel",
            blocks: [
              {
                kind: "text",
                data: {
                  format: "markdown",
                  content: "A real public HTTPS OAuth and MCP round trip.",
                },
              },
            ],
          },
        });
        expect(created.isError, JSON.stringify(created)).not.toBe(true);
        expect(JSON.stringify(await service.listPages(project.id))).toContain(
          "Saved through public tunnel",
        );
        const receipt = await manager.status();
        expect(receipt.lastCallAt).toBeTruthy();
        expect(receipt.clients).toHaveLength(1);
        if (process.env.SHOWAI_TEST_EVIDENCE)
          await writeFile(
            join(process.env.SHOWAI_TEST_EVIDENCE, "quick-roundtrip.json"),
            JSON.stringify(
              {
                passed: true,
                publicOAuth: true,
                localPageSaved: true,
                clientRecorded: true,
                at: receipt.lastCallAt,
              },
              null,
              2,
            ),
          );
      } finally {
        await mcp.close();
      }
    } finally {
      const status = await manager.stop();
      expect(status.phase).toBe("stopped");
      expect(status.localUrl).toBeUndefined();
      if (localUrl)
        await expect(
          fetch(localUrl + "/health", { signal: AbortSignal.timeout(1000) }),
        ).rejects.toThrow();
      await rm(directory, { recursive: true, force: true });
    }
  },
  90000,
);
