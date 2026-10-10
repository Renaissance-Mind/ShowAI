import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContentLibrary as GitLibrary } from "./content-library";
import { FileStore } from "./store";
import { LibraryOperations } from "./library-operations";
import { EditorDrafts } from "./editor-drafts";
import {
  importComponent,
  importCompiledComponents,
  getComponent,
  readComponentSource,
  saveComponent,
  saveTemplate,
  getTemplate,
} from "./catalog";
import type {
  ComponentSource,
  ComponentManifest,
} from "../components/custom/types";
describe("external immutable package recovery", () => {
  let root: string,
    library: GitLibrary,
    projectId: string,
    operations: LibraryOperations;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "showai-package-recovery-"));
    library = new GitLibrary(root);
    await library.initialize();
    projectId = (
      await new FileStore(root).createProject({ name: "Package recovery" })
    ).id;
    operations = new LibraryOperations(root, projectId);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  it.each(["historical", "retained-source"])(
    "recovers external edits in %s packages",
    async (area) => {
      const original = await importComponent(
        root,
        join(import.meta.dirname, "../../resources/catalog/value-slider"),
        projectId,
      );
      const ordinary = `projects/${projectId}/packages/components/${original.id}/${original.version}/`;
      let prefix: string;
      if (area === "retained-source") {
        const other = (
          await new FileStore(root).createProject({ name: "Retained sources" })
        ).id;
        await importCompiledComponents(root, [original], other);
        await importComponent(
          root,
          join(import.meta.dirname, "../../resources/catalog/value-slider"),
          other,
        );
        projectId = other;
        operations = new LibraryOperations(root, other);
        prefix = `projects/${other}/packages/components/${original.id}/.sources/${original.integrity}/`;
      } else {
        prefix = `projects/${projectId}/packages/historical/components/${original.integrity}/`;
        const files = await library.readFiles(
          (await library.tree())
            .filter((item) => item.path.startsWith(ordinary))
            .map((item) => item.path),
        );
        const edits = new Map<string, Buffer | null>();
        for (const [path, bytes] of files) {
          edits.set(prefix + path.slice(ordinary.length), bytes);
          edits.set(path, null);
        }
        await library.writeFiles(edits, {
          actor: { kind: "human" },
          channel: "system",
          message: "Restore exact dependency",
        });
      }
      const path = join(library.workspace, prefix, "index.tsx"),
        before = await readFile(path, "utf8"),
        changed = before + "\n// retained external edit\n";
      await writeFile(path, changed);
      const conflicts = await operations.conflicts(projectId);
      expect(conflicts).toHaveLength(1);
      const recovered = await operations.recoverPackage({
        id: conflicts[0].id,
        clientId: "retained-source-window",
      });
      const form = (await new EditorDrafts(root).read(recovered.draft.id))
        .content as { code: string; version: string };
      expect(form.code).toBe(changed);
      expect(form.version).toBe("1.1.2");
      expect(await readFile(path, "utf8")).toBe(before);
      expect(await operations.conflicts(projectId)).toEqual([]);
    },
    15000,
  );
  it("retains changed portable runtime bundles without inventing editable source", async () => {
    const original = await importComponent(
        root,
        join(import.meta.dirname, "../../resources/catalog/value-slider"),
        projectId,
      ),
      other = (
        await new FileStore(root).createProject({ name: "Portable only" })
      ).id;
    await importCompiledComponents(root, [original], other);
    const path = join(
      library.workspace,
      "projects",
      other,
      `packages/components/${original.id}/${original.version}/compiled.json`,
    );
    await writeFile(path, "externally changed generated runtime");
    const ops = new LibraryOperations(root, other),
      [conflict] = await ops.conflicts(other),
      recovered = await ops.recoverPackage({
        id: conflict.id,
        clientId: "portable-recovery",
      });
    const form = (await new EditorDrafts(root).read(recovered.draft.id))
      .content as { code: string; recoveryFiles: Record<string, string> };
    expect(form.code).toBe("");
    expect(form.recoveryFiles["compiled.json"]).toBe(`conflict:${conflict.id}`);
    expect(
      (await getComponent(root, original.id, original.version, other))
        .integrity,
    ).toBe(original.integrity);
  });
  it("retains changed source, incomplete JSON and added binary assets, restores the immutable projection and compiles a new version", async () => {
    const component = await importComponent(
        root,
        join(import.meta.dirname, "../../resources/catalog/value-slider"),
        projectId,
      ),
      prefix = join(
        library.workspace,
        "projects",
        projectId,
        "packages/components/value-slider/1.1.1",
      );
    const original = await readFile(join(prefix, "index.tsx"), "utf8");
    const changed = `${original}\n// externally edited source\n`;
    await writeFile(join(prefix, "index.tsx"), changed);
    await writeFile(join(prefix, "props.schema.json"), '{"unfinished":');
    await writeFile(
      join(prefix, "extra.png"),
      Buffer.from("binary asset bytes"),
    );
    const conflicts = await operations.conflicts(projectId);
    expect(conflicts.length).toBe(3);
    const recovered = await operations.recoverPackage({
      id: conflicts[0].id,
      clientId: "recover-window",
    });
    expect(await readFile(join(prefix, "index.tsx"), "utf8")).toBe(original);
    expect(await operations.conflicts(projectId)).toEqual([]);
    const draft = await new EditorDrafts(root).read(recovered.draft.id);
    const form = draft.content as {
      code: string;
      schema: string;
      source: ComponentSource;
      version: string;
      origin: unknown;
      recoveryFiles: Record<string, string>;
    };
    expect(form.code).toBe(changed);
    expect(form.schema).toBe('{"unfinished":');
    expect(form.version).toBe("1.1.2");
    expect(form.source.assets?.["extra.png"]).toBe(
      Buffer.from("binary asset bytes").toString("base64"),
    );
    const current = await readComponentSource(
      root,
      component.id,
      component.version,
      projectId,
    );
    const saved = await saveComponent(
      root,
      {
        ...form.source,
        manifest: { ...current.manifest, version: form.version },
        schema: current.schema,
        source: form.code,
      },
      projectId,
    );
    expect(saved.version).toBe("1.1.2");
    expect(
      (await getComponent(root, component.id, component.version, projectId))
        .integrity,
    ).toBe(component.integrity);
    expect(
      (await readComponentSource(root, saved.id, saved.version, projectId))
        .source,
    ).toBe(changed);
  }, 15000);
  it("preserves malformed manifests as repairable form data and enforces project binding", async () => {
    await importComponent(
      root,
      join(import.meta.dirname, "../../resources/catalog/value-slider"),
      projectId,
    );
    const path = join(
      library.workspace,
      "projects",
      projectId,
      "packages/components/value-slider/1.1.1/manifest.json",
    );
    await writeFile(path, "{incomplete manifest");
    const [conflict] = await operations.conflicts(projectId);
    await expect(
      new LibraryOperations(root, "foreign-project").recoverPackage({
        id: conflict.id,
        clientId: "foreign",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PATH" });
    const recovered = await operations.recoverPackage({
      id: conflict.id,
      clientId: "owner",
    });
    const value = (await new EditorDrafts(root).read(recovered.draft.id))
      .content as {
      manifestJson: string;
      source: { manifest: ComponentManifest };
    };
    expect(value.manifestJson).toBe("{incomplete manifest");
    expect(value.source.manifest.id).toBe("value-slider");
  });
  it("recovers template edits into a new-version draft without changing an existing template identity", async () => {
    const store = new FileStore(root),
      page = await store.createPage(projectId),
      template = await saveTemplate(
        root,
        {
          id: "recovery-template",
          name: "Original template",
          description: "before",
          document: page.document,
        },
        projectId,
      );
    const path = join(
        library.workspace,
        "projects",
        projectId,
        `packages/templates/${template.id}/${template.version}/template.json`,
      ),
      raw = JSON.parse(await readFile(path, "utf8"));
    raw.description = "external description";
    await writeFile(path, JSON.stringify(raw));
    const [conflict] = await operations.conflicts(projectId),
      recovered = await operations.recoverPackage({
        id: conflict.id,
        clientId: "template-editor",
      });
    const form = (await new EditorDrafts(root).read(recovered.draft.id))
      .content as {
      description: string;
      version: string;
      document: typeof page.document;
    };
    expect(form.description).toBe("external description");
    expect((await getTemplate(root, template.id, projectId)).integrity).toBe(
      template.integrity,
    );
    const saved = await saveTemplate(
      root,
      {
        id: template.id,
        name: template.name,
        description: form.description,
        version: form.version,
        document: form.document,
      },
      projectId,
    );
    expect(saved.integrity).not.toBe(template.integrity);
  });
});
