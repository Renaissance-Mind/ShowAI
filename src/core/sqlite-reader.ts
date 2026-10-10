import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { join } from "node:path";
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
type Request =
  | { kind: "tree"; revision: string }
  | { kind: "files"; revision: string; paths: string[] }
  | { kind: "revisions"; revision: string; paths: string[] };
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

/** Read requests pin one revision and database snapshot, including dependent assets. */
export async function readSqlite<T>(
  home: string,
  request: Request,
): Promise<T> {
  return isMainThread
    ? worker.invoke<T>(home, "library:read", request)
    : (runSqliteRead(home, request) as Promise<T>);
}
export async function runSqliteRead(home: string, request: Request) {
  if (!oid(request.revision))
    throw new CoreError("INVALID_DATA", "Invalid history revision.");
  if (request.kind !== "tree") request.paths.forEach(assertSqlitePath);
  const path = join(home, "history", "content.sqlite");
  await safeLibraryPath(home, path);
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA busy_timeout=10000; BEGIN");
  try {
    const sequence = db
      .prepare("SELECT sequence FROM revisions WHERE revision=?")
      .get(request.revision)?.sequence;
    if (!sequence)
      throw new CoreError(
        "NOT_FOUND",
        "The requested library revision is missing.",
      );
    const current =
      db.prepare("SELECT value FROM metadata WHERE key='head'").get()?.value ===
      request.revision;
    if (request.kind === "tree") {
      const key = `${home}:${request.revision}`;
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
        unpack(
          current ? exact.get(path) : exact.get(path, path, sequence),
          path,
        ),
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
  } finally {
    // Read-only snapshot, so rollback releases it on success and failure alike.
    db.close();
  }
}
