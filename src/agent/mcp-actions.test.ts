import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { actionTool, strictToolInputs } from "./mcp-actions";
import { createLibraryMcpServer } from "./mcp-library";
import { mcpSuccess } from "./presentation-tools";
import { openLibrary } from "../core/open-library";
import { syncManager } from "../sync/manager";

let root: string;
const clients: Client[] = [];
async function connect(server: McpServer) {
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mcp-actions-test", version: "1" });
  await server.connect(right);
  await client.connect(left);
  clients.push(client);
  return client;
}
const failure = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.stringify(result.content);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-mcp-actions-"));
  await openLibrary(root);
});
afterAll(async () => {
  for (const client of clients) await client.close();
  await syncManager(root).stop();
  await rm(root, { recursive: true, force: true });
});

function sampleServer() {
  const server = strictToolInputs(
    new McpServer({ name: "sample", version: "1" }),
  );
  const tool = actionTool("Sample.", {
    create: {
      fields: { name: z.string().min(1), icon: z.string().optional() },
      run: async (input) => mcpSuccess({ created: input }),
    },
    rename: {
      fields: { id: z.string(), name: z.string().nullable() },
      run: async (input) => mcpSuccess({ renamed: input }),
    },
  });
  server.registerTool(
    "sample",
    { description: tool.description, inputSchema: tool.inputSchema },
    tool.handler,
  );
  const plain = server.registerTool(
    "plain",
    { inputSchema: { value: z.string() } },
    async (input) => mcpSuccess(input),
  );
  // Decorators replace parameters; strictness must survive.
  plain.update({ paramsSchema: { value: z.string(), extra: z.number() } });
  return { server, description: tool.description };
}

test("action tools validate each call against exactly its action's fields", async () => {
  const { server, description } = sampleServer();
  expect(description).toBe(
    "Sample. Actions: create{name,icon?}; rename{id,name}.",
  );
  const client = await connect(server);
  const listed = (await client.listTools()).tools.find(
    (t) => t.name === "sample",
  )!;
  expect(listed.inputSchema.required).toEqual(["action"]);
  expect(listed.inputSchema.additionalProperties).toBe(false);

  const created = await client.callTool({
    name: "sample",
    arguments: { action: "create", name: "A" },
  });
  expect(created.isError).not.toBe(true);
  expect((created.structuredContent as any).data).toEqual({
    created: { name: "A" },
  });
  // The union accepts null for rename; create still rejects it.
  const renamed = await client.callTool({
    name: "sample",
    arguments: { action: "rename", id: "x", name: null },
  });
  expect((renamed.structuredContent as any).data).toEqual({
    renamed: { id: "x", name: null },
  });
  const nullName = await client.callTool({
    name: "sample",
    arguments: { action: "create", name: null },
  });
  expect(nullName.isError).toBe(true);
  // Structured: the action's own fields, not the advertised union.
  const nullError = (nullName.structuredContent as any).error;
  expect(nullError.code).toBe("INVALID_ARGUMENTS");
  expect(nullError.issues).toEqual([
    { path: "name", message: expect.stringContaining("expected string") },
  ]);
  expect(nullError.expected).toEqual({
    required: ["action", "name"],
    optional: ["icon"],
  });

  const crossField = await client.callTool({
    name: "sample",
    arguments: { action: "create", name: "A", id: "x" },
  });
  expect(crossField.isError).toBe(true);
  expect((crossField.structuredContent as any).error).toMatchObject({
    code: "INVALID_ARGUMENTS",
    unexpected: ["id"],
  });

  const missing = await client.callTool({
    name: "sample",
    arguments: { action: "rename", name: "B" },
  });
  expect(missing.isError).toBe(true);
  expect((missing.structuredContent as any).error.issues[0].path).toBe("id");

  const unknown = await client.callTool({
    name: "sample",
    arguments: { action: "delete" },
  });
  expect(unknown.isError).toBe(true);
  expect((unknown.structuredContent as any).error.actions).toEqual({
    create: { required: ["name"], optional: ["icon"] },
    rename: { required: ["id", "name"], optional: [] },
  });

  const undeclared = await client.callTool({
    name: "sample",
    arguments: { action: "create", name: "A", stale: 1 },
  });
  expect(undeclared.isError).toBe(true);
  expect(failure(undeclared)).toContain("stale");
});

test("strict inputs survive parameter replacement", async () => {
  const client = await connect(sampleServer().server);
  const plain = (await client.listTools()).tools.find(
    (t) => t.name === "plain",
  )!;
  expect(Object.keys(plain.inputSchema.properties ?? {})).toEqual([
    "value",
    "extra",
  ]);
  expect(plain.inputSchema.additionalProperties).toBe(false);
  const accepted = await client.callTool({
    name: "plain",
    arguments: { value: "v", extra: 1 },
  });
  expect(accepted.isError).not.toBe(true);
  const rejected = await client.callTool({
    name: "plain",
    arguments: { value: "v", extra: 1, removed: true },
  });
  expect(rejected.isError).toBe(true);
  expect(failure(rejected)).toContain("removed");
});

test("action fields cannot carry defaults", () => {
  expect(() =>
    actionTool("Sample.", {
      list: {
        fields: { limit: z.number().default(10) },
        run: async () => mcpSuccess({}),
      },
    }),
  ).toThrow("list.limit cannot have a default.");
});

test("library connections reject removed and cross-action arguments", async () => {
  const client = await connect(createLibraryMcpServer({ root }));
  const project = (
    (
      await client.callTool({
        name: "project_create",
        arguments: { name: "P" },
      })
    ).structuredContent as any
  ).data;
  const folder = await client.callTool({
    name: "organization_update",
    arguments: { projectId: project.id, action: "create_folder", name: "F" },
  });
  expect(folder.isError).not.toBe(true);
  const sortWithName = await client.callTool({
    name: "organization_update",
    arguments: {
      projectId: project.id,
      action: "sort",
      parentId: null,
      sortBy: "name",
      name: "F",
    },
  });
  expect(sortWithName.isError).toBe(true);
  expect((sortWithName.structuredContent as any).error).toMatchObject({
    code: "INVALID_ARGUMENTS",
    unexpected: ["name"],
    expected: { required: ["action", "parentId", "sortBy"] },
  });
  // Removed capture knobs are ignored and reported, not silently dropped.
  const knob = await client.callTool({
    name: "board_read",
    arguments: { projectId: project.id, pageId: "p", maxImages: 1 },
  });
  expect(knob.isError).toBe(true);
  expect((knob.structuredContent as any).migration.changes).toEqual([
    "board_read no longer takes maxImages; it was ignored",
  ]);
});

// codex-rs/core/src/mcp_tool_exposure.rs: plugin MCP tools share 64,000 bytes
// of model specs, each tool's spec repeating the server instructions. Codex
// keeps only these schema keywords (codex-rs/tools/src/json_schema/types.rs).
const CODEX_KEYWORDS = new Set([
  "$ref",
  "type",
  "description",
  "enum",
  "items",
  "minItems",
  "properties",
  "required",
  "additionalProperties",
  "anyOf",
  "oneOf",
  "allOf",
  "$defs",
  "definitions",
]);
function codexSchema(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => CODEX_KEYWORDS.has(key))
      .map(([key, child]) => [
        key,
        ["properties", "$defs", "definitions"].includes(key)
          ? Object.fromEntries(
              Object.entries(child as Record<string, unknown>).map(
                ([name, schema]) => [name, codexSchema(schema)],
              ),
            )
          : ["items", "additionalProperties"].includes(key)
            ? codexSchema(child)
            : ["anyOf", "oneOf", "allOf"].includes(key)
              ? (child as unknown[]).map(codexSchema)
              : child,
      ]),
  );
}

test("the local library tool list stays well inside Codex's plugin tool budget", async () => {
  const client = await connect(createLibraryMcpServer({ root }));
  const instructions = client.getInstructions() ?? "";
  const { tools } = await client.listTools();
  const bytes = tools.map((tool) => ({
    name: tool.name,
    bytes: Buffer.byteLength(
      JSON.stringify({
        type: "namespace",
        name: "mcp__showai__",
        description: instructions,
        tools: [
          {
            type: "function",
            name: tool.name,
            description: tool.description ?? "",
            strict: false,
            parameters: codexSchema(tool.inputSchema),
          },
        ],
      }),
    ),
  }));
  const total = bytes.reduce((sum, item) => sum + item.bytes, 0);
  // Other plugins share the 64,000 bytes (DrawAI alone uses ~7,400); keep
  // about 20 KB free so another plugin does not silently hide ShowAI tools.
  expect(total, JSON.stringify(bytes)).toBeLessThan(44_000);
  for (const item of bytes) expect(item.bytes, item.name).toBeLessThan(4_000);
  for (const tool of tools)
    expect(
      Buffer.byteLength(tool.description ?? ""),
      tool.name,
    ).toBeLessThanOrEqual(1_000);
});
