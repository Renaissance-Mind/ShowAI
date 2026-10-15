import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { WorkspaceService } from "./workspace-service";
import type { EditorDraftInput } from "../core/editor-drafts";
import { validateDocument } from "../portable/validation.mjs";

export const organizationWriteTools = new Set([
  "folder_create",
  "folder_update",
  "project_update",
  "directory_sort",
  "entry_move",
  "sidebar_group_create",
  "sidebar_group_update",
  "sidebar_project_move",
  "draft_save",
  "draft_remove",
  "draft_complete",
]);
export const sidebarTools = new Set([
  "sidebar_read",
  "sidebar_group_create",
  "sidebar_group_update",
  "sidebar_project_move",
]);
export const draftTools = new Set([
  "drafts_list",
  "draft_read",
  "draft_save",
  "draft_remove",
  "draft_complete",
]);

export function registerOrganizationTools(
  register: McpServer["registerTool"],
  service: WorkspaceService,
  call: (
    handler: () => Promise<unknown>,
    metadata?: { operationId?: string; message?: string; groupId?: string },
  ) => Promise<CallToolResult>,
) {
  const id = z.string().min(1).max(128);
  const metadata = {
    operationId: z.string().max(1000).optional(),
    message: z.string().max(4000).optional(),
    groupId: z.string().max(1000).optional(),
  };
  const read = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  };
  const write = { ...read, readOnlyHint: false };
  register(
    "folders_list",
    {
      description:
        "List real project folders and their hierarchy, icons, pins and directory preferences. includeArchived includes archived ancestors and children.",
      inputSchema: { includeArchived: z.boolean().optional() },
      annotations: read,
    },
    ({ includeArchived }) => call(() => service.folders(includeArchived)),
  );
  register(
    "folder_create",
    {
      description:
        "Create a real folder in this project. parentId is a folder identity, or null for the project root. A Page is not a folder.",
      inputSchema: {
        ...metadata,
        name: z.string().trim().min(1).max(1000),
        icon: z.string().optional(),
        parentId: id.nullable().optional(),
      },
      annotations: write,
    },
    ({ name, icon, parentId, ...meta }) =>
      call(() => service.createFolder({ name, icon, parentId }), meta),
  );
  register(
    "folder_update",
    {
      description:
        "Rename a folder, change its icon/pin, or archive/restore it. Archiving hides its descendants without deleting content. Move with entry_move.",
      inputSchema: {
        ...metadata,
        folderId: id,
        name: z.string().trim().min(1).max(1000).optional(),
        icon: z.string().optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      },
      annotations: write,
    },
    ({ folderId, name, icon, pinned, archived, ...meta }) =>
      call(
        () => service.updateFolder(folderId, { name, icon, pinned, archived }),
        meta,
      ),
  );
  register(
    "project_update",
    {
      description:
        "Rename this project, change its icon/pin, or archive/restore it. Remote archive/restore requires current project administrator permission. Content is retained.",
      inputSchema: {
        ...metadata,
        name: z.string().trim().min(1).max(1000).optional(),
        icon: z.string().optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      },
      annotations: write,
    },
    ({ name, icon, pinned, archived, ...meta }) =>
      call(() => service.updateProject({ name, icon, pinned, archived }), meta),
  );
  register(
    "directory_sort",
    {
      description:
        "Set sorting for the project's root (parentId:null) or one folder. Manual placement uses entry_move with relativeId/placement.",
      inputSchema: {
        ...metadata,
        parentId: id.nullable(),
        sortBy: z.enum(["name", "createdAt", "updatedAt", "manual"]),
      },
      annotations: write,
    },
    ({ parentId, sortBy, ...meta }) =>
      call(() => service.sort(parentId, sortBy), meta),
  );
  register(
    "entry_move",
    {
      description:
        "Move/reorder a page or folder. Pages may move between authorized projects with their pinned component dependencies. Folders move only within their project. Page moves require baseHash/baseRevision; reorderOnly changes sibling order without changing content. parentId is a destination folder, or null for root.",
      inputSchema: {
        ...metadata,
        kind: z.enum(["page", "folder"]),
        id,
        destinationProjectId: id.optional(),
        parentId: id.nullable(),
        relativeId: id.optional(),
        placement: z.enum(["before", "after"]).optional(),
        reorderOnly: z.boolean().optional(),
        baseHash: z.string().min(1).optional(),
        baseRevision: z.string().min(1).optional(),
      },
      annotations: write,
    },
    ({
      kind,
      id: entryId,
      destinationProjectId,
      parentId,
      relativeId,
      placement,
      reorderOnly,
      baseHash,
      baseRevision,
      ...meta
    }) =>
      call(
        () =>
          service.moveEntry({
            kind,
            id: entryId,
            destinationProjectId: destinationProjectId ?? service.projectId,
            parentId,
            relativeId,
            placement,
            reorderOnly,
            baseHash,
            baseRevision,
          }),
        meta,
      ),
  );
  if (service.options.libraryAccess) {
    register(
      "sidebar_read",
      {
        description:
          "Read this library/remote connection's sidebar groups and manual order. Sidebar groups/order belong to this connection's workspace; they are not project content synchronized to other devices.",
        inputSchema: {},
        annotations: read,
      },
      () => call(() => service.sidebar()),
    );
    register(
      "sidebar_group_create",
      {
        description:
          "Create a sidebar group in this library/remote connection. It contains project memberships, not Pages or folders.",
        inputSchema: { ...metadata, name: z.string().trim().min(1).max(1000) },
        annotations: write,
      },
      ({ name, ...meta }) => call(() => service.createGroup(name), meta),
    );
    register(
      "sidebar_group_update",
      {
        description:
          "Rename a sidebar group, or pass name:null to remove the group while retaining its projects.",
        inputSchema: {
          ...metadata,
          sidebarGroupId: id,
          name: z.string().trim().min(1).max(1000).nullable(),
        },
        annotations: write,
      },
      ({ sidebarGroupId, name, ...meta }) =>
        call(() => service.updateGroup(sidebarGroupId, name), meta),
    );
    register(
      "sidebar_project_move",
      {
        description:
          "Move this project into projects, pinned, or a sidebar group ID, optionally before/after another authorized project. Project pin changes sync; sidebar groups/order stay in this connection's workspace.",
        inputSchema: {
          ...metadata,
          sectionId: id,
          relativeProjectId: id.optional(),
          placement: z.enum(["before", "after"]).optional(),
        },
        annotations: write,
      },
      ({ sectionId, relativeProjectId, placement, ...meta }) =>
        call(
          () => service.moveProject(sectionId, relativeProjectId, placement),
          meta,
        ),
    );
  }
  register(
    "catalog_references",
    {
      description:
        "Find exact component/template reference sites in this project's current pages and packages. Optional version/integrity restrict the target; returns logical source paths and block IDs.",
      inputSchema: {
        kind: z.enum(["component", "template"]),
        id: z.string().min(1),
        version: z.string().optional(),
        integrity: z.string().optional(),
      },
      annotations: read,
    },
    ({ kind, id: target, version, integrity }) =>
      call(() => service.references(kind, target, { version, integrity })),
  );
  register(
    "drafts_list",
    {
      description:
        "List retained editor drafts in this project and this connection's workspace. Drafts do not sync to other devices and are not saved Pages.",
      inputSchema: {
        clientId: z.string().min(1).optional(),
        resourceId: z.string().min(1).optional(),
        kind: z.enum(["page", "component", "template"]).optional(),
      },
      annotations: read,
    },
    (input) => call(() => service.drafts(input)),
  );
  register(
    "draft_read",
    {
      description:
        "Read one retained draft in this project, including its current generation. Read/merge/save through normal page/package operations before completing it.",
      inputSchema: { draftId: z.string().regex(/^[a-f0-9]{64}$/) },
      annotations: read,
    },
    ({ draftId }) => call(() => service.readDraft(draftId)),
  );
  register(
    "draft_save",
    {
      description:
        "Retain an editable page/component/template draft in this project's connection workspace. This does not save formal content or synchronize the draft. Sequence guards same-client updates; page drafts may include their exact baseline.",
      inputSchema: {
        kind: z.enum(["page", "component", "template"]),
        clientId: z.string().min(1).max(1000),
        resourceId: id,
        content: z.unknown(),
        baseRevision: z.string().optional(),
        baseContent: z.record(z.string(), z.unknown()).optional(),
        title: z.string().optional(),
        sequence: z.number().int().nonnegative().optional(),
      },
      annotations: write,
    },
    ({ baseContent, ...input }) =>
      call(() =>
        service.saveDraft({
          ...input,
          ...(baseContent
            ? { baseContent: validateDocument(baseContent) }
            : {}),
        } as Omit<EditorDraftInput, "projectId" | "actor">),
      ),
  );
  register(
    "draft_remove",
    {
      description:
        "Explicitly discard a reviewed draft generation. A newer generation is retained and returns CONFLICT. The discarded payload is retained locally for recovery.",
      inputSchema: {
        draftId: z.string().regex(/^[a-f0-9]{64}$/),
        generation: z.string().uuid(),
      },
      annotations: { ...write, destructiveHint: true },
    },
    ({ draftId, generation }) =>
      call(() => service.removeDraft(draftId, generation)),
  );
  register(
    "draft_complete",
    {
      description:
        "Complete a page draft only after saving its exact content. Requires the read generation and committed page revision; differing content/newer drafts are retained.",
      inputSchema: {
        draftId: z.string().regex(/^[a-f0-9]{64}$/),
        generation: z.string().uuid(),
        revision: z.string().min(1),
      },
      annotations: write,
    },
    ({ draftId, generation, revision }) =>
      call(() => service.completeDraft(draftId, generation, revision)),
  );
}
