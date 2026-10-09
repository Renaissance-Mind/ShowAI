#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

// Resolve only the host-selected library. Never scan other libraries or fall back after a failure.
const home = resolve(process.env.SHOWAI_HOME || join(homedir(), ".showai"));
const configPath =
  process.env.SHOWAI_RUNTIME_CONFIG || join(home, "agent-runtime.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (
  config.format !== "showai-agent-runtime" ||
  config.protocol !== 1 ||
  resolve(config.home) !== home ||
  !isAbsolute(config.launch?.command) ||
  !Array.isArray(config.launch?.args) ||
  !config.launch.args.every((x) => typeof x === "string")
)
  throw new Error(
    "Invalid ShowAI runtime configuration or library mismatch. Repair this connection in ShowAI; no other library was selected.",
  );
const env = { ...process.env, ...config.launch.env, SHOWAI_HOME: home };
const probe = await promisify(execFile)(
  config.launch.command,
  [...config.launch.args, "runtime", "info", "--json"],
  { env, timeout: 30000, maxBuffer: 1024 * 1024 },
);
const info = JSON.parse(probe.stdout);
if (
  !info.ok ||
  resolve(info.data?.home || "") !== home ||
  info.data?.capabilities?.agentOperations?.protocol !== "showai-mcp-v1"
)
  throw new Error(
    "This ShowAI runtime does not support the unified MCP entry. Update/register the intended ShowAI runtime, then reconnect. Skills alone cannot upgrade it.",
  );
const args = [...config.launch.args, "mcp"];
if (process.env.SHOWAI_PROJECT_ID)
  args.push("--project", process.env.SHOWAI_PROJECT_ID);
if (process.env.SHOWAI_PRESENTATION_DIR) {
  if (!isAbsolute(process.env.SHOWAI_PRESENTATION_DIR))
    throw new Error(
      "SHOWAI_PRESENTATION_DIR must be an absolute host-owned output directory.",
    );
  args.push("--presentation-directory", process.env.SHOWAI_PRESENTATION_DIR);
}
const child = spawn(config.launch.command, args, { env, stdio: "inherit" });
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => child.kill(signal));
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
