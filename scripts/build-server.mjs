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
const { schema, migrations } = await import(
  pathToFileURL(resolve("dist-server/server.mjs")).href
);
await writeFile("dist-server/schema.sql", schema.join(";\n") + ";\n");
await mkdir("dist-server/migrations", { recursive: true });
for (const migration of migrations)
  await writeFile(
    `dist-server/migrations/${String(migration.version).padStart(4, "0")}_${migration.name}.sql`,
    migration.statements.join(";\n") + ";\n",
  );
console.log("Built Linux and Cloudflare ShowAI Server from the shared core.");
