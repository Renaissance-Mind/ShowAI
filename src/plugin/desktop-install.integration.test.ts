import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DesktopPluginInstaller } from "./desktop-install";
import { registerRuntime, type RuntimeLaunch } from "../agent/runtime";

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
        expect(server.command).not.toBe("node");
        expect(server.env.SHOWAI_HOME).toBe(home);
        const client = new Client({
          name: "desktop-plugin-acceptance",
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
            tools.tools.some((tool) => tool.name === "projects_list"),
          ).toBe(true);
          const projects = await client.callTool({
            name: "projects_list",
            arguments: {},
          });
          expect(projects.isError).not.toBe(true);
          await writeFile(
            join(output!, `${host}-result.json`),
            JSON.stringify(
              {
                first,
                repeated,
                changed,
                mcpWithoutNode: true,
                tools: tools.tools.length,
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
