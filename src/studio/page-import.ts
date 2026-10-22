import { parseArtifact } from "../lib/artifact";
import type { ShowArtifact } from "../types";
import { newDocument } from "../lib/document";
import { parseMarkdown } from "../lib/markdown";

/** Same extensions as the import file dialog; dropped files follow the same rule. */
export const IMPORTABLE_PAGE_EXTENSIONS = [
  "json",
  "html",
  "htm",
  "md",
  "markdown",
  "txt",
] as const;
export const IMPORT_SIZE_LIMIT = 20 * 1024 * 1024;

export function isImportablePageFile(name: string) {
  const extension = name.split(".").at(-1)?.toLowerCase();
  return (
    name.includes(".") &&
    (IMPORTABLE_PAGE_EXTENSIONS as readonly string[]).includes(extension ?? "")
  );
}

/** The page source embedded by an HTML export (`showai-data` or a `showai-*-data` script). */
export function htmlArtifactSource(html: string): string {
  const scripts = html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
  );
  let fallback = "";
  for (const [, attributes, body] of scripts) {
    const id = /\bid\s*=\s*["']?([^"'\s>]+)/i.exec(attributes)?.[1];
    if (id === "showai-data") return body;
    if (!fallback && id && /^showai-.+-data$/.test(id)) fallback = body;
  }
  return fallback;
}

/** Turns an imported file into a page artifact; Markdown and text become a new page. */
export function importedArtifact(file: {
  name: string;
  content: string;
}): ShowArtifact {
  if (/\.(md|markdown|txt)$/i.test(file.name)) {
    const document = newDocument(file.name.replace(/\.[^.]+$/, ""));
    document.content = parseMarkdown(file.content);
    return { format: "showai", version: 1, document };
  }
  if (/\.html?$/i.test(file.name))
    return parseArtifact(htmlArtifactSource(file.content));
  return parseArtifact(file.content);
}
