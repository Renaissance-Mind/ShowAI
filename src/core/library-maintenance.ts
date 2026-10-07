import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GitLibrary } from "./git-library";
import { versionedLibrary } from "./library-runtime";
import { CoreError } from "./model";
import { withLibraryLock } from "./library-lock";
import {
  atomicLibraryFile,
  readLibraryBytes,
  safeLibraryPath,
} from "./library-files";
import { EditorDrafts } from "./editor-drafts";
import { LibraryIndex } from "./library-index";
import type { LibraryManifest } from "./history-model";
import { libraryFingerprint } from "./library-fingerprints";
import { readingCacheRecords, readingCachePath } from "./reading-cache";

export type StorageCategory =
  | "repository"
  | "workspace"
  | "indexes"
  | "receipts"
  | "cache"
  | "drafts"
  | "conflicts"
  | "recovery"
  | "imports"
  | "originals"
  | "other";
interface FileSize {
  path: string;
  bytes: number;
  allocatedBytes: number;
  modifiedAt: number;
}
export interface LibraryStorage {
  measuredAt: string;
  revision: string | null;
  totalBytes: number;
  allocatedBytes: number;
  files: number;
  categories: Record<
    StorageCategory,
    { bytes: number; allocatedBytes: number; files: number }
  >;
  git: Awaited<ReturnType<GitLibrary["objectStatistics"]>>;
  maintenance: MaintenanceState | null;
}
export interface CleanupPlan {
  format: "showai-cleanup-plan";
  version: 1;
  id: string;
  libraryId: string;
  revision: string | null;
  createdAt: string;
  bytes: number;
  files: {
    path: string;
    bytes: number;
    sha256: string;
    category: StorageCategory;
  }[];
  protectedDrafts: number;
  protectedConflicts: number;
}
export interface MaintenanceState {
  format: "showai-maintenance";
  version: 1;
  state: "running" | "complete" | "failed";
  action: "compact" | "cleanup" | "archive";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  revision: string | null;
  beforeBytes?: number;
  afterBytes?: number;
  pid?: number;
  root?: string;
}
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function category(path: string): StorageCategory {
  if (path.startsWith("repository.git/")) return "repository";
  if (/^(index\.sqlite|local\/operation-index\.sqlite)(?:-|$)/.test(path))
    return "indexes";
  if (/^(?:workspace\/)?projects\/[^/]+\/exports\/reads\//.test(path))
    return "cache";
  if (path.startsWith("workspace/")) return "workspace";
  if (path.startsWith("local/receipts/")) return "receipts";
  if (
    /^(cache\/|tmp\/|local\/reading-cache\/)/.test(path) ||
    /^projects\/[^/]+\/exports\/reads\//.test(path)
  )
    return "cache";
  if (/^local\/(?:editor-drafts|discarded-drafts|draft-assets)\//.test(path))
    return "drafts";
  if (path.startsWith("local/conflicts/")) return "conflicts";
  if (/^local\/(?:transactions|drafts|leases)\//.test(path)) return "recovery";
  if (path.startsWith("local/imports/")) return "imports";
  if (/^(projects\/|packages\/|publications\/|sidebar\.json$)/.test(path))
    return "originals";
  return "other";
}
async function files(root: string, prefix = ""): Promise<FileSize[]> {
  const result: FileSize[] = [];
  async function visit(path: string) {
    const absolute = join(root, path);
    await safeLibraryPath(root, absolute);
    const info = await lstat(absolute).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return;
    if (info.isDirectory())
      for (const name of (await readdir(absolute)).sort())
        await visit(path ? `${path}/${name}` : name);
    else if (info.isFile())
      result.push({
        path,
        bytes: info.size,
        allocatedBytes:
          typeof info.blocks === "number" ? info.blocks * 512 : info.size,
        modifiedAt: info.mtimeMs,
      });
    else
      throw new CoreError(
        "INVALID_PATH",
        `Unsupported library filesystem entry: ${path}`,
      );
  }
  await visit(prefix);
  return result;
}

export class LibraryMaintenance {
  readonly library: GitLibrary;
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
    const library = versionedLibrary(this.root);
    if (!library)
      throw new CoreError(
        "INVALID_DATA",
        "Space management requires a versioned library.",
      );
    this.library = library;
  }
  async state(): Promise<MaintenanceState | null> {
    const bytes = await readLibraryBytes(
      this.root,
      join(this.root, "local", "maintenance.json"),
    );
    if (!bytes) return null;
    const value = JSON.parse(bytes.toString("utf8")) as MaintenanceState;
    if (
      value.format !== "showai-maintenance" ||
      value.version !== 1 ||
      !["running", "complete", "failed"].includes(value.state)
    )
      throw new CoreError("INVALID_DATA", "Invalid maintenance state.");
    if (value.state === "running") {
      const lease = await readLibraryBytes(
        this.root,
        join(this.root, "local", "maintenance.lock"),
      );
      let alive = false;
      if (Number.isSafeInteger(value.pid) && value.pid! > 0) {
        try {
          process.kill(value.pid!, 0);
          alive = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") alive = true;
          else if ((error as NodeJS.ErrnoException).code !== "ESRCH")
            throw error;
        }
      }
      if (
        !alive ||
        !lease ||
        value.root !== this.root ||
        JSON.parse(lease.toString("utf8")).pid !== value.pid
      )
        return {
          ...value,
          state: "failed",
          error: "上一次维护过程已结束或被中断，可重新执行。",
        };
    }
    return value;
  }
  async storage(): Promise<LibraryStorage> {
    const inventory = await files(this.root),
      categories = Object.fromEntries(
        [
          "repository",
          "workspace",
          "indexes",
          "receipts",
          "cache",
          "drafts",
          "conflicts",
          "recovery",
          "imports",
          "originals",
          "other",
        ].map((key) => [key, { bytes: 0, allocatedBytes: 0, files: 0 }]),
      ) as LibraryStorage["categories"];
    for (const item of inventory) {
      const group = categories[category(item.path)];
      group.bytes += item.bytes;
      group.allocatedBytes += item.allocatedBytes;
      group.files++;
    }
    return {
      measuredAt: new Date().toISOString(),
      revision: await this.library.head(),
      totalBytes: inventory.reduce((total, file) => total + file.bytes, 0),
      allocatedBytes: inventory.reduce(
        (total, file) => total + file.allocatedBytes,
        0,
      ),
      files: inventory.length,
      categories,
      git: await this.library.objectStatistics(),
      maintenance: await this.state(),
    };
  }
  private async job<T>(
    action: MaintenanceState["action"],
    operation: () => Promise<T>,
  ): Promise<T> {
    return withLibraryLock(
      this.root,
      async () => {
        const state: MaintenanceState = {
          format: "showai-maintenance",
          version: 1,
          action,
          state: "running",
          startedAt: new Date().toISOString(),
          revision: await this.library.head(),
          pid: process.pid,
          root: this.root,
        };
        const path = join(this.root, "local", "maintenance.json");
        await atomicLibraryFile(
          this.root,
          path,
          Buffer.from(JSON.stringify(state)),
        );
        try {
          const result = await operation();
          await atomicLibraryFile(
            this.root,
            path,
            Buffer.from(
              JSON.stringify({
                ...state,
                state: "complete",
                finishedAt: new Date().toISOString(),
              }),
            ),
          );
          return result;
        } catch (error) {
          await atomicLibraryFile(
            this.root,
            path,
            Buffer.from(
              JSON.stringify({
                ...state,
                state: "failed",
                finishedAt: new Date().toISOString(),
                error: error instanceof Error ? error.message : String(error),
              }),
            ),
          );
          throw error;
        }
      },
      "maintenance",
    );
  }
  async compact() {
    return this.job("compact", async () => {
      const before = await this.storage(),
        result = await this.library.compact();
      await this.library.verify();
      const after = await this.storage();
      return {
        ...result,
        beforeBytes: before.categories.repository.bytes,
        afterBytes: after.categories.repository.bytes,
        revision: after.revision,
      };
    });
  }
  async prepareCleanup(
    input: {
      olderThanDays?: number;
      receipts?: boolean;
      orphanAssets?: boolean;
      cache?: boolean;
      importCopies?: boolean;
    } = {},
  ): Promise<CleanupPlan> {
    if (
      input.olderThanDays !== undefined &&
      (!Number.isFinite(input.olderThanDays) || input.olderThanDays < 0)
    )
      throw new CoreError("INVALID_DATA", "Cleanup age must be nonnegative.");
    return withLibraryLock(this.root, () =>
      withLibraryLock(
        this.root,
        async () => {
          const drafts = await new EditorDrafts(this.root).list(),
            references = new Set(drafts.flatMap((draft) => draft.assets));
          const cutoff = Date.now() - (input.olderThanDays ?? 1) * 86400000,
            inventory = await files(this.root),
            chosen: CleanupPlan["files"] = [];
          const revision = await this.library.head(),
            importHeads = new Set(
              revision
                ? (await this.library.tree(revision))
                    .filter((file) =>
                      /^imports\/[a-f0-9-]{36}\/manifest\.json$/.test(
                        file.path,
                      ),
                    )
                    .map((file) => file.path.split("/")[1])
                : [],
            );
          const reading =
            input.cache !== false
              ? (await readingCacheRecords(this.root)).filter(
                  (item) => Date.parse(item.record.createdAt) < cutoff,
                )
              : [];
          const readingPaths = new Set(
            reading.flatMap((item) => [item.path, item.record.path]),
          );
          for (const file of inventory) {
            let eligible = false;
            if (readingPaths.has(file.path)) {
              const owner = reading.find(
                (item) => item.record.path === file.path,
              );
              if (owner) {
                const current = await libraryFingerprint(
                  this.root,
                  join(this.root, file.path),
                );
                if (
                  !current ||
                  current.bytes !== owner.record.bytes ||
                  current.sha256 !== owner.record.sha256
                )
                  throw new CoreError(
                    "CONFLICT",
                    "A generated reading output was modified; cleanup retained it.",
                  );
              }
              eligible = true;
            }
            if (
              input.receipts !== false &&
              /^local\/receipts\/[a-f0-9]{64}\.json$/.test(file.path)
            )
              eligible = true;
            if (
              input.orphanAssets !== false &&
              /^local\/draft-assets\/[a-f0-9]{64}$/.test(file.path) &&
              !references.has(file.path.split("/").at(-1)!)
            )
              eligible = true;
            if (
              input.cache !== false &&
              file.modifiedAt < cutoff &&
              /^(?:cache\/|tmp\/component-[a-f0-9-]{36}\/)/.test(file.path)
            )
              eligible = true;
            if (
              input.importCopies !== false &&
              /^local\/imports\/([a-f0-9-]{36})\/originals\/[a-f0-9]{64}\.gz$/.test(
                file.path,
              )
            ) {
              const importId = file.path.split("/")[2],
                hash = file.path.split("/").at(-1)!;
              if (importHeads.has(importId)) {
                const bytes = await readLibraryBytes(
                  this.root,
                  join(this.root, file.path),
                );
                const committed = await this.library.readFile(
                  `imports/${importId}/originals/${hash}`,
                  revision!,
                );
                if (!bytes?.equals(committed))
                  throw new CoreError(
                    "INVALID_DATA",
                    "The import preparation archive differs from its committed copy.",
                  );
                eligible = true;
              }
            }
            if (!eligible) continue;
            const bytes = await readLibraryBytes(
              this.root,
              join(this.root, file.path),
            );
            if (!bytes)
              throw new CoreError(
                "CONFLICT",
                "A cleanup candidate changed during preparation.",
              );
            chosen.push({
              path: file.path,
              bytes: bytes.length,
              sha256: sha(bytes),
              category: category(file.path),
            });
          }
          const conflicts = (await files(this.root, "local/conflicts")).filter(
            (file) => file.path.endsWith("/conflict.json"),
          );
          const plan: CleanupPlan = {
            format: "showai-cleanup-plan",
            version: 1,
            id: randomUUID(),
            libraryId: (await this.library.manifest()).id,
            revision,
            createdAt: new Date().toISOString(),
            bytes: chosen.reduce((sum, item) => sum + item.bytes, 0),
            files: chosen,
            protectedDrafts: drafts.length,
            protectedConflicts: conflicts.length,
          };
          await atomicLibraryFile(
            this.root,
            join(this.root, "local", "cleanup-plans", `${plan.id}.json`),
            Buffer.from(JSON.stringify(plan)),
          );
          return plan;
        },
        "drafts",
      ),
    );
  }
  async cleanup(id: string) {
    if (!uuid.test(id))
      throw new CoreError("INVALID_PATH", "Invalid cleanup plan identity.");
    return this.job("cleanup", () =>
      withLibraryLock(this.root, () =>
        withLibraryLock(
          this.root,
          async () => {
            const path = join(
                this.root,
                "local",
                "cleanup-plans",
                `${id}.json`,
              ),
              bytes = await readLibraryBytes(this.root, path);
            if (!bytes)
              throw new CoreError("NOT_FOUND", "Cleanup plan not found.");
            const plan = JSON.parse(bytes.toString("utf8")) as CleanupPlan;
            if (
              plan.format !== "showai-cleanup-plan" ||
              plan.version !== 1 ||
              plan.id !== id ||
              plan.libraryId !== (await this.library.manifest()).id ||
              !Array.isArray(plan.files)
            )
              throw new CoreError("INVALID_DATA", "Invalid cleanup plan.");
            const referenced = new Set(
              (await new EditorDrafts(this.root).list()).flatMap(
                (draft) => draft.assets,
              ),
            );
            for (const file of plan.files) {
              if (
                (!/^local\/(?:receipts\/[a-f0-9]{64}\.json|reading-cache\/[a-f0-9]{64}\.json|draft-assets\/[a-f0-9]{64}|imports\/[a-f0-9-]{36}\/originals\/[a-f0-9]{64}\.gz)$|^(?:cache\/|tmp\/component-[a-f0-9-]{36}\/)/.test(
                  file.path,
                ) &&
                  !readingCachePath.test(file.path)) ||
                file.path
                  .split("/")
                  .some((part) => part === ".." || part === ".") ||
                file.path.includes("\\")
              )
                throw new CoreError(
                  "INVALID_PATH",
                  "Cleanup plan contains a protected path.",
                );
              if (
                file.path.startsWith("local/draft-assets/") &&
                referenced.has(file.path.split("/").at(-1)!)
              )
                throw new CoreError(
                  "CONFLICT",
                  "A newer draft now references this asset; cleanup retained it.",
                );
              const current = await readLibraryBytes(
                this.root,
                join(this.root, file.path),
              );
              if (
                current &&
                (current.length !== file.bytes || sha(current) !== file.sha256)
              )
                throw new CoreError(
                  "CONFLICT",
                  "A cleanup candidate has changed; prepare a fresh plan.",
                );
            }
            for (const file of plan.files)
              await rm(join(this.root, file.path), { force: true });
            await atomicLibraryFile(
              this.root,
              path,
              Buffer.from(
                JSON.stringify({
                  ...plan,
                  appliedAt: new Date().toISOString(),
                }),
              ),
            );
            return {
              files: plan.files.length,
              freedBytes: plan.bytes,
              revision: await this.library.head(),
              protectedDrafts: plan.protectedDrafts,
              protectedConflicts: plan.protectedConflicts,
            };
          },
          "drafts",
        ),
      ),
    );
  }
  async rebuildIndex() {
    return new LibraryIndex(this.root).synchronize(true);
  }
  async archive(destination: string) {
    destination = resolve(destination);
    let ancestor = dirname(destination);
    while (
      !(await lstat(ancestor).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ))
    )
      ancestor = dirname(ancestor);
    destination = join(
      await realpath(ancestor),
      relative(ancestor, destination),
    );
    const inside = relative(await realpath(this.root), destination);
    if (
      !inside ||
      (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
    )
      throw new CoreError(
        "INVALID_PATH",
        "Archive destination must be outside the active library.",
      );
    await safeLibraryPath(destination, destination);
    if (
      await lstat(destination).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      )
    )
      throw new CoreError(
        "CONFLICT",
        "Archive destination already exists; no files were overwritten.",
      );
    return this.job("archive", async () => {
      await this.library.recover();
      return withLibraryLock(this.root, () =>
        withLibraryLock(
          this.root,
          () =>
            withLibraryLock(
              this.root,
              async () => {
                const revision = await this.library.head(),
                  manifest = await this.library.manifest(),
                  staging = `${destination}.pending-${randomUUID()}`;
                await mkdir(staging, { recursive: true });
                const inventory = (await files(this.root)).filter(
                  (file) =>
                    !/^local\/(?:leases\/|[^/]+\.lock(?:\.|$))/.test(
                      file.path,
                    ) &&
                    !/^index\.sqlite(?:-|$)/.test(file.path) &&
                    !/^(?:cache\/|tmp\/)/.test(file.path),
                );
                const recorded: {
                  path: string;
                  sha256: string;
                  bytes: number;
                }[] = [];
                for (const file of inventory) {
                  const source = join(this.root, file.path),
                    target = join(staging, file.path),
                    fingerprint = await libraryFingerprint(this.root, source);
                  if (!fingerprint)
                    throw new CoreError(
                      "CONFLICT",
                      "An archive input changed during copying.",
                    );
                  await safeLibraryPath(staging, target);
                  await mkdir(dirname(target), { recursive: true });
                  await copyFile(source, target);
                  recorded.push({ path: file.path, ...fingerprint });
                }
                const archiveManifest = {
                  format: "showai-library-archive",
                  version: 1,
                  libraryId: manifest.id,
                  revision,
                  createdAt: new Date().toISOString(),
                  files: recorded,
                };
                await atomicLibraryFile(
                  staging,
                  join(staging, "archive.json"),
                  Buffer.from(JSON.stringify(archiveManifest)),
                );
                await verifyLibraryArchive(staging);
                await rename(staging, destination);
                return {
                  path: destination,
                  libraryId: manifest.id,
                  revision,
                  files: recorded.length,
                  bytes: recorded.reduce((sum, file) => sum + file.bytes, 0),
                };
              },
              "index",
            ),
          "drafts",
        ),
      );
    });
  }
}
export async function verifyLibraryArchive(root: string) {
  const bytes = await readLibraryBytes(root, join(root, "archive.json"));
  if (!bytes)
    throw new CoreError("NOT_FOUND", "Library archive manifest not found.");
  const manifest = JSON.parse(bytes.toString("utf8")) as {
    format: string;
    version: number;
    libraryId: string;
    revision: string | null;
    files: { path: string; bytes: number; sha256: string }[];
  };
  if (
    manifest.format !== "showai-library-archive" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files)
  )
    throw new CoreError("INVALID_DATA", "Invalid library archive manifest.");
  for (const file of manifest.files) {
    const current = await libraryFingerprint(root, join(root, file.path));
    if (
      !current ||
      current.bytes !== file.bytes ||
      current.sha256 !== file.sha256
    )
      throw new CoreError(
        "INVALID_DATA",
        `Archive file differs from its fingerprint: ${file.path}`,
      );
  }
  const library = new GitLibrary(root),
    libraryManifest: LibraryManifest = await library.manifest();
  if (
    libraryManifest.id !== manifest.libraryId ||
    (await library.head()) !== manifest.revision
  )
    throw new CoreError(
      "INVALID_DATA",
      "Archive content or history differs from its manifest.",
    );
  await library.verify();
  return {
    verified: true,
    libraryId: manifest.libraryId,
    revision: manifest.revision,
    files: manifest.files.length,
  };
}
