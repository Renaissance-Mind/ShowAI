import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import {
  DELIVERY_WORKFLOWS,
  HOST_GUIDE,
  skillFiles,
  workflowWithHostDelivery,
} from "./host-package.mjs";

const MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";
const hostManifestPaths = {
  cursor: ".cursor-plugin/plugin.json",
  qoder: ".qoder-plugin/plugin.json",
  workbuddy: ".workbuddy-plugin/plugin.json",
  "kimi-code": "kimi.plugin.json",
};
const hostPluginRoots = {
  cursor: "${CURSOR_PLUGIN_ROOT}",
  workbuddy: "${CODEBUDDY_PLUGIN_ROOT}",
};

async function mcpConnection(mcp, runtimeConfig, auth, host) {
  if (
    runtimeConfig !== undefined &&
    (mcp !== "local" || !isAbsolute(runtimeConfig))
  )
    throw new Error(
      "--runtime-config requires --mcp local and an absolute path.",
    );
  if (
    auth !== undefined &&
    (!mcp || mcp === "local" || !["oauth", "none"].includes(auth))
  )
    throw new Error("--mcp-auth requires a remote MCP URL and oauth or none.");
  if (mcp === undefined) return;
  if (mcp === "local") {
    let binding;
    if (runtimeConfig) {
      const registered = JSON.parse(await readFile(runtimeConfig, "utf8"));
      if (
        registered?.format !== "showai-agent-runtime" ||
        registered.protocol !== 1 ||
        typeof registered.home !== "string" ||
        !isAbsolute(registered.home)
      )
        throw new Error(
          "Use a ShowAI agent-runtime.json with an absolute content library path.",
        );
      binding = {
        SHOWAI_HOME: registered.home,
        SHOWAI_RUNTIME_CONFIG: runtimeConfig,
      };
    }
    return {
      type: "stdio",
      command: "node",
      args: ["./mcp/launch.mjs"],
      env: {
        SHOWAI_HOST_DISPLAY: host === "kimi-code" ? "fragment-file" : "mcp-app",
        ...(host === "qoder" && { SHOWAI_QODER_WORKBENCH: "1" }),
        ...(host !== "qoder" && { SHOWAI_LINKED_WORKBENCH: "1" }),
        ...binding,
      },
    };
  }
  const url = new URL(mcp);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use an MCP HTTPS URL, or HTTP on loopback, without credentials, query or fragment.",
    );
  return {
    type: "streamable-http",
    url: url.href,
    ...(auth &&
      !host && {
        extensions: {
          "com.openai": {
            auth:
              auth === "oauth"
                ? { type: "oauth", client: { mode: "dcr" } }
                : { type: "none" },
          },
        },
      }),
  };
}

export async function universalPluginFiles(
  source,
  {
    name = "showai-universal",
    displayName = "ShowAI Universal",
    appId,
    appAlias = name,
    setupUrl,
    mcp,
    mcpAuth,
    runtimeConfig,
    host,
  } = {},
) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name))
    throw new Error("Invalid plugin name.");
  if (appId !== undefined && !/^asdk_app_[A-Za-z0-9]+$/.test(appId))
    throw new Error("Use the ID of an existing ChatGPT MCP connection.");
  if (appId !== undefined && (mcp !== undefined || host !== undefined))
    throw new Error(
      "Export the existing ChatGPT connection without another MCP or host binding.",
    );
  if (host !== undefined && !Object.hasOwn(hostManifestPaths, host))
    throw new Error("Unknown plugin host: " + host);
  const connection = await mcpConnection(mcp, runtimeConfig, mcpAuth, host);
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
    connection || appId
      ? "Use ShowAI with the included MCP connection. The Skills guide connection recovery and page creation."
      : "Use ShowAI with an MCP connection configured in your agent. The included Skills guide first-time setup.";
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
  const files = new Map();
  if (host !== "workbuddy" && host !== "kimi-code") files.set("plugin.json", json(manifest));
  if (appId)
    files.set(".app.json", json({ apps: { [appAlias]: { id: appId } } }));
  if (host === "kimi-code") {
    files.set(hostManifestPaths[host], json({
      name, version: manifest.version, description, skills: "./skills/",
      interface: { displayName },
      ...(connection && { mcpServers: { showai: connection.type === "stdio" ? {
        command: connection.command, args: connection.args, cwd: "./", env: connection.env,
      } : { url: connection.url } } }),
    }));
  } else if (host) {
    files.set(
      hostManifestPaths[host],
      json({
        name,
        displayName,
        version: manifest.version,
        description,
      }),
    );
    if (host === "workbuddy")
      files.set(
        ".workbuddy-plugin/marketplace.json",
        json({
          name: `${name}-local`,
          owner: { name: "ShowAI" },
          plugins: [
            { name, source: "./", version: manifest.version, description },
          ],
        }),
      );
  }
  if (connection) {
    const local = connection.type === "stdio";
    const serverName =
      host === "cursor" || host === "workbuddy" ? name : "showai";
    const core =
      host === "cursor" && local
        ? {
            ...connection,
            args: [`${hostPluginRoots.cursor}/mcp/launch.mjs`],
          }
        : connection;
    if (host !== "workbuddy" && host !== "kimi-code")
      files.set(
        "mcp.json",
        json({ $schema: MCP_SCHEMA, mcpServers: { [serverName]: core } }),
      );
    if (connection.type === "stdio")
      files.set(
        "mcp/launch.mjs",
        await readFile(join(source, "mcp/launch.mjs")),
      );
    if (host === "qoder" || host === "workbuddy") {
      const cwd = hostPluginRoots[host] ?? ".";
      const native = local
        ? {
            ...connection,
            args: [`${cwd}/mcp/launch.mjs`],
            ...(host === "qoder" && { cwd }),
          }
        : {
            type: "http",
            url: connection.url,
            ...(mcpAuth === "oauth" && { oauth: { enabled: true } }),
          };
      files.set(".mcp.json", json({ mcpServers: { [serverName]: native } }));
    }
  }
  const adapter = await readFile(
    join(
      source,
      "host-adapters",
      host && mcp === "local" ? `${host}.md` : "mcp-app.md",
    ),
    "utf8",
  );
  const skillRoot = join(source, "skills");
  const snapshot = await skillFiles(skillRoot, { includeHidden: false });
  if (
    Object.keys(snapshot).filter((file) => /^[^/]+\/SKILL\.md$/.test(file))
      .length !== 6
  )
    throw new Error(
      "Expected the six ShowAI workflows in the universal package.",
    );
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
        "Install this package in a compatible plugin host, or load its six skills/ folders in an Agent Skills client. Use the bundled or already configured ShowAI MCP connection. Ask “Help me connect ShowAI” when setup or reconnection is needed.",
        "",
        "在支持插件包的宿主导入本包；支持 Agent Skills 的客户端可加载 skills/ 下的六个技能目录。优先使用随包提供或已经配置的 ShowAI MCP。需要设置或恢复连接时，对 Agent 说「帮我连接 ShowAI」。",
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

export function archive(entries) {
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
      [...files].map(([path, data]) => ({
        name: options?.host === "qoder" ? path : `${name}/${path}`,
        data,
      })),
    ),
  };
}
