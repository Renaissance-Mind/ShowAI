import { importerCommand, importCommand } from "../import-commands";
import { systemPresentationGuide } from "../system-presentation";
import { runtimeInfo, registerRuntime } from "../runtime";
import {
  option,
  requireCount,
  text,
  type CommandDeclaration,
} from "./command";
import { binding } from "./inputs";

/** Runtime, guides, projects and imports from other apps. */
export const projectCommands: CommandDeclaration[] = [
  {
    command: "runtime",
    access: (args) => (args.positional[1] === "register" ? "write" : "read"),
    ownTransaction: true,
    help: ["runtime info | runtime register"],
    async run(args, { service }) {
      requireCount(args, 2);
      const info = await runtimeInfo(service.store.root);
      if (args.positional[1] === "info") return info;
      if (args.positional[1] === "register")
        return registerRuntime(service.store.root, info.launch);
      throw new Error("Use runtime info or runtime register.");
    },
  },
  {
    command: "guide",
    help: [
      "guide [workspace|reading|authoring|containers|document|datasets|catalog|component|templates|versions|recovery|sync|export|publish|import]",
    ],
    async run(args, { service, action }) {
      requireCount(args, 1, 2);
      if (action === "presentation") return systemPresentationGuide();
      return service.guide(action);
    },
  },
  {
    command: "projects",
    actions: ["current"],
    access: "write",
    help: ["projects current [--source-directory PROJECT_DIRECTORY] [--project ID]"],
    async run(args, { service }) {
      requireCount(args, 2);
      return service.currentProject({
        projectId: option(args, "project"),
        sourceDirectory: option(args, "source-directory"),
      });
    },
  },
  {
    command: "projects",
    actions: ["list"],
    help: ["projects list"],
    async run(args, { service }) {
      requireCount(args, 2);
      return service.listProjects();
    },
  },
  {
    command: "projects",
    actions: ["create"],
    options: { name: text },
    access: "write",
    help: ["projects create --name NAME [--harness HOST --session SESSION_ID]"],
    async run(args, { service }) {
      requireCount(args, 2);
      return service.createProject(option(args, "name", true)!, binding(args));
    },
  },
  {
    command: "projects",
    actions: ["bind"],
    access: "write",
    help: ["projects bind PROJECT --harness HOST --session SESSION_ID"],
    async run(args, { service, id }) {
      requireCount(args, 3);
      return service.bindProject(id, binding(args, true)!);
    },
  },
  {
    command: "import",
    options: { folder: text, importer: text },
    access: (args) => (args.options["dry-run"] ? "read" : "write"),
    ownTransaction: true,
    help: [
      "import PATH --project PROJECT [--folder FOLDER] [--importer ID] [--dry-run]",
      '  Notion "Markdown & CSV" exports (zip or folder), Word .docx, Markdown/text and ShowAI exports, or an',
      "  importer saved in the library. --dry-run returns the plan (folders, pages, databases, attachments,",
      "  warnings) and writes nothing; the import reports each item it could not write.",
    ],
    async run(args, { service, project, action }) {
      requireCount(args, 2);
      return importCommand(service, action, {
        projectId: await project(),
        folderId: option(args, "folder"),
        importer: option(args, "importer"),
        dryRun: args.options["dry-run"] === true,
        progress: !args.options.json,
      });
    },
  },
  {
    command: "importers",
    options: { scope: text },
    access: (args) => (args.positional[1] === "list" ? "read" : "write"),
    ownTransaction: true,
    help: [
      "importers list [--project PROJECT]",
      "importers save DIRECTORY [--scope global|project --project PROJECT]   DIRECTORY holds importer.json and importer.js",
      "importers remove ID [--scope global|project --project PROJECT]",
    ],
    async run(args, { service, project, action, id }) {
      return importerCommand(service, action, id, {
        scope: option(args, "scope"),
        project,
      });
    },
  },
];
