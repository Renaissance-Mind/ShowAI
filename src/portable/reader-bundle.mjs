import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { createHash } from "node:crypto";

const cache = new Map();
export function readerKinds(documents) {
  const kinds = new Set();
  const visit = (node) => {
    if (node?.type === "widget") kinds.add(node.attrs?.kind);
    node?.content?.forEach(visit);
  };
  for (const document of documents) visit(document.content);
  return [...kinds].filter((k) => typeof k === "string").sort();
}
const removeRanges = (source, ranges) => {
  for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start))
    source = source.slice(0, start) + source.slice(end);
  return source;
};

/** Build the exact dependency closure from the software's immutable source archive. */
export async function bundleReader(archivePath, documents) {
  const archiveText = await readFile(archivePath, "utf8");
  const archive = JSON.parse(archiveText);
  const { integrity, ...payload } = archive;
  if (
    archive.version !== 1 ||
    createHash("sha256").update(JSON.stringify(payload)).digest("hex") !==
      integrity
  )
    throw new Error("The reader source archive is invalid or corrupted.");
  const kinds = readerKinds(documents);
  const key = integrity + JSON.stringify(kinds);
  if (cache.has(key)) return cache.get(key);
  const job = compileReader(archivePath, archive, kinds);
  cache.set(key, job);
  if (cache.size > 16) cache.delete(cache.keys().next().value);
  job.catch(() => cache.delete(key));
  return job;
}

async function compileReader(archivePath, archive, kinds) {
  const selected = new Set(kinds);
  const chartKinds = new Set(
    JSON.parse(archive.files["resources/catalog/g2.json"]).map(
      (item) => item.kind,
    ),
  );
  const charts = kinds.filter((k) => chartKinds.has(k)).map((k) => k.slice(3));
  const drawImports = archive.draws.imports.filter((item) =>
    charts.some((type) => archive.draws.entries[type] === item.name),
  );
  const drawFiles = drawImports.map((item) =>
    posix.normalize("src/components/blocks/g2/" + item.path),
  );
  const literals = new Set(
    drawFiles.flatMap((path) =>
      [
        ...archive.files[path].matchAll(/["']([A-Za-z][A-Za-z0-9_-]*)["']/g),
      ].map((m) => m[1]),
    ),
  );
  const libraries = Object.keys(archive.libraries).filter((name) =>
    archive.libraries[name].some((tag) => literals.has(tag)),
  );
  const mandatory = new Set([
    "interval",
    "rect",
    "line",
    "point",
    "text",
    "path",
    "link",
    "area",
    "polygon",
    "box",
    "cell",
  ]);
  const coreProps = archive.core.properties
    .filter(
      (p) =>
        !p.key.startsWith("mark.") ||
        mandatory.has(p.key.slice(5)) ||
        literals.has(p.key.slice(5)),
    )
    .filter((p) => p.key !== "data.wordCloud" || literals.has("wordCloud"));
  const vendorCore =
    archive.core.source.slice(0, archive.core.start) +
    "{" +
    coreProps.map((p) => p.source).join(",") +
    "}" +
    archive.core.source.slice(archive.core.end);
  const plugin = {
    name: "showai-page-reader",
    setup(builder) {
      builder.onResolve({ filter: /^showai-reader-entry$/ }, () => ({
        path: "src/portable/main.tsx",
        namespace: "reader",
      }));
      builder.onResolve({ filter: /^\./, namespace: "reader" }, (args) => {
        const path = posix.normalize(
          posix.join(posix.dirname(args.importer), args.path),
        );
        const found = [
          path,
          ...[
            ".tsx",
            ".ts",
            ".jsx",
            ".js",
            ".mjs",
            ".json",
            ".css",
            "/index.tsx",
            "/index.ts",
          ].map((ext) => path + ext),
        ].find((p) => Object.hasOwn(archive.files, p));
        if (!found)
          throw new Error(
            `Reader dependency missing: ${args.path} from ${args.importer}`,
          );
        return {
          path: found,
          namespace: "reader",
          sideEffects: found.endsWith(".css"),
        };
      });
      builder.onLoad(
        { filter: /[/\\]@antv[/\\]g2[/\\]esm[/\\]lib[/\\]core\.js$/ },
        () => ({ contents: vendorCore, loader: "js" }),
      );
      builder.onLoad({ filter: /.*/, namespace: "reader" }, (args) => {
        let source = archive.files[args.path];
        if (args.path === "src/components/blocks/registry.ts")
          source = removeRanges(
            source,
            archive.registry.filter((r) =>
              r.kind
                ? !selected.has(r.kind)
                : r.group === "g2Metadata"
                  ? !charts.length
                  : r.group === "primitiveMetadata"
                    ? !kinds.some((k) =>
                        [
                          "text",
                          "image",
                          "table",
                          "callout",
                          "toggle",
                          "divider",
                          "code",
                        ].includes(k),
                      )
                    : false,
            ),
          );
        if (
          /^resources\/catalog\/(?:g2|components|primitives|surfaces)\.json$/.test(
            args.path,
          )
        )
          source = JSON.stringify(
            JSON.parse(source).filter((item) => selected.has(item.kind)),
          );
        if (args.path === "src/components/blocks/g2/draws.js") {
          source =
            drawImports.map((item) => item.text).join("\n") +
            "\nexport const draws={" +
            charts
              .map(
                (type) =>
                  JSON.stringify(type) + ":" + archive.draws.entries[type],
              )
              .join(",") +
            "};";
        }
        if (args.path === "src/components/blocks/g2/engine.js") {
          const imports = `import { Runtime } from "@antv/g2/esm/api/runtime";import { extend } from "@antv/g2/esm/api/extend";import { corelib } from "@antv/g2/esm/lib/core";${libraries
            .filter((k) => k !== "extension")
            .map(
              (k) =>
                `import { ${k} } from "@antv/g2/esm/lib/${{ plotlib: "plot", geolib: "geo", graphlib: "graph" }[k]}";`,
            )
            .join("")}`;
          const replacements = [
            ...archive.engine.imports.map((item) => ({
              ...item,
              text: item.extra
                ? libraries.includes("extension")
                  ? 'import { plotlib as extension } from "@antv/g2-extension-plot";'
                  : ""
                : imports,
            })),
            {
              ...archive.engine.library,
              text:
                "{ ...corelib()" +
                libraries.map((k) => ", ..." + k + "()").join("") +
                " }",
            },
          ];
          for (const item of replacements.sort((a, b) => b.start - a.start))
            source =
              source.slice(0, item.start) + item.text + source.slice(item.end);
        }
        return {
          contents: source,
          loader: args.path.endsWith(".tsx")
            ? "tsx"
            : args.path.endsWith(".ts")
              ? "ts"
              : args.path.endsWith(".css")
                ? "css"
                : args.path.endsWith(".json")
                  ? "json"
                  : "js",
          resolveDir: join(dirname(archivePath), ".."),
        };
      });
    },
  };
  const result = await build({
    stdin: {
      contents: 'import "showai-reader-entry";',
      resolveDir: dirname(archivePath),
      sourcefile: "reader-entry.js",
    },
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    minify: true,
    outfile: "reader.js",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [plugin],
    logLevel: "silent",
    legalComments: "inline",
  });
  const code = result.outputFiles.find((f) => f.path.endsWith(".js"))?.text;
  const css = result.outputFiles
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.text)
    .join("\n");
  if (!code) throw new Error("Reader compiler emitted no JavaScript.");
  const escaped = code.replace(/<\/script/gi, "<\\/script");
  const kindAttribute = JSON.stringify(kinds)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ShowAI document</title><meta name="showai-reader-kinds" content="${kindAttribute}"><script type="module">${escaped}</script><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><div id="root"></div><script id="showai-data" type="application/json">null</script></body></html>`;
}
