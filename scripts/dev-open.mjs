import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

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
if (values.status) {
  const current = await status();
  console.log(
    JSON.stringify(
      current ?? {
        protocol: "showai-development-v1",
        ready: false,
        root,
        url: origin,
        home,
      },
    ),
  );
  process.exit(current?.ready ? 0 : 1);
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
