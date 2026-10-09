import { createSyncServer } from "./app";
import { SyncError } from "../sync/protocol";
import type { StreamDigest } from "./storage";
import type {
  MetadataStore,
  ObjectStore,
  SqlValue,
  SqlStatement,
} from "./storage";
interface Statement {
  bind(...values: SqlValue[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
interface WorkerEnvironment {
  DB: {
    prepare(sql: string): Statement;
    batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]>;
  };
  CONTENT: {
    get(key: string): Promise<{
      arrayBuffer(): Promise<ArrayBuffer>;
      body: ReadableStream<Uint8Array>;
      size: number;
    } | null>;
    put(
      key: string,
      bytes: Uint8Array | ReadableStream<Uint8Array>,
    ): Promise<unknown>;
    delete(key: string): Promise<void>;
    createMultipartUpload(key: string): Promise<{
      uploadPart(
        index: number,
        bytes: Uint8Array,
      ): Promise<{ partNumber: number; etag: string }>;
      complete(parts: { partNumber: number; etag: string }[]): Promise<unknown>;
      abort(): Promise<void>;
    }>;
  };
  SHOWAI_SERVER_NAME?: string;
  SHOWAI_SERVER_URL?: string;
  SHOWAI_REGISTRATION_KEY?: string;
  SHOWAI_REGISTRATION_LIMIT?: string;
  SHOWAI_ACCOUNT_LIMIT?: string;
  SHOWAI_STORAGE_POLICY?: string;
  SHOWAI_ALLOWED_ORIGINS?: string;
}
export function workerMetadata(env: WorkerEnvironment): MetadataStore {
  const statement = (sql: string, values: SqlValue[] = []) =>
    env.DB.prepare(sql).bind(...values);
  return {
    async all<T>(sql: string, values?: SqlValue[]) {
      return (await statement(sql, values).all<T>()).results;
    },
    async run(sql: string, values?: SqlValue[]) {
      return { changes: (await statement(sql, values).run()).meta.changes };
    },
    async batch(statements: SqlStatement[]) {
      return (
        await env.DB.batch(
          statements.map((item) => statement(item.sql, item.values)),
        )
      ).map((result) => ({ changes: result.meta.changes }));
    },
  };
}
function workerDigest(): StreamDigest {
  const stream = new (
    crypto as Crypto & {
      DigestStream: new (
        algorithm: string,
      ) => WritableStream<Uint8Array> & { digest: Promise<ArrayBuffer> };
    }
  ).DigestStream("SHA-256");
  const writer = stream.getWriter();
  return {
    async update(bytes) {
      await writer.write(bytes);
    },
    async finish() {
      await writer.close();
      return Array.from(new Uint8Array(await stream.digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
    },
  };
}
let activeUploads = 0;
export function workerObjects(env: WorkerEnvironment): ObjectStore {
  return {
    digest: workerDigest,
    async remove(key) {
      await env.CONTENT.delete(key);
    },
    async open(key) {
      const object = await env.CONTENT.get(key);
      return object ? { body: object.body, bytes: object.size } : null;
    },
    async get(key, maximum = 16 * 1024 * 1024) {
      const object = await env.CONTENT.get(key);
      if (object && object.size > maximum) {
        await object.body.cancel();
        throw new SyncError(
          413,
          "TOO_LARGE",
          "Metadata object exceeds its size limit.",
        );
      }
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    async put(key, bytes) {
      await env.CONTENT.put(key, bytes);
    },
    async putVerified(key, body, expected, maximum) {
      if (activeUploads >= 2)
        throw new SyncError(
          429,
          "BUSY",
          "Upload capacity is busy; retry shortly.",
          { retryAfter: 1 },
        );
      activeUploads++;
      const temporary = `${key}.staging-${crypto.randomUUID()}`;
      const digest = workerDigest(),
        reader = body.getReader();
      const partBytes = 5 * 1024 * 1024;
      let buffer = new Uint8Array(partBytes),
        filled = 0,
        length = 0,
        completed = false;
      let upload:
        | Awaited<
            ReturnType<WorkerEnvironment["CONTENT"]["createMultipartUpload"]>
          >
        | undefined;
      const parts: { partNumber: number; etag: string }[] = [];
      try {
        upload = await env.CONTENT.createMultipartUpload(temporary);
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maximum) {
            await reader.cancel();
            throw new SyncError(413, "TOO_LARGE", "Object exceeds 64 MiB.");
          }
          await digest.update(value);
          for (let offset = 0; offset < value.byteLength;) {
            const count = Math.min(
              partBytes - filled,
              value.byteLength - offset,
            );
            buffer.set(value.subarray(offset, offset + count), filled);
            filled += count;
            offset += count;
            if (filled === partBytes) {
              parts.push(await upload.uploadPart(parts.length + 1, buffer));
              buffer = new Uint8Array(partBytes);
              filled = 0;
            }
          }
        }
        if ((await digest.finish()) !== expected)
          throw new SyncError(
            400,
            "DIGEST_MISMATCH",
            "Content does not match its digest.",
          );
        if (filled || !parts.length)
          parts.push(
            await upload.uploadPart(
              parts.length + 1,
              buffer.subarray(0, filled),
            ),
          );
        await upload.complete(parts);
        completed = true;
        const stored = await env.CONTENT.get(temporary);
        if (!stored || stored.size !== length)
          throw new Error("Staged object length does not match.");
        await env.CONTENT.put(key, stored.body);
        return length;
      } finally {
        reader.releaseLock();
        activeUploads--;
        if (upload && !completed) await upload.abort();
        // This request-owned staging key has never been published or referenced.
        // Its transaction rollback differs from historical orphan garbage collection.
        if (upload) await env.CONTENT.delete(temporary);
      }
    },
  };
}
const instances = new WeakMap<
  WorkerEnvironment,
  ReturnType<typeof createSyncServer>
>();
export default {
  async fetch(request: Request, env: WorkerEnvironment) {
    let app = instances.get(env);
    if (!app) {
      app = createSyncServer({
        metadata: workerMetadata(env),
        objects: workerObjects(env),
        name: env.SHOWAI_SERVER_NAME,
        publicUrl: env.SHOWAI_SERVER_URL,
        registrationKey: env.SHOWAI_REGISTRATION_KEY,
        autoMigrate: false,
        registrationMode: "controlled",
        storagePolicy: env.SHOWAI_STORAGE_POLICY
          ? JSON.parse(env.SHOWAI_STORAGE_POLICY)
          : undefined,
        accountLimit: env.SHOWAI_ACCOUNT_LIMIT
          ? Number(env.SHOWAI_ACCOUNT_LIMIT)
          : undefined,
        registrationLimit: env.SHOWAI_REGISTRATION_LIMIT
          ? Number(env.SHOWAI_REGISTRATION_LIMIT)
          : undefined,
        allowedOrigins: env.SHOWAI_ALLOWED_ORIGINS?.split(",").filter(Boolean),
        requirePublicOrigin: true,
      });
      instances.set(env, app);
    }
    return app.fetch(request, {
      source: request.headers.get("cf-connecting-ip") ?? "unknown",
    });
  },
};
