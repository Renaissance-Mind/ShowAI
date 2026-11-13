import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  datasetApply,
  datasetCreate,
  datasetDelete,
  datasetLink,
  datasetList,
  datasetRead,
  datasetTransform,
} from "../operations/datasets";
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
    operation: datasetList,
    help: ["datasets list --project PROJECT"],
    async input(args) {
      requireCount(args, 2);
      return {};
    },
  },
  {
    command: "datasets",
    actions: ["read"],
    operation: datasetRead,
    options: { path: text, refresh: flag, query: text },
    fields: {
      datasetId: "DATASET",
      path: "--path",
      refresh: "--refresh",
      query: "--query",
    },
    help: [
      "datasets read DATASET --project PROJECT [--path 'objectives[id=o1]'] [--refresh]",
      "datasets read DATASET --project PROJECT --query QUERY.json   {filter, sorts, search} over {columns, rows}",
    ],
    async input(args, { id }) {
      requireCount(args, 3);
      const query = option(args, "query");
      return {
        datasetId: id,
        path: option(args, "path"),
        refresh: !!args.options.refresh,
        ...(query ? { query: await readJson(query) } : {}),
      };
    },
  },
  {
    command: "datasets",
    actions: ["create"],
    operation: datasetCreate,
    options: { name: text, input: text, description: hiddenText },
    fields: {
      name: "--name",
      description: "--description",
      datasetId: "--input",
      value: "--input",
      schema: "--input",
      fromBlock: "--input",
    },
    help: [
      "datasets create --project PROJECT --name NAME --input VALUE_OR_FROM_BLOCK.json",
    ],
    async input(args) {
      requireCount(args, 2);
      const input = option(args, "input")
        ? await readJson(option(args, "input")!)
        : {};
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error(
          "--input must contain { value } or { fromBlock: { pageId, blockId, baseHash, local? } }.",
        );
      // The file may name the new dataset's id.
      const { id: datasetId, ...value } = input as Record<string, unknown>;
      return {
        ...value,
        ...(datasetId !== undefined ? { datasetId } : {}),
        name: option(args, "name", true)!,
        ...(option(args, "description")
          ? { description: option(args, "description") }
          : {}),
      };
    },
  },
  {
    command: "datasets",
    actions: ["apply"],
    operation: datasetApply,
    options: { input: text, "base-hash": text },
    fields: {
      datasetId: "DATASET",
      baseHash: "--base-hash",
      operations: "--input",
      name: "--input",
      description: "--input",
      schema: "--input",
    },
    help: [
      "datasets apply DATASET --project PROJECT --input operations.json --base-hash HASH",
    ],
    async input(args, { id }) {
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
      return {
        datasetId: id,
        ...(body as { operations: unknown[] }),
        baseHash: option(args, "base-hash", true)!,
      };
    },
  },
  {
    command: "datasets",
    actions: ["link"],
    operation: datasetLink,
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
    fields: {
      datasetId: "DATASET",
      path: "--file",
      url: "--url",
      format: "--format",
      refreshSeconds: "--refresh-seconds",
      use: "--use",
      name: "--name",
      description: "--description",
      value: "--input",
      baseHash: "--base-hash",
    },
    help: [
      "datasets link [DATASET] --project PROJECT --file /abs/data.json|.csv|.tsv|.xlsx [--name NAME] [--use file|dataset] [--input VALUE.json]",
      "datasets link [DATASET] --project PROJECT --url https://host/data.json|.csv|.tsv|.xlsx [--format FORMAT] [--refresh-seconds 300] [--name NAME] [--use file]",
      "datasets link DATASET --project PROJECT --embed [--base-hash HASH]",
      "  Keeps the value in a file outside the library (linked on this device) or reads online data",
      "  (read-only; .xlsx files too); --embed copies it back; read --refresh fetches online data now.",
    ],
    async input(args) {
      requireCount(args, 2, 3);
      const dataset = args.positional[2];
      if (args.options.embed) {
        if (!dataset) throw new Error("datasets link --embed needs DATASET.");
        // A null path copies the linked value back into the library.
        return {
          datasetId: dataset,
          path: null,
          baseHash: option(args, "base-hash"),
        };
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
      return {
        ...(dataset ? { datasetId: dataset } : {}),
        ...(file ? { path: resolve(file) } : { url: url! }),
        ...(refresh !== undefined ? { refreshSeconds: Number(refresh) } : {}),
        ...(format ? { format } : {}),
        ...(use ? { use } : {}),
        ...(option(args, "name") ? { name: option(args, "name") } : {}),
        ...(option(args, "description")
          ? { description: option(args, "description") }
          : {}),
        ...(option(args, "input")
          ? { value: await readJson(option(args, "input")!) }
          : {}),
      };
    },
  },
  {
    command: "datasets",
    actions: ["transform"],
    operation: datasetTransform,
    options: {
      name: text,
      inputs: text,
      script: text,
      "base-hash": text,
      description: hiddenText,
    },
    fields: {
      datasetId: "DATASET",
      baseHash: "--base-hash",
      name: "--name",
      description: "--description",
      inputs: "--inputs",
      script: "--script",
      dryRun: "--dry-run",
    },
    access: (args) => (args.options["dry-run"] ? "read" : "write"),
    help: [
      "datasets transform [DATASET] --project PROJECT [--name NAME] [--inputs INPUTS.json] [--script transform.js] [--base-hash HASH] [--dry-run]",
      "  A read-only dataset computed by a script from other datasets; INPUTS.json is { name: DATASET_ID };",
      "  the script defines function transform(inputs, helpers). --base-hash changes DATASET's definition;",
      "  --dry-run runs the script and returns its output without saving.",
    ],
    async input(args) {
      requireCount(args, 2, 3);
      const dataset = args.positional[2];
      const inputs = option(args, "inputs")
        ? objectInput(await readJson(option(args, "inputs")!), "--inputs")
        : undefined;
      const scriptPath = option(args, "script");
      const definition = {
        ...(inputs ? { inputs } : {}),
        ...(scriptPath
          ? { script: await readFile(resolve(scriptPath), "utf8") }
          : {}),
      };
      if (args.options["dry-run"])
        return {
          ...(dataset ? { datasetId: dataset } : {}),
          ...definition,
          dryRun: true,
        };
      const baseHash = option(args, "base-hash");
      return {
        ...(dataset ? { datasetId: dataset } : {}),
        ...(baseHash ? { baseHash } : {}),
        ...(option(args, "name") ? { name: option(args, "name") } : {}),
        ...(option(args, "description")
          ? { description: option(args, "description") }
          : {}),
        ...definition,
      };
    },
  },
  {
    command: "datasets",
    actions: ["delete"],
    operation: datasetDelete,
    options: { "base-hash": text },
    fields: { datasetId: "DATASET", baseHash: "--base-hash" },
    help: ["datasets delete DATASET --project PROJECT --base-hash HASH"],
    async input(args, { id }) {
      requireCount(args, 3);
      return { datasetId: id, baseHash: option(args, "base-hash", true)! };
    },
  },
];
