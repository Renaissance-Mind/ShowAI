import { resolve } from "node:path";
import type { PackagingChoice } from "../../core/packaging";
import { parseArtifact } from "../../portable/validation.mjs";
import { assertExportDestination, type ExportFormat } from "../exporter";
import {
  describePublicResource,
  publicCatalog,
  renderPresentation,
  writePresentation,
} from "../presentation";
import {
  flag,
  hiddenFlag,
  hiddenText,
  option,
  requireCount,
  text,
  type CommandDeclaration,
} from "./command";
import { componentMode, objectInput, readJson, readerMode } from "./inputs";

const usePublic = () => new Error("Use public list or public describe ID.");

/** Public resources, independent presentations and page exports. */
export const presentationCommands: CommandDeclaration[] = [
  {
    command: "public",
    actions: ["list"],
    options: { kind: text, query: text, cursor: hiddenText, limit: hiddenText },
    help: ["public list [--kind component|template] [--query TEXT]"],
    async run(args) {
      return publicCatalog({
        kind: option(args, "kind") as "component" | "template" | undefined,
        query: option(args, "query"),
        cursor: option(args, "cursor"),
        limit: option(args, "limit") ? Number(option(args, "limit")) : undefined,
      });
    },
  },
  {
    command: "public",
    actions: ["describe"],
    options: { kind: text, view: text, file: hiddenText },
    help: [
      "public describe ID [--kind component|template] [--view guide|schema|examples|source]",
    ],
    async run(args, { id }) {
      if (id)
        return describePublicResource(id, {
          kind: option(args, "kind") as "component" | "template" | undefined,
          view: option(args, "view") as
            "guide" | "schema" | "examples" | "source" | undefined,
          file: option(args, "file"),
        });
      throw usePublic();
    },
  },
  {
    command: "public",
    actions: ["*"],
    async run() {
      throw usePublic();
    },
  },
  {
    command: "render",
    options: { input: text, template: text, title: text, out: text, overwrite: flag },
    help: [
      "render --input INPUT_JSON --out PAGE.html [--overwrite]",
      "render --template TEMPLATE_ID --title TITLE --out PAGE.html",
    ],
    async run(args, { service }) {
      requireCount(args, 1);
      const inputPath = option(args, "input"),
        templateId = option(args, "template");
      if (!!inputPath === !!templateId)
        throw new Error("Provide --input or --template.");
      const input = inputPath
        ? objectInput(await readJson(inputPath))
        : { templateId };
      const presentation = await renderPresentation({
        ...("format" in input
          ? {
              document: parseArtifact(input).document,
              ...(Array.isArray(input.componentSources)
                ? { componentSources: input.componentSources }
                : {}),
            }
          : input),
        ...(option(args, "title") ? { title: option(args, "title") } : {}),
      });
      const out = option(args, "out", true)!;
      await assertExportDestination(
        service.store.root,
        "presentation",
        resolve(out),
      );
      return writePresentation(presentation, out, !!args.options.overwrite);
    },
  },
  {
    command: "export",
    options: {
      page: text,
      blocks: text,
      format: text,
      out: text,
      reader: text,
      packaging: text,
      "external-data": text,
      overwrite: hiddenFlag,
      components: hiddenText,
      presentation: hiddenText,
      import: hiddenText,
      snapshot: hiddenText,
    },
    help: [
      "export --project PROJECT --page PAGE [--blocks ID,ID] --format html|inline --out PATH [--reader bundled|cdn]",
      "  html defaults to an offline page; --reader cdn writes a small online page. inline carries its reader and",
      "  loads it from the CDN only past the conversation size limit (reported in readerReason); --reader bundled fails instead.",
      "  Pages with files of this device stop with the packaging plan (items, sizes, choices); pass the person's",
      "  choices with --packaging DECISIONS.json ({itemId: choice}), or --external-data embed for everything that fits.",
    ],
    async run(args, { service, project }) {
      requireCount(args, 1);
      const format = option(args, "format", true);
      if (!["html", "inline", "site"].includes(format!))
        throw new Error("--format must be html, inline or site.");
      return service.export({
        projectId: await project(),
        pageId: option(args, "page"),
        ...(Object.hasOwn(args.options, "blocks")
          ? {
              blockIds: option(args, "blocks", true)!
                .split(",")
                .map((id) => id.trim()),
            }
          : {}),
        format: format as ExportFormat,
        out: option(args, "out", true)!,
        overwrite: !!args.options.overwrite,
        components: componentMode(args),
        reader: readerMode(args),
        revision: option(args, "revision"),
        ...(option(args, "import") || option(args, "snapshot")
          ? {
              importedSnapshot: {
                importId: option(args, "import", true)!,
                snapshotId: option(args, "snapshot", true)!,
              },
            }
          : {}),
        presentation: option(args, "presentation") as
          "spatial" | "reading" | undefined,
        ...(option(args, "packaging")
          ? {
              packaging: (await readJson(
                option(args, "packaging", true)!,
              )) as Record<string, PackagingChoice>,
            }
          : {}),
        ...(option(args, "external-data")
          ? {
              externalData: (() => {
                if (option(args, "external-data") !== "embed")
                  throw new Error("--external-data must be embed.");
                return "embed" as const;
              })(),
            }
          : {}),
      });
    },
  },
];
