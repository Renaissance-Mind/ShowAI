import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins/showai");
await mkdir(join(plugin, "assets"), { recursive: true });
await mkdir(join(plugin, "scripts"), { recursive: true });
await mkdir(join(plugin, "skills/show-document/references"), {
  recursive: true,
});
await mkdir(join(plugin, "skills/show-document/examples"), { recursive: true });
await copyFile(
  join(root, "dist-portable/portable.html"),
  join(plugin, "assets/viewer.html"),
);
await copyFile(
  join(root, "docs/artifact-format.md"),
  join(plugin, "skills/show-document/references/artifact-format.md"),
);
await copyFile(
  join(root, "examples/welcome.showai.json"),
  join(plugin, "skills/show-document/examples/welcome.showai.json"),
);
await build({
  entryPoints: [join(root, "scripts/render-artifact.mjs")],
  outfile: join(plugin, "scripts/render-artifact.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  minify: false,
});
const viewer = await readFile(join(plugin, "assets/viewer.html"), "utf8");
if (
  !viewer.includes("showai-data") ||
  /<script\b[^>]*\bsrc=["']/i.test(viewer) ||
  /<link\b[^>]*rel=["']stylesheet/i.test(viewer)
)
  throw new Error("Packaged viewer must have inline JavaScript and CSS.");
const manifest = JSON.parse(
  await readFile(join(plugin, "plugin.json"), "utf8"),
);
await writeFile(
  join(plugin, "assets/build.json"),
  JSON.stringify(
    {
      version: manifest.version,
      viewerBytes: Buffer.byteLength(viewer),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ${plugin} (${(Buffer.byteLength(viewer) / 1024).toFixed(0)} KB viewer). Plugin is ready to install; no user settings were changed.`,
);
