import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { join, resolve } from "node:path";
import { isMainThread } from "node:worker_threads";
import { safeLibraryPath } from "./library-files";
import { decodeFile, nodePrefix } from "./history-codec";
import { CoreError } from "./model";
import { BackgroundWorker } from "./background-worker";

export interface SqliteTreeEntry {
  path: string;
  oid: string;
  bytes?: number;
}
type Request = { session?: string } & (
  | { kind: "tree"; revision?: string }
  | { kind: "files"; revision?: string; paths: string[] }
  | { kind: "revisions"; revision?: string; paths: string[] }
  | { kind: "entry"; revision: string }
);
type SnapshotRequest = { open: true } | { close: string };
// Keep the bounded read cache warm between interactions, without preventing host exit.
const worker = new BackgroundWorker(0);
const trees = new Map<string, SqliteTreeEntry[]>();
const oid = (value: string) => /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(value);
export function sqliteResourcePath(path: string) {
  return path
    .replace(/^(projects\/[^/]+\/pages\/[^/]+)\/reader\.json$/, "$1.json")
    .replace(
      /^(projects\/[^/]+\/pages\/[^/]+)\/nodes\/[^/]+\.json$/,
      "$1.json",
    );
}
export function assertSqlitePath(path: string): string {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\x00-\x1f]/.test(path) ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !/^(projects\/|packages\/|assets\/|publications\/|imports\/|runtimes\/|sidebar\.json$)/.test(
      path,
    )
  )
    throw new CoreError(
      "INVALID_PATH",
      `Invalid library content path: ${path}`,
    );
  return path;
}

/**
 * Read transactions held open in the thread that runs reads. SQLite's WAL keeps
 * each one on the state it first read while saves from any process commit.
 */
const sessions = new Map<string, { db: DatabaseSync; home: string }>();
const activeSnapshot = new AsyncLocalStorage<{
  home: string;
  id: string;
  revision: string | null;
}>();

async function openDatabase(home: string) {
  const path = join(home, "history", "content.sqlite");
  await safeLibraryPath(home, path);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA busy_timeout=10000; BEGIN");
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
const headOf = (db: DatabaseSync) =>
  (db.prepare("SELECT value FROM metadata WHERE key='head'").get()?.value as
    string | undefined) ?? null;

export async function runSqliteSnapshot(
  home: string,
  request: SnapshotRequest,
) {
  if ("close" in request) {
    const session = sessions.get(request.close);
    sessions.delete(request.close);
    session?.db.close();
    return null;
  }
  const db = await openDatabase(home);
  try {
    // The first read starts the snapshot every later request in the session sees.
    const revision = headOf(db),
      id = randomUUID();
    sessions.set(id, { db, home });
    return { id, revision };
  } catch (error) {
    db.close();
    throw error;
  }
}
const snapshotCall = (home: string, request: SnapshotRequest) =>
  (isMainThread
    ? worker.invoke(home, "library:snapshot", request)
    : runSqliteSnapshot(home, request)) as Promise<{
    id: string;
    revision: string | null;
  } | null>;

/**
 * Run several reads against one committed library state without the writer
 * lease. Reads inside the action that name the pinned revision use the session.
 */
export async function withSqliteSnapshot<T>(
  home: string,
  action: (revision: string | null) => Promise<T>,
): Promise<T> {
  home = resolve(home);
  const opened = (await snapshotCall(home, { open: true }))!;
  try {
    return await activeSnapshot.run({ home, ...opened }, () =>
      action(opened.revision),
    );
  } finally {
    await snapshotCall(home, { close: opened.id });
  }
}

/** The read transaction the calling operation runs in for this library, if any. */
export function activeSqliteSnapshot(home: string) {
  const snapshot = activeSnapshot.getStore();
  return snapshot?.home === resolve(home) ? snapshot : undefined;
}

/** The stored record of a current or retained revision, as written. */
export function selectEntry(db: DatabaseSync, revision: string) {
  if (!oid(revision))
    throw new CoreError("INVALID_DATA", "Invalid history revision.");
  const table = (name: string) =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);
  if (table("current_state")) {
    const current = db
      .prepare(
        "SELECT revision,entry,checksum FROM current_state WHERE revision=?",
      )
      .get(revision);
    if (current)
      return current as { revision: string; entry: string; checksum: string };
    const resource = db
      .prepare(
        "SELECT revision,entry FROM current_resources WHERE revision=? LIMIT 1",
      )
      .get(revision);
    if (resource)
      return {
        revision: String(resource.revision),
        entry: String(resource.entry),
        checksum: createHash("sha256")
          .update(String(resource.entry))
          .digest("hex"),
      };
  }
  const retained = db
    .prepare("SELECT revision,entry,checksum FROM revisions WHERE revision=?")
    .get(revision);
  if (!retained)
    throw new CoreError(
      "NOT_FOUND",
      "The requested library revision is missing.",
    );
  return retained as { revision: string; entry: string; checksum: string };
}

/** Read requests pin one revision and database snapshot, including dependent assets. */
export async function readSqlite<T>(
  home: string,
  request: Request,
): Promise<T> {
  const snapshot = activeSnapshot.getStore();
  if (
    snapshot?.home === resolve(home) &&
    request.revision !== undefined &&
    request.revision === snapshot.revision
  )
    request = { ...request, session: snapshot.id };
  return isMainThread
    ? worker.invoke<T>(home, "library:read", request)
    : (runSqliteRead(home, request) as Promise<T>);
}
export async function runSqliteRead(home: string, request: Request) {
  if (request.revision !== undefined && !oid(request.revision))
    throw new CoreError("INVALID_DATA", "Invalid history revision.");
  if (request.kind === "files" || request.kind === "revisions")
    request.paths.forEach(assertSqlitePath);
  if (request.session) {
    const session = sessions.get(request.session);
    if (session?.home !== resolve(home))
      throw new CoreError(
        "NOT_FOUND",
        "The library read snapshot has already closed.",
      );
    return readWithin(session.db, home, request);
  }
  const db = await openDatabase(home);
  try {
    return await readWithin(db, home, request);
  } finally {
    // Read-only snapshot, so closing releases it on success and failure alike.
    db.close();
  }
}
async function readWithin(db: DatabaseSync, home: string, request: Request) {
  if (request.kind === "entry") return selectEntry(db, request.revision);
  // Resolving HEAD before queuing this worker races with current-state saves,
  // which intentionally remove superseded revisions. Pin HEAD in the same
  // read transaction as the requested content and dependent objects.
  const selected = request.revision ?? headOf(db) ?? undefined;
  if (!selected) {
    if (request.kind === "tree") return [];
    if (request.kind === "revisions")
      return new Map(request.paths.map((path) => [path, null]));
    throw new CoreError(
      "NOT_FOUND",
      "The requested library revision is missing.",
    );
  }
  const hasCurrentState = !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE name='current_state'")
    .get();
  const state = hasCurrentState
    ? db.prepare("SELECT revision FROM current_state WHERE id=1").get()
    : undefined;
  const stateCurrent = state?.revision === selected;
  const sequence = stateCurrent
    ? 1
    : db
        .prepare("SELECT sequence FROM revisions WHERE revision=?")
        .get(selected)?.sequence;
  if (!sequence)
    throw new CoreError(
      "NOT_FOUND",
      "The requested library revision is missing.",
    );
  const current =
    db.prepare("SELECT value FROM metadata WHERE key='head'").get()?.value ===
    selected;
  if (request.kind === "tree") {
    const key = `${home}:${selected}`;
    let tree = trees.get(key);
    if (!tree) {
      tree = (current
        ? db
            .prepare(
              "SELECT f.path,f.oid,b.bytes FROM current_files f JOIN blobs b ON b.oid=f.oid ORDER BY f.path",
            )
            .all()
        : db
            .prepare(
              "SELECT p.path,c.oid,b.bytes FROM paths p JOIN changes c ON c.path=p.path AND c.sequence=(SELECT c2.sequence FROM changes c2 WHERE c2.path=p.path AND c2.sequence<=? ORDER BY c2.sequence DESC LIMIT 1) JOIN blobs b ON b.oid=c.oid WHERE c.oid IS NOT NULL ORDER BY p.path",
            )
            .all(sequence)) as unknown as SqliteTreeEntry[];
      trees.set(key, tree);
      if (trees.size > 8) trees.delete(trees.keys().next().value!);
    }
    return tree.map((entry) => ({ ...entry }));
  }
  if (request.kind === "revisions" && stateCurrent) {
    const exact = db.prepare(
      "SELECT revision,sequence FROM current_resources WHERE path=?",
    );
    const children = db.prepare(
      "SELECT revision,sequence FROM current_resources WHERE path>=? AND path<? ORDER BY sequence DESC LIMIT 1",
    );
    return new Map(
      request.paths.map((path) => {
        const key = sqliteResourcePath(path);
        const a = exact.get(key),
          b = children.get(key + "/", key + "0");
        const latest = !a
          ? b
          : !b || Number(a.sequence) >= Number(b.sequence)
            ? a
            : b;
        return [path, latest ? String(latest.revision) : null];
      }),
    );
  }
  if (request.kind === "revisions") {
    const exact = db.prepare(
      "SELECT max(sequence) AS sequence FROM resource_changes WHERE path=? AND sequence<=?",
    );
    const children = db.prepare(
      "SELECT max(sequence) AS sequence FROM resource_changes WHERE path>=? AND path<? AND sequence<=?",
    );
    const revision = db.prepare(
      "SELECT revision FROM revisions WHERE sequence=?",
    );
    return new Map(
      request.paths.map((path) => {
        const key = sqliteResourcePath(path),
          prefix = `${key}/`;
        const latest = Math.max(
          Number(exact.get(key, sequence)?.sequence ?? 0),
          Number(children.get(prefix, `${key}0`, sequence)?.sequence ?? 0),
        );
        return [path, latest ? String(revision.get(latest)!.revision) : null];
      }),
    );
  }
  // Resolve only requested paths and page nodes, rather than enumerating the library.
  const exact = db.prepare(
    current
      ? "SELECT b.* FROM current_files f JOIN blobs b ON b.oid=f.oid WHERE f.path=?"
      : "SELECT b.* FROM changes c JOIN blobs b ON b.oid=c.oid WHERE c.path=? AND c.sequence=(SELECT max(sequence) FROM changes WHERE path=? AND sequence<=?)",
  );
  const objects = new Map<string, Buffer>();
  const unpack = (row: Record<string, unknown> | undefined, path: string) => {
    if (!row)
      throw new CoreError(
        "NOT_FOUND",
        `File missing in historical revision: ${path}`,
      );
    const id = String(row.oid);
    let bytes = objects.get(id);
    if (!bytes) {
      const data = row.data as Uint8Array;
      bytes = row.codec === 1 ? inflateRawSync(data) : Buffer.from(data);
      if (
        bytes.length !== row.bytes ||
        createHash("sha256").update(bytes).digest("hex") !== row.digest
      )
        throw new CoreError(
          "INVALID_DATA",
          "Stored content checksum mismatch. The workspace and original history remain retained.",
        );
      objects.set(id, bytes);
    }
    return bytes;
  };
  const byPath = new Map<string, Buffer>();
  for (const path of request.paths) {
    byPath.set(
      path,
      unpack(current ? exact.get(path) : exact.get(path, path, sequence), path),
    );
    if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)) {
      const prefix = nodePrefix(path),
        end = prefix.slice(0, -1) + "0";
      const rows = current
        ? db
            .prepare(
              "SELECT f.path,b.* FROM current_files f JOIN blobs b ON b.oid=f.oid WHERE f.path>=? AND f.path<?",
            )
            .all(prefix, end)
        : db
            .prepare(
              "SELECT p.path,b.* FROM paths p JOIN changes c ON c.path=p.path AND c.sequence=(SELECT max(sequence) FROM changes WHERE path=p.path AND sequence<=?) JOIN blobs b ON b.oid=c.oid WHERE p.path>=? AND p.path<?",
            )
            .all(sequence, prefix, end);
      for (const row of rows)
        byPath.set(String(row.path), unpack(row, String(row.path)));
    }
  }
  const read = async (path: string) => {
    assertSqlitePath(path);
    const cached = byPath.get(path);
    if (cached) return cached;
    const bytes = unpack(
      current ? exact.get(path) : exact.get(path, path, sequence),
      path,
    );
    byPath.set(path, bytes);
    return bytes;
  };
  return new Map(
    await Promise.all(
      request.paths.map(
        async (path) => [path, await decodeFile(path, read)] as const,
      ),
    ),
  );
}
