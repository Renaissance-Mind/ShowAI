import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteMetadata, startSyncServer } from "./node";
import { token } from "../sync/protocol";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const action of cleanup.splice(0).reverse()) await action();
});
const passthrough = globalThis.fetch;

/** A local server whose GitHub and Resend calls are answered in-process. */
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "showai-login-security-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const proxyKey = token();
  const server = await startSyncServer({
    home,
    port: 0,
    registrationKey: "contract-key",
    githubLogin: { clientId: "github-test", clientSecret: "github-fixture" },
    emailLogin: { apiKey: "resend-fixture", from: "ShowAI <a@example.test>" },
    trustedProxyKey: proxyKey,
  });
  cleanup.push(() => server.close());
  const metadata = new SQLiteMetadata(join(home, "metadata.sqlite"));
  cleanup.push(async () => metadata.close());
  const github = { id: 4242, login: "octo" },
    mail: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://github.com/login/oauth/access_token")
      return Response.json({ access_token: "github-access" });
    if (url === "https://api.github.com/user") return Response.json(github);
    if (url === "https://api.resend.com/emails") {
      mail.push(JSON.parse(String(init?.body)).text);
      return Response.json({ id: "sent" });
    }
    return passthrough(input, init);
  });
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    credential?: string,
    source?: string,
  ) => {
    const response = await fetch(server.url + path, {
      method,
      headers: {
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
        ...(source
          ? { "x-showai-client-ip": source, "x-showai-proxy-key": proxyKey }
          : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    const text = await response.text();
    let value: any = text;
    try {
      value = JSON.parse(text);
    } catch {}
    return { status: response.status, value };
  };
  /** Authorizes a started GitHub flow in "a browser" and returns the page. */
  const authorize = async (url: string) => {
    const state = new URL(url).searchParams.get("state")!;
    return request(`/api/auth/callback/github?state=${state}&code=granted`);
  };
  const completion = (page: string) =>
    page.match(/>([A-Z2-9]{4})-([A-Z2-9]{4})</)!.slice(1).join("");
  return { server, metadata, github, mail, request, authorize, completion };
}

test("a forwarded authorization link never signs in the device that started it", async () => {
  const f = await fixture();
  const started = await f.request("/api/auth/start", "POST", {
    provider: "github",
    registrationKey: "contract-key",
    device: "Attacker device",
  });
  expect(started.status).toBe(200);
  // The victim completes authorization in their own browser.
  const page = await f.authorize(started.value.url);
  expect(page.status).toBe(200);
  expect(page.value).toContain("Attacker device");
  expect(page.value).toContain("showai://login?flow=");
  const poll = (completionCode?: string) =>
    f.request("/api/auth/finish", "POST", {
      id: started.value.id,
      pollSecret: started.value.pollSecret,
      completionCode,
    });
  expect((await poll()).value).toEqual({ status: "confirm" });
  for (let attempt = 0; attempt < 5; attempt++)
    expect((await poll("AAAA-AAAA")).value.error.code).toBe(
      "INVALID_COMPLETION_CODE",
    );
  // After five guesses even the real code is refused and no account exists.
  expect((await poll(f.completion(page.value))).value.error.code).toBe(
    "LOGIN_FAILED",
  );
  expect(
    await f.metadata.all("SELECT 1 FROM login_identities WHERE provider='github'"),
  ).toHaveLength(0);
});

test("the starting window finishes a provider login with the browser completion code", async () => {
  const f = await fixture();
  const started = await f.request("/api/auth/start", "POST", {
    provider: "github",
    registrationKey: "contract-key",
  });
  const page = await f.authorize(started.value.url);
  const finish = () =>
    f.request("/api/auth/finish", "POST", {
      id: started.value.id,
      pollSecret: started.value.pollSecret,
      completionCode: f.completion(page.value).toLowerCase(),
    });
  const first = await finish();
  expect(first.value.status).toBe("completed");
  expect(first.value.user.name).toBe("octo");
  // A lost response may be repeated briefly with the same credential.
  expect((await finish()).value.token).toBe(first.value.token);
  expect(
    (await f.request("/api/me", "GET", undefined, first.value.token)).status,
  ).toBe(200);
});

test("lasting credentials and login methods need a recent direct sign-in", async () => {
  const f = await fixture();
  const owner = await f.request("/api/auth/register", "POST", {
    name: "owner",
    password: "test-password",
    registrationKey: "contract-key",
  });
  const credential = owner.value.token as string;
  const fresh = await f.request(
    "/api/account/tokens",
    "POST",
    { device: "CLI" },
    credential,
  );
  expect(fresh.status).toBe(201);
  // Age every session past the recent sign-in window.
  await f.metadata.run(
    "UPDATE sessions SET created_at=? WHERE user_id=?",
    [new Date(Date.now() - 20 * 60_000).toISOString(), owner.value.user.id],
  );
  for (const attempt of [
    () =>
      f.request("/api/account/tokens", "POST", { device: "CLI" }, credential),
    () =>
      f.request(
        "/api/auth/start",
        "POST",
        { provider: "github" },
        credential,
      ),
    () =>
      f.request(
        "/api/auth/start",
        "POST",
        { provider: "github" },
        fresh.value.token,
      ),
  ])
    expect((await attempt()).value.error.code).toBe("RECENT_SIGN_IN_REQUIRED");
  // A federated session may never mint lasting credentials, even when fresh.
  await f.metadata.run(
    "UPDATE sessions SET created_at=?,credential_kind='federated' WHERE digest IN(SELECT digest FROM sessions WHERE user_id=? LIMIT 1)",
    [new Date().toISOString(), owner.value.user.id],
  );
  const login = await f.request("/api/auth/login", "POST", {
    name: "owner",
    password: "test-password",
  });
  await f.metadata.run(
    "UPDATE sessions SET credential_kind='federated' WHERE user_id=? AND created_at>?",
    [owner.value.user.id, new Date(Date.now() - 60_000).toISOString()],
  );
  expect(
    (
      await f.request(
        "/api/account/tokens",
        "POST",
        { device: "CLI" },
        login.value.token,
      )
    ).value.error.code,
  ).toBe("RECENT_SIGN_IN_REQUIRED");
});

test("bound login methods are listed and removable, keeping one for provider accounts", async () => {
  const f = await fixture();
  const started = await f.request("/api/auth/start", "POST", {
    provider: "github",
    registrationKey: "contract-key",
  });
  const page = await f.authorize(started.value.url);
  const signedIn = await f.request("/api/auth/finish", "POST", {
    id: started.value.id,
    pollSecret: started.value.pollSecret,
    completionCode: f.completion(page.value),
  });
  const credential = signedIn.value.token as string;
  // Add an email login with the fresh session.
  const email = await f.request(
    "/api/auth/start",
    "POST",
    { provider: "email", email: "octo@example.test" },
    credential,
  );
  const code = f.mail.at(-1)!.match(/(\d{8})/)![1];
  expect(
    (
      await f.request("/api/auth/finish", "POST", {
        id: email.value.id,
        pollSecret: email.value.pollSecret,
        code,
      })
    ).value.status,
  ).toBe("completed");
  const listed = await f.request("/api/account/logins", "GET", undefined, credential);
  expect(listed.value.map((item: { provider: string }) => item.provider).sort()).toEqual([
    "email",
    "github",
  ]);
  const remove = (provider: string, subject: string) =>
    f.request(
      "/api/account/logins",
      "DELETE",
      { provider, subject },
      credential,
    );
  expect((await remove("email", "octo@example.test")).status).toBe(200);
  // The provider-created account keeps its last login method.
  expect((await remove("github", String(f.github.id))).value.error.code).toBe(
    "LOGIN_REMOVAL_REFUSED",
  );
  expect(
    (await f.request("/api/account/logins", "GET", undefined, credential)).value,
  ).toHaveLength(1);
});

test("revoked sessions are reported distinctly from expired ones", async () => {
  const f = await fixture();
  const owner = await f.request("/api/auth/register", "POST", {
    name: "owner",
    password: "test-password",
    registrationKey: "contract-key",
  });
  const second = await f.request("/api/auth/login", "POST", {
    name: "owner",
    password: "test-password",
  });
  await f.metadata.run("UPDATE sessions SET expires_at=? WHERE digest IN(SELECT digest FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 1)", [
    new Date(Date.now() - 1000).toISOString(),
    owner.value.user.id,
  ]);
  const expired = await f.request("/api/me", "GET", undefined, second.value.token);
  expect(expired.status).toBe(401);
  expect(expired.value.error.details).toBeUndefined();
  await f.request("/api/auth/logout", "POST", undefined, owner.value.token);
  const revoked = await f.request("/api/me", "GET", undefined, owner.value.token);
  expect(revoked.status).toBe(401);
  expect(revoked.value.error.details).toEqual({ reason: "revoked" });
});

test("strict account limits follow the source so others cannot lock the owner out", async () => {
  const f = await fixture();
  await f.request("/api/auth/register", "POST", {
    name: "owner",
    password: "test-password",
    registrationKey: "contract-key",
  });
  for (let attempt = 0; attempt < 12; attempt++)
    await f.request(
      "/api/auth/login",
      "POST",
      { name: "owner", password: "wrong" },
      undefined,
      "203.0.113.9",
    );
  expect(
    (
      await f.request(
        "/api/auth/login",
        "POST",
        { name: "owner", password: "wrong" },
        undefined,
        "203.0.113.9",
      )
    ).status,
  ).toBe(429);
  expect(
    (
      await f.request(
        "/api/auth/login",
        "POST",
        { name: "owner", password: "test-password" },
        undefined,
        "198.51.100.7",
      )
    ).status,
  ).toBe(200);
  for (let attempt = 0; attempt < 5; attempt++)
    expect(
      (
        await f.request(
          "/api/auth/start",
          "POST",
          { provider: "email", email: "victim@example.test", registrationKey: "contract-key" },
          undefined,
          "203.0.113.9",
        )
      ).status,
    ).toBe(200);
  expect(
    (
      await f.request(
        "/api/auth/start",
        "POST",
        { provider: "email", email: "victim@example.test" },
        undefined,
        "203.0.113.9",
      )
    ).status,
  ).toBe(429);
  expect(
    (
      await f.request(
        "/api/auth/start",
        "POST",
        { provider: "email", email: "victim@example.test" },
        undefined,
        "198.51.100.7",
      )
    ).status,
  ).toBe(200);
  // Forged client addresses without the proxy key all count as the connection.
  const forged = (address: string) =>
    fetch(f.server.url + "/api/auth/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-showai-client-ip": address,
        "x-showai-proxy-key": "0".repeat(64),
      },
      body: JSON.stringify({ provider: "email", email: "other@example.test" }),
    });
  for (let attempt = 0; attempt < 5; attempt++)
    expect((await forged(`192.0.2.${attempt}`)).status).toBe(200);
  expect((await forged("192.0.2.99")).status).toBe(429);
});
