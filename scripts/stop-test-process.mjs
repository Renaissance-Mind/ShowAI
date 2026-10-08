import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Terminate only a test-owned child, including its Electron subprocesses. */
export async function stopTestProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  let stopError;
  if (process.platform === "win32") {
    await promisify(execFile)("taskkill", [
      "/PID",
      String(child.pid),
      "/T",
      "/F",
    ]).catch((error) => {
      stopError = error;
    });
  } else child.kill("SIGKILL");
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener("exit", exited);
      reject(stopError ?? new Error(`Test process ${child.pid} did not exit.`));
    }, 5000);
    function exited() {
      clearTimeout(timer);
      resolve();
    }
    child.once("exit", exited);
  });
}
