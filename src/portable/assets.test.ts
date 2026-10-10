import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import {
  assertOfflineImages,
  embedDocumentImages,
  externalImageUrls,
  externalResourceUrls,
} from "./assets.mjs";
import { validateDocument } from "./validation.mjs";
import { upgradeResource, createSurface } from "../surface/containers.mjs";

// A real HTTP fixture serves a valid raster image so the network-to-file path is exercised.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
let server: Server;
let origin: string;
let imageRequests = 0;
beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === "/image.png") {
      imageRequests++;
      response.writeHead(200, { "content-type": "image/png" });
      response.end(png);
      return;
    }
    if (request.url === "/document.pdf") {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(Buffer.from("%PDF-1.7\n%%EOF"));
      return;
    }
    response.writeHead(404);
    response.end("missing");
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

describe("self-contained image export", () => {
  it("embeds structured rich-text widget images after legacy text is edited", async () => {
    const src = `${origin}/image.png`;
    const document = validateDocument({
      id: "rich-text-images",
      title: "Rich text",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              id: "legacy-text",
              kind: "text",
              data: {
                format: "richtext",
                content: {
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: "保留高亮",
                          marks: [
                            { type: "highlight", attrs: { color: "#ffeedd" } },
                          ],
                        },
                      ],
                    },
                    { type: "image", attrs: { src, alt: "Original image" } },
                  ],
                },
              },
            },
          },
        ],
      },
    });
    expect(externalImageUrls(document)).toEqual([src]);
    const embedded = await embedDocumentImages(document);
    expect(externalImageUrls(embedded)).toEqual([]);
    expect(() => assertOfflineImages(embedded)).not.toThrow();
    const content = embedded.content.content![0].attrs!.data.content.content;
    expect(content[1].attrs.src).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    expect(content[0].content[0].marks[0].attrs.color).toBe("#ffeedd");
    expect(
      document.content.content![0].attrs!.data.content.content[1].attrs.src,
    ).toBe(src);
  });

  it("embeds PDF files and video posters in nested containers without changing their source", async () => {
    const document = validateDocument({
      id: "files",
      title: "Files",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: { kind: "pdf", data: { src: `${origin}/document.pdf` } },
          },
          {
            type: "widget",
            attrs: {
              kind: "video",
              data: {
                src: "data:video/mp4;base64,AA==",
                poster: `${origin}/image.png`,
              },
            },
          },
        ],
      },
    });
    expect(externalResourceUrls(document)).toHaveLength(2);
    expect(() => assertOfflineImages(document)).toThrow("need embedding");
    const result = await embedDocumentImages(document);
    expect(result.content.content?.[0].attrs?.data.src).toMatch(
      /^data:application\/pdf;base64,/,
    );
    expect(result.content.content?.[1].attrs?.data.poster).toMatch(
      /^data:image\/png;base64,/,
    );
    expect(externalResourceUrls(result)).toEqual([]);
    expect(document.content.content?.[0].attrs?.data.src).toBe(
      `${origin}/document.pdf`,
    );
  });
  it("embeds root and nested Page icons with one download and leaves Emoji unchanged", async () => {
    const src = `${origin}/image.png`;
    const document = upgradeResource(
      validateDocument({
        id: "icons",
        title: "Icons",
        icon: src,
        content: { type: "doc", content: [] },
      }),
    );
    document.content.content = [
      createSurface("page", "Child"),
      createSurface("page", "Emoji"),
    ];
    document.content.content[0].attrs!.icon = src;
    document.content.content[1].attrs!.icon = "🧪";
    const before = imageRequests;
    const result = await embedDocumentImages(document);
    expect(imageRequests - before).toBe(1);
    expect(result.icon).toBe(`data:image/png;base64,${png.toString("base64")}`);
    expect(result.content.content?.[0].attrs?.icon).toBe(result.icon);
    expect(result.content.content?.[1].attrs?.icon).toBe("🧪");
    expect(externalImageUrls(result)).toEqual([]);
    expect(document.icon).toBe(src);
  });
  it("embeds images in native text, image components, gallery, and bookmark and reuses one download", async () => {
    const src = `${origin}/image.png`;
    const document = validateDocument({
      id: "images",
      title: "Images",
      content: {
        type: "doc",
        content: [
          { type: "image", attrs: { src } },
          {
            type: "widget",
            attrs: { kind: "image", data: { src, alt: "Primitive image" } },
          },
          {
            type: "widget",
            attrs: {
              kind: "text",
              data: {
                content: `![Inline](${src})\n\n![Reference][figure]\n\n[figure]: ${src}\n\n[Keep this link](${src})`,
              },
            },
          },
          {
            type: "widget",
            attrs: {
              kind: "gallery",
              data: {
                images: [
                  { id: "image-1", src, alt: "One green pixel", caption: "" },
                ],
              },
            },
          },
          {
            type: "widget",
            attrs: {
              kind: "bookmark",
              data: { title: "Image", url: "https://example.com", image: src },
            },
          },
        ],
      },
    });
    const before = imageRequests;
    const result = await embedDocumentImages(document);
    expect(imageRequests - before).toBe(1);
    expect(externalImageUrls(result)).toEqual([]);
    expect(result.content.content?.[0].attrs?.src).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    const text = result.content.content?.find(
      (node) => node.attrs?.kind === "text",
    );
    expect(text?.attrs?.data.content).toContain(
      "![Inline](<data:image/png;base64,",
    );
    expect(text?.attrs?.data.content).toContain(
      "![Reference](<data:image/png;base64,",
    );
    expect(text?.attrs?.data.content).toContain(`[Keep this link](${src})`);
    expect(document.content.content?.[0].attrs?.src).toBe(src);
  });

  it("fails the whole export when an image cannot be downloaded", async () => {
    const document = validateDocument({
      id: "missing-image",
      title: "Missing image",
      content: {
        type: "doc",
        content: [{ type: "image", attrs: { src: `${origin}/missing.png` } }],
      },
    });
    await expect(embedDocumentImages(document)).rejects.toThrow(
      "离线导出已停止",
    );
  });
});
