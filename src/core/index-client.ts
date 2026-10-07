import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CoreError } from "./model";
import type { LibraryIndex, SearchOptions } from "./library-index";
let worker: Worker | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<
  string,
  { resolve: (data: unknown) => void; reject: (error: unknown) => void }
>();
function start() {
  if (worker) return worker;
  const candidates = [
    process.env.SHOWAI_INDEX_WORKER,
    fileURLToPath(new URL("./index-worker.mjs", import.meta.url)),
    fileURLToPath(
      new URL("../../dist-agent/index-worker.mjs", import.meta.url),
    ),
  ].filter((path): path is string => !!path);
  const path = candidates.find(existsSync);
  if (!path)
    throw new Error(
      "The content index worker is missing. Build the ShowAI runtime first.",
    );
  const next = new Worker(path, { execArgv: [] });
  worker = next;
  const failed = (error: unknown) => {
    if (worker !== next) return;
    worker = undefined;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  next.on("error", failed);
  next.on("exit", (code) => {
    if (worker === next)
      failed(new Error(`Content index worker exited (${code}).`));
  });
  next.on("message", (response) => {
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.data);
    else
      request.reject(
        new CoreError(
          response.error.code,
          response.error.message,
          response.error,
        ),
      );
    if (!pending.size) {
      next.unref();
      idle = setTimeout(() => {
        if (worker === next && !pending.size) {
          worker = undefined;
          void next.terminate();
        }
      }, 15000);
      idle.unref();
    }
  });
  return next;
}
function invoke<T>(home: string, action: string, args: unknown): Promise<T> {
  clearTimeout(idle);
  const next = start(),
    id = randomUUID();
  next.ref();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve: (data) => resolve(data as T), reject });
    next.postMessage({ id, home, action, args });
  });
}
/** CPU-heavy parsing, tokenisation and SQLite work stays outside the app's main thread. */
export class IndexClient {
  constructor(readonly home: string) {}
  search(input: SearchOptions): ReturnType<LibraryIndex["search"]> {
    return invoke(this.home, "search", input);
  }
  history(
    input: Parameters<LibraryIndex["history"]>[0],
  ): ReturnType<LibraryIndex["history"]> {
    return invoke(this.home, "history", input);
  }
  references(
    kind: string,
    id: string,
    options: Parameters<LibraryIndex["references"]>[2],
  ): ReturnType<LibraryIndex["references"]> {
    return invoke(this.home, "references", { kind, id, options });
  }
  synchronize(force = false): ReturnType<LibraryIndex["synchronize"]> {
    return invoke(this.home, "synchronize", { force });
  }
}
