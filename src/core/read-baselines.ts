import { createHash } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicLibraryFile, readLibraryBytes } from "./library-files";
import { changeContext } from "./history-context";
import { documentHash } from "./diff";
import type { PageRecord, ShowDocument } from "./model";

/** One active read baseline per session/page, bounded and replaceable like a cache. */
export class ReadBaselines {
  constructor(readonly home: string) {}
  private directory() {
    return join(this.home, "local", "read-baselines");
  }
  async remember(projectId: string, record: PageRecord) {
    const actor = changeContext().actor;
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          actor.harness,
          actor.sessionId,
          projectId,
          record.document.id,
        ]),
      )
      .digest("hex");
    await atomicLibraryFile(
      this.home,
      join(this.directory(), `${id}.json`),
      Buffer.from(
        JSON.stringify({
          projectId,
          pageId: record.document.id,
          hash: record.hash,
          revision: record.revision,
          document: record.document,
        }),
      ),
    );
    const names = (await readdir(this.directory())).filter((name) =>
      /^[a-f0-9]{64}\.json$/.test(name),
    );
    if (names.length <= 64) return;
    const entries = await Promise.all(
      names.map(async (name) => ({
        name,
        time: (await stat(join(this.directory(), name))).mtimeMs,
      })),
    );
    entries.sort((a, b) => b.time - a.time);
    for (const entry of entries.slice(64))
      await rm(join(this.directory(), entry.name), { force: true });
  }
  async read(
    projectId: string,
    pageId: string,
    token: string,
  ): Promise<ShowDocument | undefined> {
    const names = await readdir(this.directory()).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const bytes = await readLibraryBytes(
        this.home,
        join(this.directory(), name),
      );
      if (!bytes) continue;
      const record = JSON.parse(bytes.toString());
      if (
        record.projectId === projectId &&
        record.pageId === pageId &&
        (record.hash === token || record.revision === token) &&
        record.document?.id === pageId &&
        documentHash(record.document) === record.hash
      )
        return record.document;
    }
    return undefined;
  }
}
