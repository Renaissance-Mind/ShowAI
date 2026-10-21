import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { safeLibraryPath } from "./library-files";
import {
  canonicalInkJSON,
  checkpointInkOperations,
  createInkOperation,
  materializeInkOperations,
  validateInkOperation,
  type InkOperation,
  type InkOperationChange,
  type InkOperationCheckpoint,
} from "../surface/ink-operations.mjs";

/** Also implemented by native clients. Each device owns a separate journal.
 * SQLite's WAL and FULL commit barrier, rather than a JS queue, arbitrate writers. */
export const INK_JOURNAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ink_journal_metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ink_operations(
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id TEXT NOT NULL, board_id TEXT NOT NULL,
  operation_id TEXT NOT NULL, actor TEXT NOT NULL, sequence INTEGER NOT NULL,
  sha256 TEXT NOT NULL, payload TEXT NOT NULL,
  UNIQUE(page_id,board_id,operation_id), UNIQUE(page_id,board_id,actor,sequence)
);
CREATE INDEX IF NOT EXISTS ink_operations_scope ON ink_operations(page_id,board_id,ordinal);
CREATE TABLE IF NOT EXISTS ink_checkpoints(
  page_id TEXT NOT NULL, board_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
  sha256 TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(page_id,board_id)
);`;
type Scope = { pageId: string; boardId: string };
type OperationRow = { ordinal: number; operation_id: string; actor: string; sequence: number; sha256: string; payload: string };
type CheckpointRow = { ordinal: number; sha256: string; payload: string };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Host/worker API. Never instantiate this synchronous SQLite adapter on an
 * input/render thread. Browser storage needs its own durable transaction adapter. */
export class InkOperationJournal {
  readonly actor: string;
  private constructor(readonly path: string, private readonly db: DatabaseSync, private readonly checkpointEvery: number) {
    db.exec("PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    db.exec(INK_JOURNAL_SCHEMA_SQL);
    db.prepare("INSERT OR IGNORE INTO ink_journal_metadata VALUES('format','showai-ink-journal-v1')").run();
    if (db.prepare("SELECT value FROM ink_journal_metadata WHERE key='format'").get()?.value !== "showai-ink-journal-v1")
      throw new Error("Unsupported ink operation journal version.");
    db.prepare("INSERT OR IGNORE INTO ink_journal_metadata VALUES('actor',?)").run(`device-${randomUUID()}`);
    this.actor = db.prepare("SELECT value FROM ink_journal_metadata WHERE key='actor'").get()!.value as string;
  }
  static async open(root: string, options: { path?: string; checkpointEvery?: number } = {}) {
    const path = options.path ?? join(root, "local", "ink-operations.sqlite");
    const checkpointEvery = options.checkpointEvery ?? 128;
    if (!Number.isSafeInteger(checkpointEvery) || checkpointEvery < 1) throw new Error("Invalid ink checkpoint interval.");
    await safeLibraryPath(root, path);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await safeLibraryPath(root, path);
    const file = await open(path, "a", 0o600); await file.close();
    const db = new DatabaseSync(path);
    try { return new InkOperationJournal(path, db, checkpointEvery); }
    catch (error) { db.close(); throw error; }
  }
  close() { this.db.close(); }
  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  private decode(row: OperationRow): InkOperation {
    if (digest(row.payload) !== row.sha256) throw new Error(`Ink journal checksum mismatch: ${row.operation_id}`);
    const operation = validateInkOperation(JSON.parse(row.payload));
    if (operation.id !== row.operation_id || operation.actor !== row.actor || operation.sequence !== row.sequence)
      throw new Error("Ink journal identity differs from its indexed identity.");
    return operation;
  }
  private state(scope: Scope) {
    const row = this.db.prepare("SELECT ordinal,sha256,payload FROM ink_checkpoints WHERE page_id=? AND board_id=?").get(scope.pageId, scope.boardId) as CheckpointRow | undefined;
    let checkpoint: InkOperationCheckpoint | undefined;
    if (row) {
      if (digest(row.payload) !== row.sha256) throw new Error("Ink checkpoint checksum mismatch.");
      checkpoint = JSON.parse(row.payload) as InkOperationCheckpoint;
      if (checkpoint.pageId !== scope.pageId || checkpoint.boardId !== scope.boardId) throw new Error("Ink checkpoint scope mismatch.");
    }
    const rows = this.db.prepare("SELECT ordinal,operation_id,actor,sequence,sha256,payload FROM ink_operations WHERE page_id=? AND board_id=? AND ordinal>? ORDER BY ordinal").all(scope.pageId, scope.boardId, row?.ordinal ?? 0) as OperationRow[];
    const operations = rows.map(item => {
      const operation = this.decode(item);
      if (operation.pageId !== scope.pageId || operation.boardId !== scope.boardId) throw new Error("Ink journal scope mismatch.");
      return operation;
    });
    return { checkpoint, operations, ordinal: rows.at(-1)?.ordinal ?? row?.ordinal ?? 0 };
  }
  read(scope: Scope) {
    const state = this.state(scope);
    return { ...state, materialization: state.checkpoint || state.operations.length ? materializeInkOperations(state.operations, state.checkpoint) : null };
  }
  /** Import complete causal batches. Missing dependencies and actor forks roll
   * back the entire batch, including unrelated changes in that transaction. */
  append(operations: InkOperation[]) {
    return this.transaction(() => this.appendInside(operations));
  }
  private appendInside(operations: InkOperation[]) {
    const groups = new Map<string, { scope: Scope; operations: InkOperation[] }>();
    for (const operation of operations) {
      validateInkOperation(operation);
      const key = canonicalInkJSON([operation.pageId, operation.boardId]);
      const group = groups.get(key) ?? { scope: { pageId: operation.pageId, boardId: operation.boardId }, operations: [] };
      group.operations.push(operation); groups.set(key, group);
    }
    let appended = 0;
    for (const { scope, operations: incoming } of groups.values()) {
      const state = this.state(scope), fresh: InkOperation[] = [];
      const get = this.db.prepare("SELECT ordinal,operation_id,actor,sequence,sha256,payload FROM ink_operations WHERE page_id=? AND board_id=? AND operation_id=?");
      const queued = new Map<string, string>();
      for (const operation of incoming) {
        const payload = canonicalInkJSON(operation), row = get.get(scope.pageId, scope.boardId, operation.id) as OperationRow | undefined;
        if (row) {
          this.decode(row);
          if (row.payload !== payload) throw new Error(`Ink operation id collision: ${operation.id}`);
        } else if (queued.has(operation.id)) {
          if (queued.get(operation.id) !== payload) throw new Error(`Ink operation id collision: ${operation.id}`);
        } else { fresh.push(operation); queued.set(operation.id, payload); }
      }
      if (!fresh.length) continue;
      const next = checkpointInkOperations([...state.operations, ...fresh], state.checkpoint);
      const insert = this.db.prepare("INSERT INTO ink_operations(page_id,board_id,operation_id,actor,sequence,sha256,payload) VALUES(?,?,?,?,?,?,?)");
      for (const operation of fresh) {
        const payload = queued.get(operation.id)!;
        insert.run(scope.pageId, scope.boardId, operation.id, operation.actor, operation.sequence, digest(payload), payload);
        appended++;
      }
      if (state.operations.length + fresh.length >= this.checkpointEvery) this.writeCheckpoint(scope, next);
    }
    return { appended };
  }
  /** Actor/sequence allocation is atomic across processes sharing this device DB.
   * Parents are the actual view seen by the author; newer remote operations are
   * never silently added to that causal view. The preceding local op is causal. */
  appendLocal(input: Scope & { parents: string[]; changes: InkOperationChange[] }) {
    return this.transaction(() => {
      const previous = this.db.prepare("SELECT MAX(sequence) AS sequence FROM ink_operations WHERE page_id=? AND board_id=? AND actor=?").get(input.pageId, input.boardId, this.actor)?.sequence;
      const sequence = Number(previous ?? 0) + 1;
      const operation = createInkOperation({ ...input, actor: this.actor, sequence, parents: [...input.parents, ...(sequence > 1 ? [`${this.actor}:${sequence - 1}`] : [])] });
      this.appendInside([operation]);
      return operation;
    });
  }
  private writeCheckpoint(scope: Scope, checkpoint: InkOperationCheckpoint) {
    const ordinal = this.db.prepare("SELECT MAX(ordinal) AS ordinal FROM ink_operations WHERE page_id=? AND board_id=?").get(scope.pageId, scope.boardId)!.ordinal;
    const payload = canonicalInkJSON(checkpoint);
    this.db.prepare("INSERT INTO ink_checkpoints VALUES(?,?,?,?,?) ON CONFLICT(page_id,board_id) DO UPDATE SET ordinal=excluded.ordinal,sha256=excluded.sha256,payload=excluded.payload").run(scope.pageId, scope.boardId, ordinal as number, digest(payload), payload);
  }
  checkpoint(scope: Scope) {
    return this.transaction(() => {
      const state = this.state(scope);
      if (!state.operations.length && !state.checkpoint) return null;
      const checkpoint = checkpointInkOperations(state.operations, state.checkpoint);
      this.writeCheckpoint(scope, checkpoint);
      return checkpoint;
    });
  }
  /** Retained source operations support export, selective undo and integrity audit.
   * No peer acknowledgement or network transport is implied by this method. */
  operations(scope: Scope): InkOperation[] {
    return (this.db.prepare("SELECT ordinal,operation_id,actor,sequence,sha256,payload FROM ink_operations WHERE page_id=? AND board_id=? ORDER BY ordinal").all(scope.pageId, scope.boardId) as OperationRow[]).map(row => {
      const operation = this.decode(row);
      if (operation.pageId !== scope.pageId || operation.boardId !== scope.boardId) throw new Error("Ink operation scope mismatch.");
      return operation;
    });
  }
}
