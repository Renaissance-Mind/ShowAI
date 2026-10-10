import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
const root = new URL("../resources/catalog/text-diagram/", import.meta.url);
export async function diagramPackage() {
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", root), "utf8"),
  );
  const schema = JSON.parse(
    await readFile(new URL("props.schema.json", root), "utf8"),
  );
  const files = {};
  async function walk(directory = "") {
    for (const item of await readdir(new URL(directory, root), {
      withFileTypes: true,
    })) {
      const name = directory + item.name;
      if (item.isDirectory()) await walk(name + "/");
      else if (
        /\.(tsx?|js|json|css)$/.test(name) &&
        !["manifest.json", "props.schema.json"].includes(name)
      )
        files[name] = await readFile(new URL(name, root), "utf8");
    }
  }
  await walk();
  return { manifest, schema, source: files[manifest.entry], files };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.log(JSON.stringify(await diagramPackage()));
