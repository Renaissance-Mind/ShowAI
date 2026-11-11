import { newDocument } from "../../lib/document";
import { parseMarkdown } from "../../lib/markdown";
import { parseArtifact } from "../../portable/validation.mjs";
import { htmlArtifactSource } from "./html-artifact";
import type { ImportBundle, Importer } from "./types";

// Markdown, plain text and ShowAI's own HTML/JSON page exports: each file
// becomes one page, as the workbench's import has always done. A Markdown
// page is a document whose content is the parsed Markdown; an export keeps
// its document and bundled components.

export const PAGE_FILE_LIMIT = 20 * 1024 * 1024;
const EXTENSIONS = [".json", ".html", ".htm", ".md", ".markdown", ".txt"];
const extension = (path: string) =>
  /\.[^./]+$/.exec(path)?.[0]?.toLowerCase() ?? "";
const stem = (path: string) =>
  (path.split("/").at(-1) ?? path).replace(/\.[^.]+$/, "");

export const markdownImporter: Importer = {
  id: "markdown",
  name: "Markdown",
  description:
    "Markdown, plain text and ShowAI page exports (.html, .showai.json); one page per file.",
  extensions: EXTENSIONS,
  folders: false,
  origin: "builtin",
  async detect(input) {
    if (input.kind !== "file" && input.kind !== "files") return 0;
    return input.files.length &&
      input.files.every((file) => EXTENSIONS.includes(extension(file.path)))
      ? 0.5
      : 0;
  },
  async convert(input) {
    const bundle: ImportBundle = { pages: [], warnings: [] };
    for (const file of input.files) {
      if (file.size > PAGE_FILE_LIMIT)
        throw new Error(
          `${file.path} exceeds ${PAGE_FILE_LIMIT / 1024 / 1024} MB.`,
        );
      const content = await file.text();
      const type = extension(file.path);
      if ([".md", ".markdown", ".txt"].includes(type)) {
        const document = newDocument(stem(file.path));
        document.content = parseMarkdown(content);
        bundle.pages.push({
          key: file.path,
          title: document.title,
          source: file.path,
          artifact: { format: "showai", version: 1, document },
        });
        continue;
      }
      const artifact = parseArtifact(
        type === ".json" ? content : htmlArtifactSource(content),
      );
      bundle.pages.push({
        key: file.path,
        title: artifact.document.title,
        source: file.path,
        artifact,
      });
    }
    return bundle;
  },
};
