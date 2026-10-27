// Connects Claude Code in this checkout to one development instance. The main checkout gets
// showai-dev, each worktree showai-dev-<git worktree name>. Both are enabled in this checkout's own
// .claude/settings.json (project scope; Claude Code shares local settings between the worktrees
// of a repository), and the stable showai@showai-desktop is turned off there, so a session
// sees one ShowAI plugin. The plugin is pinned to the instance's library and runtime.
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { skillFiles } from "../src/plugin/host-package.mjs";

const execute = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STABLE = "showai@showai-desktop";
const usage =
  "Usage: npm run plugin:claude -- --port PORT [--mode desktop|browser] [--json]\n" +
  "       npm run plugin:claude -- --remove [--json]\n" +
  "       npm run plugin:claude -- --prune [--json]";
const { values } = parseArgs({
  options: {
    port: { type: "string" },
    mode: { type: "string", default: "desktop" },
    remove: { type: "boolean", default: false },
    prune: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
  },
});
const actions = [!!values.port, values.remove, values.prune].filter(Boolean);
if (actions.length !== 1 || !["desktop", "browser"].includes(values.mode))
  throw new Error(usage);

async function claude(args) {
  const result = await execute("claude", ["plugin", ...args], {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return result.stdout.trim();
}
const claudeJson = async (args) => JSON.parse(await claude([...args, "--json"]));
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
const exists = (path) =>
  access(path).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/** The main checkout is showai-dev; a worktree is named after its directory. */
async function checkout() {
  const git = async (...args) =>
    (await execute("git", ["rev-parse", "--path-format=absolute", ...args], { cwd: root })).stdout.trim();
  const [gitDir, commonDir, top] = (
    await git("--git-dir", "--git-common-dir", "--show-toplevel")
  ).split("\n");
  if ((await realpath(top)) !== (await realpath(root)))
    throw new Error(`Run from the checkout root ${top}.`);
  if ((await realpath(gitDir)) === (await realpath(commonDir)))
    return { worktree: false, name: "showai-dev" };
  // Git's worktree name (.git/worktrees/<name>) is unique in the repository; directory names
  // are not (every Codex worktree checks out into …/<id>/ShowAI).
  const slug = basename(gitDir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!slug) throw new Error(`Cannot name a plugin after worktree ${gitDir}.`);
  return { worktree: true, name: `showai-dev-${slug}` };
}

const generated = join(root, ".showai-dev/claude-plugin");
const projectSettings = join(root, ".claude/settings.json");

/** Turns plugins on or off for this checkout only, keeping its other settings. */
async function setProjectPlugins(changes) {
  const settings = (await readJson(projectSettings)) ?? {};
  const enabled = { ...settings.enabledPlugins };
  for (const [id, value] of Object.entries(changes)) {
    if (value === undefined) delete enabled[id];
    else enabled[id] = value;
  }
  const next = { ...settings, enabledPlugins: enabled };
  if (!Object.keys(enabled).length) delete next.enabledPlugins;
  if (Object.keys(next).length) await writeJson(projectSettings, next);
  else await rm(projectSettings, { force: true });
}

/** The per-checkout settings file is machine-specific; keep it out of every worktree's status. */
async function excludeProjectSettings() {
  const common = (
    await execute("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root })
  ).stdout.trim();
  const exclude = join(common, "info/exclude");
  const text = (await readFile(exclude, "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  }));
  const line = "/.claude/settings.json";
  if (text.split("\n").includes(line)) return;
  await mkdir(dirname(exclude), { recursive: true });
  await writeFile(exclude, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`);
}

/** One MCP handshake through the installed configuration, as Claude Code will start it. */
async function handshake(server, pluginRoot) {
  const child = spawn(
    server.command,
    server.args.map((arg) => arg.replace("${CLAUDE_PLUGIN_ROOT}", pluginRoot)),
    { env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "pipe"] },
  );
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
        () => fail(new Error(`No reply to ${method}: ${stderr.trim().slice(-2000)}`)),
        60000,
      );
      replies.set(++id, (message) => {
        clearTimeout(timer);
        done(message);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "showai-plugin-installer", version: "1" },
  });
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = (await request("tools/list", {})).result?.tools ?? [];
  const capabilities = await request("tools/call", { name: "showai_capabilities", arguments: {} });
  child.kill();
  const text = capabilities.result?.content?.[0]?.text;
  if (capabilities.result?.isError || !text)
    throw new Error(`ShowAI did not start through the plugin: ${text ?? stderr.trim().slice(-2000)}`);
  return { server: init.result?.serverInfo, tools: tools.length, capabilities: JSON.parse(text).data };
}

async function install(identity) {
  const instance = join(root, ".showai-dev", `${values.mode}-${values.port}`);
  const session = await readJson(join(instance, "session.json"));
  if (!session?.home || !session.runtime)
    throw new Error(
      `No development instance at ${instance}. Start it first: npm run dev:open -- --port ${values.port} --home <library>${values.mode === "browser" ? " browser" : ""}`,
    );
  const entry = join(session.runtime, "scripts/cli.mjs");
  if (!(await exists(entry))) throw new Error(`The instance has no built runtime at ${entry}.`);
  const electron = (await import("electron")).default;
  const launch = {
    command: electron,
    args: [entry],
    env: { ELECTRON_RUN_AS_NODE: "1", SHOWAI_HOME: session.home },
  };
  const probe = JSON.parse(
    (await execute(launch.command, [...launch.args, "runtime", "info", "--json"], {
      env: { ...process.env, ...launch.env },
      maxBuffer: 16 * 1024 * 1024,
    })).stdout,
  );
  if (!probe.ok || resolve(probe.data.home) !== resolve(session.home))
    throw new Error(`The instance runtime reports another library: ${probe.data?.home}`);

  // Same Skills and launcher as the generated Claude package; only identity and binding differ.
  process.stderr.write(
    (await execute(process.execPath, [join(root, "scripts/package-plugin.mjs")], { cwd: root })).stdout,
  );
  const source = join(root, "plugins/showai-claude");
  const plugin = join(generated, "plugin");
  const record = join(generated, "agent-runtime.json");
  await rm(plugin, { recursive: true, force: true });
  await cp(source, plugin, { recursive: true });
  const manifest = JSON.parse(await readFile(join(source, ".claude-plugin/plugin.json"), "utf8"));
  const binding = { home: resolve(session.home), launch };
  const version = `${manifest.version}+dev.${createHash("sha256")
    .update(JSON.stringify([await skillFiles(source), binding]))
    .digest("hex")
    .slice(0, 12)}`;
  const description = `ShowAI development plugin for ${root} (${values.mode} ${values.port}, library ${session.home}).`;
  await writeJson(join(plugin, ".claude-plugin/plugin.json"), {
    ...manifest,
    name: identity.name,
    version,
    description,
  });
  await writeJson(join(plugin, "plugin.json"), {
    ...JSON.parse(await readFile(join(source, "plugin.json"), "utf8")),
    name: identity.name,
    version,
  });
  const server = {
    command: launch.command,
    args: ["${CLAUDE_PLUGIN_ROOT}/mcp/launch.mjs"],
    env: {
      ELECTRON_RUN_AS_NODE: "1",
      SHOWAI_HOME: binding.home,
      SHOWAI_RUNTIME_CONFIG: record,
      SHOWAI_HOST_DISPLAY: "model-html",
    },
  };
  await writeJson(join(plugin, ".mcp.json"), { mcpServers: { showai: server } });
  await writeJson(record, {
    format: "showai-agent-runtime",
    protocol: 1,
    version: probe.data.version,
    home: binding.home,
    launch,
    channel: "development",
    registeredAt: new Date().toISOString(),
  });
  await writeJson(join(generated, ".claude-plugin/marketplace.json"), {
    name: identity.name,
    owner: { name: "ShowAI development" },
    plugins: [{ name: identity.name, source: "./plugin", version, description }],
  });

  const markets = await claudeJson(["marketplace", "list"]);
  const market = markets.find((item) => item.name === identity.name);
  if (market && (await realpath(market.path).catch(() => market.path)) !== (await realpath(generated)))
    throw new Error(`Marketplace ${identity.name} belongs to ${market.path}. Remove it there first.`);
  if (market) await claude(["marketplace", "update", identity.name]);
  else await claude(["marketplace", "add", generated, "--scope", "user"]);
  const id = `${identity.name}@${identity.name}`;
  const find = async () =>
    (await claudeJson(["list"])).find(
      (item) =>
        item.id === id &&
        item.scope === "project" &&
        item.projectPath &&
        resolve(item.projectPath) === resolve(root),
    );
  await excludeProjectSettings();
  await claude([(await find()) ? "update" : "install", id, "--scope", "project"]);
  await setProjectPlugins({ [STABLE]: false });
  const installed = await find();
  if (!installed?.enabled || installed.version !== version)
    throw new Error(`Claude Code did not confirm ${id} ${version} enabled here: ${JSON.stringify(installed)}`);
  const expected = JSON.stringify(await skillFiles(plugin));
  if (JSON.stringify(await skillFiles(installed.installPath)) !== expected)
    throw new Error(`Installed files at ${installed.installPath} differ from ${plugin}.`);
  const stable = (await claudeJson(["list"])).find((item) => item.id === STABLE && item.enabled);
  if (stable) throw new Error(`${STABLE} is still enabled in ${root}.`);
  const connection = await handshake(server, installed.installPath);
  // A launcher that cannot reach its runtime serves only showai_connection_problem.
  if (connection.capabilities.version !== probe.data.version || connection.tools < 2)
    throw new Error(`The plugin connected to an unexpected ShowAI: ${JSON.stringify(connection)}`);
  return {
    ok: true,
    action: "install",
    pluginId: id,
    scope: "project",
    projectPath: root,
    version,
    enabled: installed.enabled,
    installedPath: installed.installPath,
    readFromFolder: installed.readFromFolder,
    verifiedFiles: Object.keys(JSON.parse(expected)).length,
    instance: { mode: values.mode, port: Number(values.port), url: session.url },
    home: binding.home,
    runtime: entry,
    runtimeVersion: probe.data.version,
    runtimeRecord: record,
    mcp: { server: connection.server, tools: connection.tools },
    stableDisabledHere: STABLE,
    hostRefresh: "Start a new Claude Code session in this directory to use the plugin.",
  };
}

async function remove(identity) {
  const id = `${identity.name}@${identity.name}`;
  const markets = await claudeJson(["marketplace", "list"]);
  // Removing the marketplace also uninstalls its plugin in every scope.
  if (markets.some((item) => item.name === identity.name))
    await claude(["marketplace", "remove", identity.name]);
  await setProjectPlugins({ [id]: undefined, [STABLE]: undefined });
  await rm(generated, { recursive: true, force: true });
  return { ok: true, action: "remove", pluginId: id, projectPath: root };
}

/** Removes development marketplaces whose checkout no longer exists (archived worktrees). */
async function prune() {
  const removed = [];
  for (const item of await claudeJson(["marketplace", "list"])) {
    if (!/^showai-dev(-|$)/.test(item.name) || item.source !== "directory") continue;
    if (await exists(join(item.path, ".claude-plugin/marketplace.json"))) continue;
    await claude(["marketplace", "remove", item.name]);
    removed.push({ marketplace: item.name, path: item.path });
  }
  return { ok: true, action: "prune", removed };
}

const identity = await checkout();
const receipt = values.prune
  ? await prune()
  : values.remove
    ? await remove(identity)
    : await install(identity);
const stamped = { ...receipt, verifiedAt: new Date().toISOString() };
await writeJson(join(root, "artifacts/claude-plugin-install.json"), stamped);
process.stdout.write(JSON.stringify(stamped, null, 2) + "\n");
