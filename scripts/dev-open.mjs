import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { canonicalPath, libraryInstances } from "./dev-instances.mjs";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    status: { type: "boolean" },
    port: { type: "string" },
    home: { type: "string" },
    url: { type: "string" },
    "no-focus": { type: "boolean" },
  },
});
const readJson = (path) =>
  readFile(path, "utf8")
    .then(JSON.parse)
    .catch((error) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
const config = (await readJson(join(root, ".showai-dev/launcher.json"))) ?? {};
const mode = positionals[0] ?? "desktop";
if (!["desktop", "browser"].includes(mode) || positionals.length > 1)
  throw new Error("Choose desktop or browser.");
const port = Number(values.port ?? config.port ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("Invalid development port.");
const home = resolve(
  values.home ?? config.home ?? join(root, ".showai-dev/library"),
);
const origin = `http://127.0.0.1:${port}`;
const directory = join(root, ".showai-dev", `${mode}-${port}`);
const logPath = join(directory, "development.log");
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}
async function status() {
  const response = await fetch(origin + "/__showai-dev/status", {
    signal: AbortSignal.timeout(2000),
  }).catch((error) => {
    if (["ECONNREFUSED", "ECONNRESET"].includes(error.cause?.code))
      return undefined;
    throw error;
  });
  if (!response) return undefined;
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new Error(`${origin} 已被其他服务占用，请先核对正在运行的进程。`);
  const result = await response.json();
  if (
    result.protocol !== "showai-development-v1" ||
    resolve(result.root) !== root
  )
    throw new Error(`${origin} 不是当前源码目录的 ShowAI 开发服务。`);
  if (!values.status && (result.mode !== mode || resolve(result.home) !== home))
    throw new Error(
      `现有开发服务使用 ${result.mode} 模式和 ${result.home} 内容库，请沿用现有配置或协调后再更换。`,
    );
  return result;
}
/** The most recent launcher record of this port, for a service that is gone. */
async function lastSession() {
  const records = [];
  for (const kind of ["desktop", "browser"]) {
    const folder = join(root, ".showai-dev", `${kind}-${port}`);
    const session = await readJson(join(folder, "session.json")).catch(
      (error) => {
        // A record being replaced is reported as unreadable, not fatal.
        if (error instanceof SyntaxError) return null;
        throw error;
      },
    );
    if (session === undefined) continue;
    const log = join(folder, "development.log");
    records.push({
      path: join(folder, "session.json"),
      mode: kind,
      ...(session
        ? {
            pid: session.pid,
            running: Number.isInteger(session.pid) && alive(session.pid),
            backendPid: session.backendPid,
            home: session.home,
            startedAt: session.startedAt,
          }
        : { unreadable: true }),
      logPath: (await stat(log).catch(() => undefined)) ? log : undefined,
    });
  }
  return records.sort((a, b) =>
    String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")),
  )[0];
}

/** A launcher started before it reported reasons: infer what is visible. */
async function legacyReason(current) {
  const folder = join(root, ".showai-dev", `${current.mode}-${port}`);
  const session = await readJson(join(folder, "session.json")).catch(
    (error) => {
      if (error instanceof SyntaxError) return undefined;
      throw error;
    },
  );
  const previous = session?.backendPid;
  const base = {
    legacyLauncher: true,
    logPath: join(folder, "development.log"),
  };
  if (current.backendPid)
    return {
      code: "BACKEND_NOT_READY",
      message: "本地服务进程已启动但还没有就绪",
      ...base,
    };
  if (Number.isInteger(previous) && alive(previous))
    return {
      code: "WAITING_FOR_APP_QUIT",
      message: `上一个本地服务进程 ${previous} 仍在运行，开发服务正在等待它退出后再启动新版本：窗口可能正显示保存提示，或它正在停止后台任务（如内容库维护）`,
      pid: previous,
      ...base,
    };
  return {
    code: "BACKEND_NOT_RUNNING",
    message:
      "开发服务在运行，但本地服务进程不存在：可能正在重启，或已意外退出并等待修复源码。查看启动日志了解详情",
    ...base,
  };
}

/**
 * dev:status: the service on this port, why it is not ready, what keeps a
 * restart waiting, and every App instance serving the requested library.
 * Read-only; exit code 0 only when the service is ready.
 */
async function statusReport() {
  let problem;
  const response = await fetch(origin + "/__showai-dev/status", {
    signal: AbortSignal.timeout(2000),
  }).catch((error) => {
    if (["ECONNREFUSED", "ECONNRESET"].includes(error.cause?.code)) {
      problem = {
        code: "NOT_LISTENING",
        message: `${origin} 上没有开发服务在监听（没有启动、已停止或启动失败）`,
      };
      return undefined;
    }
    if (error.name === "TimeoutError") {
      problem = {
        code: "NO_RESPONSE",
        message: `${origin} 在 2 秒内没有回应状态请求，开发服务可能正忙或已卡住`,
      };
      return undefined;
    }
    throw error;
  });
  let current;
  if (response) {
    const body =
      response.ok &&
      response.headers.get("content-type")?.includes("application/json")
        ? await response.json().catch(() => undefined)
        : undefined;
    if (body?.protocol !== "showai-development-v1")
      problem = {
        code: "PORT_IN_USE",
        message: `${origin} 被其他服务占用（HTTP ${response.status}），不是 ShowAI 开发服务`,
      };
    else if (resolve(body.root) !== root)
      problem = {
        code: "OTHER_SOURCE_ROOT",
        message: `${origin} 是另一份源码目录的 ShowAI 开发服务：${body.root}`,
        service: {
          root: body.root,
          mode: body.mode,
          home: body.home,
          ready: body.ready,
          pid: body.pid,
        },
      };
    else current = body;
  }
  if (current && !current.ready)
    problem = current.reason ?? (await legacyReason(current));
  if (problem && !current) {
    const session = await lastSession();
    if (session) problem.lastSession = session;
  }
  const instances = await libraryInstances({
    root,
    home,
    self: current?.backendPid,
    selfLauncher: current?.pid,
    selfQuitRecord: current?.quitRecord,
  });
  const warnings = [...instances.warnings];
  if (current && (await canonicalPath(current.home)) !== instances.home)
    warnings.unshift({
      code: "HOME_MISMATCH",
      message: `${origin} 的开发服务使用内容库 ${current.home}，不是 ${home}；instances 列出的是 ${home} 的实例。`,
    });
  if (current?.pendingRestart)
    warnings.unshift({
      code: "PENDING_RESTART",
      message: `本地服务仍在运行启动时的代码（${String(current.startedCommit ?? "").slice(0, 7)}）：${current.pendingRestart.message ?? current.pendingRestart.code}`,
    });
  if (current?.stopBlocked)
    warnings.unshift({
      code: "STOP_BLOCKED",
      message: current.stopBlocked.message ?? current.stopBlocked.code,
    });
  return {
    ...(current ?? {
      protocol: "showai-development-v1",
      ready: false,
      root,
      url: origin,
      home,
    }),
    ready: !!current?.ready,
    ...(problem ? { reason: problem } : {}),
    instances: instances.instances,
    registered: instances.registered,
    warnings,
    ...(instances.ignoredPresence
      ? { ignoredPresence: instances.ignoredPresence }
      : {}),
  };
}

if (values.status) {
  const report = await statusReport();
  console.log(JSON.stringify(report));
  process.exit(report.ready ? 0 : 1);
}
await mkdir(directory, { recursive: true });
const lock = join(directory, "launch.lock");
const deadline = Date.now() + 90000;
let owned = false;
while (!owned) {
  owned = await mkdir(lock).then(
    () => true,
    (error) => {
      if (error.code === "EEXIST") return false;
      throw error;
    },
  );
  if (owned) {
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid }),
    );
    break;
  }
  const owner = await readJson(join(lock, "owner.json"));
  if (
    owner ? !alive(owner.pid) : Date.now() - (await stat(lock)).mtimeMs > 10000
  ) {
    await rm(lock, { recursive: true });
    continue;
  }
  if (Date.now() > deadline)
    throw new Error(`另一个启动请求仍在运行，请查看 ${logPath}`);
  await delay(250);
}
try {
  let current = await status();
  let started;
  if (!current) {
    const log = await open(logPath, "a");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      process.execPath,
      [
        join(root, "scripts/dev.mjs"),
        mode,
        "--port",
        String(port),
        "--home",
        home,
        "--no-open",
      ],
      {
        cwd: root,
        env,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    await once(child, "spawn");
    started = child.pid;
    child.unref();
    await log.close();
  }
  while (!current?.ready) {
    if (started && !alive(started))
      throw new Error(`ShowAI 开发服务启动失败。请查看 ${logPath}`);
    if (Date.now() > deadline)
      throw new Error(`ShowAI 开发服务启动超时。请查看 ${logPath}`);
    await delay(250);
    current = await status();
  }
  const focusUrl = new URL("/__showai-dev/focus", origin);
  if (values.url) focusUrl.searchParams.set("url", values.url);
  if (!values["no-focus"]) {
    const focused = await fetch(focusUrl, {
      method: "POST",
      headers: { Origin: origin },
    });
    if (!focused.ok)
      throw new Error(`无法打开开发窗口：${await focused.text()}`);
  }
  console.log(JSON.stringify({ ...current, logPath }));
} finally {
  await rm(lock, { recursive: true, force: true });
}
