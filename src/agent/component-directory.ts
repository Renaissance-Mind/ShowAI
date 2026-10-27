import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { CoreError } from "../core/model";
import { CAPACITY } from "../portable/capacity.mjs";
import { assertLocalPath, readJsonInput } from "./local-files";

/**
 * Checks a component package folder before it is compiled, so that a broken
 * manifest or schema is reported with its file, line and column. The compiler
 * then reads the same folder with its own package limits (source bytes, file
 * count, assets, no symbolic links).
 */
export async function inspectComponentDirectory(
  directory: string,
): Promise<Record<string, unknown>> {
  const root = assertLocalPath(directory, "directory");
  const info = await stat(root).catch((error: NodeJS.ErrnoException) => {
    throw new CoreError(
      error.code === "ENOENT" ? "NOT_FOUND" : "INVALID_PATH",
      `directory ${root} cannot be read (${error.code ?? error.message}).`,
    );
  });
  if (!info.isDirectory())
    throw new CoreError(
      "INVALID_PATH",
      `directory ${root} is not a folder. Pass the package folder that contains manifest.json.`,
    );
  const read = async (name: string) => {
    const path = join(root, name);
    const exists = await stat(path).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (!exists)
      throw new CoreError(
        "INVALID_DATA",
        `${path} is missing. A component package needs manifest.json, props.schema.json and the entry file named in the manifest.`,
      );
    return readJsonInput(path, name, CAPACITY.componentSourceBytes);
  };
  const manifest = await read("manifest.json");
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new CoreError(
      "INVALID_DATA",
      `${join(root, "manifest.json")} must contain a JSON object.`,
    );
  const schema = await read("props.schema.json");
  if (!schema || typeof schema !== "object" || Array.isArray(schema))
    throw new CoreError(
      "INVALID_DATA",
      `${join(root, "props.schema.json")} must contain a JSON Schema object.`,
    );
  const entry = (manifest as Record<string, unknown>).entry;
  if (typeof entry !== "string" || !entry.trim())
    throw new CoreError(
      "INVALID_DATA",
      `${join(root, "manifest.json")}: entry must name the package's React entry file (e.g. "index.tsx").`,
    );
  const entryPath = join(root, normalize(entry));
  const entryInfo = await stat(entryPath).catch(() => undefined);
  if (!entryInfo?.isFile())
    throw new CoreError(
      "INVALID_DATA",
      `${join(root, "manifest.json")}: entry ${JSON.stringify(entry)} does not exist in the package (${entryPath}).`,
    );
  return manifest as Record<string, unknown>;
}

/**
 * Writes an editable component package to a folder on this device, the
 * counterpart of component_save directory: manifest.json, props.schema.json,
 * the entry and every text file and asset of the package.
 */
export async function writeComponentDirectory(
  directory: string,
  source: {
    manifest: { entry: string } & Record<string, unknown>;
    schema: unknown;
    source: string;
    files?: Record<string, string>;
    assets?: Record<string, string>;
  },
  overwrite = false,
) {
  const root = resolve(assertLocalPath(directory, "out"));
  const existing = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    if (error.code === "ENOTDIR")
      throw new CoreError(
        "INVALID_PATH",
        `out ${root} is a file, not a folder.`,
      );
    throw error;
  });
  if (existing?.length && !overwrite)
    throw new CoreError(
      "INVALID_PATH",
      `out ${root} is not empty. Choose a new folder or pass overwrite:true to replace the package files in it.`,
    );
  const entries = new Map<string, Buffer>();
  for (const [path, text] of Object.entries(source.files ?? {}))
    entries.set(path, Buffer.from(text, "utf8"));
  for (const [path, encoded] of Object.entries(source.assets ?? {}))
    entries.set(path, Buffer.from(encoded, "base64"));
  // Stored package files keep their exact text; built-ins carry only objects.
  const missing = (path: string, contents: () => Buffer) => {
    if (!entries.has(path)) entries.set(path, contents());
  };
  missing("manifest.json", () =>
    Buffer.from(JSON.stringify(source.manifest, null, 2) + "\n"),
  );
  missing("props.schema.json", () =>
    Buffer.from(JSON.stringify(source.schema, null, 2) + "\n"),
  );
  missing(normalize(source.manifest.entry).replace(/^\.\//, ""), () =>
    Buffer.from(source.source, "utf8"),
  );
  let bytes = 0;
  for (const [path, contents] of entries) {
    const target = resolve(root, path);
    if (isAbsolute(path) || !target.startsWith(root + sep))
      throw new CoreError(
        "INVALID_PATH",
        `Package file ${path} would leave the output folder.`,
      );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents);
    bytes += contents.length;
  }
  return { path: root, files: entries.size, bytes };
}
