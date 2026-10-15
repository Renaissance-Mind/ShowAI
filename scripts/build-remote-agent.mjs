import { build } from "esbuild";
import { mkdir, cp, copyFile } from "node:fs/promises";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
await mkdir("dist-remote-agent/scripts", { recursive: true });
await mkdir("dist-remote-agent/assets", { recursive: true });
await build({
  entryPoints: {
    container: "src/agent-host/remote-container.ts",
    cli: "src/agent/cli.ts",
    "index-worker": "src/core/index-worker.ts",
  },
  outdir: "dist-remote-agent/scripts",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["esbuild"],
  plugins: [rawSourcePlugin],
  banner: {
    js: 'import {createRequire as __createRequire} from "node:module"; const require=__createRequire(import.meta.url);',
  },
});
await cp("plugins/showai", "dist-remote-agent/assets/agent-plugin", {
  recursive: true,
});
await copyFile(
  "dist-portable/portable.html",
  "dist-remote-agent/assets/viewer.html",
);
await copyFile(
  "dist-portable/reader-source.json",
  "dist-remote-agent/assets/reader-source.json",
);
await build({
  entryPoints: ["deployments/cloudflare/agent-worker.mjs"],
  outfile: "dist-remote-agent/worker.mjs",
  bundle: true,
  platform: "browser",
  format: "esm",
  external: ["cloudflare:workers"],
});
console.log("Built Cloudflare Agent runtime and gateway.");
