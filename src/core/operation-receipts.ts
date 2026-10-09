import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { CoreError } from "./model";
import { safeLibraryPath } from "./library-files";
import type { ContentLibrary as GitLibrary } from "./content-library";
import type { HistoryEntry } from "./history-model";
const key = (operationId: string) =>
  createHash("sha256").update(operationId).digest("hex");

/** Rebuildable operation lookup; the committed change remains the source of truth. */
export class OperationReceipts {
  readonly path: string;
  constructor(
    readonly library: Pick<
      GitLibrary,
      "root" | "head" | "history" | "isAncestor" | "entryAt"
    >,
  ) {
    this.path = join(library.root, "local", "operation-index.sqlite");
  }
  private async database() {
    await safeLibraryPath(this.library.root, this.path);
    const db = new DatabaseSync(this.path);
    db.exec(
      "PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, revision TEXT NOT NULL); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    );
    return db;
  }
  async record(entry: HistoryEntry) {
    const db = await this.database();
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("INSERT OR REPLACE INTO operations VALUES(?,?)").run(
        key(entry.operationId),
        entry.revision,
      );
      db.prepare("INSERT OR REPLACE INTO metadata VALUES('revision',?)").run(
        entry.revision,
      );
      db.exec("COMMIT");
    } finally {
      db.close();
    }
  }
  async lookup(operationId: string): Promise<HistoryEntry | undefined> {
    const db = await this.database();
    try {
      const head = await this.library.head(),
        indexed = db
          .prepare("SELECT value FROM metadata WHERE key='revision'")
          .get()?.value;
      if (head && indexed !== head) {
        const incremental =
          typeof indexed === "string" &&
          !!indexed &&
          (await this.library.isAncestor(indexed, head));
        const entries: HistoryEntry[] = [];
        let before: string | undefined;
        while (true) {
          const batch = await this.library.history({
            revision: head,
            before,
            limit: 1000,
          });
          const boundary = incremental
            ? batch.findIndex((item) => item.revision === indexed)
            : -1;
          entries.push(...(boundary < 0 ? batch : batch.slice(0, boundary)));
          if (boundary >= 0 || batch.length < 1000) break;
          before = batch.at(-1)!.revision;
        }
        db.exec("BEGIN IMMEDIATE");
        if (!incremental) db.exec("DELETE FROM operations");
        const insert = db.prepare(
          "INSERT OR REPLACE INTO operations VALUES(?,?)",
        );
        for (const entry of entries.reverse())
          insert.run(key(entry.operationId), entry.revision);
        db.prepare("INSERT OR REPLACE INTO metadata VALUES('revision',?)").run(
          head,
        );
        db.exec("COMMIT");
      }
      const revision = db
        .prepare("SELECT revision FROM operations WHERE id=?")
        .get(key(operationId))?.revision;
      if (typeof revision !== "string") return undefined;
      const entry = await this.library.entryAt(revision);
      if (entry.operationId !== operationId)
        throw new CoreError(
          "INVALID_DATA",
          "The operation cache differs from its committed change.",
        );
      return entry;
    } finally {
      db.close();
    }
  }
}
