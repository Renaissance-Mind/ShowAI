import {
  schema,
  legacyDataTables,
  accountTables,
  type MetadataStore,
} from "./storage";

export const schemaVersion = 8;
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
  {
    version: 6,
    name: "consistent_operations",
    statements: [
      "CREATE TABLE server_operations(id INTEGER PRIMARY KEY CHECK(id=1),state TEXT NOT NULL CHECK(state IN ('running','frozen')),epoch TEXT NOT NULL,frozen_at TEXT)",
      "INSERT INTO server_operations VALUES(1,'running','',NULL)",
      "CREATE TABLE server_write_leases(id TEXT PRIMARY KEY,started_at TEXT NOT NULL)",
      ...legacyDataTables.flatMap((table) =>
        ["INSERT", "UPDATE", "DELETE"].map(
          (operation) =>
            `CREATE TRIGGER freeze_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN (SELECT state FROM server_operations WHERE id=1)='frozen' BEGIN SELECT RAISE(ABORT,'SHOWAI_READ_ONLY'); END`,
        ),
      ),
      "INSERT INTO settings(key,value) VALUES('schema_version','6') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ],
  },
  {
    version: 7,
    name: "exclusive_maintenance",
    statements: [
      "ALTER TABLE server_operations ADD COLUMN maintenance_owner TEXT",
      "ALTER TABLE server_write_leases ADD COLUMN kind TEXT NOT NULL DEFAULT 'object'",
      ...legacyDataTables.flatMap((table) =>
        ["INSERT", "UPDATE", "DELETE"].flatMap((operation) => [
          `DROP TRIGGER freeze_${table}_${operation.toLowerCase()}`,
          `CREATE TRIGGER freeze_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN COALESCE((SELECT state FROM server_operations WHERE id=1),'frozen')='frozen' AND (SELECT maintenance_owner FROM server_operations WHERE id=1) IS NULL BEGIN SELECT RAISE(ABORT,'SHOWAI_READ_ONLY'); END`,
        ]),
      ),
      "UPDATE server_operations SET maintenance_owner='schema-upgrade' WHERE state='frozen'",
      "INSERT INTO settings(key,value) VALUES('schema_version','7') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      "UPDATE server_operations SET maintenance_owner=NULL WHERE maintenance_owner='schema-upgrade'",
    ],
  },
  {
    version: 8,
    name: "federated_accounts",
    statements: [
      "ALTER TABLE sessions ADD COLUMN credential_kind TEXT NOT NULL DEFAULT 'session'",
      "ALTER TABLE sessions ADD COLUMN origin_server TEXT",
      "ALTER TABLE sessions ADD COLUMN origin_user TEXT",
      "ALTER TABLE sessions ADD COLUMN origin_generation TEXT",
      "CREATE INDEX sessions_origin ON sessions(user_id,origin_server,origin_user)",
      "CREATE TABLE account_identities(user_id TEXT PRIMARY KEY REFERENCES users(id),generation TEXT NOT NULL,public_key TEXT NOT NULL,private_key TEXT NOT NULL)",
      "CREATE TABLE account_peers(user_id TEXT NOT NULL REFERENCES users(id),peer_server_id TEXT NOT NULL,peer_user_id TEXT NOT NULL,descriptor TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('active','removed')),updated_at INTEGER NOT NULL,change_id TEXT NOT NULL,PRIMARY KEY(user_id,peer_server_id))",
      "CREATE TABLE account_grant_nonces(digest TEXT PRIMARY KEY,expires_at INTEGER NOT NULL)",
      "CREATE INDEX account_grant_nonces_expiry ON account_grant_nonces(expires_at)",
      "CREATE TABLE account_resources(user_id TEXT NOT NULL REFERENCES users(id),id TEXT NOT NULL,config TEXT NOT NULL,secret TEXT,version TEXT NOT NULL,updated_at TEXT NOT NULL,refresh_lease TEXT,refresh_started_at INTEGER,publication_id TEXT,request_hash TEXT,PRIMARY KEY(user_id,id))",
      "CREATE TABLE login_identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),email TEXT,created_at TEXT NOT NULL,PRIMARY KEY(provider,subject))",
      "CREATE INDEX login_identities_user ON login_identities(user_id)",
      "CREATE TABLE login_flows(id TEXT PRIMARY KEY,provider TEXT NOT NULL,state_digest TEXT NOT NULL UNIQUE,poll_digest TEXT NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,secret TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0)",
      "CREATE INDEX login_flows_expiry ON login_flows(expires_at)",
      "UPDATE server_operations SET maintenance_owner='schema-upgrade' WHERE state='frozen'",
      ...accountTables.flatMap((table) =>
        ["INSERT", "UPDATE", "DELETE"].map(
          (operation) =>
            `CREATE TRIGGER freeze_${table}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN COALESCE((SELECT state FROM server_operations WHERE id=1),'frozen')='frozen' AND (SELECT maintenance_owner FROM server_operations WHERE id=1) IS NULL BEGIN SELECT RAISE(ABORT,'SHOWAI_READ_ONLY'); END`,
        ),
      ),
      "INSERT INTO settings(key,value) VALUES('schema_version','8') ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      "UPDATE server_operations SET maintenance_owner=NULL WHERE maintenance_owner='schema-upgrade'",
    ],
  },
];

/** Linux upgrades transactionally; Workers require deployment-time D1 migrations. */
export async function prepareMetadata(
  db: MetadataStore,
  autoMigrate: boolean,
  targetVersion = schemaVersion,
) {
  if (
    !Number.isInteger(targetVersion) ||
    targetVersion < 1 ||
    targetVersion > schemaVersion
  )
    throw new Error("Unsupported target metadata schema.");
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
      if (migration.version <= version || migration.version > targetVersion)
        continue;
      await db.batch(migration.statements.map((sql) => ({ sql })));
      version = migration.version;
    }
  }
  if (version !== targetVersion)
    throw new Error(
      "Apply ShowAI Server database migrations before serving requests.",
    );
}
