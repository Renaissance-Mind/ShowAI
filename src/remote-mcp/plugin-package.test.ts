import { test, expect } from "vitest";
import { cp, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { remotePluginPackage, chatgptAppId } from "./plugin-package";
import {
  universalPluginArchive,
  universalPluginFiles,
} from "../plugin/universal-package.mjs";
const execute = promisify(execFile);
test("the universal package guides a disconnected host without registering a server", async () => {
  const source = resolve("plugins/showai");
  const zip = await remotePluginPackage(source);
  expect(zip.name).toBe("showai-universal");
  expect(zip.endpoint).toBeUndefined();
  expect(zip.files.filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(
    6,
  );
  expect(zip.files).toContain("skills/use-showai/references/connect-mcp.md");
  for (const path of [
    ".app.json",
    "mcp.json",
    ".mcp.json",
    "mcp/launch.mjs",
    ".claude-plugin/plugin.json",
  ])
    expect(zip.files).not.toContain(path);
  const { files } = await universalPluginFiles(source, {
    setupUrl: "https://example.org/mcp",
  });
  expect(files.get("README.md")?.toString()).toContain(
    "https://example.org/mcp",
  );
  expect(files.get("plugin.json")?.toString()).not.toContain("example.org");
  expect(files.has("mcp.json")).toBe(false);
  expect(files.has(".mcp.json")).toBe(false);
  expect(files.get("skills/use-showai/SKILL.md")?.toString()).toContain(
    "references/connect-mcp.md",
  );
  const linked = await universalPluginFiles(source, {
    name: "showai-cloud",
    appId: "asdk_app_testconnection",
  });
  expect(JSON.parse(linked.files.get(".app.json")!.toString()).apps).toEqual({
    "showai-cloud": { id: "asdk_app_testconnection" },
  });
});
test("a real ZIP includes complete workflows and a remote connection without local launchers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-plugin-zip-"));
  try {
    const source = join(directory, "bundle");
    await cp(resolve("plugins/showai"), source, { recursive: true });
    await writeFile(join(source, "skills/.local-note"), "local only");
    for (const skill of ["show-visual", "show-document"]) {
      const file = `skills/${skill}/SKILL.md`;
      await cp(resolve("plugins/showai-claude", file), join(source, file));
    }
    const result = await remotePluginPackage(
      source,
      "https://device.example.com/mcp",
      "asdk_app_testconnection",
    );
    const path = join(directory, "plugin.zip");
    await writeFile(path, result.bytes);
    const { stdout } = await execute(
      process.platform === "win32" ? "python" : "python3",
      [
        "-c",
        `import zipfile,json,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 names=z.namelist(); root=names[0].split('/')[0]+'/'
 workflows=[z.read(root+'skills/'+skill+'/SKILL.md').decode() for skill in ['show-visual','show-document']]
 print(json.dumps({'names':names,'manifest':json.loads(z.read(root+'plugin.json')),'app':json.loads(z.read(root+'.app.json')),'adapter':z.read(root+'skills/use-showai/references/host-adapter.md').decode(),'workflows':workflows}))`,
        path,
      ],
    );
    const archive = JSON.parse(stdout);
    expect(
      archive.names.some((name: string) => name.includes(".local-note")),
    ).toBe(false);
    expect(
      archive.names.filter((n: string) => /skills\/[^/]+\/SKILL.md$/.test(n)),
    ).toHaveLength(6);
    expect(
      archive.names.some((n: string) =>
        /\.mcp.json|launch.mjs|node_modules/.test(n),
      ),
    ).toBe(false);
    expect(archive.manifest.name).toBe(result.name);
    expect(
      archive.manifest.extensions["com.openai"].interface.shortDescription
        .length,
    ).toBeLessThanOrEqual(30);
    expect(archive.app.apps.showai.id).toBe("asdk_app_testconnection");
    expect(archive.manifest.extensions["com.openai"].apps).toBe("./.app.json");
    expect(archive.names.some((n: string) => n.endsWith("/mcp.json"))).toBe(
      false,
    );
    expect(archive.adapter).toContain("mcp-app");
    const delivery = archive.adapter.match(
      /<!-- showai-host-delivery:start -->[\s\S]+?<!-- showai-host-delivery:end -->/,
    )?.[0];
    expect(delivery).toBeTruthy();
    for (const workflow of archive.workflows)
      expect(workflow).toContain(delivery);
    expect(
      (
        await remotePluginPackage(
          resolve("plugins/showai"),
          "https://device.example.com/mcp",
          "asdk_app_testconnection",
        )
      ).name,
    ).toBe(result.name);
    await expect(
      remotePluginPackage(
        resolve("plugins/showai"),
        "https://user:secret@device.example.com/mcp",
        "asdk_app_testconnection",
      ),
    ).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("web packages accept registered connection links and reject unrelated pages", () => {
  expect(
    chatgptAppId("https://chatgpt.com/plugins/plugin_asdk_app_example123"),
  ).toBe("asdk_app_example123");
  expect(() =>
    chatgptAppId("https://evil.example/plugins/plugin_asdk_app_example123"),
  ).toThrow();
  expect(() =>
    chatgptAppId("https://chatgpt.com/plugins/plugins_unrelated"),
  ).toThrow();
});

test("desktop packages include the selected runtime and the host's native entry", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-plugin-runtime-"));
  try {
    const runtimeConfig = join(home, "agent-runtime.json");
    await writeFile(
      runtimeConfig,
      JSON.stringify({
        format: "showai-agent-runtime",
        protocol: 1,
        home,
      }),
    );
    const source = resolve("plugins/showai");
    for (const [host, root] of [
      ["cursor", "${CURSOR_PLUGIN_ROOT}"],
      ["qoder", "."],
      ["workbuddy", "${CODEBUDDY_PLUGIN_ROOT}"],
    ] as const) {
      const { files } = await universalPluginFiles(source, {
        host,
        mcp: "local",
        runtimeConfig,
      });
      const read = (path: string) => JSON.parse(files.get(path)!.toString());
      expect(read(`.${host}-plugin/plugin.json`).version).toBe(
        read("plugin.json").version,
      );
      const serverName = host === "qoder" ? "showai" : "showai-universal";
      const connection = read("mcp.json").mcpServers[serverName];
      expect(connection).toMatchObject({
        type: "stdio",
        args: [`${host === "cursor" ? root : "."}/mcp/launch.mjs`],
        env: { SHOWAI_HOME: home, SHOWAI_RUNTIME_CONFIG: runtimeConfig },
      });
      expect(files.has("mcp/launch.mjs")).toBe(true);
      if (host !== "cursor")
        expect(read(".mcp.json").mcpServers[serverName]).toEqual({
          ...connection,
          args: [`${root}/mcp/launch.mjs`],
          ...(host === "qoder" && { cwd: root }),
        });
      if (host === "workbuddy")
        expect(
          read(".workbuddy-plugin/marketplace.json").plugins[0],
        ).toMatchObject({ source: "./", name: "showai-universal" });
    }
    const qoder = await universalPluginArchive(source, {
      host: "qoder",
      mcp: "local",
      runtimeConfig,
    });
    const zipPath = join(home, "qoder.zip");
    await writeFile(zipPath, qoder.bytes);
    const { stdout } = await execute(
      process.platform === "win32" ? "python" : "python3",
      [
        "-c",
        "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print('\\n'.join(z.namelist()))",
        zipPath,
      ],
    );
    expect(stdout.split("\n")).toContain(".qoder-plugin/plugin.json");
    expect(stdout.split("\n")).toContain(".mcp.json");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("an explicit remote endpoint uses the host's transport without bundling credentials", async () => {
  const source = resolve("plugins/showai");
  const mcp = "https://showai.example/mcp";
  const { files } = await universalPluginFiles(source, {
    host: "qoder",
    mcp,
    mcpAuth: "oauth",
  });
  const read = (path: string) => JSON.parse(files.get(path)!.toString());
  expect(read("mcp.json").mcpServers.showai).toEqual({
    type: "streamable-http",
    url: mcp,
  });
  const openai = await universalPluginFiles(source, { mcp, mcpAuth: "oauth" });
  expect(
    JSON.parse(openai.files.get("mcp.json")!.toString()).mcpServers.showai,
  ).toEqual({
    type: "streamable-http",
    url: mcp,
    extensions: {
      "com.openai": { auth: { type: "oauth", client: { mode: "dcr" } } },
    },
  });
  expect(read(".mcp.json").mcpServers.showai).toEqual({
    type: "http",
    url: mcp,
    oauth: { enabled: true },
  });
  expect(files.has("mcp/launch.mjs")).toBe(false);
  await expect(
    universalPluginFiles(source, { mcp: mcp + "?token=secret" }),
  ).rejects.toThrow();
  await expect(
    universalPluginFiles(source, { mcp, appId: "asdk_app_testconnection" }),
  ).rejects.toThrow();
});
