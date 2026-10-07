import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir("dist-server", { recursive: true });
await build({
  entryPoints: ["src/server/node.ts"],
  outfile: "dist-server/server.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
});
await build({
  entryPoints: ["src/server/worker.ts"],
  outfile: "dist-server/worker.mjs",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "esm",
});
const { schema } = await import(
  pathToFileURL(resolve("dist-server/server.mjs")).href
);
await writeFile("dist-server/schema.sql", schema.join(";\n") + ";\n");
console.log("Built Linux and Cloudflare ShowAI Server from the shared core.");
