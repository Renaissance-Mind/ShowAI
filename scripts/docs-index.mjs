import { createHash } from "node:crypto";

export const DOCS_ORIGIN = "https://showai.renaissancemind.ai";
export const DOCS_LOCALES = { "zh-CN": "", en: ".en" };

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function componentFile(key) {
  const [id, version, integrity = ""] = key.split(":");
  const digest = integrity.replace(/^sha256-/, "");
  if (!id || !version || !/^[0-9a-f]{64}$/.test(digest))
    throw new Error(`Unexpected component reference: ${key}`);
  return `${id}@${version}-${digest.slice(0, 12)}.json`;
}

function localeDocs(locale, seed, catalog, site, files) {
  const project = seed.projects?.[site.projectId];
  if (!project)
    throw new Error(
      `The ${locale} seed has no documentation project ${site.projectId}.`,
    );
  const excluded = new Set(site.appExclude ?? []);
  const pages = new Map();
  for (const [key, record] of Object.entries(seed.pages ?? {})) {
    const [projectId, pageId] = key.split("/");
    if (
      projectId !== site.projectId ||
      excluded.has(pageId) ||
      record.document?.archived
    )
      continue;
    pages.set(pageId, record);
  }
  const missing = Object.values(site.pages).filter((id) => !pages.has(id));
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
    const parent = parentId
      ? folders.find((folder) => folder.id === parentId)
      : project;
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
      const file =
        catalog.sourceFiles?.[key] ??
        `${locale}/components/${componentFile(key)}`;
      if (!files.has(file)) files.set(file, JSON.stringify(component));
      return file;
    });
    const page = JSON.stringify(record.document);
    const file = record.sourceFile ?? `${locale}/pages/${pageId}.json`;
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
    origin: site.origin ?? DOCS_ORIGIN,
    projectId: site.projectId,
    slugs: site.pages,
    locales,
  };
  files.set("manifest.json", JSON.stringify(manifest, null, 1) + "\n");
  return files;
}
