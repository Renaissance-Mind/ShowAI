export type SqlValue = string | number | null;
export interface SqlStatement {
  sql: string;
  values?: SqlValue[];
}
export interface SqlResult {
  changes: number;
}
export interface MetadataStore {
  all<T>(sql: string, values?: SqlValue[]): Promise<T[]>;
  run(sql: string, values?: SqlValue[]): Promise<SqlResult>;
  batch(statements: SqlStatement[]): Promise<SqlResult[]>;
}
export interface ObjectStore {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}
export const schema = [
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), device TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, head TEXT, archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS members (project_id TEXT NOT NULL REFERENCES projects(id), user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), PRIMARY KEY(project_id,user_id))`,
  `CREATE INDEX IF NOT EXISTS members_user ON members(user_id)`,
  `CREATE TABLE IF NOT EXISTS invites (digest TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')), created_by TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_by TEXT, revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS objects (project_id TEXT NOT NULL REFERENCES projects(id), digest TEXT NOT NULL, bytes INTEGER NOT NULL, PRIMARY KEY(project_id,digest))`,
  `CREATE TABLE IF NOT EXISTS revisions (project_id TEXT NOT NULL REFERENCES projects(id), revision TEXT NOT NULL, manifest TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id,revision))`,
];
