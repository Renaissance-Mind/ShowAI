import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore } from "./store";
import {
  blankDocument,
  readBuiltinComponentSource,
  saveComponent,
} from "./catalog";
import { buildPageHtml } from "../agent/exporter";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
it("compiles every research builtin through the public SDK and produces a selective offline reader", async () => {
  const home = await mkdtemp(join(tmpdir(), "showai-research-"));
  directories.push(home);
  const project = await new FileStore(home).createProject({
    name: "Research components",
  });
  for (const kind of ["video", "audio", "pdf", "references"]) {
    const source = readBuiltinComponentSource(kind);
    const component = await saveComponent(
      home,
      { ...source, manifest: { ...source.manifest, id: `research-${kind}` } },
      project.id,
    );
    expect(component.inline?.script).toBeTruthy();
    expect(component.html).toContain("media-src data:");
    expect(component.html).not.toMatch(/<script[^>]+src=/);
  }
  const document = blankDocument();
  document.content = {
    type: "doc",
    content: [
      { type: "widget", attrs: { kind: "text", data: { content: "$x^2$" } } },
      { type: "widget", attrs: { kind: "pdf", data: { src: "" } } },
      { type: "widget", attrs: { kind: "audio", data: { src: "" } } },
      { type: "widget", attrs: { kind: "video", data: { src: "" } } },
      { type: "widget", attrs: { kind: "references", data: { items: [] } } },
    ],
  };
  const html = await buildPageHtml(document);
  expect(html).toContain("sb-pdf-reader");
  expect(html).toContain("sb-reference-list");
  expect(html).toContain("data:font/woff2;base64,");
  expect(html).not.toContain('kind:"g2-bar"');
}, 120000);
