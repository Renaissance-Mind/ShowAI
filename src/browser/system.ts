import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { release } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";
const run = promisify(execFile);

export async function openLocalPath(
  path: string,
  reveal = false,
): Promise<void> {
  if (process.platform === "darwin")
    await run("open", reveal ? ["-R", path] : [path]);
  else if (process.platform === "win32") {
    // Explorer can return 1 after successfully handing off to an existing window.
    await run("explorer.exe", [reveal ? `/select,${path}` : path]).catch(
      (error) => {
        if (error.code !== 1) throw error;
      },
    );
  } else await run("xdg-open", [reveal ? dirname(path) : path]);
}

export async function openBrowser(url: string): Promise<void> {
  if (process.platform === "win32")
    await run("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
  else await openLocalPath(url);
}

let operatingSystem: Promise<string> | undefined;

/**
 * The operating system version a person would recognise, matching what the
 * desktop app reports: the macOS product version (not the Darwin kernel), the
 * Windows build, or the Linux distribution name. Read once per process.
 */
export function systemVersion(): Promise<string> {
  operatingSystem ??= (async () => {
    if (process.platform === "darwin")
      return (await run("sw_vers", ["-productVersion"])).stdout.trim();
    if (process.platform === "linux") {
      const source = await readFile("/etc/os-release", "utf8").catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return "";
          throw error;
        },
      );
      const name = /^PRETTY_NAME="?([^"\n]*)"?$/m.exec(source)?.[1];
      return name ? `${name} (${release()})` : release();
    }
    return release();
  })();
  return operatingSystem;
}
