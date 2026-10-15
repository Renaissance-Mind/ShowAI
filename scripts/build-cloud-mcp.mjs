import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
await mkdir("dist-cloud-mcp/scripts", { recursive: true });
await mkdir("dist-cloud-mcp/assets", { recursive: true });
await build({
  entryPoints: {
    gateway: "src/agent/cloud-entry.ts",
    "browser-check": "src/agent/cloud-browser-check-entry.ts",
    // Project reads and indexing run in this worker beside the gateway.
    "index-worker": "src/core/index-worker.ts",
    "content-check": "src/agent/cloud-content-check-entry.ts",
  },
  outdir: "dist-cloud-mcp/scripts",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // Keep SDK/Zod package initialization intact; node_modules ships in the image.
  external: ["esbuild", "zod", "@modelcontextprotocol/sdk"],
  plugins: [rawSourcePlugin],
  banner: {
    js: 'import {createRequire as __showaiCreateRequire} from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
  },
});
await build({
  entryPoints: ["deployments/cloudflare/mcp-worker.mjs"],
  outfile: "dist-cloud-mcp/worker.mjs",
  bundle: true,
  platform: "browser",
  format: "esm",
  external: ["cloudflare:workers"],
});
await copyFile(
  "dist-portable/portable.html",
  "dist-cloud-mcp/assets/viewer.html",
);
await copyFile(
  "dist-portable/reader-source.json",
  "dist-cloud-mcp/assets/reader-source.json",
);
// Next to the viewer, the runtime finds the published reader version for
// online fallbacks (reader.showai.renaissancemind.ai, jsDelivr, unpkg).
await copyFile(
  "dist-cdn/manifest.json",
  "dist-cloud-mcp/assets/cdn-manifest.json",
);
console.log("Built ShowAI Cloud MCP gateway and Worker.");
