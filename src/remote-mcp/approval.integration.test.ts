import { beforeAll, afterAll, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { AgentService } from "../agent/service";
import { startMcpHttpServer } from "../agent/mcp-http";
import { localLibraryPolicy } from "./local-library";
let root: string,
  service: AgentService,
  http: Awaited<ReturnType<typeof startMcpHttpServer>>;
const redirect = "http://127.0.0.1:12345/callback";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "showai-desktop-approval-"));
  service = new AgentService({ root: join(root, "library") });
  http = await startMcpHttpServer({
    port: 0,
    stateDirectory: join(root, "auth"),
    local: {
      root: service.store.root,
      ...localLibraryPolicy(service.store.root, {
        access: "all",
        projects: [],
      }),
      desktopApproval: true,
      consumePairingCode: () => false,
    },
  });
});
afterAll(async () => {
  await http.close();
  await rm(root, { recursive: true, force: true });
});
async function begin() {
  const registration = await fetch(http.url + "/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Approval integration",
      redirect_uris: [redirect],
      token_endpoint_auth_method: "none",
    }),
  }).then((r) => r.json());
  const verifier = randomBytes(32).toString("base64url");
  const response = await fetch(
    http.url +
      "/oauth/authorize?" +
      new URLSearchParams({
        client_id: registration.client_id,
        redirect_uri: redirect,
        response_type: "code",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        resource: http.url + "/mcp",
        scope: "projects.read projects.write projects.create",
        state: "preserved",
      }),
  );
  expect(response.status).toBe(200);
  const html = await response.text(),
    id = html.match(/name="flow" value="([^"]+)"/)![1],
    csrf = html.match(/name="csrf" value="([^"]+)"/)![1];
  expect(html).not.toContain('name="pairingCode"');
  expect(html).toContain("requestSubmit()");
  expect(response.headers.get("content-security-policy")).toContain(
    "script-src 'nonce-",
  );
  const headers = {
    "content-type": "application/x-www-form-urlencoded",
    cookie: response.headers.get("set-cookie")!.split(";")[0],
    origin: http.url,
  };
  return {
    id,
    csrf,
    headers,
    verifier,
    client: registration.client_id,
    poll: (decision = "wait", overrides = {}) =>
      fetch(http.url + "/oauth/consent", {
        method: "POST",
        headers: { ...headers, ...overrides },
        redirect: "manual",
        body: new URLSearchParams({ flow: id, csrf, decision }),
      }),
  };
}
test("HTTP callers cannot approve; a local click completes PKCE exactly once", async () => {
  const request = await begin();
  const pending = http.authorization
    .pendingApprovals()
    .find((r) => r.id === request.id)!;
  expect(pending.callbackOrigin).toBe("http://127.0.0.1:12345");
  expect(pending.access).toBe("all");
  expect((await request.poll("allow")).status).toBe(200);
  expect(http.authorization.connections()).toHaveLength(0);
  expect((await request.poll("wait", { cookie: "" })).status).toBe(400);
  expect(
    (await request.poll("wait", { origin: "https://attacker.invalid" })).status,
  ).toBe(403);
  http.authorization.decideApproval(request.id, "allow");
  expect(() =>
    http.authorization.decideApproval(request.id, "allow"),
  ).toThrow();
  const responses = await Promise.all([request.poll(), request.poll()]);
  expect(responses.map((r) => r.status).sort()).toEqual([302, 400]);
  const callback = new URL(
    responses.find((r) => r.status === 302)!.headers.get("location")!,
  );
  expect(callback.searchParams.get("state")).toBe("preserved");
  expect(http.authorization.connections()).toHaveLength(1);
  const tokenBody = {
    client_id: request.client,
    grant_type: "authorization_code",
    code: callback.searchParams.get("code")!,
    redirect_uri: redirect,
    code_verifier: request.verifier,
    resource: http.url + "/mcp",
  };
  const exchange = () =>
    fetch(http.url + "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenBody),
    });
  const tokens = await (await exchange()).json();
  expect(tokens.access_token).toBeTruthy();
  expect((await exchange()).status).toBe(400);
  const renew = () =>
    fetch(http.url + "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: request.client,
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
        resource: http.url + "/mcp",
      }),
    });
  http.authorization.revoke(http.authorization.connections()[0].id);
  expect((await renew()).status).toBe(400);
});
test("denial, browser cancellation and expiration never grant access", async () => {
  const denied = await begin();
  http.authorization.decideApproval(denied.id, "deny");
  expect(
    new URL((await denied.poll()).headers.get("location")!).searchParams.get(
      "error",
    ),
  ).toBe("access_denied");
  const canceled = await begin();
  expect((await canceled.poll("deny")).status).toBe(302);
  expect(http.authorization.pendingApprovals()).toHaveLength(0);
  const expired = await begin();
  const db = new DatabaseSync(
    join(root, "auth", "auth", "authorization.sqlite"),
  );
  db.prepare("UPDATE records SET expires=0 WHERE kind='flow' AND key=?").run(
    expired.id,
  );
  db.close();
  expect(() =>
    http.authorization.decideApproval(expired.id, "allow"),
  ).toThrow();
  expect((await expired.poll()).status).toBe(400);
  expect(http.authorization.connections()).toHaveLength(0);
});
test("restarting cancels pending prompts while preserving OAuth registrations", async () => {
  const approved = await begin();
  http.authorization.decideApproval(approved.id, "allow");
  const callback = new URL((await approved.poll()).headers.get("location")!);
  const tokens = await fetch(http.url + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: approved.client,
      grant_type: "authorization_code",
      code: callback.searchParams.get("code")!,
      redirect_uri: redirect,
      code_verifier: approved.verifier,
      resource: http.url + "/mcp",
    }),
  }).then((response) => response.json());
  const grant = http.authorization.verify(tokens.access_token);
  const request = await begin();
  const port = Number(new URL(http.localUrl).port);
  await http.close();
  http = await startMcpHttpServer({
    port,
    stateDirectory: join(root, "auth"),
    local: {
      root: service.store.root,
      ...localLibraryPolicy(service.store.root, {
        access: "all",
        projects: [],
      }),
      desktopApproval: true,
      consumePairingCode: () => false,
    },
  });
  expect(http.authorization.pendingApprovals()).toHaveLength(0);
  expect((await request.poll()).status).toBe(400);
  expect(http.authorization.verify(tokens.access_token).id).toBe(grant.id);
  const renewed = await fetch(http.url + "/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: approved.client,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      resource: http.url + "/mcp",
    }),
  }).then((response) => response.json());
  expect(http.authorization.verify(renewed.access_token).id).toBe(grant.id);
});
