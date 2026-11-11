import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { JSONContent } from "@tiptap/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";
import { visitNodes } from "../surface/document.mjs";
import { AgentService } from "./service";
import { planImport, runImport } from "./import-service";
import {
  listContributedImporters,
  removeContributedImporter,
  saveContributedImporter,
} from "../core/importers/contributed";
import {
  docxFile,
  notionFiles,
  notionZip,
} from "../core/importers/test-fixtures";

let root: string;
let outside: string;
let service: AgentService;
let projectId: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-import-"));
  outside = await mkdtemp(join(tmpdir(), "showai-import-input-"));
  await openLibrary(root);
  service = new AgentService({ root });
  projectId = (await service.createProject("Imports")).id;
}, 120_000);
afterAll(async () => {
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const nodes = (content: JSONContent) => {
  const found: JSONContent[] = [];
  visitNodes(content, (node: JSONContent) => {
    found.push(node);
  });
  return found;
};
async function pageNamed(title: string, parentId?: string | null) {
  const pages = await service.store.listPages(projectId);
  const page = pages.find(
    (item) =>
      item.title === title &&
      (parentId === undefined || (item.parentId ?? null) === parentId),
  );
  expect(page, title).toBeDefined();
  return service.store.readPage(projectId, page!.id);
}
const link = (pageId: string) => `showai://project/${projectId}/page/${pageId}`;

test("a Notion export zip with a nested Part zip becomes folders, linked pages and a database", async () => {
  const zip = join(outside, "Export-5f1c.zip");
  await writeFile(zip, notionZip());
  const target = { projectId, parentId: null };
  const plan = await planImport(service, { path: zip }, target);
  expect(plan.importer.id).toBe("notion");
  expect(plan.counts).toEqual({
    folders: 2,
    pages: 5,
    databases: 1,
    resources: 2,
    resourceBytes: plan.counts.resourceBytes,
  });
  expect(plan.root).toBeNull();
  expect(plan.warnings.map((item) => item.message)).toEqual(
    expect.arrayContaining([
      expect.stringContaining("Missing Page"),
      expect.stringContaining("HTML <video>"),
      "No page refers to this file; it was not imported.",
    ]),
  );
  // Planning writes nothing.
  expect(await service.store.listPages(projectId)).toEqual([]);

  const progress: number[] = [];
  const report = await runImport(service, { path: zip }, target, {
    onProgress: (step) => progress.push(step.done),
  });
  expect(report.problems).toEqual([]);
  expect(report.created).toEqual({
    folders: 2,
    pages: 5,
    databases: 1,
    resources: 2,
  });
  expect(progress.at(-1)).toBe(8);

  const folders = await service.store.listFolders(projectId);
  const workspace = folders.find((folder) => folder.name === "Workspace Home")!;
  const tasksFolder = folders.find((folder) => folder.name === "Tasks")!;
  expect(workspace.parentId).toBeNull();
  expect(tasksFolder.parentId).toBe(workspace.id);
  expect(report.undo).toEqual({ folders: [workspace.id], pages: [] });

  const home = await pageNamed("Workspace Home", workspace.id);
  const plan_ = await pageNamed("Project Plan", workspace.id);
  const tasks = await pageNamed("Tasks", tasksFolder.id);
  const spec = await pageNamed("Write spec", tasksFolder.id);
  const review = await pageNamed("Review", tasksFolder.id);
  expect(report.openPageId).toBe(home.document.id);

  const homeNodes = nodes(home.document.content);
  const hrefs = homeNodes.flatMap((node) =>
    (node.marks ?? [])
      .filter((mark) => mark.type === "link")
      .map((mark) => mark.attrs!.href),
  );
  expect(hrefs).toEqual(
    expect.arrayContaining([link(plan_.document.id), link(tasks.document.id)]),
  );
  expect(
    hrefs.every((href) => !String(href).startsWith("showai-import:")),
  ).toBe(true);
  const types = homeNodes.map((node) => node.type);
  expect(types).toEqual(
    expect.arrayContaining([
      "callout",
      "taskList",
      "blockquote",
      "codeBlock",
      "mathBlock",
      "table",
      "horizontalRule",
      "image",
      "toggle",
    ]),
  );
  expect(
    homeNodes.find((node) => node.type === "codeBlock")!.attrs!.language,
  ).toBe("python");
  expect(homeNodes.find((node) => node.type === "callout")!.attrs!.icon).toBe(
    "💡",
  );
  expect(homeNodes.find((node) => node.type === "toggle")!.attrs!.title).toBe(
    "Background",
  );
  expect(
    String(homeNodes.find((node) => node.type === "image")!.attrs!.src),
  ).toMatch(/^data:image\/png;base64,/);
  const widgets = homeNodes
    .filter((node) => node.type === "widget")
    .map((node) => node.attrs!);
  expect(widgets.find((item) => item.kind === "bookmark")!.data.url).toBe(
    "https://example.com/article",
  );
  expect(widgets.find((item) => item.kind === "pdf")!.data.src).toMatch(
    /^data:application\/pdf;base64,/,
  );
  // Kept as text, with a warning: the HTML and the link that left the export.
  expect(JSON.stringify(home.document.content)).toContain("an old page");

  // Links between pages, including a notion.so address, open the imported pages.
  const planLinks = nodes(plan_.document.content).flatMap((node) =>
    (node.marks ?? []).map((mark) => mark.attrs?.href),
  );
  expect(planLinks).toEqual([link(home.document.id), link(spec.document.id)]);
  // Row pages lose the property lines the database holds.
  expect(JSON.stringify(spec.document.content)).not.toContain(
    "Status: In progress",
  );
  expect(JSON.stringify(spec.document.content)).toContain("Draft the spec");

  const block = nodes(tasks.document.content).find(
    (node) => node.type === "widget" && node.attrs?.kind === "database",
  )!;
  const datasetId = block.attrs!.data.$binding.dataset as string;
  const dataset = await service.datasetRead(projectId, datasetId);
  const value = (dataset.dataset as { value: unknown }).value as {
    columns: {
      id: string;
      name: string;
      type: string;
      options?: string[];
      folder?: string;
    }[];
    rows: Record<string, unknown>[];
  };
  expect(value.columns.map((column) => [column.name, column.type])).toEqual([
    ["Name", "text"],
    ["Status", "select"],
    ["Due", "date"],
    ["Due →", "date"],
    ["Done", "checkbox"],
    ["Estimate", "number"],
    ["Link", "url"],
    ["Tags", "text"],
    ["Related", "text"],
    ["Page", "page"],
  ]);
  expect(value.columns[1].options).toEqual(["In progress", "Done"]);
  expect(value.columns.at(-1)!.folder).toBe(tasksFolder.id);
  expect(value.rows).toEqual([
    {
      id: "r1",
      title: "Write spec",
      p1: "In progress",
      p2: "2026-11-12",
      p3: true,
      p4: 3,
      p5: "https://example.com/a",
      p6: "design, docs",
      p7: "Project Plan",
      page: link(spec.document.id),
    },
    {
      id: "r2",
      title: "Review",
      p1: "Done",
      p2: "2026-11-14",
      p2_end: "2026-11-15",
      p3: false,
      p4: 1.5,
      p5: "https://example.com/b",
      p6: "docs",
      page: link(review.document.id),
    },
    { id: "r3", title: "Ship", p1: "In progress", p3: false },
  ]);

  // Deleting the folder moves the whole import to the trash.
  await service.store.updateFolder(projectId, workspace.id, { archived: true });
  expect(
    (await service.store.listFolders(projectId)).some(
      (folder) => folder.id === workspace.id,
    ),
  ).toBe(false);
});

test("the unzipped export folder imports the same way into a chosen folder", async () => {
  const folder = join(outside, "unzipped");
  for (const [path, bytes] of Object.entries(notionFiles())) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), bytes);
  }
  const destination = await service.store.createFolder(projectId, {
    name: "Inbox",
  });
  const report = await runImport(
    service,
    { path: folder },
    { projectId, parentId: destination.id },
  );
  expect(report.plan.source.kind).toBe("folder");
  expect(report.problems).toEqual([]);
  expect(report.created.pages).toBe(5);
  const folders = await service.store.listFolders(projectId);
  expect(folders.find((item) => item.name === "Workspace Home")!.parentId).toBe(
    destination.id,
  );
});

test("a Word document becomes one page with formatting, lists, a merged table, an image and footnotes", async () => {
  const path = join(outside, "report.docx");
  await writeFile(path, docxFile());
  const plan = await planImport(
    service,
    { path },
    { projectId, parentId: null },
  );
  expect(plan.importer.id).toBe("word");
  expect(plan.items).toEqual([
    {
      type: "page",
      key: "report.docx",
      title: "Quarterly Report",
      source: "report.docx",
    },
  ]);
  expect(plan.warnings).toEqual([
    {
      source: "report.docx",
      message: "1 comment was left out; comments are not page content.",
    },
  ]);
  const report = await runImport(
    service,
    { path },
    { projectId, parentId: null },
  );
  expect(report.problems).toEqual([]);
  expect(plan.counts.resources).toBe(1);
  expect(report.created.resources).toBe(1);
  const page = await service.store.readPage(projectId, report.openPageId!);
  expect(page.document.title).toBe("Quarterly Report");
  const all = nodes(page.document.content);
  const text = (value: string) =>
    all.find((node) => node.type === "text" && node.text === value);
  expect(
    all
      .filter((node) => node.type === "heading")
      .map((node) => node.attrs!.level),
  ).toEqual([1, 2]);
  expect(text("bold")!.marks).toEqual([{ type: "bold" }]);
  expect(text("italic")!.marks).toEqual([{ type: "italic" }]);
  expect(text("underlined")!.marks).toEqual([{ type: "underline" }]);
  expect(text("struck")!.marks).toEqual([{ type: "strike" }]);
  expect(text("code()")!.marks).toEqual([{ type: "code" }]);
  expect(text("a link")!.marks).toEqual([
    { type: "link", attrs: { href: "https://example.com/report" } },
  ]);
  expect(text("[1]")!.marks).toEqual([
    { type: "annotation", attrs: { note: "Source: internal survey." } },
  ]);
  expect(text("Source: internal survey.")).toBeDefined();
  // "First" and "Second" are numbered; the details nest as bullets under "First".
  const ordered = all.find((node) => node.type === "orderedList")!;
  expect(ordered.content).toHaveLength(2);
  expect(ordered.content![0].content!.map((node) => node.type)).toEqual([
    "paragraph",
    "bulletList",
  ]);
  expect(ordered.content![0].content![1].content).toHaveLength(2);
  const cells = all.filter(
    (node) => node.type === "tableCell" || node.type === "tableHeader",
  );
  expect(
    cells.map((cell) => [cell.type, cell.attrs!.colspan, cell.attrs!.rowspan]),
  ).toEqual([
    ["tableHeader", 1, 1],
    ["tableHeader", 1, 1],
    ["tableHeader", 1, 1],
    ["tableCell", 1, 2],
    ["tableCell", 2, 1],
    ["tableCell", 1, 1],
    ["tableCell", 1, 1],
  ]);
  const image = all.find((node) => node.type === "image")!;
  expect(image.attrs!.alt).toBe("Chart");
  expect(String(image.attrs!.src)).toMatch(/^data:image\/png;base64,/);
  expect(JSON.stringify(page.document.content)).not.toContain("Check this");
});

test("Markdown files keep importing as one page each, without a wrapping folder", async () => {
  const report = await runImport(
    service,
    {
      files: [
        {
          name: "a.md",
          data: Buffer.from("# Alpha\n\nText **bold**").toString("base64"),
        },
        { name: "b.txt", data: Buffer.from("plain").toString("base64") },
      ],
    },
    { projectId, parentId: null },
  );
  expect(report.plan.importer.id).toBe("markdown");
  expect(report.folderId).toBeNull();
  expect(report.created.pages).toBe(2);
  expect(report.undo.pages).toHaveLength(2);
  const alpha = await service.store.readPage(projectId, report.pages[0].pageId);
  expect(alpha.document.title).toBe("a");
  expect(
    nodes(alpha.document.content).some((node) => node.type === "heading"),
  ).toBe(true);
});

const TODO_IMPORTER = {
  manifest: {
    format: "showai-importer",
    id: "todo-lists",
    name: "Todo lists",
    version: "1.0.0",
    description:
      "Plain .todo files: the first line is the title, each further line a task.",
    extensions: [".todo"],
  },
  script: `function detect(input) {
  return input.files.every((file) => file.path.endsWith(".todo")) ? 0.8 : 0;
}
function convert(input) {
  const pages = input.files.map((file) => {
    const [title, ...tasks] = file.text.split("\\n").filter(Boolean);
    return {
      key: file.path,
      title,
      blocks: [
        { kind: "callout", data: { icon: "✅", content: tasks.length + " tasks" } },
        { kind: "text", data: { format: "markdown", content: tasks.map((task) => "- [ ] " + task).join("\\n") + "\\n\\nBack to [all lists](showai-import:page/index)" } },
      ],
    };
  });
  pages.push({ key: "index", title: "All lists", blocks: [
    { kind: "database", data: { title: "Lists", view: "table", $binding: { dataset: "showai-import:dataset/lists", props: { local: ["title", "view"] } } } },
  ] });
  return {
    pages,
    datasets: [{ key: "lists", name: "Lists", value: {
      columns: [{ id: "title", name: "Title", type: "text" }, { id: "page", name: "Page", type: "page" }],
      rows: input.files.map((file, index) => ({ id: "r" + index, title: file.path, page: "showai-import:page/" + encodeURIComponent(file.path) })),
    } }],
  };
}`,
};

test("an importer contributed to the library fills the same slot and runs sandboxed", async () => {
  await service.store.createFolder(projectId, { name: "unused" });
  await saveContributedImporter(root, TODO_IMPORTER, { scope: "global" });
  const listed = await listContributedImporters(root, projectId);
  expect(
    listed.importers.map((item) => [item.manifest.id, item.scope]),
  ).toEqual([["todo-lists", "global"]]);
  const report = await runImport(
    service,
    {
      files: [
        {
          name: "home.todo",
          data: Buffer.from("Home\nWater plants\nFix door").toString("base64"),
        },
        {
          name: "work.todo",
          data: Buffer.from("Work\nSend report").toString("base64"),
        },
      ],
    },
    { projectId, parentId: null },
  );
  expect(report.plan.importer).toMatchObject({
    id: "todo-lists",
    origin: "global",
  });
  expect(report.problems).toEqual([]);
  const index = report.pages.find((page) => page.key === "index")!;
  const home = await service.store.readPage(
    projectId,
    report.pages.find((page) => page.key === "home.todo")!.pageId,
  );
  expect(home.document.title).toBe("Home");
  const homeNodes = nodes(home.document.content);
  expect(homeNodes.filter((node) => node.type === "taskItem")).toHaveLength(2);
  expect(
    homeNodes.some((node) =>
      node.marks?.some((mark) => mark.attrs?.href === link(index.pageId)),
    ),
  ).toBe(true);
  const datasets = await service.datasetList(projectId);
  const lists = datasets.find((item) => item.name === "Lists")!;
  const value = (
    (await service.datasetRead(projectId, lists.id)).dataset as {
      value: unknown;
    }
  ).value as {
    rows: { page: string }[];
  };
  expect(value.rows[0].page).toBe(link(home.document.id));

  // The sandbox has no host objects, and a bundle that breaks the contract is refused.
  await saveContributedImporter(
    root,
    {
      manifest: {
        ...TODO_IMPORTER.manifest,
        id: "escaping",
        extensions: [".esc"],
      },
      script:
        "function convert() { return { pages: [{ key: 'x', title: typeof require + typeof process }] }; }",
    },
    { scope: "project", projectId },
  );
  await expect(
    planImport(
      service,
      { files: [{ name: "a.esc", data: "" }] },
      { projectId, parentId: null },
    ),
  ).rejects.toThrow(/page x needs either blocks or artifact/);
  await removeContributedImporter(root, "escaping", {
    scope: "project",
    projectId,
  });
  await removeContributedImporter(root, "todo-lists", { scope: "global" });
  expect((await listContributedImporters(root, projectId)).importers).toEqual(
    [],
  );
});

test("a cancelled import keeps what it wrote and reports the rest as not written", async () => {
  const zip = join(outside, "cancel.zip");
  await writeFile(zip, notionZip());
  const controller = new AbortController();
  const report = await runImport(
    service,
    { path: zip },
    { projectId, parentId: null },
    {
      signal: controller.signal,
      onProgress: (step) => {
        if (step.done === 3) controller.abort();
      },
    },
  );
  expect(report.cancelled).toBe(true);
  expect(report.created.folders).toBe(2);
  expect(report.created.databases).toBe(1);
  expect(report.created.pages).toBe(0);
});

test("an Agent saves an importer and imports through MCP, with a dry run first", async () => {
  const server = createMcpServer({ root, projectId });
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "import-test", version: "1" });
  await server.connect(right);
  await client.connect(left);
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args });
    const content = result.structuredContent as {
      ok: boolean;
      data?: any;
      error?: unknown;
    };
    if (!content.ok) throw new Error(JSON.stringify(content.error));
    return content.data;
  };
  try {
    const saved = await call("catalog_version", {
      action: "importer",
      manifest: TODO_IMPORTER.manifest,
      script: TODO_IMPORTER.script,
    });
    expect(saved).toMatchObject({ id: "todo-lists", scope: "project" });
    const listed = await call("catalog_list", { kind: "importer" });
    expect(
      listed.importers.map((item: { id: string; origin: string }) => [
        item.id,
        item.origin,
      ]),
    ).toEqual([
      ["todo-lists", "project"],
      ["notion", "builtin"],
      ["word", "builtin"],
      ["markdown", "builtin"],
    ]);
    expect(
      (await call("catalog_describe", { id: "todo-lists", kind: "importer" }))
        .script,
    ).toBe(TODO_IMPORTER.script);
    const source = join(outside, "garden.todo");
    await writeFile(source, "Garden\nWater\nWeed");
    const before = (await service.store.listPages(projectId)).length;
    const plan = await call("page_create", {
      import: { source, dryRun: true },
    });
    expect(plan.importer.id).toBe("todo-lists");
    expect(plan.counts).toMatchObject({ pages: 2, databases: 1 });
    expect((await service.store.listPages(projectId)).length).toBe(before);
    const report = await call("page_create", { import: { source } });
    expect(report.created).toMatchObject({ pages: 2, databases: 1 });
    expect((await service.store.listPages(projectId)).length).toBe(before + 2);
    await expect(
      call("page_create", { title: "x", import: { source } }),
    ).rejects.toThrow(/pass only parentId/);
    await call("catalog_version", {
      action: "remove",
      kind: "importer",
      id: "todo-lists",
    });
    expect(
      (await call("catalog_list", { kind: "importer" })).importers,
    ).toHaveLength(3);
  } finally {
    await client.close();
    await server.close();
  }
});
