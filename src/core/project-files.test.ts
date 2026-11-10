import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContentLibrary } from "./content-library";
import { FileStore } from "./store";
import { LibraryOperations } from "./library-operations";
import { importComponent } from "./catalog";
import { mutateLibrary } from "./library-runtime";
import { parseArtifact } from "../portable/validation.mjs";
import type { ShowDocument } from "./model";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

test("a project's sync files carry each page's own dependency closure when pages share components", async () => {
  const root = await mkdtemp(join(tmpdir(), "showai-project-files-"));
  roots.push(root);
  await new ContentLibrary(root).initialize();
  const store = new FileStore(root);
  const project = (await store.createProject({ name: "Shared components" })).id;
  const catalog = join(import.meta.dirname, "../../resources/catalog");
  const components = await mutateLibrary(root, async () => [
    await importComponent(root, join(catalog, "value-slider"), project),
    await importComponent(root, join(catalog, "text-diagram"), project),
  ]);
  // Pages referencing both, one, or neither component.
  for (const used of [[0, 1], [1], [0, 1], []]) {
    const page = await store.createPage(project, { title: `Uses ${used}` });
    const document = structuredClone(page.document);
    for (const index of used) {
      const component = components[index];
      document.content.content!.push({
        type: "widget",
        attrs: {
          id: `${page.document.id}-${index}`,
          kind: "custom",
          data: {
            componentId: component.id,
            version: component.version,
            integrity: component.integrity,
            props: component.defaultData,
          },
        },
      });
    }
    await store.savePage(
      project,
      page.document.id,
      document,
      page.hash,
      page.revision,
    );
  }
  const library = new ContentLibrary(root);
  const head = (await library.head())!;
  const operations = new LibraryOperations(root, project);
  const files = await operations.projectFiles(project, head);
  // Each page resolved on its own, without the shared per-call state.
  const resolve = (
    operations as unknown as {
      dependencies(
        document: ShowDocument,
        projectId: string,
        revision: string,
      ): Promise<{ files: Map<string, Buffer> }>;
    }
  ).dependencies.bind(operations);
  const expected = new Map<string, Buffer>();
  for (const [path, bytes] of files)
    if (!path.includes("/packages/historical/")) expected.set(path, bytes);
  for (const [path, bytes] of files)
    if (/^projects\/[^/]+\/pages\/[^/]+\.json$/.test(path))
      for (const [name, content] of (
        await resolve(
          parseArtifact(JSON.parse(bytes.toString())).document,
          project,
          head,
        )
      ).files)
        expected.set(name, content);
  expect(
    [...files.keys()].filter((path) => path.includes("/packages/historical/")),
  ).not.toHaveLength(0);
  expect(new Map([...files].sort())).toEqual(new Map([...expected].sort()));
});
