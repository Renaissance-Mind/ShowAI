import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { test, expect } from "vitest";
import { McpAuthorization } from "../agent/mcp-auth";
import { startMcpHttpServer } from "../agent/mcp-http";
import { AgentService } from "../agent/service";
import { execute } from "../agent-host/process";
import { agentSetupPrompt } from "./client-setup";
import { localLibraryPolicy } from "./local-library";
import { validateRemoteMcpConfig } from "./manager";
import { PairingCodes } from "./pairing";
import { tailnetDeviceTransport } from "./tailnet-device";
import { defaultRemoteMcpConfig } from "./types";

test("new private connections select device approval and existing OAuth connections keep their method", () => {
  const config = defaultRemoteMcpConfig("tailscale-private");
  const endpoint = "https://mac.example.ts.net:8443/mcp";
  expect(validateRemoteMcpConfig(config).privateAuth).toBe("device");
  const legacy = validateRemoteMcpConfig({ ...config, privateAuth: undefined });
  expect(legacy.privateAuth).toBeUndefined();
  for (const locale of ["zh-CN", "en"] as const) {
    const prompt = agentSetupPrompt(endpoint, config, locale);
    expect(prompt).toContain("Grok Bot");
    expect(prompt).toContain("Command / stdio");
    expect(prompt).toContain(
      `npx --prefer-offline -y mcp-remote@0.16.6 ${endpoint} --transport http-only`,
    );
    expect(prompt).toContain("Streamable HTTP");
    expect(prompt).toContain("projects_list");
    expect(prompt).not.toMatch(
      /Bearer|OAuth|client_secret|--resource|--auth-timeout/i,
    );
  }
  expect(agentSetupPrompt(endpoint, legacy, "en")).toContain("loopback");
  expect(() =>
    validateRemoteMcpConfig({ ...config, provider: "tailscale" }),
  ).toThrow();
});

test("a LAN invitation needs a desktop decision; a locally held key can be revoked", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-invited-client-"));
  const codes = new PairingCodes();
  const library = join(root, "library");
  const project = await new AgentService({ root: library }).createProject(
    "Selected",
  );
  const config = {
    ...defaultRemoteMcpConfig("lan"),
    access: "selected" as const,
    projects: [{ id: project.id, write: false }],
  };
  const auth = await McpAuthorization.open(
    join(root, "auth"),
    "http://127.0.0.1",
    [],
    {
      ...localLibraryPolicy(library, config),
      accessKeyOnly: true,
      consumePairingCode: (code, binding) =>
        codes.consume(code, Date.now(), binding),
    },
  );
  try {
    const key = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(key).digest("hex");
    const issue = codes.issue();
    const prompt = agentSetupPrompt(
      "http://192.168.1.1:9100/mcp",
      config,
      "en",
      issue.code,
    );
    expect(prompt).not.toContain(key);
    expect(prompt).toContain(issue.code);
    await auth.enrollLan(issue.code, digest, "Desk agent");
    await expect(
      auth.enrollLan(issue.code, "0".repeat(64), "Other agent"),
    ).rejects.toThrow();
    expect(auth.connections()).toEqual([]);
    expect(() => auth.verify(key)).toThrow();
    expect(await auth.enrollLan(issue.code, digest, "Desk agent")).toBe(
      "pending",
    );
    expect(auth.pendingApprovals()).toHaveLength(1);
    const [request] = auth.pendingApprovals();
    expect(request.method).toBe("invitation");
    auth.decideApproval(request.id, "allow");
    expect(await auth.enrollLan(issue.code, digest, "Desk agent")).toBe(
      "approved",
    );
    const grant = auth.verify(key, "projects.read");
    expect(grant.projectIds).toEqual([project.id]);
    expect(() => auth.verify(key, "projects.write")).toThrow();
    auth.revoke(grant.id);
    await expect(
      auth.enrollLan(issue.code, digest, "Desk agent"),
    ).rejects.toThrow();
    expect(() => auth.verify(key)).toThrow();
  } finally {
    auth.close();
    await rm(root, { recursive: true, force: true });
  }
});

const executable = process.env.SHOWAI_TEST_TAILNET_DEVICE;
test.skipIf(!executable)(
  "two private HTTPS clients on a real Tailscale device share one local approval, survive restart, and lose access on revocation",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "showai-tailnet-device-"));
    const client = async (name: string, endpoint: string) => {
      const c = new Client({ name, version: "1" });
      await c.connect(
        new StreamableHTTPClientTransport(new URL(endpoint + "/mcp")),
      );
      return c;
    };
    const actors: Client[] = [];
    let server: Awaited<ReturnType<typeof startMcpHttpServer>> | undefined;
    try {
      const info = await execute(executable!, ["status", "--json"]);
      expect(info.code).toBe(0);
      const self = JSON.parse(info.stdout).Self;
      const transport = await tailnetDeviceTransport(executable!, self);
      const probe = createServer();
      await new Promise<void>((resolve, reject) =>
        probe.once("error", reject).listen(0, transport.addresses[0], resolve),
      );
      const address = probe.address();
      if (!address || typeof address === "string")
        throw new Error("Missing private test port.");
      await new Promise<void>((resolve, reject) =>
        probe.close((error) => (error ? reject(error) : resolve())),
      );
      const endpoint = `https://${self.DNSName.replace(/\.$/, "")}:${address.port}`;
      const library = join(root, "library"),
        service = new AgentService({ root: library });
      const visible = await service.createProject("Shared project"),
        hidden = await service.createProject("Private project");
      const options = {
        publicUrl: endpoint,
        port: address.port,
        stateDirectory: join(root, "state"),
        tailnet: transport,
        local: {
          root: library,
          ...localLibraryPolicy(library, {
            access: "selected",
            projects: [{ id: visible.id, write: false }],
          }),
          deviceApproval: true,
          consumePairingCode: () => false,
        },
      };
      server = await startMcpHttpServer(options);
      const [a, b] = await Promise.all([
        client("first", endpoint),
        client("second", endpoint),
      ]);
      actors.push(a, b);
      const [request] = server.authorization.pendingApprovals();
      expect(server.authorization.pendingApprovals()).toHaveLength(1);
      expect(request).toMatchObject({
        method: "device",
        scopes: ["projects.read"],
      });
      expect(server.authorization.connections()).toHaveLength(0);
      expect(
        (await fetch(endpoint + "/.well-known/oauth-authorization-server"))
          .status,
      ).toBe(404);
      const tools = await a.listTools();
      expect(
        tools.tools.find((tool) => tool.name === "projects_list")?._meta
          ?.securitySchemes,
      ).toEqual([{ type: "noauth" }]);
      const firstRead = a.callTool({ name: "projects_list", arguments: {} });
      expect(
        await Promise.race([
          firstRead.then(() => "completed"),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("pending"), 500),
          ),
        ]),
      ).toBe("pending");
      server.authorization.decideApproval(request.id, "allow");
      const result = await firstRead;
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result)).toContain(visible.id);
      expect(JSON.stringify(result)).not.toContain(hidden.id);
      expect(
        (
          await b.callTool({
            name: "project_create",
            arguments: { name: "outside grant" },
          })
        ).isError,
      ).toBe(true);
      const [grant] = server.authorization.connections();
      expect(grant.lastCallAt).toBeTruthy();
      await server.close();
      server = await startMcpHttpServer(options);
      expect(
        (await b.callTool({ name: "projects_list", arguments: {} })).isError,
      ).not.toBe(true);
      expect(server.authorization.pendingApprovals()).toHaveLength(0);
      server.authorization.revoke(grant.id);
      expect(
        (await b.callTool({ name: "projects_list", arguments: {} })).isError,
      ).toBe(true);
      expect(server.authorization.connections()).toHaveLength(0);
    } finally {
      await Promise.all(actors.map((actor) => actor.close()));
      await server?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  60000,
);
