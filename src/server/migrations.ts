import { schema, type MetadataStore } from "./storage";

export const schemaVersion = 1;
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
