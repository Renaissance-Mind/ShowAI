import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AccountCipher } from "../server/account-crypto";
import { hash } from "../sync/protocol";
import { createServer } from "node:http";
import { chromium } from "playwright-core";
import { readingBrowserExecutable } from "./reading-renderer";
import { SQLiteMetadata } from "../server/node-storage";
import { startSyncServer } from "../server/node";
import { AgentService } from "./service";
import { syncManager } from "../sync/manager";
import { startMcpHttpServer } from "./mcp-http";
import { parameterComponent } from "../test/parameter-component";
import { templateFixture } from "../test/template-fixture";

let directory: string,
  sync: Awaited<ReturnType<typeof startSyncServer>>,
  http: Awaited<ReturnType<typeof startMcpHttpServer>>;
let account: { token: string; user: { id: string; name: string } },
  projectId: string,
  local: AgentService;
const clients: Client[] = [];
async function post(url: string, value: unknown, token?: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(value),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
}
async function client(token?: string) {
  const result = new Client({
    name: "showai-integration-test",
    version: "1.0.0",
  });
  await result.connect(
    new StreamableHTTPClientTransport(new URL(http.url + "/mcp"), {
      requestInit: {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
    }),
  );
  clients.push(result);
  return result;
}
function data(result: Awaited<ReturnType<Client["callTool"]>>) {
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  return (result.structuredContent as { data: Record<string, unknown> }).data;
}
async function authorize(
  scope = "projects.read projects.write",
  access = "selected",
) {
  const redirect = "http://127.0.0.1:12345/callback";
  const registration = await post(http.url + "/oauth/register", {
    client_name: "ShowAI acceptance client",
    redirect_uris: [redirect],
    token_endpoint_auth_method: "none",
  });
  const verifier = randomBytes(32).toString("base64url"),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    client_id: registration.client_id,
    response_type: "code",
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope,
    state: "state-must-return",
    resource: http.url + "/mcp",
  });
  const start = await fetch(http.url + "/oauth/authorize?" + query);
  const form = await start.text();
  expect(start.status, form).toBe(200);
  const flow = form.match(/name="flow" value="([^"]+)"/)![1],
    csrf = form.match(/name="csrf" value="([^"]+)"/)![1];
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    cookie: start.headers.get("set-cookie")!.split(";")[0],
    origin: http.url,
  };
  const login = await fetch(http.url + "/oauth/login", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      flow,
      csrf,
      server: sync.url,
      account: "integration-user",
      password: "test-only-passphrase-123",
    }),
  });
  expect(await login.text()).toContain(projectId);
  const consent = await fetch(http.url + "/oauth/consent", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      flow,
      csrf,
      project: projectId,
      access,
      decision: "allow",
    }),
    redirect: "manual",
  });
  expect(consent.status).toBe(302);
  const location = new URL(consent.headers.get("location")!);
  expect(location.searchParams.get("state")).toBe("state-must-return");
  expect(location.searchParams.get("iss")).toBe(http.url);
  const params = {
    grant_type: "authorization_code",
    client_id: registration.client_id,
    code: location.searchParams.get("code"),
    redirect_uri: redirect,
    resource: http.url + "/mcp",
    code_verifier: verifier,
  };
  const wrong = await fetch(http.url + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...params, code_verifier: "x".repeat(43) }),
  });
  expect(wrong.status).toBe(400);
  const tokens = await post(http.url + "/oauth/token", params);
  const replay = await fetch(http.url + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  expect(replay.status).toBe(400);
  return { ...tokens, client_id: registration.client_id };
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-mcp-http-test-"));
  sync = await startSyncServer({
    home: join(directory, "server"),
    port: 0,
    publicUrl: "http://127.0.0.1/cloud",
    registrationKey: "isolated-integration-registration-key",
  });
  account = await post(sync.url + "/api/auth/register", {
    name: "integration-user",
    password: "test-only-passphrase-123",
    device: "local-test",
    registrationKey: "isolated-integration-registration-key",
  });
  local = new AgentService({ root: join(directory, "desktop") });
  const project = await local.createProject("Cross-harness integration");
  projectId = project.id;
  const manager = syncManager(local.store.root);
  const connection = await manager.connect({
    url: sync.url,
    token: account.token,
  });
  await manager.attach(connection.id, projectId);
  await manager.stop();
  http = await startMcpHttpServer({
    stateDirectory: join(directory, "gateway"),
    syncServers: [sync.url],
    port: 0,
  });
}, 60_000);
afterAll(async () => {
  for (const item of clients) await item.close();
  await http?.close();
  await sync?.close();
  if (local) await syncManager(local.store.root).stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("remote guide delivers the full shared Skill workflow anonymously and retains runtime topics", async () => {
  const anonymous = await client();
  expect(anonymous.getInstructions()).toContain(
    "Start every ShowAI task by calling guide()",
  );
  const tools = await anonymous.listTools();
  const guide = tools.tools.find((tool) => tool.name === "guide")!;
  expect(guide.inputSchema.properties).toHaveProperty("skill");
  expect(guide.annotations?.readOnlyHint).toBe(true);
  const entry = data(
    await anonymous.callTool({ name: "guide", arguments: {} }),
  );
  expect(entry.protocol).toBe("showai-remote-skills-v1");
  expect(entry.markdown).toContain("根据任务继续");
  expect(entry.skills).toHaveLength(7);
  for (const skill of entry.skills as { name: string }[]) {
    const detail = data(
      await anonymous.callTool({
        name: "guide",
        arguments: { skill: skill.name },
      }),
    );
    expect(detail.source).toMatchObject({
      path: `plugins/showai/skills/${skill.name}/SKILL.md`,
    });
    expect(detail.markdown).toBeTruthy();
    expect(
      data(
        await anonymous.callTool({
          name: "guide",
          arguments: { skill: skill.name, knownHash: detail.hash },
        }),
      ).unchanged,
    ).toBe(true);
  }
  const reference = data(
    await anonymous.callTool({
      name: "guide",
      arguments: {
        skill: "create-template",
        file: "references/template-creation.md",
      },
    }),
  );
  expect(reference.markdown).toContain("template");
  const presentation = data(
    await anonymous.callTool({
      name: "guide",
      arguments: { topic: "presentation", stage: "design" },
    }),
  );
  expect(presentation.stage).toBe("design");
  for (const args of [
    { skill: "use-showai", file: "../package.json" },
    { skill: "use-showai", topic: "reading" },
    { file: "SKILL.md" },
  ]) {
    const result = await anonymous.callTool({ name: "guide", arguments: args });
    expect(result.isError).toBe(true);
  }
});

test("authorized Board reads deliver overlapping images without exposing local cache paths", async () => {
  const tokens = await authorize();
  const remote = await client(tokens.access_token);
  const created = data(
    await remote.callTool({
      name: "page_create",
      arguments: {
        projectId,
        document: {
          id: "remote-board",
          title: "Remote Board capture",
          comments: [],
          content: {
            type: "surface",
            attrs: { id: "remote-root", kind: "board" },
            content: [
              {
                type: "surface",
                attrs: {
                  id: "remote-page",
                  kind: "page",
                  name: "Original Page",
                },
                content: [
                  {
                    type: "paragraph",
                    attrs: { id: "remote-text" },
                    content: [
                      { type: "text", text: "REMOTE ORIGINAL PAGE SOURCE" },
                    ],
                  },
                ],
              },
              {
                type: "drawing",
                attrs: {
                  id: "remote-pen",
                  tool: "pen",
                  color: "#2563eb",
                  strokeWidth: 8,
                  extent: [2300, 100],
                  points: [
                    { x: 0, y: 20 },
                    { x: 2300, y: 80 },
                  ],
                },
              },
            ],
          },
          layout: {
            "remote-page": { x: 0, y: 0, width: 500, height: 400 },
            "remote-pen": { x: 0, y: 550, width: 2300, height: 100 },
          },
        },
      },
    }),
  );
  const pageId = (created.document as { id: string }).id;
  const readers = await authorize("projects.read");
  const reader = await client(readers.access_token);
  const response = await reader.callTool({
    name: "board_read",
    arguments: { projectId, pageId },
  });
  const result = data(response);
  expect(result.protocol).toBe("showai-board-reading-v1");
  expect(
    (response.content as { type: string }[]).filter((c) => c.type === "image"),
  ).toHaveLength(3);
  expect((result.images as object[]).every((i) => !("path" in i))).toBe(true);
  const captions = (response.content as { type: string; text?: string }[])
    .filter((c) => c.type === "text")
    .slice(1)
    .map((c) => JSON.parse(c.text!).imageKey);
  expect(captions).toEqual(["overview", "T1", "T2"]);
  const source = data(
    await reader.callTool({
      name: "page_read",
      arguments: {
        projectId,
        pageId,
        snapshotId: result.snapshotId,
        blockIds: ["remote-page"],
        rendered: false,
        response: "source",
      },
    }),
  );
  expect(JSON.stringify(source)).toContain("REMOTE ORIGINAL PAGE SOURCE");
  expect(source).not.toHaveProperty("path");
  const anonymous = await client();
  expect(
    (
      await anonymous.callTool({
        name: "board_read",
        arguments: {
          projectId,
          pageId,
          snapshotId: result.snapshotId,
          mode: "source",
        },
      })
    ).isError,
  ).toBe(true);
}, 60000);

test("anonymous clients discover and customize public resources without a project, while private tools challenge for OAuth", async () => {
  const anonymous = await client();
  const tools = await anonymous.listTools();
  expect(
    tools.tools.find((t) => t.name === "page_save")?.inputSchema.properties,
  ).toHaveProperty("projectId");
  expect(tools.tools.some((t) => t.name === "component_import")).toBe(false);
  expect(
    tools.tools.find((t) => t.name === "page_export")?.inputSchema.properties,
  ).not.toHaveProperty("out");
  const catalog = data(
    await anonymous.callTool({
      name: "public_catalog_list",
      arguments: { kind: "template" },
    }),
  );
  expect(catalog.synchronizationRequired).toBe(false);
  const publicIds = (catalog.items as { id: string }[]).map((item) => item.id);
  expect(publicIds).toEqual(
    expect.arrayContaining([
      "explainer",
      "comparison",
      "research-note",
      "evidence-report",
      "system-presentation",
    ]),
  );
  expect(new Set(publicIds).size).toBe(publicIds.length);
  const folder = data(
    await anonymous.callTool({
      name: "public_catalog_describe",
      arguments: {
        id: "evidence-report",
        kind: "template",
        view: "guide",
        version: "2.0.0",
      },
    }),
  );
  const stage = data(
    await anonymous.callTool({
      name: "public_catalog_describe",
      arguments: {
        id: "evidence-report",
        kind: "template",
        view: "guide",
        stage: "design",
        version: folder.version,
        integrity: folder.integrity,
      },
    }),
  );
  expect(stage.documents).toHaveLength(2);
  expect((stage.documents as { ref: { id: string } }[])[0].ref.id).toBe(
    "system-presentation",
  );
  const folderRender = data(
    await anonymous.callTool({
      name: "render_document",
      arguments: {
        templateId: "evidence-report",
        templateVersion: folder.version,
        templateIntegrity: folder.integrity,
        title: "Public folder output",
      },
    }),
  );
  const folderSource = await (
    await fetch((folderRender.delivery as { source: string }).source)
  ).json();
  expect(folderSource.document.title).toBe("Public folder output");
  const template = data(
    await anonymous.callTool({
      name: "public_catalog_describe",
      arguments: { id: "explainer", kind: "template", view: "source" },
    }),
  );
  const document = template.document as { title: string };
  document.title = "Customized without synchronization";
  const rendered = await anonymous.callTool({
    name: "render_document",
    arguments: { document },
  });
  const result = data(rendered);
  const editable = data(
    await anonymous.callTool({
      name: "presentation_source",
      arguments: {
        artifactId: (result.delivery as { artifactId: string }).artifactId,
      },
    }),
  );
  expect(JSON.parse(String(editable.text)).document.title).toBe(
    "Customized without synchronization",
  );
  expect(result.persistence).toEqual({
    savedToProject: false,
    synchronized: false,
  });
  const delivery = result.delivery as { html: string; source: string };
  expect(await (await fetch(delivery.html)).text()).toContain(
    "Customized without synchronization",
  );
  expect(
    (
      await fetch(delivery.source, {
        headers: { origin: "https://chatgpt.com" },
      })
    ).status,
  ).toBe(200);
  expect(
    (rendered._meta as { showai: { inline: string } }).showai.inline,
  ).toContain("data-showai-inline-root");
  const denied = await anonymous.callTool({
    name: "pages_list",
    arguments: { projectId },
  });
  expect(denied.isError).toBe(true);
  expect(denied._meta).toHaveProperty("mcp/www_authenticate");
  const resource = await anonymous.readResource({
    uri: "ui://showai/reader-v2.html",
  });
  expect(resource.contents[0].mimeType).toBe("text/html;profile=mcp-app");
  const malformed = await anonymous.callTool({
    name: "render_document",
    arguments: {
      document: {
        id: "invalid-kind",
        title: "Invalid custom reference",
        content: {
          type: "doc",
          content: [
            { type: "widget", attrs: { kind: "triangle-area", data: {} } },
          ],
        },
      },
    },
  });
  expect(malformed.isError).toBe(true);
  expect(JSON.stringify(malformed.content)).toContain("kind='custom'");
}, 60_000);

test("a text-only remote client writes the same synchronized page seen by the desktop and preserves stale-write conflicts", async () => {
  const credentials = await authorize(),
    remote = await client(credentials.access_token);
  const projects = data(
    await remote.callTool({ name: "projects_list" }),
  ) as unknown as { id: string }[];
  expect(projects.map((p) => p.id)).toEqual([projectId]);
  const created = await remote.callTool({
    name: "page_create",
    arguments: { projectId, title: "Created by a text-only agent" },
  });
  const record = data(created) as {
    document: { id: string };
    hash: string;
    revision: string;
  };
  const listed = data(
    await remote.callTool({ name: "pages_list", arguments: { projectId } }),
  );
  expect(Array.isArray(listed)).toBe(true);
  expect(created.structuredContent).toMatchObject({
    synchronization: { state: "synced", projectId },
  });
  await syncManager(local.store.root).run(projectId);
  expect(
    (await local.store.readPage(projectId, record.document.id)).document.title,
  ).toBe("Created by a text-only agent");
  const initial = data(
    await remote.callTool({
      name: "page_read",
      arguments: { projectId, pageId: record.document.id, rendered: false },
    }),
  ) as { hash: string; revision: string; document: { title: string } };
  const onDesktop = await local.store.readPage(projectId, record.document.id);
  await local.savePage(
    projectId,
    record.document.id,
    { ...onDesktop.document, title: "Human edited the shared page" },
    onDesktop.hash,
    undefined,
    undefined,
    onDesktop.revision,
  );
  await syncManager(local.store.root).run(projectId);
  const stale = await remote.callTool({
    name: "page_save",
    arguments: {
      projectId,
      pageId: record.document.id,
      response: "receipt",
      document: { ...initial.document, title: "Stale replacement" },
      baseHash: initial.hash,
      baseRevision: initial.revision,
    },
  });
  const retained = data(stale) as {
    pageId: string;
    retainedSyncConflicts: { variants: { pageId: string; title: string }[] }[];
  };
  expect(retained.pageId).not.toBe(record.document.id);
  expect(stale.structuredContent).toMatchObject({
    synchronization: { state: "synced", projectId },
  });
  expect(retained.retainedSyncConflicts[0].variants).toHaveLength(2);
  expect(
    retained.retainedSyncConflicts[0].variants.some((v) =>
      v.title.startsWith("Human edited the shared page"),
    ),
  ).toBe(true);
  const latest = data(
    await remote.callTool({
      name: "page_read",
      arguments: { projectId, pageId: record.document.id, rendered: false },
    }),
  ) as { document: { title: string } };
  expect(latest.document.title).toContain("Human edited the shared page");
  const shown = await remote.callTool({
    name: "page_present",
    arguments: { projectId, pageId: record.document.id },
  });
  expect(data(shown).title).toContain("Human edited the shared page");
  expect(shown._meta).toHaveProperty("showai");
  const anonymous = await client();
  const privateSource = await anonymous.callTool({
    name: "presentation_source",
    arguments: {
      artifactId: (data(shown).delivery as { artifactId: string }).artifactId,
    },
  });
  expect(privateSource.isError).toBe(true);
  const other = await remote.callTool({
    name: "pages_list",
    arguments: { projectId: "unauthorized-project" },
  });
  expect(other.isError).toBe(true);
}, 120_000);

test("anonymous custom component source compiles with pinned versions and is returned as reusable source", async () => {
  const anonymous = await client();
  const source = {
    manifest: {
      id: "public-interaction",
      name: "Public interaction",
      version: "1.0.0",
      description: "A supplied, editable interaction",
      scenarios: ["Independent presentation"],
      entry: "index.tsx",
      defaultData: { label: "Open details" },
      examples: [{ name: "Default", data: { label: "Open details" } }],
    },
    schema: {
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
      additionalProperties: false,
    },
    source:
      'import React,{useState} from "react";export default function Example({data}){const [open,setOpen]=useState(false);return <section><button onClick={()=>setOpen(!open)}>{data.label}</button>{open&&<p>Details supplied by the author.</p>}</section>}',
  };
  const result = await anonymous.callTool({
    name: "render_document",
    arguments: {
      document: {
        id: "public-example",
        title: "Editable public interaction",
        content: {
          type: "doc",
          content: [
            {
              type: "widget",
              attrs: {
                id: "interaction",
                kind: "custom",
                data: {
                  componentId: "public-interaction",
                  version: "1.0.0",
                  props: { label: "Show the explanation" },
                },
              },
            },
          ],
        },
      },
      componentSources: [source],
    },
  });
  const delivery = data(result).delivery as { source: string };
  const artifact = await (await fetch(delivery.source)).json();
  expect(artifact.components[0].id).toBe("public-interaction");
  expect(artifact.componentSources[0].source).toBe(source.source);
  expect(artifact.document.content.content[0].attrs.data.integrity).toMatch(
    /^sha256-/,
  );
  expect(
    (result._meta as { showai: { inline: string } }).showai.inline,
  ).toContain("data-showai-inline-root");
}, 60_000);

test("an oversized inline view preserves complete HTML/source and can select a smaller independent preview", async () => {
  const anonymous = await client();
  const document = {
    id: "large-public-page",
    title: "Independent large output",
    content: {
      type: "doc",
      content: [
        {
          type: "widget",
          attrs: {
            id: "summary",
            kind: "text",
            data: {
              content: "## Summary\nA selected standalone preview.",
              format: "markdown",
            },
          },
        },
        ...Array.from({ length: 3 }, (_, index) => ({
          type: "widget",
          attrs: {
            id: `large-${index}`,
            kind: "text",
            data: {
              content: randomBytes(400_000).toString("base64"),
              format: "plain",
            },
          },
        })),
      ],
    },
  };
  const full = data(
    await anonymous.callTool({
      name: "render_document",
      arguments: { document },
    }),
  );
  expect(full.inlineError).toBeTruthy();
  expect((full.delivery as { html: string }).html).toMatch(/^http/);
  const selected = await anonymous.callTool({
    name: "render_document",
    arguments: { document, blockIds: ["summary"] },
  });
  expect(data(selected).inlineError).toBeUndefined();
  const source = await (
    await fetch((data(selected).delivery as { source: string }).source)
  ).json();
  expect(source.document.content.content).toHaveLength(4);
  expect(
    (selected._meta as { showai: { inline: string } }).showai.inline,
  ).toContain("data-showai-inline-root");
}, 60_000);

test("OAuth scope, resource binding, refresh rotation and revocation are enforced", async () => {
  const credentials = await authorize("projects.read"),
    reader = await client(credentials.access_token);
  const denied = await reader.callTool({
    name: "page_create",
    arguments: { projectId, title: "Should not be written" },
  });
  expect(denied.isError).toBe(true);
  expect(denied._meta).toHaveProperty("mcp/www_authenticate");
  const badResource = await fetch(http.url + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: credentials.client_id,
      refresh_token: credentials.refresh_token,
      resource: "https://another-server.example/mcp",
    }),
  });
  expect(badResource.status).toBe(400);
  const refreshed = await post(http.url + "/oauth/token", {
    grant_type: "refresh_token",
    client_id: credentials.client_id,
    refresh_token: credentials.refresh_token,
    resource: http.url + "/mcp",
  });
  const replay = await fetch(http.url + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: credentials.client_id,
      refresh_token: credentials.refresh_token,
    }),
  });
  expect(replay.status).toBe(400);
  await post(http.url + "/oauth/revoke", {
    client_id: credentials.client_id,
    token: refreshed.access_token,
  });
  const revoked = await reader.callTool({ name: "projects_list" });
  expect(revoked.isError).toBe(true);
});

test("authorized HTTP clients use portable template folders, exact stage refs and compact source receipts", async () => {
  const credentials = await authorize(),
    remote = await client(credentials.access_token);
  const baseline = data(
    await remote.callTool({
      name: "guide",
      arguments: { topic: "presentation" },
    }),
  );
  expect(baseline.required).toBe(true);
  const saved = data(
    await remote.callTool({
      name: "template_save",
      arguments: {
        projectId,
        input: { bundle: templateFixture("http-guided-template") },
      },
    }),
  );
  expect(saved.document).toBeUndefined();
  const context = data(
    await remote.callTool({
      name: "template_context",
      arguments: {
        projectId,
        templates: [
          {
            id: saved.id,
            version: saved.version,
            integrity: saved.integrity,
            scope: "project",
          },
        ],
      },
    }),
  );
  const binding = context.context as { templates: Record<string, unknown>[] };
  expect(context.components).toHaveLength(1);
  expect(JSON.stringify(context)).not.toContain("index.tsx");
  const stage = data(
    await remote.callTool({
      name: "template_guide",
      arguments: { projectId, stage: "design", templates: binding.templates },
    }),
  );
  expect(stage.documents).toHaveLength(2);
  expect(JSON.stringify(stage)).not.toContain(
    "Only the review phase instruction",
  );
  const page = data(
    await remote.callTool({
      name: "template_apply",
      arguments: {
        projectId,
        templateId: saved.id,
        version: saved.version,
        integrity: saved.integrity,
        scope: "project",
        title: "HTTP template Page",
      },
    }),
  );
  const document = page.document as { id: string };
  const read = data(
    await remote.callTool({
      name: "page_read",
      arguments: {
        projectId,
        pageId: document.id,
        rendered: false,
        response: "source",
      },
    }),
  );
  expect(read.document).toBeDefined();
  expect(read.markdown).toBeUndefined();
  expect(read.projectId).toBe(projectId);
  const changed = data(
    await remote.callTool({
      name: "page_apply",
      arguments: {
        projectId,
        pageId: document.id,
        baseHash: read.hash,
        baseRevision: read.revision,
        operations: [{ type: "page.set", fields: { title: "HTTP revised" } }],
        response: "receipt",
      },
    }),
  );
  expect(changed.document).toBeUndefined();
  expect(changed.hash).not.toBe(read.hash);
  const other = data(
    await remote.callTool({
      name: "template_context",
      arguments: {
        projectId,
        templates: [{ id: "decision-comparison", scope: "builtin" }],
      },
    }),
  );
  expect(
    (other.context as { templates: { id: string }[] }).templates[0].id,
  ).toBe("decision-comparison");
  const original = data(
    await remote.callTool({
      name: "template_guide",
      arguments: {
        projectId,
        stage: "understanding",
        templates: binding.templates,
      },
    }),
  );
  expect((original.documents as { ref: { id: string } }[])[1].ref.id).toBe(
    saved.id,
  );
});

test("HTTP parameter queries preserve v2 semantics, anonymous compatibility and reject invalid input", async () => {
  const credentials = await authorize(),
    remote = await client(credentials.access_token),
    source = parameterComponent("http-region-reader");
  const saved = data(
    await remote.callTool({
      name: "component_save",
      arguments: { projectId, source },
    }),
  );
  const query = {
    projectId,
    kind: "component",
    id: saved.id,
    scope: "project",
    version: saved.version,
    integrity: saved.integrity,
    view: "parameters",
    parameterPath: "slides[].regions[].box",
  };
  const reference = data(
    await remote.callTool({ name: "catalog_describe", arguments: query }),
  );
  expect(reference.definitionValidated).toBe(true);
  expect(reference.entries).toHaveLength(5);
  const cached = data(
    await remote.callTool({
      name: "catalog_describe",
      arguments: { ...query, knownHash: reference.hash },
    }),
  );
  expect(cached.unchanged).toBe(true);
  expect(cached.entries).toBeUndefined();
  const document = {
    id: "invalid-http-region",
    title: "Invalid region",
    content: {
      type: "doc",
      content: [
        {
          type: "widget",
          attrs: {
            id: "regions",
            kind: "custom",
            data: {
              componentId: saved.id,
              version: saved.version,
              integrity: saved.integrity,
              props: { ...source.manifest.defaultData, selected: "not-an-id" },
            },
          },
        },
      ],
    },
  };
  const refused = await remote.callTool({
    name: "page_create",
    arguments: { projectId, document },
  });
  expect(refused.isError).toBe(true);
  const anonymous = await client();
  const publicRef = data(
    await anonymous.callTool({
      name: "public_catalog_describe",
      arguments: {
        id: "text",
        kind: "component",
        view: "parameters",
        parameterLimit: 1,
      },
    }),
  );
  expect(publicRef.entries).toHaveLength(1);
  expect(publicRef.protocol).toBe("showai-component-parameters-v1");
  const privateRef = await anonymous.callTool({
    name: "catalog_describe",
    arguments: query,
  });
  expect(privateRef.isError).toBe(true);
}, 60000);

test("account authorization discovers future projects and creates synchronized cloud projects with safe retries", async () => {
  const tokens = await authorize(
    "projects.read projects.write projects.create",
    "account",
  );
  const remote = await client(tokens.access_token);
  const operationId = crypto.randomUUID();
  const result = data(
    await remote.callTool({
      name: "project_create",
      arguments: { name: "Created from ChatGPT", operationId },
    }),
  );
  const id = (result.project as { id: string }).id;
  expect((result.synchronization as { state: string }).state).toBe("synced");
  const again = data(
    await remote.callTool({
      name: "project_create",
      arguments: { name: "Created from ChatGPT", operationId },
    }),
  );
  expect((again.project as { id: string }).id).toBe(id);
  const changed = await remote.callTool({
    name: "project_create",
    arguments: { name: "Different request", operationId },
  });
  expect(changed.isError).toBe(true);
  const localFuture = await local.createProject(
    "Added locally after authorization",
  );
  const manager = syncManager(local.store.root);
  const connection = (await manager.configuration()).connections[0];
  await manager.attach(connection.id, localFuture.id);
  await manager.stop();
  const projects = data(
    await remote.callTool({ name: "projects_list", arguments: {} }),
  ) as unknown as { id: string }[];
  expect(projects.map((p) => p.id)).toEqual(
    expect.arrayContaining([projectId, id, localFuture.id]),
  );
  const pages = data(
    await remote.callTool({ name: "pages_list", arguments: { projectId: id } }),
  );
  expect(pages).toEqual([]);
  const selectedTokens = await authorize();
  const selected = await client(selectedTokens.access_token);
  const selectedProjects = data(
    await selected.callTool({ name: "projects_list", arguments: {} }),
  ) as unknown as { id: string }[];
  expect(selectedProjects.map((p) => p.id)).toEqual([projectId]);
  expect(
    (
      await selected.callTool({
        name: "pages_list",
        arguments: { projectId: id },
      })
    ).isError,
  ).toBe(true);
  const readOnly = await client(
    (await authorize("projects.read", "account")).access_token,
  );
  expect(
    (
      await readOnly.callTool({
        name: "project_create",
        arguments: { name: "Forbidden" },
      })
    ).isError,
  ).toBe(true);
});

test("third-party login rejects CSRF and reports unconfigured providers without leaking polling credentials", async () => {
  const redirect = "http://127.0.0.1:12345/callback";
  const registration = await post(http.url + "/oauth/register", {
    redirect_uris: [redirect],
  });
  const query = new URLSearchParams({
    client_id: registration.client_id,
    response_type: "code",
    redirect_uri: redirect,
    code_challenge: createHash("sha256")
      .update("test-verifier")
      .digest("base64url"),
    code_challenge_method: "S256",
  });
  const response = await fetch(http.url + "/oauth/authorize?" + query),
    html = await response.text();
  expect(html).toContain("使用 GitHub 登录");
  expect(html).toContain("使用 Google 登录");
  const flow = html.match(/name="flow" value="([^\"]+)"/)![1],
    csrf = html.match(/name="csrf" value="([^\"]+)"/)![1];
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    origin: http.url,
  };
  const missing = await fetch(http.url + "/oauth/external/start", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      flow,
      csrf,
      server: sync.url,
      provider: "github",
    }),
  });
  expect(await missing.text()).toContain("此服务器尚未启用这种登录方式");
  const invalid = await fetch(http.url + "/oauth/external/start", {
    method: "POST",
    headers,
    body: new URLSearchParams({
      flow,
      csrf: "wrong",
      server: sync.url,
      provider: "google",
    }),
  });
  expect(invalid.status).toBe(400);
});

test("social login resumes a completed upstream account flow without exposing its session or polling secret", async () => {
  const root = join(directory, "social-server"),
    vaultKey = "e".repeat(64);
  const social = await startSyncServer({
    home: root,
    port: 0,
    vaultKey,
    githubLogin: { clientId: "test-client", clientSecret: "test-secret" },
    registrationKey: "social-test-register",
  });
  const gateway = await startMcpHttpServer({
    stateDirectory: join(directory, "social-gateway"),
    syncServers: [social.url],
    port: 0,
  });
  const db = new SQLiteMetadata(join(root, "metadata.sqlite"));
  try {
    const user = await post(social.url + "/api/auth/register", {
      name: "social-user",
      password: "social-test-password-123",
      registrationKey: "social-test-register",
    });
    const redirect = "http://127.0.0.1:12345/callback";
    const registration = await post(gateway.url + "/oauth/register", {
      redirect_uris: [redirect],
    });
    const query = new URLSearchParams({
      client_id: registration.client_id,
      response_type: "code",
      redirect_uri: redirect,
      code_challenge: createHash("sha256")
        .update("test-verifier")
        .digest("base64url"),
      code_challenge_method: "S256",
    });
    const start = await fetch(gateway.url + "/oauth/authorize?" + query),
      initial = await start.text();
    const flow = initial.match(/name="flow" value="([^\"]+)"/)![1],
      csrf = initial.match(/name="csrf" value="([^\"]+)"/)![1];
    const headers = {
      "content-type": "application/x-www-form-urlencoded",
      cookie: start.headers.get("set-cookie")!.split(";")[0],
      origin: gateway.url,
    };
    const response = await fetch(gateway.url + "/oauth/external/start", {
      method: "POST",
      headers,
      body: new URLSearchParams({
        flow,
        csrf,
        server: social.url,
        provider: "github",
      }),
    });
    const html = await response.text();
    expect(html).toContain("https://github.com/login/oauth/authorize");
    expect(html).not.toContain("pollSecret");
    const pending = await fetch(gateway.url + "/oauth/external/finish", {
      method: "POST",
      headers,
      body: new URLSearchParams({ flow, csrf }),
    });
    expect(await pending.text()).toContain("登录尚未完成");
    // Seed the persisted state produced by a verified provider callback. No provider network call is simulated.
    const row = (
      await db.all<{ id: string; secret: string }>(
        "SELECT id,secret FROM login_flows WHERE provider='github'",
      )
    )[0];
    const cipher = new AccountCipher(vaultKey),
      context = "showai-login:" + row.id;
    const secret = await cipher.open<Record<string, unknown>>(
      context,
      row.secret,
    );
    // The callback binds the provider identity and shows a one-time completion code.
    await db.run(
      "INSERT INTO login_identities(provider,subject,user_id,email,created_at) VALUES('github','social-subject',?,NULL,?)",
      [user.user.id, new Date().toISOString()],
    );
    const code = "ABCD2345";
    await db.run(
      "UPDATE login_flows SET status='completed',secret=? WHERE id=?",
      [
        await cipher.seal(context, {
          ...secret,
          externalIdentity: { subject: "social-subject", name: "social-user" },
          completionDigest: await hash(`${row.id}:${code}`),
        }),
        row.id,
      ],
    );
    // Without a code the gateway only checks status and asks for the code.
    const awaiting = await fetch(gateway.url + "/oauth/external/finish", {
      method: "POST",
      headers,
      body: new URLSearchParams({ flow, csrf }),
    });
    const prompt = await awaiting.text();
    expect(prompt).toContain("请输入登录页面显示的完成码");
    expect(prompt).toContain('name="completionCode"');
    const finish = await fetch(gateway.url + "/oauth/external/finish", {
      method: "POST",
      headers,
      body: new URLSearchParams({ flow, csrf, completionCode: "abcd-2345" }),
    });
    const consent = await finish.text();
    expect(consent).toContain("social-user");
    expect(consent).toContain('value="account"');
    expect(consent).not.toContain(user.token);
  } finally {
    db.close();
    await gateway.close();
    await social.close();
  }
});

test("a real browser completes provider start and password consent back to the client redirect", async () => {
  const root = join(directory, "browser-auth-server");
  const social = await startSyncServer({
    home: root,
    port: 0,
    vaultKey: "f".repeat(64),
    githubLogin: { clientId: "test-client", clientSecret: "test-secret" },
    registrationKey: "browser-test-register",
  });
  const gateway = await startMcpHttpServer({
    stateDirectory: join(directory, "browser-auth-gateway"),
    syncServers: [social.url],
    port: 0,
  });
  // The registered client redirect is a separate origin, like chatgpt.com.
  const received: string[] = [];
  const callback = createServer((request, response) => {
    received.push(request.url!);
    response.end("returned");
  });
  await new Promise<void>((done) => callback.listen(0, "127.0.0.1", done));
  const address = callback.address();
  if (!address || typeof address === "string")
    throw new Error("Callback server unavailable");
  const redirect = `http://localhost:${address.port}/callback`;
  const browser = await chromium.launch({
    executablePath: await readingBrowserExecutable(),
  });
  try {
    await post(social.url + "/api/auth/register", {
      name: "browser-user",
      password: "browser-test-password-123",
      registrationKey: "browser-test-register",
    });
    const registration = await post(gateway.url + "/oauth/register", {
      client_name: "Browser client",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    });
    const query = new URLSearchParams({
      client_id: registration.client_id,
      response_type: "code",
      redirect_uri: redirect,
      code_challenge: createHash("sha256")
        .update("browser-verifier")
        .digest("base64url"),
      code_challenge_method: "S256",
      scope: "projects.read projects.write",
      state: "browser-state",
    });
    const page = await browser.newPage();
    await page.goto(gateway.url + "/oauth/authorize?" + query);
    // Browser form posts carry the page's real Origin header.
    await page.getByRole("button", { name: "使用 GitHub 登录" }).click();
    await page.getByLabel("完成码").waitFor();
    expect(
      await page
        .getByRole("link", { name: "打开登录页面" })
        .getAttribute("href"),
    ).toContain("https://github.com/login/oauth/authorize");
    await page.getByRole("button", { name: "重新选择登录方式" }).click();
    await page.getByLabel("账号").fill("browser-user");
    await page.getByLabel("密码").fill("browser-test-password-123");
    await page.getByRole("button", { name: "使用账号密码登录" }).click();
    // The consent redirect leaves for the client's origin after the form post.
    await Promise.all([
      page.waitForURL((url) => url.href.startsWith(redirect)),
      page.getByRole("button", { name: "确认授权" }).click(),
    ]);
    const returned = new URL(received.at(-1)!, redirect);
    expect(returned.searchParams.get("state")).toBe("browser-state");
    expect(returned.searchParams.get("code")).toBeTruthy();
  } finally {
    await browser.close();
    await new Promise<void>((done) => callback.close(() => done()));
    await gateway.close();
    await social.close();
  }
});
