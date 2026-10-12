import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import catalog from "../../resources/catalog/components.json";
import { bundleReader } from "../portable/reader-bundle.mjs";
import { injectArtifactIntoHtml } from "../portable/validation.mjs";
import { renderReading } from "./reading-renderer";
import { pageReadSchema } from "./page-reading";
import type { ShowDocument } from "../types";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

test.each(["text", "mechanism-steps", "evidence-explorer"])(
  "portable reader mounts %s without requiring unused component metadata",
  async (kind) => {
    const directory = await mkdtemp(
      join(tmpdir(), "showai-presentation-export-"),
    );
    directories.push(directory);
    const data =
      kind === "text"
        ? {
            format: "richtext",
            content: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    { type: "text", text: "Portable prose remains readable" },
                  ],
                },
              ],
            },
          }
        : catalog.find((c) => c.kind === kind)!.examples[0].data;
    const expected =
      kind === "text"
        ? "Portable prose remains readable"
        : (data as { title: string }).title;
    const document = {
      id: "page",
      title: "Isolated component",
      icon: "",
      cover: "none",
      parentId: null,
      favorite: false,
      archived: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      comments: [],
      content: {
        type: "surface",
        attrs: { id: "root", kind: "page" },
        content: [{ type: "widget", attrs: { id: "only", kind, data } }],
      },
    } as ShowDocument;
    const reader = await bundleReader(
      resolve("dist-portable/reader-source.json"),
      [document],
    );
    const path = join(directory, "reader.html");
    await writeFile(path, injectArtifactIntoHtml(reader, document));
    const captured = await renderReading(
      path,
      pageReadSchema.parse({
        view: "html",
        viewport: { width: 1200, height: 900 },
      }),
    );
    expect(
      captured.dom.map((frame) => frame.accessibility).join("\n"),
    ).toContain(expected);
    expect(captured.png.subarray(1, 4).toString()).toBe("PNG");
  },
  30000,
);
