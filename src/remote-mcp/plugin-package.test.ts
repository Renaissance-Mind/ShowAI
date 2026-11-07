import { test, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { remotePluginPackage, chatgptAppId } from "./plugin-package";
const execute = promisify(execFile);
test("a real ZIP includes complete workflows and a remote connection without local launchers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-plugin-zip-"));
  try {
    const result = await remotePluginPackage(
      resolve("plugins/showai"),
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
 print(json.dumps({'names':names,'manifest':json.loads(z.read(root+'plugin.json')),'app':json.loads(z.read(root+'.app.json')),'adapter':z.read(root+'skills/use-showai/references/host-adapter.md').decode()}))`,
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
