import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentService } from "./service";

// Run against the bundled gateway files: project and page operations load the
// content worker beside the bundle, so a missing runtime file fails the image
// build instead of the first user request.
const root = await mkdtemp(join(tmpdir(), "showai-content-check-"));
try {
  async function readableTree(path: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await readableTree(child);
      else await readFile(child);
    }
  }
  await readableTree(
    fileURLToPath(new URL("../assets/agent-plugin", import.meta.url)),
  );
  const service = new AgentService({ root });
  const project = await service.createProject("Content check");
  await service.createPage(project.id, { title: "Content check page" });
  const pages = await service.listPages(project.id);
  if (!pages.some((page) => page.title === "Content check page"))
    throw new Error("The created page is missing from the project.");
  await service.search({ query: "Content check", projectId: project.id });
  console.log(JSON.stringify({ passed: true, pages: pages.length }));
} finally {
  await rm(root, { recursive: true, force: true });
}
