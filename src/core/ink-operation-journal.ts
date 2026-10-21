import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeLibraryPath } from "./library-files";
import {
  canonicalInkJSON, createInkOperation,
  inkCheckpointFromRecords, inkCheckpointRecords, InkOperationReplica,
  materializeInkOperations, validateInkOperation,
  type InkOperation, type InkOperationChange, type InkOperationCheckpoint,
  type InkReplicaPrepared, type InkReplicaRecord,
} from "../surface/ink-operations.mjs";

export const INK_JOURNAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ink_journal_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ink_operations(
 ordinal INTEGER PRIMARY KEY AUTOINCREMENT, page_id TEXT NOT NULL, board_id TEXT NOT NULL,
 operation_id TEXT NOT NULL, actor TEXT NOT NULL, sequence INTEGER NOT NULL,
 sha256 TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE(page_id,board_id,operation_id), UNIQUE(page_id,board_id,actor,sequence));
CREATE INDEX IF NOT EXISTS ink_operations_scope ON ink_operations(page_id,board_id,ordinal);
CREATE TABLE IF NOT EXISTS ink_checkpoints(
 page_id TEXT NOT NULL,board_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
 sha256 TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(page_id,board_id));
CREATE TABLE IF NOT EXISTS ink_replica_records(
 page_id TEXT NOT NULL,board_id TEXT NOT NULL,kind TEXT NOT NULL,record_key TEXT NOT NULL,
 field TEXT NOT NULL,payload TEXT NOT NULL,sha256 TEXT NOT NULL,
 PRIMARY KEY(page_id,board_id,kind,record_key,field));
CREATE TABLE IF NOT EXISTS ink_replica_state(
 page_id TEXT NOT NULL,board_id TEXT NOT NULL,ordinal INTEGER NOT NULL,
 payload TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(page_id,board_id));`;
type Scope = { pageId: string; boardId: string };
type OperationRow = { ordinal: number; operation_id: string; actor: string; sequence: number; sha256: string; payload: string };
type SnapshotRow = { ordinal: number; sha256: string; payload: string };
type RecordRow = { kind: InkReplicaRecord["kind"]; record_key: string; field: string; payload: string; sha256: string };
type Cached = { replica: InkOperationReplica; ordinal: number; dirty: InkReplicaRecord[] };
type Plan = { cached: Cached; token: string; ordinal: number };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const scopeKey = (scope: Scope) => canonicalInkJSON([scope.pageId, scope.boardId]);

/** Synchronous host/worker API. One retained replica validates only fresh edits;
 * source + touched register rows commit atomically before publishing its delta.
 * Never instantiate this adapter on an input/render thread. */
export class InkOperationJournal {
  readonly actor: string;
  private readonly replicas = new Map<string, Cached>();
  private constructor(readonly path: string, private readonly db: DatabaseSync) {
    db.exec("PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    db.exec(INK_JOURNAL_SCHEMA_SQL);
    db.prepare("INSERT OR IGNORE INTO ink_journal_metadata VALUES('format','showai-ink-journal-v1')").run();
    if (db.prepare("SELECT value FROM ink_journal_metadata WHERE key='format'").get()?.value !== "showai-ink-journal-v1") throw new Error("Unsupported ink operation journal version.");
    db.prepare("INSERT OR IGNORE INTO ink_journal_metadata VALUES('actor',?)").run(`device-${randomUUID()}`);
    this.actor = db.prepare("SELECT value FROM ink_journal_metadata WHERE key='actor'").get()!.value as string;
  }
  static async open(root: string, options: { path?: string; checkpointEvery?: number } = {}) {
    const path = options.path ?? join(root, "local", "ink-operations.sqlite");
    if (options.checkpointEvery !== undefined && (!Number.isSafeInteger(options.checkpointEvery) || options.checkpointEvery < 1)) throw new Error("Invalid ink checkpoint interval.");
    await safeLibraryPath(root, path); await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await safeLibraryPath(root, path);
    const file = await open(path, "a", 0o600); await file.close();
    const db = new DatabaseSync(path);
    try { return new InkOperationJournal(path, db); } catch (error) { db.close(); throw error; }
  }
  close() { this.db.close(); this.replicas.clear(); }
  private transaction<T>(action: (plans: Plan[]) => T): T {
    const plans: Plan[] = [];
    this.db.exec("BEGIN IMMEDIATE");
    let durable = false;
    try {
      const result = action(plans); this.db.exec("COMMIT"); durable = true;
      for (const plan of plans) { plan.cached.replica.commit(plan.token); plan.cached.ordinal = plan.ordinal; plan.cached.dirty = []; }
      return result;
    } catch (error) {
      if (!durable) { this.db.exec("ROLLBACK"); for (const plan of plans) plan.cached.replica.abort(plan.token); }
      else this.replicas.clear(); // The durable source is authoritative after a publication failure.
      throw error;
    }
  }
  private decode(row: OperationRow): InkOperation {
    if (digest(row.payload) !== row.sha256) throw new Error(`Ink journal checksum mismatch: ${row.operation_id}`);
    const operation = validateInkOperation(JSON.parse(row.payload));
    if (operation.id !== row.operation_id || operation.actor !== row.actor || operation.sequence !== row.sequence) throw new Error("Ink journal identity differs from its indexed identity.");
    return operation;
  }
  private tail(scope: Scope, ordinal: number) {
    return (this.db.prepare("SELECT ordinal,operation_id,actor,sequence,sha256,payload FROM ink_operations WHERE page_id=? AND board_id=? AND ordinal>? ORDER BY ordinal").all(scope.pageId, scope.boardId, ordinal) as OperationRow[]).map(row => {
      const operation = this.decode(row);
      if (operation.pageId !== scope.pageId || operation.boardId !== scope.boardId) throw new Error("Ink journal scope mismatch.");
      return { ordinal: row.ordinal, operation };
    });
  }
  private state(scope: Scope) {
    const legacy = this.db.prepare("SELECT ordinal,sha256,payload FROM ink_checkpoints WHERE page_id=? AND board_id=?").get(scope.pageId, scope.boardId) as SnapshotRow | undefined;
    const indexed = this.db.prepare("SELECT ordinal,sha256,payload FROM ink_replica_state WHERE page_id=? AND board_id=?").get(scope.pageId, scope.boardId) as SnapshotRow | undefined;
    let checkpoint: InkOperationCheckpoint | undefined, ordinal = 0, legacySelected = false;
    // Always expose corrupt committed checkpoints, even when a newer index exists.
    if (legacy && digest(legacy.payload) !== legacy.sha256) throw new Error("Ink checkpoint checksum mismatch.");
    if (indexed && digest(indexed.payload) !== indexed.sha256) throw new Error("Ink replica state checksum mismatch.");
    if (legacy && (!indexed || legacy.ordinal > indexed.ordinal)) {
      checkpoint = JSON.parse(legacy.payload) as InkOperationCheckpoint; ordinal = legacy.ordinal; legacySelected = true;
    } else if (indexed) {
      const metadata = JSON.parse(indexed.payload) as { format: string; frontier: string[] };
      if (metadata.format !== "showai-ink-index-v1") throw new Error("Unsupported ink replica index.");
      const records = (this.db.prepare("SELECT kind,record_key,field,payload,sha256 FROM ink_replica_records WHERE page_id=? AND board_id=?").all(scope.pageId, scope.boardId) as RecordRow[]).map(row => {
        if (digest(row.payload) !== row.sha256) throw new Error("Ink replica register checksum mismatch.");
        return { kind: row.kind, key: row.record_key, field: row.field, value: JSON.parse(row.payload) };
      });
      checkpoint = inkCheckpointFromRecords({ ...scope, frontier: metadata.frontier, records }); ordinal = indexed.ordinal;
    }
    if (checkpoint && (checkpoint.pageId !== scope.pageId || checkpoint.boardId !== scope.boardId)) throw new Error("Ink checkpoint scope mismatch.");
    const rows = this.tail(scope, ordinal);
    return { checkpoint, operations: rows.map(row => row.operation), ordinal: rows.at(-1)?.ordinal ?? ordinal, legacySelected };
  }
  read(scope: Scope) {
    const state = this.readState(scope);
    return { ...state, materialization: state.checkpoint || state.operations.length ? materializeInkOperations(state.operations, state.checkpoint) : null };
  }
  private readState(scope: Scope) {
    this.db.exec("BEGIN");
    try { const state = this.state(scope); this.db.exec("COMMIT"); return state; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private cached(scope: Scope): Cached {
    const key = scopeKey(scope); let cached = this.replicas.get(key);
    if (!cached) {
      const state = this.state(scope);
      const replica = new InkOperationReplica({ ...scope, checkpoint: state.checkpoint });
      const dirty = state.legacySelected && state.checkpoint ? inkCheckpointRecords(state.checkpoint) : [];
      const applied = replica.append(state.operations);
      cached = { replica, ordinal: state.ordinal, dirty: [...dirty, ...applied.records] }; this.replicas.set(key, cached);
    } else {
      const rows = this.tail(scope, cached.ordinal);
      if (rows.length) { const applied = cached.replica.append(rows.map(row => row.operation)); cached.dirty.push(...applied.records); cached.ordinal = rows.at(-1)!.ordinal; }
    }
    return cached;
  }
  /** Page-load warmup; the first subsequent stroke uses retained semantic state. */
  warm(scope: Scope) {
    this.db.exec("BEGIN");
    try { const cached = this.cached(scope); this.db.exec("COMMIT"); return { actor: this.actor, ordinal: cached.ordinal }; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  append(operations: InkOperation[]) { return this.transaction(plans => this.appendInside(operations, plans)); }
  private appendInside(operations: InkOperation[], plans: Plan[]) {
    const groups = new Map<string, { scope: Scope; operations: InkOperation[] }>();
    for (const operation of operations) {
      validateInkOperation(operation);
      const scope = { pageId: operation.pageId, boardId: operation.boardId }, key = scopeKey(scope);
      const group = groups.get(key) ?? { scope, operations: [] }; group.operations.push(operation); groups.set(key, group);
    }
    let appended = 0;
    for (const { scope, operations: incoming } of groups.values()) {
      const cached = this.cached(scope), fresh: InkOperation[] = [], queued = new Map<string, string>();
      const get = this.db.prepare("SELECT ordinal,operation_id,actor,sequence,sha256,payload FROM ink_operations WHERE page_id=? AND board_id=? AND operation_id=?");
      for (const operation of incoming) {
        const payload = canonicalInkJSON(operation), row = get.get(scope.pageId, scope.boardId, operation.id) as OperationRow | undefined;
        if (row) { this.decode(row); if (row.payload !== payload) throw new Error(`Ink operation id collision: ${operation.id}`); }
        else if (queued.has(operation.id)) { if (queued.get(operation.id) !== payload) throw new Error(`Ink operation id collision: ${operation.id}`); }
        else { fresh.push(operation); queued.set(operation.id, payload); }
      }
      if (!fresh.length) continue;
      const prepared = cached.replica.prepare(fresh);
      const plan = { cached, token: prepared.token, ordinal: cached.ordinal }; plans.push(plan);
      const insert = this.db.prepare("INSERT INTO ink_operations(page_id,board_id,operation_id,actor,sequence,sha256,payload) VALUES(?,?,?,?,?,?,?)");
      for (const operation of fresh) {
        const payload = queued.get(operation.id)!;
        plan.ordinal = Number(insert.run(scope.pageId, scope.boardId, operation.id, operation.actor, operation.sequence, digest(payload), payload).lastInsertRowid); appended++;
      }
      this.writeIndex(scope, [...cached.dirty, ...prepared.records], prepared, plan.ordinal);
    }
    return { appended };
  }
  appendLocal(input: Scope & { parents: string[]; changes: InkOperationChange[] }) {
    return this.transaction(plans => {
      const previous = this.db.prepare("SELECT MAX(sequence) AS sequence FROM ink_operations WHERE page_id=? AND board_id=? AND actor=?").get(input.pageId, input.boardId, this.actor)?.sequence;
      const sequence = Number(previous ?? 0) + 1;
      const operation = createInkOperation({ ...input, actor: this.actor, sequence, parents: [...input.parents, ...(sequence > 1 ? [`${this.actor}:${sequence - 1}`] : [])] });
      this.appendInside([operation], plans); return operation;
    });
  }
  /** A separate persisted wire actor stamps CAS-checked snapshot editors. It
   * cannot collide with the device actor's actual journal operation sequence. */
  reserveWireIdentity(pageId: string, minimumSequence = 0) {
    if (!Number.isSafeInteger(minimumSequence) || minimumSequence < 0) throw new Error("Invalid wire sequence baseline.");
    return this.transaction(() => {
      const key = `wire-sequence:${digest(pageId)}`;
      const previous = Number(this.db.prepare("SELECT value FROM ink_journal_metadata WHERE key=?").get(key)?.value ?? 0);
      const sequence = Math.max(previous, minimumSequence) + 1;
      if (!Number.isSafeInteger(sequence)) throw new Error("Ink wire sequence is exhausted.");
      this.db.prepare("INSERT INTO ink_journal_metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, String(sequence));
      return { actor: `wire-${this.actor}`, sequence };
    });
  }
  private writeIndex(scope: Scope, records: InkReplicaRecord[], prepared: InkReplicaPrepared, ordinal: number) {
    const statement = this.db.prepare("INSERT INTO ink_replica_records VALUES(?,?,?,?,?,?,?) ON CONFLICT(page_id,board_id,kind,record_key,field) DO UPDATE SET payload=excluded.payload,sha256=excluded.sha256");
    for (const record of records) { const payload = canonicalInkJSON(record.value); statement.run(scope.pageId, scope.boardId, record.kind, record.key, record.field, payload, digest(payload)); }
    const payload = canonicalInkJSON({ format: "showai-ink-index-v1", frontier: prepared.frontier });
    this.db.prepare("INSERT INTO ink_replica_state VALUES(?,?,?,?,?) ON CONFLICT(page_id,board_id) DO UPDATE SET ordinal=excluded.ordinal,payload=excluded.payload,sha256=excluded.sha256").run(scope.pageId, scope.boardId, ordinal, payload, digest(payload));
  }
  /** Explicit export snapshot. Hot appends already checkpoint only touched rows;
   * they never serialize or rewrite every stored stroke. */
  checkpoint(scope: Scope) {
    this.transaction(plans => {
      const cached = this.cached(scope), prepared = cached.replica.prepare([]);
      plans.push({ cached, token: prepared.token, ordinal: cached.ordinal });
      this.writeIndex(scope, cached.dirty, prepared, cached.ordinal);
    });
    // Reconstruction/export is outside the SQLite writer lock.
    return this.readState(scope).checkpoint ?? null;
  }
  operations(scope: Scope): InkOperation[] { return this.tail(scope, 0).map(row => row.operation); }
}
