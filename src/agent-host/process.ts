import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { translator } from "../i18n";
import agentHostMessages from "../i18n/messages/agentHost";
import { AgentFailure } from "./problems";

const t = translator(agentHostMessages);

let loginPath: string[] = [];
let loginPathResolved: Promise<string[]> | undefined;
const PATH_MARKER = "__SHOWAI_PATH__";

/**
 * A Finder-launched App inherits launchd's short PATH, without nvm, volta, asdf or
 * other shell setups. Ask the person's login shell once, so host CLIs installed
 * there are found too. A failing or slow shell leaves the fixed directories.
 */
export function resolveLoginShellPath(): Promise<string[]> {
  if (process.platform === "win32") return Promise.resolve([]);
  loginPathResolved ??= new Promise<string[]>((done) => {
    const shell = process.env.SHELL || "/bin/zsh";
    const child = spawn(
      shell,
      ["-ilc", `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`],
      {
        stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        windowsHide: true,
      },
    );
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (output += chunk));
    const finish = () => {
      clearTimeout(timer);
      const match = new RegExp(`${PATH_MARKER}(.*)${PATH_MARKER}`, "s").exec(
        output,
      );
      loginPath = match ? match[1].split(delimiter).filter(Boolean) : [];
      done(loginPath);
    };
    child.once("error", (error) => {
      console.error(`ShowAI could not read the login shell PATH: ${error.message}`);
      finish();
    });
    child.once("close", finish);
  });
  return loginPathResolved;
}

export function executablePaths() {
  return [
    ...new Set(
      [
        ...(process.env.PATH ?? "").split(delimiter),
        ...loginPath,
        join(homedir(), ".local/bin"),
        join(homedir(), ".npm-global/bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
      ].filter(Boolean),
    ),
  ];
}
export async function findExecutable(name: string): Promise<string | null> {
  await resolveLoginShellPath();
  for (const directory of executablePaths()) {
    for (const extension of process.platform === "win32"
      ? [".exe", ".cmd", ".bat", ""]
      : [""]) {
      const path = join(directory, name + extension);
      const found = await access(path, constants.X_OK).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT" || error.code === "EACCES") return false;
          throw error;
        },
      );
      if (found) return path;
    }
  }
  return null;
}
export interface ProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}
export function execute(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    signal?: AbortSignal;
    onLine?: (line: string) => void;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: "pipe",
      windowsHide: true,
    });
    let stdout = "",
      stderr = "",
      pending = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeout ?? 120000);
    child.stdin.end();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 16 * 1024 * 1024) {
        child.kill();
        reject(new Error("Agent output exceeded 16 MB."));
      }
      pending += chunk.toString();
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines) {
        try {
          options.onLine?.(line);
        } catch (error) {
          child.kill();
          reject(error);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-64000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (pending) {
        try {
          options.onLine?.(pending);
        } catch (error) {
          reject(error);
          return;
        }
      }
      if (timedOut)
        reject(
          new AgentFailure({
            code: "timeout",
            summary: t("task.timeout"),
            detail: stderr,
          }),
        );
      else if (signal && !options.signal?.aborted)
        reject(
          new AgentFailure({
            code: "process_exited",
            detail: `Agent exited with ${signal}.\n${stderr}`,
          }),
        );
      else if (signal) reject(new Error(`Agent exited with ${signal}.`));
      else resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
/** ACP is a persistent JSON-RPC process; no shell command interpolation. */
export class RpcProcess {
  child: ChildProcessWithoutNullStreams;
  private next = 0;
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >();
  private buffer = "";
  stderr = "";
  constructor(
    command: string,
    args: string[],
    cwd: string,
    onNotification: (method: string, params: any) => void,
    signal: AbortSignal,
    options: {
      env?: NodeJS.ProcessEnv;
      onRequest?: (method: string, params: any) => Promise<unknown>;
    } = {},
  ) {
    this.child = spawn(command, args, {
      cwd,
      env: options.env,
      stdio: "pipe",
      signal,
      windowsHide: true,
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: Buffer) => {
      try {
        this.buffer += chunk.toString();
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop()!;
        for (const line of lines.filter((line) => line.trim())) {
          const item = JSON.parse(line);
          if (item.method && item.id !== undefined) {
            if (options.onRequest) {
              void options
                .onRequest(item.method, item.params)
                .then((result) =>
                  this.send({ jsonrpc: "2.0", id: item.id, result }),
                )
                .catch((error: Error) =>
                  this.send({
                    jsonrpc: "2.0",
                    id: item.id,
                    error: { code: -32603, message: error.message },
                  }),
                );
            } else
              this.send({
                jsonrpc: "2.0",
                id: item.id,
                error: { code: -32601, message: "Unsupported client method" },
              });
          } else if (item.method) onNotification(item.method, item.params);
          else {
            const wait = this.pending.get(item.id);
            this.pending.delete(item.id);
            if (item.error) wait?.reject(new Error(item.error.message));
            else wait?.resolve(item.result);
          }
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
        this.child.kill();
      }
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-64000);
    });
    const fail = (error: Error) => {
      for (const item of this.pending.values()) item.reject(error);
      this.pending.clear();
    };
    this.child.once("error", fail);
    this.child.once("close", (code) =>
      fail(
        new AgentFailure({
          code: "process_exited",
          ...(code !== null ? { exitCode: code } : {}),
          detail: `Agent connection closed (${code}).\n${this.stderr}`,
        }),
      ),
    );
  }
  send(value: unknown) {
    if (this.child.killed || this.child.stdin.destroyed) return;
    this.child.stdin.write(JSON.stringify(value) + "\n");
  }
  request(method: string, params: unknown): Promise<any> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  close() {
    this.child.kill();
  }
}
