import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { parseArtifact, serializeArtifact } from "../portable/validation.mjs";
import { readerBindingPath } from "../core/archived-reader";
import type { ShowDocument } from "../types";
import type { FileConflict } from "./transfer";

export interface ConflictSource {
  account: string;
  deviceId: string;
  revision: string | null;
  baseRevision?: string;
  label?: string;
}
export interface RetainedConflict {
  format: "showai-retained-sync-conflict";
  version: 1;
  id: string;
  at: string;
  originalPath: string;
  originalPageId?: string;
  variants: {
    source: ConflictSource;
    pageId: string;
    title: string;
    path: string;
    deleted: boolean;
    hash: string | null;
  }[];
}
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const uuid = (seed: string) => {
  const value = hash(seed);
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
};
function label(source: ConflictSource) {
  return `${source.account} · 设备 ${source.deviceId === "unknown" ? "未知" : source.deviceId.slice(0, 8)}${source.label ? ` · ${source.label}` : ""}`;
}
function note(id: string, title: string, text: string): ShowDocument {
  return {
    id,
    title,
    icon: "",
    cover: "none",
    parentId: null,
    favorite: false,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      type: "surface",
      attrs: { id: uuid(id + ":surface"), kind: "page", name: "Page" },
      content: [
        {
          type: "paragraph",
          attrs: { id: uuid(id + ":paragraph") },
          content: [{ type: "text", text }],
        },
      ],
    },
    comments: [],
  };
}
/** Keep both inputs as ordinary pages and immutable source bytes in the shared project. */
export function retainSyncConflicts(input: {
  projectId: string;
  files: Map<string, Buffer>;
  conflicts: FileConflict[];
  localFiles: Map<string, Buffer>;
  remoteFiles: Map<string, Buffer>;
  local: ConflictSource;
  remote: ConflictSource;
}) {
  const files = new Map(input.files),
    records: RetainedConflict[] = [];
  const prefix = `projects/${input.projectId}/`;
  const prior = [...input.remoteFiles]
    .filter(
      ([path]) =>
        path.startsWith(prefix + "conflicts/") && path.endsWith("/record.json"),
    )
    .map(([, bytes]) => JSON.parse(bytes.toString()) as RetainedConflict);
  for (const conflict of input.conflicts) {
    const localBytes =
      conflict.local === null ? null : Buffer.from(conflict.local, "base64");
    const localHash = localBytes && hash(localBytes);
    // Another device may already have published the preservation of this exact input.
    if (
      prior.some(
        (record) =>
          record.originalPath === conflict.path &&
          record.variants.some((variant) => variant.hash === localHash),
      )
    ) {
      const remote = input.remoteFiles.get(conflict.path);
      if (remote) files.set(conflict.path, remote);
      else files.delete(conflict.path);
      continue;
    }
    const id = hash(
      JSON.stringify([conflict.path, conflict.local, conflict.remote]),
    );
    const root = `${prefix}conflicts/${id}/`;
    const originalPageId = conflict.path.match(
      /^projects\/[^/]+\/pages\/([^/]+)\.json$/,
    )?.[1];
    const record: RetainedConflict = {
      format: "showai-retained-sync-conflict",
      version: 1,
      id,
      at: new Date().toISOString(),
      originalPath: conflict.path,
      originalPageId,
      variants: [],
    };
    for (const side of ["remote", "local"] as const) {
      const encoded = conflict[side],
        bytes = encoded === null ? null : Buffer.from(encoded, "base64");
      const source = input[side];
      const preservedPath = `${root}${side}.input`;
      if (bytes) files.set(preservedPath, bytes);
      const pageId =
        originalPageId && side === "remote"
          ? originalPageId
          : uuid(`${id}:${side}`);
      const original =
        originalPageId && bytes
          ? parseArtifact(JSON.parse(bytes.toString())).document
          : null;
      const name = original?.title || conflict.path.split("/").at(-1)!;
      const title = `${name}（来源：${label(source)}${bytes ? "" : "，已删除"}）`;
      const document = original
        ? { ...original, id: pageId, title }
        : note(
            pageId,
            title,
            `${bytes ? "此文件的合并失败，原始内容已完整保留。" : "此来源删除了文件；另一来源的修改也已保留。"}\n原文件：${conflict.path}\n来源：${label(source)}\n来源版本：${source.revision ?? "未知"}\n记录：${root}record.json\n${bytes ? `原始内容：${preservedPath}` : ""}`,
          );
      const path = `${prefix}pages/${pageId}.json`;
      files.set(path, Buffer.from(serializeArtifact(document)));
      if (originalPageId && bytes) {
        const binding = input[
          (side + "Files") as "localFiles" | "remoteFiles"
        ].get(readerBindingPath(conflict.path));
        if (binding) files.set(readerBindingPath(path), binding);
      }
      record.variants.push({
        source,
        pageId,
        title,
        path: preservedPath,
        deleted: bytes === null,
        hash: bytes && hash(bytes),
      });
    }
    if (!originalPageId) {
      const remote = input.remoteFiles.get(conflict.path);
      if (remote) files.set(conflict.path, remote);
      else files.delete(conflict.path);
    }
    files.set(
      root + "record.json",
      Buffer.from(JSON.stringify(record, null, 2)),
    );
    records.push(record);
  }
  return { files, records };
}
