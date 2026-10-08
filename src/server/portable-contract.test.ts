import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "./node";
import { hash } from "../sync/protocol";
import { invitationBaseUrl, serverBaseUrl } from "../sync/server-url";

test("the actual deployment shares invitations and cannot restore removed membership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-portable-contract-"));
  const local = process.env.SHOWAI_SYNC_TEST_URL
    ? undefined
    : await startSyncServer({
        home: directory,
        port: 0,
        registrationMode: "open",
      });
  const url = process.env.SHOWAI_SYNC_TEST_URL ?? local!.url;
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    token?: string,
  ) => {
    const response = await fetch(url + path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { status: response.status, value: await response.json() };
  };
  try {
    const register = async () => {
      const result = await request("/api/auth/register", "POST", {
        name: `contract-${crypto.randomUUID()}`,
        password: "test-password",
        registrationKey: process.env.SHOWAI_SYNC_TEST_KEY,
      });
      expect(result.status).toBe(201);
      return result.value;
    };
    const admin = await register(),
      member = await register(),
      other = await register();
    const projectId = crypto.randomUUID();
    expect(
      (
        await request(
          "/api/projects",
          "POST",
          { id: projectId, name: "Portable invitation contract" },
          admin.token,
        )
      ).status,
    ).toBe(201);
    const invitation = (
      await request(
        `/api/projects/${projectId}/invites`,
        "POST",
        { role: "editor" },
        admin.token,
      )
    ).value;
    expect(invitation.url).toMatch(/^https?:\/\//);
    if (process.env.SHOWAI_SYNC_TEST_PUBLIC_URL)
      expect(invitationBaseUrl(invitation.url)).toBe(
        serverBaseUrl(process.env.SHOWAI_SYNC_TEST_PUBLIC_URL),
      );
    const acceptance = await Promise.all(
      [member, other].map((user) =>
        request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          user.token,
        ),
      ),
    );
    expect(acceptance.map((result) => result.status).sort()).toEqual([
      200, 200,
    ]);
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          member.token,
        )
      ).status,
    ).toBe(200);
    await request(
      `/api/projects/${projectId}/members`,
      "PATCH",
      { userId: member.user.id, role: null },
      admin.token,
    );
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          member.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/projects/${projectId}`,
          "GET",
          undefined,
          member.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/projects/${projectId}/members`,
          "PATCH",
          { userId: admin.user.id, role: "viewer" },
          admin.token,
        )
      ).status,
    ).toBe(409);
    const registration = await request("/api/auth/register", "POST", {
      name: `contract-invited-${crypto.randomUUID()}`,
      password: "test-password",
      invite: invitation.invite,
    });
    expect(registration.status).toBe(201);
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          registration.value.token,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/projects/${projectId}/invites`,
          "GET",
          undefined,
          admin.token,
        )
      ).value[0].accepted_count,
    ).toBe(3);
    await request(
      `/api/projects/${projectId}/invites/revoke`,
      "POST",
      { digest: await hash(invitation.invite) },
      admin.token,
    );
    expect(
      (
        await request("/api/invites/preview", "POST", {
          invite: invitation.invite,
        })
      ).status,
    ).toBe(410);
    await request(
      `/api/projects/${projectId}`,
      "PATCH",
      { archived: true },
      admin.token,
    );
  } finally {
    await local?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
