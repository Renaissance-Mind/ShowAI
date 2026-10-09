import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, open, stat, rm, readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { atomicRename } from "../core/atomic-rename";
import { dirname, join } from "node:path";
import { SyncError } from "../sync/protocol";
import { operationObjectKey } from "./maintenance";
import type {
  MetadataStore,
  ObjectStore,
  SqlStatement,
  SqlValue,
} from "./storage";
export class SQLiteMetadata implements MetadataStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;",
    );
  }
  async all<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...values) as T[];
  }
  async run(sql: string, values: SqlValue[] = []) {
    const result = this.db.prepare(sql).run(...values);
    return { changes: Number(result.changes) };
  }
  async batch(statements: SqlStatement[]) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => ({
        changes: Number(
          this.db.prepare(statement.sql).run(...(statement.values ?? []))
            .changes,
        ),
      }));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
export class DiskObjects implements ObjectStore {
  constructor(readonly root: string) {}
  private path(key: string) {
    if (!operationObjectKey(key))
      throw new Error("Invalid object storage key.");
    return join(this.root, key);
  }
  async list(cursor = "", maximum = 100) {
    const root = this.root;
    async function* walk(
      prefix: string,
    ): AsyncGenerator<{ key: string; bytes: number; uploadedAt: string }> {
      const entries = await readdir(join(root, prefix), {
        withFileTypes: true,
      }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" && !prefix) return [];
        throw error;
      });
      for (const entry of entries.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      )) {
        const key = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink())
          throw new Error("Object inventory contains a symbolic link.");
        if (entry.isDirectory()) yield* walk(key);
        else if (entry.isFile() && key > cursor && operationObjectKey(key)) {
          const info = await stat(join(root, key));
          yield { key, bytes: info.size, uploadedAt: info.mtime.toISOString() };
        }
      }
    }
    const objects = [];
    for await (const object of walk("")) {
      if (objects.length === maximum)
        return { objects, next: objects[objects.length - 1].key };
      objects.push(object);
    }
    return { objects };
  }
  async get(key: string, maximum = 16 * 1024 * 1024) {
    const info = await this.open(key);
    if (!info) return null;
    if (info.bytes > maximum) {
      await info.body.cancel();
      throw new SyncError(413, "TOO_LARGE", "Metadata object exceeds 16 MiB.");
    }
    await info.body.cancel();
    return readFile(this.path(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  }
  digest() {
    const hash = createHash("sha256");
    return {
      async update(bytes: Uint8Array) {
        hash.update(bytes);
      },
      async finish() {
        return hash.digest("hex");
      },
    };
  }
  async remove(key: string) {
    await rm(this.path(key), { force: true });
  }
  async open(key: string) {
    const path = this.path(key);
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return null;
    return {
      bytes: info.size,
      body: Readable.toWeb(
        createReadStream(path, { highWaterMark: 64 * 1024 }),
      ) as ReadableStream<Uint8Array>,
    };
  }
  async putVerified(
    key: string,
    body: ReadableStream<Uint8Array>,
    expected: string,
    maximum: number,
  ) {
    const path = this.path(key),
      folder = dirname(path),
      temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await mkdir(folder, { recursive: true });
    const file = await open(temporary, "wx", 0o600),
      hash = createHash("sha256");
    const reader = body.getReader();
    let length = 0,
      verified = false;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maximum) {
          await reader.cancel();
          throw new SyncError(413, "TOO_LARGE", "Object exceeds 64 MiB.");
        }
        hash.update(value);
        await file.writeFile(value);
      }
      if (hash.digest("hex") !== expected)
        throw new SyncError(
          400,
          "DIGEST_MISMATCH",
          "Content does not match its digest.",
        );
      await file.sync();
      verified = true;
    } finally {
      reader.releaseLock();
      await file.close();
      if (!verified) await rm(temporary, { force: true });
    }
    await atomicRename(temporary, path);
    if (process.platform !== "win32") {
      const directory = await open(folder, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return length;
  }
  async put(key: string, bytes: Uint8Array) {
    const path = this.path(key),
      folder = dirname(path);
    await mkdir(folder, { recursive: true });
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await atomicRename(temporary, path);
    // Windows cannot fsync a directory handle; the object itself is flushed above.
    if (process.platform !== "win32") {
      const directory = await open(folder, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
}
