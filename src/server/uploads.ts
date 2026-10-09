import { digestId, identifier, SyncError } from "../sync/protocol";
import type { MetadataStore, ObjectStore, SqlStatement } from "./storage";
import { Quotas } from "./quotas";

export const uploadPartBytes = 5 * 1024 * 1024;
interface Upload {
  id: string;
  project_id: string;
  user_id: string;
  digest: string;
  bytes: number;
  reservation_id: string;
  completed: number;
}
interface Part {
  part_index: number;
  digest: string;
  bytes: number;
}
function partKey(projectId: string, uploadId: string, digest: string) {
  return `projects/${identifier(projectId)}/uploads/${identifier(uploadId)}/parts/${digestId(digest)}`;
}
export class Uploads {
  constructor(
    readonly db: MetadataStore,
    readonly objects: ObjectStore,
    readonly quotas: Quotas,
  ) {}
  async find(projectId: string, userId: string, id: string): Promise<Upload> {
    const row = (
      await this.db.all<Upload>(
        "SELECT * FROM object_uploads WHERE id=? AND project_id=? AND user_id=?",
        [identifier(id), projectId, userId],
      )
    )[0];
    if (!row)
      throw new SyncError(
        404,
        "MISSING_UPLOAD",
        "Upload is unavailable for this account and project.",
      );
    return row;
  }
  async status(upload: Upload) {
    const parts = await this.db.all<Part>(
      "SELECT part_index,digest,bytes FROM object_upload_parts WHERE upload_id=? ORDER BY part_index",
      [upload.id],
    );
    return {
      id: upload.id,
      digest: upload.digest,
      bytes: upload.bytes,
      partBytes: uploadPartBytes,
      completed: !!upload.completed,
      parts,
    };
  }
  async begin(
    projectId: string,
    userId: string,
    digest: unknown,
    bytes: unknown,
    permission: SqlStatement,
  ) {
    const name = digestId(digest),
      size = Number(bytes);
    if (!Number.isSafeInteger(size) || size < 0 || size > 64 * 1024 * 1024)
      throw new SyncError(
        413,
        "TOO_LARGE",
        "Object size must be between 0 and 64 MiB.",
      );
    const ready = (
      await this.db.all<{ bytes: number }>(
        "SELECT bytes FROM objects WHERE project_id=? AND digest=?",
        [projectId, name],
      )
    )[0];
    if (ready) {
      if (ready.bytes !== size)
        throw new SyncError(
          400,
          "INVALID_SIZE",
          "Existing object size differs.",
        );
      return {
        completed: true,
        digest: name,
        bytes: size,
        id: null,
        parts: [],
        partBytes: uploadPartBytes,
      };
    }
    const previous = (
      await this.db.all<Upload>(
        "SELECT * FROM object_uploads WHERE project_id=? AND user_id=? AND digest=?",
        [projectId, userId, name],
      )
    )[0];
    if (previous) {
      if (previous.bytes !== size)
        throw new SyncError(
          409,
          "INVALID_SIZE",
          "Resume with the original object size.",
        );
      return this.status(previous);
    }
    const reservation = await this.quotas.reserve(
      projectId,
      userId,
      "object",
      name,
      size,
      permission,
    );
    if (!reservation)
      return {
        completed: true,
        digest: name,
        bytes: size,
        id: null,
        parts: [],
        partBytes: uploadPartBytes,
      };
    const id = crypto.randomUUID();
    const inserted = await this.db.run(
      `INSERT INTO object_uploads(id,project_id,user_id,digest,bytes,reservation_id,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${permission.sql})`,
      [
        id,
        projectId,
        userId,
        name,
        size,
        reservation.id,
        new Date().toISOString(),
        ...permission.values!,
      ],
    );
    if (!inserted.changes) {
      await this.quotas.release(reservation);
      throw new SyncError(403, "FORBIDDEN", "Upload permission was revoked.");
    }
    return this.status(await this.find(projectId, userId, id));
  }
  async putPart(
    upload: Upload,
    index: number,
    digest: unknown,
    body: ReadableStream<Uint8Array>,
    permission: SqlStatement,
  ) {
    const name = digestId(digest),
      count = Math.max(1, Math.ceil(upload.bytes / uploadPartBytes));
    if (
      upload.completed ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= count
    )
      throw new SyncError(400, "INVALID_PART", "Invalid upload part.");
    const size =
      index === count - 1
        ? upload.bytes - uploadPartBytes * index
        : uploadPartBytes;
    const existing = (
      await this.db.all<Part>(
        "SELECT * FROM object_upload_parts WHERE upload_id=? AND part_index=?",
        [upload.id, index],
      )
    )[0];
    if (existing) {
      if (existing.digest !== name)
        throw new SyncError(
          409,
          "PART_CONFLICT",
          "An immutable part already has different content.",
        );
      const reader = body.getReader();
      await reader.cancel();
      reader.releaseLock();
      return { ok: true, alreadyPresent: true };
    }
    const received = await this.objects.putVerified(
      partKey(upload.project_id, upload.id, name),
      body,
      name,
      size,
    );
    if (received !== size)
      throw new SyncError(
        400,
        "INVALID_SIZE",
        "Part length does not match its position.",
      );
    await this.db.run(
      `INSERT OR IGNORE INTO object_upload_parts(upload_id,part_index,digest,bytes) SELECT ?,?,?,? WHERE EXISTS(${permission.sql}) AND EXISTS(SELECT 1 FROM object_uploads WHERE id=? AND completed=0)`,
      [upload.id, index, name, size, ...permission.values!, upload.id],
    );
    const current = (
      await this.db.all<Part>(
        "SELECT * FROM object_upload_parts WHERE upload_id=? AND part_index=?",
        [upload.id, index],
      )
    )[0];
    if (!current)
      throw new SyncError(
        403,
        "FORBIDDEN",
        "Part publication permission was revoked.",
      );
    if (current.digest !== name)
      throw new SyncError(
        409,
        "PART_CONFLICT",
        "Another upload supplied this part first.",
      );
    return { ok: true };
  }
  async complete(upload: Upload, permission: SqlStatement) {
    if (upload.completed)
      return { ok: true, digest: upload.digest, alreadyPresent: true };
    const parts = await this.db.all<Part>(
      "SELECT * FROM object_upload_parts WHERE upload_id=? ORDER BY part_index",
      [upload.id],
    );
    const count = Math.max(1, Math.ceil(upload.bytes / uploadPartBytes));
    if (
      parts.length !== count ||
      parts.some((part, index) => part.part_index !== index) ||
      parts.reduce((sum, part) => sum + part.bytes, 0) !== upload.bytes
    )
      throw new SyncError(
        409,
        "MISSING_PARTS",
        "Complete every upload part before publishing.",
      );
    const store = this.objects,
      projectId = upload.project_id,
      uploadId = upload.id;
    let index = 0,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (true) {
          if (!reader) {
            if (index === parts.length) {
              controller.close();
              return;
            }
            const opened = await store.open(
              partKey(projectId, uploadId, parts[index].digest),
            );
            if (!opened || opened.bytes !== parts[index].bytes)
              throw new SyncError(
                409,
                "MISSING_PARTS",
                "A retained part is missing or has a different size.",
              );
            reader = opened.body.getReader();
          }
          const { value, done } = await reader.read();
          if (done) {
            reader.releaseLock();
            reader = undefined;
            index++;
            continue;
          }
          controller.enqueue(value);
          return;
        }
      },
      async cancel(reason) {
        if (reader) {
          await reader.cancel(reason);
          reader.releaseLock();
          reader = undefined;
        }
      },
    });
    const key = `projects/${projectId}/objects/${upload.digest}`;
    const actual = await store.putVerified(
      key,
      body,
      upload.digest,
      upload.bytes,
    );
    if (actual !== upload.bytes)
      throw new SyncError(400, "INVALID_SIZE", "Final object length differs.");
    await this.db.batch([
      {
        sql: `INSERT OR IGNORE INTO objects(project_id,digest,bytes,uploaded_by,uploaded_at) SELECT ?,?,?,?,? WHERE EXISTS(${permission.sql}) AND EXISTS(SELECT 1 FROM storage_reservations WHERE id=? AND bytes>=?)`,
        values: [
          projectId,
          upload.digest,
          actual,
          upload.user_id,
          new Date().toISOString(),
          ...permission.values!,
          upload.reservation_id,
          actual,
        ],
      },
      {
        sql: "UPDATE object_uploads SET completed=1 WHERE id=? AND EXISTS(SELECT 1 FROM objects WHERE project_id=? AND digest=?)",
        values: [upload.id, projectId, upload.digest],
      },
      {
        sql: "DELETE FROM storage_reservations WHERE id=? AND EXISTS(SELECT 1 FROM objects WHERE project_id=? AND digest=?)",
        values: [upload.reservation_id, projectId, upload.digest],
      },
    ]);
    if (!(await this.find(projectId, upload.user_id, upload.id)).completed)
      throw new SyncError(
        403,
        "FORBIDDEN",
        "Final publication permission or reservation is unavailable.",
      );
    // These parts are request-owned transaction artifacts; published objects remain immutable.
    for (const part of parts)
      await store.remove(partKey(projectId, uploadId, part.digest));
    await this.db.run("DELETE FROM object_upload_parts WHERE upload_id=?", [
      upload.id,
    ]);
    return { ok: true, digest: upload.digest };
  }
}
