import { frontendManifest } from "./build-info.mjs";
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
const runtime = join(root, "dist-runtime");
await mkdir(join(runtime, "assets"), { recursive: true });
await mkdir(join(runtime, "scripts"), { recursive: true });
await rm(join(runtime, "assets/agent-plugin"), { recursive: true, force: true });
await cp(join(root, "plugins/showai"), join(runtime, "assets/agent-plugin"), {
  recursive: true,
  verbatimSymlinks: true,
});
await rm(join(runtime, "web"), { recursive: true, force: true });
await cp(join(root, "dist"), join(runtime, "web"), {
  recursive: true,
  verbatimSymlinks: true,
});
await copyFile(
  join(root, "dist-portable/portable.html"),
  join(runtime, "assets/viewer.html"),
);
await copyFile(
  join(root, "dist-portable/reader-source.json"),
  join(runtime, "assets/reader-source.json"),
);
await rm(join(runtime, "assets/inline-core-viewer.html"), { force: true });
await copyFile(
  join(root, "dist-agent/cli.mjs"),
  join(runtime, "scripts/cli.mjs"),
);
await copyFile(
  join(root, "dist-agent/index-worker.mjs"),
  join(runtime, "scripts/index-worker.mjs"),
);
await rm(join(runtime, "node_modules"), { recursive: true, force: true });
const packages = new Set();
async function copyPackage(name) {
  if (packages.has(name)) return;
  packages.add(name);
  const source = join(root, "node_modules", name);
  const metadata = JSON.parse(
    await readFile(join(source, "package.json"), "utf8"),
  );
  await cp(source, join(runtime, "node_modules", name), {
    recursive: true,
    verbatimSymlinks: true,
  });
  for (const dependency of Object.keys(metadata.dependencies ?? {}).filter(
    (name) => !name.startsWith("@types/"),
  ))
    await copyPackage(dependency);
}
for (const name of [
  "dugite",
  "esbuild",
  "playwright-core",
  "react",
  "react-dom",
  "scheduler",
  "ajv",
  "marked",
  "katex",
  "pdfjs-dist",
  "lucide-react",
  "@xyflow/react",
  "@dagrejs/dagre",
  "@antv/g2",
  "@antv/g2-extension-plot",
  "@antv/g-svg",
  "d3-interpolate",
  "d3-regression",
  "topojson-client",
])
  await copyPackage(name);
const compilerPackages = await readdir(join(root, "node_modules/@esbuild"));
for (const name of compilerPackages)
  await cp(
    join(root, "node_modules/@esbuild", name),
    join(runtime, "node_modules/@esbuild", name),
    { recursive: true, force: true, verbatimSymlinks: true },
  );
await build({
  entryPoints: [join(root, "scripts/render-artifact.mjs")],
  outfile: join(runtime, "scripts/render-artifact.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["esbuild"],
});
const metadata = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const viewer = await readFile(join(runtime, "assets/viewer.html"), "utf8");
if (
  !viewer.includes("showai-data") ||
  /<script\b[^>]*\bsrc=["']/i.test(viewer) ||
  /<link\b[^>]*rel=["']stylesheet/i.test(viewer)
)
  throw new Error("Runtime reader must contain its JavaScript and CSS.");
await writeFile(
  join(runtime, "assets/build.json"),
  JSON.stringify(
    {
      ...frontendManifest(),
      version: metadata.version,
      platform: process.platform,
      architecture: process.arch,
      node: ">=22.12.0",
      compilerPackages,
      runtimePackages: [...packages].sort(),
      viewerBytes: Buffer.byteLength(viewer),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);
console.log(`Prepared external ShowAI runtime: ${runtime}`);
