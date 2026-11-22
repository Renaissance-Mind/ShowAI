import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { walkComponentReferences } from "../src/document/walk.mjs";
import {
  sourceDigest,
  SOURCE_EXTENSIONS,
} from "../src/core/component-source-digest.mjs";
import { parseArtifactConsumingDocument } from "../src/portable/validation.mjs";
import { buildDocs, DOCS_LOCALES } from "./docs-index.mjs";

export const docsRoot = fileURLToPath(
  new URL("../resources/docs/", import.meta.url),
);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function checkPackageSource(directory, expected) {
  const files = new Map();
  const visit = (folder) => {
    for (const entry of readdirSync(join(directory, folder), {
      withFileTypes: true,
    })) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "compiled.json" ||
        entry.name === "node_modules"
      )
        continue;
      const name = folder ? folder + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink())
        throw new Error(
          `Component source must be a regular file: ${join(directory, name)}`,
        );
      if (entry.isDirectory()) visit(name);
      else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(extname(name).toLowerCase())
      )
        files.set(name, readFileSync(join(directory, name)));
    }
  };
  visit("");
  if (
    !files.has("manifest.json") ||
    !files.has("props.schema.json") ||
    sourceDigest(files) !== expected
  )
    throw new Error(
      `Component source differs from its saved version in ${directory}. Save a new component version and update the page references.`,
    );
}

export function readDocsProject(root = docsRoot, nativePaths = true) {
  const { origin, projectId, slugs } = json(join(root, "routes.json"));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectId))
    throw new Error("The documentation project ID is invalid.");
  const site = { origin, projectId, pages: slugs };
  const seeds = {},
    catalogs = {};
  for (const locale of Object.keys(DOCS_LOCALES)) {
    const directory = `${locale}/projects/${projectId}`;
    const project = json(join(root, directory, "project.json"));
    if (project.id !== projectId || project.archived)
      throw new Error(`Expected active project ${projectId} in ${directory}.`);
    const sidebar = json(join(root, locale, "sidebar.json"));
    const pages = {},
      components = {},
      sourceFiles = {},
      packages = new Map();
    for (const entry of readdirSync(join(root, directory, "pages"), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const sourceFile = `${directory}/pages/${entry.name}`;
      const { document } = parseArtifactConsumingDocument(
        json(join(root, sourceFile)),
      );
      if (entry.name !== document.id + ".json")
        throw new Error(`Page ID differs from its filename: ${sourceFile}`);
      if (document.archived) continue;
      const componentKeys = new Set();
      walkComponentReferences(document.content, (ref) => {
        if (
          !/^[a-z][a-z0-9-]*$/.test(ref.componentId) ||
          !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(ref.version)
        )
          throw new Error(`Invalid component reference in ${sourceFile}.`);
        const file = `${directory}/packages/components/${ref.componentId}/${ref.version}/compiled.json`;
        if (!packages.has(file)) {
          const { sourceIntegrity, ...item } = json(join(root, file));
          if (
            !sourceIntegrity ||
            item.id !== ref.componentId ||
            item.version !== ref.version
          )
            throw new Error(`Invalid component package: ${file}`);
          checkPackageSource(dirname(join(root, file)), sourceIntegrity);
          packages.set(file, item);
        }
        const item = packages.get(file);
        if (ref.integrity && ref.integrity !== item.integrity)
          throw new Error(
            `Component fingerprint mismatch in ${sourceFile}: ${file}`,
          );
        const key = [item.id, item.version, item.integrity].join(":");
        components[key] = item;
        if (nativePaths) sourceFiles[key] = file;
        componentKeys.add(key);
      });
      pages[`${projectId}/${document.id}`] = {
        document,
        componentKeys: [...componentKeys],
        ...(nativePaths && { sourceFile }),
      };
    }
    seeds[locale] = { projects: { [projectId]: project }, sidebar, pages };
    catalogs[locale] = { components, sourceFiles };
  }
  return { seeds, catalogs, site };
}

function updateGeneratedFile(file, content, check) {
  if (existsSync(file) && readFileSync(file, "utf8") === content) return;
  if (check)
    throw new Error(
      `The built-in documentation index is out of date: ${file}. Run npm run docs:build.`,
    );
  const temporary = join(dirname(file), `.docs-index-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function refreshDocsIndex(root = docsRoot, check = false) {
  const index = buildDocs(readDocsProject(root)).get("manifest.json");
  const paths = new Set();
  for (const locale of Object.values(JSON.parse(index).locales)) {
    for (const page of Object.values(locale.pages)) {
      paths.add("./" + page.file);
      for (const component of page.components) paths.add("./" + component);
    }
  }
  const entries = [...paths]
    .sort()
    .map((path) => "    " + JSON.stringify(path) + ",");
  const loaders = [
    "export const files = import.meta.glob<unknown>(",
    "  [",
    ...entries,
    "  ],",
    '  { import: "default" },',
    ");",
    "",
  ].join("\n");
  updateGeneratedFile(join(root, "files.ts"), loaders, check);
  updateGeneratedFile(join(root, "manifest.json"), index, check);
}

export function docsIndexPlugin() {
  return {
    name: "showai-docs-index",
    buildStart() {
      refreshDocsIndex();
    },
    configureServer(server) {
      const update = (_event, file) => {
        const name = relative(docsRoot, file).split(sep).join("/");
        if (
          !/^(routes\.json|(?:en|zh-CN)\/(?:sidebar\.json|projects\/[^/]+\/(?:project\.json|pages\/[^/]+\.json|packages\/components\/[^/]+\/[^/]+\/compiled\.json)))$/.test(
            name,
          )
        )
          return;
        try {
          refreshDocsIndex();
        } catch (error) {
          server.config.logger.error(error.message);
          server.ws.send({
            type: "error",
            err: { message: error.message, stack: error.stack },
          });
        }
      };
      server.watcher.on("all", update);
      server.httpServer?.once("close", () => server.watcher.off("all", update));
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  refreshDocsIndex(docsRoot, process.argv.includes("--check"));
  console.log("Built-in documentation index is current.");
}
