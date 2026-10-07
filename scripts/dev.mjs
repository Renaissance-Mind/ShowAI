import { spawn, execFileSync, execFile } from "node:child_process";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { createServer as createNetServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdir, readFile, writeFile, rename, copyFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { watch } from "chokidar";
import { build as bundle } from "esbuild";
import { createServer } from "vite";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
import { developmentSessions } from "./dev-session.mjs";
import { developmentControl } from "./dev-control.mjs";
import { developmentCache } from "./dev-cache.mjs";

const startupTime = performance.now();
const root = fileURLToPath(new URL("../", import.meta.url));
process.chdir(root);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string" },
    home: { type: "string" },
    "no-open": { type: "boolean" },
    help: { type: "boolean" },
  },
});
const mode = positionals[0];
if (values.help) {
  console.log(
    "npm run dev:desktop|dev:browser -- [--port 5173] [--home /absolute/library] [--no-open]\n前端自动更新，本地服务保存完成后自动重启。不同 worktree 请使用不同端口与测试内容库。",
  );
  process.exit(0);
}
if (!["desktop", "browser"].includes(mode) || positionals.length !== 1)
  throw new Error("Choose desktop or browser development mode.");
const port = Number(values.port ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("--port must be an integer between 1 and 65535.");
const directory = join(root, ".showai-dev", `${mode}-${port}`);
const runtime = join(directory, "runtime");
const staging = join(directory, "staging");
const origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString("hex");
const git = (args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const readIdentity = () => ({
  root,
  mode,
  branch: git(["branch", "--show-current"]) || "detached",
  commit: git(["rev-parse", "HEAD"]),
});
let identity = readIdentity();
const cache = developmentCache(root, directory, mode);
let startup;
let launchedAt;
let startedCommit;
let sessionWrite = Promise.resolve();
await mkdir(join(runtime, "scripts"), { recursive: true });
await mkdir(join(runtime, "assets"), { recursive: true });
await mkdir(staging, { recursive: true });
await writeFile(
  join(runtime, "index.html"),
  "<!-- Development assets are provided by Vite. -->\n",
);

async function freePort() {
  const socket = createNetServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const result = socket.address().port;
  await new Promise((done, reject) =>
    socket.close((error) => (error ? reject(error) : done())),
  );
  return result;
}
const backendPort = mode === "browser" ? await freePort() : undefined;
const developmentPlugin = {
  name: "showai-development-workbench",
  resolveId(id) {
    if (id === "virtual:showai-development-info") return "\0" + id;
  },
  load(id) {
    if (id === "\0virtual:showai-development-info")
      return `export default ${JSON.stringify(identity)}`;
  },
  transformIndexHtml: {
    order: "pre",
    handler: () => [
      ...(mode === "browser"
        ? [
            {
              tag: "script",
              children: `window.__SHOWAI_LOCAL__=${JSON.stringify({ token })}`,
              injectTo: "head-prepend",
            },
          ]
        : []),
      {
        tag: "script",
        attrs: { type: "module", src: "/scripts/dev-client.mjs" },
        injectTo: "body",
      },
    ],
  },
};
// Own the HTTP and signal lifecycle so Vite cannot exit before drafts are saved.
const frontendServer = createHttpServer();
const vite = await createServer({
  root,
  cacheDir: join(directory, "vite-cache"),
  optimizeDeps: { entries: ["index.html"] },
  plugins: [developmentPlugin],
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    open: false,
    middlewareMode: true,
    ws: { server: frontendServer, clientPort: port },
    fs: {
      deny: [
        ".env",
        ".env.*",
        "*.{crt,pem,key,p12,pfx,cer,der}",
        ".npmrc",
        ".yarnrc.yml",
        "**/.git/**",
        "**/.showai-dev/**",
        "**/AGENTS.md",
      ],
    },
    watch: {
      ignored: [
        join(root, ".showai-dev/**"),
        join(root, "dist*/**"),
        join(root, "artifacts/**"),
        join(root, "output/**"),
        join(root, "public/portable.html"),
      ],
    },
    proxy:
      mode === "browser"
        ? {
            "/api": {
              target: `http://127.0.0.1:${backendPort}`,
              changeOrigin: false,
            },
          }
        : undefined,
  },
});
frontendServer.on(
  "request",
  developmentControl(
    origin,
    () => ({
      root: resolve(root),
      mode,
      url: origin + "/",
      home: environment.SHOWAI_HOME,
      branch: identity.branch,
      sourceCommit: identity.commit,
      startedCommit,
      startup,
      pid: process.pid,
      backendPid: child?.pid,
      ready: !!child && !!readyReceipt,
      cli: {
        command: process.execPath,
        args: [join(runtime, "scripts/cli.mjs")],
        env: { SHOWAI_HOME: environment.SHOWAI_HOME },
      },
    }),
    (url) => {
      if (mode === "desktop")
        child?.send({ type: "showai:development-focus", url });
      else child?.send("showai:development-open");
    },
    vite.middlewares,
  ),
);
const sessions = developmentSessions(vite.ws);
let child,
  watcher,
  identityWatcher,
  stopping = false,
  rebuilding = false,
  requested = false,
  timer;
let dependencies = new Set();
let readyReceipt;
const environment = {
  ...process.env,
  SHOWAI_DEV_URL: origin,
  SHOWAI_DEV_RUNTIME: runtime,
  SHOWAI_VIEWER: join(runtime, "assets/viewer.html"),
  SHOWAI_DEV_BACKEND_PORT: String(backendPort),
  SHOWAI_DEV_TOKEN: token,
  SHOWAI_DEV_SETTINGS: join(directory, "browser-settings.json"),
  SHOWAI_USER_DATA: process.env.SHOWAI_USER_DATA ?? join(directory, "profile"),
  SHOWAI_HOME: resolve(
    values.home ?? process.env.SHOWAI_HOME ?? join(root, ".showai-dev/library"),
  ),
};
delete environment.ELECTRON_RUN_AS_NODE;
const banner = {
  js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
};
const desktopCompiler = {
  name: "desktop-compiler-runtime",
  setup(builder) {
    builder.onResolve({ filter: /^esbuild$/ }, () => ({
      path: join(root, "src/desktop/compiler.ts"),
    }));
  },
};
const entrypoints = [
  {
    input: "src/agent/cli.ts",
    output: "runtime/scripts/cli.mjs",
    external: ["esbuild"],
    plugins: [rawSourcePlugin],
    banner,
  },
  ...(mode === "browser"
    ? [
        {
          input: "scripts/dev-browser-entry.ts",
          output: "browser.mjs",
          external: ["esbuild"],
          plugins: [rawSourcePlugin],
          banner,
        },
      ]
    : [
        {
          input: "src/desktop/main.ts",
          output: "desktop/main.mjs",
          external: ["electron"],
          plugins: [rawSourcePlugin, desktopCompiler],
          banner,
        },
        {
          input: "src/desktop/preload.ts",
          output: "desktop/preload.cjs",
          external: ["electron"],
          format: "cjs",
        },
      ]),
];
async function compile() {
  const before = await cache.fingerprint();
  const outputs = await Promise.all(
    entrypoints.map(async (entry) => {
      const result = await bundle({
        entryPoints: [join(root, entry.input)],
        outfile: join(directory, entry.output),
        platform: "node",
        target: "node22",
        format: entry.format ?? "esm",
        bundle: true,
        write: false,
        metafile: true,
        external: entry.external,
        plugins: entry.plugins,
        banner: entry.banner,
      });
      return result;
    }),
  );
  const inputs = outputs.flatMap((result) =>
    Object.keys(result.metafile.inputs),
  );
  dependencies = new Set(
    inputs.map((input) =>
      resolve(root, input.replace(/^showai-embedded-source:/, "")),
    ),
  );
  // A separate process keeps the portable production reader independent of
  // Vite's development NODE_ENV and the running React refresh server.
  await promisify(execFile)(
    process.execPath,
    [
      join(root, "node_modules/vite/bin/vite.js"),
      "build",
      "--config",
      join(root, "vite.portable.config.ts"),
      "--outDir",
      join(staging, "reader"),
      "--logLevel",
      "warn",
    ],
    { cwd: root, env: { ...process.env, NODE_ENV: "production" } },
  );
  const readerSources = await (
    await import("./build-reader-source.mjs")
  ).buildReaderSource(root, join(staging, "reader/reader-source.json"));
  for (const path of readerSources) dependencies.add(path);
  return { files: outputs.flatMap((result) => result.outputFiles), before };
}
async function publish({ files, before }) {
  for (const output of files) {
    await mkdir(resolve(output.path, ".."), { recursive: true });
    const temporary = output.path + ".tmp";
    await writeFile(temporary, output.contents);
    await rename(temporary, output.path);
  }
  const reader = join(runtime, "assets/viewer.html");
  await copyFile(join(staging, "reader/portable.html"), reader + ".tmp");
  await rename(reader + ".tmp", reader);
  const inlineReader = join(runtime, "assets/reader-source.json");
  await copyFile(
    join(staging, "reader/reader-source.json"),
    inlineReader + ".tmp",
  );
  await rename(inlineReader + ".tmp", inlineReader);
  if (mode === "desktop")
    await writeFile(
      join(directory, "desktop/package.json"),
      JSON.stringify({
        name: "showai-development",
        version: JSON.parse(await readFile(join(root, "package.json"), "utf8"))
          .version,
        main: "main.mjs",
      }),
    );
  await cache.save(before, dependencies, [
    ...files.map((output) => output.path),
    reader,
    inlineReader,
    ...(mode === "desktop" ? [join(directory, "desktop/package.json")] : []),
  ]);
}
function writeSession() {
  const snapshot =
    JSON.stringify(
      {
        ...identity,
        startedCommit,
        startup,
        url: origin + "/",
        pid: process.pid,
        backendPid: child?.pid,
        home: readyReceipt.home,
        runtime,
        startedAt: launchedAt,
      },
      null,
      2,
    ) + "\n";
  sessionWrite = sessionWrite.then(async () => {
    const path = join(directory, "session.json");
    await writeFile(path + ".tmp", snapshot);
    await rename(path + ".tmp", path);
  });
  return sessionWrite;
}
async function launch() {
  readyReceipt = undefined;
  const args =
    mode === "desktop"
      ? [join(directory, "desktop")]
      : [join(directory, "browser.mjs")];
  if (mode === "desktop" && process.env.SHOWAI_DEV_DEBUG_PORT)
    args.push(`--remote-debugging-port=${process.env.SHOWAI_DEV_DEBUG_PORT}`);
  const executable =
    mode === "desktop" ? (await import("electron")).default : process.execPath;
  const next = spawn(executable, args, {
    cwd: root,
    env: environment,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  child = next;
  const ready = new Promise((done, reject) => {
    const deadline = setTimeout(
      () =>
        reject(
          new Error("Development backend did not become ready in 30 seconds."),
        ),
      30000,
    );
    next.on("message", (message) => {
      if (message?.type === "ready") {
        clearTimeout(deadline);
        readyReceipt = message;
        done();
      }
    });
    next.once("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    next.once("exit", (code) => {
      clearTimeout(deadline);
      reject(new Error(`Development backend exited before ready (${code}).`));
    });
  });
  next.once("exit", (code) => {
    if (child === next) {
      child = undefined;
      if (!stopping && !rebuilding) {
        if (code === 0) void stop();
        else {
          console.error(`本地服务意外退出（${code}），修复源码后会重新启动。`);
          vite.ws.send("showai:status", {
            message: "本地服务已退出，等待修复",
          });
        }
      }
    }
  });
  await ready;
  launchedAt = new Date().toISOString();
  startedCommit = identity.commit;
  await writeSession();
}
async function stopChild() {
  const previous = child;
  if (!previous) return true;
  child = undefined;
  const exited = new Promise((done, reject) => {
    const blocked = (message) => {
      if (message?.type !== "quit-blocked") return;
      previous.off("exit", complete);
      previous.off("error", reject);
      previous.off("message", blocked);
      child = previous;
      done(false);
    };
    const complete = () => {
      previous.off("message", blocked);
      previous.off("error", reject);
      done(true);
    };
    previous.on("message", blocked);
    previous.once("exit", complete);
    previous.once("error", reject);
  });
  previous.send("showai:development-quit");
  // The desktop's normal close path waits for page saves. Never force-kill drafts.
  return await exited;
}
async function rebuild() {
  requested = true;
  if (rebuilding || stopping) return;
  rebuilding = true;
  try {
    while (requested && !stopping) {
      requested = false;
      vite.ws.send("showai:status", { message: "正在构建本地服务" });
      const outputs = await compile();
      if (stopping) break;
      if (!(await sessions.prepare())) {
        console.log(
          "更新已暂停：打开的页面未确认保存。处理保存问题后，点击开发标记重试。",
        );
        break;
      }
      if (!(await stopChild())) {
        vite.ws.send("showai:restart-cancelled", {});
        break;
      }
      if (stopping) break;
      await publish(outputs);
      await launch();
      vite.ws.send("showai:restart-complete", {});
      vite.ws.send("showai:status", { message: "已更新" });
    }
  } catch (error) {
    console.error("ShowAI 开发更新失败：", error);
    vite.ws.send("showai:restart-cancelled", {});
    vite.ws.send("showai:status", {
      message: "更新失败，请查看启动终端并修复后重试",
    });
  } finally {
    rebuilding = false;
  }
}
async function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  if (!(await stopChild())) {
    stopping = false;
    console.log(
      "页面尚未保存，开发服务继续运行。处理保存问题后再次按 Ctrl+C。",
    );
    vite.ws.send("showai:restart-cancelled", {});
    return;
  }
  vite.ws.send("showai:stopped", {});
  await watcher?.close();
  await identityWatcher?.close();
  await vite.close();
  if (frontendServer.listening) {
    await new Promise((done, reject) => {
      frontendServer.close((error) => (error ? reject(error) : done()));
      frontendServer.closeAllConnections();
    });
  }
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
vite.ws.on("showai:retry", () => void rebuild());
vite.ws.on("showai:identity-request", (_data, client) =>
  client.send("showai:identity", identity),
);
try {
  console.log(
    `ShowAI ${mode === "desktop" ? "桌面" : "浏览器"}开发版\n代码：${root}\n分支：${identity.branch}\n地址：${origin}\n首次启动正在准备本地运行环境，无需安装包。`,
  );
  frontendServer.listen(port, "127.0.0.1");
  await once(frontendServer, "listening");
  const cached = await cache.restore();
  if (cached) {
    dependencies = new Set(cached);
    console.log("源码与运行产物校验通过，复用本地构建缓存。");
  } else await publish(await compile());
  const preparedAt = performance.now();
  await launch();
  startup = {
    cacheHit: !!cached,
    preparationMs: Math.round(preparedAt - startupTime),
    backendMs: Math.round(performance.now() - preparedAt),
    totalMs: Math.round(performance.now() - startupTime),
  };
  await writeSession();
  console.log(
    `启动耗时：${startup.totalMs} ms（准备 ${startup.preparationMs} ms，本地服务与窗口 ${startup.backendMs} ms）。`,
  );
  if (mode === "browser" && !values["no-open"])
    child.send("showai:development-open");
  const gitPaths = ["HEAD", "refs/heads", "packed-refs"].map((path) =>
    resolve(root, git(["rev-parse", "--git-path", path])),
  );
  identityWatcher = watch(gitPaths, { ignoreInitial: true });
  identityWatcher.on("all", () => {
    identity = readIdentity();
    const module = vite.environments.client.moduleGraph.getModuleById(
      "\0virtual:showai-development-info",
    );
    if (module) vite.environments.client.moduleGraph.invalidateModule(module);
    vite.ws.send("showai:identity", identity);
    if (readyReceipt)
      void writeSession().catch((error) =>
        console.error("无法更新开发版本记录", error),
      );
  });
  identityWatcher.on("error", (error) => {
    console.error(error);
    void stop();
  });
  watcher = watch(
    [
      join(root, "src"),
      join(root, "resources"),
      join(root, "scripts"),
      join(root, "package.json"),
    ],
    {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 160, pollInterval: 40 },
      ignored: (path) => /(?:\.test\.ts|smoke\.mjs)$/.test(path),
    },
  );
  watcher.on("all", (_event, path) => {
    const local = relative(root, path).replaceAll("\\", "/");
    if (
      !dependencies.has(resolve(path)) &&
      !/^src\/(?:portable|core|agent|workbench|browser|desktop)\//.test(
        local,
      ) &&
      local !== "package.json"
    )
      return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 250);
  });
  watcher.on("error", (error) => {
    console.error(error);
    void stop();
  });
  console.log(
    `开发版已就绪。内容库：${readyReceipt.home}\n前端保存后自动更新；本地服务改动保存页面后自动重启。按 Ctrl+C 停止。`,
  );
} catch (error) {
  await stop();
  throw error;
}
