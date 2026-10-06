import { join } from "node:path";
import { startBrowserServer } from "../src/browser/server";
import { openBrowser } from "../src/browser/system";

const runtime = process.env.SHOWAI_DEV_RUNTIME!;
const server = await startBrowserServer({
  home: process.env.SHOWAI_HOME,
  port: Number(process.env.SHOWAI_DEV_BACKEND_PORT),
  webRoot: runtime,
  cliEntry: join(runtime, "scripts/cli.mjs"),
  settingsPath: process.env.SHOWAI_DEV_SETTINGS!,
  development: {
    origin: process.env.SHOWAI_DEV_URL!,
    token: process.env.SHOWAI_DEV_TOKEN!,
  },
});
process.send?.({ type: "ready", home: server.home });
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await server.close();
  process.disconnect?.();
}
process.on("message", (message) => {
  if (message === "showai:development-quit") void stop();
  if (message === "showai:development-open")
    void openBrowser(server.url).catch((error) => {
      console.error(
        `无法自动打开浏览器：${error.message}\n请打开 ${server.url}`,
      );
    });
});
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
