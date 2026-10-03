import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await access(join(root, "dist-desktop/main.mjs"));
await access(join(root, "dist/index.html"));
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [root, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: environment,
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
