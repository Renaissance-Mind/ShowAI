import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentLibrary as GitLibrary } from "./content-library";
import { FileStore } from "./store";
import { mutateLibrary } from "./library-runtime";
import { withChangeContext } from "./history-context";
import {
  importComponent,
  listComponents,
  readComponentSource,
  saveTemplate,
  instantiateTemplateRecord,
  promotePackage,
  packageRevisionRef,
  resolveDocumentComponents,
  saveComponent,
  getComponent,
} from "./catalog";
import type { ShowDocument } from "./model";
import type { ChangeContext } from "./history-model";

const actor: ChangeContext = {
  actor: { kind: "agent", harness: "codex", sessionId: "catalog-session" },
  channel: "cli",
  message: "Create interactive report",
};
describe("versioned component and template lifecycle", () => {
  let root: string;
  let library: GitLibrary;
  let store: FileStore;
  let projectId: string;
  let document: ShowDocument;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-versioned-catalog-"));
    library = new GitLibrary(root);
    await library.initialize();
    store = new FileStore(root);
    projectId = (await store.createProject({ name: "Report" })).id;
    document = (await store.createPage(projectId, { title: "Baseline" }))
      .document;
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("lists components without sample data and projects only the listing", async () => {
    const manifest = {
      id: "counter",
      name: "Counter",
      version: "1.0.0",
      entry: "index.tsx",
      description: "Editable number",
      scenarios: ["Adjust a value"],
      defaultData: { value: 1 },
      examples: [{ name: "One", data: { value: 1 } }],
    };
    const schema = {
      type: "object",
      properties: { value: { type: "number" } },
      required: ["value"],
      additionalProperties: false,
    };
    const source =
      "export default function Counter({data}) { return <p>{data.value}</p>; }\n";
    for (const version of ["1.0.0", "1.0.1"])
      await withChangeContext(actor, () =>
        saveComponent(
          root,
          { manifest: { ...manifest, version }, schema, source },
          projectId,
        ),
      );
    const listed = await listComponents(root, projectId, { scope: "project" });
    expect(listed.map((item) => item.version)).toEqual(["1.0.1", "1.0.0"]);
    for (const item of listed) {
      expect(item).not.toHaveProperty("defaultData");
      expect(item.examples).toEqual([{ name: "One" }]);
      expect(item.signature).toEqual(expect.any(String));
    }
    const projection = JSON.parse(
      await readFile(join(root, "local/catalog-metadata.json"), "utf8"),
    );
    expect(projection.version).toBe(2);
    expect(Object.keys(projection.entries)).toHaveLength(2);
    expect(JSON.stringify(projection)).not.toContain("defaultData");
    expect(
      (await getComponent(root, "counter", "1.0.0", projectId)).defaultData,
    ).toEqual({ value: 1 });
  });

  it("compiles and uses staged components before one atomic current-state update", async () => {
    const before = await library.head();
    const page = await withChangeContext(actor, () =>
      mutateLibrary(root, async () => {
        const component = await importComponent(
          root,
          join(import.meta.dirname, "../../resources/catalog/value-slider"),
          projectId,
        );
        expect(
          (await listComponents(root, projectId, { scope: "project" }))[0]
            .integrity,
        ).toBe(component.integrity);
        expect(
          (
            await readComponentSource(
              root,
              component.id,
              component.version,
              projectId,
            )
          ).source,
        ).toContain("export default");
        const source = structuredClone(document);
        source.content.content!.push({
          type: "widget",
          attrs: {
            id: "slider",
            kind: "custom",
            data: {
              componentId: component.id,
              version: component.version,
              integrity: component.integrity,
              props: component.defaultData,
            },
          },
        });
        const template = await saveTemplate(
          root,
          {
            id: "interactive-report",
            name: "交互报告",
            description: "参数探索",
            document: source,
          },
          projectId,
        );
        const expanded = await instantiateTemplateRecord(
          root,
          template,
          projectId,
        );
        const created = await store.createPage(projectId, {
          document: expanded,
        });
        expect(
          await resolveDocumentComponents(root, created.document, projectId),
        ).toHaveLength(1);
        expect(await library.head()).toBe(before);
        return created;
      }),
    );
    expect(page.revision).toBeTruthy();
    const current = await library.entryAt((await library.head())!);
    expect(current!.actor).toEqual(actor.actor);
    expect(current!.resources.map((resource) => resource.kind)).toEqual(
      expect.arrayContaining(["component", "template", "page"]),
    );
    expect(await library.history({ limit: 1 })).toEqual([]);
    expect(
      await resolveDocumentComponents(
        root,
        (await store.readPage(projectId, page.document.id)).document,
        projectId,
      ),
    ).toHaveLength(1);
    await library.verify();
  });

  it("preserves source bytes and promotes complete versions with the same fingerprint", async () => {
    const component = await withChangeContext(actor, () =>
      importComponent(
        root,
        join(import.meta.dirname, "../../resources/catalog/value-slider"),
        projectId,
      ),
    );
    const source = await readComponentSource(
      root,
      component.id,
      component.version,
      projectId,
    );
    const versionParts = source.manifest.version.split(".").map(Number);
    versionParts[2] += 1;
    const next = await withChangeContext(actor, () =>
      saveComponent(
        root,
        {
          ...source,
          manifest: {
            ...source.manifest,
            version: versionParts.join("."),
            description: "Updated description",
          },
        },
        projectId,
      ),
    );
    expect(next.integrity).not.toBe(component.integrity);
    expect(
      (await getComponent(root, component.id, component.version, projectId))
        .integrity,
    ).toBe(component.integrity);
    await withChangeContext(actor, () =>
      promotePackage(root, packageRevisionRef("component", next), {
        target: "global",
        projectId,
      }),
    );
    expect(
      (await listComponents(root, undefined, { scope: "global" }))[0].integrity,
    ).toBe(next.integrity);
    expect(
      (
        await readComponentSource(root, next.id, next.version, undefined, {
          scope: "global",
        })
      ).files,
    ).toEqual(
      (await readComponentSource(root, next.id, next.version, projectId)).files,
    );
  });
});
