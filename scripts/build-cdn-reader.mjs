#!/usr/bin/env node
// Builds the reader as code-split ES modules for static hosting on a CDN.
// Inline conversation fragments then carry only page data and import the
// reader from that host; each block's code and styles load with its chunk.
import { build, transform } from "esbuild";
import { copyFile, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const styles = join(root, "src/portable/cdn-styles.ts");
// Override with SHOWAI_CDN_PACKAGE to publish under another npm name.
const packageName = process.env.SHOWAI_CDN_PACKAGE || "showai-reader";

/** Stylesheets become modules that register their CSS with the mounted readers. */
const cssModules = {
  name: "showai-cdn-css",
  setup(builder) {
    builder.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, "utf8");
      const imports = [];
      // Keep @import as module imports so shared sheets are registered once.
      const body = source.replace(
        /@import\s+(?:url\()?["']([^"']+)["']\)?\s*;/g,
        (_, path) => {
          imports.push(path);
          return "";
        },
      );
      const { code: css } = await transform(body, {
        loader: "css",
        minify: true,
      });
      return {
        contents: `import { registerStyle } from ${JSON.stringify(styles)};
${imports.map((path) => `import ${JSON.stringify(path)};`).join("\n")}
registerStyle(${JSON.stringify(css)});`,
        loader: "js",
        resolveDir: dirname(args.path),
      };
    });
  },
};

// One CDN reader serves every block kind, so it cannot filter the catalogs by
// page like the bundled reader. Reading needs each kind's name and default
// data; examples, schemas and documentation serve authoring tools only.
const AUTHORING_FIELDS = ["examples", "propsSchema", "scenarios", "effects"];
const readingCatalogs = {
  name: "showai-cdn-catalogs",
  setup(builder) {
    builder.onLoad(
      { filter: /[/\\]resources[/\\]catalog[/\\][^/\\]+\.json$/ },
      async (args) => {
        const data = JSON.parse(await readFile(args.path, "utf8"));
        const reading = /-documentation\.json$/.test(args.path)
          ? {}
          : Array.isArray(data)
            ? data.map((item) =>
                Object.fromEntries(
                  Object.entries(item).filter(
                    ([key]) => !AUTHORING_FIELDS.includes(key),
                  ),
                ),
              )
            : data;
        return { contents: JSON.stringify(reading), loader: "json" };
      },
    );
  },
};

export async function buildCdnReader(outdir = join(root, "dist-cdn")) {
  await rm(outdir, { recursive: true, force: true });
  const result = await build({
    entryPoints: { reader: join(root, "src/portable/cdn.tsx") },
    absWorkingDir: root,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    outdir,
    entryNames: "[name]-[hash]",
    chunkNames: "chunks/[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [cssModules, readingCatalogs],
    metafile: true,
    legalComments: "linked",
    logLevel: "warning",
  });
  const outputs = Object.entries(result.metafile.outputs).filter(([path]) =>
    path.endsWith(".js"),
  );
  const [entryPath] =
    outputs.find(
      ([, output]) => output.entryPoint === "src/portable/cdn.tsx",
    ) ?? [];
  if (!entryPath) throw new Error("The CDN reader build emitted no entry.");
  const entry = relative(outdir, resolve(root, entryPath)).replaceAll(
    "\\",
    "/",
  );
  const bytes = await readFile(resolve(root, entryPath));
  const app = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const manifest = {
    format: "showai-cdn-reader",
    version: app.version,
    entry,
    integrity: `sha256-${createHash("sha256").update(bytes).digest("base64")}`,
    files: outputs.length,
    bytes: outputs.reduce((total, [, output]) => total + output.bytes, 0),
  };
  await mkdir(outdir, { recursive: true });
  await writeFile(
    join(outdir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  // The directory doubles as an npm package, so registry CDNs such as
  // jsDelivr and unpkg can serve it at an immutable versioned URL.
  await writeFile(join(outdir, "index.js"), `export * from "./${entry}";\n`);
  await writeFile(
    join(outdir, "package.json"),
    JSON.stringify(
      {
        name: packageName,
        version: app.version,
        description:
          "ShowAI page reader as code-split ES modules, for inline pages loaded from a CDN.",
        type: "module",
        exports: { ".": "./index.js", "./manifest.json": "./manifest.json" },
        license: app.license,
        homepage: app.homepage,
        repository: app.repository,
        bugs: app.bugs,
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(outdir, "README.md"),
    `# ${packageName}

The [ShowAI](${app.homepage}) page reader, built from ShowAI ${app.version} as code-split ES modules. Inline conversation pages written by \`render-artifact --cdn\` import it and load each component's code only when the page uses it.

\`\`\`js
const { mount } = await import("https://cdn.jsdelivr.net/npm/${packageName}@${app.version}/index.js");
mount(document.getElementById("page"), { artifact });
\`\`\`

\`manifest.json\` records the entry module and its integrity. Third-party licenses are listed in the \`*.LEGAL.txt\` files next to each module.
`,
  );
  await copyFile(join(root, "LICENSE"), join(outdir, "LICENSE"));
  return { manifest, metafile: result.metafile };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const outdir = process.argv[2] ? resolve(process.argv[2]) : undefined;
  const { manifest, metafile } = await buildCdnReader(outdir);
  const sizes = Object.entries(metafile.outputs)
    .filter(([path]) => path.endsWith(".js"))
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 8)
    .map(
      ([path, output]) =>
        `  ${(output.bytes / 1024).toFixed(0).padStart(6)} KB  ${path}`,
    );
  console.log(
    `CDN reader ${manifest.version}: ${manifest.entry}, ${manifest.files} files, ${(manifest.bytes / 1024 / 1024).toFixed(1)} MB\n${sizes.join("\n")}`,
  );
}
