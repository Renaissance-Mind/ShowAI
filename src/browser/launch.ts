import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { startBrowserServer } from "./server";
import { workbenchAssets } from "./workbench-assets";
import { openBrowser } from "./system";
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
      ...workbenchAssets(join(dirname(runtime.cliEntry), "codex-workbench-assets")),
    },
  };
}

export async function runBrowser(options: {
  home?: string;
  port?: string;
  open: boolean;
  json: boolean;
}) {
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(
      "--port must be an integer between 0 and 65535 (0 chooses a free port).",
    );
  const server = await startBrowserServer({
    ...await browserRuntime(),
    home: options.home,
    port,
    settingsPath: join(homedir(), ".showai-browser", "settings.json"),
  });
  if (options.json)
    process.stdout.write(
      JSON.stringify({
        ok: true,
        data: { url: server.url, home: server.home, mode: "browser" },
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
  if (options.open)
    await openBrowser(server.url).catch((error: Error) => {
      process.stderr.write(
        t("openBrowserFailed", { message: error.message, url: server.url }) +
          "\n",
      );
    });
}
