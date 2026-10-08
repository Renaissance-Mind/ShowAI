import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startSyncServer } from "../server/node";
import { AgentService } from "./service";
import { syncManager } from "../sync/manager";
import { startMcpHttpServer } from "./mcp-http";

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
async function authorize(scope = "projects.read projects.write") {
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
  expect((catalog.items as unknown[]).length).toBe(3);
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
    uri: "ui://showai/reader-v1.html",
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
      document: { ...initial.document, title: "Stale replacement" },
      baseHash: initial.hash,
      baseRevision: initial.revision,
    },
  });
  const retained = data(stale) as {
    document: { id: string };
    retainedSyncConflicts: { variants: { pageId: string; title: string }[] }[];
  };
  expect(retained.document.id).not.toBe(record.document.id);
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
