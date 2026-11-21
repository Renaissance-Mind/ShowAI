import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import {
  DELIVERY_WORKFLOWS,
  HOST_GUIDE,
  skillFiles,
  workflowWithHostDelivery,
} from "./host-package.mjs";

export async function universalPluginFiles(
  source,
  {
    name = "showai-universal",
    displayName = "ShowAI Universal",
    appId,
    appAlias = name,
    setupUrl,
  } = {},
) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name))
    throw new Error("Invalid plugin name.");
  if (appId !== undefined && !/^asdk_app_[A-Za-z0-9]+$/.test(appId))
    throw new Error("Use the ID of an existing ChatGPT MCP connection.");
  if (setupUrl !== undefined) {
    const url = new URL(setupUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use an HTTPS MCP URL without credentials, query or fragment.",
      );
  }
  const metadata = JSON.parse(
    await readFile(join(source, "plugin.json"), "utf8"),
  );
  const description =
    "Use ShowAI with an MCP connection configured in your agent. The included Skills guide first-time setup.";
  const manifest = {
    $schema: metadata.$schema,
    name,
    version: metadata.version,
    description,
    keywords: metadata.keywords,
    extensions: {
      "com.openai": {
        onboardingSkill: "./skills/use-showai/SKILL.md",
        ...(appId && { apps: "./.app.json" }),
        interface: {
          ...metadata.extensions?.["com.openai"]?.interface,
          displayName,
          shortDescription: "Connect your agent to ShowAI",
          longDescription: description,
        },
      },
    },
  };
  const json = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
  const files = new Map([["plugin.json", json(manifest)]]);
  if (appId) files.set(".app.json", json({ apps: { [appAlias]: { id: appId } } }));
  const adapter = await readFile(
    join(source, "host-adapters/mcp-app.md"),
    "utf8",
  );
  const skillRoot = join(source, "skills");
  const snapshot = await skillFiles(skillRoot, { includeHidden: false });
  if (Object.keys(snapshot).filter((file) => /^[^/]+\/SKILL\.md$/.test(file)).length !== 6)
    throw new Error("Expected the six ShowAI workflows in the universal package.");
  for (const [file, digest] of Object.entries(snapshot)) {
    let data = await readFile(join(skillRoot, file));
    if (createHash("sha256").update(data).digest("hex") !== digest)
      throw new Error(
        "The source Skills changed during packaging. Retry after the source settles.",
      );
    if (file === HOST_GUIDE) data = Buffer.from(adapter);
    if (DELIVERY_WORKFLOWS.includes(file))
      data = Buffer.from(
        workflowWithHostDelivery(file, data.toString("utf8"), adapter),
      );
    files.set(`skills/${file}`, data);
  }
  for (const skill of [
    "use-showai",
    "show-visual",
    "show-document",
    "create-component",
    "create-template",
    "collaborate-canvas",
  ])
    if (!files.has(`skills/${skill}/SKILL.md`))
      throw new Error(`Missing ShowAI Skill: ${skill}`);
  if (!files.has("skills/use-showai/references/connect-mcp.md"))
    throw new Error(
      "The universal plugin needs its offline MCP connection guide.",
    );
  for (const icon of ["logo.svg", "logo-dark.svg"])
    files.set("assets/" + icon, await readFile(join(source, "assets", icon)));
  files.set(
    "README.md",
    Buffer.from(
      [
        `# ${displayName}`,
        "",
        "Install this package in a compatible plugin host, or load its six skills/ folders in an Agent Skills client. In your agent, add or reconnect your ShowAI MCP server. Ask “Help me connect ShowAI” for guided setup.",
        "",
        "在支持插件包的宿主导入本包；支持 Agent Skills 的客户端可加载 skills/ 下的六个技能目录。在宿主中手动添加或重新连接 ShowAI MCP。对 Agent 说「帮我连接 ShowAI」，它会按当前环境逐步引导。",
        "",
        ...(setupUrl
          ? [
              `MCP address for manual setup / 手动配置地址：${new URL(setupUrl).href}`,
              "",
            ]
          : []),
        "[Connection guide / 接入向导](skills/use-showai/references/connect-mcp.md)",
        "",
      ].join("\n"),
    ),
  );
  return { name, version: manifest.version, files };
}

function archive(entries) {
  const locals = [],
    central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name),
      data = deflateRawSync(entry.data);
    const checksum = crc32(entry.data),
      local = Buffer.alloc(30),
      record = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(checksum, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(entry.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    central.push(record, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export async function universalPluginArchive(source, options) {
  const { name, version, files } = await universalPluginFiles(source, options);
  return {
    name,
    version,
    files: [...files.keys()],
    bytes: archive(
      [...files].map(([path, data]) => ({ name: `${name}/${path}`, data })),
    ),
  };
}
