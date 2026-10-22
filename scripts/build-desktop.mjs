import { frontendManifest } from "./build-info.mjs";
import { rawSourcePlugin } from "./raw-source-plugin.mjs";
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(join(root, "dist-desktop"), { recursive: true });
const policy =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http: showai-media:; media-src 'self' data: https: http: showai-media:; font-src 'self' data:; connect-src https: http:; frame-src 'self' about: data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'self'";
const html = (await readFile(join(root, "dist/index.html"), "utf8"))
  .replace(
    /<head>/i,
    `<head>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`,
  )
  .replace(/((?:src|href)=["'])\.\/assets\//g, "$1../dist/assets/");
await writeFile(join(root, "dist-desktop/index.html"), html);
await build({
  entryPoints: [join(root, "src/desktop/main.ts")],
  outfile: join(root, "dist-desktop/main.mjs"),
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  external: ["electron"],
  plugins: [
    rawSourcePlugin,
    {
      name: "desktop-compiler-runtime",
      setup(builder) {
        builder.onResolve({ filter: /^esbuild$/ }, () => ({
          path: join(root, "src/desktop/compiler.ts"),
        }));
      },
    },
  ],
  banner: {
    js: 'import { createRequire as __showaiCreateRequire } from "node:module"; const require = __showaiCreateRequire(import.meta.url);',
  },
});
await build({
  entryPoints: [join(root, "src/desktop/preload.ts")],
  outfile: join(root, "dist-desktop/preload.cjs"),
  platform: "node",
  target: "node22",
  format: "cjs",
  bundle: true,
  external: ["electron"],
});
await build({
  entryPoints: [join(root, "src/desktop/page-preview-worker.ts")],
  outfile: join(root, "dist-desktop/page-preview-worker.mjs"),
  platform: "node",
  target: "node22",
  format: "esm",
  bundle: true,
  plugins: [
    rawSourcePlugin,
    {
      name: "page-preview-compiler",
      setup(builder) {
        builder.onResolve({ filter: /^esbuild$/ }, () => ({
          path: join(root, "src/desktop/page-preview-compiler.ts"),
        }));
      },
    },
  ],
  banner: {
    js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);',
  },
});
await writeFile(
  join(root, "dist-desktop/build-info.json"),
  JSON.stringify(frontendManifest(), null, 2) + "\n",
);
console.log("Built ShowAI desktop main and sandboxed preload.");

await import("./build-index-worker.mjs");
await copyFile(
  join(root, "dist-agent/index-worker.mjs"),
  join(root, "dist-desktop/index-worker.mjs"),
);
