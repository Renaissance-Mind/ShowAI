import type { JSONContent } from "@tiptap/core";
import { CAPACITY } from "../../portable/capacity.mjs";
import { NOTE_MAX } from "../../components/blocks/note-markup.mjs";
import { CoreError } from "../model";
import { bufferAccess, readZipEntry, zipEntries, type ZipEntry } from "./zip";
import {
  child,
  descendants,
  elements,
  parseXml,
  textOf,
  type XmlElement,
} from "./xml";
import type {
  ImportBlock,
  ImportBundle,
  ImportWarning,
  Importer,
} from "./types";

// Word documents (.docx): headings, paragraphs, character formatting, links,
// nested lists, tables with merged cells, images and footnotes become rich
// text and image components. Page breaks carry no meaning on a page and are
// left out; comments are not page content and are reported.

/** Most nodes one rich text block holds (its contract allows 12,000). */
const NODES_PER_BLOCK = 8000;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const MONOSPACE = /courier|consolas|menlo|monaco|mono|source code/i;

type Mark = NonNullable<JSONContent["marks"]>[number];

interface Context {
  parts: Map<string, ZipEntry>;
  read(path: string): Promise<Uint8Array | undefined>;
  rels: Map<string, { target: string; external: boolean }>;
  headingStyles: Map<string, number>;
  codeStyles: Set<string>;
  titleStyles: Set<string>;
  numbering: Map<string, Map<number, "bullet" | "ordered">>;
  footnotes: Map<string, string>;
  notes: { marker: string; text: string }[];
  warnings: ImportWarning[];
  source: string;
  imageBytes: number;
  counts: { comments: number; skippedImages: number; textBoxes: number };
}

const on = (element: XmlElement | undefined) =>
  !!element && !["0", "false", "none"].includes(element.attrs["w:val"] ?? "");

function decodeXml(bytes: Uint8Array) {
  return parseXml(new TextDecoder("utf-8").decode(bytes));
}

function marksOf(run: XmlElement, context: Context, link?: string): Mark[] {
  const properties = child(run, "w:rPr");
  const marks: Mark[] = [];
  if (on(child(properties, "w:b"))) marks.push({ type: "bold" });
  if (on(child(properties, "w:i"))) marks.push({ type: "italic" });
  if (on(child(properties, "w:u"))) marks.push({ type: "underline" });
  if (on(child(properties, "w:strike")) || on(child(properties, "w:dstrike")))
    marks.push({ type: "strike" });
  const style = child(properties, "w:rStyle")?.attrs["w:val"];
  const font = child(properties, "w:rFonts")?.attrs["w:ascii"] ?? "";
  if ((style && context.codeStyles.has(style)) || MONOSPACE.test(font))
    marks.push({ type: "code" });
  if (link) marks.push({ type: "link", attrs: { href: link } });
  return marks;
}

function linkTarget(element: XmlElement, context: Context): string | undefined {
  const id = element.attrs["r:id"];
  const relation = id ? context.rels.get(id) : undefined;
  if (
    relation?.external &&
    /^(https?:\/\/|mailto:|tel:)/i.test(relation.target)
  )
    return relation.target;
  return undefined;
}

async function imageNode(
  drawing: XmlElement,
  context: Context,
): Promise<JSONContent | undefined> {
  const blip = descendants(drawing, "a:blip")[0];
  const id = blip?.attrs["r:embed"];
  const alt =
    descendants(drawing, "wp:docPr")[0]?.attrs.descr ??
    descendants(drawing, "wp:docPr")[0]?.attrs.name ??
    "";
  const relation = id ? context.rels.get(id) : undefined;
  if (!relation || relation.external) {
    context.counts.skippedImages++;
    return undefined;
  }
  const path = relation.target.startsWith("/")
    ? relation.target.slice(1)
    : `word/${relation.target}`;
  const type = IMAGE_TYPES[path.split(".").at(-1)?.toLowerCase() ?? ""];
  const bytes = await context.read(path);
  if (!type || !bytes) {
    context.warnings.push({
      source: `${context.source}/${path}`,
      message: type
        ? "The image is missing from the document."
        : "The image format has no web equivalent (PNG, JPEG, GIF and WebP are kept); left out.",
    });
    return undefined;
  }
  if (
    bytes.length > CAPACITY.resourceBytes ||
    context.imageBytes + bytes.length > CAPACITY.pageResourceBytes
  ) {
    context.warnings.push({
      source: `${context.source}/${path}`,
      message: `The image (${bytes.length} bytes) exceeds the resource limit of a page; left out.`,
    });
    return undefined;
  }
  context.imageBytes += bytes.length;
  return {
    type: "image",
    attrs: {
      src: `data:${type};base64,${Buffer.from(bytes).toString("base64")}`,
      alt,
      title: null,
    },
  };
}

/** The inline content of a paragraph; images come back separately. */
async function inline(
  parent: XmlElement,
  context: Context,
  out: JSONContent[],
  images: JSONContent[],
  link?: string,
): Promise<void> {
  for (const node of elements(parent)) {
    switch (node.name) {
      case "w:r": {
        const marks = marksOf(node, context, link);
        for (const part of elements(node)) {
          if (part.name === "w:t" || part.name === "w:delText") {
            if (part.name === "w:delText") continue;
            const text = textOf(part);
            if (text)
              out.push({
                type: "text",
                text,
                ...(marks.length ? { marks } : {}),
              });
          } else if (part.name === "w:tab")
            out.push({
              type: "text",
              text: "\t",
              ...(marks.length ? { marks } : {}),
            });
          else if (part.name === "w:br" || part.name === "w:cr") {
            if (part.attrs["w:type"] !== "page")
              out.push({ type: "hardBreak" });
          } else if (part.name === "w:noBreakHyphen")
            out.push({ type: "text", text: "-" });
          else if (part.name === "w:drawing" || part.name === "w:pict") {
            const boxes = descendants(part, "w:txbxContent");
            for (const box of boxes) {
              context.counts.textBoxes++;
              for (const paragraph of descendants(box, "w:p")) {
                const text = textOf(paragraph).trim();
                if (text)
                  out.push({ type: "hardBreak" }, { type: "text", text });
              }
            }
            if (!boxes.length) {
              const image = await imageNode(part, context);
              if (image) images.push(image);
            }
          } else if (
            part.name === "w:footnoteReference" ||
            part.name === "w:endnoteReference"
          ) {
            const kind = part.name === "w:footnoteReference" ? "f" : "e";
            const text =
              context.footnotes.get(`${kind}${part.attrs["w:id"]}`) ?? "";
            const marker = `[${context.notes.length + 1}]`;
            context.notes.push({ marker, text });
            out.push({
              type: "text",
              text: marker,
              ...(text && text.length <= NOTE_MAX
                ? { marks: [{ type: "annotation", attrs: { note: text } }] }
                : {}),
            });
          } else if (part.name === "w:commentReference")
            context.counts.comments++;
        }
        break;
      }
      case "w:hyperlink":
        await inline(
          node,
          context,
          out,
          images,
          linkTarget(node, context) ?? link,
        );
        break;
      case "w:fldSimple": {
        const url = /HYPERLINK\s+"([^"]+)"/.exec(
          node.attrs["w:instr"] ?? "",
        )?.[1];
        await inline(
          node,
          context,
          out,
          images,
          url && /^(https?:\/\/|mailto:)/i.test(url) ? url : link,
        );
        break;
      }
      case "w:ins":
      case "w:smartTag":
      case "w:customXml":
        await inline(node, context, out, images, link);
        break;
      case "w:sdt":
        await inline(
          child(node, "w:sdtContent") ?? node,
          context,
          out,
          images,
          link,
        );
        break;
      default:
        break;
    }
  }
}

interface Paragraph {
  kind: "paragraph";
  heading?: number;
  title: boolean;
  list?: { level: number; type: "bullet" | "ordered" };
  content: JSONContent[];
  images: JSONContent[];
}

async function paragraph(
  element: XmlElement,
  context: Context,
): Promise<Paragraph> {
  const properties = child(element, "w:pPr");
  const style = child(properties, "w:pStyle")?.attrs["w:val"];
  const outline = child(properties, "w:outlineLvl")?.attrs["w:val"];
  let heading = style ? context.headingStyles.get(style) : undefined;
  if (heading === undefined && outline !== undefined && Number(outline) < 6)
    heading = Number(outline) + 1;
  const numbering = child(properties, "w:numPr");
  const numId = child(numbering, "w:numId")?.attrs["w:val"];
  const level = Number(child(numbering, "w:ilvl")?.attrs["w:val"] ?? 0);
  const list =
    numId && numId !== "0" && heading === undefined
      ? {
          level: Math.min(Math.max(level, 0), 8),
          type: context.numbering.get(numId)?.get(level) ?? "bullet",
        }
      : undefined;
  const content: JSONContent[] = [];
  const images: JSONContent[] = [];
  await inline(element, context, content, images);
  return {
    kind: "paragraph",
    ...(heading ? { heading: Math.min(heading, 6) } : {}),
    title: !!style && context.titleStyles.has(style),
    ...(list ? { list } : {}),
    content,
    images,
  };
}

async function table(
  element: XmlElement,
  context: Context,
): Promise<JSONContent> {
  // Cells by grid column, so vertical merges can find the cell they continue.
  const grid: { cell: JSONContent; column: number }[][] = [];
  for (const row of elements(element, "w:tr")) {
    const header = !!child(child(row, "w:trPr"), "w:tblHeader");
    const cells: { cell: JSONContent; column: number }[] = [];
    let column = 0;
    for (const cell of elements(row, "w:tc")) {
      const properties = child(cell, "w:tcPr");
      const span = Number(child(properties, "w:gridSpan")?.attrs["w:val"] ?? 1);
      const merge = child(properties, "w:vMerge");
      if (merge && merge.attrs["w:val"] !== "restart") {
        // Continues the cell above in this grid column.
        for (let above = grid.length - 1; above >= 0; above--) {
          const owner = grid[above].find((item) => item.column === column);
          if (owner) {
            owner.cell.attrs!.rowspan = Number(owner.cell.attrs!.rowspan) + 1;
            break;
          }
        }
        column += span;
        continue;
      }
      const content: JSONContent[] = [];
      for (const part of elements(cell)) {
        if (part.name === "w:p") {
          const item = await paragraph(part, context);
          content.push(
            { type: "paragraph", content: item.content },
            ...item.images,
          );
        } else if (part.name === "w:tbl") {
          context.warnings.push({
            source: context.source,
            message: "A table inside a table cell was kept as its text.",
          });
          content.push({
            type: "paragraph",
            content: [{ type: "text", text: textOf(part) }],
          });
        }
      }
      cells.push({
        column,
        cell: {
          type: header ? "tableHeader" : "tableCell",
          attrs: { colspan: span, rowspan: 1, colwidth: null },
          content: content.length ? content : [{ type: "paragraph" }],
        },
      });
      column += span;
    }
    grid.push(cells);
  }
  return {
    type: "table",
    content: grid
      .filter((cells) => cells.length)
      .map((cells) => ({
        type: "tableRow",
        content: cells.map((item) => item.cell),
      })),
  };
}

const isParagraph = (item: Paragraph | JSONContent): item is Paragraph =>
  (item as Paragraph).kind === "paragraph" &&
  Array.isArray((item as Paragraph).images);

/** Paragraph runs with numbering become nested bullet and ordered lists. */
function withLists(items: (Paragraph | JSONContent)[]): JSONContent[] {
  const out: JSONContent[] = [];
  let stack: JSONContent[] = [];
  for (const item of items) {
    if (!isParagraph(item)) {
      stack = [];
      out.push(item);
      continue;
    }
    const block: JSONContent = item.heading
      ? {
          type: "heading",
          attrs: { level: item.heading },
          content: item.content,
        }
      : { type: "paragraph", content: item.content };
    if (!item.list) {
      stack = [];
      if (item.content.length || !item.images.length) out.push(block);
      out.push(...item.images);
      continue;
    }
    const type = item.list.type === "ordered" ? "orderedList" : "bulletList";
    while (stack.length > item.list.level + 1) stack.pop();
    if (stack.length === item.list.level + 1 && stack.at(-1)!.type !== type)
      stack.pop();
    while (stack.length < item.list.level + 1) {
      const list: JSONContent = {
        type,
        ...(type === "orderedList" ? { attrs: { start: 1 } } : {}),
        content: [],
      };
      const parent = stack.at(-1);
      if (!parent) out.push(list);
      else {
        let last = parent.content!.at(-1);
        if (!last) {
          last = { type: "listItem", content: [{ type: "paragraph" }] };
          parent.content!.push(last);
        }
        last.content!.push(list);
      }
      stack.push(list);
    }
    stack.at(-1)!.content!.push({
      type: "listItem",
      content: [block, ...item.images],
    });
  }
  return out;
}

const countNodes = (node: JSONContent): number =>
  1 + (node.content ?? []).reduce((sum, item) => sum + countNodes(item), 0);

async function convertDocx(file: {
  path: string;
  bytes(): Promise<Uint8Array>;
}) {
  const access = bufferAccess(await file.bytes());
  const parts = new Map(
    (await zipEntries(access)).map((entry) => [entry.path, entry]),
  );
  const read = async (path: string) => {
    const entry = parts.get(path);
    return entry ? readZipEntry(access, entry) : undefined;
  };
  const xml = async (path: string) => {
    const bytes = await read(path);
    return bytes ? decodeXml(bytes) : undefined;
  };
  const document = await xml("word/document.xml");
  if (!document)
    throw new CoreError(
      "INVALID_DATA",
      `${file.path} has no word/document.xml; it is not a Word document.`,
    );
  const warnings: ImportWarning[] = [];
  const context: Context = {
    parts,
    read,
    rels: new Map(),
    headingStyles: new Map(),
    codeStyles: new Set(),
    titleStyles: new Set(),
    numbering: new Map(),
    footnotes: new Map(),
    notes: [],
    warnings,
    source: file.path,
    imageBytes: 0,
    counts: { comments: 0, skippedImages: 0, textBoxes: 0 },
  };
  for (const relation of descendants(
    (await xml("word/_rels/document.xml.rels")) ?? parseXml("<r/>"),
    "Relationship",
  ))
    context.rels.set(relation.attrs.Id, {
      target: relation.attrs.Target ?? "",
      external: relation.attrs.TargetMode === "External",
    });
  const styles = await xml("word/styles.xml");
  for (const style of styles ? descendants(styles, "w:style") : []) {
    const id = style.attrs["w:styleId"];
    const name = (child(style, "w:name")?.attrs["w:val"] ?? "").toLowerCase();
    const heading = /^heading\s*([1-9])$/.exec(name)?.[1];
    if (heading) context.headingStyles.set(id, Number(heading));
    if (name === "title") context.titleStyles.add(id);
    if (/code|source|verbatim/.test(name)) context.codeStyles.add(id);
  }
  const numbering = await xml("word/numbering.xml");
  if (numbering) {
    const abstract = new Map<string, Map<number, "bullet" | "ordered">>();
    for (const item of descendants(numbering, "w:abstractNum")) {
      const levels = new Map<number, "bullet" | "ordered">();
      for (const level of elements(item, "w:lvl"))
        levels.set(
          Number(level.attrs["w:ilvl"]),
          ["bullet", "none"].includes(
            child(level, "w:numFmt")?.attrs["w:val"] ?? "bullet",
          )
            ? "bullet"
            : "ordered",
        );
      abstract.set(item.attrs["w:abstractNumId"], levels);
    }
    for (const item of descendants(numbering, "w:num")) {
      const id = child(item, "w:abstractNumId")?.attrs["w:val"];
      if (id && abstract.has(id))
        context.numbering.set(item.attrs["w:numId"], abstract.get(id)!);
    }
  }
  for (const [part, prefix, tag] of [
    ["word/footnotes.xml", "f", "w:footnote"],
    ["word/endnotes.xml", "e", "w:endnote"],
  ] as const) {
    const notes = await xml(part);
    for (const note of notes ? descendants(notes, tag) : [])
      if (
        !["separator", "continuationSeparator"].includes(
          note.attrs["w:type"] ?? "",
        )
      )
        context.footnotes.set(
          `${prefix}${note.attrs["w:id"]}`,
          descendants(note, "w:p")
            .map((p) => textOf(p).trim())
            .filter(Boolean)
            .join(" "),
        );
  }
  const core = await xml("docProps/core.xml");
  let title = core
    ? textOf(descendants(core, "dc:title")[0] ?? parseXml("<t/>")).trim()
    : "";

  const body = child(child(document, "w:document"), "w:body");
  const items: (Paragraph | JSONContent)[] = [];
  const visit = async (parent: XmlElement) => {
    for (const element of elements(parent)) {
      if (element.name === "w:p") items.push(await paragraph(element, context));
      else if (element.name === "w:tbl")
        items.push(await table(element, context));
      else if (element.name === "w:sdt")
        await visit(child(element, "w:sdtContent") ?? element);
      else if (element.name === "w:customXml" || element.name === "w:ins")
        await visit(element);
    }
  };
  if (body) await visit(body);
  // The title: document properties, a Title paragraph, or the first heading.
  const plain = (item: Paragraph) =>
    item.content
      .map((node) => node.text ?? "")
      .join("")
      .trim();
  const titled = items.findIndex((item) => isParagraph(item) && item.title);
  const firstHeading = items.findIndex(
    (item) => isParagraph(item) && item.heading === 1,
  );
  const drop = titled >= 0 ? titled : !title ? firstHeading : -1;
  if (drop >= 0) {
    const item = items[drop] as Paragraph;
    if (!title || plain(item) === title) {
      title ||= plain(item);
      if (!item.images.length) items.splice(drop, 1);
    }
  }
  if (!title)
    title = (file.path.split("/").at(-1) ?? file.path).replace(/\.docx$/i, "");

  const nodes = withLists(items);
  if (context.notes.length) {
    nodes.push({ type: "horizontalRule" });
    nodes.push({
      type: "orderedList",
      attrs: { start: 1 },
      content: context.notes.map((note) => ({
        type: "listItem",
        content: [
          {
            type: "paragraph",
            content: note.text ? [{ type: "text", text: note.text }] : [],
          },
        ],
      })),
    });
  }
  // Top-level images are image components; text is split into blocks of a
  // size the rich text contract accepts.
  const blocks: ImportBlock[] = [];
  let run: JSONContent[] = [];
  let size = 0;
  const flush = () => {
    if (run.length)
      blocks.push({
        kind: "text",
        data: { format: "richtext", content: { type: "doc", content: run } },
      });
    run = [];
    size = 0;
  };
  for (const node of nodes) {
    if (node.type === "image") {
      flush();
      blocks.push({
        kind: "image",
        data: { src: node.attrs!.src, alt: node.attrs!.alt ?? "", caption: "" },
      });
      continue;
    }
    const count = countNodes(node);
    if (size + count > NODES_PER_BLOCK) flush();
    run.push(node);
    size += count;
  }
  flush();
  if (context.counts.comments)
    warnings.push({
      source: file.path,
      message: `${context.counts.comments === 1 ? "1 comment was" : `${context.counts.comments} comments were`} left out; comments are not page content.`,
    });
  if (context.counts.skippedImages)
    warnings.push({
      source: file.path,
      message: `${context.counts.skippedImages} linked (not embedded) images were left out.`,
    });
  if (context.counts.textBoxes)
    warnings.push({
      source: file.path,
      message: `${context.counts.textBoxes} text boxes were kept as text where they are anchored.`,
    });
  return { title, blocks, warnings };
}

export const wordImporter: Importer = {
  id: "word",
  name: "Word",
  description:
    "Word documents (.docx): headings, formatting, links, lists, tables, images and footnotes; one page per document.",
  extensions: [".docx"],
  folders: false,
  origin: "builtin",
  async detect(input) {
    if (input.kind !== "file" && input.kind !== "files") return 0;
    return input.files.length &&
      input.files.every((file) => /\.docx$/i.test(file.path))
      ? 0.9
      : 0;
  },
  async convert(input): Promise<ImportBundle> {
    const bundle: ImportBundle = { pages: [], warnings: [...input.problems] };
    for (const file of input.files) {
      const page = await convertDocx(file);
      bundle.pages.push({
        key: file.path,
        title: page.title,
        source: file.path,
        blocks: page.blocks,
      });
      bundle.warnings!.push(...page.warnings);
    }
    return bundle;
  },
};
