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

export const MAIN_LOG_NAME = "showai-main.log";
const MAX_BYTES = 1024 * 1024;
const FILES = 3;
const LINE_LIMIT = 16 * 1024;

export type LogLevel = "error" | "warn" | "info";

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
