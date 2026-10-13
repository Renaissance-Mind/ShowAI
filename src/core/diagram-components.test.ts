import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import {
  listBuiltinComponents,
  readBuiltinComponentSource,
  saveComponent,
} from "./catalog";
import { componentCategory } from "./component-categories";
import {
  assertProps,
  assertParameterDefinition,
} from "../components/custom/schema";
import { validateComponentDocumentation } from "../components/custom/documentation";
import {
  diagramTemplates,
  validateDiagramData,
  type DiagramFamily,
} from "../components/blocks/diagrams/contract.mjs";
import {
  diagramSource,
  diagramDocument,
  listDiagramTemplates,
} from "../components/blocks/diagrams/templates";

const families = Object.keys(diagramTemplates) as DiagramFamily[];

test("all upstream templates are discoverable with valid parameters, source and provenance", () => {
  for (const family of families) {
    const item = listBuiltinComponents().find((item) => item.kind === family)!;
    expect(componentCategory(item)).toBe("flow");
    const docs = validateComponentDocumentation(
      item.documentation,
      item.examples.length,
    );
    assertParameterDefinition(item.propsSchema, docs, [
      item.defaultData,
      ...item.examples.map((item) => item.data),
    ]);
    assertProps(item.propsSchema, item.defaultData, docs);
    const templates = listDiagramTemplates(family);
    expect(templates.map((item) => item.id)).toEqual(diagramTemplates[family]);
    for (const example of item.examples) {
      assertProps(item.propsSchema, example.data, docs);
      validateDiagramData(family, example.data);
      const source = diagramSource(family, example.data);
      expect(source, `${family}/${example.name}`).toMatch(/<svg\b/);
      expect(source).toContain("</svg>");
      expect(source).not.toContain('href="https://fonts.googleapis.com');
    }
    const source = readBuiltinComponentSource(family);
    const files = JSON.parse(source.files["diagram-templates.json"]);
    expect(files.license.commit).toMatch(/^[a-f\d]{40}$/);
    expect(files.license.text).toContain("Permission is hereby granted");
    expect(files.templates).toHaveLength(diagramTemplates[family].length);
    expect(
      files.templates.every((item: any) => item.upstreamPath && item.source),
    ).toBe(true);
  }
});

test("saved custom content takes precedence and invalid imports fail explicitly", () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><text x="20" y="40">自己的事实 &amp; labels</text></svg>';
  for (const family of families) {
    const data = { template: diagramTemplates[family][0], source };
    expect(diagramSource(family, data)).toBe(source);
    validateDiagramData(family, { ...data, template: "custom" });
    expect(() => validateDiagramData(family, { template: "custom" })).toThrow(
      "source",
    );
    expect(() =>
      validateDiagramData(family, { ...data, source: '{"nodes":[]}' }),
    ).toThrow("JSON");
    expect(() =>
      validateDiagramData(family, { ...data, height: Infinity }),
    ).toThrow();
    expect(() =>
      validateDiagramData(family, { ...data, template: "unregistered" }),
    ).toThrow();
    expect(() =>
      validateDiagramData(family, {
        ...data,
        source: `<svg>${"中".repeat(3_000_000)}</svg>`,
      }),
    ).toThrow("8 MiB");
    const html = diagramDocument(family, source);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(
      html.indexOf("<svg"),
    );
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("base-uri 'none'");
    expect(html).toContain("Permission is hereby granted");
  }
});

test("each diagram family derives through the real SDK into an offline compiled package", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-diagrams-"));
  try {
    const project = await new FileStore(home).createProject({
      name: "Diagram integration",
    });
    for (const family of families) {
      const original = readBuiltinComponentSource(family);
      const compiled = await saveComponent(
        home,
        {
          ...original,
          manifest: { ...original.manifest, id: `derived-${family}` },
        },
        project.id,
      );
      expect(compiled.inline?.script).toContain(
        "allow-scripts allow-downloads",
      );
      expect(compiled.inline?.script).toContain("connect-src 'none'");
      expect(compiled.inline?.script).toContain("Permission is hereby granted");
      expect(compiled.inline?.styles).toContain("sb-diagram-frame");
      expect(compiled.html).not.toMatch(/<script[^>]+src=/);
      expect(compiled.html).toContain("frame-src about:");
      expect(compiled.html).toContain("connect-src 'none'");
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}, 120000);
