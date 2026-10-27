// Which running ShowAI apps serve a content library. Each desktop or browser
// build that opens a library writes <home>/local/instances/<pid>.json and
// removes it when it switches libraries or exits. Readers ignore records of
// processes that are gone or whose command no longer matches.
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const INSTANCE_FORMAT = "showai-instance";

export function instanceDirectory(home) {
  return join(resolve(home), "local", "instances");
}

/** Whether a process exists; another user's process (EPERM) counts as running. */
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

// Paths this process published, with how many open libraries use each.
const published = new Map();
let exitHook = false;
function removeOnExit() {
  if (exitHook) return;
  exitHook = true;
  process.once("exit", () => {
    for (const path of published.keys()) rmSync(path, { force: true });
  });
}

async function pruneDead(directory) {
  const names = await readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of names) {
    const pid = Number(/^(\d+)\.json$/.exec(name)?.[1]);
    if (pid && pid !== process.pid && !processAlive(pid))
      await rm(join(directory, name), { force: true });
  }
}

/**
 * Announces that this process serves `home`. Returns a handle whose remove()
 * withdraws the announcement (library switch or orderly shutdown); the record
 * is also removed when the process exits.
 */
export async function publishInstance(home, details) {
  const directory = instanceDirectory(home);
  const path = join(directory, `${process.pid}.json`);
  await mkdir(directory, { recursive: true });
  await pruneDead(directory);
  const record = {
    format: INSTANCE_FORMAT,
    version: 1,
    pid: process.pid,
    ppid: process.ppid,
    mode: details.mode,
    channel: details.channel,
    appVersion: details.appVersion,
    sourceCommit: details.sourceCommit ?? "unknown",
    executable: process.execPath,
    entry: process.argv[1] ?? null,
    cli: details.cli
      ? { command: details.cli.command, args: [...details.cli.args] }
      : null,
    ...(details.url ? { url: details.url } : {}),
    ...(details.developmentUrl ? { developmentUrl: details.developmentUrl } : {}),
    ...(details.logs ? { logs: details.logs } : {}),
    ...(details.userData ? { userData: details.userData } : {}),
    home: resolve(home),
    startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
    publishedAt: new Date().toISOString(),
  };
  const temporary = join(directory, `.${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(record, null, 2) + "\n");
  await rename(temporary, path);
  published.set(path, (published.get(path) ?? 0) + 1);
  removeOnExit();
  let removed = false;
  return {
    path,
    record,
    async remove() {
      if (removed) return;
      removed = true;
      const count = (published.get(path) ?? 1) - 1;
      if (count > 0) {
        published.set(path, count);
        return;
      }
      published.delete(path);
      await rm(path, { force: true });
    },
  };
}

/**
 * Live instance records of a library. `commands` maps pid to its command line
 * (from `ps`); when given, a record whose process now runs another executable
 * (a reused pid) is ignored.
 */
export async function readInstances(home, commands) {
  const directory = instanceDirectory(home);
  const names = await readdir(directory).catch((error) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
    throw error;
  });
  const instances = [];
  const ignored = [];
  for (const name of names.filter((item) => /^\d+\.json$/.test(item))) {
    const path = join(directory, name);
    let record;
    try {
      record = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      // Written atomically; a vanished or damaged file is reported, not fatal.
      if (error.code === "ENOENT") continue;
      ignored.push({ path, reason: "INVALID" });
      continue;
    }
    if (record?.format !== INSTANCE_FORMAT || !Number.isInteger(record.pid)) {
      ignored.push({ path, reason: "INVALID" });
      continue;
    }
    if (!processAlive(record.pid)) {
      ignored.push({ path, pid: record.pid, reason: "NOT_RUNNING" });
      continue;
    }
    const command = commands?.get(record.pid);
    if (
      commands &&
      (command === undefined ||
        (typeof record.executable === "string" &&
          !command.startsWith(record.executable)))
    ) {
      ignored.push({ path, pid: record.pid, reason: "COMMAND_MISMATCH" });
      continue;
    }
    instances.push({ ...record, path });
  }
  return { instances, ignored };
}
