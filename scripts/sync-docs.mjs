#!/usr/bin/env node
// The App ships the documentation published at showai.renaissancemind.ai/doc. The website is the
// source: this copies its documentation pages and their compiled components into resources/docs.
//   node scripts/sync-docs.mjs --site <ShowAI_Homepage/site>           write resources/docs
//   node scripts/sync-docs.mjs --site <ShowAI_Homepage/site> --check   fail when the App copy differs
// The homepage release runs --check against the ShowAI commit it deploys, so the two never diverge.
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DOCS_ORIGIN = "https://showai.renaissancemind.ai";
/** App locale → suffix of the website's seed and catalog files. */
export const DOCS_LOCALES = { "zh-CN": "", en: ".en" };

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** `doc-hero:1.0.0:sha256-<hex>` → `doc-hero@1.0.0-<12 hex>.json`; ids and versions never contain `:`. */
export function componentFile(key) {
  const [id, version, integrity = ""] = key.split(":");
  const digest = integrity.replace(/^sha256-/, "");
  if (!id || !version || !/^[0-9a-f]{64}$/.test(digest))
    throw new Error(`Unexpected component reference: ${key}`);
  return `${id}@${version}-${digest.slice(0, 12)}.json`;
}

/**
 * The documentation tree of one language: the website's docs pages (docs-site.json) in the order and
 * folders of its "ShowAI 文档" project. Other pages of that project, such as the launch article, are
 * website content and stay out.
 */
function localeDocs(locale, seed, catalog, site, files) {
  const project = seed.projects?.[site.projectId];
  if (!project)
    throw new Error(
      `The ${locale} seed has no documentation project ${site.projectId}.`,
    );
  const wanted = new Set(Object.values(site.pages));
  const pages = new Map();
  for (const [key, record] of Object.entries(seed.pages ?? {})) {
    const [projectId, pageId] = key.split("/");
    if (
      projectId !== site.projectId ||
      !wanted.has(pageId) ||
      record.document?.archived
    )
      continue;
    pages.set(pageId, record);
  }
  const missing = [...wanted].filter((id) => !pages.has(id));
  if (missing.length)
    throw new Error(
      `The ${locale} seed is missing documentation pages: ${missing.join(", ")}`,
    );
  const folders = (project.folders ?? []).filter((folder) => !folder.archived);
  const entryOrder = seed.sidebar?.entryOrder?.[site.projectId] ?? [];
  const position = (order, id) => {
    const index = order.indexOf(id);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const children = (parentId) => {
    const parent = folders.find((folder) => folder.id === parentId);
    const order =
      parent?.sortBy === "manual" && parent.manualOrder
        ? parent.manualOrder
        : entryOrder;
    const items = [
      ...folders
        .filter((folder) => (folder.parentId ?? null) === parentId)
        .map((folder) => ({
          type: "folder",
          id: folder.id,
          title: folder.name,
        })),
      ...[...pages.values()]
        .filter((record) => (record.document.parentId ?? null) === parentId)
        .map((record) => ({
          type: "page",
          id: record.document.id,
          title: record.document.title,
        })),
    ].sort(
      (a, b) =>
        position(order, a.id) - position(order, b.id) ||
        position(entryOrder, a.id) - position(entryOrder, b.id) ||
        a.title.localeCompare(b.title),
    );
    return items.flatMap((item) => {
      if (item.type === "page") return [{ type: "page", id: item.id }];
      const nested = children(item.id);
      const folder = folders.find((entry) => entry.id === item.id);
      return nested.length
        ? [
            {
              type: "folder",
              id: item.id,
              name: folder.name,
              ...(folder.icon ? { icon: folder.icon } : {}),
              children: nested,
            },
          ]
        : [];
    });
  };
  const tree = children(null);
  const placed = new Set();
  const visit = (entries) =>
    entries.forEach((entry) =>
      entry.type === "page" ? placed.add(entry.id) : visit(entry.children),
    );
  visit(tree);
  const orphaned = [...pages.keys()].filter((id) => !placed.has(id));
  if (orphaned.length)
    throw new Error(
      `Documentation pages sit in archived or missing folders: ${orphaned.join(", ")}`,
    );

  const meta = {};
  for (const [pageId, record] of pages) {
    const components = (record.componentKeys ?? []).map((key) => {
      const component = catalog.components?.[key];
      if (!component)
        throw new Error(
          `The ${locale} catalog has no component ${key} used by ${record.document.title}.`,
        );
      const file = `${locale}/components/${componentFile(key)}`;
      files.set(file, JSON.stringify(component));
      return file;
    });
    const page = JSON.stringify(record.document);
    const file = `${locale}/pages/${pageId}.json`;
    files.set(file, page);
    meta[pageId] = {
      title: record.document.title,
      icon: record.document.icon ?? "",
      file,
      sha256: sha256(page),
      components,
    };
  }
  return { name: project.name, icon: project.icon ?? "", tree, pages: meta };
}

/** Every file of resources/docs, keyed by its path relative to that directory. */
export function buildDocs({ seeds, catalogs, site }) {
  if (!site?.projectId || !site.pages || site.pages[""] === undefined)
    throw new Error(
      "docs-site.json needs a projectId and a page for the empty slug.",
    );
  const files = new Map();
  const locales = {};
  for (const locale of Object.keys(DOCS_LOCALES))
    locales[locale] = localeDocs(
      locale,
      seeds[locale],
      catalogs[locale],
      site,
      files,
    );
  const manifest = {
    format: "showai-docs",
    version: 1,
    origin: DOCS_ORIGIN,
    projectId: site.projectId,
    slugs: site.pages,
    locales,
  };
  files.set("manifest.json", JSON.stringify(manifest, null, 1) + "\n");
  return files;
}

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
      if (statSync(path).isDirectory()) walk(path);
      else found.push(relative(dir, path).split("\\").join("/"));
    }
  };
  walk(dir);
  return found;
}

/** Paths whose content differs, is missing or no longer belongs in `dir`. */
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
  rmSync(dir, { recursive: true, force: true });
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const out = resolve(option("--out") ?? join(root, "resources/docs"));
  const files = buildDocs(readSite(resolve(site)));
  if (argv.includes("--check")) {
    const differences = compareDocs(files, out);
    if (differences.length) {
      console.error(
        `The App's built-in documentation differs from the website (${differences.length} files):`,
      );
      for (const line of differences.slice(0, 20)) console.error(`  ${line}`);
      console.error(
        `Run node scripts/sync-docs.mjs --site ${site} in the ShowAI checkout, commit resources/docs, and deploy against that commit.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `Built-in documentation matches the website (${files.size} files).`,
    );
    return;
  }
  writeDocs(files, out);
  console.log(
    `Wrote ${files.size} documentation files to ${relative(process.cwd(), out) || "."}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2));
