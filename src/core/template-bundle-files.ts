import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  parseTemplateBundle,
  type TemplateBundleSource,
} from "../portable/template-bundle.mjs";

/** Directory imports and remote payloads both pass the portable bundle validator. */
export async function readTemplateDirectory(
  directory: string,
): Promise<TemplateBundleSource> {
  const root = resolve(directory);
  if (!(await lstat(root)).isDirectory())
    throw new Error("Template import requires a directory.");
  const files: Record<string, string> = {},
    assets: Record<string, string> = {};
  let bytes = 0,
    count = 0;
  async function visit(path: string, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if ([".gitkeep", ".DS_Store"].includes(entry.name)) continue;
      const name = prefix + entry.name,
        location = join(path, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Template symlinks are not supported: ${name}.`);
      if (entry.name.startsWith("."))
        throw new Error(`Hidden template files are not supported: ${name}.`);
      if (entry.isDirectory()) {
        await visit(location, name + "/");
        continue;
      }
      if (!entry.isFile())
        throw new Error(`Unsupported template entry: ${name}.`);
      const stat = await lstat(location);
      if (stat.isSymbolicLink())
        throw new Error(`Template symlink changed during import: ${name}.`);
      bytes += stat.size;
      if (++count > 200 || bytes > 16 * 1024 * 1024)
        throw new Error("Template directory exceeds package capacity.");
      const data = await readFile(location);
      if (
        [
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
          ".gif",
          ".svg",
          ".woff",
          ".woff2",
          ".ttf",
          ".otf",
        ].includes(extname(name).toLowerCase())
      )
        assets[name] = data.toString("base64");
      else files[name] = data.toString("utf8");
    }
  }
  await visit(root);
  const bundle: TemplateBundleSource = {
    format: 1,
    files,
    ...(Object.keys(assets).length ? { assets } : {}),
  };
  parseTemplateBundle(bundle);
  return bundle;
}

export async function writeTemplateDirectory(
  directory: string,
  source: TemplateBundleSource,
) {
  const bundle = parseTemplateBundle(source).source,
    root = resolve(directory);
  await mkdir(root, { recursive: false });
  await mkdir(join(root, "components"));
  await mkdir(join(root, "guides"));
  for (const [name, value] of Object.entries(bundle.files)) {
    const parts = name.split("/");
    parts.pop();
    if (parts.length) await mkdir(join(root, ...parts), { recursive: true });
    await writeFile(join(root, name), value, { flag: "wx" });
  }
  for (const [name, value] of Object.entries(bundle.assets ?? {})) {
    const parts = name.split("/");
    parts.pop();
    await mkdir(join(root, ...parts), { recursive: true });
    await writeFile(join(root, name), Buffer.from(value, "base64"), {
      flag: "wx",
    });
  }
  return {
    path: root,
    files:
      Object.keys(bundle.files).length +
      Object.keys(bundle.assets ?? {}).length,
  };
}
