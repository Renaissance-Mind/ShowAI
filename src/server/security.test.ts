import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SQLiteMetadata, startSyncServer } from "./node";
import { hash, syncProtocol, type ProjectSnapshot } from "../sync/protocol";
import { passwordHash } from "./security";
import { SyncManager } from "../sync/manager";
import { GitLibrary } from "../core/git-library";
import { FileStore } from "../core/store";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture(accountLimit = 10000) {
  const home = await mkdtemp(join(tmpdir(), "showai-security-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const options = {
    home,
    port: 0,
    registrationKey: "contract-key",
    allowedOrigins: ["https://workbench.test"],
    accountLimit,
  };
  const first = await startSyncServer(options),
    second = await startSyncServer(options);
  cleanup.push(
    () => first.close(),
    () => second.close(),
  );
  const metadata = new SQLiteMetadata(join(home, "metadata.sqlite"));
  cleanup.push(async () => metadata.close());
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    credential?: string,
    url = first.url,
    extraHeaders: Record<string, string> = {},
  ) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...extraHeaders,
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: response.status,
      headers: response.headers,
      value: response.status === 204 ? null : await response.json(),
    };
  };
  const register = async (name: string, password = "test-password") => {
    const result = await request("/api/auth/register", "POST", {
      name,
      password,
      registrationKey: "contract-key",
    });
    expect(result.status).toBe(201);
    return result.value as {
      user: { id: string; name: string };
      token: string;
      expiresAt: string;
    };
  };
  return { home, first, second, metadata, request, register };
}

test("controlled registration, password bytes, legacy hashes and audit records are enforced", async () => {
  const f = await fixture();
  expect(
    (
      await f.request("/api/auth/register", "POST", {
        name: "closed",
        password: "test-password",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await f.request("/api/auth/register", "POST", {
        name: "short",
        password: "four",
        registrationKey: "contract-key",
      })
    ).status,
  ).toBe(400);
  const password = "  meaningful password  ",
    user = await f.register("owner", password);
  for (const name of ["owner", "unknown"])
    expect(
      (
        await f.request("/api/auth/register", "POST", {
          name,
          password: "test-password",
          invite: "a".repeat(64),
        })
      ).status,
    ).toBe(403);
  expect(
    (await f.request("/api/auth/login", "POST", { name: "owner", password }))
      .status,
  ).toBe(200);
  expect(
    (
      await f.request("/api/auth/login", "POST", {
        name: "owner",
        password: password.trim(),
      })
    ).status,
  ).toBe(401);
  const salt = "b".repeat(64),
    saved = (await passwordHash("old4", salt)).split("$").at(-1)!;
  await f.metadata.run(
    "INSERT INTO users(id,name,password_salt,password_hash,created_at) VALUES('legacy','legacy',?,?,?)",
    [salt, saved, new Date().toISOString()],
  );
  expect(
    (
      await f.request("/api/auth/login", "POST", {
        name: "legacy",
        password: " old4 ",
      })
    ).status,
  ).toBe(200);
  const legacy = (
    await f.metadata.all<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id='legacy'",
    )
  )[0];
  expect(legacy.password_hash.startsWith("pbkdf2-sha256$100000$")).toBe(true);
  expect(
    (
      await f.request("/api/auth/login", "POST", {
        name: "legacy",
        password: " old4 ",
      })
    ).status,
  ).toBe(200);
  const rows = await f.metadata.all<{ details: string }>(
    "SELECT details FROM audit_events",
  );
  expect(rows.length).toBeGreaterThan(0);
  expect(
    rows.some(
      (row) =>
        row.details.includes(password) || row.details.includes(user.token),
    ),
  ).toBe(false);
});

test("account and trusted-source limits are atomic across two real server instances and recover after expiry", async () => {
  const f = await fixture(),
    owner = await f.register("owner");
  const attempts = await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      f.request(
        "/api/auth/login",
        "POST",
        { name: "owner", password: "wrong-password" },
        undefined,
        index % 2 ? f.first.url : f.second.url,
      ),
    ),
  );
  expect(attempts.filter((result) => result.status === 401)).toHaveLength(12);
  expect(attempts.filter((result) => result.status === 429)).toHaveLength(12);
  expect(
    attempts
      .filter((result) => result.status === 429)
      .every((result) => Number(result.headers.get("retry-after")) > 0),
  ).toBe(true);
  const names = await Promise.all(
    Array.from({ length: 97 }, (_, index) =>
      f.request(
        "/api/auth/login",
        "POST",
        { name: `unknown-${index}`, password: "wrong-password" },
        undefined,
        f.second.url,
        {
          "x-forwarded-for": `192.0.2.${index}`,
          "cf-connecting-ip": `192.0.2.${index}`,
        },
      ),
    ),
  );
  expect(names.filter((result) => result.status === 401)).toHaveLength(96);
  expect(names.filter((result) => result.status === 429)).toHaveLength(1);
  await f.metadata.run("UPDATE request_limits SET expires_at=0");
  expect(
    (
      await f.request("/api/auth/login", "POST", {
        name: owner.user.name,
        password: "test-password",
      })
    ).status,
  ).toBe(200);
  const identity = await hash(JSON.stringify(["login:account", "owner"]));
  expect(
    (
      await f.metadata.all<{ hits: number }>(
        "SELECT hits FROM request_limits WHERE key=?",
        [identity],
      )
    )[0].hits,
  ).toBe(1);
});

test("session expiry, individual revocation, password rotation and logout-all preserve independent account access", async () => {
  const f = await fixture(),
    owner = await f.register("owner"),
    other = await f.register("other");
  const login = await f.request("/api/auth/login", "POST", {
    name: "owner",
    password: "test-password",
  });
  expect(Date.parse(owner.expiresAt) - Date.now()).toBeGreaterThan(
    29 * 86400_000,
  );
  expect(Date.parse(owner.expiresAt) - Date.now()).toBeLessThanOrEqual(
    30 * 86400_000,
  );
  await f.metadata.run(
    "UPDATE sessions SET expires_at='2000-01-01' WHERE digest=?",
    [await hash(owner.token)],
  );
  expect(
    (await f.request("/api/me", "GET", undefined, owner.token)).status,
  ).toBe(401);
  const active = login.value.token as string;
  const wrong = await f.request(
    "/api/auth/password",
    "POST",
    { currentPassword: "wrong-password", newPassword: "new-test-password" },
    active,
  );
  expect(wrong.status).toBe(401);
  const changed = await f.request(
    "/api/auth/password",
    "POST",
    { currentPassword: "test-password", newPassword: "new-test-password" },
    active,
  );
  expect(changed.status).toBe(200);
  expect((await f.request("/api/me", "GET", undefined, active)).status).toBe(
    401,
  );
  expect(
    (await f.request("/api/me", "GET", undefined, other.token)).status,
  ).toBe(200);
  expect(
    (
      await f.request("/api/auth/login", "POST", {
        name: "owner",
        password: "test-password",
      })
    ).status,
  ).toBe(401);
  const session = await f.request("/api/auth/login", "POST", {
    name: "owner",
    password: "new-test-password",
  });
  expect(session.status).toBe(200);
  expect(
    (
      await f.request(
        "/api/sessions/revoke",
        "POST",
        { digest: await hash(other.token) },
        changed.value.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (await f.request("/api/me", "GET", undefined, other.token)).status,
  ).toBe(200);
  expect(
    (
      await f.request(
        "/api/sessions/revoke-all",
        "POST",
        {},
        changed.value.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (await f.request("/api/me", "GET", undefined, changed.value.token)).status,
  ).toBe(401);
  expect(
    (await f.request("/api/me", "GET", undefined, session.value.token)).status,
  ).toBe(401);
});

test("single-use registration claims are atomic, directed claims are scoped, and member removal can revoke related links", async () => {
  const f = await fixture(),
    owner = await f.register("owner"),
    target = await f.register("target"),
    outsider = await f.register("outsider");
  await f.request(
    "/api/projects",
    "POST",
    { id: "project", name: "Project" },
    owner.token,
  );
  const single = await f.request(
    "/api/projects/project/invites",
    "POST",
    { role: "viewer", maxUses: 1 },
    owner.token,
  );
  const inviteCount = (
    await f.metadata.all<{ count: number }>(
      "SELECT COUNT(*) AS count FROM invites",
    )
  )[0].count;
  expect(
    (
      await f.request(
        "/api/projects/project/invites",
        "POST",
        { role: "viewer", targetName: "unregistered-target" },
        owner.token,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await f.metadata.all<{ count: number }>(
        "SELECT COUNT(*) AS count FROM invites",
      )
    )[0].count,
  ).toBe(inviteCount);
  const claims = await Promise.all(
    ["first", "second"].map((name) =>
      f.request("/api/auth/register", "POST", {
        name,
        password: "test-password",
        invite: single.value.invite,
      }),
    ),
  );
  expect(claims.map((result) => result.status).sort()).toEqual([201, 403]);
  expect(
    (
      await f.metadata.all<{ count: number }>(
        "SELECT COUNT(*) AS count FROM users",
      )
    )[0].count,
  ).toBe(4);
  expect(
    (
      await f.request("/api/invites/preview", "POST", {
        invite: single.value.invite,
      })
    ).status,
  ).toBe(410);
  const directed = await f.request(
    "/api/projects/project/invites",
    "POST",
    { role: "editor", targetName: "target", maxUses: 1 },
    owner.token,
  );
  expect(
    (
      await f.request(
        "/api/invites/accept",
        "POST",
        { invite: directed.value.invite },
        outsider.token,
      )
    ).status,
  ).toBe(410);
  expect(
    (
      await f.request(
        "/api/invites/accept",
        "POST",
        { invite: directed.value.invite },
        target.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request(
        "/api/invites/accept",
        "POST",
        { invite: directed.value.invite },
        target.token,
      )
    ).status,
  ).toBe(200);
  const shared = await f.request(
    "/api/projects/project/invites",
    "POST",
    { role: "viewer", maxUses: null },
    owner.token,
  );
  expect(
    (
      await f.request(
        "/api/invites/accept",
        "POST",
        { invite: shared.value.invite },
        target.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request(
        "/api/projects/project/members",
        "PATCH",
        { userId: target.user.id, role: null, revokeInvites: true },
        owner.token,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await f.request(
        "/api/invites/accept",
        "POST",
        { invite: shared.value.invite },
        outsider.token,
      )
    ).status,
  ).toBe(410);
  expect(
    (await f.request("/api/projects/project", "GET", undefined, target.token))
      .status,
  ).toBe(403);
});

test("HTTP origins and request bodies are bounded while approved CORS and credential-free headers remain usable", async () => {
  const f = await fixture();
  expect(
    (
      await f.request("/api/info", "GET", undefined, undefined, f.first.url, {
        origin: "https://untrusted.test",
      })
    ).status,
  ).toBe(403);
  const cors = await f.request(
    "/api/info",
    "OPTIONS",
    undefined,
    undefined,
    f.first.url,
    { origin: "https://workbench.test" },
  );
  expect(cors.status).toBe(204);
  expect(cors.headers.get("access-control-allow-origin")).toBe(
    "https://workbench.test",
  );
  expect(cors.headers.get("x-content-type-options")).toBe("nosniff");
  expect(cors.headers.get("referrer-policy")).toBe("no-referrer");
  const large = await f.request("/api/auth/register", "POST", {
    name: "large",
    password: "test-password",
    padding: "x".repeat(70_000),
  });
  expect(large.status).toBe(413);
});

test("concurrent registration respects the configured total account capacity", async () => {
  const f = await fixture(1);
  const attempts = await Promise.all(
    ["one", "two"].map((name) =>
      f.request("/api/auth/register", "POST", {
        name,
        password: "test-password",
        registrationKey: "contract-key",
      }),
    ),
  );
  expect(attempts.map((attempt) => attempt.status).sort()).toEqual([201, 507]);
  expect(
    (
      await f.metadata.all<{ count: number }>(
        "SELECT COUNT(*) AS count FROM users",
      )
    )[0].count,
  ).toBe(1);
});

test("editor snapshots cannot bypass administrator-only project archive settings", async () => {
  const f = await fixture(),
    owner = await f.register("owner"),
    editor = await f.register("editor");
  await f.request(
    "/api/projects",
    "POST",
    { id: "project", name: "Project" },
    owner.token,
  );
  const invite = await f.request(
    "/api/projects/project/invites",
    "POST",
    { role: "editor" },
    owner.token,
  );
  await f.request(
    "/api/invites/accept",
    "POST",
    { invite: invite.value.invite },
    editor.token,
  );
  const bytes = Buffer.from(
      JSON.stringify({ id: "project", name: "Project", archived: true }),
    ),
    digest = await hash(bytes);
  expect(
    (
      await fetch(f.first.url + `/api/projects/project/objects/${digest}`, {
        method: "PUT",
        headers: { authorization: `Bearer ${editor.token}` },
        body: Uint8Array.from(bytes),
      })
    ).status,
  ).toBe(200);
  const snapshot: ProjectSnapshot = {
    format: syncProtocol,
    projectId: "project",
    parents: [],
    files: { "projects/project/project.json": digest },
    change: {
      at: new Date().toISOString(),
      actor: { kind: "human" },
      channel: "cli",
      operationId: "editor-archive",
      paths: ["projects/project/project.json"],
    },
  };
  expect(
    (
      await f.request(
        "/api/projects/project/revisions",
        "POST",
        { snapshot, expected: null },
        editor.token,
      )
    ).status,
  ).toBe(403);
  expect(
    (await f.request("/api/projects/project", "GET", undefined, owner.token))
      .value.head,
  ).toBeNull();
  expect(
    (
      await f.request(
        "/api/projects/project",
        "PATCH",
        { archived: true },
        owner.token,
      )
    ).status,
  ).toBe(200);
});

test("an expired session preserves local editing and queued changes until normal re-login", async () => {
  const f = await fixture(),
    account = await f.register("owner"),
    home = join(f.home, "client");
  await new GitLibrary(home).initialize();
  const manager = new SyncManager(home),
    store = new FileStore(home);
  cleanup.push(() => manager.stop());
  const connection = await manager.connect({
    url: f.first.url,
    account: account.user.name,
    password: "test-password",
  });
  await manager.stop();
  const project = await store.createProject({ name: "Offline edits" });
  await manager.attach(connection.id, project.id);
  await manager.stop();
  await f.metadata.run(
    "UPDATE sessions SET expires_at='2000-01-01' WHERE user_id=?",
    [account.user.id],
  );
  await manager.run();
  expect((await manager.status()).projects[0].status).toBe("offline");
  const page = await store.createPage(project.id, {
    title: "Saved while login expired",
  });
  expect(
    (await store.readPage(project.id, page.document.id)).document.title,
  ).toBe("Saved while login expired");
  await manager.connect({
    url: f.first.url,
    account: account.user.name,
    password: "test-password",
  });
  await manager.stop();
  await manager.run();
  expect((await manager.status()).projects[0].status).toBe("synced");
});
