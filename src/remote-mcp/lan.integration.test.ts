import { expect, test } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentService } from "../agent/service";
import { RemoteMcpManager } from "./manager";
import { lanAddresses } from "./network";

const address = lanAddresses()[0]?.address;
function options(directory: string) {
  const key = randomBytes(32);
  return {
    directory: join(directory, "profile"),
    home: () => join(directory, "library"),
    encrypt: (text: string) => {
      const iv = randomBytes(16),
        cipher = createCipheriv("aes-256-cbc", key, iv);
      return Buffer.concat([iv, cipher.update(text), cipher.final()]).toString(
        "base64",
      );
    },
    decrypt: (text: string) => {
      const bytes = Buffer.from(text, "base64"),
        cipher = createDecipheriv("aes-256-cbc", key, bytes.subarray(0, 16));
      return Buffer.concat([
        cipher.update(bytes.subarray(16)),
        cipher.final(),
      ]).toString();
    },
  };
}
async function ready(manager: RemoteMcpManager) {
  await expect
    .poll(async () => (await manager.status()).phase)
    .not.toBe("starting");
  const state = await manager.status();
  expect(state.phase, state.error).toBe("running");
  expect(state.reachable, state.error).toBe(true);
  return state;
}
async function client(url: string, token: string) {
  const c = new Client({ name: "real-lan-client", version: "1" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return c;
}

test.skipIf(!address)(
  "real LAN MCP saves pages with a revocable key, keeps keys through App restart, and releases its interface",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "showai-lan-"));
    const config = options(directory),
      manager = new RemoteMcpManager(config),
      resumed = new RemoteMcpManager(config);
    const service = new AgentService({ root: config.home() });
    const project = await service.createProject("LAN acceptance");
    let connection: Client | undefined, restored: Client | undefined;
    try {
      await manager.start({
        provider: "lan",
        bindAddress: address,
        publicUrl: "",
        port: 0,
        executable: "",
        access: "all",
        projects: [],
      });
      const state = await ready(manager),
        origin = new URL(state.url!).origin;
      expect(new URL(state.url!).hostname).toBe(address);
      expect(state.executables).toEqual({ cloudflare: null, tailscale: null });
      const initialize = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "unauthorized", version: "1" },
        },
      };
      const anonymous = await fetch(state.url!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(initialize),
      });
      expect(anonymous.status).toBe(401);
      expect(anonymous.headers.get("www-authenticate")).toBe(
        'Bearer realm="ShowAI"',
      );
      expect(
        (await fetch(origin + "/.well-known/oauth-authorization-server"))
          .status,
      ).toBe(404);
      await expect(manager.createAccessKey(" ")).rejects.toThrow();
      const receipt = await manager.createAccessKey("Linux workstation");
      expect(JSON.stringify(await manager.status())).not.toContain(
        receipt.token,
      );
      connection = await client(state.url!, receipt.token);
      const created = await connection.callTool({
        name: "page_create",
        arguments: {
          projectId: project.id,
          title: "Saved through LAN",
          blocks: [
            {
              kind: "text",
              data: {
                format: "markdown",
                content: "A real network interface and access key.",
              },
            },
          ],
        },
      });
      expect(created.isError, JSON.stringify(created)).not.toBe(true);
      expect(JSON.stringify(await service.listPages(project.id))).toContain(
        "Saved through LAN",
      );
      expect((await manager.status()).lastCallAt).toBeTruthy();
      const remoteProject = await connection.callTool({
        name: "project_create",
        arguments: { name: "Created over LAN", operationId: randomUUID() },
      });
      expect(remoteProject.isError, JSON.stringify(remoteProject)).not.toBe(
        true,
      );
      expect(JSON.stringify(await service.listProjects())).toContain(
        "Created over LAN",
      );
      await connection.close();
      connection = undefined;
      await manager.suspend();
      await resumed.restore();
      const after = await ready(resumed);
      expect(after.url).toBe(state.url);
      restored = await client(after.url!, receipt.token);
      const listed = await restored.callTool({
        name: "projects_list",
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      expect(JSON.stringify(listed)).toContain("LAN acceptance");
      await resumed.revoke(receipt.id);
      const denied = await fetch(after.url!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${receipt.token}`,
        },
        body: JSON.stringify(initialize),
      });
      expect(denied.status).toBe(401);
      await restored.close();
      restored = undefined;
      await resumed.stop();
      await expect(
        fetch(origin + "/health", { signal: AbortSignal.timeout(1000) }),
      ).rejects.toThrow();
      for (const entry of await readdir(config.directory, {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const bytes = await readFile(
          join(config.directory, entry.name, "auth", "authorization.sqlite"),
        );
        expect(bytes.includes(Buffer.from(receipt.token))).toBe(false);
      }
    } finally {
      await connection?.close();
      await restored?.close();
      await manager.suspend();
      await resumed.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(!address)(
  "LAN access keys enforce selected read-only projects and cannot create projects",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "showai-lan-policy-"));
    const config = options(directory),
      manager = new RemoteMcpManager(config);
    const service = new AgentService({ root: config.home() });
    const selected = await service.createProject("Selected"),
      hidden = await service.createProject("Hidden");
    let connection: Client | undefined;
    try {
      await manager.start({
        provider: "lan",
        bindAddress: address,
        publicUrl: "",
        port: 0,
        executable: "",
        access: "selected",
        projects: [{ id: selected.id, write: false }],
      });
      const state = await ready(manager),
        receipt = await manager.createAccessKey("Read-only tablet");
      connection = await client(state.url!, receipt.token);
      const listed = await connection.callTool({
        name: "projects_list",
        arguments: {},
      });
      expect(listed.isError).not.toBe(true);
      expect(JSON.stringify(listed)).toContain(selected.id);
      expect(JSON.stringify(listed)).not.toContain(hidden.id);
      const write = await connection.callTool({
        name: "page_create",
        arguments: { projectId: selected.id, title: "Denied", blocks: [] },
      });
      expect(write.isError).toBe(true);
      expect(
        JSON.stringify(await service.listPages(selected.id)),
      ).not.toContain("Denied");
      const tools = await connection.listTools();
      expect(tools.tools.some((tool) => tool.name === "project_create")).toBe(
        false,
      );
      const other = await connection.callTool({
        name: "pages_list",
        arguments: { projectId: hidden.id },
      });
      expect(other.isError).toBe(true);
      await connection.close();
      connection = undefined;
      await manager.stop();
      await manager.start({ ...state.config, access: "all" });
      const expanded = await ready(manager);
      const stale = await fetch(expanded.url!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${receipt.token}`,
        },
        body: "{}",
      });
      expect(stale.status).toBe(401);
      const newKey = await manager.createAccessKey("Expanded access tablet");
      connection = await client(expanded.url!, newKey.token);
      const expandedList = await connection.callTool({
        name: "projects_list",
        arguments: {},
      });
      expect(expandedList.isError).not.toBe(true);
      expect(JSON.stringify(expandedList)).toContain(hidden.id);
    } finally {
      await connection?.close();
      await manager.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
