import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { randomBytes } from "node:crypto";
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

export async function runBrowser(options: {
  home?: string;
  port?: string;
  open: boolean;
  json: boolean;
  dshOrigin?: string;
}) {
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
