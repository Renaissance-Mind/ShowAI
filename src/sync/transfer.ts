import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ContentLibrary as GitLibrary } from "../core/content-library";
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
import { validatePackageBundle } from "../core/catalog";
import { validateReaderClosure } from "./dependency-validation";
import {
  syncProtocol,
  legacySyncProtocol,
  snapshotRevision,
  validateSnapshot,
  scopedPath,
  portablePathKey,
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
    } else if (
      path.startsWith(`${prefix}conflicts/`) &&
      path.endsWith("/record.json")
    ) {
      const record = JSON.parse(bytes.toString());
      record.originalPath = record.originalPath.replace(
        prefix,
        `projects/${to}/`,
      );
      record.variants = record.variants.map((variant: { path: string }) => ({
        ...variant,
        path: variant.path.replace(prefix, `projects/${to}/`),
      }));
      result.set(target, Buffer.from(JSON.stringify(record, null, 2)));
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
  deviceId?: string,
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
      deviceId: entry.syncOrigin?.deviceId ?? deviceId,
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
  expectedProjectId = record.snapshot.projectId,
): Promise<Map<string, Buffer>> {
  validateSnapshot(record.snapshot, expectedProjectId);
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
  await validateReaderClosure(files.keys(), expectedProjectId, async (path) =>
    files.get(path)!,
  );
  const owned = relocateLegacyPackages(files, expectedProjectId);
  validateProjectPackageClosure(owned, expectedProjectId);
  return owned;
}

/** Resolve received package references solely against this snapshot's owned depot. */
function validateProjectPackageClosure(
  files: Map<string, Buffer>,
  projectId: string,
) {
  type Package = {
    kind: "component" | "template";
    record: Record<string, unknown>;
  };
  const packages = new Map<string, Package>();
  const identity = (value: Record<string, unknown>) =>
    `${value.kind}:${value.id}@${value.version}:${value.integrity}`;
  for (const [path, bytes] of files) {
    if (
      !path.startsWith(`projects/${projectId}/packages/`) ||
      !/\/(?:compiled|template)\.json$/.test(path)
    )
      continue;
    const record = JSON.parse(bytes.toString()),
      kind = path.endsWith("/compiled.json") ? "component" : "template";
    packages.set(identity({ ...record, kind }), { kind, record });
  }
  for (const [rootKey, root] of packages) {
    const visited = new Map<string, Package>();
    const visit = (key: string, active: Set<string>) => {
      if (active.has(key) || active.size > 16 || visited.size > 1000)
        throw new CoreError(
          "INVALID_DATA",
          "Invalid synchronized package dependency graph.",
        );
      if (visited.has(key)) return;
      const entry = packages.get(key);
      if (!entry)
        throw new CoreError(
          "INVALID_DATA",
          "A synchronized package dependency is missing from the owned depot.",
        );
      visited.set(key, entry);
      const next = new Set(active).add(key);
      const references = [
        ...(Array.isArray(entry.record.dependencies)
          ? entry.record.dependencies
          : []),
        ...(Array.isArray(entry.record.parts)
          ? entry.record.parts
              .filter((part) => part.ref)
              .map((part) => part.ref)
          : []),
      ];
      for (const ref of references) visit(identity(ref), next);
    };
    visit(rootKey, new Set());
    validatePackageBundle({
      format: "showai-catalog-bundle",
      version: 1,
      root: {
        kind: root.kind,
        id: root.record.id,
        version: root.record.version,
        integrity: root.record.integrity,
      },
      components: [...visited.values()]
        .filter((entry) => entry.kind === "component")
        .map((entry) => ({ component: entry.record })),
      templates: [...visited.values()]
        .filter((entry) => entry.kind === "template")
        .map((entry) => entry.record),
    });
  }
}

/** Old shared packages are read into an owned immutable depot, never installed globally. */
function relocateLegacyPackages(files: Map<string, Buffer>, projectId: string) {
  const roots = new Map<
    string,
    { kind: string; record: Record<string, unknown> }
  >();
  for (const [path, bytes] of files) {
    const match = path.match(
      /^(packages\/(?:published\/)?(components|templates)\/[^/]+\/[^/]+)\/(compiled|template)\.json$/,
    );
    if (match)
      roots.set(match[1], {
        kind: match[2],
        record: JSON.parse(bytes.toString()),
      });
  }
  if (
    !roots.size &&
    ![...files.keys()].some((path) => path.startsWith("packages/"))
  )
    return files;
  for (const { kind, record } of roots.values()) {
    validatePackageBundle({
      format: "showai-catalog-bundle",
      version: 1,
      root: {
        kind: kind === "components" ? "component" : "template",
        id: record.id,
        version: record.version,
        integrity: record.integrity,
      },
      components: [...roots.values()]
        .filter((item) => item.kind === "components")
        .map((item) => ({ component: item.record })),
      templates: [...roots.values()]
        .filter((item) => item.kind === "templates")
        .map((item) => item.record),
    });
  }
  const result = new Map<string, Buffer>();
  for (const [path, bytes] of files) {
    if (!path.startsWith("packages/")) {
      result.set(path, bytes);
      continue;
    }
    const root = [...roots.keys()].find((root) => path.startsWith(root + "/"));
    if (!root)
      throw new CoreError(
        "INVALID_DATA",
        "A legacy package has no verified manifest.",
      );
    const ref = roots.get(root)!;
    const target = `projects/${projectId}/packages/historical/${ref.kind}/${ref.record.integrity}/${path.slice(root.length + 1)}`;
    if (result.has(target) && !result.get(target)!.equals(bytes))
      throw new CoreError("INVALID_DATA", "Legacy dependency paths collide.");
    result.set(target, bytes);
  }
  return result;
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
  remoteProjectId = projectId,
  singleRevision = false,
) {
  const library = new GitLibrary(home);
  const tree = await library.tree(expectedHead ?? undefined);
  const existingAliases = new Map<string, string[]>();
  for (const entry of tree) {
    const key = portablePathKey(entry.path);
    existingAliases.set(key, [...(existingAliases.get(key) ?? []), entry.path]);
  }
  const sharedPaths = new Set(
    tree
      .map((entry) => entry.path)
      .filter((path) => path.startsWith("runtimes/readers/")),
  );
  const immutable = new Map<string, string>();
  const identity = (path: string, bytes: Buffer) =>
    digest(
      path.endsWith("manifest.json")
        ? Buffer.from(JSON.stringify(JSON.parse(bytes.toString())))
        : bytes,
    );
  const validate = async (files: Map<string, Buffer>) => {
    const names = new Set<string>();
    for (const [path, bytes] of files) {
      scopedPath(path, projectId);
      if (path.startsWith("packages/"))
        throw new CoreError(
          "INVALID_DATA",
          "Imported packages must belong to this project.",
        );
      const key = portablePathKey(path);
      const outsideAlias = existingAliases
        .get(key)
        ?.some(
          (alias) =>
            alias !== path && !alias.startsWith(`projects/${projectId}/`),
        );
      if (outsideAlias)
        throw new CoreError(
          "INVALID_DATA",
          "Imported paths alias an existing resource outside this project.",
        );
      if (names.has(key))
        throw new CoreError(
          "INVALID_DATA",
          "Imported paths collide on this filesystem.",
        );
      names.add(key);
      if (!path.startsWith("runtimes/readers/")) continue;
      const expected =
        immutable.get(path) ??
        (sharedPaths.has(path)
          ? identity(
              path,
              await library.readFile(path, expectedHead ?? undefined),
            )
          : undefined);
      const actual = identity(path, bytes);
      if (expected && expected !== actual)
        throw new CoreError(
          "INVALID_DATA",
          "A shared immutable reader cannot be overwritten.",
        );
      immutable.set(path, actual);
    }
    const metadata = JSON.parse(
      files.get(`projects/${projectId}/project.json`)!.toString(),
    );
    if (
      metadata.id !== projectId ||
      ["sourceDirectory", "binding", "bindings"].some((key) =>
        Object.hasOwn(metadata, key),
      )
    )
      throw new CoreError(
        "INVALID_DATA",
        "Imported project identity or device bindings are invalid.",
      );
    await validateReaderClosure(files.keys(), projectId, async (path) =>
      files.get(path)!,
    );
  };
  // Validate the complete sequence before replay; spool bytes so history size does not
  // multiply memory use. A rejected later record must not leave earlier writes behind.
  const parent = join(home, "local", "sync");
  if (singleRevision) {
    const one: { record: SnapshotRecord; files: Map<string, Buffer> }[] = [];
    for await (const entry of entries) {
      if (one.length)
        throw new CoreError(
          "INVALID_DATA",
          "A single-revision import contains an unexpected later record.",
        );
      validateSnapshot(entry.record.snapshot, remoteProjectId);
      if (!(await validSnapshotRecord(entry.record)))
        throw new CoreError(
          "INVALID_DATA",
          "Imported snapshot integrity is invalid.",
        );
      await validate(entry.files);
      one.push(entry);
    }
    await validate(finalFiles);
    return replayProjectHistory(
      home,
      projectId,
      serverId,
      one,
      finalFiles,
      expectedHead,
    );
  }
  await mkdir(parent, { recursive: true });
  const spool = await mkdtemp(join(parent, "validated-import-"));
  let count = 0;
  try {
    for await (const { record, files } of entries) {
      validateSnapshot(record.snapshot, remoteProjectId);
      if (!(await validSnapshotRecord(record)))
        throw new CoreError(
          "INVALID_DATA",
          "Imported snapshot integrity is invalid.",
        );
      await validate(files);
      const folder = join(spool, String(count++));
      await mkdir(folder);
      const paths = [...files.keys()];
      for (let index = 0; index < paths.length; index++)
        await writeFile(join(folder, String(index)), files.get(paths[index])!, {
          mode: 0o600,
        });
      await writeFile(
        join(folder, "entry.json"),
        JSON.stringify({ record, paths }),
        { mode: 0o600 },
      );
    }
    await validate(finalFiles);
    async function* validated() {
      for (let index = 0; index < count; index++) {
        const folder = join(spool, String(index));
        const { record, paths } = JSON.parse(
          await readFile(join(folder, "entry.json"), "utf8"),
        ) as { record: SnapshotRecord; paths: string[] };
        const files = new Map<string, Buffer>();
        for (let offset = 0; offset < paths.length; offset++)
          files.set(
            paths[offset],
            await readFile(join(folder, String(offset))),
          );
        yield { record, files };
      }
    }
    return await replayProjectHistory(
      home,
      projectId,
      serverId,
      validated(),
      finalFiles,
      expectedHead,
    );
  } finally {
    await rm(spool, { recursive: true, force: true });
  }
}

async function replayProjectHistory(
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
            deviceId: change.deviceId,
            sourceUser: record.source?.user,
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
