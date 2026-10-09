import { createHash } from "node:crypto";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "./diff";
import { CoreError } from "./model";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "./library-files";
import type { ContentLibrary as GitLibrary } from "./content-library";

export interface WorkspaceConflict {
  format: "showai-workspace-conflict";
  version: 1;
  id: string;
  path: string;
  baseRevision: string | null;
  observedAt: string;
  kind: "added" | "modified" | "deleted";
  observedHash: string | null;
  state: "unresolved" | "resolved";
  resolution?: "discard" | "import" | "merge";
  resolvedAt?: string;
  resolvedRevision?: string | null;
}

export function workspaceHash(
  path: string,
  bytes: Buffer | null,
): string | null {
  if (bytes === null) return null;
  const exact = /\/components\//.test(path) && !path.endsWith("/compiled.json");
  let normalized: string | Buffer = bytes;
  if (path.endsWith(".json") && !exact) {
    try {
      normalized = canonicalJson(JSON.parse(bytes.toString("utf8")));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return createHash("sha256").update(normalized).digest("hex");
}

/** External content stays in place and is independently retained before resolution. */
export class WorkspaceProtection {
  constructor(
    readonly library: Pick<
      GitLibrary,
      "root" | "workspace" | "tree" | "readFiles"
    >,
  ) {}

  async list(path?: string): Promise<WorkspaceConflict[]> {
    const root = join(this.library.root, "local", "conflicts");
    const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const records: WorkspaceConflict[] = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}$/.test(name)) continue;
      const bytes = await readLibraryBytes(
        this.library.root,
        join(root, name, "conflict.json"),
      );
      if (!bytes) continue;
      const value = JSON.parse(bytes.toString("utf8")) as WorkspaceConflict;
      if (
        value.format !== "showai-workspace-conflict" ||
        value.version !== 1 ||
        value.id !== name ||
        !value.path ||
        !["unresolved", "resolved"].includes(value.state)
      )
        throw new CoreError(
          "INVALID_DATA",
          "Invalid workspace conflict record.",
        );
      if (!path || value.path === path) records.push(value);
    }
    return records.sort((a, b) => b.observedAt.localeCompare(a.observedAt));
  }

  async capture(
    path: string,
    baseRevision: string | null,
    observed: Buffer | null,
    existed: boolean,
  ): Promise<WorkspaceConflict> {
    const observedHash = workspaceHash(path, observed);
    const existing = (await this.list(path)).find(
      (record) =>
        record.state === "unresolved" && record.observedHash === observedHash,
    );
    if (existing) return existing;
    const id = createHash("sha256")
      .update(JSON.stringify([path, baseRevision, observedHash]))
      .digest("hex");
    const record: WorkspaceConflict = {
      format: "showai-workspace-conflict",
      version: 1,
      id,
      path,
      baseRevision,
      observedHash,
      observedAt: new Date().toISOString(),
      kind: observed === null ? "deleted" : existed ? "modified" : "added",
      state: "unresolved",
    };
    const directory = join(this.library.root, "local", "conflicts", id);
    if (observed)
      await atomicLibraryFile(
        this.library.root,
        join(directory, "input"),
        observed,
      );
    await atomicLibraryFile(
      this.library.root,
      join(directory, "conflict.json"),
      Buffer.from(JSON.stringify(record, null, 2)),
    );
    return record;
  }

  async inspect(
    paths: string[],
    revision: string | null,
  ): Promise<WorkspaceConflict[]> {
    const tree = new Set(
      (revision ? await this.library.tree(revision) : []).map(
        (entry) => entry.path,
      ),
    );
    const present = paths.filter((path) => tree.has(path));
    const committed =
      revision && present.length
        ? await this.library.readFiles(present, revision)
        : new Map<string, Buffer>();
    const conflicts: WorkspaceConflict[] = [];
    for (const path of paths) {
      const actual = await readLibraryBytes(
        this.library.root,
        join(this.library.workspace, path),
      );
      const expected = committed.get(path) ?? null;
      if (workspaceHash(path, actual) !== workspaceHash(path, expected))
        conflicts.push(
          await this.capture(path, revision, actual, tree.has(path)),
        );
    }
    return conflicts;
  }

  async baseline(
    paths: string[],
    revision: string | null,
    allowed = new Set<string>(),
  ): Promise<Record<string, string | null>> {
    const found = await this.inspect(paths, revision);
    const pending = (await this.list()).filter(
      (record) =>
        record.state === "unresolved" &&
        paths.includes(record.path) &&
        !allowed.has(record.id),
    );
    if (found.length || pending.length)
      throw new CoreError(
        "CONFLICT",
        "文件被外部工具修改，外部版本已保留。请先处理该资源的冲突。",
        {
          conflictId: (found[0] ?? pending[0]).id,
          currentRevision: revision ?? undefined,
        },
      );
    const result: Record<string, string | null> = Object.create(null);
    for (const path of paths)
      result[path] = workspaceHash(
        path,
        await readLibraryBytes(
          this.library.root,
          join(this.library.workspace, path),
        ),
      );
    return result;
  }

  async materialize(
    paths: string[],
    revision: string,
    before: Record<string, string | null>,
  ): Promise<WorkspaceConflict[]> {
    const tree = new Set(
      (await this.library.tree(revision)).map((entry) => entry.path),
    );
    const files = await this.library.readFiles(
      paths.filter((path) => tree.has(path)),
      revision,
    );
    const conflicts: WorkspaceConflict[] = [];
    for (const path of paths) {
      const target = join(this.library.workspace, path);
      const actual = await readLibraryBytes(this.library.root, target),
        desired = files.get(path) ?? null;
      const fingerprint = workspaceHash(path, actual);
      if (
        fingerprint !== workspaceHash(path, desired) &&
        fingerprint !== before[path]
      ) {
        conflicts.push(
          await this.capture(path, revision, actual, tree.has(path)),
        );
        continue;
      }
      if (desired !== null)
        await atomicLibraryFile(this.library.root, target, desired);
      else {
        await safeLibraryPath(this.library.root, target);
        await rm(target, { force: true });
      }
    }
    return conflicts;
  }

  async input(
    id: string,
  ): Promise<{ conflict: WorkspaceConflict; bytes: Buffer | null }> {
    if (!/^[a-f0-9]{64}$/.test(id))
      throw new CoreError("INVALID_PATH", "Invalid conflict identity.");
    const conflict = (await this.list()).find((record) => record.id === id);
    if (!conflict)
      throw new CoreError("NOT_FOUND", "Workspace conflict not found.");
    const bytes = await readLibraryBytes(
      this.library.root,
      join(this.library.root, "local", "conflicts", id, "input"),
    );
    if (workspaceHash(conflict.path, bytes) !== conflict.observedHash)
      throw new CoreError(
        "INVALID_DATA",
        "The preserved external draft is corrupt.",
      );
    return { conflict, bytes };
  }

  async resolve(
    id: string,
    resolution: "discard" | "import" | "merge",
    revision: string | null,
  ): Promise<WorkspaceConflict> {
    const { conflict } = await this.input(id);
    const record: WorkspaceConflict = {
      ...conflict,
      state: "resolved",
      resolution,
      resolvedAt: new Date().toISOString(),
      resolvedRevision: revision,
    };
    await atomicLibraryFile(
      this.library.root,
      join(this.library.root, "local", "conflicts", id, "conflict.json"),
      Buffer.from(JSON.stringify(record, null, 2)),
    );
    return record;
  }
}
