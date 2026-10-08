import { schema, type MetadataStore } from "./storage";

export const schemaVersion = 2;
export const migrations = [
  {
    version: 1,
    name: "initial",
    statements: [
      ...schema,
      "INSERT OR IGNORE INTO settings(key,value) VALUES('server_id',lower(hex(randomblob(16))))",
      "INSERT INTO settings(key,value) VALUES('schema_version','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ],
  },
  {
    version: 2,
    name: "account_protection",
    statements: [
      "CREATE TABLE request_limits (key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, hits INTEGER NOT NULL)",
      "CREATE INDEX request_limits_expiry ON request_limits(expires_at)",
      "CREATE TABLE audit_events (id TEXT PRIMARY KEY, at TEXT NOT NULL, event TEXT NOT NULL, user_id TEXT, project_id TEXT, details TEXT NOT NULL)",
      "CREATE INDEX audit_events_project_at ON audit_events(project_id,at)",
      "ALTER TABLE invites ADD COLUMN max_uses INTEGER",
      "ALTER TABLE invites ADD COLUMN target_name TEXT",
      "ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE sessions ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0",
      "INSERT INTO settings(key,value) VALUES('schema_version','2') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ],
  },
];

/** Linux upgrades transactionally; Workers require deployment-time D1 migrations. */
export async function prepareMetadata(db: MetadataStore, autoMigrate: boolean) {
  if (autoMigrate) await db.run(schema[0]);
  let version = Number(
    (
      await db.all<{ value: string }>(
        "SELECT value FROM settings WHERE key='schema_version'",
      )
    )[0]?.value ?? 0,
  );
  if (!Number.isInteger(version) || version < 0 || version > schemaVersion)
    throw new Error("Unsupported ShowAI Server metadata schema version.");
  if (autoMigrate) {
    for (const migration of migrations) {
      if (migration.version <= version) continue;
      await db.batch(migration.statements.map((sql) => ({ sql })));
      version = migration.version;
    }
  }
  if (version !== schemaVersion)
    throw new Error(
      "Apply ShowAI Server database migrations before serving requests.",
    );
}
