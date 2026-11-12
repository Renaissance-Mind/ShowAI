import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandProps, validateContributions } from "./contributions";
import { listComponents, saveComponent } from "../core/catalog";
import { FileStore } from "../core/store";
import { readBuiltinComponentCatalog } from "./catalog";
import type { ComponentManifest } from "./types";

const commandsOf = (commands: unknown, examples = 1) =>
  validateContributions({ commands }, { examples }).commands ?? [];

describe("component command declarations", () => {
  it("accepts insert and goTo commands", () => {
    const commands = commandsOf(
      [
        { id: "today", title: "Today", keywords: ["daily"], run: { insert: { example: 0 } } },
        { id: "blank", title: "Blank", run: { insert: {} } },
        { id: "own", title: "Own", run: { insert: { props: { value: 3 } } } },
        { id: "go", title: "Board", run: { goTo: "showai://project/p1/page/a?blocks=b" } },
      ],
      1,
    );
    expect(commands).toHaveLength(4);
    const component = {
      defaultData: { value: 0 },
      examples: [{ data: { value: 1 } }],
    };
    expect(commandProps(commands[0], component)).toEqual({ value: 1 });
    expect(commandProps(commands[1], component)).toEqual({ value: 0 });
    expect(commandProps(commands[2], component)).toEqual({ value: 3 });
    expect(() => commandProps(commands[3], component)).toThrow(/does not insert/);
  });

  it.each([
    [[{ id: "Bad Id", title: "x", run: { insert: {} } }], /contributes\.commands\[0\]\.id must be lowercase/],
    [[{ id: "a", title: " ", run: { insert: {} } }], /title/],
    [[{ id: "a", title: "x", run: { insert: { example: 2 } } }], /contributes\.commands\[0\]\.run\.insert\.example names a missing example/],
    [[{ id: "a", title: "x", run: { insert: { example: 0, props: {} } } }], /not both/],
    [[{ id: "a", title: "x", run: { goTo: "https://example.com" } }], /page link/],
    [[{ id: "a", title: "x", run: { open: "settings" } }], /run/],
    [[{ id: "a", title: "x", run: { insert: {} }, extra: 1 }], /extra/],
    [
      [
        { id: "a", title: "x", run: { insert: {} } },
        { id: "a", title: "y", run: { insert: {} } },
      ],
      /unique/,
    ],
    [Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, title: "x", run: { insert: {} } })), /20/],
  ])("rejects %j", (value, message) => {
    expect(() => commandsOf(value)).toThrow(message);
  });

  it("built-in components declare their slots through the same contract", () => {
    const declared = readBuiltinComponentCatalog().filter(
      (component) => component.contributes !== undefined,
    );
    expect(declared.map((component) => component.kind)).toContain("date");
    for (const component of declared)
      expect(() =>
        validateContributions(component.contributes, {
          examples: component.examples.length,
          schema: component.propsSchema,
        }),
      ).not.toThrow();
  });
});

describe("mention and database field declarations", () => {
  const schema = {
    type: "object",
    properties: { label: { type: "string" }, count: { type: "number" } },
  };
  it.each([
    [{ mention: { prop: "label", input: "time" } }, /contributes\.mention\.input/],
    [{ mention: { prop: "count", input: "text" } }, /contributes\.mention\.prop must be a string property/],
    [{ mention: { prop: "missing", input: "text" } }, /contributes\.mention\.prop/],
    [{ mention: { prop: "label", input: "options" } }, /needs options/],
    [{ databaseField: { protocol: 2, valueKind: "number" } }, /contributes\.databaseField\.protocol/],
    [{ databaseField: { protocol: 1, valueKind: "money" } }, /contributes\.databaseField\.valueKind/],
    [
      { databaseField: { protocol: 1, valueKind: "number", operators: ["contains"] } },
      /contributes\.databaseField\.operators\[0\] must be an operator of number values/,
    ],
    [
      {
        mention: { prop: "label", input: "text" },
        databaseField: { protocol: 1, valueKind: "text" },
      },
      /cannot hold both/,
    ],
    [{ palette: [] }, /contributes .*palette/],
  ])("rejects %j", (value, message) => {
    expect(() => validateContributions(value, { examples: 0, schema })).toThrow(
      message,
    );
  });
  it("accepts a mention and a field type with commands", () => {
    expect(
      validateContributions(
        {
          mention: { prop: "label", input: "options", options: [{ label: "A", value: "a" }] },
          commands: [{ id: "go", title: "Go", run: { goTo: "showai://project/p/page/q" } }],
        },
        { examples: 0, schema },
      ).mention?.input,
    ).toBe("options");
    expect(
      validateContributions(
        { databaseField: { protocol: 1, valueKind: "number", operators: ["gt", "lt"] } },
        { examples: 0 },
      ).databaseField?.operators,
    ).toEqual(["gt", "lt"]);
  });
});

describe("saving a component with commands", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });
  const manifest: ComponentManifest = {
    id: "standup-card",
    name: "Standup",
    version: "1.0.0",
    description: "A daily standup card",
    entry: "index.tsx",
    scenarios: ["Daily standup"],
    defaultData: { value: 0 },
    examples: [{ name: "One", data: { value: 1 } }],
  };
  const schema = {
    type: "object",
    properties: { value: { type: "number" } },
    required: ["value"],
    additionalProperties: false,
  };
  const source = "export default function Card({data}){return <p>{data.value}</p>}";
  async function library() {
    const home = await mkdtemp(join(tmpdir(), "showai-commands-"));
    directories.push(home);
    const project = await new FileStore(home).createProject({ name: "Commands" });
    return { home, projectId: project.id };
  }

  it("keeps the commands in the listing the workbench and the Agent read", async () => {
    const { home, projectId } = await library();
    const commands = [
      { id: "five", title: "Insert five", keywords: ["number"], run: { insert: { props: { value: 5 } } } },
      { id: "one", title: "Insert one", run: { insert: { example: 0 } } },
    ];
    const saved = await saveComponent(
      home,
      { manifest: { ...manifest, contributes: { commands } }, schema, source },
      projectId,
    );
    expect(saved.contributes?.commands).toEqual(commands);
    const listed = (await listComponents(home, projectId)).find(
      (item) => item.id === manifest.id,
    );
    expect(listed?.contributes?.commands).toEqual(commands);
  });

  it("rejects insert props that do not fit the schema", async () => {
    const { home, projectId } = await library();
    await expect(
      saveComponent(
        home,
        {
          manifest: {
            ...manifest,
            contributes: {
              commands: [{ id: "bad", title: "Bad", run: { insert: { props: { value: "x" } } } }],
            },
          },
          schema,
          source,
        },
        projectId,
      ),
    ).rejects.toThrow(/contributes\.commands\[0\]\.run\.insert\.props \(command 'bad'\)/);
  });

  it("refuses slot fields outside contributes", async () => {
    const { home, projectId } = await library();
    await expect(
      saveComponent(
        home,
        {
          manifest: {
            ...manifest,
            commands: [{ id: "one", title: "One", run: { insert: {} } }],
          } as ComponentManifest,
          schema,
          source,
        },
        projectId,
      ),
    ).rejects.toThrow(/manifest\.contributes\.commands/);
  });
});
