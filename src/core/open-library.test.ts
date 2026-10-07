import { describe, it, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "./open-library";
import { GitLibrary } from "./git-library";
import { FileStore } from "./store";
import { AgentService } from "../agent/service";
describe("default versioned libraries", () => {
  it("initializes a shared empty home once and records AgentService writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "showai-open-empty-"));
    try {
      await Promise.all([openLibrary(root), openLibrary(root)]);
      const manifest = await new GitLibrary(root).manifest();
      expect((await openLibrary(root)).initialized).toBe(false);
      expect((await new GitLibrary(root).manifest()).id).toBe(manifest.id);
      const project = await new AgentService({ root }).createProject(
        "Versioned by default",
      );
      expect(
        (await new GitLibrary(root).history())[0].resources[0].projectId,
      ).toBe(project.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("retains an existing original library until its reviewed import", async () => {
    const root = await mkdtemp(join(tmpdir(), "showai-open-original-"));
    try {
      const store = new FileStore(root),
        project = await store.createProject({ name: "Original" }),
        page = await store.createPage(project.id),
        before = await readFile(page.path);
      expect((await openLibrary(root)).mode).toBe("legacy");
      expect(await readFile(page.path)).toEqual(before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
