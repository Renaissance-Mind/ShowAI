import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { access, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { withLibraryLock } from "../core/library-lock";
import { startBrowserServer } from "./server";
import { workbenchAssets } from "./workbench-assets";
import { openSystemUrl } from "../host/local-system";
import { translator } from "../i18n";
import messages from "../i18n/messages/workbench";

const t = translator(messages);

async function browserRuntime() {
  const cliEntry = process.env.SHOWAI_RUNTIME_ENTRY ?? fileURLToPath(import.meta.url);
  const runtimeWeb = resolve(dirname(cliEntry), "../web");
  const webRoot = await access(join(runtimeWeb, "index.html")).then(
    () => runtimeWeb,
    () => resolve(dirname(cliEntry), "../dist"),
  );
  return { cliEntry, webRoot };
}

export async function startCodexWorkbenchBrowser(options: {
  home: string;
  profile: string;
  key: string;
  host?: "codex" | "qoder";
}) {
  if (!isAbsolute(options.profile))
    throw new Error("SHOWAI_CODEX_WORKBENCH_PROFILE must be an absolute directory.");
  const runtime = await browserRuntime();
  const server = await startBrowserServer({
    ...runtime,
    home: options.home,
    settingsPath: join(options.profile, "settings.json"),
    agentWorkspaceRoot: join(options.profile, "agent-workspaces"),
    codexWorkbench: { key: options.key },
  });
  return {
    ...server,
    transport: {
      ...server.workbench,
      ...workbenchAssets(join(dirname(runtime.cliEntry), "codex-workbench-assets"), options.host),
    },
  };
}

export async function startAntigravityWorkbenchBrowser(options: {
  home: string;
  profile: string;
  key: string;
}) {
  if (!isAbsolute(options.profile))
    throw new Error("Antigravity workbench profile must be an absolute directory.");
  const runtime = await browserRuntime();
  return startBrowserServer({
    ...runtime,
    home: options.home,
    settingsPath: join(options.profile, "settings.json"),
    agentWorkspaceRoot: join(options.profile, "agent-workspaces"),
    antigravityWorkbench: { key: options.key },
  });
}

interface LinkedWorkbenchSession { id: string; url: string; home: string; pid: number }

async function linkedWorkbenchSession(home: string, id?: string) {
  try {
    const session = JSON.parse(await readFile(join(home, "local", "linked-workbench", "session.json"), "utf8")) as LinkedWorkbenchSession;
    if (session.home !== home || (id && session.id !== id) || !/^[a-f0-9-]{36}$/.test(session.id) ||
      !Number.isInteger(session.pid) || session.pid < 1) return;
    const url = new URL(session.url);
    if (url.hostname !== "127.0.0.1" || url.protocol !== "http:" || !url.port || url.username || url.password) return;
    const response = await fetch(new URL("/_showai/workbench", url), {
      method: "HEAD", redirect: "error", signal: AbortSignal.timeout(800),
    });
    if (response.headers.get("X-ShowAI-Workbench") === session.id) return session;
  } catch (error) {
    if (!(error instanceof SyntaxError || error instanceof TypeError ||
      (error instanceof Error && error.name === "TimeoutError") || (error as NodeJS.ErrnoException).code === "ENOENT")) throw error;
  }
}

export async function startLinkedWorkbenchBrowser(home: string) {
  return withLibraryLock(home, async () => {
    const running = await linkedWorkbenchSession(home);
    if (running) return running;
    const { cliEntry } = await browserRuntime();
    const profile = join(home, "local", "linked-workbench");
    await mkdir(profile, { recursive: true });
    const id = randomUUID();
    const logPath = join(profile, "server.log");
    const log = await open(logPath, "a", 0o600);
    const child = spawn(process.execPath, [cliEntry, "serve", "--home", home, "--linked-workbench", id, "--no-open", "--json"], {
      detached: true, windowsHide: true, stdio: ["ignore", log.fd, log.fd], cwd: home,
    });
    let failed: Error | undefined;
    child.once("error", error => { failed = error; });
    child.unref();
    await log.close();
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !failed && child.exitCode === null) {
      const session = await linkedWorkbenchSession(home, id);
      if (session) return session;
      await delay(120);
    }
    if (child.exitCode === null && child.pid) child.kill("SIGTERM");
    throw new Error(`ShowAI browser workbench could not start. See ${logPath}.`, { cause: failed });
  }, "linked-workbench");
}

async function runLinkedWorkbench(home: string, id: string) {
  const profile = join(home, "local", "linked-workbench");
  const server = await startBrowserServer({
    ...await browserRuntime(),
    home,
    settingsPath: join(profile, "settings.json"),
    agentWorkspaceRoot: join(profile, "agent-workspaces"),
    registerAgentRuntime: false,
    linkedWorkbench: { id },
  });
  const receipt = join(profile, "session.json");
  const temporary = join(profile, `${id}.json`);
  try {
    await mkdir(profile, { recursive: true });
    await writeFile(temporary, JSON.stringify({ id, url: server.url, home: server.home, pid: process.pid }), { mode: 0o600 });
    await rename(temporary, receipt);
  } catch (error) {
    await server.close();
    throw error;
  }
  let lastSeen = Date.now();
  const idle = setInterval(() => {
    if (server.connectedClients()) lastSeen = Date.now();
    if (Date.now() - lastSeen > 30 * 60_000) void stop();
  }, 30_000);
  idle.unref();
  async function stop() {
    clearInterval(idle);
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await server.close();
  }
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

export async function runBrowser(options: {
  home?: string;
  port?: string;
  open: boolean;
  json: boolean;
  dshOrigin?: string;
  linkedWorkbench?: string;
}) {
  if (options.linkedWorkbench) {
    if (!options.home || !isAbsolute(options.home) || options.open || options.dshOrigin ||
      !/^[a-f0-9-]{36}$/.test(options.linkedWorkbench)) throw new Error("Invalid local ShowAI workbench launch.");
    return runLinkedWorkbench(options.home, options.linkedWorkbench);
  }
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(
      "--port must be an integer between 0 and 65535 (0 chooses a free port).",
    );
  const dshWorkbench = options.dshOrigin === undefined ? undefined :
    { parentOrigin: options.dshOrigin, key: randomBytes(32).toString("hex") };
  if (dshWorkbench && (!options.home || !options.json || options.open))
    throw new Error("Harness requires --home, --json and --no-open.");
  const profile = dshWorkbench ? join(options.home!, "local", "dsh-workbench") : undefined;
  const server = await startBrowserServer({
    ...await browserRuntime(),
    home: options.home,
    port,
    settingsPath: profile ? join(profile, "settings.json") : join(homedir(), ".showai-browser", "settings.json"),
    ...(profile ? { dshWorkbench, agentWorkspaceRoot: join(profile, "agent-workspaces") } : {}),
  });
  const url = new URL(server.url);
  if (dshWorkbench) url.searchParams.set("dshWorkbench", dshWorkbench.key);
  if (options.json)
    process.stdout.write(
      JSON.stringify({
        ok: true,
        data: { url: url.href, home: server.home, mode: dshWorkbench ? "dsh-workbench" : "browser" },
      }) + "\n",
    );
  else
    process.stdout.write(
      t("serveReady", { url: server.url, home: server.home }) + "\n",
    );
  let closing = false;
  const stop = async () => {
    if (closing) return;
    closing = true;
    try {
      await server.close();
    } finally {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    }
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  if (dshWorkbench) {
    process.stdin.once("end", stop);
    process.stdin.resume();
  }
  if (options.open)
    await openSystemUrl(server.url).catch((error: Error) => {
      process.stderr.write(
        t("openBrowserFailed", { message: error.message, url: server.url }) +
          "\n",
      );
    });
}
