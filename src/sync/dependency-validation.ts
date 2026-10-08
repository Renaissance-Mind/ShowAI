import { digestId, hash, scopedPath, SyncError } from "./protocol";

type Read = (path: string) => Promise<Uint8Array>;
const decoder = new TextDecoder();
function json(bytes: Uint8Array): Record<string, unknown> {
  const data = JSON.parse(decoder.decode(bytes));
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new SyncError(
      400,
      "INVALID_DEPENDENCY",
      "Invalid dependency metadata.",
    );
  // Server objects are history-codec envelopes; decoded client files are plain JSON.
  if (data.format === "showai-stored-json") {
    if (
      data.version !== 1 ||
      !Array.isArray(data.assets) ||
      data.assets.length ||
      !data.value ||
      typeof data.value !== "object"
    )
      throw new SyncError(
        400,
        "INVALID_DEPENDENCY",
        "Reader metadata cannot contain assets.",
      );
    return data.value;
  }
  return data;
}

/** Readers are shared only by a fully verified immutable identity and an owned binding. */
export async function validateReaderClosure(
  paths: Iterable<string>,
  projectId: string,
  read: Read,
) {
  const available = new Set(paths),
    referenced = new Set<string>();
  for (const path of available) {
    scopedPath(path, projectId);
    if (
      !path.startsWith(`projects/${projectId}/`) ||
      !/^projects\/[^/]+\/(?:pages\/[^/]+\/reader\.json|history\/imports\/[^/]+\/snapshots\/[^/]+\.reader\.json)$/.test(
        path,
      )
    )
      continue;
    const binding = json(await read(path));
    if (
      binding.format !== "showai-page-reader" ||
      binding.version !== 1 ||
      !["captured", "import-time"].includes(String(binding.origin))
    )
      throw new SyncError(
        400,
        "INVALID_READER",
        "Invalid project reader binding.",
      );
    referenced.add(digestId(binding.integrity));
  }
  for (const id of referenced) {
    const root = `runtimes/readers/${id}/`,
      manifestPath = root + "manifest.json",
      htmlPath = root + "viewer.html";
    if (!available.has(manifestPath) || !available.has(htmlPath))
      throw new SyncError(
        400,
        "INVALID_READER",
        "The referenced reader is incomplete.",
      );
    const manifest = json(await read(manifestPath));
    const { integrity, ...payload } = manifest;
    const html = await read(htmlPath),
      source = decoder.decode(html);
    if (
      manifest.format !== "showai-archived-reader" ||
      manifest.version !== 1 ||
      integrity !== id ||
      (await hash(JSON.stringify(payload))) !== id ||
      manifest.htmlHash !== (await hash(html)) ||
      manifest.htmlBytes !== html.byteLength ||
      !Array.isArray(manifest.kinds) ||
      manifest.kinds.some((kind: unknown) => typeof kind !== "string") ||
      !source.includes('id="showai-data"') ||
      /<script\b[^>]*\bsrc=["']/i.test(source) ||
      /<link\b[^>]*\brel=["']stylesheet/i.test(source)
    )
      throw new SyncError(
        400,
        "INVALID_READER",
        "The reader differs from its complete fingerprint.",
      );
  }
  for (const path of available) {
    const reader = path.match(/^runtimes\/readers\/([a-f0-9]{64})\/(.*)$/);
    if (
      reader &&
      (!referenced.has(reader[1]) ||
        !["manifest.json", "viewer.html"].includes(reader[2]))
    )
      throw new SyncError(
        400,
        "INVALID_READER",
        "An unreferenced shared reader cannot be imported.",
      );
  }
}

/** Publication rejects package graphs that escape their received project depot. */
export async function validatePackageClosure(
  paths: Iterable<string>,
  projectId: string,
  read: Read,
) {
  const packages = new Map<string, Record<string, unknown>>();
  const identity = (ref: Record<string, unknown>) =>
    `${ref.kind}:${ref.id}@${ref.version}:${ref.integrity}`;
  for (const path of paths) {
    if (
      !path.startsWith(`projects/${projectId}/packages/`) ||
      !/\/(compiled|template)\.json$/.test(path)
    )
      continue;
    if (packages.size >= 1000)
      throw new SyncError(
        400,
        "INVALID_DEPENDENCY",
        "Package closure exceeds 1000 records.",
      );
    const encoded = JSON.parse(decoder.decode(await read(path))),
      record =
        encoded.format === "showai-stored-json" ? encoded.value : encoded;
    const kind = path.endsWith("/compiled.json") ? "component" : "template";
    if (
      !record ||
      typeof record.id !== "string" ||
      typeof record.version !== "string" ||
      typeof record.integrity !== "string" ||
      !/^sha256-[a-f0-9]{64}$/.test(record.integrity)
    )
      throw new SyncError(
        400,
        "INVALID_DEPENDENCY",
        "Invalid owned package identity.",
      );
    packages.set(identity({ ...record, kind }), record);
  }
  const walk = (key: string, active: Set<string>, visited: Set<string>) => {
    if (active.has(key) || active.size > 16)
      throw new SyncError(
        400,
        "INVALID_DEPENDENCY",
        "Package graph is cyclic or too deep.",
      );
    if (visited.has(key)) return;
    const record = packages.get(key);
    if (!record)
      throw new SyncError(
        400,
        "INVALID_DEPENDENCY",
        "A package dependency is absent from the owned project depot.",
      );
    visited.add(key);
    const next = new Set(active).add(key);
    const refs = [
      ...(Array.isArray(record.dependencies) ? record.dependencies : []),
      ...(Array.isArray(record.parts)
        ? record.parts.filter((part) => part.ref).map((part) => part.ref)
        : []),
    ];
    for (const ref of refs) {
      if (ref.projectId !== undefined && ref.projectId !== projectId)
        throw new SyncError(
          400,
          "INVALID_DEPENDENCY",
          "Package locators cannot address another project.",
        );
      walk(identity(ref), next, visited);
    }
  };
  for (const key of packages.keys()) walk(key, new Set(), new Set());
}
