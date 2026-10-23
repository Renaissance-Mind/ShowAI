import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

export interface PreviewReference {
  home: string;
  projectId: string;
  pageId: string;
  theme: string;
}
interface Entry extends PreviewReference {
  key: string;
  imageKey: string;
  fingerprint: string;
  updatedAt: number;
}

/** A single fitted image serves small/medium/large cards, folder fans and prefetch. */
export const pagePreviewSize = { width: 640, height: 440, padding: 20 };
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const keyFor = (reference: PreviewReference) =>
  digest(
    JSON.stringify([
      reference.home,
      reference.projectId,
      reference.pageId,
      reference.theme,
    ]),
  );

/** Persistent latest-image pointers; invalidation retains the image for immediate display. */
export class PagePreviewCache {
  private entries = new Map<string, Entry>();
  private writes = new Map<string, Promise<unknown>>();
  private ready?: Promise<void>;
  private pruning?: Promise<void>;

  constructor(
    readonly directory: string,
    private readonly maxBytes = 192 * 1024 * 1024,
  ) {}

  private initialize() {
    return (this.ready ??= (async () => {
      await mkdir(this.directory, { recursive: true });
      for (const name of await readdir(this.directory)) {
        if (!/^latest-[a-f0-9]{64}\.json$/.test(name)) continue;
        let entry: Entry;
        try {
          entry = JSON.parse(
            await readFile(join(this.directory, name), "utf8"),
          );
        } catch (error) {
          if (
            !(error instanceof SyntaxError) &&
            (error as NodeJS.ErrnoException).code !== "ENOENT"
          )
            throw error;
          console.warn(
            "Discarding unreadable preview cache metadata",
            name,
            error,
          );
          continue;
        }
        if (
          !entry ||
          typeof entry !== "object" ||
          [entry.home, entry.projectId, entry.pageId, entry.theme].some(
            (value) => typeof value !== "string",
          ) ||
          !/^[a-f0-9]{64}$/.test(entry.imageKey) ||
          typeof entry.fingerprint !== "string" ||
          !Number.isFinite(entry.updatedAt) ||
          entry.key !== keyFor(entry) ||
          name !== `latest-${entry.key}.json`
        ) {
          console.warn("Discarding invalid preview cache metadata", name);
          continue;
        }
        this.entries.set(entry.key, entry);
      }
    })());
  }

  private serialized<T>(key: string, work: () => Promise<T>) {
    const task = (this.writes.get(key) ?? Promise.resolve()).then(work, work);
    this.writes.set(key, task);
    const cleanup = () => {
      if (this.writes.get(key) === task) this.writes.delete(key);
    };
    task.then(cleanup, cleanup);
    return task;
  }

  private async metadata(entry: Entry) {
    const target = join(this.directory, `latest-${entry.key}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(entry));
    await rename(temporary, target);
  }

  async latest(reference: PreviewReference) {
    await this.initialize();
    const entry = this.entries.get(keyFor(reference));
    if (!entry) return;
    let bytes: Buffer;
    try {
      bytes = await readFile(join(this.directory, `${entry.imageKey}.png`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return;
    }
    if (bytes.length < 24 || bytes.toString("hex", 0, 8) !== "89504e470d0a1a0a")
      return;
    return {
      image: `data:image/png;base64,${bytes.toString("base64")}`,
      fingerprint: entry.fingerprint,
    };
  }

  async publish(
    reference: PreviewReference,
    fingerprint: string,
    image: string,
    valid: () => boolean = () => true,
  ) {
    if (!image.startsWith("data:image/png;base64,"))
      throw new Error("Invalid preview image.");
    await this.initialize();
    const key = keyFor(reference);
    return this.serialized(key, async () => {
      if (!valid()) return false;
      const bytes = Buffer.from(
        image.slice("data:image/png;base64,".length),
        "base64",
      );
      const imageKey = digest(Buffer.concat([Buffer.from(fingerprint), bytes]));
      const path = join(this.directory, `${imageKey}.png`);
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, path);
      if (!valid()) return false;
      const entry = {
        ...reference,
        key,
        imageKey,
        fingerprint,
        updatedAt: Date.now(),
      };
      await this.metadata(entry);
      // A notification arriving during I/O must leave the entry stale, not bless an old capture.
      if (!valid()) {
        entry.fingerprint = "";
        await this.metadata(entry);
      }
      this.entries.set(key, entry);
      return entry.fingerprint !== "";
    });
  }

  async invalidate(matches: (reference: PreviewReference) => boolean) {
    await this.initialize();
    await Promise.all(
      [...this.entries.values()].filter(matches).map((entry) => {
        entry.fingerprint = "";
        return this.serialized(entry.key, async () => {
          const current = this.entries.get(entry.key)!;
          current.fingerprint = "";
          await this.metadata(current);
        });
      }),
    );
  }

  async prune() {
    if (this.pruning) return this.pruning;
    this.pruning = (async () => {
      await this.initialize();
      const files = await Promise.all(
        (await readdir(this.directory))
          .filter((name) => /^[a-f0-9]{64}\.png$/.test(name))
          .map(async (name) => {
            const info = await stat(join(this.directory, name));
            return { name, bytes: info.size, modified: info.mtimeMs };
          }),
      );
      let bytes = files.reduce((sum, file) => sum + file.bytes, 0);
      if (bytes <= this.maxBytes) return;
      const referenced = new Set(
        [...this.entries.values()].map((entry) => `${entry.imageKey}.png`),
      );
      files.sort(
        (a, b) =>
          Number(referenced.has(a.name)) - Number(referenced.has(b.name)) ||
          a.modified - b.modified,
      );
      for (const file of files) {
        if (bytes <= this.maxBytes) break;
        if (this.writes.size) break;
        await rm(join(this.directory, file.name), { force: true });
        bytes -= file.bytes;
        for (const [key, entry] of this.entries)
          if (`${entry.imageKey}.png` === file.name) {
            this.entries.delete(key);
            await rm(join(this.directory, `latest-${key}.json`), {
              force: true,
            });
          }
      }
    })();
    try {
      await this.pruning;
    } finally {
      this.pruning = undefined;
    }
  }
}
