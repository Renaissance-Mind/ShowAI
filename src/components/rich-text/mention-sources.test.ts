import { describe, expect, it } from "vitest";
import {
  mentionEntries,
  registerMentionSource,
  type MentionContext,
} from "./mention-sources";
import { slashMenuRows } from "../slash-menu-model";
import {
  typedDays,
  validateMentionContract,
} from "../../portable/mention-contract.mjs";
import { markdownToRichText, validateRichTextData } from "./model.mjs";
import { toMarkdown } from "../../lib/document";
import { validateDocument } from "../../portable/validation.mjs";
import type { CatalogComponent } from "../../core/component-categories";
import catalog from "../../../resources/catalog/components.json";

const date = catalog.find((item) => item.kind === "date") as CatalogComponent;
const context = (query: string, extra: Partial<MentionContext> = {}) =>
  ({
    query,
    projectId: "p",
    pageId: "here",
    pages: [
      { id: "old", title: "Old notes", updatedAt: "2026-01-01T00:00:00Z" },
      { id: "here", title: "This page", updatedAt: "2026-11-12T00:00:00Z" },
      { id: "new", title: "New plan", updatedAt: "2026-11-10T00:00:00Z" },
    ],
    components: [date],
    locale: "en",
    today: new Date(2026, 10, 12),
    labels: {
      pages: "Pages",
      today: "Today",
      tomorrow: "Tomorrow",
      yesterday: "Yesterday",
    },
    displayName: (component) => component.name,
    ...extra,
  }) satisfies MentionContext;
const rows = (query: string, extra?: Partial<MentionContext>) =>
  slashMenuRows(mentionEntries(context(query, extra)), {
    query,
    level: "root",
    recent: [],
    labels: { recent: "Recent", charts: "Charts" },
  }).flatMap((row) => (row.type === "item" ? [row.item] : []));

describe("@ menu sources", () => {
  it("lists recently changed pages first, never the page being edited", () => {
    const items = rows("");
    expect(items.filter((item) => item.group === "Pages").map((i) => i.title))
      .toEqual(["New plan", "Old notes"]);
    expect(items[0].entry.insertion).toEqual({
      type: "link",
      href: "showai://project/p/page/new",
      text: "New plan",
    });
  });
  it("filters pages and dates by what was typed", () => {
    expect(rows("old").map((item) => item.title)).toEqual(["Old notes"]);
    const tomorrow = rows("tom");
    expect(tomorrow.map((item) => item.title)).toEqual(["Tomorrow"]);
    expect(tomorrow[0].entry.insertion).toMatchObject({
      type: "component",
      prop: "date",
      value: "2026-11-13",
    });
    const typed = rows("2026-12-24");
    expect(typed.map((item) => item.entry.insertion)).toEqual([
      expect.objectContaining({ value: "2026-12-24" }),
    ]);
    expect(rows("12/24")[0].entry.insertion).toMatchObject({
      value: "2026-12-24",
    });
    expect(typedDays("2026-02-30")).toEqual([]);
  });
  it("turns a component's mention contract into a source", () => {
    const tag = {
      ...date,
      kind: "status-tag",
      name: "Status",
      mention: {
        prop: "label",
        input: "options",
        options: [
          { label: "Blocked", value: "blocked", keywords: "stuck" },
          { label: "Done", value: "done" },
        ],
      },
    } as CatalogComponent;
    const items = rows("stuck", { components: [tag] });
    expect(items.map((item) => [item.group, item.title])).toEqual([
      ["Status", "Blocked"],
    ]);
  });
  it("adds registered sources", () => {
    const remove = registerMentionSource({
      id: "people",
      label: () => "People",
      search: ({ query }) =>
        query
          ? [
              {
                id: `person:${query}`,
                title: query,
                keywords: query,
                insertion: { type: "link", href: "https://example.com", text: query },
              },
            ]
          : [],
    });
    expect(rows("Ada").map((item) => item.group)).toContain("People");
    remove();
    expect(rows("Ada").map((item) => item.group)).not.toContain("People");
  });
  it("validates mention contracts", () => {
    expect(() =>
      validateMentionContract({ prop: "date", input: "time" }),
    ).toThrow("mention.input");
    expect(() =>
      validateMentionContract(
        { prop: "missing", input: "text" },
        { type: "object", properties: { label: { type: "string" } } },
      ),
    ).toThrow("mention.prop");
    expect(() => validateMentionContract({ prop: "a", input: "options" }))
      .toThrow("needs options");
  });
});

describe("inline components in rich text", () => {
  it("reads @[kind]{data} from Markdown and writes it back", () => {
    const doc = markdownToRichText(
      'Due @[date]{"date":"2026-11-20"} with [the plan](showai://project/p/page/new).',
    );
    const paragraph = doc.content![0];
    expect(paragraph.content).toEqual([
      { type: "text", text: "Due " },
      { type: "inlineWidget", attrs: { kind: "date", data: { date: "2026-11-20" } } },
      { type: "text", text: " with " },
      {
        type: "text",
        text: "the plan",
        marks: [{ type: "link", attrs: { href: "showai://project/p/page/new" } }],
      },
      { type: "text", text: "." },
    ]);
    validateRichTextData({ format: "richtext", content: doc });
    expect(toMarkdown(paragraph)).toContain('@[date]{"date":"2026-11-20"}');
    // Text that only resembles the syntax stays text.
    const plain = markdownToRichText(String.raw`see @[date]{"date": 2026`).content![0]
      .content!;
    expect(plain.every((node) => node.type === "text")).toBe(true);
    expect(plain.map((node) => node.text).join("")).toBe(
      String.raw`see @[date]{"date": 2026`,
    );
  });
  it("validates the inline component's data on save", () => {
    const page = (date: string) => ({
      id: "page",
      title: "Page",
      createdAt: "2026-11-12T00:00:00.000Z",
      updatedAt: "2026-11-12T00:00:00.000Z",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { id: "p1" },
            content: [
              { type: "inlineWidget", attrs: { id: "d1", kind: "date", data: { date } } },
            ],
          },
        ],
      },
    });
    expect(() => validateDocument(page("2026-11-20"))).not.toThrow();
    expect(() => validateDocument(page("2026-13-01"))).toThrow("calendar day");
  });
});
