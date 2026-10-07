import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const root = dirname(require.resolve("pdfjs-dist/package.json"));
const assets = {};
await mkdir("resources/licenses/pdfjs", { recursive: true });
const copyLicense = async (source, destination) => {
  const license = await readFile(source, "utf8");
  await writeFile(destination, license.replace(/[ \t]+$/gm, "").trimEnd() + "\n");
};
await copyLicense(join(root, "LICENSE"), "resources/licenses/pdfjs/LICENSE");
for (const [kind, directory] of Object.entries({
  cMapUrl: "cmaps",
  standardFontDataUrl: "standard_fonts",
  wasmUrl: "wasm",
})) {
  assets[kind] = {};
  for (const name of (await readdir(join(root, directory))).sort()) {
    if (name.includes("LICENSE")) {
      await copyLicense(
        join(root, directory, name),
        join("resources/licenses/pdfjs", `${directory}-${name}`),
      );
      continue;
    }
    if (
      directory === "wasm" &&
      (!name.endsWith(".wasm") || name.startsWith("quickjs"))
    )
      continue;
    assets[kind][name] = (await readFile(join(root, directory, name))).toString(
      "base64",
    );
  }
}
await writeFile(
  "src/components/blocks/pdf-assets.json",
  JSON.stringify(assets) + "\n",
);
