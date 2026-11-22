import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { RuntimeLaunch } from "../agent/runtime";
import { execute, findExecutable } from "../agent-host/process";

async function isFile(path: string) {
  return stat(path).then(value => value.isFile(), (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  });
}

/** Use Desktop's pnpm even when the user has not installed dsh on PATH. */
export async function dshPackageLauncher(host: string): Promise<RuntimeLaunch | undefined> {
  let command = host;
  if (process.platform === "darwin" && host.endsWith(".app")) {
    command = join(host, "Contents/Resources/runtime/cli/bin/dsh");
    if (!(await isFile(command))) {
      const cli = await findExecutable("dsh");
      if (!cli) return;
      command = cli;
    }
  }
  if (process.platform === "win32") {
    if (/[/\\]resources[/\\]runtime[/\\]cli[/\\]bin[/\\]dsh\.cmd$/i.test(host))
      command = resolve(dirname(host), "../../../..", "DeepSeek Harness.exe");
    if (basename(command).toLowerCase() === "deepseek harness.exe") {
      const archive = join(dirname(command), "resources/app.asar");
      if (!(await isFile(command)) || !(await isFile(archive))) return;
      // The packaged dsh.cmd runs these exact arguments in Electron Node mode.
      // Pass them directly so package paths are never interpreted by cmd.exe.
      return {
        command,
        args: ["--expose-internals", join(archive, "dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js")],
        env: { ELECTRON_RUN_AS_NODE: "1" },
      };
    }
  }
  if (!(await isFile(command))) return;
  await access(command, constants.X_OK);
  return { command, args: [], env: {} };
}

/** The external package command manages a closed Desktop profile. */
export async function dshDesktopRunning(profile: string): Promise<boolean | undefined> {
  const paths = new Set([resolve(profile), await realpath(profile)]);
  if (process.platform === "win32") {
    const powershell = await findExecutable("powershell");
    if (!powershell) return;
    const query = "$ErrorActionPreference='Stop'; (Get-CimInstance Win32_Process -Filter \"Name='DeepSeek Harness.exe'\").CommandLine";
    const result = await execute(powershell, ["-NoProfile", "-NonInteractive", "-Command", query], { timeout: 10000 });
    if (result.code !== 0) return;
    return result.stdout.split(/\r?\n/).some(line => {
      const command = line.replaceAll("\\", "/").toLowerCase();
      return command.includes("/dsh-desktop-host/lib/index.js") &&
        [...paths].some(path => command.includes(path.replaceAll("\\", "/").toLowerCase()));
    });
  }
  const escaped = [...paths].map(path => path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pgrep = await findExecutable("pgrep");
  if (!pgrep) return;
  const pattern = `/dsh-desktop-host/lib/index[.]js[[:space:]"].*[[:space:]"](${escaped.join("|")})([[:space:]"]|$)`;
  const result = await execute(pgrep, ["-f", pattern], { timeout: 5000 });
  if (result.code === 0 || result.code === 1) return result.code === 0;
}
