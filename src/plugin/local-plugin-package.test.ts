import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import { prepareLocalPlugin } from "./local-plugin-package";
import { installCursorAgent } from "./local-install";
import { launchSnippet } from "./launch-snippets";

test("local host packages keep their native format and the selected library", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-host-setups-"));
  const home = join(root, "library");
  const cli = {
    command: process.execPath,
    args: [resolve("dist-agent/cli.mjs")],
    env: { SHOWAI_HOME: home },
  };
  const options = {
    root,
    pluginRoot: () => resolve("plugins/showai"),
    kimiBundleRoot: () => resolve("plugins/showai-kimi"),
    runtime: () => ({ home, cli }),
    channel: "development" as const,
  };
  try {
    for (const [host, manifest, mcpConfig] of [
      ["kimi", "kimi.plugin.json", "kimi.plugin.json"],
      ["kimi-code", "kimi.plugin.json", "kimi.plugin.json"],
      ["cursor", ".cursor-plugin/plugin.json", "mcp.json"],
      ["workbuddy", ".workbuddy-plugin/marketplace.json", ".mcp.json"],
      ["qoder", ".qoder-plugin/plugin.json", ".mcp.json"],
    ]) {
      const { path } = await prepareLocalPlugin(host, options);
      const zip =
        host === "qoder" ? unzipSync(await readFile(path)) : undefined;
      const read = (file: string) =>
        zip
          ? Buffer.from(zip[file]).toString()
          : readFile(join(path, file), "utf8");
      expect(JSON.parse(await read(manifest)).name).toBeTruthy();
      const config = JSON.parse(await read(mcpConfig));
      const [server] = Object.values(config.mcpServers) as {
        env: Record<string, string>;
      }[];
      expect(server.env.SHOWAI_HOME).toBe(home);
      if (["cursor", "workbuddy", "qoder"].includes(host))
        expect(server).toHaveProperty("command", cli.command);
      expect(
        JSON.parse(await readFile(server.env.SHOWAI_RUNTIME_CONFIG, "utf8")),
      ).toMatchObject({ home, launch: cli });
      expect(await read("skills/show-visual/SKILL.md")).toContain(
        "show-visual",
      );
      expect(await read("mcp/launch.mjs")).toContain("SHOWAI_RUNTIME_CONFIG");
    }
    const cursor = await prepareLocalPlugin("cursor-ide", options);
    const vsix = unzipSync(await readFile(cursor.path));
    const manifest = JSON.parse(Buffer.from(vsix["extension/package.json"]).toString());
    expect(manifest.contributes.customEditors[0].selector).toEqual([{ filenamePattern: "*.showai-ref" }]);
    expect(JSON.parse(Buffer.from(vsix["extension/binding.json"]).toString())).toMatchObject({ library: home });
    const cursorMcp = JSON.parse(Buffer.from(vsix["extension/agent-plugins/showai-cursor-ide/mcp.json"]).toString());
    expect(cursorMcp.mcpServers["showai-cursor-ide"].env).toMatchObject({
      SHOWAI_CURSOR_WORKBENCH_LINK: "1", SHOWAI_HOME: home,
    });
    const trae = unzipSync(await readFile((await prepareLocalPlugin("trae", options)).path));
    expect(trae["extension/extension.cjs"]).toEqual(vsix["extension/extension.cjs"]);
    expect(Object.keys(trae).some(path => path.startsWith("extension/agent-plugins/"))).toBe(false);
    expect(JSON.parse(launchSnippet("opencode", cli))).toEqual({
      mcp: {
        showai: {
          type: "local",
          command: [cli.command, ...cli.args],
          environment: cli.env,
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("a local Cursor installation updates its library and preserves a conflicting unmanaged copy", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-cursor-install-"));
  const app = join(root, "installations");
  const local = join(root, "cursor/plugins/local");
  const options = (home: string) => ({
    root: app,
    pluginRoot: () => resolve("plugins/showai"),
    kimiBundleRoot: () => resolve("plugins/showai-kimi"),
    runtime: () => ({
      home, cli: { command: process.execPath, args: [resolve("dist-agent/cli.mjs")], env: { SHOWAI_HOME: home } },
    }),
    channel: "development" as const,
  });
  try {
    const installedConfig = join(local, "showai-cursor/mcp.json");
    for (const name of ["first", "second"]) {
      const home = join(root, name);
      const { path } = await prepareLocalPlugin("cursor", options(home));
      await installCursorAgent(path, local, app);
      expect(JSON.parse(await readFile(installedConfig, "utf8"))).toMatchObject({
        mcpServers: { "showai-cursor": { env: { SHOWAI_HOME: home } } },
      });
    }
    const other = join(root, "other/plugins/local");
    const foreignConfig = join(other, "showai-cursor/mcp.json");
    await mkdir(join(other, "showai-cursor"), { recursive: true });
    const foreign = JSON.stringify({ mcpServers: { "showai-cursor": { command: "custom-server" } } });
    await writeFile(foreignConfig, foreign);
    const { path } = await prepareLocalPlugin("cursor", options(join(root, "second")));
    await expect(installCursorAgent(path, other, app)).rejects.toMatchObject({ code: "PLUGIN_OTHER_SOURCE" });
    expect(await readFile(foreignConfig, "utf8")).toBe(foreign);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
