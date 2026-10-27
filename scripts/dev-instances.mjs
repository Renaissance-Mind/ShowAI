// Read-only view of every ShowAI App serving one content library, for
// `npm run dev:status`. Sources: presence records the Apps write
// (<home>/local/instances), development launchers of this source root
// (.showai-dev/<mode>-<port>/session.json), and running processes whose
// command matches the launch registered in <home>/agent-runtime.json (Apps
// built before presence records existed).
import { execFile } from "node:child_process";
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  processAlive,
  readInstances,
} from "../src/core/instance-presence.mjs";

const missing = (error) => error.code === "ENOENT" || error.code === "ENOTDIR";

async function readJson(path) {
  const text = await readFile(path, "utf8").catch((error) => {
    if (missing(error)) return undefined;
    throw error;
  });
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A record being replaced or damaged is reported as unreadable, not fatal.
    return null;
  }
}

/** Resolves symbolic links (/tmp → /private/tmp) so libraries compare equal. */
export async function canonicalPath(path) {
  return realpath(resolve(path)).catch((error) => {
    if (missing(error)) return resolve(path);
    throw error;
  });
}

/**
 * pid → full command line. LC_ALL keeps non-ASCII App names (ShowAI 稳定版)
 * unescaped. Undefined where `ps` does not exist (Windows).
 */
export async function processCommands() {
  if (process.platform === "win32") return undefined;
  const { stdout } = await promisify(execFile)(
    "ps",
    ["-axww", "-o", "pid=,command="],
    {
      env: { ...process.env, LC_ALL: "en_US.UTF-8" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const commands = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match) commands.set(Number(match[1]), match[2]);
  }
  return commands;
}

/** <home>/agent-runtime.json: which App's CLI and MCP Agents launch. */
export async function readRegistration(home) {
  const path = join(home, "agent-runtime.json");
  const value = await readJson(path);
  if (value === undefined) return { path, state: "missing" };
  if (
    value?.format !== "showai-agent-runtime" ||
    typeof value.launch?.command !== "string" ||
    !Array.isArray(value.launch.args) ||
    typeof value.launch.args[0] !== "string"
  )
    return { path, state: "invalid" };
  return {
    path,
    state: "registered",
    version: value.version,
    ...(value.channel ? { channel: value.channel } : {}),
    home: value.home,
    command: value.launch.command,
    entry: value.launch.args[0],
    ...(value.registeredAt ? { registeredAt: value.registeredAt } : {}),
  };
}

/** The development launcher directory a runtime entry belongs to. */
function developmentDirectory(entry) {
  return /^(.*[\\/]\.showai-dev[\\/](?:desktop|browser)-\d+)[\\/]runtime[\\/]scripts[\\/]cli\.mjs$/.exec(
    entry,
  )?.[1];
}

/**
 * How a process relates to a registered launch: "app" (an open desktop App
 * or browser server), "cli" (a CLI/MCP child Agents started) or undefined.
 */
export function launchRole(line, registration) {
  const { command, entry } = registration;
  if (!line.startsWith(command)) return undefined;
  const rest = line.slice(command.length);
  if (rest && !rest.startsWith(" ")) return undefined;
  const development = developmentDirectory(entry);
  if (development) {
    // Every development desktop shares one Electron binary; its backend
    // argument names the launcher directory.
    if (
      rest.startsWith(` ${join(development, "desktop")}`) ||
      rest.startsWith(` ${join(development, "browser.mjs")}`)
    )
      return "app";
  } else if (rest.startsWith(` ${entry} serve`)) return "app";
  if (rest.startsWith(` ${entry}`)) return "cli";
  // Chromium helper processes (GPU, renderer, utility) are part of an App, not one.
  if (/(?:^|\s)--type=/.test(rest)) return undefined;
  // Processes carrying a script argument are CLI/MCP children, not open Apps.
  if (development || /\.(?:mjs|cjs|js)(?:\s|$)/.test(rest)) return undefined;
  return "app";
}

async function developmentSessions(root, home, commands) {
  const directory = join(root, ".showai-dev");
  const names = await readdir(directory).catch((error) => {
    if (missing(error)) return [];
    throw error;
  });
  const sessions = [];
  for (const name of names) {
    const match = /^(desktop|browser)-(\d+)$/.exec(name);
    if (!match) continue;
    const path = join(directory, name, "session.json");
    const session = await readJson(path);
    if (!session?.home || !Number.isInteger(session.backendPid)) continue;
    if (!processAlive(session.pid) || !processAlive(session.backendPid))
      continue;
    // A reused pid no longer runs this launcher.
    if (commands && !commands.get(session.pid)?.includes("dev.mjs")) continue;
    if ((await canonicalPath(session.home)) !== home) continue;
    sessions.push({
      path,
      directory: join(directory, name),
      mode: match[1],
      port: Number(match[2]),
      session,
    });
  }
  return sessions;
}

async function quitBlocked(path, pid) {
  if (!path) return undefined;
  const record = await readJson(path);
  if (!record || record.format !== "showai-quit-blocked" || record.pid !== pid)
    return undefined;
  return {
    path,
    updatedAt: record.updatedAt,
    windows: (record.windows ?? []).map((window) => ({
      windowId: window.windowId,
      title: window.title,
      state: window.state,
      codes: (window.blockers ?? []).map((blocker) => blocker.code),
    })),
  };
}

function label(instance) {
  const kind = `${instance.channel ?? "unknown"} ${instance.mode ?? "app"}`;
  const where = instance.port ? ` :${instance.port}` : "";
  const version = instance.sourceCommit
    ? `, commit ${String(instance.sourceCommit).slice(0, 7)}`
    : instance.appVersion
      ? `, ${instance.appVersion}`
      : "";
  return `${kind}${where} (pid ${instance.pid}${version})`;
}

/**
 * Every live App serving `home`, the registration Agents use, and warnings.
 * `self` / `selfLauncher` are the backend and launcher pids of the development
 * service on the requested port; `selfQuitRecord` is the quit-blocked.json
 * path that service reports.
 */
export async function libraryInstances({
  root,
  home: requested,
  self,
  selfLauncher,
  selfQuitRecord,
}) {
  const home = await canonicalPath(requested);
  const commands = await processCommands();
  const registration = await readRegistration(home);
  const byPid = new Map();
  const add = (pid, fields, evidence) => {
    const current = byPid.get(pid) ?? { pid, evidence: [] };
    for (const [key, value] of Object.entries(fields))
      if (value !== undefined && current[key] === undefined)
        current[key] = value;
    current.evidence.push(evidence);
    byPid.set(pid, current);
  };
  const { instances: present, ignored } = await readInstances(home, commands);
  for (const record of present)
    add(
      record.pid,
      {
        mode: record.mode,
        channel: record.channel,
        appVersion: record.appVersion,
        sourceCommit: record.sourceCommit,
        url: record.url ?? record.developmentUrl,
        startedAt: record.startedAt,
        entry: record.cli?.args?.[0],
        executable: record.executable,
        logs: record.logs,
        presence: record.path,
        homeConfirmed: true,
      },
      "presence",
    );
  for (const found of await developmentSessions(root, home, commands))
    add(
      found.session.backendPid,
      {
        mode: found.mode,
        channel: "development",
        port: found.port,
        url: found.session.url,
        launcherPid: found.session.pid,
        branch: found.session.branch,
        sourceCommit: found.session.startedCommit ?? found.session.commit,
        startedAt: found.session.startedAt,
        entry: join(found.directory, "runtime", "scripts", "cli.mjs"),
        session: found.path,
        homeConfirmed: true,
      },
      "development-session",
    );
  let cliProcesses = 0;
  if (registration.state === "registered" && commands)
    for (const [pid, line] of commands) {
      const role = launchRole(line, registration);
      if (role === "cli") cliProcesses++;
      if (role !== "app") continue;
      add(
        pid,
        {
          ...(developmentDirectory(registration.entry)
            ? { channel: "development" }
            : registration.channel
              ? { channel: registration.channel }
              : {}),
          mode: /\bserve\b|browser\.mjs/.test(line) ? "browser" : "desktop",
          // The version the registration names; the process is that build.
          appVersion: registration.version,
          entry: registration.entry,
          // Older Apps say nothing about their library; the registration names it.
          homeConfirmed: false,
        },
        "registered-command",
      );
    }
  const instances = [...byPid.values()].sort((a, b) => a.pid - b.pid);
  for (const instance of instances) {
    instance.command = commands?.get(instance.pid)?.slice(0, 400);
    instance.self =
      (self !== undefined && instance.pid === self) ||
      (selfLauncher !== undefined && instance.launcherPid === selfLauncher);
    instance.registered =
      registration.state === "registered" &&
      (instance.entry === registration.entry ||
        instance.evidence.includes("registered-command"));
    const record = instance.logs
      ? join(instance.logs, "quit-blocked.json")
      : instance.self
        ? selfQuitRecord
        : undefined;
    const blocked = await quitBlocked(record, instance.pid);
    if (blocked) instance.quitBlocked = blocked;
  }
  const registeredInstances = instances.filter((item) => item.registered);
  const registered =
    registration.state === "registered"
      ? {
          ...registration,
          pids: registeredInstances.map((item) => item.pid),
          running: registeredInstances.length > 0,
          self: registeredInstances.some((item) => item.self),
          cliProcesses,
          ...(registeredInstances.length
            ? { instance: registeredInstances.map(label).join(", ") }
            : {}),
        }
      : registration;
  const warnings = [];
  if (instances.length > 1)
    warnings.push({
      code: "MULTIPLE_INSTANCES",
      message: `${instances.length} 个 ShowAI 实例同时使用内容库 ${home}：${instances.map(label).join("；")}。agent-runtime.json ${registeredInstances.length ? `登记的是 ${registeredInstances.map(label).join("、")}` : registration.state === "registered" ? `登记的 ${registration.command} 没有在运行` : "没有有效登记"}；Agent 的 CLI/MCP 按该登记启动。`,
      pids: instances.map((item) => item.pid),
    });
  if (registration.state === "missing")
    warnings.push({
      code: "REGISTRATION_MISSING",
      message: `${registration.path} 不存在，Agent 插件无法找到这个内容库的启动方式。`,
    });
  if (registration.state === "invalid")
    warnings.push({
      code: "REGISTRATION_INVALID",
      message: `${registration.path} 无法识别，可在 设置 → 插件 → 修复登记 中重新登记。`,
    });
  if (registration.state === "registered" && !registeredInstances.length)
    warnings.push({
      code: "REGISTERED_NOT_RUNNING",
      message: `agent-runtime.json 登记的 ${registration.channel ?? ""} ${registration.version}（${registration.command}）当前没有作为 App 运行；Agent 启动的 CLI/MCP 仍会使用它。`,
    });
  if (
    instances.some((item) => item.self) &&
    registration.state === "registered" &&
    registeredInstances.length &&
    !registeredInstances.some((item) => item.self)
  )
    warnings.push({
      code: "REGISTERED_ELSEWHERE",
      message: `agent-runtime.json 登记的是 ${registeredInstances.map(label).join("、")}，不是本端口的开发服务；Agent 的 CLI/MCP 不会使用本端口的代码。`,
    });
  for (const instance of instances)
    if (instance.quitBlocked)
      warnings.push({
        code: "QUIT_BLOCKED",
        message: `${label(instance)} 有 ${instance.quitBlocked.windows.length} 个窗口拒绝关闭，详见 ${instance.quitBlocked.path}`,
        pid: instance.pid,
      });
  return {
    home,
    instances,
    registered,
    warnings,
    ...(ignored.length ? { ignoredPresence: ignored } : {}),
  };
}
