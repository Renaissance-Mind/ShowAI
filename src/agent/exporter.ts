import {
  access,
  lstat,
  realpath,
  rm,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { FileStore } from "../core/store";
import { resolveDocumentComponents } from "../core/catalog";
import type { CompiledComponent } from "../components/custom/types";
import { assertOfflineImages } from "../portable/assets.mjs";
import { toInlineFragment } from "../portable/inline.mjs";
import {
  injectArtifactIntoHtml,
  serializeArtifact,
} from "../portable/validation.mjs";
import type { ShowDocument } from "../types";

export type ExportFormat = "html" | "inline" | "site";
export interface ExportOptions {
  root?: string;
  projectId: string;
  pageId?: string;
  format: ExportFormat;
  out: string;
  templatePath?: string;
  overwrite?: boolean;
}
export interface ExportResult {
  format: ExportFormat;
  projectId: string;
  pageIds: string[];
  path: string;
  sourcePaths: string[];
  bytes: number;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}

export async function findViewerTemplate(explicit?: string): Promise<string> {
  const directory = dirname(fileURLToPath(import.meta.url));
  const candidates = explicit
    ? [resolve(explicit)]
    : [
        ...(process.env.SHOWAI_VIEWER
          ? [resolve(process.env.SHOWAI_VIEWER)]
          : []),
        resolve(directory, "../assets/viewer.html"),
        resolve(directory, "../dist-portable/portable.html"),
        resolve(directory, "../../dist-portable/portable.html"),
      ];
  for (const candidate of candidates)
    if (await exists(candidate)) return candidate;
  throw new Error(
    "The ShowAI viewer is missing. Build the application first or set SHOWAI_VIEWER to the bundled viewer.html.",
  );
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export async function buildPageHtml(
  document: ShowDocument,
  templatePath?: string,
  components: CompiledComponent[] = [],
): Promise<string> {
  assertOfflineImages(document);
  return injectArtifactIntoHtml(
    await readFile(await findViewerTemplate(templatePath), "utf8"),
    document,
    components,
  );
}

async function assertDestination(
  path: string,
  overwrite: boolean,
): Promise<void> {
  if (!overwrite && (await exists(path)))
    throw new Error(
      `Output already exists: ${path}. Choose another path or pass --overwrite.`,
    );
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

async function effectivePath(path: string): Promise<string> {
  let parent = resolve(path);
  const suffix: string[] = [];
  for (;;) {
    const found = await lstat(parent).then(
      () => true,
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (found) return join(await realpath(parent), ...suffix);
    const next = dirname(parent);
    if (next === parent)
      throw new Error("Unable to resolve export destination.");
    suffix.unshift(relative(next, parent));
    parent = next;
  }
}

/** Allows the selected project's exports folder, while resolving aliases and symlinks. */
export async function assertExportDestination(
  root: string,
  projectId: string,
  path: string,
): Promise<void> {
  const store = new FileStore(root);
  const projects = join(store.root, "projects");
  const allowed = join(store.projectPath(projectId), "exports");
  const target = resolve(path);
  if (isInside(projects, target) && !isInside(allowed, target))
    throw new Error(
      "Export outside project sources or into this project's exports directory.",
    );
  const actualProjects = await effectivePath(projects);
  const actualTarget = await effectivePath(target);
  // Keep the permitted location lexical relative to the real projects root: an
  // exports symlink must not redefine what belongs to the export subtree.
  const actualAllowed = join(actualProjects, projectId, "exports");
  if (
    isInside(actualProjects, actualTarget) &&
    !isInside(actualAllowed, actualTarget)
  )
    throw new Error(
      "Export destination resolves to protected project sources or another project's exports.",
    );
  if (isInside(allowed, target)) {
    const actualProject = await effectivePath(store.projectPath(projectId));
    if (!isInside(join(actualProject, "exports"), actualTarget))
      throw new Error(
        "The project's exports directory cannot redirect through a symbolic link.",
      );
  }
}

/** Produces deliverables from a stored project; never changes its authoring source. */
export async function exportPage(
  options: ExportOptions,
): Promise<ExportResult> {
  const store = new FileStore(options.root);
  const out = resolve(options.out);
  await assertExportDestination(store.root, options.projectId, out);
  if (options.format !== "site") {
    if (!options.pageId)
      throw new Error("A page id is required for html or inline export.");
    const { document } = await store.readPage(
      options.projectId,
      options.pageId,
      { checkpoint: false },
    );
    const components = await resolveDocumentComponents(
      store.root,
      document,
      options.projectId,
    );
    const html = await buildPageHtml(
      document,
      options.templatePath,
      components,
    );
    const result = options.format === "inline" ? toInlineFragment(html) : html;
    const sourcePath =
      out.slice(0, out.length - extname(out).length) + ".showai.json";
    if (sourcePath === out)
      throw new Error(
        "Choose an .html output path; source JSON is saved alongside it.",
      );
    await assertDestination(out, !!options.overwrite);
    await assertExportDestination(store.root, options.projectId, sourcePath);
    await assertDestination(sourcePath, !!options.overwrite);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(sourcePath, serializeArtifact(document, components), {
      flag: options.overwrite ? "w" : "wx",
    });
    await writeFile(out, result, { flag: options.overwrite ? "w" : "wx" });
    return {
      format: options.format,
      projectId: options.projectId,
      pageIds: [document.id],
      path: out,
      sourcePaths: [sourcePath],
      bytes: Buffer.byteLength(result),
    };
  }

  const pages = await store.listPages(options.projectId, {
    includeArchived: false,
  });
  if (!pages.length) throw new Error("This project has no pages to export.");
  const selected = options.pageId
    ? pages.filter((page) => page.id === options.pageId)
    : pages;
  if (!selected.length)
    throw new Error(`Page not found in this project: ${options.pageId}`);
  const records = await Promise.all(
    selected.map((page) =>
      store.readPage(options.projectId, page.id, { checkpoint: false }),
    ),
  );
  const template = await readFile(
    await findViewerTemplate(options.templatePath),
    "utf8",
  );
  const documents = records
    .map((record) => record.document)
    .filter((document) => options.pageId || !document.archived);
  if (!documents.length)
    throw new Error("This project has no active pages to export.");
  for (const document of documents) assertOfflineImages(document);
  const pageComponents = await Promise.all(
    documents.map((document) =>
      resolveDocumentComponents(store.root, document, options.projectId),
    ),
  );
  let previousRoutes: { id: string; file: string }[] = [];
  if (await exists(out)) {
    if (!(await stat(out)).isDirectory())
      throw new Error("Site output must be a directory.");
    const entries = await readdir(out);
    if (
      entries.length &&
      (!options.overwrite || !(await exists(join(out, "showai-site.json"))))
    )
      throw new Error(
        "Site output must be empty, or a ShowAI site with --overwrite enabled.",
      );
    if (entries.length) {
      const previous = JSON.parse(
        await readFile(join(out, "showai-site.json"), "utf8"),
      );
      if (
        previous.format !== "showai-site" ||
        previous.version !== 1 ||
        previous.projectId !== options.projectId ||
        !Array.isArray(previous.pages) ||
        previous.pages.some(
          (page: { id?: unknown; file?: unknown }) =>
            typeof page.id !== "string" ||
            typeof page.file !== "string" ||
            !/^(?:index|[a-zA-Z0-9_%.-]+)\.html$/.test(page.file),
        )
      )
        throw new Error(
          "Cannot overwrite a site without a valid matching ShowAI manifest.",
        );
      previousRoutes = previous.pages;
    }
  }
  const routes = documents.map((document, index) => ({
    id: document.id,
    title: document.title || "Untitled",
    file:
      index === 0 ? "index.html" : `${encodeURIComponent(document.id)}.html`,
  }));
  const destinations = [
    "assets/viewer.js",
    "assets/viewer.css",
    "showai-site.json",
    ...routes.map((route) => route.file),
    ...routes.map(
      (route) => `sources/${encodeURIComponent(route.id)}.showai.json`,
    ),
    ...previousRoutes.map((route) => route.file),
    ...previousRoutes.map(
      (route) => `sources/${encodeURIComponent(route.id)}.showai.json`,
    ),
  ];
  for (const path of destinations)
    await assertExportDestination(
      store.root,
      options.projectId,
      join(out, path),
    );
  await mkdir(join(out, "assets"), { recursive: true });
  await mkdir(join(out, "sources"), { recursive: true });
  const sourcePaths: string[] = [];
  let bytes = 0;
  for (const [index, document] of documents.entries()) {
    const components = pageComponents[index];
    let html = injectArtifactIntoHtml(template, document, components);
    // Each page shares one reader bundle and stylesheet; page data remains embedded.
    const scripts: string[] = [];
    html = html.replace(
      /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
      (tag, attributes: string, code: string) => {
        if (!/type=["']module["']/.test(attributes)) return tag;
        scripts.push(code);
        return scripts.length === 1
          ? '<script type="module" src="./assets/viewer.js"></script>'
          : "";
      },
    );
    const styles: string[] = [];
    html = html.replace(
      /<style\b[^>]*>([\s\S]*?)<\/style>/gi,
      (_tag, css: string) => {
        styles.push(css);
        return styles.length === 1
          ? '<link rel="stylesheet" href="./assets/viewer.css">'
          : "";
      },
    );
    if (!scripts.length || !styles.length)
      throw new Error(
        "Site export requires a built viewer with inline scripts and styles.",
      );
    if (index === 0) {
      const code = scripts.join("\n");
      const css =
        styles.join("\n") +
        '\n.showai-site-nav{display:flex;flex-wrap:wrap;gap:8px 20px;padding:18px max(24px,calc((100vw - 920px)/2));padding-right:max(64px,calc((100vw - 920px)/2));border-bottom:1px solid #8883;font:14px system-ui}.showai-site-nav a{color:inherit;text-decoration:none;opacity:.65;max-width:100%;overflow-wrap:anywhere}.showai-site-nav a[aria-current="page"]{opacity:1;font-weight:650}.showai-site-nav a:hover{text-decoration:underline}@media print{.showai-site-nav{display:none}}';
      await writeFile(join(out, "assets/viewer.js"), code);
      await writeFile(join(out, "assets/viewer.css"), css);
      bytes += Buffer.byteLength(code) + Buffer.byteLength(css);
    }
    if (documents.length > 1) {
      const navigation = `<nav class="showai-site-nav" aria-label="Site pages">${routes.map((route, routeIndex) => `<a href="./${escapeHtml(route.file)}"${index === routeIndex ? ' aria-current="page"' : ""}>${escapeHtml(route.title)}</a>`).join("")}</nav>`;
      html = html.replace(/<body\b[^>]*>/i, (tag) => tag + navigation);
    }
    await writeFile(join(out, routes[index].file), html);
    const sourcePath = join(
      out,
      "sources",
      `${encodeURIComponent(document.id)}.showai.json`,
    );
    await writeFile(sourcePath, serializeArtifact(document, components));
    sourcePaths.push(sourcePath);
    bytes += Buffer.byteLength(html);
  }
  for (const previous of previousRoutes) {
    if (!routes.some((route) => route.file === previous.file))
      await rm(join(out, previous.file), { force: true });
    if (!routes.some((route) => route.id === previous.id))
      await rm(
        join(out, "sources", `${encodeURIComponent(previous.id)}.showai.json`),
        { force: true },
      );
  }
  await writeFile(
    join(out, "showai-site.json"),
    JSON.stringify(
      {
        format: "showai-site",
        version: 1,
        projectId: options.projectId,
        pages: routes,
      },
      null,
      2,
    ) + "\n",
  );
  return {
    format: "site",
    projectId: options.projectId,
    pageIds: documents.map((document) => document.id),
    path: join(out, "index.html"),
    sourcePaths,
    bytes,
  };
}
