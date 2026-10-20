import manifest from "../../resources/docs/manifest.json";
import type { CompiledComponent } from "../components/custom/types";
import type { Locale } from "../i18n";
import type { ShowDocument } from "../types";

/**
 * The documentation published at showai.renaissancemind.ai/doc, shipped with the App
 * (resources/docs, written by scripts/sync-docs.mjs). Pages are read-only and live outside
 * the content library; each file is its own lazy chunk.
 */
export type DocsEntry =
  | { type: "page"; id: string }
  | {
      type: "folder";
      id: string;
      name: string;
      icon?: string;
      children: DocsEntry[];
    };

interface DocsLocale {
  name: string;
  icon: string;
  tree: DocsEntry[];
  pages: Record<
    string,
    { title: string; icon: string; file: string; components: string[] }
  >;
}

const docs = manifest as {
  origin: string;
  slugs: Record<string, string>;
  locales: Record<Locale, DocsLocale>;
};

/** The App's first-run screen, listed first among the documentation. */
export const WELCOME_DOC = "welcome";
/** The documentation's own front page (/doc). */
export const DOCS_HOME = docs.slugs[""];
export const DOCS_VISIBLE_KEY = "showai:builtin-docs";

const files = import.meta.glob<string>("../../resources/docs/*/*/*.json", {
  query: "?raw",
  import: "default",
});
const components = new Map<string, Promise<CompiledComponent>>();

function read(file: string) {
  const load = files[`../../resources/docs/${file}`];
  if (!load) throw new Error(`The App is missing documentation file ${file}.`);
  return load().then((text) => JSON.parse(text));
}

export function builtinDocs(locale: Locale): DocsLocale {
  return docs.locales[locale] ?? docs.locales["zh-CN"];
}

/** Folders that contain the page, outermost first; undefined when the page is not documentation. */
export function builtinDocPath(locale: Locale, id: string) {
  const search = (
    entries: DocsEntry[],
    folders: Extract<DocsEntry, { type: "folder" }>[],
  ): Extract<DocsEntry, { type: "folder" }>[] | undefined => {
    for (const entry of entries) {
      if (entry.type === "page") {
        if (entry.id === id) return folders;
      } else {
        const found = search(entry.children, [...folders, entry]);
        if (found) return found;
      }
    }
  };
  return search(builtinDocs(locale).tree, []);
}

export async function loadBuiltinDoc(
  locale: Locale,
  id: string,
): Promise<{ document: ShowDocument; components: CompiledComponent[] }> {
  const page = builtinDocs(locale).pages[id];
  if (!page) throw new Error(`No documentation page ${id}.`);
  const [document, compiled] = await Promise.all([
    read(page.file) as Promise<ShowDocument>,
    Promise.all(
      page.components.map((file) => {
        let component = components.get(file);
        if (!component) {
          component = read(file);
          components.set(file, component);
          component.catch(() => components.delete(file));
        }
        return component;
      }),
    ),
  ]);
  return { document, components: compiled };
}

/** A link to the website's documentation (/doc/<slug>, optionally under a language prefix). */
export function builtinDocLink(
  href: string,
): { pageId: string; hash: string } | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return;
  }
  if (url.origin !== docs.origin) return;
  const match = /^(?:\/(?:zh|en))?\/docs?(?:\/([a-z0-9-]+))?\/?$/i.exec(
    url.pathname,
  );
  if (!match) return;
  const pageId = docs.slugs[(match[1] ?? "").toLowerCase()];
  return pageId ? { pageId, hash: url.hash } : undefined;
}

/** An App preference (Settings → General), shown unless the person turned it off. */
export function readDocsVisible() {
  return localStorage.getItem(DOCS_VISIBLE_KEY) !== "hidden";
}
