
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { AgentService } from "./service";
import { structuredContent } from "./page-structured";

export const codexPageReferenceExtension = ".showai-ref";
export const codexPageReferenceMaxLength = 4096;

const identity = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
export const codexPageIdentity = { projectId: identity, pageId: identity };
export const codexPageTarget = { ...codexPageIdentity, blockId: z.string().min(1).max(512).optional() };
export type CodexPageTarget = { projectId: string; pageId: string; blockId?: string };
const pageReference = z.strictObject({
  format: z.literal("showai-page-reference"),
  version: z.literal(1),
  ...codexPageIdentity,
});
const referenceFile = z.discriminatedUnion("version", [
  pageReference,
  pageReference.extend({ version: z.literal(2), blockId: codexPageTarget.blockId.unwrap() }),
]);

export async function readCodexPageTarget(service: AgentService, target: CodexPageTarget) {
  const { document } = await service.store.readPage(target.projectId, target.pageId);
  if (!target.blockId) return { projectId: target.projectId, pageId: target.pageId, title: document.title };
  const block = structuredContent(document).outline.find(item => item.id === target.blockId);
  if (!block) throw new Error("This block is no longer in the saved ShowAI Page: " + target.blockId);
  return { ...target, title: document.title, blockTitle: block.title.slice(0, 120) || block.kind || block.type };
}

export async function resolveCodexPageReference(
  service: AgentService,
  source: string,
) {
  const file = referenceFile.parse(JSON.parse(source));
  const target = { projectId: file.projectId, pageId: file.pageId, ...(file.version === 2 && { blockId: file.blockId }) };
  await readCodexPageTarget(service, target);
  return target;
}

export async function writeCodexPageReference(
  service: AgentService,
  directory: string | undefined,
  target: CodexPageTarget,
) {
  const page = await readCodexPageTarget(service, target);
  const contents = JSON.stringify(
    referenceFile.parse({
      format: "showai-page-reference",
      version: target.blockId ? 2 : 1,
      projectId: target.projectId,
      pageId: target.pageId,
      ...(target.blockId && { blockId: target.blockId }),
    }),
    null,
    2,
  ) + "\n";
  const root = directory ?? join(service.store.root, "local", "codex-page-references");
  await mkdir(root, { recursive: true });
  const output = await mkdtemp(join(root, "page-"));
  const title = page.title.replace(/[<>:"/\\|?*\p{C}]/gu, " ").trim().slice(0, 65);
  const name = "ShowAI - " + (title || "Page") + codexPageReferenceExtension;
  const path = join(output, name);
  try {
    await writeFile(path, contents, { flag: "wx", mode: 0o600 });
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
  return {
    ...page,
    path,
    file: {
      type: "resource_link" as const,
      uri: pathToFileURL(path).href,
      name,
      title: page.title,
      mimeType: "application/json",
      size: Buffer.byteLength(contents),
    },
  };
}
