#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import {
  ANTIGRAVITY_EAGER_TOOLS,
  antigravityManifest,
  antigravitySidecarConfig,
  skillFiles,
} from "../src/plugin/host-package.mjs";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage =
  "Usage: npm run plugin:antigravity -- [--port PORT] [--mode desktop|browser] [--json]\n" +
  "       npm run plugin:antigravity -- --remove [--json]";
const { values } = parseArgs({
  options: {
    port: { type: "string" },
    mode: { type: "string", default: "desktop" },
    remove: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});
if (values.help) {
  process.stdout.write(usage + "\n");
  process.exit(0);
}
if (
  (values.port && values.remove) ||
  !["desktop", "browser"].includes(values.mode)
)
  throw new Error(usage);

const log = (message) =>
  (values.json ? process.stderr : process.stdout).write(message + "\n");

const writeJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n");
  await rename(temporary, path);
};
const readJson = (path) =>
  readFile(path, "utf8").then(JSON.parse, (error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
const exists = (path, mode = constants.F_OK) =>
  access(path, mode).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT" || error.code === "EACCES") return false;
      throw error;
    },
  );

async function findAgy() {
  const dirs = [
    ...(process.env.PATH ?? "").split(delimiter),
    join(homedir(), ".local/bin"),
    join(homedir(), ".npm-global/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ].filter(Boolean);
  for (const dir of dirs) {
    for (const ext of process.platform === "win32"
      ? [".exe", ".cmd", ".bat", ""]
      : [""]) {
      const candidate = join(dir, `agy${ext}`);
      if (await exists(candidate, constants.X_OK)) return candidate;
    }
  }
  throw new Error(
    "agy was not found. Install the Antigravity CLI before installing this plugin.",
  );
}

const agyHome = () => resolve(process.env.AGY_HOME || homedir());

async function agy(executable, args) {
  const env = {
    ...process.env,
    ...(process.env.AGY_HOME ? { HOME: agyHome() } : {}),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = await execute(executable, ["plugin", ...args], {
    cwd: root,
    env,
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout.trim();
}
const agyJson = async (executable, args) =>
  JSON.parse(await agy(executable, [...args, "--json"]));

async function handshake(server) {
  const child = spawn(server.command, server.args, {
    env: { ...process.env, ...server.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const replies = new Map();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const message = JSON.parse(line);
    replies.get(message.id)?.(message);
  });
  let id = 0;
  const request = (method, params) =>
    new Promise((done, fail) => {
      const timer = setTimeout(
        () =>
          fail(
            new Error(
              `No reply to ${method}: ${stderr.trim().slice(-2000)}`,
            ),
          ),
        60000,
      );
      replies.set(++id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "antigravity-plugin-installer", version: "1" },
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }) + "\n",
  );
  const tools = (await request("tools/list", {})).result?.tools ?? [];
  const capabilities = await request("tools/call", {
    name: "showai_capabilities",
    arguments: {},
  });
  child.kill();
  const text = capabilities.result?.content?.[0]?.text;
  if (capabilities.result?.isError || !text)
    throw new Error(
      `ShowAI did not start through the plugin: ${text ?? stderr.trim().slice(-2000)}`,
    );
  return {
    server: init.result?.serverInfo,
    tools: tools.length,
    toolNames: tools.map((tool) => tool.name),
    capabilities: JSON.parse(text).data,
  };
}

const generated = join(root, ".showai-dev/antigravity-plugin");

async function resolveBinding() {
  if (values.port) {
    const instance = join(root, ".showai-dev", `${values.mode}-${values.port}`);
    const session = await readJson(join(instance, "session.json"));
    if (!session?.home || !session.runtime)
      throw new Error(
        `No development instance at ${instance}. Start it first: npm run dev:open -- --port ${values.port} --home <library>${values.mode === "browser" ? " browser" : ""}`,
      );
    const entry = join(session.runtime, "scripts/cli.mjs");
    if (!(await exists(entry)))
      throw new Error(`The instance has no built runtime at ${entry}.`);
    const electron = (await import("electron")).default;
    const home = resolve(session.home);
    return {
      channel: "development",
      home,
      launch: {
        command: electron,
        args: [entry],
        env: { ELECTRON_RUN_AS_NODE: "1", SHOWAI_HOME: home },
      },
      instance: {
        mode: values.mode,
        port: Number(values.port),
        url: session.url,
      },
      runtime: entry,
    };
  }
  const home = resolve(process.env.SHOWAI_HOME || join(homedir(), ".showai"));
  const config = await readJson(
    process.env.SHOWAI_RUNTIME_CONFIG || join(home, "agent-runtime.json"),
  );
  if (
    config?.format !== "showai-agent-runtime" ||
    resolve(config.home ?? "") !== home ||
    !isAbsolute(config.launch?.command ?? "") ||
    !Array.isArray(config.launch?.args) ||
    !config.launch.args.length
  )
    throw new Error(
      `No ShowAI runtime is registered for ${home}. Start ShowAI or register the runtime first.`,
    );
  return {
    channel: config.channel ?? "packaged",
    home,
    launch: {
      command: config.launch.command,
      args: config.launch.args,
      env: { ...config.launch.env, SHOWAI_HOME: home },
    },
    runtime: config.launch.args[0],
  };
}

async function install(executable) {
  const binding = await resolveBinding();
  const probe = JSON.parse(
    (
      await execute(
        binding.launch.command,
        [...binding.launch.args, "runtime", "info", "--json"],
        {
          env: { ...process.env, ...binding.launch.env },
          maxBuffer: 16 * 1024 * 1024,
        },
      )
    ).stdout,
  );
  if (!probe.ok || resolve(probe.data.home) !== binding.home)
    throw new Error(
      `The runtime reports another library: ${probe.data?.home}`,
    );

  log("Preparing the ShowAI skills…");
  process.stderr.write(
    (
      await execute(process.execPath, [join(root, "scripts/package-plugin.mjs")], {
        cwd: root,
      })
    ).stdout,
  );
  const source = join(root, "plugins/showai-antigravity");
  const plugin = join(generated, "plugin");
  const record = join(generated, "agent-runtime.json");
  await rm(plugin, { recursive: true, force: true });
  await cp(source, plugin, { recursive: true });
  if (values.port) {
    const channel = `开发通道 showai-dev（${values.mode} ${values.port}，内容库 ${binding.home.replace(homedir(), "~")}）`;
    for (const entry of await readdir(join(plugin, "skills"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const file = join(plugin, "skills", entry.name, "SKILL.md");
      const text = await readFile(file, "utf8");
      if (!/^description: /m.test(text))
        throw new Error(`${file} has no description line.`);
      await writeFile(
        file,
        text.replace(/^description: /m, `description: ${channel}：`),
      );
    }
  }
  const manifest = JSON.parse(await readFile(join(source, "plugin.json"), "utf8"));
  const version = values.port
    ? `${manifest.version}+dev.${createHash("sha256")
        .update(
          JSON.stringify([
            await skillFiles(source),
            { home: binding.home, launch: binding.launch },
          ]),
        )
        .digest("hex")
        .slice(0, 12)}`
    : manifest.version;
  await writeJson(
    join(plugin, "plugin.json"),
    antigravityManifest(manifest, version),
  );
  await writeJson(record, {
    format: "showai-agent-runtime",
    protocol: 1,
    version: probe.data.version,
    home: binding.home,
    launch: binding.launch,
    channel: binding.channel,
    registeredAt: new Date().toISOString(),
  });
  const targetInstallPath = join(agyHome(), ".gemini/config/plugins/showai");
  const serverEnv = {
    ...binding.launch.env,
    SHOWAI_HOME: binding.home,
    SHOWAI_RUNTIME_CONFIG: record,
    SHOWAI_HOST_DISPLAY: "mcp-app",
    SHOWAI_ANTIGRAVITY_WORKBENCH: "1",
  };
  const server = {
    command: binding.launch.command,
    args: [join(targetInstallPath, "mcp/launch.mjs")],
    env: serverEnv,
    tools: ANTIGRAVITY_EAGER_TOOLS,
  };
  await writeJson(join(plugin, "mcp_config.json"), {
    mcpServers: { showai: server },
  });
  const sidecarRevision = createHash("sha256")
    .update(
      JSON.stringify([
        await readFile(join(plugin, "sidecars/workbench/main.mjs"), "utf8"),
        await readFile(join(plugin, "sidecars/workbench/bridge.js"), "utf8"),
      ]),
    )
    .digest("hex")
    .slice(0, 12);
  await writeJson(
    join(plugin, "sidecars/workbench/sidecar.json"),
    antigravitySidecarConfig({
      command: binding.launch.command,
      env: { ...serverEnv, SHOWAI_SIDECAR_REVISION: sidecarRevision },
    }),
  );

  await agy(executable, ["install", plugin]);
  const find = async () =>
    (await agyJson(executable, ["list"])).find(
      (item) => item.name === "showai",
    );
  if (!(await find())?.enabled) await agy(executable, ["enable", "showai"]);
  const installed = await find();
  if (!installed?.enabled || installed.version !== version || !installed.path)
    throw new Error(
      `Antigravity did not confirm showai ${version} enabled: ${JSON.stringify(installed)}`,
    );
  const expected = JSON.stringify(await skillFiles(plugin));
  const copied = await skillFiles(installed.path);
  if (JSON.stringify(copied) !== expected)
    throw new Error(
      `Installed files at ${installed.path} differ from ${plugin}.`,
    );
  const validation = await agyJson(executable, [
    "validate",
    installed.path,
    "--strict",
  ]);
  if (
    (validation.components?.mcpServers ?? 0) < 1 ||
    (validation.components?.sidecars ?? 0) < 1 ||
    (validation.findings?.length ?? 0) > 0
  )
    throw new Error(
      `Antigravity plugin validation failed: ${JSON.stringify(validation)}`,
    );
  const connection = await handshake(server);
  if (
    connection.capabilities.version !== probe.data.version ||
    connection.capabilities.presentation?.declaredHostDisplay !== "mcp-app" ||
    connection.tools < 2
  )
    throw new Error(
      `The plugin connected to an unexpected ShowAI: ${JSON.stringify(connection)}`,
    );
  return {
    ok: true,
    action: "install",
    pluginId: "showai",
    version,
    enabled: installed.enabled,
    installedPath: installed.path,
    verifiedFiles: Object.keys(copied).length,
    validation: {
      agentPluginsSpec: validation.agentPluginsSpec,
      components: validation.components,
      findings: validation.findings,
    },
    ...(binding.instance ? { instance: binding.instance } : {}),
    home: binding.home,
    runtime: binding.runtime,
    runtimeVersion: probe.data.version,
    runtimeRecord: record,
    mcp: {
      server: connection.server,
      tools: connection.tools,
      cardPresent: connection.toolNames.includes("card_present"),
    },
    hostRefresh:
      "Restart Antigravity or start a new conversation to use the updated plugin.",
  };
}

async function remove(executable) {
  const items = await agyJson(executable, ["list"]);
  if (items.some((item) => item.name === "showai"))
    await agy(executable, ["uninstall", "showai"]);
  await rm(generated, { recursive: true, force: true });
  return { ok: true, action: "remove", pluginId: "showai" };
}

const executable = await findAgy();
const receipt = values.remove
  ? await remove(executable)
  : await install(executable);
const stamped = { ...receipt, verifiedAt: new Date().toISOString() };
await writeJson(join(root, "artifacts/antigravity-plugin-install.json"), stamped);
if (values.json) process.stdout.write(JSON.stringify(stamped, null, 2) + "\n");
else if (stamped.action === "remove") log("Uninstalled ShowAI from Antigravity.");
else
  log(
    `Verified showai ${stamped.version} in Antigravity (${stamped.verifiedFiles} files, ${stamped.mcp.tools} MCP tools, library ${stamped.home}).\nInstalled at ${stamped.installedPath}`,
  );
