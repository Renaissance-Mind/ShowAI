import { getSchema } from "@tiptap/core";
import { createExtensions } from "../editor/extensions";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newDocument } from "../lib/document";
import { assertOfflineImages, externalImageUrls } from "./assets.mjs";
import {
  escapeJsonForHtml,
  injectArtifactIntoHtml,
  isSafeUrl,
  MAX_ARTIFACT_BYTES,
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "./validation.mjs";

function documentWith(content: object[]) {
  return {
    id: "portable-test",
    title: "便携文档",
    content: { type: "doc", content },
  };
}

describe("portable artifact boundaries", () => {
  it("round trips the application documents and documented example without content loss", () => {
    for (const document of [newDocument()]) {
      expect(parseArtifact(serializeArtifact(document)).document).toEqual(
        document,
      );
    }
    const example = readFileSync(
      new URL("../../examples/welcome.showai.json", import.meta.url),
      "utf8",
    );
    expect(parseArtifact(example).document.title.length).toBeGreaterThan(0);
  });

  it("accepts the actual editor schema defaults for every supported block", () => {
    const schema = getSchema(createExtensions());
    for (const [name, type] of Object.entries(schema.nodes)) {
      if (
        [
          "doc",
          "text",
          "image",
          "hardBreak",
          "mathInline",
          "richText",
          "listItem",
          "taskItem",
          "table",
          "tableRow",
          "tableCell",
          "tableHeader",
        ].includes(name)
      )
        continue;
      const node = type.createAndFill();
      expect(node, `${name} should create a valid node`).not.toBeNull();
      const content = node!.toJSON();
      expect(
        () => validateDocument(documentWith([content])),
        name,
      ).not.toThrow();
    }
    for (const [name, type] of Object.entries(schema.marks)) {
      const mark = type.create(
        name === "link" ? { href: "https://example.com" } : undefined,
      );
      const text = schema.text("Marked text", [mark]).toJSON();
      expect(
        () =>
          validateDocument(
            documentWith([{ type: "paragraph", content: [text] }]),
          ),
        `mark ${name}`,
      ).not.toThrow();
    }
    const table = schema
      .nodeFromJSON({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                attrs: { align: "center" },
                content: [{ type: "paragraph" }],
              },
              {
                type: "tableCell",
                attrs: { colwidth: [0], align: null },
                content: [{ type: "paragraph" }],
              },
            ],
          },
        ],
      })
      .toJSON();
    expect(
      validateDocument(documentWith([table])).content.content?.[0],
    ).toEqual(table);
  });

  it("prevents JSON data from breaking out of its script and escapes the HTML title", () => {
    const title = "</title><script>alert(1)</script>&\u2028\u2029";
    const document = validateDocument({
      ...documentWith([
        { type: "paragraph", content: [{ type: "text", text: title }] },
      ]),
      title,
    });
    const template =
      '<html><head><title>Template</title></head><body><script id="showai-data" type="application/json">null</script></body></html>';
    const html = injectArtifactIntoHtml(template, document);
    expect(html.match(/<script\b/g)).toHaveLength(1);
    const data = html.match(/type="application\/json">(.*?)<\/script>/s)?.[1];
    expect(parseArtifact(data).document.title).toBe(title);
    expect(escapeJsonForHtml(title)).not.toMatch(/[<>&\u2028\u2029]/);
    expect(html).toContain("&lt;/title&gt;");
  });

  it("rejects executable URLs and prototype keys before editor creation", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,hello",
      "file:///etc/passwd",
      " javaScript:alert(1)",
      "https:\n//example.com",
    ])
      expect(isSafeUrl(url)).toBe(false);
    expect(isSafeUrl("https://example.com")).toBe(true);
    expect(isSafeUrl("data:image/svg+xml;base64,PHN2Zz4=", true)).toBe(false);
    expect(() =>
      validateDocument(
        JSON.parse(
          '{"id":"x","title":"x","content":{"type":"doc","content":[]},"__proto__":{}}',
        ),
      ),
    ).toThrow("reserved key");
    expect(() =>
      validateDocument(
        documentWith([
          { type: "image", attrs: { src: "javascript:alert(1)" } },
        ]),
      ),
    ).toThrow("src");
  });

  it("rejects malformed trees rather than silently discarding imported content", () => {
    const malformed = [
      [{ type: "text", text: "not a block" }],
      [
        {
          type: "paragraph",
          content: [{ type: "widget", attrs: { kind: "chart", data: {} } }],
        },
      ],
      [{ type: "table", content: [{ type: "paragraph" }] }],
      [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "heading",
                  content: [{ type: "text", text: "wrong first child" }],
                },
              ],
            },
          ],
        },
      ],
      [{ type: "callout" }],
      [{ type: "paragraph", attrs: { title: {} } }],
      [{ type: "heading", attrs: { level: 6 } }],
    ];
    for (const content of malformed)
      expect(() => validateDocument(documentWith(content))).toThrow();
    expect(() =>
      parseArtifact({
        format: "showai",
        version: 2,
        document: documentWith([]),
      }),
    ).toThrow("version");
  });

  it("enforces depth, node count, byte limits and finite numeric values", () => {
    let node: object = { type: "paragraph" };
    for (let i = 0; i < 60; i++) node = { type: "blockquote", content: [node] };
    expect(() => validateDocument(documentWith([node]))).toThrow("deeply");
    expect(() =>
      validateDocument(
        documentWith(
          Array.from({ length: 12001 }, () => ({ type: "paragraph" })),
        ),
      ),
    ).toThrow("too many");
    expect(() => parseArtifact(" ".repeat(MAX_ARTIFACT_BYTES + 1))).toThrow(
      "10 MB",
    );
    expect(() =>
      validateDocument(
        documentWith([
          {
            type: "widget",
            attrs: { kind: "custom", data: { value: Infinity } },
          },
        ]),
      ),
    ).toThrow("finite");
  });

  it("preserves unknown registered-block data without executing it", () => {
    const data = { source: "<script>bad()</script>", options: [1, true, null] };
    const result = validateDocument(
      documentWith([{ type: "widget", attrs: { kind: "future-block", data } }]),
    );
    expect(result.content.content?.[0].attrs?.data).toEqual(data);
  });

  it("detects external images across nested image and gallery blocks", () => {
    const source = "https://example.com/plot.png";
    const document = validateDocument(
      documentWith([
        {
          type: "callout",
          content: [{ type: "image", attrs: { src: source } }],
        },
        {
          type: "widget",
          attrs: {
            kind: "gallery",
            data: {
              images: [{ id: "plot", src: source, alt: "plot", caption: "" }],
            },
          },
        },
      ]),
    );
    expect(externalImageUrls(document)).toEqual([source]);
    expect(() => assertOfflineImages(document)).toThrow("need embedding");
    expect(() =>
      assertOfflineImages(
        validateDocument(
          documentWith([
            {
              type: "image",
              attrs: { src: "data:image/png;base64,iVBORw0KGgo=" },
            },
          ]),
        ),
      ),
    ).not.toThrow();
  });

  it("refuses unbuilt templates", () => {
    expect(() =>
      injectArtifactIntoHtml(
        "<html></html>",
        validateDocument(documentWith([])),
      ),
    ).toThrow("placeholder");
  });
});
