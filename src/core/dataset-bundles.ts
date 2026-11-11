import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { workspaceRoot } from "./library-runtime";
import { CoreError } from "./model";
import { assertId, type FileStore } from "./store";
import { isSourceBundle, type SourceBundle } from "./dataset-sources";

// Copies of files outside the library that travel with a synchronized
// project, so its other devices can read (and for datasets, edit) them.
//
// A copy is the file's bytes stored once under bundles/<sha256> in the
// library workspace. bundles/ is part of a project's synchronization but not
// of history: the dataset file (source.bundle) or projects/<id>/packaging.json
// records which copy is current, and that record is versioned like any
// project file. Each device remembers in local/bundle-state.json the content
// its file and the synchronized copy last agreed on, which tells a change of
// the file on this device from a change made on another device.

const HASH = /^[a-f0-9]{64}$/;

export const bundleHash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** sha256 of a file, read as a stream. */
export async function fileHash(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

export function bundleDirectory(home: string): string {
  return join(workspaceRoot(home), "bundles");
}

export function bundlePath(home: string, hash: string): string {
  if (!HASH.test(hash))
    throw new CoreError("INVALID_DATA", "Invalid bundled copy reference.");
  return join(bundleDirectory(home), hash);
}

export async function hasBundle(home: string, hash: string): Promise<boolean> {
  return stat(bundlePath(home, hash)).then(
    (info) => info.isFile(),
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

/** Stores a copy once by its content; returns its hash. */
export async function storeBundle(home: string, bytes: Buffer): Promise<string> {
  const hash = bundleHash(bytes);
  if (!(await hasBundle(home, hash)))
    await atomicLibraryFile(home, bundlePath(home, hash), bytes);
  return hash;
}

/** A stored copy, checked against its hash; undefined when it has not arrived. */
export async function readBundle(
  home: string,
  hash: string,
): Promise<Buffer | undefined> {
  const bytes = await readLibraryBytes(home, bundlePath(home, hash));
  if (!bytes) return undefined;
  if (bundleHash(bytes) !== hash)
    throw new CoreError("INVALID_DATA", `Corrupt bundled copy: ${hash}`);
  return bytes;
}

// ---------------------------------------------------------------------------
// What this device's file and the synchronized copy last agreed on

export interface BundleAgreement {
  /** Content both sides had when they last matched. */
  hash: string;
  /** The copy shared from the file that this content derives from. */
  base?: string;
  at: string;
  /** Both changed since: the file was kept and the other copy stays in bundles/. */
  conflict?: { file: string; bundle: string; at: string };
  /** The file was too large to bundle when last checked. */
  tooLarge?: { bytes: number; at: string };
}
interface AgreementFile {
  format: "showai-bundle-state";
  version: 1;
  items: Record<string, BundleAgreement>;
}

export class BundleAgreements {
  constructor(readonly home: string) {}
  private path() {
    return join(this.home, "local", "bundle-state.json");
  }
  private async file(): Promise<AgreementFile> {
    const bytes = await readLibraryBytes(this.home, this.path());
    if (!bytes) return { format: "showai-bundle-state", version: 1, items: {} };
    const value = JSON.parse(bytes.toString()) as AgreementFile;
    if (
      value?.format !== "showai-bundle-state" ||
      value.version !== 1 ||
      !value.items ||
      typeof value.items !== "object"
    )
      throw new CoreError("INVALID_DATA", "Invalid bundle state.");
    return value;
  }
  async get(key: string): Promise<BundleAgreement | undefined> {
    return (await this.file()).items[key];
  }
  async set(key: string, value: BundleAgreement | null): Promise<void> {
    const file = await this.file();
    if (value === null) {
      if (!(key in file.items)) return;
      delete file.items[key];
    } else file.items[key] = value;
    await atomicLibraryFile(
      this.home,
      this.path(),
      Buffer.from(`${JSON.stringify(file, null, 2)}\n`),
    );
  }
}

export const datasetBundleKey = (projectId: string, datasetId: string) =>
  `${projectId}/${datasetId}`;
export const resourceBundleKey = (projectId: string, ref: string) =>
  `${projectId}/resource:${bundleHash(Buffer.from(ref)).slice(0, 32)}`;

// ---------------------------------------------------------------------------
// Packaging of a project's linked resource files: projects/<id>/packaging.json

export interface ProjectPackaging {
  format: "showai-packaging";
  version: 1;
  /** By file: reference as the pages store it. */
  resources: Record<string, SourceBundle>;
}

export function packagingPath(store: FileStore, projectId: string): string {
  return join(store.projectPath(assertId(projectId)), "packaging.json");
}

export function validatePackaging(value: unknown): ProjectPackaging {
  const packaging = value as ProjectPackaging;
  if (
    !packaging ||
    typeof packaging !== "object" ||
    packaging.format !== "showai-packaging" ||
    packaging.version !== 1 ||
    !packaging.resources ||
    typeof packaging.resources !== "object" ||
    Array.isArray(packaging.resources) ||
    Object.keys(packaging).some(
      (key) => !["format", "version", "resources"].includes(key),
    ) ||
    Object.entries(packaging.resources).some(
      ([ref, bundle]) =>
        !/^file:/i.test(ref) || ref.length > 4096 || !isSourceBundle(bundle),
    )
  )
    throw new CoreError("INVALID_DATA", "Invalid project packaging file.");
  return packaging;
}

export async function readPackaging(
  store: FileStore,
  projectId: string,
): Promise<ProjectPackaging> {
  try {
    return validatePackaging(
      await store.datasetFiles().readJson(packagingPath(store, projectId)),
    );
  } catch (error) {
    if (error instanceof CoreError && error.code === "NOT_FOUND")
      return { format: "showai-packaging", version: 1, resources: {} };
    throw error;
  }
}

export async function writePackaging(
  store: FileStore,
  projectId: string,
  packaging: ProjectPackaging,
): Promise<void> {
  const sorted: ProjectPackaging = {
    format: "showai-packaging",
    version: 1,
    resources: Object.fromEntries(
      Object.entries(validatePackaging(packaging).resources).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ),
  };
  await store
    .datasetFiles()
    .write(
      packagingPath(store, projectId),
      `${JSON.stringify(sorted, null, 2)}\n`,
    );
}

/** Hashes of the copies a set of project files refers to. */
export function referencedBundles(files: Map<string, Buffer>): Set<string> {
  const hashes = new Set<string>();
  for (const [path, bytes] of files) {
    if (/^projects\/[^/]+\/datasets\/[^/]+\.json$/.test(path)) {
      if (!bytes.includes('"bundle"')) continue;
      const bundle = (
        JSON.parse(bytes.toString()) as { source?: { bundle?: SourceBundle } }
      )?.source?.bundle;
      if (bundle?.sync && bundle.hash && HASH.test(bundle.hash))
        hashes.add(bundle.hash);
    } else if (/^projects\/[^/]+\/packaging\.json$/.test(path)) {
      const packaging = JSON.parse(bytes.toString()) as ProjectPackaging;
      for (const bundle of Object.values(packaging?.resources ?? {}))
        if (bundle?.sync && bundle.hash && HASH.test(bundle.hash))
          hashes.add(bundle.hash);
    }
  }
  return hashes;
}

/** Copies stored on this device and the time each was last written. */
export async function storedBundles(
  home: string,
): Promise<{ hash: string; modifiedAt: number }[]> {
  const names = await readdir(bundleDirectory(home)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [] as string[];
      throw error;
    },
  );
  const result = [];
  for (const name of names) {
    if (!HASH.test(name)) continue;
    const info = await stat(join(bundleDirectory(home), name));
    result.push({ hash: name, modifiedAt: info.mtimeMs });
  }
  return result;
}

/** How long an unreferenced stored copy is kept before collection. */
export const BUNDLE_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Removes stored copies no project file refers to any more, after a grace
 * period that covers a synchronization still placing a new record.
 */
export async function collectBundles(
  store: FileStore,
  options: { graceMs?: number; now?: number } = {},
): Promise<string[]> {
  const stored = await storedBundles(store.root);
  if (!stored.length) return [];
  const files = new Map<string, Buffer>();
  for (const project of await store.listProjects({ includeArchived: true })) {
    const directory = store.datasetFiles().directory(project.id);
    const names = await store
      .datasetFiles()
      .names(directory)
      .catch((error) => {
        if (error instanceof CoreError && error.code === "NOT_FOUND") return [];
        throw error;
      });
    for (const name of names) {
      const value = await store
        .datasetFiles()
        .readJson(join(directory, name))
        .catch(() => undefined);
      if (value)
        files.set(
          `projects/${project.id}/datasets/${name}`,
          Buffer.from(JSON.stringify(value)),
        );
    }
    const packaging = await readPackaging(store, project.id).catch(
      () => undefined,
    );
    if (packaging)
      files.set(
        `projects/${project.id}/packaging.json`,
        Buffer.from(JSON.stringify(packaging)),
      );
  }
  const referenced = referencedBundles(files);
  const now = options.now ?? Date.now();
  const grace = options.graceMs ?? BUNDLE_GRACE_MS;
  const removed: string[] = [];
  for (const item of stored)
    if (!referenced.has(item.hash) && now - item.modifiedAt >= grace) {
      await rm(bundlePath(store.root, item.hash), { force: true });
      removed.push(item.hash);
    }
  return removed;
}
