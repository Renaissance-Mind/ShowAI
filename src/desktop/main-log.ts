import {
  appendFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { formatWithOptions } from "node:util";
import { redact } from "../core/redact";

/** The main-process log users can attach to a problem report. */
export const MAIN_LOG_NAME = "showai-main.log";
const MAX_BYTES = 1024 * 1024;
const FILES = 3;
const LINE_LIMIT = 16 * 1024;

export type LogLevel = "error" | "warn" | "info";

/**
 * Log lines use the shared redaction of problem reports: the home directory
 * becomes `~` and credentials are masked.
 */
export function redactLogText(text: string, home = homedir()): string {
  return redact(text, { home });
}

export interface MainLog {
  readonly directory: string;
  readonly path: string;
  write(level: LogLevel, source: string, ...values: unknown[]): void;
}

export function createMainLog(options: {
  directory: string;
  home?: string;
  maxBytes?: number;
  files?: number;
  /** Where to say once that the log itself could not be written. */
  fallback?: (message: string) => void;
}): MainLog {
  const directory = options.directory;
  const path = join(directory, MAIN_LOG_NAME);
  const maxBytes = options.maxBytes ?? MAX_BYTES;
  const files = options.files ?? FILES;
  const rotated = (index: number) =>
    index === 0 ? path : join(directory, `showai-main.${index}.log`);
  let failed = false;
  const rotate = (incoming: number) => {
    let size = 0;
    try {
      size = statSync(path).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (size + incoming <= maxBytes) return;
    rmSync(rotated(files - 1), { force: true });
    for (let index = files - 2; index >= 0; index--) {
      try {
        renameSync(rotated(index), rotated(index + 1));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  };
  return {
    directory,
    path,
    write(level, source, ...values) {
      if (failed) return;
      let message = formatWithOptions({ colors: false, depth: 4 }, ...values);
      if (message.length > LINE_LIMIT)
        message = `${message.slice(0, LINE_LIMIT)}… [truncated]`;
      const line = `${new Date().toISOString()} [${level}] [${source}] ${redactLogText(message, options.home)}\n`;
      // The log is a reporting boundary: a full disk must not break the App.
      try {
        mkdirSync(directory, { recursive: true });
        rotate(Buffer.byteLength(line));
        appendFileSync(path, line, { mode: 0o600 });
      } catch (error) {
        failed = true;
        options.fallback?.(
          `ShowAI could not write ${path}: ${(error as Error).message}`,
        );
      }
    },
  };
}

/** Mirrors console warnings and errors of this process into the log file. */
export function captureConsole(log: MainLog, source = "main"): () => void {
  const original = { error: console.error, warn: console.warn };
  console.error = (...values: unknown[]) => {
    original.error(...values);
    log.write("error", source, ...values);
  };
  console.warn = (...values: unknown[]) => {
    original.warn(...values);
    log.write("warn", source, ...values);
  };
  return () => {
    console.error = original.error;
    console.warn = original.warn;
  };
}

async function readOptional(path: string) {
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
}

/**
 * The last `count` lines of the log, continuing into the previous rotated
 * file when the current one is short. Lines were redacted when written and
 * are redacted again for the report.
 */
export async function readLogTail(
  directory: string,
  count = 200,
  home = homedir(),
): Promise<string> {
  const lines = (text: string) => text.split("\n").filter(Boolean);
  let tail = lines(await readOptional(join(directory, MAIN_LOG_NAME)));
  if (tail.length < count)
    tail = [
      ...lines(await readOptional(join(directory, "showai-main.1.log"))),
      ...tail,
    ];
  return redactLogText(tail.slice(-count).join("\n"), home);
}
