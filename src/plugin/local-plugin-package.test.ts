import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import { prepareLocalPlugin } from "./local-plugin-package";
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
      expect(
        JSON.parse(await readFile(server.env.SHOWAI_RUNTIME_CONFIG, "utf8")),
      ).toMatchObject({ home, launch: cli });
      expect(await read("skills/show-visual/SKILL.md")).toContain(
        "show-visual",
      );
      expect(await read("mcp/launch.mjs")).toContain("SHOWAI_RUNTIME_CONFIG");
    }
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
});
