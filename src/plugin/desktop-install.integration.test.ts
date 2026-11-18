import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { DesktopPluginInstaller, hostExecutable } from "./desktop-install";
import { registerRuntime, type RuntimeLaunch } from "../agent/runtime";

async function codexServerTools(root: string, installedPath: string) {
  const codex = await hostExecutable("codex");
  expect(codex).toBeTruthy();
  const cwd = join(root, "workspace");
  await mkdir(cwd, { recursive: true });
  const child = spawn(codex!, ["app-server", "--listen", "stdio://"], {
    cwd,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const send = (message: object) =>
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  let tools: Tool[] | undefined;
  let skills: string[] | undefined;
  try {
    send({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "desktop-plugin-acceptance", version: "1" },
      },
    });
    for await (const line of createInterface({ input: child.stdout })) {
      const message = JSON.parse(line);
      if (message.id !== undefined && message.error)
        throw new Error(JSON.stringify(message.error));
      if (message.id === 1) {
        send({ method: "initialized" });
        send({ id: 2, method: "mcpServerStatus/list", params: {} });
        send({ id: 3, method: "skills/list", params: { cwds: [cwd] } });
      } else if (message.id === 2) {
        const servers: { name: string; tools: Record<string, Tool> }[] =
          message.result.data;
        expect(servers.map(({ name }) => name)).toEqual(["showai"]);
        tools = Object.values(servers[0].tools);
      } else if (message.id === 3) {
        const records: {
          skills: { path: string; name: string; enabled?: boolean }[];
        }[] = message.result.data;
        skills = records
          .flatMap(({ skills }) => skills)
          .filter(
            ({ path, enabled }) =>
              enabled !== false &&
              path.startsWith(join(installedPath, "skills") + sep),
          )
          .map(({ name }) => name.split(":").at(-1)!)
          .sort();
      }
      if (tools && skills) break;
    }
    if (!tools || !skills)
      throw new Error("Codex app-server exited before loading ShowAI.");
    const bundledSkills = (
      await readdir(join(installedPath, "skills"), { withFileTypes: true })
    )
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(skills).toEqual(bundledSkills);
    expect(skills).toContain("use-showai");
    expect(await readFile(join(root, "codex/config.toml"), "utf8")).not.toMatch(
      /^\[mcp_servers(?:\.|\])/m,
    );
    for (const [name, type] of [
      ["workbench_open_global", "global"],
      ["workbench_open_page", "thread"],
    ]) {
      expect(tools.find((tool) => tool.name === name)?._meta).toMatchObject({
        ui: { resourceUri: expect.stringMatching(/^ui:\/\/showai\//) },
        "openai/ui": { entrypoints: [{ type }] },
      });
    }
    return tools.length;
  } finally {
    child.kill();
  }
}

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
      AGY_HOME: process.env.AGY_HOME,
    };
    beforeAll(async () => {
      await mkdir(output!, { recursive: true });
      root = await mkdtemp(join(output!, "installation-"));
      process.env.CODEX_HOME = join(root, "codex");
      process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
      process.env.DSH_HOME = join(root, "dsh");
      process.env.AGY_HOME = join(root, "antigravity");
      await mkdir(process.env.CODEX_HOME, { recursive: true });
      await mkdir(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
      await mkdir(process.env.AGY_HOME, { recursive: true });
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
    test.each(["codex", "claude", "antigravity"] as const)(
      "%s installs, repeats, updates the library and starts MCP without Node on PATH",
      async (host) => {
        const first = await installer.install(host);
        const firstHome = home;
        const manifestName =
          host === "codex"
            ? "mcp.json"
            : host === "claude"
              ? ".mcp.json"
              : "mcp_config.json";
        const initialManifest = JSON.parse(
          await readFile(join(first.installedPath, manifestName), "utf8"),
        );
        const firstBinding =
          initialManifest.mcpServers.showai.env.SHOWAI_RUNTIME_CONFIG;
        expect(first.verifiedFiles).toBeGreaterThan(20);
        if (host === "codex") await codexServerTools(root, first.installedPath);
        const state = async () =>
          (await installer.status()).find((item) => item.host === host)!;
        expect(await state()).toMatchObject({ enabled: true, current: true });
        const repeated = await installer.install(host);
        expect(repeated.treeSha256).toBe(first.treeSha256);
        home = join(root, `library-${host}`);
        cli = { ...cli, env: { ...cli.env, SHOWAI_HOME: home } };
        await registerRuntime(home, cli);
        expect(await state()).toMatchObject({ enabled: true, current: false });
        const changed = await installer.install(host);
        expect(changed.version).not.toBe(first.version);
        expect(await state()).toMatchObject({ enabled: true, current: true });
        expect(JSON.parse(await readFile(firstBinding, "utf8")).home).toBe(
          firstHome,
        );
        const manifest = JSON.parse(
          await readFile(join(changed.installedPath, manifestName), "utf8"),
        );
        const server = manifest.mcpServers.showai;
        expect(
          await readFile(join(changed.installedPath, "mcp/launch.mjs"), "utf8"),
        ).toBe(
          await readFile(
            resolve("plugins", "showai-" + host, "mcp/launch.mjs"),
            "utf8",
          ),
        );
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
        const record = JSON.parse(
          await readFile(server.env.SHOWAI_RUNTIME_CONFIG, "utf8"),
        );
        expect(record).toMatchObject({
          home,
          launch: cli,
          channel: "packaged",
        });
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
            tools.tools.some((tool) => tool.name === "workbench_open_global"),
          ).toBe(host === "codex");
          expect(
            tools.tools.some((tool) => tool.name === "workbench_open_page"),
          ).toBe(host === "codex");
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
          if (host === "codex") {
            expect(delivery.mode).toBe("mcp-app");
            const cache = join(
              server.env.SHOWAI_CODEX_WORKBENCH_PROFILE,
              "agent-runtime-probe.json",
            );
            expect(
              JSON.parse(await readFile(cache, "utf8")).info.data.home,
            ).toBe(home);
            await expect(
              readFile(join(home, "local/agent-runtime-probe.json")),
            ).rejects.toMatchObject({ code: "ENOENT" });
            expect(
              (capabilities.structuredContent as any).data.presentation
                .liveUpdates,
            ).toMatchObject({
              available: true,
              defaultDeliverySupported: true,
            });
            const liveResult = await client.callTool({
              name: "show_component",
              arguments: {
                kind: "chart",
                data: {
                  labels: ["A"],
                  series: [{ name: "result", values: [1] }],
                },
                live: true,
              },
            });
            expect(liveResult.isError).not.toBe(true);
            const initial = (liveResult.structuredContent as any).data;
            expect(initial.delivery.mode).toBe("mcp-app");
            const updated = await client.callTool({
              name: "show_component_update",
              arguments: {
                viewId: initial.live.viewId,
                baseRevision: 0,
                operationId: "installed-codex-update",
                complete: true,
                operations: [
                  {
                    type: "component.props.set",
                    blockId: initial.blocks[0].id,
                    props: {
                      labels: ["A", "B"],
                      series: [{ name: "result", values: [1, 2] }],
                    },
                  },
                ],
              },
            });
            expect(updated.isError).not.toBe(true);
            expect((updated.structuredContent as any).data).toMatchObject({
              viewId: initial.live.viewId,
              revision: 1,
              complete: true,
            });
            const latest = await client.callTool({
              name: "show_component_read",
              arguments: { viewId: initial.live.viewId, source: true },
            });
            expect(
              (latest.structuredContent as any).data.artifact.document.content
                .content[0].attrs.data.labels,
            ).toEqual(["A", "B"]);
            await client.callTool({
              name: "show_component_close",
              arguments: { viewId: initial.live.viewId },
            });
          } else if (host === "antigravity") {
            expect(delivery.mode).toBe("fragment-file");
            expect(await readFile(delivery.inline, "utf8")).toContain("<");
          } else if (delivery.mode === "compact")
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
          const loaded =
            host === "codex"
              ? await codexServerTools(root, changed.installedPath)
              : undefined;
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
      const dshState = async () =>
        (await installer.status()).find((item) => item.host === "deepseek")!;
      const status = await dshState();
      expect(status).toMatchObject({
        host: "deepseek",
        installed: true,
        enabled: true,
        installedPath: first.installedPath,
        current: true,
      });
      const probe = join(bundle, "skills/update-probe.txt");
      await writeFile(probe, "newer bundle\n");
      try {
        const stale = await dshState();
        expect(stale).toMatchObject({ installed: true, current: false });
        expect(stale.expected).not.toBe(status.expected);
        await installer.install("deepseek");
        const refreshed = await dshState();
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
        expect(
          tools.tools.some((tool) => tool.name.startsWith("workbench_")),
        ).toBe(false);
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
    test("a Codex-only instruction update only invalidates Codex", async () => {
      const states = async () =>
        Object.fromEntries(
          (await installer.status()).map((item) => [item.host, item.expected]),
        );
      const before = await states();
      const path = join(bundle, "host-adapters/codex-entry.md");
      const original = await readFile(path, "utf8");
      try {
        await writeFile(path, original + "\nAdditional Codex instructions.\n");
        const after = await states();
        for (const host of ["codex", "claude", "antigravity", "deepseek"])
          expect(before[host], host).toBeTruthy();
        expect(after.codex).not.toBe(before.codex);
        for (const host of ["claude", "antigravity", "deepseek"])
          expect(after[host], host).toBe(before[host]);
      } finally {
        await writeFile(path, original);
      }
    });
    test("invalid replacement content leaves the installed Codex launcher available", async () => {
      const first = await installer.install("codex");
      const staged = join(
        root,
        "profile/external-plugins/codex/plugins/showai/mcp",
      );
      const before = await readFile(join(staged, "launch.mjs"), "utf8");
      const template = join(bundle, "host-adapters/launch.mjs.in");
      const original = await readFile(template, "utf8");
      try {
        await writeFile(
          template,
          original.replace("__SHOWAI_PROBE_CACHE_PATH__", "undefined"),
        );
        await expect(installer.install("codex")).rejects.toThrow(
          "probe cache path",
        );
        expect(await readFile(join(staged, "launch.mjs"), "utf8")).toBe(before);
        expect((await installer.status("codex"))[0].version).toBe(
          first.version,
        );
      } finally {
        await writeFile(template, original);
      }
    });
    test("rejects arbitrary host names", async () => {
      await expect(installer.install("sh")).rejects.toThrow(
        "Unknown plugin host",
      );
    });
  },
);
