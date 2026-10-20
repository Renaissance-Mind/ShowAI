import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLibrary } from "../core/open-library";
import { ContentLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { readOnboarding } from "../core/onboarding";
import { syncManager } from "../sync/manager";
import { seedSampleProject } from "./sample-project";
import { AgentService } from "./service";

const keys = ["kyoto", "attention", "foldable"] as const;
const samples = join(import.meta.dirname, "../../resources/samples");
const input = async (locale = "zh-CN") => ({
  name: "示例", // i18n-exempt: test fixture project name
  icon: "🧩",
  locale,
  pages: await Promise.all(
    keys.map(async (key) => ({
      key,
      artifact: await readFile(
        join(samples, locale, `${key}.showai.json`),
        "utf8",
      ),
    })),
  ),
});

async function withHome(test: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "showai-samples-"));
  try {
    await test(root);
  } finally {
    await syncManager(root).stop();
    await rm(root, { recursive: true, force: true });
  }
}

describe("sample project", () => {
  it("is created once in a new library and never comes back", () =>
    withHome(async (root) => {
      await openLibrary(root);
      expect((await readOnboarding(root))?.samples.state).toBe("pending");
      const store = new FileStore(root);
      const [first, concurrent] = await Promise.all([
        seedSampleProject(root, await input()),
        seedSampleProject(root, await input()),
      ]);
      expect(first?.state).toBe("seeded");
      expect(concurrent).toEqual(first);
      if (first?.state !== "seeded") throw new Error("not seeded");
      const projects = await store.listProjects();
      expect(projects.map((project) => project.name)).toEqual(["示例"]); // i18n-exempt: fixture
      const pages = await store.listPages(first.projectId);
      expect(pages.map((page) => page.id).sort()).toEqual(
        Object.values(first.pages).sort(),
      );
      // Pages keep their custom components and open with them.
      const service = new AgentService({ root });
      const kyoto = await service.readPage(first.projectId, first.pages.kyoto);
      expect(JSON.stringify(kyoto)).toContain("trip-route-map");

      // Removing the project (the workbench archives it) never restores it.
      await store.updateProject(first.projectId, { archived: true });
      expect(await seedSampleProject(root, await input())).toEqual(first);
      await openLibrary(root);
      expect(await seedSampleProject(root, await input())).toEqual(first);
      expect(
        (await store.listProjects({ includeArchived: true })).length,
      ).toBe(1);
      expect((await store.listProjects()).length).toBe(0);
    }));

  it("creates the English sample pages in the documented order", () =>
    withHome(async (root) => {
      await openLibrary(root);
      const seeded = await seedSampleProject(root, {
        ...(await input("en")),
        name: "Examples",
      });
      if (seeded?.state !== "seeded") throw new Error("not seeded");
      // The default directory order (newest first) lists the samples as given.
      const pages = await new FileStore(root).listPages(seeded.projectId);
      expect(
        pages
          .slice()
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map((page) => page.id),
      ).toEqual(keys.map((key) => seeded.pages[key]));
      expect(pages.map((page) => page.title).sort()).toEqual([
        "Attention, step by step",
        "Kyoto in five days",
        "Which foldable to buy?",
      ]);
    }));

  it("leaves libraries that the App did not create untouched", () =>
    withHome(async (root) => {
      await new ContentLibrary(root).initialize();
      await openLibrary(root);
      expect(await readOnboarding(root)).toBeNull();
      expect(await seedSampleProject(root, await input("en"))).toBeNull();
      expect(await new FileStore(root).listProjects()).toEqual([]);
    }));

  it("keeps a new library pending when the input is not a page source", () =>
    withHome(async (root) => {
      await openLibrary(root);
      await expect(
        seedSampleProject(root, {
          name: "Examples",
          locale: "en",
          pages: [{ key: "kyoto", artifact: "{}" }],
        }),
      ).rejects.toThrow();
      expect((await readOnboarding(root))?.samples.state).toBe("pending");
      expect(await new FileStore(root).listProjects()).toEqual([]);
    }));
});
