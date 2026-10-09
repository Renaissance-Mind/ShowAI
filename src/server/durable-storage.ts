import type {
  MetadataStore,
  ObjectStore,
  SqlStatement,
  SqlValue,
} from "./storage";
import { hash, SyncError } from "../sync/protocol";
import { operationObjectKey } from "./maintenance";

export interface DurableSql {
  exec<T = Record<string, SqlValue>>(
    sql: string,
    ...values: (SqlValue | ArrayBuffer)[]
  ): {
    toArray(): T[];
    one(): T;
  };
}
export interface DurableStorage {
  sql: DurableSql;
  transactionSync<T>(run: () => T): T;
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm(time: number): Promise<void>;
}
export class DurableMetadata implements MetadataStore {
  constructor(readonly storage: DurableStorage) {}
  async all<T>(sql: string, values: SqlValue[] = []): Promise<T[]> {
    return this.storage.sql.exec<T>(sql, ...values).toArray();
  }
  private execute(sql: string, values: SqlValue[] = []) {
    this.storage.sql.exec(sql, ...values).toArray();
    return this.storage.sql
      .exec<{ changes: number }>("SELECT changes() AS changes")
      .one();
  }
  async run(sql: string, values: SqlValue[] = []) {
    return this.execute(sql, values);
  }
  async batch(statements: SqlStatement[]) {
    return this.storage.transactionSync(() =>
      statements.map((item) => this.execute(item.sql, item.values)),
    );
  }
}
interface HotObject {
  key: string;
  bytes: number;
  uploaded_at: string;
  content: ArrayBuffer;
  used_at: number;
}
const hotLimit = 256 * 1024;
const hotBudget = 128 * 1024 * 1024;

/** Small immutable edit objects are durable before acknowledgement. R2 remains
 * the large-object and archival tier. Inventory/export sees one logical union. */
export class DurableObjects implements ObjectStore {
  constructor(
    readonly storage: DurableStorage,
    readonly cold: ObjectStore,
  ) {
    storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS _showai_hot_objects(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,uploaded_at TEXT NOT NULL,content BLOB NOT NULL,used_at INTEGER NOT NULL)",
    );
    storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS _showai_hot_lru ON _showai_hot_objects(used_at)",
    );
  }
  private hot(key: string) {
    if (!operationObjectKey(key))
      throw new Error("Invalid object storage key.");
    return this.storage.sql
      .exec<HotObject>("SELECT * FROM _showai_hot_objects WHERE key=?", key)
      .toArray()[0];
  }
  private writable() {
    return (
      this.storage.sql
        .exec<{ state: string }>(
          "SELECT state FROM server_operations WHERE id=1",
        )
        .toArray()[0]?.state === "running"
    );
  }
  private async remember(
    key: string,
    bytes: Uint8Array,
    at = new Date().toISOString(),
  ) {
    if (bytes.length > hotLimit) return;
    this.storage.sql.exec(
      "INSERT OR REPLACE INTO _showai_hot_objects VALUES(?,?,?,?,?)",
      key,
      bytes.length,
      at,
      bytes.slice().buffer,
      Date.now(),
    );
    const total = this.storage.sql
      .exec<{ bytes: number }>(
        "SELECT COALESCE(SUM(bytes),0) AS bytes FROM _showai_hot_objects",
      )
      .one().bytes;
    if (total > hotBudget) await this.storage.setAlarm(Date.now() + 1000);
  }
  async stat(key: string) {
    const hot = this.hot(key);
    return hot
      ? { bytes: hot.bytes, uploadedAt: hot.uploaded_at }
      : this.cold.stat(key);
  }
  async get(key: string, maximum = 16 * 1024 * 1024) {
    const hot = this.hot(key);
    if (hot) {
      if (hot.bytes > maximum)
        throw new SyncError(
          413,
          "TOO_LARGE",
          "Metadata object exceeds its limit.",
        );
      if (this.writable())
        this.storage.sql.exec(
          "UPDATE _showai_hot_objects SET used_at=? WHERE key=?",
          Date.now(),
          key,
        );
      return new Uint8Array(hot.content);
    }
    const bytes = await this.cold.get(key, maximum);
    if (bytes && bytes.length <= hotLimit && this.writable()) {
      const info = await this.cold.stat(key);
      if (!info)
        throw new Error("Object disappeared while loading its durable cache.");
      await this.remember(key, bytes, info.uploadedAt);
    }
    return bytes;
  }
  async open(key: string) {
    const hot = this.hot(key);
    if (!hot) return this.cold.open(key);
    return {
      bytes: hot.bytes,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(hot.content));
          controller.close();
        },
      }),
    };
  }
  async put(key: string, bytes: Uint8Array) {
    if (!operationObjectKey(key))
      throw new Error("Invalid object storage key.");
    if (bytes.length <= hotLimit) await this.remember(key, bytes);
    else await this.cold.put(key, bytes);
  }
  digest() {
    return this.cold.digest();
  }
  async putVerified(
    key: string,
    body: ReadableStream<Uint8Array>,
    expected: string,
    maximum: number,
  ) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0,
      complete = false;
    try {
      while (length <= hotLimit) {
        const item = await reader.read();
        if (item.done) {
          complete = true;
          break;
        }
        chunks.push(item.value);
        length += item.value.length;
        if (length > maximum)
          throw new SyncError(413, "TOO_LARGE", "Object exceeds its limit.");
      }
      if (complete) {
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.length;
        }
        if ((await hash(bytes)) !== expected)
          throw new SyncError(
            400,
            "DIGEST_MISMATCH",
            "Content does not match its digest.",
          );
        await this.put(key, bytes);
        return length;
      }
      let index = 0;
      const forwarded = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (index < chunks.length) {
            controller.enqueue(chunks[index++]);
            return;
          }
          const item = await reader.read();
          if (item.done) controller.close();
          else controller.enqueue(item.value);
        },
        cancel(reason) {
          return reader.cancel(reason);
        },
      });
      return await this.cold.putVerified(key, forwarded, expected, maximum);
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
  }
  async remove(key: string) {
    await this.cold.remove(key);
    this.storage.sql.exec("DELETE FROM _showai_hot_objects WHERE key=?", key);
  }
  async list(cursor?: string, maximum = 100) {
    const state: { tier: "hot" | "cold"; after?: string } = cursor
      ? JSON.parse(atob(cursor))
      : { tier: "hot" };
    if (
      !["hot", "cold"].includes(state.tier) ||
      (state.after !== undefined && typeof state.after !== "string")
    )
      throw new Error("Invalid durable object inventory cursor.");
    if (state.tier === "hot") {
      const rows = this.storage.sql
        .exec<Omit<HotObject, "content">>(
          "SELECT key,bytes,uploaded_at,used_at FROM _showai_hot_objects WHERE key>? ORDER BY key LIMIT ?",
          state.after ?? "",
          maximum + 1,
        )
        .toArray();
      const more = rows.length > maximum;
      const objects = rows
        .slice(0, maximum)
        .map((item) => ({
          key: item.key,
          bytes: item.bytes,
          uploadedAt: item.uploaded_at,
        }));
      return {
        objects,
        next: btoa(
          JSON.stringify(
            more
              ? { tier: "hot", after: objects.at(-1)!.key }
              : { tier: "cold" },
          ),
        ),
      };
    }
    const page = await this.cold.list(state.after, maximum);
    const objects = page.objects.filter((item) => !this.hot(item.key));
    return {
      objects,
      ...(page.next
        ? { next: btoa(JSON.stringify({ tier: "cold", after: page.next })) }
        : {}),
    };
  }
  async archive() {
    if (!this.writable()) return;
    const rows = this.storage.sql
      .exec<HotObject>(
        "SELECT * FROM _showai_hot_objects ORDER BY used_at LIMIT 16",
      )
      .toArray();
    for (const row of rows) {
      if (!this.writable()) return;
      const bytes = new Uint8Array(row.content);
      await this.cold.put(row.key, bytes);
      const stored = await this.cold.get(row.key, hotLimit);
      if (
        !stored ||
        stored.length !== row.bytes ||
        (await hash(stored)) !== (await hash(bytes))
      )
        throw new Error("Archived object failed integrity verification.");
      // A freeze or a concurrent reader can keep the hot copy. Inventory still
      // exports one object and acknowledges no deletion before R2 verification.
      if (this.writable())
        this.storage.sql.exec(
          "DELETE FROM _showai_hot_objects WHERE key=? AND used_at=?",
          row.key,
          row.used_at,
        );
    }
    const total = this.storage.sql
      .exec<{ bytes: number }>(
        "SELECT COALESCE(SUM(bytes),0) AS bytes FROM _showai_hot_objects",
      )
      .one().bytes;
    if (total > hotBudget * 0.75)
      await this.storage.setAlarm(Date.now() + 1000);
  }
}
