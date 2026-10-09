import { createHash } from "node:crypto";
import { join } from "node:path";
import { ContentLibrary as GitLibrary } from "./content-library";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { parseArtifact } from "../portable/validation.mjs";
import { documentHash, indexBlocks, normalizeDocument } from "./diff";
import type { PageSummary } from "./model";

interface Entry {
  signature: string;
  summary: PageSummary;
}
interface SummaryCache {
  format: string;
  version: number;
  revision: string;
  entries: Record<string, Entry>;
  integrity: string;
}
const snapshots = new Map<string, Promise<Record<string, Entry>>>();
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A disposable projection. Page reads and writes still inspect the actual workspace. */
export async function pageSummaries(
  library: GitLibrary,
  revision: string,
): Promise<Record<string, Entry>> {
  const key = `${library.repository}:${revision}`;
  let task = snapshots.get(key);
  if (!task) {
    task = build(library, revision);
    snapshots.set(key, task);
    if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value!);
    task.catch(() => {
      if (snapshots.get(key) === task) snapshots.delete(key);
    });
  }
  return task;
}
async function build(library: GitLibrary, revision: string) {
  const path = join(library.root, "local", "page-summaries.json");
  const bytes = await readLibraryBytes(library.root, path);
  let previous: SummaryCache | undefined;
  if (bytes) {
    try {
      previous = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (
      previous &&
      (previous.format !== "showai-page-summaries" ||
        previous.version !== 1 ||
        !previous.entries ||
        previous.integrity !== digest([previous.revision, previous.entries]))
    )
      previous = undefined;
  }
  if (previous?.revision === revision) return previous.entries;
  const tree = await library.tree(revision);
  const signatures = new Map<string, string[]>();
  for (const entry of tree) {
    const match = entry.path.match(
      /^(projects\/[^/]+\/pages\/[^/.]+)(?:\.json|\/nodes\/[^/]+\.json|\/reader\.json)$/,
    );
    if (!match) continue;
    const page = match[1] + ".json";
    if (!signatures.has(page)) signatures.set(page, []);
    signatures.get(page)!.push(entry.path + ":" + entry.oid);
  }
  const paths = tree
    .map((e) => e.path)
    .filter((path) => /^projects\/[^/]+\/pages\/[^/.]+\.json$/.test(path));
  const changed = paths.filter(
    (path) =>
      previous?.entries[path]?.signature !== digest(signatures.get(path)),
  );
  const loaded = new Map<string, Buffer>();
  for (let offset = 0; offset < changed.length; offset += 32)
    for (const [path, bytes] of await library.readFiles(
      changed.slice(offset, offset + 32),
      revision,
    ))
      loaded.set(path, bytes);
  const entries: Record<string, Entry> = {};
  for (const path of paths) {
    const signature = digest(signatures.get(path));
    const prior = previous?.entries[path];
    const document = loaded.has(path)
      ? normalizeDocument(
          parseArtifact(JSON.parse(loaded.get(path)!.toString("utf8")))
            .document,
        )
      : undefined;
    if (document && document.id !== path.split("/").at(-1)!.slice(0, -5))
      throw new Error("Page id differs from its filename.");
    const summary = document
      ? {
          id: document.id,
          title: document.title,
          updatedAt: document.updatedAt,
          icon: document.icon,
          hash: documentHash(document),
          blockCount: indexBlocks(document).size,
          parentId: document.parentId,
          favorite: document.favorite,
          archived: document.archived,
        }
      : prior!.summary;
    // Even A → B → A must retain its latest resource revision, not an old hash match.
    const resourceRevision = await library.resourceRevision(path, revision);
    entries[path] = {
      signature,
      summary: {
        ...summary,
        ...(resourceRevision ? { revision: resourceRevision } : {}),
      },
    };
  }
  const cache: SummaryCache = {
    format: "showai-page-summaries",
    version: 1,
    revision,
    entries,
    integrity: digest([revision, entries]),
  };
  await atomicLibraryFile(
    library.root,
    path,
    Buffer.from(JSON.stringify(cache)),
  );
  return entries;
}
