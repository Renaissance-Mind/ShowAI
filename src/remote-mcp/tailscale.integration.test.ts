import { expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { execute } from "../agent-host/process";
import { AgentService } from "../agent/service";
import { RemoteMcpManager } from "./manager";

const executable = process.env.SHOWAI_TEST_TAILSCALE;
async function request(input: string, init?: RequestInit) {
  const result = await fetch(input, {
    ...init,
    signal: AbortSignal.timeout(10000),
  });
  if (process.env.SHOWAI_TEST_EVIDENCE)
    await writeFile(
      join(process.env.SHOWAI_TEST_EVIDENCE, "tailscale-request-stage.json"),
      JSON.stringify({ path: new URL(input).pathname, status: result.status }),
    );
  return result;
}

test.skipIf(!executable).each(["tailscale-private", "tailscale"])(
  "real %s route preserves other services, completes HTTPS OAuth/MCP and closes its connector",
  async (provider) => {
    const directory = await mkdtemp(join(tmpdir(), "showai-tailnet-"));
    const service = new AgentService({ root: join(directory, "library") });
    const project = await service.createProject(
      "Tailscale transport acceptance",
    );
    const encryptionKey = randomBytes(32);
    const manager = new RemoteMcpManager({
      directory: join(directory, "profile"),
      home: () => service.store.root,
      encrypt: (value) => {
        const iv = randomBytes(16),
          cipher = createCipheriv("aes-256-cbc", encryptionKey, iv);
        return Buffer.concat([
          iv,
          cipher.update(value),
          cipher.final(),
        ]).toString("base64");
      },
      decrypt: (value) => {
        const bytes = Buffer.from(value, "base64"),
          cipher = createDecipheriv(
            "aes-256-cbc",
            encryptionKey,
            bytes.subarray(0, 16),
          );
        return Buffer.concat([
          cipher.update(bytes.subarray(16)),
          cipher.final(),
        ]).toString();
      },
    });
    const serving = async () => {
      const result = await execute(executable!, ["serve", "status", "--json"], {
        timeout: 10000,
      });
      expect(result.code).toBe(0);
      return JSON.parse(result.stdout || "{}");
    };
    const before = await serving();
    let client: Client | undefined;
    let localUrl: string | undefined;
    try {
      await manager.start({
        provider,
        executable,
        port: 0,
        publicUrl: "",
        access: "all",
        projects: [],
      });
      await expect
        .poll(async () => (await manager.status()).phase, { timeout: 70000 })
        .not.toBe("starting");
      const state = await manager.status();
      localUrl = state.localUrl;
      if (process.env.SHOWAI_TEST_EVIDENCE)
        await writeFile(
          join(process.env.SHOWAI_TEST_EVIDENCE, `${provider}-route.json`),
          JSON.stringify(state, null, 2),
        );
      expect(state.phase, state.error).toBe("running");
      expect(state.reachable, state.error).toBe(true);
      const origin = new URL(state.url!).origin,
        port = state.config.httpsPort!;
      const routes = await serving();
      const own = Object.values(routes.Foreground ?? {}).find((route) =>
        JSON.stringify(route).includes(state.localUrl!),
      ) as { AllowFunnel?: Record<string, boolean> } | undefined;
      expect(own).toBeTruthy();
      expect(Object.values(own!.AllowFunnel ?? {}).some(Boolean)).toBe(
        provider === "tailscale",
      );
      expect(new URL(state.url!).port || "443").toBe(String(port));
      for (const [id, route] of Object.entries(before.Foreground ?? {}))
        expect(routes.Foreground[id]).toEqual(route);
      const metadata = await request(
        origin + "/.well-known/oauth-authorization-server",
      ).then((r) => r.json());
      expect(metadata.issuer).toBe(origin);
      const redirect = "http://127.0.0.1:12345/callback";
      const registration = await request(origin + "/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Real Tailscale acceptance",
          redirect_uris: [redirect],
          token_endpoint_auth_method: "none",
        }),
      }).then((r) => r.json());
      const verifier = randomBytes(32).toString("base64url");
      const authorization = await request(
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
            scope: "projects.read projects.write projects.create",
            resource: state.url!,
          }),
      );
      const html = await authorization.text(),
        flow = html.match(/name="flow" value="([^"]+)"/)![1],
        csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
      manager.decide(flow, "allow");
      const consent = await request(origin + "/oauth/consent", {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin,
          cookie: authorization.headers.get("set-cookie")!.split(";")[0],
        },
        body: new URLSearchParams({ flow, csrf, decision: "allow" }),
      });
      expect(consent.status).toBe(302);
      const token = await request(origin + "/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: registration.client_id,
          grant_type: "authorization_code",
          code: new URL(consent.headers.get("location")!).searchParams.get(
            "code",
          )!,
          redirect_uri: redirect,
          code_verifier: verifier,
          resource: state.url!,
        }),
      }).then((r) => r.json());
      client = new Client({ name: "real-tailnet-client", version: "1" });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(state.url!), {
          fetch: async (input, init) => {
            const response = await fetch(input, {
              ...init,
              signal: AbortSignal.any([
                AbortSignal.timeout(15000),
                ...(init?.signal ? [init.signal] : []),
              ]),
            });
            return response;
          },
          requestInit: {
            headers: { authorization: `Bearer ${token.access_token}` },
          },
        }),
      );
      const created = await client.callTool({
        name: "page_create",
        arguments: {
          projectId: project.id,
          title: "Saved through Tailscale",
          blocks: [
            {
              kind: "text",
              data: {
                format: "markdown",
                content: "Real TLS, PKCE authorization and MCP.",
              },
            },
          ],
        },
      });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      expect(JSON.stringify(await service.listPages(project.id))).toContain(
        "Saved through Tailscale",
      );
      if (process.env.SHOWAI_TEST_EVIDENCE)
        await writeFile(
          join(process.env.SHOWAI_TEST_EVIDENCE, `${provider}-roundtrip.json`),
          JSON.stringify(
            {
              passed: true,
              oauth: true,
              localSave: true,
              private: provider === "tailscale-private",
              port,
              preservedExistingRoutes: true,
            },
            null,
            2,
          ),
        );
    } finally {
      await client?.close();
      await manager.stop();
      const after = await serving();
      if (localUrl) {
        expect(JSON.stringify(after)).not.toContain(localUrl);
        await expect(
          fetch(localUrl + "/health", { signal: AbortSignal.timeout(1000) }),
        ).rejects.toThrow();
      }
      for (const [id, route] of Object.entries(before.Foreground ?? {}))
        expect(after.Foreground?.[id]).toEqual(route);
      await rm(directory, { recursive: true, force: true });
    }
  },
  90000,
);
