#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import { buildDocs, DOCS_LOCALES } from "./docs-index.mjs";
import { docsRoot, readDocsProject } from "./docs-project.mjs";
export { buildDocs, componentFile } from "./docs-index.mjs";

export function readSite(siteDir) {
  const json = (path) => JSON.parse(readFileSync(join(siteDir, path), "utf8"));
  const seeds = {},
    catalogs = {};
  for (const [locale, suffix] of Object.entries(DOCS_LOCALES)) {
    seeds[locale] = json(`public/seed${suffix}.json`);
    catalogs[locale] = json(`public/catalog${suffix}.json`);
  }
  return { seeds, catalogs, site: json("web/docs-site.json") };
}

function existingFiles(dir) {
  const found = [];
  const walk = (folder) => {
    let names;
    try {
      names = readdirSync(folder);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const name of names) {
      const path = join(folder, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error(`Unexpected symlink in the snapshot: ${path}`);
      if (stat.isDirectory()) walk(path);
      else found.push(relative(dir, path).split("\\").join("/"));
    }
  };
  walk(dir);
  return found;
}

export function compareDocs(files, dir) {
  const differences = [];
  for (const [path, content] of files) {
    let current = null;
    try {
      current = readFileSync(join(dir, path), "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (current !== content)
      differences.push(
        current === null ? `missing ${path}` : `changed ${path}`,
      );
  }
  for (const path of existingFiles(dir))
    if (!files.has(path)) differences.push(`extra ${path}`);
  return differences;
}

export function writeDocs(files, dir) {
  const previous = existingFiles(dir);
  for (const path of previous) {
    if (
      path !== "manifest.json" &&
      !/^(en|zh-CN)\/(pages|components)\/[^/]+\.json$/.test(path)
    )
      throw new Error(
        `The export directory contains a file outside the documentation snapshot: ${path}`,
      );
  }
  for (const path of previous) if (!files.has(path)) rmSync(join(dir, path));
  for (const [path, content] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    return index < 0 ? undefined : argv[index + 1];
  };
  const site = option("--site");
  if (!site)
    throw new Error(
      "Usage: node scripts/sync-docs.mjs --site <ShowAI_Homepage/site> [--check] [--out DIR]",
    );
  const destination = option("--out");
  const files = buildDocs(readSite(resolve(site)));
  if (!destination) {
    if (!argv.includes("--check"))
      throw new Error(
        "Edit the native projects in resources/docs. Use --check to compare the website snapshot or --out DIR to export a separate copy.",
      );
    const local = buildDocs(readDocsProject(docsRoot, false));
    const paths = new Set([...local.keys(), ...files.keys()]);
    const differences = [...paths].filter((path) => {
      const left = local.get(path),
        right = files.get(path);
      return (
        !left ||
        !right ||
        !isDeepStrictEqual(JSON.parse(left), JSON.parse(right))
      );
    });
    if (differences.length)
      throw new Error(
        `The website snapshot differs from the App documentation: ${differences.join(", ")}`,
      );
    console.log(
      `Built-in documentation matches the website (${files.size} files).`,
    );
    return;
  }
  function resolvedDestination(path) {
    return existsSync(path)
      ? realpathSync(path)
      : join(resolvedDestination(dirname(path)), basename(path));
  }
  const out = resolvedDestination(resolve(destination));
  const source = realpathSync(docsRoot);
  if (
    out === source ||
    source.startsWith(out + sep) ||
    out.startsWith(source + sep)
  )
    throw new Error(
      "Choose an export directory outside the editable documentation project.",
    );
  if (argv.includes("--check")) {
    const differences = compareDocs(files, out);
    if (differences.length) throw new Error(differences.join("\n"));
  } else {
    writeDocs(files, out);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  main(process.argv.slice(2));
