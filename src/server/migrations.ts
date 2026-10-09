import { schema, type MetadataStore } from "./storage";

export const schemaVersion = 5;
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
  {
    version: 3,
    name: "object_manifests",
    statements: [
      "ALTER TABLE revisions ADD COLUMN manifest_key TEXT",
      "ALTER TABLE revisions ADD COLUMN manifest_digest TEXT",
      "ALTER TABLE revisions ADD COLUMN manifest_bytes INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE revisions ADD COLUMN sequence INTEGER",
      "UPDATE revisions SET sequence=rowid,manifest_bytes=length(CAST(manifest AS BLOB))",
      "CREATE UNIQUE INDEX revisions_sequence ON revisions(project_id,sequence)",
      "INSERT INTO settings(key,value) VALUES('schema_version','3') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ],
  },
  {
    version: 4,
    name: "storage_quotas",
    statements: [
      "ALTER TABLE projects ADD COLUMN created_by TEXT",
      "CREATE INDEX projects_creator ON projects(created_by)",
      "ALTER TABLE objects ADD COLUMN uploaded_by TEXT",
      "ALTER TABLE objects ADD COLUMN uploaded_at TEXT",
      "CREATE INDEX objects_uploader ON objects(uploaded_by)",
      "CREATE INDEX revisions_author ON revisions(user_id)",
      "CREATE TABLE storage_reservations(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,created_at TEXT NOT NULL,UNIQUE(project_id,kind,digest))",
      "CREATE INDEX storage_reservations_user ON storage_reservations(user_id)",
      "CREATE TABLE upload_budgets(day TEXT NOT NULL,user_id TEXT NOT NULL,hits INTEGER NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(day,user_id))",
      "INSERT INTO settings(key,value) VALUES('schema_version','4') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ],
  },
  {
    version: 5,
    name: "resumable_objects",
    statements: [
      "CREATE TABLE object_uploads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,user_id TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,reservation_id TEXT NOT NULL,created_at TEXT NOT NULL,completed INTEGER NOT NULL DEFAULT 0,UNIQUE(project_id,user_id,digest))",
      "CREATE TABLE object_upload_parts(upload_id TEXT NOT NULL,part_index INTEGER NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(upload_id,part_index))",
      "INSERT INTO settings(key,value) VALUES('schema_version','5') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
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
