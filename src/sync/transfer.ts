import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { GitLibrary } from "../core/git-library";
import { LibraryOperations } from "../core/library-operations";
import { encodeFile, decodeFile } from "../core/history-codec";
import type {
  HistoryEntry,
  FileChanges,
  ChangeContext,
} from "../core/history-model";
import { CoreError } from "../core/model";
import { canonicalJson } from "../core/diff";
import { previewPageMerge } from "../core/page-merge";
import { parseArtifact, serializeArtifact } from "../portable/validation.mjs";
import {
  syncProtocol,
  legacySyncProtocol,
  snapshotRevision,
  validateSnapshot,
  type ProjectSnapshot,
  type SnapshotRecord,
} from "./protocol";

export interface CapturedSnapshot extends SnapshotRecord {
  objects: Map<string, Buffer>;
  localRevision: string;
}
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function remapProjectFiles(
  files: Map<string, Buffer>,
  from: string,
  to: string,
) {
  if (from === to) return files;
  const result = new Map<string, Buffer>(),
    prefix = `projects/${from}/`;
  for (const [path, bytes] of files) {
    const target = path.startsWith(prefix)
      ? `projects/${to}/${path.slice(prefix.length)}`
      : path;
    if (path === `${prefix}project.json`) {
      const metadata = JSON.parse(bytes.toString());
      metadata.id = to;
      result.set(target, Buffer.from(JSON.stringify(metadata, null, 2) + "\n"));
    } else if (
      path.startsWith(`${prefix}history/imports/`) &&
      path.endsWith("/manifest.json")
    ) {
      const descriptor = JSON.parse(bytes.toString());
      descriptor.snapshots = descriptor.snapshots.map(
        (snapshot: { projectId: string; path?: string }) => ({
          ...snapshot,
          projectId: to,
          ...(snapshot.path
            ? { path: snapshot.path.replace(prefix, `projects/${to}/`) }
            : {}),
        }),
      );
      result.set(target, Buffer.from(JSON.stringify(descriptor, null, 2)));
    } else result.set(target, bytes);
  }
  return result;
}
export async function captureProject(
  home: string,
  projectId: string,
  entry: HistoryEntry,
  parents: string[],
  remoteProjectId = projectId,
): Promise<CapturedSnapshot> {
  const logical = remapProjectFiles(
    await new LibraryOperations(home, projectId).projectFiles(
      projectId,
      entry.revision,
    ),
    projectId,
    remoteProjectId,
  );
  const files: Record<string, string> = {},
    objects = new Map<string, Buffer>();
  for (const [path, bytes] of logical)
    for (const [name, content] of encodeFile(path, bytes)) {
      if (!content) continue;
      const id = digest(content);
      files[name] = id;
      objects.set(id, content);
    }
  const prefix = `projects/${projectId}/`;
  const snapshot: ProjectSnapshot = {
    format: syncProtocol,
    projectId: remoteProjectId,
    parents,
    files,
    change: {
      at: entry.at,
      actor: entry.actor,
      channel: entry.channel,
      operationId: entry.operationId,
      sourceRevision: entry.syncOrigin?.sourceRevision ?? entry.revision,
      ...(entry.message ? { message: entry.message } : {}),
      ...(entry.restoredFrom ? { restoredFrom: entry.restoredFrom } : {}),
      ...(entry.mergedFrom ? { mergedFrom: entry.mergedFrom } : {}),
      paths: entry.paths
        .filter((path) => path.startsWith(prefix) && !path.includes("/.sync/"))
        .map(
          (path) => `projects/${remoteProjectId}/${path.slice(prefix.length)}`,
        ),
    },
  };
  return {
    snapshot,
    revision: await snapshotRevision(snapshot),
    objects,
    localRevision: entry.revision,
  };
}
export async function decodeSnapshot(
  record: SnapshotRecord,
  readObject: (id: string) => Promise<Buffer>,
): Promise<Map<string, Buffer>> {
  validateSnapshot(record.snapshot, record.snapshot.projectId);
  if (!(await validSnapshotRecord(record)))
    throw new CoreError(
      "INVALID_DATA",
      "Project snapshot failed integrity verification.",
    );
  const read = async (path: string) => {
    const id = record.snapshot.files[path];
    if (!id)
      throw new CoreError(
        "NOT_FOUND",
        `Project dependency is missing: ${path}`,
      );
    const bytes = await readObject(id);
    if (digest(bytes) !== id)
      throw new CoreError("INVALID_DATA", `Corrupt synchronized object: ${id}`);
    return bytes;
  };
  const files = new Map<string, Buffer>();
  for (const path of Object.keys(record.snapshot.files)) {
    if (/\/pages\/[^/]+\/nodes\//.test(path) || path.startsWith("assets/"))
      continue;
    files.set(path, await decodeFile(path, read));
  }
  return files;
}
export async function validSnapshotRecord(record: SnapshotRecord) {
  if ((await snapshotRevision(record.snapshot)) === record.revision)
    return true;
  // V1 manifests retain the original server serialization order, including its locale.
  return (
    record.snapshot.format === legacySyncProtocol &&
    digest(Buffer.from(JSON.stringify(record.snapshot))) === record.revision
  );
}
export interface FileConflict {
  path: string;
  base: string | null;
  local: string | null;
  remote: string | null;
}
export function mergeProjectFiles(
  base: Map<string, Buffer>,
  local: Map<string, Buffer>,
  remote: Map<string, Buffer>,
) {
  const merged = new Map<string, Buffer>(),
    conflicts: FileConflict[] = [];
  const equal = (a?: Buffer, b?: Buffer) =>
    a === undefined ? b === undefined : b !== undefined && a.equals(b);
  for (const path of new Set([
    ...base.keys(),
    ...local.keys(),
    ...remote.keys(),
  ])) {
    const a = base.get(path),
      b = local.get(path),
      c = remote.get(path);
    if (equal(b, c) || equal(a, c)) {
      if (b) merged.set(path, b);
      continue;
    }
    if (equal(a, b)) {
      if (c) merged.set(path, c);
      continue;
    }
    if (a && b && c && /^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path)) {
      const preview = previewPageMerge(
        parseArtifact(JSON.parse(a.toString())).document,
        parseArtifact(JSON.parse(b.toString())).document,
        parseArtifact(JSON.parse(c.toString())).document,
      );
      if (!preview.conflicts.length) {
        merged.set(path, Buffer.from(serializeArtifact(preview.document)));
        continue;
      }
    }
    if (a && b && c && /\/project\.json$/.test(path)) {
      const original = JSON.parse(a.toString()) as Record<string, unknown>,
        ours = JSON.parse(b.toString()) as Record<string, unknown>,
        theirs = JSON.parse(c.toString()) as Record<string, unknown>;
      const result: Record<string, unknown> = {};
      let conflict = false;
      for (const key of new Set([
        ...Object.keys(original),
        ...Object.keys(ours),
        ...Object.keys(theirs),
      ])) {
        if (
          ["updatedAt", "sourceDirectory", "binding", "bindings"].includes(key)
        ) {
          result[key] =
            key === "updatedAt"
              ? [ours[key], theirs[key]].filter(Boolean).sort().at(-1)
              : ours[key];
          continue;
        }
        const baseline = canonicalJson(original[key] ?? null),
          one = canonicalJson(ours[key] ?? null),
          two = canonicalJson(theirs[key] ?? null);
        if (one === two || baseline === two) result[key] = ours[key];
        else if (baseline === one) result[key] = theirs[key];
        else conflict = true;
      }
      if (!conflict) {
        merged.set(path, Buffer.from(JSON.stringify(result, null, 2) + "\n"));
        continue;
      }
    }
    // Immutable dependency depots can coexist; a differing same-path package is a real conflict.
    conflicts.push({
      path,
      base: a?.toString("base64") ?? null,
      local: b?.toString("base64") ?? null,
      remote: c?.toString("base64") ?? null,
    });
    if (b) merged.set(path, b);
  }
  return { files: merged, conflicts };
}
export async function projectHistory(
  home: string,
  projectId: string,
  after: string | null,
  includeImported = false,
) {
  const library = new GitLibrary(home),
    entries: HistoryEntry[] = [];
  let before: string | undefined;
  while (true) {
    const batch = await library.history({ projectId, before, limit: 1000 });
    let stopped = false;
    for (const entry of batch) {
      if (entry.revision === after) {
        stopped = true;
        break;
      }
      if (
        (includeImported || !entry.syncOrigin) &&
        entry.paths.some(
          (path) =>
            path.startsWith(`projects/${projectId}/`) &&
            !path.includes("/.sync/"),
        )
      )
        entries.push(entry);
    }
    if (stopped || batch.length < 1000) break;
    before = batch.at(-1)!.revision;
  }
  return entries.reverse();
}
/** Original times/actors and remote graph identities survive replay into a shared local library. */
export async function importProjectHistory(
  home: string,
  projectId: string,
  serverId: string,
  entries:
    | Iterable<{ record: SnapshotRecord; files: Map<string, Buffer> }>
    | AsyncIterable<{ record: SnapshotRecord; files: Map<string, Buffer> }>,
  finalFiles: Map<string, Buffer>,
  expectedHead: string | null,
) {
  const library = new GitLibrary(home),
    prefix = `projects/${projectId}/`;
  const paths = (await library.tree(expectedHead ?? undefined))
    .map((entry) => entry.path)
    .filter(
      (path) =>
        path.startsWith(prefix) &&
        !/\/pages\/[^/]+\/nodes\//.test(path) &&
        !path.includes("/.sync/"),
    );
  const current = paths.length
    ? await library.readFiles(paths, expectedHead ?? undefined)
    : new Map<string, Buffer>();
  const ownMetadata = current.get(`${prefix}project.json`);
  const localBindings = ownMetadata ? JSON.parse(ownMetadata.toString()) : {};
  const imported = new Set(
    (await library.tree(expectedHead ?? undefined)).map((entry) => entry.path),
  );
  async function* replay(): AsyncGenerator<{
    changes: FileChanges;
    context: ChangeContext;
  }> {
    let previous = current;
    let latest: SnapshotRecord | undefined;
    for await (const { record, files } of entries) {
      latest = record;
      if (imported.has(`${prefix}.sync/versions/${record.revision}.json`)) {
        previous = files;
        continue;
      }
      const changes: FileChanges = new Map();
      for (const path of previous.keys())
        if (path.startsWith(prefix) && !files.has(path))
          changes.set(path, null);
      for (const [path, bytes] of files) {
        if (path === `${prefix}project.json`) {
          const metadata = JSON.parse(bytes.toString());
          for (const key of ["sourceDirectory", "binding", "bindings"])
            if (localBindings[key] !== undefined)
              metadata[key] = localBindings[key];
          changes.set(
            path,
            Buffer.from(JSON.stringify(metadata, null, 2) + "\n"),
          );
        } else changes.set(path, bytes);
      }
      changes.set(
        `${prefix}.sync/versions/${record.revision}.json`,
        Buffer.from(
          JSON.stringify({
            serverId,
            revision: record.revision,
            sourceRevision: record.snapshot.change.sourceRevision,
            parents: record.snapshot.parents,
          }),
        ),
      );
      const change = record.snapshot.change;
      yield {
        changes,
        context: {
          actor: change.actor,
          channel: change.channel,
          message: change.message ?? "同步项目历史",
          operationId: `sync:${serverId}:${projectId}:${record.revision}`,
          syncOrigin: {
            serverId,
            projectId: record.snapshot.projectId,
            revision: record.revision,
            parents: record.snapshot.parents,
            at: change.at,
            sourceRevision: change.sourceRevision,
            restoredFrom: change.restoredFrom,
            mergedFrom: change.mergedFrom,
          },
        },
      };
      previous = files;
    }
    if (latest && !sameFiles(previous, finalFiles)) {
      const changes: FileChanges = new Map([...finalFiles]);
      const metadataPath = `${prefix}project.json`,
        metadataBytes = changes.get(metadataPath);
      if (metadataBytes) {
        const metadata = JSON.parse(metadataBytes.toString());
        for (const key of ["sourceDirectory", "binding", "bindings"])
          if (localBindings[key] !== undefined)
            metadata[key] = localBindings[key];
        changes.set(
          metadataPath,
          Buffer.from(JSON.stringify(metadata, null, 2) + "\n"),
        );
      }
      for (const path of previous.keys())
        if (path.startsWith(prefix) && !finalFiles.has(path))
          changes.set(path, null);
      yield {
        changes,
        context: {
          actor: { kind: "system" },
          channel: "system",
          message: "合并同步内容并保留本地修改",
          operationId: `sync-merge:${crypto.randomUUID()}`,
          syncOrigin: {
            serverId,
            projectId,
            revision: latest.revision,
            parents: latest.snapshot.parents,
            at: new Date().toISOString(),
          },
        },
      };
    }
  }
  return library.replayImported(replay(), expectedHead);
}
export function sameFiles(one: Map<string, Buffer>, two: Map<string, Buffer>) {
  return (
    one.size === two.size &&
    [...one].every(([path, bytes]) => two.get(path)?.equals(bytes))
  );
}
