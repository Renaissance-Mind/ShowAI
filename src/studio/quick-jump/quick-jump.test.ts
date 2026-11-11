import { describe, expect, it, vi } from "vitest";
import type { PageSummary, ProjectSummary } from "../../core/model";
import type { CatalogComponent } from "../../core/component-categories";
import type { SearchResult } from "../../core/library-index";
import {
  QuickJumpRegistry,
  flattenGroups,
  itemScore,
  rankSource,
  termScore,
  type QuickJumpGroup,
  type QuickJumpItem,
  type QuickJumpSource,
} from "./registry";
import {
  builtinSources,
  commandsSource,
  componentCommandItems,
  componentsSource,
  contentSource,
  foldersSource,
  pagesSource,
  projectsSource,
  type QuickJumpContext,
} from "./sources";

const time = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
function project(
  id: string,
  name: string,
  extra: Partial<ProjectSummary> = {},
): ProjectSummary {
  return {
    format: "showai-project",
    version: 1,
    id,
    name,
    createdAt: time(1),
    updatedAt: time(2),
    pageCount: 0,
    ...extra,
  };
}
function page(
  id: string,
  title: string,
  day: number,
  parentId: string | null = null,
): PageSummary {
  return {
    id,
    title,
    createdAt: time(1),
    updatedAt: time(day),
    icon: "",
    hash: id,
    blockCount: 1,
    parentId,
    favorite: false,
    archived: false,
  };
}
const folder = (id: string, name: string, parentId: string | null = null) => ({
  id,
  name,
  parentId,
  pinned: false,
  archived: false,
  createdAt: time(1),
  updatedAt: time(3),
});
const item = (title: string, extra: Partial<QuickJumpItem> = {}): QuickJumpItem => ({
  key: title,
  title,
  icon: "page",
  data: null,
  ...extra,
});

function context(extra: Partial<QuickJumpContext> = {}): QuickJumpContext {
  const projects = [
    project("p1", "Research", {
      folders: [folder("f1", "Papers"), folder("f2", "Drafts", "f1")],
    }),
    project("p2", "Archive", { archived: true }),
  ];
  return {
    projects,
    pages: {
      p1: {
        pages: [
          page("a", "Roadmap 2027", 5),
          page("b", "Reading notes", 9, "f2"),
          page("c", "Old page", 1, "missing-folder"),
        ],
      },
      p2: { pages: [page("z", "Roadmap archived", 10)] },
    },
    commands: [],
    components: [],
    canInsert: false,
    labels: {
      pages: "Pages",
      folders: "Folders",
      projects: "Projects",
      content: "Content",
      commands: "Commands",
      components: "Components",
    },
    searchContent: async () => [],
    openPage: vi.fn(),
    openDirectory: vi.fn(),
    insert: vi.fn(async () => {}),
    ...extra,
  };
}

describe("ranking", () => {
  it("orders exact, prefix, word, inner and letters-in-order matches", () => {
    const exact = termScore("road", "road");
    const prefix = termScore("road", "roadmap");
    const word = termScore("map", "road map");
    const inner = termScore("map", "roadmap");
    const letters = termScore("rdmp", "roadmap");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(inner);
    expect(inner).toBeGreaterThan(letters);
    expect(letters).toBeGreaterThan(0);
    expect(termScore("xyz", "roadmap")).toBe(0);
  });

  it("needs every term in the title or keywords and prefers the title", () => {
    expect(itemScore("new page", item("New page"))).toBeGreaterThan(
      itemScore("new page", item("Page", { keywords: "new" })),
    );
    expect(itemScore("dark", item("Switch appearance", { keywords: "dark light" }))).toBeGreaterThan(0);
    expect(itemScore("new zebra", item("New page"))).toBe(0);
  });

  it("lists the most recent first with an empty query, within the source's share", () => {
    const source: QuickJumpSource<null> = {
      id: "s",
      label: () => "S",
      emptyLimit: 2,
      search: () => [],
      run: () => {},
    };
    const rows = rankSource(source, "", [
      item("a", { updatedAt: time(1) }),
      item("b", { updatedAt: time(3) }),
      item("c", { updatedAt: time(2) }),
    ]);
    expect(rows.map((row) => row.item.title)).toEqual(["b", "c"]);
    expect(rankSource({ ...source, emptyLimit: 0 }, "", [item("a")])).toEqual([]);
  });

  it("puts stronger groups first and content matches after title matches", async () => {
    const registry = new QuickJumpRegistry<null>([
      { id: "fuzzy", label: () => "F", search: () => [item("r-o-a-d")], run: () => {} },
      { id: "exact", label: () => "E", search: () => [item("road")], run: () => {} },
      {
        id: "text",
        label: () => "T",
        matched: true,
        search: async () => [item("body match")],
        run: () => {},
      },
    ]);
    const reports: QuickJumpGroup[][] = [];
    registry.search("road", null, (groups) => reports.push(groups), (error) => {
      throw error;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(reports[0].map((group) => group.source)).toEqual(["exact", "fuzzy"]);
    expect(reports.at(-1)!.map((group) => group.source)).toEqual([
      "exact",
      "fuzzy",
      "text",
    ]);
    expect(flattenGroups(reports.at(-1)!).map((row) => row.item.title)).toEqual([
      "road",
      "r-o-a-d",
      "body match",
    ]);
  });

  it("shows a page once when its title and its content both match", async () => {
    const ctx = context({
      searchContent: async () => [
        { path: "projects/p1/pages/a.json", blockId: "b1" } as SearchResult,
        { path: "projects/p1/pages/a.json", blockId: "b2" } as SearchResult,
        { path: "projects/p1/pages/b.json", blockId: "b3" } as SearchResult,
      ],
    });
    const registry = new QuickJumpRegistry<QuickJumpContext>([pagesSource, contentSource]);
    let groups: QuickJumpGroup[] = [];
    registry.search("roadmap", ctx, (value) => (groups = value), (error) => {
      throw error;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(groups.map((group) => [group.source, group.rows.map((row) => row.item.key)])).toEqual([
      ["pages", ["p1/a"]],
      ["content", ["p1/b/b3"]],
    ]);
  });

  it("refuses a second source with the same id and stops reports when cancelled", async () => {
    const source: QuickJumpSource<null> = {
      id: "one",
      label: () => "",
      matched: true,
      search: async () => [item("late")],
      run: () => {},
    };
    const registry = new QuickJumpRegistry<null>([source]);
    expect(() => registry.register(source)).toThrow(/already registered/);
    const report = vi.fn();
    registry.search("x", null, report, () => {})();
    await Promise.resolve();
    await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("built-in sources", () => {
  it("pages carry their project and folder path and skip archived or orphaned pages", async () => {
    const ctx = context();
    const rows = rankSource(pagesSource, "", await pagesSource.search("", ctx));
    expect(rows.map((row) => [row.item.title, row.item.path])).toEqual([
      ["Reading notes", "Research / Papers / Drafts"],
      ["Roadmap 2027", "Research"],
    ]);
    await pagesSource.run(rows[0].item, ctx);
    expect(ctx.openPage).toHaveBeenCalledWith({
      projectId: "p1",
      pageId: "b",
      blockIds: [],
    });
  });

  it("folders and projects open their directory", async () => {
    const ctx = context();
    const folders = rankSource(foldersSource, "draft", await foldersSource.search("draft", ctx));
    expect(folders.map((row) => [row.item.title, row.item.path])).toEqual([
      ["Drafts", "Research / Papers"],
    ]);
    await foldersSource.run(folders[0].item, ctx);
    expect(ctx.openDirectory).toHaveBeenCalledWith("p1", "f2");
    const projects = rankSource(projectsSource, "r", await projectsSource.search("r", ctx));
    expect(projects.map((row) => row.item.title)).toEqual(["Research"]);
  });

  it("content matches open the block and skip pages already gone", async () => {
    const result = (path: string, blockId: string | null) =>
      ({ path, blockId }) as SearchResult;
    const ctx = context({
      searchContent: async () => [
        result("projects/p1/pages/a.json", "block-1"),
        result("projects/p1/pages/a.json", "block-1"),
        result("projects/p1/pages/gone.json", null),
        result("packages/components/x/1.0.0/manifest.json", null),
      ],
    });
    const items = await contentSource.search("gantt", ctx);
    expect(items.map((entry) => entry.key)).toEqual(["p1/a/block-1"]);
    await contentSource.run(items[0], ctx);
    expect(ctx.openPage).toHaveBeenCalledWith({
      projectId: "p1",
      pageId: "a",
      blockIds: ["block-1"],
    });
    expect(await contentSource.search("g", ctx)).toEqual([]);
  });

  it("commands keep their shortcut and run their action", async () => {
    const run = vi.fn();
    const ctx = context({
      commands: [
        { id: "sidebar", title: "Toggle the sidebar", shortcut: "Mod+\\", run },
        { id: "theme", title: "Switch appearance", keywords: "dark", run: vi.fn() },
      ],
    });
    const rows = rankSource(commandsSource, "dark", await commandsSource.search("dark", ctx));
    expect(rows.map((row) => row.item.key)).toEqual(["theme"]);
    const sidebar = (await commandsSource.search("", ctx))[0];
    expect(sidebar.shortcut).toBe("Mod+\\");
    await commandsSource.run(sidebar, ctx);
    expect(run).toHaveBeenCalled();
  });
});

describe("components and their commands", () => {
  const builtin = {
    kind: "callout-card",
    name: "提示卡",
    description: "A card",
    scenarios: [],
    defaultData: { text: "default" },
    propsSchema: {},
    examples: [{ name: "warning", data: { text: "careful" } }],
    contributes: {
      commands: [
        { id: "warn", title: "Insert a warning card", run: { insert: { example: 0 } } },
      ],
    },
  } as CatalogComponent;
  const custom = {
    id: "standup",
    name: "Standup",
    version: "1.0.0",
    integrity: "sha256-" + "0".repeat(64),
    scope: "project",
    description: "Daily standup",
    scenarios: [],
    entry: "index.tsx",
    updatedAt: time(1),
    examples: [],
    contributes: {
      commands: [
        {
          id: "today",
          title: "Add today's standup",
          keywords: ["daily"],
          run: { insert: { props: { date: "today" } } },
        },
        {
          id: "board",
          title: "Open the team board",
          run: { goTo: "showai://project/p1/page/a?blocks=b1" },
        },
      ],
    },
  } as CatalogComponent;

  it("every component offers insertion and its declared commands through one path", () => {
    const editable = componentCommandItems([builtin, custom], true, "C");
    expect(editable.map((entry) => entry.key)).toEqual([
      "catalog:callout-card",
      "catalog:callout-card:warn",
      `catalog:standup@1.0.0#${"sha256-" + "0".repeat(64)}`,
      `catalog:standup@1.0.0#${"sha256-" + "0".repeat(64)}:today`,
      `catalog:standup@1.0.0#${"sha256-" + "0".repeat(64)}:board`,
    ]);
    // Without an editable page only navigation stays.
    expect(
      componentCommandItems([builtin, custom], false, "C").map((entry) => entry.title),
    ).toEqual(["Open the team board"]);
    // A component placed inside a line keeps its navigation commands only.
    const inline = {
      ...custom,
      id: "status-tag",
      contributes: {
        mention: { prop: "label", input: "text" as const },
        commands: custom.contributes!.commands,
      },
    } as CatalogComponent;
    expect(
      componentCommandItems([inline], true, "C").map((entry) => entry.title),
    ).toEqual(["Open the team board"]);
  });

  it("runs insert commands with example or declared props and goTo with the page link", async () => {
    const insert = vi.fn(async () => {});
    const ctx = context({ components: [builtin, custom], canInsert: true, insert });
    const items = await componentsSource.search("", ctx);
    const byTitle = (title: string) => items.find((entry) => entry.title === title)!;
    await componentsSource.run(byTitle("Insert a warning card"), ctx);
    const [[, warningProps]] = insert.mock.calls as unknown as [
      [CatalogComponent, (c: never) => unknown],
    ];
    expect(
      warningProps({ defaultData: {}, examples: [{ name: "w", data: { text: "careful" } }] } as never),
    ).toEqual({ text: "careful" });
    await componentsSource.run(byTitle("Add today's standup"), ctx);
    const props = (insert.mock.calls[1] as unknown as [unknown, (c: never) => unknown])[1];
    expect(props({ defaultData: {}, examples: [] } as never)).toEqual({ date: "today" });
    await componentsSource.run(byTitle("Open the team board"), ctx);
    expect(ctx.openPage).toHaveBeenCalledWith({
      projectId: "p1",
      pageId: "a",
      blockIds: ["b1"],
    });
    await componentsSource.run(byTitle("Standup"), ctx);
    expect(insert).toHaveBeenLastCalledWith(custom);
    expect(rankSource(componentsSource, "daily", items).map((row) => row.item.title)).toEqual([
      "Add today's standup",
      "Standup",
    ]);
  });
});

describe("scale", () => {
  it("ranks thousands of pages quickly", async () => {
    const projects = Array.from({ length: 40 }, (_, index) =>
      project(`p${index}`, `Project ${index}`, {
        folders: Array.from({ length: 10 }, (_, f) => folder(`f${index}-${f}`, `Folder ${f}`)),
      }),
    );
    const pages: Record<string, { pages: PageSummary[] }> = {};
    const words = ["roadmap", "notes", "meeting", "draft", "plan", "review", "研究", "周报"];
    let count = 0;
    for (const [index, entry] of projects.entries()) {
      pages[entry.id] = {
        pages: Array.from({ length: 125 }, (_, n) => {
          count++;
          return page(
            `pg${index}-${n}`,
            `${words[n % words.length]} ${words[(n * 7) % words.length]} ${n}`,
            1 + (n % 27),
            n % 3 ? `f${index}-${n % 10}` : null,
          );
        }),
      };
    }
    expect(count).toBe(5000);
    const ctx = context({ projects, pages });
    const registry = new QuickJumpRegistry<QuickJumpContext>(
      builtinSources.filter((source) => source !== contentSource),
    );
    const timings: Record<string, number> = {};
    const measure = (label: string, query: string) => {
      const start = performance.now();
      let groups: QuickJumpGroup[] = [];
      registry.search(query, ctx, (value) => (groups = value), (error) => {
        throw error;
      });
      timings[label] = performance.now() - start;
      return groups;
    };
    measure("first (builds the page index)", "");
    for (const query of ["r", "ro", "roadmap", "rdmp", "研究", "meeting plan 12", "zzzz"])
      measure(`query "${query}"`, query);
    const groups = measure("query roadmap", "roadmap");
    expect(groups[0].rows.length).toBe(8);
    console.info("quick jump over 5000 pages (ms):", timings);
    for (const [label, value] of Object.entries(timings))
      expect(value, label).toBeLessThan(label.startsWith("first") ? 400 : 150);
  });
});
