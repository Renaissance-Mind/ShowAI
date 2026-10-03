import { rawSourcePlugin } from "./raw-source-plugin.mjs";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("dist-agent", { recursive: true });
await build({
  entryPoints: ["src/agent/cli.ts"],
  outfile: "dist-agent/cli.mjs",
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  external: ["esbuild"],
  plugins: [rawSourcePlugin],
  banner: {
    js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
  },
});
console.log("Built ShowAI CLI and optional stdio MCP entry.");
