import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AgentService } from "./service";
import { templateFixture } from "../test/template-fixture";
import { syncManager } from "../sync/manager";
let home: string, projectId: string;
const clients: Client[] = [];
async function connect(templates?: string) {
  const client = new Client({ name: "template-stdio-test", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve("dist-agent/cli.mjs"),
        "--home",
        home,
        "mcp",
        "--project",
        projectId,
        ...(templates ? ["--templates", templates] : []),
      ],
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir() },
    }),
  );
  clients.push(client);
  return client;
}
async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return (result.structuredContent as { data: Record<string, any> }).data;
}
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "showai-template-stdio-"));
  const service = new AgentService({ root: home });
  projectId = (await service.createProject("Stdio workflow")).id;
});
afterAll(async () => {
  for (const client of clients) await client.close();
  await syncManager(home).stop();
  await rm(home, { recursive: true, force: true });
});
test("two real stdio sessions retain different pinned templates and stage disclosures", async () => {
  const [a, b] = await Promise.all([
    connect("paper-explainer@2.0.0"),
    connect(),
  ]);
  const first = await call(a, "template_context"),
    second = await call(b, "template_context");
  expect(first.context.templates[0].id).toBe("paper-explainer");
  expect(second.context.templates).toEqual([]);
  expect(first.system.required).toBe(true);
  expect(first.stages).toEqual(["intent", "material", "logic", "design"]);
  const stage = await call(a, "template_guide", { stage: "design" });
  expect(stage.documents).toHaveLength(2);
  expect(stage.documents[1].ref.id).toBe("paper-explainer");
  expect(
    stage.documents.every((d: { path: string }) => d.path.includes("design")),
  ).toBe(true);
  const blank = await call(a, "template_context", { templates: [] });
  expect(blank.context.templates).toEqual([]);
  expect(blank.system.required).toBe(true);
  const blankStage = await call(a, "template_guide", {
    stage: "design",
    templates: [],
  });
  expect(blankStage.documents).toHaveLength(1);
  expect(blankStage.documents[0].ref.id).toBe("system-presentation");
  expect((await call(a, "template_context")).context).toEqual(first.context);
  expect(
    (await call(a, "template_context", { knownHash: first.context.hash }))
      .system,
  ).toBeUndefined();
  await expect(
    readFile(join(home, "agent-runtime.json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});
test("remote-shaped bundle payload registers real components without local paths", async () => {
  const client = await connect("paper-explainer");
  const saved = await call(client, "template_save", {
    input: { bundle: templateFixture("payload-template") },
  });
  expect(saved.document).toBeUndefined();
  const context = await call(client, "template_context", {
    templates: [
      {
        id: saved.id,
        scope: "project",
        version: saved.version,
        integrity: saved.integrity,
      },
    ],
  });
  expect(context.components).toHaveLength(1);
  const binding = context.components[0].ref;
  const guide = await call(client, "catalog_describe", {
    kind: "component",
    id: binding.id,
    scope: "project",
    version: binding.version,
    integrity: binding.integrity,
    view: "guide",
  });
  expect(guide.documentationStatus).toBe("available");
  expect(JSON.stringify(context)).not.toContain("index.tsx");
});
test("source and receipt profiles reduce text without losing saved content or revision checks", async () => {
  const client = await connect("paper-explainer");
  const page = await call(client, "template_apply", {
    templateId: "paper-explainer",
    scope: "builtin",
    version: "2.0.0",
    title: "Report",
  });
  const full = await call(client, "page_read", {
    pageId: page.document.id,
    rendered: false,
  });
  const source = await call(client, "page_read", {
    pageId: page.document.id,
    rendered: false,
    response: "source",
  });
  expect(source.document).toEqual(full.document);
  expect(source.markdown).toBeUndefined();
  expect(source.outline).toBeUndefined();
  expect(JSON.stringify(source).length).toBeLessThan(
    JSON.stringify(full).length,
  );
  const changed = await call(client, "page_apply", {
    pageId: page.document.id,
    baseHash: source.hash,
    baseRevision: source.revision,
    operations: [{ type: "page.set", fields: { title: "Revised" } }],
    response: "receipt",
  });
  expect(changed.document).toBeUndefined();
  expect(changed.hash).not.toBe(source.hash);
  const after = await call(client, "page_read", {
    pageId: page.document.id,
    rendered: false,
    response: "source",
  });
  expect(after.document.title).toBe("Revised");
  expect(after.document.templateContext).toEqual(
    source.document.templateContext,
  );
  const conflict = await client.callTool({
    name: "page_apply",
    arguments: {
      pageId: page.document.id,
      baseHash: source.hash,
      baseRevision: source.revision,
      operations: [{ type: "page.set", fields: { title: "Stale" } }],
      response: "receipt",
    },
  });
  expect(conflict.isError).toBe(true);
});
