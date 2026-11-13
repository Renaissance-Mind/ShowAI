import { z } from "zod";
import type { EditorDraftInput } from "../../core/editor-drafts";
import { validateDocument } from "../../portable/validation.mjs";
import type { ToolAction } from "../mcp-actions";
import { pageStateReceipt } from "../page-receipt";
import type { PageRecord } from "../../core/model";
import { pageDuplicate, pageUpdate } from "../operations/pages";
import type { ToolConnection, ToolDeclaration } from "./tool";

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

const id = z.string().min(1).max(128);
const metadata = {
  operationId: z.string().max(1000).optional(),
  message: z.string().max(4000).optional(),
  groupId: z.string().max(1000).optional(),
};
const name = z.string().trim().min(1).max(1000);
const groupName = name.nullable();
const parentId = id.nullable();
const placement = z.enum(["before", "after"]);
const draftId = z.string().regex(/^[a-f0-9]{64}$/);
const generation = z.string().uuid();

/** Folder, page, project and sidebar actions of organization_read and _update. */
function organizationActions({
  workspace: service,
  service: pages,
  call,
}: ToolConnection) {
  const readActions: Record<string, ToolAction> = {
    folders: {
      fields: { includeArchived: z.boolean().optional() },
      run: ({ includeArchived }) =>
        call(() => service.folders(includeArchived as boolean | undefined)),
    },
    deleted: {
      fields: {},
      run: () => call(() => service.deleted()),
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
    update_page: {
      fields: { ...metadata, ...pageUpdate.input },
      run: ({ pageId, archived, pinned, baseHash, baseRevision, ...meta }) =>
        call(
          async () =>
            pageStateReceipt(
              (await pageUpdate.run(
                { service: pages, projectId: service.project() },
                { pageId, archived, pinned, baseHash, baseRevision } as Parameters<
                  typeof pageUpdate.run
                >[1],
              )) as PageRecord,
              service.project(),
            ),
          meta,
        ),
    },
    duplicate_page: {
      fields: { ...metadata, ...pageDuplicate.input },
      run: ({ pageId, title, ...meta }) =>
        call(
          async () =>
            pageStateReceipt(
              (await pageDuplicate.run(
                { service: pages, projectId: service.project() },
                { pageId, title } as Parameters<typeof pageDuplicate.run>[1],
              )) as PageRecord,
              service.project(),
            ),
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
  return { readActions, updateActions };
}

/** Folders, pages, the project and the sidebar; references; editor drafts. */
export const organizationTools: ToolDeclaration[] = [
  {
    name: "organization_read",
    access: "read",
    summary:
      "Read project folders, deleted items that can be restored, or this connection's sidebar groups and project order.",
    actions: (connection) => organizationActions(connection).readActions,
  },
  {
    name: "organization_update",
    access: "write",
    summary:
      "Change folders, pages, this project or the sidebar. archived:true deletes (restorable, listed by organization_read deleted), archived:false restores. parentId is a folder or null for the root; page moves need baseHash/baseRevision; sectionId is projects, pinned or a sidebar group; update_group with name:null removes it.",
    actions: (connection) => organizationActions(connection).updateActions,
  },
  {
    name: "catalog_references",
    access: "read",
    description:
      "Find where a component or template is referenced in this project's pages and packages; version/integrity narrow the target.",
    input: () => ({
      kind: z.enum(["component", "template"]),
      id: z.string().min(1),
      version: z.string().optional(),
      integrity: z.string().optional(),
    }),
    run: ({ workspace: service, call }, { kind, id: target, version, integrity }) =>
      call(() => service.references(kind, target, { version, integrity })),
  },
  {
    name: "draft_read",
    access: "read",
    summary:
      "Read editor drafts in this project's connection workspace; drafts are not formal content and do not sync.",
    actions: ({ workspace: service, call }) => ({
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
    }),
  },
  {
    name: "draft_write",
    access: "write",
    summary:
      "Save an editable draft, or complete a page draft after saving its exact content.",
    actions: ({ workspace: service, call }) => ({
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
    }),
  },
  {
    name: "draft_remove",
    access: "write",
    hints: { destructiveHint: true },
    description:
      "Discard a reviewed draft generation; a newer generation returns CONFLICT.",
    input: () => ({ draftId, generation }),
    run: ({ workspace: service, call }, { draftId, generation }) =>
      call(() => service.removeDraft(draftId, generation)),
  },
];
