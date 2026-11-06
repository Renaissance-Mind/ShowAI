import { afterAll, beforeAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentService } from "../agent/service";
import { startMcpHttpServer } from "../agent/mcp-http";
import { REMOTE_FETCH } from "../core/dataset-sources";
import { withDatasetAccess } from "../core/dataset-access";
import { parameterComponent } from "../test/parameter-component";

let directory: string;
let service: AgentService;
let http: Awaited<ReturnType<typeof startMcpHttpServer>>;
let selected: string, hidden: string;
let canWrite = true;
let pairingCode = "";
const clients: Client[] = [];
const authorizationOptions = () => ({
  root: service.store.root,
  projects: async () => [
    {
      id: selected,
      name: "Selected project",
      role: canWrite ? ("editor" as const) : ("viewer" as const),
    },
  ],
  consumePairingCode: (code: string) => {
    const valid = !!pairingCode && code === pairingCode;
    if (valid) pairingCode = "";
    return valid;
  },
});
async function client(token?: string) {
  const c = new Client({ name: "remote-local-test", version: "1" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(http.url + "/mcp"), {
      requestInit: {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    }),
  );
  clients.push(c);
  return c;
}
async function authorize(scope = "projects.read projects.write") {
  const redirect = "http://127.0.0.1:12345/callback";
  const registration = await fetch(http.url + "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Local acceptance",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  }).then((r) => r.json());
  const verifier = randomBytes(32).toString("base64url");
  const query = new URLSearchParams({
    client_id: registration.client_id,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    scope,
    state: "preserved",
    resource: http.url + "/mcp",
  });
  const start = await fetch(http.url + "/oauth/authorize?" + query);
  const html = await start.text();
  expect(start.status, html).toBe(200);
  const flow = html.match(/name="flow" value="([^"]+)"/)![1];
  const csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    cookie: start.headers.get("set-cookie")!.split(";")[0],
    origin: http.url,
  };
  const submit = (code: string, csrfValue = csrf) =>
    fetch(http.url + "/oauth/consent", {
      method: "POST",
      headers,
      redirect: "manual",
      body: new URLSearchParams({
        flow,
        csrf: csrfValue,
        pairingCode: code,
        decision: "allow",
      }),
    });
  pairingCode = randomBytes(18).toString("base64url");
  expect((await submit(pairingCode, "invalid-csrf")).status).toBe(400);
  expect(await (await submit("wrong-code")).text()).toMatch(
    /Invalid or expired pairing code|配对码无效/,
  );
  const consent = await submit(pairingCode);
  expect(consent.status, await consent.text()).toBe(302);
  expect(pairingCode).toBe("");
  const callback = new URL(consent.headers.get("location")!);
  expect(callback.searchParams.get("state")).toBe("preserved");
  expect(callback.searchParams.get("iss")).toBe(http.url);
  const tokenResponse = await fetch(http.url + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: registration.client_id,
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
      resource: http.url + "/mcp",
    }),
  });
  expect(tokenResponse.status).toBe(200);
  return tokenResponse.json() as Promise<{
    access_token: string;
    refresh_token: string;
  }>;
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "showai-local-mcp-"));
  service = new AgentService({ root: join(directory, "library") });
  selected = (await service.createProject("Selected project")).id;
  hidden = (await service.createProject("Unshared project")).id;
  const original = REMOTE_FETCH.publicAddressesOnly;
  http = await startMcpHttpServer({
    port: 0,
    stateDirectory: join(directory, "state"),
    local: authorizationOptions(),
  });
  expect(REMOTE_FETCH.publicAddressesOnly).toBe(original);
});
afterAll(async () => {
  for (const c of clients) await c.close();
  await http?.close();
  await rm(directory, { recursive: true, force: true });
});

test("local OAuth protects projects and saves real pages directly to the desktop library", async () => {
  const anonymous = await client();
  const tools = await anonymous.listTools();
  expect(tools.tools.some((t) => t.name === "project_create")).toBe(false);
  expect(
    (await anonymous.callTool({ name: "projects_list", arguments: {} }))
      .isError,
  ).toBe(true);
  const token = await authorize();
  const c = await client(token.access_token);
  const projects = await c.callTool({ name: "projects_list", arguments: {} });
  expect(projects.isError).not.toBe(true);
  expect(JSON.stringify(projects)).toContain(selected);
  expect(JSON.stringify(projects)).not.toContain(hidden);
  const privateComponent = await service.saveComponent(
    hidden,
    parameterComponent("unshared-component"),
  );
  const forbiddenFork = await c.callTool({
    name: "catalog_version",
    arguments: {
      projectId: selected,
      action: "fork",
      version: "2.0.0",
      ref: {
        kind: "component",
        id: privateComponent.id,
        version: privateComponent.version,
        integrity: privateComponent.integrity,
        scope: "project",
        projectId: hidden,
      },
    },
  });
  expect(forbiddenFork.isError).toBe(true);
  expect(
    JSON.stringify(
      await service.catalogList({
        projectId: selected,
        kind: "component",
        scope: "project",
      }),
    ),
  ).not.toContain("unshared-component");
  const confidential = await service.datasetCreate(hidden, {
    name: "Private source",
    value: { secret: "must-never-leave-unshared-project" },
  });
  const hiddenInput = await c.callTool({
    name: "dataset_write",
    arguments: {
      projectId: selected,
      action: "transform",
      dryRun: true,
      inputs: { source: { project: hidden, dataset: confidential.dataset.id } },
      script: "function transform(inputs) { return inputs.source; }",
    },
  });
  expect(JSON.stringify(hiddenInput)).not.toContain(
    "must-never-leave-unshared-project",
  );
  expect(hiddenInput.isError, JSON.stringify(hiddenInput)).toBe(true);
  await expect(
    withDatasetAccess(
      { root: service.store.root, read: new Set([hidden]), write: new Set() },
      () =>
        service.datasetApply(hidden, confidential.dataset.id, {
          baseHash: confidential.hash,
          operations: [{ op: "set", path: "secret", value: "changed" }],
        }),
    ),
  ).rejects.toThrow("permissions");
  expect(
    (await c.callTool({ name: "pages_list", arguments: { projectId: hidden } }))
      .isError,
  ).toBe(true);
  const created = await c.callTool({
    name: "page_create",
    arguments: {
      projectId: selected,
      title: "Created remotely",
      blocks: [
        {
          kind: "text",
          data: {
            format: "markdown",
            content: "Written directly to the local library.",
          },
        },
      ],
    },
  });
  expect(created.isError, JSON.stringify(created)).not.toBe(true);
  const pages = await service.listPages(selected);
  expect(JSON.stringify(pages)).toContain("Created remotely");
  canWrite = false;
  expect(
    (
      await c.callTool({
        name: "page_create",
        arguments: { projectId: selected, title: "Must fail" },
      })
    ).isError,
  ).toBe(true);
  canWrite = true;
  const grants = http.authorization.connections();
  http.authorization.revoke(grants[0].id);
  expect(
    (await c.callTool({ name: "projects_list", arguments: {} })).isError,
  ).toBe(true);
}, 30000);

test("read-only OAuth scope cannot write and persisted authorization survives a server restart", async () => {
  const token = await authorize("projects.read");
  const c = await client(token.access_token);
  expect(
    (
      await c.callTool({
        name: "page_create",
        arguments: { projectId: selected, title: "Must fail" },
      })
    ).isError,
  ).toBe(true);
  for (const c of clients.splice(0)) await c.close();
  const port = Number(new URL(http.url).port);
  await http.close();
  http = await startMcpHttpServer({
    port,
    stateDirectory: join(directory, "state"),
    local: authorizationOptions(),
  });
  const reconnected = await client(token.access_token);
  expect(
    (await reconnected.callTool({ name: "projects_list", arguments: {} }))
      .isError,
  ).not.toBe(true);
});
