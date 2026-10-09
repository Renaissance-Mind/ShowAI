import { createHash, randomUUID } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { encodeFile, decodeFile, nodePrefix } from "./history-codec";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { withLibraryLock } from "./library-lock";
import { CoreError } from "./model";
import { ContentLibrary as GitLibrary } from "./content-library";
import { documentHash, canonicalJson } from "./diff";
import type { ShowDocument } from "./model";
import type { ChangeActor } from "./history-model";

export interface EditorDraftInput {
  kind: "page" | "component" | "template";
  clientId: string;
  resourceId: string;
  projectId?: string;
  baseRevision?: string;
  title?: string;
  actor?: ChangeActor;
  content: unknown;
  sequence?: number;
  recoverySource?: { id: string; generation: string };
}
export interface EditorDraftRecord extends Omit<EditorDraftInput, "content"> {
  format: "showai-editor-draft";
  version: 1;
  id: string;
  savedAt: string;
  generation: string;
  path: string;
  assets: string[];
  base64Assets: string[];
  base64AssetPaths?: string[][];
  storage: "page-nodes" | "json";
  normalizationWarning?: string;
}

function identity(
  input: Pick<
    EditorDraftInput,
    "kind" | "clientId" | "resourceId" | "projectId"
  >,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.kind,
        input.clientId,
        input.projectId,
        input.resourceId,
      ]),
    )
    .digest("hex");
}
function identifier(value: string, field: string): void {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1000 ||
    /[\x00-\x1f]/.test(value)
  )
    throw new CoreError("INVALID_DATA", `Invalid draft ${field}.`);
}
const generationPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function validateRecord(record: EditorDraftRecord, id: string) {
  if (
    !record ||
    record.format !== "showai-editor-draft" ||
    record.version !== 1 ||
    record.id !== id ||
    identity(record) !== id ||
    !["page", "component", "template"].includes(record.kind) ||
    !generationPattern.test(record.generation) ||
    !["page-nodes", "json"].includes(record.storage) ||
    !Array.isArray(record.assets) ||
    record.assets.some(
      (asset) => typeof asset !== "string" || !/^[a-f0-9]{64}$/.test(asset),
    ) ||
    !Array.isArray(record.base64Assets) ||
    record.base64Assets.some((name) => typeof name !== "string")
  )
    throw new CoreError("INVALID_DATA", "Invalid editor draft manifest.");
  identifier(record.clientId, "clientId");
  identifier(record.resourceId, "resourceId");
  if (record.projectId) identifier(record.projectId, "projectId");
  const expected =
    record.storage === "page-nodes"
      ? `projects/${record.projectId}/pages/${record.resourceId}.json`
      : `drafts/${id}.json`;
  if (
    record.path !== expected ||
    (record.storage === "page-nodes" &&
      (!/^[\w-]{1,128}$/.test(record.projectId ?? "") ||
        !/^[\w-]{1,128}$/.test(record.resourceId)))
  )
    throw new CoreError(
      "INVALID_DATA",
      "Draft content path differs from its identity.",
    );
  if (
    record.base64AssetPaths &&
    (!Array.isArray(record.base64AssetPaths) ||
      record.base64AssetPaths.some(
        (path) =>
          !Array.isArray(path) ||
          !path.every((part) => typeof part === "string") ||
          !(
            (path.length === 2 && path[0] === "assets") ||
            (path.length === 3 && path[0] === "source" && path[1] === "assets")
          ),
      ))
  )
    throw new CoreError("INVALID_DATA", "Invalid draft asset slots.");
  if (
    record.recoverySource &&
    (!/^[a-f0-9]{64}$/.test(record.recoverySource.id) ||
      !generationPattern.test(record.recoverySource.generation))
  )
    throw new CoreError("INVALID_DATA", "Invalid recovery draft identity.");
}

/** Draft generations are local; formal history begins only after a successful commit. */
export class EditorDrafts {
  constructor(readonly root: string) {}
  async save(input: EditorDraftInput): Promise<EditorDraftRecord> {
    if (!["page", "component", "template"].includes(input.kind))
      throw new CoreError("INVALID_DATA", "Invalid draft kind.");
    identifier(input.clientId, "clientId");
    identifier(input.resourceId, "resourceId");
    if (input.projectId) identifier(input.projectId, "projectId");
    if (
      input.recoverySource &&
      (!/^[a-f0-9]{64}$/.test(input.recoverySource.id) ||
        !generationPattern.test(input.recoverySource.generation))
    )
      throw new CoreError("INVALID_DATA", "Invalid recovery draft identity.");
    const raw = JSON.stringify(input.content);
    if (
      input.sequence !== undefined &&
      (!Number.isSafeInteger(input.sequence) || input.sequence < 0)
    )
      throw new CoreError(
        "INVALID_DATA",
        "Draft sequence must be a nonnegative integer.",
      );
    if (raw === undefined || Buffer.byteLength(raw) > 32 * 1024 * 1024)
      throw new CoreError(
        "INVALID_DATA",
        "Draft content exceeds the 32 MB limit.",
      );
    return withLibraryLock(
      this.root,
      async () => {
        const id = identity(input),
          generation = randomUUID();
        const directory = join(this.root, "local", "editor-drafts", id);
        const previous = await readLibraryBytes(
          this.root,
          join(directory, "draft.json"),
        );
        if (previous) {
          const record = JSON.parse(
            previous.toString("utf8"),
          ) as EditorDraftRecord;
          validateRecord(record, id);
          if (
            input.sequence !== undefined &&
            (record.sequence ?? -1) > input.sequence
          )
            return record;
          if (
            input.sequence !== undefined &&
            record.sequence === input.sequence
          ) {
            const retained = await this.readUnlocked(id);
            if (
              canonicalJson(retained.content) === canonicalJson(JSON.parse(raw))
            )
              return record;
            throw new CoreError(
              "CONFLICT",
              "The same draft sequence was reused for different content; its prior version was retained.",
            );
          }
        }
        let content = JSON.parse(raw),
          path = `drafts/${id}.json`,
          storage: EditorDraftRecord["storage"] = "json";
        const base64Assets: string[] = [];
        const base64AssetPaths: string[][] = [];
        if (input.kind === "component")
          for (const [holder, prefix] of [
            [content, []],
            [content?.source, ["source"]],
          ] as [Record<string, unknown> | undefined, string[]][]) {
            if (
              !holder?.assets ||
              typeof holder.assets !== "object" ||
              Array.isArray(holder.assets)
            )
              continue;
            for (const [name, value] of Object.entries(holder.assets)) {
              if (
                typeof value === "string" &&
                Buffer.from(value, "base64").toString("base64") === value
              ) {
                (holder.assets as Record<string, string>)[name] =
                  `data:application/octet-stream;base64,${value}`;
                base64AssetPaths.push([...prefix, "assets", name]);
                if (!prefix.length) base64Assets.push(name);
              }
            }
          }
        let files: ReturnType<typeof encodeFile>,
          normalizationWarning: string | undefined;
        if (
          input.kind === "page" &&
          input.projectId &&
          /^[\w-]{1,128}$/.test(input.projectId) &&
          /^[\w-]{1,128}$/.test(input.resourceId)
        ) {
          path = `projects/${input.projectId}/pages/${input.resourceId}.json`;
          try {
            files = encodeFile(
              path,
              Buffer.from(
                JSON.stringify({
                  format: "showai",
                  version: 3,
                  document: content,
                }),
              ),
            );
            storage = "page-nodes";
          } catch (error) {
            if (!(error instanceof CoreError) || error.code !== "INVALID_DATA")
              throw error;
            normalizationWarning = error.message;
            path = `drafts/${id}.json`;
            files = encodeFile(path, Buffer.from(JSON.stringify(content)));
          }
        } else files = encodeFile(path, Buffer.from(JSON.stringify(content)));
        if (storage === "page-nodes") {
          // Local recovery snapshots don't need Git's per-node object layout.
          // Keep the existing JSON representation and asset deduplication so one
          // keystroke cannot require thousands of individual durable writes.
          path = `drafts/${id}.json`;
          storage = "json";
          files = encodeFile(path, Buffer.from(JSON.stringify(content)));
        }
        const assets: string[] = [];
        for (const [name, bytes] of files)
          if (bytes !== null) {
            if (name.startsWith("assets/")) {
              const hash = name.slice(7);
              assets.push(hash);
              const target = join(this.root, "local", "draft-assets", hash);
              const existing = await readLibraryBytes(this.root, target);
              if (existing && !existing.equals(bytes))
                throw new CoreError(
                  "INVALID_DATA",
                  "Draft asset fingerprint collision or corruption.",
                );
              if (!existing) await atomicLibraryFile(this.root, target, bytes);
            } else
              await atomicLibraryFile(
                this.root,
                join(directory, generation, name),
                bytes,
              );
          }
        const { content: _content, ...metadata } = input;
        const record: EditorDraftRecord = {
          ...metadata,
          format: "showai-editor-draft",
          version: 1,
          id,
          generation,
          path,
          storage,
          savedAt: new Date().toISOString(),
          assets,
          base64Assets,
          base64AssetPaths,
          ...(normalizationWarning ? { normalizationWarning } : {}),
        };
        await atomicLibraryFile(
          this.root,
          join(directory, "draft.json"),
          Buffer.from(JSON.stringify(record, null, 2)),
        );
        // The published generation is durable. Earlier local generations can be removed.
        for (const name of await readdir(directory))
          if (name !== generation && /^[a-f0-9-]{36}$/.test(name))
            await rm(join(directory, name), { recursive: true });
        return record;
      },
      "drafts",
    );
  }

  async list(
    input: {
      clientId?: string;
      projectId?: string;
      kind?: string;
      resourceId?: string;
    } = {},
  ): Promise<EditorDraftRecord[]> {
    const directory = join(this.root, "local", "editor-drafts");
    const names = await readdir(directory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const result: EditorDraftRecord[] = [];
    for (const id of names) {
      if (!/^[a-f0-9]{64}$/.test(id)) continue;
      const bytes = await readLibraryBytes(
        this.root,
        join(directory, id, "draft.json"),
      );
      if (!bytes) continue;
      const record = JSON.parse(bytes.toString()) as EditorDraftRecord;
      validateRecord(record, id);
      if (
        Object.entries(input).every(
          ([key, value]) =>
            value === undefined ||
            record[key as keyof EditorDraftRecord] === value,
        )
      )
        result.push(record);
    }
    return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  async read(
    id: string,
  ): Promise<{ record: EditorDraftRecord; content: unknown }> {
    return withLibraryLock(this.root, () => this.readUnlocked(id), "drafts");
  }

  private async readUnlocked(
    id: string,
  ): Promise<{ record: EditorDraftRecord; content: unknown }> {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new CoreError("INVALID_PATH", "Invalid draft identity.");
    const record = (await this.list()).find((item) => item.id === id);
    if (!record) throw new CoreError("NOT_FOUND", "Editor draft not found.");
    const directory = join(
      this.root,
      "local",
      "editor-drafts",
      id,
      record.generation,
    );
    const bytes = await decodeFile(record.path, async (path) => {
      if (path.startsWith("assets/")) {
        if (!record.assets.includes(path.slice(7)))
          throw new CoreError(
            "INVALID_DATA",
            "Draft references an undeclared asset.",
          );
        const asset = await readLibraryBytes(
          this.root,
          join(this.root, "local", "draft-assets", path.slice(7)),
        );
        if (!asset) throw new CoreError("NOT_FOUND", "Draft asset is missing.");
        return asset;
      }
      if (
        path !== record.path &&
        !(
          record.storage === "page-nodes" &&
          path.startsWith(nodePrefix(record.path)) &&
          /^[a-f0-9]{64}\.json$/.test(
            path.slice(nodePrefix(record.path).length),
          )
        )
      )
        throw new CoreError(
          "INVALID_PATH",
          "Draft references another generation or resource.",
        );
      const value = await readLibraryBytes(this.root, join(directory, path));
      if (!value) throw new CoreError("NOT_FOUND", "Draft content is missing.");
      return value;
    });
    let content = JSON.parse(bytes.toString("utf8"));
    if (record.storage === "page-nodes") content = content.document;
    for (const path of record.base64AssetPaths ??
      record.base64Assets.map((name) => ["assets", name])) {
      let parent = content;
      for (const part of path.slice(0, -1)) {
        if (
          !parent ||
          typeof parent !== "object" ||
          !Object.hasOwn(parent, part)
        )
          throw new CoreError("INVALID_DATA", "Invalid draft asset slot.");
        parent = parent[part];
      }
      const key = path.at(-1)!,
        prefix = "data:application/octet-stream;base64,";
      if (
        !parent ||
        typeof parent !== "object" ||
        !Object.hasOwn(parent, key) ||
        typeof parent[key] !== "string" ||
        !parent[key].startsWith(prefix)
      )
        throw new CoreError("INVALID_DATA", "Invalid draft asset value.");
      Object.defineProperty(parent, key, {
        value: parent[key].slice(prefix.length),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return { record, content };
  }

  async remove(id: string, expectedGeneration?: string): Promise<void> {
    return withLibraryLock(
      this.root,
      async () => {
        if (!/^[a-f0-9]{64}$/.test(id))
          throw new CoreError("INVALID_PATH", "Invalid draft identity.");
        if (
          !(await readLibraryBytes(
            this.root,
            join(this.root, "local", "editor-drafts", id, "draft.json"),
          ))
        )
          return;
        const { record, content: payload } = await this.readUnlocked(id);
        if (expectedGeneration && record.generation !== expectedGeneration)
          return;
        const history = join(
          this.root,
          "local",
          "discarded-drafts",
          record.id,
          `${Date.now()}`,
        );
        const content = { record, content: payload };
        await atomicLibraryFile(
          this.root,
          join(history, "draft.json"),
          Buffer.from(JSON.stringify(content)),
        );
        await rm(join(this.root, "local", "editor-drafts", record.id), {
          recursive: true,
        });
      },
      "drafts",
    );
  }

  async completePage(
    id: string,
    generation: string,
    revision: string,
  ): Promise<boolean> {
    return withLibraryLock(
      this.root,
      async () => {
        const { record, content } = await this.readUnlocked(id);
        if (record.generation !== generation) return false;
        if (
          record.kind !== "page" ||
          !record.projectId ||
          !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(revision)
        )
          throw new CoreError(
            "INVALID_DATA",
            "Completing a page draft requires a committed page revision.",
          );
        const bytes = await new GitLibrary(this.root).readFile(
          `projects/${record.projectId}/pages/${record.resourceId}.json`,
          revision,
        );
        const committed = JSON.parse(bytes.toString("utf8"))
          .document as ShowDocument;
        if (documentHash(committed) !== documentHash(content as ShowDocument))
          throw new CoreError(
            "CONFLICT",
            "The committed page differs from this draft. The draft was retained.",
          );
        await rm(join(this.root, "local", "editor-drafts", id), {
          recursive: true,
        });
        return true;
      },
      "drafts",
    );
  }
}
