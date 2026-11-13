import { z } from "zod";
import { setSyncPackaging, syncPackagingPlan } from "../../core/packaging";
import { validateDocument } from "../../portable/validation.mjs";
import { syncManager } from "../../sync/manager";
import {
  changeSchema,
  jsonObject,
  type ToolConnection,
  type ToolDeclaration,
} from "./tool";

async function syncState({ service, projectId }: ToolConnection) {
  const state = await syncManager(service.store.root).status();
  const project = state.projects.find((item) => item.projectId === projectId);
  return {
    projectId,
    connected: !!project,
    ...(project ? { synchronization: project } : { mode: "local" }),
    // Copies of this device's files that travel to the other devices.
    packaging: await syncPackagingPlan(service.store, projectId),
  };
}
// Synchronization runs where the library is; hosted connections have none.
const local = ({ options }: ToolConnection) =>
  options.presentation?.transport !== "http";

/** Drafts against the current page, external file changes and synchronization. */
export const workspaceTools: ToolDeclaration[] = [
  {
    name: "page_merge_preview",
    access: "read",
    description: "Compare a local draft, its base and the current Page.",
    input: () => ({
      pageId: z.string(),
      baseRevision: z.string(),
      document: jsonObject,
    }),
    run: ({ service, projectId, call }, { document, ...input }) =>
      call(() =>
        service.pageMergePreview({
          ...(input as { pageId: string; baseRevision: string }),
          projectId,
          document: validateDocument(document),
        }),
      ),
  },
  {
    name: "page_merge_save",
    access: "write",
    description:
      "Save a reviewed merged Page, rechecking the current revision.",
    input: () => ({
      ...changeSchema,
      pageId: z.string(),
      baseRevision: z.string(),
      currentRevision: z.string(),
      document: jsonObject,
    }),
    run: (
      { service, projectId, call },
      { operationId, message, groupId, document, ...input },
    ) =>
      call(
        () =>
          service.pageMergeSave({
            ...(input as {
              pageId: string;
              baseRevision: string;
              currentRevision: string;
            }),
            projectId,
            document: validateDocument(document),
          }),
        { operationId, message, groupId },
      ),
  },
  {
    name: "workspace_conflict",
    access: "read",
    summary:
      "Read retained external file changes in this project: list them, or read one with its formal and baseline versions.",
    actions: ({ service, projectId, call }) => ({
      list: {
        fields: {},
        run: () => call(() => service.workspaceConflicts(projectId)),
      },
      read: {
        fields: { id: z.string() },
        run: ({ id }) => call(() => service.workspaceConflict(id as string)),
      },
    }),
  },
  {
    name: "workspace_resolve",
    access: "write",
    summary:
      "Resolve an external change by discard, page import or reviewed merge (preserved snapshots remain available), or recover an external package change as an editable local draft and restore the immutable version.",
    actions: ({ service, projectId, call }) => ({
      resolve: {
        fields: {
          ...changeSchema,
          id: z.string(),
          resolution: z.enum(["discard", "import", "merge"]),
          document: jsonObject.optional(),
        },
        run: ({ operationId, message, groupId, document, id, resolution }) =>
          call(
            () =>
              service.resolveWorkspaceConflict({
                id: id as string,
                resolution: resolution as "discard" | "import" | "merge",
                ...(document
                  ? {
                      document: validateDocument(
                        document as Record<string, unknown>,
                      ),
                    }
                  : {}),
              }),
            {
              operationId: operationId as string | undefined,
              message: message as string | undefined,
              groupId: groupId as string | undefined,
            },
          ),
      },
      recover_package: {
        fields: { id: z.string(), clientId: z.string() },
        run: ({ id, clientId }) =>
          call(() =>
            service.recoverPackageConflict({
              id: id as string,
              clientId: clientId as string,
              targetProjectId: projectId,
            }),
          ),
      },
    }),
  },
  {
    name: "project_sync_status",
    access: "read",
    available: local,
    description: "Return synchronization status for this project.",
    input: () => ({}),
    run: (connection) => connection.call(() => syncState(connection)),
  },
  {
    name: "project_sync",
    access: "write",
    available: local,
    description:
      "Synchronize this connected project and return status, error and remoteHead. packaging {itemId: bundle|skip} first stores the person's choice of which files of this device travel with it.",
    input: () => ({
      packaging: z.record(z.string(), z.enum(["bundle", "skip"])).optional(),
    }),
    run: (connection, { packaging }) =>
      connection.call(async () => {
        const { service, projectId } = connection;
        if (packaging)
          await setSyncPackaging(service.store, projectId, packaging);
        const before = await syncState(connection);
        if (!before.connected) return before;
        await syncManager(service.store.root).run(projectId);
        const after = await syncState(connection);
        if (
          "synchronization" in after &&
          after.synchronization.status !== "synced"
        )
          throw new Error(
            `Project synchronization is incomplete (${after.synchronization.status}): ${after.synchronization.error ?? "inspect project_sync_status"}. Local content is retained.`,
          );
        return after;
      }),
  },
];
