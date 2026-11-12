import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { FileStore } from "./store";
import {
  blankDocument,
  componentWidgetData,
  importComponent,
  lockDocumentComponents,
  saveComponent,
} from "./catalog";
import { validateDocument } from "../portable/validation.mjs";
import { createResource } from "../document/containers.mjs";
import { defaultPageOutline } from "../document/page-outline.mjs";
import type { CompiledComponent } from "../contract/types";
import type { ShowDocument } from "../types";

let home: string, projectId: string;
let counter: CompiledComponent, outline: CompiledComponent;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-lock-components-"));
  projectId = (await new FileStore(home).createProject({ name: "Lock" })).id;
  counter = await saveComponent(
    home,
    {
      manifest: {
        id: "counter",
        name: "Counter",
        version: "1.0.0",
        entry: "index.tsx",
        description: "Editable number",
        scenarios: ["Adjust a value"],
        defaultData: { value: 1 },
        examples: [{ name: "One", data: { value: 1 } }],
      },
      schema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
      source:
        "export default function Counter({data}) { return <p>{data.value}</p>; }\n",
    },
    projectId,
  );
  outline = await importComponent(
    home,
    resolve("examples", "page-outline-index"),
    projectId,
  );
}, 60000);
afterAll(async () => {
  await rm(home, { recursive: true, force: true });
});

// A Page whose views are filled in from its blocks during validation.
function page(content: ShowDocument["content"]["content"]) {
  const document = createResource(blankDocument()) as ShowDocument;
  document.content.content = content;
  document.surfaceViews = {};
  return document;
}
const paragraph = (id: string) => ({
  type: "paragraph",
  attrs: { id },
  content: [{ type: "text", text: id }],
});
// The normalised private copy that every caller receives.
const normalised = (document: ShowDocument) =>
  validateDocument(JSON.parse(JSON.stringify(document))) as ShowDocument;

describe("lockDocumentComponents", () => {
  it("returns a normalised copy of a page without custom widgets", async () => {
    const document = page([paragraph("a"), paragraph("b")]);
    // Optional fields left undefined by editor code are dropped, as JSON would.
    document.content.content![0].attrs!.textAlign = undefined;
    delete (document as Partial<ShowDocument>).icon;
    const before = structuredClone(document);
    const locked = await lockDocumentComponents(home, document, projectId);
    expect(document).toStrictEqual(before);
    expect(locked).toEqual(normalised(before));
    expect(locked.icon).toBe("✦");
    expect(locked).not.toBe(document);
    expect(locked.content).not.toBe(document.content);
    locked.content.content![1].attrs!.id = "changed";
    expect(document.content.content![1].attrs!.id).toBe("b");
  });

  it("freezes custom widget references without touching the caller's draft", async () => {
    const data = componentWidgetData(counter);
    const document: ShowDocument = {
      ...blankDocument(),
      content: {
        type: "doc",
        content: [
          paragraph("intro"),
          {
            type: "widget",
            attrs: {
              id: "w1",
              kind: "custom",
              data: { ...data, integrity: undefined, scope: "project" },
            },
          },
          { type: "widget", attrs: { id: "w2", kind: "custom", data } },
        ],
      },
    };
    const before = structuredClone(document);
    const locked = await lockDocumentComponents(home, document, projectId);
    expect(document).toStrictEqual(before);
    const expected = normalised(before);
    for (const node of expected.content.content!.slice(1)) {
      const { scope: _scope, ...properties } = node.attrs!.data;
      node.attrs!.data = {
        ...properties,
        componentId: counter.id,
        version: counter.version,
        integrity: counter.integrity,
      };
    }
    expect(locked).toEqual(expected);
    expect(locked.content.content![1].attrs!.data).not.toHaveProperty("scope");
    expect(locked.content.content![2].attrs!.data).not.toBe(data);
  });

  it("checks a page outline renderer and leaves the page as validated", async () => {
    const document = page([
      {
        type: "heading",
        attrs: { id: "h", level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      paragraph("body"),
    ]);
    document.content.attrs!.outline = {
      ...defaultPageOutline(),
      renderer: {
        componentId: outline.id,
        version: outline.version,
        integrity: outline.integrity,
        props: outline.defaultData,
      },
    };
    const before = structuredClone(document);
    const locked = await lockDocumentComponents(home, document, projectId);
    expect(document).toStrictEqual(before);
    expect(locked).toEqual(normalised(before));
    document.content.attrs!.outline.renderer.componentId = counter.id;
    document.content.attrs!.outline.renderer.version = counter.version;
    document.content.attrs!.outline.renderer.integrity = counter.integrity;
    document.content.attrs!.outline.renderer.props = counter.defaultData;
    await expect(
      lockDocumentComponents(home, document, projectId),
    ).rejects.toThrow("Page outline renderer does not implement protocol 1.");
  });
});
