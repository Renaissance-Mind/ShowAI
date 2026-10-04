import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { startBrowserServer } from "./server";
import { openBrowser } from "./system";

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
  const cliEntry =
    process.env.SHOWAI_RUNTIME_ENTRY ?? fileURLToPath(import.meta.url);
  const runtimeWeb = resolve(dirname(cliEntry), "../web");
  const webRoot = await access(join(runtimeWeb, "index.html")).then(
    () => runtimeWeb,
    () => resolve(dirname(cliEntry), "../dist"),
  );
  const server = await startBrowserServer({
    home: options.home,
    port,
    cliEntry,
    webRoot,
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
      `ShowAI 本地工作台：${server.url}\n内容库：${server.home}\n按 Ctrl+C 停止服务。CLI 可以独立运行。\n`,
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
        `无法自动打开浏览器：${error.message}\n请手动打开 ${server.url}\n`,
      );
    });
}
