import type { ImportBlock } from "./types";


export const NOTION_BLOCKS = {
  text: (markdown: string): ImportBlock => ({
    kind: "text",
    data: { format: "markdown", content: markdown },
  }),
  callout: (input: { icon?: string; markdown: string }): ImportBlock => ({
    kind: "callout",
    data: {
      title: "",
      icon: input.icon || "💡",
      tone: "sage",
      content: input.markdown,
    },
  }),
  toggle: (input: { summary: string; markdown: string }): ImportBlock => ({
    kind: "toggle",
    data: { summary: input.summary, content: input.markdown, open: false },
  }),
  image: (input: { src: string; alt: string }): ImportBlock => ({
    kind: "image",
    data: { src: input.src, alt: input.alt, caption: "" },
  }),
  bookmark: (input: { url: string; title: string }): ImportBlock => ({
    kind: "bookmark",
    data: {
      title: input.title === input.url ? "" : input.title,
      description: "",
      url: input.url,
      image: "",
    },
  }),
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

export const NOTION_PROPERTY_COLUMNS: Record<
  NotionProperty,
  "text" | "number" | "select" | "multiSelect" | "relation" | "checkbox" | "url" | "date"
> = {
  title: "text",
  text: "text",
  number: "number",
  select: "select",
  multiSelect: "multiSelect",
  checkbox: "checkbox",
  url: "url",
  email: "text",
  date: "date",
  relation: "relation",
};

export const NOTION_INFERENCE = {
  selectOptions: 20,
  checked: ["yes", "true"],
  unchecked: ["no", "false"],
};
