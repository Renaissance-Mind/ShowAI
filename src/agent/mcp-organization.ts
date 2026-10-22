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
        "List project folders with hierarchy, icons, pins and sort settings.",
      inputSchema: { includeArchived: z.boolean().optional() },
      annotations: read,
    },
    ({ includeArchived }) => call(() => service.folders(includeArchived)),
  );
  register(
    "folder_create",
    {
      description:
        "Create a folder in this project; parentId is a folder or null for the root.",
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
        "Rename a folder, change its icon or pin, or archive/restore it.",
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
        "Rename this project, change its icon or pin, or archive/restore it.",
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
        "Set child sorting for the project root (parentId:null) or a folder.",
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
        "Move or reorder a page or folder. parentId is the destination folder (null for root); relativeId/placement set the position. Pages need baseHash/baseRevision and may move to destinationProjectId; reorderOnly keeps content unchanged.",
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
          "Read this connection's sidebar groups and manual project order.",
        inputSchema: {},
        annotations: read,
      },
      () => call(() => service.sidebar()),
    );
    register(
      "sidebar_group_create",
      {
        description: "Create a sidebar group for projects.",
        inputSchema: { ...metadata, name: z.string().trim().min(1).max(1000) },
        annotations: write,
      },
      ({ name, ...meta }) => call(() => service.createGroup(name), meta),
    );
    register(
      "sidebar_group_update",
      {
        description: "Rename a sidebar group, or remove it with name:null.",
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
          "Move this project to projects, pinned or a sidebar group, optionally before/after another project.",
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
        "Find where a component or template is referenced in this project's pages and packages; version/integrity narrow the target.",
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
      description: "List editor drafts in this project's connection workspace.",
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
      description: "Read one draft and its current generation.",
      inputSchema: { draftId: z.string().regex(/^[a-f0-9]{64}$/) },
      annotations: read,
    },
    ({ draftId }) => call(() => service.readDraft(draftId)),
  );
  register(
    "draft_save",
    {
      description:
        "Save an editable page/component/template draft in this connection's workspace; drafts are not formal content and do not sync. sequence orders one client's updates.",
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
        "Discard a reviewed draft generation; a newer generation returns CONFLICT.",
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
        "Complete a page draft after saving its exact content, with the draft generation and the saved page revision.",
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
