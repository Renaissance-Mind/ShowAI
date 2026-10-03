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
  listComponents,
  listBuiltinComponents,
  listTemplates,
  readComponentSource,
  resolveDocumentComponents,
  saveComponent,
  saveTemplate,
} from "./catalog";
import type { ComponentManifest } from "../components/custom/types";

const directories: string[] = [];
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "showai-catalog-"));
  directories.push(path);
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

describe("filesystem template catalog", () => {
  it("provides blank, research, comparison and brief without invented findings", async () => {
    const home = await temporary();
    expect((await listTemplates(home)).map((item) => item.id)).toEqual([
      "blank",
      "research",
      "comparison",
      "brief",
    ]);
    const research = await getTemplate(home, "research");
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
    const personal = await saveTemplate(home, {
      id: "research",
      name: "Personal",
      description: "Reusable",
      document,
    });
    await saveTemplate(
      home,
      { id: "research", name: "Project", description: "Local", document },
      "project-one",
    );
    expect((await getTemplate(home, "research")).name).toBe("Personal");
    expect((await getTemplate(home, "research", "project-one")).name).toBe(
      "Project",
    );
    expect(
      (await listTemplates(home, "project-one")).filter(
        (item) => item.id === "research",
      ),
    ).toHaveLength(1);
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
    await mkdir(join(home, "packages"));
    await symlink(outside, join(home, "packages/templates"));
    await expect(
      saveTemplate(home, {
        name: "Unsafe",
        description: "",
        document: blankDocument(),
      }),
    ).rejects.toThrow("Symbolic");
    await expect(getTemplate(home, "../outside")).rejects.toThrow("ids");
    await expect(listTemplates(home, "../../outside")).rejects.toThrow(
      "project",
    );
  });
});

describe("compiled React packages", () => {
  it("describes all built-in blocks for agents without importing browser renderers", () => {
    const builtins = listBuiltinComponents();
    expect(builtins.map((item) => item.kind)).toEqual([
      "chart",
      "database",
      "metrics",
      "playground",
      "gallery",
      "bookmark",
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
    );
    expect(component.html).toContain("Content-Security-Policy");
    expect(component.html).toContain("<!--SHOWAI_COMPONENT_DATA-->");
    expect(component.html).not.toMatch(/<script[^>]+src=/);
    expect(component.inline?.script).toContain("ShowAIInlineComponent");
    expect(component.inline!.script.length).toBeLessThan(15000);
    expect(component.integrity).toMatch(/^sha256-[a-f0-9]{64}$/);
    expect(
      (await readComponentSource(home, "value-slider", "1.0.0")).source,
    ).toContain("ValueSlider");
    const document = blankDocument();
    document.content.content = Array.from({ length: 2 }, () => ({
      type: "widget",
      attrs: { kind: "custom", data: componentWidgetData(component) },
    }));
    const resolved = await resolveDocumentComponents(home, document);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].html).toBe(component.html);
    expect(JSON.stringify(document)).not.toContain("<!doctype");
    expect((await listComponents(home))[0].id).toBe("value-slider");
    expect((await listComponents(home))[0]).not.toHaveProperty("inline");
  });
  it("uses immutable versions, validates defaults and examples, and allows a new version", async () => {
    const home = await temporary();
    const first = await saveComponent(home, { manifest, schema, source });
    expect(
      (await saveComponent(home, { manifest, schema, source })).integrity,
    ).toBe(first.integrity);
    await expect(
      saveComponent(home, { manifest, schema, source: source + "\n// edited" }),
    ).rejects.toThrow("immutable");
    await expect(
      saveComponent(home, {
        manifest: {
          ...manifest,
          id: "bad-default",
          defaultData: { value: "invalid" },
        },
        schema,
        source,
      }),
    ).rejects.toThrow("props");
    await expect(
      saveComponent(home, {
        manifest: {
          ...manifest,
          id: "bad-example",
          examples: [{ name: "bad", data: {} }],
        },
        schema,
        source,
      }),
    ).rejects.toThrow("props");
    await saveComponent(home, {
      manifest: { ...manifest, version: "1.0.1" },
      schema,
      source,
    });
    expect((await getComponent(home, manifest.id)).version).toBe("1.0.1");
  });
  it("compiles package-local modules and CSS but rejects Node, remote and escaping imports", async () => {
    const home = await temporary();
    const component = await saveComponent(home, {
      manifest,
      schema,
      source:
        'import "./styles.css";import Label from "./Label";export default function C(){return <Label/>}',
      files: {
        "styles.css": ".actual-label{color:green}",
        "Label.tsx":
          'export default function Label(){return <strong className="actual-label">Label</strong>}',
      },
    });
    expect(component.html).toContain("actual-label");
    for (const [index, importPath] of [
      "node:fs",
      "https://example.com/code.js",
      "../../outside.ts",
      "react-dom/server",
    ].entries()) {
      await expect(
        saveComponent(home, {
          manifest: { ...manifest, id: `blocked-${index}` },
          schema,
          source: `import value from ${JSON.stringify(importPath)};export default function C(){return <pre>{String(value)}</pre>}`,
        }),
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
    await expect(importComponent(home, packageDir)).rejects.toThrow("symbolic");
    await saveComponent(home, { manifest, schema, source });
    const path = join(
      home,
      "packages/components/local-counter/1.0.0/compiled.json",
    );
    const stored = JSON.parse(await readFile(path, "utf8"));
    stored.html += "<!-- modified -->";
    await writeFile(path, JSON.stringify(stored));
    await expect(
      getComponent(home, manifest.id, manifest.version),
    ).rejects.toThrow("integrity");
  });
  it("resolves project packages without leaking into other projects and rejects mismatched props or integrity", async () => {
    const home = await temporary();
    const component = await saveComponent(
      home,
      { manifest, schema, source },
      "private-project",
    );
    expect(await listComponents(home)).toEqual([]);
    expect((await listComponents(home, "private-project"))[0].scope).toBe(
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
      resolveDocumentComponents(home, document, "private-project"),
    ).rejects.toThrow("props");
    document.content.content[0].attrs!.data = {
      ...componentWidgetData(component),
      integrity: "sha256-" + "0".repeat(64),
    };
    await expect(
      resolveDocumentComponents(home, document, "private-project"),
    ).rejects.toThrow("integrity");
  });
  it("imports portable components without execution and can restore the original editable source", async () => {
    const firstHome = await temporary(),
      secondHome = await temporary();
    const component = await saveComponent(firstHome, {
      manifest,
      schema,
      source,
    });
    await importCompiledComponents(secondHome, [component], "imported-page");
    expect(
      (
        await getComponent(
          secondHome,
          manifest.id,
          manifest.version,
          "imported-page",
        )
      ).html,
    ).toBe(component.html);
    await expect(
      readComponentSource(
        secondHome,
        manifest.id,
        manifest.version,
        "imported-page",
      ),
    ).rejects.toThrow("no editable source");
    await expect(
      importCompiledComponents(
        secondHome,
        [{ ...component, html: component.html + "x" }],
        "imported-page",
      ),
    ).rejects.toThrow("integrity");
    await saveComponent(
      secondHome,
      { manifest, schema, source },
      "imported-page",
    );
    expect(
      (
        await readComponentSource(
          secondHome,
          manifest.id,
          manifest.version,
          "imported-page",
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
    await saveComponent(home, {
      manifest,
      schema,
      source:
        'import image from "./image.png";export default function Image(){return <img src={image} alt="Asset"/>}',
      assets,
    });
    const stored = await readComponentSource(
      home,
      manifest.id,
      manifest.version,
    );
    expect(stored.assets).toEqual(assets);
    const next = await saveComponent(home, {
      ...stored,
      manifest: { ...stored.manifest, version: "1.0.1" },
    });
    expect(next.html).toContain("data:image/png;base64,");
  });
});
