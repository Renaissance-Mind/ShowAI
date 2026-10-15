import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteMetadata, startSyncServer } from "./node";
import { ExternalLogins } from "./external-logins";
import { hash, token } from "../sync/protocol";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "showai-account-flow-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const vaultKey = token();
  const server = await startSyncServer({
    home,
    port: 0,
    vaultKey,
    registrationKey: "owner-key",
  });
  cleanup.push(() => server.close());
  const db = new SQLiteMetadata(join(home, "metadata.sqlite"));
  cleanup.push(async () => db.close());
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    credential?: string,
  ) {
    const response = await fetch(server.url + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, value: (await response.json()) as any };
  }
  const owner = (
    await request("/api/auth/continue", "POST", {
      name: "Owner",
      password: "test-password",
      registrationKey: "owner-key",
    })
  ).value;
  const project = (
    await request(
      "/api/projects",
      "POST",
      { name: "Invitation project" },
      owner.token,
    )
  ).value;
  async function invite(input: Record<string, unknown> = {}) {
    return (
      await request(
        `/api/projects/${project.id}/invites`,
        "POST",
        { role: "viewer", maxUses: 1, ...input },
        owner.token,
      )
    ).value;
  }
  return { server, db, vaultKey, owner, project, request, invite };
}

test("continue identifies existing accounts and an invitation creates a new member atomically", async () => {
  const f = await fixture();
  const existing = await f.request("/api/auth/continue", "POST", {
    name: "Owner",
    password: "test-password",
  });
  expect(existing.value.user.id).toBe(f.owner.user.id);
  expect(
    (
      await f.request("/api/auth/continue", "POST", {
        name: "Owner",
        password: "wrong-password",
        registrationKey: "owner-key",
      })
    ).status,
  ).toBe(401);
  const invitation = await f.invite();
  const first = await f.request("/api/auth/continue", "POST", {
    name: "Guest",
    password: "test-password",
    invite: invitation.invite,
  });
  expect(first.status).toBe(201);
  const accepted = await f.request(
    "/api/invites/accept",
    "POST",
    { invite: invitation.invite },
    first.value.token,
  );
  expect(accepted.value.id).toBe(f.project.id);
  expect(accepted.value.role).toBe("viewer");
  expect(
    (
      await f.request("/api/auth/continue", "POST", {
        name: "Extra",
        password: "test-password",
        invite: invitation.invite,
      })
    ).status,
  ).toBe(403);
  expect(await f.db.all("SELECT 1 FROM users WHERE name='Extra'")).toHaveLength(
    0,
  );
});

test("verified external identities use invitation eligibility and preserve account identity on return", async () => {
  const f = await fixture();
  const invitation = await f.invite({ role: "editor" });
  const logins = new ExternalLogins(
    f.db,
    new (await import("./sessions")).Sessions(
      f.db,
      async () => (await f.request("/api/info")).value.serverId,
    ),
    { vaultKey: f.vaultKey, registrationKey: "owner-key" },
  );
  const flow = {
    verifier: "",
    nonce: "",
    redirectUri: "",
    device: "Test device",
    invite: invitation.invite,
  };
  const identity = {
    subject: "verified-external-id",
    name: "External reader",
    email: "verified@example.test",
  };
  const user = await logins["externalUser"]("email", identity, flow);
  expect(
    await f.db.all(
      "SELECT role FROM members WHERE project_id=? AND user_id=?",
      [f.project.id, user.id],
    ),
  ).toEqual([{ role: "editor" }]);
  expect((await logins["externalUser"]("email", identity, flow)).id).toBe(
    user.id,
  );
  await expect(
    logins["externalUser"]("email", { ...identity, subject: "second" }, flow),
  ).rejects.toMatchObject({ code: "INVITE_UNAVAILABLE" });
  expect(
    await f.db.all("SELECT 1 FROM login_identities WHERE subject='second'"),
  ).toHaveLength(0);
});

test("admins can retrieve encrypted invitation links, viewers cannot, and existing membership keeps its role", async () => {
  const f = await fixture();
  const invitation = await f.invite();
  const digest = await hash(invitation.invite);
  const saved = await f.db.all<{ value: string }>(
    "SELECT value FROM settings WHERE key=?",
    [`invite-link:${digest}`],
  );
  expect(saved[0].value).not.toContain(invitation.invite);
  expect(saved[0].value.startsWith("v1.")).toBe(true);
  const listing = await f.request(
    `/api/projects/${f.project.id}/invites`,
    "GET",
    undefined,
    f.owner.token,
  );
  expect(listing.value[0].url).toBe(invitation.url);
  const viewer = (
    await f.request("/api/auth/continue", "POST", {
      name: "Viewer",
      password: "test-password",
      invite: invitation.invite,
    })
  ).value;
  expect(
    (
      await f.request(
        `/api/projects/${f.project.id}/invites`,
        "GET",
        undefined,
        viewer.token,
      )
    ).status,
  ).toBe(403);
  const ownerAccept = await f.request(
    "/api/invites/accept",
    "POST",
    { invite: invitation.invite },
    f.owner.token,
  );
  expect(ownerAccept.value.role).toBe("admin");
  const preview = await f.request(
    "/api/invites/preview",
    "POST",
    { invite: invitation.invite },
    f.owner.token,
  );
  expect(preview.value.invitedBy).toBe("Owner");
  await f.request(
    `/api/projects/${f.project.id}/invites/revoke`,
    "POST",
    { digest },
    f.owner.token,
  );
  const revoked = await f.request(
    `/api/projects/${f.project.id}/invites`,
    "GET",
    undefined,
    f.owner.token,
  );
  expect(revoked.value[0].url).toBeUndefined();
});
