import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentService } from "./service";

// Run against the bundled gateway files: project and page operations load the
// content worker beside the bundle, so a missing runtime file fails the image
// build instead of the first user request.
const root = await mkdtemp(join(tmpdir(), "showai-content-check-"));
try {
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
