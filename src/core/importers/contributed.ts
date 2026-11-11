import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { runTransform } from "../dataset-transform";
import { atomicLibraryFile } from "../library-files";
import {
  listLibraryDirectory,
  logicalPath,
  readLibraryFile,
  versionedLibrary,
  workspaceRoot,
  writeLibraryFiles,
} from "../library-runtime";
import { CoreError } from "../model";
import type { ImportBundle, ImportInput, Importer } from "./types";

// Importers an Agent contributes to the content library. They live beside
// components and templates, in packages/importers/ID of the library (every
// project) or of one project: importer.json describes the importer and
// importer.js converts the input in the QuickJS sandbox of dataset
// transforms — no files, network or host objects, a memory limit and a
// deadline. The script returns the same ImportBundle as built-in importers.

export const IMPORTER_FORMAT = "showai-importer";
export const BUILTIN_IMPORTER_IDS = ["notion", "word", "markdown"];
export const CONTRIBUTED_LIMITS = {
  scriptBytes: 512 * 1024,
  memoryBytes: 256 * 1024 * 1024,
  timeoutMs: 20_000,
  outputBytes: 64 * 1024 * 1024,
  /** Text handed to the script: each file and all files together. */
  textFileBytes: 4 * 1024 * 1024,
  textBytes: 32 * 1024 * 1024,
};

export interface ImporterManifest {
  format: typeof IMPORTER_FORMAT;
  id: string;
  name: string;
  version: string;
  description: string;
  extensions: string[];
  folders?: boolean;
}

export interface ContributedImporter {
  manifest: ImporterManifest;
  script: string;
  scope: "global" | "project";
  projectId?: string;
}

const ID = /^[a-z][a-z0-9-]{0,79}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/;
const invalid = (message: string): never => {
  throw new CoreError("INVALID_DATA", message);
};

export function validateImporterManifest(value: unknown): ImporterManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    invalid("importer.json must be an object.");
  const manifest = value as Record<string, unknown>;
  for (const key of Object.keys(manifest))
    if (
      ![
        "format",
        "id",
        "name",
        "version",
        "description",
        "extensions",
        "folders",
      ].includes(key)
    )
      invalid(`importer.json has an unknown field ${key}.`);
  if (manifest.format !== IMPORTER_FORMAT)
    invalid(`importer.json format must be "${IMPORTER_FORMAT}".`);
  if (typeof manifest.id !== "string" || !ID.test(manifest.id))
    invalid("importer.json id must be lower-case letters, digits and -.");
  if (BUILTIN_IMPORTER_IDS.includes(manifest.id as string))
    invalid(
      `${String(manifest.id)} is a built-in importer; choose another id.`,
    );
  if (typeof manifest.version !== "string" || !VERSION.test(manifest.version))
    invalid("importer.json version must be exact semver, e.g. 1.0.0.");
  for (const key of ["name", "description"] as const)
    if (
      typeof manifest[key] !== "string" ||
      !(manifest[key] as string).trim() ||
      (manifest[key] as string).length > 1000
    )
      invalid(`importer.json ${key} must be text of 1–1000 characters.`);
  if (
    !Array.isArray(manifest.extensions) ||
    manifest.extensions.length > 20 ||
    !manifest.extensions.every(
      (item) => typeof item === "string" && /^\.[a-z0-9]{1,16}$/.test(item),
    )
  )
    invalid(
      'importer.json extensions must list up to 20 lower-case extensions such as ".opml".',
    );
  if (manifest.folders !== undefined && typeof manifest.folders !== "boolean")
    invalid("importer.json folders must be true or false.");
  if (!(manifest.extensions as string[]).length && manifest.folders !== true)
    invalid("An importer reads files with extensions, folders, or both.");
  return manifest as unknown as ImporterManifest;
}

function validateScript(script: unknown): string {
  if (typeof script !== "string" || !script.trim())
    invalid("importer.js must contain the script.");
  if (Buffer.byteLength(script as string) > CONTRIBUTED_LIMITS.scriptBytes)
    invalid(
      `importer.js holds at most ${CONTRIBUTED_LIMITS.scriptBytes} bytes.`,
    );
  if (!/\bconvert\b/.test(script as string))
    invalid("importer.js must define function convert(input, helpers).");
  return script as string;
}

function base(home: string, scope: "global" | "project", projectId?: string) {
  if (
    scope === "project" &&
    (!projectId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(projectId))
  )
    invalid("A project importer needs its projectId.");
  return scope === "project"
    ? join(workspaceRoot(home), "projects", projectId!, "packages", "importers")
    : join(workspaceRoot(home), "packages", "importers");
}

async function readText(
  home: string,
  path: string,
): Promise<string | undefined> {
  const managed = await readLibraryFile(home, path).catch(
    (error: { code?: string }) => {
      if (error.code === "NOT_FOUND") return undefined;
      throw error;
    },
  );
  if (managed) return managed.toString("utf8");
  if (versionedLibrary(home)) return undefined;
  return readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
}

async function names(home: string, path: string): Promise<string[]> {
  const managed = await listLibraryDirectory(home, path);
  if (managed) return managed;
  if (versionedLibrary(home)) return [];
  return readdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

async function readAt(
  home: string,
  directory: string,
  scope: "global" | "project",
  projectId?: string,
): Promise<ContributedImporter | undefined> {
  const manifest = await readText(home, join(directory, "importer.json"));
  const script = await readText(home, join(directory, "importer.js"));
  if (manifest === undefined || script === undefined) return undefined;
  return {
    manifest: validateImporterManifest(JSON.parse(manifest)),
    script: validateScript(script),
    scope,
    ...(projectId ? { projectId } : {}),
  };
}

/** Importers of the project first, then of the whole library; a project importer hides a library one with its id. */
export async function listContributedImporters(
  home: string,
  projectId?: string,
): Promise<{ importers: ContributedImporter[]; problems: string[] }> {
  const importers: ContributedImporter[] = [];
  const problems: string[] = [];
  const scopes: ["project" | "global", string | undefined][] = projectId
    ? [
        ["project", projectId],
        ["global", undefined],
      ]
    : [["global", undefined]];
  for (const [scope, project] of scopes) {
    const root = base(home, scope, project);
    for (const id of (await names(home, root)).sort()) {
      if (!ID.test(id) || importers.some((item) => item.manifest.id === id))
        continue;
      try {
        const importer = await readAt(home, join(root, id), scope, project);
        if (importer && importer.manifest.id !== id)
          throw new Error(
            `importer.json id ${importer.manifest.id} differs from its folder.`,
          );
        if (importer) importers.push(importer);
      } catch (error) {
        // One broken importer must not hide the others; its reason is listed.
        problems.push(
          `${scope === "project" ? `projects/${project}/` : ""}packages/importers/${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return { importers, problems };
}

async function writeFiles(
  home: string,
  files: Map<string, Buffer | null>,
): Promise<void> {
  if (versionedLibrary(home)) {
    const changes = new Map<string, Buffer | null>();
    for (const [path, bytes] of files) {
      const logical = logicalPath(home, path);
      if (!logical) invalid("The importer path leaves the library.");
      changes.set(logical!, bytes);
    }
    await writeLibraryFiles(home, changes);
    return;
  }
  for (const [path, bytes] of files)
    if (bytes) await atomicLibraryFile(home, path, bytes);
    else await rm(path, { force: true });
}

/** Saves (or replaces) a contributed importer; the library history keeps earlier versions. */
export async function saveContributedImporter(
  home: string,
  input: { manifest: unknown; script: unknown },
  target: { scope: "global" | "project"; projectId?: string },
): Promise<ContributedImporter> {
  const manifest = validateImporterManifest(input.manifest);
  const script = validateScript(input.script);
  const directory = join(
    base(home, target.scope, target.projectId),
    manifest.id,
  );
  await writeFiles(
    home,
    new Map([
      [
        join(directory, "importer.json"),
        Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      ],
      [join(directory, "importer.js"), Buffer.from(script)],
    ]),
  );
  return {
    manifest,
    script,
    scope: target.scope,
    ...(target.projectId && target.scope === "project"
      ? { projectId: target.projectId }
      : {}),
  };
}

export async function removeContributedImporter(
  home: string,
  id: string,
  target: { scope: "global" | "project"; projectId?: string },
): Promise<{ id: string; scope: "global" | "project" }> {
  if (!ID.test(id)) invalid("Invalid importer id.");
  const directory = join(base(home, target.scope, target.projectId), id);
  if (!(await readAt(home, directory, target.scope, target.projectId)))
    throw new CoreError("NOT_FOUND", `No ${target.scope} importer ${id}.`);
  await writeFiles(
    home,
    new Map([
      [join(directory, "importer.json"), null],
      [join(directory, "importer.js"), null],
    ]),
  );
  return { id, scope: target.scope };
}

/** The input as the sandbox sees it: every file with its size, and the text of text files. */
async function sandboxInput(input: ImportInput, withText: boolean) {
  let total = 0;
  const files = [];
  for (const file of input.files) {
    let text: string | undefined;
    if (
      withText &&
      file.size <= CONTRIBUTED_LIMITS.textFileBytes &&
      total + file.size <= CONTRIBUTED_LIMITS.textBytes
    ) {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          await file.bytes(),
        );
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        total += file.size;
      } catch (error) {
        // Binary files reach the script without text; their bytes stay with
        // the harness, which embeds them through file placeholders.
        if (!(error instanceof TypeError)) throw error;
      }
    }
    files.push({
      path: file.path,
      size: file.size,
      ...(text !== undefined ? { text } : {}),
    });
  }
  return { name: input.name, kind: input.kind, files };
}

const extensionOf = (path: string) =>
  /\.[^./]+$/.exec(path)?.[0]?.toLowerCase() ?? "";

/** A contributed importer in the same slot as the built-in ones. */
export function contributedImporter(item: ContributedImporter): Importer {
  const { manifest, script } = item;
  const limits = {
    memoryBytes: CONTRIBUTED_LIMITS.memoryBytes,
    timeoutMs: CONTRIBUTED_LIMITS.timeoutMs,
    outputBytes: CONTRIBUTED_LIMITS.outputBytes,
  };
  const failure = (run: { message: string }) =>
    new CoreError("INVALID_DATA", `Importer ${manifest.id}: ${run.message}`);
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    extensions: manifest.extensions,
    folders: manifest.folders === true,
    origin: item.scope,
    async detect(input) {
      if (input.kind !== "file" && input.kind !== "files" && !manifest.folders)
        return 0;
      const matching = input.files.filter((file) =>
        manifest.extensions.includes(extensionOf(file.path)),
      ).length;
      const fallback =
        input.kind === "file" || input.kind === "files"
          ? matching === input.files.length && matching
            ? 0.6
            : 0
          : matching
            ? 0.3
            : 0;
      if (!/\bfunction\s+detect\b|\bdetect\s*=/.test(script)) return fallback;
      const run = await runTransform(script, await sandboxInput(input, false), {
        entry: "detect",
        limits,
      });
      if (!run.ok) throw failure(run);
      const score = Number(run.value);
      if (!Number.isFinite(score) || score < 0 || score > 1)
        throw failure({ message: "detect must return a number from 0 to 1." });
      return score;
    },
    async convert(input) {
      const run = await runTransform(script, await sandboxInput(input, true), {
        entry: "convert",
        limits,
      });
      if (!run.ok) throw failure(run);
      return run.value as ImportBundle;
    },
  };
}
