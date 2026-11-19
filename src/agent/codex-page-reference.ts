
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { AgentService } from "./service";

export const codexPageReferenceExtension = ".showai-ref";
export const codexPageReferenceMaxLength = 4096;

const identity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const codexPageIdentity = { projectId: identity, pageId: identity };
const pageReference = z.strictObject({
  format: z.literal("showai-page-reference"),
  version: z.literal(1),
  ...codexPageIdentity,
});

export async function resolveCodexPageReference(
  service: AgentService,
  source: string,
) {
  const { projectId, pageId } = pageReference.parse(JSON.parse(source));
  await service.store.readPage(projectId, pageId);
  return { projectId, pageId };
}

export async function writeCodexPageReference(
  service: AgentService,
  directory: string | undefined,
  projectId: string,
  pageId: string,
) {
  const { document } = await service.store.readPage(projectId, pageId);
  const contents = JSON.stringify(
    pageReference.parse({
      format: "showai-page-reference",
      version: 1,
      projectId,
      pageId,
    }),
    null,
    2,
  ) + "\n";
  const root = directory ?? join(service.store.root, "local", "codex-page-references");
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, "page-"));
  const title = document.title.replace(/[<>:"/\\|?*\p{C}]/gu, " ").trim().slice(0, 65);
  const name = "ShowAI - " + (title || "Page") + codexPageReferenceExtension;
  const path = join(output, name);
  try {
    await writeFile(path, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  return {
    title: document.title,
    projectId,
    pageId,
    path,
    file: {
      type: "resource_link" as const,
      uri: pathToFileURL(path).href,
      name,
      title: document.title,
      mimeType: "application/json",
      size: Buffer.byteLength(contents),
    },
  };
}
