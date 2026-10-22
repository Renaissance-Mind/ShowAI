import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { WorkspaceService } from "./workspace-service";
import type { EditorDraftInput } from "../core/editor-drafts";
import { validateDocument } from "../portable/validation.mjs";
import { actionTool, type ToolAction } from "./mcp-actions";

export const organizationWriteTools = new Set([
  "organization_update",
  "draft_write",
  "draft_remove",
]);
/** Operations on this connection's sidebar, keyed tool:action. */
export const sidebarOperations = new Set([
  "organization_read:sidebar",
  "organization_update:create_group",
  "organization_update:update_group",
  "organization_update:move_project",
]);
export const draftTools = new Set([
  "draft_read",
  "draft_write",
  "draft_remove",
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
  const name = z.string().trim().min(1).max(1000);
  const groupName = name.nullable();
  const parentId = id.nullable();
  const placement = z.enum(["before", "after"]);
  const readActions: Record<string, ToolAction> = {
    folders: {
      fields: { includeArchived: z.boolean().optional() },
      run: ({ includeArchived }) =>
        call(() => service.folders(includeArchived as boolean | undefined)),
    },
  };
  const updateActions: Record<string, ToolAction> = {
    create_folder: {
      fields: {
        ...metadata,
        name,
        icon: z.string().optional(),
        parentId: parentId.optional(),
      },
      run: ({ name, icon, parentId, ...meta }) =>
        call(
          () =>
            service.createFolder({
              name: name as string,
              icon: icon as string | undefined,
              parentId: parentId as string | null | undefined,
            }),
          meta,
        ),
    },
    update_folder: {
      fields: {
        ...metadata,
        folderId: id,
        name: name.optional(),
        icon: z.string().optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      },
      run: ({ folderId, name, icon, pinned, archived, ...meta }) =>
        call(
          () =>
            service.updateFolder(folderId as string, {
              name: name as string | undefined,
              icon: icon as string | undefined,
              pinned: pinned as boolean | undefined,
              archived: archived as boolean | undefined,
            }),
          meta,
        ),
    },
    update_project: {
      fields: {
        ...metadata,
        name: name.optional(),
        icon: z.string().optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
      },
      run: ({ name, icon, pinned, archived, ...meta }) =>
        call(
          () =>
            service.updateProject({
              name: name as string | undefined,
              icon: icon as string | undefined,
              pinned: pinned as boolean | undefined,
              archived: archived as boolean | undefined,
            }),
          meta,
        ),
    },
    sort: {
      fields: {
        ...metadata,
        parentId,
        sortBy: z.enum(["name", "createdAt", "updatedAt", "manual"]),
      },
      run: ({ parentId, sortBy, ...meta }) =>
        call(
          () =>
            service.sort(
              parentId as string | null,
              sortBy as "name" | "createdAt" | "updatedAt" | "manual",
            ),
          meta,
        ),
    },
    move: {
      fields: {
        ...metadata,
        kind: z.enum(["page", "folder"]),
        id,
        destinationProjectId: id.optional(),
        parentId,
        relativeId: id.optional(),
        placement: placement.optional(),
        reorderOnly: z.boolean().optional(),
        baseHash: z.string().min(1).optional(),
        baseRevision: z.string().min(1).optional(),
      },
      run: ({
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
              kind: kind as "page" | "folder",
              id: entryId as string,
              destinationProjectId:
                (destinationProjectId as string | undefined) ??
                service.projectId,
              parentId: parentId as string | null,
              relativeId: relativeId as string | undefined,
              placement: placement as "before" | "after" | undefined,
              reorderOnly: reorderOnly as boolean | undefined,
              baseHash: baseHash as string | undefined,
              baseRevision: baseRevision as string | undefined,
            }),
          meta,
        ),
    },
  };
  if (service.options.libraryAccess) {
    readActions.sidebar = {
      fields: {},
      run: () => call(() => service.sidebar()),
    };
    updateActions.create_group = {
      fields: { ...metadata, name },
      run: ({ name, ...meta }) =>
        call(() => service.createGroup(name as string), meta),
    };
    updateActions.update_group = {
      fields: { ...metadata, sidebarGroupId: id, name: groupName },
      run: ({ sidebarGroupId, name, ...meta }) =>
        call(
          () =>
            service.updateGroup(
              sidebarGroupId as string,
              name as string | null,
            ),
          meta,
        ),
    };
    updateActions.move_project = {
      fields: {
        ...metadata,
        sectionId: id,
        relativeProjectId: id.optional(),
        placement: placement.optional(),
      },
      run: ({ sectionId, relativeProjectId, placement, ...meta }) =>
        call(
          () =>
            service.moveProject(
              sectionId as string,
              relativeProjectId as string | undefined,
              placement as "before" | "after" | undefined,
            ),
          meta,
        ),
    };
  }
  const organizationRead = actionTool(
    "Read project folders or this connection's sidebar groups and project order.",
    readActions,
  );
  register(
    "organization_read",
    {
      description: organizationRead.description,
      inputSchema: organizationRead.inputSchema,
      annotations: read,
    },
    organizationRead.handler,
  );
  const organizationUpdate = actionTool(
    "Change folders, this project or the sidebar. parentId is a folder or null for the root; page moves need baseHash/baseRevision; sectionId is projects, pinned or a sidebar group; update_group with name:null removes it.",
    updateActions,
  );
  register(
    "organization_update",
    {
      description: organizationUpdate.description,
      inputSchema: organizationUpdate.inputSchema,
      annotations: write,
    },
    organizationUpdate.handler,
  );
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
  const draftId = z.string().regex(/^[a-f0-9]{64}$/);
  const generation = z.string().uuid();
  const draftRead = actionTool(
    "Read editor drafts in this project's connection workspace; drafts are not formal content and do not sync.",
    {
      list: {
        fields: {
          clientId: z.string().min(1).optional(),
          resourceId: z.string().min(1).optional(),
          kind: z.enum(["page", "component", "template"]).optional(),
        },
        run: (input) =>
          call(() =>
            service.drafts(input as Parameters<typeof service.drafts>[0]),
          ),
      },
      read: {
        fields: { draftId },
        run: ({ draftId }) => call(() => service.readDraft(draftId as string)),
      },
    },
  );
  register(
    "draft_read",
    {
      description: draftRead.description,
      inputSchema: draftRead.inputSchema,
      annotations: read,
    },
    draftRead.handler,
  );
  const draftWrite = actionTool(
    "Save an editable draft, or complete a page draft after saving its exact content.",
    {
      save: {
        fields: {
          kind: z.enum(["page", "component", "template"]),
          clientId: z.string().min(1).max(1000),
          resourceId: id,
          content: z.unknown(),
          baseRevision: z.string().optional(),
          baseContent: z.record(z.string(), z.unknown()).optional(),
          title: z.string().optional(),
          sequence: z.number().int().nonnegative().optional(),
        },
        run: ({ baseContent, ...input }) =>
          call(() =>
            service.saveDraft({
              ...input,
              ...(baseContent
                ? {
                    baseContent: validateDocument(
                      baseContent as Record<string, unknown>,
                    ),
                  }
                : {}),
            } as Omit<EditorDraftInput, "projectId" | "actor">),
          ),
      },
      complete: {
        fields: { draftId, generation, revision: z.string().min(1) },
        run: ({ draftId, generation, revision }) =>
          call(() =>
            service.completeDraft(
              draftId as string,
              generation as string,
              revision as string,
            ),
          ),
      },
    },
  );
  register(
    "draft_write",
    {
      description: draftWrite.description,
      inputSchema: draftWrite.inputSchema,
      annotations: write,
    },
    draftWrite.handler,
  );
  register(
    "draft_remove",
    {
      description:
        "Discard a reviewed draft generation; a newer generation returns CONFLICT.",
      inputSchema: { draftId, generation },
      annotations: { ...write, destructiveHint: true },
    },
    ({ draftId, generation }) =>
      call(() => service.removeDraft(draftId, generation)),
  );
}
