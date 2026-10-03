import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore } from "./store";
import {
  blankDocument,
  componentWidgetData,
  forkPackage,
  getComponent,
  getComponentByRef,
  getTemplate,
  importPublishedBundle,
  instantiateTemplateRecord,
  listComponents,
  listTemplates,
  lockDocumentComponents,
  packageRevisionRef,
  previewPackageMerge,
  promotePackage,
  readComponentSource,
  resolveDocumentComponents,
  resolvePackageBundle,
  saveComponent,
  savePackageMerge,
  saveTemplate,
  validatePackageBundle,
} from "./catalog";
import { mergeValues } from "./catalog-merge";
import type {
  CompiledComponent,
  ComponentManifest,
  PackageRevisionRef,
  TemplateRecord,
} from "../components/custom/types";

const manifest: ComponentManifest = {
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
  properties: { value: { type: "number" }, unit: { type: "string" } },
  required: ["value"],
  additionalProperties: false,
};
const source =
  'const title = "Base";\nconst suffix = "!";\nexport default function Counter({data}) { return <p>{title}: {data.value}{suffix}</p>; }\n';
const exact = (
  kind: "component" | "template",
  item: { id: string; version: string; integrity: string },
): PackageRevisionRef => ({
  kind,
  id: item.id,
  version: item.version,
  integrity: item.integrity,
});

describe("immutable scoped catalog revisions", () => {
  let home: string, a: string, b: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "showai-revisions-"));
    const store = new FileStore(home);
    a = (await store.createProject({ name: "A" })).id;
    b = (await store.createProject({ name: "B" })).id;
  });
  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });
  const docFor = (component: CompiledComponent) => ({
    ...blankDocument(),
    content: {
      type: "doc",
      content: [
        {
          type: "widget",
          attrs: { kind: "custom", data: componentWidgetData(component) },
        },
      ],
    },
  });

  it("requires a real project for writes and only promotes explicitly to global", async () => {
    await expect(
      saveComponent(home, { manifest, schema, source }),
    ).rejects.toThrow("projectId");
    await expect(
      saveTemplate(home, {
        name: "Report",
        description: "",
        document: blankDocument(),
      }),
    ).rejects.toThrow("projectId");
    const component = await saveComponent(
      home,
      { manifest, schema, source },
      a,
    );
    expect(await listComponents(home)).toEqual([]);
    expect((await listComponents(home, a, { scope: "project" }))[0].scope).toBe(
      "project",
    );
    const promoted = await promotePackage(home, exact("component", component), {
      projectId: a,
      target: "global",
    });
    expect(promoted.root.scope).toBe("global");
    expect(
      (await getComponent(home, component.id, component.version, b)).integrity,
    ).toBe(component.integrity);
    await expect(
      saveComponent(home, { manifest, schema, source }, "missing-project"),
    ).rejects.toThrow();
  });

  it("resolves a fingerprint past a conflicting project shadow and freezes legacy refs", async () => {
    const global = await saveComponent(home, { manifest, schema, source }, a);
    await promotePackage(home, exact("component", global), {
      projectId: a,
      target: "global",
    });
    const local = await saveComponent(
      home,
      {
        manifest: {
          ...manifest,
          defaultData: { value: "local" },
          examples: [{ name: "Local", data: { value: "local" } }],
        },
        schema: { ...schema, properties: { value: { type: "string" } } },
        source: source.replace('"Base"', '"Local"'),
      },
      b,
    );
    expect(
      (await getComponent(home, manifest.id, manifest.version, b)).integrity,
    ).toBe(local.integrity);
    expect(
      (await getComponentByRef(home, exact("component", global), b)).integrity,
    ).toBe(global.integrity);
    const document = docFor(global);
    document.content.content!.push(docFor(local).content.content![0]);
    expect(await resolveDocumentComponents(home, document, b)).toHaveLength(2);
    delete document.content.content![0].attrs!.data.integrity;
    document.content.content![0].attrs!.data.scope = "global";
    const locked = await lockDocumentComponents(home, document, b);
    expect(locked.content.content![0].attrs!.data.integrity).toBe(
      global.integrity,
    );
    expect(locked.content.content![0].attrs!.data.scope).toBeUndefined();
    expect(document.content.content![0].attrs!.data.integrity).toBeUndefined();
    await expect(
      getComponentByRef(
        home,
        { ...exact("component", global), scope: "project" },
        b,
      ),
    ).rejects.toThrow("integrity");
  });

  it("preserves old user-scope component fingerprints without hash migration", async () => {
    const old = await saveComponent(home, { manifest, schema, source }, a);
    const sourcePath = join(
      home,
      "projects",
      a,
      "packages/components/counter/1.0.0/compiled.json",
    );
    const stored = JSON.parse(await readFile(sourcePath, "utf8"));
    stored.scope = "user";
    const path = join(home, "packages/components/counter/1.0.0");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "compiled.json"), JSON.stringify(stored));
    expect(await getComponent(home, "counter", "1.0.0")).toMatchObject({
      scope: "global",
      integrity: old.integrity,
    });
  });

  it("keeps versioned templates immutable and legacy flat templates read-only", async () => {
    const document = blankDocument();
    const first = await saveTemplate(
      home,
      {
        id: "report",
        name: "Report",
        description: "",
        document,
        version: "1.0.0",
      },
      a,
    );
    await expect(
      saveTemplate(
        home,
        {
          id: "report",
          name: "Changed",
          description: "",
          document,
          version: "1.0.0",
        },
        a,
      ),
    ).rejects.toThrow("immutable");
    expect(
      (await getTemplate(home, "report", a, { version: "1.0.0" })).integrity,
    ).toBe(first.integrity);
    const path = join(home, "packages/templates");
    await mkdir(path, { recursive: true });
    await writeFile(
      join(path, "legacy.json"),
      JSON.stringify({
        id: "legacy",
        name: "Legacy",
        description: "",
        scope: "user",
        updatedAt: new Date().toISOString(),
        document,
      }),
    );
    const legacy = await getTemplate(home, "legacy");
    expect(legacy).toMatchObject({
      scope: "global",
      version: "0.0.0-legacy",
      legacy: true,
    });
    const fork = (await forkPackage(home, exact("template", legacy), {
      projectId: a,
      version: "1.0.0",
    })) as TemplateRecord;
    expect(fork).toMatchObject({
      scope: "project",
      version: "1.0.0",
      parents: [exact("template", legacy)],
    });
    expect(fork.legacy).toBeUndefined();
  });

  it("promotes nested template/component closure that survives deletion of its source project", async () => {
    const component = await saveComponent(
      home,
      {
        manifest: {
          ...manifest,
          effects: ["Live numeric output"],
          examples: [
            {
              name: "One",
              data: { value: 1 },
              request: "Show a value",
              description: "Initial value",
            },
          ],
        },
        schema,
        source,
      },
      a,
    );
    const leaf = await saveTemplate(
      home,
      {
        id: "leaf",
        name: "Leaf",
        description: "Data",
        document: docFor(component),
      },
      a,
    );
    const root = await saveTemplate(
      home,
      {
        id: "report",
        name: "Report",
        description: "Nested report",
        document: blankDocument(),
        scenarios: ["Research"],
        contentGuide: [
          { title: "Evidence", instructions: ["Use measured data"] },
        ],
        related: [
          {
            kind: "template",
            id: "leaf",
            version: leaf.version,
            purpose: "Render evidence",
          },
        ],
        examples: [
          {
            name: "Research question",
            request: "Compare methods",
            steps: [{ kind: "template", id: "leaf", purpose: "Evidence" }],
          },
        ],
        composition: [
          {
            type: "content",
            content: {
              type: "paragraph",
              content: [{ type: "text", text: "Introduction" }],
            },
          },
          {
            type: "template",
            ref: { ...exact("template", leaf), scope: "project", projectId: a },
            title: "Evidence",
          },
        ],
      },
      a,
    );
    expect(root.dependencies).toHaveLength(2);
    const bundle = await promotePackage(home, exact("template", root), {
      projectId: a,
      target: "global",
    });
    expect(bundle.templates).toHaveLength(2);
    expect(bundle.components).toHaveLength(1);
    expect(bundle.components[0].source?.source).toBe(source);
    await rm(join(home, "projects", a), { recursive: true });
    const global = await getTemplate(home, root.id, undefined, {
      scope: "global",
      version: root.version,
      integrity: root.integrity,
    });
    expect(global.composition?.[1]).toEqual({
      type: "template",
      ref: exact("template", leaf),
      title: "Evidence",
    });
    const first = await instantiateTemplateRecord(home, global),
      second = await instantiateTemplateRecord(home, global);
    expect(JSON.stringify(first)).toContain("Introduction");
    expect(JSON.stringify(first)).toContain(component.integrity);
    expect(first.content.content?.[0].attrs?.id).not.toBe(
      second.content.content?.[0].attrs?.id,
    );
    const copiedHome = join(home, "independent-home");
    await mkdir(copiedHome);
    await cp(join(home, "packages"), join(copiedHome, "packages"), {
      recursive: true,
    });
    expect(
      (await instantiateTemplateRecord(copiedHome, exact("template", global)))
        .content.content,
    ).toHaveLength(3);
    expect(
      (await readComponentSource(copiedHome, component.id, component.version))
        .manifest.effects,
    ).toEqual(["Live numeric output"]);
  });

  it("preflights all promotion conflicts before exposing any new dependency", async () => {
    const original = await saveComponent(home, { manifest, schema, source }, a);
    await promotePackage(home, exact("component", original), {
      projectId: a,
      target: "global",
    });
    const conflict = await saveComponent(
      home,
      { manifest, schema, source: source.replace('"Base"', '"Conflict"') },
      b,
    );
    const unique = await saveComponent(
      home,
      { manifest: { ...manifest, id: "unique" }, schema, source },
      b,
    );
    const document = docFor(unique);
    document.content.content!.push(docFor(conflict).content.content![0]);
    const template = await saveTemplate(
      home,
      { id: "conflicted", name: "Conflict", description: "", document },
      b,
    );
    await expect(
      promotePackage(home, exact("template", template), {
        projectId: b,
        target: "global",
      }),
    ).rejects.toThrow("immutable");
    expect((await listComponents(home)).map((item) => item.id)).toEqual([
      "counter",
    ]);
    expect(
      (await listTemplates(home)).some((item) => item.id === "conflicted"),
    ).toBe(false);
  });

  it("validates published bundles and pins their immutable records", async () => {
    const component = await saveComponent(
      home,
      { manifest, schema, source },
      a,
    );
    const template = await saveTemplate(
      home,
      {
        id: "publish",
        name: "Publish",
        description: "",
        document: docFor(component),
      },
      a,
    );
    const bundle = await resolvePackageBundle(
      home,
      exact("template", template),
      a,
    );
    const damaged = structuredClone(bundle);
    damaged.components[0].component.html += "tampered";
    expect(() => validatePackageBundle(damaged)).toThrow("integrity");
    const incomplete = structuredClone(bundle);
    incomplete.components = [];
    expect(() => validatePackageBundle(incomplete)).toThrow("Missing exact");
    await importPublishedBundle(home, bundle);
    expect(
      (
        await getTemplate(home, "publish", b, {
          scope: "published",
          version: template.version,
        })
      ).integrity,
    ).toBe(template.integrity);
    await rm(join(home, "projects", a), { recursive: true });
    expect(
      await resolveDocumentComponents(
        home,
        await instantiateTemplateRecord(home, {
          ...exact("template", template),
          scope: "published",
        }),
        b,
      ),
    ).toHaveLength(1);
  });

  it("forks project revisions with parents without mutating global content", async () => {
    const component = await saveComponent(
      home,
      { manifest, schema, source },
      a,
    );
    await promotePackage(home, exact("component", component), {
      projectId: a,
      target: "global",
    });
    const parent = {
      ...exact("component", component),
      scope: "global" as const,
    };
    const fork = (await forkPackage(home, parent, {
      projectId: b,
      version: "1.1.0",
    })) as CompiledComponent;
    expect(fork.parents).toEqual([parent]);
    expect(fork.scope).toBe("project");
    expect((await getComponent(home, "counter", "1.0.0")).integrity).toBe(
      component.integrity,
    );
    expect(await listComponents(home, a, { scope: "project" })).toHaveLength(1);
    await expect(
      forkPackage(home, parent, { projectId: b, version: "1.0.0" }),
    ).rejects.toThrow("new exact version");
  });

  it("previews nonoverlapping source and JSON edits, then saves a new two-parent merge", async () => {
    const base = await saveComponent(home, { manifest, schema, source }, a);
    const baseRef = {
      ...exact("component", base),
      scope: "project" as const,
      projectId: a,
    };
    const ours = await saveComponent(
      home,
      {
        manifest: { ...manifest, version: "1.1.0", defaultData: { value: 2 } },
        schema,
        source: source.replace('"Base"', '"Ours"'),
        parents: [baseRef],
      },
      a,
    );
    const theirs = await saveComponent(
      home,
      {
        manifest: {
          ...manifest,
          version: "1.2.0",
          defaultData: { value: 1, unit: "ms" },
        },
        schema,
        source: source.replace('"!"', '"?"'),
        parents: [baseRef],
      },
      b,
    );
    const input = {
      projectId: a,
      base: baseRef,
      ours: { ...exact("component", ours), projectId: a },
      theirs: { ...exact("component", theirs), projectId: b },
    };
    const preview = await previewPackageMerge(home, input);
    expect(preview.conflicts).toEqual([]);
    if (preview.merged.kind !== "component")
      throw new Error("Expected component merge");
    expect(preview.merged.source).toContain('"Ours"');
    expect(preview.merged.source).toContain('"?"');
    expect(preview.merged.manifest.defaultData).toEqual({
      value: 2,
      unit: "ms",
    });
    const merged = await savePackageMerge(home, {
      ...input,
      version: "1.3.0",
      resolved: preview.merged,
    });
    expect(merged.parents).toEqual([input.ours, input.theirs]);
    expect(merged.mergeBase).toEqual(baseRef);
    expect(
      (await getComponentByRef(home, exact("component", base), a)).integrity,
    ).toBe(base.integrity);
    await expect(
      previewPackageMerge(home, {
        ...input,
        base: { ...baseRef, integrity: "sha256-" + "0".repeat(64) },
      }),
    ).rejects.toThrow("integrity");
  });

  it("reports overlapping text, field, and deletion conflicts without overwriting either side", () => {
    const result = mergeValues(
      { source: "a\nb\nc\n", data: { value: 1, nullable: null } },
      { source: "a\nours\nc\n", data: { value: 2 } },
      { source: "a\ntheirs\nc\n", data: { value: 3, nullable: "changed" } },
    );
    expect(result.conflicts.map((item) => item.path)).toEqual([
      "/source",
      "/data/value",
      "/data/nullable",
    ]);
    expect(result.value).toEqual({
      source: "a\nours\nc\n",
      data: { value: 2 },
    });
  });

  it("merges template content and guidance into a new project revision", async () => {
    const document = blankDocument();
    const base = await saveTemplate(
      home,
      { id: "merge-report", name: "Report", description: "Original", document },
      a,
    );
    const changed = structuredClone(document);
    changed.content.content = [
      { type: "paragraph", content: [{ type: "text", text: "Our evidence" }] },
    ];
    const ours = await saveTemplate(
      home,
      {
        id: base.id,
        version: "1.1.0",
        name: base.name,
        description: base.description,
        document: changed,
        parents: [exact("template", base)],
      },
      a,
    );
    const theirs = await saveTemplate(
      home,
      {
        id: base.id,
        version: "1.2.0",
        name: base.name,
        description: "Improved instructions",
        document,
        contentGuide: [{ title: "Evidence", instructions: ["Cite sources"] }],
        parents: [exact("template", base)],
      },
      a,
    );
    const input = {
      projectId: a,
      base: exact("template", base),
      ours: exact("template", ours),
      theirs: exact("template", theirs),
    };
    const preview = await previewPackageMerge(home, input);
    expect(preview.conflicts).toEqual([]);
    const merged = (await savePackageMerge(home, {
      ...input,
      version: "1.3.0",
      resolved: preview.merged,
    })) as TemplateRecord;
    expect(merged.parents).toEqual([input.ours, input.theirs]);
    expect(merged.description).toBe("Improved instructions");
    expect(merged.contentGuide[0].instructions).toEqual(["Cite sources"]);
    expect(
      JSON.stringify(
        (await instantiateTemplateRecord(home, merged, a)).content,
      ),
    ).toContain("Our evidence");
  });

  it("rejects source tampering when reading a locked base for a merge", async () => {
    const component = await saveComponent(
      home,
      { manifest, schema, source },
      a,
    );
    await writeFile(
      join(home, "projects", a, "packages/components/counter/1.0.0/index.tsx"),
      source + "\n// outside edit",
    );
    const ref = exact("component", component);
    await expect(
      previewPackageMerge(home, {
        projectId: a,
        base: ref,
        ours: ref,
        theirs: ref,
      }),
    ).rejects.toThrow("source integrity");
  });

  it.each(["component", "template"] as const)(
    "forks a merged %s with one current parent and no inherited mergeBase",
    async (kind) => {
      const base =
        kind === "component"
          ? await saveComponent(home, { manifest, schema, source }, a)
          : await saveTemplate(
              home,
              {
                id: "merged-report",
                name: "Report",
                description: "Original",
                document: blankDocument(),
              },
              a,
            );
      const baseRef = exact(kind, base);
      const ours =
        kind === "component"
          ? await saveComponent(
              home,
              {
                manifest: {
                  ...manifest,
                  version: "1.1.0",
                  description: "Ours",
                },
                schema,
                source,
                parents: [baseRef],
              },
              a,
            )
          : await saveTemplate(
              home,
              {
                ...(base as TemplateRecord),
                version: "1.1.0",
                description: "Ours",
                parents: [baseRef],
              },
              a,
            );
      const theirs =
        kind === "component"
          ? await saveComponent(
              home,
              {
                manifest: {
                  ...manifest,
                  version: "1.2.0",
                  scenarios: ["Theirs"],
                },
                schema,
                source,
                parents: [baseRef],
              },
              a,
            )
          : await saveTemplate(
              home,
              {
                ...(base as TemplateRecord),
                version: "1.2.0",
                scenarios: ["Theirs"],
                parents: [baseRef],
              },
              a,
            );
      const input = {
        projectId: a,
        base: baseRef,
        ours: exact(kind, ours),
        theirs: exact(kind, theirs),
      };
      const preview = await previewPackageMerge(home, input);
      expect(preview.conflicts).toEqual([]);
      const merged = await savePackageMerge(home, {
        ...input,
        version: "1.3.0",
        resolved: preview.merged,
      });
      expect(merged.mergeBase).toEqual(baseRef);
      const path = join(
        home,
        "projects",
        a,
        "packages",
        kind === "component" ? "components" : "templates",
        merged.id,
        merged.version,
        kind === "component" ? "compiled.json" : "template.json",
      );
      const before = await readFile(path, "utf8");
      const parent = exact(kind, merged);
      const fork = await forkPackage(home, parent, {
        projectId: a,
        version: "1.4.0",
      });
      expect(fork.parents).toEqual([parent]);
      expect(fork.mergeBase).toBeUndefined();
      expect(await readFile(path, "utf8")).toBe(before);
      if (kind === "component") {
        const forkSource = await readComponentSource(
          home,
          fork.id,
          fork.version,
          a,
        );
        expect(forkSource.parents).toEqual([parent]);
        expect(forkSource.mergeBase).toBeUndefined();
        expect(forkSource.manifest.mergeBase).toBeUndefined();
        expect(
          (await getComponent(home, merged.id, merged.version, a)).mergeBase,
        ).toEqual(baseRef);
      } else
        expect(
          (await getTemplate(home, merged.id, a, { version: merged.version }))
            .mergeBase,
        ).toEqual(baseRef);
    },
  );

  it("rejects an over-deep composition before publishing the new template", async () => {
    let previous = await saveTemplate(
      home,
      {
        id: "depth-0",
        name: "Root",
        description: "",
        document: blankDocument(),
      },
      a,
    );
    for (let depth = 1; depth <= 16; depth++)
      previous = await saveTemplate(
        home,
        {
          id: `depth-${depth}`,
          name: `Depth ${depth}`,
          description: "",
          composition: [{ type: "template", ref: exact("template", previous) }],
        },
        a,
      );
    await expect(
      saveTemplate(
        home,
        {
          id: "too-deep",
          name: "Too deep",
          description: "",
          composition: [{ type: "template", ref: exact("template", previous) }],
        },
        a,
      ),
    ).rejects.toThrow("16 levels");
    expect(
      (await listTemplates(home, a, { scope: "project" })).some(
        (item) => item.id === "too-deep",
      ),
    ).toBe(false);
  });

  it("clearly rejects missing composition refs and direct cycles", async () => {
    const leaf = await saveTemplate(
      home,
      { id: "leaf", name: "Leaf", description: "", document: blankDocument() },
      a,
    );
    await expect(
      saveTemplate(
        home,
        {
          id: "missing",
          name: "Missing",
          description: "",
          composition: [
            {
              type: "template",
              ref: { ...exact("template", leaf), id: "unavailable" },
            },
          ],
        },
        a,
      ),
    ).rejects.toThrow("not found");
    await expect(
      saveTemplate(
        home,
        {
          id: "leaf",
          version: leaf.version,
          name: "Cycle",
          description: "",
          composition: [
            { type: "template", ref: packageRevisionRef("template", leaf) },
          ],
        },
        a,
      ),
    ).rejects.toThrow("cycle");
  });
});
