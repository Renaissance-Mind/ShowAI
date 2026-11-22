import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { refreshDocsIndex } from "../../scripts/docs-project.mjs";
import manifest from "../../resources/docs/manifest.json";
import { AgentService } from "../agent/service";
import {
  readComponentSource,
  resolveDocumentComponents,
  saveComponent,
} from "../core/catalog";
import { SyncManager } from "../sync/manager";
import { openLibrary } from "../core/open-library";
import { FileStore } from "../core/store";
import { walkComponentReferences } from "../document/walk.mjs";

it("saves workbench edits to the source page and builds its updated component into the App index", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-docs-authoring-"));
  try {
    const project = manifest.projectId,
      page = manifest.slugs["quick-start"];
    const original = fileURLToPath(
      new URL("../../resources/docs/", import.meta.url),
    );
    const inputs = new Set(["routes.json", "manifest.json", "files.ts"]);
    for (const [locale, edition] of Object.entries(manifest.locales)) {
      inputs.add(`${locale}/sidebar.json`);
      inputs.add(`${locale}/projects/${project}/project.json`);
      for (const entry of Object.values(edition.pages)) {
        inputs.add(entry.file);
        for (const component of entry.components)
          inputs.add(dirname(component));
      }
    }
    for (const input of inputs) {
      await mkdir(dirname(join(root, input)), { recursive: true });
      await cp(join(original, input), join(root, input), { recursive: true });
    }
    const titles = new Map<string, string>();
    let archived = "";
    let updatedPackage = "";
    for (const locale of ["zh-CN", "en"] as const) {
      const home = join(root, locale);
      expect((await openLibrary(home)).mode).toBe("legacy");
      await new SyncManager(home).run();
      const store = new FileStore(home);
      expect((await store.readSidebar()).projectOrder).toContain(project);
      expect((await store.listProjects()).map((entry) => entry.id)).toContain(
        project,
      );
      expect((await store.readProject(project)).name).toBe(
        manifest.locales[locale].name,
      );
      const packages = new Set<string>();
      for (const id of Object.keys(manifest.locales[locale].pages)) {
        const { document } = await store.readPage(project, id);
        for (const component of await resolveDocumentComponents(
          home,
          document,
          project,
        )) {
          const key = component.id + "@" + component.version;
          if (packages.has(key)) continue;
          const source = await readComponentSource(
            home,
            component.id,
            component.version,
            project,
          );
          expect(source.source).toBe(source.files?.[source.manifest.entry]);
          packages.add(key);
        }
      }
      const record = await store.readPage(project, page);
      const doc = structuredClone(record.document);
      doc.title += " (edited)";
      titles.set(locale, doc.title);
      if (locale === "zh-CN") {
        const draft = await store.createPage(project, { title: "Draft" });
        archived = draft.document.id;
        await store.updatePageMetadata(
          project,
          archived,
          { archived: true },
          draft.hash,
        );
        const [current] = await resolveDocumentComponents(home, doc, project);
        const source = await readComponentSource(
          home,
          current.id,
          current.version,
          project,
        );
        const version = current.version.split("-")[0] + "-docs-authoring-test";
        const component = await saveComponent(
          home,
          {
            ...source,
            manifest: { ...source.manifest, version },
            files: {
              ...source.files,
              "style.css":
                (source.files?.["style.css"] ?? "") +
                "\n.docs-edit-example { color: red; }",
            },
          },
          project,
        );
        updatedPackage = `/${component.id}/${version}/compiled.json`;
        expect(component.inline?.styles).toContain(".docs-edit-example");
        walkComponentReferences(doc.content, (data) => {
          const ref = data as {
            componentId: string;
            version: string;
            integrity: string;
          };
          if (ref.componentId === component.id) {
            ref.version = component.version;
            ref.integrity = component.integrity;
          }
        });
        doc.content.content!.push({
          type: "paragraph",
          attrs: { id: "docs-edit-example" },
          content: [{ type: "text", text: "编辑后在 App 中显示的正文" }],
        });
      }
      await new AgentService({ root: home }).savePage(
        project,
        page,
        doc,
        record.hash,
      );
      expect(
        (await new FileStore(home).readPage(project, page)).document.title,
      ).toBe(doc.title);
    }
    expect(() => refreshDocsIndex(root, true)).toThrow(/out of date/);
    refreshDocsIndex(root);
    refreshDocsIndex(root, true);
    const index = JSON.parse(
      await readFile(join(root, "manifest.json"), "utf8"),
    );
    expect(await readFile(join(root, "files.ts"), "utf8")).not.toContain(
      archived,
    );
    const zh = index.locales["zh-CN"].pages[page];
    expect(zh.title).toBe(titles.get("zh-CN"));
    expect(zh.components).toContainEqual(
      expect.stringContaining(updatedPackage),
    );
    expect(await readFile(join(root, zh.file), "utf8")).toContain(
      "编辑后在 App 中显示的正文",
    );
    expect(index.locales.en.pages[page].title).toBe(titles.get("en"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
