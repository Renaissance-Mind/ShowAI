import { validatePageIcon } from "../lib/page-icon.mjs";
import { PROJECT_SCOPE_LIMIT } from "../desktop/bridge";
import { syncManager } from "../sync/manager";
import { remoteSaveOrigin } from "../core/remote-save-conflict";
import {
  upgradeResource,
  createResource,
  wrapSurface,
  surfaceKind,
} from "../surface/containers.mjs";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join, sep, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { changeContext, withChangeContext } from "../core/history-context";
import { mutateLibrary, versionedLibrary } from "../core/library-runtime";
import { canonicalJson } from "../core/diff";
import type { ChangeActor } from "../core/history-model";
import { EditorDrafts, type EditorDraftInput } from "../core/editor-drafts";
import { LibraryImport } from "../core/library-import";
import {
  LibraryMaintenance,
  verifyLibraryArchive,
} from "../core/library-maintenance";
import {
  maintenancePolicy,
  setMaintenancePolicy,
} from "../core/maintenance-scheduler";
import { AgentService } from "../agent/service";
import { assertExportDestination, exportPage } from "../agent/exporter";
import { assertId, CoreError, FileStore } from "../core/store";
import type { PageRecord, ProjectBinding } from "../core/model";
import {
  getComponent,
  blankDocument,
  getTemplate,
  importComponent,
  instantiateTemplate,
  instantiateTemplateRecord,
  promotePackage,
  forkPackage,
  previewPackageMerge,
  savePackageMerge,
  listBuiltinComponents,
  describeBuiltinComponent,
  listComponents,
  listTemplates,
  readComponentSource,
  readBuiltinComponentSource,
  resolveDocumentComponents,
  importCompiledComponents,
  lockDocumentComponents,
  saveComponent,
  saveTemplate,
} from "../core/catalog";
import {
  parseArtifact,
  serializeArtifact,
  validateDocument,
} from "../portable/validation.mjs";
import {
  preparePublication,
  verifyPublication,
  loadRemoteComponents,
} from "../core/publication";
import type {
  CatalogReadOptions,
  PackageRevisionRef,
  PackageMergeInput,
  EditablePackage,
  SaveTemplateInput,
} from "../components/custom/types";
import type { ComponentManifest, JsonSchema } from "../components/custom/types";
import type { DesktopInfo } from "../desktop/bridge";

export const workbenchActions = new Set([
  "sync:status",
  "sync:connect",
  "sync:default",
  "sync:disconnect",
  "sync:projects",
  "sync:attach",
  "sync:subscribe",
  "sync:detach",
  "sync:previewInvite",
  "sync:retained",
  "sync:join",
  "sync:dashboard",
  "sync:manage",
  "sync:run",
  "sync:wake",
  "sync:conflict",
  "sync:resolve",
  "sync:sessions",
  "sync:revokeToken",
  "sync:revokeAllTokens",
  "sync:changePassword",
  "sync:createProject",
  "sync:changeAccount",
  "sync:bindAccounts",
  "sync:unbindAccount",
  "sync:accountProfile",
  "sync:restoreAccounts",
  "sync:resources",
  "sync:projectVisibility",
  "sync:serverInfo",
  "sync:beginLogin",
  "sync:finishLogin",
  "sync:createToken",
  "app:info",
  "library:storage",
  "library:compact",
  "library:cleanupPlan",
  "library:cleanup",
  "library:rebuildIndex",
  "library:maintenancePolicy",
  "library:setMaintenancePolicy",
  "library:archive",
  "library:verifyArchive",
  "library:prepareImport",
  "library:activateImport",
  "library:imports",
  "page:mergePreview",
  "page:mergeSave",
  "workspace:conflicts",
  "workspace:recoverPackage",
  "workspace:conflict",
  "workspace:resolve",
  "library:search",
  "drafts:list",
  "drafts:read",
  "drafts:save",
  "drafts:remove",
  "drafts:complete",
  "projects:list",
  "projects:create",
  "projects:rename",
  "projects:pin",
  "projects:remove",
  "sidebar:get",
  "sidebar:moveProject",
  "sidebar:moveEntry",
  "groups:create",
  "groups:rename",
  "groups:remove",
  "projects:group",
  "folders:list",
  "folders:create",
  "folders:rename",
  "folders:pin",
  "folders:remove",
  "pages:list",
  "pages:get",
  "pages:create",
  "pages:insertTemplate",
  "pages:save",
  "pages:duplicate",
  "pages:remove",
  "pages:rename",
  "pages:pin",
  "pages:move",
  "pages:import",
  "templates:list",
  "templates:get",
  "templates:save",
  "components:list",
  "components:get",
  "components:import",
  "components:source",
  "components:save",
  "components:createExample",
  "catalog:promote",
  "catalog:fork",
  "catalog:mergePreview",
  "catalog:mergeSave",
  "catalog:preparePublish",
  "catalog:verifyPublish",
  "dialog:openPage",
  "export:page",
  "export:site",
  "fs:reveal",
  "settings:chooseHome",
  "clipboard:write",
  "app:openPageWindow",
  "app:openWindow",
]);
export function text(
  args: Record<string, unknown>,
  key: string,
  optional = false,
): string | undefined {
  const value = args[key];
  if (optional && value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 10000)
    throw new CoreError("INVALID_DATA", `${key} must be non-empty text.`);
  return value;
}
export const required = (args: Record<string, unknown>, key: string) =>
  text(args, key)!;
export const projectId = (args: Record<string, unknown>) =>
  assertId(required(args, "projectId"));
export const pageId = (args: Record<string, unknown>) =>
  assertId(required(args, "pageId"));

function boolean(args: Record<string, unknown>, key: string): boolean {
  if (typeof args[key] !== "boolean")
    throw new CoreError("INVALID_DATA", `${key} must be boolean.`);
  return args[key];
}

function parentFolder(args: Record<string, unknown>): string | null {
  return args.parentId === null || args.parentId === undefined
    ? null
    : assertId(required(args, "parentId"));
}

function catalogOptions(args: Record<string, unknown>): CatalogReadOptions {
  const scope = text(args, "scope", true);
  if (
    scope &&
    !["all", "project", "global", "published", "builtin"].includes(scope)
  )
    throw new CoreError("INVALID_DATA", "Unknown catalog scope.");
  return {
    scope: scope as CatalogReadOptions["scope"],
    version: text(args, "version", true),
    integrity: text(args, "integrity", true),
  };
}
function revisionArg(
  args: Record<string, unknown>,
  key = "ref",
): PackageRevisionRef {
  const value = args[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CoreError(
      "INVALID_DATA",
      "An exact package revision is required.",
    );
  const ref = value as Record<string, unknown>;
  if (
    !["template", "component"].includes(String(ref.kind)) ||
    ["id", "version", "integrity"].some(
      (key) => typeof ref[key] !== "string" || !ref[key],
    )
  )
    throw new CoreError(
      "INVALID_DATA",
      "A revision needs kind, id, version and integrity.",
    );
  return value as PackageRevisionRef;
}
function componentDelivery(
  args: Record<string, unknown>,
): "bundled" | "remote" {
  if (args.components === undefined) return "bundled";
  if (args.components !== "bundled" && args.components !== "remote")
    throw new CoreError("INVALID_DATA", "Choose bundled or remote components.");
  return args.components;
}

export interface OpenDialogOptions {
  title: string;
  defaultPath?: string;
  properties: string[];
  filters?: { name: string; extensions: string[] }[];
}
export interface SaveDialogOptions {
  title: string;
  defaultPath: string;
  filters: { name: string; extensions: string[] }[];
}
export interface WorkbenchHost {
  preferencesChanged?(): void;
  info(): DesktopInfo;
  openDialog(
    options: OpenDialogOptions,
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
  saveDialog(
    options: SaveDialogOptions,
  ): Promise<{ canceled: boolean; filePath?: string }>;
  invoke(action: string, args: Record<string, unknown>): Promise<unknown>;
}

export function createWorkbench(
  store: FileStore,
  service: AgentService,
  host: WorkbenchHost,
) {
  async function validateDestination(
    projectId: string,
    parentId: string | null,
  ): Promise<void> {
    if (
      parentId !== null &&
      !(await store.listFolders(projectId)).some(
        (folder) => folder.id === parentId,
      )
    )
      throw new CoreError(
        "NOT_FOUND",
        "The destination folder is missing or archived.",
      );
  }

  async function optionalProject(
    args: Record<string, unknown>,
  ): Promise<string | undefined> {
    const id = text(args, "projectId", true);
    if (id) await store.readProject(assertId(id));
    return id;
  }

  async function activePages(id: string) {
    return store.listPages(id, { includeArchived: false });
  }

  async function pageRecord(id: string, page: string) {
    const record = await store.readPage(id, page);
    return enrichPage(id, record);
  }

  async function enrichPage(id: string, record: PageRecord, known?: unknown) {
    const projectConnection = (
      await syncManager(store.root).configuration()
    ).projects.find((project) => project.projectId === id);
    const components = await resolveDocumentComponents(
      store.root,
      record.document,
      id,
    );
    const key = (component: {
      id: string;
      version: string;
      integrity: string;
      scope?: string;
    }) =>
      JSON.stringify([
        component.id,
        component.version,
        component.integrity,
        component.scope,
      ]);
    const reused =
      Array.isArray(known) &&
      known.length === components.length &&
      components.every((component) =>
        known.some(
          (ref) =>
            ref && typeof ref === "object" && key(ref) === key(component),
        ),
      );
    return {
      ...record,
      incomingCrossDevice: !!(await remoteSaveOrigin(store.root, id, record)),
      retainedSyncConflicts: (
        await syncManager(store.root).retainedConflicts(id)
      ).filter(
        (item) =>
          item.originalPageId === record.document.id ||
          item.variants.some(
            (variant) => variant.pageId === record.document.id,
          ),
      ),
      readOnly:
        projectConnection?.role === "viewer" ||
        projectConnection?.status === "revoked",
      components: reused ? [] : components,
      ...(reused ? { reuseComponents: true } : {}),
    };
  }

  function artifactInput(value: unknown) {
    if (typeof value === "string" && /^\s*</.test(value)) {
      const match = value.match(
        /<script\b(?=[^>]*\bid=["']showai-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i,
      );
      if (!match)
        throw new CoreError(
          "INVALID_DATA",
          "This HTML does not contain an editable ShowAI page.",
        );
      return parseArtifact(match[1]);
    }
    return parseArtifact(value);
  }

  function filename(title: string): string {
    return (title.trim() || "ShowAI")
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .slice(0, 100);
  }

  async function handle(
    action: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (action.startsWith("sync:")) {
      const sync = syncManager(store.root);
      sync.start();
      switch (action) {
        case "sync:status":
          return sync.status();
        case "sync:serverInfo":
          return sync.serverInfo(required(args, "url"));
        case "sync:beginLogin":
          return sync.beginLogin(
            args as unknown as Parameters<typeof sync.beginLogin>[0],
          );
        case "sync:finishLogin":
          return sync.finishLogin(
            args as unknown as Parameters<typeof sync.finishLogin>[0],
          );
        case "sync:createToken":
          return sync.createPersonalToken(required(args, "connectionId"));
        case "sync:bindAccounts":
          return sync.accounts.bind(
            required(args, "connectionId"),
            required(args, "targetConnectionId"),
          );
        case "sync:unbindAccount":
          return sync.accounts.unbind(
            required(args, "connectionId"),
            required(args, "serverId"),
          );
        case "sync:accountProfile":
          return sync.accounts.profile(required(args, "connectionId"));
        case "sync:restoreAccounts":
          return sync.accounts.restore(required(args, "connectionId"));
        case "sync:resources":
          return sync.accounts.resources();
        case "sync:projectVisibility": {
          if (typeof args.visible !== "boolean")
            throw new CoreError("INVALID_DATA", "请选择项目是否在本设备显示。");
          const result = await sync.setProjectVisibility(
            projectId(args),
            args.visible,
          );
          host.preferencesChanged?.();
          return result;
        }
        case "sync:connect":
          return sync.connect(
            args as unknown as Parameters<typeof sync.connect>[0],
          );
        case "sync:default":
          return sync.setDefault(
            args.connectionId === null ? null : required(args, "connectionId"),
          );
        case "sync:disconnect":
          return sync.disconnect(required(args, "connectionId"));
        case "sync:projects":
          return sync.remoteProjects(required(args, "connectionId"));
        case "sync:attach":
          return sync.attach(required(args, "connectionId"), projectId(args));
        case "sync:subscribe":
          return sync.subscribe(
            required(args, "connectionId"),
            required(args, "remoteProjectId"),
          );
        case "sync:detach":
          return sync.detach(projectId(args));
        case "sync:changeAccount":
          return sync.changeAccount(
            projectId(args),
            required(args, "connectionId"),
          );
        case "sync:previewInvite":
          return sync.previewInvite(required(args, "link"));
        case "sync:retained":
          return sync.retainedConflicts(projectId(args));
        case "sync:join":
          return sync.join(
            required(args, "connectionId"),
            required(args, "link"),
          );
        case "sync:dashboard":
          return sync.dashboard(
            required(args, "connectionId"),
            text(args, "projectId", true),
          );
        case "sync:manage": {
          const operation = required(args, "operation");
          if (
            !["invite", "member", "revokeInvite", "project"].includes(
              operation,
            ) ||
            !args.input ||
            typeof args.input !== "object" ||
            Array.isArray(args.input)
          )
            throw new CoreError("INVALID_DATA", "无效的项目管理操作。");
          return sync.manage(
            required(args, "connectionId"),
            projectId(args),
            operation as "invite" | "member" | "revokeInvite" | "project",
            args.input as Record<string, unknown>,
          );
        }
        case "sync:run":
          return sync.run(text(args, "projectId", true));
        case "sync:wake":
          sync.wake();
          return { scheduled: true };
        case "sync:conflict":
          return sync.conflict(projectId(args));
        case "sync:resolve":
          return sync.resolveConflict(
            projectId(args),
            args.choices as Record<string, "local" | "remote">,
          );
        case "sync:sessions":
          return sync.sessions(required(args, "connectionId"));
        case "sync:revokeToken":
          return sync.revokeToken(
            required(args, "connectionId"),
            required(args, "digest"),
          );
        case "sync:revokeAllTokens":
          return sync.revokeAllTokens(required(args, "connectionId"));
        case "sync:changePassword":
          return sync.changePassword(
            required(args, "connectionId"),
            required(args, "currentPassword"),
            required(args, "newPassword"),
          );
        case "sync:createProject": {
          const project = await store.createProject({
            name: required(args, "name"),
          });
          await sync.attach(required(args, "connectionId"), project.id);
          return project;
        }
      }
    }
    switch (action) {
      case "library:storage":
        return new LibraryMaintenance(store.root).storage({
          projects: args.projects === true,
        });
      case "library:compact":
        return new LibraryMaintenance(store.root).compact();
      case "library:cleanupPlan":
        return new LibraryMaintenance(store.root).prepareCleanup();
      case "library:cleanup":
        return new LibraryMaintenance(store.root).cleanup(required(args, "id"));
      case "library:rebuildIndex":
        return {
          revision: await new LibraryMaintenance(store.root).rebuildIndex(),
        };
      case "library:maintenancePolicy":
        return maintenancePolicy(store.root);
      case "library:setMaintenancePolicy":
        return setMaintenancePolicy(store.root, {
          automatic: args.automatic as boolean,
        });
      case "library:archive":
        return new LibraryMaintenance(store.root).archive(
          required(args, "out"),
        );
      case "library:verifyArchive":
        return verifyLibraryArchive(required(args, "path"));
      case "library:prepareImport":
        return new LibraryImport(store.root).prepare(
          text(args, "source", true) ?? store.root,
        );
      case "library:activateImport":
        return new LibraryImport(store.root).activate(required(args, "id"));
      case "library:imports":
        return new LibraryImport(store.root).list();
      case "app:info":
        return {
          ...(await host.info()),
          libraryVersion: (await versionedLibrary(store.root)) ? 2 : 1,
        };
      case "library:search":
        return service.search({
          query: required(args, "query"),
          projectId: text(args, "projectId", true),
          kind: text(args, "kind", true) as
            | "page"
            | "component"
            | "template"
            | "project"
            | "source"
            | undefined,
          limit: args.limit as number | undefined,
          cursor: text(args, "cursor", true),
        });
      case "page:mergePreview":
        return service.pageMergePreview({
          projectId: projectId(args),
          pageId: pageId(args),
          baseRevision: required(args, "baseRevision"),
          document: validateDocument(args.document),
        });
      case "page:mergeSave":
        return enrichPage(
          projectId(args),
          await service.pageMergeSave({
            projectId: projectId(args),
            pageId: pageId(args),
            baseRevision: required(args, "baseRevision"),
            currentRevision: required(args, "currentRevision"),
            document: validateDocument(args.document),
          }),
        );
      case "workspace:conflicts":
        return service.workspaceConflicts(text(args, "projectId", true));
      case "workspace:recoverPackage":
        return service.recoverPackageConflict({
          id: required(args, "id"),
          clientId: required(args, "clientId"),
          targetProjectId: text(args, "targetProjectId", true),
        });
      case "workspace:conflict":
        return service.workspaceConflict(required(args, "id"));
      case "workspace:resolve": {
        const resolution = required(args, "resolution");
        if (!["discard", "import", "merge"].includes(resolution))
          throw new CoreError("INVALID_DATA", "Invalid conflict resolution.");
        const resolved = await service.resolveWorkspaceConflict({
          id: required(args, "id"),
          resolution: resolution as "discard" | "import" | "merge",
          document: args.document ? validateDocument(args.document) : undefined,
        });
        if ("document" in resolved) {
          const match = resolved.path.match(/\/projects\/([^/]+)\/pages\//);
          if (match) return enrichPage(match[1], resolved);
        }
        return resolved;
      }
      case "drafts:list":
        return new EditorDrafts(store.root).list({
          clientId: text(args, "clientId", true),
          projectId: text(args, "projectId", true),
          resourceId: text(args, "resourceId", true),
          kind: text(args, "kind", true),
        });
      case "drafts:read":
        return new EditorDrafts(store.root).read(required(args, "id"));
      case "drafts:save": {
        const input = args.input as EditorDraftInput;
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw new CoreError(
            "INVALID_DATA",
            "A draft requires explicit input.",
          );
        return new EditorDrafts(store.root).save({
          ...input,
          actor: { kind: "human" },
        });
      }
      case "drafts:remove":
        return new EditorDrafts(store.root).remove(
          required(args, "id"),
          text(args, "generation", true),
        );
      case "drafts:complete":
        return new EditorDrafts(store.root).completePage(
          required(args, "id"),
          required(args, "generation"),
          required(args, "revision"),
        );
      case "projects:list": {
        const projectIds =
          args.projectIds === undefined ? undefined : args.projectIds;
        if (
          projectIds !== undefined &&
          (!Array.isArray(projectIds) ||
            projectIds.length > PROJECT_SCOPE_LIMIT)
        )
          throw new CoreError(
            "INVALID_DATA",
            "Project scope must be an array of project identities.",
          );
        const projects = await store.listProjects({
          includeArchived: args.includeArchived === true,
          projectIds: projectIds?.map((id) => assertId(id)),
        });
        if (args.includeHidden === true) return projects;
        const hidden = new Set(
          (await syncManager(store.root).configuration()).hiddenProjectIds ??
            [],
        );
        return projects.filter((project) => !hidden.has(project.id));
      }
      case "sidebar:get":
        return store.readSidebar();
      case "sidebar:moveProject": {
        const placement = args.placement ?? "before";
        if (placement !== "before" && placement !== "after")
          throw new CoreError("INVALID_DATA", "Invalid placement.");
        return store.arrangeProject(
          projectId(args),
          required(args, "sectionId"),
          text(args, "relativeId", true),
          placement,
        );
      }
      case "sidebar:moveEntry": {
        const kind = required(args, "kind"),
          placement = args.placement ?? "before";
        if (
          (kind !== "page" && kind !== "folder") ||
          (placement !== "before" && placement !== "after")
        )
          throw new CoreError("INVALID_DATA", "Invalid sidebar move.");
        const source = projectId(args),
          destination = assertId(required(args, "destinationProjectId"));
        return store.arrangeEntry(
          {
            reorderOnly: args.reorderOnly === true,
            kind,
            projectId: source,
            id: assertId(required(args, "id")),
            destinationProjectId: destination,
            parentId: parentFolder(args),
            relativeId: text(args, "relativeId", true),
            placement,
            baseHash: text(args, "baseHash", true),
            baseRevision: text(args, "baseRevision", true),
          },
          async (document) => {
            const locked = await lockDocumentComponents(
              store.root,
              document,
              source,
            );
            const components = await resolveDocumentComponents(
              store.root,
              locked,
              source,
            );
            if (components.length)
              await importCompiledComponents(
                store.root,
                components,
                destination,
              );
            return lockDocumentComponents(store.root, locked, destination);
          },
        );
      }
      case "groups:create":
        return store.createProjectGroup(required(args, "name"));
      case "groups:rename":
        return store.updateProjectGroup(
          required(args, "groupId"),
          required(args, "name"),
        );
      case "groups:remove":
        return store.updateProjectGroup(required(args, "groupId"), null);
      case "projects:group":
        return store.moveProjectToGroup(
          projectId(args),
          args.groupId === null ? null : required(args, "groupId"),
        );
      case "projects:create":
        return service.createProject(
          required(args, "name"),
          args.binding as ProjectBinding | undefined,
          args.icon === undefined
            ? undefined
            : validatePageIcon(args.icon, "project.icon"),
        );
      case "projects:rename":
        return store.updateProject(projectId(args), {
          name: required(args, "name"),
          icon:
            args.icon === undefined
              ? undefined
              : validatePageIcon(args.icon, "project.icon"),
        });
      case "projects:pin":
        return store.updateProject(projectId(args), {
          pinned: boolean(args, "pinned"),
        });
      case "projects:remove":
        return store.updateProject(projectId(args), { archived: true });
      case "folders:list":
        return store.listFolders(projectId(args));
      case "folders:create":
        return store.createFolder(projectId(args), {
          name: required(args, "name"),
          parentId: parentFolder(args),
        });
      case "folders:rename":
        return store.updateFolder(
          projectId(args),
          assertId(required(args, "folderId")),
          { name: required(args, "name") },
        );
      case "folders:pin":
        return store.updateFolder(
          projectId(args),
          assertId(required(args, "folderId")),
          { pinned: boolean(args, "pinned") },
        );
      case "folders:remove":
        return store.updateFolder(
          projectId(args),
          assertId(required(args, "folderId")),
          { archived: true },
        );
      case "pages:list":
        return activePages(projectId(args));
      case "pages:get":
        return pageRecord(projectId(args), pageId(args));
      case "pages:insertTemplate": {
        const id = projectId(args);
        return enrichPage(
          id,
          await service.applyTemplate(
            id,
            required(args, "templateId"),
            undefined,
            {
              pageId: pageId(args),
              baseHash: required(args, "baseHash"),
              baseRevision: text(args, "baseRevision", true),
              parentId: text(args, "parentId", true),
              version: text(args, "templateVersion", true),
              scope: text(args, "templateScope", true) as Exclude<
                CatalogReadOptions["scope"],
                "all"
              >,
              integrity: text(args, "templateIntegrity", true),
            },
          ),
        );
      }
      case "pages:create": {
        const id = projectId(args);
        const templateId = text(args, "templateId", true);
        const document = templateId
          ? await instantiateTemplateRecord(
              store.root,
              await getTemplate(store.root, templateId, id, {
                version: text(args, "templateVersion", true),
                scope: text(
                  args,
                  "templateScope",
                  true,
                ) as CatalogReadOptions["scope"],
                integrity: text(args, "templateIntegrity", true),
              }),
              id,
            )
          : args.document !== undefined
            ? validateDocument(args.document)
            : blankDocument();
        const parentId =
          args.parentId !== undefined
            ? parentFolder(args)
            : args.document !== undefined &&
                document.parentId &&
                (await store.listFolders(id)).some(
                  (folder) => folder.id === document.parentId,
                )
              ? document.parentId
              : null;
        await validateDestination(id, parentId);
        if (
          args.kind !== undefined &&
          !["page", "board"].includes(String(args.kind))
        )
          throw new Error("Choose Page or Board.");
        let resource = upgradeResource(document, {
          includeTitle: !!templateId || args.document !== undefined,
        });
        if (args.kind && args.kind !== surfaceKind(resource.content))
          resource =
            (!templateId || templateId === "blank") &&
            args.document === undefined
              ? createResource(document, args.kind as "page" | "board")
              : wrapSurface(
                  resource,
                  resource.content.attrs!.id,
                  args.kind as "page" | "board",
                );
        return enrichPage(
          id,
          await service.createPage(id, {
            ...(args.title !== undefined
              ? { title: required(args, "title") }
              : {}),
            document: {
              ...resource,
              parentId,
            },
          }),
        );
      }
      case "pages:rename":
      case "pages:pin":
      case "pages:move": {
        const id = projectId(args);
        const fields =
          action === "pages:rename"
            ? { title: required(args, "title") }
            : action === "pages:pin"
              ? { favorite: boolean(args, "pinned") }
              : { parentId: parentFolder(args) };
        return enrichPage(
          id,
          await store.updatePageMetadata(
            id,
            pageId(args),
            fields,
            required(args, "baseHash"),
            text(args, "baseRevision", true),
          ),
        );
      }
      case "pages:save": {
        const id = projectId(args);
        return enrichPage(
          id,
          await service.savePage(
            id,
            pageId(args),
            validateDocument(args.document),
            required(args, "baseHash"),
            undefined,
            undefined,
            text(args, "baseRevision", true),
          ),
          args.knownComponents,
        );
      }
      case "pages:duplicate": {
        const id = projectId(args),
          original = await store.readPage(id, pageId(args));
        const parentId = (await store.listFolders(id)).some(
          (folder) => folder.id === original.document.parentId,
        )
          ? original.document.parentId
          : null;
        return enrichPage(
          id,
          await service.createPage(id, {
            document: {
              ...instantiateTemplate({
                ...original.document,
                title: `${original.document.title || "未命名页面"} 副本`,
                archived: false,
              }),
              parentId,
            },
          }),
        );
      }
      case "pages:remove": {
        const id = projectId(args),
          original = await store.readPage(id, pageId(args));
        return enrichPage(
          id,
          await store.savePage(
            id,
            original.document.id,
            { ...original.document, archived: true },
            text(args, "baseHash", true) ?? original.hash,
            text(args, "baseRevision", true) ?? original.revision,
          ),
        );
      }
      case "pages:import": {
        const artifact = artifactInput(args.artifact);
        const id = projectId(args);
        const parentId =
          args.parentId !== undefined
            ? parentFolder(args)
            : (await store.listFolders(id)).some(
                  (folder) => folder.id === artifact.document.parentId,
                )
              ? artifact.document.parentId
              : null;
        await validateDestination(id, parentId);
        return enrichPage(
          id,
          await service.createPage(id, {
            document: { ...artifact.document, parentId },
            components: [
              ...(artifact.components ?? []),
              ...(artifact.remoteComponents?.length
                ? await loadRemoteComponents(artifact.remoteComponents)
                : []),
            ],
          }),
        );
      }
      case "templates:list":
        return listTemplates(
          store.root,
          await optionalProject(args),
          catalogOptions(args),
        );
      case "templates:get": {
        const project = await optionalProject(args);
        const template = await getTemplate(
          store.root,
          required(args, "id"),
          project,
          catalogOptions(args),
        );
        const previewDocument = await instantiateTemplateRecord(
          store.root,
          template,
          project,
        );
        return {
          ...template,
          previewDocument,
          components: await resolveDocumentComponents(
            store.root,
            previewDocument,
            project,
          ),
        };
      }
      case "templates:save": {
        const project = projectId(args);
        await store.listPages(project);
        const document =
          args.document !== undefined
            ? validateDocument(args.document)
            : args.pageId
              ? (await store.readPage(project, pageId(args))).document
              : undefined;
        return saveTemplate(
          store.root,
          {
            id: text(args, "id", true),
            version: text(args, "version", true),
            name: required(args, "name"),
            description:
              typeof args.description === "string" ? args.description : "",
            document,
            scenarios: args.scenarios as SaveTemplateInput["scenarios"],
            contentGuide:
              args.contentGuide as SaveTemplateInput["contentGuide"],
            related: args.related as SaveTemplateInput["related"],
            examples: args.examples as SaveTemplateInput["examples"],
            composition: args.composition as SaveTemplateInput["composition"],
            parents: args.parents as SaveTemplateInput["parents"],
            mergeBase: args.mergeBase as SaveTemplateInput["mergeBase"],
          },
          project,
        );
      }
      case "components:list":
        return [
          ...(!args.scope || args.scope === "all" || args.scope === "builtin"
            ? listBuiltinComponents()
            : []
          ).map((item) => ({
            ...item,
            id: item.kind,
            scope: "builtin",
          })),
          ...(await listComponents(
            store.root,
            await optionalProject(args),
            catalogOptions(args),
          )),
        ];
      case "components:get": {
        const id = required(args, "id");
        if (
          (!args.scope || args.scope === "builtin") &&
          listBuiltinComponents({ includeLegacy: true }).some(
            (item) => item.kind === id,
          )
        )
          return { ...describeBuiltinComponent(id), id, scope: "builtin" };
        return getComponent(
          store.root,
          id,
          text(args, "version", true),
          await optionalProject(args),
          catalogOptions(args),
        );
      }
      case "components:source":
        if (args.scope === "builtin")
          return readBuiltinComponentSource(required(args, "id"));
        return readComponentSource(
          store.root,
          required(args, "id"),
          text(args, "version", true),
          await optionalProject(args),
          catalogOptions(args),
        );
      case "components:import": {
        const project = projectId(args);
        await store.listPages(project);
        const result = await host.openDialog({
          title: "选择组件源码目录",
          properties: ["openDirectory"],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        return importComponent(store.root, result.filePaths[0], project);
      }
      case "components:save": {
        const project = projectId(args);
        await store.listPages(project);
        if (
          !args.manifest ||
          typeof args.manifest !== "object" ||
          (typeof args.schema !== "boolean" &&
            (!args.schema || typeof args.schema !== "object")) ||
          typeof args.source !== "string"
        )
          throw new CoreError(
            "INVALID_DATA",
            "A component needs its manifest, schema, and source.",
          );
        return saveComponent(
          store.root,
          {
            manifest: args.manifest as ComponentManifest,
            schema: args.schema as JsonSchema,
            source: args.source,
            ...(args.files
              ? { files: args.files as Record<string, string> }
              : {}),
            ...(args.assets
              ? { assets: args.assets as Record<string, string> }
              : {}),
          },
          project,
        );
      }
      case "components:createExample": {
        const project = projectId(args);
        await store.listPages(project);
        const id = `counter-${randomUUID().slice(0, 8)}`;
        return saveComponent(
          store.root,
          {
            manifest: {
              id,
              name: "计数器",
              version: "1.0.0",
              description: "可编辑的 React 控件示例，点击按钮调整计数。",
              scenarios: [
                "理解组件输入、交互和页面数据保存，例如用按钮记录一个本地计数。",
              ],
              effects: [
                "点击按钮即可观察数值变化。",
                "编辑状态下将计数保存到页面，阅读时可临时操作。",
              ],
              entry: "Component.tsx",
              defaultData: { label: "计数", value: 0 },
              examples: [
                {
                  name: "从零开始",
                  request: "从0开始，用增加和减少按钮探索整数变化。",
                  data: { label: "计数", value: 0 },
                },
              ],
            },
            schema: {
              type: "object",
              properties: {
                label: { type: "string" },
                value: { type: "number" },
              },
              required: ["label", "value"],
              additionalProperties: false,
            },
            source: `import React, {useEffect, useState} from "react";\nexport default function Counter({data,onChange,readOnly}) {\n const [value,setValue]=useState(data.value);\n useEffect(()=>setValue(data.value),[data.value]);\n function change(next) {setValue(next); if(!readOnly) onChange?.({...data,value:next});}\n return <section style={{fontFamily:"system-ui",padding:28,textAlign:"center",background:"#f4f6f3",borderRadius:12}}><p>{data.label}</p><output style={{fontSize:48}}>{value}</output><div style={{display:"flex",justifyContent:"center",gap:12,marginTop:16}}><button onClick={()=>change(value-1)} aria-label="减少">−</button><button onClick={()=>change(value+1)} aria-label="增加">+</button></div></section>;\n}\n`,
          },
          project,
        );
      }
      case "catalog:promote": {
        const project = projectId(args);
        await store.listPages(project);
        const bundle = await promotePackage(store.root, revisionArg(args), {
          projectId: project,
          target: "global",
        });
        const ref = bundle.root;
        return ref.kind === "component"
          ? getComponent(store.root, ref.id, ref.version, project, {
              scope: "global",
              integrity: ref.integrity,
            })
          : getTemplate(store.root, ref.id, project, {
              scope: "global",
              version: ref.version,
              integrity: ref.integrity,
            });
      }
      case "catalog:fork": {
        const project = projectId(args);
        await store.listPages(project);
        return forkPackage(store.root, revisionArg(args), {
          projectId: project,
          id: text(args, "id", true),
          version: required(args, "version"),
          name: text(args, "name", true),
        });
      }
      case "catalog:mergePreview":
      case "catalog:mergeSave": {
        const project = projectId(args);
        await store.listPages(project);
        const input: PackageMergeInput = {
          projectId: project,
          base: revisionArg(args, "base"),
          ours: revisionArg(args, "ours"),
          theirs: revisionArg(args, "theirs"),
        };
        return action === "catalog:mergePreview"
          ? previewPackageMerge(store.root, input)
          : savePackageMerge(store.root, {
              ...input,
              id: text(args, "id", true),
              version: required(args, "version"),
              resolved: args.resolved as EditablePackage,
            });
      }
      case "catalog:preparePublish": {
        const project = await optionalProject(args),
          ref = revisionArg(args);
        const selection = await host.openDialog({
          title: "选择发布包保存位置",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selection.canceled || !selection.filePaths[0]) return null;
        const out = join(
          selection.filePaths[0],
          `${filename(ref.id)}-${filename(ref.version)}-${Date.now()}`,
        );
        return preparePublication(store.root, {
          refs: [ref],
          projectId: project,
          out,
        });
      }
      case "catalog:verifyPublish": {
        const project = await optionalProject(args);
        return verifyPublication(store.root, {
          manifestUrl: required(args, "manifestUrl"),
          projectId: project,
        });
      }
      case "dialog:openPage": {
        const result = await host.openDialog({
          title: "导入 ShowAI 页面",
          properties: ["openFile"],
          filters: [{ name: "ShowAI 页面", extensions: ["json", "html"] }],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const path = result.filePaths[0];
        if ((await stat(path)).size > 20 * 1024 * 1024)
          throw new CoreError(
            "INVALID_DATA",
            "The imported page exceeds 20 MB.",
          );
        return {
          name: path.split(sep).at(-1),
          content: await readFile(path, "utf8"),
        };
      }
      case "export:page": {
        const id = projectId(args),
          page = pageId(args);
        if (!["html", "json", "inline"].includes(required(args, "format")))
          throw new CoreError(
            "INVALID_DATA",
            "Unsupported page export format.",
          );
        const format = args.format as "html" | "json" | "inline";
        const record = await pageRecord(id, page);
        const selection = await host.saveDialog({
          title: "导出页面",
          defaultPath: `${filename(record.document.title)}${format === "json" ? ".showai.json" : ".html"}`,
          filters: [
            {
              name: format === "json" ? "ShowAI 页面源" : "HTML 页面",
              extensions: [format === "json" ? "json" : "html"],
            },
          ],
        });
        if (selection.canceled || !selection.filePath) return null;
        await assertExportDestination(store.root, id, selection.filePath);
        if (format === "json") {
          const source = serializeArtifact(record.document, record.components);
          await writeFile(selection.filePath, source, "utf8");
          return {
            format,
            path: selection.filePath,
            bytes: Buffer.byteLength(source),
          };
        }
        return exportPage({
          root: store.root,
          projectId: id,
          pageId: page,
          format,
          components: componentDelivery(args),
          presentation: text(args, "presentation", true) as
            "spatial" | "reading" | undefined,
          out: selection.filePath,
          overwrite: true,
        });
      }
      case "export:site": {
        const id = projectId(args);
        await store.listPages(id);
        const selection = await host.openDialog({
          title: "选择网站输出目录",
          properties: ["openDirectory", "createDirectory"],
        });
        if (selection.canceled || !selection.filePaths[0]) return null;
        return exportPage({
          root: store.root,
          projectId: id,
          format: "site",
          components: componentDelivery(args),
          out: selection.filePaths[0],
          overwrite: true,
        });
      }
      case "fs:reveal":
      case "settings:chooseHome":
      case "clipboard:write":
        return host.invoke(action, args);
      case "app:openPageWindow":
      case "app:openWindow": {
        const id = projectId(args);
        const page =
          action === "app:openPageWindow"
            ? pageId(args)
            : text(args, "pageId", true);
        const folder = text(args, "folderId", true);
        if (page && folder)
          throw new CoreError("INVALID_DATA", "Choose a page or a folder.");
        const project = await store.readProject(id);
        if (project.archived)
          throw new CoreError("NOT_FOUND", "This project is archived.");
        if (page)
          await store.readPage(id, assertId(page), { checkpoint: false });
        if (
          folder &&
          !(await store.listFolders(id)).some(
            (item) => item.id === assertId(folder),
          )
        )
          throw new CoreError("NOT_FOUND", "This folder is unavailable.");
        return host.invoke(action, {
          projectId: id,
          ...(page ? { pageId: page } : {}),
          ...(folder ? { folderId: folder } : {}),
        });
      }
      default:
        throw new CoreError(
          "INVALID_DATA",
          `Unknown workbench action: ${action}`,
        );
    }
  }
  const mutationActions = new Set([
    "sidebar:moveProject",
    "sidebar:moveEntry",
    "library:prepareImport",
    "library:activateImport",
    "page:mergeSave",
    "workspace:resolve",
    "projects:create",
    "projects:rename",
    "projects:pin",
    "projects:remove",
    "projects:group",
    "groups:create",
    "groups:rename",
    "groups:remove",
    "folders:create",
    "folders:rename",
    "folders:pin",
    "folders:remove",
    "pages:create",
    "pages:save",
    "pages:insertTemplate",
    "pages:duplicate",
    "pages:remove",
    "pages:rename",
    "pages:pin",
    "pages:move",
    "pages:import",
    "templates:save",
    "components:import",
    "components:save",
    "components:createExample",
    "catalog:promote",
    "catalog:fork",
    "catalog:mergeSave",
    "catalog:verifyPublish",
  ]);
  const dialogActions = new Set([
    "components:import",
    "workspace:resolve",
    "library:prepareImport",
    "library:activateImport",
  ]);
  return (action: string, args: Record<string, unknown>): Promise<unknown> => {
    if (
      args.expectedHome !== undefined &&
      (typeof args.expectedHome !== "string" ||
        resolve(args.expectedHome) !== store.root)
    )
      throw new CoreError("CONFLICT", "内容库已切换，请重新载入。");
    if (!mutationActions.has(action)) return handle(action, args);
    const supplied = args.historyContext as
      | {
          actor?: ChangeActor;
          operationId?: string;
          message?: string;
          groupId?: string;
        }
      | undefined;
    if (supplied && (typeof supplied !== "object" || Array.isArray(supplied)))
      throw new CoreError("INVALID_DATA", "Invalid change context.");
    const actor = supplied?.actor ?? { kind: "human" as const };
    if (
      !actor ||
      !["human", "agent", "system", "unknown"].includes(actor.kind) ||
      (actor.kind === "agent" && (!actor.harness || !actor.sessionId))
    )
      throw new CoreError(
        "INVALID_DATA",
        "Agent changes require the actual harness and session ID.",
      );
    const channel =
      host.info().mode === "browser"
        ? ("browser" as const)
        : ("desktop" as const);
    const message = supplied?.message ?? action;
    const requestFingerprint = createHash("sha256")
      .update(
        canonicalJson({
          action,
          args: { ...args, historyContext: undefined },
          actor,
          channel,
          message,
          groupId: supplied?.groupId,
        }),
      )
      .digest("hex");
    const context = {
      ...changeContext(),
      actor,
      channel,
      operationId: supplied?.operationId ?? randomUUID(),
      message,
      groupId: supplied?.groupId,
      requestFingerprint,
    };
    return withChangeContext(context, () =>
      dialogActions.has(action)
        ? handle(action, args)
        : mutateLibrary(store.root, () => handle(action, args), context),
    ).then((result) => {
      syncManager(store.root).wake(
        typeof args.projectId === "string" ? [args.projectId] : undefined,
        typeof args.projectId !== "string",
      );
      return result;
    });
  };
}
