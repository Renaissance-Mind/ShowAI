import { build } from "esbuild";
import {
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
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
  join(root, "dist-agent/cli.mjs"),
  join(plugin, "scripts/cli.mjs"),
);
for (const document of [
  "artifact-format.md",
  "agent-usage.md",
  "catalog-lifecycle.md",
]) {
  const text = (await readFile(join(root, "docs", document), "utf8"))
    .replaceAll("../plugins/showai/README.md", "../../../README.md")
    .replaceAll(
      "](../src/",
      "](https://github.com/Renaissance-Mind/ShowAI/blob/main/src/",
    )
    .replaceAll(
      "../resources/catalog/value-slider",
      "../examples/value-slider",
    );
  await writeFile(
    join(plugin, "skills/show-document/references", document),
    text,
  );
}
await cp(
  join(root, "resources/catalog/value-slider"),
  join(plugin, "skills/show-document/examples/value-slider"),
  { recursive: true, force: true },
);
await copyFile(
  join(root, "examples/welcome.showai.json"),
  join(plugin, "skills/show-document/examples/welcome.showai.json"),
);
// esbuild locates its native executable relative to its real npm package.
// Ship the installed target platform rather than pretending one binary is portable.
await rm(join(plugin, "node_modules"), { recursive: true, force: true });
await mkdir(join(plugin, "node_modules/@esbuild"), { recursive: true });
const runtimePackages = new Set();
async function copyRuntimePackage(name) {
  if (runtimePackages.has(name)) return;
  runtimePackages.add(name);
  const source = join(root, "node_modules", name);
  const metadata = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  await cp(source, join(plugin, "node_modules", name), {
    recursive: true,
    force: true,
  });
  for (const dependency of Object.keys(metadata.dependencies ?? {}))
    await copyRuntimePackage(dependency);
}
for (const name of ["esbuild", "react", "react-dom", "scheduler", "ajv"])
  await copyRuntimePackage(name);
const binaryPackages = await readdir(join(root, "node_modules/@esbuild"));
for (const name of binaryPackages)
  await cp(
    join(root, "node_modules/@esbuild", name),
    join(plugin, "node_modules/@esbuild", name),
    { recursive: true, force: true },
  );
await build({
  entryPoints: [join(root, "scripts/render-artifact.mjs")],
  outfile: join(plugin, "scripts/render-artifact.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
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
      platform: process.platform,
      architecture: process.arch,
      node: ">=22.12.0",
      compilerPackages: binaryPackages,
      runtimePackages: [...runtimePackages].sort(),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared ShowAI plugin for ${process.platform}/${process.arch}: ${plugin}. No user settings were changed.`,
);
