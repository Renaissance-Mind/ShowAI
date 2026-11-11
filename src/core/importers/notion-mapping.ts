import type { ImportBlock } from "./types";

// What a Notion export becomes in ShowAI, kept as data in one place. The
// importer recognises Notion blocks and database properties; these tables
// decide the catalog component (or rich text) and column type each one
// becomes. To target another component — a custom one included — change
// the entry; the importer's parsing stays as it is.

/** Notion blocks that become their own component instance. Everything else
 * (headings, paragraphs, lists, to-dos, quotes, code with its language,
 * equations, simple tables, dividers, inline links) is Markdown inside a
 * rich text block, whose parser maps it to the matching rich text nodes. */
export const NOTION_BLOCKS = {
  text: (markdown: string): ImportBlock => ({
    kind: "text",
    data: { format: "markdown", content: markdown },
  }),
  /** <aside> callouts; the leading emoji becomes the icon. */
  callout: (input: { icon?: string; markdown: string }): ImportBlock => ({
    kind: "callout",
    data: {
      title: "",
      icon: input.icon || "💡",
      tone: "sage",
      content: input.markdown,
    },
  }),
  /** <details><summary> toggles. */
  toggle: (input: { summary: string; markdown: string }): ImportBlock => ({
    kind: "toggle",
    data: { summary: input.summary, content: input.markdown, open: false },
  }),
  image: (input: { src: string; alt: string }): ImportBlock => ({
    kind: "image",
    data: { src: input.src, alt: input.alt, caption: "" },
  }),
  /** A link alone on its line: Notion's bookmarks and embeds. */
  bookmark: (input: { url: string; title: string }): ImportBlock => ({
    kind: "bookmark",
    data: {
      title: input.title === input.url ? "" : input.title,
      description: "",
      url: input.url,
      image: "",
    },
  }),
  /** File blocks by the attachment's type. */
  video: (input: { src: string; name: string }): ImportBlock => ({
    kind: "video",
    data: { title: "", src: input.src, caption: "", fileName: input.name },
  }),
  audio: (input: { src: string; name: string }): ImportBlock => ({
    kind: "audio",
    data: { title: "", src: input.src, caption: "", fileName: input.name },
  }),
  pdf: (input: { src: string; name: string }): ImportBlock => ({
    kind: "pdf",
    data: { title: "", src: input.src, caption: "", fileName: input.name },
  }),
  /** A CSV database, bound to the dataset that holds its columns and rows. */
  database: (input: { title: string; dataset: string }): ImportBlock => ({
    kind: "database",
    data: {
      title: input.title,
      view: "table",
      $binding: {
        dataset: input.dataset,
        props: { local: ["title", "view", "groupBy", "calendar", "views"] },
      },
    },
  }),
};

/** Kinds of Notion database properties the importer can tell from a CSV. */
export type NotionProperty =
  | "title"
  | "text"
  | "number"
  | "select"
  | "multiSelect"
  | "checkbox"
  | "url"
  | "email"
  | "date"
  | "relation";

/**
 * The ShowAI database column type of each Notion property. multiSelect and
 * relation are kept as text (relations show the related page titles) until
 * the database has those column types.
 */
export const NOTION_PROPERTY_COLUMNS: Record<
  NotionProperty,
  "text" | "number" | "select" | "checkbox" | "url" | "date"
> = {
  title: "text",
  text: "text",
  number: "number",
  select: "select",
  multiSelect: "text",
  checkbox: "checkbox",
  url: "url",
  email: "text",
  date: "date",
  relation: "text",
};

/** Settings of the inference that turns CSV text into property kinds. */
export const NOTION_INFERENCE = {
  /** A column with at most this many distinct values (and repeats) is a select. */
  selectOptions: 20,
  /** Values Notion writes for checkboxes. */
  checked: ["yes", "true"],
  unchecked: ["no", "false"],
};
