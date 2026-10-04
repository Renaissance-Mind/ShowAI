import { execFile } from "node:child_process";
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
