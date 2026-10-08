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
export const manifestMaximum = 16 * 1024 * 1024;
export function manifestKey(projectId: string, digest: string) {
  return `projects/${identifier(projectId)}/manifests/${digestId(digest)}`;
}
export class Revisions {
  constructor(
    readonly db: MetadataStore,
    readonly objects: ObjectStore,
  ) {}
  async store(projectId: string, snapshot: ProjectSnapshot) {
    const serialized = canonical(snapshot),
      bytes = encoder.encode(serialized);
    if (bytes.byteLength > manifestMaximum)
      throw new SyncError(
        413,
        "TOO_LARGE",
        "The project manifest exceeds 16 MiB.",
      );
    const digest = await hash(bytes),
      key = manifestKey(projectId, digest);
    await this.objects.put(key, bytes);
    return { key, digest, bytes: bytes.byteLength };
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
