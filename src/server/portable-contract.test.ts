import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startSyncServer } from "./node";

test("the actual deployment consumes invitations once and cannot restore removed membership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "showai-portable-contract-"));
  const local = process.env.SHOWAI_SYNC_TEST_URL
    ? undefined
    : await startSyncServer({ home: directory, port: 0 });
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
      200, 410,
    ]);
    const winner = acceptance[0].status === 200 ? member : other;
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          winner.token,
        )
      ).status,
    ).toBe(200);
    await request(
      `/api/projects/${projectId}/members`,
      "PATCH",
      { userId: winner.user.id, role: null },
      admin.token,
    );
    expect(
      (
        await request(
          "/api/invites/accept",
          "POST",
          { invite: invitation.invite },
          winner.token,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/projects/${projectId}`,
          "GET",
          undefined,
          winner.token,
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
  } finally {
    await local?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
