import { EventEmitter } from "node:events";
import { watch as nativeWatch, type FSWatcher } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { watch } from "chokidar";

/** FSEvents watches the tree without one kqueue file descriptor per content file. */
class RecursiveLibraryWatcher extends EventEmitter {
  private native: FSWatcher;
  private pending = new Map<
    string,
    { timer?: ReturnType<typeof setTimeout>; stamp?: string; since: number }
  >();
  private closed = false;

  constructor(root: string, ignored: (path: string) => boolean) {
    super();
    this.native = nativeWatch(root, { recursive: true }, (_event, name) => {
      const path = name ? join(root, String(name)) : root;
      if (ignored(path) || this.closed || this.pending.has(path)) return;
      const entry = { since: Date.now() };
      this.pending.set(path, entry);
      void this.settle(path, entry);
    });
    this.native.on("error", (error) => this.emit("error", error));
    queueMicrotask(() => {
      if (!this.closed) this.emit("ready");
    });
  }

  private async settle(
    path: string,
    entry: {
      timer?: ReturnType<typeof setTimeout>;
      stamp?: string;
      since: number;
    },
  ) {
    try {
      const info = await stat(path).catch((error) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR")
          return undefined;
        throw error;
      });
      if (this.closed) return;
      const stamp = info
        ? `${info.size}:${info.mtimeMs}:${info.ctimeMs}`
        : "missing";
      if (entry.stamp !== stamp) {
        entry.stamp = stamp;
        entry.since = Date.now();
      }
      if (Date.now() - entry.since < 120) {
        entry.timer = setTimeout(() => void this.settle(path, entry), 40);
        return;
      }
      this.pending.delete(path);
      this.emit("all", "change", path);
    } catch (error) {
      this.pending.delete(path);
      if (!this.closed) this.emit("error", error);
    }
  }

  async close() {
    this.closed = true;
    this.native.close();
    for (const entry of this.pending.values()) clearTimeout(entry.timer);
    this.pending.clear();
  }
}

export function watchLibrary(root: string, ignored: (path: string) => boolean) {
  return process.platform === "darwin"
    ? new RecursiveLibraryWatcher(root, ignored)
    : watch(root, {
        ignoreInitial: true,
        depth: 9,
        awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
        ignored,
      });
}
export type LibraryWatcher = ReturnType<typeof watchLibrary>;
