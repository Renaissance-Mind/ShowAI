import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { withLibrarySnapshot } from "../core/library-runtime";
import { AgentService } from "./service";
import { inlinePresentation } from "./presentation";

/** One captured source revision, a complete reader and an optional focused preview. */
export async function presentPage(input: {
  root: string;
  projectId: string;
  pageId: string;
  blockIds?: string[];
}) {
  const directory = join(
    input.root,
    "local",
    "presentation-builds",
    randomUUID(),
  );
  await mkdir(directory, { recursive: true });
  try {
    return await withLibrarySnapshot(input.root, async () => {
      const service = new AgentService(input);
      const record = await service.store.readPage(
        input.projectId,
        input.pageId,
      );
      const full = await service.export({
        projectId: input.projectId,
        pageId: input.pageId,
        format: "html",
        presentation: "reading",
        out: join(directory, "page.html"),
      });
      const html = await readFile(full.path, "utf8");
      const source = await readFile(full.sourcePaths[0], "utf8");
      const selected = input.blockIds
        ? await service.export({
            projectId: input.projectId,
            pageId: input.pageId,
            blockIds: input.blockIds,
            format: "html",
            presentation: "reading",
            out: join(directory, "selection.html"),
          })
        : undefined;
      const preview = inlinePresentation(
        selected ? await readFile(selected.path, "utf8") : html,
      );
      return {
        title: record.document.title,
        document: record.document,
        pageId: record.document.id,
        projectId: input.projectId,
        hash: record.hash,
        revision: record.revision,
        html,
        source,
        ...preview,
        // This operation never initiates synchronization. HTTP adds its verified receipt.
        persistence: { savedToProject: true, synchronized: false },
        bytes: {
          html: Buffer.byteLength(html),
          inline: preview.inline ? Buffer.byteLength(preview.inline) : null,
        },
      };
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
