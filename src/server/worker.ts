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
  all<T>(): Promise<{ results: T[]; meta?: D1Usage }>;
  run(): Promise<{ meta: D1Usage }>;
}
interface D1Usage {
  changes: number;
  rows_read?: number;
  rows_written?: number;
  duration?: number;
}
interface WorkerEnvironment {
  DB: {
    prepare(sql: string): Statement;
    batch(statements: Statement[]): Promise<{ meta: D1Usage }[]>;
  };
  CONTENT: {
    head(key: string): Promise<{ size: number; uploaded: Date } | null>;
    list(options: { cursor?: string; limit: number }): Promise<{
      objects: { key: string; size: number; uploaded: Date }[];
      truncated: boolean;
      cursor?: string;
    }>;
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
  SHOWAI_REQUEST_POLICY?: string;
  SHOWAI_OBSERVE?: string;
  REQUEST_RATE?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  SOURCE_RATE?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
  SHOWAI_ALLOWED_ORIGINS?: string;
  SHOWAI_OPERATIONS_KEY?: string;
}
function metric(env: WorkerEnvironment, value: Record<string, unknown>) {
  if (env.SHOWAI_OBSERVE === "1")
    console.log(JSON.stringify({ showaiMetric: true, ...value }));
}
export function workerMetadata(env: WorkerEnvironment): MetadataStore {
  const statement = (sql: string, values: SqlValue[] = []) =>
    env.DB.prepare(sql).bind(...values);
  return {
    async all<T>(sql: string, values?: SqlValue[]) {
      const result = await statement(sql, values).all<T>();
      metric(env, {
        kind: "d1",
        rowsRead: result.meta?.rows_read,
        rowsWritten: result.meta?.rows_written,
        durationMs: result.meta?.duration,
      });
      return result.results;
    },
    async run(sql: string, values?: SqlValue[]) {
      const result = await statement(sql, values).run();
      metric(env, {
        kind: "d1",
        rowsRead: result.meta.rows_read,
        rowsWritten: result.meta.rows_written,
        durationMs: result.meta.duration,
      });
      return { changes: result.meta.changes };
    },
    async batch(statements: SqlStatement[]) {
      const results = await env.DB.batch(
        statements.map((item) => statement(item.sql, item.values)),
      );
      for (const result of results)
        metric(env, {
          kind: "d1",
          rowsRead: result.meta.rows_read,
          rowsWritten: result.meta.rows_written,
          durationMs: result.meta.duration,
        });
      return results.map((result) => ({ changes: result.meta.changes }));
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
  const note = (operation: string, bytes?: number) =>
    metric(env, {
      kind: "r2",
      operation,
      bytes,
      measurement: "operation-attempt",
    });
  return {
    async stat(key) {
      note("head");
      const info = await env.CONTENT.head(key);
      return info
        ? { bytes: info.size, uploadedAt: info.uploaded.toISOString() }
        : null;
    },
    async list(cursor, maximum = 100) {
      note("list");
      const page = await env.CONTENT.list({ cursor, limit: maximum });
      if (page.truncated && !page.cursor)
        throw new Error(
          "Object inventory is truncated without a continuation cursor.",
        );
      return {
        objects: page.objects.map((item) => ({
          key: item.key,
          bytes: item.size,
          uploadedAt: item.uploaded.toISOString(),
        })),
        ...(page.truncated ? { next: page.cursor } : {}),
      };
    },
    digest: workerDigest,
    async remove(key) {
      note("delete");
      await env.CONTENT.delete(key);
    },
    async open(key) {
      note("get");
      const object = await env.CONTENT.get(key);
      return object ? { body: object.body, bytes: object.size } : null;
    },
    async get(key, maximum = 16 * 1024 * 1024) {
      note("get");
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
      note("put", bytes.byteLength);
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
        note("createMultipartUpload");
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
              note("uploadPart", buffer.byteLength);
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
        if (filled || !parts.length) {
          note("uploadPart", filled);
          parts.push(
            await upload.uploadPart(
              parts.length + 1,
              buffer.subarray(0, filled),
            ),
          );
        }
        note("completeMultipartUpload");
        await upload.complete(parts);
        completed = true;
        note("get");
        const stored = await env.CONTENT.get(temporary);
        if (!stored || stored.size !== length)
          throw new Error("Staged object length does not match.");
        note("put", length);
        await env.CONTENT.put(key, stored.body);
        return length;
      } finally {
        reader.releaseLock();
        activeUploads--;
        if (upload && !completed) {
          note("abortMultipartUpload");
          await upload.abort();
        }
        // This request-owned staging key has never been published or referenced.
        // Its transaction rollback differs from historical orphan garbage collection.
        if (upload) {
          note("delete");
          await env.CONTENT.delete(temporary);
        }
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
    const begun = performance.now();
    const source = request.headers.get("cf-connecting-ip") ?? "unknown";
    const credential = request.headers
      .get("authorization")
      ?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const rateKey = credential
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(credential),
            ),
          ),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join("")
      : `anonymous:${source}`;
    if (env.REQUEST_RATE || env.SOURCE_RATE) {
      if (
        (env.SOURCE_RATE &&
          !(await env.SOURCE_RATE.limit({ key: source })).success) ||
        (env.REQUEST_RATE &&
          !(await env.REQUEST_RATE.limit({ key: rateKey })).success)
      )
        return new Response(
          JSON.stringify({
            error: {
              code: "RATE_LIMITED",
              message: "请求过于频繁，请稍后重试。",
            },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "60",
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        );
    }
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
        operationsKey: env.SHOWAI_OPERATIONS_KEY,
        requestPolicy: env.SHOWAI_REQUEST_POLICY
          ? JSON.parse(env.SHOWAI_REQUEST_POLICY)
          : undefined,
      });
      instances.set(env, app);
    }
    const response = await app.fetch(request, {
      source: request.headers.get("cf-connecting-ip") ?? "unknown",
    });
    const path = new URL(request.url).pathname;
    const category = path.includes("/api/ops/")
      ? "operations"
      : path.includes("/api/auth/")
        ? "authentication"
        : path.includes("/objects")
          ? "objects"
          : path.includes("/revisions")
            ? "history"
            : path.endsWith("/heads")
              ? "heads"
              : "metadata";
    metric(env, {
      kind: "request",
      category,
      method: request.method,
      status: response.status,
      headersLatencyMs: performance.now() - begun,
    });
    return response;
  },
};
