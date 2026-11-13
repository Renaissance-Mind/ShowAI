import { resolve } from "node:path";
import { ContentLibrary as GitLibrary } from "../../core/content-library";
import { LibraryImport } from "../../core/library-import";
import {
  LibraryMaintenance,
  verifyLibraryArchive,
} from "../../core/library-maintenance";
import {
  maintenancePolicy,
  setMaintenancePolicy,
} from "../../core/maintenance-scheduler";
import {
  commandContext,
  hiddenText,
  option,
  requireCount,
  text,
  type CommandDeclaration,
} from "./command";
import { readDocument } from "./inputs";

/** Versioned library maintenance, search and workspace conflicts. */
export const libraryCommands: CommandDeclaration[] = [
  {
    command: "library",
    actions: ["init"],
    access: "write",
    ownTransaction: true,
    help: ["library init | verify | compact"],
    covers: ["library verify", "library compact"],
    async run(args, { service }) {
      requireCount(args, 2);
      return new GitLibrary(service.store.root).initialize();
    },
  },
  {
    command: "library",
    actions: ["verify"],
    async run(args, { service }) {
      requireCount(args, 2);
      await new GitLibrary(service.store.root).verify();
      return { verified: true };
    },
  },
  {
    command: "library",
    actions: ["compact"],
    access: "write",
    ownTransaction: true,
    async run(args, { service }) {
      requireCount(args, 2);
      return new LibraryMaintenance(service.store.root).compact();
    },
  },
  {
    command: "library",
    actions: ["stats"],
    help: ["library stats | cleanup-plan [--older-than-days DAYS] | cleanup PLAN_ID"],
    covers: ["library cleanup-plan", "library cleanup"],
    async run(args, { service }) {
      requireCount(args, 2);
      return new LibraryMaintenance(service.store.root).storage();
    },
  },
  {
    command: "library",
    actions: ["cleanup-plan"],
    options: { "older-than-days": text },
    async run(args, { service }) {
      requireCount(args, 2);
      return new LibraryMaintenance(service.store.root).prepareCleanup({
        olderThanDays: option(args, "older-than-days")
          ? Number(option(args, "older-than-days"))
          : undefined,
      });
    },
  },
  {
    command: "library",
    actions: ["cleanup"],
    access: "write",
    ownTransaction: true,
    async run(args, { service }) {
      requireCount(args, 3);
      return new LibraryMaintenance(service.store.root).cleanup(
        args.positional[2],
      );
    },
  },
  {
    command: "library",
    actions: ["rebuild-index"],
    access: "write",
    ownTransaction: true,
    help: ["library rebuild-index | policy [--automatic true|false]"],
    covers: ["library policy"],
    async run(args, { service }) {
      requireCount(args, 2);
      return {
        revision: await new LibraryMaintenance(
          service.store.root,
        ).rebuildIndex(),
      };
    },
  },
  {
    command: "library",
    actions: ["policy"],
    options: { automatic: text },
    access: "write",
    ownTransaction: true,
    async run(args, { service }) {
      requireCount(args, 2);
      const automatic = option(args, "automatic");
      if (!automatic) return maintenancePolicy(service.store.root);
      if (!["true", "false"].includes(automatic))
        throw new Error("--automatic must be true or false.");
      return setMaintenancePolicy(service.store.root, {
        automatic: automatic === "true",
      });
    },
  },
  {
    command: "library",
    actions: ["archive"],
    options: { out: text },
    access: "write",
    ownTransaction: true,
    help: [
      "library archive --out ABSOLUTE_NEW_DIRECTORY | verify-archive ARCHIVE_DIRECTORY",
    ],
    covers: ["library verify-archive"],
    async run(args, { service }) {
      requireCount(args, 2);
      return new LibraryMaintenance(service.store.root).archive(
        option(args, "out", true)!,
      );
    },
  },
  {
    command: "library",
    actions: ["verify-archive"],
    async run(args) {
      requireCount(args, 3);
      return verifyLibraryArchive(resolve(args.positional[2]));
    },
  },
  {
    command: "library",
    actions: ["import"],
    options: { source: text },
    access: "write",
    ownTransaction: true,
    help: ["library import --source OLD_PATH --home NEW_OR_SAME_PATH"],
    async run(args, { service }) {
      requireCount(args, 2);
      return new LibraryImport(service.store.root).prepare(
        option(args, "source") ?? service.store.root,
      );
    },
  },
  {
    command: "library",
    actions: ["activate"],
    access: "write",
    ownTransaction: true,
    help: ["library activate IMPORT_ID --home PATH"],
    async run(args, { service }) {
      requireCount(args, 3);
      return new LibraryImport(service.store.root).activate(args.positional[2]);
    },
  },
  {
    command: "library",
    actions: ["migrate"],
    access: "write",
    ownTransaction: true,
    help: [
      "library migrate --home PATH (prepare, verify and activate in place; retain originals)",
    ],
    async run(args, { service }) {
      requireCount(args, 2);
      const importer = new LibraryImport(service.store.root);
      const report = await importer.prepare(service.store.root);
      return importer.activate(report.id);
    },
  },
  {
    command: "library",
    actions: ["imports"],
    help: ["library imports --home PATH"],
    async run(args, { service }) {
      requireCount(args, 2);
      return new LibraryImport(service.store.root).list();
    },
  },
  {
    command: "search",
    options: {
      query: text,
      kind: text,
      limit: hiddenText,
      cursor: hiddenText,
    },
    help: [
      "search --query TEXT [--project ID] [--kind page|component|template|project|source]",
    ],
    async run(args, { service }) {
      requireCount(args, 1);
      return service.search({
        query: option(args, "query", true)!,
        projectId: option(args, "project"),
        kind: option(args, "kind") as
          "page" | "component" | "template" | "project" | "source" | undefined,
        limit: option(args, "limit") ? Number(option(args, "limit")) : undefined,
        cursor: option(args, "cursor"),
      });
    },
  },
  {
    command: "workspace",
    actions: ["merge"],
    options: { input: text, "base-revision": text },
    access: (args) => (option(args, "revision") ? "write" : "read"),
    help: [
      "workspace merge PAGE --project ID --input DRAFT --base-revision BASE [--revision CURRENT_TO_SAVE]",
    ],
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      const document = (await readDocument(option(args, "input", true)!))
        .document;
      const selection = {
        projectId: await project(),
        pageId: id,
        baseRevision: option(args, "base-revision", true)!,
        document,
      };
      return option(args, "revision")
        ? service.pageMergeSave({
            ...selection,
            currentRevision: option(args, "revision", true)!,
          })
        : service.pageMergePreview(selection);
    },
  },
  {
    command: "workspace",
    actions: ["conflicts"],
    help: [
      "workspace conflicts [--project ID] | conflict CONFLICT_ID | resolve CONFLICT_ID --resolution discard|import|merge",
    ],
    covers: ["workspace conflict", "workspace resolve"],
    async run(args, { service }) {
      requireCount(args, 2);
      return service.workspaceConflicts(option(args, "project"));
    },
  },
  {
    command: "workspace",
    actions: ["recover-package"],
    access: "write",
    ownTransaction: true,
    async run(args, { service }) {
      requireCount(args, 3);
      return service.recoverPackageConflict({
        id: args.positional[2],
        clientId: `cli:${commandContext(args).actor.sessionId ?? "local-recovery"}`,
        targetProjectId: option(args, "project"),
      });
    },
  },
  {
    command: "workspace",
    actions: ["conflict"],
    async run(args, { service, id }) {
      requireCount(args, 3);
      return service.workspaceConflict(id);
    },
  },
  {
    command: "workspace",
    actions: ["resolve"],
    options: { resolution: text, input: hiddenText },
    access: "write",
    ownTransaction: true,
    async run(args, { service, id }) {
      requireCount(args, 3);
      const resolution = option(args, "resolution", true);
      if (!resolution || !["discard", "import", "merge"].includes(resolution))
        throw new Error("--resolution must be discard, import or merge.");
      return service.resolveWorkspaceConflict({
        id,
        resolution: resolution as "discard" | "import" | "merge",
        document: option(args, "input")
          ? (await readDocument(option(args, "input")!)).document
          : undefined,
      });
    },
  },
];
