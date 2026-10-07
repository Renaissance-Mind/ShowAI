import { build } from "esbuild";
import { parseSync } from "vite";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, relative, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);

function statements(source, path) {
  const result = parseSync(path, source);
  if (result.errors.length) throw new Error(result.errors[0].message);
  return result.program.body;
}

/** Freeze the reader's source graph and registration boundaries at build time. */
export async function buildReaderSource(root, destination) {
  const graph = await build({
    entryPoints: [join(root, "src/portable/main.tsx")],
    absWorkingDir: root,
    bundle: true,
    write: false,
    metafile: true,
    platform: "browser",
    format: "esm",
    jsx: "automatic",
    outfile: "reader.js",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const files = {};
  const vendor = createHash("sha256");
  for (const path of Object.keys(graph.metafile.inputs).sort()) {
    const normalized = path.replaceAll("\\", "/");
    const nodeModules = normalized.indexOf("node_modules/");
    const bytes = await readFile(resolve(root, path));
    if (nodeModules >= 0) {
      vendor.update(normalized.slice(nodeModules));
      vendor.update(createHash("sha256").update(bytes).digest("hex"));
    } else files[path] = bytes.toString("utf8");
  }
  const vendorIntegrity = vendor.digest("hex");
  const registryPath = "src/components/blocks/registry.ts";
  const registry = statements(files[registryPath], registryPath).flatMap(
    (node) => {
      if (node.type === "ForOfStatement" && node.right.type === "Identifier")
        return [{ start: node.start, end: node.end, group: node.right.name }];
      if (
        node.type === "ExpressionStatement" &&
        node.expression.type === "CallExpression" &&
        node.expression.callee.name === "registerBlock"
      ) {
        const kind = node.expression.arguments[0]?.properties.find(
          (p) => p.key?.name === "kind",
        )?.value?.value;
        if (typeof kind !== "string")
          throw new Error("Reader registration needs a literal kind.");
        return [{ start: node.start, end: node.end, kind }];
      }
      return [];
    },
  );
  const drawPath = "src/components/blocks/g2/draws.js";
  const drawNodes = statements(files[drawPath], drawPath);
  const draws = {
    imports: drawNodes
      .filter((n) => n.type === "ImportDeclaration")
      .map((n) => ({
        name: n.specifiers[0].local.name,
        path: n.source.value,
        text: files[drawPath].slice(n.start, n.end),
      })),
    entries: Object.fromEntries(
      drawNodes
        .find(
          (n) =>
            n.type === "ExportNamedDeclaration" &&
            n.declaration?.declarations?.[0]?.id?.name === "draws",
        )
        .declaration.declarations[0].init.properties.map((p) => [
          p.key.name ?? p.key.value,
          p.value.name,
        ]),
    ),
  };
  const enginePath = "src/components/blocks/g2/engine.js";
  const engineNodes = statements(files[enginePath], enginePath);
  const engineImports = engineNodes
    .filter(
      (n) =>
        n.type === "ImportDeclaration" &&
        ["@antv/g2", "@antv/g2-extension-plot"].includes(n.source.value),
    )
    .map((n) => ({
      start: n.start,
      end: n.end,
      extra: n.source.value.endsWith("extension-plot"),
    }));
  const create = engineNodes.find(
    (n) =>
      n.type === "ExportNamedDeclaration" &&
      n.declaration?.id?.name === "createG2Context",
  ).declaration;
  const library = create.body.body.find(
    (n) =>
      n.type === "VariableDeclaration" &&
      n.declarations[0]?.id?.name === "ChartBase",
  ).declarations[0].init.arguments[1];
  if (library.type !== "ObjectExpression")
    throw new Error("G2 reader requires an explicit library declaration.");
  const engine = {
    imports: engineImports,
    library: { start: library.start, end: library.end },
  };
  const g2 = require("@antv/g2");
  const libraries = Object.fromEntries(
    ["plotlib", "geolib", "graphlib"].map((name) => [
      name,
      Object.keys(g2[name]()).map((k) => k.split(".").at(-1)),
    ]),
  );
  libraries.extension = Object.keys(
    require("@antv/g2-extension-plot").plotlib(),
  ).map((k) => k.split(".").at(-1));
  const corePath = join(
    dirname(require.resolve("@antv/g2/package.json")),
    "esm/lib/core.js",
  );
  const coreSource = await readFile(corePath, "utf8");
  const fn = statements(coreSource, corePath).find(
    (n) =>
      n.type === "ExportNamedDeclaration" &&
      n.declaration?.id?.name === "corelib",
  ).declaration;
  const object = fn.body.body.find(
    (n) => n.type === "ReturnStatement",
  ).argument;
  const core = {
    source: coreSource,
    start: object.start,
    end: object.end,
    properties: object.properties.map((p) => ({
      key: p.key.value,
      source: coreSource.slice(p.start, p.end),
    })),
  };
  const payload = {
    version: 1,
    vendorIntegrity,
    files,
    registry,
    draws,
    engine,
    libraries,
    core,
  };
  const integrity = createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify({ ...payload, integrity }));
  return [
    ...Object.keys(graph.metafile.inputs).map((path) => resolve(root, path)),
    corePath,
  ];
}
