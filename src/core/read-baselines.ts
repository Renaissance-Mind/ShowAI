import { createHash } from "node:crypto";
import { readdir, rm, stat, utimes } from "node:fs/promises";
import { join } from "node:path";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import type { PageRecord, ShowDocument } from "./model";

const BASELINES = 64;
const ALIASES = 256;

function key(...parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
function digest(json: string) {
  return createHash("sha256").update(json).digest("hex");
}

/**
 * Page versions that sessions and people read, kept as a bounded cache so a
 * later diff can compare against them. Each version is stored once under a
 * name derived from its page and hash, with a small alias per revision, so a
 * lookup opens at most two files and a repeated read of an unchanged page
 * rewrites nothing.
 */
export class ReadBaselines {
  constructor(readonly home: string) {}
  private directory() {
    return join(this.home, "local", "read-baselines");
  }
  private documentPath(projectId: string, pageId: string, hash: string) {
    return join(this.directory(), `${key(projectId, pageId, hash)}.json`);
  }
  private aliasPath(projectId: string, pageId: string, revision: string) {
    return join(
      this.directory(),
      `${key(projectId, pageId, "revision", revision)}.ref`,
    );
  }

  async remember(projectId: string, record: PageRecord) {
    const pageId = record.document.id;
    const path = this.documentPath(projectId, pageId, record.hash);
    const now = new Date();
    // The same version keeps its file; refreshing its time keeps it in the cache.
    const kept = await utimes(path, now, now).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (!kept) {
      const document = JSON.stringify(record.document);
      await atomicLibraryFile(
        this.home,
        path,
        Buffer.from(
          `{"projectId":${JSON.stringify(projectId)},"pageId":${JSON.stringify(pageId)},"hash":${JSON.stringify(record.hash)},"digest":"${digest(document)}","document":${document}}`,
        ),
      );
    }
    if (record.revision)
      await atomicLibraryFile(
        this.home,
        this.aliasPath(projectId, pageId, record.revision),
        Buffer.from(JSON.stringify({ hash: record.hash })),
      );
    await this.prune();
  }

  /** Keeps the most recently used versions and aliases. */
  private async prune() {
    const names = await readdir(this.directory());
    for (const [pattern, limit] of [
      [/^[a-f0-9]{64}\.json$/, BASELINES],
      [/^[a-f0-9]{64}\.ref$/, ALIASES],
    ] as const) {
      const matching = names.filter((name) => pattern.test(name));
      if (matching.length <= limit) continue;
      const entries = await Promise.all(
        matching.map(async (name) => ({
          name,
          time: (await stat(join(this.directory(), name))).mtimeMs,
        })),
      );
      entries.sort((a, b) => b.time - a.time);
      for (const entry of entries.slice(limit))
        await rm(join(this.directory(), entry.name), { force: true });
    }
  }

  /** The document of the version with this hash or revision, if still kept. */
  async read(
    projectId: string,
    pageId: string,
    token: string,
  ): Promise<ShowDocument | undefined> {
    const direct = await this.load(projectId, pageId, token);
    if (direct) return direct;
    const alias = await readLibraryBytes(
      this.home,
      this.aliasPath(projectId, pageId, token),
    );
    if (!alias) return undefined;
    const { hash } = JSON.parse(alias.toString()) as { hash?: unknown };
    return typeof hash === "string"
      ? this.load(projectId, pageId, hash)
      : undefined;
  }

  private async load(projectId: string, pageId: string, hash: string) {
    const bytes = await readLibraryBytes(
      this.home,
      this.documentPath(projectId, pageId, hash),
    );
    if (!bytes) return undefined;
    const record = JSON.parse(bytes.toString());
    // A damaged or hand-edited file is not a baseline.
    if (
      record.projectId === projectId &&
      record.pageId === pageId &&
      record.hash === hash &&
      record.document?.id === pageId &&
      record.digest === digest(JSON.stringify(record.document))
    )
      return record.document as ShowDocument;
    return undefined;
  }
}

