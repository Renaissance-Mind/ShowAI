import { build } from "esbuild";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
async function run(args) {
  const child = spawn(process.execPath, args, { stdio: "inherit" });
  const [code] = await once(child, "exit");
  if (code !== 0)
    throw new Error(`Actual cubic acceptance process failed (${code})`);
}
await run([
  "node_modules/vite/bin/vite.js",
  "build",
  "--config",
  "scripts/portable-cubic-ui-vite.config.mjs",
]);
await run([
  "node_modules/vite/bin/vite.js",
  "build",
  "--config",
  "vite.portable.config.ts",
]);
await run(["scripts/build-agent.mjs"]);
await run(["scripts/build-index-worker.mjs"]);
const { mkdir, copyFile } = await import("node:fs/promises");
await mkdir("dist-runtime/scripts", { recursive: true });
await copyFile("dist-agent/cli.mjs", "dist-runtime/scripts/cli.mjs");
await copyFile(
  "dist-agent/index-worker.mjs",
  "dist-runtime/scripts/index-worker.mjs",
);
await build({
  entryPoints: ["scripts/portable-cubic-ui-smoke.ts"],
  outfile: "output/playwright/cubic-ui.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["esbuild", "playwright-core", "vite"],
  plugins: [rawSourcePlugin],
  banner: {
    js: 'import {createRequire as __showaiCreateRequire} from "node:module";const require=__showaiCreateRequire(import.meta.url);',
  },
});
await run(["output/playwright/cubic-ui.mjs"]);
