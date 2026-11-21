import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline";

const bindingFile = new URL("./workbench-binding.json", import.meta.url);
const route = "/showai-workbench";

async function launchWorkbench(parentOrigin, signal) {
  const binding = JSON.parse(await readFile(bindingFile, "utf8"));
  const runtime = JSON.parse(await readFile(binding.runtimeConfig, "utf8"));
  if (runtime.format !== "showai-agent-runtime" || runtime.protocol !== 1 ||
      !isAbsolute(binding.home) || resolve(runtime.home) !== binding.home ||
      !isAbsolute(runtime.launch?.command ?? "") ||
      !Array.isArray(runtime.launch.args) || !runtime.launch.args.every(arg => typeof arg === "string"))
    throw new Error("Update the DeepSeek Harness plugin in ShowAI to bind its runtime and library.");
  signal.throwIfAborted();
  const child = spawn(runtime.launch.command, [...runtime.launch.args, "serve", "--home", binding.home,
    "--port", "0", "--no-open", "--json", "--dsh-origin", parentOrigin], {
    cwd: binding.home,
    env: { ...process.env, ...runtime.launch.env, SHOWAI_HOME: binding.home },
    stdio: ["pipe", "pipe", "pipe"],
    signal,
  });
  const lines = createInterface({ input: child.stdout });
  let errorOutput = "";
  child.stderr.on("data", chunk => { errorOutput = (errorOutput + chunk).slice(-1024); });
  return new Promise((done, fail) => {
    const timer = setTimeout(() => stop(new Error("The ShowAI workbench did not start in time.")), 30000);
    function stop(error) {
      clearTimeout(timer);
      if (child.exitCode === null && !child.killed) child.kill();
      fail(error);
    }
    child.on("error", stop);
    child.once("exit", () => {
      clearTimeout(timer);
      fail(new Error(errorOutput.trim() || "The ShowAI runtime stopped. Update the plugin and try again."));
    });
    lines.on("line", line => {
      if (!line.startsWith("{")) return;
      try {
        const result = JSON.parse(line);
        const url = URL.parse(result.data?.url);
        if (!result.ok || result.data?.mode !== "dsh-workbench" || result.data.home !== binding.home ||
            url?.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
            !/^[a-f0-9]{64}$/.test(url.searchParams.get("dshWorkbench") ?? ""))
          throw new Error(result.error?.message || "Update the registered ShowAI runtime to use the Harness workbench.");
        clearTimeout(timer);
        done({ child, url: url.href });
      } catch (error) { stop(error); }
    });
  });
}

export function registerWorkbench(ctx) {
  const sessions = new Map();
  const lifetime = new AbortController();
  const unregister = ctx.webServer.register({
    kind: "exact", path: route,
    async handler(request, response) {
      const protocol = request.socket?.encrypted ? "https:" : "http:";
      const listener = URL.parse(protocol + "//" + request.headers.host);
      const peer = request.socket?.remoteAddress;
      const desktop = request.headers["x-showai-workbench"] === "desktop";
      const marker = desktop ? "desktop" : "1";
      const parentOrigin = desktop ? "dsh-app://app" : request.headers.origin;
      // Only the local Harness UI may request an editor attached to this library.
      // Electron's authenticated protocol forwarder removes the browser Origin.
      if (request.method !== "POST" || !listener || listener.host !== request.headers.host ||
          !["localhost", "127.0.0.1", "[::1]"].includes(listener.hostname) ||
          Number(listener.port || (protocol === "https:" ? 443 : 80)) !== request.socket?.localPort ||
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) ||
          request.headers["x-showai-workbench"] !== marker ||
          (desktop ? request.headers.origin !== undefined : parentOrigin !== listener.origin)) {
        response.writeHead(403).end(); return;
      }
      const connection = ctx.get("connection");
      const admission = connection?.admit?.(request);
      if (!admission?.peer || admission.peer !== connection.browserPeer) {
        response.writeHead(admission?.rejection ?? 403).end(); return;
      }
      const headers = { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" };
      try {
        let starting = sessions.get(parentOrigin);
        if (!starting) {
          starting = launchWorkbench(parentOrigin, lifetime.signal);
          sessions.set(parentOrigin, starting);
          const forget = () => { if (sessions.get(parentOrigin) === starting) sessions.delete(parentOrigin); };
          starting.then(({ child }) => child.once("exit", forget), forget);
        }
        const { url } = await starting;
        response.writeHead(200, headers).end(JSON.stringify({ url }));
      } catch (error) {
        ctx.logger?.warn?.(`ShowAI workbench: ${error.message}`);
        response.writeHead(503, headers).end(JSON.stringify({ error: error.message }));
      }
    },
  });
  return () => { lifetime.abort(); unregister(); };
}
