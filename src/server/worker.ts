import { createSyncServer } from "./app";
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
    get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
    put(key: string, bytes: Uint8Array): Promise<unknown>;
  };
  SHOWAI_SERVER_NAME?: string;
  SHOWAI_SERVER_URL?: string;
  SHOWAI_REGISTRATION_KEY?: string;
  SHOWAI_REGISTRATION_LIMIT?: string;
  SHOWAI_ACCOUNT_LIMIT?: string;
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
export function workerObjects(env: WorkerEnvironment): ObjectStore {
  return {
    async get(key) {
      const object = await env.CONTENT.get(key);
      return object ? new Uint8Array(await object.arrayBuffer()) : null;
    },
    async put(key, bytes) {
      await env.CONTENT.put(key, bytes);
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
