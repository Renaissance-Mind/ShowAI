import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQLiteMetadata, startSyncServer } from "./node";
import { hash, syncProtocol, type ProjectSnapshot } from "../sync/protocol";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0).reverse()) await action();
});
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), "showai-server-"));
  cleanup.push(() => rm(home, { recursive: true, force: true }));
  const running = await startSyncServer({
    home,
    port: 0,
    registrationKey: "testing-key",
  });
  cleanup.push(() => running.close());
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    token?: string,
  ) => {
    const response = await fetch(running.url + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, value: await response.json() };
  };
  const register = async (name: string) =>
    (
      await request("/api/auth/register", "POST", {
        name,
        password: "test-password",
        registrationKey: "testing-key",
      })
    ).value;
  const admin = await register("admin");
  await request(
    "/api/projects",
    "POST",
    { id: "project-one", name: "Project One" },
    admin.token,
  );
  return { ...running, home, request, register, admin };
}
describe("portable project server with real SQLite and disk storage", () => {
  it("shares an invitation across accounts and preserves removed membership", async () => {
    const f = await fixture(),
      editor = await f.register("editor"),
      viewer = await f.register("viewer");
    const info = await f.request("/api/info");
    expect(info.value.roles).toEqual(["admin", "editor", "viewer"]);
    const invite = await f.request(
      "/api/projects/project-one/invites",
      "POST",
      { role: "editor" },
      f.admin.token,
    );
    expect(invite.status).toBe(201);
    const accepted = await f.request(
      "/api/invites/accept",
      "POST",
      { invite: invite.value.invite },
      editor.token,
    );
    expect(accepted.value.role).toBe("editor");
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invite.value.invite },
          editor.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invite.value.invite },
          viewer.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.request(
          "/api/projects/project-one/invites",
          "POST",
          { role: "admin" },
          editor.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (await f.request("/api/projects", "GET", undefined, editor.token)).value,
    ).toHaveLength(1);
    await f.request(
      "/api/projects/project-one/members",
      "PATCH",
      { userId: editor.user.id, role: null },
      f.admin.token,
    );
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invite.value.invite },
          editor.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/api/projects/project-one",
          "GET",
          undefined,
          editor.token,
        )
      ).status,
    ).toBe(403);
  });
  it("allows different accounts to accept an invitation concurrently", async () => {
    const f = await fixture(),
      one = await f.register("one"),
      two = await f.register("two");
    const invite = (
      await f.request(
        "/api/projects/project-one/invites",
        "POST",
        { role: "viewer" },
        f.admin.token,
      )
    ).value;
    const responses = await Promise.all(
      [one, two].map((user) =>
        f.request(
          "/api/invites/accept",
          "POST",
          { invite: invite.invite },
          user.token,
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 200,
    ]);
    expect(
      (
        await f.request(
          "/api/projects/project-one/members",
          "GET",
          undefined,
          f.admin.token,
        )
      ).value,
    ).toHaveLength(3);
  });
  it("keeps one link available for repeated registration and preserves existing roles", async () => {
    const f = await fixture();
    const invitation = (
      await f.request(
        "/api/projects/project-one/invites",
        "POST",
        { role: "editor" },
        f.admin.token,
      )
    ).value;
    const joined = [];
    for (const name of ["first", "second", "third"]) {
      expect(
        (
          await f.request("/api/invites/preview", "POST", {
            invite: invitation.invite,
          })
        ).status,
      ).toBe(200);
      const registration = await f.request("/api/auth/register", "POST", {
        name,
        password: "test-password",
        invite: invitation.invite,
      });
      expect(registration.status).toBe(201);
      const user = registration.value;
      joined.push(user);
      const accepted = await f.request(
        "/api/invites/accept",
        "POST",
        { invite: invitation.invite },
        user.token,
      );
      expect(accepted.status).toBe(200);
      expect(accepted.value.role).toBe("editor");
    }
    await f.request(
      "/api/projects/project-one/members",
      "PATCH",
      { userId: joined[0].user.id, role: "viewer" },
      f.admin.token,
    );
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          joined[0].token,
        )
      ).value.role,
    ).toBe("viewer");
    const invitations = await f.request(
      "/api/projects/project-one/invites",
      "GET",
      undefined,
      f.admin.token,
    );
    expect(invitations.value[0].accepted_count).toBe(3);
    await f.request(
      "/api/projects/project-one/invites/revoke",
      "POST",
      { digest: await hash(invitation.invite) },
      f.admin.token,
    );
    expect(
      (
        await f.request("/api/invites/preview", "POST", {
          invite: invitation.invite,
        })
      ).status,
    ).toBe(410);
    expect(
      (
        await f.request("/api/auth/register", "POST", {
          name: "after-revocation",
          password: "test-password",
          invite: invitation.invite,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          joined[1].token,
        )
      ).status,
    ).toBe(410);
  });
  it("migrates legacy claims so old links admit more members without restoring removed users", async () => {
    const f = await fixture(),
      original = await f.register("original"),
      newcomer = await f.register("newcomer");
    const invitation = (
      await f.request(
        "/api/projects/project-one/invites",
        "POST",
        { role: "viewer" },
        f.admin.token,
      )
    ).value;
    const metadata = new SQLiteMetadata(join(f.home, "metadata.sqlite"));
    await metadata.run("UPDATE invites SET accepted_by=? WHERE digest=?", [
      original.user.id,
      await hash(invitation.invite),
    ]);
    // Legacy databases predate the explicit schema-version checkpoint.
    await metadata.run("DELETE FROM settings WHERE key='schema_version'");
    metadata.close();
    const upgraded = await startSyncServer({
      home: f.home,
      port: 0,
      registrationKey: "testing-key",
    });
    cleanup.push(() => upgraded.close());
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          original.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          newcomer.token,
        )
      ).value.role,
    ).toBe("viewer");
    expect(
      (
        await f.request(
          "/api/projects/project-one/invites",
          "GET",
          undefined,
          f.admin.token,
        )
      ).value[0].accepted_count,
    ).toBe(2);
  });
  it("keeps at least one administrator and checks live membership on every request", async () => {
    const f = await fixture(),
      other = await f.register("other");
    expect(
      (
        await f.request(
          "/api/projects/project-one/members",
          "PATCH",
          { userId: f.admin.user.id, role: null },
          f.admin.token,
        )
      ).status,
    ).toBe(409);
    const invite = (
      await f.request(
        "/api/projects/project-one/invites",
        "POST",
        { role: "admin" },
        f.admin.token,
      )
    ).value;
    await f.request(
      "/api/invites/accept",
      "POST",
      { invite: invite.invite },
      other.token,
    );
    const responses = await Promise.all(
      [f.admin, other].map((user) =>
        f.request(
          "/api/projects/project-one/members",
          "PATCH",
          { userId: user.user.id, role: "viewer" },
          user.token,
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const members = (
      await f.request(
        "/api/projects/project-one/members",
        "GET",
        undefined,
        f.admin.token,
      )
    ).value;
    expect(
      members.filter((member: { role: string }) => member.role === "admin"),
    ).toHaveLength(1);
    const remaining =
      members.find((member: { role: string }) => member.role === "admin").id ===
      f.admin.user.id
        ? f.admin
        : other;
    const removed = remaining === f.admin ? other : f.admin;
    await f.request(
      "/api/projects/project-one/members",
      "PATCH",
      { userId: removed.user.id, role: null },
      remaining.token,
    );
    expect(
      (
        await f.request(
          "/api/projects/project-one",
          "GET",
          undefined,
          removed.token,
        )
      ).status,
    ).toBe(403);
  });
  it("verifies complete content, rejects foreign paths, and preserves concurrent branches", async () => {
    const f = await fixture(),
      bytes = new TextEncoder().encode(
        '{"id":"project-one","name":"Project One"}',
      ),
      digest = await hash(bytes);
    const make = (
      operationId: string,
      parents: string[] = [],
    ): ProjectSnapshot => ({
      format: syncProtocol,
      projectId: "project-one",
      parents,
      files: { "projects/project-one/project.json": digest },
      change: {
        at: new Date().toISOString(),
        actor: { kind: "human" },
        channel: "desktop",
        operationId,
        paths: ["projects/project-one/project.json"],
      },
    });
    expect(
      (
        await f.request(
          "/api/projects/project-one/revisions",
          "POST",
          { snapshot: make("missing"), expected: null },
          f.admin.token,
        )
      ).value.error.code,
    ).toBe("MISSING_OBJECT");
    const uploaded = await fetch(
      `${f.url}/api/projects/project-one/objects/${digest}`,
      {
        method: "PUT",
        body: bytes,
        headers: { authorization: `Bearer ${f.admin.token}` },
      },
    );
    expect(uploaded.status).toBe(200);
    const first = await f.request(
      "/api/projects/project-one/revisions",
      "POST",
      { snapshot: make("first"), expected: null },
      f.admin.token,
    );
    expect(first.status).toBe(200);
    const responses = await Promise.all(
      ["a", "b"].map((operationId) =>
        f.request(
          "/api/projects/project-one/revisions",
          "POST",
          {
            snapshot: make(operationId, [first.value.revision]),
            expected: first.value.revision,
          },
          f.admin.token,
        ),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const history = (
      await f.request(
        "/api/projects/project-one/revisions",
        "GET",
        undefined,
        f.admin.token,
      )
    ).value;
    expect(history.entries).toHaveLength(3);
    expect(
      history.entries.filter(
        (entry: { published: boolean }) => !entry.published,
      ),
    ).toHaveLength(1);
    const invalid = make("foreign");
    invalid.files["projects/other-project/pages/page.json"] = digest;
    expect(
      (
        await f.request(
          "/api/projects/project-one/revisions",
          "POST",
          { snapshot: invalid, expected: history.head },
          f.admin.token,
        )
      ).status,
    ).toBe(400);
    const foreign = await f.register("foreign");
    expect(
      (
        await fetch(`${f.url}/api/projects/project-one/objects/${digest}`, {
          headers: { authorization: `Bearer ${foreign.token}` },
        })
      ).status,
    ).toBe(403);
  });
  it("retains server identity, tokens and data after restart; supports token revocation", async () => {
    const f = await fixture(),
      before = (await f.request("/api/info")).value.serverId;
    await f.close();
    cleanup.pop();
    const restarted = await startSyncServer({ home: f.home, port: 0 });
    cleanup.push(() => restarted.close());
    expect(
      (await (await fetch(restarted.url + "/api/info")).json()).serverId,
    ).toBe(before);
    const headers = {
      authorization: `Bearer ${f.admin.token}`,
      "content-type": "application/json",
    };
    expect(
      await (await fetch(restarted.url + "/api/projects", { headers })).json(),
    ).toHaveLength(1);
    const sessions = await (
      await fetch(restarted.url + "/api/sessions", { headers })
    ).json();
    await fetch(restarted.url + "/api/sessions/revoke", {
      method: "POST",
      headers,
      body: JSON.stringify({ digest: sessions[0].digest }),
    });
    expect(
      (await fetch(restarted.url + "/api/projects", { headers })).status,
    ).toBe(401);
  });
});
