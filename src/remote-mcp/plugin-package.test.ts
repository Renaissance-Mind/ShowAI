import { test, expect } from "vitest";
import { cp, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { remotePluginPackage, chatgptAppId } from "./plugin-package";
import { universalPluginFiles } from "../plugin/universal-package.mjs";
const execute = promisify(execFile);
test("the universal package guides a disconnected host without registering a server", async () => {
  const source = resolve("plugins/showai");
  const zip = await remotePluginPackage(source);
  expect(zip.name).toBe("showai-universal");
  expect(zip.endpoint).toBeUndefined();
  expect(zip.files.filter((path) => path.endsWith("/SKILL.md"))).toHaveLength(6);
  expect(zip.files).toContain("skills/use-showai/references/connect-mcp.md");
  for (const path of [".app.json", "mcp.json", ".mcp.json", "mcp/launch.mjs", ".claude-plugin/plugin.json"])
    expect(zip.files).not.toContain(path);
  const { files } = await universalPluginFiles(source, { setupUrl: "https://example.org/mcp" });
  expect(files.get("README.md")?.toString()).toContain("https://example.org/mcp");
  expect(files.get("plugin.json")?.toString()).not.toContain("example.org");
  expect(files.has("mcp.json")).toBe(false);
  expect(files.has(".mcp.json")).toBe(false);
  expect(files.get("skills/use-showai/SKILL.md")?.toString()).toContain("references/connect-mcp.md");
});
test("a real ZIP includes complete workflows and a remote connection without local launchers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-plugin-zip-"));
  try {
    const source = join(directory, "bundle");
    await cp(resolve("plugins/showai"), source, { recursive: true });
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
    const delivery = archive.adapter.match(/<!-- showai-host-delivery:start -->[\s\S]+?<!-- showai-host-delivery:end -->/)?.[0];
    expect(delivery).toBeTruthy();
    for (const workflow of archive.workflows) expect(workflow).toContain(delivery);
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
