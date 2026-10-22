import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLibraryMcpServer } from "./mcp-library";
import { createMcpServer } from "./mcp";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";

let root: string;
const connections: {
  client: Client;
  server: ReturnType<typeof createMcpServer>;
}[] = [];
async function connect(server: ReturnType<typeof createMcpServer>) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "workspace-management-test",
    version: "1",
  });
  await server.connect(right);
  await client.connect(left);
  connections.push({ client, server });
  return client;
}
async function call(
  c: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await c.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return (result.structuredContent as any).data;
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-mcp-management-"));
  await openLibrary(root);
});
afterAll(async () => {
  for (const { client, server } of connections) {
    await client.close();
    await server.close();
  }
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

test("library MCP organizes real folders, projects and sidebar entries with scoped cross-project moves", async () => {
  const c = await connect(createLibraryMcpServer({ root }));
  const a = await call(c, "project_create", { name: "Source" });
  const b = await call(c, "project_create", { name: "Destination" });
  const projectId = a.id;
  const folder = await call(c, "organization_update", {
    action: "create_folder",
    projectId,
    name: "Promotion",
    icon: "📁",
    operationId: "create-folder-once",
  });
  expect(
    (
      await call(c, "organization_update", {
        action: "create_folder",
        projectId,
        name: "Promotion",
        icon: "📁",
        operationId: "create-folder-once",
      })
    ).id,
  ).toBe(folder.id);
  const child = await call(c, "organization_update", {
    action: "create_folder",
    projectId,
    name: "Materials",
    parentId: folder.id,
  });
  await call(c, "organization_update", {
    action: "update_folder",
    projectId,
    folderId: folder.id,
    name: "Launch",
    pinned: true,
    archived: true,
  });
  expect(
    await call(c, "organization_read", { action: "folders", projectId }),
  ).toEqual([]);
  expect(
    await call(c, "organization_read", {
      action: "folders",
      projectId,
      includeArchived: true,
    }),
  ).toHaveLength(2);
  await call(c, "organization_update", {
    action: "update_folder",
    projectId,
    folderId: folder.id,
    archived: false,
  });
  expect(
    (await call(c, "organization_read", { action: "folders", projectId })).find(
      (f: any) => f.id === folder.id,
    ),
  ).toMatchObject({ name: "Launch", pinned: true });
  expect(
    (
      await c.callTool({
        name: "organization_update",
        arguments: {
          action: "move",
          projectId,
          kind: "folder",
          id: folder.id,
          parentId: child.id,
        },
      })
    ).isError,
  ).toBe(true);
  await call(c, "organization_update", {
    action: "move",
    projectId,
    kind: "folder",
    id: child.id,
    parentId: null,
  });
  await call(c, "organization_update", {
    action: "sort",
    projectId,
    parentId: null,
    sortBy: "name",
  });
  const page = await call(c, "page_create", {
    projectId,
    title: "Campaign",
    parentId: folder.id,
  });
  expect(page.document.parentId).toBe(folder.id);
  const bound = await connect(createMcpServer({ root, projectId }));
  const boundTools = (await bound.listTools()).tools;
  expect(
    (
      boundTools.find((t) => t.name === "organization_read")?.inputSchema
        .properties?.action as { enum?: string[] }
    ).enum,
  ).toEqual(["folders"]);
  expect(
    (
      boundTools.find((t) => t.name === "organization_update")?.inputSchema
        .properties?.action as { enum?: string[] }
    ).enum,
  ).not.toContain("create_group");
  expect(
    (
      await bound.callTool({
        name: "organization_update",
        arguments: {
          action: "move",
          projectId,
          kind: "page",
          id: page.document.id,
          destinationProjectId: b.id,
          parentId: null,
          baseHash: page.hash,
          baseRevision: page.revision,
        },
      })
    ).isError,
  ).toBe(true);
  const moved = await call(c, "organization_update", {
    action: "move",
    projectId,
    kind: "page",
    id: page.document.id,
    destinationProjectId: b.id,
    parentId: null,
    baseHash: page.hash,
    baseRevision: page.revision,
  });
  expect(moved.page.document.id).toBe(page.document.id);
  expect(await call(c, "pages_list", { projectId })).toEqual([]);
  expect((await call(c, "pages_list", { projectId: b.id }))[0].id).toBe(
    page.document.id,
  );
  const sidebar = await call(c, "organization_update", {
    action: "create_group",
    projectId,
    name: "Research",
  });
  const group = sidebar.groups.find((g: any) => g.name === "Research");
  await call(c, "organization_update", {
    action: "move_project",
    projectId,
    sectionId: group.id,
  });
  await call(c, "organization_update", {
    action: "move_project",
    projectId: b.id,
    sectionId: group.id,
    relativeProjectId: projectId,
    placement: "before",
  });
  expect(
    (await call(c, "organization_read", { action: "sidebar", projectId }))
      .projectGroups[projectId],
  ).toBe(group.id);
  await call(c, "organization_update", {
    action: "update_group",
    projectId,
    sidebarGroupId: group.id,
    name: "Projects",
  });
  await call(c, "organization_update", {
    action: "update_group",
    projectId,
    sidebarGroupId: group.id,
    name: null,
  });
  expect(
    (await call(c, "organization_read", { action: "sidebar", projectId }))
      .groups,
  ).toEqual([]);
  await call(c, "organization_update", {
    action: "update_project",
    projectId,
    name: "Renamed",
    icon: "🧠",
    pinned: true,
    archived: true,
  });
  expect(
    (await call(c, "projects_list")).some((p: any) => p.id === projectId),
  ).toBe(false);
  expect(
    (await call(c, "projects_list", { includeArchived: true })).find(
      (p: any) => p.id === projectId,
    ),
  ).toMatchObject({ name: "Renamed", archived: true, pinned: true });
  await call(c, "organization_update", {
    action: "update_project",
    projectId,
    archived: false,
  });
  expect(
    (await call(c, "project_context", { projectId })).project.folders,
  ).toHaveLength(2);
});

test("draft operations retain generations, reject foreign projects and complete only exact committed page content", async () => {
  const c = await connect(createLibraryMcpServer({ root }));
  const projectId = (await call(c, "project_create", { name: "Draft checks" }))
    .id;
  const other = (await call(c, "project_create", { name: "Other draft owner" }))
    .id;
  const page = await call(c, "page_create", {
    projectId,
    title: "Saved draft",
  });
  const input = {
    projectId,
    kind: "page",
    clientId: "test-editor",
    resourceId: page.document.id,
    content: page.document,
    baseRevision: page.revision,
    baseContent: page.document,
    sequence: 1,
  };
  const draft = await call(c, "draft_write", { action: "save", ...input });
  expect(
    (await call(c, "draft_read", { action: "list", projectId }))[0].generation,
  ).toBe(draft.generation);
  expect(
    (
      await call(c, "draft_read", {
        action: "read",
        projectId,
        draftId: draft.id,
      })
    ).content.title,
  ).toBe("Saved draft");
  for (const [name, args] of [
    ["draft_read", { action: "read", draftId: draft.id }],
    ["draft_remove", { draftId: draft.id, generation: draft.generation }],
    [
      "draft_write",
      {
        action: "complete",
        draftId: draft.id,
        generation: draft.generation,
        revision: page.revision,
      },
    ],
  ] as const)
    expect(
      (
        await c.callTool({
          name,
          arguments: { projectId: other, ...args },
        })
      ).isError,
    ).toBe(true);
  const newer = await call(c, "draft_write", {
    action: "save",
    ...input,
    sequence: 2,
    content: { ...page.document, title: "Unsaved" },
  });
  expect(
    (
      await c.callTool({
        name: "draft_remove",
        arguments: {
          projectId,
          draftId: draft.id,
          generation: draft.generation,
        },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await c.callTool({
        name: "draft_write",
        arguments: {
          action: "complete",
          projectId,
          draftId: draft.id,
          generation: newer.generation,
          revision: page.revision,
        },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await call(c, "draft_read", {
        action: "read",
        projectId,
        draftId: draft.id,
      })
    ).content.title,
  ).toBe("Unsaved");
  await call(c, "draft_remove", {
    projectId,
    draftId: draft.id,
    generation: newer.generation,
  });
  const exact = await call(c, "draft_write", {
    action: "save",
    ...input,
    sequence: 3,
  });
  expect(
    await call(c, "draft_write", {
      action: "complete",
      projectId,
      draftId: exact.id,
      generation: exact.generation,
      revision: page.revision,
    }),
  ).toMatchObject({ completed: true });
  expect(await call(c, "draft_read", { action: "list", projectId })).toEqual(
    [],
  );
});
