import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DesktopPluginInstaller, hostExecutable } from "./desktop-install";
import { registerRuntime, type RuntimeLaunch } from "../agent/runtime";

/** Asks a Codex app-server on the disposable CODEX_HOME how many ShowAI tools it loaded. */
async function codexServerTools() {
  const codex = await hostExecutable("codex");
  expect(codex).toBeTruthy();
  const child = spawn(codex!, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  const send = (message: object) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  try {
    send({
      id: 1,
      method: "initialize",
      params: { clientInfo: { name: "desktop-plugin-acceptance", version: "1" } },
    });
    for await (const line of createInterface({ input: child.stdout })) {
      const message = JSON.parse(line);
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "mcpServerStatus/list", params: {} });
      } else if (message.id === 2) {
        const showai = message.result.data.find(
          (item: { name: string }) => item.name === "showai",
        );
        return showai ? Object.keys(showai.tools).length : 0;
      }
    }
    throw new Error("Codex app-server exited before listing MCP servers.");
  } finally {
    child.kill();
  }
}

// Opt in with a task-owned output directory and a real registered runtime.
// Runs the installed official CLIs with disposable user configuration; no mocks.
const output = process.env.SHOWAI_PLUGIN_TEST_OUTPUT;
const config = process.env.SHOWAI_PLUGIN_TEST_RUNTIME;
describe.skipIf(!output || !config)(
  "desktop plugin installation with real hosts",
  () => {
    let root: string;
    let installer: DesktopPluginInstaller;
    let home: string;
    let cli: RuntimeLaunch;
    let bundle: string;
    const saved = {
      CODEX_HOME: process.env.CODEX_HOME,
      CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
      DSH_HOME: process.env.DSH_HOME,
    };
    beforeAll(async () => {
      await mkdir(output!, { recursive: true });
      root = await mkdtemp(join(output!, "installation-"));
      process.env.CODEX_HOME = join(root, "codex");
      process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
      process.env.DSH_HOME = join(root, "dsh");
      await mkdir(process.env.CODEX_HOME, { recursive: true });
      await mkdir(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
      const registered = JSON.parse(await readFile(config!, "utf8"));
      home = join(root, "library");
      cli = {
        ...registered.launch,
        env: { ...registered.launch.env, SHOWAI_HOME: home },
      };
      await registerRuntime(home, cli);
      bundle = join(root, "app-resources/agent-plugin");
      await cp(resolve("plugins/showai"), bundle, { recursive: true });
      installer = new DesktopPluginInstaller({
        root: join(root, "profile/external-plugins"),
        pluginRoot: () => bundle,
        dshBundleRoot: () => resolve("plugins/dsh-showai"),
        runtime: () => ({ home, cli }),
        channel: "packaged",
      });
    });
    afterAll(async () => {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (root) await rm(root, { recursive: true, force: true });
    });
    test.each(["codex", "claude"] as const)(
      "%s installs, repeats, updates the library and starts MCP without Node on PATH",
      async (host) => {
        const first = await installer.install(host);
        expect(first.verifiedFiles).toBeGreaterThan(20);
        const state = async () =>
          (await installer.status()).find((item) => item.host === host)!;
        expect(await state()).toMatchObject({ enabled: true, current: true });
        const repeated = await installer.install(host);
        expect(repeated.treeSha256).toBe(first.treeSha256);
        home = join(root, `library-${host}`);
        cli = { ...cli, env: { ...cli.env, SHOWAI_HOME: home } };
        await registerRuntime(home, cli);
        // Another library makes the installed copy outdated until it is updated.
        expect(await state()).toMatchObject({ enabled: true, current: false });
        const changed = await installer.install(host);
        expect(changed.version).not.toBe(first.version);
        expect(await state()).toMatchObject({ enabled: true, current: true });
        const manifest = JSON.parse(
          await readFile(
            join(
              changed.installedPath,
              host === "codex" ? "mcp.json" : ".mcp.json",
            ),
            "utf8",
          ),
        );
        const server = manifest.mcpServers.showai;
        if (host === "codex")
          expect(manifest.$schema).toBe(
            "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
          );
        const profile = JSON.parse(
          await readFile(
            join(changed.installedPath, "host-profile.json"),
            "utf8",
          ),
        );
        expect(profile.profile).toBe(host);
        expect(profile.declaredHostDisplay).toBe(
          server.env.SHOWAI_HOST_DISPLAY,
        );
        const guide = await readFile(
          join(
            changed.installedPath,
            "skills/use-showai/references/host-adapter.md",
          ),
          "utf8",
        );
        expect(guide).toBe(
          await readFile(
            resolve("plugins/showai/host-adapters", `${host}.md`),
            "utf8",
          ),
        );
        expect(server.command).not.toBe("node");
        expect(server.env.SHOWAI_HOME).toBe(home);
        // Pinned to this App's runtime, not to whichever App last registered in the library.
        const record = JSON.parse(
          await readFile(server.env.SHOWAI_RUNTIME_CONFIG, "utf8"),
        );
        expect(record).toMatchObject({ home, launch: cli, channel: "packaged" });
        expect(server.env.SHOWAI_RUNTIME_CONFIG).not.toBe(
          join(home, "agent-runtime.json"),
        );
        const client = new Client({
          name: "desktop-plugin-acceptance",
          version: "1",
        });
        const transport = new StdioClientTransport({
          ...server,
          command:
            host === "codex"
              ? join(changed.installedPath, server.command)
              : server.command,
          env: { ...server.env, PATH: "/usr/bin:/bin" },
          stderr: "pipe",
        });
        try {
          await client.connect(transport);
          const tools = await client.listTools();
          expect(
            tools.tools.some((tool) => tool.name === "projects_list"),
          ).toBe(true);
          const projects = await client.callTool({
            name: "projects_list",
            arguments: {},
          });
          expect(projects.isError).not.toBe(true);
          const capabilities = await client.callTool({
            name: "showai_capabilities",
            arguments: {},
          });
          expect(
            (capabilities.structuredContent as any).data.presentation
              .declaredHostDisplay,
          ).toBe(profile.declaredHostDisplay);
          const shown = await client.callTool({
            name: "show_component",
            arguments: {
              kind: "flowchart",
              data: {
                flows: [
                  {
                    id: "connection",
                    label: "连接",
                    nodes: [
                      { id: "agent", label: "Agent" },
                      { id: "library", label: "隔离内容库" },
                    ],
                    edges: [
                      { id: "write", source: "agent", target: "library" },
                    ],
                  },
                ],
              },
            },
          });
          expect(shown.isError).not.toBe(true);
          const delivery = (shown.structuredContent as any).data.delivery;
          if (host === "codex") expect(delivery.mode).toBe("fragment-file");
          else if (delivery.mode === "compact")
            expect(delivery.compact).toContain("<");
          else {
            expect(delivery.mode).toBe("image");
            expect(
              Array.isArray(shown.content) &&
                shown.content.some(
                  (item: { type?: string }) => item.type === "image",
                ),
            ).toBe(true);
            expect(
              (shown.structuredContent as any).data.warnings.join(" "),
            ).toMatch(/compact fragment|CDN reader/);
          }
          // Codex itself must load the server, not only a client that reads mcp.json directly.
          const loaded =
            host === "codex" ? await codexServerTools() : undefined;
          if (host === "codex") expect(loaded).toBe(tools.tools.length);
          await writeFile(
            join(output!, `${host}-result.json`),
            JSON.stringify(
              {
                first,
                repeated,
                changed,
                mcpWithoutNode: true,
                declaredHostDisplay: profile.declaredHostDisplay,
                deliveryMode: delivery.mode,
                tools: tools.tools.length,
                codexLoadedTools: loaded,
              },
              null,
              2,
            ),
          );
        } finally {
          await client.close();
        }
      },
      120000,
    );
    test("a development build does not install the user-scope Claude Code plugin", async () => {
      const development = new DesktopPluginInstaller({
        root: join(root, "profile/development-plugins"),
        pluginRoot: () => bundle,
        dshBundleRoot: () => resolve("plugins/dsh-showai"),
        runtime: () => ({ home, cli }),
        channel: "development",
      });
      await expect(development.install("claude")).rejects.toMatchObject({
        code: "PLUGIN_DEVELOPMENT_BUILD",
      });
    });
    test("deepseek stages a bundle whose MCP row starts without Node on PATH", async () => {
      // Harness installs the bundle itself; a profile linking the staged path counts as installed.
      const profile = join(root, "dsh/profiles/desktop");
      await mkdir(profile, { recursive: true });
      await writeFile(
        join(profile, "package.json"),
        JSON.stringify({ dsh: { profile: { bundles: [] } } }),
      );
      const first = await installer.install("deepseek");
      expect(first.dsh).toMatchObject({ add: true, profileMissing: false });
      await writeFile(
        join(profile, "package.json"),
        JSON.stringify({
          dependencies: { "@showai/dsh-showai": `link:${first.installedPath}` },
          dsh: { profile: { bundles: ["@showai/dsh-showai"] } },
        }),
      );
      const [, , status] = await installer.status();
      expect(status).toMatchObject({
        host: "deepseek",
        installed: true,
        enabled: true,
        installedPath: first.installedPath,
        current: true,
      });
      // A newer App bundle leaves the staged files stale until they are prepared again.
      const probe = join(bundle, "skills/update-probe.txt");
      await writeFile(probe, "newer bundle\n");
      try {
        const [, , stale] = await installer.status();
        expect(stale).toMatchObject({ installed: true, current: false });
        expect(stale.expected).not.toBe(status.expected);
        await installer.install("deepseek");
        const [, , refreshed] = await installer.status();
        expect(refreshed).toMatchObject({ current: true });
        expect(refreshed.expected).toBe(stale.expected);
      } finally {
        await rm(probe);
        await installer.install("deepseek");
      }
      const patch = await readFile(
        join(first.installedPath, "cordis.patch.yml"),
        "utf8",
      );
      const server = {
        command: JSON.parse(/command: (".*")/.exec(patch)![1]),
        args: [JSON.parse(/^ {10}- (".*")$/m.exec(patch)![1])],
        env: Object.fromEntries(
          [...patch.matchAll(/^ {10}(".*"): (".*")$/gm)].map((match) => [
            JSON.parse(match[1]),
            JSON.parse(match[2]),
          ]),
        ),
        cwd: JSON.parse(/cwd: (".*")/.exec(patch)![1]),
      };
      expect(server.command).not.toBe("node");
      expect(server.env.SHOWAI_HOME).toBe(home);
      const client = new Client({
        name: "dsh-plugin-acceptance",
        version: "1",
      });
      const transport = new StdioClientTransport({
        ...server,
        env: { ...server.env, PATH: "/usr/bin:/bin" },
        stderr: "pipe",
      });
      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.some((tool) => tool.name === "page_apply")).toBe(
          true,
        );
        await writeFile(
          join(output!, "deepseek-result.json"),
          JSON.stringify({ first, status, tools: tools.tools.length }, null, 2),
        );
      } finally {
        await client.close();
      }
    }, 120000);
    test("rejects arbitrary host names", async () => {
      await expect(installer.install("sh")).rejects.toThrow(
        "Unknown plugin host",
      );
    });
  },
);
