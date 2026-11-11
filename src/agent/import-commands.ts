import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { mutateLibrary } from "../core/library-runtime";
import { CoreError } from "../core/model";
import {
  removeContributedImporter,
  saveContributedImporter,
} from "../core/importers/contributed";
import {
  availableImporters,
  importerInfo,
  planImport,
  runImport,
  type ImportPlan,
  type ImportReport,
} from "./import-service";
import type { AgentService } from "./service";

// The Agent's entries to the import harness (CLI and MCP): the same plan and
// run as the workbench, plus saving the importers an Agent writes.

/** At most this many plan items are listed back; counts cover all of them. */
const LISTED_ITEMS = 200;

export function compactPlan(plan: ImportPlan) {
  return plan.items.length > LISTED_ITEMS
    ? {
        ...plan,
        items: plan.items.slice(0, LISTED_ITEMS),
        itemsOmitted: plan.items.length - LISTED_ITEMS,
      }
    : plan;
}
export function compactReport(report: ImportReport) {
  return {
    ...report,
    plan: compactPlan(report.plan),
  };
}

export async function importCommand(
  service: AgentService,
  path: string,
  options: {
    projectId: string;
    folderId?: string;
    importer?: string;
    dryRun: boolean;
    progress?: boolean;
  },
) {
  const source = { path: resolve(path) };
  const target = {
    projectId: options.projectId,
    parentId: options.folderId ?? null,
  };
  if (options.dryRun)
    return planImport(service, source, target, { importer: options.importer });
  return runImport(service, source, target, {
    importer: options.importer,
    onProgress:
      options.progress && process.stderr.isTTY
        ? (step) =>
            process.stderr.write(
              `\r${step.done}/${step.total} ${step.current ?? ""}`
                .slice(0, 120)
                .padEnd(120) + (step.done === step.total ? "\n" : ""),
            )
        : undefined,
  });
}

/** importer.json and importer.js of a folder, as saving takes them. */
export async function readImporterDirectory(directory: string) {
  const folder = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(folder, "importer.json"), "utf8"),
  ) as unknown;
  const script = await readFile(join(folder, "importer.js"), "utf8");
  return { manifest, script };
}

function importerScope(value: string | undefined): "global" | "project" {
  const scope = value ?? "global";
  if (scope !== "global" && scope !== "project")
    throw new CoreError("INVALID_DATA", "--scope must be global or project.");
  return scope;
}

export async function importerCommand(
  service: AgentService,
  action: string | undefined,
  id: string | undefined,
  options: { scope?: string; project: () => Promise<string> },
) {
  const root = service.store.root;
  if (action === "list") {
    const { importers, problems } = await availableImporters(
      root,
      await options.project(),
    );
    return { importers: importers.map(importerInfo), problems };
  }
  const scope = importerScope(options.scope);
  const target = {
    scope,
    ...(scope === "project" ? { projectId: await options.project() } : {}),
  };
  if (action === "save" && id) {
    const input = await readImporterDirectory(id);
    const saved = await mutateLibrary(root, () =>
      saveContributedImporter(root, input, target),
    );
    return {
      ...saved.manifest,
      scope: saved.scope,
      next: "showai import PATH --dry-run",
    };
  }
  if (action === "remove" && id)
    return mutateLibrary(root, () =>
      removeContributedImporter(root, id, target),
    );
  throw new Error(
    "Use importers list, importers save DIRECTORY or importers remove ID.",
  );
}
