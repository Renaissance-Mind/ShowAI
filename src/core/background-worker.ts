import { Worker } from "node:worker_threads";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CoreError } from "./model";

/** A separate execution queue per workload; idle workers do not keep a host alive. */
export class BackgroundWorker {
  constructor(private readonly idleMs = 15000) {}
  private worker?: Worker;
  private idle?: ReturnType<typeof setTimeout>;
  private pending = new Map<
    string,
    {
      resolve: (data: unknown) => void;
      reject: (error: unknown) => void;
    }
  >();
  private start() {
    if (this.worker) return this.worker;
    const path = [
      process.env.SHOWAI_INDEX_WORKER,
      fileURLToPath(new URL("./index-worker.mjs", import.meta.url)),
      fileURLToPath(
        new URL("../../dist-agent/index-worker.mjs", import.meta.url),
      ),
    ].find((path) => path && existsSync(path));
    if (!path)
      throw new Error(
        "The content worker is missing. Build the ShowAI runtime first.",
      );
    const worker = new Worker(path, { execArgv: [] });
    this.worker = worker;
    const failed = (error: unknown) => {
      if (this.worker !== worker) return;
      this.worker = undefined;
      clearTimeout(this.idle);
      for (const request of this.pending.values()) request.reject(error);
      this.pending.clear();
    };
    worker.on("error", failed);
    worker.on("exit", (code) =>
      failed(new Error(`Content worker exited (${code}).`)),
    );
    worker.on("message", (response) => {
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.ok) request.resolve(response.data);
      else
        request.reject(
          new CoreError(
            response.error.code,
            response.error.message,
            response.error,
          ),
        );
      if (!this.pending.size) {
        worker.unref();
        if (!this.idleMs) return;
        this.idle = setTimeout(() => {
          if (this.worker === worker && !this.pending.size) {
            this.worker = undefined;
            void worker.terminate();
          }
        }, this.idleMs);
        this.idle.unref();
      }
    });
    return worker;
  }
  invoke<T>(home: string, action: string, args: unknown): Promise<T> {
    clearTimeout(this.idle);
    const worker = this.start(),
      id = randomUUID();
    worker.ref();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (data) => resolve(data as T), reject });
      worker.postMessage({ id, home, action, args });
    });
  }
}
