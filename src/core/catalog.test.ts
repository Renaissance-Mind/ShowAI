import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  blankDocument,
  componentWidgetData,
  getComponent,
  getTemplate,
  importComponent,
  importCompiledComponents,
  instantiateTemplate,
  instantiateTemplateRecord,
  listComponents,
  listBuiltinComponents,
  listTemplates,
  readComponentSource,
  readBuiltinComponentSource,
  resolvePackageBundle,
  validatePackageBundle,
  resolveDocumentComponents,
  saveComponent,
  saveTemplate,
  promotePackage,
  packageRevisionRef,
} from "./catalog";
import { upgradeDocument, visitNodes } from "../surface/document.mjs";
import { FileStore } from "./store";
import type { ComponentManifest } from "../components/custom/types";

const directories: string[] = [];
const projectIds = new Map<string, string>();
const project = (home: string) => projectIds.get(home)!;
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "showai-catalog-"));
  directories.push(path);
  projectIds.set(
    path,
    (await new FileStore(path).createProject({ name: "Catalog test" })).id,
  );
  return path;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const manifest: ComponentManifest = {
  id: "local-counter",
  name: "Counter",
  version: "1.0.0",
  description: "An editable numeric value",
  entry: "index.tsx",
  scenarios: ["Numeric input"],
  defaultData: { value: 0 },
  examples: [{ name: "Zero", data: { value: 0 } }],
};
const schema = {
  type: "object",
  properties: { value: { type: "number" } },
  required: ["value"],
  additionalProperties: false,
};
const source =
  'import {useState} from "react";export default function Counter({data,onChange}){const[value,setValue]=useState(data.value);return <button onClick={()=>{setValue(value+1);onChange?.({value:value+1})}}>{value}</button>}';

it("preserves a custom component category through saving and listing", async () => {
  const home = await temporary();
  const saved = await saveComponent(
    home,
    {
      manifest: { ...manifest, category: "data" },
      schema,
      source,
    },
    project(home),
  );
  expect(saved.category).toBe("data");
  expect((await listComponents(home, project(home)))[0].category).toBe("data");
  await expect(
    saveComponent(
      home,
      {
        manifest: {
          ...manifest,
          category: "invalid",
        } as unknown as ComponentManifest,
        schema,
        source,
      },
      project(home),
    ),
  ).rejects.toThrow("Component category");
});

it("React Flow can be composed through the SDK and exported without external scripts", async () => {
  const home = await temporary();
  const original = readBuiltinComponentSource("flowchart");
  const source = {
    ...original,
    manifest: { ...original.manifest, id: "workflow-diagram" },
  };
  const result = await saveComponent(home, source, project(home));
  expect(result.html).toContain("react-flow");
  expect(result.html).not.toMatch(/<script[^>]+src=/);
  expect(result.inline?.script).toBeTruthy();
  expect(result.inline?.styles).toContain("sf-node");
  const reloaded = await getComponent(
    home,
    result.id,
    result.version,
    project(home),
  );
  expect(reloaded.integrity).toBe(result.integrity);
});

describe("filesystem template catalog", () => {
  it("provides blank, research, comparison and brief without invented findings", async () => {
    const home = await temporary();
    expect(
      (await listTemplates(home, project(home))).map((item) => item.id),
    ).toEqual(["blank", "research", "comparison", "brief"]);
    const research = await getTemplate(home, "research", project(home));
    expect(research.scope).toBe("builtin");
    expect(
      research.document.content.content?.find((node) => node.type === "widget")
        ?.attrs?.data.rows,
    ).toEqual([]);
  });
  it("saves user and project templates with project precedence and instantiates a fresh page", async () => {
    const home = await temporary(),
      document = blankDocument();
    document.title = "Actual notes";
    document.content.content = [
      {
        type: "paragraph",
        attrs: { id: "original-block" },
        content: [{ type: "text", text: "A user-authored template." }],
      },
    ];
    const personal = await saveTemplate(
      home,
      {
        id: "research",
        name: "Personal",
        description: "Reusable",
        document,
      },
      project(home),
    );
    await promotePackage(home, packageRevisionRef("template", personal), {
      projectId: project(home),
      target: "global",
    });
    const projectOne = (
      await new FileStore(home).createProject({
        name: "Second catalog project",
      })
    ).id;
    await saveTemplate(
      home,
      { id: "research", name: "Project", description: "Local", document },
      projectOne,
    );
    expect((await getTemplate(home, "research", project(home))).name).toBe(
      "Personal",
    );
    expect((await getTemplate(home, "research", projectOne)).name).toBe(
      "Project",
    );
    expect(
      (await listTemplates(home, projectOne)).filter(
        (item) => item.id === "research",
      ),
    ).toHaveLength(3);
    const page = instantiateTemplate(personal.document);
    expect(page.id).not.toBe(document.id);
    expect(page.content.content?.[0].attrs?.id).not.toBe("original-block");
    expect(page.content.content?.[0].content?.[0].text).toBe(
      "A user-authored template.",
    );
    expect(document.content.content[0].attrs?.id).toBe("original-block");
  });
  it("rejects path traversal and symlink catalog writes", async () => {
    const home = await temporary(),
      outside = await temporary();
    await mkdir(join(home, "projects", project(home), "packages"));
    await symlink(
      outside,
      join(home, "projects", project(home), "packages/templates"),
    );
    await expect(
      saveTemplate(
        home,
        {
          name: "Unsafe",
          description: "",
          document: blankDocument(),
        },
        project(home),
      ),
    ).rejects.toThrow("Symbolic");
    await expect(
      getTemplate(home, "../outside", project(home)),
    ).rejects.toThrow("ids");
    await expect(listTemplates(home, "../../outside")).rejects.toThrow(
      "project",
    );
  });
});

it("expands composed whiteboard parts with stable source ids and remapped layout and view references", async () => {
  const home = await temporary();
  const page = upgradeDocument({ ...blankDocument(), title: "Spatial source" });
  const regionId = page.content.content![0].attrs!.id;
  page.views = {
    initial: "start",
    saved: [{ id: "start", name: "Start", targets: [regionId] }],
    readingOrder: [regionId],
  };
  const part = {
    type: "content" as const,
    content: page.content,
    layout: page.layout,
    views: page.views,
  };
  const saved = await saveTemplate(
    home,
    {
      name: "Whiteboard composition",
      description: "Two equal regions",
      document: page,
      composition: [part, part],
    },
    project(home),
  );
  const reread = await getTemplate(home, saved.id, project(home), {
    version: saved.version,
  });
  expect(reread.integrity).toBe(saved.integrity);
  const expanded = await instantiateTemplateRecord(home, reread, project(home));
  expect(expanded.content.type).toBe("surface");
  expect(expanded.content.content).toHaveLength(2);
  const ids: string[] = [];
  visitNodes(expanded.content, (node) => {
    if (node.attrs?.id) ids.push(node.attrs.id);
  });
  expect(new Set(ids).size).toBe(ids.length);
  expect(expanded.views!.saved).toHaveLength(2);
  expect(expanded.views!.initial).toBe(expanded.views!.saved[0].id);
  for (const view of expanded.views!.saved)
    expect(ids).toContain(view.targets[0]);
  for (const node of expanded.content.content!)
    expect(expanded.layout![node.attrs!.id].mode).toBe("flow");
});

describe("compiled React packages", () => {
  it("describes all built-in blocks for agents without importing browser renderers", () => {
    const builtins = listBuiltinComponents();
    expect(builtins.map((item) => item.kind)).toEqual([
      "text",
      "image",
      "table",
      "callout",
      "toggle",
      "divider",
      "code",
      "chart",
      "database",
      "metrics",
      "playground",
      "gallery",
      "bookmark",
      "flowchart",
    ]);
    expect(
      builtins.every((item) => item.propsSchema && item.scenarios.length),
    ).toBe(true);
  });
  it("imports actual TSX, bundles React offline, reads its source and resolves document references once", async () => {
    const home = await temporary();
    const component = await importComponent(
      home,
      resolve("resources/catalog/value-slider"),
      project(home),
    );
    expect(component.html).toContain("Content-Security-Policy");
    expect(component.html).toContain("<!--SHOWAI_COMPONENT_DATA-->");
    expect(component.html).not.toMatch(/<script[^>]+src=/);
    expect(component.inline?.script).toContain("ShowAIInlineComponent");
    expect(component.inline!.script.length).toBeLessThan(15000);
    expect(component.integrity).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(
      (
        await readComponentSource(
          home,
          "value-slider",
          component.version,
          project(home),
        )
      ).source,
    ).toContain("ValueSlider");
    const document = blankDocument();
    document.content.content = Array.from({ length: 2 }, () => ({
      type: "widget",
      attrs: { kind: "custom", data: componentWidgetData(component) },
    }));
    const resolved = await resolveDocumentComponents(
      home,
      document,
      project(home),
    );
    expect(resolved).toHaveLength(1);
    expect(resolved[0].html).toBe(component.html);
    expect(JSON.stringify(document)).not.toContain("<!doctype");
    expect((await listComponents(home, project(home)))[0].id).toBe(
      "value-slider",
    );
    expect((await listComponents(home, project(home)))[0]).not.toHaveProperty(
      "inline",
    );
  });
  it("uses immutable versions, validates defaults and examples, and allows a new version", async () => {
    const home = await temporary();
    const first = await saveComponent(
      home,
      { manifest, schema, source },
      project(home),
    );
    expect(
      (await saveComponent(home, { manifest, schema, source }, project(home)))
        .integrity,
    ).toBe(first.integrity);
    await expect(
      saveComponent(
        home,
        { manifest, schema, source: source + "\n// edited" },
        project(home),
      ),
    ).rejects.toThrow("immutable");
    await expect(
      saveComponent(
        home,
        {
          manifest: {
            ...manifest,
            id: "bad-default",
            defaultData: { value: "invalid" },
          },
          schema,
          source,
        },
        project(home),
      ),
    ).rejects.toThrow("props");
    await expect(
      saveComponent(
        home,
        {
          manifest: {
            ...manifest,
            id: "bad-example",
            examples: [{ name: "bad", data: {} }],
          },
          schema,
          source,
        },
        project(home),
      ),
    ).rejects.toThrow("props");
    await saveComponent(
      home,
      {
        manifest: { ...manifest, version: "1.0.1" },
        schema,
        source,
      },
      project(home),
    );
    expect(
      (await getComponent(home, manifest.id, undefined, project(home))).version,
    ).toBe("1.0.1");
  });
  it("compiles package-local modules and CSS but rejects Node, remote and escaping imports", async () => {
    const home = await temporary();
    const component = await saveComponent(
      home,
      {
        manifest,
        schema,
        source:
          'import "./styles.css";import Label from "./Label";export default function C(){return <Label/>}',
        files: {
          "styles.css": ".actual-label{color:green}",
          "Label.tsx":
            'export default function Label(){return <strong className="actual-label">Label</strong>}',
        },
      },
      project(home),
    );
    expect(component.html).toContain("actual-label");
    for (const [index, importPath] of [
      "node:fs",
      "https://example.com/code.js",
      "../../outside.ts",
      "react-dom/server",
    ].entries()) {
      await expect(
        saveComponent(
          home,
          {
            manifest: { ...manifest, id: `blocked-${index}` },
            schema,
            source: `import value from ${JSON.stringify(importPath)};export default function C(){return <pre>{String(value)}</pre>}`,
          },
          project(home),
        ),
      ).rejects.toThrow(/allowed|leave/);
    }
  });
  it("rejects package symlinks and detects modified compiled payloads", async () => {
    const home = await temporary(),
      packageDir = await temporary();
    await writeFile(
      join(packageDir, "manifest.json"),
      JSON.stringify(manifest),
    );
    await writeFile(
      join(packageDir, "props.schema.json"),
      JSON.stringify(schema),
    );
    await symlink(
      resolve("resources/catalog/value-slider/index.tsx"),
      join(packageDir, "index.tsx"),
    );
    await expect(
      importComponent(home, packageDir, project(home)),
    ).rejects.toThrow("symbolic");
    await saveComponent(home, { manifest, schema, source }, project(home));
    const path = join(
      home,
      "projects",
      project(home),
      "packages/components/local-counter/1.0.0/compiled.json",
    );
    const stored = JSON.parse(await readFile(path, "utf8"));
    stored.html += "<!-- modified -->";
    await writeFile(path, JSON.stringify(stored));
    await expect(
      getComponent(home, manifest.id, manifest.version, project(home)),
    ).rejects.toThrow("integrity");
  });
  it("resolves project packages without leaking into other projects and rejects mismatched props or integrity", async () => {
    const home = await temporary();
    const component = await saveComponent(
      home,
      { manifest, schema, source },
      project(home),
    );
    expect(await listComponents(home, undefined, { scope: "global" })).toEqual(
      [],
    );
    expect((await listComponents(home, project(home)))[0].scope).toBe(
      "project",
    );
    const document = blankDocument();
    document.content.content = [
      {
        type: "widget",
        attrs: {
          kind: "custom",
          data: {
            ...componentWidgetData(component),
            props: { value: "wrong" },
          },
        },
      },
    ];
    await expect(
      resolveDocumentComponents(home, document, project(home)),
    ).rejects.toThrow("props");
    document.content.content[0].attrs!.data = {
      ...componentWidgetData(component),
      integrity: "sha256-" + "0".repeat(64),
    };
    await expect(
      resolveDocumentComponents(home, document, project(home)),
    ).rejects.toThrow("integrity");
  });
  it("imports portable components without execution and can restore the original editable source", async () => {
    const firstHome = await temporary(),
      secondHome = await temporary();
    const component = await saveComponent(
      firstHome,
      {
        manifest,
        schema,
        source,
      },
      project(firstHome),
    );
    await importCompiledComponents(
      secondHome,
      [component],
      project(secondHome),
    );
    expect(
      (
        await getComponent(
          secondHome,
          manifest.id,
          manifest.version,
          project(secondHome),
        )
      ).html,
    ).toBe(component.html);
    await expect(
      readComponentSource(
        secondHome,
        manifest.id,
        manifest.version,
        project(secondHome),
      ),
    ).rejects.toThrow("no editable source");
    await expect(
      importCompiledComponents(
        secondHome,
        [{ ...component, html: component.html + "x" }],
        project(secondHome),
      ),
    ).rejects.toThrow("integrity");
    await saveComponent(
      secondHome,
      { manifest, schema, source },
      project(secondHome),
    );
    expect(
      (
        await readComponentSource(
          secondHome,
          manifest.id,
          manifest.version,
          project(secondHome),
        )
      ).source,
    ).toBe(source);
  });
  it("preserves embedded image files when editing a component into a new version", async () => {
    const home = await temporary();
    const assets = {
      "image.png":
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    };
    await saveComponent(
      home,
      {
        manifest,
        schema,
        source:
          'import image from "./image.png";export default function Image(){return <img src={image} alt="Asset"/>}',
        assets,
      },
      project(home),
    );
    const stored = await readComponentSource(
      home,
      manifest.id,
      manifest.version,
      project(home),
    );
    expect(stored.assets).toEqual(assets);
    const next = await saveComponent(
      home,
      {
        ...stored,
        manifest: { ...stored.manifest, version: "1.0.1" },
      },
      project(home),
    );
    expect(next.html).toContain("data:image/png;base64,");
  });
});

describe("component composition and editable primitives", () => {
  it("compiles every builtin starting source through the shared SDK", async () => {
    const home = await temporary();
    for (const item of listBuiltinComponents()) {
      const original = readBuiltinComponentSource(item.kind);
      const compiled = await saveComponent(
        home,
        {
          ...original,
          manifest: { ...original.manifest, id: `my-${item.kind}` },
        },
        project(home),
      );
      expect(compiled.html).toContain("Content-Security-Policy");
      expect(compiled.inline?.script).toBeTruthy();
      if (item.kind === "text")
        expect(compiled.inline!.script.length).toBeLessThan(80000);
      expect(compiled.defaultData).toEqual(item.defaultData);
    }
  }, 30000);

  it("bundles nested exact revisions, preserves closure and validates every dependency", async () => {
    const home = await temporary();
    const child = await saveComponent(
      home,
      { manifest, schema, source },
      project(home),
    );
    const wrapper = {
      ...manifest,
      id: "counter-panel",
      dependencies: [packageRevisionRef("component", child)],
    };
    const parent = await saveComponent(
      home,
      {
        manifest: wrapper,
        schema,
        source:
          'import Counter from "showai:component/local-counter";import {Text} from "showai:components";export default function Panel(props){return <section><Text data={{content:"## Nested counter"}} readOnly/><Counter {...props}/></section>}',
      },
      project(home),
    );
    const grandparent = await saveComponent(
      home,
      {
        manifest: {
          ...manifest,
          id: "counter-report",
          dependencies: [packageRevisionRef("component", parent)],
        },
        schema,
        source:
          'import Panel from "showai:component/counter-panel";export default function Report(props){return <Panel {...props}/>}',
      },
      project(home),
    );
    const bundle = await resolvePackageBundle(
      home,
      packageRevisionRef("component", grandparent),
      project(home),
    );
    expect(bundle.components.map((entry) => entry.component.id)).toEqual([
      child.id,
      parent.id,
      grandparent.id,
    ]);
    expect(() =>
      validatePackageBundle({
        ...bundle,
        components: bundle.components.slice(1),
      }),
    ).toThrow("Missing exact");
    await promotePackage(home, packageRevisionRef("component", grandparent), {
      projectId: project(home),
      target: "global",
    });
    await rm(join(home, "projects", project(home)), { recursive: true });
    const other = (
      await new FileStore(home).createProject({ name: "Consumer" })
    ).id;
    const editable = await readComponentSource(
      home,
      grandparent.id,
      grandparent.version,
      other,
      { scope: "global" },
    );
    const fork = await saveComponent(
      home,
      { ...editable, manifest: { ...editable.manifest, version: "1.0.1" } },
      other,
    );
    expect(fork.dependencies?.[0].integrity).toBe(parent.integrity);
    expect(fork.html).toContain("Nested counter");
    await expect(
      saveComponent(
        home,
        {
          manifest: { ...manifest, id: "missing-declaration" },
          schema,
          source:
            'import Child from "showai:component/local-counter";export default Child',
        },
        other,
      ),
    ).rejects.toThrow("Declare an exact");
    await expect(
      saveComponent(
        home,
        {
          manifest: {
            ...wrapper,
            id: "wrong-fingerprint",
            dependencies: [
              {
                ...packageRevisionRef("component", child),
                integrity: "sha256-" + "0".repeat(64),
              },
            ],
          },
          schema,
          source:
            'import Child from "showai:component/local-counter";export default Child',
        },
        other,
      ),
    ).rejects.toThrow(/integrity|not found/);
  }, 30000);
});
