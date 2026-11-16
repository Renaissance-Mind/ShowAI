import { build } from "esbuild";
import { mkdir, mkdtemp, rm, readFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: "string" },
    state: { type: "string" },
    out: { type: "string" },
    url: { type: "string" },
    feature: { type: "string" },
    scene: { type: "string", multiple: true },
    theme: { type: "string" },
    locale: { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
    scale: { type: "string" },
    renderer: { type: "string" },
    baseline: { type: "string" },
    "update-baseline": { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  console.log(
    "npm run ui:lab -- [--port PORT] [--state DIRECTORY] [--out DIRECTORY]\nnpm run test:ui -- [--url ORIGIN] [--feature FEATURE] [--scene SCENE] [--renderer chromium|electron] [--theme light|dark] [--width 1440] [--height 1000] [--scale 2] [--baseline DIRECTORY] [--update-baseline]\nThe Demo starts in the background without opening a browser. Tests never display native windows.",
  );
  process.exit(0);
}
const command = positionals[0] ?? "serve",
  test = command === "test";
if (
  !["serve", "test", "status", "stop"].includes(command) ||
  positionals.length > 1
)
  throw new Error("Unknown UI Lab command.");
if (command === "status" || command === "stop") {
  if (!values.state) throw new Error("Specify the UI Lab --state directory.");
  const saved = JSON.parse(
    await readFile(join(resolve(values.state), "server.json"), "utf8"),
  );
  const status = await fetch(saved.origin + "/__ui-lab/api/status", {
    signal: AbortSignal.timeout(3000),
  }).then((response) => response.json());
  if (
    status.pid !== saved.pid ||
    status.state !== resolve(values.state) ||
    status.root !== repository
  )
    throw new Error("The server identity does not match this UI Lab.");
  if (command === "stop") {
    const response = await fetch(saved.origin + "/__ui-lab/api/shutdown", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid: saved.pid }),
    });
    if (!response.ok) throw new Error("UI Lab rejected the shutdown request.");
    let exited = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        process.kill(saved.pid, 0);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
        exited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const closed = JSON.parse(
      await readFile(join(resolve(values.state), "closed.json"), "utf8"),
    );
    if (!exited || closed.pid !== saved.pid)
      throw new Error("UI Lab shutdown has not completed.");
  }
  console.log(
    JSON.stringify(
      command === "stop" ? { stopped: true, pid: saved.pid } : status,
    ),
  );
  process.exit(0);
}
if (values.url && !test)
  throw new Error("--url attaches a test to an existing UI Lab.");
if (values["update-baseline"] && !values.baseline)
  throw new Error("--update-baseline requires --baseline DIRECTORY.");
const parent = join(homedir(), "ShowAI-Development/development/ui-lab");
await mkdir(parent, { recursive: true });
const state = values.state
    ? resolve(values.state)
    : await mkdtemp(join(parent, "run-")),
  output = values.out ? resolve(values.out) : join(state, "results");
await mkdir(state, { recursive: true });
const buildDirectory = join(repository, ".showai-dev", `ui-lab-${process.pid}`);
await mkdir(buildDirectory, { recursive: true });
let server,
  closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server?.close();
  await rm(buildDirectory, { recursive: true, force: true });
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(
    signal,
    () =>
      void close().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      }),
  );
try {
  await build({
    entryPoints: [
      ...(!values.url ? [join(repository, "src/ui-lab/server.ts")] : []),
      join(repository, "src/ui-lab/runner.ts"),
    ],
    outdir: buildDirectory,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node24",
    packages: "external",
    plugins: [rawSourcePlugin],
    banner: {
      js: "import { createRequire as __uiLabRequire } from 'node:module'; const require = __uiLabRequire(import.meta.url);",
    },
  });
  if (!values.url) {
    const { startUiLab } = await import(
      pathToFileURL(join(buildDirectory, "server.js"))
    );
    server = await startUiLab({
      repository,
      state,
      output,
      port: values.port ? Number(values.port) : 0,
      baseline: values.baseline ? resolve(values.baseline) : undefined,
      onShutdown: close,
    });
  }
  const origin = values.url ? new URL(values.url).origin : server.origin;
  if (!test)
    console.log(
      JSON.stringify({
        ready: true,
        url: server.url,
        state,
        output,
        pid: process.pid,
        background: true,
      }),
    );
  else {
    const { runUiScenes } = await import(
      pathToFileURL(join(buildDirectory, "runner.js"))
    );
    const result = await runUiScenes({
      origin,
      output,
      repository,
      feature: values.feature,
      scenes: values.scene,
      theme: values.theme,
      locale: values.locale,
      width: values.width ? Number(values.width) : undefined,
      height: values.height ? Number(values.height) : undefined,
      scale: values.scale ? Number(values.scale) : undefined,
      renderer: values.renderer,
      baseline: values.baseline ? resolve(values.baseline) : undefined,
      updateBaseline: values["update-baseline"],
    });
    console.log(
      JSON.stringify({
        passed: result.passed,
        directory: result.directory,
        results: result.results.map((result) => ({
          feature: result.feature,
          scene: result.scene,
          passed: result.passed,
          error: result.error,
          checkpoints: result.checkpoints.length,
        })),
        focus: result.focus,
        errors: result.errors,
      }),
    );
    if (!result.passed) process.exitCode = 1;
    await close();
  }
} catch (error) {
  await close();
  throw error;
}
