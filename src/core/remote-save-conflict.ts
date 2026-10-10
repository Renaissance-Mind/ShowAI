import { ReadBaselines } from "./read-baselines";
import { FileStore } from "./store";
import { versionedLibrary, writeLibraryFiles } from "./library-runtime";
import { EditorDrafts } from "./editor-drafts";
import { documentHash } from "./diff";
import { LibraryOperations } from "./library-operations";
import { readLibraryBytes } from "./library-files";
import { join } from "node:path";
import { CoreError, type PageRecord } from "./model";
import type { ShowDocument } from "../types";
import type { SyncConfiguration } from "../sync/protocol";
import { previewPageMerge } from "./page-merge";
import { retainSyncConflicts } from "../sync/conflict-retention";
import { serializeArtifact } from "../portable/validation.mjs";

export async function remoteSaveOrigin(
  home: string,
  projectId: string,
  current: PageRecord,
) {
  const library = versionedLibrary(home);
  if (!library || !current.revision) return null;
  const entry = await library.entryAt(current.revision),
    origin = entry.syncOrigin;
  if (!origin) return null;
  const bytes = await readLibraryBytes(
    home,
    join(home, "local", "sync", "config.json"),
  );
  if (!bytes) return null;
  const config = JSON.parse(bytes.toString()) as SyncConfiguration;
  const binding = config.projects.find((item) => item.projectId === projectId);
  const connection = config.connections.find(
    (item) => item.id === binding?.connectionId,
  );
  if (!connection || origin.serverId !== connection.serverId) return null;
  const foreign = origin.deviceId
    ? origin.deviceId !== config.deviceId
    : !!origin.sourceUser && origin.sourceUser.id !== connection.user.id;
  return foreign ? { config, connection, origin } : null;
}
/** A dirty editor encountering an imported remote version follows the cross-device policy. */
export async function preserveRemoteSave(
  home: string,
  projectId: string,
  current: PageRecord,
  document: ShowDocument,
  baseHash: string,
  baseRevision?: string,
): Promise<PageRecord | null> {
  const source = await remoteSaveOrigin(home, projectId, current),
    library = versionedLibrary(home);
  if (!source || !library || !baseRevision) return null;
  const baseDocument =
    (await new EditorDrafts(home).baseline(
      projectId,
      current.document.id,
      baseRevision,
    )) ??
    (await new ReadBaselines(home).read(
      projectId,
      current.document.id,
      baseRevision,
    ));
  if (baseDocument && documentHash(baseDocument) !== baseHash)
    throw new CoreError("INVALID_DATA", "草稿基线与 baseHash 不一致。");
  const store = new FileStore(home),
    preview = baseDocument
      ? previewPageMerge(baseDocument, document, current.document)
      : null;
  if (preview && !preview.conflicts.length)
    return store.savePage(
      projectId,
      current.document.id,
      preview.document,
      current.hash,
      current.revision,
    );
  const head = await library.head();
  if (!head) throw new CoreError("NOT_FOUND", "内容库的当前版本不存在。");
  const remoteFiles = await new LibraryOperations(home, projectId).projectFiles(
    projectId,
    head,
  );
  const path = `projects/${projectId}/pages/${current.document.id}.json`,
    localBytes = Buffer.from(serializeArtifact(document));
  const localFiles = new Map(remoteFiles);
  localFiles.set(path, localBytes);
  const preserved = retainSyncConflicts({
    projectId,
    files: remoteFiles,
    localFiles,
    remoteFiles,
    conflicts: [
      {
        path,
        base: baseDocument
          ? Buffer.from(serializeArtifact(baseDocument)).toString("base64")
          : null,
        local: localBytes.toString("base64"),
        remote: remoteFiles.get(path)!.toString("base64"),
      },
    ],
    local: {
      account: source.connection.user.name,
      deviceId: source.config.deviceId,
      revision: null,
    },
    remote: {
      account: source.origin.sourceUser?.name ?? "未知账号",
      deviceId: source.origin.deviceId ?? "unknown",
      revision: source.origin.revision,
    },
  });
  const changes = new Map(
    [...preserved.files].filter(
      ([path, bytes]) => !remoteFiles.get(path)?.equals(bytes),
    ),
  );
  await writeLibraryFiles(
    home,
    changes,
    new Map([[path, current.revision ?? null]]),
  );
  const localPage = preserved.records[0]?.variants.find(
    (variant) => variant.source.deviceId === source.config.deviceId,
  );
  if (!localPage) throw new CoreError("INVALID_DATA", "跨设备草稿副本未生成。");
  const saved = await store.readPage(projectId, localPage.pageId);
  return { ...saved, retainedSyncConflicts: preserved.records };
}
