import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { bundleReader } from "../portable/reader-bundle.mjs";
import {
  injectArtifactIntoHtml,
  parseArtifact,
} from "../portable/validation.mjs";
import { renderReading } from "./reading-renderer";
import { pageReadSchema } from "./page-reading";
import type { ShowDocument } from "../types";
import { listBuiltinComponents } from "../core/catalog";
import { catalogEntry, summarizeCatalog } from "./disclosure";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

const document = {
  id: "page",
  title: "Conversation component",
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
    content: [
      {
        type: "widget",
        attrs: {
          id: "peak",
          kind: "metrics",
          data: { items: [{ label: "峰值延迟", value: 240, unit: "ms" }] },
        },
      },
    ],
  },
} as ShowDocument;

test("every built-in component records whether it fits a conversation", () => {
  const items = listBuiltinComponents().filter((item) => !item.insertion);
  expect(
    items.filter((item) => !item.conversation).map((item) => item.kind),
  ).toEqual([]);
  for (const item of items)
    if (item.conversation!.status !== "ready")
      expect(item.conversation!.note).toBeTruthy();
  const entry = catalogEntry(
    summarizeCatalog(
      "component",
      items.find((item) => item.kind === "pdf")!,
    ),
  );
  expect(entry).toMatchObject({ conversation: "limited" });
  expect(
    catalogEntry(
      summarizeCatalog(
        "component",
        items.find((item) => item.kind === "chart")!,
      ),
    ),
  ).not.toHaveProperty("conversation");
});

test("selection chrome is validated and kept with the artifact", () => {
  const artifact = {
    format: "showai",
    version: 3,
    document,
    selection: { blockIds: ["peak"], chrome: "none" },
  };
  expect(parseArtifact(artifact).selection).toEqual({
    blockIds: ["peak"],
    chrome: "none",
  });
  expect(() =>
    parseArtifact({
      ...artifact,
      selection: { blockIds: ["peak"], chrome: "menu" },
    }),
  ).toThrow('chrome must be "none"');
});

test.each([
  ["component", { blockIds: ["peak"], chrome: "none" as const }, false],
  ["partial page", { blockIds: ["peak"] }, true],
])(
  "a %s preview carries reader options only for page projections",
  async (_name, selection, options) => {
    const directory = await mkdtemp(join(tmpdir(), "showai-show-component-"));
    directories.push(directory);
    const reader = await bundleReader(
      resolve("dist-portable/reader-source.json"),
      [document],
    );
    const path = join(directory, "reader.html");
    await writeFile(
      path,
      injectArtifactIntoHtml(reader, document, [], [], "reading", selection),
    );
    const captured = await renderReading(
      path,
      pageReadSchema.parse({
        view: "html",
        viewport: { width: 760, height: 600 },
      }),
    );
    const accessibility = captured.dom
      .map((frame) => frame.accessibility)
      .join("\n");
    expect(accessibility).toContain("峰值延迟");
    expect(/页面选项|Page options/.test(accessibility)).toBe(options);
  },
  30000,
);
