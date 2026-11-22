import { writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cursorWorkbenchArchive } from "../src/plugin/cursor-workbench-package.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: { out: { type: "string" }, "runtime-config": { type: "string" }, host: { type: "string", default: "cursor" } },
});
const runtimeConfig = values["runtime-config"];
if (!values.out?.endsWith(".vsix") || (runtimeConfig && !isAbsolute(runtimeConfig)) || !["cursor", "trae"].includes(values.host))
  throw new Error("Use --out NEW_FILE.vsix [--host cursor|trae] [--runtime-config /absolute/agent-runtime.json].");
const path = resolve(values.out);
await writeFile(path, await cursorWorkbenchArchive(join(root, "plugins/showai"), { runtimeConfig, host: values.host }), { flag: "wx" });
console.log(`Prepared ShowAI Workbench at ${path}`);
