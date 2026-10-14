import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { buildPageHtml } from "../agent/exporter";
import { blankDocument } from "./catalog";
import { createResource } from "../surface/containers.mjs";
import { conversationPreview } from "./conversation-preview";

let directory: string, html: string;
const saved = { ...process.env };
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-preview-policy-"));
  const manifest = join(directory, "manifest.json");
  await writeFile(
    manifest,
    JSON.stringify({
      format: "showai-cdn-reader",
      name: "showai-reader",
      version: "1.0.0-reader.test",
      entry: "reader-TEST.js",
    }),
  );
  process.env.SHOWAI_CDN_MANIFEST = manifest;
  delete process.env.SHOWAI_READER_CDN;
  html = await buildPageHtml(createResource(blankDocument()));
}, 30000);
afterAll(async () => {
  process.env = saved;
  await rm(directory, { recursive: true, force: true });
});

it("delivers the actual local reader even when a CDN is available", async () => {
  const preview = await conversationPreview(html);
  expect(preview.reader).toBe("bundled");
  expect(preview.inline).not.toContain("import(url)");
  expect(preview.inline).toContain("data-showai-inline-root");
});

it("falls back only for the bundle size limit and respects explicit offline selection", async () => {
  const oversized = html.replace(
    "</style>",
    `/*${randomBytes(1500000).toString("base64")}*/</style>`,
  );
  expect((await conversationPreview(oversized)).reader).toBe("cdn");
  await expect(conversationPreview(oversized, "bundled")).rejects.toThrow(
    "1000000 bytes",
  );
  process.env.SHOWAI_READER_CDN = "off";
  await expect(conversationPreview(oversized)).rejects.toThrow("1000000 bytes");
  delete process.env.SHOWAI_READER_CDN;
});

it("keeps explicit online export small and does not hide an invalid local reader", async () => {
  expect((await conversationPreview(html, "cdn")).reader).toBe("cdn");
  await expect(
    conversationPreview(html.replace('id="root"', 'id="missing"')),
  ).rejects.toThrow("mount point");
});
