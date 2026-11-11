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

/** The kinds a dispatch condition names, or null when it names them some other way. */
function conditionKinds(test) {
  const isKind = (node) => node.type === "Identifier" && node.name === "kind";
  const literal = (node) =>
    node.type === "Literal" && typeof node.value === "string";
  if (test.type === "LogicalExpression" && test.operator === "||") {
    const left = conditionKinds(test.left);
    const right = conditionKinds(test.right);
    return left && right
      ? {
          kinds: [...left.kinds, ...right.kinds],
          prefixes: [...left.prefixes, ...right.prefixes],
        }
      : null;
  }
  if (
    test.type === "BinaryExpression" &&
    test.operator === "===" &&
    isKind(test.left) &&
    literal(test.right)
  )
    return { kinds: [test.right.value], prefixes: [] };
  if (
    test.type === "CallExpression" &&
    test.arguments.length === 1 &&
    test.callee.type === "MemberExpression" &&
    !test.callee.computed
  ) {
    const method = test.callee.property.name;
    const [argument] = test.arguments;
    if (
      method === "includes" &&
      test.callee.object.type === "ArrayExpression" &&
      test.callee.object.elements.every(literal) &&
      isKind(argument)
    )
      return {
        kinds: test.callee.object.elements.map((element) => element.value),
        prefixes: [],
      };
    if (
      method === "startsWith" &&
      isKind(test.callee.object) &&
      literal(argument)
    )
      return { kinds: [], prefixes: [argument.value] };
  }
  return null;
}

/**
 * Component validators the portable validator reaches only through
 * validateWidgetData's dispatch on literal kinds. A reader whose pages hold
 * none of those kinds never calls them, so it can leave their modules out.
 * Imports used any other way are not listed and stay real.
 */
function widgetValidators(source) {
  const path = "src/portable/validation.mjs";
  const body = statements(source, path);
  const dispatch = body.find(
    (node) =>
      node.type === "FunctionDeclaration" &&
      node.id.name === "validateWidgetData",
  );
  if (!dispatch) throw new Error("Reader validation needs validateWidgetData.");
  const branches = new Map();
  for (const node of dispatch.body.body) {
    if (
      node.type !== "IfStatement" ||
      node.consequent.type !== "BlockStatement"
    )
      continue;
    const call = node.consequent.body[0];
    if (
      node.consequent.body.length !== 2 ||
      node.consequent.body[1].type !== "ReturnStatement" ||
      call.type !== "ExpressionStatement" ||
      call.expression.type !== "CallExpression" ||
      call.expression.callee.type !== "Identifier"
    )
      continue;
    const kinds = conditionKinds(node.test);
    if (kinds) branches.set(call.expression.callee.name, kinds);
  }
  // Used exactly twice: its import and its one dispatch call.
  const uses = (name) =>
    [...source.matchAll(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g"))]
      .length;
  return body.flatMap((node) => {
    if (
      node.type !== "ImportDeclaration" ||
      !/-contract\.mjs$|\/contract\.mjs$/.test(node.source.value) ||
      !node.specifiers.length ||
      !node.specifiers.every(
        (s) =>
          s.type === "ImportSpecifier" &&
          branches.has(s.local.name) &&
          uses(s.local.name) === 2,
      )
    )
      return [];
    const names = node.specifiers.map((s) => s.local.name);
    return [
      {
        start: node.start,
        end: node.end,
        names,
        kinds: names.flatMap((name) => branches.get(name).kinds),
        prefixes: names.flatMap((name) => branches.get(name).prefixes),
      },
    ];
  });
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
  // Top-level bindings the registrations use. A reader drops the ones its
  // remaining registrations no longer name, so modules (and their CSS) behind
  // a removed kind never enter the bundle.
  const declarations = statements(files[registryPath], registryPath).flatMap(
    (node) => {
      if (node.type === "ImportDeclaration" && node.specifiers.length)
        return [
          {
            start: node.start,
            end: node.end,
            names: node.specifiers.map((s) => s.local.name),
          },
        ];
      if (node.type === "VariableDeclaration")
        return [
          {
            start: node.start,
            end: node.end,
            names: node.declarations.map((d) => {
              if (d.id.type !== "Identifier")
                throw new Error(
                  "Reader registry bindings must be plain names.",
                );
              return d.id.name;
            }),
          },
        ];
      return [];
    },
  );
  const validators = widgetValidators(files["src/portable/validation.mjs"]);
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
    declarations,
    validators,
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
