import { afterEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { ContentLibrary } from "../core/content-library";
import { FileStore } from "../core/store";
import { componentWidgetData, saveComponent } from "../core/catalog";
import { validateDocument, parseArtifact } from "../portable/validation.mjs";
import { localFileRef } from "../portable/local-files.mjs";
import { analyzeExport, exportPage } from "./exporter";
import { presentPage } from "./page-presentation";
import type { ShowDocument } from "../core/model";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useResource } from "../components/local-resources";

// A real 1×1 PNG.
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

function customProps(document: ShowDocument) {
  const block = document.content.content?.find(
    (node) => node.attrs?.id === "viewer",
  );
  return (block?.attrs?.data as { props: Record<string, any> }).props;
}

test("custom component props carry local files as packaged items and leave no device path in exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "component-local-files-"));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, "library");
  await new ContentLibrary(home).initialize();
  const store = new FileStore(home);
  const project = await store.createProject({ name: "组件本机文件" });
  // Files outside the library, in a folder named like a person's home.
  const files = join(directory, "Users", "alice-device", "Material");
  await mkdir(files, { recursive: true });
  const imagePath = join(files, "cover image.png");
  const videoPath = join(files, "clip.mp4");
  await writeFile(imagePath, png);
  await writeFile(videoPath, Buffer.alloc(4096, 3));
  const cover = localFileRef(imagePath);
  const clip = localFileRef(videoPath);
  const report = localFileRef(join(files, "report.docx"));
  const component = await saveComponent(
    home,
    {
      manifest: {
        id: "local-viewer",
        name: "Local viewer",
        version: "1.0.0",
        description: "Shows a cover and a clip through useResource",
        entry: "index.tsx",
        scenarios: ["Local files in props"],
        defaultData: { cover: "", clip: "", report: "", items: [] },
        examples: [
          {
            name: "Empty",
            data: { cover: "", clip: "", report: "", items: [] },
          },
        ],
      },
      schema: {
        type: "object",
        properties: {
          cover: { type: "string" },
          clip: { type: "string" },
          report: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { src: { type: "string" } },
              required: ["src"],
              additionalProperties: false,
            },
          },
        },
        required: ["cover", "clip", "report", "items"],
        additionalProperties: false,
      },
      source:
        'import React from "react";import {useResource} from "showai:components";export default function Viewer({data}){const cover=useResource(data.cover,"image");const clip=useResource(data.clip,"video");return <section>{cover.url?<img src={cover.url} alt="cover"/>:<p>{cover.name}</p>}{clip.url?<video src={clip.url}/>:<p>{clip.name}</p>}</section>}',
    },
    project.id,
  );
  const page = await store.createPage(project.id, {
    document: validateDocument({
      id: "component-files",
      title: "Component files",
      content: {
        type: "doc",
        content: [
          {
            type: "widget",
            attrs: {
              id: "viewer",
              kind: "custom",
              data: componentWidgetData(component, {
                cover,
                clip,
                report,
                items: [{ src: cover }],
              }),
            },
          },
        ],
      },
    }),
  });
  const pageId = page.document.id;

  // The export plan lists the component's files with where they are used.
  const plan = await analyzeExport({
    root: home,
    projectId: project.id,
    pageId,
    format: "html",
  });
  const items = Object.fromEntries(plan.items.map((item) => [item.id, item]));
  expect(items[cover]).toMatchObject({
    kind: "file-resource",
    name: "cover image.png",
    bytes: png.length,
    choice: "embed",
  });
  expect(items[cover].blocks).toEqual([
    { pageId, blockId: "viewer" },
    { pageId, blockId: "viewer" },
  ]);
  expect(items[clip]).toMatchObject({ kind: "file-resource", bytes: 4096 });
  // A file of another type is never carried, so it is not a choice.
  expect(items[report]).toBeUndefined();

  // Without confirmation, local files stay on the device.
  await expect(
    exportPage({
      root: home,
      projectId: project.id,
      pageId,
      format: "html",
      out: join(directory, "exports", "refused.html"),
    }),
  ).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });

  const out = join(directory, "exports", "component.html");
  const exported = await exportPage({
    root: home,
    projectId: project.id,
    pageId,
    format: "html",
    out,
    packaging: { [cover]: "embed", [clip]: "skip" },
  });
  const sourceText = await readFile(exported.sourcePaths[0], "utf8");
  const props = customProps(parseArtifact(sourceText).document);
  const encoded = `data:image/png;base64,${png.toString("base64")}`;
  expect(props).toEqual({
    cover: encoded,
    clip: "file:clip.mp4",
    report: "file:report.docx",
    items: [{ src: encoded }],
  });
  const html = await readFile(out, "utf8");

  // A rendered conversation copy embeds what fits by default.
  const presented = await presentPage({
    root: home,
    projectId: project.id,
    pageId,
  });
  const presentedProps = customProps(
    parseArtifact(presented.source).document,
  );
  expect(presentedProps.cover).toBe(encoded);
  expect(presentedProps.clip).toMatch(/^data:video\/mp4;base64,/);
  expect(presentedProps.report).toBe("file:report.docx");

  // An export of a page without local files shows what the reader itself contains.
  const plain = await store.createPage(project.id, {
    document: validateDocument({
      id: "plain",
      title: "Plain",
      content: { type: "doc", content: [{ type: "paragraph" }] },
    }),
  });
  const baseline = await readFile(
    (
      await exportPage({
        root: home,
        projectId: project.id,
        pageId: plain.document.id,
        format: "html",
        out: join(directory, "exports", "plain.html"),
      })
    ).path,
    "utf8",
  );
  const username = userInfo().username;
  for (const text of [html, sourceText, presented.html, presented.source]) {
    expect(text).not.toContain(files);
    expect(text).not.toContain("alice-device");
    expect(text).not.toContain(directory);
    expect(text).not.toContain(homedir());
    if (!baseline.includes(username)) expect(text).not.toContain(username);
  }
}, 120_000);

test("useResource gives a component embedded data as its address", () => {
  const encoded = `data:image/png;base64,${png.toString("base64")}`;
  const views: ReturnType<typeof useResource>[] = [];
  function Probe({ value }: { value: string }) {
    views.push(useResource(value, "image"));
    return null;
  }
  renderToStaticMarkup(createElement(Probe, { value: encoded }));
  renderToStaticMarkup(createElement(Probe, { value: "file:cover.png" }));
  expect(views[0]).toMatchObject({
    url: encoded,
    status: "ready",
    local: false,
  });
  // A copy without the file names it; the component shows that name.
  expect(views[1]).toMatchObject({
    status: "loading",
    local: true,
    name: "cover.png",
  });
  expect(views[1].url).toBeUndefined();
});
