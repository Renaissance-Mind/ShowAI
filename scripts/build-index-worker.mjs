import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
await mkdir("dist-agent", { recursive: true });
await build({
  entryPoints: ["src/core/index-worker.ts"],
  outfile: "dist-agent/index-worker.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["esbuild"],
  plugins: [rawSourcePlugin],
  banner: {
    js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
  },
});
