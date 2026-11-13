import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentService } from "../service";
import {
  flag,
  hiddenText,
  option,
  requireCount,
  text,
  type CommandDeclaration,
} from "./command";
import { objectInput, readJson } from "./inputs";

/** Shared datasets: datasets *. */
export const datasetCommands: CommandDeclaration[] = [
  {
    command: "datasets",
    actions: ["list"],
    help: ["datasets list --project PROJECT"],
    async run(args, { service, project }) {
      requireCount(args, 2);
      return service.datasetList(await project());
    },
  },
  {
    command: "datasets",
    actions: ["read"],
    options: { path: text, refresh: flag, query: text },
    help: [
      "datasets read DATASET --project PROJECT [--path 'objectives[id=o1]'] [--refresh]",
      "datasets read DATASET --project PROJECT --query QUERY.json   {filter, sorts, search} over {columns, rows}",
    ],
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      const query = option(args, "query");
      return service.datasetRead(await project(), id, {
        path: option(args, "path"),
        refresh: !!args.options.refresh,
        ...(query
          ? {
              query: (await readJson(query)) as {
                filter?: unknown;
                sorts?: unknown;
                search?: string;
              },
            }
          : {}),
      });
    },
  },
  {
    command: "datasets",
    actions: ["create"],
    options: { name: text, input: text, description: hiddenText },
    access: "write",
    help: [
      "datasets create --project PROJECT --name NAME --input VALUE_OR_FROM_BLOCK.json",
    ],
    async run(args, { service, project }) {
      requireCount(args, 2);
      const input = option(args, "input")
        ? await readJson(option(args, "input")!)
        : {};
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error(
          "--input must contain { value } or { fromBlock: { pageId, blockId, baseHash, local? } }.",
        );
      return service.datasetCreate(await project(), {
        ...(input as Record<string, unknown>),
        name: option(args, "name", true)!,
        ...(option(args, "description")
          ? { description: option(args, "description") }
          : {}),
      } as Parameters<AgentService["datasetCreate"]>[1]);
    },
  },
  {
    command: "datasets",
    actions: ["apply"],
    options: { input: text, "base-hash": text },
    access: "write",
    help: [
      "datasets apply DATASET --project PROJECT --input operations.json --base-hash HASH",
    ],
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      const input = await readJson(option(args, "input", true)!);
      const body = Array.isArray(input) ? { operations: input } : input;
      if (
        !body ||
        typeof body !== "object" ||
        !Array.isArray((body as { operations?: unknown }).operations)
      )
        throw new Error(
          "Expected a JSON array of dataset operations, or { operations: [...], name?, description? }.",
        );
      return service.datasetApply(await project(), id, {
        ...(body as { operations: unknown[] }),
        baseHash: option(args, "base-hash", true)!,
      });
    },
  },
  {
    command: "datasets",
    actions: ["link"],
    options: {
      file: text,
      url: text,
      name: text,
      use: text,
      input: text,
      format: text,
      "refresh-seconds": text,
      embed: flag,
      "base-hash": text,
      description: hiddenText,
    },
    access: "write",
    help: [
      "datasets link [DATASET] --project PROJECT --file /abs/data.json|.csv|.tsv|.xlsx [--name NAME] [--use file|dataset] [--input VALUE.json]",
      "datasets link [DATASET] --project PROJECT --url https://host/data.json|.csv|.tsv|.xlsx [--format FORMAT] [--refresh-seconds 300] [--name NAME] [--use file]",
      "datasets link DATASET --project PROJECT --embed [--base-hash HASH]",
      "  Keeps the value in a file outside the library (linked on this device) or reads online data",
      "  (read-only; .xlsx files too); --embed copies it back; read --refresh fetches online data now.",
    ],
    async run(args, { service, project }) {
      requireCount(args, 2, 3);
      const dataset = args.positional[2];
      if (args.options.embed) {
        if (!dataset) throw new Error("datasets link --embed needs DATASET.");
        return service.datasetEmbed(
          await project(),
          dataset,
          option(args, "base-hash"),
        );
      }
      const use = option(args, "use");
      if (use !== undefined && !["file", "dataset"].includes(use))
        throw new Error("--use must be file or dataset.");
      const format = option(args, "format");
      if (format !== undefined && !["json", "csv", "tsv", "xlsx"].includes(format))
        throw new Error("--format must be json, csv, tsv or xlsx.");
      const url = option(args, "url");
      const file = option(args, "file");
      if (!url === !file) throw new Error("Give either --file or --url.");
      const refresh = option(args, "refresh-seconds");
      return service.datasetLink(await project(), {
        ...(dataset ? { datasetId: dataset } : {}),
        ...(file ? { path: resolve(file) } : { url: url! }),
        ...(refresh !== undefined ? { refreshSeconds: Number(refresh) } : {}),
        ...(format
          ? { format: format as "json" | "csv" | "tsv" | "xlsx" }
          : {}),
        ...(use ? { use: use as "file" | "dataset" } : {}),
        ...(option(args, "name") ? { name: option(args, "name") } : {}),
        ...(option(args, "description")
          ? { description: option(args, "description") }
          : {}),
        ...(option(args, "input")
          ? { value: await readJson(option(args, "input")!) }
          : {}),
      });
    },
  },
  {
    command: "datasets",
    actions: ["transform"],
    options: {
      name: text,
      inputs: text,
      script: text,
      "base-hash": text,
      description: hiddenText,
    },
    access: (args) => (args.options["dry-run"] ? "read" : "write"),
    help: [
      "datasets transform [DATASET] --project PROJECT [--name NAME] [--inputs INPUTS.json] [--script transform.js] [--base-hash HASH] [--dry-run]",
      "  A read-only dataset computed by a script from other datasets; INPUTS.json is { name: DATASET_ID };",
      "  the script defines function transform(inputs, helpers). --base-hash changes DATASET's definition;",
      "  --dry-run runs the script and returns its output without saving.",
    ],
    async run(args, { service, project }) {
      requireCount(args, 2, 3);
      const dataset = args.positional[2];
      const inputs = option(args, "inputs")
        ? objectInput(await readJson(option(args, "inputs")!), "--inputs")
        : undefined;
      const scriptPath = option(args, "script");
      const definition = {
        ...(inputs ? { inputs: inputs as Record<string, string> } : {}),
        ...(scriptPath
          ? { script: await readFile(resolve(scriptPath), "utf8") }
          : {}),
      };
      if (args.options["dry-run"])
        return service.datasetTryTransform(await project(), {
          ...(dataset ? { datasetId: dataset } : {}),
          ...definition,
        });
      const baseHash = option(args, "base-hash");
      return service.datasetTransform(await project(), {
        ...(dataset
          ? baseHash
            ? { datasetId: dataset }
            : { id: dataset }
          : {}),
        ...(baseHash ? { baseHash } : {}),
        ...(option(args, "name") ? { name: option(args, "name") } : {}),
        ...(option(args, "description")
          ? { description: option(args, "description") }
          : {}),
        ...definition,
      });
    },
  },
  {
    command: "datasets",
    actions: ["delete"],
    options: { "base-hash": text },
    access: "write",
    help: ["datasets delete DATASET --project PROJECT --base-hash HASH"],
    async run(args, { service, project, id }) {
      requireCount(args, 3);
      return service.datasetDelete(
        await project(),
        id,
        option(args, "base-hash", true)!,
      );
    },
  },
];
