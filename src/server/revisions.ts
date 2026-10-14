import { CAPACITY } from "../portable/capacity.mjs";
import {
  canonical,
  digestId,
  hash,
  identifier,
  snapshotRevision,
  legacySyncProtocol,
  SyncError,
  type ProjectSnapshot,
} from "../sync/protocol";
import type { MetadataStore, ObjectStore } from "./storage";

export interface RevisionRow {
  revision: string;
  manifest: string;
  manifest_key: string | null;
  manifest_digest: string | null;
  manifest_bytes: number;
  sequence: number;
  published: number;
  source_user_id: string;
  source_user_name: string;
  received_at: string;
}
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export const manifestMaximum = CAPACITY.syncManifestBytes;
export function manifestKey(projectId: string, digest: string) {
  return `projects/${identifier(projectId)}/manifests/${digestId(digest)}`;
}
/** Verified manifests kept in memory; a revision's manifest never changes. */
const parsedBudget = 32 * 1024 * 1024;
export class Revisions {
  private parsed = new Map<
    string,
    { snapshot: ProjectSnapshot; bytes: number }
  >();
  private parsedBytes = 0;
  constructor(
    readonly db: MetadataStore,
    readonly objects: ObjectStore,
  ) {}
  /** Callers treat cached snapshots as immutable. */
  remember(
    projectId: string,
    revision: string,
    snapshot: ProjectSnapshot,
    bytes: number,
  ) {
    const key = `${projectId}:${revision}`;
    if (bytes > parsedBudget / 2 || this.parsed.has(key)) return;
    this.parsed.set(key, { snapshot, bytes });
    this.parsedBytes += bytes;
    for (const [oldest, entry] of this.parsed) {
      if (this.parsedBytes <= parsedBudget) break;
      this.parsed.delete(oldest);
      this.parsedBytes -= entry.bytes;
    }
  }
  /** The verified manifest of a project's current head, when it is readable. */
  async current(projectId: string, head: string | null) {
    if (!head) return undefined;
    const row = await this.row(projectId, head);
    return row ? this.snapshot(projectId, row) : undefined;
  }
  /** Existing records are retained as a frozen archive; new publications replace state. */
  async activateCurrent(projectId: string) {
    await this.db.run(
      "INSERT OR IGNORE INTO settings(key,value) SELECT ?,CAST(COALESCE(MAX(sequence),0) AS TEXT) FROM revisions WHERE project_id=?",
      [`current-state-boundary:${projectId}`, projectId],
    );
  }
  async retainCurrent(projectId: string, revision: string) {
    const boundary = Number(
      (
        await this.db.all<{ value: string }>(
          "SELECT value FROM settings WHERE key=?",
          [`current-state-boundary:${projectId}`],
        )
      )[0].value,
    );
    const obsolete = await this.db.all<{ manifest_key: string }>(
      "SELECT manifest_key FROM revisions WHERE project_id=? AND published=1 AND sequence>? AND revision<>? AND revision<>(SELECT head FROM projects WHERE id=?)",
      [projectId, boundary, revision, projectId],
    );
    await this.db.run(
      "DELETE FROM revisions WHERE project_id=? AND published=1 AND sequence>? AND revision<>? AND revision<>(SELECT head FROM projects WHERE id=?)",
      [projectId, boundary, revision, projectId],
    );
    for (const row of obsolete) {
      if (
        row.manifest_key &&
        !(
          await this.db.all(
            "SELECT 1 FROM revisions WHERE manifest_key=? UNION ALL SELECT 1 FROM storage_reservations WHERE digest=? LIMIT 1",
            [row.manifest_key, row.manifest_key.split("/").at(-1)!],
          )
        ).length
      )
        await this.objects.remove(row.manifest_key);
    }
  }
  async prepare(
    projectId: string,
    snapshot: ProjectSnapshot,
    known?: { serialized: string; digest: string },
  ) {
    const serialized = known?.serialized ?? canonical(snapshot),
      bytes = encoder.encode(serialized);
    if (bytes.byteLength > manifestMaximum)
      throw new SyncError(
        413,
        "TOO_LARGE",
        "The project manifest exceeds 16 MiB.",
      );
    const digest = known?.digest ?? (await hash(bytes)),
      key = manifestKey(projectId, digest);
    return { key, digest, bytes: bytes.byteLength, content: bytes };
  }
  async store(projectId: string, snapshot: ProjectSnapshot) {
    const prepared = await this.prepare(projectId, snapshot);
    await this.objects.put(prepared.key, prepared.content);
    return prepared;
  }
  async row(
    projectId: string,
    revision: string,
  ): Promise<RevisionRow | undefined> {
    return (
      await this.db.all<RevisionRow>(
        "SELECT r.*,u.id AS source_user_id,u.name AS source_user_name,r.created_at AS received_at FROM revisions r JOIN users u ON u.id=r.user_id WHERE r.project_id=? AND r.revision=?",
        [projectId, digestId(revision)],
      )
    )[0];
  }
  async snapshot(
    projectId: string,
    row: RevisionRow,
  ): Promise<ProjectSnapshot> {
    const cached = this.parsed.get(`${projectId}:${row.revision}`);
    if (cached) return cached.snapshot;
    let serialized = row.manifest;
    if (row.manifest_key) {
      if (
        !row.manifest_digest ||
        row.manifest_key !== manifestKey(projectId, row.manifest_digest) ||
        row.manifest_bytes > manifestMaximum
      )
        throw new SyncError(
          500,
          "CORRUPT_MANIFEST",
          "Invalid project manifest pointer.",
        );
      const bytes = await this.objects.get(row.manifest_key);
      if (
        !bytes ||
        bytes.byteLength !== row.manifest_bytes ||
        (await hash(bytes)) !== row.manifest_digest
      )
        throw new SyncError(
          500,
          "CORRUPT_MANIFEST",
          "Project manifest failed integrity verification.",
        );
      serialized = decoder.decode(bytes);
    }
    const snapshot = JSON.parse(serialized) as ProjectSnapshot;
    if (
      snapshot.projectId !== projectId ||
      ((await snapshotRevision(snapshot)) !== row.revision &&
        !(
          snapshot.format === legacySyncProtocol &&
          (await hash(JSON.stringify(snapshot))) === row.revision
        ))
    )
      throw new SyncError(
        500,
        "CORRUPT_MANIFEST",
        "Project manifest identity does not match.",
      );
    this.remember(projectId, row.revision, snapshot, row.manifest_bytes);
    return snapshot;
  }
  summary(row: RevisionRow) {
    return {
      revision: row.revision,
      published: !!row.published,
      sequence: row.sequence,
      manifestBytes: row.manifest_bytes,
      source: {
        user: { id: row.source_user_id, name: row.source_user_name },
        receivedAt: row.received_at,
      },
    };
  }
  async record(projectId: string, row: RevisionRow) {
    return {
      ...this.summary(row),
      snapshot: await this.snapshot(projectId, row),
    };
  }
  /** Explicit, restartable conversion; inline bytes remain available for rollback. */
  async migrateInline(projectId?: string, maximum = 100) {
    const rows = await this.db.all<RevisionRow & { project_id: string }>(
      `SELECT r.*,u.id AS source_user_id,u.name AS source_user_name,r.created_at AS received_at FROM revisions r JOIN users u ON u.id=r.user_id WHERE r.manifest_key IS NULL${projectId ? " AND r.project_id=?" : ""} ORDER BY r.sequence LIMIT ?`,
      projectId ? [identifier(projectId), maximum] : [maximum],
    );
    let migrated = 0;
    for (const row of rows) {
      await this.snapshot(row.project_id, row);
      const bytes = encoder.encode(row.manifest),
        digest = await hash(bytes),
        key = manifestKey(row.project_id, digest);
      await this.objects.put(key, bytes);
      if (
        !(await this.objects
          .get(key)
          .then(async (stored) => !!stored && (await hash(stored)) === digest))
      )
        throw new Error("Manifest migration object verification failed.");
      const result = await this.db.run(
        "UPDATE revisions SET manifest_key=?,manifest_digest=?,manifest_bytes=? WHERE project_id=? AND revision=? AND manifest_key IS NULL AND manifest=?",
        [
          key,
          digest,
          bytes.byteLength,
          row.project_id,
          row.revision,
          row.manifest,
        ],
      );
      migrated += result.changes;
    }
    return { inspected: rows.length, migrated, more: rows.length === maximum };
  }
}
