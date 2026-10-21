import { CoreError, assertId, type FileStore } from "../core/store";
import {
  DatasetDrafts,
  DatasetStore,
  sharedPropsSchema,
  type DatasetDocument,
} from "../core/datasets";
import { getComponent } from "../core/catalog";
import { readCustomBlockData } from "../components/custom/contract";
import { syncManager } from "../sync/manager";

/** Workbench actions for project datasets, shared by the desktop and browser hosts. */
export const datasetActions = new Set([
  "datasets:list",
  "datasets:get",
  "datasets:create",
  "datasets:apply",
  "datasets:remove",
  "datasets:references",
  "datasets:draftSave",
  "datasets:draftList",
  "datasets:draftRemove",
]);
export const datasetMutationActions = new Set([
  "datasets:create",
  "datasets:apply",
  "datasets:remove",
]);

function id(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string")
    throw new CoreError("INVALID_DATA", `${key} is required.`);
  return assertId(value);
}
function optionalText(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 10000)
    throw new CoreError("INVALID_DATA", `${key} must be text.`);
  return value;
}

async function readOnlyProject(
  store: FileStore,
  projectId: string,
): Promise<boolean> {
  const connection = (
    await syncManager(store.root).configuration()
  ).projects.find((project) => project.projectId === projectId);
  return connection?.role === "viewer" || connection?.status === "revoked";
}

export async function handleDatasetAction(
  store: FileStore,
  action: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const datasets = new DatasetStore(store);
  const projectId = id(args, "projectId");
  switch (action) {
    case "datasets:list":
      return datasets.list(projectId);
    case "datasets:get": {
      const record = await datasets.read(projectId, id(args, "datasetId"));
      const readOnly = await readOnlyProject(store, projectId);
      if (args.ifHash === record.hash)
        return { unchanged: true, hash: record.hash, readOnly };
      return { ...record, readOnly };
    }
    case "datasets:create": {
      const name = optionalText(args, "name");
      if (!name?.trim())
        throw new CoreError("INVALID_DATA", "A dataset needs a name.");
      const local = Array.isArray(args.local)
        ? args.local.filter((key): key is string => typeof key === "string")
        : [];
      let schema: DatasetDocument["schema"];
      let origin: DatasetDocument["origin"];
      if (args.fromComponent !== undefined) {
        // The shared keys of a custom component stay valid for that component.
        const ref = readCustomBlockData({
          ...(args.fromComponent as object),
          props: {},
        });
        const component = await getComponent(
          store.root,
          ref.componentId,
          ref.version,
          projectId,
          {
            integrity: ref.integrity,
            scope: ref.scope,
          },
        );
        schema = sharedPropsSchema(component.schema, local);
        origin = { kind: "custom", componentId: ref.componentId };
      } else if (typeof args.originKind === "string")
        origin = { kind: args.originKind.slice(0, 80) };
      const pageId = optionalText(args, "pageId");
      const blockId = optionalText(args, "blockId");
      if (origin)
        Object.assign(
          origin,
          pageId ? { pageId } : {},
          blockId ? { blockId } : {},
        );
      return datasets.create(projectId, {
        ...(args.datasetId !== undefined ? { id: id(args, "datasetId") } : {}),
        name,
        description: optionalText(args, "description"),
        value: args.value,
        ...(origin ? { origin } : {}),
        ...(schema ? { schema } : {}),
      });
    }
    case "datasets:apply": {
      if (!Array.isArray(args.operations))
        throw new CoreError("INVALID_DATA", "operations must be an array.");
      return datasets.apply(projectId, id(args, "datasetId"), {
        baseHash: optionalText(args, "baseHash"),
        operations: args.operations,
        name: optionalText(args, "name"),
        description:
          args.description === null ? null : optionalText(args, "description"),
      });
    }
    case "datasets:remove":
      return datasets.remove(projectId, id(args, "datasetId"), {
        baseHash: optionalText(args, "baseHash") ?? "",
      });
    case "datasets:references":
      return datasets.references(projectId, id(args, "datasetId"));
    case "datasets:draftSave":
      return new DatasetDrafts(store.root).save({
        clientId: optionalText(args, "clientId") ?? "",
        projectId,
        datasetId: id(args, "datasetId"),
        baseHash: optionalText(args, "baseHash") ?? "",
        pending: args.pending as never,
        held: args.held as never,
      });
    case "datasets:draftList":
      return new DatasetDrafts(store.root).list(
        projectId,
        id(args, "datasetId"),
      );
    case "datasets:draftRemove":
      await new DatasetDrafts(store.root).remove(
        optionalText(args, "clientId") ?? "",
        projectId,
        id(args, "datasetId"),
      );
      return { removed: true };
  }
  throw new CoreError("INVALID_DATA", "Unknown dataset action.");
}
