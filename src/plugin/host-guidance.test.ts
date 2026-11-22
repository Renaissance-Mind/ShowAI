import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import { stageDshBundle } from "./dsh-stage.mjs";
import { stageHostPlugin } from "./host-package.mjs";
import { prepareLocalPlugin } from "./local-plugin-package";
import { universalPluginFiles } from "./universal-package.mjs";

const source = resolve("plugins/showai");
const hosts = {
  codex: "Codex",
  claude: "Claude Code",
  antigravity: "Antigravity",
  deepseek: "DeepSeek Harness",
  kimi: "Kimi Work",
  "kimi-code": "Kimi Code",
  cursor: "Cursor Agents",
  "cursor-ide": "Cursor IDE",
  qoder: "Qoder",
  workbuddy: "WorkBuddy",
  trae: "TRAE IDE",
  chatgpt: "ChatGPT",
};
const isGuide = (file: string) =>
  file.endsWith(".md") || file.includes("/references/formats/");

async function packageGuides(path: string) {
  const guides = new Map<string, string>();
  if (path.endsWith(".zip") || path.endsWith(".vsix")) {
    for (const [file, data] of Object.entries(unzipSync(await readFile(path))))
      if (isGuide(file)) guides.set(file, Buffer.from(data).toString("utf8"));
  } else {
    for (const file of await readdir(path, { recursive: true })) {
      const relative = file.replaceAll("\\", "/");
      if (isGuide(relative))
        guides.set(relative, await readFile(join(path, file), "utf8"));
    }
  }
  return guides;
}

function checkHost(profile: keyof typeof hosts, guides: Map<string, string>) {
  const name = hosts[profile];
  const embedded =
    profile === "cursor-ide"
      ? "extension/agent-plugins/showai-cursor-ide/"
      : "";
  const read = (file: string) => guides.get(embedded + file);
  const allText = [...guides.values()].join("\n");
  for (const other of [
    ...Object.values(hosts).filter((host) => host !== name),
    "Grok Bot",
    "Gemini CLI",
    "OpenCode",
  ])
    expect(allText, name).not.toContain(other);
  expect(allText.includes("T3 Code"), name).toBe(
    profile === "codex" || profile === "claude",
  );
  expect(allText, name).not.toContain("<!-- showai-only:");
  const skills = [...guides.keys()].filter((file) =>
    file.endsWith("/SKILL.md"),
  );
  expect(skills, name).toHaveLength(profile === "trae" ? 0 : 6);
  if (profile === "trae" || profile === "cursor-ide")
    expect(guides.get("extension/README.md")).toContain(name);
  if (profile === "trae") return;
  expect(read("README.md")).toContain(name);
  expect(read("skills/use-showai/SKILL.md")).toMatch(
    new RegExp("^description: .*" + name, "m"),
  );
  const connection = read("skills/use-showai/references/connect-mcp.md");
  expect(connection).toContain(name);
  expect(connection).toContain("projects_list");
  const adapter = read("skills/use-showai/references/host-adapter.md")!;
  const delivery = adapter.match(
    /<!-- showai-host-delivery:start -->[\s\S]*?<!-- showai-host-delivery:end -->/,
  )?.[0];
  expect(delivery).toBeTruthy();
  for (const skill of ["show-document", "show-visual"])
    expect(read("skills/" + skill + "/SKILL.md")).toContain(delivery);
}

test("local installers deliver guidance for exactly the selected host", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-host-guides-"));
  const home = join(root, "library");
  const cli = {
    command: process.execPath,
    args: [resolve("dist-agent/cli.mjs")],
    env: { SHOWAI_HOME: home },
  };
  try {
    for (const profile of ["codex", "claude", "antigravity"] as const) {
      const target = join(root, profile);
      await stageHostPlugin({ source, target, profile });
      checkHost(profile, await packageGuides(target));
    }
    const target = join(root, "deepseek");
    await stageDshBundle({
      target,
      home,
      runtime: cli,
      pluginRoot: source,
      bundleRoot: resolve("plugins/showai-deepseek"),
    });
    checkHost("deepseek", await packageGuides(target));
    for (const profile of [
      "kimi",
      "kimi-code",
      "cursor",
      "cursor-ide",
      "qoder",
      "workbuddy",
      "trae",
    ] as const) {
      const { path } = await prepareLocalPlugin(profile, {
        root,
        pluginRoot: () => source,
        kimiBundleRoot: () => resolve("plugins/showai-kimi"),
        runtime: () => ({ home, cli }),
        channel: "development",
      });
      checkHost(profile, await packageGuides(path));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);

test("remote host exports describe the selected connection and the universal ZIP keeps all guides", async () => {
  for (const host of ["cursor", "qoder", "workbuddy", "kimi-code"] as const) {
    for (const mcp of [undefined, "https://showai.example/mcp"]) {
      const { files } = await universalPluginFiles(source, { host, mcp });
      const guides = new Map(
        [...files]
          .filter(([path]) => isGuide(path))
          .map(([path, data]) => [path, data.toString()]),
      );
      checkHost(host, guides);
      expect(guides.get("README.md")).not.toContain("from Settings");
    }
  }
  const chat = await universalPluginFiles(source, {
    appId: "asdk_app_existing",
  });
  checkHost(
    "chatgpt",
    new Map(
      [...chat.files]
        .filter(([path]) => isGuide(path))
        .map(([path, data]) => [path, data.toString()]),
    ),
  );
  const universal = await packageGuides(
    resolve("downloads/showai-universal.zip"),
  );
  const readme = universal.get("showai-universal/README.md")!;
  const connection = universal.get(
    "showai-universal/skills/use-showai/references/connect-mcp.md",
  )!;
  for (const host of Object.values(hosts)) expect(readme).toContain(host);
  for (const host of [
    "ChatGPT",
    "Grok Bot",
    "T3 Code",
    "DeepSeek Harness",
    "Qoder",
  ])
    expect(connection).toContain(host);
});
